// End-to-end smoke test: drives the built app in headless Chrome at iPhone size.
// Usage: node tools/e2e.mjs [base-url] [screenshot-dir]   (or `make e2e`, which serves dist/ first)
// Set CHROME to the browser binary if it is not /usr/bin/google-chrome.
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8787/lebenindeutschland/";
const OUT = process.argv[3] || "build/e2e";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
fs.mkdirSync(OUT, { recursive: true });

const data = await (await fetch(new URL("data/questions.json", BASE))).json();
const answer = new Map();
for (const q of data.general) answer.set(q.id, q.a);
for (const st of Object.values(data.states)) for (const q of st.questions) answer.set(q.id, q.a);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push("console: " + m.text());
});
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("requestfailed", (r) => problems.push("requestfailed: " + r.url()));

let n = 0;
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 150));
  await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png` });
};
// The About block is below the fold, so it gets a screenshot of its own.
const shotAbout = async (name) => {
  const el = await page.waitForSelector(".about", { visible: true });
  await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await new Promise((r) => setTimeout(r, 150));
  await el.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png` });
};
const click = async (sel) => {
  await page.waitForSelector(sel, { visible: true, timeout: 5000 });
  await page.$eval(sel, (el) => el.click());
  await new Promise((r) => setTimeout(r, 60));
};
process.on("unhandledRejection", async (e) => {
  console.log("FAILED:", e.message);
  try {
    await page.screenshot({ path: `${OUT}/zz-failure.png` });
  } catch {
    /* no page left to capture */
  }
  console.log(problems.join("\n"));
  process.exit(1);
});
const text = (sel) => page.$eval(sel, (el) => el.textContent.trim());
const check = (cond, msg) => {
  if (!cond) problems.push("check failed: " + msg);
  else console.log("ok  " + msg);
};

await page.goto(BASE, { waitUntil: "networkidle0" });
await page.waitForSelector(".onb");
await page.evaluate(() => (globalThis.firstLoad = true));
await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 10000 });
await new Promise((r) => setTimeout(r, 500));
check(
  await page.evaluate(() => globalThis.firstLoad === true),
  "first visit does not reload when the service worker takes over",
);
await shot("onboarding-de");
await click('[data-act="set-lang"][data-lang="en"]');
await page.select("#set-state", "BY");
await shot("onboarding-en");
await click('[data-act="onb-start"]');
await page.waitForSelector(".progress-card");
await shot("learn-home");
check((await text(".big-num")).includes("310"), "Bayern pool has 310 questions");

// ---- learning session: answer the first card right, the second wrong, then everything right
await click('[data-act="start-session"]');
let step = 0,
  wrongDone = false;
while ((await page.$('[data-act="answer-learn"]')) || (await page.$('[data-act="next-card"]:not([disabled])'))) {
  if (await page.$('[data-act="answer-learn"]')) {
    const id = await page.$eval(".qcard", (el) => el.dataset.id);
    const a = answer.get(id);
    const pick = step === 1 && !wrongDone ? (a + 1) % 4 : a;
    if (step === 0) await shot("session-question");
    await click(`[data-act="answer-learn"][data-i="${pick}"]`);
    if (step === 0) await shot("session-correct");
    if (pick !== a) {
      wrongDone = true;
      await shot("session-wrong");
    }
    step++;
  }
  await click('[data-act="next-card"]');
  if (step > 60) {
    problems.push("session did not end");
    break;
  }
}
await page.waitForSelector(".summary-card");
await shot("session-summary");
check(step === 21, `session took ${step} answers (20 cards + 1 repeat)`);

await click('[data-act="list-back"]');
await page.waitForSelector(".progress-card");
await shot("learn-home-after");
const learningCount = await page.$eval('[data-list="learning"] b', (el) => +el.textContent);
check(learningCount === 20, `20 questions in progress (got ${learningCount})`);

// mark one as learned, then move it back
await click('[data-act="open-list"][data-list="learning"]');
await shot("list-learning");
await click('[data-act="mark-learned"]');
await click('[data-act="list-back"]');
await click('[data-act="open-list"][data-list="learned"]');
check((await page.$$(".lrow")).length === 1, "learned list has the marked question");
await shot("list-learned");
await click('[data-act="move-back"]');
check((await page.$$(".lrow")).length === 0, "move back empties the learned list");
await click('[data-act="list-back"]');

// ---- tests
await click('[data-act="go"][data-tab="test"]');
await page.waitForSelector(".modes");
await shot("test-home-empty");
await click('[data-act="test-start"][data-type="quick"]');
for (let i = 0; i < 10; i++) {
  const id = await page.$eval(".qcard", (el) => el.dataset.id);
  const a = answer.get(id);
  if (i === 0) await shot("quick-question");
  await click(`[data-act="pick-test"][data-i="${i < 7 ? a : (a + 1) % 4}"]`);
  await new Promise((r) => setTimeout(r, 400));
}
await click('[data-act="test-finish"]');
await page.waitForSelector(".result-card");
await shot("quick-result");
check((await text(".score b")) === "7", "quick test scored 7/10");

await click('[data-act="review-back"]');
await click('[data-act="test-start"][data-type="exam"]');
await page.waitForSelector("#timer");
await new Promise((r) => setTimeout(r, 1200));
check(
  /^5\d:\d\d$|^60:00$/.test(await text("#timer")),
  "exam timer counts down from 60:00 (" + (await text("#timer")) + ")",
);
for (let i = 0; i < 20; i++) {
  const id = await page.$eval(".qcard", (el) => el.dataset.id);
  await click(`[data-act="pick-test"][data-i="${answer.get(id)}"]`);
  await new Promise((r) => setTimeout(r, 400));
}
await shot("exam-running");
await click('[data-act="test-exit"]');
await shot("exam-exit");
await click('[data-act="test-later"]');
await page.waitForSelector(".resume");
await click('[data-act="test-resume"]');
await click('[data-act="test-finish"]');
await page.waitForSelector(".confirm");
await shot("exam-confirm");
await click('[data-act="test-finish-now"]');
await page.waitForSelector(".result-card");
await shot("exam-result");
check((await text(".score b")) === "20", "exam scored 20/33 with 13 unanswered");
check(!(await text(".result-card")).includes("back to learning"), "unanswered exam questions stay out of learning");
await click('[data-act="review-back"]');
await page.waitForSelector(".chart");
await shot("test-home-history");
check((await page.$$(".hrow")).length === 2, "history has 2 tests");

// ---- browse
await click('[data-act="go"][data-tab="browse"]');
await page.waitForSelector("#browse-list .qcard");
check((await page.$$("#browse-list .qcard")).length === 310, "browse shows 310 questions");
await page.click("#browse-answers");
await new Promise((r) => setTimeout(r, 100));
const firstId = await page.$eval("#browse-list .qcard", (el) => el.dataset.id);
await click(`#browse-list .qcard[data-id="${firstId}"] [data-i="0"]`);
await shot("browse-reveal");
await page.type("#browse-search", "Grundgesetz");
await new Promise((r) => setTimeout(r, 400));
const hits = (await page.$$("#browse-list .qcard")).length;
check(hits > 5 && hits < 60, `search “Grundgesetz” finds ${hits} questions`);
await page.$eval("#browse-search", (el) => {
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
await click('[data-act="browse-filter"][data-f="state"]');
check((await page.$$("#browse-list .qcard")).length === 10, "state filter shows the 10 Bayern questions");

// ---- settings: Russian with hints
await click('[data-act="go"][data-tab="settings"]');
await shot("settings-en");
await shotAbout("about-en");
const about = await text(".about");
check(about.includes("as of May 7, 2025"), "About shows the catalogue date in English");
check(about.includes("questions 55, 70, 181, 216, 235 from Annex 1"), "About lists the Anlage 1 photos");
await click('[data-act="set-lang"][data-lang="ru"]');
await new Promise((r) => setTimeout(r, 500));
await shotAbout("about-ru");
await click('[data-act="go"][data-tab="browse"]');
await page.$eval("#browse-search", (el) => {
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await click('[data-act="browse-filter"][data-f="state"]');
await new Promise((r) => setTimeout(r, 300));
await shot("browse-ru-hints-state");
check(await page.$eval("body", (b) => b.classList.contains("hints")), "RU hints are on");
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
await click('[data-act="go"][data-tab="learn"]');
await shot("learn-home-dark-ru");
await click('[data-act="go"][data-tab="settings"]');
await shotAbout("about-ru-dark");
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await click('[data-act="set-lang"][data-lang="de"]');
await new Promise((r) => setTimeout(r, 500));
await shotAbout("about-de");
await click('[data-act="go"][data-tab="learn"]');

// ---- persistence, then offline start from the service worker cache
await page.reload({ waitUntil: "networkidle0" });
await page.waitForSelector(".progress-card");
check((await page.$$(".onb")).length === 0, "reload keeps onboarding done");
const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker.ready).active);
check(swReady, "service worker active");
await new Promise((r) => setTimeout(r, 1500));
await page.setOfflineMode(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".progress-card", { timeout: 8000 });
await click('[data-act="go"][data-tab="browse"]');
await page.waitForSelector("#browse-list .qcard img, #browse-list .qcard");
check(true, "app starts offline");
await page.setOfflineMode(false);

await browser.close();
const real = problems.filter((p) => !(p.startsWith("requestfailed") && p.includes("offline")));
console.log(real.length ? "\nPROBLEMS:\n" + real.join("\n") : "\nno problems");
console.log("screenshots in " + OUT);
process.exitCode = real.length ? 1 : 0;
