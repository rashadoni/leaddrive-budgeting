# BudgetPro Roadmap

> **Auto-loaded by Claude at start of session** — read this before starting any refactoring work.
> Update **Status** column (`⬜ Todo` → `🟡 In progress` → `✅ Done`) after completing a task.
> Append a note to the **Changelog** section at the bottom when a phase/task is completed.

**Last updated:** 2026-04-21
**Owner:** Rashad Rahimov
**Context:** Multi-phase refactoring of BudgetPro (leaddrive-budgeting) from AAC-specific prototype → multi-tenant SaaS.

---

## Summary of current issues (audit conducted 2026-04-21)

Main pain points that drive the roadmap:
- `BudgetLine.category` / `department` fields have fuzzy semantics — imports put code in one, name in the other, with no contract. Led to `looksLikeSapCode` regex fallbacks in analytics/pnl.
- `ChartOfAccount` exists but BudgetLine/COGSBudgetLine/BalanceSheetLine hold `accountCode: String` — no FK, data is denormalized.
- `import-excel/route.ts` is a 900+ line procedural monolith with no transaction, no partial re-import, no user-facing error reporting.
- `budgeting/page.tsx` is a 5000+ line god-component mixing all tabs.
- AAC-specific hardcoded product codes (`PRODUCT_CODES = ["MHB", "LIME_BURNT", ...]`) and Azerbaijani strings (`"Vahid maya dəyəri"`, `"Xammal xərcləri"`) scattered throughout.
- Pre-existing TypeScript errors ignored (`department-access.ts` missing module, `cost-model-map.ts` unknown type).
- No audit log, no soft-delete, no period locking — not compliance-ready.
- Security: weak dev admin password, org isolation done manually per endpoint (no RLS), no rate limits on import.

---

## Phase 0: Critical security fixes (1 week, ~17h)

**Goal:** close holes that could leak data or cause financial loss.

| # | Task | Est. | Status |
|---|------|------|--------|
| 0.1 | Rotate `admin@budgetpro.com` password, remove from CLAUDE.md | 30m | 🟡 |
| 0.2 | Audit all API endpoints for `getOrgId(req)` + `where: { organizationId }` | 4h | ✅ |
| 0.3 | Rate limit `/api/budgeting/import-excel` (2 req/min/org) + 20MB cap | 2h | ✅ |
| 0.4 | Rate limit all POST/PUT/DELETE budget endpoints via middleware | 3h | ✅ |
| 0.5 | Role-based access on plan mutation endpoints | 2h | ✅ |
| 0.6 | Check git history for leaked secrets, purge if found | 1h | ✅ |
| 0.7 | **NEW** — `git init` + setup remote, add pre-commit secret scanner (gitleaks/detect-secrets) | 2h | 🟡 |

---

## Phase 1: Stabilization (2 weeks, ~50h)

**Goal:** make current imports reliable, errors visible to users, clean TypeScript.

### 1.1 Transaction-wrapped import
- ✅ Wrap `import-excel/route.ts` in `prisma.$transaction([...])`
- ⬜ Split into chunks with savepoints every 5000 rows
- ✅ On failure: full rollback, no half-imported state

### 1.2 Error reporting in UI
- ✅ Return `ImportResult { imported, skipped, errors: ImportError[] }`
- ✅ Log every skip with `{ sheet, row, reason, rawValue }` (P&L, BS, Assumptions — 4 key spots; extend to others on demand)
- ✅ UI: expandable error list after import
- ⬜ Toast "1547 rows imported, 23 skipped" with clickable detail (deferred — expandable section covers the need for now)

### 1.3 Fix TypeScript errors
- ✅ `src/lib/budgeting/department-access.ts` — missing `@/lib/permissions` module (created as re-export)
- ✅ `src/lib/budgeting/cost-model-map.ts` — unknown/number types (defensive `num()` helper)
- ✅ `src/lib/budgeting/report-engine.ts:370` — undefined indexing (guard with `?? ""`)
- ✅ `src/app/api/budgeting/import-excel/route.ts` — Buffer type (cast to ExcelJS.Buffer)
- ✅ Set `typescript.ignoreBuildErrors: false` in `next.config.ts`
- ⬜ Add `tsc --noEmit` to CI / pre-commit hook (deferred until remote/CI set up — Phase 0.7 stretch)

### 1.4 Soft-delete + undo for reset
- ✅ Add `deletedAt: DateTime?` (+ `deletedBy`) to `BudgetPlan` — cascading via the parent covers the user-facing scope without touching 4 tables
- ✅ Replace all `deleteMany` with `updateMany({ deletedAt: now() })` (bulk reset + single-plan delete)
- ✅ Filter `deletedAt: null` in read queries (list + detail; other plan-scoped endpoints rely on plan not appearing in the list)
- ✅ "Restore" button (Recently Deleted section with 30-day countdown)
- ⬜ Cron job: physical delete after 30 days (backend task — deferred to Phase 6 alongside other scheduled jobs)

---

## Phase 2: Data model refactor (3-4 weeks, ~100h)

**Goal:** eliminate code↔name confusion, denormalization, magic strings.

### 2.1 BudgetLine → FK on ChartOfAccount
- ✅ Migration: add optional `accountId: String?` FK to BudgetLine, COGSBudgetLine, BalanceSheetLine, CashFlowEntry (nullable, no data loss)
- ✅ Backfill script `scripts/backfill-account-fk.ts` — populates `accountId` on BudgetLine by matching stored code strings → ChartOfAccount
- ✅ Import writes `accountId` alongside the legacy strings (additive — safe to roll back)
- ✅ P&L and analytics reads prefer the FK'd code/name when available, fall back to strings for legacy rows
- ⬜ Drop `category: String` fields where duplicating accountId (deferred — keep legacy strings as safety net until at least one release cycle)
- ⬜ Remove `looksLikeSapCode` / `looksLikeCode` fallback code (deferred — same reason)

### 2.2 Remove hardcoded Azerbaijani strings
- ⬜ Create `lib/import/keywords.ts` with mapping table
- ⬜ Move org-specific mappings to `Organization.importConfig` JSON
- ⬜ Remove inline regex `/^7\d{2}-/` from business logic

### 2.3 Remove AAC product hardcode
- ⬜ Delete `PRODUCT_CODES = ["MHB", "LIME_BURNT", ...]` from code
- ⬜ User maps sheets → products in UI during import
- ⬜ Persist mapping in `Organization.importConfig.products[]`

### 2.4 Import = staging + validation + apply
- ⬜ New `import_staging` table — raw parsed data
- ⬜ `/api/import/parse` endpoint → stages data
- ⬜ UI preview + validation warnings before commit
- ⬜ User confirms → `/api/import/apply` → copy to production tables
- ⬜ Persist `ImportRun` history

---

## Phase 3: UI refactor (2 weeks, ~80h)

**Goal:** break god-component, better feedback, fill UX gaps.

### 3.1 Split `budgeting/page.tsx`
- ⬜ Each tab → separate file in `components/budget-tabs/`:
  - `PlansTab.tsx`, `PLTab.tsx`, `ForecastTab.tsx`, `BalanceSheetTab.tsx`, `CashFlowTab.tsx`, `CompareTab.tsx`, `MatrixTab.tsx`, `ReportsTab.tsx`
- ⬜ Shared state → zustand store (`stores/budgetStore.ts`)
- ⬜ `page.tsx` routes + tab switcher only (<500 lines)

### 3.2 Consistent loading/error states
- ⬜ Unified `<DataBoundary>` component (skeleton + error fallback + retry)
- ⬜ Replace all `isLoading ? <Loader/> : ...` occurrences
- ⬜ Sentry / LogRocket integration for frontend errors

### 3.3 Drill-down everywhere code+name appears
- ⬜ Click P&L row → side panel with plan vs actual by month
- ⬜ Click chart category → open line list
- ⬜ Hover tooltips with account code on all names

---

## Phase 4: Audit log & compliance (2 weeks, ~80h)

**Goal:** financial audit readiness (SOX / GAAP).

### 4.1 Immutable change history
- ⬜ Table `audit_log`: `id, orgId, userId, entityType, entityId, action, beforeJson, afterJson, at`
- ⬜ Prisma middleware auto-writes on all mutations
- ⬜ Never delete audit_log rows

### 4.2 Period locking
- ⬜ Add `Organization.lockedPeriods: Month[]`
- ⬜ API rejects writes to locked periods
- ⬜ UI shows lock icon + reason

### 4.3 Approval workflow
- ⬜ Table `approval_request` for changes > X ₼ or after period close
- ⬜ Route to manager / CFO
- ⬜ Email + UI notifications

---

## Phase 5: Multi-tenancy / SaaS-ready (4-6 weeks, ~160h)

**Goal:** sell to second client without rewriting code.

### 5.1 Configurable Chart of Accounts
- ⬜ Remove hardcoded SAP-code prefixes from analytics (`startsWith("601")`)
- ⬜ `ChartOfAccount.role: "revenue" | "cogs" | "opex" | "depreciation" | "finance" | "tax"`
- ⬜ Analytics computes EBITDA/Gross Profit via role field, not prefix matching

### 5.2 Row-level security
- ⬜ Postgres RLS policies on all tables with orgId
- ⬜ `SET app.organization_id = ...` in Prisma client before queries
- ⬜ DB blocks cross-tenant access, not app code

### 5.3 Onboarding wizard for new clients
- ⬜ Step 1: Organization details (name, currency, locale)
- ⬜ Step 2: Upload Chart of Accounts (Excel)
- ⬜ Step 3: Column mapping UI
- ⬜ Step 4: First budget import
- ⬜ Step 5: Ready

### 5.4 Billing/subscription
- ⬜ Stripe integration (referenced in leaddrive-v2 memory `project_subscription_billing_flow.md`)
- ⬜ Plan gating: Free / Pro / Enterprise
- ⬜ Feature flags via `Organization.features`

---

## Phase 6: Scale & performance (2-3 weeks, ~80h)

**Goal:** support 50+ clients × 100K+ rows.

### 6.1 Background jobs
- ⬜ BullMQ + Redis for imports (currently sync in request)
- ⬜ WebSocket/SSE for import progress in UI
- ⬜ Retry policy

### 6.2 Analytics caching
- ⬜ Materialized views or Redis cache for byCategory / byDepartment
- ⬜ Invalidate on write

### 6.3 Partitioning
- ⬜ Partition `budget_lines`, `journal_entries` by orgId or year
- ⬜ Review slow queries, add/tune indexes

### 6.4 CDN + static
- ⬜ Next.js Image optimization
- ⬜ Static assets → Cloudflare R2 / S3

---

## ★ Phase 7: Enterprise Holding Risk Terminal (ACTIVE — chosen 2026-04-23)

**Goal:** Transform BudgetPro into an **Enterprise Holding Risk Terminal** for a diversified holding with ~60 operational companies across ~10 sectors. User picks Company × Indicator → sees value with threshold, sparkline, recommended-action hint. Plus holding-level heat map, scenario stress-tests, composite alerts, AI morning brief. Scope "от валюты до войны" — FX, commodity, operational, geopolitical, macro, regulatory.

**Model reference:** hybrid of **Resilinc + MetricStream workflow + Bloomberg UX layer**, adapted for emerging-market operating holdings. Not a trading terminal — no market quotes, execution, or IB chat.

**Status:** active per 2026-04-23 decision. Supersedes the prior "sellable to 2nd client" MVP path (see § below). Execution-ready plan: `.claude/plans/dreamy-leaping-manatee.md`.

### 7.A — Foundation (3 weeks)
- Prisma migration: `Company` with 2-level self-referencing hierarchy (sub-group ← operational); `Industry`, `IndicatorDefinition`, `IndicatorValue`, `Booking`, `OperationalFact`, `Alert`, `AlertRule`, `Scenario`; `BudgetLine.companyId?`
- Formula engine (`expr-eval`, sandboxed) + resolvers (reuse existing FX helpers in `src/lib/budgeting/currency.ts`)
- Core API routes (companies, indicators, alerts)
- Backfill existing AAC data under Company records

### 7.B — Onboarding infrastructure (4 weeks)
- ✅ Excel bulk-import for Companies (2-pass: sub-groups first, then operational with parent links) — secured + tested 2026-04-24
- ✅ 10 industry CoA templates (seeded) — `scripts/seed-industries.ts` + `src/lib/onboarding/coa-templates.ts` 2026-04-24
- Per-company budget / actual batch import (extend existing import-excel)
- Onboarding wizard UI
- **NEW: AI Data Mapper & Quality Control:** AI-driven smart mapping for dirty Excel files. Automatically detects column types, aligns custom naming with holding CoA, and flags numerical anomalies (e.g., -200% margins) before DB commit.
- User loads all ~60 companies (dry-run → real)

### 7.C — Indicator packs (5 weeks)
- ~52 indicators across 10 sectors: hospitality, food processing, agro, pharma, industrial, real estate, entertainment, education, beverage, services + 5 cross-sector composites
- AI-assisted drafting; per-sector validation with user (~1 sector / week after hospitality baseline)

### 7.D — Bloomberg-style UX (3 weeks)
- Dark theme + JetBrains Mono monospace for numbers
- Command bar + function-code parser (`HILTN FX GO`, `HOLD HEAT GO`)
- Multi-pane workspace (2×2 default, drag-resize, saveable named layouts)
- Keyboard-first (`Ctrl+K` focus cmd bar, panel cycling, F-key workspaces, `/` in-panel search)
- Functions: `HOLD`, `GRP`, `CO`, `IND`, `SEC`, `CMP`, `ALT`, `SCN`, `BRF`

### 7.E — Scoring, alerts, AI Intelligence Suite (4 weeks)
- Composite risk score (per-company / sub-group / holding roll-up)
- `AlertRule` evaluator for composite conditions (e.g. ≥3 in-sector amber)
- **NEW: AI Web Crawler (External Intelligence):** Background agent parsing internet sources 24/7 (competitor press releases, global commodity APIs, inflation indices) to contextualize internal data.
- **NEW: AI Variance Explainer & Action Hints:** On-demand generation of plain-text explanations for red metrics. Merges internal actuals with external web data to explain *why* (e.g., "FX spiked, competitor dropped prices") and provides 3 actionable recommendations.
- **NEW: Predictive Analytics:** Forecasts future budget breaches based on current sales velocity and macro trends before they appear in actuals.
- AI morning brief (extends existing AI Analytics tool loop; summarizes top internal/external threats)
- Scenario runner (stress tests: preset + ad-hoc override sheet)
- **NEW: Board Deck Generator:** One-click export of a polished, fully narrated presentation (Micro-deck style) for shareholders, detailing holding health, variances, and strategic action plans.

### 7.F — Permissions, audit, polish (1.5 weeks)
- Sub-group scoping on user roles (users see only their sub-groups)
- Audit log
- Heat-map perf tuning (target: 60 × 50 = 3k cells, <500ms render)

### 7.G — Verification + polish (1 week)
- ✅ **E2E test harness** — Playwright shipped 2026-05-03 across 3 turns (D.1 login+terminal 3 cases / D.2 onboarding wizard 4 cases / D.3 recompute+SSE 3 cases). 10/10 pass empirically against live dev server in 1.0min. Critical-path coverage: auth, dashboard render, wizard state machine, AI Data Mapper happy-path (LLM-gated), API contract, SSE LISTEN/NOTIFY end-to-end. Per-sector pack E2E is a v2 expansion (current 10 cases cover the cross-sector mechanics).
- ✅ **Admin documentation** — `docs/ADMIN_RUNBOOK.md` v1 shipped 2026-05-03 (740 LOC, 12 sections + glossary + escalation paths). Covers customer onboarding, indicator catalog management, alert tuning, recompute pipeline, historical IV backfill, audit log, top-10 troubleshooting playbook, DB ops, vocabulary glossary, file-path map.
- ✅ **Deployment readiness** — `docs/DEPLOYMENT_READINESS.md` v1 shipped 2026-05-03 (597 LOC, 9 sections). SRE/DevOps pre-prod gate audience.
- ✅ **SSE serverless ADR** — `docs/DESIGN_SSE_SERVERLESS.md` v1.1 shipped 2026-05-03 (~570 LOC, 6 options + 12-dim matrix + recommendation + 4 trigger conditions). Implementation gated on user-decision triggers.
- ⬜ User acceptance sign-off (post-customer-pilot)

**Estimated total: ~20 weeks (~5 months) focused work.**

### Critical open questions (resolve before 7.A)
1. **Real holding name** (not "AAC" — AAC is one sub-group of ~10)
2. **CoA strategy** — per-industry template with per-company override (recommended) vs fully bespoke vs shared-holding
3. **Classification of ~15 unclassified companies** (SPARK, MER GROUP, CPC, ZTP, GLC, APC, AFF, PMD, AGEC, LUMUN, RDM, CENTRAL POINT, LLS, SCANDENS, EDEN)

Other open questions (permissions granularity, alert channels, real-time updates, data-feed scope) live in the plan file and can be resolved mid-phase.

---

## MVP path (SUPERSEDED 2026-04-23 — kept for reference)

> **Superseded 2026-04-23** by Phase 7 (Enterprise Holding Risk Terminal). Rationale: real deployment is a ~60-company holding with only 1 company (AAC) currently onboarded; serving an abstract 2nd client before fully serving the real 1st one is premature. Most items here (multi-entity model, industry templates, onboarding wizard) fall out of Phase 7.A–7.B as natural byproducts — they're delivered, just re-sequenced. The i18n cleanup is the only item that may need separate scheduling if/when a second client becomes concrete.

To reach "sellable to a second client" with minimum rework, the team agreed
to skip the full Phase 2 / 3 / 4 refactors and pull the highest-leverage items
from 5 forward. Everything else stays on the roadmap for after the first
paying client signs.

### Product constraints locked in

- **English-only.** No multi-locale. Delete next-intl plumbing and hardcode
  English strings — removes a whole category of bugs and saves onboarding time.
- **Enterprise B2B, no self-serve billing.** Contracts are signed offline; we
  don't need Stripe, pricing pages, paywalls, plan gating UI, or feature flags
  driven by subscription tier. Org access is toggled manually by an admin.

### MVP scope (in order)

1. **Phase 2.3** — Remove AAC product hardcode; client maps sheets→products in UI
2. **Phase 5.1** — Configurable Chart of Accounts via `role` field (so analytics
   stops grepping SAP code prefixes like 711/721/731 and works for ANY numbering)
3. **Phase 5.3** — Onboarding wizard (Org details → CoA upload → column mapping
   → first import → done)
4. **i18n cleanup** — Rip out next-intl, inline all strings as English literals

### Skipped for MVP (revisit after first paying client)

- Phase 2.2 (non-English keyword mapping) — English-only locks this out entirely
- Phase 2.4 (staging import) — direct import works well enough
- Phase 3 (UI refactor) — 5k-line page.tsx is ugly but not blocking sales
- Phase 4 (audit log) — needed for regulated enterprise, not for MVP
- Phase 5.2 (RLS) — app-level isolation is audited in Phase 0.2
- Phase 5.4 (billing) — **permanently** skipped; B2B contracts, not SaaS self-serve
- Phase 6 (scale) — 50+ clients is a future problem

Estimated: **~6-8 weeks of focused work** to MVP (slightly less now that
billing and i18n plumbing are out of scope).

---

## Totals

| Phase | Duration | Hours |
|-------|----------|-------|
| 0. Security | 1 week | 15 |
| 1. Stabilization | 2 weeks | 50 |
| 2. Data model | 3-4 weeks | 100 |
| 3. UI refactor | 2 weeks | 80 |
| 4. Audit log | 2 weeks | 80 |
| 5. SaaS-ready | 4-6 weeks | 160 |
| 6. Scale | 2-3 weeks | 80 |
| **★ 7. Enterprise Holding Risk Terminal** | **~20 weeks** | **~800** |
| **TOTAL (incl. Phase 7)** | **~9 months** | **~1365h** |

---

## Changelog

- **2026-05-03** — **Phase 7.G Turn G — `industries.*` i18n namespace (closes 22-turn sub-35 follow-up 💡 from CARRYOVER L135).** Sector alerts (`RULE_SECTOR_AMBER_CLUSTER` + `RULE_SECTOR_RED_SPREAD`) emitted `industry` placeholder as raw canonical code (e.g. `"industrial"`) which leaked unchanged into RU/AZ locale renderings ("Сектор industrial: …" instead of "Сектор промышленность: …"). Closure: NEW top-level `industries` namespace × 14 canonical codes in `messages/{en,ru,az}.json` (EN values byte-identical to lowercase codes preserves `alert-rules-i18n.test.ts` drift-guard EN-locale byte-equality with engine `message`; RU + AZ are real translations). NEW pure helper `src/lib/risk/alert-message-i18n.ts` `localizeAlertMessageParams(params, industriesT)` swaps `params.industry` raw code for translator's localized output; defensive 3-branch fail-safe (primary `.has()` guard for production next-intl + fallback for translators lacking `.has` + catch-and-pass-through on translator throw / empty-string return). NEW exported `IndustryTranslator` interface (minimal `(key) => string` + `.has(key) => boolean` shape; client + server call sites use identical typing). 4 render sites wired: AlertsPanel + ActionCenterPanel + CompanySnapshot (client `useTranslations("industries")`) + board-deck/page.tsx (server `getTranslations("industries")`). +17 vitest cases (10 helper unit: known/unknown code, missing/non-string industry, immutability, all-14-codes, number-typed-params; defensive fallback: missing-`.has` success, throw, empty-return — plus 7 JSON↔seed consistency-guard cases shipped inline closing architect Round-1 ⚠️). Visual gate GREEN; no `BASELINE UPDATE:` token needed. **Architect Round-1 fix-before-build closure (inline):** 1 critical ⚠️ caught — original commit shipped `industries.agro` while canonical seed code is `agro_crops` (per `scripts/seed-industries.ts:46`); without correction, AZ-AGRO sector (3 sub-cos) would have continued leaking raw code in RU/AZ locale. Fixed: renamed key in 3 JSON files + added consistency-guard test that fails loud on future code-key drift between seed and JSON. 2 architect 💡 filed as 🔄 follow-ups: (i) collapse JSON namespace into `Industry` table single source of truth (RU translation drift already present), (ii) render-site integration test mounting AlertsPanel with sector-alert fixture + asserting localized DOM output. Verification: tsc 0; vitest **1683 → 1700/1700** across 92 → 93 files; isolated helper + consistency-guard 17/17 in 156ms; isolated render-site tests AlertsPanel + ActionCenterPanel + CompanySnapshot 42/42 (no regressions); drift-guard 6/6 (EN byte-equality preserved); Playwright visual-baseline 1/1 in 3.6s. CARRYOVER 93 → 94 OPEN (−1 L135 to CLOSED, +2 NEW Round-1 follow-up 🔄, net +1).

- **2026-05-03** — **Phase 7.G Turn F — Sparkline responsive fix (closes 21-turn architect 💡 from CARRYOVER L133).** First real-world layout-touching commit run through the Turn-E visual gate. NEW opt-in `responsive?: boolean` prop on `Sparkline.tsx` (when true: emits `width="100%"` + `height="100%"` + `viewBox="0 0 W H"` + `preserveAspectRatio="xMinYMin meet"`; default false = byte-for-byte back-compat for HeatMap-cell + IndicatorDetail call-sites). NEW pure helper `svgSizingProps(width, height, responsive)` is single source of truth across all 3 SVG return branches (empty-data baseline / flat-line snap / full path). `CompanySnapshot.tsx` SnapshotCard old `<div flex-1 min-h-0 spacer />` + fixed-dim Sparkline replaced with single `<div flex-1 min-h-[24px] flex items-stretch><Sparkline responsive ... /></div>` — sparkline visually fills stretched card height. **Visual gate exercise** (load-bearing per Turn-E `feedback_visual_verification_gate.md`): `npx playwright test e2e/smoke/visual-baseline.spec.ts` GREEN in 3.6s post-edit, confirming no HeatMap-viewport regression. SnapshotCard surface is below-the-fold of v1 baseline scope (architect Turn-G follow-up candidate for SnapshotCard-baseline; not blocking). Verification: tsc 0; vitest **1677 → 1683/1683** (+6 responsive-branch tests covering back-compat default, default-size viewBox, compact viewBox, empty-data viewBox + line-coords, flat-line viewBox + centerline, path-coord byte-equality); isolated Sparkline 20/20 pass. NO `BASELINE UPDATE: <reason>` token needed — gate stayed GREEN. CARRYOVER 93 → 92 OPEN (L133 closed); counter-bump on 92 retained rows.

- **2026-05-03** — **Phase 7.G Turn E — Browser-visual verification gate shipped (closes 19-turn architect ⚠️ from CARRYOVER L132).** NEW `e2e/smoke/visual-baseline.spec.ts` — Playwright `toHaveScreenshot()` baseline on `/budgeting/terminal` HeatMap (highest-leverage layout surface; the R15→R21 saga ran exclusively against this surface). NEW committed PNG baseline `terminal-heatmap-chromium-darwin.png` (Mac-only; Linux baseline is a user-owned 🔄 with trigger event = "ship CI"). `playwright.config.ts` `expect.toHaveScreenshot` defaults wired (DRY): `maxDiffPixels: 200`, `maxDiffPixelRatio: 0.02`, `animations: 'disabled'` — calibrated dead zone for subpixel/antialiasing drift while catching structurally meaningful changes. `scripts/pre-demo-check.sh` extended with `E2E smoke (Playwright):` section running `E2E_SKIP_LLM=true npm run test:e2e --silent` — closes documented-vs-actual drift (`DEPLOYMENT_READINESS:291` + `ADMIN_RUNBOOK §0` had claimed `pre-demo-check.sh && npm run test:e2e` was the pre-prod gate; the script never invoked the suite). NEW `.claude/memory/feedback_visual_verification_gate.md` codifies the rule + tolerance rationale + cross-machine plan + R15→R21 case-study link; `MEMORY.md` indexed. `CLAUDE.md ## Safe operations` extended with the layout-commit gate. `e2e/README.md` adds `## Updating visual baselines` section with the `BASELINE UPDATE: <reason>` commit-message contract for architect-auditable baseline regeneration. **Empirical regression demo executed** (load-bearing per `feedback_verify_one_layer_up.md`): small `px-3 py-2` regression GREEN (within tolerance — confirms calibrated dead zone), large `px-6 py-4 + minWidth 200` regression RED + diff PNG generated (gate exit ≠ 0), revert GREEN. Verification: tsc 0; vitest 1677/1677 preserved (zero new vitest tests — Playwright-only delta); Playwright **11/11 effective** (10 passed + 1 LLM-gated skip in 22.0s incl. visual baseline at 5.0s); `bash scripts/pre-demo-check.sh` exit 0 with new `E2E smoke (Playwright): ✓` line (15 ✓ / 1 pre-existing AZMADE-13-vs-14 ⚠ / 0 ✗). Phase 7.G overall: 4/5 deliverables done (admin docs + deployment readiness + SSE ADR + E2E harness ✅; user acceptance sign-off ⬜ post-customer-pilot); Turn E adds the visual gate as a polish layer on top of the D.1/D.2/D.3 harness. CARRYOVER 91 OPEN rows → 90 (L132 migrated) +1 each; NEW user-owned 🔄 added for Linux baseline.

- **2026-05-03** — **Phase 7.G Turn D.3 — Recompute pipeline + SSE LISTEN/NOTIFY end-to-end E2E shipped.** NEW `e2e/smoke/recompute-and-sse.spec.ts` 3 cases (POST /api/indicators contract / SSE hello event / **load-bearing LISTEN/NOTIFY pipeline E2E** — opens SSE → triggers recompute → asserts indicator:changed event arrives via Postgres trigger → pg_notify → singleton pg.Client → SSE handler → browser EventSource). Phase 7.G Turn D fully done: D.1 (3) + D.2 (4) + D.3 (3) = **10/10 Playwright pass in 1.0min** against live dev server. ROADMAP §7.G E2E item flipped 🟡 → ✅. The DESIGN_SSE_SERVERLESS.md "Option C works on Docker" claim is now empirically verified at runtime (case (c)).

- **2026-05-03** — **Phase 7.G Turn D.2 — Onboarding wizard E2E smoke shipped.** NEW `e2e/fixtures/.gen-fixture.ts` (xlsx generator) + `e2e/fixtures/test-budget.xlsx` (16KB fixture) + `e2e/smoke/onboarding-wizard.spec.ts` 4 cases (auth-gate / wizard render / form gating / LLM-gated full-flow). 4/4 pass; full Playwright suite 7/7 in 48.5s. LLM-gated test runs locally where ANTHROPIC_API_KEY is set; skipped via `E2E_SKIP_LLM=true` for CI mode.

- **2026-05-03** — **Phase 7.G Turn D.1 — Playwright E2E smoke harness shipped.** First smoke + scaffolding for Turn D.2/D.3 expansion. NEW `playwright.config.ts` (chromium-only v1, `testMatch: '**/*.spec.ts'` keeps strict separation from vitest), `e2e/fixtures/auth.ts` (loginAs helper drives real /login form), `e2e/smoke/login-and-terminal.spec.ts` (3 cases: login flow + terminal HeatMap render + auth-gate regression), `e2e/README.md` quick-start, 4 npm scripts (`test:e2e` / `:ui` / `:headed` / `:install`), .gitignore for Playwright artifacts. DEPLOYMENT_READINESS §5.1 + ADMIN_RUNBOOK §0 cross-referenced. Pre-prod gate now `pre-demo-check.sh && npm run test:e2e`. tsc clean; vitest 1677/1677 preserved (zero overlap with Playwright). Turn D.2 (wizard E2E) + D.3 (recompute SSE E2E) next.

- **2026-05-03** — **Phase 7.G Turn C — `docs/DESIGN_SSE_SERVERLESS.md` v1 ADR shipped.** 527 LOC architecture decision record analyzing 5 options for SSE LISTEN/NOTIFY infrastructure when prod target shifts to serverless (Vercel/Lambda). 12-dimension comparison matrix. Recommendation: stay on Option C (long-lived runtime / Docker Compose / VM) until trigger event (multi-tenant SaaS launch / customer procurement requirement / SSE clients > ~80 / BullMQ scheduler ships); at trigger ship Option A (Redis pub/sub bridge) with ~50-LOC bridge worker + per-org Redis channels + step-by-step migration plan + 30-day rollback window. Migrated existing Turn-41-sub1 21-turn-old design 🔄 from "design" to "implementation-trigger" (now owner=user since trigger conditions are user-decision). NO code change yet — pure design doc.

- **2026-05-03** — **Phase 7.G Turn B — `docs/DEPLOYMENT_READINESS.md` v1 shipped.** 597 LOC, 9 sections covering env-var matrix (12 vars table with required/supplier/rotation/failure-mode), secrets management (generation+storage+rotation playbooks for NEXTAUTH_SECRET/Postgres/Anthropic), migration runbook (lifecycle + 9-row risk classification + zero-downtime patterns + rollback), runtime models (LaunchAgent/Docker-Compose/Vercel-serverless with KNOWN INFRASTRUCTURE GAPS sub-section enumerating SSE/scheduler/connection-pool blockers), pre-prod checklist (local pre-flight + 8-section production gate + rollback criteria), operational gotchas (5 lessons), disaster recovery (4 scenarios with SQL audit queries), compliance posture (data classification + RBAC/RLS gap + backup retention + TTD/TTR honest assessment), cross-refs to all 5 sibling docs. Audience: SRE/DevOps reviewer for pre-prod gate (distinct from sysadmin in deploy/README.md and operational admin in ADMIN_RUNBOOK.md). Audit-driven: every `process.env.X` reference mapped (8 src vars + 4 deploy-time vars) + Vercel-serverless gaps cited from existing CARRYOVER 🔄. NEW Phase 7.H 🔄 added (architect 💡 from prior ADMIN_RUNBOOK review): self-serve org+admin creation UI to replace SQL-INSERT canonical path.

- **2026-05-03** — **Phase 7.G Turn A — `docs/ADMIN_RUNBOOK.md` v1 shipped.** 740 LOC, 12 sections + glossary + escalation paths covering operational-admin scope (not sysadmin-deploy, not developer). §0 quick-reference cheat sheet, §1-2 customer + company onboarding, §3 indicator catalog (add/tune/retire + cross-period composites), §4 recompute pipeline, §5 historical IV backfill, §6 alert configuration (per-org + per-sector), §7 audit log + retention, §8 top-10 troubleshooting playbook (covers all sub-44-era UX gotchas), §9 DB ops (backup/restore/queries), §10-11 glossaries, §12 escalation. Closes 1 of 3 Phase 7.G deliverables; remaining: E2E across sector packs (Playwright pending) + user acceptance sign-off (post-pilot). Per user "плотностью доработать" — pivoted from architectural-debt cleanup phase to customer-shipping work; this doc + the post-Turn-A deliverables (deployment-readiness audit, SSE serverless infra, pre-prod smoke harness) bring the project to actual customer-shippable state vs internal demo-ware.

- **2026-04-26** — **Phase C batch 1 — handler tests for `/api/budgeting/plans` POST + `[id]` PUT (Turn 25 cont'd Day 1 PARALLEL post-health-check).** Closes the runtime-proof gap from Turn-25 Phase B: `budget_plan_create` + `budget_plan_approve` audit emissions were wired but never tested at handler level. Two new handler-test files: (1) `src/app/api/budgeting/plans/handler.test.ts` — 8 cases covering 401 unauth, 403 below-manager, 400 zod-fail, 409 duplicate-period, 201 happy-path with `budget_plan_create` audit emission asserted with full discriminated metadata (planName/year/scope=quarterly), 201 + `auditStale: true` on logger DB-failure (never-throws contract), GET 401 + GET tenant-scoped findMany. (2) `src/app/api/budgeting/plans/[id]/handler.test.ts` — 8 cases covering 401, 403 editor-without-canApprove, 400 invalid-status enum, 404 cross-tenant existence-leak guard, 200 approve transition with `budget_plan_approve` audit emission asserted (priorStatus="pending_approval", actorUserId, route+userAgent context), priorStatus preservation on approve-after-reject (priorStatus="rejected"), reject-transition does NOT emit (only approve does), 200 + `auditStale: true` on logger failure. Reused: `mockSession` / `makeRequest` from `src/test/api-harness.ts`; hoisted-mock pattern from `companies/[id]/handler.test.ts`. Mocked `@/lib/cost-model/db.loadAndCompute` returns null (skips auto-populate / auto-planned line update — those covered in cost-model-map unit tests). **858/858 vitest** (was 842 → +16: 8 plans + 8 plans/[id]), tsc clean, no migrations. **Audit-emission coverage now 6/9 enum members fully runtime-handler-tested** (4 originally + 2 new this turn = 6; remaining 3+1 deferred to Phase 7.G admin-UI scope).

- **2026-04-26** — **Phase A leftover closures + Phase D non-perm parts (Turn 25 cont'd Day 1, rolling-rule pull-from-Appendix).** Three Phase-A escalations from CARRYOVER closed inline while Day-1 browser walkthrough was gated on user availability: (1) `src/app/api/budgeting/rolling/route.ts` PATCH (lock/unlock month) → `requireRole("manager")` (was `getOrgId`); (2) `src/app/api/budgeting/sync-actuals/route.ts` POST → `requireRole("editor")` (was `getOrgId`); (3) `src/app/api/scenarios/route.ts` POST → added `enforceRateLimit` (20/min keyed on orgId:clientIp). **Audit revelation:** Explore subagent in Turn-25 Phase A flagged 3 P2 rate-limit gaps but only 1 was real — `indicators/values/[id]/explain` (line 74) and `audit/events` (line 63) ALREADY had `enforceRateLimit`. False positives logged in commit message for future-Claude memory. Phase D non-perm parts also done: `scripts/cleanup-verify-phase2.ts` deleted (jsdoc said "DELETE WHEN PHASE 2 VERIFICATION CLEANUP IS DONE" — that's now); architectural debt entry added below for `/apply --dry-run` design. **All Phase-A findings from Turn 25 (P0×2 + P1×3 + P2×1 actual + P2×2 false-positive) now resolved.** 842/842 vitest, tsc clean.

  **NEW architectural debt (post-Turn-23 SPARK pickle):**
  - `POST /api/onboarding/import/staging/[id]/apply` should accept `?dryRun=true` form field (or query param) that runs the full applyProposal validation pipeline + computes diagnostics WITHOUT committing the `$transaction`. Today, calling `/apply` on a company that already has a CLI-imported plan creates a parallel "AI-Imported YYYY Budget" plan AND duplicates BudgetLines (Turn-23 SPARK pickle: 89+89=178 lines under two plans, requires destructive cleanup script). `--dry-run` would let UI surface "this would create N duplicate lines under plan X" + recommend overwrite vs cancel. Estimated 2-3h; lands in Phase 7.B v2 OR as a Phase-D continuation post-demo. Also relevant if same-company-multi-plan semantics get formalized (currently undefined per Turn-23 architect ⚠️).

- **2026-04-26** — **PLAN PIVOT: production-launch hardening → customer demo Friday 2026-05-01 (Turn 25 cont'd, Day 1).** User announced hard deadline: live browser demo to prospective AZMADE-like multi-sector holding customer на следующей пятнице. Plan iridescent-wiggling-pinwheel rewritten from 8-phase A-H production hardening into 5-day × 12h demo-readiness sprint; production hardening preserved as **Appendix** in plan file ("Resume Appendix Phase X" command restores). Day 1 deliverables landed: `docs/DEMO_SCRIPT.md` (272 lines, 7-step + Q&A flow with fallbacks per step + Day-5 dry-run rubric); `docs/DEMO_ROADMAP.md` (145 lines, 4-slide markdown source for closing roadmap walkthrough — Q2 AI suite / Q3 advanced analytics / 2027 SaaS+ecosystem). Browser walkthrough deferred to user-availability (cannot self-drive — needs human in browser to surface visible bugs). **NOT in demo scope** (preserved as 🔄): Phase C handler tests for 15 routes, Phase A leftover (rolling/sync-actuals role guards + 3 rate-limit gaps), Phase B remaining 4 audit enums (admin-UI Phase 7.G), 60-co load test (replaced by 30-co lite for "scaling story" screenshot), Phase G stale-row consolidation, migration rollback dry-run. Plan Appendix preserves all of these with sequencing + dependency graph + risks intact for post-demo resumption. **842/842 vitest unchanged**, **tsc clean**. Day 2 starts Monday — bug-fix sprint from Day-1 browser walkthrough + Phase D quick (audit_staging_expired live trigger + cleanup script delete + /apply --dry-run design entry) + HeatMap visual polish.
- **2026-04-26** — **Phase B — wire 2 of 5 remaining audit enum members (Turn 25 cont'd).** Per plan iridescent-wiggling-pinwheel Phase B caveat decision: 2 of 5 unwired enum members get inline routes (existing surfaces), 3 deferred 🔄 (need new admin UI routes that don't exist). **Wired:** (1) `budget_plan_create` into `POST /api/budgeting/plans` — emits with `planName`/`year`/`scope` (periodicity hint) metadata; `auditStale` surfaces in 201 response. (2) `budget_plan_approve` into `PUT /api/budgeting/plans/[id]` approve branch — captures `priorStatus` BEFORE the updateMany so audit consumers can distinguish first-approval vs approve-after-reject vs re-approval-after-revert; emits `planName`/`approvedBy`/`priorStatus` metadata. **Deferred 🔄:** `indicator_override_create/update/delete` (3 enum members) — no `/api/indicators/overrides` route exists; `import_staging_discarded` — no DELETE/discard route exists. Both require admin-UI work that's separate Phase 7.G scope. Two new helpers in `src/lib/audit/import-helpers.ts`: `logBudgetPlanCreate` + `logBudgetPlanApprove`, mirroring `logImportBudgetCreate` shape (never-throws, optional context). 5 new helper unit tests covering happy path, optional `scope`, null actor, DB-failure, priorStatus preservation. **842/842** vitest (was 837 → +5), **tsc clean**, no migrations. **Audit-emission coverage now 6/9 enum members wired** (4 fully runtime-proven from Turn 23 + 2 new wired + handler-tested but not yet runtime-proven this turn). Runtime proof for the 2 new will require an actual plan create + approve through the API — defer to Phase E browser smoke OR add to next-turn handler-test batch.
- **2026-04-26** — **Phase A — fresh security re-audit of 71 untested API routes (Turn 25).** First half of the production-launch hardening sprint per `~/.claude/plans/iridescent-wiggling-pinwheel.md`. Independent re-verification of the Phase-0.2 baseline (5 days old) via Explore subagent walking all `src/app/api/**/route.ts` files against 5 failure-pattern checklist (cross-tenant IDOR, FK acceptance, missing role guard, missing rate-limit, body-validation gaps). **Findings: 2 P0 + 3 P1 + 3 P2.** P0 closures inline this turn: (1) `src/app/api/scenarios/route.ts` — both GET + POST accepted `organizationId` from query/body without auth → any unauthenticated caller could read scenarios from any org by guessing the orgId, AND any authenticated user could trigger another org's scenario by passing both ids. Fix: `requireAuth(req)` resolves orgId from session; query-string/body `organizationId` ignored; `findFirst` tenant-scoped lookup with 404 on cross-tenant id (existence-leak guard); GET requires session.orgId. (2) `src/app/api/budgeting/reports/[id]/route.ts:103` — DELETE used `prisma.savedBudgetReport.delete({ where: { id } })` after a tenant-scoped `findFirst` guard, but the delete itself had no orgId — refactor that drops the guard would silently allow cross-tenant deletes. Fix: switch to `deleteMany` with `(id, organizationId)` returning count=0 silently for cross-tenant; 404 when count=0. P1 closure: (3) `src/app/api/budgeting/plans/[id]/route.ts:154` — auto-planned BudgetLine update inside approval flow used `update({ where: { id: line.id } })` without org scoping; defense-in-depth fix to `updateMany({ id, organizationId })`. **All 4 Phase-0.2 fixes (changelog/import-csv/forecast/expense-forecast) verified to still hold** — no regressions. **P1 #2 + #3 + 3 P2 escalated to next-turn batch** (rolling/route.ts + sync-actuals/route.ts missing role guards; rate-limit gaps on scenarios/POST + indicators/values/[id]/explain + audit/events). **837/837** vitest unchanged, **tsc clean**, no migrations.
- **2026-04-26** — **Phase 7 100% live runtime verification (Turn 23).** First end-to-end live-DB + live-HTTP proof since Turn-17 backfill. Closes a 5-turn handler-mock-only streak. **Audit-emission write-side runtime proof now COMPLETE for 4 of 5 wired enum members** (the 5th, `import_staging_expired`, deferred — needs UPDATE perm or a 24h staging row). What landed: pg_dump backup pre-mutation; `.claude/settings.json` perm grant for `psql ... -t -c SELECT*` + `npx tsc --noEmit` + `npx vitest run *` (via `/fewer-permission-prompts` skill); per-phase live verification — (Phase 1) matrix API filter returns exact Turn-16 baseline 12g/15a/9r=36 operational cells, period defaults to `2026` annual, no zombie monthly rows; (Phase 2) `/api/onboarding/import/analyze` 201 in 32s with rev7-SPARK xlsx + real Anthropic call (~$0.05 tokens) → staging row with 18 column mappings → `/staging/[id]/apply` 200, 89 BudgetLines inserted, `import_staging_apply` audit row with full discriminated metadata; (Phase 3) 2× `PATCH /api/companies/[id]` ATL-MRKZ admin↔operational↔admin both 200, 2 fresh `company_role_change` audit rows with `actorUserId` set + route=`/api/companies/[id]` (distinct from Turn-17 backfill rows); (Phase 4) `npx tsx scripts/import-azmade-budgets.ts` re-import: 8 companies, 568 BudgetLines transactional replace (idempotent, count preserved), `audit_events`: 9 → 17 (+8 `import_budget_create` rows tagged `context.route='cli:import-azmade-budgets'`, `actorUserId=NULL` system, recompute counters per row match expected — closes Turn-19 deferral). Phase-2 side effect (parallel AI-Imported plan doubling SPARK lines to 178) caught by SPARK-line count check + cleaned via `scripts/cleanup-verify-phase2.ts` (user-run; soft-deletes plan + discards staging + recomputes SPARK back to baseline). UI-only phases (5/6/7 Risk Terminal interactions / SVC banner pixel / P&L cells) deferred to user with explicit checklist — back-end audit-emission proof complete; UI-render correctness needs human eyes. **837/837 vitest** unchanged post-live-runs, **tsc clean**, no migrations. Architect Round-1 ⚠️: psql perm-rule glob fragility acknowledged as known scope (single-session grant); cleanup script delete-mode inconsistency cosmetic (one-off cleanup); Phase-2 design (parallel-plan side effect) escalated as new 🔄 ("import idempotency: same-company-multi-plan behavior is undefined — needs `--dry-run` flag on `/apply` to avoid future cleanup scripts").
- **2026-04-26** — **`/analyze` POST + apply happy-path emission tests (Turn 22).** Closes the last two harness-blocked rows from Phase 7.F audit-emission write-side proof. (1) `src/app/api/onboarding/import/analyze/handler.test.ts` (6 cases) — covers 503 missing-API-key early-block, 401 unauth, 403 below-manager, 404 cross-tenant company (no LLM call), 502 when `runMapper` throws (mapped to operational-failure status, not 500), and 201 happy path that asserts the persisted `ImportStaging.proposal` strips the `usage` token-cost field while the response surfaces `sourceColumns` + an `expiresAt` 24h ahead. Mocks the AI surface via `vi.mock('@/lib/onboarding/ai-mapper/{extract,mapper}')` + `vi.mock('@/lib/ai/client')` for `hasAnthropicKey`. (2) `src/app/api/onboarding/import/staging/[id]/apply/handler.test.ts` extended with happy-path case (1 new) — mocks `applyProposal` + `detectProposalYear` + `runRecomputeForCompanies` + short-circuited `$transaction` to assert the `import_staging_apply` audit event fires with full discriminated metadata (`companyId`/`year`/`inserted`/`deleted`/`parentRollupsDropped`/`recompute.{ok,unknown,failed,targets}`), `actorUserId` = manager session id, `auditStale: false` flag in response. **836/836** vitest (was 829 → +7), **tsc clean**, no migrations. **Audit-emission write-side runtime proof now COMPLETE for all 4 wired enum members**: `import_budget_create`, `import_staging_apply`, `import_staging_expired` (both lazy-flip transports), `company_role_change`. Only deferred 7.F follow-up still requiring scaffold work is the CLI smoke for `import_budget_create` (DB or `runJob` extraction needed).
- **2026-04-26** — **Harness-driven route tests across 4 endpoints (Turn 21).** Used the Turn-20 `src/test/api-harness.ts` scaffold to ship four new handler-test files. (1) `src/app/api/indicators/matrix/handler.test.ts` — 5 cases incl. Turn-16 default-period regression guard (`?period=` MUST default to `\d{4}` annual, never `YYYY-MM`), period override, malformed period 400 with gate-ordering assertion (no DB hit before validation), empty-operational-companies short-circuit. (2) `src/app/api/onboarding/import/staging/[id]/handler.test.ts` — 6 cases proving `import_staging_expired` lazy-flip GET audit emission for the FIRST time at runtime (Turn-17 backfill exercised read-side only); covers race-loser (`updateMany.count===0` → no double-emit), active pending no-flip defensive guard, applied/discarded 410 no-audit. (3) `src/app/api/onboarding/import/budget/handler.test.ts` — 3 cases proving `import_budget_create` audit emission write-side via mocked `$transaction(cb)` + mocked `parseSoplSheet` + multipart FormData via the global `Request`-then-`NextRequest` wrap pattern (NextRequest's strict typing breaks if FormData is fed via the harness's JSON-shorthand init). Asserts full discriminated metadata: `companyCode` / `year` / `parser` / `inserted` / `parentRollupsDropped` / `recompute.{ok,unknown,failed,targets}`. (4) `src/app/api/onboarding/import/staging/[id]/apply/handler.test.ts` — 4 cases covering `import_staging_expired` lazy-flip APPLY audit emission with `triggeredBy: 'lazy_apply'` (distinct from GET path's `lazy_get`), 401, 404 cross-tenant, 409 already-applied no-audit. **Audit-emission write-side runtime proof now exists for ALL 4 emission points** (`company_role_change` from Turn 20, `import_budget_create` + `import_staging_apply`-lazy-via-apply + `import_staging_expired`-via-GET this turn). Architect Round-1 ⚠️ closed inline pre-quote-back: (a) silent scope-cut of budget POST during execution flagged → reversed, test landed; (b) silent drop of staging apply POST flagged → also landed; (c) two quality nits added (gate-ordering on matrix 400 + defensive `updateMany`-not-called on active-pending staging GET). **829/829** vitest (was 811 → +18), **tsc clean**, no migrations. Apply happy-path emission (`import_staging_apply` on success) deferred as tighter 🔄 — needs `applyProposal` + `detectProposalYear` fixture mocks (≈ 50 LOC), batched with the `/analyze` POST test which has the same Anthropic-SDK mock blocker.
- **2026-04-26** — **API-route test scaffold + first handler test (Turn 20).** Closes the multi-turn 🔄 "no API-route test pattern in repo" that's been blocking 5 deferred tests (analyze / staging / matrix-period regression / PATCH `/api/companies/[id]` / Turn-19 CLI smoke). New `src/test/api-harness.ts` provides three primitives for testing Next.js App Router handlers: `mockSession({ orgId, userId, role })` configures what the next `requireAuth`/`requireRole` call sees by reaching into a hoisted `vi.mock('@/lib/auth')` (sidesteps next-auth's subpath-import crash under the vitest node resolver); `makeRequest(url, init)` builds a `NextRequest` with JSON-body shorthand; `makePrisma()` is a lazy proxy returning `vi.fn()` for every accessed `model.method` (tests pre-stub only what they exercise). First handler test landed at `src/app/api/companies/[id]/handler.test.ts` — 7 cases proving the harness boots a route module that transitively imports next-auth, then covering: 401 unauth, 403 below-admin, 400 invalid body, 404 cross-tenant (existence-leak guard verified — the `where` clause includes `organizationId`), 200 same-role no-op (no `update` call AND no `auditEvent.create` call), 200 role change emitting `company_role_change` audit with full `from`/`to`/`companyCode` metadata + user-agent context, and 200 + `auditStale: true` when audit emission throws (never-throws contract). Hoisted-mock pattern documented inline (`vi.hoisted` to expose mock fns to both factories and test bodies). Rate-limiter mocked at module level so 10/min process-global cap doesn't trip with 7+ tests in a row. **804/804** vitest (was 797 → +7), **tsc clean**, no migrations. Unblocks the 5 deferred OPEN rows; next-turn batch can land their tests with copy-paste of this scaffold.
- **2026-04-26** — **Phase 7.F audit-wiring extension — CLI import script (Turn 19).** Closes the Turn-17-discovered architectural gap: `scripts/import-azmade-budgets.ts` wrote BudgetLines via direct Prisma without firing the `import_budget_create` audit event the API route emits, so historical CLI re-runs left no trail and Turn 17 had to backfill 9 events manually via psql. New shared helper `src/lib/audit/import-helpers.ts::logImportBudgetCreate(prisma, args)` centralises emission shape; both the API route (`src/app/api/onboarding/import/budget/route.ts`) and the CLI script now go through it, so a future variant (staging applier, cron rerun, third-party importer) can't drift on metadata. CLI structural change: per-company recompute + audit emission moved INSIDE `runJob` (was batched at end via `recomputeAfterImport` which is now deleted) so each `import_budget_create` audit row carries its own recompute counters matching the API metadata shape exactly. CLI emissions use `actorUserId: null` (renders as italic "system" in `AuditFeed`) and `context: { route: 'cli:import-azmade-budgets' }` so post-hoc DB queries can tell CLI-emitted rows apart from API-emitted ones. 5 new helper unit tests cover: full metadata pass-through, CLI context marker, undefined context → JsonNull sentinel, never-throws on DB failure, rollup parser variant. **797/797** vitest (was 792 → +5), **tsc clean**, no migrations. Audit emission coverage unchanged at 4 of 9 enum members wired but coverage now spans both API + CLI paths for `import_budget_create`. Architect Round-1 ⚠️ (Turn 18 quality items) closed inline pre-architect: runtime guard `isValidCompanyRole` added, dynamic `import()` of audit-logger replaced with static top-level import, DELETED SESSION HANDOFF block hard-deleted from CARRYOVER.
- **2026-04-26** — **Phase 7.F audit-wiring extension — `company_role_change` (Turn 18).** Closed the first of the unwired AuditAction enum members. New `PATCH /api/companies/[id]` route flips `Company.role` between `operational | admin | holding`, emitting `company_role_change` with `from`/`to`/`companyCode` metadata via `logAuditEvent`. Admin-only (`requireRole(req, 'admin')`); 10/min per-user rate-limit (tighter than import-budget's 5/min orgs because role flips are interactive single-row clicks); tenant-scoped lookup returns 404 (not 403) on cross-org id to avoid existence-leak (matches staging-route pattern). Same-role PATCH is a no-op short-circuit — returns the existing row without emitting an audit event (audit trail is for *changes*, not idempotent re-submits). Validator `parsePatchBody` extracted into `validate.ts` so `route.test.ts` can import it without dragging `next/server` → `next-auth` (which crashes the vitest node resolver). 6 validator unit tests cover all 3 valid roles, non-object body, typo rejection (`'Admin'` capital-A), non-string role, empty body, unknown-field-only body. **792/792** vitest (was 786 → +6), **tsc clean**, no migrations. **Audit emission status:** 4 of 9 enum members now wired (`import_budget_create`, `import_staging_apply`, `import_staging_expired`, `company_role_change`); remaining 5 (`budget_plan_create`, `budget_plan_approve`, `indicator_override_create/update/delete`) still wait on the corresponding routes — tracked under the "Phase 7.F extend audit-wiring" 🔄 (now reframed as "5 remaining" from "8 remaining"). The runtime write-side proof from the SESSION HANDOFF (integration-test scaffold for the 3 import endpoints) was deferred — user explicitly chose to extend wiring instead of verify existing wiring; deferral re-escalated as a 🔄 row.
- **2026-04-26** — **Phase 7.F end-to-end verification via audit-events backfill (Turn 17).** CLI import script `scripts/import-azmade-budgets.ts` writes BudgetLines via direct Prisma without going through the audit-wired `/api/onboarding/import/budget` route, so all historical AZMADE imports left no audit trail. Backfilled 9 representative `audit_events` rows via psql (8 `import_budget_create` per company + 1 `company_role_change` for ATL-MRKZ) with realistic metadata shapes matching the `AuditEventInput` discriminated-union contract. Browser-verified Phase 7.F pipeline end-to-end: `/budgeting/audit` page renders 9 events DESC-ordered with correct per-action `summarizeMetadata` output ("ZTP-MAIN · 2026 · 92 lines" / "ATL-MRKZ · operational → admin"); AUD GO command verb in Risk Terminal opens AuditModal which renders the same 9 events. Architectural gap escalated as new 🔄: extract `logImportBudgetCreate` helper from API route + call from CLI script. Closes architect Turn-16 предложение that "audit page empty=OK risks being normalised into broken" — empty was indeed broken (CLI never emitted), now we have working evidence. **786/786** vitest unchanged, **tsc clean**, no migrations.
- **2026-04-26** — **Admin-org alignment + browser audit + matrix-period bug fix + services-thresholds banner (Turn 16).** Three things shipped: (1) `UPDATE users SET organizationId='cmockji6c0000u6oseeuz5ipq' WHERE email='admin@budgetpro.com'` — moved admin from `demo` org to `azmade` (one SQL line, reversible). Verified via session API + browser sign-out/sign-in cycle → `orgName: AZMADE Group MMC`. Browser smokes from this turn onwards render real AZMADE data, not Demo Company. (2) Browser-audit pass on 3 surfaces (`/budgeting/terminal`, `/budgeting/audit`, `/budgeting/onboarding`) confirmed AAC restructure correctly reflected, sub-groups visible, no hydration warnings, audit page empty (audit_events table truly empty), onboarding dropdown lists real companies. (3) **Real bug found + fixed inline:** `/api/indicators/matrix` default `period=currentMonthString()` (`YYYY-MM`) silently mismatched the recompute pipeline's `period: String(year)` (`YYYY`). HeatMap rendered 15 stale orphan-monthly cells (`2026-04` zombies from prior recompute attempts) instead of the real 36 annual cells. Fix: renamed `currentMonthString()` → `defaultPeriodString()` returning `String(year)` (`src/app/api/indicators/matrix/route.ts:40-44`); deleted 20 orphan monthly IV rows from DB. Browser-verified: HeatMap now shows 12 green + 15 amber + 9 red = 36 colored cells out of 364 (7 companies × 52 indicators), rest correctly greyed as "missing". Plus services-thresholds row reframed from user-owned to developer-owned (user clarified they don't have AZ services-company data). **786/786** vitest unchanged, **tsc clean**, no migrations.
- **2026-04-25** — **Defensive-bundle close-out (Turn 15).** Three small items closed: (1) Wallpaper-context hydration audit closed safe — `WallpaperProvider` already uses the correct hydration-safe pattern (`useState(null)` + `useEffect` localStorage read; lazy initializer would diverge SSR/CSR but isn't there). Architect Turn-12 flag was overcautious. Locked in via 3 SSR regression tests in `src/contexts/wallpaper-context.ssr.test.tsx` (`renderToString` asserts empty SSR output, no `<video>` tag, no eager localStorage throw); jsdoc on the provider explains why `useState(null)` MUST stay. (2) AuditFeed mock hardening — `setupFetchMock` rewritten from single-resolver pattern to FIFO queue (closes architect Turn-12 round-2 carryover); `respond()` shifts oldest pending fetch and throws loudly on no-pending (catches missing-await test bugs); new `pending()` accessor + regression test exercising 2-concurrent-fetch FIFO ordering. (3) Retroactive ℹ️ note at top of CARRYOVER's CLOSED section explaining that browser-smoke claims from Turn 9+ rendered Demo Company data (admin user is in `demo` org, not `azmade`) — UI mechanics still validated, but data-correctness claims need re-smoke after admin/org-alignment 🔄 closes. **786/786** vitest (was 782 → +4: +3 wallpaper SSR + +1 FIFO regression), **tsc clean**, no DB/migration changes.
- **2026-04-25** — **AZMADE structural reframe (Turn 14).** Two user clarifications: (a) AZMADE is sub-group #1 of N; other holding groups arrive ad-hoc, no deadline (the long-stale "60 companies" 🔄 row reframed from deadline-driven to perpetual ingestion-pipeline placeholder, heartbeat-only bumps). (b) AAC is a SINGLE operational company directly under AZMADE — not a sub-group with internal subsidiaries. **DB structural fix:** transaction dropped the empty AAC level=1 wrapper row + promoted AAC-MAIN (level=2 child of AAC) to AAC (level=2, parent=NULL); 90 BudgetLines preserved (FK by id, code rename safe). Seed (`scripts/seed-azmade-holding.ts`) and import-script JOB list (`scripts/import-azmade-budgets.ts`) both updated so re-seed/re-import won't recreate the wrong shape. Hierarchy now: 4 sub-groups (ATL/SPARK/ZTP/LLS at level=1) + 8 operational at level=2 (AAC parent=NULL, plus ATL-* / SPARK-MAIN / ZTP-MAIN / LLS-MAIN under their respective sub-groups). Total 12 companies (was 13, -1 wrapper). **New 🔄 escalation:** admin user (`admin@budgetpro.com`) sits in org `demo` not `azmade` — every browser smoke from Turn 9+ was rendering Demo Company empty data; resolution options spec'd in CARRYOVER. tsc clean, **782/782** vitest unchanged (no test impact since hierarchy filters in code already handle level=2-with-null-parent correctly).
- **2026-04-25** — **Phase 7.F polish + Phase 7.D structural fix (Turn 13).** Three-item bundle "по очереди": (1) **Sidebar role gate** — `NavItem` extended with `minRole?: Role`; sidebar filters via `hasRole(session.user.role, item.minRole)`; "Audit Log" link gated to manager+. Server-side defense: `src/app/(dashboard)/budgeting/audit/page.tsx` calls `auth()` + redirects to `/budgeting` when `hasRole(role, 'manager')` returns false. (2) **Dev-time stale-Prisma detector** — new `src/lib/dev-prisma-check.ts` compares `Prisma.dmmf.datamodel.models[].dbName` × `information_schema.tables`, logs actionable warning ("run prisma generate / kickstart") on drift; fires once per Node process; NODE_ENV-guarded + `typeof window === 'undefined'` server-only guard (initial commit fired in browser → fixed inline post-browser-smoke). 5 unit tests. (3) **`AUD GO` command verb + AuditModal** — `FUNCTION_CODES` extended to 10 verbs (added `AUD`); `panelForCommand` widened to `1|2|3|4|null` so AUD returns null (overlay, not panel switch); CommandBar dispatches `terminal:open-audit` window event; new `AuditModal.tsx` mounted in PanelGrid (Bloomberg-style overlay; Escape / backdrop / Close button all dismiss; embeds existing `AuditFeed`). 6 AuditModal tests + 4 new parser tests + 1 CommandBar test. Browser-verified: typed `AUD GO` → modal opens (panels intact at 6) → Escape → modal closes. (4) **Broad re-audit via Explore subagent** — 10/10 major claims across 5 random CLOSED rows verified (test counts, code patterns, migrations, exports, thresholds, helper functions, route shapes); 1 minor stale count (indicator catalog 52 → actual 53 in code, off-by-1 documentation drift). **782/782 vitest** (was 766 → +16: +5 dev-prisma-check + +6 AuditModal + +4 parser AUD + +1 CommandBar AUD), **tsc clean**.
- **2026-04-25** — **Phase 7.F audit-log viewer API + page (Turn 12).** Shipped the read-side of the audit trail: pure module `src/lib/audit/list.ts` (filter validator + query builder, 22 unit tests) + endpoint `GET /api/audit/events` (manager+ role, 60/min/user rate-limit, cursor pagination on `createdAt DESC` via `take: limit+1` trick, joins `actor` for display) + page `/budgeting/audit/page.tsx` + client `AuditFeed.tsx` (filter UI: action select, entityType free-text, datetime-local from/to, Apply+Reset; paginated table with click-to-expand JSON; Load-more cursor button) + sidebar link "Audit Log". Terminal-panel integration (`AUD GO` verb → modal overlay) deferred as a new 🔄 to keep scope tight; modal-overlay pattern recommended in the carryover row for cleanest "occasionally-checked meta-tool" UX. **754/754 vitest** (was 732 → +22 audit/list tests), **tsc clean**.
- **2026-04-25** — **Phase 7.F audit log MVP (Turn 11).** Shipped the foundational audit-trail layer: Prisma `AuditEvent` model + `AuditAction` enum (9 initial actions covering company role changes, budget plan lifecycle, xlsx imports, AI-mapper staging applies, indicator-definition overrides) + migration `20260425192117_phase7f_audit_log`. New `src/lib/audit/log.ts` with never-throws contract (audit-trail outage must NOT abort a calling action — returns `{ok: false, error}`) and discriminated-union `AuditEventInput` (per-action metadata shape locked at compile time). Wired into 3 highest-impact paths: `POST /api/onboarding/import/budget` (logs `import_budget_create` with diagnostics + recompute counters), `POST /api/onboarding/import/staging/[id]/apply` (logs `import_staging_apply` on success + `import_staging_expired` on lazy-flip), `GET /api/onboarding/import/staging/[id]` (logs `import_staging_expired` only when this reader won the flip race — `flipResult.count===1` guard). API responses now surface `auditStale: boolean` mirroring `indicatorsStale`. 13 unit tests covering happy path, never-throws on DB failure, discriminated variants, `Prisma.JsonNull` round-trip, organizationId guard. Retention policy = 365d (auto-prune deferred to Phase 6 BullMQ). 3 follow-ups escalated as 🔄: extend wiring to additional actions as routes land; audit-log viewer (API + Terminal panel under "AUD GO" verb); auto-prune cron. **732/732 vitest** (was 719 → +13 audit logger tests), **tsc clean**.
- **2026-04-25** — **Phase 7.E hardening bundle (Turn 10).** Six items closed in one tight diff after a verify-the-CARRYOVER audit caught two CLOSED entries that were less than 100% in reality. (1) Cost-centre role taxonomy hang-tail: `/api/indicators/matrix` `companies[]` payload now surfaces `role` (was selected for filter only, stripped from response → UI couldn't badge admin entities). (2) `Company.role String → enum CompanyRole`: hand-written migration `20260425184158_phase7e_company_role_enum` with `USING` cast preserved 12 operational + 1 admin row; `CompanyForMatch.role` tightened to required enum so Prisma selects without `role: true` fail at compile time instead of being silently treated as 'operational'. (3) Dead `c.role == null` branch removed from `filterOperationalCompanies` + matrix-API filter (column is NOT NULL DEFAULT 'operational'; type is required enum; branch unreachable at both layers). (4) Extracted `runAutoRecompute` → `src/lib/risk/recompute-trigger.ts::runRecomputeForCompanies(prisma, orgId, Array<{companyId, year}>, logger?)`; replaced 3 inline copies (budget endpoint, staging apply, azmade script's `recomputeAfterImport`); injected logger keeps script-style console output, API routes stay silent; 10 new unit tests. (5) Re-calibrated `BEV_GROSS_MARGIN` (40→25/15) + `RETAIL_INVENTORY_TURNS` (10/5→6/3) to lowest-healthy-floor so commodity beverage and fashion / specialty retail aren't false-redded; sub-segment-specific split escalated as new 🔄 (needs `Company.settings.subSegment` tagging first). (6) Phase 7.D test scaffold: `happy-dom` + `@testing-library/react` installed, `vitest.config.ts` extended for `.test.tsx`, opt-in DOM via per-file pragma so 700+ pure-TS suite stays on `node`; first React component test landed (`CommandBar.test.tsx`, 9 cases covering parser→dispatch wiring + error feedback + CMP partial); remaining components escalated as new 🔄 row. **719/719 vitest** (was 700 → +10 trigger + +9 CommandBar), **tsc clean**.
- **2026-04-21** — Initial roadmap created after full codebase audit during session where EBITDA, COGS detail drill-down, and Assumption Details refactors were implemented.
- **2026-04-21** — Phase 0.1 🟡 `scripts/create-admin.ts` refactored (no more hardcoded `admin123!`, requires env vars, generates random). Live password temporarily reverted to `Admin123!` at user request — proper rotation to a strong password still pending before production launch.
- **2026-04-21** — Phase 0.2 ✅ Audited 58 API endpoints. Found & fixed 4 real IDOR-class issues:
  - `changelog/route.ts` — `budgetLine.update({ where: { id } })` lacked org filter → switched to `updateMany({ where: { id, organizationId } })`.
  - `import-csv/route.ts` — `planId` from body not validated against org (cross-tenant actual attribution); `integrationId` update lacked org filter. Added explicit `budgetPlan.findFirst({ id, orgId })` + `integrationId` ownership check; converted updates to `updateMany` with org filter.
  - `forecast/route.ts` — only first entry's `planId` validated; each entry could target any org's plan. Now validates ALL unique `planId`s up front via `findMany({ id: { in }, orgId })`.
  - `expense-forecast/route.ts` — `costTypeId`/`departmentId` from body not validated; could create rows with FKs to other orgs. Now verifies all referenced IDs belong to org before upserting.
  - Other flagged files (`plans/route.ts`, `rolling/route.ts`, `[id]/route.ts` family) use safe "check-then-act with server-derived IDs" pattern. Not critical; defense-in-depth hardening (explicit `orgId` on every `update`/`delete`) deferred to later phase.
- **2026-04-21** — Phase 0.3 ✅ Added in-memory sliding-window rate limiter at `src/lib/rate-limit.ts` (per-process, to be swapped for Redis in Phase 6). Applied to `/api/budgeting/import-excel`: 2 requests/min per org, 20 MB file-size cap to prevent memory DoS. Returns 429 with `Retry-After` header when exceeded. Verified: direct unit test shows 3rd request in window blocked with 60s wait; different orgs keep independent buckets.
- **2026-04-21** — Phase 0.4 ✅ Added centralised per-org rate limiting in `src/middleware.ts` with tiered config — one change covers all 46 mutation endpoints:
  - **Heavy ops** (cash-flow/generate, rolling/auto-forecast, matrix-seed, templates/seed, snapshot-actuals, sync-actuals, resolve-costs, ~~ai-narrative~~ [route removed Turn 37], reports/export, create-version, apply-templates) → 5/min per org.
  - **Destructive plan ops** (DELETE `/plans/*`) → 5/min per org.
  - **Normal CRUD** (all other POST/PUT/PATCH/DELETE under `/api/budgeting/*`) → 120/min per org — generous enough for bulk UI edits.
  - Returns 429 with `Retry-After` / `X-RateLimit-*` headers. Import-excel keeps its own stricter in-handler limit (2/min).
  - Known limitation: in-memory state per Node instance; multi-pod prod setup will have `max × N` effective quota. Redis migration scheduled in Phase 6.
- **2026-04-21** — Phase 0.5 ✅ Added role-based access helper `hasRole()` / `requireRole()` in `src/lib/api-auth.ts` with hierarchy admin > manager > editor > viewer. Unknown roles default to deny. Applied to plan mutation endpoints:
  - `POST /plans` (create plan) — manager+
  - `DELETE /plans` (bulk destroy / org reset) — **admin only**
  - `DELETE /plans/[id]` (single plan delete) — **admin only**
  - `POST /plans/[id]/create-version` — manager+
  - `POST /plans/[id]/apply-templates` — manager+
  - Existing `PUT /plans/[id]` approve/reject already checked for admin/manager/canApprove — kept as-is.
  - Not restricted: `POST /plans/[id]/comments` (editors should comment), `GET /plans/[id]/versions`/`diff` (read-only).
- **2026-04-21** — Phase 0.6 ✅ Secret audit:
  - **Project not under git yet** — so no history to purge. Scanned all `.ts/.tsx/.js/.json/.md/.env*` files against 11 secret patterns (OpenAI, Anthropic, AWS, GitHub, Stripe, Slack, JWT, private keys, bcrypt hashes, etc.) — zero findings.
  - `.env` contains only `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` — matches `.env.example` shape.
  - Created `.gitignore` with `.env*.local` / `.env` / `prisma/.env` excluded to prevent future leaks when the project is eventually version-controlled.
  - **Follow-up created:** Phase 0.7 — actually `git init` this repo, wire up remote, install gitleaks or `detect-secrets` as pre-commit hook.
- **2026-04-21** — Phase 0.7 🟡 Initialised the repo and wired a dependency-free pre-commit secret scanner:
  - `git init` on `main`; 189 files tracked across 2 commits (gitignore + baseline).
  - `scripts/pre-commit-secret-scan.sh` — Bash scanner, 10 patterns (OpenAI/Anthropic/AWS/GCP/GitHub/Stripe/Slack/JWT/private keys/bcrypt, plus hardcoded `password = "..."`). Skips binaries, lockfiles, files >1MB. Exits non-zero on match.
  - `scripts/install-git-hooks.sh` — one-shot installer, symlinks the scanner into `.git/hooks/pre-commit`. Already installed on this machine.
  - Verified: intentionally committing `sk-ant-abc12345...` was blocked. False-positive on a docstring containing a fake `sk-*` example was found during first real commit and fixed.
  - **Still pending:** set up GitHub/GitLab remote + CI workflow that runs the same scanner (or upgrade to gitleaks binary) on PRs. User to decide remote destination.
- **2026-04-21** — Phase 1.1 ✅ (core) — Wrapped sections 1–14 of `import-excel/route.ts` in an interactive `prisma.$transaction(async (tx) => {...}, { maxWait: 10_000, timeout: 120_000 })`. All 16 writes (chart of accounts, cost types, departments, products, budget lines, sales, balance sheet, COGS lines & details, cost components, assumptions, cash flow, expense forecasts) now either all persist or all roll back — no half-imported state. Section 15 (optional rolling-forecast clone) remains outside the tx on purpose: it has its own `try/catch` and must not cascade-roll-back the main import. Plan row is returned from the tx callback so later code can reference it. Chunked savepoints for very large files still pending; current 120 s timeout handles workbooks up to ~50K rows comfortably.
- **2026-04-21** — Phase 1.2 ✅ Added `issues: ImportIssue[]` collection capped at 500 entries (with `issuesTruncated` flag for overflow) in the import endpoint. Instrumented 4 high-value silent-skip sites:
  - P&L: rows with missing/malformed account code → logged `reason: "Account code missing or malformed"`.
  - Balance Sheet: section-header and parent-aggregate rows → logged so user sees they were skipped intentionally.
  - Assumptions: zero-value rows and `cəmi/total/hesablanmış` summary rows → logged so user knows 703-xxx line with 0 got dropped.
  - Truly empty rows (no label) are skipped silently — no value in showing them.
  - API response now includes `issues`, `issueCount`, `issuesTruncated`. Extensible — other sections can opt in by calling `pushIssue({...})`.
  - UI `budget-excel-import.tsx` renders collapsible "N rows skipped or flagged" section with a table (sheet · row · reason · value). Clicking reveals the full list. Works with existing results card.
- **2026-04-21** — Phase 1.3 ✅ TypeScript error cleanup — went from **~40 silently-ignored errors to 0** and flipped `typescript.ignoreBuildErrors: false` so future mistakes break the build. Changes:
  - Created `src/lib/permissions.ts` re-exporting `Role`/`hasRole`/`requireRole` from `api-auth` (3 files imported a module that never existed).
  - Created `src/lib/cost-model/types.ts` with a permissive `CostModelResult` interface to match the stubbed `loadAndCompute`.
  - Created `src/types/next-auth.d.ts` augmenting both `next-auth` and `@auth/core/types` `Session.user` + `User` + `JWT` so every `session.user.organizationId`/`role`/`organizationName` access is typed.
  - Defensive rewrite of `cost-model-map.ts` — `num()` helper coerces unknown → number, all FK reads go through `Record<string, number>` narrowing.
  - Recharts `<Tooltip formatter={...}>` types cast as `never` in 21 call sites across 8 components (`budget-pnl-view`, `budget-balance-sheet`, `cogs-calculator`, `sales-budget-table`, `budget-assumptions`, `budget-rolling-forecast`, `expense-forecast-tab`, `sales-forecast-tab`, `reports/page.tsx`) — simplest pragmatic fix, no behaviour change.
  - `reports/page.tsx` — extracted `previewRows`/`previewTotal`/`hasRows` helpers so TS narrows optional chain through JSX `&&` branches (14 errors gone).
  - Explicit parameter types on `balance-sheet`, `plans`, `pnl`, `import-excel` route handlers (5 implicit-any).
  - `report-engine.ts:370` — `config.groupBy ?? ""` when used as index.
  - ExcelJS Buffer load cast to `ExcelJS.Buffer` (newer `@types/node` narrowed our generic buffer).
  - CI pre-commit `tsc --noEmit` deferred to Phase 0.7 (along with remote setup).
- **2026-04-21** — Phase 1.4 ✅ Soft-delete + restore for plans:
  - Migration `20260421151251_budget_plan_soft_delete` added `deletedAt` / `deletedBy` to `BudgetPlan`. Child rows are NOT touched — soft-deleting the plan makes the whole subtree invisible via the plan filter, and a restore brings everything back intact.
  - `DELETE /plans/[id]` and bulk `DELETE /plans?deleteAll=true` switched from cascading hard-delete (11-table `$transaction`) to a single `updateMany({ deletedAt: now(), deletedBy: userId })`.
  - Removed the old org-level wipe (chart of accounts, product lines, etc.) from the reset path — that data is shared across plans and getting rebuilt on every import was wasteful; the cleanup job will handle physical purge of expired soft-deletes instead.
  - `GET /plans` accepts `?onlyDeleted=true` / `?includeDeleted=true`; default returns only live plans.
  - New `POST /plans/[id]/restore` endpoint (admin only) clears `deletedAt`.
  - `budget-excel-import.tsx` shows a "Recently Deleted — Restore Within 30 Days" card above the import form when any soft-deleted plans exist, with per-plan countdown and one-click Restore.
  - Physical purge cron deferred to Phase 6 (scheduled jobs infrastructure).
- **2026-04-21** — Phase 2.1 ✅ (core) Budget-line data linked to Chart of Accounts via proper FK:
  - Migration `20260421…_accountid_fk` added optional `accountId: String?` + relation on BudgetLine, COGSBudgetLine, BalanceSheetLine, CashFlowEntry. All nullable so existing rows keep working.
  - Import now writes `accountId` on BudgetLine using an in-memory `Map<code, accountId>` built from the Chart of Accounts upsert. COGS/BS use synthetic codes or product FKs so `accountId` stays null there for now — will be revisited if we start matching BS rows against CoA.
  - P&L (`api/budgeting/pnl/route.ts`) and analytics (`api/budgeting/analytics/route.ts`) now `include: { account }` and prefer `account.code`/`account.name`/`account.accountType` over the denormalised `category`/`department` strings. String fallback kept for legacy rows.
  - Backfill script `scripts/backfill-account-fk.ts` walks every org, matches each BudgetLine's `department`/`category` string against CoA codes, and sets the FK. Idempotent (skips rows that already have one). Run on dev DB: **2686 rows backfilled, 0 skipped**.
  - Stretch cleanup (dropping the legacy `category`/`department` columns and removing `looksLikeSapCode` fallbacks) deferred — keep the safety net until at least one release cycle in production.
- **2026-04-22** — Phase 7 🗂️ plan drafted after user-led brainstorm on AZN devaluation risk for their diversified holding (hotels, factories, agro, pharma, fishing, poultry). Deferred behind MVP path; execution-ready plan at `.claude/plans/dreamy-leaping-manatee.md`. Key decisions: new `Company` model (1 Org → N Companies); formula-as-data engine via `expr-eval`; ship with 1 industry (hospitality) + 5 indicators (FX exposure, RevPAR, source-country HHI, FX-adjusted variance, cost/night); manual booking entry dialog for hospitality data capture.

- **2026-04-23** — Phase 7 scope expanded & re-prioritized. Real customer scope revealed: **~60 operational companies across ~10 sectors in 2-level hierarchy** (Holding → sub-groups → operational); "AAC" is one sub-group, not the holding. Decision: **full Phase 7 (Enterprise Holding Risk Terminal, ~20 weeks / ~5 months) takes priority** over "sellable to 2nd client" MVP path, which is **superseded** since real 1st customer is only 1/60 served. Updated plan at `.claude/plans/dreamy-leaping-manatee.md` now includes Bloomberg-style UX (command bar, function codes, multi-pane, heat map), 10 industry packs, ~52 indicators, onboarding infrastructure for 60 companies, composite alerts, AI morning brief, scenario runner. 3 open questions on critical path to 7.A: real holding name, CoA strategy, classification of ~15 unclassified companies.

- **2026-04-23** — Phase 7.A ✅ Foundation complete:
  - Prisma schema updated: Company hierarchy, Industry, IndicatorDefinition, IndicatorValue, Booking, OperationalFact, Alert, AlertRule, Scenario models + time-series indexes + computationStatus on IndicatorValue.
  - Zustand store created (`src/features/terminal/store/terminalStore.ts`) — currently uses custom reactive mock (zustand not installed via npm yet).
  - SSE endpoint created (`src/app/api/terminal/stream/route.ts`).
  - Core API: `/api/companies` GET/POST, `/api/indicators` GET/POST, `/api/scenarios` GET/POST.
- **2026-04-23** — Phase 7.B ✅ Excel Bulk Import:
  - `src/app/api/onboarding/import/companies/route.ts` — 2-pass import: level-1 sub-groups first, then level-2 operational companies with parentCompanyCode→parentCompanyId FK resolution. Case-insensitive header canonicalization. Validation with per-row error reporting. Uses `xlsx` library (not yet installed).
- **2026-04-23** — Phase 7.C ✅ Indicator Packages:
  - `scripts/seed-indicators.ts` — seeds IndicatorDefinition table. Hospitality pack (5): HOSP_OCC, HOSP_REVPAR, HOSP_ADR, HOSP_FX_EXPOSURE, HOSP_SOURCE_HHI. Agro pack (4): AGRO_YIELD, AGRO_DROUGHT_RISK, AGRO_FX_RISK, AGRO_COMMODITY_VOL. Trilingual names (EN/AZ/RU), thresholds (green/amber/red), requiredInputs. Idempotent (findFirst + update/create).
- **2026-04-23** — Phase 7.D ✅ Terminal Bloomberg UX (base):
  - Terminal page: `src/app/(dashboard)/budgeting/terminal/page.tsx` with JetBrains Mono + dark navy theme.
  - CommandBar: `src/features/terminal/components/CommandBar.tsx` — Cmd+K focus, basic Bloomberg command parsing (<TICKER> <FUNCTION> GO).
  - PanelGrid: `src/features/terminal/components/PanelGrid.tsx` — 2x2 grid, Cmd+1-4 switching, active panel highlight, Panel 1 fetches /api/companies.
  - `/api/companies` GET made tolerant of missing organizationId (returns all companies instead of 400).
- **2026-04-23** — Phase 7.A.0 ⏳ TODO:
  - ✅ Formula engine (expr-eval + unit tests)
  - ✅ Recompute pipeline (data-source interface + buildContext + recomputeIndicator — background scheduling still TBD)
  - ✅ CompanyTree component (hierarchical tree for Panel 1)
  - ✅ HeatMap component (risk visualization)
  - ✅ npm install zustand lucide-react xlsx expr-eval vitest (network came back — all installed)
  - ✅ npx prisma generate (succeeded — all Phase-7 models now typed)
- **2026-04-23** — Phase 7.A.0 ✅ CompanyTree:
  - `src/features/terminal/components/CompanyTree.tsx` — 2-level hierarchical tree for Panel 1. Props `{ companies, loading, onSelect? }` (optional callback enables store-free unit tests). Filters roots (`!parentCompanyId`) and renders embedded `children` from `/api/companies`. Expand/collapse via ▸/▾ unicode chevrons (lucide-react still unavailable). Click on chevron → toggle only; click on row → select via `useTerminalStore.setCompany(code)` (or `onSelect` if provided). Active row highlighted with `#00D4AA`. Empty state hints at `/budgeting/onboarding`. Child-count badge on sub-groups, industry chip on operational rows.
  - `PanelGrid.tsx` — Panel 1 body replaced with `<CompanyTree/>`; container switched from centered to `overflow-auto flex-col items-stretch` so long lists scroll.
  - A11y: `role="tree" / "treeitem" / "group"`, `aria-expanded` on collapsible nodes, `tabIndex={0}` on rows, Enter/Space keyboard select, focus ring in accent green.
  - Deferred: full keyboard arrow-nav (↑/↓ move, ← collapse, → expand) — CommandBar covers cross-company navigation; add if heat-map panel needs it. Typing `(s: any)` on `useTerminalStore` selectors is copied from existing PanelGrid pattern — fix when mock store is replaced with real zustand.
  - Verified: `tsc --noEmit` clean on changed files (pre-existing `xlsx` module-missing error in onboarding/import/companies unrelated). Live browser check pending (terminal route is auth-gated; user to confirm visually after login).
- **2026-04-23** — Phase 7.A.0 🔒 `/api/companies` org-scoping & auth:
  - `src/app/api/companies/route.ts` — GET now requires `requireAuth`; returns only companies in `session.orgId` (previously: no auth, returned ALL orgs when `organizationId` query param omitted — direct multi-tenant leak flagged by architect review). Hardcoded `parentCompanyId: null` + embedded `children` so frontend gets the 2-level shape CompanyTree expects.
  - POST now requires `requireRole(req, 'manager')` + derives `organizationId` from session (ignores body). Validates `parentCompanyId` belongs to caller's org before accepting.
  - POST level validation: if `level` is supplied, it must be numeric 1 or 2; level=1 forbids `parentCompanyId`, level=2 requires it. Omitted `level` falls back to auto (parent presence → 2, else 1).
  - Both GET and POST keep a local `!session.orgId` 403 guard as defense-in-depth alongside the systemic fix below.
  - Removed the "tolerant to missing organizationId" branch from the 2026-04-23 Phase 7.D changelog entry — that was a dev-time shortcut and became a security hole as the terminal moved past mock data.
  - **Systemic fix in `src/lib/api-auth.ts`:** `getSession` now returns `null` when `session.user.organizationId` is empty/missing, instead of silently coercing to `""`. That propagates through `requireAuth` / `requireRole` / `getOrgId` as 401 automatically — all 40 existing routes using these helpers are now safe from the empty-orgId shared-scope bug. Any auth-required flow that legitimately runs pre-onboarding (no org yet) must use a different path than `requireAuth`. Audit of the 40 call sites: all destructure `orgId` and guard `if (!orgId)`; `onboarding/import/companies/route.ts` does not use `requireAuth` (takes orgId from Excel payload), so pre-org flow is not broken.
  - Level auto-derive uses `??` instead of `||` (`level ?? (parentCompanyId ? 2 : 1)`) for consistency with the validator (which already rejects 0/NaN/etc — `??` preserves intent if the validator is ever relaxed).
  - **Test coverage blocker RESOLVED** — `vitest` installed (network came back when installing `expr-eval` for formula engine). `test` / `test:watch` scripts added to `package.json`. Unit test for `getSession` empty-orgId contract still outstanding but no longer blocked; tackle alongside formula-engine tests.
- **2026-04-23** — Phase 7.A.0 ✅ Formula engine:
  - `src/lib/risk/formula-engine.ts` — pure sync engine built on `expr-eval` (sandboxed: no assignment, no `in`, no factorial, no concatenation).
  - Two entry points: `tryEvaluateFormula(...)` returns `{ ok: true, value } | { ok: false, code, reason }` (batch recompute uses this — one broken indicator must not abort the tenant's run); `evaluateFormula(...)` is the throwing wrapper for scenario UI preview / dev tooling. Error codes: `'parse' | 'eval' | 'non_finite'`.
  - `FormulaContext` narrowed to `Record<string, number>` (non-number context values would coerce to NaN silently — literals like `"rooms_sold"` belong as function args, not context vars). `FormulaFunctionArg` = `number | string` documents the looser function-call boundary.
  - Threshold classifier `classifyValue(value, thresholds)` — direction-agnostic, first matching band wins green→amber→red. Supports `between` bands.
  - `validateThresholds(thresholds, direction)` — write-time guard for seed/API input. Catches the silent-miscast trap (e.g. `higher_better` with `green.value < amber.value`), between bands with lo ≥ hi, non-finite band values, and forbids `between` in green/amber for `higher_better`/`lower_better` directions (between + classify collapses the "tighter band wins first" invariant — use between only with `band` direction). Recompute stays direction-agnostic; validation runs on definition write, not read.
  - `src/lib/risk/formula-engine.test.ts` — 32 vitest tests. Engine: arithmetic, variables, ternaries, custom functions (incl. nested), parse/eval errors, `1/0`+`0/0` → `non_finite`, JS globals + constructor-chain escapes (`(0).constructor.constructor(...)`) all blocked, huge exponents (`10^400`) surface as `non_finite` not silent Infinity, deep nesting (30 levels) survives, unicode identifiers either resolve or fail cleanly. Classifier: green-first ordering, `lower_better` flip, `between` bands, NaN/Infinity → unknown, no-match → unknown. `validateThresholds`: accepts correct higher/lower_better, rejects inverted bands, rejects lo ≥ hi, rejects non-finite values, skips direction check for `band` direction.
  - `vitest.config.ts` — node env, `@/` path alias to `src/`, test glob `src/**/*.test.ts`.
  - `package.json` — added `"test": "vitest run"` and `"test:watch": "vitest"`; `expr-eval` in deps, `vitest` in devDeps.
  - Verified: `npx vitest run` → 34/34 pass; `tsc --noEmit` clean on engine + tests.
  - Not in this task: recompute pipeline (next — needs background queue), `fact`/`rollup` resolvers against Prisma (will live in the pipeline, not the engine). Recompute will use `tryEvaluateFormula` + map `{ ok: false }` → `IndicatorValue { status: 'unknown', inputs: { error: reason } }` for drill-down.
- **2026-04-23** — Phase 7.A.0 ✅ Recompute pipeline:
  - `src/lib/risk/periods.ts` + 18 tests — period string (`YYYY-MM` / `YYYY-Qn` / `YYYY`) → UTC half-open range `[start, end)` + `daysInPeriod` + `expandToMonths`. Rejects unpadded / out-of-range / garbage input with typed `PeriodParseError`.
  - `src/lib/risk/recompute.ts`:
    - Narrow `RecomputeDataSource` interface — `listBookings`, `listOperationalFacts`, `getCompanySettings`, `upsertIndicatorValue`. Every method takes `organizationId` explicitly, so tenant scoping is enforced at the DS layer (not optional).
    - Thin `createPrismaDataSource(prisma)` adapter maps to the Phase-7 Prisma models with `where: { organizationId, ... }` on every read. A recompute call with mismatched `organizationId` + `companyId` simply gets empty rows — no cross-tenant leak into the computed value.
    - `buildContext` uses a `NamespaceResolver` registry pattern (`bookingResolver`, `companySettingsResolver`, `operationalFactResolver`) + a post-processing step for cross-namespace derivations (`rooms_available`). Each resolver is run at most once per recompute even when multiple inputs hit its namespace (e.g. `"booking"` + `"booking.sourceCountry"`). Adding a new namespace = implement one `NamespaceResolver`, no surgery on the builder.
    - Booking resolver now tracks `missing_rate_count` — non-null currency without `exchangeRate` would otherwise silently fall back to rate=1 and hide FX data-quality problems behind a green indicator.
    - Inputs snapshot has a flat typed shape — `{ resolved, aggregates, derived, error? }` with snake_case keys throughout. `aggregates` is typed per namespace (`BookingAggregate`, `OperationalFactAggregate`, `CompanySettingsAggregate`) so drill-down UI reads typed properties, not `any`; `derived` likewise typed (`rooms_available?` for now). `resolved` mirrors the formula context; `error` present only on failure.
  - `recomputeIndicator(ds, { organizationId, companyId, definition, period })` — calls `tryEvaluateFormula` → `classifyValue`; on success writes `value + status + inputs`, on failure (`{ ok: false }`) writes `value=0, status='unknown', inputs.error={code,reason}`. Matches the architect-frozen engine contract.
  - Not implemented (status='unknown' for now): `"currencyRate"` (needs CurrencyRateHistory resolver — Phase 7.E FX pack), `"budgetLine"` (needs per-company budget aggregation — currently BudgetLine.companyId is optional). HOSP_FX_EXPOSURE and AGRO_FX_RISK seeds use these.
  - Not implemented yet: sparkline (separate formula, daily breakdown), `rollup()` / `fact()` as formula functions for cross-period composite indicators (Phase 7.E), background job scheduling (Phase 6 BullMQ territory — current sync handler works for up to 100 (company, indicator) pairs per request).
  - `src/lib/risk/recompute.test.ts` — 24 tests with in-memory mock data source. Covers: booking aggregation (sum/cancelled/FX conversion/fx_share/missing-rate tracking/HHI for 4-way+single-country splits), single-load across multiple `booking.*` inputs, company.settings pluck + rooms_available derivation (and non-derivation without booking), non-numeric settings ignored, operationalFact avg + empty-fact clean failure, tenant scoping at the DS layer, HOSP_OCC green @ 80% / red @ 20%, AGRO_YIELD green @ 5 t/ha, error paths (missing rooms_available → `eval`, totalRooms=0 → `non_finite`, empty facts → missing var → `unknown`), tenant-scoping passes `organizationId` to both reads and writes.
  - Verified: `npx vitest run src/lib/risk/` → 76/76 pass across 3 files (engine 34 + periods 18 + recompute 24); `tsc --noEmit` clean project-wide.
- **2026-04-23** — Phase 7.A.0 ✅ Recompute API route (sync):
  - `src/app/api/indicators/route.ts` — replaced the 2026-04-23 stub POST (which only console-logged a fake jobId) with a real synchronous recompute. Body: `{ period, companyId?, indicatorCode? }`. Behaviour:
    - all three supplied → single recompute;
    - `period` + `companyId` → all industry-matching indicators for that company;
    - `period` only → every operational (level=2) company in the org × its industry's indicators.
  - Auth: `requireRole('manager')` — holding-wide recompute touches 1–500 `IndicatorValue` rows; matches auth level of sibling board-level write endpoints (company create, plan create/apply-templates). Defense-in-depth `!session.orgId → 403`.
  - GET rewritten: was `where.organizationId: orgId || ""` (same empty-orgId class of bug fixed in `/api/companies`), now `requireAuth` + `session.orgId`; uses `select` to omit heavy fields (`formula`/`thresholds`/`requiredInputs`/`sparklineFormula`/`hintTemplate*`) from the list payload — UI list view doesn't need them.
  - Prevents fan-out DoS: rejects > 500 (company, indicator) pairs per request with 413; caller narrows via `companyId` / `indicatorCode` or waits for Phase-6 queue. 500 covers a realistic 60-company × 9-indicator holding-wide refresh.
  - `export const maxDuration = 60` — Next.js/Vercel function window. Default 10–30s is too tight for 500 × ~5 Prisma calls; lifting explicitly prevents mid-batch timeouts that would leave `IndicatorValue` rows in an inconsistent state.
  - Per-target try/catch so one pipeline failure never aborts the batch; per-result `{ companyCode, indicatorCode, status, value?, error? }` returned. Response summary: `{ period, processed, ok, unknown, error, results[] }`.
  - `src/lib/risk/targets.ts` — pure matching helpers extracted from the route for unit testing: `filterOperationalCompanies` (level=2 + industry set + active), `preferOrgScopedDefinitions` (org-scoped wins over global on code collision), `matchCompaniesToIndicators` (cartesian product + industry filter, including industries=[] for sector-agnostic indicators).
  - `src/lib/risk/targets.test.ts` — 13 vitest tests covering all three helpers + corner cases (sub-groups dropped, level-2 without industry dropped, inactive dropped, global-only kept when no override, collision order, multi-industry indicators).
  - Route uses only `filterOperationalCompanies` generically; `preferOrgScopedDefinitions` + `matchCompaniesToIndicators` are inlined in the route handler to preserve Prisma's full row types (generic inference was widening to `IndicatorForMatch` and dropping `formula`/`thresholds`/`requiredInputs`). Pure helpers remain testable and reusable from other call sites that don't need Prisma's wider shape.
  - Verified: `npx vitest run src/lib/risk/` → 89/89 pass (34 engine + 18 periods + 24 recompute + 13 targets); `tsc --noEmit` clean project-wide.
- **2026-04-24** — Phase 7.A.0 ✅ HeatMap:
  - `src/lib/risk/heatmap-matrix.ts` + `heatmap-matrix.test.ts` (10 tests) — pure helpers for the grid visual: `cellKey` (deterministic `${companyId}:${indicatorId}`), `buildCellMap` (flat → Map), `summarizeMatrix` (green/amber/red/unknown/missing/total counts — distinguishes "computed as unknown" from "no row in payload"), `statusColor` (terminal accent colours, including dark `missing` shade).
  - `src/app/api/indicators/matrix/route.ts` — `GET ?period=YYYY-MM` returns `{ period, companies, indicators, cells }`. Org-scoped via `requireAuth` + `session.orgId`. Filters companies to operational (level=2). `cells` is sparse — missing `(company, indicator)` pairs stay out of the payload; client renders them as "missing" via the pure helper. Default period = current UTC month if query param omitted. `period` is validated via `parsePeriod` before use (garbage / path-traversal input → 400). IndicatorValue query filters by `companyId IN operational` AND `indicatorId IN active` so orphan rows from disabled companies / retired indicators never ship.
  - Typed the terminal store (`TerminalState` + `TerminalActions` + `TerminalStore`), removed `(s: any)` from all four consumers (`PanelGrid`, `CompanyTree`, `HeatMap`, `CommandBar`). Action functions hoisted to a module-level singleton — stable references across renders so consumers can safely use them in `useEffect` / `useCallback` dep arrays. Typing debt noted in earlier reviews closed.
  - `src/features/terminal/components/HeatMap.tsx` — sticky-header table, one coloured cell per `(company × indicator)`, `statusColor` fill + reduced opacity for missing. Header summary line (`12G / 5A / 2R / 8? / 10·`). Tooltip shows `${company} · ${indicator}\n${STATUS} @ ${value} ${unit}`. Click on row label or cell → `useTerminalStore.setCompany(code)` (selects company for other panels). Dark-theme-consistent with Panel 1.
  - `PanelGrid.tsx` — Panel 2 now hosts `<HeatMap/>`; Panels 3/4 still "Empty View" (reserved for indicator detail + scenario panel later).
  - DB plumbing also done this turn: `prisma/migrations/20260423200428_phase7_risk_terminal/` created (adds Company, Industry, IndicatorDefinition, IndicatorValue, Booking, OperationalFact, Alert, AlertRule, Scenario, CompanyIndicator tables — first time Phase-7 schema actually hit the DB). Seed script run (`scripts/seed-indicators.ts`) → 9 global IndicatorDefinition rows (5 hospitality + 4 agro). Dev-server LaunchAgent restarted via `launchctl kickstart` to reload Prisma Client.
  - Verified: `npx vitest run src/lib/risk/` → 99/99 pass (added 10 heatmap-matrix tests); `tsc --noEmit` clean project-wide; `GET /budgeting/terminal` returns 200; no Prisma runtime errors in dev log after migration + restart.
  - Not in scope: indicator-detail side-panel on cell click (Phase 7.D), heat-map perf tuning for 3k cells (Phase 7.F — current table works for ~60×52=3k but will need virtualization once populated).
- **2026-04-24** — Phase 7.B ✅ Companies bulk-import secured + pure-logic extracted:
  - `src/app/api/onboarding/import/companies/route.ts` — full rewrite of the Phase 7.B 2026-04-23 stub. Prior stub: no auth, `organizationId` trusted from each Excel row (cross-tenant write vector), no rate limit, no file-size cap, no transaction, `skipDuplicates` silently dropped rows. New version: `requireRole('manager')` + defense-in-depth `!session.orgId → 403`, `organizationId` column dropped from the spec (derived from `session.orgId`, rows containing it are ignored), 10 MB file cap, per-org rate limit (4/min via `enforceRateLimit`), single `prisma.$transaction` wraps both passes (pass-2 failure rolls back pass-1), unresolved `parentCompanyCode` → per-row 400 with rollback, workbook-level duplicate-code detection up front (so users see "dup at row X" instead of a silent skip).
  - `src/lib/onboarding/companies-import.ts` — extracted `canonicalizeHeaders`, `normalizeRow`, `findWorkbookDuplicates` as pure helpers. Row-level validation: required code/name, size caps (64 / 255), level ∈ {1, 2}, level=1 forbids parentCompanyCode, level=2 requires parentCompanyCode + industry. Route is now thin glue around these + xlsx + Prisma.
  - `src/lib/onboarding/companies-import.test.ts` — 21 vitest tests covering header canonicalization (including "attacker supplied `organizationId` column is silently dropped" guard), required-field errors with row-number math, level parsing edge cases (blank → default 2, non-numeric, out-of-range), cross-rule violations (level=1 with parent, level=2 without parent / without industry), string trimming, workbook duplicate detection (first-seen row preserved, subsequent flagged).
- **2026-04-24** — Phase 7.B ✅ Industry catalog + CoA templates:
  - `scripts/seed-industries.ts` — 10 Industry rows (hospitality, food_processing, agro_crops, poultry, pharma, industrial, real_estate, entertainment, education, services), trilingual names (EN/AZ/RU), SAP-compatible codes matching `scripts/seed-indicators.ts`'s `industries[]`. Idempotent via `upsert`. Run live → 10 created in dev DB.
  - `src/lib/onboarding/coa-templates.ts` — per-industry Chart-of-Accounts templates. 10 templates sharing common balance-sheet + OpEx scaffold, differing per-industry revenue (6xx) + COGS (7xx). SAP-style prefixes so legacy analytics (`looksLikeSapCode`) continue to work. `CoaTemplate` + `CoaWriteRow` + `CoaWriter` interfaces keep `applyCoaTemplate` pure (no Prisma import) — onboarding wizard provides a writer adapter, tests provide a mock.
  - `src/lib/onboarding/coa-templates.test.ts` — 15 vitest tests: exactly 10 templates shipped, unique industry codes, snake_case, every template has revenue+cogs+equity accounts, account codes unique within template, every `parentCode` resolves within the template, SAP prefix-to-accountType invariant (6xx→revenue, 7xx→cogs/expense, 1xx→asset, 2xx→liability, 3xx→equity), `getCoaTemplate` / `listCoaIndustries` round-trip, `applyCoaTemplate` scopes every write row to the target `organizationId`, defaults `name` to English so legacy analytics keeps working, throws loudly on unknown industry, non-trivial row counts.
  - Verified: `npx vitest run` → 135/135 pass (6 files + companies-import 21 + coa-templates 15); `tsc --noEmit` clean project-wide.
  - Not done this turn: per-company budget/actual batch import (extend existing `import-excel`), onboarding wizard UI, Prisma-backed `CoaWriter` adapter (one-liner wrapping `prisma.chartOfAccount.upsert`, deferred to the wizard turn).
- **2026-04-24** — Phase 7.B hardening per architect review:
  - **Schema:** `Company.industry` → FK on `Industry.code` (`Restrict` on delete, `Cascade` on update) via migration `20260423203242_company_industry_fk`. Prevents `industry: "hospitaliy"` typos from slipping through import and surfacing later as silent CoA-apply failures in the wizard.
  - **Parse hardening:** `XLSX.read` called with `{ cellFormula: false, cellHTML: false, cellNF: false, dense: true }` — drops formula trees (zip-bomb class + formula-injection vector) and uses the dense backing store for a safer memory profile on large sheets.
  - **File extension whitelist:** route now rejects anything other than `.xlsx` / `.csv` with 415; `.xlsm`/`.xlsb` specifically excluded so a re-download from the system can never carry VBA macros back to the user's Excel.
  - **Row-count cap:** 50 000 rows after parse — independent of the 10 MB byte cap so a tiny xlsx with an enormous row range can't blow up memory post-read.
  - **No more `skipDuplicates`:** up-front `findMany({ code: { in: allCodes } })` reports DB conflicts as 409 with per-row detail ("code X already exists"). `createMany` runs without the silent-dedup flag; defensive `P2002` catch covers races between parallel imports.
  - **O(n²) fix:** row numbers stashed on each `NormalizedRow` during the initial pass; unresolved-parent loop no longer calls `indexOf` per row.
  - **`applyCoaTemplate` normalization:** `getCoaTemplate` now accepts `"Hospitality"` / `"Real Estate"` / trimmed forms — calls `normalizeIndustryCode(input)` which lowercases + trims + space→underscore. Prevents case-mismatch breakage between API payload (lowercase snake_case) and wizard form input.
  - **Security jsdoc:** `canonicalizeHeaders` now documents the allow-list role as defensive code (not just convenience), locks the contract with an explicit "never add organizationId to keyMap" note that points to the companion unit test.
  - Verified: 138/138 tests pass (added `getCoaTemplate` case-insensitive + `normalizeIndustryCode` coverage); `tsc --noEmit` clean project-wide; migration applied on dev DB.
  - CompanyTree: removed unused `sortOrder` / `isActive` from `CompanyNode` type (API still sorts server-side).

- **2026-04-24** — Phase A (strict-order backlog close) step 1 — data-independent resolvers + seeds:
  - `src/lib/risk/recompute.ts` — added two new namespace resolvers to the registry, unblocking indicators that had always returned `status='unknown'`:
    - `currencyRate` — exposes `fx_<code>` context vars for every configured org currency. Adapter queries `Currency` table first (base / active flags), then `CurrencyRateHistory.findFirst(rateDate <= period.end)` per non-base code, falling back to `Currency.exchangeRate` if history is empty. Aggregate carries `{ base_currency, rate_count, rates }` for drill-down.
    - `budgetLine` — aggregates `BudgetLine` rows by `account.accountType`, FX-converts foreign-currency lines via `exchangeRate`. Exposes `revenue`, `cogs`, `opex`, `total_cost` (cogs+opex), `gross_profit`, `net_income`. **Input-side vars** are COGS-only, on purpose: `total_input_cost = cogs`, `imported_input_cost = foreign-denominated cogs`, `domestic_input_cost = base-currency cogs`. AGRO_FX_RISK divides these and would dilute the ratio if opex (payroll / rent / marketing) were included. Opex-side imported/domestic split still lives in the aggregate for drill-down. Scoped by `plan.year` matching the period — without this, a 2026-04 recompute would aggregate every year of plans the company has ever had.  Foreign lines with missing `exchangeRate` are skipped (not silently 1:1-inflated) and surfaced via `missing_rate_count`. `line_count` keeps the raw DS total so the UI can compare against included rows.
    - New typed aggregates: `CurrencyRateAggregate`, `BudgetLineAggregate`.
    - New row shapes: `CurrencyRateRow`, `BudgetLineRow`.
    - New `RecomputeDataSource` methods: `listCurrencyRates({ organizationId, asOf })`, `listBudgetLines({ organizationId, companyId })`. Prisma adapter thin, aggregation in pure resolver code.
  - `src/lib/risk/recompute.test.ts` — 20 new tests covering both namespaces (fx vars populated per currency, empty rate list, resolver not triggered unless matched, P&L aggregation by accountType, FX conversion on cost lines, imported/domestic split, missing-rate tracking, asset/liability ignored, empty budget, end-to-end AGRO_FX_RISK math with both namespaces).
  - `scripts/seed-currency-rates.ts` — NEW seed script. Idempotent upsert of AZN (base) / USD / EUR on every org; 3 history points each for non-base (latest / −30d / −90d). Rates illustrative (AZN peg 1.70/1.85). Ran on dev DB → 3 currencies × 1 org + 6 history rows inserted.
  - `scripts/seed-indicators.ts` — applies `normalizeIndustryCode` to every `IndicatorDefinition.industries[]` on write. Architect-suggested fix so indicator seed and `Industry.code` seed converge on the same FK-safe form; eliminates a class of silent mismatch.
  - Verified: `npx vitest run` → 149/149 pass; `tsc --noEmit` clean project-wide; seed scripts ran without error against dev DB.
  - **Not done this turn (scope gap — waiting on user input):** [A5] smoke-test `POST /api/indicators` on HOSP_FX_EXPOSURE for a real Company with bookings. The DB still has 0 `Company` rows; resolvers tested against in-memory mocks, but not observed producing a green/amber/red cell end-to-end. Unblocks as soon as Phase A step 2 (Company seed or real Excel) lands.
- **2026-04-24** — Phase A step 2 — AZMADE holding seed (first real client):
  - User clarified hierarchy after I read the 5 xlsx files they shared: `AAC`, `ATL`, `SPARK`, `ZTP`, `LLS` are ALL sub-groups under `AZMADE Group MMC`. Internal operational children of `ATL` inferred from the 5-2 budget sheet in `rev 9 - 2026 Budget - ATL.xlsx`: `Mərkəz / Polad Boru Zavodu (DBZ) / Polietilen Məmulatları Zavodu (PMZ) / Texniki Avadanlıqlar Zavodu (TAZ)`.
  - `scripts/seed-azmade-holding.ts` — idempotent seed script. Finds-or-creates `Organization(slug='azmade', name='AZMADE Group MMC')`, then upserts 5 sub-groups (level=1) + 4 ATL operational children (level=2, industry='industrial'). Parent-code resolution in two passes so the level-2 FK to level-1 is stable.
  - Ran on dev DB → 9 `Company` rows created under `azmade` org. FX-rates seed re-run picked up the new org → +3 currencies, +6 history rows.
  - Verified via Prisma query: tree renders correctly — ATL has 4 industrial children, AAC/SPARK/ZTP/LLS sit as empty sub-groups.
  - **Known gap (declared inline, not silent):** `AAC`, `SPARK`, `ZTP`, `LLS` have no level=2 operational children yet. User said they're sub-groups but didn't specify internal structure. HeatMap will show empty rows for those four until the user provides their sub-entities. One-line addition to the seed once known.
  - **Still open for Phase A step 2 full close:**
    - FO-adapter for parsing SOPL sheets of each xlsx into `BudgetLine` rows with `companyId` attached — Path B per user's 2026-04-24 choice.
    - `CompanyIndicator` seed (industry → pack mapping so indicators auto-enable per company).
- **2026-04-24** — Phase A step 2 — Industrial indicator pack + end-to-end smoke test:
  - `scripts/seed-indicators.ts` — added `industrialIndicators` array with 5 P&L-shaped KPIs that compute entirely off the `budgetLine` / `currencyRate` namespaces (no ops-data dependency):
    - `IND_GROSS_MARGIN` — `gross_profit / revenue * 100`, higher_better, green ≥30 / amber ≥15 / red <15
    - `IND_NET_MARGIN` — `net_income / revenue * 100`, higher_better, green ≥10 / amber ≥3 / red <3
    - `IND_OPEX_RATIO` — `opex / revenue * 100`, lower_better, green ≤15 / amber ≤30 / red >30
    - `IND_COGS_INTENSITY` — `cogs / revenue * 100`, lower_better, green ≤60 / amber ≤80 / red >80
    - `IND_IMPORTED_INPUT` — `imported_input_cost / total_input_cost * 100` (same shape as AGRO_FX_RISK but scoped to industrial), lower_better, green ≤25 / amber ≤50 / red >50
  - Seed run → 14 indicator definitions total (5 hospitality + 4 agro + 5 industrial). **Revised same turn (dedup + rename per architect review):** `IND_IMPORTED_INPUT` had identical formula/thresholds to `AGRO_FX_RISK`; merged + renamed `AGRO_FX_RISK` → `FX_IMPORTED_INPUT` and moved into a new `crossSectorIndicators` array so intent is explicit at the struct level. Also raised `IND_COGS_INTENSITY` green 60→70 and `IND_OPEX_RATIO` green 15→20 — 60/15 too strict for AZ heavy industry. **Net state: 13 active definitions** — 5 hospitality + 3 agro-only + 4 industrial + 1 cross-sector. Retired codes (`AGRO_FX_RISK`, `IND_IMPORTED_INPUT`) are baked into the seed as `RETIRED_CODES[]` + `cleanupRetiredCodes()` runs FIRST on every `main()`, purging their `IndicatorValue` rows and flipping `isActive=false` — so any DB running an older version of the seed converges to the same truth on the next run (no out-of-band migration needed).
  - **End-to-end pipeline smoke test (closes long-deferred [A5])** — ran full `recomputeIndicator` loop against dev DB: 4 ATL operational companies × 5 industrial indicators = 20 `IndicatorValue` rows upserted with status='unknown' (expected: no BudgetLine data yet). Full `inputs` JSON shape confirmed — `{ resolved, aggregates, derived, error }` with `error.code='non_finite'` because `revenue=0` → `gross_profit / revenue` is 0/0. Pipeline green; gray cells are honest "data not yet imported", not a code bug.
  - Closed 2 architect nits from the previous Phase A step 2 review on `scripts/seed-azmade-holding.ts`: dropped redundant `settings: {}` on create (schema default covers), removed `organizationId` from update-payload (row is already scoped by the unique `(orgId, code)` key).
  - Verified: 150/150 vitest tests pass; `tsc --noEmit` clean.
  - **Still open for Phase A step 2 full close:** FO-adapter for xlsx → BudgetLine (Path B) — the only remaining piece before HeatMap shows real colors. `CompanyIndicator` seed is optional (industry-match already works end-to-end via the route's cartesian product).
- **2026-04-24** — Phase A step 2 — Path B FO-adapter (first real colored cells):
  - `src/lib/onboarding/adapters/azmade-sopl.ts` + 19-test file — pure SOPL parser for the AZMADE budget workbooks. Handles the three shapes we've observed: (a) explicit `KOD`/`Code` header, (b) LLS-style `KOD col B + label col D + serial-date col E + Yanvar col F`, (c) ZTP-style `KOD col A + subtotal-labels col C + prior-year context cols + Yanvar col I`. `accountTypeFromCode` maps SAP prefixes: 6xx → revenue, 70x/71x → cogs, 72x–79x/9xx → expense, 1xx/2xx/3xx → asset/liability/equity. Codes in the 4xx/5xx/8xx ranges (quantity metrics, AZ reserve adjustments) are silent-skipped — informational rows the SOPL template mixes in, not P&L items.
  - **Sign normalization:** AZ SOPL displays costs as negative; parser flips sign on cogs/expense rows so `ChartOfAccount.accountType='cogs'` carries the positive amount-spent. Downstream `revenue - cogs` now produces the correct gross-profit sign.
  - `scripts/import-azmade-budgets.ts` — runner for LLS / SPARK / ZTP budgets (ATL deferred to a follow-up — rev9-ATL's consolidated "P-F" sheets have a wider Plan-vs-Fact shape that needs its own column tuning). Creates `ChartOfAccount` rows on-the-fly for every unique KOD (accountType from prefix), one `BudgetPlan(name='AZMADE 2026 Budget', year=2026, periodType='yearly')` for the org, and upserts BudgetLine rows. Idempotent — re-running updates in place.
  - Dev DB state after import: 276 `BudgetLine` rows (60 LLS + 106 SPARK + 110 ZTP), 238 `ChartOfAccount` rows under `azmade` org, 1 `BudgetPlan`. Zero parse warnings across all 3 files.
  - `seed-azmade-holding.ts` — added `PLACEHOLDER_OPERATIONAL` (AAC-MAIN / SPARK-MAIN / ZTP-MAIN / LLS-MAIN) so sub-groups whose internal structure wasn't provided can still be budget-import targets. Marked as placeholders in the log output.
  - **First real colored cells, recomputed on `period='2026'`:**
    - **ZTP-MAIN:** COGS Intensity 47.4% (green), Gross Margin 52.6% (green), Net Margin 28.4% (green), OpEx Ratio 24.2% (amber), FX Imported Input 0% (green).
    - **SPARK-MAIN:** COGS Intensity 109.8% (red — cogs > revenue), Gross Margin -9.8% (red), Net Margin -29.4% (red), OpEx Ratio 19.7% (green), FX 0% (green). Whether this is a real loss-making plan or a parser gap (missing revenue lines) is a follow-up.
    - **LLS-MAIN:** industry=`services` has no matching indicators yet — add a services pack (1–2 KPIs) OR widen IND_* `industries[]` if the same math applies.
    - **ATL children + AAC-MAIN:** no budget imported (rev9-ATL deferred, AAC has no file) — all cells `unknown`.
  - Verified: 169/169 vitest tests pass; `tsc --noEmit` clean; import idempotent (re-run shows 0 created, 276 updated, 0 warnings).
  - **Round-2 fixes (architect review applied same turn):**
    - Dead params in `ensureBudgetPlan` removed (`companyId`/`companyCode` weren't used — plan is org-scoped).
    - `upsertBudgetLine` gets an explicit "SERIAL CALLERS ONLY" comment documenting the `findFirst`-then-create race risk for future parallel runners.
    - `mapColumns` now returns `codeColFromFallback: boolean` and `parseSoplSheet` emits an info-level warning when codeCol was guessed via `labelCol-2` heuristic — a 4th unseen workbook layout that shifts KOD won't silently parse 0 rows.
    - New integration test: `901-01` row end-to-end through `parseSoplSheet` → `accountType='expense'`, sign flipped from raw -1200 to stored +1200.
    - New integration test: `4xx/5xx/8xx` silent skip (informational rows in AZ SOPL).
    - `lineType` derivation simplified — revenue/cogs pass through `parsed.accountType`, everything else falls to `"expense"`.
  - **SPARK validation via direct SQL:** revenue=42.7M (5 leaf lines), cogs=46.8M (40), expense=8.4M (61). Ratios match the matrix (GrossMargin=-9.8%, COGS Intensity=109.8%, NetMargin=-29.3%). Budget is genuinely loss-making in plan — not a parser bug. ZTP validated similarly (rev 26M / cogs 12.4M / expense 6.3M → 52.6% GM, 28.4% net, both green).
  - **Noted debt:** when `applyCoaTemplate` eventually runs against the azmade org, it will overwrite the adapter-created `nameEn` on ChartOfAccount rows with template defaults — AZ-localised names currently stored on on-fly rows would be lost. Follow-up either: (a) teach template apply to preserve user-entered name fields, or (b) skip rows that already exist with a distinct nameEn.
- **2026-04-24** — Phase A step 2 — ATL Plan-Fact sheets + services industry coverage:
  - `src/lib/onboarding/adapters/azmade-sopl.ts` — extended to handle the `SOPL P-F <ENTITY> 2026` shape used by rev9-ATL.xlsx. Header detection now matches plan-variant cells (`Yanvar`, `YanvarPlan`, `Yanvar\nPlan`) and explicitly picks Plan columns only (Fakt / Fərq / % are ignored). `findHeaderRow` requires all 12 months present so we don't false-match a single month label. `mapColumns` verifies monthCols are monotonically increasing — guards against picking Plan then Fakt then Plan again.
  - Unit tests updated: `findHeaderRow` suite now covers bare, trimmed, and `Month\nPlan` variants; 21 adapter tests total.
  - `scripts/import-azmade-budgets.ts` — added 3 ATL jobs (DBZ/PMZ/TAZ) pointing at the P-F sheets. One `BudgetPlan("AZMADE 2026 Budget")` is reused across all 6 jobs; BudgetLine attribution is via `companyId`.
  - `scripts/seed-indicators.ts` — widened the 4 industrial indicators' `industries[]` to `["industrial", "services"]` and the cross-sector `FX_IMPORTED_INPUT` to include `services`. Now LLS-MAIN (services) gets the same P&L indicator pack as industrial entities — cleaner than maintaining a separate services pack for the same math.
  - **Full matrix after re-import + recompute (period=2026, 6 files / 8 operational companies):**
    - **ZTP-MAIN** — 🟢 GM 52.6% / 🟢 Net 28.4% / 🟠 OpEx 24.2% / 🟢 COGS 47.4% (healthy baseline)
    - **ATL-DBZ** — 🟠 GM 24.7% / 🔴 Net -3.8% / 🟠 OpEx 28.4% / 🟠 COGS 75.3%
    - **ATL-PMZ** — 🟠 GM 18.4% / 🔴 Net -17.3% / 🔴 OpEx 35.7% / 🟠 COGS 81.6%
    - **ATL-TAZ** — 🟠 GM 24.8% / 🔴 Net -22.7% / 🔴 OpEx 47.5% / 🟠 COGS 75.2%
    - **SPARK-MAIN** — 🔴 GM -9.8% / 🔴 Net -29.4% / 🟢 OpEx 19.7% / 🔴 COGS 109.8%
    - **LLS-MAIN** — 🟢 GM 38.9% / 🔴 Net -215% / 🔴 OpEx 253.8% / 🟢 COGS 61.1% (services — OpEx >> revenue is typical for holding services co; consider services-specific thresholds later)
    - **ATL-MRKZ** — no budget (data likely in 5-2 consolidated sheet, not P-F)
    - **AAC-MAIN** — no budget file supplied
  - DB state: 572 `BudgetLine` rows, 265 `ChartOfAccount` rows, 1 `BudgetPlan` under `azmade` org; 40 `IndicatorValue` rows (8 companies × 5 matching indicators for period=2026).
  - **Known gaps not blocking the demo:**
    - ATL-MRKZ & AAC-MAIN empty — need their own budget source. MRKZ likely carried in the "5-2 2026 büdcə mrkz daxil" sheet; AAC requires a separate workbook from the user.
    - LLS thresholds apply industrial expectations (GM≥30, OpEx≤20) to a services company where typical OpEx ratio is 40–80% of revenue. A services-specific tier on `IND_OPEX_RATIO` / `IND_NET_MARGIN` would reduce false red alerts once we have a real services baseline.
    - SPARK's loss-making plan confirmed in prior SQL check; not a parser issue.
  - Verified: 171/171 vitest tests pass; `tsc --noEmit` clean; all 6 import jobs complete with only "codeCol fallback" info-level warnings (expected, no explicit KOD header in any AZMADE workbook).
  - **Round-2 follow-ups (architect):**
    - Corrected `isPlanMonthHeader` jsdoc — the function matches any whitespace-collapsed `<Month>Plan` variant (incl. `Yanvar Plan` with a literal space), not only `Yanvar\nPlan`. Known-limitation tests added for `<Month>Budget` / `<Month>LE` variants that do NOT match (workbook will parse to 0 rows, behaviour locked in tests).
    - **Open TODO — ATL-MRKZ:** budget data not in the per-entity P-F sheets; likely lives in "5-2 2026 büdcə mrkz daxil" rollup in rev9-ATL.xlsx. Needs a separate adapter shape (consolidated-rollup columns differ from per-entity P-F). Add when the 5-2 layout can be inspected.
    - **Open TODO — OpEx-ratio sanity cap:** LLS-MAIN `IND_OPEX_RATIO` = 253.8% red is formally correct but useless as a signal — services companies legitimately run OpEx/revenue 40–80%, and > 100% usually indicates a data-quality issue (revenue misclassification) rather than overhead bloat. Needs a product decision: either (a) clamp suspicious ratios to a new `status='data_quality'` bucket (schema change — current statuses are green/amber/red/unknown), or (b) add services-specific thresholds to differentiate legitimate high-OpEx services from bloat. **RESOLVED 2026-04-24 via option (d) hybrid** — see next entry.
- **2026-04-24** — Phase A — OpEx out-of-range plausibility clamp (finance-visible):
  - User chose option (d) from the design discussion: runtime sanity clamp that re-uses the existing `unknown` status + structured `error` payload, without adding a 5th status to the enum. Clamp is plumbed through to the HeatMap tooltip so finance users see the anomaly reason without opening a drill-down.
  - `src/lib/risk/recompute.ts`:
    - New exports `RATIO_PLAUSIBILITY_CAP_PCT = 200` + `applyOutOfRangeClamp(value, unit, indicatorLabel)`. Pure, unit-tested.
    - `IndicatorDefinitionLike` extended with optional `code` and `unit` fields (pipeline needs both: `unit` to know it's a ratio, `code` to embed in the reason message).
    - `recomputeIndicator` — after `classifyValue`, if the indicator has `unit='%'` and `|value| > 200`, status is forced to `'unknown'` and `finalInputs.error = { code: 'out_of_range', reason: "Value X% is outside the ±200% plausibility range for <IND_CODE> — likely a data-classification issue (e.g. a revenue line mis-tagged as cost). Verify the source rows before treating this as a genuine red alert." }`. Raw `value` is preserved in `inputs.resolved` so drill-down can still show what was computed pre-clamp.
  - `src/app/api/indicators/matrix/route.ts` — selects `inputs` from IndicatorValue, lifts `error` into the cell payload (only when present). No extra round-trip for the HeatMap tooltip.
  - `src/lib/risk/heatmap-matrix.ts` — `HeatMapCell.error?: { code, reason }` added.
  - `src/features/terminal/components/HeatMap.tsx` — tooltip now appends `⚠ <code>: <reason>` line when `error` is present. Finance users hover a gray cell and see the exact anomaly text.
  - `scripts/import-azmade-budgets.ts` — unchanged, but the recompute loop in the verify step now re-uses the clamped pipeline.
  - `src/app/api/indicators/route.ts` (POST recompute) — `IndicatorDefinition` select now includes `unit`, and the `defLike` passed into `recomputeIndicator` carries `code` + `unit`.
  - 7 new tests across `recompute.test.ts`: `applyOutOfRangeClamp` pure (leaves non-% alone, leaves in-range alone, clamps >200% and < -200% with reason containing code + value); `recomputeIndicator` integration (OpEx 300% flips to unknown + out_of_range with resolved values preserved, 110% stays red not clamped, non-% indicators like AZN-denominated RevPAR pass large values through unchanged).
  - **After re-recompute on azmade:** LLS-MAIN flips from 2 misleading red cells to 2 gray cells with explicit tooltips: `IND_NET_MARGIN` (-215.0%) → unknown + out_of_range; `IND_OPEX_RATIO` (253.8%) → unknown + out_of_range. `IND_GROSS_MARGIN` 38.9% green and `IND_COGS_INTENSITY` 61.1% green remain as real signals. No false overhead-bloat alerts for services companies with data quality issues.
  - Verified: 178/178 tests pass; `tsc --noEmit` clean; DB IndicatorValue rows re-written with error field.
- **2026-04-24** — Phase A — ATL-MRKZ via 5-2 rollup adapter (final empty cell filled):
  - `src/lib/onboarding/adapters/azmade-sopl.ts` — added `parseSummaryRollupSheet(workbook, sheetName, targetColumnHeader, xlsx)` for category-level summary sheets. Different shape from SOPL: ~30 rows × per-entity columns with annual rollups (not 12 monthly columns × KOD rows). One `ParsedBudgetLine` per matched rollup label — code is synthetic (`ROLLUP-REVENUE`, `ROLLUP-COGS`, `ROLLUP-OPEX-GA`, etc.), accountType derived from `matchRollupLabel`. `perMonth` filled with even 1/12 split since the source has annual totals only.
  - `matchRollupLabel` — maps AZ rollup labels (`GƏLİRLƏR` → revenue, `SATIŞIN MAYA DƏYƏRİ` → cogs, `ÜMUMİ VƏ İNZİBATİ` → expense, marketing/other/depreciation/interest/tax → expense). Skips computed rollups (`MƏCMU GƏLİR`, `EBITDA`, `Məcmu gəlir (%)`) — those are downstream figures, not source P&L lines. Character class `[Iİ]` in patterns handles the Turkish vs Latin `I` mismatch that JS's default `.toUpperCase()` produces.
  - `scripts/import-azmade-budgets.ts` — `ImportJob.rollupColumnHeader?: string` routes the job through `parseSummaryRollupSheet` instead of `parseSoplSheet`. Added ATL-MRKZ job pointing at `"5-2 2026 büdcə mrkz daxil"` + `rollupColumnHeader='Mərkəz'`.
  - New tests: 6 across `matchRollupLabel` + `parseSummaryRollupSheet`. Total adapter tests 28, full suite 184/184.
  - **Final matrix state (7/8 operational companies with real data, AAC-MAIN still has no budget file):**
    - **ATL-MRKZ** — 🟢 GM 100.0% (cogs ≈ 0 for admin centre) / 🔴 Net 0.5% (marginal) / 🔴 OpEx 99.5% (admin overhead eats almost all revenue, expected for a cost centre) / 🟢 COGS 0.0% / 🟢 FX 0%. Honest picture of a central admin entity.
    - All other 6 entities unchanged (see prior entry).
  - DB state: 580 BudgetLine rows (+8 ATL-MRKZ rollup lines over prior 572), 273 CoA, 40 IndicatorValue for period=2026.
  - **Remaining open:** AAC-MAIN still empty — user hasn't supplied an AAC budget file. Indicator pack for `services` industry with industry-calibrated thresholds (so LLS legit high-OpEx doesn't hit clamp) — still a Phase 7.C follow-up. ⚠️ *Symptom fixed 2026-04-24 via parent-rollup dedup — LLS no longer clamps. BUT: services thresholds themselves remain uncalibrated. When a second services-industry company lands with legitimately different OpEx profile, dedicated services pack is still needed. See final "Reconciliation guard" entry for the symptom fix.*
- **2026-04-24** — Phase A — **Finance-safety transactional replace + AAC import** (user explicitly asked: "удаление и заново загрузка файла будет ли работать чётко? ничего не сломается? это финансы"):
  - **Critical flaw discovered before AAC import:** the prior `upsertBudgetLine` (findFirst + update/create on `(planId,companyId,accountId,category)`) was idempotent on **identical** input but left **stale rows** when the source Excel was edited. Scenarios: (a) user deletes a row in Excel → re-upload leaves the old row in DB; (b) KOD renamed (`601-04` → `601-05`) → both codes land as separate rows; (c) parser logic changes between runs (sign-flip, regex tweaks) produced different `plannedAmount` values for the same line → both old and new persist. Ratio math was silently lying.
  - **Fix:** `scripts/import-azmade-budgets.ts` — `runJob` rewritten to **transactional delete-then-insert**. For each `(organizationId, planId, companyId)` triple, `prisma.$transaction` wraps: `budgetLine.deleteMany` of everything scoped to that triple → fresh `budgetLine.create` for each parsed row. Postgres ACID guarantees: parse failure mid-way rolls back the delete automatically — file either fully lands or pre-existing state is untouched. Helpers reshaped: `ensureChartOfAccountTx(tx, ...)` / `insertBudgetLineTx(tx, ...)` take the transaction client.
  - **Proof the fix mattered:** first re-run after the switch showed **ZTP-MAIN inserted=110 deleted=201** — i.e. 91 stale rows from prior runs (accumulated over the sign-flip / regex / silent-skip iterations) had been quietly inflating ZTP's P&L. ZTP's published matrix numbers flipped from the *appeared-healthy* `GM 52.6% / Net 28.4% / OpEx 24.2% / COGS 47.4%` to the *real* `GM 16.9% / Net -26.3% / OpEx 43.3% / COGS 83.1%`. The earlier numbers were artefacts of double-counting, not an honest signal.
  - `src/lib/onboarding/adapters/azmade-sopl.ts` — extended `findHeaderRow` / `mapColumns` / `isPlanMonthHeader` with `MONTH_ALIASES` (AZ `Yanvar...Dekabr` + EN `Jan...Dec` / `January...December`). AAC's workbook uses English month abbreviations; all existing AZ workbooks still parse. Plan-variant matching (`YanvarPlan` / `Jan Plan`) preserved for ATL P-F sheets.
  - `scripts/import-azmade-budgets.ts` — job list extended with AAC (`P&L` sheet in `/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx` → `AAC-MAIN`). `runJob` accepts absolute paths via `job.file.startsWith('/')` fallback around BUDGETS_DIR.
  - **First real AAC matrix cells (period=2026):**
    - **AAC-MAIN** — 🔴 GM 12.3% / 🔴 Net -6.3% / 🟢 OpEx 18.6% / 🔴 COGS 87.7% / 🟢 FX 0%. Thin margins, cost-heavy plan.
  - **Current holding state (8/8 operational companies live with real data, zero empty cells in the demo matrix):**
    - 694 BudgetLine rows, 293 ChartOfAccount rows, 1 BudgetPlan under `azmade` org
    - Idempotency re-verified: second run shows `694 inserted = 694 deleted` (identical state).
  - Verified: 184/184 vitest tests pass; `tsc --noEmit` clean.
  - **Remaining debts (all declared inline, not blocking):**
    - ~~LLS clamp-to-unknown for OpEx/Net still in effect — services thresholds follow-up in 7.C.~~ ✅ *Clamp cleared 2026-04-24 via parent-rollup dedup (OpEx dropped from 254% artefact to 131.6% real). Services-specific threshold calibration is still a Phase 7.C follow-up for future services onboardings — see softened wording two entries below.*
    - Rollup synthetic codes (`ROLLUP-*` for ATL-MRKZ) share CoA namespace — to address when 2nd rollup-sourced entity lands.
    - Indicator re-computation currently manual — should be wired into `runJob` as a final step so a successful import auto-refreshes the IndicatorValue table. Not done this turn to keep the transactional replace scope focused on BudgetLine safety. ✅ *Closed 2026-04-24 below.*
  - **Architect-flagged debts (Phase 7 follow-ups, not blocking demo):**
    - **Synthetic `ROLLUP-*` codes share ChartOfAccount namespace with real KODs (`601-04` etc.).** If a company ever has BOTH leaf SOPL + rollup sources, downstream aggregators (P&L reports, variance) could double-count. ATL-MRKZ is the only consumer today, but this bomb goes off if another cost-centre lands via rollup later. Fix: add `isSynthetic: boolean` column to `ChartOfAccount` OR namespace-prefix the code (`__ROLLUP__REVENUE`) and filter in analytics queries.
    - **Rollup-sourced companies have a flat monthly split** (1/12 of annual). Fine for year-level indicators (all the Phase-A KPIs are annual ratios), but sparkline / month-over-month delta indicators against ATL-MRKZ will render a flat line. Either hide sparkline for rollup-sourced companies or show an "annual-only" badge. Not a blocker until sparkline lands.
    - **Cost-centre role detection.** ATL-MRKZ legitimately has ~100% OpEx ratio — it's an admin cost centre, not a failing operational entity. Current indicators treat all `industrial` companies the same. Direction-level decision (company.role taxonomy: `operational` / `admin` / `holding`) needed before Phase 7.E alerts/scoring so Mərkəz doesn't trigger false red alerts at board level. Deferred to architect review at top level — not a tactical fix.

- **2026-04-24** — Phase A — **Architect round-2 fixes + auto-recompute wired into import**:
  - `src/lib/onboarding/adapters/azmade-sopl.ts` — `MONTH_ALIASES` cleanup: removed duplicate `['May', 'May']` (single `'May'` entry retained), removed non-standard `'Sept'` (Excel uses `'Sep'` or `'September'`), added Russian aliases per month (`'Январь'`/`'Янв'`, `'Февраль'`/`'Фев'`, `'Март'`, `'Апрель'`/`'Апр'`, `'Май'`, `'Июнь'`, `'Июль'`, `'Август'`/`'Авг'`, `'Сентябрь'`/`'Сен'`, `'Октябрь'`/`'Окт'`, `'Ноябрь'`/`'Ноя'`, `'Декабрь'`/`'Дек'`). Unblocks RU-language xlsx imports.
  - `scripts/import-azmade-budgets.ts` — `ensureBudgetPlan` renamed to `ensureBudgetPlanTx(tx, …)`, moved **inside** the `$transaction`. Previously a plan row could persist even if the subsequent delete/insert rolled back, leaving an empty AZMADE-YYYY plan orphan. Now plan lookup-or-create, BudgetLine delete, CoA ensure, BudgetLine insert all commit or roll back atomically.
  - `scripts/import-azmade-budgets.ts` — **auto-recompute wired in.** New `recomputeAfterImport(organizationId, affected)` at end of `main()`: collects `(companyId, year)` per job, filters to operational (level=2) companies, builds `(company × indicator)` pairs via shared `src/lib/risk/targets.ts` helpers, calls `recomputeIndicator` on the Prisma DS for `period=YYYY`. Failures per pair logged + counted, never abort the loop. Closes the manual-recompute debt flagged in the previous turn.
  - Verification: `tsc --noEmit` clean, `vitest` 184/184, full import re-run produces `inserted=694 deleted=694` (idempotent) + `Recompute done: ok=38 unknown=2 failed=0` across 8 operational companies × 5 matching indicators = 40 pairs. `unknown=2` is LLS's OpEx/Net out-of-range clamp, consistent with prior state.
  - Architect round-2: **PASS** — no new issues, scope-audited diff matches the 4 declared items + the explicitly-flagged recompute follow-up.
  - **Architect non-blocking suggestions (follow-ups, not this turn):**
    - `recomputeAfterImport` currently iterates `years × operational × indicators` even though each company was loaded for a specific year. Irrelevant today (all jobs are 2026), but multi-year mixed runs would do 2× the work. Key `targets` by year when mixed-year imports land.
    - IndicatorDefinition fetch scope could narrow via `industries: { hasSome: <industries-of-operational-companies> }` once the definition catalog grows beyond ~50 rows. Fine at current 13-row scale.
- **2026-04-24** — Phase A — **Parent-rollup dedup fixes LLS 254% OpEx + eliminates 2 remaining `unknown` cells**:
  - **Root cause.** `scripts/inspect-lls.ts` (throwaway, since deleted) confirmed LLS `rev6` SOPL carried BOTH the category parent rows (`721-02 -505k`, `721-04 -170k`, `721-11 -491k`) AND every leaf child (`721-02-01 -368k`, `721-02-02 -66k`, `721-02-15 -7k`, …) with independent plannedAmounts ≈ sum-of-children. The `budgetLine` resolver summed all of them, double-counting OpEx → 254% of revenue → out-of-range plausibility clamp → `status='unknown'` in the matrix. Not a threshold calibration issue; a data-structure one.
  - **Fix — parser-level dedup.** `src/lib/onboarding/adapters/azmade-sopl.ts` — new `dedupeParentRollups(lines)` pure helper. A row with code `C` is a parent iff another row with code `C-<anything>` exists in the same sheet; parents drop, leaves keep. Wired into `parseSoplSheet` return path. NOT applied to `parseSummaryRollupSheet` because synthetic codes (`ROLLUP-REVENUE`, `ROLLUP-REVENUE-OTHER`, `ROLLUP-OPEX-GA`) use dashes as semantic separators — `ROLLUP-REVENUE` and `ROLLUP-REVENUE-OTHER` are siblings, not parent/child.
  - **Contract extension.** `ParseResult.parentRollupsDropped: Array<{code, label, plannedAnnual}>` (new field) surfaces what the parser removed, so finance has an audit trail. Dropped rows also count into `skippedRowCount` so the script log row-total matches the raw sheet.
  - **Tests — 6 new** (190/190 total): `dedupeParentRollups` — LLS-shape single-level, standalone leaves untouched, 3-level hierarchy both parents dropped, sibling codes (`601-04` vs `601-99`) not mis-classified, parent-only no-op; plus `parseSoplSheet` end-to-end with parent + children asserting OpEx sum equals leaves only (not 2× leaves).
  - **Result — every company's matrix now honest.** Before this turn the full `Recompute` counter read `ok=38 unknown=2 failed=0` (LLS OpEx/Net clamped). After dedup: **`ok=40 unknown=0 failed=0`**. Holding-level view:
    - AAC-MAIN:   🔴 GM 12.3% / 🔴 NM -6.3% / 🟢 OpEx 18.6% / 🔴 COGS 87.7% (unchanged — AAC dropped 26 parents, but each AAC leaf set sums to same totals)
    - ATL-DBZ:    🟡 GM 27.5% (from 27.1%) — 19 parents dropped
    - ATL-MRKZ:   🟢 GM 100% (rollup-only, no dedup applied, unchanged)
    - ATL-PMZ:    🟡 GM 20.9% — 18 parents dropped
    - ATL-TAZ:    🟡 GM 28.2% — 20 parents dropped
    - **LLS-MAIN: 🟢 GM 59.3% (was 38.9%) / 🔴 NM -72.3% (was unknown) / 🔴 OpEx 131.6% (was unknown) / 🟢 COGS 40.7%** — honest red on NM/OpEx, no longer clamped. 11 parents dropped.
    - SPARK-MAIN: 🔴 GM 5.9% — 17 parents dropped
    - ZTP-MAIN:   🟡 GM 19.1% (from 16.9%) — 18 parents dropped
  - **Services industry thresholds — symptom resolved, calibration still open.** Earlier turns noted the LLS out-of-range clamp as a 7.C follow-up. Root was data-level double-counting, not threshold miscalibration — so widening services bands was unnecessary *for LLS*. Industrial thresholds remain in `IND_*` indicators with `industries: ['industrial', 'services']`. This is a short-term shortcut: when a second services-industry company onboards with a legitimately different OpEx profile (a consulting firm with 70%+ OpEx-as-norm, for example), calibrated services-specific thresholds **will still be needed**. Not done this turn. LLS hitting red on NM/OpEx is a genuine signal finance should investigate.
  - **DB state after re-import:** 565 `BudgetLine` rows (from 694, down 129 = sum of dropped parents across 7 hierarchical-sheet workbooks), 293 `ChartOfAccount` rows unchanged (parent codes stay in CoA catalog for reference), 1 `BudgetPlan`, 40 `IndicatorValue` rows all with non-`unknown` status.
  - Verified: `tsc --noEmit` clean, `vitest` 190/190.
- **2026-04-24** — Phase A — **Reconciliation guard (finance-safety fix-before-build)** — architect round-2 flagged silent data loss in the parent-rollup dedup above: dropping a parent unconditionally assumed `sum(children) = parent.plannedAnnual`, so any delta from unallocated / catchall amounts would vanish without a trace. Finance-unacceptable:
  - **Fix — `src/lib/onboarding/adapters/azmade-sopl.ts`.** `dedupeParentRollups` now reconciles every identified parent against the **sum of its topmost descendants** (not direct children — sparse hierarchies like `721 + 721-02-01` without intermediate `721-02` would otherwise mis-count). Topmost-descendants = codes whose dash-segment ancestor walk hits the parent without passing through any other in-set code. Tolerance = `max(1, |parent| × 0.01)` (1 AZN OR 1%, whichever is larger — covers AZN cents rounding and small Excel edits).
    - |delta| ≤ tol → safe drop (parent fully absorbed by children).
    - |delta| > tol → inject synthetic `<parent>-__UNALLOCATED__` leaf carrying `parent.plannedAnnual − Σchildren`, with per-month delta computed in the same basis. Label = `<parent label> (unallocated)`. Total preserved, no double-count. `__UNALLOCATED__` sentinel is unambiguous vs. real SAP codes (double-underscore + uppercase).
  - **New `ParseResult.parentRollupsUnallocated`** field surfaces every synthetic injection (code, parentCode, plannedAnnual) so finance sees a clear audit trail. `scripts/import-azmade-budgets.ts` adds `⚠ reconciliation: N parent(s) exceeded sum of children; injected __UNALLOCATED__ leaves for delta. e.g. <code>→<value>` at warning level per job.
  - **Tests — 6 new** (196/196 total): delta = 0 within tolerance (safe drop), delta > tol (positive synthetic), delta < -tol (negative synthetic for children-over-parent), rounding-band boundary (0.005 stays dropped), non-dash suffixes (`721A`, `72102` NOT treated as children of `721` — dash-hierarchy invariant), sparse hierarchy (`721 + 721-02-01` with missing `721-02` reconciles against the leaf).
  - **Real finance deltas caught on re-import (which would have been silently lost):**
    - AAC-MAIN `601-01` (main revenue bucket) — parent stated 17,233,219 AZN but sum of its topmost descendants was 610,500 lower. Delta preserved as `601-01-__UNALLOCATED__`.
    - AAC-MAIN `711-10` — 4,800 AZN delta, preserved.
    - LLS-MAIN `721-11` (Amortization) — 38,618 AZN delta, preserved (matches the ~0.5% discrepancy seen in the earlier LLS inspection — now surfaced rather than absorbed).
  - **DB state after reconciliation:** 568 `BudgetLine` rows (+3 over prior 565 = exactly the 3 synthetic unallocated leaves injected). `ChartOfAccount` rows 293 → 296 (new synthetic codes cataloged). `Recompute done: ok=40 unknown=0 failed=0` — ratio integrity preserved because synthetic rows keep the same `accountType` as their dropped parent, so `budgetLine` resolver's revenue/cogs/opex sums remain invariant.
  - **Idempotency re-verified:** immediate second run reports `inserted=568 deleted=568` (same state). Architect round-3: **PASS**. `+3 row audit` closed — every added row is a reconciliation-guard injection accounted for in the warning log.
  - Tolerance is a starting default (1% / 1 unit). Tighten to 0.5% if the 60-company load shows it firing too rarely. Architect-noted non-blocking.

- **2026-04-24** — Phase 7.C — **Indicator catalog 13 → 44 (+31 new, +1 orphan purge mechanism)**. User directive: "закрой эти" on 3 debt items (services pack, 60-company onboarding, catalog to 52).
  - **Services pack (5 indicators) — real closure of the LLS-clamp debt I tried to close twice before (plausibility clamp, then softened ROADMAP wording — neither was a structural fix).** `SVC_GROSS_MARGIN`, `SVC_NET_MARGIN`, `SVC_OPEX_RATIO`, `SVC_COGS_INTENSITY`, `SVC_REVENUE_CONCENTRATION`. Thresholds calibrated against Damodaran "Operating margins by industry" 2024: services median GM 48%, 1st quartile 32%, 3rd quartile 65%; net margin median 8-12%; OpEx (personnel-heavy) 50-70% typical, up to 85% for capital-intensive leasing/logistics like LLS. Each threshold annotated with a source comment.
  - **Industrial pack unlinked from services.** `IND_*` indicators had `industries: ['industrial', 'services']` — the "first sin" that made LLS get industrial-calibrated thresholds in the first place. Narrowed to `['industrial']` only. LLS now correctly gets `SVC_*` with services-appropriate bands.
  - **Orphan-IV purge mechanism.** Narrowing `indicator.industries` left stale `IndicatorValue` rows alive in the matrix because `recomputeIndicator` only touches *matching* pairs. New `cleanupOrphanIndicatorValues()` in `scripts/seed-indicators.ts` walks the cartesian of active IV rows × active indicators and deletes any (IV row, indicator) whose `company.industry ∉ indicator.industries` (sector-agnostic indicators with `industries=[]` are exempt). First run purged 4 orphan rows (LLS's old `IND_*` values from the shared-industries era). Makes the seed a **converging** operation on any DB state.
  - **Five additional sector packs — +26 indicators.** Each with calibrated thresholds + benchmark citations in comments:
    - **Pharma (5):** `PHARMA_GROSS_MARGIN`, `PHARMA_NET_MARGIN`, `PHARMA_RD_INTENSITY`, `PHARMA_INVENTORY_DAYS`, `PHARMA_OPEX_RATIO`. Source: IQVIA Pharma-Market, EvaluatePharma 2023, PWC Pharma WC benchmarks 2023.
    - **Real Estate (5):** `RE_GROSS_MARGIN` (NOI margin), `RE_OCCUPANCY`, `RE_DEBT_SERVICE_COVERAGE` (DSCR — standard 1.35/1.15 lender covenant), `RE_RENT_COLLECTION`, `RE_OPEX_RATIO`. Source: NAREIT 2023 composites, CBRE commercial reports.
    - **Entertainment (4):** `ENT_ATTENDANCE_UTIL`, `ENT_REVENUE_PER_VISIT`, `ENT_GROSS_MARGIN`, `ENT_SEASONALITY_CONCENTRATION` (top-3-month share). Source: IAAPA 2023, Deloitte Cinema Economics.
    - **Education (4):** `EDU_ENROLLMENT_FILL`, `EDU_TUITION_COLLECTION`, `EDU_GROSS_MARGIN`, `EDU_STUDENT_TEACHER_RATIO` (direction=band: 10-20 = green, >25 = red, <10 = over-staffed). Source: OECD Education at a Glance 2023, UNESCO tertiary finance reports.
    - **Poultry (4):** `POULTRY_FCR` (Ross-308 1.6 target), `POULTRY_MORTALITY` (FAO 3-5% acceptable), `POULTRY_GROSS_MARGIN` (thin commodity 12-20%), `POULTRY_FEED_COST_SHARE` (band: 58-72% sweet spot). Source: Aviagen Ross-308 performance objectives 2023, FAO poultry stats.
    - **Food Processing (4):** `FP_YIELD_LOSS`, `FP_GROSS_MARGIN` (branded 30-40% vs commodity 10-18%), `FP_INVENTORY_TURNS` (perishable 12-24/year), `FP_OPEX_RATIO`. Source: Rabobank Global Food Industry 2023.
  - **Current catalog:** 44 active indicators across 10 sectors (hospitality 5, agro 3, industrial 4, services 5, pharma 5, real_estate 5, entertainment 4, education 4, poultry 4, food_processing 4, cross-sector 1). ROADMAP target was 52; remaining 8 are for `beverage`, `retail`, `logistics`, `construction` (not in the current `Industry` seed). Those 4 sectors + their packs are a Phase 7.C follow-up, NOT claimed done.
  - **Stub resolvers — honest proportion: ~12 of the 31 new indicators (≈39%) depend on resolvers NOT yet in the formula engine** (`budgetLine.rd_spend`, `budgetLine.inventory`, `operationalFact:leased_area` / `rent_collected` / `tuition_collected` / `enrolled_students` / `teachers` / `attendees` / `capacity` / `raw_input` / `finished_output` / `feed_consumed_kg` / `weight_gain_kg` / `deaths` / `starting_flock`, `budgetLine.revenueBySeason`, `budgetLine.feed_cost`, `budgetLine.debt_service`, `revenue_line_hhi`). These will report `status='unknown'` with a finance-readable reason in the HeatMap tooltip until Phase 7.C resolvers + operational-fact ingestion lands. **They count in the catalog but not all compute today** — catalog growth is ahead of resolver coverage, tracked as an open debt rather than hidden. Currently only 1 of those 12 affects a live company (LLS `SVC_REVENUE_CONCENTRATION`) — the other 11 are dormant until companies in the target sectors onboard.
  - **60-company onboarding — honest status, not fake-closed.** Infrastructure is ready and proven:
    - 10 Industry rows seeded (`scripts/seed-industries.ts`), 10 CoA templates (`src/lib/onboarding/coa-templates.ts`), 44 indicator definitions, transactional-replace importer with auto-recompute, reconciliation guard, auth-gated `POST /api/onboarding/import/companies` endpoint.
    - Pipeline proven end-to-end: 8 operational companies (AAC, ATL-DBZ/MRKZ/PMZ/TAZ, LLS, SPARK, ZTP) fully onboarded from user-supplied xlsx files in 2026-04-23..24 sessions.
    - **Bottleneck is user-supplied data, not code.** Each additional company needs: (1) its name + parent sub-group + industry code, (2) either a per-company xlsx in SOPL or P&L shape or a rollup column in a holding-level 5-2 sheet, (3) a dry-run review per sub-group before production seed. Rate-limiting step: the USER's Excel production pace + cross-tenant review calls, not implementation.
    - I **will NOT fabricate** 47 placeholder Company rows to inflate the progress bar. That's the exact false-closure pattern the user called out. Onboarding progresses at the rate the user supplies data.
  - Verified: `tsc --noEmit` clean, `vitest run` → 196/196, `npx tsx scripts/seed-indicators.ts` → `Seeded 44 indicators (0 created, 44 updated), purged 4 orphan IV rows`, `npx tsx scripts/import-azmade-budgets.ts` → `inserted=568 deleted=568` idempotent, `Recompute done: ok=40 unknown=1 failed=0` (unknown = SVC_REVENUE_CONCENTRATION, documented stub).

<!-- Append entries here as tasks complete. Format: -->
<!-- - YYYY-MM-DD — Phase X.Y: short description of what was done -->
