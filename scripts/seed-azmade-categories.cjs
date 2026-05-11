/**
 * Phase 7.G CXLIII — seed AZMADE categorical metadata (cost_types +
 * departments) WITHOUT fake transactional data.
 *
 * These are NOT fake numbers — they're standard accounting categories
 * for AZ industrial holdings (mapping to 7xx OpEx accounts that already
 * exist in client's chart_of_accounts from real xlsx import). CFO can
 * edit/extend via Settings UI; these are sensible defaults that make the
 * Workspace matrix view functional out of the box.
 *
 * Distinct from disabled seed-azmade-rich.disabled.ts which created
 * categories TOGETHER WITH thousands of synthetic budget rows. This one
 * creates ONLY the categories (no rows), so the Workspace "Generate
 * Matrix" button works without showing the "No cost types configured"
 * error.
 *
 * Idempotent: upsert by (orgId, key).
 *
 * Run: `node scripts/seed-azmade-categories.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const DEPARTMENTS = [
  { key: "production", label: "İstehsalat (Production)", hasRevenue: false, sortOrder: 1 },
  { key: "sales", label: "Satış və marketinq (Sales & Marketing)", hasRevenue: true, sortOrder: 2 },
  { key: "admin", label: "İnzibati (Administrative)", hasRevenue: false, sortOrder: 3 },
  { key: "finance", label: "Maliyyə (Finance)", hasRevenue: false, sortOrder: 4 },
  { key: "logistics", label: "Logistika (Logistics)", hasRevenue: false, sortOrder: 5 },
]

// Cost types map to real AZ-industrial CoA prefixes (711-xx materials,
// 721-xx staff, 731-xx utilities, 741-xx maintenance, 751-xx D&A, etc.)
const COST_TYPES = [
  { key: "staff", label: "İşçi heyəti xərcləri (Staff costs)", isShared: false, sortOrder: 1 },
  { key: "utilities", label: "Kommunal xərclər (Utilities)", isShared: false, sortOrder: 2 },
  { key: "services", label: "Alınmış xidmətlər (Services)", isShared: false, sortOrder: 3 },
  { key: "communication", label: "Rabitə xərcləri (Communication)", isShared: false, sortOrder: 4 },
  { key: "maintenance", label: "Təmir-istismar xərcləri (Maintenance)", isShared: false, sortOrder: 5 },
  { key: "materials", label: "Mal-materiallar (Materials)", isShared: false, sortOrder: 6 },
  { key: "transport", label: "Nəqliyyat xərcləri (Transport)", isShared: false, sortOrder: 7 },
  { key: "marketing", label: "Marketinq xərcləri (Marketing)", isShared: false, sortOrder: 8 },
  { key: "finance_cost", label: "Maliyyə xərcləri (Finance costs)", isShared: false, sortOrder: 9 },
  { key: "depreciation", label: "Amortizasiya (Depreciation)", isShared: false, sortOrder: 10 },
  { key: "tax", label: "Vergilər (Taxes)", isShared: false, sortOrder: 11 },
  { key: "other", label: "Digər xərclər (Other expenses)", isShared: false, sortOrder: 12 },
]

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error('AZMADE org not found')
  console.log(`\n=== Seeding categorical metadata for AZMADE ===\n`)

  let dCreated = 0, dUpdated = 0, ctCreated = 0, ctUpdated = 0
  for (const d of DEPARTMENTS) {
    const existing = await prisma.budgetDepartment.findFirst({
      where: { organizationId: org.id, key: d.key },
      select: { id: true },
    })
    if (existing) {
      await prisma.budgetDepartment.update({
        where: { id: existing.id },
        data: { label: d.label, hasRevenue: d.hasRevenue, sortOrder: d.sortOrder, isActive: true },
      })
      dUpdated++
    } else {
      await prisma.budgetDepartment.create({
        data: { organizationId: org.id, ...d, isActive: true },
      })
      dCreated++
    }
  }
  console.log(`Departments: ${dCreated} created, ${dUpdated} updated (total ${DEPARTMENTS.length})`)

  for (const ct of COST_TYPES) {
    const existing = await prisma.budgetCostType.findFirst({
      where: { organizationId: org.id, key: ct.key },
      select: { id: true },
    })
    if (existing) {
      await prisma.budgetCostType.update({
        where: { id: existing.id },
        data: { label: ct.label, isShared: ct.isShared, sortOrder: ct.sortOrder, isActive: true },
      })
      ctUpdated++
    } else {
      await prisma.budgetCostType.create({
        data: { organizationId: org.id, ...ct, isActive: true },
      })
      ctCreated++
    }
  }
  console.log(`Cost Types: ${ctCreated} created, ${ctUpdated} updated (total ${COST_TYPES.length})`)
  console.log(`\n=== DONE ===`)
  console.log(`Workspace "Generate Matrix" button should now work.`)
  console.log(`CFO can edit/add via /budgeting?tab=config UI.`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
