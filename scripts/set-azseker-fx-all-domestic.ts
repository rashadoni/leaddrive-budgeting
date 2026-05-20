/**
 * Phase 7.M Tier 4 (2026-05-19) — set fxExposureSource="all_domestic"
 * on AZSEKER operating entities.
 *
 * Per Azik confirmation (2026-05-19 Telegram «цифры аз»), the entire
 * Guvven Fin.xlsx workbook is in AZN. No foreign-currency exposure
 * exists in current data. This script stamps Company.settings.fxExposureSource
 * = "all_domestic" so FX_IMPORTED_INPUT resolves to 0% green instead
 * of unknown.
 *
 * Re-runnable. If/when Azik confirms a particular entity DOES have FX
 * exposure (e.g. imported equipment in USD), remove the entry from
 * ALL_DOMESTIC_CODES + re-run.
 *
 * Usage:
 *   npx tsx scripts/set-azseker-fx-all-domestic.ts             # apply
 *   npx tsx scripts/set-azseker-fx-all-domestic.ts --dry-run   # preview
 */
import { PrismaClient, Prisma } from "@prisma/client"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const ORG_SLUG = "azmade"

const ALL_DOMESTIC_CODES = [
  "AZSEKER-AZSF",
  "AZSEKER-CPC",
  "AZSEKER-EDEN",
  "AZSEKER-MALT",
  "AZSEKER-PROMALT",
  "AZSEKER-HORIZON",
]

async function main(): Promise<number> {
  console.log(
    `\n=== Set fxExposureSource=all_domestic${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true },
  })
  if (!org) {
    console.error(`✗ Org slug=${ORG_SLUG} not found`)
    return 1
  }
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: ALL_DOMESTIC_CODES } },
    select: { id: true, code: true, settings: true },
    orderBy: { code: "asc" },
  })
  console.log(
    `Found ${companies.length}/${ALL_DOMESTIC_CODES.length} target companies\n`,
  )
  for (const c of companies) {
    const prevSettings = (c.settings ?? {}) as Record<string, unknown>
    const wasSet = prevSettings.fxExposureSource === "all_domestic"
    const merged: Record<string, unknown> = {
      ...prevSettings,
      fxExposureSource: "all_domestic",
    }
    console.log(
      `  ${wasSet ? "↪" : "✓"} ${c.code.padEnd(20)} ${wasSet ? "(already set)" : "set fxExposureSource = all_domestic"}`,
    )
    if (!DRY_RUN && !wasSet) {
      await prisma.company.update({
        where: { id: c.id },
        data: { settings: merged as Prisma.InputJsonValue },
      })
    }
  }
  console.log(
    `\n=== ${DRY_RUN ? "DRY-RUN" : "DONE"} ===\n`,
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
