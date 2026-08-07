#!/usr/bin/env bash
#
# Seed the crisis-scenario catalog on production (2026-08-07).
#
#   bash deploy/seed-prod-scenarios.sh            # dry run — prints the SQL, writes nothing
#   bash deploy/seed-prod-scenarios.sh --apply    # backs up, then upserts the catalog
#   bash deploy/seed-prod-scenarios.sh --remove   # backs up, then deletes catalog rows
#
# Why this exists
# ───────────────
# Production had ZERO rows in `scenarios`. The 14-entry catalog has lived in
# `src/lib/risk/crisis-catalog.ts` since Phase 1, and `scripts/seed-crisis-scenarios.ts`
# has been the way to load it — but that runner needs Prisma, tsx and a repo
# checkout, none of which exist on the production host, so it was never run
# there. Consequence: the What-if panel opened empty ("No scenarios found"), the
# signal chips linking to DROUGHT_2026 / SUGAR_PRICE_TO_70 led nowhere, and the
# per-company import-share work of Phase 16.6/16.7 had never once executed in
# production — not because it was broken, but because there was nothing to run.
#
# This is CONFIGURATION, not business data: codes, trilingual names and shock
# parameters, all already in the repository and unit-tested. It writes no
# figures of this company's own. That is why it is separable from the example
# assumptions, which ARE stand-in numbers and carry a removable marker.
#
# The SQL is GENERATED from the catalog by scripts/emit-scenario-seed-sql.ts, so
# there is one source of truth; this script never restates the rows itself.
#
# Idempotent: --apply upserts by `code`, and preserves any human-authored
# `overrides->'adjustments'` on a row, exactly as the Prisma runner does.
set -euo pipefail

PROD_HOST="root@46.225.60.142"
APP_DIR="/opt/budgetpro"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="dry"
[ "${1:-}" = "--apply" ] && MODE="apply"
[ "${1:-}" = "--remove" ] && MODE="remove"

remote_psql() {
  ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
    && set -a && . ./.env.production && set +a \
    && docker compose --env-file .env.production exec -T db \
       psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 $*'"
}

backup() {
  local f="backups/pre-scenario-seed-$(date -u +%Y-%m-%dT%H%M%SZ).sql.gz"
  echo "→ Backing up prod DB to $f…"
  ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
    && set -a && . ./.env.production && set +a \
    && umask 077 && set -o pipefail && set -o noclobber \
    && docker compose --env-file .env.production exec -T db \
       pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\" \
     | gzip > \"$f\" && gzip -t \"$f\" && chmod 600 \"$f\"'"
  echo "✓ Verified backup: $f"
}

SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT
echo "→ Generating SQL from src/lib/risk/crisis-catalog.ts…"
(cd "$REPO_ROOT" && npx tsx scripts/emit-scenario-seed-sql.ts) > "$SQL_FILE"
# A generator that silently produced nothing would otherwise send an empty
# transaction and report success.
grep -q 'INSERT INTO _cat' "$SQL_FILE" || { echo "✗ Generated SQL has no catalog rows — aborting."; exit 1; }

echo "→ Scenarios currently on production:"
remote_psql -At <<'SQL'
SELECT count(*) FROM scenarios;
SQL

if [ "$MODE" = "dry" ]; then
  echo
  echo "Dry run. Would upsert $(grep -c "^  ('" "$SQL_FILE") scenarios. Generated SQL:"
  echo "────────────────────────────────────────────────────────────"
  cat "$SQL_FILE"
  echo "────────────────────────────────────────────────────────────"
  echo "Re-run with --apply to back up and write, or --remove to delete them."
  exit 0
fi

backup

if [ "$MODE" = "remove" ]; then
  echo "→ Removing catalog scenarios — but NOT any row a human has edited…"
  remote_psql <<'SQL'
BEGIN;
-- A row carrying `adjustments` was touched by a person through the product.
-- Deleting it would discard work this script never created, so it is skipped
-- and named rather than silently kept or silently removed.
\echo '=== kept (human-edited, not deleted) ==='
SELECT code FROM scenarios WHERE overrides ? 'adjustments' ORDER BY code;
DELETE FROM scenarios WHERE NOT (overrides ? 'adjustments');
COMMIT;
SELECT count(*) AS remaining FROM scenarios;
SQL
  echo "✓ Removed."
  exit 0
fi

echo "→ Upserting the catalog…"
remote_psql < "$SQL_FILE"

echo
echo "✓ Done. The What-if panel now has scenarios. To undo:"
echo "    bash deploy/seed-prod-scenarios.sh --remove"
