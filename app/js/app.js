import { LANGS, t, setLang, relDay, fmtDateTime, fmtMinutes, fmtNumber } from "./i18n.js";
import { S, save, exportData, importData, resetProgress, clearHistory } from "./store.js";
import { grade, markLearned, backToLearning, steps, LEARNED } from "./srs.js";
import { VERSION } from "./version.js";

const STATES = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};
const SESSION_SIZE = 20;
const EXAM_MS = 60 * 60 * 1000;
const PASS_MARK = 17;
const TRIVIAL = /^(Bild \d|\d+)$/; // picture labels and plain numbers need no translation

const ICON = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const ICONS = {
  learn: ICON(
    '<rect x="3.5" y="7" width="13" height="13.5" rx="2.5"/><path d="M7.5 3.5h10a3 3 0 0 1 3 3V17"/><path d="m7 13.5 2 2 4-4"/>',
  ),
  test: ICON('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2.5M9.5 2.5h5M18.5 6.5l1.5-1.5"/>'),
  browse: ICON(
    '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="17.5" r="1.2"/>',
  ),
  settings: ICON(
    '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  ),
  close: ICON('<path d="M6 6l12 12M18 6 6 18"/>'),
  left: ICON('<path d="m15 5-7 7 7 7"/>'),
  right: ICON('<path d="m9 5 7 7-7 7"/>'),
  check: ICON('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  globe: ICON(
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5Z"/>',
  ),
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

let DATA = null;
const BY_ID = new Map();
const HINTS = {};
const ui = {
  tab: "learn",
  learn: "home",
  summary: null,
  testView: "home",
  reviewId: null,
  reviewAll: false,
  confirm: null,
  browse: { filter: "all", term: "", answers: true },
};
let timer = null;
let swReg = null;

/* ---------------- data ---------------- */

function stateQuestions(code = S.settings.state) {
  return DATA.states[code]?.questions || [];
}
function pool() {
  return DATA.general.concat(stateQuestions());
}

// New questions come in catalogue order with one state question after every 30 general ones.
function learnOrder() {
  const st = stateQuestions(),
    out = [];
  DATA.general.forEach((q, i) => {
    out.push(q);
    const k = (i + 1) / 30 - 1;
    if (Number.isInteger(k) && st[k]) out.push(st[k]);
  });
  return out;
}

function qLabel(q) {
  return q.st ? `${STATES[q.st]} · ${t("task")} ${q.k}` : `${t("task")} ${q.n}`;
}

async function loadHints(lang) {
  if (lang === "de" || HINTS[lang]) return;
  try {
    const res = await fetch(`data/hints-${lang}.json`);
    if (res.ok) {
      HINTS[lang] = await res.json();
      render();
    }
  } catch {
    /* offline before first load: hints appear once the file is cached */
  }
}
function hintFor(q) {
  const l = S.settings.lang;
  return l !== "de" && HINTS[l] ? HINTS[l][q.id] || null : null;
}

/* ---------------- progress ---------------- */

const P = (id) => S.progress[id];
function status(id) {
  const p = P(id);
  if (!p || !p.l) return "new";
  return p.l >= LEARNED ? "learned" : "learning";
}

function stats() {
  const now = Date.now();
  const r = { total: 0, learned: 0, learning: 0, fresh: 0, due: 0 };
  for (const q of pool()) {
    r.total++;
    const s = status(q.id);
    if (s === "new") r.fresh++;
    else if (s === "learned") r.learned++;
    else {
      r.learning++;
      if (P(q.id).d <= now) r.due++;
    }
  }
  return r;
}

function ensureToday() {
  const d = todayStr();
  if (S.daily.date !== d) {
    S.daily = { date: d, newDone: 0 };
    save("daily");
  }
}
function newLeft() {
  ensureToday();
  return Math.max(0, S.settings.newPerDay - S.daily.newDone);
}

function plan() {
  const st = stats();
  const due = Math.min(st.due, SESSION_SIZE);
  const fresh = Math.min(SESSION_SIZE - due, newLeft(), st.fresh);
  return { due, fresh, size: due + fresh };
}

function markActivity() {
  const d = todayStr();
  if (S.activity[S.activity.length - 1] !== d) {
    S.activity.push(d);
    S.activity = S.activity.slice(-400);
    save("activity");
  }
}
function streak() {
  const days = new Set(S.activity),
    d = new Date();
  if (!days.has(todayStr(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(todayStr(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/* ---------------- learning session ---------------- */

function optionOrder() {
  return S.settings.shuffle ? shuffle([0, 1, 2, 3]) : null;
}

function buildSession(extra) {
  const now = Date.now(),
    all = pool();
  const learning = all.filter((q) => status(q.id) === "learning").sort((a, b) => P(a.id).d - P(b.id).d);
  const due = learning.filter((q) => P(q.id).d <= now).slice(0, SESSION_SIZE);
  const nNew = Math.max(0, Math.min(SESSION_SIZE - due.length, extra ? SESSION_SIZE : newLeft()));
  const fresh = learnOrder()
    .filter((q) => status(q.id) === "new")
    .slice(0, nNew);
  const early = extra
    ? learning.filter((q) => P(q.id).d > now).slice(0, Math.max(0, SESSION_SIZE - due.length - fresh.length))
    : [];
  const reviews = due.concat(early).map((q) => q.id),
    news = fresh.map((q) => q.id),
    queue = [];
  while (reviews.length || news.length) {
    if (reviews.length) queue.push(reviews.shift());
    if (reviews.length) queue.push(reviews.shift());
    if (news.length) queue.push(news.shift());
  }
  if (!queue.length) return null;
  return {
    queue,
    pos: 0,
    total: queue.length,
    cleared: [],
    first: {},
    answered: null,
    order: optionOrder(),
    extra: !!extra,
  };
}

function startSession(extra) {
  S.session = buildSession(extra);
  save("session");
  ui.learn = "home";
  render(true);
}

function answerLearn(i) {
  const s = S.session;
  if (!s || s.answered) return;
  const id = s.queue[s.pos],
    q = BY_ID.get(id),
    correct = i === q.a,
    now = Date.now();
  const prev = P(id);
  if (!prev || !prev.l) {
    ensureToday();
    S.daily.newDone++;
    save("daily");
  }
  S.progress[id] = grade(prev, correct, now);
  markActivity();
  if (!(id in s.first)) s.first[id] = correct;
  if (correct) {
    if (!s.cleared.includes(id)) s.cleared.push(id);
  } else s.queue.splice(Math.min(s.pos + 4, s.queue.length), 0, id);
  s.answered = { pick: i, correct };
  save("progress", "session");
  render();
}

function endSession() {
  const s = S.session;
  const n = s ? Object.keys(s.first).length : 0;
  ui.summary = n ? { n, c: Object.values(s.first).filter(Boolean).length } : null;
  S.session = null;
  save("session");
  ui.learn = ui.summary ? "summary" : "home";
  render(true);
}

function nextCard() {
  const s = S.session;
  if (!s || !s.answered) return;
  s.pos++;
  s.answered = null;
  s.order = optionOrder();
  if (s.pos >= s.queue.length) return endSession();
  save("session");
  render(true);
}

/* ---------------- tests ---------------- */

function startTest(type) {
  if (S.test) return;
  const ids =
    type === "exam"
      ? shuffle(DATA.general)
          .slice(0, 30)
          .concat(shuffle(stateQuestions()).slice(0, 3))
          .map((q) => q.id)
      : shuffle(pool())
          .slice(0, 10)
          .map((q) => q.id);
  S.test = {
    type,
    state: S.settings.state,
    ids,
    picks: ids.map(() => null),
    idx: 0,
    started: Date.now(),
    limit: type === "exam" ? EXAM_MS : 0,
  };
  save("test");
  ui.testView = "run";
  ui.confirm = null;
  render(true);
}

function testElapsed(T) {
  return (T.paused || Date.now()) - T.started;
}
function testExpired(T) {
  return T && T.limit && !T.paused && testElapsed(T) >= T.limit;
}

// Scores the running test, stores it in the history and sends every mistake back to learning.
function finishTest(timeUp) {
  const T = S.test;
  if (!T) return;
  const now = Date.now();
  const items = T.ids.map((id, i) => [id, T.picks[i]]);
  const correct = items.filter(([id, p]) => BY_ID.get(id) && BY_ID.get(id).a === p).length;
  const need = T.type === "exam" ? PASS_MARK : Math.ceil((items.length * PASS_MARK) / 33);
  let moved = 0;
  for (const [id, p] of items) {
    const q = BY_ID.get(id);
    if (!q || p === q.a) continue;
    const prev = P(id);
    S.progress[id] = backToLearning(prev, now);
    S.progress[id].w = (prev?.w || 0) + 1;
    moved++;
  }
  const rec = {
    id: now.toString(36),
    type: T.type,
    state: T.state,
    started: T.started,
    finished: now,
    dur: Math.min(testElapsed(T), T.limit || Infinity),
    total: items.length,
    correct,
    need,
    pass: correct >= need,
    timeUp: !!timeUp,
    moved,
    items,
  };
  S.history.unshift(rec);
  S.history = S.history.slice(0, 300);
  S.test = null;
  save("history", "test", "progress");
  ui.testView = "review";
  ui.reviewId = rec.id;
  ui.reviewAll = false;
  ui.confirm = null;
}

function startTimer() {
  const tick = () => {
    const T = S.test,
      el = $("#timer");
    if (!T || !el) return;
    if (T.limit) {
      const left = T.limit - testElapsed(T);
      if (left <= 0) {
        finishTest(true);
        render(true);
        toast(t("timeUp"));
        return;
      }
      el.textContent = clock(left);
      el.classList.toggle("low", left < 5 * 60000);
    } else {
      el.textContent = clock(testElapsed(T));
    }
  };
  tick();
  timer = setInterval(tick, 1000);
}

/* ---------------- building blocks ---------------- */

function hintPill() {
  const l = S.settings.lang;
  if (l === "de") return "";
  return `<button type="button" class="pill${S.settings.hints ? " on" : ""}" data-act="toggle-hints" aria-pressed="${S.settings.hints}" aria-label="${esc(t("hints.toggle"))}">${ICONS.globe}<span>${l.toUpperCase()}</span></button>`;
}

function dotsHTML(p) {
  const n = steps(p);
  return `<span class="dots" title="${esc(t("steps", { n }))}" aria-label="${esc(t("steps", { n }))}">${[0, 1, 2, 3].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
}

function segBar(st) {
  const w = (n) => `${((n / Math.max(1, st.total)) * 100).toFixed(2)}%`;
  return `<div class="segbar" role="img" aria-label="${esc(`${t("learned")} ${st.learned}, ${t("learning")} ${st.learning}, ${t("new")} ${st.fresh}`)}"><span class="s-learned" style="width:${w(st.learned)}"></span><span class="s-learning" style="width:${w(st.learning)}"></span></div>`;
}

// One renderer for every place a question appears.
// mode: show (answer ticked) | answer (tap to answer) | answered | pick (test) | review (after a test)
function qCard(q, o = {}) {
  const mode = o.mode || "show";
  const order = o.order || [0, 1, 2, 3];
  const h = hintFor(q);
  const interactive = mode === "answer" || mode === "pick";
  const opts = order
    .map((oi) => {
      const text = q.o[oi];
      const ht =
        h && h.o && h.o[oi] && h.o[oi] !== text && !TRIVIAL.test(text)
          ? `<span class="hint">${esc(h.o[oi])}</span>`
          : "";
      let cls = "";
      if (mode === "show") cls = oi === q.a ? "is-correct" : "dim";
      else if (mode === "answered" || mode === "review")
        cls = oi === q.a ? "is-correct" : oi === o.picked ? "is-wrong" : "dim";
      else if (mode === "pick" && oi === o.picked) cls = "is-picked";
      const sr =
        mode !== "pick" && mode !== "answer"
          ? oi === q.a
            ? `<span class="sr">${t("sr.correct")}</span>`
            : oi === o.picked
              ? `<span class="sr">${t("sr.yours")}</span>`
              : ""
          : "";
      const body = `<span class="box" aria-hidden="true"></span><span class="otext">${esc(text)}${ht}${sr}</span>`;
      return interactive
        ? `<li><button type="button" class="opt ${cls}" data-act="${o.act}" data-i="${oi}"${mode === "pick" ? ` aria-pressed="${oi === o.picked}"` : ""}>${body}</button></li>`
        : `<li class="opt ${cls}">${body}</li>`;
    })
    .join("");
  const img = q.img
    ? `<figure class="qimg"><img src="${esc(q.img)}" alt="${esc(t("picture"))}" loading="lazy" decoding="async">${q.credit ? `<figcaption>${esc(q.credit)}</figcaption>` : ""}</figure>`
    : "";
  return `<article class="qcard${o.cls ? " " + o.cls : ""}" data-id="${q.id}">
    <header class="qhead"><span class="qnum">${esc(qLabel(q))}</span>${o.head || ""}${h ? `<button type="button" class="tr-btn" data-act="toggle-tr">${ICONS.globe}${esc(t("translate"))}</button>` : ""}</header>
    <p class="qtext">${esc(q.q)}</p>${h ? `<p class="hint qhint">${esc(h.q)}</p>` : ""}
    ${img}
    <ol class="opts">${opts}</ol>${o.note ? `<p class="qnote">${esc(o.note)}</p>` : ""}
  </article>`;
}

function confirmBox(text, yesAct, yesLabel, noAct = "confirm-cancel", noLabel = t("cancel")) {
  return `<div class="confirm" role="alert"><p>${esc(text)}</p><div class="row-btns"><button type="button" class="btn danger" data-act="${yesAct}">${esc(yesLabel)}</button><button type="button" class="btn" data-act="${noAct}">${esc(noLabel)}</button></div></div>`;
}

/* ---------------- views: learn ---------------- */

function viewLearn() {
  if (S.session) return viewSession();
  if (ui.learn === "summary") return viewSummary();
  if (ui.learn === "learned" || ui.learn === "learning") return viewList(ui.learn);
  const st = stats(),
    pl = plan();
  const allDone = st.learned === st.total;
  let action;
  if (allDone) {
    action = `<section class="card done-card"><h2>${t("allLearned.title")}</h2><p class="muted">${t("allLearned.body")}</p></section>`;
  } else if (pl.size) {
    action = `<button type="button" class="btn primary big" data-act="start-session"><span>${t("startLearning")}</span><small>${t("sessionPlan", { due: pl.due, fresh: pl.fresh })}</small></button>`;
  } else {
    action = `<section class="card done-card"><div class="done-mark">${ICONS.check}</div><div><h2>${t("doneToday.title")}</h2><p class="muted">${t("doneToday.body")}</p></div></section>
      <button type="button" class="btn big" data-act="start-extra"><span>${t("practiceMore")}</span><small>${t("practiceMore.sub")}</small></button>`;
  }
  return `
    <section class="card progress-card">
      <div class="pc-top"><h2>${t("progress.title")}</h2><span class="muted">${esc(STATES[S.settings.state])}</span></div>
      <p class="big-num"><b>${st.learned}</b> <span>${t("progress.of", { n: st.total })}</span></p>
      ${segBar(st)}
      <ul class="legend">
        <li><i class="sw s-learned"></i>${t("learned")} <b>${st.learned}</b></li>
        <li><i class="sw s-learning"></i>${t("learning")} <b>${st.learning}</b></li>
        <li><i class="sw s-new"></i>${t("new")} <b>${st.fresh}</b></li>
      </ul>
    </section>
    <section class="kpis">
      <div><b>${st.due}</b><span>${t("kpi.due")}</span></div>
      <div><b>${newLeft()}</b><span>${t("kpi.newLeft")}</span></div>
      <div><b>${streak()}</b><span>${t("kpi.streak")}</span></div>
    </section>
    ${action}
    <nav class="rows">
      <button type="button" class="row-link" data-act="open-list" data-list="learned"><span>${t("list.learned")}</span><b>${st.learned}</b>${ICONS.right}</button>
      <button type="button" class="row-link" data-act="open-list" data-list="learning"><span>${t("list.learning")}</span><b>${st.learning}</b>${ICONS.right}</button>
    </nav>
    <details class="how"><summary>${t("how.title")}</summary><p>${t("how.body")}</p></details>`;
}

function viewSession() {
  const s = S.session,
    id = s.queue[s.pos],
    q = BY_ID.get(id);
  if (!q) {
    S.session = null;
    save("session");
    return viewLearn();
  }
  const p = P(id);
  const pct = Math.round((s.cleared.length / s.total) * 100);
  let fb = "";
  if (s.answered) {
    fb = s.answered.correct
      ? `<p class="fb good">${ICONS.check}<span><b>${t("fb.correct")}</b> ${p.l >= LEARNED ? t("fb.learned") : t("fb.nextReview", { when: relDay(p.d) })}</span></p>`
      : `<p class="fb bad"><span><b>${t("fb.wrong")}</b> ${t("fb.again")}</span></p>`;
  }
  const isNew = !s.answered && (!p || !p.l);
  const canMark = s.answered && s.answered.correct && p.l < LEARNED;
  return `
    <div class="focus-top">
      <button type="button" class="icon-btn" data-act="end-session" aria-label="${esc(t("endSession"))}">${ICONS.close}</button>
      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${s.total}" aria-valuenow="${s.cleared.length}"><span style="width:${pct}%"></span></div>
      <span class="meter-num">${s.cleared.length}/${s.total}</span>
      ${hintPill()}
    </div>
    ${qCard(q, {
      mode: s.answered ? "answered" : "answer",
      order: s.order,
      picked: s.answered?.pick,
      act: "answer-learn",
      head: isNew ? `<span class="badge new">${t("level.new")}</span>` : dotsHTML(p),
    })}
    <div class="fb-wrap" aria-live="polite">${fb}</div>
    ${canMark ? `<button type="button" class="link" data-act="mark-learned" data-id="${id}">${t("markLearned.inline")}</button>` : ""}
    <div class="actionbar"><button type="button" class="btn primary wide" data-act="next-card"${s.answered ? "" : " disabled"}>${t("next")}</button></div>`;
}

function viewSummary() {
  const sm = ui.summary || { n: 0, c: 0 };
  const st = stats(),
    pl = plan();
  const next = pl.size
    ? `<button type="button" class="btn primary big" data-act="start-session"><span>${t("summary.next")}</span><small>${t("sessionPlan", { due: pl.due, fresh: pl.fresh })}</small></button>`
    : st.learned < st.total
      ? `<button type="button" class="btn big" data-act="start-extra"><span>${t("practiceMore")}</span><small>${t("practiceMore.sub")}</small></button>`
      : "";
  return `
    <section class="card summary-card">
      <div class="done-mark">${ICONS.check}</div>
      <h2>${t("summary.title")}</h2>
      <p class="muted">${t("summary.firstTry", { c: sm.c, n: sm.n })}</p>
      ${segBar(st)}
      <p class="muted small">${st.learned} ${t("progress.of", { n: st.total })}</p>
    </section>
    <div class="stack">${next}<button type="button" class="btn" data-act="list-back">${t("summary.done")}</button></div>`;
}

function viewList(kind) {
  const now = Date.now();
  const items = pool().filter((q) => status(q.id) === kind);
  if (kind === "learning") items.sort((a, b) => P(a.id).d - P(b.id).d);
  else items.sort((a, b) => (P(b.id).L || 0) - (P(a.id).L || 0));
  const rows = items
    .map((q) => {
      const p = P(q.id),
        h = hintFor(q);
      const ans = q.o[q.a],
        hAns = h && h.o && h.o[q.a] !== ans ? h.o[q.a] : "";
      return `<li class="lrow">
      <div class="lrow-main">
        <span class="qnum">${esc(qLabel(q))}</span>
        <p class="lq">${esc(q.q)}</p>${h ? `<p class="hint">${esc(h.q)}</p>` : ""}
        ${q.img ? `<img class="lthumb" src="${esc(q.img)}" alt="${esc(t("picture"))}" loading="lazy">` : ""}
        <p class="la">${ICONS.check}<span>${esc(ans)}${hAns ? `<span class="hint">${esc(hAns)}</span>` : ""}</span></p>
        ${kind === "learning" ? `<p class="lmeta">${dotsHTML(p)}<span>${p.d <= now ? t("due.now") : t("due.in", { when: relDay(p.d) })}</span></p>` : ""}
      </div>
      <button type="button" class="btn small" data-act="${kind === "learned" ? "move-back" : "mark-learned"}" data-id="${q.id}">${kind === "learned" ? t("moveBack") : t("markLearned")}</button>
    </li>`;
    })
    .join("");
  return `
    <div class="subhead"><button type="button" class="back" data-act="list-back">${ICONS.left}<span>${t("tab.learn")}</span></button></div>
    <h2 class="page-h">${t(kind === "learned" ? "list.learned" : "list.learning")} <span class="muted">${items.length}</span></h2>
    ${items.length ? `<ul class="lrows">${rows}</ul>` : `<p class="empty">${t(kind === "learned" ? "list.learned.empty" : "list.learning.empty")}</p>`}`;
}

/* ---------------- views: test ---------------- */

function viewTest() {
  if (ui.testView === "run" && S.test) return viewTestRun();
  if (ui.testView === "review") {
    const r = S.history.find((x) => x.id === ui.reviewId);
    if (r) return viewReview(r);
  }
  return viewTestHome();
}

function viewTestHome() {
  const T = S.test;
  const resume = T
    ? `<button type="button" class="card resume" data-act="test-resume">
      <span><b>${t("test.resume")}</b><small>${t(T.type === "exam" ? "test.exam" : "test.quick")} · ${t("test.resume.sub", { a: T.picks.filter((p) => p !== null).length, n: T.ids.length })}</small></span>${ICONS.right}</button>`
    : "";
  const modes = `
    <div class="modes">
      <section class="card mode">
        <h2>${t("test.exam")}</h2><p class="muted">${t("test.exam.sub")}</p>
        <button type="button" class="btn primary" data-act="test-start" data-type="exam"${T ? " disabled" : ""}>${t("test.start")}</button>
      </section>
      <section class="card mode">
        <h2>${t("test.quick")}</h2><p class="muted">${t("test.quick.sub")}</p>
        <button type="button" class="btn" data-act="test-start" data-type="quick"${T ? " disabled" : ""}>${t("test.start")}</button>
      </section>
    </div>${T ? `<p class="note">${t("test.busy")}</p>` : ""}`;
  const exams = S.history.filter((r) => r.type === "exam");
  let statsHTML = "";
  if (exams.length) {
    const passed = exams.filter((r) => r.pass).length;
    const avg = exams.reduce((a, r) => a + r.correct, 0) / exams.length;
    statsHTML = `<section class="card">
      <div class="kpis inset">
        <div><b>${exams.length}</b><span>${t("stats.tests")}</span></div>
        <div><b>${passed}</b><span>${t("stats.passed")}</span></div>
        <div><b>${fmtNumber(avg)}</b><span>${t("stats.avg")}</span></div>
      </div>
      ${scoreChart(exams.slice(0, 12).reverse())}
      <p class="note">${t("chart.caption")}</p></section>`;
  }
  const hist = S.history.length
    ? `<ul class="hist">${S.history
        .map(
          (r) => `<li><button type="button" class="hrow" data-act="open-review" data-id="${r.id}">
        <span class="hmain"><b>${t(r.type === "exam" ? "test.exam" : "test.quick")}</b><small>${esc(fmtDateTime(r.finished))} · ${esc(r.state)}</small></span>
        <span class="hscore">${r.correct}/${r.total}</span><span class="badge ${r.pass ? "pass" : "fail"}">${t(r.pass ? "result.pass" : "result.fail")}</span></button></li>`,
        )
        .join("")}</ul>`
    : `<p class="empty">${t("history.empty")}</p>`;
  return `${resume}${modes}${statsHTML}<h2 class="section-h">${t("history.title")}</h2>${hist}`;
}

function scoreChart(list) {
  const W = 320,
    H = 128,
    top = 8,
    bottom = 20,
    left = 2,
    right = 24,
    ph = H - top - bottom;
  const slot = (W - left - right) / Math.max(list.length, 8),
    bw = Math.min(20, slot * 0.62);
  const y = (v) => top + ph - (v / 33) * ph;
  const bars = list
    .map((r, i) => {
      const x = left + i * slot + (slot - bw) / 2,
        h = (r.correct / 33) * ph;
      return `<rect x="${x.toFixed(1)}" y="${(top + ph - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" class="${r.pass ? "b-pass" : "b-fail"}"/><text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" class="c-lab">${r.correct}</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("chart.caption"))}">
    <line x1="${left}" x2="${W - right}" y1="${top + ph}" y2="${top + ph}" class="c-axis"/>
    <line x1="${left}" x2="${W - right}" y1="${y(PASS_MARK).toFixed(1)}" y2="${y(PASS_MARK).toFixed(1)}" class="c-pass"/>
    <text x="${W - right + 5}" y="${(y(PASS_MARK) + 4).toFixed(1)}" class="c-passlab">17</text>${bars}</svg>`;
}

function viewTestRun() {
  const T = S.test,
    n = T.ids.length,
    q = BY_ID.get(T.ids[T.idx]);
  const unanswered = T.picks.filter((p) => p === null).length;
  const grid = T.ids
    .map(
      (id, i) =>
        `<button type="button" class="gcell${T.picks[i] !== null ? " done" : ""}${i === T.idx ? " here" : ""}" data-act="test-go" data-i="${i}" aria-label="${esc(t("questionOf", { i: i + 1, n }))}">${i + 1}</button>`,
    )
    .join("");
  let box = "";
  if (ui.confirm === "finish")
    box = confirmBox(
      t("finish.unanswered", { n: unanswered }),
      "test-finish-now",
      t("finish.confirm"),
      "confirm-cancel",
      t("keepGoing"),
    );
  if (ui.confirm === "exit")
    box = `<div class="confirm" role="alert"><p><b>${t("exit.title")}</b> ${T.limit ? t("exit.note") : ""}</p><div class="row-btns">
      <button type="button" class="btn primary" data-act="test-later">${t("exit.later")}</button>
      <button type="button" class="btn danger" data-act="test-discard">${t("exit.discard")}</button>
      <button type="button" class="btn" data-act="confirm-cancel">${t("cancel")}</button></div></div>`;
  return `
    <div class="focus-top">
      <button type="button" class="icon-btn" data-act="test-exit" aria-label="${esc(t("exit.title"))}">${ICONS.close}</button>
      <span class="run-title">${t("questionOf", { i: T.idx + 1, n })}</span>
      <span class="timer" id="timer"></span>
      ${hintPill()}
    </div>
    ${box}
    <div class="grid">${grid}</div>
    ${q ? qCard(q, { mode: "pick", picked: T.picks[T.idx], act: "pick-test" }) : ""}
    <div class="actionbar">
      <button type="button" class="btn" data-act="test-prev"${T.idx === 0 ? " disabled" : ""}>${t("back")}</button>
      ${T.idx < n - 1 ? `<button type="button" class="btn primary" data-act="test-next">${t("next")}</button>` : ""}
      <button type="button" class="btn${T.idx === n - 1 ? " primary" : ""}" data-act="test-finish">${t("finish")}</button>
    </div>`;
}

function viewReview(r) {
  const rows = r.items.map(([id, p], i) => ({ q: BY_ID.get(id), p, i })).filter((x) => x.q);
  const wrong = rows.filter((x) => x.p !== x.q.a);
  const shown = ui.reviewAll ? rows : wrong;
  const list = shown
    .map((x) =>
      qCard(x.q, {
        mode: "review",
        picked: x.p,
        head: `<span class="qpos">#${x.i + 1}</span>`,
        note: x.p === null ? t("unanswered") : "",
        cls: x.p === x.q.a ? "ok" : "bad",
      }),
    )
    .join("");
  return `
    <div class="subhead"><button type="button" class="back" data-act="review-back">${ICONS.left}<span>${t("tab.test")}</span></button></div>
    <section class="card result-card">
      <p class="muted small">${t(r.type === "exam" ? "test.exam" : "test.quick")} · ${esc(STATES[r.state] || r.state)} · ${esc(fmtDateTime(r.finished))}</p>
      <p class="score"><b>${r.correct}</b><span>/ ${r.total}</span></p>
      <span class="badge big ${r.pass ? "pass" : "fail"}">${t(r.pass ? "result.pass" : "result.fail")}</span>
      <ul class="facts">
        ${!r.pass ? `<li>${t("result.need", { n: r.need - r.correct })}</li>` : ""}
        <li>${t("result.time", { d: fmtMinutes(r.dur) })}${r.timeUp ? ` · ${t("timeUp")}` : ""}</li>
        ${r.moved ? `<li>${t("result.moved", { n: r.moved })}</li>` : ""}
      </ul>
    </section>
    <div class="seg" role="group">
      <button type="button" class="seg-btn" data-act="review-filter" data-all="0" aria-pressed="${!ui.reviewAll}">${t("result.onlyWrong")} <span class="ct">${wrong.length}</span></button>
      <button type="button" class="seg-btn" data-act="review-filter" data-all="1" aria-pressed="${ui.reviewAll}">${t("result.all")} <span class="ct">${rows.length}</span></button>
    </div>
    <div class="qlist">${list || `<p class="empty">${t("result.noMistakes")}</p>`}</div>
    <div class="stack"><button type="button" class="btn" data-act="review-back">${t("result.back")}</button></div>`;
}

/* ---------------- views: browse ---------------- */

function viewBrowse() {
  const b = ui.browse,
    st = stateQuestions();
  const segs = [
    ["all", t("browse.all"), DATA.general.length + st.length],
    ["general", t("browse.general"), DATA.general.length],
    ["state", STATES[S.settings.state], st.length],
  ];
  return `
    <div class="browse-controls">
      <div class="seg" role="group">${segs.map(([k, label, n]) => `<button type="button" class="seg-btn" data-act="browse-filter" data-f="${k}" aria-pressed="${b.filter === k}"><span class="seg-label">${esc(label)}</span> <span class="ct">${n}</span></button>`).join("")}</div>
      <input type="search" id="browse-search" class="search" placeholder="${esc(t("browse.search"))}" value="${esc(b.term)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
      <label class="switch-row compact"><span>${t("browse.showAnswers")}</span><input type="checkbox" class="switch" id="browse-answers"${b.answers ? " checked" : ""}></label>
      <p class="note">${t("browse.note")}</p>
    </div>
    <div id="browse-list" class="qlist"></div>`;
}

function browseMatches(q, term) {
  if (/^\d+$/.test(term)) return q.n === +term || (q.st && q.k === +term && ui.browse.filter === "state");
  const h = hintFor(q);
  const hay = [q.q, ...q.o, h ? h.q : "", ...(h && h.o ? h.o : [])].join(" ").toLowerCase();
  return hay.includes(term);
}

function renderBrowseList() {
  const el = $("#browse-list");
  if (!el) return;
  const b = ui.browse,
    term = b.term.trim().toLowerCase();
  let items = b.filter === "general" ? DATA.general : b.filter === "state" ? stateQuestions() : pool();
  if (term) items = items.filter((q) => browseMatches(q, term));
  el.innerHTML = items.length
    ? items.map((q) => qCard(q, { mode: b.answers ? "show" : "answer", act: "reveal-browse" })).join("")
    : `<p class="empty">${esc(t("browse.empty", { q: b.term }))}</p>`;
}

/* ---------------- views: settings & onboarding ---------------- */

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function langButtons() {
  return `<div class="seg" role="group">${Object.entries(LANGS)
    .map(
      ([k, l]) =>
        `<button type="button" class="seg-btn" data-act="set-lang" data-lang="${k}" aria-pressed="${S.settings.lang === k}" lang="${k}">${l.name}</button>`,
    )
    .join("")}</div>`;
}
function hintsSwitch() {
  const de = S.settings.lang === "de";
  return `<label class="switch-row${de ? " disabled" : ""}"><span><b>${t("set.hints")}</b><small>${de ? t("set.hints.de") : t("set.hints.note")}</small></span>
    <input type="checkbox" class="switch" id="set-hints"${S.settings.hints && !de ? " checked" : ""}${de ? " disabled" : ""}></label>`;
}
function stateSelect() {
  return `<select id="set-state" class="select" aria-label="${esc(t("set.state"))}">${Object.entries(STATES)
    .map(([c, n]) => `<option value="${c}"${c === S.settings.state ? " selected" : ""}>${n}</option>`)
    .join("")}</select>`;
}
function installCard() {
  return isIOS() && !isStandalone()
    ? `<section class="card install"><h2>${t("install.title")}</h2><p class="muted">${t("install.body")}</p></section>`
    : "";
}

function viewSettings() {
  const s = S.settings;
  return `
    <section class="group"><h2>${t("set.language")}</h2>${langButtons()}<p class="note">${t("set.language.note")}</p>${hintsSwitch()}</section>
    <section class="group"><h2>${t("set.state")}</h2>${stateSelect()}<p class="note">${t("set.state.note")}</p></section>
    <section class="group"><h2>${t("set.learning")}</h2>
      <p class="label">${t("set.newPerDay")}</p>
      <div class="seg" role="group">${[10, 20, 30, 50].map((n) => `<button type="button" class="seg-btn" data-act="set-new" data-n="${n}" aria-pressed="${s.newPerDay === n}">${n}</button>`).join("")}</div>
      <label class="switch-row"><span><b>${t("set.shuffle")}</b><small>${t("set.shuffle.note")}</small></span><input type="checkbox" class="switch" id="set-shuffle"${s.shuffle ? " checked" : ""}></label>
    </section>
    ${installCard()}
    <section class="group"><h2>${t("set.data")}</h2><p class="note">${t("set.storage.note")}</p>
      <div class="stack">
        <button type="button" class="btn" data-act="export">${t("set.export")}</button>
        <button type="button" class="btn" data-act="import">${t("set.import")}</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
        <button type="button" class="btn danger-outline" data-act="ask" data-what="reset">${t("set.resetProgress")}</button>
        ${ui.confirm === "reset" ? confirmBox(t("confirm.reset"), "reset-do", t("confirm.yes")) : ""}
        <button type="button" class="btn danger-outline" data-act="ask" data-what="history">${t("set.clearHistory")}</button>
        ${ui.confirm === "history" ? confirmBox(t("confirm.history"), "history-do", t("confirm.yes")) : ""}
      </div>
    </section>
    <section class="group about"><h2>${t("about.title")}</h2><p class="note">${t("about.body", { edition: DATA.source.edition })}</p><p class="note mono">v${VERSION}</p></section>`;
}

function renderOnboarding() {
  document.body.classList.add("focus", "onboarding");
  $("#topbar").innerHTML = "";
  $("#tabbar").innerHTML = "";
  $("#view").innerHTML = `
    <section class="onb">
      <img class="onb-icon" src="icons/icon.svg" alt="" width="72" height="72">
      <h1>Leben in Deutschland</h1>
      <p class="muted">${t("onb.sub")}</p>
      <h2>${t("onb.lang")}</h2>${langButtons()}
      ${S.settings.lang !== "de" ? hintsSwitch() : ""}
      <h2>${t("onb.state")}</h2>${stateSelect()}
      <button type="button" class="btn primary big" data-act="onb-start"><span>${t("onb.start")}</span></button>
      ${installCard()}
    </section>`;
}

/* ---------------- shell ---------------- */

function topbarHTML() {
  const title = { learn: t("tab.learn"), test: t("tab.test"), browse: t("tab.browse"), settings: t("tab.settings") }[
    ui.tab
  ];
  return `<h1 class="tb-title">${title}</h1><div class="tb-actions">${hintPill()}<button type="button" class="chip" data-act="go" data-tab="settings" aria-label="${esc(t("set.state"))}: ${esc(STATES[S.settings.state])}">${S.settings.state}</button></div>`;
}
function tabbarHTML() {
  return ["learn", "test", "browse", "settings"]
    .map(
      (k) =>
        `<button type="button" data-act="go" data-tab="${k}"${ui.tab === k ? ' aria-current="page"' : ""}>${ICONS[k]}<span>${t("tab." + k)}</span></button>`,
    )
    .join("");
}

function applyLangClasses() {
  const l = S.settings.lang;
  setLang(l);
  document.documentElement.lang = l;
  document.body.classList.toggle("lang-de", l === "de");
  document.body.classList.toggle("hints", l !== "de" && S.settings.hints);
}

function render(toTop) {
  if (!DATA) return;
  clearInterval(timer);
  timer = null;
  applyLangClasses();
  if (!S.settings.onboarded) return renderOnboarding();
  document.body.classList.remove("onboarding");
  if (testExpired(S.test)) {
    finishTest(true);
    if (ui.tab === "test") ui.testView = "review";
  }
  const focus = (ui.tab === "learn" && !!S.session) || (ui.tab === "test" && ui.testView === "run" && !!S.test);
  document.body.classList.toggle("focus", focus);
  $("#topbar").innerHTML = topbarHTML();
  $("#tabbar").innerHTML = tabbarHTML();
  const view =
    ui.tab === "test"
      ? viewTest()
      : ui.tab === "browse"
        ? viewBrowse()
        : ui.tab === "settings"
          ? viewSettings()
          : viewLearn();
  $("#view").innerHTML = view;
  if (ui.tab === "browse") renderBrowseList();
  if (focus && ui.tab === "test") startTimer();
  if (toTop) window.scrollTo(0, 0);
}

function route() {
  const tab = location.hash.replace("#", "");
  ui.tab = ["learn", "test", "browse", "settings"].includes(tab) ? tab : "learn";
  ui.confirm = null;
  if (ui.tab === "learn" && ui.learn !== "summary" && !S.session)
    ui.learn = ui.learn === "learned" || ui.learn === "learning" ? ui.learn : "home";
  if (ui.tab === "test" && !(ui.testView === "run" && S.test) && ui.testView !== "review") ui.testView = "home";
  render(true);
}

function go(tab) {
  if (location.hash === "#" + tab) route();
  else location.hash = tab;
}

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------------- actions ---------------- */

const A = {
  go: (el) => {
    ui.learn = "home";
    ui.testView = S.test ? ui.testView : "home";
    go(el.dataset.tab);
  },
  "start-session": () => startSession(false),
  "start-extra": () => startSession(true),
  "answer-learn": (el) => answerLearn(+el.dataset.i),
  "next-card": () => nextCard(),
  "end-session": () => endSession(),
  "mark-learned": (el) => {
    S.progress[el.dataset.id] = markLearned(P(el.dataset.id), Date.now());
    save("progress");
    toast(t("toast.learned"));
    render();
  },
  "move-back": (el) => {
    S.progress[el.dataset.id] = backToLearning(P(el.dataset.id), Date.now());
    save("progress");
    toast(t("toast.back"));
    render();
  },
  "open-list": (el) => {
    ui.learn = el.dataset.list;
    render(true);
  },
  "list-back": () => {
    ui.learn = "home";
    ui.summary = null;
    render(true);
  },

  "test-start": (el) => startTest(el.dataset.type),
  "test-resume": () => {
    const T = S.test;
    if (T && T.paused) {
      T.started += Date.now() - T.paused;
      delete T.paused;
      save("test");
    }
    ui.testView = "run";
    ui.confirm = null;
    render(true);
  },
  "pick-test": (el) => {
    const T = S.test;
    T.picks[T.idx] = +el.dataset.i;
    save("test");
    render();
    if (T.idx < T.ids.length - 1) {
      const at = T.idx;
      setTimeout(() => {
        if (S.test === T && T.idx === at && ui.testView === "run") {
          T.idx++;
          save("test");
          render(true);
        }
      }, 280);
    }
  },
  "test-go": (el) => {
    S.test.idx = +el.dataset.i;
    ui.confirm = null;
    save("test");
    render(true);
  },
  "test-prev": () => {
    S.test.idx--;
    ui.confirm = null;
    save("test");
    render(true);
  },
  "test-next": () => {
    S.test.idx++;
    ui.confirm = null;
    save("test");
    render(true);
  },
  "test-finish": () => {
    if (S.test.picks.some((p) => p === null)) {
      ui.confirm = "finish";
      render();
      window.scrollTo(0, 0);
      return;
    }
    finishTest(false);
    render(true);
  },
  "test-finish-now": () => {
    finishTest(false);
    render(true);
  },
  "test-exit": () => {
    ui.confirm = "exit";
    render();
    window.scrollTo(0, 0);
  },
  "test-later": () => {
    S.test.paused = Date.now();
    save("test");
    ui.testView = "home";
    ui.confirm = null;
    render(true);
  },
  "test-discard": () => {
    S.test = null;
    save("test");
    ui.testView = "home";
    ui.confirm = null;
    render(true);
  },
  "open-review": (el) => {
    ui.testView = "review";
    ui.reviewId = el.dataset.id;
    ui.reviewAll = false;
    render(true);
  },
  "review-filter": (el) => {
    ui.reviewAll = el.dataset.all === "1";
    render();
  },
  "review-back": () => {
    ui.testView = "home";
    render(true);
  },

  "browse-filter": (el) => {
    ui.browse.filter = el.dataset.f;
    render();
  },
  "reveal-browse": (el) => {
    const card = el.closest(".qcard");
    if (!card || card.classList.contains("revealed")) return;
    const q = BY_ID.get(card.dataset.id),
      pick = +el.dataset.i;
    card.classList.add("revealed");
    card.querySelectorAll("button.opt").forEach((b) => {
      const oi = +b.dataset.i;
      b.setAttribute("aria-disabled", "true");
      b.classList.add(oi === q.a ? "is-correct" : oi === pick ? "is-wrong" : "dim");
    });
  },
  "toggle-tr": (el) => el.closest(".qcard").classList.toggle("show-hint"),
  "toggle-hints": () => {
    S.settings.hints = !S.settings.hints;
    save("settings");
    render();
  },

  "set-lang": (el) => {
    S.settings.lang = el.dataset.lang;
    save("settings");
    loadHints(S.settings.lang);
    render();
  },
  "set-new": (el) => {
    S.settings.newPerDay = +el.dataset.n;
    save("settings");
    render();
  },
  ask: (el) => {
    ui.confirm = ui.confirm === el.dataset.what ? null : el.dataset.what;
    render();
  },
  "confirm-cancel": () => {
    ui.confirm = null;
    render();
  },
  "reset-do": () => {
    resetProgress();
    ui.confirm = null;
    toast(t("done.toast"));
    render();
  },
  "history-do": () => {
    clearHistory();
    ui.confirm = null;
    toast(t("done.toast"));
    render();
  },
  export: async () => {
    const name = `lebenindeutschland-${todayStr()}.json`;
    const blob = new Blob([JSON.stringify(exportData())], { type: "application/json" });
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1500);
  },
  import: () => $("#import-file").click(),
  "onb-start": () => {
    S.settings.onboarded = true;
    save("settings");
    go("learn");
  },
  "update-reload": () => {
    const w = swReg && swReg.waiting;
    if (w) w.postMessage("skipWaiting");
    else location.reload();
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
  const fn = A[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "set-state") {
    S.settings.state = el.value;
    save("settings");
    if (S.settings.onboarded) render();
    else renderOnboarding();
  } else if (el.id === "set-hints") {
    S.settings.hints = el.checked;
    save("settings");
    applyLangClasses();
    render();
  } else if (el.id === "set-shuffle") {
    S.settings.shuffle = el.checked;
    save("settings");
  } else if (el.id === "browse-answers") {
    ui.browse.answers = el.checked;
    renderBrowseList();
  } else if (el.id === "import-file" && el.files[0]) {
    el.files[0].text().then((txt) => {
      let ok;
      try {
        ok = importData(JSON.parse(txt));
      } catch {
        ok = false;
      }
      toast(t(ok ? "set.import.ok" : "set.import.bad"));
      if (ok) render(true);
    });
  }
});

let searchTimer = null;
document.addEventListener("input", (e) => {
  if (e.target.id !== "browse-search") return;
  ui.browse.term = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderBrowseList, 150);
});

// Keyboard shortcuts for desktop: 1–4 answer, Enter continues.
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = S.session;
  if (ui.tab !== "learn" || !s) return;
  const order = s.order || [0, 1, 2, 3];
  if (/^[1-4]$/.test(e.key) && !s.answered) {
    e.preventDefault();
    answerLearn(order[+e.key - 1]);
  } else if (e.key === "Enter" && s.answered && !e.target.matches("button")) {
    e.preventDefault();
    nextCard();
  }
});

window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (swReg) swReg.update().catch(() => {});
  if (S.settings.onboarded && !(ui.tab === "test" && S.test && ui.testView === "run")) render();
});

/* ---------------- service worker ---------------- */

function showUpdate() {
  const el = $("#update");
  el.innerHTML = `<span>${t("update.text")}</span><button type="button" class="btn small primary" data-act="update-reload">${t("update.reload")}</button>`;
  el.hidden = false;
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloading) {
      reloading = true;
      location.reload();
    }
  });
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w &&
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) showUpdate();
          });
      });
    })
    .catch(() => {});
}

/* ---------------- boot ---------------- */

async function boot() {
  applyLangClasses();
  try {
    const res = await fetch("data/questions.json");
    if (!res.ok) throw new Error(res.status);
    DATA = await res.json();
  } catch {
    $("#view").innerHTML = `<p class="empty">${t("error.load")}</p>`;
    return;
  }
  for (const q of DATA.general) BY_ID.set(q.id, q);
  for (const [code, st] of Object.entries(DATA.states))
    for (const q of st.questions) {
      q.st = code;
      BY_ID.set(q.id, q);
    }
  if (!DATA.states[S.settings.state]) S.settings.state = "BY";
  loadHints(S.settings.lang);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  route();
  registerSW();
}

boot();
