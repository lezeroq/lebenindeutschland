"""Fetch the answer key for one Bundesland's 10 state rows (301-310) plus 3 general spot checks.

Usage: python3 -I tools/scrape_state.py <STATE_ID> <out.json> [<BY.json reference>]

Opens the catalogue (page 30) for the state, then jumps straight to the wanted rows via
P30_ROWNUM instead of walking all 310 rows. One request at a time, 0.4 s apart, with a few
retries and backoff on failure. Output records have the same shape as scrape.py's
(num, answers[{text, correct}], note, id).
"""
import html
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oet import get, submit  # noqa: E402

STATE_ID = sys.argv[1]
OUT = sys.argv[2]
REF = sys.argv[3] if len(sys.argv) > 3 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data-src", "answers", "BY.json")

SPOT_CHECKS = [1, 130, 300]
STATE_ROWS = list(range(301, 311))
PAUSE = 0.4


def text(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def parse(page):
    """Same parser as scrape.py: row number, 4 answers with correct flag, explanation note."""
    num = int(re.search(r"Aufgabe (\d+) von 310", page).group(1))
    answers = []
    rows = re.findall(
        r'<span id="\d" style="[^"]*">(richtige|falsche) Antwort =&?g?t?;?></span>.*?'
        r'<input type="radio" name="f20".*?/>\s*</td>\s*<td[^>]*>(.*?)</td>',
        page, re.S)
    for flag, ans in rows:
        answers.append({"text": text(ans), "correct": flag == "richtige"})
    expl = re.search(r"Erläuterung.*?<td[^>]*>(.*?)</td>", page, re.S)
    return {"num": num, "answers": answers, "note": text(expl.group(1)) if expl else ""}


def polite(fn, *args, tries=4):
    """Call fn with a pause before it; on failure back off (2, 4, 8 s) and retry."""
    delay = 2
    for attempt in range(1, tries + 1):
        time.sleep(PAUSE)
        try:
            return fn(*args)
        except Exception as e:  # network errors, timeouts, unexpected page
            if attempt == tries:
                raise
            print(f"  attempt {attempt} failed ({e!r}); retrying in {delay}s", file=sys.stderr)
            time.sleep(delay)
            delay *= 2


def open_catalogue():
    _, p1 = polite(get, "f?p=514:1:0")
    _, page = polite(submit, p1, "SUBMIT", {"P1_BUL_ID": STATE_ID})
    ids = re.findall(r'<option value="(\d+)"[^>]*>(\d+)', page)
    rowmap = {int(n): qid for qid, n in ids}
    if len(rowmap) != 310:
        raise RuntimeError(f"catalogue has {len(rowmap)} rows, expected 310")
    return page, rowmap


def fetch_row(page, rowmap, n):
    def go():
        _, p = submit(page, "P30_ROWNUM", {"P30_ROWNUM": rowmap[n]})
        rec = parse(p)
        if rec["num"] != n:
            raise RuntimeError(f"asked for row {n}, got {rec['num']}")
        return p, rec
    return polite(go)


def main():
    page, rowmap = open_catalogue()
    results, problems = [], []
    first = parse(page)  # catalogue opens on row 1
    for n in SPOT_CHECKS + STATE_ROWS:
        if n == 1 and first["num"] == 1:
            rec = first
        else:
            page, rec = fetch_row(page, rowmap, n)
        rec["id"] = rowmap[n]
        ok = len(rec["answers"]) == 4 and sum(a["correct"] for a in rec["answers"]) == 1
        if not ok:
            problems.append(f"row {n}: {len(rec['answers'])} answers, "
                            f"{sum(a['correct'] for a in rec['answers'])} correct")
        results.append(rec)
        print(f"row {n} id {rec['id']} ok={ok} {rec['note']}", flush=True)

    ref = {r["num"]: r for r in json.load(open(REF, encoding="utf-8"))}
    for rec in results:
        if rec["num"] in SPOT_CHECKS:
            want = [a["text"] for a in ref[rec["num"]]["answers"] if a["correct"]]
            got = [a["text"] for a in rec["answers"] if a["correct"]]
            same = want == got and rec["id"] == ref[rec["num"]]["id"]
            print(f"spot check row {rec['num']}: {'MATCH' if same else 'MISMATCH'} {got} vs BY {want}")
            if not same:
                problems.append(f"spot check row {rec['num']} differs from BY.json")

    results.sort(key=lambda r: r["num"])
    json.dump(results, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("saved", len(results), "rows to", OUT)
    if problems:
        print("PROBLEMS:", *problems, sep="\n  ", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
