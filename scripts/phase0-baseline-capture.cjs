/**
 * Phase 0 (decouple-terminal-pnl plan) — read-only baseline capture.
 *
 * Produces the "before" oracle used to prove the decoupling introduces
 * NO indicator drift and NO financial-data loss:
 *   1. Checksums: Σ BudgetLine.plannedAmount (2026 plan) by company×month×lineType,
 *      Σ BalanceSheetLine.amount by company×year-month×lineType,
 *      Σ CashFlowEntry.amount by year-month×activityType (CF has no companyId).
 *   2. Parity oracle: every IndicatorValue (code, company, period, value, status).
 *
 * Output: docs/plans/phase0-baseline.json  (committed — the parity oracle).
 * Run: node scripts/phase0-baseline-capture.cjs   (DB read-only).
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

(async () => {
  const org = await p.organization.findFirst({ select: { id: true, name: true } });
  const companies = await p.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true },
  });
  const coCode = new Map(companies.map((c) => [c.id, c.code]));
  const inds = await p.indicatorDefinition.findMany({ select: { id: true, code: true } });
  const indCode = new Map(inds.map((i) => [i.id, i.code]));

  // ── 1. BudgetLine checksum (live, all plans, 2026) ──
  const bl = await p.budgetLine.findMany({
    where: { organizationId: org.id, deletedAt: null, plan: { year: 2026 } },
    select: { plannedAmount: true, monthIndex: true, lineType: true, companyId: true },
  });
  const blSums = {};
  let blTotal = 0;
  for (const l of bl) {
    const k = `${coCode.get(l.companyId) || l.companyId}|m${l.monthIndex}|${l.lineType}`;
    blSums[k] = round2((blSums[k] || 0) + l.plannedAmount);
    blTotal += l.plannedAmount;
  }

  // ── 2. BalanceSheetLine checksum ──
  const bs = await p.balanceSheetLine.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { amount: true, year: true, month: true, lineType: true, companyId: true },
  });
  const bsSums = {};
  for (const l of bs) {
    const k = `${coCode.get(l.companyId) || l.companyId}|${l.year}-${l.month}|${l.lineType}`;
    bsSums[k] = round2((bsSums[k] || 0) + l.amount);
  }

  // ── 3. CashFlowEntry checksum (no companyId — org/account scoped) ──
  const cf = await p.cashFlowEntry.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { amount: true, year: true, month: true, activityType: true },
  });
  const cfSums = {};
  for (const e of cf) {
    const k = `${e.year}-${e.month}|${e.activityType}`;
    cfSums[k] = round2((cfSums[k] || 0) + e.amount);
  }

  // ── 4. Indicator parity oracle ──
  const ivs = await p.indicatorValue.findMany({
    where: { organizationId: org.id },
    select: { indicatorId: true, companyId: true, period: true, value: true, status: true },
  });
  const oracle = ivs
    .map((iv) => ({
      code: indCode.get(iv.indicatorId) || iv.indicatorId,
      company: coCode.get(iv.companyId) || iv.companyId,
      period: iv.period,
      value: iv.value == null ? null : round2(iv.value),
      status: iv.status,
    }))
    .sort((a, b) =>
      `${a.code}|${a.company}|${a.period}`.localeCompare(`${b.code}|${b.company}|${b.period}`),
    );

  const out = {
    capturedFor: org.name,
    note: "Phase 0 baseline — DO NOT EDIT. Parity oracle for the terminal-PnL decoupling.",
    checksums: {
      budgetLine2026Total: round2(blTotal),
      budgetLineRows: bl.length,
      budgetLineByKey: blSums,
      balanceSheetByKey: bsSums,
      cashFlowByKey: cfSums,
    },
    indicatorOracle: oracle,
    indicatorCount: oracle.length,
  };
  fs.writeFileSync("docs/plans/phase0-baseline.json", JSON.stringify(out, null, 2) + "\n");
  console.log("BudgetLine 2026 total:", round2(blTotal), "| rows:", bl.length);
  console.log("BS sum-keys:", Object.keys(bsSums).length, "| CF sum-keys:", Object.keys(cfSums).length);
  console.log("Indicator oracle entries:", oracle.length);
  console.log("Wrote docs/plans/phase0-baseline.json");
  await p.$disconnect();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
