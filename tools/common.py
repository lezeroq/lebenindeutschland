"""Paths, the list of federal states and JSON helpers shared by the build tools."""

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"  # app source: HTML, CSS, ES modules, icons
QUESTIONS = ROOT / "data" / "questions.json"  # committed snapshot of the catalogue and answer key
TRANSLATIONS = ROOT / "translations"  # <lang>.json hints, keyed by question id
BUILD = ROOT / "build"  # downloads and intermediate files, safe to delete
PDF = BUILD / "katalog.pdf"
PDF_TEXT = BUILD / "katalog.txt"
CATALOGUE = BUILD / "catalogue.json"
ANNEX = BUILD / "einbtestv.zip"  # the Einbürgerungstestverordnung with Anlage 1 and its pictures
ANSWERS = BUILD / "answers"
PICTURES = BUILD / "img"
DIST = ROOT / "dist" / "lebenindeutschland"  # what gets published at /lebenindeutschland/

# Order matches the catalogue and the app's state picker.
STATES = [
    ("BW", "Baden-Württemberg"),
    ("BY", "Bayern"),
    ("BE", "Berlin"),
    ("BB", "Brandenburg"),
    ("HB", "Bremen"),
    ("HH", "Hamburg"),
    ("HE", "Hessen"),
    ("MV", "Mecklenburg-Vorpommern"),
    ("NI", "Niedersachsen"),
    ("NW", "Nordrhein-Westfalen"),
    ("RP", "Rheinland-Pfalz"),
    ("SL", "Saarland"),
    ("SN", "Sachsen"),
    ("ST", "Sachsen-Anhalt"),
    ("SH", "Schleswig-Holstein"),
    ("TH", "Thüringen"),
]
CODES = [code for code, _ in STATES]
GENERAL_COUNT = 300
STATE_COUNT = 10


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: Any, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write("\n")


def question_ids(doc: dict[str, Any]) -> list[str]:
    """All question ids of a questions.json document in catalogue order."""
    ids = [q["id"] for q in doc["general"]]
    for st in doc["states"].values():
        ids += [q["id"] for q in st["questions"]]
    return ids
