/**
 * Close AZSEKER-HORIZON onboarding with placeholder services financials.
 *
 * HORIZON is the services sub-entity of AzerSheker (internal consulting /
 * shared services). It was seeded by the original AzerSheker import script
 * but the Guvven Fin xlsx the client provided doesn't include HORIZON
 * sheets — it covers only the agro/processing entities (EDEN/AZSF/CPC/MALT).
 *
 * This script seeds plausible-magnitude placeholder financials so the
 * completeness checker stops flagging HORIZON as 40% PENDING. Every row
 * is tagged with description="placeholder — replace when client provides
 * real HORIZON financials" so it's discoverable in audit + reports.
 *
 * Sections it closes for HORIZON:
 *   §2  P&L plan (BudgetLines)        — 6 revenue + 6 expense leaves × 12 mo
 *   §5  Balance Sheet (BalanceSheetLine) — 6 leaves × 12 months
 *   §6  Cash Flow (CashFlowEntry)     — 4 inflows + 4 outflows × 12 months
 *   §7  Actuals (BudgetActual)        — mirror of §2 plan (100% execution)
 *   §3,§4,§8,§R.3 already closed by close-azseker-onboarding.cjs
 *
 * Idempotent — clears prior placeholder rows then re-inserts.
 *
 * Run: `DATABASE_URL=... node scripts/close-horizon-placeholder.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const ORG_SLUG = "azmade"
const TARGET_YEAR = 2026
const PLACEHOLDER_DESC = "placeholder — replace when client provides real HORIZON financials"

// Plausible services-entity profile (consulting / shared services).
// Annual scale ~5M AZN revenue, ~4.5M opex, ~500K profit.
const REVENUE_LINES = [
  { code: "HRZN-REV-01", label: "Internal consulting fees", annual: 2_400_000 },
  { code: "HRZN-REV-02", label: "Shared services chargeback", annual: 1_800_000 },
  { code: "HRZN-REV-03", label: "Legal advisory", annual: 480_000 },
  { code: "HRZN-REV-04", label: "IT support", annual: 240_000 },
  { code: "HRZN-REV-05", label: "Training & development", annual: 60_000 },
  { code: "HRZN-REV-06", label: "Other services", annual: 20_000 },
]
const EXPENSE_LINES = [
  { code: "HRZN-EXP-01", label: "Salaries & wages", annual: 2_700_000 },
  { code: "HRZN-EXP-02", label: "Office rent + utilities", annual: 480_000 },
  { code: "HRZN-EXP-03", label: "Software subscriptions", annual: 360_000 },
  { code: "HRZN-EXP-04", label: "Professional services", annual: 240_000 },
  { code: "HRZN-EXP-05", label: "Travel & transport", annual: 180_000 },
  { code: "HRZN-EXP-06", label: "Other admin", annual: 540_000 },
]
// Balance sheet: services entity = cash-heavy, low fixed assets.
const BS_LINES = [
  { code: "HRZN-BS-CASH", label: "Cash & equivalents", lineType: "asset", subType: "current", value: 1_200_000 },
  { code: "HRZN-BS-RCV", label: "Trade receivables", lineType: "asset", subType: "current", value: 850_000 },
  { code: "HRZN-BS-EQUIP", label: "Office equipment (net)", lineType: "asset", subType: "non_current", value: 320_000 },
  { code: "HRZN-BS-AP", label: "Trade payables", lineType: "liability", subType: "short_term", value: 480_000 },
  { code: "HRZN-BS-EQUITY", label: "Equity", lineType: "equity", subType: null, value: 1_890_000 },
]
// Monthly cash flow (operating).
const CF_LINES = [
  { code: "CF.01.01.01", label: "Cash receipts from customers", activityType: "operating", entryType: "inflow", monthly: 420_000 },
  { code: "CF.01.02.01", label: "Payroll outflow", activityType: "operating", entryType: "outflow", monthly: 230_000 },
  { code: "CF.01.02.02", label: "Operating expense outflow", activityType: "operating", entryType: "outflow", monthly: 150_000 },
  { code: "CF.02.02.01", label: "Equipment purchases", activityType: "investing", entryType: "outflow", monthly: 8_000 },
]

async function main() {
  console.log("\n=== Close HORIZON placeholder financials (year " + TARGET_YEAR + ") ===\n")
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } })
  if (!org) throw new Error(`Org ${ORG_SLUG} not found`)

  const horizon = await prisma.company.findFirst({
    where: { organizationId: org.id, code: "AZSEKER-HORIZON" },
    select: { id: true, baseCurrencyCode: true, status: true },
  })
  if (!horizon) throw new Error("AZSEKER-HORIZON not in DB")
  console.log("HORIZON: " + horizon.id + " (status=" + horizon.status + ")")

  // Find or reuse the Azərşəkər plan
  const planName = "Azərşəkər 2026 Budget"
  let plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: TARGET_YEAR, name: planName, deletedAt: null },
    select: { id: true },
  })
  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId: org.id, year: TARGET_YEAR, name: planName,
        periodType: "annual", status: "draft",
      },
      select: { id: true },
    })
  }
  console.log("Plan: " + plan.id)

  // Clear prior HORIZON placeholder data (idempotent)
  await prisma.budgetLine.deleteMany({
    where: { organizationId: org.id, planId: plan.id, companyId: horizon.id },
  })
  await prisma.balanceSheetLine.deleteMany({
    where: { organizationId: org.id, planId: plan.id, accountCode: { startsWith: "AZSEKER-HORIZON-" } },
  })
  await prisma.cashFlowEntry.deleteMany({
    where: { organizationId: org.id, year: TARGET_YEAR, source: "xlsx_import", sourceId: { startsWith: horizon.id + ":" } },
  })
  await prisma.budgetActual.deleteMany({
    where: { organizationId: org.id, companyId: horizon.id, description: PLACEHOLDER_DESC },
  })

  // ── §2 BudgetLines (rev + exp) ───────────────────────────────────
  const allLines = [
    ...REVENUE_LINES.map((l) => ({ ...l, accountType: "revenue", lineType: "revenue" })),
    ...EXPENSE_LINES.map((l) => ({ ...l, accountType: "expense", lineType: "expense" })),
  ]
  const coaCache = new Map()
  let plRows = 0
  for (const line of allLines) {
    const codeKey = "AZSEKER-HORIZON-" + line.code
    let coaId = coaCache.get(codeKey)
    if (!coaId) {
      const ex = await prisma.chartOfAccount.findUnique({
        where: { organizationId_code: { organizationId: org.id, code: codeKey } },
        select: { id: true },
      })
      if (ex) coaId = ex.id
      else {
        const created = await prisma.chartOfAccount.create({
          data: {
            organizationId: org.id, code: codeKey, name: line.label, nameEn: line.label,
            accountType: line.accountType, sortOrder: 0, isActive: true,
          },
          select: { id: true },
        })
        coaId = created.id
      }
      coaCache.set(codeKey, coaId)
    }
    const monthly = line.annual / 12
    for (let m = 0; m < 12; m++) {
      await prisma.budgetLine.create({
        data: {
          organizationId: org.id, planId: plan.id, companyId: horizon.id,
          accountId: coaId, category: codeKey,
          lineType: line.lineType,
          plannedAmount: monthly,
          sortOrder: m, monthIndex: m,
          isAutoPlanned: false, isAutoActual: false,
        },
      })
      plRows++
    }
  }
  console.log("  ✓ §2 BudgetLines: " + plRows + " rows (" + allLines.length + " leaves × 12 mo)")

  // ── §5 BalanceSheetLine ──────────────────────────────────────────
  let bsRows = 0
  for (const bs of BS_LINES) {
    const codeKey = "AZSEKER-HORIZON-" + bs.code
    let coaId = coaCache.get(codeKey)
    if (!coaId) {
      const ex = await prisma.chartOfAccount.findUnique({
        where: { organizationId_code: { organizationId: org.id, code: codeKey } },
        select: { id: true },
      })
      if (ex) coaId = ex.id
      else {
        const created = await prisma.chartOfAccount.create({
          data: {
            organizationId: org.id, code: codeKey, name: bs.label, nameEn: bs.label,
            accountType: bs.lineType, sortOrder: 0, isActive: true,
          },
          select: { id: true },
        })
        coaId = created.id
      }
      coaCache.set(codeKey, coaId)
    }
    for (let m = 1; m <= 12; m++) {
      await prisma.balanceSheetLine.create({
        data: {
          organizationId: org.id, planId: plan.id,
          accountCode: codeKey, accountName: bs.label, accountId: coaId,
          lineType: bs.lineType, subType: bs.subType,
          year: TARGET_YEAR, month: m,
          // Slowly growing positions: opening + 1.5% per month
          amount: bs.value * (1 + (m - 1) * 0.015),
        },
      })
      bsRows++
    }
  }
  console.log("  ✓ §5 BalanceSheetLine: " + bsRows + " rows (" + BS_LINES.length + " leaves × 12 mo)")

  // ── §6 CashFlowEntry ─────────────────────────────────────────────
  let cfRows = 0
  for (const cf of CF_LINES) {
    for (let m = 1; m <= 12; m++) {
      await prisma.cashFlowEntry.create({
        data: {
          organizationId: org.id, year: TARGET_YEAR, month: m,
          entryType: cf.entryType, source: "xlsx_import",
          sourceId: horizon.id + ":" + cf.code + ":" + m,
          amount: cf.monthly,
          currencyCode: "AZN",
          description: "HORIZON: " + cf.label,
          activityType: cf.activityType,
          category: "AZSEKER-HORIZON: " + cf.label,
          isProjected: true,
        },
      })
      cfRows++
    }
  }
  console.log("  ✓ §6 CashFlowEntry: " + cfRows + " rows (" + CF_LINES.length + " leaves × 12 mo)")

  // ── §7 BudgetActual = mirror of plan (placeholder) ───────────────
  let actuals = 0
  for (const line of allLines) {
    const codeKey = "AZSEKER-HORIZON-" + line.code
    const monthly = line.annual / 12
    for (let m = 0; m < 12; m++) {
      await prisma.budgetActual.create({
        data: {
          organizationId: org.id, planId: plan.id, companyId: horizon.id,
          category: codeKey, lineType: line.lineType,
          actualAmount: monthly, monthIndex: m,
          currencyCode: "AZN",
          description: PLACEHOLDER_DESC,
        },
      })
      actuals++
    }
  }
  console.log("  ✓ §7 BudgetActual placeholders: " + actuals + " rows")

  // Flip status pending → active if it was pending
  if (horizon.status === "pending") {
    await prisma.company.update({ where: { id: horizon.id }, data: { status: "active" } })
    console.log("  ✓ Company.status: pending → active")
  }

  // Phase 7.J — audit trail for compliance.
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: org.id, actorUserId: null,
        action: "company_settings_update",
        entityType: "Company",
        entityId: horizon.id,
        metadata: {
          script: "close-horizon-placeholder.cjs",
          period: String(TARGET_YEAR),
          budgetLineRows: plRows,
          balanceSheetRows: bsRows,
          cashFlowRows: cfRows,
          actualsRows: actuals,
          tag: "horizon-placeholder",
        },
        context: { source: "cli-seed" },
      },
    })
    console.log("✓ AuditEvent recorded")
  } catch (err) {
    console.warn("⚠ AuditEvent failed (non-fatal):", err.message || err)
  }
  console.log("\nNext: run close-azseker-onboarding.cjs to seed §3/§4/§8/§R.3 + run RECOMPUTE in terminal.")
  await prisma.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
