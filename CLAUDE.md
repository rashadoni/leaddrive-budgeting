# BudgetPro — Claude Context

## Roadmap (ALWAYS READ FIRST)

**Before starting any refactoring, feature, or architectural work — read `docs/ROADMAP.md`.**

It contains all phases (0-6) Security → Scale, per-task status (⬜ Todo / 🟡 In progress / ✅ Done), and the completion changelog.

When completing a task:
1. Update its status in `docs/ROADMAP.md`
2. Append to the Changelog section at the bottom with date + brief note
3. If the change reveals new issues, add them to the appropriate phase

## Project Overview

- **Stack:** Next.js 16 + Prisma + PostgreSQL, port 3000
- **Dev server:** runs via LaunchAgent (`~/Library/LaunchAgents/com.budgetpro.dev.plist`)
  - Restart: `launchctl kickstart -k gui/501/com.budgetpro.dev`
  - Logs: `~/Library/Logs/budgetpro.log`
- **Current state:** Transforming from AAC-specific prototype into Enterprise Holding Risk Terminal. Not yet multi-tenant SaaS — org isolation is enforced at the application layer, no RLS.

## Workflow

- Solo flow: main Claude writes code and runs `npx tsc --noEmit` / `npx vitest run` before committing; user (Rashad) owns ship/cut decisions and supplies Excel data + business rules.
- Pre-commit hook (`.githooks/pre-commit`) runs the M7 status-band scanner + secret scanner. Activate once per clone with `git config core.hooksPath .githooks`; bypass with `git commit --no-verify`.
- **Merge PRs with `gh pr merge --merge`. Squash and rebase merging are DISABLED on the repo (2026-08-03) and this is why.** Work happens on one long-lived branch (`claude/import-lineage`). A squash or rebase merge rewrites the commit onto main under a new SHA, so the branch's own commits stop being ancestors of main — GitHub then reports the next PR as CONFLICTING, CI never starts, and the fix is a `git rebase --onto origin/main <old-base>` every single time. That happened four times in one session, costing a CI cycle each. A merge commit keeps the branch an ancestor, so the next PR opens clean with no rebase. Squash also discards the per-commit messages, which in this repo are the same evidence the ROADMAP changelog carries. To undo: `gh api -X PATCH repos/rashadrahimov/leaddrive-budgeting -F allow_squash_merge=true -F allow_rebase_merge=true`.
- Subagents (architect / Explore / Plan) are on-demand only — invoke when the user asks or for high-risk work (RLS rollout, auth/security additions, schema migrations, new API routes, LLM integration). Not part of the default turn flow.
- End each turn by announcing the next step as a fact, not a question.

## Phase 7: Enterprise Holding Risk Terminal (ACTIVE)

Full scope + per-task status live in `docs/ROADMAP.md` — read that for the current picture, not this file. High-level snapshot:

- **Foundation + formula engine + recompute pipeline — feature-complete.** 11 resolvers in `src/lib/risk/recompute.ts` (booking, companySettings, operationalFact, newsSentiment, currencyRate, budgetLine, fact, rollup, industryFactor, weather, commodityPrice); cross-period composites via `fact()`/`rollup()`; 12-slot sparklines; async fan-out in `POST /api/indicators` at `SYNC_THRESHOLD=50`.
- **Truth infrastructure — feature-complete.** Audit + drift-watchdog + freshness dashboard + period locks (pure helpers in `src/lib/audit/`).
- **Onboarding (7.B) — partial.** Done: Excel company bulk-import (secured), 10 CoA templates, AI Auto Import (any xlsx → AI classifier → bit-perfect pipeline; single- and multi-file with group-atomicity + cross-file conflict detection; adapters under `src/lib/onboarding/adapters/` + `ai-import/`). Missing: ~60-company wire-up. **The onboarding wizard UI was DELETED, not left unbuilt** (`674c851e` — "delete unreachable onboarding wizard + AI-mapper routes"); AI Auto Import replaced it. Wording it as "missing" kept sending sessions to rebuild something that was removed on purpose.
- **AI suite (7.E) — v1 shipped:** Web Crawler, Variance Explainer, Predictive Analytics, Board Deck Generator.
- **riskTags + Compliance/Legal indicators — live** (composite-score penalties via `RISK_TAG_PENALTY_TABLE`; audit findings + court cases in `Company.settings`).
- **In-app user guide at `/guide`** (EN/RU/AZ; `docs/USER_GUIDE.<lang>.md`, sticky TOC, per-language checklist, print-to-PDF).

### Key files

- `prisma/schema.prisma` — full DB schema (1100+ lines)
- `src/lib/risk/` — formula engine, recompute pipeline, threshold classifier
- `src/lib/onboarding/` — companies-import pure helpers, CoA templates, AI-import adapters
- `src/features/terminal/` — terminal page, store, CompanyTree, HeatMap, CommandBar
- `src/app/api/companies/`, `src/app/api/indicators/`, `src/app/api/scenarios/`, `src/app/api/indicators/matrix/`, `src/app/api/onboarding/import/companies/`
- `scripts/seed-industries.ts`, `scripts/seed-indicators.ts`

### Important Notes

- `expr-eval`, `vitest`, `xlsx`, `zustand`, `lucide-react` all installed.
- `terminalStore.ts` uses a hand-rolled reactive mock (module-level actions singleton for referential stability). Swapping to real zustand is optional, not scheduled.
- Terminal page URL: `/budgeting/terminal` (auth-gated). `(dashboard)` is a route group in App Router.

## Key architectural debts (short version — full list in ROADMAP)

1. ~~`BudgetLine.category` / `department` fuzzy semantics~~ — **closed Phase 2.1**. `accountId` NOT NULL FK to ChartOfAccount across BudgetLine/CashFlowEntry/COGSBudgetLine/BalanceSheetLine. `looksLikeCode` kept for BudgetActual aggregation (no FK migration yet — potential Phase 2.4+).
2. ~~`budgeting/page.tsx` is 5000+ lines~~ — **closed Phase 3.1** (now 332 LOC; tabs in `src/features/budgeting/components/`).
3. ~~Import has hardcoded AZ strings + AAC product codes~~ — **closed Phase 2.3** (AZMADE/AAC legacy removed). Replaced by AI Auto Import. Org-specific keyword mappings deferred to 2nd-customer onboarding.
4. ~~No audit log, soft-delete, period locking~~ — shipped Phase 4 (+ soft-delete Phase 1.4 with daily physical-purge cron).
5. Pre-existing TypeScript errors — closed Phase 1.3; CI now enforces `tsc --noEmit` on every push.

## Safe operations

- Dev server is managed by LaunchAgent — do NOT `npm run dev` manually, it conflicts with port 3000.
- **Re-import does NOT require a Reset, and a Reset is destructive — prefer re-importing.** (Corrected 2026-07-31; the old line here said the opposite and nearly cost a production dataset.) Every import batch clean-slates exactly what it is about to write: the archive scope is derived from the rows being inserted — `planId in planIds` × `footprintCompanyIds` × the plan year (`src/lib/onboarding/import-batch.ts:217-260`, tripwire in `src/lib/onboarding/collateral-guard.ts`). That scoping exists because of the 2026-06-11 incident where an actuals import archived 2700 sibling budget lines. So a plain re-import fully replaces a year for the companies in the file, and creates a missing year from nothing (`resolveImportPlan` makes the plan).
  A Reset, by contrast, hard-deletes things no workbook can restore: the 14 `Company.settings` keys (audit findings incl. Compliance Hub close/assign/comment write-backs, court disputes, risk register, land parcels, capex, strategic descriptions), **all** `BudgetActual` for the company+year with no provenance filter (unlike `OperationalFact`, which is filtered), org-wide `SalesForecast`, and everything on the holding-level company. Reset only with a year scope, never blank-year, and `pg_dump` `companies`, `budget_actuals`, `sales_forecasts` first.
- **Import one year per request.** `src/app/api/import/ai-auto-multi/route.ts` takes `const year = importYears[0]` for three safety checks — period lock, stale-sibling detection, backlog diff — so on a `2025,2026` run none of them see 2026. Two sequential single-year calls restore all three, and keep each run under the 300s nginx proxy timeout.
- Always run a preview (`apply=0`) before applying. Gates A/B/C run in preview too, so a preview surfaces `BLOCKED:` reasons before anything is written.
- Prisma migrations: `npx prisma migrate dev --name <name>` (no `--skip-seed` — removed in Prisma 7 CLI; incremental migrate doesn't trigger seed anyway). Must run with the LOCAL prisma 6.19.3 (`node_modules` present) — a bare global `npx prisma` may resolve to Prisma 7, which rejects this schema's `url = env(...)` datasource style.
- Type checking: `npx tsc --noEmit` — there are pre-existing errors (Phase 1.3), don't panic.
- **The visual gate runs on the MAC ONLY — proven 2026-08-02, do not burn another session on this.** Playwright names snapshots per platform, and this repo's committed baselines are `*-chromium-darwin.png`. On the Linux dev box a run looks for `*-chromium-linux.png`, finds nothing, and either fails as "snapshot missing" or — with `--update-snapshots` — silently writes a NEW Linux baseline that is compared against nothing. That is a green tick proving nothing, which is worse than the red. Committing one would also leave two baselines drifting independently, since macOS and Linux font rasterisation differ (which is why Playwright separates them at all). Verified with a throwaway probe spec rather than inferred: Playwright reported `Expected: …/probe-1-chromium-linux.png`. The missing `E2E_ADMIN_PASSWORD`, database and dev server on that box are all surmountable; this is not. CI does not run it either — the workflow is secret-scan / tsc / RLS gates / M7 / vitest / next build, all Linux. **So a layout-touching commit made from the Linux box ships with the gate unrun, and the commit message must say so.**
- **Layout-touching commits MUST run the visual gate:** any change to `src/features/terminal/components/HeatMap.tsx`, `CompanyTree.tsx`, `PanelGrid.tsx`, any `*.module.css` inside `src/features/terminal/`, `src/app/globals.css`, or `tailwind.config.ts` requires `npm run test:e2e -- visual-baseline` before commit. Snapshot drift = baseline regenerate (`npm run test:e2e -- --update-snapshots`) **+** include diff'd PNGs in the commit **+** commit-message line `BASELINE UPDATE: <reason>`. See `.claude/memory/feedback_visual_verification_gate.md`.
- **NEVER claim a screenshot shows something without concrete evidence.** Do not assert «вот, X виден» unless you can point to the exact pixel/glyph/coordinate. If unsure: zoom tighter, cross-check the accessibility tree via `find` (titles/aria-labels survive), or say «не вижу — проверю иначе». When a marker reads ambiguously, make the rendering more visible rather than claiming it's already visible. See `.claude/memory/feedback_no_screenshot_lies.md`.
