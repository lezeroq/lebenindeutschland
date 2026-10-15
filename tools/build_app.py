"""Build the publishable app into dist/lebenindeutschland/.

Usage: python3 tools/build_app.py

Copies app/ (except the service worker template), then writes
  data/questions.json        minified copy of data/questions.json
  data/hints-<lang>.json     one per translations/<lang>.json, in catalogue order
  img/*.webp                 the pictures from build/img/
  js/version.js, sw.js       version hash over all files, service worker precaching all of them
"""

import hashlib
import json
import shutil
import sys

from common import APP, DIST, PICTURES, QUESTIONS, TRANSLATIONS, load_json, question_ids, write_json

SW_TEMPLATE = "sw.template.js"


def copy_app() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(APP, DIST, ignore=shutil.ignore_patterns(SW_TEMPLATE, ".*"))


def build_data() -> None:
    doc = load_json(QUESTIONS)
    ids = question_ids(doc)
    write_json(DIST / "data" / "questions.json", doc, compact=True)
    for path in sorted(TRANSLATIONS.glob("*.json")):
        hints = load_json(path)
        missing = [i for i in ids if i not in hints]
        print(f"hints-{path.stem}: {len(hints)} entries, {len(missing)} questions without translation")
        write_json(DIST / "data" / f"hints-{path.stem}.json", {i: hints[i] for i in ids if i in hints}, compact=True)

    wanted = {q["img"] for q in doc["general"] if q["img"]}
    wanted |= {q["img"] for st in doc["states"].values() for q in st["questions"] if q["img"]}
    (DIST / "img").mkdir()
    for rel in sorted(wanted):
        src = PICTURES / rel.removeprefix("img/")
        if not src.exists():
            sys.exit(f"missing picture {src}: run `make pictures`")
        shutil.copy2(src, DIST / rel)


def app_files() -> list[str]:
    files = [p.relative_to(DIST).as_posix() for p in DIST.rglob("*") if p.is_file()]
    return sorted(f for f in files if f not in ("sw.js", "js/version.js"))


def build_sw() -> None:
    files = app_files()
    h = hashlib.sha256()
    for rel in files:
        h.update(rel.encode())
        h.update((DIST / rel).read_bytes())
    version = h.hexdigest()[:10]
    (DIST / "js" / "version.js").write_text(f'export const VERSION = "{version}";\n', encoding="utf-8")
    assets = ["./", "js/version.js"] + [f for f in files if f != "index.html"]
    tpl = (APP / SW_TEMPLATE).read_text(encoding="utf-8")
    sw = tpl.replace("__VERSION__", version).replace("__ASSETS__", json.dumps(assets, indent=2))
    (DIST / "sw.js").write_text(sw, encoding="utf-8")
    print(f"version {version}, {len(assets)} precached files")


def main() -> None:
    copy_app()
    build_data()
    build_sw()
    print(f"built {DIST}")


if __name__ == "__main__":
    main()
