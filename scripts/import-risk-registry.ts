/**
 * Import risk registry from "Top risk - EDEN AGRO MMC.xlsx" into
 * Company.settings.riskRegistry for AZSEKER-EDEN.
 *
 * Idempotent: safe to re-run after Azik sends updated file.
 * When risk registries for AZSF/CPC/MALT arrive, the file should gain
 * a company-code column or separate sheets; update ENTITY_MAP accordingly.
 *
 * Usage:
 *   npx tsx scripts/import-risk-registry.ts
 *   npx tsx scripts/import-risk-registry.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import path from "path"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")

const FILE = path.join(
  "/Users/rashadrahimov/Documents/budget azersheker",
  "Top risk - EDEN AGRO MMC.xlsx",
)

// Current file covers only EDEN. Extend when additional company sheets arrive.
const ENTITY_MAP: Record<string, string> = {
  Azerseker: "AZSEKER-EDEN",
}

export interface RiskItem {
  level1: string
  level2: string
  level3: string
  kri: string
  criticality: number
  description: string
  note?: string
}

function parseRiskSheet(ws: XLSX.WorkSheet): RiskItem[] {
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  })

  const items: RiskItem[] = []
  // row 0 = header, data starts at row 1
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i]
    const level1 = typeof row[0] === "string" ? row[0].trim() : null
    const level2 = typeof row[1] === "string" ? row[1].trim() : null
    const level3 = typeof row[2] === "string" ? row[2].trim() : null
    const kri = typeof row[3] === "string" ? row[3].trim() : null
    const criticality = typeof row[4] === "number" ? row[4] : 1
    const description = typeof row[5] === "string" ? row[5].trim() : null
    const note = typeof row[6] === "string" ? row[6].trim() : undefined

    if (!level1 || !level2 || !level3 || !kri) continue

    items.push({
      level1,
      level2,
      level3,
      kri,
      criticality,
      description: description ?? "",
      ...(note ? { note } : {}),
    })
  }
  return items
}

async function main(): Promise<void> {
  console.log(`\n=== Import Risk Registry${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`)

  const org = await prisma.organization.findFirst({
    where: { slug: "azmade" },
    select: { id: true, name: true },
  })
  if (!org) throw new Error('Organization slug="azmade" not found')
  console.log(`Org: ${org.name}`)

  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false })
  console.log(`File: ${FILE}`)
  console.log(`Sheets: ${wb.SheetNames.join(", ")}\n`)

  let applied = 0

  for (const sheetName of wb.SheetNames) {
    const companyCode = ENTITY_MAP[sheetName]
    if (!companyCode) {
      console.log(`  Sheet "${sheetName}": no entity mapping — skipping`)
      continue
    }

    const items = parseRiskSheet(wb.Sheets[sheetName])
    if (items.length === 0) {
      console.warn(`  ${companyCode}: no valid risk rows parsed — skipping`)
      continue
    }

    console.log(`  ${companyCode}: ${items.length} risks parsed`)
    for (const r of items) {
      console.log(`    [${r.criticality}] ${r.level1} / ${r.level2} / ${r.level3}`)
    }

    if (DRY_RUN) {
      console.log(`    (dry-run) would write riskRegistry[${items.length}] to settings`)
      continue
    }

    const company = await prisma.company.findFirst({
      where: { organizationId: org.id, code: companyCode },
      select: { id: true, name: true, settings: true },
    })
    if (!company) {
      console.warn(`  ✗ ${companyCode} not in DB — skipping`)
      continue
    }

    const current = (company.settings as Record<string, unknown> | null) ?? {}
    const updated = { ...current, riskRegistry: items } as unknown as Prisma.InputJsonValue

    await prisma.company.update({
      where: { id: company.id },
      data: { settings: updated },
    })
    console.log(`  ✓ ${company.name} (${companyCode}): riskRegistry updated (${items.length} items)`)
    applied++
  }

  console.log(`\nDone. ${applied} compan${applied === 1 ? "y" : "ies"} updated.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
