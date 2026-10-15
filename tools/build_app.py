"""Build the app's data files, version stamp and service worker.

Reads  data-src/questions.json and data-src/i18n-out/*.json
Writes public/lebenindeutschland/data/{questions,hints-en,hints-ru}.json,
       public/lebenindeutschland/js/version.js and public/lebenindeutschland/sw.js
"""
import glob
import hashlib
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "public", "lebenindeutschland")
SRC = os.path.join(ROOT, "data-src")


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


# One translation batch used British spelling; keep the English hints consistently American.
US_SPELLING = [("colour", "color"), ("Colour", "Color"), ("centre", "center"), ("Centre", "Center"),
               ("favour", "favor"), ("honour", "honor"), ("Honour", "Honor"), ("labour", "labor"), ("Labour", "Labor"),
               ("neighbour", "neighbor"), ("Neighbour", "Neighbor"), ("organis", "organiz"), ("Organis", "Organiz"),
               ("recognis", "recogniz"), ("licence", "license"), ("programme", "program")]


def americanize(text):
    for gb, us in US_SPELLING:
        text = text.replace(gb, us)
    return text


def build_data():
    q = json.load(open(os.path.join(SRC, "questions.json"), encoding="utf-8"))
    ids = [x["id"] for x in q["general"]]
    for code, st in q["states"].items():
        ids += [x["id"] for x in st["questions"]]
    write_json(os.path.join(APP, "data", "questions.json"), q)

    hints = {"en": {}, "ru": {}}
    for path in sorted(glob.glob(os.path.join(SRC, "i18n-out", "*.json"))):
        if ".part" in path:
            continue
        for qid, tr in json.load(open(path, encoding="utf-8")).items():
            for lang in hints:
                if lang in tr:
                    entry = tr[lang]
                    if lang == "en":
                        entry = {"q": americanize(entry["q"]), "o": [americanize(o) for o in entry["o"]]}
                    hints[lang][qid] = entry
    for lang, h in hints.items():
        missing = [i for i in ids if i not in h]
        print(f"hints-{lang}: {len(h)} entries, {len(missing)} questions without translation")
        write_json(os.path.join(APP, "data", f"hints-{lang}.json"), {i: h[i] for i in ids if i in h})


def app_files():
    out = []
    for dirpath, _, files in os.walk(APP):
        for name in files:
            rel = os.path.relpath(os.path.join(dirpath, name), APP).replace(os.sep, "/")
            if rel in ("sw.js", "js/version.js") or name.startswith("."):
                continue
            out.append(rel)
    return sorted(out)


def build_sw():
    files = app_files()
    h = hashlib.sha256()
    for rel in files:
        h.update(rel.encode())
        h.update(open(os.path.join(APP, rel), "rb").read())
    version = h.hexdigest()[:10]
    with open(os.path.join(APP, "js", "version.js"), "w") as f:
        f.write(f'export const VERSION = "{version}";\n')
    assets = ["./", "js/version.js"] + [f for f in files if f != "index.html"]
    tpl = open(os.path.join(ROOT, "tools", "sw.template.js"), encoding="utf-8").read()
    sw = tpl.replace("__VERSION__", version).replace("__ASSETS__", json.dumps(assets, indent=2))
    with open(os.path.join(APP, "sw.js"), "w", encoding="utf-8") as f:
        f.write(sw)
    print(f"version {version}, {len(assets)} precached files")


if __name__ == "__main__":
    if "--sw-only" not in sys.argv:
        build_data()
    build_sw()
