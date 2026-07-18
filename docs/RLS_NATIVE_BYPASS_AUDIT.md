# Native-BYPASSRLS audit

**Date:** 2026-07-18
**Status:** read-only production catalog audit complete; global-catalog,
evidence-core, standalone Trade-ledger, AI-accounting and user-layout
preference candidates isolated-live-tested; no production migration or
authentication change from this audit.

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
2. **Evidence core (current stacked candidate):** audit events and period
   snapshots only; preserve audit actor nullification/retention and snapshot
   re-sign history.
3. **Trade ledger standalone (current stacked candidate):** add the missing
   Organization/same-org spend-type integrity and permit only the one-time void
   transition.
4. **System accounting (current stacked candidate):** AI usage is request-role
   SELECT-only; native admin keeps non-negative correction semantics and RLS
   configuration fails closed without its dedicated URL.
5. **Identity/config:** user layout preferences are now isolated as an
   auth-neutral tenant/integrity candidate. Users wait for the duplicate-email
   decision; then departments, currencies, CoA and companies follow as
   operation-specific slices.
6. **Financial truth:** plans, lines, actuals, BS/CF/COGS/sales and forecasts.
7. **Risk/intel/alerts/caches:** preserve alert replace semantics.
8. **Imports/integrations/staging/AI + Trade remainder:** preserve cleanup,
   retry deletion, replaceable derived snapshots and master-data behavior.

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

## 8. Evidence-core stacked candidate

`20260718143000_evidence_core_rls_guards` follows the unapplied global-catalog
candidate and is also candidate-only.

- Scope is only `audit_events` and `period_snapshots`; both become
  request-role SELECT+INSERT with no GUC clause.
- Request-role UPDATE/DELETE is revoked on both tables.
- The existing audit INSERT notification trigger is preserved. Audit retention,
  actor `ON DELETE SET NULL`, and tenant erasure remain native-admin behavior.
- PeriodSnapshot UPDATE is rejected even for native admin; re-signing remains
  a new INSERT.
- Fresh replay: 20 migrations; valid upgrade: 19 → 20.
- Intentional predecessor-policy drift: rejected atomically with an unchanged
  policy fingerprint.
- Full live RLS gate: 5 files / 67 tests under real-shaped roles.
- Full default gate: 523 files passed, 6,796 tests passed, 76 skipped.
- Expected post-stack GUC count: 65.
- TypeScript, Prisma validate, RLS scanner and 158-page production build: clean.
- Disposable PostgreSQL containers/tmpfs removed.

Production remains on migration 18 with 68 GUC policies. Trade ledger and AI
usage are not part of this migration.

## 9. Trade spend-ledger stacked candidate

`20260718153000_trade_spend_ledger_guards` follows the two unapplied
candidates and is also candidate-only.

- Adds a real Organization FK with tenant-erasure cascade and organization-id
  update restriction.
- A fixed-search-path `SECURITY DEFINER` trigger rejects missing/cross-org
  spend types, prevoided inserts, partial voids and every UPDATE except the
  exact one-time `(voidedAt, voidedBy)` transition from both null to both set.
- Request-role policies are SELECT, unvoided INSERT and one-time void UPDATE;
  no DELETE policy or custom-GUC bypass remains on this table.
- App-role DELETE and table-wide UPDATE are revoked; column UPDATE remains only
  for `voidedAt` and `voidedBy`. Native admin retains tenant erasure and
  break-glass deletion.
- Fresh replay: 21 migrations; valid upgrade: 20 → 21 with the existing row
  preserved; intentional cross-org predecessor drift rejected atomically with
  the old policy, row and catalog unchanged.
- Complete live RLS gate: 6 files / 74 tests under real-shaped roles. Catalog:
  79 total policies, 64 remaining GUC-bypass policies, Trade DELETE=false,
  void-column UPDATE=true, amount UPDATE=false.
- Full default gate: 524 files passed + 7 skipped, 6,802 tests passed + 83
  skipped; TypeScript, Prisma validate/generate, RLS scanner (179 routes / 0
  unwrapped) and the 158-page production build are clean.
- The disposable PostgreSQL container/tmpfs and temporary migration copy were
  removed.
- Deferred Trade remainder: `createdBy`/`voidedBy` and optional
  campaign/dimension IDs are still scalar references. Their same-org and
  `SET NULL`/`RESTRICT`/cascade semantics need a separate owner-reviewed
  integrity slice.

All three candidates remain unapplied. Production remains on SHA `ded040c2`,
migration 18 and 68 GUC-bypass policies. The next cohort is system accounting
(`ai_token_usage`) only after native-admin fail-fast and correction/monotonicity
semantics are approved.

## 10. AI token-accounting stacked candidate

`20260718163000_ai_token_usage_guards` follows the three unapplied
candidates and is also candidate-only.

- Request traffic only reads tenant usage; all runtime writes remain atomic
  native-admin upserts.
- The request role receives one tenant SELECT policy with no custom-GUC bypass;
  provisioning revokes INSERT, UPDATE and DELETE.
- A validated DB constraint prevents negative input, output or call counters.
  Native admin may still correct over-counting downward while totals stay
  non-negative; strict monotonicity is deliberately not imposed.
- `checkBudget` fails before a paid provider call when RLS has an app URL but
  no native-admin URL. `recordUsage` rejects negative, fractional, infinite
  and unsafe token increments.
- Production read-only evidence: 7 rows, 36 calls, 840,507 input tokens, 61,859
  output tokens, 0 negative rows, 0 orphan organizations. The current app role
  still has CRUD because this candidate is not deployed.
- Fresh replay: 22 migrations; valid upgrade: 21 → 22 preserving 150 synthetic
  tokens; intentional negative predecessor rejected atomically with the legacy
  policy and row intact.
- Full live RLS: 7 files / 80 tests. Post-stack catalog: 79 policies, 63 GUC
  policies; app SELECT=true and all DML=false.
- Full default: 525 files passed + 8 skipped / 6,814 tests passed + 89 skipped;
  TypeScript, Prisma, 179-route scanner and 158-page build are clean.
- Disposable PostgreSQL/tmpfs and temporary migration copy were removed.

All four candidates remain unapplied. Production remains on `ded040c2`,
migration 18 and 68 GUC policies. Identity/config is the next cohort; users are
blocked on the globally-unique-versus-org-qualified login contract.

## 11. User layout-preference stacked candidate

`20260718170000_user_layout_preference_guards` follows the four unapplied
candidates and is also candidate-only.

- It replaces the legacy GUC-trusting `FOR ALL` policy with exact tenant
  SELECT, INSERT, UPDATE and DELETE policies. Existing request CRUD semantics
  are preserved.
- A fixed-search-path `SECURITY DEFINER` trigger rejects a layout whose user
  belongs to another organization. A paired users trigger rejects moving a
  user across organizations while saved layouts exist.
- Both triggers take the same transaction advisory lock. The migration also
  takes `SHARE ROW EXCLUSIVE` locks before its integrity preflight, closing the
  concurrent insert/reassignment and preflight TOCTOU windows.
- This is tenant isolation, not user-identity RLS: the shared request DB role
  has no trusted per-user identity. Existing layout routes continue to enforce
  ownership with `session.userId`; a separate trusted actor-context design is
  required before user-level DB policy can be claimed.
- The `users` policy, login lookup, JWT refresh, email uniqueness, passwordHash
  and role behavior are unchanged. Duplicate-email login remains an owner
  decision.
- Fresh replay: 23 migrations. Valid upgrade: 22 → 23 preserving the existing
  layout. Intentional cross-org data drift and unexpected policy drift both
  failed atomically with predecessor state intact.
- The concurrency regression proved a user move waits for a concurrent layout
  insert and is then rejected. User deletion still cascades layouts.
- Full live RLS: 8 files / 88 tests. Post-stack catalog: 82 policies, 62 GUC
  policies, four layout policies and two enabled guards; app is NOBYPASSRLS
  and has no direct EXECUTE on the guard functions.
- Full default: 526 files passed + 9 skipped / 6,819 tests passed + 97 skipped;
  Prisma, TypeScript, 179-route scanner and 158-page build are clean.
- Disposable PostgreSQL/tmpfs and temporary migration copy were removed.

All five candidates remain unapplied. Production was not migrated or deployed
and remains on the last verified `ded040c2`, migration 18 and 68 GUC policies;
direct SSH re-verification is unavailable from remote-dev. The next
auth-neutral slice is `budget_departments` after its FK-consumer audit. Users
remain blocked on globally unique versus organization-qualified login.
