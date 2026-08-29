#!/usr/bin/env bash
#
# READ-ONLY pre-demo state check (2026-07-29).
#
#   bash deploy/check-demo-readiness.sh
#
# A live client demo of "reset → AI import" trips over STATE, not code:
# a period lock returns 423 mid-demo, a leftover advisory lock returns 409,
# a stale plan makes the terminal show numbers the operator did not expect.
# This reads exactly that state and changes nothing. Same named-script shape
# as check-migrations.sh.
set -euo pipefail

PROD_HOST="${PROD_HOST:-root@75.119.156.234}"
APP_DIR="/opt/budgetpro"

ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production exec -T db \
     psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1'" <<'SQL'
\echo '--- period locks (a locked 2025/2026 means 423 on reset/apply mid-demo) ---'
SELECT id, name, "lockedPeriods" FROM "Organization";

\echo '--- advisory locks currently held (leftover import = 409 IMPORT_IN_PROGRESS) ---'
SELECT locktype, classid, objid, granted, pid
FROM pg_locks WHERE locktype = 'advisory';

\echo '--- live plans + row counts (what the terminal shows BEFORE the demo) ---'
SELECT p.year, p.kind, p.name,
  (SELECT count(*) FROM budget_lines b WHERE b."planId"=p.id AND b."deletedAt" IS NULL) AS bl,
  (SELECT count(*) FROM balance_sheet_lines s WHERE s."planId"=p.id AND s."deletedAt" IS NULL) AS bs
FROM budget_plans p WHERE p."deletedAt" IS NULL ORDER BY p.year, p.kind;

\echo '--- import batch reports: the newest verdicts the demo can show ---'
SELECT "createdAt"::date AS day, "fileType", verdict, evidence, "rowsInserted", committed
FROM import_batch_reports ORDER BY "createdAt" DESC LIMIT 8;
SQL
