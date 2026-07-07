# RLS Enforcement Flip — Phase 5.2 Stage 3 (pre-Mars gate)

**Status:** in progress (started 2026-07-07). Owner: Claude, ship/cut: Rashad.
**Design provenance:** Codex-architect was UNAVAILABLE (ChatGPT-plan usage limit
until 2026-07-11); per the global protocol this plan was designed inline against
the LOCKED ADR-RLS Round-2 verdict (explicit `withOrgScope` per route — do not
re-litigate). A Codex review pass of the finished flip is queued for when quota
returns.

## Goal

Two real tenants (FO Holding + Mars Overseas) must not be able to leak rows to
each other even through an application-layer bug. That means the app's runtime
Postgres role must NOT be `budgetpro` (SUPERUSER + table owner → every one of
the 67 `tenant_isolation` policies is inert today).

## Verified baseline (2026-07-07)

| Fact | Value |
|---|---|
| Tables with ENABLE RLS + `tenant_isolation` | 67 |
| Org-scoped models in schema (`organizationId String`) | 69 |
| route.ts files under `src/app/api` | 179 |
| Routes wrapped in `withOrgScope` | 16 |
| Unwrapped routes touching org-scoped delegates | 137 |
| Unwrapped routes touching NO org delegate | 26 |
| Dev roles | `budgetpro_app` (NOBYPASSRLS) + `budgetpro_admin` (BYPASSRLS) exist; `.env` has `DATABASE_URL_APP`/`_ADMIN` |
| Prod roles | NEITHER exists; compose passes superuser `DATABASE_URL` only |

## Decision 1 — cutover topology: progressive enforcement, env-flip last

Two clients during migration:

- `prismaApp` (new, `src/lib/db/prisma-app.ts`) — `DATABASE_URL_APP`, RLS
  **enforced**. `withOrgScope` defaults to it. Every wrapped route gets real
  DB-layer isolation the moment it is wrapped — no big-bang.
- Global `prisma` — stays on `DATABASE_URL` (superuser) until the final slice,
  so the 137 unwrapped routes keep working exactly as today (app-layer scoping
  only — same posture as before this work, honestly stated).
- `prismaAdmin` — already exists; cron / cross-org / auth-critical paths move
  to it explicitly.

Final state: runtime default client points at `budgetpro_app` (any future
unwrapped route fails LOUD with 0 rows instead of silently bypassing);
migrations in `docker-entrypoint.sh` keep the superuser/admin URL; rollback is
a single env unset (`DATABASE_URL_APP`), no policy DDL involved.

## Decision 2 — wave plan

- **S0 (infra)**: `prisma-app.ts` (+ boot-time role assertion: log `current_user`
  + `rolbypassrls` on first use; error-level in production when bypassrls=t);
  `withOrgScope` default → `prismaApp`; coverage scanner
  `scripts/rls-coverage-scan.mjs` (report-only, later `--enforce`); leak test
  extended with trade tables. Gate: RLS_INTEGRATION leak test green on dev.
- **S1 (trade wave — the tracker scope)**: wrap all 17 `/api/trade/*` routes;
  handler tests gain the standard `with-org-scope` mock. Gate: trade suites +
  live dev E2E + leak test.
- **S2**: `budgeting/*` remainder (~40 routes).
- **S3**: companies / indicators / scenarios / onboarding / analytics (~50).
- **S4**: the rest + cron routes → `prismaAdmin` + `/api/admin/*` →
  `prismaAdmin` + NextAuth login/session user-lookup → `prismaAdmin`
  (login happens before org context exists; `users` **is** RLS-covered, so the
  app role sees 0 rows there without a scope — auth MUST bypass by design).
- **S5**: scanner → enforcing (pre-commit + CI); dev runtime default flipped to
  `DATABASE_URL_APP`; full regression + soak on dev.
- **S6 (prod)**: user-approved role-provisioning SQL on prod (runbook §1 +
  `create-app-role.sql`), `DATABASE_URL_APP`/`_ADMIN` into `/opt/budgetpro/.env`
  + compose passthrough, deploy, smoke (login OK, trade dashboards non-empty,
  `SELECT current_user` = budgetpro_app, `rolbypassrls=f`). Rollback: unset
  `DATABASE_URL_APP`, redeploy (fall back to superuser).

## Mechanical rules (per route)

Canonical pattern: `docs/RLS_PATTERN_EXAMPLE.md`. Additions for this flip:

1. Route-internal `prisma.$transaction(fn)` collapses INTO the `withOrgScope`
   tx (interactive transactions cannot nest) — the scope IS the transaction.
2. Libs taking a client argument (`recomputeTradePacing`, `logAuditEvent`,
   `findFirstActiveLockInPeriods`, …) receive the scope's `tx`. When such a
   call must run AFTER the main tx commits (e.g. pacing recompute), open a
   SECOND `withOrgScope` block — sequential scoped transactions per request
   are fine; one giant tx around slow work (LLM calls, file parses) is NOT
   (5s interactive-tx timeout + lock hold).
3. Rate-limit, zod parse, auth checks stay OUTSIDE the scope (no DB).
4. Handler tests: `vi.mock("@/lib/db/with-org-scope", () => ({ withOrgScope:
   async (_o, fn) => fn(prismaMock) }))`.

## Risks (ranked) & mitigations

1. **Login bricked at final flip** — `users` is org-scoped ⇒ RLS hides rows
   pre-auth. Auth path moves to `prismaAdmin` in S4 with its own test before
   any env flip.
2. **Interactive-tx timeout on heavy routes** (imports, AI, recompute fan-out)
   — split into multiple scope blocks; never wrap non-DB slow work.
3. **Missed route ⇒ silent empty UI** — scanner in CI + smoke canary asserting
   a known org sees non-empty data + wave-by-wave live checks.
4. **WITH CHECK write failures** exposing latent cross-org writes — that's the
   point; they surface as 500s → fix the write, don't widen the policy.
5. **Global reference tables** (industries, currencies…) have no
   `organizationId` → no policy → unaffected. Verified by the 69-model audit.
6. **Pool leakage** — `SET LOCAL` inside the tx only; raw `SET` is forbidden
   (grep-guard in the scanner).
7. **Migrations** keep a non-enforced role (entrypoint uses superuser URL) —
   `prisma migrate deploy` must never run as `budgetpro_app`.

## Progress log

- 2026-07-07 — plan written; S0 started.
- 2026-07-07 — **S2 write-wave (user-scoped to high-value financial writes).**
  Wrapped: `lines/[id]`, `actuals/[id]`, `lines/count`, `balance-sheet/[id]`,
  `cash-flow/[id]`, `chart-of-accounts` + `[id]`, `sections` + `[id]`,
  `plans/[id]` (GET/PUT/DELETE — the full approval-workflow PUT in one tx;
  loadAndCompute + createNotification are platform stubs today), `period-locks`
  (GET/POST/DELETE — snapshot + audit in-tx). Threaded `tx` through the local
  lock/bypass helpers and loosened 3 shared libs to accept `TransactionClient`:
  `createPeriodSnapshot`, the `import-helpers` audit trio (`logBudgetPlanApprove`
  etc.). **import-csv** (deprecated bulk importer, up to 50k row-creates) is
  `rls-scan-ignore` + switched to `prismaAdmin` — a 50k-row loop can't run in
  one interactive tx and the route is pending removal; app-layer org filters
  preserved. Coverage 33 → 46 wrapped + 1 opted-out; 106 unwrapped remain
  (read routes + non-budgeting domains → Sonnet loop / later waves). Gates:
  tsc 0; full vitest 6298; RLS integration 10/10. Read routes + the plans
  sub-routes (comments/versions/diff/apply-templates/restore/companies/purge/
  create-version) still unwrapped — flagged by the scanner, not hidden.
- 2026-07-07 — **S0 + S1 SHIPPED.** S0: `prisma-app.ts` (RLS-enforced client,
  test-env guard so unit tests keep their mocked client, boot-time role
  assertion), `withOrgScope` default → app client + `timeoutMs`/`maxWaitMs`
  passthrough, coverage scanner (`scripts/rls-coverage-scan.mjs`), leak test
  extended with trade tables incl. a cross-org WITH-CHECK write-rejection
  assertion (10/10 green under `budgetpro_app`). S1: all **17 trade routes
  wrapped** (33 total wrapped, 120 unwrapped remain); route-internal
  `$transaction`s collapsed into the scope tx; `recomputeTradePacing`/
  `buildPacingInput` client params loosened to `TransactionClient`;
  423-audit keeps the global client (fire-and-forget must outlive the tx).
  Live-verified on dev under the ENFORCED role: boot log
  `RLS-enforced client active as "budgetpro_app"`, all 6 trade GETs return
  demo data, spend POST 201 + void 200, playwright smoke green. Incident en
  route: flipping the withOrgScope default handed REAL Prisma clients to old
  handler tests (dotenv leak) → FK-violation failures against the dev DB;
  fixed with the test-env guard; DB verified intact (fixture org ids don't
  exist → all writes rejected by FK).
