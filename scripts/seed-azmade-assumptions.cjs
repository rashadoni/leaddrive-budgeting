/**
 * Phase 7.G CXLIV — seed REAL AZ macro/tax assumptions for AZMADE org.
 *
 * NOT fake. These are publicly-available factual values:
 * - USD/AZN 1.7   — Central Bank of Azerbaijan official peg since 2017
 * - EUR/AZN 1.85  — derived from USD-peg + ECB EUR/USD rate
 * - RUB/AZN 0.018 — CBAR official rate range 2026
 * - Profit Tax 20% — AZ Tax Code Article 105 (corporate income tax)
 * - VAT 18% — AZ Tax Code Article 174
 * - Social tax 22% — State Social Protection Fund employer rate
 * - CPI target 4% — CBAR inflation target 2026
 *
 * Without these, the indicator recompute pipeline can't compute FX-exposure
 * indicators, tax-related indicators, or inflation-adjusted comparisons →
 * Risk Terminal HeatMap shows empty cells.
 *
 * Run: `node scripts/seed-azmade-assumptions.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const ASSUMPTIONS = [
  { category: "fx",        key: "usd_azn_rate",     label: "USD/AZN məzənnəsi",      value: 1.70,    unit: "AZN/USD", notes: "CBAR rəsmi məzənnə (peg since 2017)" },
  { category: "fx",        key: "eur_azn_rate",     label: "EUR/AZN məzənnəsi",      value: 1.85,    unit: "AZN/EUR", notes: "USD peg + ECB EUR/USD cross-rate" },
  { category: "fx",        key: "rub_azn_rate",     label: "RUB/AZN məzənnəsi",      value: 0.018,   unit: "AZN/RUB", notes: "CBAR average range 2026" },
  { category: "tax",       key: "profit_tax_rate",  label: "Mənfəət vergisi",        value: 20,      unit: "%",       notes: "AZ Vergi Məcəlləsi maddə 105" },
  { category: "tax",       key: "vat_rate",         label: "ƏDV dərəcəsi",           value: 18,      unit: "%",       notes: "AZ Vergi Məcəlləsi maddə 174" },
  { category: "tax",       key: "social_tax_rate",  label: "Sosial sığorta dərəcəsi",value: 22,      unit: "%",       notes: "DSMF işəgötürən payı" },
  { category: "inflation", key: "cpi_target",       label: "İllik inflyasiya hədəfi",value: 4,       unit: "%",       notes: "CBAR proqnozu 2026" },
]

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("AZMADE org not found")

  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: 2026, deletedAt: null, name: { startsWith: "AZMADE" } },
    select: { id: true, name: true },
  })
  if (!plan) throw new Error("AZMADE 2026 plan not found")
  console.log(`\n=== Seeding real AZ assumptions for ${plan.name} ===\n`)

  let created = 0, updated = 0
  for (const a of ASSUMPTIONS) {
    const existing = await prisma.budgetAssumption.findFirst({
      where: { organizationId: org.id, planId: plan.id, key: a.key },
      select: { id: true },
    })
    if (existing) {
      await prisma.budgetAssumption.update({
        where: { id: existing.id },
        data: { label: a.label, value: a.value, unit: a.unit, notes: a.notes, category: a.category },
      })
      updated++
    } else {
      await prisma.budgetAssumption.create({
        data: { organizationId: org.id, planId: plan.id, ...a },
      })
      created++
    }
  }
  console.log(`Assumptions: ${created} created, ${updated} updated`)
  console.log(`\n=== DONE ===`)
  console.log(`Now run recompute: POST /api/indicators (or click ПЕРЕРАСЧЁТ in Risk Terminal).`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
