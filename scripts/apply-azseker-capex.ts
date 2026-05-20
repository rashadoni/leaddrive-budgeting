/**
 * Phase 7.M Tier 3 (2026-05-19) — apply CAPEX_Farm + CAPEX_CPC sheets
 * from the new Guvven Fin.xlsx onto Company.settings.capexInitiatives.
 *
 * Stored as JSON array (no DB schema change). Each entity gets its own
 * list, summing to its planned 2026 CAPEX spend. Risk Terminal Panel +
 * Board Deck Generator read this for the "major initiatives" section.
 *
 * Usage:
 *   npx tsx scripts/apply-azseker-capex.ts
 *   npx tsx scripts/apply-azseker-capex.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { parseCapexSheets } from "@/lib/onboarding/adapters/azseker-workbook-capex"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const FILE =
  "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const ORG_SLUG = "azmade"

async function main(): Promise<number> {
  console.log(
    `\n=== Apply AzerSheker CAPEX initiatives${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Organization slug="${ORG_SLUG}" not found`)
    return 1
  }

  const wb = XLSX.readFile(FILE, {
    cellFormula: false,
    cellHTML: false,
  })
  const result = parseCapexSheets(wb, XLSX)
  console.log(
    `Parsed ${result.initiatives.length} initiatives from CAPEX_Farm + CAPEX_CPC`,
  )
  if (result.warnings.length > 0) {
    console.warn(`Warnings (${result.warnings.length}):`)
    for (const w of result.warnings.slice(0, 10)) console.warn(`  ⚠ ${w}`)
    if (result.warnings.length > 10)
      console.warn(`  ... +${result.warnings.length - 10} more`)
  }

  // Group by company
  const byCompany = new Map<string, typeof result.initiatives>()
  for (const ini of result.initiatives) {
    if (!byCompany.has(ini.companyCode)) byCompany.set(ini.companyCode, [])
    byCompany.get(ini.companyCode)!.push(ini)
  }

  console.log(`\n── Breakdown by entity ──`)
  for (const [code, items] of byCompany.entries()) {
    const total = items.reduce((s, i) => s + i.amountAzn, 0)
    const capexCount = items.filter((i) => i.initiativeType === "CAPEX").length
    const opexCount = items.filter((i) => i.initiativeType === "OPEX").length
    console.log(
      `  ${code.padEnd(20)} ${items.length} items (${capexCount} CAPEX + ${opexCount} OPEX) · ₼${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    )
  }

  console.log(`\n── Applying to Company.settings ──`)
  for (const [code, items] of byCompany.entries()) {
    const co = await prisma.company.findFirst({
      where: { organizationId: org.id, code },
      select: { id: true, settings: true },
    })
    if (!co) {
      console.warn(`  ⚠ ${code} not in DB — skipping`)
      continue
    }
    const prevSettings = (co.settings ?? {}) as Record<string, unknown>
    const merged: Record<string, unknown> = {
      ...prevSettings,
      capexInitiatives: items.map((i) => ({
        description: i.description,
        amountAzn: i.amountAzn,
        quantity: i.quantity,
        type: i.initiativeType,
        category: i.category,
        financingSource: i.financingSource,
        cfCode: i.cfCode,
        plfCode: i.plfCode,
        currency: i.currency,
        costCentre: i.costCentre,
      })),
      capexInitiativesSource: "azseker-workbook-2026-05-19",
      capexInitiativesYear: 2026,
      capexTotalAzn: items.reduce((s, i) => s + i.amountAzn, 0),
    }
    if (!DRY_RUN) {
      await prisma.company.update({
        where: { id: co.id },
        data: { settings: merged as Prisma.InputJsonValue },
      })
    }
    console.log(`  ✓ ${code.padEnd(20)} ${items.length} initiatives written`)
  }

  console.log(
    `\n=== ${DRY_RUN ? "DRY-RUN — no DB changes applied" : "DONE — Company.settings updated"} ===\n`,
  )
  return 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(2)
  })
