#\!/bin/bash
# Helper that generated Tier 3-8 RLS migrations. Idempotent: re-running
# overwrites existing scaffolds. NOT applied — `prisma migrate dev`
# remains user-authorized per the rollout doc.

set -euo pipefail
PRISMA_DIR="$(cd "$(dirname "$0")/../.." && pwd)/prisma/migrations"

write_migration() {
  local ts="$1" table="$2" tier="$3" rationale="$4"
  local dir="$PRISMA_DIR/${ts}_rls_${table}"
  mkdir -p "$dir"
  cat > "$dir/migration.sql" <<SQL_EOF
-- Phase 5.2 Stage 2 Tier $tier — RLS on $table.
-- $rationale
-- Same shape as Tier 1 pilot (indicator_values, 20260512000200).

ALTER TABLE "$table" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "$table";

CREATE POLICY tenant_isolation ON "$table"
  FOR ALL
  USING (
    "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
SQL_EOF
}

# IndicatorDefinition has NULLABLE organizationId (global seeds + org
# overrides). Policy MUST allow NULL through so per-org reads still see
# the global catalogue. Separate template.
write_migration_nullable() {
  local ts="$1" table="$2" tier="$3" rationale="$4"
  local dir="$PRISMA_DIR/${ts}_rls_${table}"
  mkdir -p "$dir"
  cat > "$dir/migration.sql" <<SQL_EOF
-- Phase 5.2 Stage 2 Tier $tier — RLS on $table (nullable orgId).
-- $rationale
-- Policy allows NULL through so global rows (seed catalogue) stay
-- visible to all orgs.

ALTER TABLE "$table" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "$table";

CREATE POLICY tenant_isolation ON "$table"
  FOR ALL
  USING (
    "organizationId" IS NULL
    OR "organizationId" = current_setting('app.organization_id', true)
    OR current_setting('app.bypass_rls', true) = 'true'
  );
SQL_EOF
}

# Tier 3 — financial truth (6)
write_migration 20260521130000 budget_plans            3 "Top-level container for budget data — leak would expose entire plan structures across tenants."
write_migration 20260521130100 budget_lines            3 "Core P&L line items — most-touched financial table."
write_migration 20260521130200 balance_sheet_lines     3 "Balance sheet detail — same sensitivity as budget_lines."
write_migration 20260521130300 cash_flow_entries       3 "Cash flow statement detail."
write_migration 20260521130400 budget_actuals          3 "Posted actuals — variance baseline."
write_migration 20260521130500 budget_forecast_entries 3 "Rolling forecast entries."

# Tier 4 — core entity (3)
write_migration 20260521140000 companies     4 "Org structure — admin UI crosses orgs; carefully wrap before enabling."
write_migration 20260521140100 users         4 "User accounts — auth flow already filters by orgId at session layer."
write_migration 20260521140200 counterparties 4 "Customers / suppliers — concentration risk surface."

# Tier 5 — operational facts (8)
write_migration 20260521150000 operational_facts     5 "KPI facts (yield, occupancy, FCR)."
write_migration 20260521150100 bookings              5 "Hospitality bookings."
write_migration 20260521150200 indicator_disclosures 5 "ESG / manual indicator overrides."
write_migration 20260521150300 client_reconciliations 5 "Per-client reconciliation drafts — sensitive WIP."
write_migration 20260521150400 budget_cost_types     5 "Cost-type taxonomy per org."
write_migration 20260521150500 cogs_budget_lines     5 "Detailed COGS plan."
write_migration 20260521150600 cogs_cost_details     5 "COGS cost-component detail."
write_migration 20260521150700 sales_budget_lines    5 "Sales plan line items."

# Tier 6 — AI / cache / forecasts (10)
write_migration 20260521160000 ai_mapper_proposal_cache 6 "Cached LLM column mappings."
write_migration 20260521160100 ai_token_usage          6 "Per-org LLM spend tracking."
write_migration 20260521160200 board_deck_narrations   6 "Generated narrative cache."
write_migration 20260521160300 variance_explanations   6 "AI variance explainer cache."
write_migration 20260521160400 predictive_breaches     6 "Forward breach forecasts."
write_migration 20260521160500 intel_data_points       6 "External intel (commodity prices, macro)."
write_migration 20260521160600 intel_items             6 "News / intel items."
write_migration 20260521160700 feed_impact_forecasts   6 "Feed-price impact projections."
write_migration 20260521160800 rolling_forecast_months 6 "12-month rolling forecast snapshots."
write_migration 20260521160900 expense_forecasts       6 "Departmental expense projections."

# Tier 7 — config / metadata (10)
# IndicatorDefinition has nullable orgId — special policy below.
write_migration_nullable 20260521170000 indicator_definitions 7 "Indicator catalogue: global seeds + org-specific overrides."
write_migration 20260521170100 chart_of_accounts          7 "CoA per org."
write_migration 20260521170200 industries                 7 "Per-org industry overrides on top of seed packs."
write_migration 20260521170300 currencies                 7 "Per-org currency overrides."
write_migration 20260521170400 currency_rate_history      7 "Historical FX rates."
write_migration 20260521170500 scenarios                  7 "What-if scenario overlays."
write_migration 20260521170600 budget_assumptions         7 "Free-text assumption rows attached to plans."
write_migration 20260521170700 budget_direction_templates 7 "Per-org direction defaults (revenue/cogs/opex)."
write_migration 20260521170800 budget_departments         7 "Org chart departments."
write_migration 20260521170900 budget_department_owners   7 "Department → owner mapping."

# Tier 8 — UI / reports / misc (15)
write_migration 20260521180000 alerts                  8 "Alert state per org."
write_migration 20260521180100 alert_events            8 "Alert fire history."
write_migration 20260521180200 alert_rules             8 "Configured alert thresholds."
write_migration 20260521180300 cash_flow_alerts        8 "Cash-flow-specific alert state."
write_migration 20260521180400 period_snapshots        8 "Quarterly snapshots."
write_migration 20260521180500 product_lines           8 "Product lines per org."
write_migration 20260521180600 sales_forecasts         8 "Sales forecast rows."
write_migration 20260521180700 saved_budget_reports    8 "User-saved report definitions."
write_migration 20260521180800 budget_approval_comments 8 "Per-approval comment thread."
write_migration 20260521180900 budget_sections         8 "Plan section structure."
write_migration 20260521181000 cost_components         8 "Cost-component taxonomy."
write_migration 20260521181100 import_staging          8 "Staging rows for pending imports."
write_migration 20260521181200 accounting_imports      8 "External accounting system imports."
write_migration 20260521181300 accounting_integrations 8 "Linked accounting systems config (QuickBooks/Xero/...)."
write_migration 20260521181400 user_layout_preferences 8 "Per-user UI preferences (org-scoped via user)."

echo "All 49 migrations scaffolded."
