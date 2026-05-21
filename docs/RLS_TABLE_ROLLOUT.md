# RLS Per-Table Rollout — Phase 5.2 Stage 2

**Status:** Stage 2 infrastructure unblocked 2026-05-21 (ADR Round-2
verdict locked in + `prismaAdmin` client shipped + `withOrgScope`
bypass deprecated). Per-table rollout is multi-PR, multi-session.

**Pattern reference:** `docs/RLS_PATTERN_EXAMPLE.md`.

## Per-table rollout loop

For each table T:

1. **Pre-check (≤ 30 min)**
   - `prisma/schema.prisma` confirms `organizationId` column + leading
     index `(organizationId, …)` (add migration if missing).
   - `seedMultiOrg()` includes T fixture rows for orgA + orgB.
   - `rls-leak.integration.test.ts` has an assertion for T (add one
     if not — same shape as the existing indicator_values fragment).

2. **Wrap call sites (1-4 h depending on count)**
   - `grep -rln "prisma\.tableName" src/` to enumerate.
   - For each route handler that touches T: wrap in `withOrgScope`
     per the canonical pattern. Inline tests stay green (RLS still off).
   - For cron / worker callers: confirm they use `prismaAdmin` already
     (per Phase 6 BullMQ wiring) OR convert them.

3. **Author RLS migration (≤ 30 min)**
   - Copy `prisma/migrations/20260512000200_rls_indicator_values/` as
     template. Replace table name + policy name.
   - Include `up.sql` (ENABLE + POLICY) and a sibling `down.sql` (DISABLE).
   - Idempotency guards (`DROP POLICY IF EXISTS` first).

4. **Apply pilot migration (5 min, requires user OK)**
   - `prisma migrate dev --name rls_<table>` in dev DB.
   - Or `psql -f migration.sql` if pre-migrated dev DB needs manual.

5. **Verify (15 min)**
   - `RLS_INTEGRATION=1 npx vitest run src/lib/db/rls-leak.integration.test.ts`
     → assertion for T should now PASS (was failing-by-design pre-RLS).
   - `EXPLAIN ANALYZE` on the heaviest T query → no >10% p95 regression.
   - Targeted vitest + smoke + full vitest sweep.

6. **PR + commit message**
   - `feat(rls): enable RLS on <table> (Phase 5.2 Stage 2 — table N/53)`
   - Body references this doc + the new `tests passed N/N` line.

7. **Roll forward to next table.**

## Priority queue

Order locked by architect Round-1: sensitivity × query frequency. Tier
labels reflect groups of tables to ship in a single PR (smaller tables
can batch; big-traffic tables ship solo for tight regression control).

### Tier 1 — pilot (1 table)

| # | Model | DB table | Migration |
|---|---|---|---|
| 1 | `IndicatorValue` | `indicator_values` | ✅ written (`20260512000200_rls_indicator_values`), **NOT applied** — needs user OK |

### Tier 2 — compliance / audit (3 tables, ship together)

| # | Model | DB table | Status |
|---|---|---|---|
| 2 | `AuditEvent` | `audit_events` | 🟡 migration scaffolded (`20260521120000_rls_audit_events`), leak test added, **NOT applied** |
| 3 | `BudgetChangeLog` | `budget_change_logs` | 🟡 migration scaffolded (`20260521120100_rls_budget_change_logs`), leak test added, **NOT applied** |
| 4 | `ApprovalRequest` | `approval_requests` | 🟡 migration scaffolded (`20260521120200_rls_approval_requests`), leak test added, **NOT applied** |

### Tier 3 — financial truth (6 tables)

| # | Model | DB table | Status |
|---|---|---|---|
| 5 | `BudgetPlan` | `budget_plans` | ⬜ |
| 6 | `BudgetLine` | `budget_lines` | ⬜ |
| 7 | `BalanceSheetLine` | `balance_sheet_lines` | ⬜ |
| 8 | `CashFlowEntry` | `cash_flow_entries` | ⬜ |
| 9 | `BudgetActual` | `budget_actuals` | ⬜ |
| 10 | `BudgetForecastEntry` | `budget_forecast_entries` | ⬜ |

### Tier 4 — core entity (3 tables, careful — used across admin UIs)

| # | Model | DB table | Status |
|---|---|---|---|
| 11 | `Company` | `companies` | ⬜ |
| 12 | `User` | `users` | ⬜ |
| 13 | `Counterparty` | `counterparties` | ⬜ |

### Tier 5 — operational facts (8 tables)

| # | Model | DB table | Status |
|---|---|---|---|
| 14 | `OperationalFact` | `operational_facts` | ⬜ |
| 15 | `Booking` | `bookings` | ⬜ |
| 16 | `IndicatorDisclosure` | `indicator_disclosures` | ⬜ |
| 17 | `ClientReconciliation` | `client_reconciliations` | ⬜ |
| 18 | `BudgetCostType` | `budget_cost_types` | ⬜ |
| 19 | `COGSBudgetLine` | `cogs_budget_lines` | ⬜ |
| 20 | `COGSCostDetail` | `cogs_cost_details` | ⬜ |
| 21 | `SalesBudgetLine` | `sales_budget_lines` | ⬜ |

### Tier 6 — AI / cache / forecasts (10 tables)

| # | Model | DB table | Status |
|---|---|---|---|
| 22 | `AIMapperProposalCache` | `ai_mapper_proposal_cache` | ⬜ |
| 23 | `AITokenUsage` | `ai_token_usage` | ⬜ |
| 24 | `BoardDeckNarration` | `board_deck_narrations` | ⬜ |
| 25 | `VarianceExplanation` | `variance_explanations` | ⬜ |
| 26 | `PredictiveBreach` | `predictive_breaches` | ⬜ |
| 27 | `IntelDataPoint` | `intel_data_points` | ⬜ |
| 28 | `IntelItem` | `intel_items` | ⬜ |
| 29 | `FeedImpactForecast` | `feed_impact_forecasts` | ⬜ |
| 30 | `RollingForecastMonth` | `rolling_forecast_months` | ⬜ |
| 31 | `ExpenseForecast` | `expense_forecasts` | ⬜ |

### Tier 7 — config / metadata (10 tables)

| # | Model | DB table | Status |
|---|---|---|---|
| 32 | `IndicatorDefinition` | `indicator_definitions` | ⬜ |
| 33 | `ChartOfAccount` | `chart_of_accounts` | ⬜ |
| 34 | `Industry` | `industries` | ⬜ |
| 35 | `Currency` | `currencies` | ⬜ |
| 36 | `CurrencyRateHistory` | `currency_rate_history` | ⬜ |
| 37 | `Scenario` | `scenarios` | ⬜ |
| 38 | `BudgetAssumption` | `budget_assumptions` | ⬜ |
| 39 | `BudgetDirectionTemplate` | `budget_direction_templates` | ⬜ |
| 40 | `BudgetDepartment` | `budget_departments` | ⬜ |
| 41 | `BudgetDepartmentOwner` | `budget_department_owners` | ⬜ |

### Tier 8 — UI / reports / misc (15 tables)

| # | Model | DB table | Status |
|---|---|---|---|
| 42 | `Alert` | `alerts` | ⬜ |
| 43 | `AlertEvent` | `alert_events` | ⬜ |
| 44 | `AlertRule` | `alert_rules` | ⬜ |
| 45 | `CashFlowAlert` | `cash_flow_alerts` | ⬜ |
| 46 | `PeriodSnapshot` | `period_snapshots` | ⬜ |
| 47 | `ProductLine` | `product_lines` | ⬜ |
| 48 | `SalesForecast` | `sales_forecasts` | ⬜ |
| 49 | `SavedBudgetReport` | `saved_budget_reports` | ⬜ |
| 50 | `BudgetApprovalComment` | `budget_approval_comments` | ⬜ |
| 51 | `BudgetSection` | `budget_sections` | ⬜ |
| 52 | `CostComponent` | `cost_components` | ⬜ |
| 53 | `ImportStaging` | `import_staging` | ⬜ |
| 54 | `AccountingImport` | `accounting_imports` | ⬜ |
| 55 | `AccountingIntegration` | `accounting_integrations` | ⬜ |
| 56 | `UserLayoutPreference` | `user_layout_preferences` | ⬜ |

## Estimate

53 org-scoped tables × ~2-4h average per table = 120-200h total. At
1 PR/day cadence: ~10-12 weeks of focused work. Realistic interleaved
with other Phase 7 work: ~16-20 weeks.

Critical path is Tier 1 (pilot — proves the pattern end-to-end) +
Tier 2 (compliance — risk-asymmetry, can ship in parallel). Tiers 3-8
incremental.

## Pre-requisites (one-time)

1. ☐ User authorizes `psql -f scripts/sql/create-bypass-role.sql`
   (provisions `budgetpro_admin` BYPASSRLS role).
2. ☐ User sets `DATABASE_URL_ADMIN` in `.env`.
3. ☐ User authorizes `npx prisma migrate dev --name rls_indicator_values`
   (applies the Tier 1 pilot migration).

After (1)-(3), Tier 1 is live and `RLS_INTEGRATION=1 vitest` should
flip from FAIL → PASS on the indicator_values leak assertion.
