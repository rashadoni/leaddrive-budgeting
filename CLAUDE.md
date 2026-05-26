# BudgetPro — Claude Context

## Roadmap (ALWAYS READ FIRST)

**Before starting any refactoring, feature, or architectural work — read `docs/ROADMAP.md`.**

It contains:
- All phases (0-6) from Security → Scale
- Current status per task (⬜ Todo / 🟡 In progress / ✅ Done)
- Completion changelog
- Rationale for each phase based on 2026-04-21 audit

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

## Roles & workflow (read before acting)

Two roles operate on this codebase by default; subagents are available
on-demand only.

| Role | Identity | Tools | Does | Does NOT |
|---|---|---|---|---|
| **User** | Human (Rashad) | N/A | Strategic scope, ship/cut decisions, real-world context (Excel data, business rules), approves deferrals | Write code |
| **Developer** | Main Claude in the session | Full (Read/Write/Edit/Bash/...) | Writes code, runs tests/tsc/migrations, makes tactical architecture calls autonomously, announces next step, never votes | Decide ship/cut unilaterally; silently defer promised work |

**Subagents (on-demand only — Phase 7.G Turn LXXXVII per user «убери всех агентов»):**
- `architect` / `Explore` / `Plan` / `general-purpose` are NOT invoked in default turn flow
- Invoke ONLY when user explicitly requests OR when the work falls in a
  high-risk class (see `memory/feedback_no_agents.md`):
  - Phase 5.2 RLS rollout (cross-tenant leak silent killer)
  - Phase 4.x security additions (auth bypass)
  - Schema migrations (especially destructive)
  - New API routes (Zod / auth gate / rate limit consistency)
  - LLM integration (prompt drift / token budgets)
  - `.claude/hooks/**` edits (recursion-style risk)
- Hook files (`architect-gate.sh`, `mark-dirty.sh`, `auto-bootstrap.sh`)
  remain on disk but are UNWIRED from `settings.json`. Re-wire to
  re-enable for a work block.

### Turn flow

1. User gives direction OR developer continues per agreed plan.
2. Developer executes the work directly. No mandatory TurnGoal declaration
   for routine work; declare for novel/multi-day work or when scope is
   ambiguous.
3. Developer runs `npx tsc --noEmit` + `npx vitest run` mid-turn as needed.
   `test-gate.sh` Stop hook still runs `vitest` pre-Stop as safety net.
4. Pre-commit hook runs M7 status-band scanner + secret scanner.
5. Developer commits with descriptive message.
6. **CARRYOVER (`docs/CARRYOVER.md`) is a manual tracker** — file 🔄 rows
   when useful (deferred work, user-action blockers, dev-owned follow-ups).
   No automatic freshness enforcement. Counter-bump (`npm run carryover:bump`)
   is OPTIONAL.
7. Turn ends with developer announcing the next step as a fact, not a
   question (`feedback_decide_next_step.md`).

### How developer invokes subagents (on demand)

```
Agent(subagent_type="architect", description="...", prompt="...")
Agent(subagent_type="Explore", description="...", prompt="...")
Agent(subagent_type="Plan", description="...", prompt="...")
```

Use cases:
- `architect` — security review on Phase 5.2 RLS / Phase 4.x security work, schema migration audit, LLM cost review
- `Explore` — cross-file audit ("where is X used", "find all consumers of Y")
- `Plan` — multi-day feature plan needing architectural design

Default is NO subagent invocation. tsc + vitest + pre-commit M7 +
test-gate are the active safety net.

### Durable protocol files

Persisted in `memory/` and auto-loaded at session start. `memory/MEMORY.md`
is the index — each line is a markdown link pointing at a feedback/project/
reference memory file. A new Claude traverses those links when the topic
comes up (not up-front). If any are missing on a new machine, the developer
must re-read them before continuing Phase 7.

Core protocol files today:

- `feedback_no_agents.md` — **Phase 7.G Turn LXXXVII current default**: subagents not invoked in default flow; risk-class re-enable list
- `feedback_fix_before_build.md` — close review findings before new work (LXXXVII: applies to dev self-review + user feedback; architect-FAIL gate removed)
- `feedback_decide_next_step.md` — don't ask, announce
- `feedback_session_speedup.md` — pacing rules #1-26
- ~~`feedback_architect_scope_audit.md`~~ — DEPRECATED Turn LXXXVII (no auto-architect)
- ~~`feedback_100_percent_closure.md`~~ — DEPRECATED Turn LXXXVII (no Completion Audit)
- ~~`feedback_carryover_enforcement.md`~~ — DEPRECATED Turn LXXXVII (CARRYOVER now manual; check #5 disabled)
- ~~`feedback_single_round_architect.md`~~ — DEPRECATED Turn LXXXVII (architect not invoked at all; rule moot)
- plus product / UX / user-preference memories — enumerated in `MEMORY.md`

### Multi-machine bootstrap

The protocol files live in TWO places:

- **In-repo** (git-tracked, clones with project):
  - `.claude/agents/architect.md`
  - `.claude/hooks/architect-gate.sh` + `mark-dirty.sh` + `bootstrap.sh`
  - `.claude/hooks/tests/architect-gate.test.sh`
  - `.claude/settings.json`
  - `.claude/memory/` — mirror of protocol memory files (source of truth)
  - `docs/CARRYOVER.md`
  - `docs/ROADMAP.md`
  - `CLAUDE.md`

- **User-home** (per-machine, Claude Code auto-loads at session start):
  - `~/.claude/projects/-Users-<user>-Documents-leaddrive-budgeting/memory/*.md`

**On a fresh clone** (new machine or first-time setup), the user-home memory is missing, so protocol auto-memory degrades. To fix:

1. **Automatic** (Claude Code ≥ version supporting `SessionStart` hook): `.claude/hooks/bootstrap.sh` runs on session start, syncs `.claude/memory/` → `~/.claude/projects/<slug>/memory/`. Idempotent.
2. **Manual fallback**: `bash .claude/hooks/bootstrap.sh` once after clone. Takes < 1 second.

Verify the bootstrap succeeded: `ls ~/.claude/projects/*leaddrive-budgeting/memory/` should show all `feedback_*.md` + `project_*.md` + `user_*.md` files listed in `MEMORY.md`.

## Phase 7: Enterprise Holding Risk Terminal (ACTIVE)

Phase 7 scope, progress, and per-task status live in `docs/ROADMAP.md` —
read that for the current picture, not this file. High-level snapshot:

- **Foundation (7.A) — done:** Prisma schema, core API routes, migrations applied.
- **Formula engine + recompute pipeline (7.A.0) — feature-complete.**
  Engine, periods, resolver registry, matrix API, HeatMap + CompanyTree
  components all built and unit-tested. **11 resolvers registered**
  today (recompute.ts:2211): `booking`, `companySettings`, `operationalFact`,
  `newsSentiment`, `currencyRate`, `budgetLine`, `fact` (cross-period
  reads), `rollup` (cross-company sums), `industryFactor`, `weather`,
  `commodityPrice`. Parent-rollup dedup + reconciliation guard on xlsx
  ingest. **Cross-period composites work** via `fact()`/`rollup()`
  formula functions (Phase 7.E phase 3). **Sparklines computed** inline
  on single-IV recomputes (`withSparkline:true`) and batched via
  `scripts/compute-sparklines.ts` — every IV in DB currently carries a
  12-slot trailing sparkline. **Async fan-out** in `POST /api/indicators`:
  `SYNC_THRESHOLD=50` runs in-request, larger batches enqueue to the
  in-process job runner (no 500-pair cap). Background scheduler
  bootstrap: `scripts/intel-scheduler-bootstrap.ts`.
- **Truth infrastructure (Phase D + follow-ups) — feature-complete.**
  Audit-company.cjs + drift-watchdog.cjs + freshness dashboard + period
  locks all shipped. Pure helpers extracted to `src/lib/audit/audit-helpers.cjs`
  and `drift-watchdog-helpers.cjs` (32 vitest cases between them).
  Freshness source list configurable per-org via
  `Organization.settings.intelFreshnessSources`. Trust-status integration
  test locks the matrix → CompanyTree → TrustBadge wire-up. Only
  remaining row in `docs/TRUTH_INFRA_FOLLOWUPS.md` is V1 (DriftDiffPreview
  UI verification via a real xlsx upload — browser-only).
- **Onboarding (7.B) — partial.** Done: Excel bulk-import for companies
  (secured), 10 CoA templates, CLI importer for AZMADE budgets with
  transactional replace + auto-recompute. Missing: per-company
  budget/actual import as an API route (onboarding wizard depends on it),
  onboarding wizard UI, AI Data Mapper (Phase 7.B NEW, blocks
  60-company scale — every new xlsx shape currently requires code),
  ~60-company wire-up (13 seeded, 8 operational today).
- **Phase 7.E AI suite — v1 shipped.** All four capabilities (AI Web
  Crawler, AI Variance Explainer, Predictive Analytics, Board Deck
  Generator) shipped per ROADMAP changelog 2026-05-12. v2 plans
  vendor-gated — `~/.claude/plans/phase-7e-ai-suite-v2.md`.
- **Phase 7.M Tier 3 + Tier 4 — shipped 2026-05-19/20.** Bit-perfect
  AzerSheker workbook ingestion (`Guvven Fin.xlsx` May 19 source) +
  universal AI Auto Import (any xlsx → AI classifier → bit-perfect
  pipeline). **8 new adapters** under `src/lib/onboarding/adapters/`:
  `azseker-workbook-descriptions.ts` (Təsvir),
  `azseker-workbook-capex.ts` (CAPEX_Farm + CAPEX_CPC),
  `azseker-land-registry.ts` (Çıxarışların uçotu),
  `azseker-farming-strategy.ts` (İcmal forward 2026-35), +
  `ai-import/` directory (sheet-meta-extractor, sheet-classifier,
  adapter-registry, universal-reconciler, orchestrator,
  wire-azseker-adapters). **7 admin pages** wired through Sidebar →
  Admin Tools landing (`/budgeting/admin`): import-workbook,
  ai-import, indicator-health, data-archive, companies-readiness +
  existing pages. **Bug fixes**: CUSTOMER_HHI / SUPPLIER_HHI formulas
  (`counterparty_hhi:customer` → `counterparty_hhi_customer` —
  expr-eval doesn't accept `:` in expressions); AZSEKER-PROMALT
  lookup separate from ENTITIES array. **Indicators recovered**: 53 →
  120 OK after: CUSTOMER_HHI/SUPPLIER_HHI fix (+59), news-sentiment
  broadcast (+3), derived drought_index from weather+land (+1),
  FX_IMPORTED_INPUT `fxExposureSource: "all_domestic"` opt-in (+4).
  Live: 4 AZSEKER entities populated bit-perfect (573 P&L + 251 BS +
  309 CF + 409 ops_facts); EDEN carries 22,596 ha land + 111 CAPEX
  + Brix/Pol-ready KPI parser; Org carries forward-forecast 2026-35.
  Verified end-to-end: AI classifier on real workbook 23/23 dataType
  + 14/14 entity correct (cost $0.13/run). **Test infra**: vitest
  testTimeout 5s→30s + retry=2 + testing-library asyncUtilTimeout
  30s for CPU-contention flake stabilization.
- **Phase 7.M Tier 5 — shipped 2026-05-20.** Multi-file AI Import
  with group-level atomicity + cross-file conflict detection,
  end-to-end functional (apply mode writes real data).
  Plan archived: `~/.claude/plans/jazzy-spinning-noodle.md`. **New
  modules**: `ai-import/file-type-detector.ts` (7 file-types),
  `ai-import/conflict-detector.ts` (cell-level cross-file diff),
  `ai-import/multi-file-orchestrator.ts` (parallel meta+classify
  → conflict gate → group-atomic apply → single recompute),
  `ai-import/production-adapter-registry.ts` (770+ LOC — wires
  ALL 11 dataTypes into AdapterRegistry shape; PLF/BS/CF/KPI/SALES
  via `run*Batch(tx, ...)`, soft-data Land/CAPEX/Descriptions/
  ForwardForecast via direct `tx.company.update` / `tx.organization
  .update`; closure caches plan+companies per orchestrator call).
  **Batch fns extended** (import-batch / bs / cf / kpi): accept
  `PrismaClient | Prisma.TransactionClient` for caller-managed
  outer tx — back-compat preserved (detection via `$transaction`
  method presence). **New endpoint**: `POST /api/import/ai-auto-multi`
  — 1-10 files, admin-gated, 3/hour/org rate-limit, 20 MB total
  cap, pre-checked cost budget (N × 35K tokens), 409 with diff
  payload when conflicts found (zero DB writes). **New UI**:
  `MultiFileForm.tsx` + tabs wrapper on `/budgeting/admin/ai-import`
  (toggle "1 файл" / "Несколько файлов"). **Filename hint**:
  classifier system prompt + `buildSheetClassifierUserMessage`
  now accept `filenameHint` as soft prior (e.g. "Farming strategy"
  → forward-forecast). **Apply-order graph**: descriptions →
  main-financial → kpi-only → capex-plan → land-registry →
  forward-forecast (deps respect bedrock data ordering).
  **E2E test**: `scripts/test-multi-file-import-e2e.ts` —
  uploads 3 real Azik files (Guvven Fin / Çıxarışların / Farming
  strategy), validates classifications + conflict-free + 3 groups
  commit + recompute fires + cost <$0.50 + duration <120s.
  **Tests added**: 11 file-type-detector + 10 conflict-detector +
  9 outer-tx (import/bs/cf/kpi) + 9 multi-file-orchestrator +
  11 handler + 9 UI + 9 production-adapter-registry + 1 filename-hint
  = 70 new cases; full suite 5042 passing.
- **Phase 7.N — riskTags wired everywhere + Compliance/Legal indicators live (2026-05-26/27).**
  - **riskTags wiring (commit `4de2bd2`):** `subsidy_dependency`/`non_transparent_structure`/`data_absence` flags now penalize composite-score (−5/−8/−12, max −25, floor 0), thread into AI Morning Brief narrative, AI Variance Explainer system prompt, and Board Deck snapshot. New `RISK_TAG_PENALTY_TABLE` exported from `composite-score.ts`.
  - **Compliance + Legal indicators (commits `d12771e` + `b848f8b`):** 3 pre-existing seeds (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE) finally have data. 218 audit findings + 54 court cases parsed from client xlsx via `scripts/import-audit-findings.mjs` + `scripts/import-court-disputes-detailed.mjs`; `scripts/wire-compliance-indicators.mjs` aliases descriptive metric names → canonical seed-expected names. Live: AZSF 🔴🔴🔴 / CPC 🔴🟡🟡 / EDEN ⚪⚪🟡 visible in HeatMap. Full ledgers stored in `Company.settings.auditFindings` + `courtDisputes` for future drill-down.
- **In-app user guide at `/guide` (multi-language EN/RU/AZ).** 655-line `docs/USER_GUIDE.<lang>.md` with sticky TOC, persistent 51-item checklist (per-language `localStorage` key `guide:checks:<lang>`), 14 embedded screenshots, print-to-PDF, language switcher. Server-side reads markdown at request time. Client viewer uses `useSyncExternalStore` for checklist state (no hydration warnings). Re-translate via `ANTHROPIC_API_KEY=... node scripts/translate-guide.mjs [en|az]` (streaming SDK call, ~$0.15 per lang, ~5-6 min per call). Re-capture screenshots via `node scripts/capture-guide-screenshots.mjs`.

### Key files

- `prisma/schema.prisma` — full DB schema (1100+ lines)
- `src/lib/risk/` — formula engine, recompute pipeline, threshold classifier
- `src/lib/onboarding/` — companies-import pure helpers, CoA templates
- `src/features/terminal/` — terminal page, store, CompanyTree, HeatMap, CommandBar
- `src/app/api/companies/`, `src/app/api/indicators/`, `src/app/api/scenarios/`,
  `src/app/api/indicators/matrix/`, `src/app/api/onboarding/import/companies/`
- `scripts/seed-industries.ts`, `scripts/seed-indicators.ts`

### Important Notes

- `expr-eval`, `vitest`, `xlsx`, `zustand`, `lucide-react` all installed as of
  2026-04-23 (earlier CLAUDE.md note about "npm network issues" is resolved).
- `terminalStore.ts` uses a hand-rolled reactive mock (module-level actions
  singleton for referential stability). A swap to real zustand is an option
  once Phase 7 polish begins — not scheduled in ROADMAP.
- Terminal page URL: `/budgeting/terminal`. Page is auth-gated.
- The `(dashboard)` is a route group in App Router.

## Key architectural debts (short version — full list in ROADMAP)

1. ~~`BudgetLine.category` / `department` fuzzy semantics~~ — **closed 2026-05-26 Phase 2.1**. `category` String dropped from BudgetLine/CashFlowEntry; `accountCode`/`accountName` dropped from COGSBudgetLine/BalanceSheetLine; `accountId` NOT NULL FK to ChartOfAccount across all 4 tables. `looksLikeSapCode`/`looksLikeCostAccount` helpers retired. `looksLikeCode` kept for BudgetActual aggregation (BudgetActual has no FK migration yet — out of 2.1 scope; potential Phase 2.4+ work).
2. ~~`budgeting/page.tsx` is 5000+ lines~~ — **closed 2026-05-11 Phase 3.1** (page.tsx now 332 LOC; all tabs extracted to `src/features/budgeting/components/`).
3. ~~Import has hardcoded Azerbaijani strings + AAC product codes~~ — **closed 2026-05-26 Phase 2.3** (AZMADE/AAC legacy removed: route, UI component, 19 scripts, 3 adapters, ~8.6K LOC deleted). Replacement: AI Auto Import (Phase 7.M Tier 7) handles any xlsx shape via classifier. **Phase 2.2 sub-2** (org-specific keyword mappings in Organization.importConfig) deferred until 2nd-customer onboarding surfaces a real difference.
4. ~~No audit log, no soft-delete, no period locking~~ — all shipped Phase 4 (4.1 audit + 4.2 period locks + 4.3 approvals); soft-delete shipped Phase 1.4 + Phase 7.M Step 4 with daily physical-purge cron (closed 2026-05-26 Phase 1.4).
5. Pre-existing TypeScript errors — Phase 1.3 ✅ closed earlier; CI now enforces `tsc --noEmit` on every push (Phase 0.7 closure 2026-05-26 GitHub Actions workflow).

## Safe operations

- Dev server is managed by LaunchAgent — do NOT `npm run dev` manually, it conflicts with port 3000.
- Re-import of Excel requires Reset first (there's no incremental re-import yet — Phase 2.4 goal).
- Prisma migrations: `npx prisma migrate dev --name <name> --skip-seed` works reliably.
- Type checking: `npx tsc --noEmit` — there are pre-existing errors (see Phase 1.3), don't panic.
- **Pre-commit hook (M7 regression gate):** `.githooks/pre-commit` runs the M7 status-band-shape scanner (~150ms) and aborts commits that would regress color-blind-safe shape coding. Activate once per clone with `git config core.hooksPath .githooks`. Bypass in emergencies with `git commit --no-verify`. The scanner also runs in the Stop-hook test gate, so missing pre-commit activation only affects mid-turn commits.
- **Layout-touching commits MUST run the visual gate:** any change to `src/features/terminal/components/HeatMap.tsx`, `CompanyTree.tsx`, `PanelGrid.tsx`, any `*.module.css` inside `src/features/terminal/`, `src/app/globals.css`, or `tailwind.config.ts` requires `npm run test:e2e -- visual-baseline` before commit. Snapshot drift = baseline regenerate (`npm run test:e2e -- --update-snapshots`) **+** include diff'd PNGs in the commit **+** commit-message line `BASELINE UPDATE: <reason>`. Closes 19-turn architect ⚠️ from CARRYOVER L132. See `.claude/memory/feedback_visual_verification_gate.md` for rationale + tolerance values + cross-machine plan.
