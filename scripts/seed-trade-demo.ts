/**
 * Phase 9 — Trade Tower DEMO dataset (Mars Overseas pitch).
 *
 * Fills the Trade Spend Control Tower with realistic-looking master data,
 * budget pools derived from the org's real revenue plan (flat 10M/month
 * fallback when no plan exists), an approved campaign, a month of spend
 * postings and a fresh pacing snapshot + alerts — so the demo shows a
 * living dashboard instead of zeros.
 *
 * Run:
 *   npx tsx scripts/seed-trade-demo.ts            # seed (first org)
 *   npx tsx scripts/seed-trade-demo.ts --org <id> # explicit org
 *   npx tsx scripts/seed-trade-demo.ts --clean    # remove ALL trade data
 *
 * SAFETY: refuses to touch an org that has an APPLIED TradeImportBatch
 * (= real customer data went through the import pipeline) unless
 * --force is passed. Demo rows carry sourceDocument="DEMO" so they are
 * distinguishable at a glance.
 */

import { PrismaClient } from "@prisma/client";
import { buildDefaultSpendTypeRows } from "../src/lib/trade/spend-types";
import { planPoolUpserts } from "../src/lib/trade/budget";
import { spreadMonthlyPlan, computePacing, type PacingInput } from "../src/lib/trade/pacing";
import { summarizeLedger } from "../src/lib/trade/ledger";
import {
  evaluatePacingAlerts,
  pacingAlertScopeKeys,
  syncTradeAlerts,
} from "../src/lib/trade/alerts";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const REGIONS = [
  { code: "BAKI", name: "Bakı" },
  { code: "GENCE", name: "Gəncə" },
  { code: "SUMQAYIT", name: "Sumqayıt" },
];
const CHANNELS = [
  { code: "MODERN_TRADE", name: "Modern Trade", channelType: "modern_trade" },
  { code: "ENENEVI", name: "Ənənəvi ticarət", channelType: "traditional" },
  { code: "HORECA", name: "HoReCa", channelType: "horeca" },
];
const REPS = [
  { externalCode: "R01", name: "Elvin Məmmədov", region: "BAKI", channel: "MODERN_TRADE" },
  { externalCode: "R02", name: "Aysel Quliyeva", region: "BAKI", channel: "ENENEVI" },
  { externalCode: "R03", name: "Rüfət Həsənov", region: "GENCE", channel: "ENENEVI" },
  { externalCode: "R04", name: "Nigar Əliyeva", region: "SUMQAYIT", channel: "HORECA" },
];
const OUTLETS = [
  { code: "C001", name: "Araz Market Nizami", chain: "ARAZ", region: "BAKI", channel: "MODERN_TRADE", rep: "R01" },
  { code: "C002", name: "Bravo Gənclik", chain: "BRAVO", region: "BAKI", channel: "MODERN_TRADE", rep: "R01" },
  { code: "C003", name: "OBA Yasamal", chain: "OBA", region: "BAKI", channel: "MODERN_TRADE", rep: "R01" },
  { code: "C004", name: "Rahat 28 May", chain: "RAHAT", region: "BAKI", channel: "MODERN_TRADE", rep: "R01" },
  { code: "C005", name: "Təzə Bazar köşkü 12", region: "BAKI", channel: "ENENEVI", rep: "R02" },
  { code: "C006", name: "Nərimanov mini-market", region: "BAKI", channel: "ENENEVI", rep: "R02" },
  { code: "C007", name: "Gəncə Mərkəz market", region: "GENCE", channel: "ENENEVI", rep: "R03" },
  { code: "C008", name: "Kəpəz ərzaq", region: "GENCE", channel: "ENENEVI", rep: "R03" },
  { code: "C009", name: "Bravo Gəncə", chain: "BRAVO", region: "GENCE", channel: "MODERN_TRADE", rep: "R03" },
  { code: "C010", name: "Sumqayıt bulvar kafe", region: "SUMQAYIT", channel: "HORECA", rep: "R04" },
  { code: "C011", name: "Dalğa restoran", region: "SUMQAYIT", channel: "HORECA", rep: "R04" },
  { code: "C012", name: "Sahil hotel bar", region: "SUMQAYIT", channel: "HORECA", rep: "R04" },
];
const SKUS = [
  { code: "S001", name: "Pepsi 0.5L PET", brand: "Pepsi", category: "CSD", pkg: "0.5L PET", barcode: "8690000000015" },
  { code: "S002", name: "Pepsi 1L PET", brand: "Pepsi", category: "CSD", pkg: "1L PET", barcode: "8690000000022" },
  { code: "S003", name: "Pepsi 1.5L PET", brand: "Pepsi", category: "CSD", pkg: "1.5L PET", barcode: "8690000000039" },
  { code: "S004", name: "Mountain Dew 0.5L", brand: "Mountain Dew", category: "CSD", pkg: "0.5L PET", barcode: "8690000000046" },
  { code: "S005", name: "Lay's Classic 90g", brand: "Lay's", category: "Snacks", pkg: "90g", barcode: "8690000000053" },
  { code: "S006", name: "Lay's Paprika 140g", brand: "Lay's", category: "Snacks", pkg: "140g", barcode: "8690000000060" },
  { code: "S007", name: "Jala alma 1L", brand: "Jala", category: "Juice", pkg: "1L TP", barcode: "8690000000077" },
  { code: "S008", name: "Jala nar 1L", brand: "Jala", category: "Juice", pkg: "1L TP", barcode: "8690000000084" },
  { code: "S009", name: "Natura su 0.5L", brand: "Natura", category: "Water", pkg: "0.5L PET", barcode: "8690000000091" },
  { code: "S010", name: "Natura su 1.5L", brand: "Natura", category: "Water", pkg: "1.5L PET", barcode: "8690000000107" },
];

async function resolveOrg(): Promise<{ id: string; name: string }> {
  const wanted = opt("org");
  const org = wanted
    ? await prisma.organization.findFirst({ where: { id: wanted }, select: { id: true, name: true } })
    : await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) throw new Error(wanted ? `Organization ${wanted} not found` : "No organization in DB");
  return org;
}

async function guardRealData(orgId: string): Promise<void> {
  if (flag("force")) return;
  const applied = await prisma.tradeImportBatch.count({
    where: { organizationId: orgId, status: "applied" },
  });
  if (applied > 0) {
    throw new Error(
      `Org has ${applied} APPLIED trade import batch(es) — looks like real customer data. ` +
        `Refusing to touch it. Re-run with --force if you are sure.`
    );
  }
}

async function clean(orgId: string): Promise<void> {
  const where = { organizationId: orgId };
  const counts: Record<string, number> = {};
  counts.ledger = (await prisma.tradeSpendLedger.deleteMany({ where })).count;
  counts.snapshots = (await prisma.tradePacingSnapshot.deleteMany({ where })).count;
  counts.planDaily = (await prisma.tradePlanDaily.deleteMany({ where })).count;
  counts.pools = (await prisma.tradeBudgetPool.deleteMany({ where })).count;
  counts.scopes = (await prisma.tradeCampaignScope.deleteMany({ where })).count;
  counts.campaigns = (await prisma.tradeCampaign.deleteMany({ where })).count;
  counts.alerts = (await prisma.alert.deleteMany({ where: { ...where, domain: "trade" } })).count;
  counts.outlets = (await prisma.tradeOutlet.deleteMany({ where })).count;
  counts.reps = (await prisma.tradeSalesRep.deleteMany({ where })).count;
  counts.skus = (await prisma.tradeSku.deleteMany({ where })).count;
  counts.channels = (await prisma.tradeChannel.deleteMany({ where })).count;
  counts.regions = (await prisma.tradeRegion.deleteMany({ where })).count;
  counts.batches = (await prisma.tradeImportBatch.deleteMany({ where })).count;
  counts.spendTypes = (await prisma.tradeSpendType.deleteMany({ where })).count;
  console.log("✓ cleaned:", counts);
}

async function seed(orgId: string): Promise<void> {
  const admin = await prisma.user.findFirst({
    where: { organizationId: orgId, role: "admin" },
    select: { id: true },
  });
  const createdBy = admin?.id ?? "seed-trade-demo";

  // 1. Spend types (defaults, idempotent).
  await prisma.tradeSpendType.createMany({
    data: buildDefaultSpendTypeRows(orgId),
    skipDuplicates: true,
  });
  const types = await prisma.tradeSpendType.findMany({ where: { organizationId: orgId } });
  const typeByKey = new Map(types.map((t) => [t.key, t]));

  // 2. Dimensions.
  await prisma.tradeRegion.createMany({
    data: REGIONS.map((r) => ({ organizationId: orgId, ...r })),
    skipDuplicates: true,
  });
  await prisma.tradeChannel.createMany({
    data: CHANNELS.map((c) => ({ organizationId: orgId, ...c })),
    skipDuplicates: true,
  });
  const regionId = new Map(
    (await prisma.tradeRegion.findMany({ where: { organizationId: orgId } })).map((r) => [r.code, r.id])
  );
  const channelId = new Map(
    (await prisma.tradeChannel.findMany({ where: { organizationId: orgId } })).map((c) => [c.code, c.id])
  );
  await prisma.tradeSalesRep.createMany({
    data: REPS.map((r) => ({
      organizationId: orgId,
      externalCode: r.externalCode,
      name: r.name,
      regionId: regionId.get(r.region) ?? null,
      channelId: channelId.get(r.channel) ?? null,
    })),
    skipDuplicates: true,
  });
  const repId = new Map(
    (await prisma.tradeSalesRep.findMany({ where: { organizationId: orgId } })).map((r) => [
      r.externalCode,
      r.id,
    ])
  );
  await prisma.tradeOutlet.createMany({
    data: OUTLETS.map((o) => ({
      organizationId: orgId,
      externalCode: o.code,
      name: o.name,
      chainCode: o.chain ?? null,
      regionId: regionId.get(o.region)!,
      channelId: channelId.get(o.channel)!,
      salesRepId: repId.get(o.rep) ?? null,
    })),
    skipDuplicates: true,
  });
  await prisma.tradeSku.createMany({
    data: SKUS.map((s) => ({
      organizationId: orgId,
      externalCode: s.code,
      name: s.name,
      brand: s.brand,
      category: s.category,
      packageSize: s.pkg,
      barcode: s.barcode,
    })),
    skipDuplicates: true,
  });

  // 3. Budget pools for the current year — real revenue plan when it
  //    exists, flat 10M/month demo fallback otherwise.
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const revenue = await prisma.budgetLine.groupBy({
    by: ["monthIndex"],
    where: {
      organizationId: orgId,
      deletedAt: null,
      lineType: "revenue",
      monthIndex: { not: null },
      plan: { year, kind: "budget" },
    },
    _sum: { plannedAmount: true },
  });
  const salesByMonth = new Map<number, number>(
    revenue.filter((r) => r.monthIndex != null).map((r) => [(r.monthIndex as number) + 1, r._sum.plannedAmount ?? 0])
  );
  if (salesByMonth.size === 0) {
    for (let m = 1; m <= 12; m++) salesByMonth.set(m, 10_000_000);
  }
  const upserts = planPoolUpserts(salesByMonth, []);
  for (const u of upserts) {
    await prisma.tradeBudgetPool.upsert({
      where: {
        organizationId_year_month_grainKey: { organizationId: orgId, year, month: u.month, grainKey: "org" },
      },
      create: {
        organizationId: orgId,
        year,
        month: u.month,
        grainKey: "org",
        salesPlanAmount: u.salesPlanAmount,
        budgetPct: u.budgetPct,
        budgetAmount: u.budgetAmount,
      },
      update: {
        salesPlanAmount: u.salesPlanAmount,
        budgetPct: u.budgetPct,
        budgetAmount: u.budgetAmount,
      },
    });
    await prisma.tradePlanDaily.deleteMany({
      where: { organizationId: orgId, year, month: u.month, grainKey: "org" },
    });
    const sales = spreadMonthlyPlan(year, u.month, u.salesPlanAmount);
    const budget = spreadMonthlyPlan(year, u.month, u.budgetAmount);
    await prisma.tradePlanDaily.createMany({
      data: sales.map((d, i) => ({
        organizationId: orgId,
        date: new Date(Date.UTC(year, u.month - 1, d.day)),
        year,
        month: u.month,
        grainKey: "org",
        plannedSalesAmount: d.amount,
        plannedTradeBudgetAmount: budget[i]?.amount ?? 0,
        workingDayWeight: d.weight,
      })),
    });
  }
  const pool = await prisma.tradeBudgetPool.findUnique({
    where: { organizationId_year_month_grainKey: { organizationId: orgId, year, month, grainKey: "org" } },
  });
  const budgetMonth = pool?.budgetAmount ?? 0;

  // 4. Campaigns: one approved & running, one draft.
  const monthStr = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  await prisma.tradeCampaign.upsert({
    where: { organizationId_code: { organizationId: orgId, code: "YAY_PROMO" } },
    create: {
      organizationId: orgId,
      code: "YAY_PROMO",
      name: "Yay Promo — Pepsi Modern Trade",
      goal: "Yay sezonunda Modern Trade kanalında Pepsi satışını +15% artırmaq",
      startDate: new Date(`${year}-${monthStr}-01T00:00:00Z`),
      endDate: new Date(Date.UTC(year, month - 1, lastDay)),
      status: "approved",
      plannedBudgetAmount: Math.round(budgetMonth * 0.4),
      expectedSalesUpliftPct: 15,
      ownerUserId: createdBy,
      scopes: {
        create: [
          { organizationId: orgId, scopeType: "channel", scopeValue: "Modern Trade" },
          { organizationId: orgId, scopeType: "brand", scopeValue: "Pepsi" },
        ],
      },
    },
    update: {},
  });
  await prisma.tradeCampaign.upsert({
    where: { organizationId_code: { organizationId: orgId, code: "PAYIZ_AKSIYA" } },
    create: {
      organizationId: orgId,
      code: "PAYIZ_AKSIYA",
      name: "Payız aksiyası — Jala HoReCa",
      goal: "HoReCa kanalında Jala şirələrinin listələnməsi",
      startDate: new Date(Date.UTC(year, month, 1)),
      endDate: new Date(Date.UTC(year, month + 1, 28)),
      status: "draft",
      plannedBudgetAmount: Math.round(budgetMonth * 0.15),
      expectedSalesUpliftPct: 8,
      ownerUserId: createdBy,
      scopes: {
        create: [
          { organizationId: orgId, scopeType: "channel", scopeValue: "HoReCa" },
          { organizationId: orgId, scopeType: "brand", scopeValue: "Jala" },
        ],
      },
    },
    update: {},
  });
  const campaign = await prisma.tradeCampaign.findUnique({
    where: { organizationId_code: { organizationId: orgId, code: "YAY_PROMO" } },
    select: { id: true },
  });

  // 5. Spend postings for the current month: pace slightly ahead of the
  //    calendar so the demo shows a lively (watch-ish) dashboard.
  await prisma.tradeSpendLedger.deleteMany({ where: { organizationId: orgId, year, month } });
  const day = Math.max(now.getUTCDate(), 2);
  const targetControl = Math.round(budgetMonth * Math.min((day / lastDay) * 1.25, 0.9));
  const onInvoice = typeByKey.get("on_invoice_discount")!;
  const promo = typeByKey.get("promo_payment")!;
  const listing = typeByKey.get("listing_fee")!;
  const posm = typeByKey.get("posm")!;
  const d = (dd: number) => new Date(Date.UTC(year, month - 1, Math.min(Math.max(dd, 1), day)));
  const entries: {
    kind: "plan" | "accrued" | "actual";
    typeId: string;
    date: Date;
    amount: number;
    note: string;
    campaignId?: string;
  }[] = [
    { kind: "plan", typeId: promo.id, date: d(1), amount: Math.round(budgetMonth * 0.4), note: "DEMO — Yay Promo plan", campaignId: campaign?.id },
    { kind: "accrued", typeId: onInvoice.id, date: d(3), amount: Math.round(targetControl * 0.3), note: "DEMO — həftə 1 invoice endirimləri" },
    { kind: "accrued", typeId: onInvoice.id, date: d(10), amount: Math.round(targetControl * 0.25), note: "DEMO — həftə 2 invoice endirimləri" },
    { kind: "accrued", typeId: onInvoice.id, date: d(17), amount: Math.round(targetControl * 0.2), note: "DEMO — həftə 3 invoice endirimləri" },
    { kind: "accrued", typeId: onInvoice.id, date: d(11), amount: -Math.round(targetControl * 0.03), note: "DEMO — kredit-nota düzəlişi" },
    { kind: "actual", typeId: promo.id, date: d(8), amount: Math.round(targetControl * 0.18), note: "DEMO — Yay Promo ödənişi", campaignId: campaign?.id },
    { kind: "actual", typeId: listing.id, date: d(5), amount: Math.round(targetControl * 0.06), note: "DEMO — Bravo listing haqqı" },
    { kind: "actual", typeId: posm.id, date: d(14), amount: Math.round(targetControl * 0.04), note: "DEMO — soyuducu quraşdırma" },
  ];
  for (const e of entries) {
    await prisma.tradeSpendLedger.create({
      data: {
        organizationId: orgId,
        entryKind: e.kind,
        spendTypeId: e.typeId,
        campaignId: e.campaignId ?? null,
        entryDate: e.date,
        year,
        month,
        amount: e.amount,
        sourceDocument: e.note,
        createdBy,
      },
    });
  }

  // 6. Pacing snapshot + alert sync (same math as POST /api/trade/pacing).
  const ledger = await prisma.tradeSpendLedger.findMany({
    where: { organizationId: orgId, year, month, voidedAt: null },
    select: {
      entryKind: true,
      amount: true,
      spendType: { select: { id: true, key: true, label: true, accrualMethod: true } },
    },
  });
  const { totals } = summarizeLedger(ledger);
  const input: PacingInput = {
    year,
    month,
    asOfDay: day,
    salesPlanMonth: pool?.salesPlanAmount ?? 0,
    salesActualMtd: 0, // 9.5 feed pending — same placeholder as the API
    budgetMonth,
    controlSpendMtd: totals.control,
    accruedSpendMtd: totals.accrued,
    actualSpendMtd: totals.actual,
  };
  const result = computePacing(input);
  const period = `${year}-${monthStr}`;
  const asOfDate = new Date(Date.UTC(year, month - 1, day));
  await prisma.tradePacingSnapshot.upsert({
    where: {
      organizationId_asOfDate_period_grainKey: { organizationId: orgId, asOfDate, period, grainKey: "org" },
    },
    create: {
      organizationId: orgId,
      asOfDate,
      period,
      grainKey: "org",
      salesPlanMtd: result.salesPlanMtd,
      salesActualMtd: 0,
      budgetMonth,
      controlSpendMtd: totals.control,
      accruedSpendMtd: totals.accrued,
      actualSpendMtd: totals.actual,
      forecastSalesMonth: result.forecastSalesMonth,
      forecastSpendMonth: result.forecastSpendMonth,
      forecastBudgetVariance: result.forecastBudgetVariance,
      forecastSalesGap: result.forecastSalesGap,
      riskStatus: result.riskStatus,
      math: input as unknown as object,
    },
    update: {
      controlSpendMtd: totals.control,
      accruedSpendMtd: totals.accrued,
      actualSpendMtd: totals.actual,
      forecastSpendMonth: result.forecastSpendMonth,
      forecastBudgetVariance: result.forecastBudgetVariance,
      riskStatus: result.riskStatus,
      math: input as unknown as object,
      generatedAt: new Date(),
    },
  });
  const candidates = evaluatePacingAlerts(period, "org", result).filter(
    (c) => c.ruleId !== "trade_spend_ahead_of_sales"
  );
  await syncTradeAlerts(prisma.alert, orgId, candidates, pacingAlertScopeKeys(period, "org"));

  console.log(`✓ demo seeded for org ${orgId}`);
  console.log(
    `  pools: ${upserts.length} months · month budget: ${budgetMonth.toLocaleString()} · ` +
      `control MTD: ${totals.control.toLocaleString()} · risk: ${result.riskStatus}`
  );
  console.log("  open /budgeting/trade to see the dashboard");
}

async function main() {
  const org = await resolveOrg();
  console.log(`org: ${org.name} (${org.id})`);
  await guardRealData(org.id);
  if (flag("clean")) {
    await clean(org.id);
  } else {
    await seed(org.id);
  }
}

main()
  .catch((e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
