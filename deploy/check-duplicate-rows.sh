#!/usr/bin/env bash
#
# Phase 11.8b pre-flight — READ-ONLY duplicate-row check on the financial tables.
#
#   bash deploy/check-duplicate-rows.sh
#
# Context — and a correction
# ──────────────────────────
# The Phase 11 audit proposed `@@unique([planId, companyId, accountId,
# monthIndex])` on `BudgetLine` as the last-resort backstop against
# double-import. Measuring production on 2026-07-29 showed that key is WRONG:
# 376 groups violate it, and 268 of them differ only by AMOUNT, with identical
# department, subtype and notes. Those are legitimate — since Phase 2.1 made
# `accountId` the FK, several distinct source lines in the workbook collapse
# onto the same account in the same month by design. That constraint would
# reject real data.
#
# The real natural key is `(planId, sourceDocument)`: `sourceDocument` carries
# the adapter's `sourceCell`, i.e. the workbook cell a row came from, so one DB
# row per source cell is exactly the invariant an import should hold. On
# production that key had 16 violating groups / 19 excess rows — a genuine
# double-write signature, small enough to inspect by hand.
#
# The constraint is NOT shipped: dropping 19 financial rows changes reported
# numbers, which is an owner decision, not a migration's. This script makes the
# state visible so that decision can be made on evidence.
#
# `sourceDocument IS NULL` rows (legacy + hand-entered) are excluded — they
# never had a source cell and cannot violate a key derived from one.
#
# SAFETY: strictly SELECT. Safe on production at any time.

set -euo pipefail

PROD_HOST="root@46.225.60.142"
APP_DIR="/opt/budgetpro"

echo "→ Checking financial tables for duplicate rows…"

ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production exec -T db \
     psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1'" <<'SQL'
\echo '--- BudgetLine: violations of the REAL key (planId, sourceDocument) ---'
SELECT count(*) AS dup_groups, coalesce(sum(n) - count(*), 0) AS excess_rows
FROM (
  SELECT count(*) AS n
  FROM budget_lines
  WHERE "deletedAt" IS NULL AND "sourceDocument" IS NOT NULL
  GROUP BY "planId", "sourceDocument"
  HAVING count(*) > 1
) d;

\echo ''
\echo '--- the offending groups, with the amounts involved ---'
SELECT b."planId", b."sourceDocument", count(*) AS rows,
       array_agg(b."plannedAmount" ORDER BY b.id) AS amounts
FROM budget_lines b
WHERE b."deletedAt" IS NULL AND b."sourceDocument" IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 40;

\echo ''
\echo '--- BalanceSheetLine / CashFlowEntry (expected: clean) ---'
SELECT 'balance_sheet_lines' AS tbl, count(*) AS dup_groups FROM (
  SELECT 1 FROM balance_sheet_lines WHERE "deletedAt" IS NULL
  GROUP BY "planId","companyId","accountId","year","month" HAVING count(*)>1) a
UNION ALL
SELECT 'cash_flow_entries', count(*) FROM (
  SELECT 1 FROM cash_flow_entries WHERE "deletedAt" IS NULL
  GROUP BY "sourceId","year","month","accountId" HAVING count(*)>1) b;

\echo ''
\echo '--- Phase 11.8b: which rows carry an ORDINAL-BEARING source key? ---'
\echo '--- (new format ...!CODE#<n>@YYYY-MM identifies a CELL;           ---'
\echo '---  old format ...!CODE@YYYY-MM identifies only an ACCOUNT CODE) ---'
SELECT
  CASE WHEN "sourceDocument" ~ '#[0-9]+@[0-9]{4}-[0-9]{2}$'
       THEN 'new (ordinal)' ELSE 'legacy (no ordinal)' END AS key_format,
  count(*) AS rows,
  count(DISTINCT "planId") AS plans
FROM budget_lines
WHERE "deletedAt" IS NULL AND "sourceDocument" IS NOT NULL
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '--- violations AMONG ordinal-bearing keys only (must be 0) ---'
SELECT count(*) AS dup_groups, coalesce(sum(n) - count(*), 0) AS excess_rows
FROM (
  SELECT count(*) AS n FROM budget_lines
  WHERE "deletedAt" IS NULL AND "sourceDocument" IS NOT NULL
    AND "sourceDocument" ~ '#[0-9]+@[0-9]{4}-[0-9]{2}$'
  GROUP BY "planId", "sourceDocument" HAVING count(*) > 1
) v;

\echo ''
\echo '--- 11.8b index: is it actually present, and with the right predicate? ---'
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'budget_lines'
  AND indexname = 'budget_lines_plan_source_cell_key';
SQL

echo
echo "The 11.8b index SHIPPED 2026-07-29 and is enforced for ordinal-bearing"
echo "keys only, so read the blocks above as:"
echo "  legacy-format groups → expected. Real data under a key that cannot"
echo "                         distinguish it; excluded by the index predicate."
echo "                         They join the index on their own after re-import."
echo "  ordinal-key groups   → must be 0. Anything here is a genuine double-write"
echo "                         that got in before the index, or the index is gone."
echo "  index row missing    → the constraint is NOT in place. Investigate."
