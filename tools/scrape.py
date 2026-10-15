"""Walk all 310 questions for one Bundesland and record which answer BAMF marks correct."""
import html
import json
import re
import sys
import time

from oet import get, submit

STATE_ID = sys.argv[1]  # 3 = Bayern
OUT = sys.argv[2]


def text(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def parse(page):
    num = int(re.search(r"Aufgabe (\d+) von 310", page).group(1))
    answers = []
    rows = re.findall(
        r'<span id="\d" style="[^"]*">(richtige|falsche) Antwort =&?g?t?;?></span>.*?'
        r'<input type="radio" name="f20".*?/>\s*</td>\s*<td[^>]*>(.*?)</td>',
        page, re.S)
    for flag, ans in rows:
        answers.append({"text": text(ans), "correct": flag == "richtige"})
    expl = re.search(r"Erläuterung.*?<td[^>]*>(.*?)</td>", page, re.S)
    return {"num": num, "answers": answers, "note": text(expl.group(1)) if expl else ""}


_, p1 = get("f?p=514:1:0")
_, page = submit(p1, "SUBMIT", {"P1_BUL_ID": STATE_ID})
ids = re.findall(r'<option value="(\d+)"[^>]*>(\d+)\s*</option>', page)
if not ids:
    ids = re.findall(r'<option value="(\d+)"[^>]*>(\d+)', page)
print(len(ids), "question ids")

results = []
for qid, n in ids:
    if n != "1":
        _, page = submit(page, "P30_ROWNUM", {"P30_ROWNUM": qid})
    rec = parse(page)
    rec["id"] = qid
    if rec["num"] != int(n) or len(rec["answers"]) != 4 or sum(a["correct"] for a in rec["answers"]) != 1:
        print("PROBLEM", n, rec, file=sys.stderr)
    results.append(rec)
    if int(n) % 25 == 0:
        print("done", n, flush=True)
    time.sleep(0.4)

json.dump(results, open(OUT, "w"), ensure_ascii=False, indent=1)
print("saved", len(results))
