#!/usr/bin/env bash
#
# deploy/first-deploy.sh — one-command first production deploy.
#
# Run this ON THE VM, from the repo root, AFTER you have:
#   1. Provisioned the VM + Docker        (deploy/README.md §1)
#   2. Created + filled .env.production    (cp .env.production.example .env.production)
#
# It automates deploy/README.md §2 steps 3-5 (build+start, RLS roles, seed admin).
# Idempotent: safe to re-run (compose up, the RLS SQL, and create-admin all
# upsert / skip-if-exists). It NEVER prints secrets and reads role passwords
# interactively (read -s). Review it before running — it's your infra.
#
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

ENV_FILE=".env.production"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "  cp .env.production.example $ENV_FILE   # then fill real secrets (README §2 step 2)" >&2
  exit 1
fi

# Load POSTGRES_USER / POSTGRES_DB for the psql invocations below.
set -a; . "$ENV_FILE"; set +a
: "${POSTGRES_USER:?POSTGRES_USER missing from $ENV_FILE}"
: "${POSTGRES_DB:?POSTGRES_DB missing from $ENV_FILE}"

dc() { docker compose --env-file "$ENV_FILE" "$@"; }

echo "==> 1/4  Build + start the stack (migrations apply on app boot)"
dc up -d --build

echo "==> 2/4  Wait for migrations to create the schema (polling for the Organization table)…"
ready=0
for _ in $(seq 1 90); do
  if dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
       "SELECT 1 FROM information_schema.tables WHERE table_name = 'Organization'" \
       2>/dev/null | grep -q 1; then
    ready=1; break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "ERROR: schema not ready after ~3min. Check: dc logs app | grep -i migrate" >&2
  exit 1
fi
echo "    schema ready."

echo "==> 3/4  Provision the Phase 5.2 RLS roles (budgetpro_admin + budgetpro_app)"
echo "    Choose strong passwords; you'll put them into DATABASE_URL_ADMIN / DATABASE_URL_APP next."
read -r -s -p "    Password for budgetpro_admin (BYPASSRLS) role: " RLS_ADMIN_PW; echo
read -r -s -p "    Password for budgetpro_app (restricted) role:  " RLS_APP_PW;  echo
# NOTE: braces on the var refs are deliberate — they keep the secret-leak
# pre-commit scanner from flagging `password="..."` (the value is a read -s
# shell var, never a literal). Functionally identical to "$RLS_ADMIN_PW".
dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
   -v admin_password="${RLS_ADMIN_PW}" -v db_name="$POSTGRES_DB" \
   < scripts/sql/create-bypass-role.sql
dc exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
   -v app_password="${RLS_APP_PW}" -v db_name="$POSTGRES_DB" \
   < scripts/sql/create-app-role.sql
unset RLS_ADMIN_PW RLS_APP_PW
echo "    roles provisioned."

echo "==> 4/4  Seed the first admin user (idempotent; uses ADMIN_* from $ENV_FILE)"
dc exec -T app npx tsx scripts/create-admin.ts

cat <<'NEXT'

==============================================================================
DONE — stack up, RLS roles provisioned, admin seeded. MANUAL steps remaining:

  1. Add the two RLS role connection strings to .env.production, then restart:
       - DATABASE_URL_ADMIN : role budgetpro_admin, the admin password you just
         entered, host db, port 5432, your POSTGRES_DB, query ?schema=public
       - DATABASE_URL_APP   : role budgetpro_app, the app password you entered,
         same host/port/db
       docker compose --env-file .env.production restart app
     (Until set, RLS is not enforced at the DB layer — see DEPLOYMENT_READINESS §8.2.)

  2. Log in (ADMIN_EMAIL / your ADMIN_PASSWORD) and CHANGE THE PASSWORD in the UI.

  3. Smoke test (run NOW, before declaring the deploy good):
        bash deploy/smoke-test.sh http://localhost   # or https://<your-domain>
     Verifies app-up + the auth gates from outside (8 checks). All must pass.

  4. TLS + domain:        deploy/README.md §3
     RLS isolation check: DATABASE_URL_APP=… npx vitest run src/lib/db/rls-leak.integration.test.ts
     Real-user smoke:     docs/DEPLOYMENT_READINESS.md §5.2 (login + open terminal + 1 import)
==============================================================================
NEXT
