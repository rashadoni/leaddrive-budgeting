/**
 * Seed realistic AZMADE actuals for Jan-Apr 2026 (YTD as of demo date
 * 2026-04-26). Activates the Plan/Actual/Variance grid in
 * `/budgeting?tab=pnl-report` (BudgetPnlView already renders rows × 12
 * monthly cols + Variance % with color-coded favorability — see
 * `src/components/budget-pnl-view.tsx:194-680`). Without seeded actuals
 * the grid shows Plan column populated but Actual = 0₼ → variance shows
 * 100% under-budget everywhere → looks broken/empty for demo audience.
 *
 * Per-company variance config (mixed "winners + strugglers" story chosen
 * by user via AskUserQuestion Turn 35 plan):
 *
 *   AAC-MAIN:    rev -18..-12%, cost +8..+15%   (worst — drives discussion)
 *   SPARK-MAIN:  rev -15..-10%, cost +5..+12%   (struggling)
 *   ATL-PMZ:     rev -8..-3%,   cost ±3%        (slightly behind)
 *   LLS-MAIN:    rev ±5%,       cost ±5%        (tracking plan)
 *   ATL-MRKZ:    rev ±3%,       cost ±3%        (admin, flat)
 *   ATL-TAZ:     rev +2..+8%,   cost ±5%        (modest upside)
 *   ZTP-MAIN:    rev +5..+10%,  cost -3..+2%    (steady win)
 *   ATL-DBZ:     rev +12..+18%, cost ±5%        (over-performer)
 *
 * Seeded RNG (LCG keyed on planId+companyCode+month+lineType) → re-runs
 * deterministic; same actual values produced each time.
 *
 * Idempotency: skip if (planId, year=2026) already has any
 * budget_actuals rows. Drop+re-seed manually via psql if you need
 * different variance profile.
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/seed-azmade-actuals.ts`
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = "azmade";
const YEAR = 2026;
const MONTHS_TO_SEED = [1, 2, 3, 4]; // Jan, Feb, Mar, Apr (YTD as of 2026-04-26)

interface VarianceConfig {
  revLow: number;
  revHigh: number;
  costLow: number;
  costHigh: number;
}

// Per-company variance ranges (decimal jitter applied to monthlyPlanned)
const VARIANCE: Record<string, VarianceConfig> = {
  "AAC-MAIN":   { revLow: -0.18, revHigh: -0.12, costLow: +0.08, costHigh: +0.15 },
  "SPARK-MAIN": { revLow: -0.15, revHigh: -0.10, costLow: +0.05, costHigh: +0.12 },
  "ATL-PMZ":    { revLow: -0.08, revHigh: -0.03, costLow: -0.03, costHigh: +0.03 },
  "LLS-MAIN":   { revLow: -0.05, revHigh: +0.05, costLow: -0.05, costHigh: +0.05 },
  "ATL-MRKZ":   { revLow: -0.03, revHigh: +0.03, costLow: -0.03, costHigh: +0.03 },
  "ATL-TAZ":    { revLow: +0.02, revHigh: +0.08, costLow: -0.05, costHigh: +0.05 },
  "ZTP-MAIN":   { revLow: +0.05, revHigh: +0.10, costLow: -0.03, costHigh: +0.02 },
  "ATL-DBZ":    { revLow: +0.12, revHigh: +0.18, costLow: -0.05, costHigh: +0.05 },
};

// 32-bit FNV-1a hash for deterministic per-row seed
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Linear congruential generator — seeded, returns float in [0, 1)
function seededRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state, 1664525) + 1013904223;
    state >>>= 0;
    return state / 0x100000000;
  };
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found`);

  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, deletedAt: null, year: YEAR },
  });
  if (!plan) throw new Error(`No active ${YEAR} plan for AZMADE`);

  // Idempotency guard
  const existing = await prisma.budgetActual.count({
    where: { organizationId: org.id, planId: plan.id },
  });
  if (existing > 0) {
    console.log(
      `[seed-azmade-actuals] ${existing} actuals already exist for plan ${plan.id} — skipping. ` +
        `To re-seed, run: psql ... -c "DELETE FROM budget_actuals WHERE \\"planId\\"='${plan.id}'"`,
    );
    return;
  }

  // Load all companies + their BudgetLines
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: Object.keys(VARIANCE) } },
    select: { id: true, code: true },
  });

  const actualsToCreate: Array<{
    organizationId: string;
    planId: string;
    companyId: string; // Turn 35: per-company filter requires this
    category: string;
    department: string | null;
    lineType: string;
    actualAmount: number;
    expenseDate: string;
    description: string;
    costTypeId: string | null;
    departmentId: string | null;
  }> = [];

  const summary: Array<{ code: string; count: number; planYtd: number; actualYtd: number }> = [];

  for (const co of companies) {
    const config = VARIANCE[co.code];
    if (!config) continue;

    // Pull this company's BudgetLines (12 rows per parsed line post-Turn-34)
    const lines = await prisma.budgetLine.findMany({
      where: { companyId: co.id },
      select: {
        category: true,
        department: true,
        lineType: true,
        plannedAmount: true,
        sortOrder: true,
        costTypeId: true,
        departmentId: true,
      },
    });

    let planYtd = 0;
    let actualYtd = 0;
    let count = 0;

    for (const line of lines) {
      const monthIdx = (line.sortOrder ?? 0) % 100; // 0..11
      if (monthIdx < 0 || monthIdx > 11) continue;
      const monthOneIndexed = monthIdx + 1;
      if (!MONTHS_TO_SEED.includes(monthOneIndexed)) continue;

      // Seeded RNG per (company, month, line) for deterministic re-runs
      const seedKey = `${plan.id}::${co.code}::${monthOneIndexed}::${line.category}::${line.lineType}`;
      const rand = seededRandom(hashString(seedKey));

      const isRevenue = line.lineType === "revenue";
      const low = isRevenue ? config.revLow : config.costLow;
      const high = isRevenue ? config.revHigh : config.costHigh;
      const jitter = low + rand() * (high - low);
      const actualAmount = Math.max(0, line.plannedAmount * (1 + jitter));

      actualsToCreate.push({
        organizationId: org.id,
        planId: plan.id,
        companyId: co.id, // Turn 35: bind actual to company for per-co filter
        category: line.category,
        department: line.department,
        lineType: line.lineType,
        actualAmount,
        expenseDate: `${YEAR}-${String(monthOneIndexed).padStart(2, "0")}-15`,
        description: `Auto-seed ${co.code} ${YEAR}-${String(monthOneIndexed).padStart(2, "0")} (Turn-35 demo actuals)`,
        costTypeId: line.costTypeId,
        departmentId: line.departmentId,
      });
      planYtd += line.plannedAmount;
      actualYtd += actualAmount;
      count += 1;
    }

    summary.push({ code: co.code, count, planYtd, actualYtd });
  }

  // Bulk insert (single transaction implicit via createMany)
  const result = await prisma.budgetActual.createMany({ data: actualsToCreate });
  console.log(`[seed-azmade-actuals] inserted ${result.count} actual rows.\n`);

  console.log("Per-company YTD summary (Jan-Apr):");
  console.log("Company    | rows | plan YTD       | actual YTD     | variance");
  console.log("-----------+------+----------------+----------------+---------");
  for (const s of summary) {
    const variance = s.planYtd === 0 ? 0 : ((s.actualYtd - s.planYtd) / s.planYtd) * 100;
    const sign = variance >= 0 ? "+" : "";
    console.log(
      `${s.code.padEnd(10)} | ${String(s.count).padStart(4)} | ${s.planYtd.toFixed(0).padStart(14)} | ${s.actualYtd.toFixed(0).padStart(14)} | ${sign}${variance.toFixed(1)}%`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
