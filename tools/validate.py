"""Check data/questions.json and translations/*.json.

Usage: python3 tools/validate.py [--strict]

Questions: 300 general (g1..g300) and 16 states x 10 (<CODE>1..10); every question has a
non-empty text, exactly 4 distinct non-empty options, an answer index 0..3, an img that is
null or img/<name>.webp, and no third-party (©) picture credit.
Translations: every key is a known question id and every entry has a non-empty "q" and exactly
4 options. Missing translations are reported; --strict turns them into errors.
Exits non-zero on any error.
"""

import argparse
import re
import sys
from typing import Any

from common import CODES, GENERAL_COUNT, QUESTIONS, STATE_COUNT, TRANSLATIONS, load_json, question_ids

errors: list[str] = []


def check_question(q: dict[str, Any], want_id: str) -> None:
    qid = q.get("id")
    if qid != want_id:
        errors.append(f"{want_id}: id is {qid!r}")
    if not isinstance(q.get("q"), str) or not q["q"].strip():
        errors.append(f"{qid}: empty question text")
    o = q.get("o")
    if not isinstance(o, list) or len(o) != 4 or not all(isinstance(x, str) and x.strip() for x in o):
        errors.append(f"{qid}: options must be 4 non-empty strings, got {o!r}")
    elif len(set(o)) != 4:
        errors.append(f"{qid}: duplicate options {o!r}")
    a = q.get("a")
    if not isinstance(a, int) or isinstance(a, bool) or not 0 <= a <= 3:
        errors.append(f"{qid}: a must be an int 0..3, got {a!r}")
    img = q.get("img")
    if img is not None and not (isinstance(img, str) and re.fullmatch(r"img/[\w-]+\.webp", img)):
        errors.append(f"{qid}: img must be null or img/<name>.webp, got {img!r}")
    credit = q.get("credit", "")
    if not isinstance(credit, str):
        errors.append(f"{qid}: credit must be a string")
    elif "©" in credit:
        errors.append(f"{qid}: third-party picture ({credit}); see AGENTS.md, Licensing")


def check_questions(doc: dict[str, Any]) -> None:
    gen = doc.get("general", [])
    if len(gen) != GENERAL_COUNT:
        errors.append(f"general: {len(gen)} questions, expected {GENERAL_COUNT}")
    for i, q in enumerate(gen, start=1):
        check_question(q, f"g{i}")
        if q.get("n") != i:
            errors.append(f"g{i}: n is {q.get('n')!r}")
    states = doc.get("states", {})
    if list(states) != CODES:
        errors.append(f"states: keys {list(states)}, expected {CODES}")
    for code in CODES:
        st = states.get(code)
        if not st:
            continue
        if not st.get("name"):
            errors.append(f"{code}: missing name")
        qs = st.get("questions", [])
        if len(qs) != STATE_COUNT:
            errors.append(f"{code}: {len(qs)} questions, expected {STATE_COUNT}")
        for k, q in enumerate(qs, start=1):
            check_question(q, f"{code}{k}")
            if q.get("k") != k:
                errors.append(f"{code}{k}: k is {q.get('k')!r}")


def check_translations(ids: list[str], strict: bool) -> None:
    known = set(ids)
    for path in sorted(TRANSLATIONS.glob("*.json")):
        lang = path.stem
        hints = load_json(path)
        for qid, e in hints.items():
            if qid not in known:
                errors.append(f"{path.name}: unknown question id {qid}")
                continue
            ok = isinstance(e, dict) and isinstance(e.get("q"), str) and e["q"].strip()
            o = e.get("o") if isinstance(e, dict) else None
            ok = ok and isinstance(o, list) and len(o) == 4 and all(isinstance(x, str) and x.strip() for x in o)
            if not ok:
                errors.append(f"{path.name}: {qid} needs a non-empty q and 4 non-empty options")
        missing = [i for i in ids if i not in hints]
        print(
            f"translations/{lang}.json: {len(hints)} of {len(ids)} questions"
            + (f", missing {missing}" if missing else "")
        )
        if missing and strict:
            errors.append(f"{path.name}: {len(missing)} questions without translation")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true", help="treat missing translations as errors")
    args = ap.parse_args()

    doc = load_json(QUESTIONS)
    check_questions(doc)
    ids = question_ids(doc)
    n_img = sum(1 for q in doc["general"] if q.get("img"))
    n_img += sum(1 for st in doc["states"].values() for q in st["questions"] if q.get("img"))
    if not re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", str(doc.get("source", {}).get("edition"))):
        errors.append("source.edition must be the catalogue date dd.mm.yyyy (shown in Settings > About)")
    print(f"{QUESTIONS.name}: {len(ids)} questions, {n_img} with pictures, edition {doc['source'].get('edition')}")
    check_translations(ids, args.strict)
    if errors:
        print(f"{len(errors)} ERROR(S):", *errors, sep="\n  ")
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
