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
  // matters — IVs reference indicator + company.
  await prisma.indicatorValue.deleteMany({
    where: { organizationId: { in: ids } },
  });
  await prisma.indicatorDefinition.deleteMany({
    where: { code: { startsWith: PREFIX } },
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
      industry: "industrial",
    },
    select: { id: true, code: true },
  });
  const companyB = await prisma.company.create({
    data: {
      organizationId: orgB.id,
      code: COMPANY_B_CODE,
      name: COMPANY_B_CODE,
      level: 1,
      industry: "industrial",
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

  return { orgA, orgB, companyA, companyB, indicator, ivA, ivB };
}
