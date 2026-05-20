/**
 * Phase 7.M Tier 3 (2026-05-19) — apply land registry from
 * Çıxarışların uçotu.xlsx onto Company.settings.landParcels for
 * AZSEKER-EDEN (Eden Agro LLC).
 *
 * Usage:
 *   npx tsx scripts/apply-azseker-land.ts
 *   npx tsx scripts/apply-azseker-land.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { parseLandRegistrySheet } from "@/lib/onboarding/adapters/azseker-land-registry"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const FILE =
  "/Users/rashadrahimov/Documents/budget azersheker/Çıxarışların uçotu.xlsx"
const ORG_SLUG = "azmade"
const SHEET = "Sheet1"
const TARGET_COMPANY = "AZSEKER-EDEN"

async function main(): Promise<number> {
  console.log(
    `\n=== Apply AzerSheker land registry${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
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
  const result = parseLandRegistrySheet(wb, SHEET, XLSX)

  console.log(`Parsed ${result.parcels.length} land parcels from ${SHEET}`)
  console.log(
    `Total: ${result.totalHectares.toFixed(2)} ha · ₼${result.totalAnnualRentAzn.toLocaleString(undefined, { maximumFractionDigits: 0 })}/year rent`,
  )
  if (result.warnings.length > 0) {
    console.warn(`Warnings (${result.warnings.length}):`)
    for (const w of result.warnings) console.warn(`  ⚠ ${w}`)
  }

  // Region breakdown
  const byRegion = new Map<string, { count: number; hectares: number }>()
  for (const p of result.parcels) {
    const region = p.region ?? "Unknown"
    const cur = byRegion.get(region) ?? { count: 0, hectares: 0 }
    cur.count++
    cur.hectares += p.hectares
    byRegion.set(region, cur)
  }
  console.log(`\n── Breakdown by region ──`)
  for (const [region, { count, hectares }] of byRegion.entries()) {
    console.log(
      `  ${region.padEnd(15)} ${count} parcels · ${hectares.toFixed(2)} ha`,
    )
  }

  const co = await prisma.company.findFirst({
    where: { organizationId: org.id, code: TARGET_COMPANY },
    select: { id: true, settings: true },
  })
  if (!co) {
    console.error(`✗ ${TARGET_COMPANY} not in DB`)
    return 1
  }

  const prevSettings = (co.settings ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = {
    ...prevSettings,
    landParcels: result.parcels,
    landTotalHectares: result.totalHectares,
    landTotalAnnualRentAzn: result.totalAnnualRentAzn,
    landRegistrySource: "azseker-cixarislari-2026-05-19",
  }

  if (!DRY_RUN) {
    await prisma.company.update({
      where: { id: co.id },
      data: { settings: merged as Prisma.InputJsonValue },
    })
    console.log(
      `\n✓ ${TARGET_COMPANY} updated with ${result.parcels.length} land parcels`,
    )
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
