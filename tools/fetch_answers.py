"""Fetch the official answer key from the BAMF Online-Testcenter.

Usage: python3 tools/fetch_answers.py [--force] [CODE ...]   (default: all 16 states)

Each state's catalogue has 310 rows: the 300 general questions, then its 10 state questions.
Bayern is fetched in full and is the source for the general answers. Every other state only
needs rows 301-310, plus rows 1, 130 and 300 as spot checks that its general rows match Bayern's.

Writes build/answers/<CODE>.json (records: num, id, answers[{text, correct}], note). States that
already have a file are skipped unless --force is given, so an interrupted run resumes where it
stopped. Requests go one at a time with a pause, around 500 in total (5-10 minutes).
"""

import argparse
import sys

from common import ANSWERS, CODES, STATES, load_json, write_json
from oet import Catalogue

PRIMARY = "BY"
SPOT_CHECKS = [1, 130, 300]
STATE_ROWS = list(range(301, 311))
NAMES = dict(STATES)


def fetch_state(code: str) -> list[dict]:
    rows = list(range(1, 311)) if code == PRIMARY else SPOT_CHECKS + STATE_ROWS
    cat = Catalogue(NAMES[code])
    out = []
    for n in rows:
        out.append(cat.question(n))
        if n % 50 == 0 or n == rows[-1]:
            print(f"  {code}: row {n}", flush=True)
    return out


def problems_in(code: str, records: list[dict]) -> list[str]:
    out = []
    for r in records:
        correct = sum(a["correct"] for a in r["answers"])
        if len(r["answers"]) != 4 or correct != 1:
            out.append(f"{code} row {r['num']}: {len(r['answers'])} answers, {correct} correct")
    return out


def correct_text(record: dict) -> str:
    return next(a["text"] for a in record["answers"] if a["correct"])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("codes", nargs="*", metavar="CODE", help="state codes, default: all")
    ap.add_argument("--force", action="store_true", help="fetch again even if build/answers/<CODE>.json exists")
    args = ap.parse_args()
    codes = args.codes or CODES
    unknown = sorted(set(codes) - set(CODES))
    if unknown:
        sys.exit(f"unknown state codes: {unknown}")

    problems = []
    for code in [PRIMARY] + [c for c in codes if c != PRIMARY]:
        path = ANSWERS / f"{code}.json"
        if path.exists() and not args.force:
            print(f"{code}: cached in {path}")
            continue
        print(f"{code}: fetching", flush=True)
        records = fetch_state(code)
        bad = problems_in(code, records)
        problems += bad
        if not bad:
            write_json(path, records)

    primary = {r["num"]: r for r in load_json(ANSWERS / f"{PRIMARY}.json")}
    for code in CODES:
        path = ANSWERS / f"{code}.json"
        if code == PRIMARY or not path.exists():
            continue
        for r in load_json(path):
            if r["num"] in SPOT_CHECKS and (correct_text(r), r["id"]) != (
                correct_text(primary[r["num"]]),
                primary[r["num"]]["id"],
            ):
                problems.append(f"{code} row {r['num']} differs from {PRIMARY}")

    if problems:
        sys.exit("answer key problems:\n  " + "\n  ".join(problems))
    print("answer key OK")


if __name__ == "__main__":
    main()
