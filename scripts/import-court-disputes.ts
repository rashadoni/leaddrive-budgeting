/**
 * Import court disputes registry from "Açıq məhkəmə mübahisələri.xlsx"
 * into Organization.settings.courtDisputes (full JSON list) and
 * OperationalFact records (LEGAL_CASES_TOTAL / LEGAL_CASES_ACTIVE per company).
 *
 * Idempotent: safe to re-run after the file is updated.
 *
 * Usage:
 *   npx tsx scripts/import-court-disputes.ts
 *   npx tsx scripts/import-court-disputes.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import path from "path"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")

const FILE = path.join(
  "/Users/rashadrahimov/Documents/budget azersheker",
  "Açıq məhkəmə mübahisələri.xlsx",
)

const ORG_SLUG = "azmade"
const TODAY = new Date().toISOString().slice(0, 10)
// First day of current month — used as date for OperationalFact records
const PERIOD_DATE = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1))

export interface CourtCase {
  index: number
  date: string
  court: string
  plaintiff: string
  defendant: string
  claimType: string
  description: string
  department: string
  counsel: string
  status: string
  hearingDate?: string
  actions?: string
  result?: string
  closedDate?: string
}

/** Heuristic: active if status contains "icraatda" or "dayandırıl" or "Apellyasiya" */
function isActive(status: string): boolean {
  const s = (status ?? "").toLowerCase()
  if (s.includes("xitam")) return false
  if (s.includes("təmin edilməyib")) return false
  if (s.includes("imzalanmışdır")) return false
  if (s.includes("mümkün sayılmam")) return false
  if (s.includes("mümkün hesab edilməyib")) return false
  // Has specific resolution keywords
  if (s.includes("məhkumiyyət") || s.includes("cərimə")) return false
  // Only a closing date pattern (DD.MM.YYYY at start)
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(status.trim())) return false
  return true
}

/** Which AZSEKER entity code is primarily involved */
function detectCompanyCode(plaintiff: string, defendant: string): string {
  const both = (plaintiff + " " + defendant).toLowerCase()
  if (both.includes("cpc")) return "AZSEKER-CPC"
  if (both.includes("eden agro") || both.includes("eden")) return "AZSEKER-EDEN"
  if (both.includes("malt") || both.includes("pl malt") || both.includes("azsf")) return "AZSEKER-AZSF"
  return "AZSEKER" // holding-level (no specific subsidiary)
}

function parseCourtSheet(ws: XLSX.WorkSheet): CourtCase[] {
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  })
  // row 0 = title, row 1 = headers
  const cases: CourtCase[] = []
  for (let i = 2; i < aoa.length; i++) {
    const row = aoa[i]
    const idx = typeof row[0] === "number" ? row[0] : null
    if (!idx) continue

    const c: CourtCase = {
      index: idx,
      date: String(row[1] ?? "").trim(),
      court: String(row[2] ?? "").trim(),
      plaintiff: String(row[3] ?? "").trim(),
      defendant: String(row[4] ?? "").trim(),
      claimType: String(row[5] ?? "").trim(),
      description: String(row[6] ?? "").trim(),
      department: String(row[7] ?? "").trim(),
      counsel: String(row[8] ?? "").trim(),
      status: String(row[9] ?? "").trim(),
      hearingDate: row[10] ? String(row[10]).trim() : undefined,
      actions: row[11] ? String(row[11]).trim() : undefined,
      result: row[12] ? String(row[12]).trim() : undefined,
      closedDate: row[15] ? String(row[15]).trim() : undefined,
    }
    if (c.court || c.plaintiff || c.defendant) cases.push(c)
  }
  return cases
}

async function main(): Promise<void> {
  console.log(`\n=== Import Court Disputes${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`)

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, settings: true },
  })
  if (!org) throw new Error(`Organization slug="${ORG_SLUG}" not found`)
  console.log(`Org: ${org.name} (${org.id})`)

  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false })
  const sheetName = wb.SheetNames[0]
  const cases = parseCourtSheet(wb.Sheets[sheetName])

  console.log(`Parsed ${cases.length} court cases from "${sheetName}"`)

  const activeCases = cases.filter((c) => isActive(c.status))
  const closedCases = cases.filter((c) => !isActive(c.status))
  console.log(`  Active: ${activeCases.length}`)
  console.log(`  Closed: ${closedCases.length}`)

  // Group by company
  const byCompany: Record<string, { total: number; active: number }> = {}
  for (const c of cases) {
    const code = detectCompanyCode(c.plaintiff, c.defendant)
    if (!byCompany[code]) byCompany[code] = { total: 0, active: 0 }
    byCompany[code].total++
    if (isActive(c.status)) byCompany[code].active++
  }
  console.log("\n  By company:")
  for (const [code, counts] of Object.entries(byCompany)) {
    console.log(`    ${code}: ${counts.total} total, ${counts.active} active`)
  }

  if (DRY_RUN) {
    console.log("\n  (dry-run) would write org.settings.courtDisputes + OperationalFact records")
    return
  }

  // 1. Store full list in Org.settings
  const currentOrgSettings = (org.settings as Record<string, unknown> | null) ?? {}
  const updatedOrgSettings = {
    ...currentOrgSettings,
    courtDisputes: cases,
    courtDisputesUpdatedAt: TODAY,
  } as unknown as Prisma.InputJsonValue

  await prisma.organization.update({
    where: { id: org.id },
    data: { settings: updatedOrgSettings },
  })
  console.log(`\n✓ org.settings.courtDisputes updated (${cases.length} cases)`)

  // 2. Write OperationalFact records per company (LEGAL_CASES_TOTAL, LEGAL_CASES_ACTIVE)
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true, name: true },
  })
  const companyByCode = Object.fromEntries(companies.map((c) => [c.code, c]))

  for (const [code, counts] of Object.entries(byCompany)) {
    // "AZSEKER" is the parent company (level=1, code="AZSEKER") — exists in DB
    const lookupCode = code
    const company = companyByCode[lookupCode]
    if (!company) {
      console.warn(`  ⚠ Company ${lookupCode} not in DB — skipping OperationalFact`)
      continue
    }

    const metrics: Array<[string, number]> = [
      ["LEGAL_CASES_TOTAL", counts.total],
      ["LEGAL_CASES_ACTIVE", counts.active],
    ]

    for (const [metric, value] of metrics) {
      // Delete existing for this company/metric/month, then create fresh
      await prisma.operationalFact.deleteMany({
        where: {
          companyId: company.id,
          metric,
          date: {
            gte: PERIOD_DATE,
            lt: new Date(Date.UTC(PERIOD_DATE.getFullYear(), PERIOD_DATE.getMonth() + 1, 1)),
          },
        },
      })
      await prisma.operationalFact.create({
        data: {
          companyId: company.id,
          organizationId: org.id,
          metric,
          value,
          date: PERIOD_DATE,
          unit: "count",
          source: "import",
        },
      })
    }
    console.log(
      `  ✓ ${company.name}: LEGAL_CASES_TOTAL=${counts.total}, LEGAL_CASES_ACTIVE=${counts.active}`,
    )
  }

  console.log("\nDone.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
