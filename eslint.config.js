import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["build/", "dist/", "node_modules/", ".venv/"] },
  js.configs.recommended,
  { files: ["app/js/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: ["app/sw.template.js"],
    // __ASSETS__ is replaced with the precache list by tools/build_app.py
    languageOptions: { globals: { ...globals.serviceworker, __ASSETS__: "readonly" } },
  },
  { files: ["tools/**/*.mjs", "*.js"], languageOptions: { globals: globals.node } },
];
