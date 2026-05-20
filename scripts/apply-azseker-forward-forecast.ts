/**
 * Phase 7.M Tier 4 (2026-05-19) — apply forward forecast 2027-2035 from
 * "Farming strategy - Guvven.xlsx" İcmal sheet onto Company.settings.
 * Stored at organisation level (Org.settings.forwardForecast) because
 * the İcmal sheet is a consolidated holding view, not per-entity.
 *
 * Risk Terminal Panel + Board Deck Generator read this for "what does
 * the next 3-5 years look like" answers.
 *
 * Usage:
 *   npx tsx scripts/apply-azseker-forward-forecast.ts
 *   npx tsx scripts/apply-azseker-forward-forecast.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { parseIcmalSheet } from "@/lib/onboarding/adapters/azseker-farming-strategy"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const FILE =
  "/Users/rashadrahimov/Documents/budget azersheker/Farming strategy - Guvven.xlsx"
const ORG_SLUG = "azmade"
const SHEET = "İcmal"

async function main(): Promise<number> {
  console.log(
    `\n=== Apply AzerSheker forward forecast${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, settings: true },
  })
  if (!org) {
    console.error(`✗ Org slug=${ORG_SLUG} not found`)
    return 1
  }

  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false })
  const result = parseIcmalSheet(wb, SHEET, XLSX)
  console.log(
    `Parsed ${result.forecast.length} forecast years (terminal=${result.hasTerminalValue})`,
  )
  for (const w of result.warnings) console.warn(`  ⚠ ${w}`)

  if (result.forecast.length === 0) {
    console.warn(`Nothing to apply.`)
    return 0
  }

  console.log(`\n── Forecast summary ──`)
  for (const f of result.forecast) {
    const topBu = f.breakdown[0]?.businessUnit ?? "—"
    console.log(
      `  ${f.year}: ₼${(f.totalRevenueAzn / 1_000_000).toFixed(1)}M total · top BU "${topBu}" (${f.breakdown.length} BUs)`,
    )
  }

  const prevSettings = (org.settings ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = {
    ...prevSettings,
    forwardForecast: {
      source: "azseker-farming-strategy-2026-05-19",
      sheet: SHEET,
      hasTerminalValue: result.hasTerminalValue,
      years: result.forecast,
    },
  }

  if (!DRY_RUN) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { settings: merged as Prisma.InputJsonValue },
    })
    console.log(
      `\n✓ Org.settings.forwardForecast updated (${result.forecast.length} years)`,
    )
  }
  console.log(
    `\n=== ${DRY_RUN ? "DRY-RUN — no DB changes applied" : "DONE — Organization.settings updated"} ===\n`,
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
