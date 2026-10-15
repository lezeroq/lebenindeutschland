// Everything the app remembers lives in localStorage on this device, under one prefix.
const NS = "lid:v1:";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(NS + key);
    else localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app keeps working for this visit */
  }
}

const DEFAULT_SETTINGS = { lang: "de", hints: true, state: "BY", newPerDay: 20, shuffle: false, onboarded: false };

export const S = {
  settings: Object.assign({}, DEFAULT_SETTINGS, read("settings", {})),
  progress: read("progress", {}),   // question id -> { l, d, c, w, t, L }
  history: read("history", []),     // finished tests, newest first
  daily: read("daily", { date: "", newDone: 0 }),
  activity: read("activity", []),   // days with learning activity, "YYYY-MM-DD"
  session: read("session", null),   // learning session in progress
  test: read("test", null),         // test in progress
};

export function save(...keys) {
  for (const k of keys) write(k, S[k]);
}

const EXPORT_KEYS = ["settings", "progress", "history", "daily", "activity"];

export function exportData() {
  const out = { app: "lebenindeutschland", format: 1, exported: new Date().toISOString() };
  for (const k of EXPORT_KEYS) out[k] = S[k];
  return out;
}

export function importData(obj) {
  if (!obj || obj.app !== "lebenindeutschland" || typeof obj.progress !== "object") return false;
  S.settings = Object.assign({}, DEFAULT_SETTINGS, obj.settings || {}, { onboarded: true });
  S.progress = obj.progress || {};
  S.history = Array.isArray(obj.history) ? obj.history : [];
  S.daily = obj.daily || { date: "", newDone: 0 };
  S.activity = Array.isArray(obj.activity) ? obj.activity : [];
  S.session = null;
  S.test = null;
  save(...EXPORT_KEYS, "session", "test");
  return true;
}

export function resetProgress() {
  S.progress = {};
  S.daily = { date: "", newDone: 0 };
  S.activity = [];
  S.session = null;
  save("progress", "daily", "activity", "session");
}

export function clearHistory() {
  S.history = [];
  save("history");
}
