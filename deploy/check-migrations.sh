#!/usr/bin/env bash
#
# READ-ONLY migration status check against production (2026-07-29).
#
#   bash deploy/check-migrations.sh
#
# Why this exists as a script rather than an ad-hoc ssh
# ────────────────────────────────────────────────────
# Several ROADMAP rows sit at "code done, migration pending" — 11.4
# (`budget_plan_unique_per_year_kind`), 11.13 (`import_batch_report`), 11.21
# (`bs_line_source_document`). Whether they are applied is a question about
# PRODUCTION, and a session with no database access can only guess. Guessing
# in either direction is worse than not knowing: "applied" closes a row that
# is still open, "pending" sends the next session to re-run a migration that
# already landed.
#
# It is deliberately a named script, mirroring `check-duplicate-rows.sh`, so
# the answer comes from a reviewable read-only query rather than from granting
# arbitrary remote shell.
#
# Reads `_prisma_migrations` and nothing else. Writes nothing, anywhere.
set -euo pipefail

PROD_HOST="root@75.119.156.234"
APP_DIR="/opt/budgetpro"

echo "→ Migration directories in this checkout:"
ls -1 prisma/migrations | grep -v migration_lock.toml | sort

echo
echo "→ Applied on production (name · finished · rolled back):"
ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && docker compose --env-file .env.production exec -T db \
     psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1'" <<'SQL'
\pset border 2
SELECT
  migration_name,
  to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS finished,
  CASE WHEN rolled_back_at IS NOT NULL THEN 'ROLLED BACK' ELSE '' END AS state
FROM _prisma_migrations
ORDER BY migration_name;
SQL

echo
echo "Compare the two lists. A directory present above but missing below has"
echo "NOT been applied. The container entrypoint (deploy/docker-entrypoint.sh)"
echo "runs 'prisma migrate deploy' on every start, so the usual fix is simply"
echo "to deploy — verified against that file, not assumed."
