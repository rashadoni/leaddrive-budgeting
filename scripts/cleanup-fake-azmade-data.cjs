/**
 * Cleanup fake/synthetic data created by seed-azmade-rich.ts +
 * seed-azmade-actuals.ts + seed-azmade-companies.ts.
 *
 * SAFE — preserves:
 *   - AZMADE org itself
 *   - Real companies (AAC, ATL, SPARK, ZTP, LLS + ATL children MRKZ/DBZ/PMZ/TAZ
 *     + *-MAIN level=2 children)
 *   - chart_of_accounts (real, from import-azmade-budgets.ts)
 *   - budget_lines (real, from import-azmade-budgets.ts)
 *   - currency_rates / indicator_definitions / industries / scenarios
 *
 * DELETES (for AZMADE org):
 *   - 30 fake AZ-* companies (and cascading bookings/operational_facts/budget_lines
 *     for those companies)
 *   - All sales_budget_lines / cogs_budget_lines / balance_sheet_lines
 *   - All cash_flow_entries (where source='plan' = seed-azmade-rich)
 *   - All budget_assumptions / sales_forecasts / expense_forecasts /
 *     rolling_forecast_months / budget_forecast_entries
 *   - All budget_actuals (Jan-Apr 2026 fakes from seed-azmade-actuals)
 *   - All budget_departments / budget_cost_types (seed-azmade-rich synthetic)
 *   - All product_lines (MHB / Lime burnt / etc — seed-azmade-rich synthetic)
 *
 * Also deletes the entire `demo` org if it exists (cascade clears all its data).
 *
 * USAGE:
 *   node scripts/cleanup-fake-azmade-data.cjs            # dry-run, shows counts
 *   node scripts/cleanup-fake-azmade-data.cjs --execute  # actually deletes
 *
 * Idempotent — re-running after --execute is a no-op.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const FAKE_AZ_PREFIX = "AZ-"
const DRY_RUN = !process.argv.includes("--execute")

async function main() {
  console.log(DRY_RUN ? "\n=== DRY-RUN (use --execute to actually delete) ===\n" : "\n=== EXECUTING DELETIONS ===\n")

  const azmade = await prisma.organization.findFirst({
    where: { slug: "azmade" },
    select: { id: true, name: true },
  })
  if (!azmade) {
    console.log("AZMADE org not found — nothing to clean.")
    return
  }
  console.log(`Target org: ${azmade.name} (${azmade.id})`)

  // 1) Identify fake AZ-* companies
  const fakeCompanies = await prisma.company.findMany({
    where: { organizationId: azmade.id, code: { startsWith: FAKE_AZ_PREFIX } },
    select: { id: true, code: true },
  })
  console.log(`\n--- Fake AZ-* companies (${fakeCompanies.length}) ---`)
  for (const c of fakeCompanies) console.log(`  ${c.code}`)

  // 2) Counts before deletion
  const tableTargets = [
    {
      name: "sales_budget_lines (synthetic)",
      count: () => prisma.salesBudgetLine.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.salesBudgetLine.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "cogs_budget_lines (synthetic)",
      count: () => prisma.cOGSBudgetLine.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.cOGSBudgetLine.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "balance_sheet_lines (synthetic)",
      count: () => prisma.balanceSheetLine.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.balanceSheetLine.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "cash_flow_entries (source='plan' = seed-azmade-rich)",
      count: () => prisma.cashFlowEntry.count({ where: { organizationId: azmade.id, source: "plan" } }),
      del: () => prisma.cashFlowEntry.deleteMany({ where: { organizationId: azmade.id, source: "plan" } }),
    },
    {
      name: "budget_assumptions (synthetic)",
      count: () => prisma.budgetAssumption.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.budgetAssumption.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "sales_forecasts (synthetic)",
      count: () => prisma.salesForecast.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.salesForecast.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "expense_forecasts (synthetic)",
      count: () => prisma.expenseForecast.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.expenseForecast.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "rolling_forecast_months (synthetic)",
      count: () => prisma.rollingForecastMonth.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.rollingForecastMonth.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "budget_forecast_entries (synthetic)",
      count: () => prisma.budgetForecastEntry.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.budgetForecastEntry.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "budget_actuals (Jan-Apr 2026 fakes from seed-azmade-actuals)",
      count: () => prisma.budgetActual.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.budgetActual.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "budget_departments (synthetic 11)",
      count: () => prisma.budgetDepartment.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.budgetDepartment.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "budget_cost_types (synthetic 13)",
      count: () => prisma.budgetCostType.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.budgetCostType.deleteMany({ where: { organizationId: azmade.id } }),
    },
    {
      name: "product_lines (MHB/Lime/Adhesive/U-block synthetic)",
      count: () => prisma.productLine.count({ where: { organizationId: azmade.id } }),
      del: () => prisma.productLine.deleteMany({ where: { organizationId: azmade.id } }),
    },
  ]

  console.log(`\n--- Per-table counts BEFORE ---`)
  for (const t of tableTargets) {
    const c = await t.count()
    console.log(`  ${t.name}: ${c}`)
  }

  // 3) Cash flow alerts (regenerated automatically; clear them too)
  const alertCount = await prisma.cashFlowAlert.count({ where: { organizationId: azmade.id } })
  console.log(`  cash_flow_alerts: ${alertCount}`)

  // 4) Demo org
  const demoOrg = await prisma.organization.findFirst({ where: { slug: "demo" } })
  if (demoOrg) {
    console.log(`\n--- Demo org found (will cascade-delete entirely) ---`)
    console.log(`  ${demoOrg.name} (${demoOrg.id})`)
  }

  if (DRY_RUN) {
    console.log(`\n=== DRY-RUN complete — re-run with --execute to delete ===`)
    await prisma.$disconnect()
    return
  }

  // EXECUTE
  console.log(`\n--- EXECUTING ---`)
  for (const t of tableTargets) {
    const r = await t.del()
    console.log(`  ${t.name}: deleted ${r.count}`)
  }
  const a = await prisma.cashFlowAlert.deleteMany({ where: { organizationId: azmade.id } })
  console.log(`  cash_flow_alerts: deleted ${a.count}`)

  // Delete fake companies (cascade clears their bookings / operational_facts /
  // budget_lines / indicator_values via FK onDelete: Cascade)
  if (fakeCompanies.length > 0) {
    const f = await prisma.company.deleteMany({
      where: { organizationId: azmade.id, code: { startsWith: FAKE_AZ_PREFIX } },
    })
    console.log(`  fake AZ-* companies: deleted ${f.count} (cascade clears child rows)`)
  }

  if (demoOrg) {
    const d = await prisma.organization.delete({ where: { id: demoOrg.id } })
    console.log(`  demo org: deleted (cascade clears all its data)`)
  }

  console.log(`\n=== DONE ===`)
  console.log(`Real data preserved: AAC / ATL / SPARK / ZTP / LLS + budget_lines + chart_of_accounts.`)
  console.log(`Empty tables (Cash Flow / Balance Sheet / Sales Budget / COGS / Forecasts / Actuals)`)
  console.log(`will need re-import from real xlsx files via the extended import path.`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
