"""Minimal client for the BAMF Online-Testcenter (Oracle APEX app 514) at oet.bamf.de."""

import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import TypeVar

BASE = "https://oet.bamf.de/ords/oetut/"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) lebenindeutschland-trainer"
PAUSE = 0.4  # seconds between requests; one request at a time
T = TypeVar("T")


def field(page: str, pattern: str) -> str:
    m = re.search(pattern, page)
    return html.unescape(m.group(1)) if m else ""


def polite(fn: Callable[[], T], tries: int = 5) -> T:
    """Call fn after a short pause; on failure back off (2, 4, 8, 16 s) and retry."""
    delay = 2
    for attempt in range(1, tries + 1):
        time.sleep(PAUSE)
        try:
            return fn()
        except Exception as e:  # network errors, timeouts, unexpected pages
            if attempt == tries:
                raise
            print(f"  attempt {attempt} failed ({e!r}); retrying in {delay}s", file=sys.stderr)
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


class Session:
    """One APEX session with its own cookies."""

    def __init__(self) -> None:
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        self.opener.addheaders = [("User-Agent", USER_AGENT)]

    def get(self, url: str) -> str:
        with self.opener.open(urllib.parse.urljoin(BASE, url), timeout=30) as r:
            return r.read().decode("utf-8", "replace")

    def submit(self, page: str, request: str, items: dict[str, str]) -> str:
        """Emulate apex.submit(): POST page items as p_json and return the page it leads to."""
        inst = field(page, r'name="p_instance" value="([0-9]+)"')
        step = field(page, r'name="p_flow_step_id" value="([0-9]+)"')
        payload = {
            "pageItems": {
                "itemsToSubmit": [{"n": k, "v": v} for k, v in items.items()],
                "protected": field(page, r'id="pPageItemsProtected" value="([^"]*)"'),
                "rowVersion": field(page, r'id="pPageItemsRowVersion" value="([^"]*)"'),
                "formRegionChecksums": [],
            },
            "salt": field(page, r'value="([0-9]+)" id="pSalt"'),
        }
        data = urllib.parse.urlencode(
            {
                "p_flow_id": "514",
                "p_flow_step_id": step,
                "p_instance": inst,
                "p_debug": "",
                "p_request": request,
                "p_reload_on_submit": "A",
                "p_page_submission_id": field(page, r'id="pPageSubmissionId" value="([0-9]+)"'),
                "p_json": json.dumps(payload),
            }
        ).encode()
        url = BASE + f"wwv_flow.accept?p_context=514:{step}:{inst}"
        with self.opener.open(urllib.request.Request(url, data=data), timeout=30) as r:
            return r.read().decode("utf-8", "replace")


def text(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def parse_question(page: str) -> dict:
    """Row number, the 4 answers with their correct flag and the explanation note of a catalogue page."""
    m = re.search(r"Aufgabe (\d+) von 310", page)
    if not m:
        raise RuntimeError("not a catalogue page")
    rows = re.findall(
        r'<span id="\d" style="[^"]*">(richtige|falsche) Antwort =&?g?t?;?></span>.*?'
        r'<input type="radio" name="f20".*?/>\s*</td>\s*<td[^>]*>(.*?)</td>',
        page,
        re.S,
    )
    expl = re.search(r"Erläuterung.*?<td[^>]*>(.*?)</td>", page, re.S)
    return {
        "num": int(m.group(1)),
        "answers": [{"text": text(ans), "correct": flag == "richtige"} for flag, ans in rows],
        "note": text(expl.group(1)) if expl else "",
    }


def state_ids(page: str) -> dict[str, str]:
    """State name -> P1_BUL_ID from the start page's state picker."""
    m = re.search(r"<select[^>]*P1_BUL_ID.*?</select>", page, re.S)
    if not m:
        raise RuntimeError("no state picker on the start page")
    return {
        html.unescape(name).strip(): value
        for value, name in re.findall(r'<option value="(\d+)"[^>]*>([^<]+)', m.group(0))
    }


class Catalogue:
    """The question catalogue (page 30) of one state, opened in a fresh session."""

    def __init__(self, state_name: str) -> None:
        self.session = Session()
        start = polite(lambda: self.session.get("f?p=514:1:0"))
        ids = state_ids(start)
        if state_name not in ids:
            raise RuntimeError(f"state {state_name!r} not in the Testcenter picker: {sorted(ids)}")
        self.page = polite(lambda: self.session.submit(start, "SUBMIT", {"P1_BUL_ID": ids[state_name]}))
        self.rows = {int(n): qid for qid, n in re.findall(r'<option value="(\d+)"[^>]*>(\d+)', self.page)}
        if len(self.rows) != 310:
            raise RuntimeError(f"{state_name}: catalogue has {len(self.rows)} rows, expected 310")

    def question(self, n: int) -> dict:
        """Open row n (1..310) and return its parsed answers plus the Testcenter row id."""

        def go() -> dict:
            if parse_question(self.page)["num"] != n:
                page = self.session.submit(self.page, "P30_ROWNUM", {"P30_ROWNUM": self.rows[n]})
                rec = parse_question(page)
                if rec["num"] != n:
                    raise RuntimeError(f"asked for row {n}, got {rec['num']}")
                self.page = page
            return parse_question(self.page)

        rec = polite(go)
        rec["id"] = self.rows[n]
        return rec
