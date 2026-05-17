/**
 * Phase 7.J — extend AzerSheker §3 Sales budget with Production +
 * Promalt sales plans from the Guvven Fin xlsx.
 *
 * The base `close-azseker-onboarding.cjs` only parsed the "Farming
 * Budget sales plan" sheet (4 row-crop products). This script picks
 * up the two remaining sales-plan sheets:
 *
 *   - Production Budget sales plan  (CPC — 12 product variants:
 *     Glucose G40 / Fructose F42 / Cornstarch / Maltose / packed
 *     vs. weighed, domestic vs export). Row layout:
 *       R2 header: "For PLF | Group | Location | For PL | Production
 *                   step 3 | Product (step 4) | New name | Product
 *                   (Sales) | <blank> | <12 monthly dates>"
 *       R3+: product rows with monthly volumes (col 9..20)
 *
 *   - Satış ProMalt  (MALT — per-customer per-month qty + AZN).
 *     Row layout:
 *       R2 header: "Alıcı (MALT arpası) | Qiymət TON/AZN | Yanvar |
 *                   blank | Fevral | blank | …" (12 months × 2 sub-
 *                   columns: qty + value)
 *       R4+: customer rows (Müştəri 1 / 2 / 3 …) with monthly qty +
 *            AZN cells.
 *
 * Strategy:
 *   - Add 12 new ProductLine rows (Glucose / Fructose / Cornstarch /
 *     Maltose / Malt — domestic and export variants).
 *   - For Production sales: 1 row × 12 months per product.
 *   - For Promalt sales: aggregate across customers per month (1
 *     SalesBudgetLine per (month × MALT_PRODUCT)).
 *
 * Idempotent — clear & re-insert per (plan × productLine) before
 * writing.
 *
 * Run: `DATABASE_URL=... node scripts/close-azseker-sales.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const XLSX = require("xlsx")
const prisma = new PrismaClient()

const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Copy of Guvven Fin.xlsx"
const ORG_SLUG = "azmade"
const TARGET_YEAR = 2026

// Production sales plan products. Maps Production Budget sales plan
// "For PL" (col 4) + "Product (Sales)" (col 8) → canonical product line.
const PRODUCTION_PRODUCTS = [
  { code: "CPC-GLUCOSE-G40-DOM", name: "Glucose G40 (domestic)", unit: "ton", forPL: /^glucose$/i, productNames: [/qlükoza-g40/i] },
  { code: "CPC-GLUCOSE-G40-EXP", name: "Glucose G40 (export)", unit: "ton", forPL: /export.*glucose|glucose.*export/i, productNames: [/qlükoza-g40/i] },
  { code: "CPC-GLUCOSE-G40-LIQ", name: "Glucose G-40 liquid acid-hydrolysed", unit: "ton", forPL: /^glucose$/i, productNames: [/qlükoza\s*-?40.*turşulu/i] },
  { code: "CPC-MALTOSE-M50", name: "Maltose syrup M-50", unit: "ton", forPL: /^glucose$/i, productNames: [/maltoza siropu/i] },
  { code: "CPC-FRUCTOSE-F42-DOM", name: "Fructose F-42 (domestic)", unit: "ton", forPL: /^fructose$/i, productNames: [/fruktoza f-42/i] },
  { code: "CPC-FRUCTOSE-F42-EXP", name: "Fructose F-42 (export)", unit: "ton", forPL: /fructose.*export|export.*fructose/i, productNames: [/fruktoza f-42/i] },
  { code: "CPC-CORNSTARCH-DOM", name: "Corn starch 25kg (domestic)", unit: "ton", forPL: /corn starch$/i, productNames: [/nişasta adi/i] },
  { code: "CPC-CORNSTARCH-EXP", name: "Corn starch 25kg (export)", unit: "ton", forPL: /corn starch.*export/i, productNames: [/nişasta adi/i] },
  { code: "CPC-CORNSTARCH-OX-DOM", name: "Oxidized starch (domestic)", unit: "ton", forPL: /corn starch$/i, productNames: [/nişasta oksidləşmiş/i] },
  { code: "CPC-CORNSTARCH-OX-EXP", name: "Oxidized starch (export)", unit: "ton", forPL: /corn starch.*export/i, productNames: [/nişasta oksidləşmiş/i] },
  { code: "CPC-BYPRODUCT-BRAN", name: "Corn bran (by-product)", unit: "ton", forPL: /byproduct/i, productNames: [/qarğıdalı kəpəyi/i] },
  { code: "CPC-BYPRODUCT-GERM", name: "Corn germ (by-product)", unit: "ton", forPL: /byproduct/i, productNames: [/qarğıdalı özəyi/i] },
  { code: "CPC-BYPRODUCT-GLUTEN", name: "Corn gluten (by-product)", unit: "ton", forPL: /byproduct/i, productNames: [/qlüten/i] },
]

const MALT_SALES_PRODUCT = { code: "AZSEKER-MALT", name: "Malt", unit: "ton" }

async function ensureProductLines(orgId, defs) {
  const map = new Map()
  for (const d of defs) {
    const ex = await prisma.productLine.findFirst({
      where: { organizationId: orgId, code: d.code },
      select: { id: true },
    })
    if (ex) { map.set(d.code, ex.id); continue }
    const created = await prisma.productLine.create({
      data: { organizationId: orgId, code: d.code, name: d.name, unit: d.unit, isActive: true },
      select: { id: true },
    })
    map.set(d.code, created.id)
  }
  return map
}

function isValidNumber(v) { return typeof v === "number" && Number.isFinite(v) }

async function main() {
  console.log("\n=== AzerSheker extra-sales adapters (year " + TARGET_YEAR + ") ===\n")
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } })
  if (!org) throw new Error(`Org ${ORG_SLUG} not found`)

  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: false })

  // Find AzerSheker plans (year=2026 with BudgetLines for AZSEKER entities)
  const azsekerCompanies = await prisma.company.findMany({
    where: { organizationId: org.id, OR: [{ code: { startsWith: "AZSEKER" } }, { code: "AZSEKER" }] },
    select: { id: true },
  })
  const plans = await prisma.budgetPlan.findMany({
    where: {
      organizationId: org.id, year: TARGET_YEAR, deletedAt: null,
      lines: { some: { companyId: { in: azsekerCompanies.map((c) => c.id) } } },
    },
    select: { id: true, name: true },
  })
  console.log("Plans:", plans.map((p) => p.name).join(", "))

  // ──────────────── Production Budget sales plan ────────────────
  console.log("\n--- Production Budget sales plan ---")
  const allDefs = [...PRODUCTION_PRODUCTS, MALT_SALES_PRODUCT]
  const productMap = await ensureProductLines(org.id, allDefs)
  const sh = wb.Sheets["Production Budget sales plan"]
  if (!sh) {
    console.log("  ⚠ sheet not found")
  } else {
    const aoa = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, blankrows: false })
    // R2 = header with 12 monthly dates starting at col 9 (J).
    const headerRow = aoa[1] || []
    const monthCols = []
    for (let c = 0; c < headerRow.length && monthCols.length < 12; c++) {
      const v = headerRow[c]
      if (typeof v === "number" && v > 44000 && v < 48000) {
        const d = new Date((v - 25569) * 86400 * 1000)
        if (d.getUTCFullYear() === TARGET_YEAR) monthCols.push(c)
      }
    }
    if (monthCols.length < 12) {
      console.log("  ⚠ couldn't find 12 monthly cols for " + TARGET_YEAR + " (found " + monthCols.length + ")")
    } else {
      let totalRows = 0
      for (const plan of plans) {
        const ids = PRODUCTION_PRODUCTS.map((p) => productMap.get(p.code)).filter(Boolean)
        await prisma.salesBudgetLine.deleteMany({
          where: { organizationId: org.id, planId: plan.id, productLineId: { in: ids } },
        })
        // Pre-aggregate across rows since multiple sheet rows may match
        // the same product (e.g. "weighed" + "packed" variants both
        // map to Glucose G40). Schema has UNIQUE
        // (planId × productLineId × year × month) so duplicate inserts
        // throw. Aggregation step keeps the data faithful + writeable.
        const agg = new Map() // productCode → [12]qty
        for (let r = 2; r < aoa.length; r++) {
          const row = aoa[r] || []
          const forPL = typeof row[3] === "string" ? row[3] : ""
          const productSales = typeof row[7] === "string" ? row[7] : ""
          if (!forPL && !productSales) continue
          let matchedProduct = null
          for (const pd of PRODUCTION_PRODUCTS) {
            const plMatch = pd.forPL.test(forPL)
            const pMatch = pd.productNames.some((re) => re.test(productSales))
            if (plMatch && pMatch) { matchedProduct = pd; break }
          }
          if (!matchedProduct) continue
          let qtyArr = agg.get(matchedProduct.code)
          if (!qtyArr) { qtyArr = Array(12).fill(0); agg.set(matchedProduct.code, qtyArr) }
          for (let m = 0; m < 12; m++) {
            const qty = row[monthCols[m]]
            if (isValidNumber(qty)) qtyArr[m] += qty
          }
        }
        // Write aggregated rows
        for (const [code, qtyArr] of agg.entries()) {
          const pid = productMap.get(code)
          if (!pid) continue
          for (let m = 0; m < 12; m++) {
            if (qtyArr[m] === 0) continue
            await prisma.salesBudgetLine.create({
              data: {
                organizationId: org.id, planId: plan.id, productLineId: pid,
                year: TARGET_YEAR, month: m + 1,
                quantity: qtyArr[m],
                unitPrice: 0, amount: 0,
              },
            })
            totalRows++
          }
        }
      }
      console.log("  ✓ " + totalRows + " SalesBudgetLine rows for Production CPC products")
    }
  }

  // ──────────────── Satış ProMalt ────────────────
  console.log("\n--- Satış ProMalt ---")
  const malt = wb.Sheets["Satış ProMalt"]
  if (!malt) {
    console.log("  ⚠ sheet not found")
  } else {
    const aoa = XLSX.utils.sheet_to_json(malt, { header: 1, raw: true, blankrows: false })
    // R2: "Alıcı | Qiymət | YANVAR | <blank> | FEVRAL | <blank> | …"
    // R3: subheader "Miqdar | Məbləğ | Miqdar | Məbləğ …"
    // R4+: customer rows.
    // Monthly Miqdar cols start at index 2, step 2 (col 2, 4, 6, …, 24).
    const qtyCols = []
    const valCols = []
    for (let m = 0; m < 12; m++) {
      qtyCols.push(2 + m * 2)
      valCols.push(3 + m * 2)
    }
    let totalRows = 0
    for (const plan of plans) {
      const pid = productMap.get(MALT_SALES_PRODUCT.code)
      // Clear MALT product rows for plan
      await prisma.salesBudgetLine.deleteMany({
        where: { organizationId: org.id, planId: plan.id, productLineId: pid },
      })
      // Aggregate across customers per month
      const aggQty = Array(12).fill(0)
      const aggVal = Array(12).fill(0)
      for (let r = 3; r < aoa.length; r++) {
        const row = aoa[r] || []
        const buyer = row[0]
        if (typeof buyer !== "string" || buyer.trim() === "") continue
        for (let m = 0; m < 12; m++) {
          const q = row[qtyCols[m]]
          const v = row[valCols[m]]
          if (isValidNumber(q)) aggQty[m] += q
          if (isValidNumber(v)) aggVal[m] += v
        }
      }
      for (let m = 0; m < 12; m++) {
        if (aggQty[m] === 0 && aggVal[m] === 0) continue
        const unitPrice = aggQty[m] > 0 ? aggVal[m] / aggQty[m] : 0
        await prisma.salesBudgetLine.create({
          data: {
            organizationId: org.id, planId: plan.id, productLineId: pid,
            year: TARGET_YEAR, month: m + 1,
            quantity: aggQty[m],
            unitPrice,
            amount: aggVal[m],
          },
        })
        totalRows++
      }
    }
    console.log("  ✓ " + totalRows + " SalesBudgetLine rows for MALT (aggregated across customers)")
  }

  // Phase 7.J — audit trail.
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: org.id, actorUserId: null,
        action: "company_settings_update",
        entityType: "SalesBudgetLine",
        entityId: null,
        metadata: {
          script: "close-azseker-sales.cjs",
          period: String(TARGET_YEAR),
          productLines: allDefs.length,
        },
        context: { source: "cli-seed" },
      },
    })
    console.log("✓ AuditEvent recorded")
  } catch (err) {
    console.warn("⚠ AuditEvent failed (non-fatal):", err.message || err)
  }
  console.log("\n=== DONE ===")
  await prisma.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
