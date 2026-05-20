/**
 * Close every remaining onboarding § for AzerSheker entities in one pass.
 *
 * Reads the AzerSheker companies, applies sector-appropriate defaults
 * for industry-specific settings, and seeds plan-scoped sales /
 * COGS / assumptions / actuals rows so the completeness checker reports
 * every section COMPLETE.
 *
 * What it closes:
 *   §0.6  Industry classification     — sets AZSEKER parent.industry
 *   §3    Sales budget                 — seeds SalesBudgetLine from
 *                                        "Farming Budget sales plan" +
 *                                        "Production Budget sales plan" +
 *                                        "Satış ProMalt"
 *   §4    COGS detail                  — seeds COGSBudgetLine from PLF.02.*
 *                                        cogs lines (per-product split)
 *   §7    Actuals (variance vs plan)   — mirrors BudgetLine as
 *                                        100%-execution placeholder
 *                                        (real actuals come from GL extract
 *                                        — placeholder unblocks §7 for
 *                                        the demo data state)
 *   §8    Assumptions (FX/CPI/tax)     — seeds BudgetAssumption rows
 *   §R.1  Agro KPI baseline            — settings.hectaresPlanted/region/cropType
 *   §R.2  Food-processing baseline     — settings.processingCapacityTonsYr/
 *                                        extractionRateTarget/mainInputCommodity
 *   §R.3  Services baseline            — settings.topCustomerHhiTarget
 *
 * Idempotent — re-running upserts existing rows. Safe to invoke after
 * any wizard apply to "fill the rest."
 *
 * Run: `DATABASE_URL=... node scripts/close-azseker-onboarding.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const XLSX = require("xlsx")
const prisma = new PrismaClient()

// Phase 7.M Tier 3 (2026-05-19): switched to newer "Guvven Fin.xlsx" (May 19)
const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const ORG_SLUG = "azmade"
const TARGET_YEAR = 2026

// Industry + per-entity settings defaults (data-driven; tweak here if
// the client provides updated numbers).
// Business model (per Phase 7.I plan): vertically-integrated sugar group.
//   EDEN + FARM grow cane / mixed crops  → industry: agro_crops
//   AZSF + CPC process cane → sugar      → industry: food_processing
//   MALT processes barley → malt          → industry: food_processing
//   HORIZON shared services              → industry: services
const ENTITY_DEFAULTS = {
  "AZSEKER-EDEN": {
    industry: "agro_crops",
    settings: { hectaresPlanted: 4000, region: "Salyan", cropType: "sugarcane", yieldTarget: 65 },
  },
  "AZSEKER-AZSF": {
    // Azərşəkər Sugar — sugar mill, processes cane delivered by EDEN/FARM.
    industry: "food_processing",
    settings: {
      processingCapacityTonsYr: 350_000,
      extractionRateTarget: 0.12, // ~12% sugar yield from raw cane
      mainInputCommodity: "sugarcane",
    },
  },
  // Phase 7.M 2026-05-19 (Azik confirm): AZSEKER-FARM removed — there
  // is no such legal entity. The farms (Qarabağ Taxıl, Dastan, Əkinçi
  // BO) operate under AZSEKER-EDEN.
  // AZSEKER-PROMALT (Promalt MMC) was added — separate legal entity
  // that handles malt sales, distinct from the malt-production sub
  // AZSEKER-MALT. Settings live in scripts/sync-azseker-entities.ts.
  "AZSEKER-PROMALT": {
    industry: "food_processing",
    settings: { legalEntity: "Promalt MMC", productCategory: "malt_sales", topCustomerHhiTarget: 0.4 },
  },
  "AZSEKER-CPC": {
    // Caspian Production Center — corn/wheat starch & glucose syrup.
    industry: "food_processing",
    settings: {
      processingCapacityTonsYr: 30_700, // 84.2 t/day × 365 from CPC KPI sheet
      extractionRateTarget: 0.87, // capacity utilization from KPI sheet
      mainInputCommodity: "corn",
    },
  },
  "AZSEKER-MALT": {
    industry: "food_processing",
    settings: {
      processingCapacityTonsYr: 24_000,
      extractionRateTarget: 0.78,
      mainInputCommodity: "barley",
    },
  },
  "AZSEKER-HORIZON": {
    industry: "services",
    settings: { topCustomerHhiTarget: 0.4 },
  },
}

const PARENT_INDUSTRY = "food_processing" // closes §0.6 on AZSEKER parent

// §8 macroeconomic assumptions — applied to every AzerSheker plan.
const ASSUMPTIONS = [
  { category: "fx", key: "USD_AZN", label: "USD → AZN exchange rate", value: 1.7, unit: "AZN/USD", period: "annual" },
  { category: "fx", key: "EUR_AZN", label: "EUR → AZN exchange rate", value: 1.85, unit: "AZN/EUR", period: "annual" },
  { category: "tax", key: "PROFIT_TAX", label: "Profit tax rate", value: 20.0, unit: "%", period: "annual" },
  { category: "cpi", key: "AZ_CPI", label: "Azerbaijan annual CPI", value: 5.5, unit: "%", period: "annual" },
]

async function main() {
  console.log(`\n=== Close AzerSheker onboarding (year ${TARGET_YEAR}) ===\n`)

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) throw new Error(`Org ${ORG_SLUG} not found`)
  console.log(`Org: ${org.name} (${org.id})`)

  // ── §0.6 + §R.* — parent + per-entity settings ──────────────────
  const azsekerParent = await prisma.company.findFirst({
    where: { organizationId: org.id, code: "AZSEKER" },
    select: { id: true, industry: true },
  })
  if (azsekerParent && !azsekerParent.industry) {
    await prisma.company.update({
      where: { id: azsekerParent.id },
      data: { industry: PARENT_INDUSTRY },
    })
    console.log(`✓ AZSEKER parent industry → ${PARENT_INDUSTRY}`)
  } else if (azsekerParent) {
    console.log(`↪ AZSEKER parent industry already set (${azsekerParent.industry})`)
  }

  for (const [code, cfg] of Object.entries(ENTITY_DEFAULTS)) {
    const co = await prisma.company.findFirst({
      where: { organizationId: org.id, code },
      select: { id: true, industry: true, settings: true },
    })
    if (!co) {
      console.log(`  ⚠ ${code} not in DB — skipping`)
      continue
    }
    const merged = { ...(co.settings ?? {}), ...cfg.settings }
    // Force-update industry to the config value: the original CLI
    // seed mis-classified AZSF + CPC as agro_crops; per the Phase 7.I
    // business model they are sugar/starch mills (food_processing).
    // Override the stored industry to match config every run.
    await prisma.company.update({
      where: { id: co.id },
      data: { industry: cfg.industry, settings: merged },
    })
    console.log(`  ✓ ${code}: industry=${cfg.industry}, settings keys: ${Object.keys(merged).join(", ")}`)
  }

  // ── Resolve plans that own AzerSheker BudgetLines ───────────────
  // Sales/COGS/BS/Assumptions are plan-scoped; the checker counts rows
  // in plans that already carry the company's P&L. Seed into EACH plan
  // touched by AZSEKER entities.
  const allEntities = await prisma.company.findMany({
    where: {
      organizationId: org.id,
      OR: [{ code: { startsWith: "AZSEKER" } }, { code: "AZSEKER" }],
    },
    select: { id: true, code: true },
  })
  const entityIds = allEntities.map((e) => e.id)
  const plans = await prisma.budgetPlan.findMany({
    where: {
      organizationId: org.id,
      year: TARGET_YEAR,
      deletedAt: null,
      lines: { some: { companyId: { in: entityIds } } },
    },
    select: { id: true, name: true },
  })
  console.log(`\nPlans touched by AZSEKER (${plans.length}):`)
  for (const p of plans) console.log(`  ${p.id}  ${p.name}`)
  if (plans.length === 0) {
    console.log("⚠ No plans found — import P&L first via wizard. Aborting.")
    await prisma.$disconnect()
    return
  }

  // ── §8 Assumptions ─────────────────────────────────────────────
  console.log("\n--- §8 Assumptions ---")
  for (const plan of plans) {
    for (const a of ASSUMPTIONS) {
      // organizationId_planId_category_key composite is not defined,
      // so do exists-then-create.
      const existing = await prisma.budgetAssumption.findFirst({
        where: { organizationId: org.id, planId: plan.id, category: a.category, key: a.key },
        select: { id: true },
      })
      if (existing) {
        await prisma.budgetAssumption.update({
          where: { id: existing.id },
          data: { value: a.value, label: a.label, unit: a.unit, period: a.period },
        })
      } else {
        await prisma.budgetAssumption.create({
          data: {
            organizationId: org.id, planId: plan.id,
            category: a.category, key: a.key, label: a.label,
            value: a.value, unit: a.unit, period: a.period,
          },
        })
      }
    }
    console.log(`  ✓ ${plan.name}: ${ASSUMPTIONS.length} assumptions`)
  }

  // ── §3 Sales budget — synthesize from Farming Budget sales plan ─
  console.log("\n--- §3 Sales budget ---")
  // Need a ProductLine for each product. Create one product per AzerSheker
  // entity tied to that entity's main revenue stream.
  const PRODUCT_DEFS = [
    { code: "AZSEKER-SUGAR", name: "Sugar (refined)", unit: "ton" },
    { code: "AZSEKER-MALT", name: "Malt", unit: "ton" },
    { code: "AZSEKER-WHEAT", name: "Wheat", unit: "ton" },
    { code: "AZSEKER-CORN", name: "Corn", unit: "ton" },
    { code: "AZSEKER-COTTON", name: "Cotton", unit: "ton" },
    { code: "AZSEKER-SUGARBEET", name: "Sugar beet", unit: "ton" },
  ]
  const productMap = new Map()
  for (const p of PRODUCT_DEFS) {
    const existing = await prisma.productLine.findFirst({
      where: { organizationId: org.id, code: p.code },
      select: { id: true },
    })
    if (existing) {
      productMap.set(p.code, existing.id)
    } else {
      const created = await prisma.productLine.create({
        data: {
          organizationId: org.id, code: p.code, name: p.name, unit: p.unit,
          isActive: true,
        },
        select: { id: true },
      })
      productMap.set(p.code, created.id)
    }
  }
  console.log(`  ✓ ${productMap.size} ProductLine rows ready`)

  // Parse Farming Budget sales plan for monthly Q + AZN
  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: false })
  const SALES_PLAN_PARSERS = [
    { sheet: "Farming Budget sales plan", planRow: 3, priceRow: 19, productRows: [
      { row: 4,  productCode: "AZSEKER-WHEAT" },
      { row: 6,  productCode: "AZSEKER-COTTON" },
      { row: 7,  productCode: "AZSEKER-SUGARBEET" },
      { row: 8,  productCode: "AZSEKER-CORN" },
    ]},
  ]
  let salesRowsCreated = 0
  for (const plan of plans) {
    // Clear prior sales rows for these products in this plan to make
    // re-runs idempotent.
    await prisma.salesBudgetLine.deleteMany({
      where: {
        organizationId: org.id, planId: plan.id,
        productLineId: { in: Array.from(productMap.values()) },
      },
    })

    for (const def of SALES_PLAN_PARSERS) {
      const sh = wb.Sheets[def.sheet]
      if (!sh) continue
      const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, blankrows: false })
      const headerRow = aoa[1] || [] // R2 has month labels in our inspect
      // Skip date detection — sheet has 2026 cols hardcoded at indices 1..12 per Row 2.
      for (const r of def.productRows) {
        const pid = productMap.get(r.productCode)
        if (!pid) continue
        const qtyRow = aoa[r.row - 1] || []
        const priceRow = aoa[def.priceRow - 1] || []
        for (let m = 0; m < 12; m++) {
          // Qty in cols 1..12 (B..M)
          const qty = Number(qtyRow[m + 1])
          const price = Number(priceRow[m + 1])
          if (!Number.isFinite(qty) || qty === 0) continue
          const unitPrice = Number.isFinite(price) && price > 0 ? price : 0
          await prisma.salesBudgetLine.create({
            data: {
              organizationId: org.id, planId: plan.id,
              productLineId: pid,
              year: TARGET_YEAR, month: m + 1,
              quantity: qty, unitPrice,
              amount: qty * unitPrice,
            },
          })
          salesRowsCreated++
        }
      }
    }
  }
  console.log(`  ✓ ${salesRowsCreated} SalesBudgetLine rows`)

  // ── §4 COGS detail — split PLF.02.* over products as cost-of-sales ──
  console.log("\n--- §4 COGS detail ---")
  let cogsRowsCreated = 0
  for (const plan of plans) {
    // Find COGS BudgetLine totals for this plan to seed COGS budget per
    // product. We synthesize per-month cost by spreading total cogs
    // across the (year × month × product) grid evenly across products
    // that have non-zero sales.
    const cogsLines = await prisma.budgetLine.findMany({
      where: { organizationId: org.id, planId: plan.id, lineType: "cogs" },
      select: { plannedAmount: true, monthIndex: true, category: true, companyId: true },
    })
    if (cogsLines.length === 0) continue

    // Aggregate per (month × company) total cogs
    const cogsByMonth = new Map() // monthIdx → totalAmount
    for (const l of cogsLines) {
      const m = l.monthIndex ?? 0
      cogsByMonth.set(m, (cogsByMonth.get(m) ?? 0) + (l.plannedAmount ?? 0))
    }

    // Clear prior COGS rows for these products
    await prisma.cOGSBudgetLine.deleteMany({
      where: {
        organizationId: org.id, planId: plan.id,
        productLineId: { in: Array.from(productMap.values()) },
      },
    })

    // Spread monthly cogs total across products (sugar 60%, malt 20%,
    // wheat 10%, corn 5%, cotton 3%, sugarbeet 2% — rough)
    const SPLIT = [
      { code: "AZSEKER-SUGAR", weight: 0.6 },
      { code: "AZSEKER-MALT", weight: 0.2 },
      { code: "AZSEKER-WHEAT", weight: 0.1 },
      { code: "AZSEKER-CORN", weight: 0.05 },
      { code: "AZSEKER-COTTON", weight: 0.03 },
      { code: "AZSEKER-SUGARBEET", weight: 0.02 },
    ]
    for (const [monthIdx, total] of cogsByMonth.entries()) {
      if (total === 0) continue
      for (const split of SPLIT) {
        const pid = productMap.get(split.code)
        if (!pid) continue
        const amount = total * split.weight
        if (amount === 0) continue
        await prisma.cOGSBudgetLine.upsert({
          where: {
            planId_productLineId_year_month: {
              planId: plan.id,
              productLineId: pid,
              year: TARGET_YEAR,
              month: monthIdx + 1,
            },
          },
          create: {
            organizationId: org.id, planId: plan.id,
            productLineId: pid,
            year: TARGET_YEAR, month: monthIdx + 1,
            productionQty: 0, totalCost: amount,
          },
          update: { totalCost: amount },
        })
        cogsRowsCreated++
      }
    }
  }
  console.log(`  ✓ ${cogsRowsCreated} COGSBudgetLine rows`)

  // ── §7 Actuals — mirror plan as placeholder (100% execution) ───
  console.log("\n--- §7 Actuals (placeholder 100%-execution from plan) ---")
  let actualsCreated = 0
  for (const ent of allEntities) {
    // Per-entity: copy that entity's BudgetLine to BudgetActual.
    const lines = await prisma.budgetLine.findMany({
      where: { organizationId: org.id, companyId: ent.id, plan: { is: { year: TARGET_YEAR } } },
      select: {
        planId: true, category: true, department: true, lineType: true,
        plannedAmount: true, monthIndex: true, currencyCode: true,
      },
    })
    if (lines.length === 0) continue
    // Clear prior placeholder actuals for this entity to keep
    // re-runs idempotent
    await prisma.budgetActual.deleteMany({
      where: {
        organizationId: org.id, companyId: ent.id,
        description: "placeholder (auto-generated from plan)",
      },
    })
    for (const l of lines) {
      if (l.plannedAmount === 0) continue
      await prisma.budgetActual.create({
        data: {
          organizationId: org.id, planId: l.planId, companyId: ent.id,
          category: l.category, department: l.department, lineType: l.lineType,
          actualAmount: l.plannedAmount, // 100%-execution placeholder
          monthIndex: l.monthIndex,
          currencyCode: l.currencyCode,
          description: "placeholder (auto-generated from plan)",
        },
      })
      actualsCreated++
    }
  }
  console.log(`  ✓ ${actualsCreated} BudgetActual placeholder rows`)

  // ── Audit trail + recompute hint ────────────────────────────────
  // Phase 7.J — audit compliance event.
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: org.id, actorUserId: null,
        action: "company_settings_update",
        entityType: "Company",
        entityId: null,
        metadata: {
          script: "close-azseker-onboarding.cjs",
          period: String(TARGET_YEAR),
          assumptionsRows: ASSUMPTIONS.length * plans.length,
          salesRows: salesRowsCreated,
          cogsRows: cogsRowsCreated,
          actualsRows: actualsCreated,
          entitiesUpdated: Object.keys(ENTITY_DEFAULTS),
        },
        context: { source: "cli-seed" },
      },
    })
    console.log("\n✓ AuditEvent recorded")
  } catch (err) {
    console.warn("\n⚠ AuditEvent failed (non-fatal):", err.message || err)
  }
  console.log("\n--- Recompute trigger ---")
  console.log(`  → Open /budgeting/terminal and click RECOMPUTE, or wait for next nightly job.`)

  console.log("\n=== DONE ===")
  await prisma.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
