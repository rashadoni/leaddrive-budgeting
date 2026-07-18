# Native-BYPASSRLS audit

**Date:** 2026-07-18
**Status:** read-only production catalog audit complete; first narrow migration
candidate isolated-live-tested; no production migration or authentication
change from this audit.

## 1. Exact production inventory

The production catalog, not the migration source alone, is the authority for
these counts:

| Item | Count | Current production shape |
|---|---:|---|
| RLS-enabled tables | 70 | all have `relforcerowsecurity=false` |
| Policies trusting `app.bypass_rls` | 68 | 55 baseline + 13 Trade; all are `FOR ALL` |
| DataRevision | 1 table / 3 policies | already native-bypass-only after migration 18 |
| Industries | 1 policy | `FOR ALL USING (true)`, no organization column |

`budgetpro_app` is non-superuser/NOBYPASSRLS and `budgetpro_admin` is
non-superuser/BYPASSRLS. That role split is correct. The remaining weakness is
that a custom PostgreSQL GUC is user-settable: a regular DB session can execute
`SET LOCAL app.bypass_rls = 'true'`. A policy must therefore never treat that
value as authorization.

No production application caller uses `withOrgScope(..., { bypass: true })`.
The only callers were positive-leak tests. Removing the helper option closes an
internal footgun, but the 67 ordinary policies still need migration because a
future raw-SQL bug or direct app-role connection could set the GUC without the
helper.

## 2. Global catalog findings

### `indicator_definitions`

- Contract: `organizationId=null` is a product-owned global seed;
  non-null is a tenant override.
- Production: 110 rows, all 110 global.
- Current production policy is `FOR ALL` and allows global, own-org, or GUC
  bypass. With broad table CRUD grants, request-role traffic can therefore
  update/delete a global seed or insert another global row.
- Required shape: SELECT global + own; INSERT/UPDATE/DELETE own only. Native
  `budgetpro_admin` remains the global seed/migration writer.

### `industries`

- Contract: shared product taxonomy with no `organizationId`.
- Production: 14 rows.
- Current policy is `FOR ALL USING (true)`; `budgetpro_app` also has full
  table CRUD. RLS therefore provides no write protection.
- Required shape: public SELECT only, no request-role DML policy, plus explicit
  INSERT/UPDATE/DELETE revoke after the provisioning script's broad grants.

## 3. Runtime and scanner findings

- The deprecated `withOrgScope({ bypass: true })` path had no production
  caller and is removed in the candidate. Stale untyped callers fail closed;
  native `prismaAdmin` is the sole cross-org boundary.
- `scripts/sql/gen-rls-migrations.sh` still generated the unsafe historical
  GUC policy and incorrectly treated `industries` as org-scoped. It is now
  retired and exits non-zero.
- The API scanner has 22 explicit `rls-scan-ignore` routes; 26 API routes
  import `prismaAdmin`. Only `cron/refresh-feeds` and `cron/trade-digest`
  are intrinsically cross-org. The remaining long-lived import/AI/admin/public
  paths need a per-route client-boundary review; an application `admin` role
  does not itself justify DB BYPASSRLS.
- `prisma-app.ts` and `prisma-admin.ts` still fall back to the default client
  when their dedicated URL is missing. Production currently supplies both, but
  a later slice should fail fast rather than log and continue.
- The boot-time app-role assertion is asynchronous/log-only. A wrong URL can
  start serving before the assertion reports it.
- `company_indicators` and other tenant-child tables without a direct
  `organizationId` are outside the 68-policy inventory. They require a
  separate FK-derived RLS review; a scoped parent lookup is not a table policy.

## 4. Auth boundary discovered, not changed

Login performs a global `findFirst({ email, isActive:true })`, while the schema
uniqueness is `(organizationId, email)`. The login request does not carry an
organization selector. Two tenants can therefore legally have the same email,
making authentication selection ambiguous.

No password, passwordHash, session secret, login flow or production
authentication was changed. Before the `users` policy cohort, the owner must
choose one contract:

1. globally unique login email; or
2. organization-qualified login.

A two-org/same-email negative control is mandatory for that slice.

## 5. Operation-specific policy debt

A mechanical `FOR ALL` rewrite would miss domain semantics:

- `audit_events`: append-only request path; retention/delete belongs to admin.
- `period_snapshots`: immutable fingerprint record; request path should not
  rewrite/delete history.
- `trade_spend_ledger`: append-only ledger with explicit void semantics;
  request DELETE must not exist and UPDATE needs a trigger/column contract.
- `alert_events`: not append-only — runtime intentionally replaces the current
  period, so it cannot share the evidence-table policy blindly.
- `budget_change_logs`: legitimate purge endpoints exist and need explicit
  retention semantics before restriction.

## 6. Safe migration cohorts

1. **Runtime + global catalogs (current candidate):** remove helper bypass,
   retire generator, split `indicator_definitions`, make `industries`
   request-role read-only.
2. **Evidence/immutable:** audit events, period snapshots, Trade ledger, then AI
   usage after its accounting semantics are confirmed.
3. **Identity/config:** users only after the duplicate-email decision; then
   companies, user preferences, departments, CoA and currencies.
4. **Financial truth:** plans, lines, actuals, BS/CF/COGS/sales and forecasts.
5. **Risk/intel/alerts/caches:** preserve alert replace semantics.
6. **Imports/integrations/staging/AI:** preserve cleanup and retry deletion.
7. **Trade remainder:** separate master data, replaceable derived snapshots and
   immutable ledger behavior.

Each cohort needs: fresh replay, predecessor upgrade, intentional preflight
failure with atomic rollback, app/admin role assertions, absent-scope denial,
A/B read/write/delete isolation, GUC negative control, connection-pool reset,
native-admin success, grants/policy catalog proof and a production backup before
any owner-approved deployment.

## 7. Current candidate and evidence

`20260718133000_global_catalog_rls_guards` is a candidate only.

- Atomic `BEGIN/COMMIT`, 5-second lock timeout and exact predecessor-policy
  preflight.
- Fresh replay: all 19 migrations.
- Valid upgrade: 18 → 19.
- Negative catalog drift: migration rejected, policy fingerprint unchanged,
  migration not finished.
- Live gate under real-shaped roles: 4 files / 59 tests passed.
- Focused default gate: 3 files passed + live file skipped, 16 tests passed.
- Full Vitest: 522 files passed, 6,790 tests passed, 68 skipped, 0 failed.
- TypeScript, Prisma validate and the 158-page Next.js production build: clean.
- Disposable PostgreSQL 16 container/tmpfs removed after the gate.
- Expected post-candidate count: 67 ordinary GUC policies remain.
- Production is still on migration 18 and retains 68 GUC policies until an
  explicit later deployment approval.
