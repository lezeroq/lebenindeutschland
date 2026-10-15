"""Join PDF questions (authoritative wording) with the BAMF Testcenter answer key."""
import difflib
import itertools
import json
import re
import sys

pdf = json.load(open(sys.argv[1]))
web = json.load(open(sys.argv[2]))
out = sys.argv[3]


def key(s):
    s = re.sub(r"^Bild (\d)$", r"\1", s.strip())
    toks = re.findall(r"\w+", s.lower().replace("selbstständig", "selbständig"))
    return " ".join(sorted(toks))


def sim(a, b):
    return difflib.SequenceMatcher(None, key(a), key(b)).ratio()


assert len(pdf) == len(web) == 310
merged, weak = [], []
for i, (p, w) in enumerate(zip(pdf, web)):
    assert w["num"] == i + 1
    wtexts = [a["text"] for a in w["answers"]]
    m = [[sim(wt, pt) for pt in p["options"]] for wt in wtexts]
    perm = max(itertools.permutations(range(4)), key=lambda pm: sum(m[k][pm[k]] for k in range(4)))
    scores = [m[k][perm[k]] for k in range(4)]
    wc = next(k for k, a in enumerate(w["answers"]) if a["correct"])
    idx = perm[wc]
    # runner-up: how close is the second-best PDF option to the web's correct answer
    others = sorted((m[wc][j] for j in range(4) if j != idx), reverse=True)
    if min(scores) < 0.85 or m[wc][idx] - others[0] < 0.25:
        weak.append((i + 1, round(min(scores), 2), round(m[wc][idx] - others[0], 2)))
    merged.append({
        "n": i + 1, "section": p["section"], "num": p["num"], "page": p["page"],
        "question": p["question"], "credit": p["credit"], "options": p["options"], "correct": idx,
        "web_correct_text": wtexts[wc], "identity_order": list(perm) == [0, 1, 2, 3],
    })

json.dump(merged, open(out, "w"), ensure_ascii=False, indent=1)
print("merged", len(merged), "| weak matches", len(weak),
      "| option order differs from PDF", sum(not x["identity_order"] for x in merged))
for wk in weak:
    print("weak", wk)
