import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Every outbound request to flightlog.org must go through gatedFetch (see
    // src/lib/flightlog/outbound-gate.ts) so it's bounded by the request gate — a bare
    // fetch() here would bypass concurrency, spacing, and the timeout entirely.
    files: ["src/lib/flightlog/http.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Use gatedFetch from ./outbound-gate instead of a bare fetch() — see outbound-gate.ts's doc comment.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not an eslint-config-next default: a leftover review worktree under .claude/worktrees/**
    // carries a full duplicate copy of this repo, node_modules included — a plain `pnpm run
    // lint` would otherwise walk it and report failures that have nothing to do with the
    // working tree.
    ".claude/**",
  ]),
]);

export default eslintConfig;
