/**
 * Patch script: insert missing PLF .R rows (e.g. PLF.05.01.R — G&A rollup lines)
 * that were previously skipped by the LEAF_CODE_RE regex bug.
 *
 * SAFE to run multiple times — checks for existing rows first.
 */
import * as XLSX from "xlsx"
import { PrismaClient } from "@prisma/client"

const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const PLAN_ID = "cmp17ayy7000du6ockilfw0c4"
const ORG_ID = "cmockji6c0000u6oseeuz5ipq"

// Sheet → entity code mapping (actual sheet names in Guvven Fin.xlsx)
const PLF_SHEETS: Array<{ sheetName: string; entityCode: string }> = [
  { sheetName: "PLF CPC",  entityCode: "AZSEKER-CPC"  },
  { sheetName: "PLF AZSF", entityCode: "AZSEKER-AZSF" },
  { sheetName: "PLF EDEN", entityCode: "AZSEKER-EDEN" },
  { sheetName: "PL Malt",  entityCode: "AZSEKER-MALT" },
]

const SERIAL_2026_MIN = 46000
const SERIAL_2026_MAX = 46400

// PLF section → accountType (matches azseker-plf.ts logic)
function plfAccountType(code: string): "revenue" | "cogs" | "expense" | null {
  const m = code.match(/^PLF\.(\d{2})/)
  if (!m) return null
  const section = m[1]
  if (section === "01") return "revenue"
  if (section === "02") return "cogs"
  if (section === "10") return null // computed Net Profit
  if (/^0[3-9]$/.test(section)) return "expense"
  if (section === "12") return "expense" // PROVISIONS
  return null
}

async function main() {
  const prisma = new PrismaClient()
  const wb = XLSX.readFile(FILE)

  // Load company ID map
  const companies = await prisma.company.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, code: true },
  })
  const companyIdByCode = new Map(companies.map(c => [c.code, c.id]))

  // Load CoA map for accountId FK
  const coaEntries = await prisma.chartOfAccount.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, code: true },
  })
  const coaByCode = new Map(coaEntries.map(a => [a.code, a.id]))

  let totalInserted = 0

  for (const { sheetName, entityCode } of PLF_SHEETS) {
    const ws = wb.Sheets[sheetName]
    if (!ws) { console.log(`Sheet "${sheetName}" not found — skipping`); continue }

    const companyId = companyIdByCode.get(entityCode)
    if (!companyId) { console.log(`Company ${entityCode} not found in DB`); continue }

    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false }) as unknown[][]

    // Find 2026 column range
    let colStart = -1, colEnd = -1
    for (let r = 0; r < 5; r++) {
      const hdr = aoa[r]
      const first = hdr.findIndex((v, i) =>
        i > 2 && typeof v === "number" && v >= SERIAL_2026_MIN && v <= SERIAL_2026_MAX
      )
      if (first < 0) continue
      let last = first
      while (last + 1 < hdr.length && typeof hdr[last + 1] === "number" &&
             (hdr[last + 1] as number) >= SERIAL_2026_MIN && (hdr[last + 1] as number) <= SERIAL_2026_MAX) last++
      colStart = first; colEnd = last; break
    }
    if (colStart < 0) { console.log(`No 2026 columns found in ${sheetName}`); continue }

    // Match .R codes AND PLF.12.XX.XX provision codes (both missing from DB)
    const LEAF_R_RE = /^PLF\.\d{2}\.\d{2}\.([A-Za-z]{1,2}|\d{1,2})$/

    const rowsToInsert: any[] = []

    for (const rawRow of aoa) {
      const codeRaw = rawRow[0]
      const code = typeof codeRaw === "string" ? codeRaw.trim() : ""
      if (!LEAF_R_RE.test(code)) continue

      const accountType = plfAccountType(code)
      if (!accountType) continue

      const label = typeof rawRow[1] === "string" ? (rawRow[1] as string).trim() : code
      const category = `${entityCode}-${code}`

      // Check if this row already exists in DB
      const existing = await prisma.budgetLine.findFirst({
        where: { planId: PLAN_ID, companyId, category, deletedAt: null },
      })
      if (existing) {
        // Already imported (shouldn't happen but guard anyway)
        continue
      }

      const normalizeSign = accountType === "cogs" || accountType === "expense"
      for (let m = 0; m < 12; m++) {
        const raw = rawRow[colStart + m]
        const v = typeof raw === "number" ? raw : (parseFloat(String(raw)) || 0)
        if (v === 0) continue
        const amount = normalizeSign ? -v : v

        rowsToInsert.push({
          organizationId: ORG_ID,
          planId: PLAN_ID,
          companyId,
          category,
          lineType: accountType,
          plannedAmount: amount,
          currencyCode: "AZN",
          exchangeRate: null,
          monthIndex: m,
          accountId: coaByCode.get(category) ?? null,
          sourceDocument: `patch-plf-r-rows#${sheetName}!${code}@2026-${String(m + 1).padStart(2, "0")}`,
        })
      }
    }

    if (rowsToInsert.length > 0) {
      const result = await prisma.budgetLine.createMany({ data: rowsToInsert })
      console.log(`${entityCode}: inserted ${result.count} .R rows`)
      totalInserted += result.count
    } else {
      console.log(`${entityCode}: no new .R rows to insert`)
    }
  }

  console.log(`\nTotal inserted: ${totalInserted} rows`)
  await prisma.$disconnect()
}

main().catch(console.error)
