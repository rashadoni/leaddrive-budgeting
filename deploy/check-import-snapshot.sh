#!/usr/bin/env bash
#
# READ-ONLY snapshot of the financial rows an import would replace (2026-07-29).
#
#   bash deploy/check-import-snapshot.sh > /tmp/db-snapshot.csv
#
# Why this exists
# ───────────────
# Before a Reset + re-import, the only honest answer to "what will change?" is
# a row-level diff of what the database holds NOW against what the new file
# parses to. The DB side of that diff is this script: every live BudgetLine,
# BalanceSheetLine and CashFlowEntry for 2025–2026, keyed the way the diff
# joins them (company code × account code × month), plus `sourceDocument` so
# the provenance claim ("this data came from actual-budget-v1.xlsx") is
# checked rather than assumed.
#
# Same shape as check-migrations.sh / check-duplicate-rows.sh: a named,
# reviewable script over ssh, reading tables and writing nothing. CSV goes to
# stdout; progress goes to stderr so redirection stays clean.
set -euo pipefail

PROD_HOST="${PROD_HOST:-root@75.119.156.234}"
APP_DIR="/opt/budgetpro"

echo "→ Snapshotting prod financial rows (2025–2026, live only)…" >&2

ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production exec -T db \
     psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 -q -A -F, -P footer=off'" <<'SQL'
\echo table,plan_kind,plan_year,company,account,month,amount,source
SELECT 'budget_line', p.kind, p.year, c.code, coa.code,
       bl."monthIndex", bl."plannedAmount", coalesce(bl."sourceDocument",'')
FROM budget_lines bl
JOIN budget_plans p       ON p.id = bl."planId"
LEFT JOIN companies c     ON c.id = bl."companyId"
JOIN chart_of_accounts coa ON coa.id = bl."accountId"
WHERE bl."deletedAt" IS NULL AND p."deletedAt" IS NULL
  AND p.year IN (2025, 2026)
ORDER BY p.year, p.kind, c.code, coa.code, bl."monthIndex";

SELECT 'bs_line', p.kind, p.year, c.code, coa.code,
       bsl.month, bsl.amount, coalesce(bsl."sourceDocument",'')
FROM balance_sheet_lines bsl
JOIN budget_plans p       ON p.id = bsl."planId"
LEFT JOIN companies c     ON c.id = bsl."companyId"
JOIN chart_of_accounts coa ON coa.id = bsl."accountId"
WHERE bsl."deletedAt" IS NULL AND p."deletedAt" IS NULL
  AND bsl.year IN (2025, 2026)
ORDER BY bsl.year, c.code, coa.code, bsl.month;

SELECT 'cf_entry', cfe."entryType", cfe.year, c.code, coa.code,
       cfe.month, cfe.amount, cfe.source || ':' || coalesce(cfe."sourceId",'')
FROM cash_flow_entries cfe
LEFT JOIN companies c     ON c.id = cfe."companyId"
JOIN chart_of_accounts coa ON coa.id = cfe."accountId"
WHERE cfe."deletedAt" IS NULL AND cfe.year IN (2025, 2026)
ORDER BY cfe.year, c.code, coa.code, cfe.month;
SQL

echo "→ done." >&2
