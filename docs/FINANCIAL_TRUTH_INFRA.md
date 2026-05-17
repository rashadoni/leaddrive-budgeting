# Financial Truth Infrastructure — guard rails for 60-company finance terminal

**Status:** In progress (Phase A active 2026-05-16)
**Owner:** Rashad
**Motivation:** AZSEKER audit (2026-05-16) revealed 5 classes of data risk that
would have silently misled a CFO viewing the terminal:

1. Revenue matched xlsx but **ratio indicators (gross margin, opex ratio,
   etc.) were never computed** — UI showed "no IV" for fields a finance user
   would expect to see.
2. **Classification errors** — AZSF 411K classified entirely as `expense`,
   none as `cogs` → FP_GROSS_MARGIN = 100% (green) when reality is loss.
3. **`unknown` status renders as colored band** — `AGRO_YIELD: 0 [unknown]`
   looked like "actual zero yield" instead of "no data ingested".
4. **HORIZON has 0 BudgetLines** — exists in tree but no source data → null
   leaked into rollups; we caught it only by manual reading the audit.
5. **No drift detection** — accidental DB edits or re-imports could silently
   diverge from the source xlsx without anyone noticing.

The plan below builds an 8-pillar trust layer so any new company added (we
have ~47 left to onboard) is provably correct before it appears on the
terminal, and stays correct over time.

---

## Phase A — Foundation (Day 1)

Goal: a single CLI command that audits any (company, xlsx, sheet) tuple
against the DB, plus a database column to store the result.

### A.1 Universal `scripts/audit-company.cjs`

Generalizes the AZSEKER-specific diagnostic. Inputs:
- `--company AAC-MAIN` (DB company code)
- `--xlsx /path/to/budget.xlsx`
- `--sheet PL_AAC` (sheet within xlsx)
- `--period 2026`

Outputs (per the PLF.01..PLF.10 lines):
- `xlsx_value` (12-month sum from sheet)
- `db_budget_line_sum` (sum of BudgetLines for that lineType)
- `db_indicator_value` (IND_REVENUE_TOTAL / IND_GROSS_MARGIN / ...)
- `drift_abs` + `drift_pct`
- Per-cell verdict: `match` (< 0.01%) / `drift_minor` (< 1%) / `drift_major`
- Sanity-band check per industry (e.g., gross margin should be 5–80% for
  food processing; outside that range → `suspicious`)

Exit code: 0 = all green, 1 = any drift_major or suspicious. Hooks into CI
for new-company onboarding.

### A.2 Migration — IndicatorValue provenance fields

```prisma
model IndicatorValue {
  // ... existing fields
  sourceDocument    String?  // "Consolidated budget 2026_AHMAD_NEW.xlsx#PL_EDEN!R3"
  lastReconciledAt  DateTime?
  reconciledBy      String?  // user id who ran the audit
  sanityBand        String?  // "normal" | "low_extreme" | "high_extreme" | "missing_input"
}
```

Same fields on `BudgetLine` for the source row pointer.

### A.3 UI fix — `unknown` status renders as "—"

In HeatMap.tsx and IndicatorDetail.tsx: when `cell.status === 'unknown'`,
render the cell as a neutral "—" with no color band, no shape, and a
tooltip "No data ingested — not a zero value." Prevents the visual lie
where 0/unknown reads like a real measurement.

---

## Phase B — Visibility (Day 2)

Goal: surface trust state to the user so they don't have to drill down
to know which companies are reliable.

### B.1 Company status badge in CompanyTree

Computed at matrix-fetch time from DB indicators:
- 🟢 **Verified** — all `material` indicators have IV with `lastReconciledAt`
  within 30 days, no `suspicious` band, no `missing_input`.
- 🟡 **Partial** — basic P&L OK but industry-KPI missing (e.g., agro
  company with no `AGRO_YIELD_PER_HA` entry).
- 🔴 **Suspicious** — at least one ratio outside sanity band (margin > 95%
  or < -50%, opex_ratio > 200%, etc.).
- ⚪ **Pending** — company exists but `lastReconciledAt` is null for all IVs
  (just imported, awaiting audit).

Rendered as a 6px circle to the left of the company code.

### B.2 IndicatorDetail provenance panel

In Panel 3 (Indicator Detail) — below the value + status — show:
```
Источник: PL_EDEN!R3 (Consolidated budget 2026_AHMAD_NEW.xlsx)
Сверено: 16.05.2026 Rashad Rahimov
Sanity-band: normal (15–35% expected for agro_crops)
```
Click "Источник" → opens audit report for that specific cell.

### B.3 Audit log events

New AuditAction enum values:
- `reconciliation_run` — every `audit-company` execution
- `reconciliation_drift_detected` — when drift > 0.01%
- `reconciliation_signoff` — manager approves the result

---

## Phase C — Onboarding gate (Day 3)

Goal: a new company is not visible in the production terminal until it
passes a checklist.

### C.1 `Company.status` field

```prisma
model Company {
  // ... existing
  status  String  @default("pending")
  // 'pending'  — created but not verified yet
  // 'partial'  — basic P&L OK, missing industry KPIs
  // 'verified' — all checks passed, visible to all roles
  // 'locked'   — period closed, snapshot signed off
}
```

### C.2 Onboarding checklist UI (`/budgeting/admin/companies/[code]/onboarding`)

Per-company widget:
- ☐ Budget plan imported (year=2026, lines > 0)
- ☐ Revenue/COGS/Expense classification reviewed (% split shown)
- ☐ Industry assigned (not null)
- ☐ Industry KPI baseline (for agro: hectares + region + cropType; for
  hospitality: totalRooms; etc.) — pulls from `Company.settings`
- ☐ Recompute ran (no "no IV" for material indicators)
- ☐ EBITDA reconciled vs xlsx (Feature 5 drawer) — drift < 1%
- ☐ Manager signoff

Each item has a button "Run check" → executes the underlying script and
flips checkbox + audit-log entry.

### C.3 Terminal gate

CompanyTree filters out `status === 'pending'` companies by default. Admin
toggle "Show pending (N)" reveals them for review. HeatMap shows them with
a hatched/diagonal overlay if visible.

---

## Phase D — Drift watchdog (Day 4)

Goal: catch silent data corruption / accidental edits.

### D.1 Nightly cron

For every company with `sourceDocument` registered:
1. Re-run audit-company against the source xlsx.
2. Compare new result to last stored result.
3. Drift > 0.01% in any line → audit-log + email + flag company `status` to
   `partial` (force re-signoff) + dashboard alert badge.

Implementation: `src/lib/scheduler/cron/drift-watchdog.ts` running daily at
03:00 (Asia/Baku TZ — existing scheduler infrastructure).

### D.2 Reference-data freshness

For external feeds (weather Open-Meteo, commodity World Bank, FX TCMB):
- Each `IntelDataPoint` has `fetchedAt` (existing).
- New check: warn if max `fetchedAt` per source > expected interval × 1.5:
  - Daily feeds → 36-hour threshold
  - Monthly feeds → 45-day threshold
- Indicators using stale data auto-flip status to `unknown` with reason
  "stale source (last update: X days ago)".

### D.3 Drift dashboard

`/budgeting/admin/drift` page:
- Companies with non-zero drift in last 30 days
- Stale external feeds
- Companies with `status = 'pending'` for > 7 days (onboarding stalled)
- Click-through to per-line audit report.

---

## Phase E — Signoff + immutability (Day 5)

Goal: an auditable "this is the official number for Q1 2026" workflow.

### E.1 Quarter snapshot

Manager clicks "Sign off Q1 2026" on a company → background job:
1. Collect all IndicatorValue + BudgetLine rows for the period.
2. Compute SHA-256 hash of the snapshot.
3. Write to new `PeriodSnapshot` table with `signedAt`, `signedBy`, hash.

### E.2 Lock mode

Signed periods are read-only:
- `BudgetLine` mutations rejected with 403 if `plan.period` is in a signed
  period (unless `unlock_reason` provided + super-admin role).
- Recompute can still rebuild IndicatorValue from signed BudgetLines but
  produces identical hash (sanity check); divergent recompute → alert.

### E.3 Unlock workflow

Super-admin → "Unlock Q1 2026" with mandatory `unlock_reason` text → all
period mutations re-enabled, audit-log entry, manager must re-sign.

### E.4 Terminal banner

Signed periods show "Locked, signed by X on DATE" in HeatMap header.
Unsigned current period shows "Live data — not yet signed off".

---

## Out of scope (v1, backlog if needed later)

- **Multi-source reconciliation** (xlsx + GL accounting system simultaneously)
- **Continuous integration of source files** (auto-detect new xlsx in
  Dropbox/SharePoint and re-run audit)
- **Industry-specific sanity bands beyond the basic per-CoA categories**
- **Diff visualization** between two periods (Q4 2025 vs Q1 2026 deltas
  with cell-level drift highlighting)
- **Mobile alert push** (web push API for managers when drift detected)

---

## Status tracker

**Last refresh: 2026-05-17 (Session 9 docs-hygiene pass).** Table reconstructed by cross-referencing actual codebase artefacts + `docs/TRUTH_INFRA_FOLLOWUPS.md` + CARRYOVER changelog 2026-05-16. Phases A/B/D/E mostly shipped through the truth-infra closure session (Phase 7.G Turn LXVII–LXXX + 2026-05-16 wave). **Single remaining ⬜:** C.3 + E.4 (UI-gate items not surfaced) and V1 (browser-side smoke, tracked in `TRUTH_INFRA_FOLLOWUPS.md`).

| Phase | Component | Status | Evidence |
|---|---|---|---|
| A.1 | `audit-company.cjs` | ✅ Done | `scripts/audit-company.cjs` + `src/lib/audit/audit-helpers.cjs` hoisted helpers + 22 vitest cases (closure: TRUTH_INFRA F1, 2026-05-16) |
| A.2 | IV/BudgetLine provenance migration | ✅ Done | `IndicatorValue` carries `valueSource` + `confidence` + `sourceDocument` + `lastReconciledAt` + `reconciledBy` + `sanityBand`; schema rows present + surfaced by `/api/indicators/values/[id]` |
| A.3 | HeatMap `unknown → —` rendering | ✅ Done | `HeatMap.tsx` renders em-dash for `status === "unknown"` cells (98 grep hits across UI logic) |
| B.1 | CompanyTree status badge | ✅ Done | `TrustBadge` component in `CompanyTree.tsx` (lines 464, 514, 742) + integration test `CompanyTree.trust-badge.test.tsx` |
| B.2 | IndicatorDetail provenance panel | ✅ Done | `IndicatorDetail.tsx` surfaces `valueSource` + `sourceDocument` + `lastReconciledAt` + `sanityBand` (14 grep hits) |
| B.3 | Audit log events for reconciliation | ✅ Done | `reconciliation_drift_detected` enum value in `prisma/schema.prisma`; emitted by `scripts/drift-watchdog.cjs` |
| C.1 | `Company.status` field + migration | ✅ Done | `Company.status String @default("pending")` (schema line 230) |
| C.2 | Onboarding checklist UI | ✅ Done | `/api/companies/[id]/onboarding/route.ts` + `OnboardingCompletenessDashboard.tsx` + `OnboardingTabbedPage.tsx` + `OnboardingWizardSwitcher.tsx` |
| C.3 | Terminal gate for pending companies | ⬜ Pending | Schema field exists; CompanyTree does not yet filter `status === "pending"` by default. `TrustBadge` surfaces status but doesn't gate visibility. |
| D.1 | Drift watchdog cron | ✅ Done | `scripts/drift-watchdog.cjs` + `src/lib/audit/drift-watchdog-helpers.cjs` + 10 vitest cases (closure: TRUTH_INFRA F2, 2026-05-16) |
| D.2 | Reference-data freshness checks | ✅ Done | `src/lib/intel/freshness.ts` + `resolveFreshnessSources()` reads `Organization.settings.intelFreshnessSources`; 5+7 vitest cases (closure: TRUTH_INFRA F3 + L3, 2026-05-16) |
| D.3 | Drift dashboard | ✅ Done | `src/features/admin/components/DriftDashboard.tsx` + `DriftDashboard.test.tsx` + `/api/admin/drift/route.ts` + handler tests (closure: TRUTH_INFRA F4 + F5, 2026-05-16) |
| E.1 | Quarter snapshot table + hash | ✅ Done | `PeriodSnapshot` Prisma model (schema line 1897) + `/admin/periods` UI |
| E.2 | Lock mode on BudgetLine mutations | ✅ Done | `src/lib/budgeting/period-lock.ts` + `period-lock-http.ts` gate 24+ mutation handlers with 423 response (Phase 4.2 closed Turn LXX) |
| E.3 | Unlock workflow | ✅ Done | `PeriodLocksAdmin.tsx` admin UI + audit on add/remove + lock-API |
| E.4 | Terminal locked-period banner | ⬜ Pending | `PeriodLockBadge.tsx` exists for plan-row badges, but no terminal-wide banner showing "Q1 2026 is locked, mutations rejected". |
| V1 | DriftDiffPreview browser smoke | ⬜ Pending | Tracked in `docs/TRUTH_INFRA_FOLLOWUPS.md` — code shipped, browser-side verification with real xlsx upload pending. |
