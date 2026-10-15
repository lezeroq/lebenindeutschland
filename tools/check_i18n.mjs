// Checks the interface languages in app/js/i18n.js: every language in LANGS has a STR block with
// exactly the keys of German, every placeholder of the German text, and (except German) a
// translations/<code>.json file. Also reports translation files for languages not in LANGS.
// Usage: node tools/check_i18n.mjs
import fs from "node:fs";
import { LANGS, STR } from "../app/js/i18n.js";

const problems = [];
const base = STR.de;
const vars = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");

for (const code of Object.keys(LANGS)) {
  const str = STR[code];
  if (!str) {
    problems.push(`${code}: in LANGS but no STR block`);
    continue;
  }
  for (const key of Object.keys(base)) {
    if (!(key in str)) problems.push(`${code}: missing "${key}"`);
    else if (vars(str[key]) !== vars(base[key])) problems.push(`${code}: "${key}" placeholders differ from de`);
  }
  for (const key of Object.keys(str)) if (!(key in base)) problems.push(`${code}: "${key}" is not a German key`);
  if (code !== "de" && !fs.existsSync(`translations/${code}.json`))
    problems.push(`${code}: no translations/${code}.json`);
}
for (const code of Object.keys(STR)) if (!LANGS[code]) problems.push(`${code}: STR block but not in LANGS`);
for (const file of fs.readdirSync("translations")) {
  const code = file.replace(/\.json$/, "");
  if (!LANGS[code]) problems.push(`translations/${file}: language "${code}" is not in LANGS`);
}

console.log(`interface languages: ${Object.keys(LANGS).join(", ")}`);
if (problems.length) {
  console.log(`${problems.length} PROBLEM(S):\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else console.log("OK");
