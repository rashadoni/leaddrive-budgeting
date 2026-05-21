# ADR — Phase 5.2 Postgres RLS scope-injection mechanism

**Status:** ACCEPTED · 2026-05-16
**Context:** [docs/ROADMAP.md §Phase 5.2](ROADMAP.md), [memory: feedback_no_agents.md](../.claude/memory/feedback_no_agents.md) (RLS = high-risk class), architect review 2026-05-16 (verdict 🟡 PROCEED WITH GUARDRAILS).

## Problem

53 Prisma models carry `organizationId`. Postgres RLS policies will require `app.organization_id` to be set on the session **before every query** that touches an RLS-enabled table. Two patterns considered:

| Pattern | Pros | Cons |
|---|---|---|
| **A. Pure explicit wrapper** (`withOrgScope(orgId, fn)` at every callsite) | Maximally auditable; grep-able; no "magic" | 500–1000 manual edits across `src/app/api/**` + `src/lib/**`; every new route must remember to wrap; regression-prone over 6+ months |
| **B. Pure middleware** (`prisma.$use` or `$extends({query})` reads ALS-stored orgId, auto-injects `SET LOCAL`) | Single point of enforcement; new routes get coverage automatically | "Magic" — orgId resolution is invisible at the callsite; risks if ALS context leaks across request boundaries (streaming, server actions); harder to audit |
| **C. Hybrid (this ADR)** | Middleware as default for API request flow; explicit wrapper for cron / migrations / admin-cross-org reads | Two paths to reason about; clear documentation needed on when to use each |

## Decision

**C — Hybrid.**

- **Default (API request flow):** Next.js middleware at `middleware.ts` resolves `orgId` from the session and stores it in `AsyncLocalStorage<{ orgId: string }>`. A Prisma `$extends({ query })` extension reads ALS in every query and emits `SET LOCAL "app.organization_id" = '<orgId>'` at the head of an implicit transaction. New API routes need ZERO awareness of RLS.
- **Explicit wrapper (`withOrgScope`):** Required for paths where ALS context is unavailable or wrong:
  - **Cron / batch scripts** (`scripts/*.cjs`) — no Next.js request context; orgId comes from argv or env.
  - **Background workers** (`scripts/intel-scheduler-bootstrap.ts`) — same as cron.
  - **Cross-org admin reads** (e.g. holding-wide reporting) — wrapper called with each `orgId` in a loop, OR with `bypass: true`.
  - **Migrations / seed scripts** — `bypass: true` via the dedicated `BYPASSRLS` Postgres role (precondition #4 of this rollout).
- **Bypass:** SHORT-TERM the `withOrgScope(orgId, fn, { bypass: true })` flag stays. LONG-TERM (within 2 weeks per architect) it's deprecated in favor of a separate `DATABASE_URL_ADMIN` connection string pointing at a Postgres role with `BYPASSRLS` privilege; cron/migrations switch to that client.

## Why Hybrid (not pure A or B)

- **Pure A** was rejected because the mechanical-refactor cost (2-3 weeks) creates a long window where some routes are wrapped and others aren't — exactly the silent-leak class we're trying to prevent. New routes added during that window won't get retrofitted automatically.
- **Pure B** was rejected because the bypass paths (cron, cross-org admin) need explicit intent. A pure-middleware design forces these to either bypass globally (insecure) or use a hacky "fake orgId" pattern.
- **Hybrid** isolates the two cases: 95%+ of code runs through ALS+middleware silently; the remaining 5% (clearly tagged as cron/admin/migration) uses the explicit wrapper.

## Rollout sequencing

Architect-approved order, sensitivity × surface descending:
1. `indicator_values` (pilot — highest-traffic, well-isolated; migration already written)
2. `audit_events` (compliance — never want cross-tenant audit leak)
3. `budget_change_log` (lowest-break-risk append-only — safe to enable broad after pilot)
4. `companies` (admin UIs cross orgs — apply AFTER middleware proven on 3 tables)
5. `budget_lines`, `budget_plans` (financial truth)
6. `client_reconciliations`, `indicator_disclosures` (sensitive client data)
7. … remaining 46 by query frequency × data sensitivity

**Per-table loop:**
1. Add `seedMultiOrg()` fixture rows for the table.
2. Write failing leak test (org A session → endpoint hitting this table → assert 0 rows from org B).
3. Wrap the most-touched callsites (or confirm middleware coverage if it's a request-flow path).
4. Run vitest + Playwright e2e end-to-end **with RLS still disabled** — confirms wrap doesn't break anything.
5. Apply RLS migration for the table (`prisma migrate deploy`).
6. Re-run vitest + e2e — confirms RLS doesn't break wrapped paths; leak test must now pass.
7. Architect Round-N before next table.

## Constraints inherited

- `SET LOCAL` only persists for the duration of the surrounding transaction. **Every RLS-protected query must run inside an explicit `prisma.$transaction`** OR via the `$extends` middleware that auto-opens one. Implicit single-statement Prisma queries on the global client do **not** carry `SET LOCAL` and would either bypass RLS (insecure) or fail (cross-statement state lost).
- Single `DATABASE_URL` today (no PgBouncer). Connection pooling at the Prisma layer (`?connection_limit=N`). `SET LOCAL` inside a transaction is safe; `SET` (no LOCAL) would leak to the next pooled query — never use the non-LOCAL form.
- Composite index `(organizationId, companyId, period)` on `indicator_values` ensures RLS-policy evaluation uses the index, not seq scan. Verify equivalent leading-`organizationId` index on every table BEFORE enabling RLS for it (precondition #5 of the per-table loop).

## Rollback

Per table, immediate revert is one `psql` statement:
```sql
ALTER TABLE indicator_values DISABLE ROW LEVEL SECURITY;
```
Document the exact statement per RLS migration in `docs/RUNBOOK_RLS.md` (separate file, created with the first migration apply). Prisma does not auto-run `down.sql`, but commit one adjacent to every `up`-migration for documentation + grep-ability.

## Performance budget

Abort threshold per architect: **>10% p95 regression** on `/api/indicators/matrix` measured via `EXPLAIN ANALYZE` against a 5000-row synthetic seed (60-co projected scale). Pre-rollout baseline taken in [Stage 1 pre-flight](#stage-1-checklist). Re-measure after each table is RLS-enabled; abort and revert that table if budget breached.

## Stage 1 checklist (preconditions before code change)

1. ✅ ADR written (this file).
2. 🟡 Tighten `withOrgScope` regex to cuid-length-bound (`/^[a-z0-9]{20,32}$/i`).
3. 🟡 Delete orphan `tenantPrisma()` from `src/lib/prisma.ts` (0 callers, misleads future contributors).
4. ⬜ Build `seedMultiOrg()` test helper + failing cross-org leak test (must FAIL on current no-RLS code = safety net for the rollout).
5. ⬜ Baseline `EXPLAIN ANALYZE` on `/api/indicators/matrix` query.
6. ⬜ Provision separate `budgetpro_admin` Postgres role with `BYPASSRLS` + `DATABASE_URL_ADMIN` env. Migration + cron scripts switch to it.
7. ⬜ Build the `$extends({query})` middleware that reads ALS orgId + emits `SET LOCAL`. Document the ALS-store + Next.js middleware wiring.
8. ⬜ Architect Round-2 review before applying first RLS migration.

## Open questions for future rounds

- **Q (deferred):** does `ALSContext` survive across Next.js streaming responses (`app router` streaming)? Empirical test in Stage 2.
- **Q (deferred):** what's the test pattern for Prisma `$extends` middleware in vitest? Need a way to assert `SET LOCAL` was emitted before each query.

## Architect Round-2 verdict (2026-05-21)

**Decision: commit to the EXPLICIT-WRAPPER-PER-ROUTE approach. Drop the `$extends` middleware idea.**

Rationale (synthesised from Stage 1 work + Phase 6 BullMQ experience):

1. **Prisma `$extends({query})` limitations confirmed** (per `org-scope-context.ts` jsdoc): the query callback fires INSIDE the implicit transaction Prisma opens; we cannot wrap a `SET LOCAL` statement around it without batching into raw `$transaction([...])` arrays at every call site — which defeats the "automatic" promise.

2. **Phase 7.M Tier 5 + Phase 6 set the precedent**: batch functions (`runImportBatch`, `runBalanceSheetBatch`, etc.) and BullMQ processors already accept `Prisma.TransactionClient` as their first arg. The explicit-tx pattern is already woven through 4 critical write paths; extending it to RLS-protected reads is mechanical.

3. **Risk asymmetry**: an undetected silent leak in a `$extends` middleware (e.g. ALS context lost across async boundaries in streaming responses, server actions, or worker processes) ships unnoticed for weeks. An UNWRAPPED route is immediately visible because RLS returns 0 rows (UI shows empty / 401) — fail-loud beats fail-silent for compliance code.

4. **Bypass story stays clean**: cron / background workers / migrations explicitly use the `DATABASE_URL_ADMIN` connection (separate Postgres role with `BYPASSRLS`). No `bypass: true` hack inside withOrgScope; that flag becomes deprecated as part of Round-2 (use the dedicated admin client).

5. **Cost**: explicit-wrap = 500-1000 mechanical edits but each is auditable and gradual. `$extends` approach was 2-3 weeks of build + uncertain feasibility. Explicit-wrap delivers per-table value continuously, doesn't require a Big-Bang switchover.

**Implementation rules:** see `docs/RLS_PATTERN_EXAMPLE.md` for the canonical wrapped-route pattern + write-endpoint shape + cron/worker pattern using `prismaAdmin`.

**withOrgScope.bypass deprecation**: keep the flag wired for 2 more weeks, emit a `console.warn` when used, then remove in Stage 2 closure PR (target 2026-06-04).
