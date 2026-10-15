# Leben in Deutschland trainer: notes for agents

An offline-capable study app (PWA) for the German citizenship test "Leben in Deutschland" /
"Einbürgerungstest". It has all 460 official questions: 300 general ones and 10 for each of the 16
federal states, with the official answer key and pictures. English and Russian translations can be
shown as hints under the German text. There are three modes: learning with spaced repetition, tests
(a mock exam and a quick test) with history, and browsing. Progress lives in the browser's
`localStorage` and can be exported and imported as JSON in Settings.

The app is plain HTML, CSS and ES modules: no framework, no bundler, no runtime dependencies.
It is published as a static folder at `/lebenindeutschland/` on the owner's website. This repo only
produces that folder: `make` writes `dist/lebenindeutschland/`, which is copied as-is into the
website so that it is served at `/lebenindeutschland/`. The manifest and service worker scope
assume that path. There is deliberately no publishing or upload code and no hosting configuration
here; do not add any.

## Layout

| Path                  | What it is                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `app/`                | App source: `index.html`, `app.css`, `manifest.webmanifest`, `icons/`, `sw.template.js`   |
| `app/js/app.js`       | UI, routing, sessions, tests, browsing, settings                                          |
| `app/js/i18n.js`      | Interface languages (`LANGS`) and all interface strings (`STR`)                           |
| `app/js/srs.js`       | Learning levels and review intervals                                                      |
| `app/js/store.js`     | `localStorage` state, export and import                                                   |
| `data/questions.json` | Snapshot of the catalogue and answer key. Generated, but committed and reviewed like code |
| `translations/`       | `<lang>.json` hint translations, keyed by question id                                     |
| `tools/`              | Download, parse, merge, picture, validation and build scripts; e2e test                   |
| `assets/`             | Source art (square icon used for the maskable and Apple touch PNGs)                       |
| `build/`              | Ignored. Downloads and intermediate files; safe to delete                                 |
| `dist/`               | Ignored. The built app, `dist/lebenindeutschland/`                                        |

## Pipeline

```
bamf.de catalogue PDF ── fetch_catalogue.py ──▶ build/katalog.pdf, build/katalog.txt
                         parse_catalogue.py ──▶ build/catalogue.json      wording, option order, page
oet.bamf.de Testcenter ─ fetch_answers.py ────▶ build/answers/<CODE>.json which option is correct
                         build_questions.py ──▶ data/questions.json       committed snapshot
                         pictures.py ─────────▶ build/img/*.webp          cropped from the PDF
app/ + data/ + translations/ + build/img/ ─ build_app.py ─▶ dist/lebenindeutschland/
```

- The PDF is authoritative for wording and option order. The Testcenter only tells which answer is
  correct; its option order and spelling can differ, so `build_questions.py` pairs options by fuzzy
  similarity and prints a `WARN weak match` for unclear pairings.
- Picture questions are found automatically: a gap of more than 40 pt between the question text and
  the first checkbox. `pictures.py` crops that region, trims the margin and writes WebP.
- `data/questions.json` records the PDF's SHA-256. If BAMF has replaced the PDF, `make` stops with
  "not the catalogue edition ...": the questions must be rebuilt (see below).
- `build_app.py` hashes every output file into a version (`js/version.js`, `sw.js`). Installed apps
  only update when that hash changes; then they show an "Update" banner.

## Commands

Requirements: Python 3.11+ (standard library only), poppler-utils (`pdftotext`, `pdfinfo`,
`pdftoppm`), ImageMagick (`magick` or `convert`), Node 22+ with npm, `uv` (for black and isort) and
Google Chrome (only for `make e2e`; set `CHROME=/path/to/chrome` if it is not
`/usr/bin/google-chrome`).

```sh
make setup       # once: npm ci + uv sync (linters, formatters, e2e driver)
make             # build dist/lebenindeutschland/ (downloads the catalogue PDF on first run)
make serve       # http://127.0.0.1:8787/lebenindeutschland/
make e2e         # click through every mode in headless Chrome; screenshots in build/e2e/
make format      # isort + black, eslint --fix, prettier --write
make check       # lint (black, isort, pyright, eslint, prettier) + validate the data
make questions   # rebuild data/questions.json from BAMF, reusing downloads in build/
make refresh     # delete build/, download everything again, rebuild questions and app
make help        # list all targets
```

Run Python tools from the repo root as `python3 tools/<name>.py`; each has a docstring with usage.
Paths and the list of states are in `tools/common.py`.

## Data format

`data/questions.json`:

```jsonc
{
  "source": { "catalogue": "BAMF Gesamtfragenkatalog", "edition": "07.05.2025", "answers": "…", "retrieved": "2026-10-15", "pdf_sha256": "…" },
  "general": [{ "id": "g1", "n": 1, "q": "…", "o": ["…", "…", "…", "…"], "a": 3, "img": null, "credit": "" }],
  "states": { "BW": { "name": "Baden-Württemberg", "questions": [{ "id": "BW1", "k": 1, "q": "…", "o": […], "a": 0, "img": "img/BW-1.webp", "credit": "" }] } }
}
```

- Ids are stable and used everywhere (progress in `localStorage`, translations): `g1`…`g300`,
  `BW1`…`TH10`. Never renumber them.
- `a` is the 0-based index of the correct option in `o`, in PDF order.
- `source.edition` is shown in Settings > About (`about.body` has an `{edition}` placeholder).
- Only change this file through `tools/build_questions.py`, never by hand.

`translations/<lang>.json` maps each question id to `{ "q": "…", "o": ["…", "…", "…", "…"] }`. The
options must be in the same order as the German `o`. Picture options such as "Bild 1" are translated
too ("Picture 1"). The build turns each file into `data/hints-<lang>.json`.

## Updating the questions

BAMF publishes a new catalogue edition from time to time. You can tell because `make` stops with
"not the catalogue edition" or because the
[catalogue page](https://www.bamf.de/SharedDocs/Anlagen/DE/Integration/Einbuergerung/gesamtfragenkatalog-lebenindeutschland.html)
shows a new "Stand".

1. Run `make refresh`. It downloads the PDF and makes about 500 Testcenter requests, one at a time
   with a pause (5–10 minutes). Do not parallelize the requests or shorten the pause. If it is
   interrupted, `make questions` resumes from the files already in `build/answers/`.
2. Read the output:
   - every `WARN weak match` line: check that answer by hand against `build/katalog.txt` and
     `build/answers/<CODE>.json`;
   - the list of changed questions (`g17: question, options`, `BY3: answer`, `g42: picture`).
3. Review `git diff data/questions.json`.
4. For every changed question, update its entry in every `translations/*.json`: question text and
   options, in the new German option order. If only the answer changed, translations need no change.
5. If pictures changed, look at the new files in `build/img/`.
6. Run `make format check e2e`, then commit `data/questions.json` and the translations together.

If a step fails because BAMF changed the PDF layout or the Testcenter pages, fix
`tools/parse_catalogue.py` or `tools/oet.py`. Their checks say what broke: the catalogue must yield
the ids g1..g300 and BW1..TH10 with 4 options each, and every Testcenter row needs 4 answers with
exactly 1 correct. If the number of questions or states ever changes, also update `tools/common.py`,
the app (exam composition in `app/js/app.js`, `STATES`) and the counts in `tools/e2e.mjs`.

## Adding a language

Example: Ukrainian, code `uk`.

1. In `app/js/i18n.js`, add `uk: { name: "Українська", locale: "uk-UA" }` to `LANGS` (in picker
   order). Add a `uk: { … }` block to `STR` with every key of `de`: copy the `en` block and translate
   it, keeping `{placeholders}` as they are.
2. Update the strings that name the hint languages, in every language: `set.hints.de` in `STR`, plus
   the meta description in `app/index.html` and the feature list in `README.md`.
3. Create `translations/uk.json` with all 460 ids. Translate from the German in
   `data/questions.json`, which is authoritative; the English file is a useful reference. Keep the
   option order. Work in batches (for example g1–g100, g101–g200, g201–g300, the states) and run
   `python3 tools/validate.py` after each one.
4. Run `python3 tools/validate.py --strict` (fails on missing translations), then
   `make format check e2e`. `tools/check_i18n.mjs`, part of `make check`, verifies that `uk` has
   every interface string with the same placeholders and a translations file.

Hints and the service worker pick up the new file automatically. Right-to-left languages would also
need `dir="rtl"` handling in `applyLangClasses()` and CSS work; that is not supported yet.

## Changing the app

- Interface text lives only in `app/js/i18n.js`, for every language in `LANGS`.
- Never edit `dist/`; change `app/` and rebuild.
- Users' progress is in `localStorage` under the keys in `app/js/store.js`. A change to its shape
  needs a migration for existing data and must keep export and import working.
- For visual changes, run `make e2e` and look at the screenshots in `build/e2e/` (light, dark,
  German, English, Russian). The app is used mostly on phones.

## Conventions

- Run `make format` and then `make check` before every commit; both must pass.
- Python: black and isort with a line length of 120, pyright in standard mode, type hints on new
  functions, standard library only.
- JS, CSS, HTML, JSON and Markdown: Prettier with a print width of 120; ESLint recommended rules.
- Never commit `build/`, `dist/` or the catalogue PDF. `data/questions.json` is the only generated
  file in git.
- Be polite to BAMF servers: one request at a time, with pauses and caching in `build/`.
