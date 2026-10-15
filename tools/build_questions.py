"""Assemble data-src/questions.json for the app from the verified merges.

Usage: python3 -I tools/build_questions.py

Inputs:
  data-src/merged/bayern_merged.json  rows 1-300 = general questions, 301-310 = Bayern 1-10
  data-src/merged/<CODE>.json         merge_states.py output for every other state
  public/lebenindeutschland/img/      g<NNN>.webp and <CODE>-<k>.webp pictures
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SRC = os.path.join(ROOT, "data-src")
APP = os.path.join(ROOT, "public", "lebenindeutschland")
OUT = os.path.join(SRC, "questions.json")

STATES = [
    ("BW", "Baden-Württemberg"), ("BY", "Bayern"), ("BE", "Berlin"), ("BB", "Brandenburg"),
    ("HB", "Bremen"), ("HH", "Hamburg"), ("HE", "Hessen"), ("MV", "Mecklenburg-Vorpommern"),
    ("NI", "Niedersachsen"), ("NW", "Nordrhein-Westfalen"), ("RP", "Rheinland-Pfalz"),
    ("SL", "Saarland"), ("SN", "Sachsen"), ("ST", "Sachsen-Anhalt"), ("SH", "Schleswig-Holstein"),
    ("TH", "Thüringen"),
]
# picture questions, found with tools/crop.py --dry-run (gap between question text and options)
GENERAL_PICTURES = {21, 55, 70, 130, 176, 181, 187, 209, 216, 226, 235}
STATE_PICTURES = {1, 8}  # coat of arms, map


def load(path):
    return json.load(open(path, encoding="utf-8"))


def img(rel):
    assert os.path.isfile(os.path.join(APP, rel)), f"missing picture {rel}"
    return rel


def main():
    bm = load(os.path.join(SRC, "merged", "bayern_merged.json"))
    assert [r["n"] for r in bm] == list(range(1, 311))

    general = []
    for r in bm[:300]:
        assert r["section"] == "general" and r["num"] == r["n"]
        general.append({
            "id": f"g{r['n']}", "n": r["n"], "q": r["question"], "o": r["options"], "a": r["correct"],
            "img": img(f"img/g{r['n']:03d}.webp") if r["n"] in GENERAL_PICTURES else None,
            "credit": r["credit"],
        })

    states = {}
    for code, name in STATES:
        if code == "BY":
            rows = bm[300:]
            # same answers as the fresh state-only merge
            fresh = load(os.path.join(SRC, "merged", "BY.json"))
            assert [(r["options"], r["correct"]) for r in rows] == [(r["options"], r["correct"]) for r in fresh]
        else:
            rows = load(os.path.join(SRC, "merged", f"{code}.json"))
        assert [r["num"] for r in rows] == list(range(1, 11)) and all(r["section"] == name for r in rows), code
        states[code] = {"name": name, "questions": [{
            "id": f"{code}{r['num']}", "k": r["num"], "q": r["question"], "o": r["options"], "a": r["correct"],
            "img": img(f"img/{code}-{r['num']}.webp") if r["num"] in STATE_PICTURES else None,
            "credit": r["credit"],
        } for r in rows]}

    doc = {
        "source": {"catalogue": "BAMF Gesamtfragenkatalog, Stand 07.05.2025",
                   "answers": "BAMF Online-Testcenter oet.bamf.de", "retrieved": "2026-10-15"},
        "general": general,
        "states": states,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {OUT}: {len(general)} general, {len(states)} states x "
          f"{sorted({len(s['questions']) for s in states.values()})} questions")


if __name__ == "__main__":
    main()
