"""Minimal client for the BAMF Online-Testcenter (Oracle APEX app 514)."""
import html
import http.cookiejar
import json
import re
import sys
import urllib.parse
import urllib.request

BASE = "https://oet.bamf.de/ords/oetut/"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) study-list")]


def get(url):
    with opener.open(urllib.parse.urljoin(BASE, url), timeout=30) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


def field(page, pattern):
    m = re.search(pattern, page)
    return html.unescape(m.group(1)) if m else ""


def submit(page, request, items):
    """Emulate apex.submit(): POST page items as p_json, return the followed page."""
    inst = field(page, r'name="p_instance" value="([0-9]+)"')
    step = field(page, r'name="p_flow_step_id" value="([0-9]+)"')
    sub = field(page, r'id="pPageSubmissionId" value="([0-9]+)"')
    salt = field(page, r'value="([0-9]+)" id="pSalt"')
    prot = field(page, r'id="pPageItemsProtected" value="([^"]*)"')
    rowv = field(page, r'id="pPageItemsRowVersion" value="([^"]*)"')
    payload = {
        "pageItems": {
            "itemsToSubmit": [{"n": k, "v": v} for k, v in items.items()],
            "protected": prot,
            "rowVersion": rowv,
            "formRegionChecksums": [],
        },
        "salt": salt,
    }
    data = urllib.parse.urlencode({
        "p_flow_id": "514",
        "p_flow_step_id": step,
        "p_instance": inst,
        "p_debug": "",
        "p_request": request,
        "p_reload_on_submit": "A",
        "p_page_submission_id": sub,
        "p_json": json.dumps(payload),
    }).encode()
    url = BASE + f"wwv_flow.accept?p_context=514:{step}:{inst}"
    with opener.open(urllib.request.Request(url, data=data), timeout=30) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")


if __name__ == "__main__":
    out = sys.argv[1]
    _, p1 = get("f?p=514:1:0")
    url, p2 = submit(p1, "SUBMIT", {"P1_BUL_ID": "3"})
    print(url)
    open(out, "w").write(p2)
