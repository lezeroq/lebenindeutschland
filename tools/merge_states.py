"""Join each state's 10 PDF questions (authoritative wording) with the Testcenter answer key.

Usage: python3 -I tools/merge_states.py [CODE ...]   (default: all 16 states)

Reads data-src/pdf/parsed_<CODE>.json (rows 301-310 = state Aufgabe 1-10) and
data-src/answers/<CODE>.json (rows num 301-310), finds the best option permutation with the
same token-sorted fuzzy similarity as merge.py, and writes data-src/merged/<CODE>.json with
records shaped like bayern_merged.json (n, section, num, page, question, credit, options,
correct (0-based PDF index), web_correct_text, identity_order, min_score, margin).
"""
import difflib
import itertools
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data-src")
CODES = "BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH".split()


def key(s):
    s = re.sub(r"^Bild (\d)$", r"\1", s.strip())
    toks = re.findall(r"\w+", s.lower().replace("selbstständig", "selbständig"))
    return " ".join(sorted(toks))


def sim(a, b):
    return difflib.SequenceMatcher(None, key(a), key(b)).ratio()


def merge_state(code):
    pdf = json.load(open(f"{ROOT}/pdf/parsed_{code}.json", encoding="utf-8"))[300:]
    web = {r["num"]: r for r in json.load(open(f"{ROOT}/answers/{code}.json", encoding="utf-8"))}
    assert len(pdf) == 10 and [p["num"] for p in pdf] == list(range(1, 11)), code
    merged, weak = [], []
    for p in pdf:
        n = 300 + p["num"]
        w = web[n]
        assert len(w["answers"]) == 4 and sum(a["correct"] for a in w["answers"]) == 1, (code, n)
        wtexts = [a["text"] for a in w["answers"]]
        m = [[sim(wt, pt) for pt in p["options"]] for wt in wtexts]
        perm = max(itertools.permutations(range(4)), key=lambda pm: sum(m[k][pm[k]] for k in range(4)))
        scores = [m[k][perm[k]] for k in range(4)]
        wc = next(k for k, a in enumerate(w["answers"]) if a["correct"])
        idx = perm[wc]
        runner_up = max(m[wc][j] for j in range(4) if j != idx)
        rec = {
            "n": n, "section": p["section"], "num": p["num"], "page": p["page"],
            "question": p["question"], "credit": p["credit"], "options": p["options"], "correct": idx,
            "web_correct_text": wtexts[wc], "identity_order": list(perm) == [0, 1, 2, 3],
            "min_score": round(min(scores), 3), "margin": round(m[wc][idx] - runner_up, 3),
            "web_options": wtexts, "note": w["note"],
        }
        if min(scores) < 0.85 or rec["margin"] < 0.25:
            weak.append(rec)
        merged.append(rec)
    os.makedirs(f"{ROOT}/merged", exist_ok=True)
    json.dump(merged, open(f"{ROOT}/merged/{code}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    reordered = [r["num"] for r in merged if not r["identity_order"]]
    print(f"{code}: merged {len(merged)} | weak {len(weak)} | order differs from PDF: {reordered or 'none'}"
          f" | correct (1-based) {[r['correct'] + 1 for r in merged]}")
    for r in weak:
        print(f"   weak {code}{r['num']}: min_score={r['min_score']} margin={r['margin']}")
        print(f"      PDF: {r['options']}")
        print(f"      web: {r['web_options']} -> correct {r['web_correct_text']!r}")
    return merged


if __name__ == "__main__":
    for c in sys.argv[1:] or CODES:
        merge_state(c)
