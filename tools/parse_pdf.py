"""Parse the BAMF Gesamtfragenkatalog text (pdftotext -layout) into questions."""
import json
import re
import sys

BOX = chr(0xF0A3)  # checkbox glyph pdftotext emits before each option

src, state, out = sys.argv[1], sys.argv[2], sys.argv[3]
pages = open(src, encoding="utf-8").read().split("\f")

questions = []
section = "general"
cur = None
for pno, page in enumerate(pages, start=1):
    for line in page.split("\n"):
        s = line.strip()
        m = re.match(r"Fragen für das Bundesland (.+)$", s)
        if m:
            section = m.group(1).strip()
            cur = None
            continue
        if re.match(r"Seite \d+ von \d+$", s) or s in ("Teil I", "Teil II", "Allgemeine Fragen"):
            continue
        m = re.match(r"Aufgabe (\d+)$", s)
        if m:
            cur = {"section": section, "num": int(m.group(1)), "page": pno, "q": [], "opts": []}
            questions.append(cur)
            continue
        if cur is None or not s:
            continue
        if s[:1] in (BOX, "\u25a1"):
            cur["opts"].append(s[1:].strip())
        elif cur["opts"] and line.startswith("    ") and not re.match(r"^\s*Bild \d", line):
            cur["opts"][-1] += " " + s  # wrapped option line
        elif not cur["opts"]:
            cur["q"].append(s)

result = []
for q in questions:
    if q["section"] not in ("general", state):
        continue
    # picture grid captions ("Bild 1   Bild 2 ...") and photo credits are not question text
    lines = [l for l in q["q"] if not re.fullmatch(r"(Bild \d\s*)+", l)]
    credit = " ".join(l for l in lines if l.startswith(("©", "In Anlehnung an")))
    text = " ".join(l for l in lines if not l.startswith(("©", "In Anlehnung an")))
    text = re.sub(r"^%d\.\s*" % q["num"], "", text)
    opts = [" ".join(o.split()) for o in q["opts"]]
    result.append({"section": q["section"], "num": q["num"], "page": q["page"],
                   "question": " ".join(text.split()), "credit": credit, "options": opts})

json.dump(result, open(out, "w"), ensure_ascii=False, indent=1)
print(len(result), "questions;",
      sum(1 for r in result if len(r["options"]) != 4), "with !=4 options")
