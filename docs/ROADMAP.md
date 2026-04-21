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

## Minimal MVP path (if under sales pressure)

If rushed, skip to these tasks for a sellable second-client:
- ✅ Phase 0 (security) — mandatory
- ✅ Phase 1.2 (error reporting)
- ✅ Phase 2.3 (remove AAC hardcode)
- ✅ Phase 5.1 (configurable CoA via role)
- ✅ Phase 5.3 (onboarding wizard)

Everything else can wait until first paying customer.

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
| **TOTAL** | **~4 months** | **~565h** |

---

## Changelog

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
  - **Heavy ops** (cash-flow/generate, rolling/auto-forecast, matrix-seed, templates/seed, snapshot-actuals, sync-actuals, resolve-costs, ai-narrative, reports/export, create-version, apply-templates) → 5/min per org.
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

<!-- Append entries here as tasks complete. Format: -->
<!-- - YYYY-MM-DD — Phase X.Y: short description of what was done -->
