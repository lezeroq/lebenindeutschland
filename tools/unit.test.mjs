// Unit tests for the app's pure logic: the learning levels (app/js/srs.js) and the import check
// (app/js/backup.js). Usage: node --test tools/unit.test.mjs   (or `make test`, part of `make check`)
import assert from "node:assert/strict";
import test from "node:test";
import { checkBackup } from "../app/js/backup.js";
import { LEARNED, addDays, grade, steps } from "../app/js/srs.js";

process.env.TZ = "Europe/Berlin"; // the days below cross the switch to summer time on 29 March 2026
const at = (day, hour = 9) => new Date(2026, 2, day, hour).getTime(); // a time on a day in March 2026
const HOUR = 3600e3;

test("four correct answers on four different days make a question learned", () => {
  let p = grade(undefined, true, at(26));
  assert.equal(p.l, 2);
  assert.equal(p.d, at(27, 0));
  for (const [level, wait] of [
    [3, 2],
    [4, 4],
  ]) {
    const now = p.d + 9 * HOUR;
    p = grade(p, true, now);
    assert.equal(p.l, level);
    assert.equal(p.d, addDays(now, wait));
  }
  p = grade(p, true, p.d + 9 * HOUR);
  assert.equal(p.l, LEARNED);
  assert.equal(steps(p), 4);
});

test("practicing before the due day counts the answer but does not move the question up", () => {
  const p = grade(undefined, true, at(26));
  const again = grade(p, true, at(26, 18));
  assert.equal(again.l, 2);
  assert.equal(again.d, p.d);
  assert.equal(again.c, 2);
});

test("a wrong answer drops a question to level 1, due right away", () => {
  const p = grade(grade(undefined, true, at(26)), false, at(27));
  assert.deepEqual([p.l, p.d, p.w, steps(p)], [1, at(27), 1, 0]);
  assert.equal(grade(p, true, at(27, 10)).d, at(28, 0), "answered right again: due the next day");
});

test("addDays returns the start of a later day, also across the switch to summer time", () => {
  assert.equal(addDays(at(28, 12), 1), at(29, 0));
  assert.equal(addDays(at(28, 12), 2), at(30, 0));
  assert.equal(at(30, 0) - at(29, 0), 23 * HOUR, "29 March 2026 has 23 hours in Berlin");
});

const known = { ids: new Set(["g1", "g2", "BY1"]), states: ["BY", "BE"] };

function backup() {
  const now = at(26);
  return {
    app: "lebenindeutschland",
    format: 1,
    exported: "2026-03-26T08:00:00.000Z",
    settings: { lang: "en", hints: true, state: "BY", newPerDay: 20, shuffle: false, onboarded: true },
    progress: { g1: grade(undefined, true, now), g2: grade(undefined, false, now) },
    history: [
      {
        id: "abc",
        type: "quick",
        state: "BY",
        started: now - 6e4,
        finished: now,
        dur: 6e4,
        total: 2,
        correct: 1,
        need: 2,
        pass: false,
        timeUp: false,
        moved: 1,
        items: [
          ["g1", 2],
          ["BY1", null],
        ],
      },
    ],
    daily: { date: "2026-03-26", newDone: 2 },
    activity: ["2026-03-25", "2026-03-26"],
  };
}

test("checkBackup accepts an export", () => {
  assert.deepEqual(checkBackup(backup(), known), []);
});

test("checkBackup rejects broken exports", () => {
  const breakers = {
    "another app": (b) => (b.app = "other"),
    "unknown language": (b) => (b.settings.lang = "xx"),
    "unknown state": (b) => (b.settings.state = "ZZ"),
    "newPerDay as text": (b) => (b.settings.newPerDay = "20"),
    "unknown question": (b) => (b.progress.g999 = b.progress.g1),
    "level out of range": (b) => (b.progress.g1.l = 9),
    "test without items": (b) => delete b.history[0].items,
    "answer out of range": (b) => (b.history[0].items[0][1] = 4),
    "activity with a bad day": (b) => b.activity.push("yesterday"),
    "no daily": (b) => delete b.daily,
    "unknown key": (b) => (b.extra = 1),
  };
  for (const [name, breakIt] of Object.entries(breakers)) {
    const b = backup();
    breakIt(b);
    assert.notDeepEqual(checkBackup(b, known), [], name);
  }
  assert.deepEqual(checkBackup(null, known), ["not a JSON object"]);
});
