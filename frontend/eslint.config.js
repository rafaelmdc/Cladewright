// Flat ESLint config for the Vite + React + TypeScript SPA. Type-checking is handled
// separately by `tsc --noEmit` (see the `lint` npm script); ESLint here catches the
// lint-class issues tsc doesn't — unused vars, bad hook deps, non-HMR-safe exports.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // The two time-tested hooks rules. rules-of-hooks is a correctness gate (error);
      // exhaustive-deps is advisory (warn). The plugin's newer strict rules (refs,
      // set-state-in-effect, immutability) flag legitimate gameplay patterns in Marathon,
      // so we don't adopt the full recommended set — revisit per-rule if desired.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Allow intentionally-unused args prefixed with _ (event handlers, etc.).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
