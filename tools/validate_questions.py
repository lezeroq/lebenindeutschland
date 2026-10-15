"""Sanity-check data-src/questions.json.

Usage: python3 -I tools/validate_questions.py [questions.json]

Checks: 300 general questions with ids g1..g300; 16 states x 10 questions with ids <CODE>1..10;
every question has a non-empty q, exactly 4 non-empty options and a in 0..3; every img path
exists under public/lebenindeutschland/ (and every picture there is referenced).
Exits non-zero on any error.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
APP = os.path.join(ROOT, "public", "lebenindeutschland")
PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data-src", "questions.json")
CODES = "BW BY BE BB HB HH HE MV NI NW RP SL SN ST SH TH".split()

errors = []


def err(msg):
    errors.append(msg)


def check_question(q, want_id):
    qid = q.get("id")
    if qid != want_id:
        err(f"{want_id}: id is {qid!r}")
    if not isinstance(q.get("q"), str) or not q["q"].strip():
        err(f"{qid}: empty question text")
    o = q.get("o")
    if not isinstance(o, list) or len(o) != 4 or not all(isinstance(x, str) and x.strip() for x in o):
        err(f"{qid}: options must be 4 non-empty strings, got {o!r}")
    elif len(set(o)) != 4:
        err(f"{qid}: duplicate options {o!r}")
    if not isinstance(q.get("a"), int) or isinstance(q.get("a"), bool) or not 0 <= q["a"] <= 3:
        err(f"{qid}: a must be an int 0..3, got {q.get('a')!r}")
    if q.get("img") is not None:
        if not os.path.isfile(os.path.join(APP, q["img"])):
            err(f"{qid}: img {q['img']} does not exist under {APP}")
        else:
            used.add(os.path.normpath(q["img"]))
    if not isinstance(q.get("credit", ""), str):
        err(f"{qid}: credit must be a string")


doc = json.load(open(PATH, encoding="utf-8"))
used = set()

gen = doc.get("general", [])
if len(gen) != 300:
    err(f"general: {len(gen)} questions, expected 300")
for i, q in enumerate(gen, start=1):
    check_question(q, f"g{i}")
    if q.get("n") != i:
        err(f"g{i}: n is {q.get('n')!r}")

states = doc.get("states", {})
if list(states) != CODES:
    err(f"states: keys {list(states)}, expected {CODES}")
for code in CODES:
    st = states.get(code)
    if not st:
        continue
    if not st.get("name"):
        err(f"{code}: missing name")
    qs = st.get("questions", [])
    if len(qs) != 10:
        err(f"{code}: {len(qs)} questions, expected 10")
    for k, q in enumerate(qs, start=1):
        check_question(q, f"{code}{k}")
        if q.get("k") != k:
            err(f"{code}{k}: k is {q.get('k')!r}")

img_dir = os.path.join(APP, "img")
on_disk = {os.path.join("img", f) for f in os.listdir(img_dir)} if os.path.isdir(img_dir) else set()
for f in sorted(on_disk - used):
    err(f"unreferenced picture {f}")

n_q = len(gen) + sum(len(s.get("questions", [])) for s in states.values())
n_img = sum(1 for q in gen if q.get("img")) + sum(1 for s in states.values() for q in s.get("questions", []) if q.get("img"))
print(f"{PATH}: {len(gen)} general + {len(states)} states = {n_q} questions, {n_img} with pictures")
if errors:
    print(f"{len(errors)} ERROR(S):", *errors, sep="\n  ")
    sys.exit(1)
print("OK")
