# TASK for Codex — RLS Phase 5.2 S6: enforce Row-Level Security on PRODUCTION

**You are executing the final "enforcement flip" of an RLS rollout on the
production server.** Everything in the application code is already done and
deployed; your job is the operational/DB step that provisions two Postgres
roles, points the app's runtime connection at the restricted one, and verifies
per-org isolation now holds at the database layer. This is self-contained — you
do NOT need any prior chat context.

> ⚠️ **High-severity + outward-facing.** You will `CREATE ROLE … BYPASSRLS` and
> edit a production env file. Do NOT commit `.env.production`. Do NOT run
> destructive DB statements. If any verification step fails, STOP and roll back
> (see §7) rather than improvising.

---

## 1. Background (what's already true — do not redo)

- Stack: Next.js 16 + Prisma 6.19 + Postgres 16, deployed on a single VM via
  `docker compose`. Multi-tenant; org isolation is enforced in the app layer AND
  (once this task lands) at the DB layer via RLS policies.
- The DB already has **67 tables with `ENABLE ROW LEVEL SECURITY` +
  `tenant_isolation` policies** of the shape
  `("organizationId" = current_setting('app.organization_id', true) OR current_setting('app.bypass_rls', true) = 'true')`.
  (Applied by prisma migrations; `prisma migrate deploy` is up to date on prod.)
- Application code (already committed + deployed to prod, commit `9fdfc91c`):
  - Every org-scoped HTTP route runs its DB work inside `withOrgScope(orgId, fn)`
    which opens a tx on the **app client** and emits `SET LOCAL app.organization_id = '<orgId>'`.
  - Three clients exist: global `prisma` (`@/lib/prisma`, `DATABASE_URL`),
    `prismaApp` (`@/lib/db/prisma-app`, `DATABASE_URL_APP`), `prismaAdmin`
    (`@/lib/db/prisma-admin`, `DATABASE_URL_ADMIN`).
  - Auth, fire-and-forget audits, post-tx recompute, LLM metering, and 8
    cross-cutting write helpers are already routed to `prismaAdmin`.
  - **When `DATABASE_URL_APP` / `DATABASE_URL_ADMIN` are UNSET, all three clients
    fall back to the superuser `DATABASE_URL`** — so today prod runs
    behaviour-identical to before, and logs on boot:
    `db:prisma-app  "DATABASE_URL_APP not set — … RLS policies are NOT enforced …"`.
- The role-provisioning SQL scripts are already in the repo and on prod:
  - `scripts/sql/create-bypass-role.sql` → creates `budgetpro_admin` **WITH BYPASSRLS**
    (for migrations, cron, admin routes). Expects psql var `-v admin_password=… -v db_name=…`.
  - `scripts/sql/create-app-role.sql` → creates `budgetpro_app` **NOBYPASSRLS**
    (the RLS-enforced role HTTP handlers use). Expects `-v app_password=… -v db_name=…`.
  Both are **idempotent** (create-if-missing; re-runs are safe; `create-app-role.sql`
  defensively re-asserts `NOBYPASSRLS`).

## 2. Environment facts

| Thing | Value |
|---|---|
| Prod host | `ssh root@46.225.60.142` |
| App dir | `/opt/budgetpro` |
| Env file | `/opt/budgetpro/.env.production` (contains `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, …) |
| Compose DB service / container | service `db` / container `budgetpro-db` (postgres:16-alpine) |
| Compose app service / container | service `app` / container `budgetpro-app` |
| DB host **inside** the compose network | `db:5432` (use this in the new URLs, NOT `localhost`) |
| Compose invocation the deploy uses | `docker compose --env-file .env.production …` |

## 3. Goal / definition of done

1. Roles `budgetpro_admin` (BYPASSRLS) and `budgetpro_app` (NOBYPASSRLS) exist on
   the prod DB with the right attributes and table/sequence grants.
2. `.env.production` has `DATABASE_URL_ADMIN` (budgetpro_admin) and
   `DATABASE_URL_APP` (budgetpro_app), both `@db:5432/<POSTGRES_DB>?schema=public`.
3. The `app` container has been **recreated** (not just restarted) so it reads
   the new env; boot log now says
   `db:prisma-app  "RLS-enforced client active as \"budgetpro_app\""` (or equivalent)
   and NO LONGER says "DATABASE_URL_APP not set".
4. Smoke passes (§6): login works, the risk-terminal dashboard renders **non-empty**
   data, and `SELECT current_user` on an app-role connection returns `budgetpro_app`
   with `rolbypassrls = f`.

## 4. Preconditions to check first (abort if any fails)

Run on prod, in `/opt/budgetpro`:
```bash
set -a && . ./.env.production && set +a
echo "user=$POSTGRES_USER  db=$POSTGRES_DB"           # must print real, non-empty values
ls scripts/sql/create-bypass-role.sql scripts/sql/create-app-role.sql   # both must exist
docker compose --env-file .env.production ps          # db + app must be Up/healthy
docker compose --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select count(*) from pg_policies where policyname='tenant_isolation'"   # expect ~67
```
If `POSTGRES_USER`/`POSTGRES_DB` print empty, the env file name differs — find the
right one before continuing. If the policy count is 0, RLS migrations aren't applied
— STOP (this task assumes they are).

## 5. Execute (all on prod, in `/opt/budgetpro`, bash)

```bash
# 5.1 load DB name/user into the shell
set -a && . ./.env.production && set +a

# 5.2 generate URL-SAFE passwords (hex → no /,+,= that break connection URLs)
ADMIN_PW=$(openssl rand -hex 24)
APP_PW=$(openssl rand -hex 24)

# 5.3 provision the BYPASSRLS admin role
# (ADMIN_PW / APP_PW below are shell VARIABLES set in 5.2 — not literals;
#  they are hex so they need no quoting. The SQL quotes them safely via %L / :'…'.)
docker compose --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v admin_password=$ADMIN_PW -v db_name="$POSTGRES_DB" \
  < scripts/sql/create-bypass-role.sql

# 5.4 provision the NOBYPASSRLS app role
docker compose --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_password=$APP_PW -v db_name="$POSTGRES_DB" \
  < scripts/sql/create-app-role.sql

# 5.5 verify role attributes — MUST be budgetpro_admin|t and budgetpro_app|f
docker compose --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -tAc "select rolname, rolbypassrls from pg_roles where rolname like 'budgetpro_%' order by rolname"

# 5.6 append the two connection URLs to the prod env (host db:5432, from the vars)
cat >> .env.production <<EOF
DATABASE_URL_ADMIN="postgresql://budgetpro_admin:${ADMIN_PW}@db:5432/${POSTGRES_DB}?schema=public"
DATABASE_URL_APP="postgresql://budgetpro_app:${APP_PW}@db:5432/${POSTGRES_DB}?schema=public"
EOF
grep -nE "DATABASE_URL_(APP|ADMIN)" .env.production   # confirm both lines present, once each

# 5.7 recreate the app container so it re-reads env (restart does NOT re-read env)
set -a && . ./.env.production && set +a
docker compose --env-file .env.production up -d
```

Notes:
- `create-app-role.sql` grants `SELECT/INSERT/UPDATE/DELETE` on all tables +
  sequences + `ALTER DEFAULT PRIVILEGES` (future tables inherit). RLS policies —
  not GRANTs — are what scope rows to the caller's org. Don't add extra grants.
- If a `budgetpro_*` role already exists (partial prior run), the scripts no-op
  safely; the append in 5.6 must NOT duplicate lines — if the keys already exist,
  edit them in place instead of appending.

## 6. Smoke / verification (run NOW; all must pass)

```bash
# 6.1 boot log flipped to enforced
docker compose --env-file .env.production logs app --since=3m \
  | grep -iE "prisma-app|budgetpro_app|not set"
#   expect a line like: RLS-enforced client active as "budgetpro_app"
#   expect NO "DATABASE_URL_APP not set" line from THIS boot.

# 6.2 the app role is genuinely restricted, and RLS enforces at the DB layer.
#     Pick any real org id, then prove: no scope → 0 rows; with scope → own rows.
ORG=$(docker compose --env-file .env.production exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select \"organizationId\" from companies group by \"organizationId\" order by count(*) desc limit 1")
echo "orgId=$ORG"
# connect AS budgetpro_app (source the APP_PW you set; or re-read the URL from .env.production)
docker compose --env-file .env.production exec -T db \
  psql "postgresql://budgetpro_app:${APP_PW}@localhost:5432/${POSTGRES_DB}" -tAc \
  "select rolbypassrls from pg_roles where rolname=current_user"            # expect: f  … current_user=budgetpro_app
docker compose --env-file .env.production exec -T db \
  psql "postgresql://budgetpro_app:${APP_PW}@localhost:5432/${POSTGRES_DB}" -tAc \
  "select count(*) from companies"                                          # expect: 0  (no scope → RLS hides all)
docker compose --env-file .env.production exec -T db \
  psql "postgresql://budgetpro_app:${APP_PW}@localhost:5432/${POSTGRES_DB}" -tAc \
  "set app.organization_id='$ORG'; select count(*) from companies"         # expect: > 0 (own-org rows visible)
```
(Inside the `db` container `localhost:5432` is the DB itself — that's why 6.2 uses
`localhost` while the app's URL in `.env.production` uses `db`.)

```bash
# 6.3 HTTP: app still serves + auth gate intact (external)
bash deploy/smoke-test.sh http://localhost      # or https://<domain> — all 8 checks must pass
```
Then MANUALLY: log into the UI, open the Risk Terminal / a budgeting dashboard,
confirm it renders **real, non-empty** data (this proves `withOrgScope` under the
app role correctly sees the caller's own rows). If a dashboard is unexpectedly
EMPTY or a page 500s → a code path is missing org context → **roll back (§7)** and
report the exact route + the container log error (grep for `permission denied` /
`row-level security` / `violates`).

## 7. Rollback (if any §6 check fails)

```bash
# remove ONLY the DATABASE_URL_APP line (keeping the admin role/URL is harmless);
# the app then falls back to the superuser DATABASE_URL — app-layer org scoping
# still holds, DB-layer RLS simply stops enforcing.
sed -i '/^DATABASE_URL_APP=/d' .env.production
set -a && . ./.env.production && set +a
docker compose --env-file .env.production up -d
docker compose --env-file .env.production logs app --since=1m | grep -i "not set"   # back to "not set" = rolled back
```
The `budgetpro_app` / `budgetpro_admin` roles can be left in place (unused) or
dropped with `DROP ROLE budgetpro_app;` / `DROP ROLE budgetpro_admin;` as superuser.

## 8. Report back (what to hand back to the human)

- The §5.5 role-attribute output (must show `budgetpro_admin|t`, `budgetpro_app|f`).
- The §6.1 boot-log line proving the enforced client is active.
- The §6.2 three counts (`f`, `0`, `>0`).
- §6.3 smoke result + the manual dashboard-non-empty confirmation.
- Whether you rolled back and why (if applicable).
- **Do NOT print the generated passwords into any committed file or the chat
  transcript**; they now live only in `.env.production` on the host.

## 9. Out of scope / follow-ups for the human (NOT this task)

- ~~**Rotate the production demo admin password** before giving the 2nd tenant
  (Mars Overseas) access.~~ **DONE 2026-07-16:** production `admin@fo.az` now
  has a new strong credential and authenticated smoke passed. `NEXTAUTH_SECRET`
  was also rotated with an app force-recreate: a captured pre-rotation JWT was
  rejected, while a fresh login succeeded and the terminal rendered 168 cells.
  No secret value is recorded in this document.
- Wiring `node scripts/rls-coverage-scan.mjs --enforce` into CI to block new
  unwrapped routes (a code/CI change, can be a separate PR).
- **TLS/domain remains OPEN and blocks client access:** `budget.fo.az`, `fo.az`
  and `staging.budget.fo.az` are NXDOMAIN; `NEXTAUTH_URL` is the HTTP IP,
  certbot/certificates are absent, and effective nginx listens only on 80
  despite Docker publishing 443. A real FQDN + DNS control are required before
  ACME issuance, HTTPS verification and redirect. SMTP remains a separate
  pre-existing item.
- Move the temporary root-only credential/recovery artifacts to an approved
  vault and establish a break-glass admin/recovery path; there is currently one
  active production admin.
