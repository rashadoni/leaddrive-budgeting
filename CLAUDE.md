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
- Subagents (architect / Explore / Plan) are on-demand only — invoke when the user asks or for high-risk work (RLS rollout, auth/security additions, schema migrations, new API routes, LLM integration). Not part of the default turn flow.
- End each turn by announcing the next step as a fact, not a question.

## Phase 7: Enterprise Holding Risk Terminal (ACTIVE)

Full scope + per-task status live in `docs/ROADMAP.md` — read that for the current picture, not this file. High-level snapshot:

- **Foundation + formula engine + recompute pipeline — feature-complete.** 11 resolvers in `src/lib/risk/recompute.ts` (booking, companySettings, operationalFact, newsSentiment, currencyRate, budgetLine, fact, rollup, industryFactor, weather, commodityPrice); cross-period composites via `fact()`/`rollup()`; 12-slot sparklines; async fan-out in `POST /api/indicators` at `SYNC_THRESHOLD=50`.
- **Truth infrastructure — feature-complete.** Audit + drift-watchdog + freshness dashboard + period locks (pure helpers in `src/lib/audit/`).
- **Onboarding (7.B) — partial.** Done: Excel company bulk-import (secured), 10 CoA templates, AI Auto Import (any xlsx → AI classifier → bit-perfect pipeline; single- and multi-file with group-atomicity + cross-file conflict detection; adapters under `src/lib/onboarding/adapters/` + `ai-import/`). Missing: onboarding wizard UI, ~60-company wire-up.
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
- Re-import of Excel requires Reset first (no incremental re-import yet — Phase 2.4 goal).
- Prisma migrations: `npx prisma migrate dev --name <name> --skip-seed` works reliably.
- Type checking: `npx tsc --noEmit` — there are pre-existing errors (Phase 1.3), don't panic.
- **Layout-touching commits MUST run the visual gate:** any change to `src/features/terminal/components/HeatMap.tsx`, `CompanyTree.tsx`, `PanelGrid.tsx`, any `*.module.css` inside `src/features/terminal/`, `src/app/globals.css`, or `tailwind.config.ts` requires `npm run test:e2e -- visual-baseline` before commit. Snapshot drift = baseline regenerate (`npm run test:e2e -- --update-snapshots`) **+** include diff'd PNGs in the commit **+** commit-message line `BASELINE UPDATE: <reason>`. See `.claude/memory/feedback_visual_verification_gate.md`.
- **NEVER claim a screenshot shows something without concrete evidence.** Do not assert «вот, X виден» unless you can point to the exact pixel/glyph/coordinate. If unsure: zoom tighter, cross-check the accessibility tree via `find` (titles/aria-labels survive), or say «не вижу — проверю иначе». When a marker reads ambiguously, make the rendering more visible rather than claiming it's already visible. See `.claude/memory/feedback_no_screenshot_lies.md`.
