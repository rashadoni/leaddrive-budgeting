# Phase 5.2 RLS — Operations Runbook

Operational procedures for the Postgres RLS rollout. See [ADR-RLS.md](ADR-RLS.md) for the design decisions; this doc is "click these commands in this order".

## §1 — Provision `budgetpro_admin` BYPASSRLS role (USER ACTION REQUIRED)

**Why:** cron jobs, migrations, and admin scripts need to read/write across orgs without going through RLS. The right pattern is a dedicated Postgres role with `BYPASSRLS` privilege, used via a separate `DATABASE_URL_ADMIN` connection string. The short-term `withOrgScope(orgId, fn, { bypass: true })` flag will be deprecated within 2 weeks of this role landing.

**Why USER action (not Claude auto-applied):** creating a permanent role with BYPASSRLS + ALL PRIVILEGES is a high-severity permission grant. The auto-classifier blocked the create attempt on 2026-05-16 — correctly. This SQL must be run by the human with explicit intent.

### Step 1 — Generate a strong password

```bash
# 32 random bytes, base64 — 256-bit entropy
openssl rand -base64 32
```

Save the output; you'll need it for both Step 2 (SQL) and Step 3 (env var).

### Step 2 — Run the role-provision SQL

Connect to the dev/staging/prod Postgres as a superuser:

```bash
psql $DATABASE_URL
```

Then execute (replace `<PASSWORD_FROM_STEP_1>`):

```sql
-- Idempotent guard — re-runs of this block are safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budgetpro_admin') THEN
    EXECUTE format(
      'CREATE ROLE budgetpro_admin WITH LOGIN PASSWORD %L BYPASSRLS',
      '<PASSWORD_FROM_STEP_1>'
    );
  END IF;
END$$;

-- Grants: full read/write on every existing table + sequence in the
-- public schema. ALTER DEFAULT PRIVILEGES picks up tables added by
-- future Prisma migrations automatically.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO budgetpro_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO budgetpro_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO budgetpro_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO budgetpro_admin;

-- Verify the BYPASSRLS attribute landed.
SELECT rolname, rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname = 'budgetpro_admin';
-- Expect: budgetpro_admin | t | t
```

### Step 3 — Add `DATABASE_URL_ADMIN` to `.env`

In `.env` (and any deploy env — staging, prod), add a line **alongside** the existing `DATABASE_URL`:

```bash
# Existing app connection — subject to RLS policies (default)
DATABASE_URL="postgresql://budgetpro:<app_pw>@localhost:5432/budgetpro?schema=public"

# Admin/cron connection — BYPASSRLS role for migrations + scheduled jobs
DATABASE_URL_ADMIN="postgresql://budgetpro_admin:<PASSWORD_FROM_STEP_1>@localhost:5432/budgetpro?schema=public"
```

Both URLs point at the **same** database; the difference is the connection role and therefore RLS-policy behavior.

### Step 4 — Wire the admin client (Claude-pending)

After the role + env var are set, Claude will:
1. Add `prismaAdmin` export to `src/lib/prisma.ts` that reads `DATABASE_URL_ADMIN`.
2. Migrate `scripts/*.cjs` + `scripts/*.ts` + cron entry points to use `prismaAdmin` for cross-org work.
3. Deprecate the `withOrgScope(..., { bypass: true })` flag — surfaces a `console.warn` for 2 weeks, then removed.

### Verification

After Step 4, run the integration test in bypass mode:

```bash
RLS_INTEGRATION=1 npx vitest run src/lib/db/rls-leak.integration.test.ts -t "bypass"
```

Expect: bypass case passes (returns both orgs' rows).

---

## §2 — Apply an RLS migration to a table (per-table playbook)

Order per [ADR-RLS.md §Rollout sequencing](ADR-RLS.md#rollout-sequencing):
indicator_values → audit_events → budget_change_log → companies → budget_lines → …

### Pre-flight (before each table)

1. Confirm the table has a leading-`organizationId` index — otherwise the RLS policy predicate becomes a seq-scan trap at scale:
   ```bash
   psql $DATABASE_URL -c "\d <table_name>" | grep -i organizationId
   ```
2. Re-measure [RLS_PERF_BASELINE.md](RLS_PERF_BASELINE.md) on the candidate's heaviest query.
3. Verify all production callsites that touch this table are either:
   - Inside a request-flow path covered by the ALS+`$extends` middleware (default), OR
   - Wrapped in an explicit `withOrgScope(orgId, ...)` (cron / admin).

### Apply

```bash
# Run pending migration (Prisma auto-runs idempotent CREATE POLICY blocks)
cd /Users/rashadrahimov/Documents/leaddrive-budgeting
npx prisma migrate deploy
```

### Verify

```bash
# Integration leak test should now PASS (was failing pre-RLS)
set -a && source .env && set +a
RLS_INTEGRATION=1 npx vitest run src/lib/db/rls-leak.integration.test.ts

# Full e2e suite — confirm wrapped paths still work
npm run test:e2e -- azerseker-pilot
```

### Rollback (if anything breaks)

```sql
-- Replace <table_name> with the table whose RLS broke
ALTER TABLE <table_name> DISABLE ROW LEVEL SECURITY;
```

Plus:
```bash
# Mark the migration rolled back so future deploys re-attempt
npx prisma migrate resolve --rolled-back <migration_name>
```

Rollback is a one-line SQL because RLS-disable is non-destructive — no data lost, just enforcement off.

---

## §3 — Daily monitoring (after first table goes live)

Cron query to detect missing-orgId queries that bypassed the middleware:

```sql
-- Postgres log analysis (requires log_min_duration_statement + log_line_prefix set)
-- Look for queries against RLS-enabled tables that DID NOT preceded by SET LOCAL
-- TODO: define query pattern in Stage 3 when production logs are wired
```

(This section gets fleshed out when prod logging infrastructure lands; out-of-scope for the rollout.)
