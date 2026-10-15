// Checks an exported progress file (store.js exportData) before importData lets it replace what is
// stored. The file must have exactly the shape the app writes; anything else is rejected as a whole.
import { LANGS } from "./i18n.js";

const TOP_KEYS = ["app", "format", "exported", "settings", "progress", "history", "daily", "activity"];
const SETTING_KEYS = ["lang", "hints", "state", "newPerDay", "shuffle", "onboarded"];
const PROGRESS_KEYS = ["l", "d", "c", "w", "t", "L"];
const RECORD_KEYS = [
  ...["id", "type", "state", "started", "finished", "dur", "total"],
  ...["correct", "need", "pass", "timeUp", "moved", "items"],
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isTime = (v) => Number.isFinite(v) && v >= 0;
const unknownKeys = (obj, allowed) => Object.keys(obj).filter((k) => !allowed.includes(k));

// known: { ids: question ids (anything with .has), states: state codes (array) }.
// Returns the problems found; an empty list means the file is valid.
export function checkBackup(obj, known) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  if (!isObj(obj)) return ["not a JSON object"];
  if (obj.app !== "lebenindeutschland") bad("app is not lebenindeutschland");
  if (obj.format !== 1) bad(`unknown format ${obj.format}`);
  if (typeof obj.exported !== "string") bad("exported is not a date string");
  for (const k of unknownKeys(obj, TOP_KEYS)) bad(`unknown key ${k}`);

  const s = obj.settings;
  if (!isObj(s)) bad("settings is not an object");
  else {
    for (const k of unknownKeys(s, SETTING_KEYS)) bad(`unknown setting ${k}`);
    if ("lang" in s && !Object.hasOwn(LANGS, s.lang)) bad(`unknown language ${s.lang}`);
    if ("state" in s && !known.states.includes(s.state)) bad(`unknown state ${s.state}`);
    if ("newPerDay" in s && !(Number.isInteger(s.newPerDay) && s.newPerDay > 0)) bad("newPerDay is not a count");
    for (const k of ["hints", "shuffle", "onboarded"])
      if (k in s && typeof s[k] !== "boolean") bad(`${k} is not true/false`);
  }

  if (!isObj(obj.progress)) bad("progress is not an object");
  else
    for (const [id, p] of Object.entries(obj.progress)) {
      if (!known.ids.has(id)) bad(`progress: unknown question ${id}`);
      else if (!isObj(p)) bad(`progress ${id} is not an object`);
      else if (
        unknownKeys(p, PROGRESS_KEYS).length ||
        !(Number.isInteger(p.l) && p.l >= 0 && p.l <= 5) ||
        !isTime(p.d) ||
        !isCount(p.c) ||
        !isCount(p.w) ||
        !isTime(p.t) ||
        ("L" in p && !isTime(p.L))
      )
        bad(`progress ${id} is malformed`);
    }

  if (!Array.isArray(obj.history)) bad("history is not a list");
  else
    obj.history.forEach((r, i) => {
      const items = isObj(r) && Array.isArray(r.items) ? r.items : null;
      const itemsOk =
        items &&
        items.every(
          (it) =>
            Array.isArray(it) &&
            it.length === 2 &&
            known.ids.has(it[0]) &&
            (it[1] === null || (Number.isInteger(it[1]) && it[1] >= 0 && it[1] <= 3)),
        );
      if (
        !itemsOk ||
        unknownKeys(r, RECORD_KEYS).length ||
        typeof r.id !== "string" ||
        !["exam", "quick"].includes(r.type) ||
        !known.states.includes(r.state) ||
        ![r.started, r.finished, r.dur].every(isTime) ||
        r.total !== items.length ||
        !(isCount(r.correct) && r.correct <= r.total) ||
        ![r.need, r.moved].every(isCount) ||
        ![r.pass, r.timeUp].every((v) => typeof v === "boolean")
      )
        bad(`history record ${i + 1} is malformed`);
    });

  const d = obj.daily;
  if (
    !isObj(d) ||
    unknownKeys(d, ["date", "newDone"]).length ||
    !(d.date === "" || DAY.test(d.date)) ||
    !isCount(d.newDone)
  )
    bad("daily is malformed");

  if (!Array.isArray(obj.activity) || !obj.activity.every((day) => typeof day === "string" && DAY.test(day)))
    bad("activity is not a list of days");
  return problems;
}
