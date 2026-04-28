/**
 * Seed extended budget tables (sales/cogs/balance-sheet/cash-flow/forecasts/
 * assumptions/rolling) for AZMADE org so per-tab availability gating
 * (Bug #6 from Turn 29) UN-hides all 11 secondary budget tabs for the demo.
 *
 * Why: pre-seed AZMADE has only `budget_lines` populated. The Onboarding
 * importer (CLI + /apply route) writes ONLY budget_lines/chart_of_accounts
 * — every other domain table stays empty. The `useTabAvailability()` hook
 * then hides 9 sidebar tabs (Sales Budget, COGS Budget, Balance Sheet,
 * Cash Flow, Assumptions, Sales Forecast, Expense Forecast, Rolling,
 * Report Builder). Demo customer sees a sparse hub while Demo org has
 * the full nav populated.
 *
 * What this script seeds (idempotent — skips if any rows already exist
 * for the AZMADE 2026 plan):
 *   - 11 budget_departments (mirrors Demo org's structure with AZ labels)
 *   - 13 budget_cost_types (AZ-labeled per Demo)
 *   - 6 product_lines (AAC-style: MHB, Lime burnt/slaked, Adhesive, U-block, Lime waste)
 *   - 12 × 6 = 72 sales_budget_lines (monthly × product, seasonal demand)
 *   - 12 × 6 = 72 cogs_budget_lines (monthly × product, ~70% margin)
 *   - 12 × 13 = 156 balance_sheet_lines (typical CoA with AZ names)
 *   - 12 × 9 = 108 cash_flow_entries (monthly × activity category)
 *   - ~30 budget_assumptions (FX rate, tax, inflation, salary growth, ...)
 *   - 12 × 11 = 132 sales_forecasts (monthly × department)
 *   - 12 × 13 = 156 expense_forecasts (monthly × cost type)
 *   - 12 rolling_forecast_months (one per month)
 *   - 12 × ~8 = ~96 budget_forecast_entries
 *
 * All AZ-labeled to match the customer's language. Numbers are realistic
 * for an AZ industrial holding (AZN values in millions).
 *
 * Run: `npx tsx scripts/seed-azmade-rich.ts`
 *
 * Idempotency: each block checks count for the (org, plan) tuple and
 * skips if non-zero. Re-run safe.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_SLUG = 'azmade';
const PLAN_NAME = 'AZMADE 2026 Budget';
const YEAR = 2026;

// ── Reference data: departments + cost types + product lines ──────────────
// Mirrors Demo org's structure (verified via psql). Already AZ-labeled.

const DEPARTMENTS: Array<{ key: string; label: string; hasRevenue: boolean; sortOrder: number }> = [
  { key: 'production', label: 'İstehsalat (Production)', hasRevenue: false, sortOrder: 1 },
  { key: 'sales', label: 'Satış və marketinq (Sales & Marketing)', hasRevenue: true, sortOrder: 2 },
  { key: 'admin', label: 'İnzibati (Administrative)', hasRevenue: false, sortOrder: 3 },
  { key: 'finance', label: 'Maliyyə (Finance)', hasRevenue: false, sortOrder: 4 },
  { key: 'logistics', label: 'Logistika (Logistics)', hasRevenue: false, sortOrder: 5 },
  { key: 'mhb', label: 'MHB (Qaz beton)', hasRevenue: true, sortOrder: 10 },
  { key: 'lime_burnt', label: 'Yandırılmış əhəng', hasRevenue: true, sortOrder: 11 },
  { key: 'lime_slaked', label: 'Söndürülmüş əhəng', hasRevenue: true, sortOrder: 12 },
  { key: 'adhesive', label: 'Yapışqan', hasRevenue: true, sortOrder: 13 },
  { key: 'ublock', label: 'U-block', hasRevenue: true, sortOrder: 14 },
  { key: 'lime_waste', label: 'Tullantı əhəng', hasRevenue: true, sortOrder: 15 },
];

const COST_TYPES: Array<{ key: string; label: string; isShared: boolean; sortOrder: number }> = [
  { key: 'staff', label: 'İşçi heyəti xərcləri (Staff costs)', isShared: false, sortOrder: 1 },
  { key: 'utilities', label: 'Kommunal xərclər (Utilities)', isShared: false, sortOrder: 2 },
  { key: 'services', label: 'Alınmış xidmətlər (Services)', isShared: false, sortOrder: 3 },
  { key: 'communication', label: 'Rabitə xərcləri (Communication)', isShared: false, sortOrder: 4 },
  { key: 'maintenance', label: 'Təmir-istismar xərcləri (Maintenance)', isShared: false, sortOrder: 5 },
  { key: 'materials', label: 'Mal-materiallar (Materials)', isShared: false, sortOrder: 6 },
  { key: 'transport', label: 'Nəqliyyat xərcləri (Transport)', isShared: false, sortOrder: 7 },
  { key: 'other_expense', label: 'Digər xərclər (Other expenses)', isShared: false, sortOrder: 8 },
  { key: 'marketing', label: 'Marketinq xərcləri (Marketing)', isShared: false, sortOrder: 9 },
  { key: 'finance', label: 'Maliyyə xərcləri (Finance costs)', isShared: false, sortOrder: 10 },
  { key: 'non_operating', label: 'Qeyri-əməliyyat xərcləri (Non-operating)', isShared: false, sortOrder: 11 },
  { key: 'tax', label: 'Vergilər (Taxes)', isShared: false, sortOrder: 12 },
  { key: 'depreciation', label: 'Amortizasiya (Depreciation)', isShared: false, sortOrder: 13 },
];

const PRODUCT_LINES: Array<{
  code: string;
  name: string;
  unit: string;
  sortOrder: number;
  // Annual targets per product (AZN)
  annualRevenue: number;
  // Monthly distribution shape — multiplied by base then normalized to annual
  shape: number[];
}> = [
  // Seasonal industrial pattern: peak in spring/summer construction season
  { code: 'MHB', name: 'MHB (Qaz beton)', unit: 'm³', sortOrder: 1, annualRevenue: 12_000_000, shape: [0.6, 0.7, 0.9, 1.1, 1.3, 1.4, 1.4, 1.3, 1.2, 1.0, 0.7, 0.4] },
  { code: 'LIME_BURNT', name: 'Yandırılmış əhəng', unit: 'ton', sortOrder: 2, annualRevenue: 8_500_000, shape: [0.7, 0.8, 1.0, 1.1, 1.2, 1.3, 1.3, 1.2, 1.1, 1.0, 0.8, 0.5] },
  { code: 'LIME_SLAKED', name: 'Söndürülmüş əhəng', unit: 'ton', sortOrder: 3, annualRevenue: 4_200_000, shape: [0.8, 0.9, 1.0, 1.1, 1.2, 1.2, 1.2, 1.1, 1.0, 1.0, 0.8, 0.7] },
  { code: 'ADHESIVE', name: 'Yapışqan', unit: 'ədəd', sortOrder: 4, annualRevenue: 2_800_000, shape: [0.9, 1.0, 1.0, 1.1, 1.1, 1.1, 1.1, 1.1, 1.0, 1.0, 0.9, 0.7] },
  { code: 'UBLOCK', name: 'U-block', unit: 'ədəd', sortOrder: 5, annualRevenue: 1_500_000, shape: [0.7, 0.8, 1.0, 1.1, 1.3, 1.3, 1.3, 1.2, 1.1, 0.9, 0.7, 0.6] },
  { code: 'LIME_WASTE', name: 'Tullantı əhəng', unit: 'ton', sortOrder: 6, annualRevenue: 350_000, shape: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
];

// Balance-sheet line items, AZ-labeled. Asset/liability/equity sections.
const BALANCE_SHEET: Array<{
  code: string;
  nameAz: string;
  lineType: 'asset' | 'liability' | 'equity';
  subType: string;
  baseAmount: number;
}> = [
  // Assets
  { code: '101', nameAz: 'Pul vəsaitləri', lineType: 'asset', subType: 'current', baseAmount: 8_500_000 },
  { code: '102', nameAz: 'Bank hesabları', lineType: 'asset', subType: 'current', baseAmount: 12_300_000 },
  { code: '111', nameAz: 'Müştəri borcları (Debitor)', lineType: 'asset', subType: 'current', baseAmount: 18_700_000 },
  { code: '121', nameAz: 'Mal-material ehtiyatları', lineType: 'asset', subType: 'current', baseAmount: 22_400_000 },
  { code: '131', nameAz: 'Əsas vəsaitlər (binalar)', lineType: 'asset', subType: 'non_current', baseAmount: 145_000_000 },
  { code: '132', nameAz: 'Avadanlıq və maşınlar', lineType: 'asset', subType: 'non_current', baseAmount: 78_000_000 },
  { code: '133', nameAz: 'Nəqliyyat vasitələri', lineType: 'asset', subType: 'non_current', baseAmount: 12_500_000 },
  // Liabilities
  { code: '201', nameAz: 'Təchizatçı borcları (Kreditor)', lineType: 'liability', subType: 'current', baseAmount: 14_600_000 },
  { code: '211', nameAz: 'Vergi borcları', lineType: 'liability', subType: 'current', baseAmount: 3_200_000 },
  { code: '221', nameAz: 'Bank kreditləri (uzunmüddətli)', lineType: 'liability', subType: 'non_current', baseAmount: 65_000_000 },
  { code: '222', nameAz: 'Bank kreditləri (qısamüddətli)', lineType: 'liability', subType: 'current', baseAmount: 18_500_000 },
  // Equity
  { code: '301', nameAz: 'Nizamnamə kapitalı', lineType: 'equity', subType: 'capital', baseAmount: 50_000_000 },
  { code: '302', nameAz: 'Bölüşdürülməmiş mənfəət', lineType: 'equity', subType: 'retained', baseAmount: 47_100_000 },
];

const CASH_FLOW_CATEGORIES: Array<{
  category: string;
  activityType: 'operating' | 'investing' | 'financing';
  entryType: 'inflow' | 'outflow';
  baseMonthly: number;
  shape: number[];
}> = [
  { category: 'Müştərilərdən daxil olan vəsait', activityType: 'operating', entryType: 'inflow', baseMonthly: 2_500_000, shape: [0.7, 0.8, 1.0, 1.1, 1.3, 1.4, 1.4, 1.3, 1.2, 1.0, 0.8, 0.6] },
  { category: 'Təchizatçılara ödənişlər', activityType: 'operating', entryType: 'outflow', baseMonthly: -1_400_000, shape: [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.3, 1.2, 1.1, 1.0, 0.9, 0.7] },
  { category: 'Əmək haqqı və SSF', activityType: 'operating', entryType: 'outflow', baseMonthly: -680_000, shape: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5] },
  { category: 'Vergi və icbari ödənişlər', activityType: 'operating', entryType: 'outflow', baseMonthly: -340_000, shape: [1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  { category: 'Əsas vəsaitlərə investisiya', activityType: 'investing', entryType: 'outflow', baseMonthly: -250_000, shape: [0, 0, 0.5, 1, 2, 1.5, 1, 1, 0.5, 0, 0, 0] },
  { category: 'Avadanlıq satışı', activityType: 'investing', entryType: 'inflow', baseMonthly: 60_000, shape: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0] },
  { category: 'Bank krediti alınması', activityType: 'financing', entryType: 'inflow', baseMonthly: 0, shape: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { category: 'Bank krediti qaytarılması', activityType: 'financing', entryType: 'outflow', baseMonthly: -180_000, shape: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  { category: 'Faiz xərcləri', activityType: 'financing', entryType: 'outflow', baseMonthly: -95_000, shape: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
];

const ASSUMPTIONS: Array<{
  category: string;
  key: string;
  label: string;
  value: number;
  unit: string;
  notes?: string;
}> = [
  { category: 'fx', key: 'usd_azn_rate', label: 'USD/AZN məzənnəsi', value: 1.7, unit: 'AZN/USD', notes: 'Mərkəzi Bank rəsmi məzənnəsi əsasında' },
  { category: 'fx', key: 'eur_azn_rate', label: 'EUR/AZN məzənnəsi', value: 1.85, unit: 'AZN/EUR' },
  { category: 'fx', key: 'rub_azn_rate', label: 'RUB/AZN məzənnəsi', value: 0.018, unit: 'AZN/RUB' },
  { category: 'tax', key: 'profit_tax_rate', label: 'Mənfəət vergisi dərəcəsi', value: 20, unit: '%', notes: 'AZ Vergi Məcəlləsi maddə 105' },
  { category: 'tax', key: 'vat_rate', label: 'ƏDV dərəcəsi', value: 18, unit: '%' },
  { category: 'tax', key: 'social_tax_rate', label: 'Sosial sığorta dərəcəsi', value: 22, unit: '%', notes: 'İşəgötürən payı' },
  { category: 'inflation', key: 'cpi_target', label: 'İllik inflyasiya hədəfi', value: 4, unit: '%', notes: 'Mərkəzi Bank proqnozu' },
  { category: 'inflation', key: 'wage_growth', label: 'Əmək haqqı artımı', value: 6, unit: '%' },
  { category: 'pricing', key: 'mhb_price_growth', label: 'MHB qiymət artımı (illik)', value: 5, unit: '%' },
  { category: 'pricing', key: 'lime_price_growth', label: 'Əhəng qiymət artımı (illik)', value: 4, unit: '%' },
  { category: 'pricing', key: 'cogs_inflation', label: 'COGS inflyasiyası', value: 5.5, unit: '%' },
  { category: 'finance', key: 'avg_credit_rate', label: 'Orta kredit faiz dərəcəsi', value: 12, unit: '%' },
  { category: 'finance', key: 'wacc', label: 'WACC (orta çəkili kapital dəyəri)', value: 14, unit: '%' },
  { category: 'finance', key: 'min_cash_buffer', label: 'Minimum nağd qalıq', value: 5_000_000, unit: 'AZN' },
  { category: 'operations', key: 'capacity_utilization', label: 'İstehsal gücü istifadəsi', value: 78, unit: '%' },
  { category: 'operations', key: 'avg_payment_terms_days', label: 'Orta ödəniş müddəti', value: 45, unit: 'gün' },
  { category: 'operations', key: 'avg_receivables_days', label: 'Debitor borc dövriyyəsi', value: 38, unit: 'gün' },
  { category: 'operations', key: 'avg_inventory_days', label: 'Mal-material dövriyyəsi', value: 62, unit: 'gün' },
  { category: 'hr', key: 'headcount_total', label: 'Ümumi işçi sayı', value: 245, unit: 'nəfər' },
  { category: 'hr', key: 'headcount_production', label: 'İstehsalat işçiləri', value: 168, unit: 'nəfər' },
  { category: 'hr', key: 'avg_monthly_salary', label: 'Orta aylıq maaş', value: 1350, unit: 'AZN' },
  { category: 'commercial', key: 'market_share_target', label: 'Hədəf bazar payı', value: 24, unit: '%' },
  { category: 'commercial', key: 'customer_count', label: 'Aktiv müştəri sayı', value: 412, unit: '' },
  { category: 'commercial', key: 'avg_order_size', label: 'Orta sifariş həcmi', value: 28_500, unit: 'AZN' },
  { category: 'risk', key: 'fx_exposure_usd', label: 'USD valyuta riski', value: 35, unit: '%' },
  { category: 'risk', key: 'concentration_top5', label: 'Top-5 müştəri konsentrasiyası', value: 42, unit: '%' },
  { category: 'risk', key: 'days_of_cash', label: 'Nağd vəsaitlərin gün ehtiyatı', value: 35, unit: 'gün' },
];

function id(): string {
  // cuid-style id (Prisma's @default(cuid()) not available in raw inserts)
  return 'cmo' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
}

async function main(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) throw new Error(`Organization slug=${ORG_SLUG} not found`);
  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: YEAR, name: PLAN_NAME, deletedAt: null },
  });
  if (!plan) {
    throw new Error(
      `Plan "${PLAN_NAME}" for ${YEAR} not found in org=${ORG_SLUG}. Run scripts/import-azmade-budgets.ts first.`,
    );
  }

  console.log(`[seed-azmade-rich] org=${org.id} plan=${plan.id}`);

  // ── 1. Departments ────────────────────────────────────────────────────
  const deptCount = await prisma.budgetDepartment.count({
    where: { organizationId: org.id },
  });
  if (deptCount === 0) {
    await prisma.budgetDepartment.createMany({
      data: DEPARTMENTS.map((d) => ({
        id: id(),
        organizationId: org.id,
        key: d.key,
        label: d.label,
        hasRevenue: d.hasRevenue,
        sortOrder: d.sortOrder,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    console.log(`  ✓ Departments: ${DEPARTMENTS.length} created`);
  } else {
    console.log(`  ⊙ Departments: ${deptCount} already exist, skipping`);
  }

  // ── 2. Cost types ─────────────────────────────────────────────────────
  const costTypeCount = await prisma.budgetCostType.count({
    where: { organizationId: org.id },
  });
  if (costTypeCount === 0) {
    await prisma.budgetCostType.createMany({
      data: COST_TYPES.map((c) => ({
        id: id(),
        organizationId: org.id,
        key: c.key,
        label: c.label,
        isShared: c.isShared,
        sortOrder: c.sortOrder,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    console.log(`  ✓ Cost types: ${COST_TYPES.length} created`);
  } else {
    console.log(`  ⊙ Cost types: ${costTypeCount} already exist, skipping`);
  }

  // ── 3. Product lines ──────────────────────────────────────────────────
  const productCount = await prisma.productLine.count({
    where: { organizationId: org.id },
  });
  if (productCount === 0) {
    await prisma.productLine.createMany({
      data: PRODUCT_LINES.map((p) => ({
        id: id(),
        organizationId: org.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        sortOrder: p.sortOrder,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    console.log(`  ✓ Product lines: ${PRODUCT_LINES.length} created`);
  } else {
    console.log(`  ⊙ Product lines: ${productCount} already exist, skipping`);
  }

  const products = await prisma.productLine.findMany({
    where: { organizationId: org.id },
    orderBy: { sortOrder: 'asc' },
  });
  const productByCode = new Map(products.map((p) => [p.code, p.id]));

  // ── 4. Sales budget lines (12 × 6 = 72 rows) ─────────────────────────
  const salesCount = await prisma.salesBudgetLine.count({
    where: { planId: plan.id },
  });
  if (salesCount === 0) {
    const rows: Prisma.SalesBudgetLineCreateManyInput[] = [];
    for (const p of PRODUCT_LINES) {
      const productId = productByCode.get(p.code);
      if (!productId) continue;
      const shapeSum = p.shape.reduce((s, v) => s + v, 0);
      const monthlyBaseRev = p.annualRevenue / shapeSum;
      for (let m = 1; m <= 12; m++) {
        const factor = p.shape[m - 1];
        const amount = Math.round(monthlyBaseRev * factor);
        // Synthetic quantity + unit price (round to clean numbers)
        const unitPrice = p.code === 'MHB' ? 220 : p.code === 'LIME_BURNT' ? 180 : p.code === 'LIME_SLAKED' ? 160 : p.code === 'ADHESIVE' ? 12 : p.code === 'UBLOCK' ? 6 : 40;
        const quantity = Math.round(amount / unitPrice);
        rows.push({
          id: id(),
          organizationId: org.id,
          planId: plan.id,
          productLineId: productId,
          year: YEAR,
          month: m,
          quantity,
          unitPrice,
          amount,
          notes: `${p.name} - ${m.toString().padStart(2, '0')}/${YEAR} satış proqnozu`,
        });
      }
    }
    await prisma.salesBudgetLine.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Sales budget lines: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Sales budget lines: ${salesCount} already exist, skipping`);
  }

  // ── 5. COGS budget lines (12 × 6 = 72) ────────────────────────────────
  const cogsCount = await prisma.cOGSBudgetLine.count({
    where: { planId: plan.id },
  });
  if (cogsCount === 0) {
    const rows: Prisma.COGSBudgetLineCreateManyInput[] = [];
    for (const p of PRODUCT_LINES) {
      const productId = productByCode.get(p.code);
      if (!productId) continue;
      const shapeSum = p.shape.reduce((s, v) => s + v, 0);
      // ~70% gross margin → COGS ≈ 30% of revenue
      const annualCogs = p.annualRevenue * 0.32;
      const monthlyBaseCogs = annualCogs / shapeSum;
      for (let m = 1; m <= 12; m++) {
        const factor = p.shape[m - 1];
        const totalCost = Math.round(monthlyBaseCogs * factor);
        const productionQty = Math.round((p.annualRevenue * 1.05 * factor) / shapeSum / (p.code === 'MHB' ? 220 : 100));
        rows.push({
          id: id(),
          organizationId: org.id,
          planId: plan.id,
          productLineId: productId,
          year: YEAR,
          month: m,
          productionQty,
          totalCost,
        });
      }
    }
    await prisma.cOGSBudgetLine.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ COGS budget lines: ${rows.length} created`);
  } else {
    console.log(`  ⊙ COGS budget lines: ${cogsCount} already exist, skipping`);
  }

  // ── 6. Balance sheet lines (12 × 13 = 156) ────────────────────────────
  const bsCount = await prisma.balanceSheetLine.count({
    where: { planId: plan.id },
  });
  if (bsCount === 0) {
    const rows: Prisma.BalanceSheetLineCreateManyInput[] = [];
    for (const item of BALANCE_SHEET) {
      for (let m = 1; m <= 12; m++) {
        // Slight monthly drift: assets/liabilities grow 0.8% per month, equity flat
        const driftFactor =
          item.lineType === 'equity' ? 1 : 1 + 0.008 * (m - 1);
        rows.push({
          id: id(),
          organizationId: org.id,
          planId: plan.id,
          accountCode: item.code,
          accountName: item.nameAz,
          lineType: item.lineType,
          subType: item.subType,
          year: YEAR,
          month: m,
          amount: Math.round(item.baseAmount * driftFactor),
        });
      }
    }
    await prisma.balanceSheetLine.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Balance sheet lines: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Balance sheet lines: ${bsCount} already exist, skipping`);
  }

  // ── 7. Cash flow entries (12 × 9 = 108) ───────────────────────────────
  const cfCount = await prisma.cashFlowEntry.count({
    where: {
      organizationId: org.id,
      year: YEAR,
    },
  });
  if (cfCount === 0) {
    const rows: Prisma.CashFlowEntryCreateManyInput[] = [];
    for (const c of CASH_FLOW_CATEGORIES) {
      const shapeSum = c.shape.reduce((s, v) => s + v, 0) || 12;
      const baseAdjusted = (c.baseMonthly * 12) / shapeSum;
      for (let m = 1; m <= 12; m++) {
        const factor = c.shape[m - 1];
        const amount = Math.round(baseAdjusted * factor);
        if (amount === 0) continue;
        rows.push({
          id: id(),
          organizationId: org.id,
          year: YEAR,
          month: m,
          entryType: c.entryType,
          source: 'plan',
          amount,
          currencyCode: 'AZN',
          activityType: c.activityType,
          category: c.category,
          isProjected: true,
          plannedAmount: amount,
          description: `${c.category} - ${m.toString().padStart(2, '0')}/${YEAR}`,
        });
      }
    }
    await prisma.cashFlowEntry.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Cash flow entries: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Cash flow entries: ${cfCount} already exist, skipping`);
  }

  // ── 8. Budget assumptions ─────────────────────────────────────────────
  const asmCount = await prisma.budgetAssumption.count({
    where: { planId: plan.id },
  });
  if (asmCount === 0) {
    await prisma.budgetAssumption.createMany({
      data: ASSUMPTIONS.map((a, idx) => ({
        id: id(),
        organizationId: org.id,
        planId: plan.id,
        category: a.category,
        key: a.key,
        label: a.label,
        value: a.value,
        unit: a.unit ?? null,
        period: `${YEAR}`,
        notes: a.notes ?? null,
        sortOrder: idx,
      })),
      skipDuplicates: true,
    });
    console.log(`  ✓ Budget assumptions: ${ASSUMPTIONS.length} created`);
  } else {
    console.log(`  ⊙ Budget assumptions: ${asmCount} already exist, skipping`);
  }

  // ── 9. Sales forecasts (12 × revenue-bearing departments) ────────────
  const salesFcCount = await prisma.salesForecast.count({
    where: { organizationId: org.id, year: YEAR },
  });
  if (salesFcCount === 0) {
    const departments = await prisma.budgetDepartment.findMany({
      where: { organizationId: org.id, hasRevenue: true },
    });
    const rows: Prisma.SalesForecastCreateManyInput[] = [];
    for (const d of departments) {
      // Per-department monthly target ~ 200K-2M AZN, seasonal
      const annualBase = d.key === 'mhb' ? 12_000_000 : d.key === 'lime_burnt' ? 8_500_000 : d.key === 'lime_slaked' ? 4_200_000 : d.key === 'adhesive' ? 2_800_000 : d.key === 'ublock' ? 1_500_000 : d.key === 'lime_waste' ? 350_000 : 1_200_000;
      const seasonal = [0.7, 0.8, 1.0, 1.1, 1.3, 1.4, 1.4, 1.3, 1.1, 1.0, 0.7, 0.5];
      const shapeSum = seasonal.reduce((s, v) => s + v, 0);
      for (let m = 1; m <= 12; m++) {
        rows.push({
          id: id(),
          organizationId: org.id,
          departmentId: d.id,
          year: YEAR,
          month: m,
          amount: Math.round((annualBase / shapeSum) * seasonal[m - 1]),
          notes: `${d.label} - aylıq satış proqnozu`,
        });
      }
    }
    await prisma.salesForecast.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Sales forecasts: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Sales forecasts: ${salesFcCount} already exist, skipping`);
  }

  // ── 10. Expense forecasts (12 × cost-types) ──────────────────────────
  const expenseFcCount = await prisma.expenseForecast.count({
    where: { organizationId: org.id, year: YEAR },
  });
  if (expenseFcCount === 0) {
    const costTypes = await prisma.budgetCostType.findMany({
      where: { organizationId: org.id },
    });
    const departments = await prisma.budgetDepartment.findMany({
      where: { organizationId: org.id },
    });
    const adminDept = departments.find((d) => d.key === 'admin');
    const rows: Prisma.ExpenseForecastCreateManyInput[] = [];
    for (const c of costTypes) {
      // Per-cost-type monthly base — staff/utilities/materials are biggest
      const annualBase = c.key === 'staff' ? 4_000_000 : c.key === 'utilities' ? 1_200_000 : c.key === 'materials' ? 2_500_000 : c.key === 'maintenance' ? 800_000 : c.key === 'transport' ? 600_000 : c.key === 'finance' ? 1_100_000 : c.key === 'tax' ? 850_000 : c.key === 'depreciation' ? 1_800_000 : 350_000;
      for (let m = 1; m <= 12; m++) {
        // Roughly flat with small variation
        const monthly = annualBase / 12;
        const variation = 1 + 0.05 * Math.sin((m - 1) * Math.PI / 6);
        rows.push({
          id: id(),
          organizationId: org.id,
          costTypeId: c.id,
          departmentId: adminDept?.id ?? null,
          year: YEAR,
          month: m,
          amount: Math.round(monthly * variation),
          notes: `${c.label} - aylıq xərc proqnozu`,
        });
      }
    }
    await prisma.expenseForecast.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Expense forecasts: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Expense forecasts: ${expenseFcCount} already exist, skipping`);
  }

  // ── 11. Rolling forecast months (12) ──────────────────────────────────
  const rollCount = await prisma.rollingForecastMonth.count({
    where: { planId: plan.id },
  });
  if (rollCount === 0) {
    const rows: Prisma.RollingForecastMonthCreateManyInput[] = [];
    for (let m = 1; m <= 12; m++) {
      rows.push({
        id: id(),
        organizationId: org.id,
        planId: plan.id,
        year: YEAR,
        month: m,
        // Past months (1-3 = Q1) are locked actuals; rest are forecast
        status: m <= 3 ? 'actual' : 'forecast',
      });
    }
    await prisma.rollingForecastMonth.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Rolling forecast months: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Rolling forecast months: ${rollCount} already exist, skipping`);
  }

  // ── 12. Budget forecast entries (12 × ~13 cost types = ~156) ─────────
  const fcEntryCount = await prisma.budgetForecastEntry.count({
    where: { planId: plan.id },
  });
  if (fcEntryCount === 0) {
    const costTypes = await prisma.budgetCostType.findMany({
      where: { organizationId: org.id },
    });
    const rows: Prisma.BudgetForecastEntryCreateManyInput[] = [];
    for (const c of costTypes) {
      const annualBase = c.key === 'staff' ? 4_000_000 : c.key === 'utilities' ? 1_200_000 : c.key === 'materials' ? 2_500_000 : c.key === 'maintenance' ? 800_000 : c.key === 'transport' ? 600_000 : c.key === 'finance' ? 1_100_000 : c.key === 'tax' ? 850_000 : c.key === 'depreciation' ? 1_800_000 : 350_000;
      for (let m = 1; m <= 12; m++) {
        const monthly = annualBase / 12;
        rows.push({
          id: id(),
          organizationId: org.id,
          planId: plan.id,
          year: YEAR,
          month: m,
          category: c.label,
          lineType: 'expense',
          forecastAmount: Math.round(monthly * (1 + 0.03 * Math.sin((m - 1) * Math.PI / 6))),
          costTypeId: c.id,
        });
      }
    }
    await prisma.budgetForecastEntry.createMany({ data: rows, skipDuplicates: true });
    console.log(`  ✓ Budget forecast entries: ${rows.length} created`);
  } else {
    console.log(`  ⊙ Budget forecast entries: ${fcEntryCount} already exist, skipping`);
  }

  console.log(`\n[seed-azmade-rich] Done.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
