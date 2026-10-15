"""Find picture questions in the BAMF catalogue PDF and render each picture region to a PNG.

Usage:
  python3 -I tools/crop.py <katalog.pdf> <questions.json> <outdir> [--code CODE]
                           [--section general|state|all] [--min-gap PT] [--dry-run]

<questions.json> is a parse_pdf.py output (parsed_<CODE>.json) or a merge.py output; each record
needs section/num/page/question. A question is a picture question when the vertical gap between
the end of its question text and its first answer checkbox is larger than --min-gap points
(plain questions have ~19 pt). This also catches vector drawings that `pdfimages` cannot see.
The region between those two lines is rendered (it includes "Bild 1..4" captions and credits).

Output names: general questions -> g<NNN>.png, state questions -> <CODE>-<k>.png.
State sections restart "Aufgabe" numbering at 1, so lines are always looked up on the
question's own page (record "page").
"""
import argparse
import json
import re
import subprocess
import xml.etree.ElementTree as ET

DPI = 150
NS = "{http://www.w3.org/1999/xhtml}"
BOXES = ("", "□")  # checkbox glyphs pdftotext emits before each option


def lines_on(pdf_path, page, _cache={}):
    if page in _cache:
        return _cache[page]
    xml = subprocess.run(["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), pdf_path, "-"],
                         capture_output=True, text=True, check=True).stdout
    pg = ET.fromstring(xml).find(f".//{NS}page")
    out = []
    for ln in pg.iter(f"{NS}line"):
        words = [w.text or "" for w in ln.iter(f"{NS}word")]
        out.append({"text": " ".join(words), "ymin": float(ln.get("yMin")), "ymax": float(ln.get("yMax"))})
    out.sort(key=lambda l: l["ymin"])
    _cache[page] = (float(pg.get("width")), out)
    return _cache[page]


def norm(s):
    return re.sub(r"\W+", "", s.lower())


def region(pdf_path, q):
    """Return (width, top, bottom) in PDF points: end of question text .. first option checkbox."""
    width, lines = lines_on(pdf_path, q["page"])
    start = next(i for i, l in enumerate(lines) if l["text"].strip() == f"Aufgabe {q['num']}")
    qtext = norm(q["question"])
    top = lines[start]["ymax"]
    i = start + 1
    while i < len(lines):
        t = lines[i]["text"].strip()
        # question text, or layout leftovers: a "184." number line, a lone "…" continuation
        if not ((norm(t) and norm(t) in qtext) or re.fullmatch(r"\d+\.|…|\.\.\.", t)):
            break
        top = max(top, lines[i]["ymax"])
        i += 1
    bottom = next((l["ymin"] for l in lines[i:] if l["text"].strip().startswith(BOXES)), None)
    return width, top, bottom


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("questions")
    ap.add_argument("outdir")
    ap.add_argument("--code", help="state code used in output names, e.g. BW")
    ap.add_argument("--section", choices=["general", "state", "all"], default="all")
    ap.add_argument("--min-gap", type=float, default=40.0)
    ap.add_argument("--dry-run", action="store_true", help="only report detected picture questions")
    args = ap.parse_args()

    found = []
    for q in json.load(open(args.questions, encoding="utf-8")):
        general = q["section"] == "general"
        if (args.section == "general" and not general) or (args.section == "state" and general):
            continue
        width, top, bottom = region(args.pdf, q)
        if bottom is None:
            print(f"WARN {q['section']} {q['num']} p{q['page']}: no option checkbox on the page")
            continue
        if bottom - top <= args.min_gap:
            continue
        name = f"g{q['num']:03d}" if general else f"{args.code}-{q['num']}"
        found.append(name)
        print(f"{name}: page {q['page']} gap {bottom - top:.0f}pt (top={top:.0f} bottom={bottom:.0f})")
        if args.dry_run:
            continue
        s = DPI / 72
        x0, y0 = int(40 * s), int((top + 4) * s)
        w, h = int((width - 80) * s), int((bottom - top - 8) * s)
        subprocess.run(["pdftoppm", "-png", "-singlefile", "-r", str(DPI), "-f", str(q["page"]),
                        "-l", str(q["page"]), "-x", str(x0), "-y", str(y0), "-W", str(w), "-H", str(h),
                        args.pdf, f"{args.outdir}/{name}"], check=True)
    print("picture questions:", " ".join(found) or "none")


if __name__ == "__main__":
    main()
