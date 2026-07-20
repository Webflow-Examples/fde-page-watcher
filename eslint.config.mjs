import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / vendored output anywhere in the tree — including nested git
    // worktrees under .claude/worktrees, whose built .next files otherwise
    // flood `npm run lint` with thousands of findings from outside src.
    "**/.next/**",
    "**/node_modules/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
