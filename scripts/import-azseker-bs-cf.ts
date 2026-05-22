/**
 * One-shot script: import missing BS and CF data for AzerSheker subsidiaries
 * from Guvven Fin.xlsx.
 *
 * BS CPC / AZSF / EDEN were never loaded.
 * BS Malt was partially loaded; this completes it.
 * CF for all 4 entities was never loaded.
 *
 * Run: npx tsx scripts/import-azseker-bs-cf.ts
 */

import path from "path"
import * as XLSX from "xlsx"
import { PrismaClient } from "@prisma/client"
import { parseWorkbookBsSheet } from "../src/lib/onboarding/adapters/azseker-workbook-bs"
import { parsePlfCfSheet } from "../src/lib/onboarding/adapters/azseker-plf"
import { runBalanceSheetBatch } from "../src/lib/onboarding/bs-import-batch"
import { runCashFlowBatch } from "../src/lib/onboarding/cf-import-batch"

const prisma = new PrismaClient()

const ORG_ID = "cmockji6c0000u6oseeuz5ipq"
const PLAN_ID = "cmp17ayy7000du6ockilfw0c4" // Azərşəkər 2026 Budget
const YEAR = 2026
const WORKBOOK_PATH = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const PERIOD_SCOPE = Array.from({ length: 12 }, (_, i) =>
  `${YEAR}-${String(i + 1).padStart(2, "0")}`,
)

const ENTITIES = [
  { code: "CPC",  bsSheet: "BS CPC",  cfSheet: "CF CPC",  cfSourceTag: "azseker-cf-cpc"  },
  { code: "AZSF", bsSheet: "BS AZSF", cfSheet: "CF AZSF", cfSourceTag: "azseker-cf-azsf" },
  { code: "EDEN", bsSheet: "BS EDEN", cfSheet: "CF EDEN", cfSourceTag: "azseker-cf-eden" },
  { code: "MALT", bsSheet: "BS Malt", cfSheet: "CF Malt", cfSourceTag: "azseker-cf-malt" },
]

async function main() {
  console.log("Reading workbook:", WORKBOOK_PATH)
  const wb = XLSX.readFile(WORKBOOK_PATH, { cellDates: false, raw: true })

  // ── Collect ALL BS rows first, insert in one batch (avoids cascade archive) ──
  const allBsRows: Parameters<typeof runBalanceSheetBatch>[1]["rows"][number][] = []
  for (const entity of ENTITIES) {
    console.log(`\nParsing BS ${entity.code} (${entity.bsSheet})…`)
    const parsed = parseWorkbookBsSheet(wb, entity.bsSheet, XLSX, { preferYear: YEAR })
    parsed.warnings.forEach((w) => console.warn(`  ⚠️  ${w.reason}`))
    const rows = parsed.lines.flatMap((line) =>
      Object.entries(line.monthlyAmounts)
        .filter(([period]) => period.startsWith(String(YEAR)))
        .map(([period, amount]) => ({
          planId: PLAN_ID,
          accountCode: `AZSEKER-${entity.code}-${line.code}`,
          accountName: line.label,
          lineType: line.lineType,
          subType: line.subType ?? null,
          year: YEAR,
          month: Number(period.split("-")[1]),
          amount,
          sourceCell: `guvven-fin#${entity.bsSheet}!${line.code}@${period}`,
        })),
    )
    console.log(`  ${parsed.lines.length} accounts → ${rows.length} rows`)
    allBsRows.push(...rows)
  }

  console.log(`\nInserting ${allBsRows.length} BS rows (single batch, all entities)…`)
  const bsResult = await prisma.$transaction((tx) =>
    runBalanceSheetBatch(tx, {
      organizationId: ORG_ID,
      label: `AZSEKER ALL BS ${YEAR}`,
      actorUserId: "script:import-azseker-bs-cf",
      sourceDocument: "guvven-fin:BS-all",
      planIds: [PLAN_ID],
      periodScope: PERIOD_SCOPE,
      rows: allBsRows,
      expectedSums: new Map(),
      purgeArchivedFirst: true,
    }),
  )
  console.log(`✅  BS inserted ${bsResult.metrics.rowsInserted} (archived ${bsResult.metrics.resetArchived}, purged ${bsResult.metrics.resetPurged})`)

  // ── CF — entity-specific source tags, no cascade issue ──────────────
  let totalCfRows = 0
  for (const entity of ENTITIES) {
    console.log(`\nParsing CF ${entity.code} (${entity.cfSheet})…`)
    const cfParsed = parsePlfCfSheet(wb, entity.cfSheet, XLSX, { preferYear: YEAR })
    cfParsed.warnings.forEach((w) => console.warn(`  ⚠️  ${w.reason}`))

    const cfRows = cfParsed.entries.flatMap((entry) =>
      entry.perMonth
        .map((amount, monthIdx) => ({ amount, month: monthIdx + 1 }))
        .filter(({ amount, month }) => amount !== 0 && month >= 1 && month <= 12)
        .map(({ amount, month }) => ({
          entityCode: `AZSEKER-${entity.code}`,
          cfCode: entry.code,
          category: `AZSEKER-${entity.code}-${entry.code}`,
          activityType: entry.activityType,
          entryType: entry.entryType,
          year: YEAR,
          month,
          amount,
          currencyCode: "AZN" as const,
          description: entry.label,
          source: entity.cfSourceTag,
          sourceId: `AZSEKER-${entity.code}::${entry.code}::${YEAR}-${String(month).padStart(2, "0")}`,
        })),
    )

    console.log(`  ${cfParsed.entries.length} CF lines → ${cfRows.length} non-zero rows`)
    if (cfRows.length === 0) continue

    const cfResult = await prisma.$transaction((tx) =>
      runCashFlowBatch(tx, {
        organizationId: ORG_ID,
        label: `AZSEKER ${entity.code} CF ${YEAR}`,
        actorUserId: "script:import-azseker-bs-cf",
        sourceDocument: `guvven-fin:${entity.cfSheet}`,
        sourceTag: entity.cfSourceTag,
        periodScope: PERIOD_SCOPE,
        rows: cfRows,
        expectedSums: new Map(),
        purgeArchivedFirst: true,
      }),
    )
    console.log(`  ✅  inserted ${cfResult.metrics.rowsInserted}`)
    totalCfRows += cfResult.metrics.rowsInserted
  }

  console.log(`\n✅  Total: BS ${bsResult.metrics.rowsInserted} rows, CF ${totalCfRows} rows`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
