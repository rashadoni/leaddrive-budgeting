/**
 * ESLint flat config (2026-06-03) — restores a working `npm run lint` under
 * Next 16, which REMOVED the `next lint` command (the old `lint` script just
 * errored "Invalid project directory: .../lint"). Uses the canonical
 * `eslint-config-next` flat config (core-web-vitals + typescript + next plugin).
 *
 * eslint-version note: pinned eslint to ^9 (was ^10) — eslint-config-next@16's
 * bundled plugins (eslint-plugin-react / react-hooks) call eslint-9 APIs removed
 * in eslint 10 (`context.getFilename`, `scopeManager.addGlobals`) and crash on
 * 10. `settings.react.version` is pinned to skip the version auto-detection path.
 *
 * Backlog note: this codebase ran for a long time with NO working lint, so
 * eslint-config-next's strictest rules (the new react-compiler hooks lints +
 * unescaped-entities) flag a large pre-existing backlog. To make `npm run lint`
 * GREEN + usable now, those are dialled to "warn" (surfaced, non-blocking) by
 * injecting the override into next's OWN config objects — the only place the
 * plugins are in scope (a separate rules-only object errors "plugin not
 * defined" in flat config). `react-hooks/rules-of-hooks` is deliberately KEPT
 * at error (real-bug guard); the one known-safe violation carries an inline
 * justified disable. Tighten the warns to errors incrementally.
 */
import next from "eslint-config-next";

// Pre-existing-backlog rules → warn (not blocking). Only applied where the rule
// is already configured (so the owning plugin is guaranteed in scope).
const DOWNGRADE_TO_WARN = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/static-components": "warn",
  "react-hooks/immutability": "warn",
  "react/no-unescaped-entities": "warn",
};

const tuned = next.map((cfg) => {
  if (!cfg || !cfg.rules) return cfg;
  const rules = { ...cfg.rules };
  for (const [rule, level] of Object.entries(DOWNGRADE_TO_WARN)) {
    if (rule in rules) rules[rule] = level;
  }
  return { ...cfg, rules };
});

export default [
  {
    ignores: [
      "**/.next/**", // any depth — incl. .claude/worktrees/*/.next build output
      ".claude/**", // git worktrees + session artifacts (not project source)
      "out/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "**/*.snap",
      "public/**",
    ],
  },
  ...tuned,
  {
    // Skip eslint-plugin-react's eslint-version-sensitive auto-detection.
    settings: { react: { version: "19" } },
  },
];
