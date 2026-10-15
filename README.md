# Leben in Deutschland – Trainer

Offline-capable study app (PWA) for the German citizenship test, served at
<https://artsiomkaval.com/lebenindeutschland/>.

- All 460 official questions: 300 general and 10 for each of the 16 federal states, with the
  BAMF answer key and pictures.
- English and Russian translations as optional hints under the German text.
- Three modes: learning with spaced repetition, tests (mock exam and quick test) with history, and
  browsing.

## Layout

| Path | What it is |
|---|---|
| `public/lebenindeutschland/` | The app: plain HTML, CSS and ES modules, no build step for the code |
| `data-src/questions.json` | Question data, built from the BAMF catalogue PDF and the BAMF Online-Testcenter answers |
| `data-src/i18n-out/*.json` | English and Russian translations, keyed by question id (`g1`…`g300`, `BY1`…`TH10`) |
| `tools/` | Scrapers, PDF parser, picture cropper, data validator, app build, end-to-end test |

## Common tasks

```sh
python3 -I tools/build_app.py        # rebuild data/, js/version.js and sw.js after any change
python3 -m http.server -d public 8787  # local preview at http://localhost:8787/lebenindeutschland/
node tools/e2e.mjs <url> <shot-dir>  # click through every mode in headless Chrome
```

Always run `build_app.py` before publishing. The service worker caches every file under a version hash,
and installed apps only see an update when that hash changes; they then show an "Update" banner.

## How learning works

Every question goes through levels 0 (new), 1 (just missed), 2–4 (learning) and 5 (learned).
A correct answer moves it up one level and schedules the next review 1, 2 or 4 days later.
The fourth correct answer in a row marks it learned. A wrong answer resets it to level 1, and it
comes back in the same session. Mistakes in tests are sent back to learning too. Sessions have at
most 20 cards: due reviews first, then new questions up to the daily limit.

All progress is stored in `localStorage` on the device and can be exported and imported as JSON
in Settings.
