# Leben in Deutschland trainer. `make` builds dist/lebenindeutschland/; AGENTS.md explains the pipeline.

PYTHON ?= python3
UV ?= uv
PORT ?= 8787

.DEFAULT_GOAL := app
.PHONY: app questions refresh pictures validate setup lint format check serve e2e clean help

help:  ## list the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | expand -t 12

app: validate build/img/.stamp  ## build the publishable app into dist/lebenindeutschland/
	$(PYTHON) tools/build_app.py

questions: build/catalogue.json  ## rebuild data/questions.json from BAMF (reuses downloads in build/)
	$(PYTHON) tools/fetch_answers.py
	$(PYTHON) tools/build_questions.py
	$(PYTHON) tools/validate.py

refresh:  ## download everything again, then rebuild the questions and the app
	rm -rf build
	$(MAKE) questions
	$(MAKE) app

pictures: build/img/.stamp  ## render the question pictures into build/img/

validate:  ## check data/questions.json, translations/*.json and the interface languages
	$(PYTHON) tools/validate.py
	node tools/check_i18n.mjs

build/katalog.pdf build/katalog.txt build/einbtestv.zip &:
	$(PYTHON) tools/fetch_catalogue.py

build/catalogue.json: build/katalog.txt tools/parse_catalogue.py
	$(PYTHON) tools/parse_catalogue.py

build/img/.stamp: build/katalog.pdf build/einbtestv.zip build/catalogue.json data/questions.json tools/pictures.py
	$(PYTHON) tools/pictures.py
	touch $@

setup:  ## install the linters, formatters and the e2e test driver
	npm ci
	$(UV) sync

lint:  ## check formatting, lint and type-check (no changes)
	$(UV) run black --check --quiet tools
	$(UV) run isort --check-only --quiet tools
	npx pyright
	npx eslint .
	npx prettier --check --log-level warn .

format:  ## format and auto-fix everything
	$(UV) run isort --quiet tools
	$(UV) run black --quiet tools
	npx eslint --fix .
	npx prettier --write --log-level warn .

check: lint validate  ## lint and validate; run before every commit

serve: app  ## serve dist/ at http://127.0.0.1:8787/lebenindeutschland/ (PORT=... to change)
	$(PYTHON) -m http.server --bind 127.0.0.1 --directory dist $(PORT)

e2e: app  ## click through the built app in headless Chrome (set CHROME=/path/to/chrome)
	@$(PYTHON) -m http.server --bind 127.0.0.1 --directory dist $(PORT) >/dev/null 2>&1 & pid=$$!; \
	sleep 1; node tools/e2e.mjs http://127.0.0.1:$(PORT)/lebenindeutschland/ build/e2e; status=$$?; \
	kill $$pid; exit $$status

clean:  ## remove dist/ and build/ (the next build downloads the catalogue PDF again)
	rm -rf dist build
