// ESLint flat config for the whole monorepo (web + relay + scripts).
// Run with `pnpm lint` from the root.
//
// Deliberately NOT type-checked (typescript-eslint "recommended", not
// "recommended-type-checked"), so linting stays fast and needs no tsconfig wiring.
//
// The block marked "TODO(lint)" at the bottom downgrades rules to "warn" because they
// fired on the existing code when ESLint was introduced. They are real findings to work
// through, not accepted style: promote each back to "error" once its warnings are gone.
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default defineConfig(
  {
    ignores: ["**/dist/**", "**/dist-share/**", "**/.wrangler/**", "**/node_modules/**", "docs/**"],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    rules: {
      // `interface Env extends Cloudflare.Env {}` is the standard Workers typing pattern.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
    },
  },

  // Web app: browser globals, React hooks and accessibility rules.
  {
    files: ["web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
  {
    files: ["web/src/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },

  // Relay: Workers runtime. Project rule: the relay never logs anything.
  {
    files: ["relay/src/**/*.ts"],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: { "no-console": "error" },
  },

  // Node scripts and config files. Console output is how these report.
  {
    files: ["scripts/**/*.{js,mjs}", "web/scripts/**/*.{js,mjs}", "web/*.{mjs,ts}", "relay/*.ts", "*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // The browser scripts (e2e, history-check) pass callbacks to page.evaluate(), which run in the browser.
    files: ["scripts/e2e-*.mjs", "scripts/history-check.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // TODO(lint): downgraded to "warn" when ESLint was introduced; see the comment at the top.
  {
    rules: {
      "prefer-const": "warn",
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    files: ["web/src/**/*.tsx"],
    rules: {
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-autofocus": "warn",
    },
  },
);
