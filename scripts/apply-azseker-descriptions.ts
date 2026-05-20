/**
 * Phase 7.M Tier 3 (2026-05-19) — apply Təsvir strategic descriptions
 * from the new Guvven Fin.xlsx onto Company.settings.strategicDescription.
 *
 * Idempotent: re-running rewrites the same field; safe to re-run after
 * Azik updates the workbook.
 *
 * Usage:
 *   npx tsx scripts/apply-azseker-descriptions.ts
 *   npx tsx scripts/apply-azseker-descriptions.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { parseTesvirSheet } from "@/lib/onboarding/adapters/azseker-workbook-descriptions"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const FILE =
  "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const ORG_SLUG = "azmade"
const SHEET = "Təsvir"

async function main(): Promise<number> {
  console.log(
    `\n=== Apply AzerSheker strategic descriptions${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Organization slug="${ORG_SLUG}" not found`)
    return 1
  }
  console.log(`Org: ${org.name}\n`)

  const wb = XLSX.readFile(FILE, {
    cellFormula: false,
    cellHTML: false,
  })
  const result = parseTesvirSheet(wb, SHEET, XLSX)
  console.log(
    `Parsed ${result.descriptions.length} entity descriptions from "${SHEET}":`,
  )
  for (const w of result.warnings) console.warn(`  ⚠ ${w}`)

  if (result.descriptions.length === 0) {
    console.warn(`Nothing to apply.`)
    return 0
  }

  for (const desc of result.descriptions) {
    const co = await prisma.company.findFirst({
      where: { organizationId: org.id, code: desc.companyCode },
      select: { id: true, name: true, settings: true },
    })
    if (!co) {
      console.warn(
        `  ⚠ ${desc.companyCode} not in DB — skipping (run sync-azseker-entities first?)`,
      )
      continue
    }
    const prevSettings = (co.settings ?? {}) as Record<string, unknown>
    const merged: Record<string, unknown> = {
      ...prevSettings,
      strategicDescription: desc.description,
      competitiveAdvantage: desc.competitiveAdvantage,
      strategicNarrative: desc.fullText,
      strategicDescriptionSource: "azseker-workbook-tesvir-2026-05-19",
    }
    console.log(
      `  ✓ ${desc.companyCode.padEnd(20)} ${desc.entityLabel.padEnd(15)} — ${desc.description.slice(0, 70)}...`,
    )
    if (!DRY_RUN) {
      await prisma.company.update({
        where: { id: co.id },
        data: { settings: merged as Prisma.InputJsonValue },
      })
    }
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
