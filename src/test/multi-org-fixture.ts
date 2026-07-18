/**
 * Phase 5.2 — Multi-org test fixture for RLS integration tests.
 *
 * Creates 2 disposable Organizations + 1 Company + 1 IndicatorDefinition
 * + 1 IndicatorValue per org so cross-tenant leak assertions can run
 * against the real Postgres (RLS happens at the DB layer, not in
 * Prisma; unit mocks are insufficient).
 *
 * **Naming discipline (per `feedback_no_synthetic_business_data`):**
 *   - Test rows use the prefix `__RLS_LEAK_TEST_` on every textual
 *     field a finance user might see (Organization.name,
 *     Company.code/name, IndicatorDefinition.code).
 *   - `cleanupMultiOrg()` removes EVERYTHING tagged with that prefix
 *     by cascading from the Organization rows.
 *   - `seedMultiOrg()` REFUSES to run if test orgs already exist —
 *     forces cleanup-first discipline so a half-rolled-back previous
 *     run doesn't leave drifted state.
 *
 * Usage:
 *   const { orgA, orgB } = await seedMultiOrg(prisma);
 *   try {
 *     // ... test assertions using orgA.id / orgB.id ...
 *   } finally {
 *     await cleanupMultiOrg(prisma);
 *   }
 */

import type { PrismaClient } from "@prisma/client";

const PREFIX = "__RLS_LEAK_TEST_";
const ORG_A_NAME = `${PREFIX}ORG_A`;
const ORG_B_NAME = `${PREFIX}ORG_B`;
const COMPANY_A_CODE = `${PREFIX}CO_A`;
const COMPANY_B_CODE = `${PREFIX}CO_B`;
const INDICATOR_CODE = `${PREFIX}IND`;

export interface MultiOrgFixture {
  orgA: { id: string; name: string };
  orgB: { id: string; name: string };
  companyA: { id: string; code: string };
  companyB: { id: string; code: string };
  indicator: { id: string; code: string };
  ivA: { id: string };
  ivB: { id: string };
  // Phase 5.2 Stage 2 Tier 2 (2026-05-21) — leak-test rows for the
  // compliance-tier tables (audit_events / budget_change_logs /
  // approval_requests). One row per table per org so assertions can
  // compare `findMany({orgA scope}).length === 1` (no cross-org bleed).
  auditA: { id: string };
  auditB: { id: string };
  budgetChangeA: { id: string };
  budgetChangeB: { id: string };
  approvalA: { id: string };
  approvalB: { id: string };
  // Phase 5.2 Stage 3 (2026-07-07) — Trade Tower leak rows (the tables
  // Mars Overseas will live in): one budget pool + one ledger posting
  // per org.
  tradePoolA: { id: string };
  tradePoolB: { id: string };
  tradeLedgerA: { id: string };
  tradeLedgerB: { id: string };
}

export async function cleanupMultiOrg(prisma: PrismaClient): Promise<void> {
  // Find org ids first (cascade rules will pick up downstream rows
  // for tables that have onDelete: Cascade on organizationId).
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  if (orgs.length === 0) return;
  const ids = orgs.map((o) => o.id);
  // Belt + suspenders: explicitly delete the test indicator + IVs +
  // companies in case the schema's cascade rules ever change. Order
  // matters — IVs reference indicator + company; budget_change_log +
  // approval_requests reference budget_plan; everything references org.
  await prisma.indicatorValue.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.indicatorDefinition.deleteMany({
    where: { code: { startsWith: PREFIX } },
  });
  // Phase 5.2 Stage 2 Tier 2 — compliance-tier teardown.
  await prisma.budgetChangeLog.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.approvalRequest.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      organizationId: { in: ids },
      entityType: "RLSLeakTest",
    },
  });
  await prisma.budgetPlan.deleteMany({
    where: { organizationId: { in: ids } },
  });
  // Phase 5.2 Stage 3 — trade-tier teardown (ledger references spendType).
  await prisma.tradeSpendLedger.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.tradeSpendType.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.tradeBudgetPool.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.company.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: ids } },
  });
}

export async function seedMultiOrg(prisma: PrismaClient): Promise<MultiOrgFixture> {
  // Refuse if anything starts-with the prefix — forces cleanup-first
  // discipline.
  const existing = await prisma.organization.count({
    where: { name: { startsWith: PREFIX } },
  });
  if (existing > 0) {
    throw new Error(
      `seedMultiOrg: ${existing} test org(s) already exist with prefix ${PREFIX}. Call cleanupMultiOrg() first or fix a previous run's leak.`,
    );
  }

  const orgA = await prisma.organization.create({
    data: { name: ORG_A_NAME, slug: ORG_A_NAME.toLowerCase() },
    select: { id: true, name: true },
  });
  const orgB = await prisma.organization.create({
    data: { name: ORG_B_NAME, slug: ORG_B_NAME.toLowerCase() },
    select: { id: true, name: true },
  });

  const companyA = await prisma.company.create({
    data: {
      organizationId: orgA.id,
      code: COMPANY_A_CODE,
      name: COMPANY_A_CODE,
      level: 1,
    },
    select: { id: true, code: true },
  });
  const companyB = await prisma.company.create({
    data: {
      organizationId: orgB.id,
      code: COMPANY_B_CODE,
      name: COMPANY_B_CODE,
      level: 1,
    },
    select: { id: true, code: true },
  });

  // Indicator definitions are org-nullable globals; create one with a
  // distinctive code we can match for cleanup.
  const indicator = await prisma.indicatorDefinition.create({
    data: {
      code: INDICATOR_CODE,
      nameEn: INDICATOR_CODE,
      category: "operational",
      direction: "higher_better",
      unit: "%",
      formula: "1",
      thresholds: {},
      sortOrder: 9999,
    },
    select: { id: true, code: true },
  });

  const ivA = await prisma.indicatorValue.create({
    data: {
      organizationId: orgA.id,
      companyId: companyA.id,
      indicatorId: indicator.id,
      period: "2026",
      value: 10,
      status: "green",
      sparkline: [],
      inputs: {},
    },
    select: { id: true },
  });
  const ivB = await prisma.indicatorValue.create({
    data: {
      organizationId: orgB.id,
      companyId: companyB.id,
      indicatorId: indicator.id,
      period: "2026",
      value: 20,
      status: "amber",
      sparkline: [],
      inputs: {},
    },
    select: { id: true },
  });

  // ── Phase 5.2 Stage 2 Tier 2 — compliance-tier leak rows ──────────
  const [auditA, auditB] = await Promise.all([
    prisma.auditEvent.create({
      data: {
        organizationId: orgA.id,
        actorUserId: null,
        action: "indicator_override_create",
        entityType: "RLSLeakTest",
        entityId: `${PREFIX}A`,
        metadata: {},
        context: {},
      },
      select: { id: true },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: orgB.id,
        actorUserId: null,
        action: "indicator_override_create",
        entityType: "RLSLeakTest",
        entityId: `${PREFIX}B`,
        metadata: {},
        context: {},
      },
      select: { id: true },
    }),
  ]);

  const [planA, planB] = await Promise.all([
    prisma.budgetPlan.create({
      data: {
        organizationId: orgA.id,
        name: `${PREFIX}PLAN_A`,
        periodType: "annual",
        year: 2026,
        status: "draft",
      },
      select: { id: true },
    }),
    prisma.budgetPlan.create({
      data: {
        organizationId: orgB.id,
        name: `${PREFIX}PLAN_B`,
        periodType: "annual",
        year: 2026,
        status: "draft",
      },
      select: { id: true },
    }),
  ]);

  const [budgetChangeA, budgetChangeB] = await Promise.all([
    prisma.budgetChangeLog.create({
      data: {
        organizationId: orgA.id,
        planId: planA.id,
        action: "create",
        entityType: "BudgetLine",
        entityId: `${PREFIX}A`,
        snapshot: {},
        userId: null,
      },
      select: { id: true },
    }),
    prisma.budgetChangeLog.create({
      data: {
        organizationId: orgB.id,
        planId: planB.id,
        action: "create",
        entityType: "BudgetLine",
        entityId: `${PREFIX}B`,
        snapshot: {},
        userId: null,
      },
      select: { id: true },
    }),
  ]);

  const [approvalA, approvalB] = await Promise.all([
    prisma.approvalRequest.create({
      data: {
        organizationId: orgA.id,
        planId: planA.id,
        requestType: "budget_line_create",
        status: "pending",
        proposedChange: {},
        requestedBy: "system",
      },
      select: { id: true },
    }),
    prisma.approvalRequest.create({
      data: {
        organizationId: orgB.id,
        planId: planB.id,
        requestType: "budget_line_create",
        status: "pending",
        proposedChange: {},
        requestedBy: "system",
      },
      select: { id: true },
    }),
  ]);

  // ── Phase 5.2 Stage 3 (2026-07-07) — Trade Tower leak rows ─────────
  const [tradePoolA, tradePoolB] = await Promise.all([
    prisma.tradeBudgetPool.create({
      data: {
        organizationId: orgA.id,
        year: 2026,
        month: 1,
        grainKey: "org",
        salesPlanAmount: 1000,
        budgetPct: 5,
        budgetAmount: 50,
      },
      select: { id: true },
    }),
    prisma.tradeBudgetPool.create({
      data: {
        organizationId: orgB.id,
        year: 2026,
        month: 1,
        grainKey: "org",
        salesPlanAmount: 2000,
        budgetPct: 5,
        budgetAmount: 100,
      },
      select: { id: true },
    }),
  ]);

  const [spendTypeA, spendTypeB] = await Promise.all([
    prisma.tradeSpendType.create({
      data: {
        organizationId: orgA.id,
        key: `${PREFIX}manual`,
        label: `${PREFIX}manual`,
        accrualMethod: "manual",
      },
      select: { id: true },
    }),
    prisma.tradeSpendType.create({
      data: {
        organizationId: orgB.id,
        key: `${PREFIX}manual`,
        label: `${PREFIX}manual`,
        accrualMethod: "manual",
      },
      select: { id: true },
    }),
  ]);

  const [tradeLedgerA, tradeLedgerB] = await Promise.all([
    prisma.tradeSpendLedger.create({
      data: {
        organizationId: orgA.id,
        entryKind: "actual",
        spendTypeId: spendTypeA.id,
        entryDate: new Date(Date.UTC(2026, 0, 15)),
        year: 2026,
        month: 1,
        amount: 10,
        sourceDocument: `${PREFIX}A`,
        createdBy: "system",
      },
      select: { id: true },
    }),
    prisma.tradeSpendLedger.create({
      data: {
        organizationId: orgB.id,
        entryKind: "actual",
        spendTypeId: spendTypeB.id,
        entryDate: new Date(Date.UTC(2026, 0, 15)),
        year: 2026,
        month: 1,
        amount: 20,
        sourceDocument: `${PREFIX}B`,
        createdBy: "system",
      },
      select: { id: true },
    }),
  ]);

  return {
    orgA,
    orgB,
    companyA,
    companyB,
    indicator,
    ivA,
    ivB,
    auditA,
    auditB,
    budgetChangeA,
    budgetChangeB,
    approvalA,
    approvalB,
    tradePoolA,
    tradePoolB,
    tradeLedgerA,
    tradeLedgerB,
  };
}
