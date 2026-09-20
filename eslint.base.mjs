import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Shared rule set for the Node workspaces (backend, engine, shared).
// Frontend has its own config (browser globals + react plugins).
export const nodeWorkspaceRules = {
  // TypeScript specific rules
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
  "@typescript-eslint/explicit-function-return-type": "off",
  "@typescript-eslint/explicit-module-boundary-types": "off",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "warn",

  // General rules
  "no-console": "warn",
  "prefer-const": "error",
  "no-var": "error",
  "object-shorthand": "error",
  "prefer-arrow-callback": "error",
  "prefer-template": "error",

  // Node.js specific
  "no-process-exit": "warn",
  "handle-callback-err": "error",
};

export function nodeWorkspaceConfig({ ts = true } = {}) {
  return {
    extends: [
      js.configs.recommended,
      ...(ts ? tseslint.configs.recommended : []),
    ],
    files: [ts ? "**/*.{ts,js}" : "**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: nodeWorkspaceRules,
  };
}
