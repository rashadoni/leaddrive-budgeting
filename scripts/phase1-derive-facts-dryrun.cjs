/**
 * Phase 1 (decouple plan) — DRY RUN deriver. NO DB WRITES.
 * Derives the period-fact subtotals (pl_ / bs_ / cf_) from the current live
 * data and verifies the grand total against the Phase 0 checksum
 * (21,828,325.86). Proves the core derivation before any write / the faithful
 * FX-split + D&A version (which will reuse the resolver's per-line logic).
 *
 * Run: node scripts/phase1-derive-facts-dryrun.cjs
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

(async () => {
  const baseline = JSON.parse(fs.readFileSync("docs/plans/phase0-baseline.json", "utf8"));
  const org = await p.organization.findFirst({ select: { id: true } });
  const companies = await p.company.findMany({ where: { organizationId: org.id }, select: { id: true, code: true } });
  const coCode = new Map(companies.map((c) => [c.id, c.code]));

  // ── P&L facts from BudgetLine (2026), grouped by account.accountType (matches the resolver) ──
  const bl = await p.budgetLine.findMany({
    where: { organizationId: org.id, deletedAt: null, plan: { year: 2026 } },
    select: { plannedAmount: true, monthIndex: true, lineType: true, companyId: true, account: { select: { accountType: true } } },
  });
  const pl = {}; // company|month → {revenue,cogs,opex}
  let byAccountType = { revenue: 0, cogs: 0, expense: 0, other: 0 };
  let byLineType = { revenue: 0, cogs: 0, expense: 0, other: 0 };
  let grand = 0;
  for (const l of bl) {
    const co = coCode.get(l.companyId) || l.companyId;
    const k = `${co}|m${l.monthIndex}`;
    pl[k] = pl[k] || { revenue: 0, cogs: 0, opex: 0 };
    const at = l.account?.accountType || "other";
    byAccountType[at === "revenue" || at === "cogs" || at === "expense" ? at : "other"] += l.plannedAmount;
    byLineType[["revenue", "cogs", "expense"].includes(l.lineType) ? l.lineType : "other"] += l.plannedAmount;
    if (at === "revenue") pl[k].revenue += l.plannedAmount;
    else if (at === "cogs") pl[k].cogs += l.plannedAmount;
    else if (at === "expense") pl[k].opex += l.plannedAmount;
    grand += l.plannedAmount;
  }
  const plFactCount = Object.keys(pl).length * 4; // revenue/cogs/opex/net_income per company-month

  // ── BS facts ──
  const bs = await p.balanceSheetLine.findMany({ where: { organizationId: org.id, deletedAt: null }, select: { amount: true, year: true, month: true, lineType: true, companyId: true } });
  const bsAgg = {};
  for (const l of bs) { const k = `${coCode.get(l.companyId) || l.companyId}|${l.year}-${l.month}|${l.lineType}`; bsAgg[k] = r2((bsAgg[k] || 0) + l.amount); }

  // ── CF facts (org-level, no companyId) ──
  const cf = await p.cashFlowEntry.findMany({ where: { organizationId: org.id, deletedAt: null }, select: { amount: true, year: true, month: true, activityType: true } });
  const cfAgg = {};
  for (const e of cf) { const k = `${e.year}-${e.month}|${e.activityType}`; cfAgg[k] = r2((cfAgg[k] || 0) + e.amount); }

  // ── Verify ──
  console.log("=== P&L derivation ===");
  console.log("by accountType:", JSON.stringify(Object.fromEntries(Object.entries(byAccountType).map(([k, v]) => [k, r2(v)]))));
  console.log("by lineType:   ", JSON.stringify(Object.fromEntries(Object.entries(byLineType).map(([k, v]) => [k, r2(v)]))));
  console.log("accountType == lineType grouping?", JSON.stringify(byAccountType) === JSON.stringify(byLineType));
  console.log("grand total derived:", r2(grand), "| Phase0 checksum:", baseline.checksums.budgetLine2026Total, "| MATCH:", r2(grand) === baseline.checksums.budgetLine2026Total);
  console.log("pl fact rows (company×month×4):", plFactCount);
  console.log("\n=== BS derivation ===");
  console.log("bs fact keys:", Object.keys(bsAgg).length, "| matches Phase0 BS keys:", Object.keys(bsAgg).length === Object.keys(baseline.checksums.balanceSheetByKey).length);
  console.log("\n=== CF derivation ===");
  console.log("cf fact keys:", Object.keys(cfAgg).length, "| matches Phase0 CF keys:", Object.keys(cfAgg).length === Object.keys(baseline.checksums.cashFlowByKey).length);
  console.log("\nDRY RUN — no writes. Faithful FX-split/D&A derivation + writes come with the shared-aggregation refactor.");
  await p.$disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
