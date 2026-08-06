#!/usr/bin/env bash
#
# Apply pending Prisma migrations to production (2026-08-06).
#
#   bash deploy/apply-migrations.sh            # dry run — lists what would apply
#   bash deploy/apply-migrations.sh --apply    # takes a backup, then applies
#
# Why this exists — and what it is NOT for
# ────────────────────────────────────────
# Migrations already reach production on their own: `deploy/docker-entrypoint.sh`
# runs `prisma migrate deploy` on every container start, so a normal
# `update-prod.sh` deploy migrates and then serves. **This script is not needed
# for that, and is not a replacement for it.**
#
# It exists for the one case the entrypoint cannot cover: applying a migration
# BEFORE the new code ships. Between the container starting and the migration
# finishing, the old image is gone and the new one has not served yet — fine for
# an additive change, but for anything the running code cannot tolerate you want
# the schema in place first, verified, with a backup you took deliberately. That
# is expand-then-deploy, and it needs a way to migrate without deploying.
#
# It mirrors `check-migrations.sh` — a named, reviewable script rather than
# arbitrary remote shell — because the alternative people reach for is an ad-hoc
# `ssh … psql`, which is unreviewable and exactly what that script was written to
# avoid.
#
# If you are not deliberately separating the two steps, just deploy.
#
# What it does, in order
# ──────────────────────
#   1. Reads `_prisma_migrations` on prod and diffs it against this checkout's
#      `prisma/migrations/` to find what is pending. Read-only so far.
#   2. Without `--apply`, prints the list and stops. That is the default,
#      because "which migrations are pending" is a question worth being able to
#      ask without any risk of answering it destructively.
#   3. With `--apply`: takes a verified `pg_dump` backup FIRST (same shape as
#      update-prod.sh — pipefail, noclobber, gzip -t, chmod 600), then applies
#      each pending migration inside ONE transaction together with its
#      `_prisma_migrations` row, so the schema change and the record of it
#      cannot diverge. A failure rolls back that migration entirely.
#   4. Re-reads the migration table and prints the result.
#
# The checksum recorded is the sha256 of the migration.sql file, which is what
# Prisma itself stores. A wrong one fails loudly on the next `migrate` command
# rather than corrupting anything.
#
# Ordering note: migrations run oldest-first, by directory name. Prisma's
# timestamp-prefixed names sort correctly under `LC_ALL=C sort`.
set -euo pipefail

PROD_HOST="root@46.225.60.142"
APP_DIR="/opt/budgetpro"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ ! -d prisma/migrations ]; then
  echo "✗ Run from the repository root (prisma/migrations not found)." >&2
  exit 1
fi

# SQL always arrives on STDIN, never as `-c "…"`. An inline query has to survive
# the local shell, ssh's own re-parse and the remote `bash -lc`, and it does not:
# the first version of this script passed the query through `$*`, the quoting
# collapsed, psql saw `SELECT`/`migration_name`/`FROM` as separate arguments and
# ignored them all. It then returned NOTHING, which made every migration look
# pending — a dry run listing 13 migrations against a production database that
# already had 12 of them. Only flag tokens (no spaces) may be passed as args.
remote_psql() {
  ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
    && set -a && . ./.env.production && set +a \
    && docker compose --env-file .env.production exec -T db \
       psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 $*'"
}

echo "→ Reading applied migrations from production…"
APPLIED="$(remote_psql -At <<'SQL'
SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL;
SQL
)"
if [ -z "$APPLIED" ]; then
  # An empty read is indistinguishable from "nothing applied yet", and acting on
  # it would re-run the entire history against a live database. On a deployed
  # prod that is never the truth, so refuse rather than guess.
  echo "✗ Read zero applied migrations from production." >&2
  echo "  That is almost certainly a connection or quoting failure, not an empty" >&2
  echo "  database. Refusing to treat the whole history as pending." >&2
  exit 1
fi

LOCAL="$(ls -1 prisma/migrations | grep -v migration_lock.toml | LC_ALL=C sort)"
PENDING="$(comm -23 <(echo "$LOCAL") <(echo "$APPLIED" | LC_ALL=C sort))"

if [ -z "$PENDING" ]; then
  echo "✓ Nothing pending — production is up to date."
  exit 0
fi

echo
echo "→ Pending migrations (oldest first):"
echo "$PENDING" | sed 's/^/    /'
echo

if [ "$APPLY" -ne 1 ]; then
  echo "Dry run. Re-run with --apply to take a backup and apply them."
  exit 0
fi

# Backup BEFORE any DDL. Same guards as update-prod.sh: pipefail so a failed
# pg_dump fails the run even though gzip exits cleanly, noclobber + a
# second-resolution UTC name so a retry cannot overwrite the only recovery
# point, and gzip -t to prove the artifact is readable before anything changes.
BACKUP_FILE="backups/pre-migration-$(date -u +%Y-%m-%dT%H%M%SZ).sql.gz"
echo "→ Backing up prod DB to $BACKUP_FILE…"
ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
  && set -a && . ./.env.production && set +a \
  && umask 077 && set -o pipefail && set -o noclobber \
  && docker compose --env-file .env.production exec -T db \
     pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\" \
   | gzip > \"$BACKUP_FILE\" \
  && gzip -t \"$BACKUP_FILE\" \
  && chmod 600 \"$BACKUP_FILE\"'"
echo "✓ Verified backup: $BACKUP_FILE"
echo

while IFS= read -r NAME; do
  [ -n "$NAME" ] || continue
  SQL_FILE="prisma/migrations/$NAME/migration.sql"
  if [ ! -f "$SQL_FILE" ]; then
    echo "✗ $NAME has no migration.sql — refusing to continue." >&2
    exit 1
  fi
  CHECKSUM="$(sha256sum "$SQL_FILE" | cut -d' ' -f1)"
  echo "→ Applying $NAME (sha256 ${CHECKSUM:0:12}…)"

  # One transaction: the DDL and the row recording it land together or not at
  # all. Without this a mid-run failure leaves prod with a changed schema that
  # Prisma believes is unapplied, and the next run tries it again.
  {
    echo "BEGIN;"
    cat "$SQL_FILE"
    cat <<SQLTAIL

INSERT INTO "_prisma_migrations"
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '$CHECKSUM', now(), '$NAME', NULL, NULL, now(), 1);
COMMIT;
SQLTAIL
  } | remote_psql
  echo "✓ $NAME applied"
  echo
done <<< "$PENDING"

echo "→ Migration table after apply (most recent first):"
remote_psql <<'SQL'
\pset border 2
SELECT migration_name,
       to_char(finished_at, 'YYYY-MM-DD HH24:MI') AS finished,
       CASE WHEN rolled_back_at IS NOT NULL THEN 'ROLLED BACK' ELSE '' END AS state
FROM "_prisma_migrations"
ORDER BY finished_at DESC NULLS LAST
LIMIT 5;
SQL

echo
echo "✓ Done. Deploy the code now: bash deploy/update-prod.sh"
