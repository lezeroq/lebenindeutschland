"""Parse the catalogue text (pdftotext -layout) into questions.

Usage: python3 tools/parse_catalogue.py

Reads build/katalog.txt and writes build/catalogue.json: one record per question with
id (g1..g300, BW1..TH10), section ("general" or a state code), num, page, question, credit and
options in PDF order. The PDF wording is authoritative; the answer key comes from the Testcenter.
"""

import re
import sys

from common import CATALOGUE, CODES, GENERAL_COUNT, PDF_TEXT, STATE_COUNT, STATES, write_json

BOXES = (chr(0xF0A3), "□")  # checkbox glyphs pdftotext emits before each option
STATE_BY_NAME = {name: code for code, name in STATES}


def parse(text: str) -> list[dict]:
    raw: list[dict] = []
    section = "general"
    cur: dict | None = None
    for pno, page in enumerate(text.split("\f"), start=1):
        for line in page.split("\n"):
            s = line.strip()
            m = re.match(r"Fragen für das Bundesland (.+)$", s)
            if m:
                name = m.group(1).strip()
                if name not in STATE_BY_NAME:
                    sys.exit(f"unknown state heading {name!r} on page {pno}")
                section = STATE_BY_NAME[name]
                cur = None
                continue
            if re.match(r"Seite \d+ von \d+$", s) or s in ("Teil I", "Teil II", "Allgemeine Fragen"):
                continue
            m = re.match(r"Aufgabe (\d+)$", s)
            if m:
                cur = {"section": section, "num": int(m.group(1)), "page": pno, "q": [], "opts": []}
                raw.append(cur)
                continue
            if cur is None or not s:
                continue
            if s.startswith(BOXES):
                cur["opts"].append(s[1:].strip())
            elif cur["opts"] and line.startswith("    ") and not re.match(r"^\s*Bild \d", line):
                cur["opts"][-1] += " " + s  # wrapped option line
            elif not cur["opts"]:
                cur["q"].append(s)

    out = []
    for q in raw:
        # picture grid captions ("Bild 1   Bild 2 ...") and photo credits are not question text
        lines = [ln for ln in q["q"] if not re.fullmatch(r"(Bild \d\s*)+", ln)]
        credit = " ".join(ln for ln in lines if ln.startswith(("©", "In Anlehnung an")))
        text = " ".join(ln for ln in lines if not ln.startswith(("©", "In Anlehnung an")))
        text = re.sub(r"^%d\.\s*" % q["num"], "", text)
        qid = f"g{q['num']}" if q["section"] == "general" else f"{q['section']}{q['num']}"
        out.append(
            {
                "id": qid,
                "section": q["section"],
                "num": q["num"],
                "page": q["page"],
                "question": " ".join(text.split()),
                "credit": credit,
                "options": [" ".join(o.split()) for o in q["opts"]],
            }
        )
    return out


def check(questions: list[dict]) -> list[str]:
    problems = []
    want = [f"g{n}" for n in range(1, GENERAL_COUNT + 1)]
    want += [f"{code}{k}" for code in CODES for k in range(1, STATE_COUNT + 1)]
    got = [q["id"] for q in questions]
    if got != want:
        problems.append(f"expected {len(want)} questions g1..g300, BW1..TH10 in order; got {len(got)}")
    for q in questions:
        if len(q["options"]) != 4:
            problems.append(f"{q['id']}: {len(q['options'])} options")
        if not q["question"]:
            problems.append(f"{q['id']}: empty question text")
    return problems


def main() -> None:
    questions = parse(PDF_TEXT.read_text(encoding="utf-8"))
    problems = check(questions)
    write_json(CATALOGUE, questions)
    print(f"wrote {CATALOGUE}: {len(questions)} questions")
    if problems:
        sys.exit("catalogue problems:\n  " + "\n  ".join(problems))


if __name__ == "__main__":
    main()
