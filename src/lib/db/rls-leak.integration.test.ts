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
 *   2. Until the RLS migration is applied AND the $extends middleware
 *      is wired, this test SHOULD FAIL — because withOrgScope only sets
 *      a session variable; without a policy reading that variable,
 *      Postgres returns both orgs' rows.
 *
 * **Why we still ship it now (failing-by-design):** this is the
 * architect's required "safety net" — the test that PROVES we've
 * actually closed the leak when RLS lands. Without writing it now and
 * confirming it fails on the current no-RLS code, we have no
 * confidence that turning RLS on actually fixes anything.
 *
 * **How to run when ready (Stage 2+ of the rollout):**
 *   RLS_INTEGRATION=1 npx vitest run src/lib/db/rls-leak.integration.test.ts
 *
 * **Expected lifecycle:**
 *   - 2026-05-16 (now, no RLS): RLS_INTEGRATION=1 run → leak assertion
 *     FAILS (Postgres returns 2 rows where 1 expected) → confirms test
 *     is correctly hooked into the data path.
 *   - After indicator_values RLS migration applies + $extends middleware
 *     wraps queries: same run PASSES → confirms RLS closes the leak.
 *   - Wire into pre-deploy CI gate at that point.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { withOrgScope } from "./with-org-scope";
import {
  seedMultiOrg,
  cleanupMultiOrg,
  type MultiOrgFixture,
} from "@/test/multi-org-fixture";

const ENABLED = process.env.RLS_INTEGRATION === "1";
const describeIntegration = ENABLED ? describe : describe.skip;

describeIntegration("RLS cross-tenant leak (Phase 5.2 safety net)", () => {
  let fixture: MultiOrgFixture;

  beforeAll(async () => {
    // Defensive cleanup first — in case a previous run died mid-way.
    await cleanupMultiOrg(prisma);
    fixture = await seedMultiOrg(prisma);
  });

  afterAll(async () => {
    await cleanupMultiOrg(prisma);
    await prisma.$disconnect();
  });

  it("withOrgScope(orgA.id) returns ONLY orgA's indicator_values (no leak from orgB)", async () => {
    const result = await withOrgScope(fixture.orgA.id, async (tx) => {
      return tx.indicatorValue.findMany({
        where: { indicatorId: fixture.indicator.id },
        select: { id: true, organizationId: true, value: true },
      });
    });
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
    });
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
      { bypass: true },
    );
    // With bypass, the policy short-circuits → both orgs' rows visible.
    // This is the cron/migration/admin-cross-org-read path.
    expect(result).toHaveLength(2);
    const orgIds = result.map((r) => r.organizationId).sort();
    expect(orgIds).toEqual([fixture.orgA.id, fixture.orgB.id].sort());
  });

  // ── Phase 5.2 Stage 2 Tier 2 (2026-05-21) — compliance-tier leaks ──
  // These assertions are failing-by-design until the corresponding
  // RLS migrations apply. Same shape as the indicator_values pair
  // above — the per-table loop spec from docs/RLS_TABLE_ROLLOUT.md.

  it("withOrgScope(orgA.id) returns ONLY orgA's audit_events (Tier 2)", async () => {
    const result = await withOrgScope(fixture.orgA.id, async (tx) => {
      return tx.auditEvent.findMany({
        where: { entityType: "RLSLeakTest" },
        select: { id: true, organizationId: true },
      });
    });
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
    });
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
    });
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
      { bypass: true },
    );
    expect(result).toHaveLength(2);
  });
});
