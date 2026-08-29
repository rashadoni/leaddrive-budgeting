#!/usr/bin/env bash
#
# Phase 11.4 pre-flight — READ-ONLY duplicate-plan check against PRODUCTION.
#
#   bash deploy/check-duplicate-plans.sh
#
# Migration `20260729120000_budget_plan_unique_per_year_kind` deliberately
# REFUSES to apply while more than one LIVE BudgetPlan exists for the same
# (organizationId, year, kind). Merging two plans' financial rows is an owner
# decision, not something a migration does silently. This is the pre-flight.
#
# Why it matters: the risk engine reads `plan: { year, kind: "actual" }` with
# no planId (src/lib/risk/recompute-data-source.ts), so it SUMS every live
# actual plan for the year — silently doubling every P&L and balance-sheet
# number. Each import's clean-slate is plan-scoped, so neither plan can ever
# reach the other's rows to correct it.
#
# SAFETY: strictly SELECT. No writes, no DDL, no migration, no deploy, no
# backup needed. It is safe to run at any time, including mid-day.
#
# Credentials are never hardcoded — POSTGRES_USER / POSTGRES_DB are sourced
# from the server's own .env.production, exactly as deploy/update-prod.sh does
# for the pre-deploy backup.

set -euo pipefail

PROD_HOST="root@75.119.156.234"
APP_DIR="/opt/budgetpro"

echo "→ Querying prod for split (organizationId, year, kind) plan groups…"

# The SQL travels over stdin with a quoted heredoc, so the camelCase column
# identifiers keep their double quotes without fighting the ssh/bash quoting
# layers. Postgres folds unquoted identifiers to lower case, so dropping those
# quotes would fail with `column "organizationid" does not exist`.
ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production exec -T db \
     psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1'" <<'SQL'
\echo '--- live plan groups (only groups with >1 plan are a problem) ---'
SELECT "organizationId",
       year,
       kind,
       count(*)                             AS live_plans,
       array_agg(name ORDER BY "createdAt") AS plan_names,
       array_agg(id   ORDER BY "createdAt") AS plan_ids
FROM budget_plans
WHERE "deletedAt" IS NULL
GROUP BY 1, 2, 3
HAVING count(*) > 1
ORDER BY year DESC, kind;

\echo ''
\echo '--- financial rows per plan, for every year that has any plan ---'
\echo '--- (use this to see which plan is the data-holding one)      ---'
SELECT p.year,
       p.kind,
       p.id,
       p.name,
       (SELECT count(*) FROM budget_lines        b WHERE b."planId" = p.id AND b."deletedAt" IS NULL) AS budget_lines,
       (SELECT count(*) FROM balance_sheet_lines s WHERE s."planId" = p.id AND s."deletedAt" IS NULL) AS bs_lines,
       (SELECT count(*) FROM budget_actuals      a WHERE a."planId" = p.id)                           AS actuals,
       (SELECT count(*) FROM sales_budget_lines  l WHERE l."planId" = p.id)                           AS sales_lines
FROM budget_plans p
WHERE p."deletedAt" IS NULL
ORDER BY p.year DESC, p.kind, p."createdAt";
SQL

echo
echo "Read the first block:"
echo "  empty      → CLEAN. Migration 20260729120000 can be applied."
echo "  any rows   → the terminal is currently SUMMING those plans."
echo "               The OLDEST plan in each group is canonical (it is the one"
echo "               resolveImportPlan() already writes into). Re-point the"
echo "               duplicate's child rows to it, soft-delete the duplicate,"
echo "               then apply the migration."
