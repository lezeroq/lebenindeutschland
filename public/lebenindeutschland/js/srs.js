// Spaced repetition: a small Leitner scheme with day-based intervals.
//
// Levels: 0 = new, 1 = answered wrong (due again right away), 2–4 = learning, 5 = learned.
// A correct answer moves a question up one level (a new or just-missed question goes straight to 2)
// and schedules it 1, 2 or 4 days later. The fourth correct answer in a row makes it learned.
// Any wrong answer drops it back to level 1.

export const LEARNED = 5;
const WAIT_DAYS = { 2: 1, 3: 2, 4: 4 };

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts, n) {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function grade(prev, correct, now) {
  const p = Object.assign({ l: 0, c: 0, w: 0 }, prev);
  if (correct) {
    p.c += 1;
    p.l = p.l <= 1 ? 2 : p.l + 1;
    if (p.l >= LEARNED) {
      p.l = LEARNED;
      p.d = 0;
      p.L = now;
    } else {
      p.d = addDays(now, WAIT_DAYS[p.l]);
    }
  } else {
    p.w += 1;
    p.l = 1;
    p.d = now;
    delete p.L;
  }
  p.t = now;
  return p;
}

export function markLearned(prev, now) {
  return Object.assign({ c: 0, w: 0 }, prev, { l: LEARNED, d: 0, L: now, t: now });
}

export function backToLearning(prev, now) {
  const p = Object.assign({ c: 0, w: 0 }, prev, { l: 1, d: now, t: now });
  delete p.L;
  return p;
}

// Correct answers collected towards "learned" (0–4), for the progress dots.
export function steps(p) {
  if (!p || !p.l) return 0;
  return p.l >= LEARNED ? 4 : p.l - 1;
}
