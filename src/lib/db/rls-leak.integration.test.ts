/**
 * Phase 5.2 — RLS cross-tenant leak integration test (THE SAFETY NET).
 *
 * Builds a 2-org fixture in real Postgres, then asserts that a query
 * issued inside `withOrgScope(orgA.id, ...)` returns ONLY orgA's rows
 * (no cross-tenant leak into orgB).
 *
 * **This test is intentionally SKIPPED by default** because:
 *   1. It hits real Postgres (slow vs unit tests; not safe in CI
 *      without a dedicated test DB).
 *   2. Until the RLS migration is applied AND DATABASE_URL_APP is set,
 *      this test SHOULD FAIL — because withOrgScope only sets a session
 *      variable; without a policy reading that variable, Postgres returns
 *      both orgs' rows. Also, connecting as a superuser with BYPASSRLS
 *      silently ignores all policies regardless of migration state.
 *
 * **How to run when ready (Stage 2+ of the rollout):**
 *   DATABASE_URL_APP=postgresql://budgetpro_app:budgetpro_app_dev@localhost:5432/budgetpro \
 *   RLS_INTEGRATION=1 npx vitest run src/lib/db/rls-leak.integration.test.ts
 *
 * Or just set DATABASE_URL_APP in .env and run:
 *   RLS_INTEGRATION=1 npx vitest run src/lib/db/rls-leak.integration.test.ts
 *
 * **Expected lifecycle:**
 *   - Without RLS migration: all isolation assertions FAIL (both orgs' rows).
 *   - After RLS migration + DATABASE_URL_APP set: isolation assertions PASS.
 *   - Wire into pre-deploy CI gate at that point.
 *
 * **Why DATABASE_URL_APP matters:** the dev DATABASE_URL typically connects
 * as a Postgres superuser (e.g. the macOS username) which has BYPASSRLS
 * built in. That silently skips ALL policies — the test would pass even
 * with broken policies. DATABASE_URL_APP must point to a non-superuser,
 * non-BYPASSRLS role (budgetpro_app).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withOrgScope } from "./with-org-scope";
import {
  seedMultiOrg,
  cleanupMultiOrg,
  type MultiOrgFixture,
} from "@/test/multi-org-fixture";

const ENABLED = process.env.RLS_INTEGRATION === "1";
const describeIntegration = ENABLED ? describe : describe.skip;

// Use DATABASE_URL_APP (non-superuser, no BYPASSRLS) when available so
// RLS policies are actually enforced. Falling back to the default
// DATABASE_URL (typically the dev superuser with BYPASSRLS) would make
// all isolation assertions silently pass regardless of policy state.
const APP_URL = process.env.DATABASE_URL_APP;
const prismaApp: PrismaClient = APP_URL
  ? new PrismaClient({ datasources: { db: { url: APP_URL } } })
  : prisma;

const scopeOpts = { client: prismaApp };

describeIntegration("RLS cross-tenant leak (Phase 5.2 safety net)", () => {
  let fixture: MultiOrgFixture;

  beforeAll(async () => {
    if (!APP_URL) {
      console.warn(
        "[RLS integration] DATABASE_URL_APP not set — running as default DB user. " +
          "If that user has BYPASSRLS, isolation assertions will fail even with correct policies.",
      )
    }
    // Defensive cleanup first — in case a previous run died mid-way.
    // Use the superuser prisma for setup/teardown (needs to see all orgs).
    await cleanupMultiOrg(prisma);
    fixture = await seedMultiOrg(prisma);
  });

  afterAll(async () => {
    await cleanupMultiOrg(prisma);
    await prisma.$disconnect();
    if (APP_URL) await prismaApp.$disconnect();
  });

  it("withOrgScope(orgA.id) returns ONLY orgA's indicator_values (no leak from orgB)", async () => {
    const result = await withOrgScope(fixture.orgA.id, async (tx) => {
      return tx.indicatorValue.findMany({
        where: { indicatorId: fixture.indicator.id },
        select: { id: true, organizationId: true, value: true },
      });
    }, scopeOpts);
    // The load-bearing assertion. Pre-RLS: result.length === 2 (both
    // orgA's and orgB's IVs visible) → this assertion FAILS.
    // Post-RLS: result.length === 1, only orgA's row.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(fixture.ivA.id);
    expect(result[0].organizationId).toBe(fixture.orgA.id);
    expect(result.map((r) => r.organizationId)).not.toContain(fixture.orgB.id);
  });

  it("withOrgScope(orgB.id) returns ONLY orgB's indicator_values (symmetric)", async () => {
    const result = await withOrgScope(fixture.orgB.id, async (tx) => {
      return tx.indicatorValue.findMany({
        where: { indicatorId: fixture.indicator.id },
        select: { id: true, organizationId: true },
      });
    }, scopeOpts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(fixture.ivB.id);
    expect(result[0].organizationId).toBe(fixture.orgB.id);
  });

  it("withOrgScope(orgA.id, { bypass: true }) returns BOTH orgs (admin escape hatch)", async () => {
    const result = await withOrgScope(
      fixture.orgA.id,
      async (tx) => {
        return tx.indicatorValue.findMany({
          where: { indicatorId: fixture.indicator.id },
          select: { id: true, organizationId: true },
        });
      },
      { ...scopeOpts, bypass: true },
    );
    // With bypass, the policy short-circuits → both orgs' rows visible.
    // This is the cron/migration/admin-cross-org-read path.
    expect(result).toHaveLength(2);
    const orgIds = result.map((r) => r.organizationId).sort();
    expect(orgIds).toEqual([fixture.orgA.id, fixture.orgB.id].sort());
  });

  // ── Phase 5.2 Stage 2 Tier 2 (2026-05-21) — compliance-tier leaks ──

  it("withOrgScope(orgA.id) returns ONLY orgA's audit_events (Tier 2)", async () => {
    const result = await withOrgScope(fixture.orgA.id, async (tx) => {
      return tx.auditEvent.findMany({
        where: { entityType: "RLSLeakTest" },
        select: { id: true, organizationId: true },
      });
    }, scopeOpts);
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe(fixture.orgA.id);
    expect(result[0].id).toBe(fixture.auditA.id);
  });

  it("withOrgScope(orgA.id) returns ONLY orgA's budget_change_logs (Tier 2)", async () => {
    const result = await withOrgScope(fixture.orgA.id, async (tx) => {
      return tx.budgetChangeLog.findMany({
        where: {
          entityType: "BudgetLine",
          entityId: { startsWith: "__RLS_LEAK_TEST_" },
        },
        select: { id: true, organizationId: true },
      });
    }, scopeOpts);
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe(fixture.orgA.id);
    expect(result[0].id).toBe(fixture.budgetChangeA.id);
  });

  it("withOrgScope(orgA.id) returns ONLY orgA's approval_requests (Tier 2)", async () => {
    const result = await withOrgScope(fixture.orgA.id, async (tx) => {
      return tx.approvalRequest.findMany({
        where: { requestedBy: "system", requestType: "budget_line_create" },
        select: { id: true, organizationId: true },
      });
    }, scopeOpts);
    expect(result).toHaveLength(1);
    expect(result[0].organizationId).toBe(fixture.orgA.id);
    expect(result[0].id).toBe(fixture.approvalA.id);
  });

  it("Tier 2 bypass escape hatch returns BOTH orgs (admin cross-org)", async () => {
    const result = await withOrgScope(
      fixture.orgA.id,
      async (tx) => {
        return tx.auditEvent.findMany({
          where: { entityType: "RLSLeakTest" },
          select: { id: true, organizationId: true },
        });
      },
      { ...scopeOpts, bypass: true },
    );
    expect(result).toHaveLength(2);
  });
});
