#!/usr/bin/env bash
#
# Seed EXAMPLE budget assumptions on production (2026-08-06).
#
#   bash deploy/seed-prod-assumptions.sh            # dry run — shows what it would write
#   bash deploy/seed-prod-assumptions.sh --apply    # backs up, then writes
#   bash deploy/seed-prod-assumptions.sh --remove   # backs up, then deletes ONLY these rows
#
# Why this exists
# ───────────────
# The Fərziyyələr tab shipped working but empty — nothing had ever written to
# `budget_assumptions`, so there was nothing to look at and nothing to record a
# help video against. The owner asked for example rows so the section can be
# seen and filmed ("добавь", 2026-08-06).
#
# ⚠ THE VALUES BELOW ARE EXAMPLES, NOT THIS BUSINESS'S DATA.
#
# That matters beyond tidiness: `import_share` feeds the FX devaluation
# scenario per company, so these numbers change the worst-hit ranking a board
# narrative is built from. Every row therefore carries a NOTES field that says
# so in three words a reader cannot miss, and `--remove` deletes exactly and
# only the rows this script wrote — matched on that marker, never on key or
# company, so a real row typed later by a controller is never caught by it.
#
# Idempotent: --apply removes its own previous rows first, so running twice
# leaves one copy, not two.
set -euo pipefail

PROD_HOST="root@46.225.60.142"
APP_DIR="/opt/budgetpro"
# The budget plan the tab opens on. Read from prod on 2026-08-06; the script
# re-resolves it by NAME at run time so a recreated plan does not silently make
# this a no-op against a stale id.
PLAN_NAME="Azərşəkər 2026 Budget"
MARKER="[NÜMUNƏ / ПРИМЕР / EXAMPLE — silinə bilər]"

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
  local f="backups/pre-assumptions-seed-$(date -u +%Y-%m-%dT%H%M%SZ).sql.gz"
  echo "→ Backing up prod DB to $f…"
  ssh "$PROD_HOST" "bash -lc 'cd \"$APP_DIR\" \
    && set -a && . ./.env.production && set +a \
    && umask 077 && set -o pipefail && set -o noclobber \
    && docker compose --env-file .env.production exec -T db \
       pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\" \
     | gzip > \"$f\" && gzip -t \"$f\" && chmod 600 \"$f\"'"
  echo "✓ Verified backup: $f"
}

echo "→ Current assumption rows on production:"
remote_psql -At <<'SQL'
SELECT count(*) FROM budget_assumptions;
SQL

if [ "$MODE" = "dry" ]; then
  echo
  echo "Dry run. Would write 6 EXAMPLE rows into the plan named \"$PLAN_NAME\":"
  echo "    import_share   plan default          0.30"
  echo "    import_share   AZSEKER-CPC           0.72"
  echo "    import_share   AZSEKER-AZSF          0.65"
  echo "    import_share   AZSEKER-EDEN          0.18"
  echo "    import_share   AZSEKER-PROMALT       0.00"
  echo "    cost_rigidity  AZSEKER-EDEN          0.80"
  echo
  echo "Each row's notes begin with: $MARKER"
  echo "Re-run with --apply to back up and write, or --remove to delete them."
  exit 0
fi

backup

if [ "$MODE" = "remove" ]; then
  echo "→ Removing ONLY the rows this script wrote (matched on the example marker)…"
  remote_psql <<SQL
BEGIN;
DELETE FROM budget_assumptions WHERE notes LIKE '${MARKER}%';
COMMIT;
SELECT count(*) AS remaining FROM budget_assumptions;
SQL
  echo "✓ Removed. Any rows entered through the UI are untouched."
  exit 0
fi

echo "→ Writing example rows…"
remote_psql <<SQL
BEGIN;

-- Resolve by NAME, not a hardcoded id, so a recreated plan is not a silent no-op.
CREATE TEMP TABLE _t AS
SELECT p.id AS plan_id, p."organizationId" AS org_id
FROM budget_plans p
WHERE p.name = '${PLAN_NAME}' AND p."deletedAt" IS NULL
ORDER BY p."createdAt" DESC LIMIT 1;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _t) THEN
    RAISE EXCEPTION 'Plan "%" not found — refusing to guess which plan to write to.', '${PLAN_NAME}';
  END IF;
END \$\$;

-- Idempotent: clear this script's own previous rows only.
DELETE FROM budget_assumptions WHERE notes LIKE '${MARKER}%';

INSERT INTO budget_assumptions
  (id, "organizationId", "planId", "companyId", category, key, label, value, unit, period, notes, "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t.org_id, t.plan_id, v.company_id, v.category, v.key, v.label, v.value, v.unit, 'annual',
       '${MARKER} ' || v.note, v.ord, now(), now()
FROM _t t
CROSS JOIN (VALUES
  (NULL::text,                                'fx',         'import_share',  'Idxal xərclərinin payı',  0.30, '%', 'holdinq üzrə defolt',                    0),
  ('cmqukprvm0003t59zbm3skdbc',               'fx',         'import_share',  'Idxal xərclərinin payı',  0.72, '%', 'CPC — xam qarğıdalı idxalı',             1),
  ('codex_azsf_20260630',                     'fx',         'import_share',  'Idxal xərclərinin payı',  0.65, '%', 'Azərşəkər — xam şəkər idxalı',           2),
  ('cmqukprvq0005t59z4b2end2g',               'fx',         'import_share',  'Idxal xərclərinin payı',  0.18, '%', 'EDEN — yalnız dərman və gübrə',          3),
  ('cmqukprvt0007t59znbc41sh7',               'fx',         'import_share',  'Idxal xərclərinin payı',  0.00, '%', 'PROMALT — xammal daxili bazardan',       4),
  ('cmqukprvq0005t59z4b2end2g',               'operations', 'cost_rigidity', 'Batmış xərclərin payı',   0.80, '%', 'EDEN — toxum və suvarma əvvəlcədən',     5)
) AS v(company_id, category, key, label, value, unit, note, ord);

COMMIT;

\echo '=== written ==='
SELECT a.key, COALESCE(c.code, '(plan default)') AS scope, a.value, a.notes
FROM budget_assumptions a LEFT JOIN companies c ON c.id = a."companyId"
WHERE a.notes LIKE '${MARKER}%'
ORDER BY a."sortOrder";
SQL

echo
echo "✓ Done. These are EXAMPLE values — remove them with:"
echo "    bash deploy/seed-prod-assumptions.sh --remove"
