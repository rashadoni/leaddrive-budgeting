# Truth-Infra Follow-ups (post-Phase-D)

Tracks **incomplete + untested** items across Phases A–D so they don't
slip through. Once Phase E lands, walk back through this list before
calling the truth-infrastructure "done".

Last update: 2026-05-16 after Phase E starts.

## Untested artifacts

| # | File | Class | Why deferred |
|---|---|---|---|
| F1 | `scripts/audit-company.cjs` | CLI script | Smoke-tested manually on AZSEKER cluster; no Vitest fixture. Need: mock-DB test that asserts drift-major / suspicious verdicts trigger correctly. |
| F2 | `scripts/drift-watchdog.cjs` | CLI script | Smoke-tested with the AzərŞəkər registry (0 drifts). No fixture for "drift detected" path — need a fake xlsx with mutated values + assert audit_log entry is emitted. |
| F3 | ✅ ~~`src/lib/intel/freshness.ts`~~ | Library | **Closed 2026-05-16** — 5 cases (fresh / stale / critical_stale on daily threshold, monthly day-scale, missing). |
| F4 | `src/app/api/admin/drift/route.ts` | Route handler | No handler test. Need: cross-tenant isolation + correct enrichment of `actor` and `company` joins + correct shape of stalePending output. |
| F5 | `src/features/admin/components/DriftDashboard.tsx` | React component | No vitest. Could mount with stubbed fetch + assert 3 sections + freshness chips render. |
| F6 | `src/features/onboarding/components/DriftDiffPreview.tsx` | React component | No vitest. Needs: mock fetch dryRun response → assert diff table renders + confirm checkbox toggles. |
| F7 | ✅ ~~`?dryRun=true` branch in apply-multi/route.ts~~ | Route handler | **Closed 2026-05-16** — 2 cases: existing-plan (current vs incoming totals + asserts \$transaction NEVER called) + fresh-onboarding (planExisted:false, current zero). Plus minor fix to normalize cogs/expense via Math.abs for sign-convention-independent gross profit. |

## Incomplete / advisory-only

| # | Spot | Issue | Fix |
|---|---|---|---|
| L1 | ✅ ~~`ImportWizardMulti.tsx` Apply button hard-gate~~ | **Closed 2026-05-16** — DriftDiffPreview now exposes `onHasExistingDataChange` callback; wizard maintains `diffHasExistingData` state and Apply button `disabled={applying \|\| (diffHasExistingData && !safetyConfirmed)}`. Fresh onboarding (no existing data) keeps Apply enabled without confirmation. |
| L2 | `drift-watchdog.cjs` `actorUserId` | Set to `null` because CLI runs without a session. Production needs a service-account User row to associate with so audit-log filtering by user works. | Create `User.email='system+drift-watchdog@local'` once at setup; pass its id via env or CLI flag. |
| L3 | `freshness.ts` source list `DEFAULT_SOURCES` | Hard-coded array of 5 source codes. New adapters require a code change. | Move to org-settings JSON or a `IntelDataSource` config table. |
| L4 | `onboarding-source-registry.json` | Hand-maintained mapping `company_code → xlsx_path`. Falls out of sync if user moves files. | UI to edit the registry from `/budgeting/admin/onboarding` (right now you edit JSON by hand). |
| L5 | DriftDashboard `stalePending` query | N+1 — for each company, fetches its most recent IV separately. Fine at 20 cos, slow at 60. | Single grouped query OR materialize on a periodic job. |
| L6 | ✅ ~~Trust badge staleness fallback~~ | **Closed 2026-05-16** — `computeCompanyTrustStatus` now checks `lastReconciledAt` on material cells. If the max audit timestamp across material cells is > 30 days old (or no cell ever audited), degrade verified → partial. Matrix route + HeatMapCell wire field added. 3 new tests cover stale/fresh/never-audited cases. |
| L7 | EBITDA on the diff preview | Not shown — only revenue/cogs/expense/gross-profit. EBITDA requires D&A row classification which isn't in the dryRun aggregation. | Extend dryRun aggregator to recognize D&A account codes and emit EBITDA delta. |

## Verification gaps (passed tsc but no actual end-to-end run)

| # | Path | What still needs hands-on validation |
|---|---|---|
| V1 | DriftDiffPreview UI under a real xlsx upload | Code shipped but not actually exercised in browser with a real budget xlsx (smoke only at the `/onboarding?view=import` page-render level). |
| V2 | Drift dashboard with REAL drift event in audit log | Currently 0 events in dev DB. Need to artificially mutate an xlsx + run watchdog to confirm drift event renders in red row. |
| V3 | Drift dashboard with REAL ingested IntelDataPoint | All sources show `missing` because no commodity / weather adapter has run. Verify with a manual seed once. |
| V4 | trust-status.ts with `sanityBand: 'high_extreme'` cell | Tested in unit, but visual badge in CompanyTree wasn't verified via screenshot for a `suspicious` overall company. |
| V5 | Trust Audit Strip with `lastReconciledAt > 1 year` | Edge case where staleness should degrade trust isn't surfaced yet (per L6). |

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
| L8 | ✅ ~~Mutation routes without period-lock gate~~ | **Closed 2026-05-16** — 6 of 9 high-risk routes gated (assumptions, balance-sheet, sales-budget, expense-forecast, sales-forecast, sales-forecast/import). Remaining 3 (plans/[id] PUT/DELETE, plans/[id]/restore, plans POST) reclassified as low-risk: they mutate plan metadata (name/status/notes/deletedAt) NOT period-scoped financial lines. Lock would block delete/restore visibility but not data integrity — recategorized to backlog. |
| L9 | ✅ ~~verifyPeriodSnapshot not yet wired~~ | **Closed 2026-05-16** — wired into runRecomputeForCompanies via parseLockedPeriods + verifyPeriodSnapshot loop at the tail; emits `period_snapshot_drift` AuditEvent on hash divergence. Best-effort with try/catch. |
| L10 | ✅ ~~Period snapshot UI surface~~ | **Closed 2026-05-16** — GET /api/budgeting/period-locks now enriches each lock with its latest PeriodSnapshot; PeriodLocksAdmin renders signed date + truncated hashes + revenue/cogs/grossProfit aggregates per row. |
