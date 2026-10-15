"""Assemble data/questions.json from the catalogue PDF and the Testcenter answer key.

Usage: python3 tools/build_questions.py

Reads build/katalog.pdf, build/catalogue.json and build/answers/*.json. The PDF has the
authoritative wording and option order, the Testcenter says which answer is correct. The
Testcenter may list the options in another order or spell them slightly differently, so the
four options are paired by token-sorted fuzzy similarity; weak pairings are printed for review.

Prints which questions changed compared to the previous data/questions.json, so their
translations can be updated.
"""

import datetime
import difflib
import itertools
import re
import subprocess
import sys
from typing import Any

from common import (
    ANSWERS,
    CATALOGUE,
    CODES,
    GENERAL_COUNT,
    PDF,
    QUESTIONS,
    STATE_COUNT,
    STATES,
    load_json,
    write_json,
)
from pictures import ANNEX_PHOTOS, detect, image_path, sha256

PRIMARY = "BY"  # fetch_answers.py takes the general answers from this state's catalogue
MIN_SCORE = 0.85  # weakest option pairing that still counts as a clear match
MIN_MARGIN = 0.25  # how much better the chosen option must match the correct answer than the runner-up


def words(s: str) -> list[str]:
    s = re.sub(r"^Bild (\d)$", r"\1", s.strip())
    return re.findall(r"\w+", s.lower().replace("selbstständig", "selbständig"))


def key(s: str) -> str:
    """Word order does not matter: the Testcenter writes "Bürger / Bürgerin", the PDF "Bürgerin/Bürger"."""
    return " ".join(sorted(words(s)))


def sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, key(a), key(b)).ratio()


def correct_option(q: dict, web: dict) -> tuple[int, list[str]]:
    """Index of the correct option in PDF order, and warnings when the pairing is weak."""
    wtexts = [a["text"] for a in web["answers"]]
    wc = next(k for k, a in enumerate(web["answers"]) if a["correct"])
    # Unambiguous when exactly one PDF option has the same words, in order or in any order.
    for same in (lambda a, b: words(a) == words(b), lambda a, b: key(a) == key(b)):
        hits = [i for i, opt in enumerate(q["options"]) if same(wtexts[wc], opt)]
        if len(hits) == 1:
            return hits[0], []
    # Otherwise pair all four options at once by fuzzy similarity.
    m = [[sim(wt, pt) for pt in q["options"]] for wt in wtexts]
    perm = max(itertools.permutations(range(4)), key=lambda pm: sum(m[k][pm[k]] for k in range(4)))
    idx = perm[wc]
    min_score = min(m[k][perm[k]] for k in range(4))
    margin = m[wc][idx] - max(m[wc][j] for j in range(4) if j != idx)
    warnings = []
    if min_score < MIN_SCORE or margin < MIN_MARGIN:
        warnings.append(
            f"{q['id']}: weak match (min score {min_score:.2f}, margin {margin:.2f})\n"
            f"      PDF: {q['options']}\n      web: {wtexts} -> correct {wtexts[wc]!r}"
        )
    return idx, warnings


def edition() -> str:
    """The catalogue's "Stand" date from the PDF title, e.g. 07.05.2025 (shown in Settings > About)."""
    info = subprocess.run(["pdfinfo", str(PDF)], capture_output=True, text=True, check=True).stdout
    m = re.search(r"Stand:?\s*(\d{2}\.\d{2}\.\d{4})", info)
    if not m:
        sys.exit(f"no 'Stand: dd.mm.yyyy' in the title of {PDF}")
    return m.group(1)


def build(pictures: set[str]) -> tuple[dict[str, Any], list[str]]:
    catalogue = {q["id"]: q for q in load_json(CATALOGUE)}
    answers = {code: {r["num"]: r for r in load_json(ANSWERS / f"{code}.json")} for code in CODES}
    warnings: list[str] = []

    def record(q: dict, web: dict, extra: dict) -> dict:
        idx, warn = correct_option(q, web)
        warnings.extend(warn)
        img = image_path(q) if q["id"] in pictures else None
        # the credit belongs to the PDF's photo; ANNEX_PHOTOS replaces it with the uncredited official one
        credit = "" if q["id"] in ANNEX_PHOTOS else q["credit"]
        return {
            "id": q["id"],
            **extra,
            "q": q["question"],
            "o": q["options"],
            "a": idx,
            "img": img,
            "credit": credit,
        }

    general = [record(catalogue[f"g{n}"], answers[PRIMARY][n], {"n": n}) for n in range(1, GENERAL_COUNT + 1)]
    states = {}
    for code, name in STATES:
        rows = [
            record(catalogue[f"{code}{k}"], answers[code][GENERAL_COUNT + k], {"k": k})
            for k in range(1, STATE_COUNT + 1)
        ]
        states[code] = {"name": name, "questions": rows}
    doc = {
        "source": {
            "catalogue": "BAMF Gesamtfragenkatalog",
            "edition": edition(),
            "answers": "BAMF Online-Testcenter oet.bamf.de",
            "retrieved": datetime.date.today().isoformat(),
            "pdf_sha256": sha256(PDF),
        },
        "general": general,
        "states": states,
    }
    return doc, warnings


def by_id(doc: dict[str, Any]) -> dict[str, dict]:
    out = {q["id"]: q for q in doc["general"]}
    for st in doc["states"].values():
        out |= {q["id"]: q for q in st["questions"]}
    return out


def changes(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    names = {"q": "question", "o": "options", "a": "answer", "img": "picture", "credit": "credit"}
    a, b = by_id(old), by_id(new)
    out = []
    for qid in b:
        if qid not in a:
            out.append(f"{qid}: new")
            continue
        diff = [names[k] for k in names if a[qid].get(k) != b[qid].get(k)]
        if diff:
            out.append(f"{qid}: {', '.join(diff)}")
    out += [f"{qid}: removed" for qid in a if qid not in b]
    return out


def main() -> None:
    catalogue = load_json(CATALOGUE)
    doc, warnings = build(set(detect(PDF, catalogue)))
    old = load_json(QUESTIONS) if QUESTIONS.exists() else None
    changed = changes(old, doc) if old else []
    if old and not changed and old["source"].get("pdf_sha256") == doc["source"]["pdf_sha256"]:
        doc["source"]["retrieved"] = old["source"]["retrieved"]  # nothing new: keep the file unchanged
    write_json(QUESTIONS, doc)

    n_img = sum(1 for q in by_id(doc).values() if q["img"])
    print(f"wrote {QUESTIONS}: {len(doc['general'])} general + {len(doc['states'])} states, {n_img} pictures")
    print(f"source: {doc['source']['catalogue']}, Stand {doc['source']['edition']}")
    for w in warnings:
        print("WARN", w, file=sys.stderr)
    if changed:
        print(f"{len(changed)} question(s) changed since the previous data/questions.json:")
        print("  " + "\n  ".join(changed))
        if any(("question" in c or "options" in c or c.endswith(": new")) for c in changed):
            print("Update the translations of new questions and changed questions or options (see AGENTS.md).")
    elif old:
        print("no question changed")


if __name__ == "__main__":
    main()
