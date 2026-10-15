"""Find the picture questions in the catalogue PDF and render their pictures to WebP.

Usage: python3 tools/pictures.py [--dry-run]

A question has a picture when the gap between the end of its question text and its first answer
checkbox is larger than MIN_GAP points (plain questions have ~19 pt). This also catches vector
drawings that `pdfimages` cannot see. The region between those two lines is rendered; it includes
the "Bild 1..4" captions. The white margin is trimmed to BORDER px and the picture is scaled
down to fit MAX_SIZE. build_questions.py uses detect() to set each question's "img".

Photos that the PDF credits to third parties are not taken from the PDF: see ANNEX_PHOTOS.

Reads build/katalog.pdf, build/einbtestv.zip, build/catalogue.json and data/questions.json;
writes build/img/*.webp. Needs poppler-utils (pdftotext, pdftoppm) and ImageMagick.
"""

import argparse
import hashlib
import html
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from common import ANNEX, CATALOGUE, PDF, PICTURES, QUESTIONS, load_json

MIN_GAP = 40.0  # points
DPI = 150
BORDER = 12  # px of white kept around the trimmed picture
MAX_SIZE = 900  # px; larger pictures are scaled down to fit, smaller ones are kept as they are
QUALITY = 82
NS = "{http://www.w3.org/1999/xhtml}"
BOXES = (chr(0xF0A3), "□")  # checkbox glyphs pdftotext emits before each option

Line = tuple[str, float, float]  # text, yMin, yMax

# The PDF credits these photos to third parties ("© Bundesregierung/…", "© Deutscher Bundestag/…"),
# whose terms do not allow republishing them here. Anlage 1 of the Einbürgerungstestverordnung, an
# official work without copyright (§ 5 Abs. 1 UrhG), shows photos of the same scenes for the same
# questions, so those are used instead. Question id -> picture file in build/einbtestv.zip.
ANNEX_PHOTOS = {
    "g55": "bgbl1_2008_j01649_0020.jpg",  # Reichstag building
    "g70": "bgbl1_2008_j01649_0030.jpg",  # Heinemann appoints Schmidt, 1974
    "g181": "bgbl1_2008_j01649_0060.jpg",  # Brandt kneels in Warsaw, 1970
    "g216": "bgbl1_2013_j0585-1_0020.jpg",  # Bundestag plenary hall
    "g235": "bgbl1_2008_j01649_0090.jpg",  # Mitterrand and Kohl in Verdun, 1984
}


def sha256(path: Path) -> str:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def layout(pdf: Path) -> dict[int, tuple[float, list[Line]]]:
    """Page number -> (page width, text lines sorted top to bottom), from one pdftotext run."""
    xml = subprocess.run(
        ["pdftotext", "-bbox-layout", str(pdf), "-"], capture_output=True, text=True, check=True
    ).stdout
    pages = {}
    for pno, pg in enumerate(ET.fromstring(xml).iter(f"{NS}page"), start=1):
        lines = []
        for ln in pg.iter(f"{NS}line"):
            words = " ".join(w.text or "" for w in ln.iter(f"{NS}word"))
            lines.append((words, float(ln.get("yMin", 0)), float(ln.get("yMax", 0))))
        lines.sort(key=lambda line: line[1])
        pages[pno] = (float(pg.get("width", 0)), lines)
    return pages


def norm(s: str) -> str:
    return re.sub(r"\W+", "", s.lower())


def region(pages: dict[int, tuple[float, list[Line]]], q: dict) -> tuple[float, float, float | None]:
    """(page width, top, bottom) in points: end of the question text .. first option checkbox."""
    width, lines = pages[q["page"]]
    start = next(i for i, ln in enumerate(lines) if ln[0].strip() == f"Aufgabe {q['num']}")
    qtext = norm(q["question"])
    top = lines[start][2]
    i = start + 1
    while i < len(lines):
        t = lines[i][0].strip()
        # question text, or layout leftovers: a "184." number line, a lone "…" continuation
        if not ((norm(t) and norm(t) in qtext) or re.fullmatch(r"\d+\.|…|\.\.\.", t)):
            break
        top = max(top, lines[i][2])
        i += 1
    bottom = next((ln[1] for ln in lines[i:] if ln[0].strip().startswith(BOXES)), None)
    return width, top, bottom


def image_path(q: dict) -> str:
    """Path of a question's picture inside the app, e.g. img/g021.webp or img/BW-1.webp."""
    if q["section"] == "general":
        return f"img/g{q['num']:03d}.webp"
    return f"img/{q['section']}-{q['num']}.webp"


def detect(pdf: Path, catalogue: list[dict]) -> dict[str, tuple[int, float, float, float]]:
    """Question id -> (page, width, top, bottom) for every picture question."""
    pages = layout(pdf)
    found = {}
    for q in catalogue:
        width, top, bottom = region(pages, q)
        if bottom is None:
            sys.exit(f"{q['id']}: no option checkbox on page {q['page']}")
        if bottom - top > MIN_GAP:
            found[q["id"]] = (q["page"], width, top, bottom)
    return found


def annex_question(xml: str, name: str) -> int | None:
    """Number of the general question whose text comes right before picture `name` in the XML."""
    i = xml.find(f'SRC="{name}"')
    if i < 0:
        return None
    text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", xml[max(0, i - 2000) : i])).split())
    nums = re.findall(r"(?:^|\s)(\d{1,3})\. (?=[A-ZÄÖÜ])", text)
    return int(nums[-1]) if nums else None


def check_annex(annex: zipfile.ZipFile) -> None:
    """Make sure every ANNEX_PHOTOS picture exists and still belongs to its question."""
    xml = next(annex.read(n).decode("utf-8") for n in annex.namelist() if n.endswith(".xml"))
    names = set(annex.namelist())
    for qid, name in ANNEX_PHOTOS.items():
        num = annex_question(xml, name)
        if name not in names or num != int(qid[1:]):
            sys.exit(
                f"{qid}: {name} is not the picture of question {qid[1:]} in Anlage 1 (found {num}); fix ANNEX_PHOTOS"
            )


def imagemagick() -> str:
    for name in ("magick", "convert"):
        if shutil.which(name):
            return name
    sys.exit("ImageMagick (magick or convert) is required to write WebP pictures")


def render(pdf: Path, page: int, width: float, top: float, bottom: float, out: Path, magick: str) -> None:
    s = DPI / 72
    x0, y0 = int(40 * s), int((top + 4) * s)
    w, h = int((width - 80) * s), int((bottom - top - 8) * s)
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "crop"
        subprocess.run(
            ["pdftoppm", "-png", "-singlefile", "-r", str(DPI), "-f", str(page), "-l", str(page)]
            + ["-x", str(x0), "-y", str(y0), "-W", str(w), "-H", str(h), str(pdf), str(png)],
            check=True,
        )
        subprocess.run(
            [magick, f"{png}.png", "-trim", "+repage", "-bordercolor", "white", "-border", str(BORDER)]
            + ["-resize", f"{MAX_SIZE}x{MAX_SIZE}>", "-quality", str(QUALITY), str(out)],
            check=True,
        )


def render_annex(annex: zipfile.ZipFile, name: str, out: Path, magick: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "annex.jpg"
        src.write_bytes(annex.read(name))
        subprocess.run(
            [magick, str(src), "-resize", f"{MAX_SIZE}x{MAX_SIZE}>", "-quality", str(QUALITY), str(out)], check=True
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="only list the detected picture questions")
    args = ap.parse_args()

    doc = load_json(QUESTIONS)
    want = doc["source"].get("pdf_sha256")
    if want and sha256(PDF) != want:
        sys.exit(
            f"{PDF} is not the catalogue edition data/questions.json was built from.\n"
            "BAMF probably published a new edition: run `make refresh` to rebuild the questions."
        )
    catalogue = {q["id"]: q for q in load_json(CATALOGUE)}
    found = detect(PDF, list(catalogue.values()))
    used = {q["id"]: q["img"] for q in doc["general"] if q["img"]}
    used |= {q["id"]: q["img"] for st in doc["states"].values() for q in st["questions"] if q["img"]}
    if set(found) != set(used):
        sys.exit(f"picture questions in the PDF {sorted(found)} differ from data/questions.json {sorted(used)}")

    credited = sorted(qid for qid in found if catalogue[qid]["credit"].startswith("©") and qid not in ANNEX_PHOTOS)
    if credited:
        sys.exit(
            f"{credited}: the PDF credits these pictures to third parties. Use the picture from Anlage 1 "
            "(ANNEX_PHOTOS) or drop it; see AGENTS.md, Licensing."
        )

    with zipfile.ZipFile(ANNEX) as annex:
        check_annex(annex)
        for qid, (page, width, top, bottom) in found.items():
            source = f"Anlage 1 {ANNEX_PHOTOS[qid]}" if qid in ANNEX_PHOTOS else f"PDF page {page}"
            print(f"{qid}: {source}, gap {bottom - top:.0f} pt")
        if args.dry_run:
            return
        if PICTURES.exists():
            shutil.rmtree(PICTURES)
        PICTURES.mkdir(parents=True)
        magick = imagemagick()
        for qid, (page, width, top, bottom) in found.items():
            out = PICTURES / Path(used[qid]).name
            if qid in ANNEX_PHOTOS:
                render_annex(annex, ANNEX_PHOTOS[qid], out, magick)
            else:
                render(PDF, page, width, top, bottom, out, magick)
    print(f"rendered {len(found)} pictures to {PICTURES}")


if __name__ == "__main__":
    main()
