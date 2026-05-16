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
| L1 | `ImportWizardMulti.tsx` line ~459 | Apply button is NOT hard-gated on `safetyConfirmed` — the user can press Apply even if existing data is detected without ticking the diff-confirm checkbox. The checkbox is advisory. | Gate `disabled={applying \|\| (driftHasExistingData && !safetyConfirmed)}`. Requires DriftDiffPreview to expose "hasExistingData" upward (via a new callback prop). |
| L2 | `drift-watchdog.cjs` `actorUserId` | Set to `null` because CLI runs without a session. Production needs a service-account User row to associate with so audit-log filtering by user works. | Create `User.email='system+drift-watchdog@local'` once at setup; pass its id via env or CLI flag. |
| L3 | `freshness.ts` source list `DEFAULT_SOURCES` | Hard-coded array of 5 source codes. New adapters require a code change. | Move to org-settings JSON or a `IntelDataSource` config table. |
| L4 | `onboarding-source-registry.json` | Hand-maintained mapping `company_code → xlsx_path`. Falls out of sync if user moves files. | UI to edit the registry from `/budgeting/admin/onboarding` (right now you edit JSON by hand). |
| L5 | DriftDashboard `stalePending` query | N+1 — for each company, fetches its most recent IV separately. Fine at 20 cos, slow at 60. | Single grouped query OR materialize on a periodic job. |
| L6 | Trust badge propagation | Uses `worstOf(self, descendants)` walk-up. Doesn't account for `lastReconciledAt` staleness — a company audited 60 days ago still shows verified if all sections passed. | Add 30-day staleness fallback → degrade verified to partial. |
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
| L8 | Mutation routes without period-lock gate | 19 of 39 budgeting/forecast/* routes don't currently call `isPeriodLocked()`. Locking a period works for the 20 that DO check, but the other paths can still mutate the locked data. | Walk every POST/PATCH/DELETE/PUT in src/app/api/budgeting/* + src/app/api/indicators/* and add the `requirePeriodUnlocked()` gate where mutations touch period-scoped data. |
| L9 | verifyPeriodSnapshot not yet wired | The library exists but no caller invokes it. Recompute pipeline should run verify on completion + emit `period_snapshot_drift` audit event if hashes diverge. | Hook verifyPeriodSnapshot into `recompute.ts` after each indicator recompute on locked periods + add the new audit-action enum value. |
| L10 | Period snapshot UI surface | Snapshot rows are written + queryable, but the admin/periods page doesn't show them yet. User can't see "Q1 2026 signed by Rashad, hash X". | Add a `Signed at` column + hash badge in the periods admin page. |
