# Truth-Infra Follow-ups (post-Phase-D)

Tracks **incomplete + untested** items across Phases A–D so they don't
slip through. Once Phase E lands, walk back through this list before
calling the truth-infrastructure "done".

Last update: 2026-05-16 after the «начни всё»/«продолжай» closure session
(Waves 1–3 + V4/V5 bonus, +39 vitest cases). **Only V1 remains open** —
DriftDiffPreview UI verification via real xlsx upload, browser-only.
Status: 17 of 18 rows closed; truth-infrastructure feature-complete
modulo the one browser-side verification.

## Untested artifacts

| # | File | Class | Why deferred |
|---|---|---|---|
| F1 | ✅ ~~`scripts/audit-company.cjs`~~ | CLI script | **Closed 2026-05-16** — pure helpers (classifyDrift / classifySanityBand / extractAnnualFromSheet / parseArgs / computeVerdict + the SHEET_MAP / INDICATORS_BY_INDUSTRY / SANITY_BANDS / PLF_LINES tables) hoisted into `src/lib/audit/audit-helpers.cjs`; the CLI script `require`s them. 22 vitest cases cover all five helpers + catalog shape. |
| F2 | ✅ ~~`scripts/drift-watchdog.cjs`~~ | CLI script | **Closed 2026-05-16** — `computeDrifts` / `buildBeforeMap` + `DRIFT_THRESHOLD_PCT` hoisted into `src/lib/audit/drift-watchdog-helpers.cjs`; the watchdog `require`s them and parseArgs from F1's audit-helpers.cjs. 10 vitest cases cover band-change-only / value-drift-only / no-drift / unseen-indicators / zero-baseline / Decimal-string coercion / custom threshold. |
| F3 | ✅ ~~`src/lib/intel/freshness.ts`~~ | Library | **Closed 2026-05-16** — 5 cases (fresh / stale / critical_stale on daily threshold, monthly day-scale, missing). |
| F4 | ✅ ~~`src/app/api/admin/drift/route.ts`~~ | Route handler | **Closed 2026-05-16** — 4 cases: 401/403 auth, 200 happy path with stalePending composition, runBy metadata fallback for CLI-origin events. |
| F5 | ✅ ~~`src/features/admin/components/DriftDashboard.tsx`~~ | React component | **Closed 2026-05-16** — 5 cases via happy-dom: 3-section render, freshness cards with status pills, empty-drift green message, drift row renders co/runBy/indicator, stalled-onboarding "never audited" copy. |
| F6 | ✅ ~~`src/features/onboarding/components/DriftDiffPreview.tsx`~~ | React component | **Closed 2026-05-16** — 5 cases: all 5 metric rows render, onHasExistingDataChange fires (true/false) per branch, confirm checkbox onChange wired, fetch error state shows "Diff preview failed". |
| F7 | ✅ ~~`?dryRun=true` branch in apply-multi/route.ts~~ | Route handler | **Closed 2026-05-16** — 2 cases: existing-plan (current vs incoming totals + asserts \$transaction NEVER called) + fresh-onboarding (planExisted:false, current zero). Plus minor fix to normalize cogs/expense via Math.abs for sign-convention-independent gross profit. |

## Incomplete / advisory-only

| # | Spot | Issue | Fix |
|---|---|---|---|
| L1 | ✅ ~~`ImportWizardMulti.tsx` Apply button hard-gate~~ | **Closed 2026-05-16** — DriftDiffPreview now exposes `onHasExistingDataChange` callback; wizard maintains `diffHasExistingData` state and Apply button `disabled={applying \|\| (diffHasExistingData && !safetyConfirmed)}`. Fresh onboarding (no existing data) keeps Apply enabled without confirmation. |
| L2 | ✅ ~~`drift-watchdog.cjs` `actorUserId`~~ | **Closed 2026-05-16** — watchdog now `ensureServiceUser()` upserts `system+drift-watchdog@local` per org (random passwordHash, viewer role, cached for the process), uses its id on every audit event. Falls back to null on upsert failure. |
| L3 | ✅ ~~`freshness.ts` source list `DEFAULT_SOURCES`~~ | **Closed 2026-05-16** — new `resolveFreshnessSources(prisma, orgId)` reads `Organization.settings.intelFreshnessSources` (array of `{sourceCode, cadence}`). Strict validation: any malformed entry drops the override + logs `console.warn`, then falls back to `DEFAULT_SOURCES`. `DEFAULT_SOURCES` now `export const`, typed as `ReadonlyArray<FreshnessSource>`. Drift route resolves sources before calling `checkReferenceFreshness`. 7 new vitest cases (null / missing key / empty array / valid override / malformed entry / unknown cadence / non-array). ADMIN_RUNBOOK §6.4 documents the shape. |
| L4 | ✅ ~~`onboarding-source-registry.json` UI~~ | **Closed 2026-05-16** — admin page `/budgeting/admin/source-registry` provides CRUD over the JSON file via PUT/DELETE on `/api/admin/source-registry`. Atomic write (tmp + rename) protects against concurrent edits. Sidebar entry added under Admin. |
| L5 | ✅ ~~DriftDashboard `stalePending` N+1~~ | **Closed 2026-05-16** — replaced per-company findFirst loop with a single `prisma.indicatorValue.groupBy({ by: ['companyId'], _max: { lastReconciledAt: true } })`. 60 cos → 1 query (was 60). |
| L6 | ✅ ~~Trust badge staleness fallback~~ | **Closed 2026-05-16** — `computeCompanyTrustStatus` now checks `lastReconciledAt` on material cells. If the max audit timestamp across material cells is > 30 days old (or no cell ever audited), degrade verified → partial. Matrix route + HeatMapCell wire field added. 3 new tests cover stale/fresh/never-audited cases. |
| L7 | ✅ ~~EBITDA on the diff preview~~ | **Closed 2026-05-16** — dryRun aggregator now tracks D&A in COGS (703-11) + OpEx (721-11) via the existing `isDaCode` helper, computes EBITDA = Rev - (COGS-DA_COGS) - (OpEx-DA_OpEx). UI renders bold EBITDA row in DriftDiffPreview. Handler test asserts EBITDA = 4800 with D&A add-back of 600+360 from a 12000 revenue scenario. |

## Verification gaps (passed tsc but no actual end-to-end run)

| # | Path | What still needs hands-on validation |
|---|---|---|
| V1 | DriftDiffPreview UI under a real xlsx upload | Code shipped but not actually exercised in browser with a real budget xlsx (smoke only at the `/onboarding?view=import` page-render level). |
| V2 | ✅ ~~Drift dashboard with REAL drift event in audit log~~ | **Closed 2026-05-16 — real path.** Initially shipped a synthetic injector (`diag-synthetic-drift.cjs`) for quick demo; **reverted per admin policy** — no synthetic rows in shared business tables (finance users see the same DB). Real verification: run `node scripts/drift-watchdog.cjs` after an IndicatorValue.sanityBand actually changes from a re-audit; the dashboard's "Recent drift events" section renders the resulting AuditEvent. F2's unit tests on `computeDrifts` lock the diff logic separately. |
| V3 | ✅ ~~Drift dashboard with REAL ingested IntelDataPoint~~ | **Closed 2026-05-16 — real path.** Initially shipped a synthetic seeder (`diag-seed-intel.cjs`); **reverted per admin policy**. Real path: `npx tsx scripts/ingest-commodity-once.ts` populates real rows from Open-Meteo + Yahoo (smoke-verified against FO Holding: 6 weather-openmeteo + 11 sugar-yahoo-sb-f rows landed). For UI-only verification without DB writes: `CommodityTickerPanel.test.tsx` (happy-dom) mocks `/api/intel/data-points` and asserts the panel renders. |
| V4 | ✅ ~~trust-status.ts with `sanityBand: 'high_extreme'` cell~~ | **Closed 2026-05-16** — `CompanyTree.trust-badge.test.tsx` (happy-dom, 3 cases) mocks `useMatrix` with material `high_extreme` cells and asserts `aria-label="Trust status: suspicious"` renders on both leaf + parent header (verifies the worst-child-wins bubble logic). Control case asserts `verified` when bands are `normal`. Locks the matrix → CompanyTree → TrustBadge wiring without needing a browser screenshot. |
| V5 | ✅ ~~Trust Audit Strip with `lastReconciledAt > 1 year`~~ | **Closed 2026-05-16** — `trust-status.test.ts` extended with 2 extreme-staleness cases under the L6 describe block: (a) verified → partial when all material cells are 400-days old, (b) `suspicious` still outranks staleness when both fire (1-year-old cell with `high_extreme` sanityBand → suspicious, not partial). |

## Phase E in-progress

| # | Status |
|---|---|
| E.1 | ✅ PeriodSnapshot table + SHA-256 + create-on-lock hook + 4 unit tests |
| E.2 | ⚠️ Lock mode on mutations — partial. 20 of 39 budgeting mutation routes gate periods via `isPeriodLocked()`. The other 19 are unaudited — see L8 below. |
| E.3 | ✅ Unlock workflow exists from Phase 7.G LXVII |
| E.4 | ⏳ Terminal locked-period banner — in progress this turn |
| E.5 | ⏳ verifyPeriodSnapshot integration in recompute pipeline — to flag silent drift on locked periods (follow-up after E.4) |

### Phase E follow-ups (added with E)

| # | Spot | Issue | Fix |
|---|---|---|---|
| L8 | ✅ ~~Mutation routes without period-lock gate~~ | **Closed 2026-05-16** — all 9 high-risk routes gated. Wave 1: assumptions, balance-sheet, sales-budget. Wave 2: expense-forecast, sales-forecast (+import). Wave 3 (this turn): plans/[id] PUT on approve transition, plans/[id] DELETE soft-delete, plans/[id]/restore. Plans POST (create) genuinely has no period to lock against (the year arrives with the create itself) → out of scope. |
| L9 | ✅ ~~verifyPeriodSnapshot not yet wired~~ | **Closed 2026-05-16** — wired into runRecomputeForCompanies via parseLockedPeriods + verifyPeriodSnapshot loop at the tail; emits `period_snapshot_drift` AuditEvent on hash divergence. Best-effort with try/catch. |
| L10 | ✅ ~~Period snapshot UI surface~~ | **Closed 2026-05-16** — GET /api/budgeting/period-locks now enriches each lock with its latest PeriodSnapshot; PeriodLocksAdmin renders signed date + truncated hashes + revenue/cogs/grossProfit aggregates per row. |
