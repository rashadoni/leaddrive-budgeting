/**
 * Import PBC audit follow-up stats from "Follow up - For GTC.xlsx" into
 * OperationalFact records per company and Organization.settings.auditFollowup.
 *
 * Metrics written per company (current-month snapshot):
 *   AUDIT_MAJOR_OPEN      — Major + Major NC findings not yet resolved
 *   AUDIT_MINOR_OPEN      — Minor + Minor NC findings not yet resolved
 *   AUDIT_OBSERVATION_OPEN — Observation findings not yet resolved
 *   AUDIT_OFI_OPEN        — OFI (Opportunity for Improvement) not yet resolved
 *   AUDIT_TOTAL           — All findings (any type)
 *   AUDIT_CLOSED_PCT      — % of findings resolved (0–100)
 *
 * Idempotent: safe to re-run when the file is updated.
 *
 * Usage:
 *   npx tsx scripts/import-audit-followup.ts
 *   npx tsx scripts/import-audit-followup.ts --dry-run
 */
import { PrismaClient, Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import path from "path"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")

const FILE = path.join(
  "/Users/rashadrahimov/Documents/budget azersheker",
  "Follow up - For GTC.xlsx",
)

const ORG_SLUG = "azmade"
const PERIOD_DATE = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1))
const TODAY = new Date().toISOString().slice(0, 10)

/** Normalize company name to entity code */
const COMPANY_MAP: Record<string, string> = {
  Azərşəkər: "AZSEKER",
  "CPC MMC": "AZSEKER-CPC",
}

/** Returns true if finding is still open / unresolved */
function isOpen(status: string): boolean {
  const s = (status ?? "").toLowerCase().trim()
  // "İcra tarixi çatmamış" = deadline not reached yet = still open
  if (s.includes("çatmamış")) return true
  if (s.includes("yetirilməyib")) return true
  return false
}

/** Canonicalise observation type into a metric-safe category */
function typeCategory(raw: string): "major" | "minor" | "observation" | "ofi" | "other" {
  const t = raw.trim().toLowerCase()
  if (t.startsWith("major")) return "major"
  if (t.startsWith("minor")) return "minor"
  if (t === "observation") return "observation"
  if (t === "ofi") return "ofi"
  return "other"
}

interface RowStat {
  company: string     // raw name from sheet
  type: string        // Müşahidə növü
  status: string      // Status (MNG)
}

function parseFollowupSheet(ws: XLSX.WorkSheet): RowStat[] {
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  })
  // row 0 = empty, row 1 = headers, data starts row 2
  const rows: RowStat[] = []
  for (let i = 2; i < aoa.length; i++) {
    const row = aoa[i]
    if (row[0] == null) continue
    const company = String(row[3] ?? "").trim()
    const type = String(row[1] ?? "").trim()
    const status = String(row[6] ?? "").trim()
    if (company && type) rows.push({ company, type, status })
  }
  return rows
}

interface CompanyStat {
  total: number
  majorOpen: number
  minorOpen: number
  observationOpen: number
  ofiOpen: number
  closedPct: number
  rows: RowStat[]
}

function aggregateByCompany(rows: RowStat[]): Map<string, CompanyStat> {
  const map = new Map<string, CompanyStat>()
  for (const r of rows) {
    const code = COMPANY_MAP[r.company]
    if (!code) continue
    if (!map.has(code)) {
      map.set(code, { total: 0, majorOpen: 0, minorOpen: 0, observationOpen: 0, ofiOpen: 0, closedPct: 0, rows: [] })
    }
    const stat = map.get(code)!
    stat.rows.push(r)
    stat.total++
    const cat = typeCategory(r.type)
    if (isOpen(r.status)) {
      if (cat === "major") stat.majorOpen++
      else if (cat === "minor") stat.minorOpen++
      else if (cat === "observation") stat.observationOpen++
      else if (cat === "ofi") stat.ofiOpen++
    }
  }
  for (const stat of map.values()) {
    const open = stat.majorOpen + stat.minorOpen + stat.observationOpen + stat.ofiOpen
    stat.closedPct = stat.total > 0 ? Math.round(((stat.total - open) / stat.total) * 100) : 0
  }
  return map
}

async function main(): Promise<void> {
  console.log(`\n=== Import Audit Follow-up${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`)

  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, settings: true },
  })
  if (!org) throw new Error(`Organization slug="${ORG_SLUG}" not found`)
  console.log(`Org: ${org.name}`)

  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false })
  const sheetName = "Follow-up"
  if (!wb.Sheets[sheetName]) throw new Error(`Sheet "${sheetName}" not found in ${FILE}`)

  const rows = parseFollowupSheet(wb.Sheets[sheetName])
  console.log(`Parsed ${rows.length} finding rows from "${sheetName}"`)

  const byCompany = aggregateByCompany(rows)

  console.log("\nSummary:")
  for (const [code, stat] of byCompany) {
    const openTotal = stat.majorOpen + stat.minorOpen + stat.observationOpen + stat.ofiOpen
    console.log(
      `  ${code}: ${stat.total} total, ${openTotal} open (major=${stat.majorOpen}, ` +
      `minor=${stat.minorOpen}, obs=${stat.observationOpen}, ofi=${stat.ofiOpen}), ` +
      `closed=${stat.closedPct}%`,
    )
  }

  if (DRY_RUN) {
    console.log("\n  (dry-run) would write OperationalFact records + org.settings.auditFollowup")
    return
  }

  const companies = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true, name: true },
  })
  const companyByCode = Object.fromEntries(companies.map((c) => [c.code, c]))

  let applied = 0

  for (const [code, stat] of byCompany) {
    const company = companyByCode[code]
    if (!company) {
      console.warn(`  ⚠ Company ${code} not in DB — skipping`)
      continue
    }

    const metrics: Array<[string, number]> = [
      ["AUDIT_MAJOR_OPEN", stat.majorOpen],
      ["AUDIT_MINOR_OPEN", stat.minorOpen],
      ["AUDIT_OBSERVATION_OPEN", stat.observationOpen],
      ["AUDIT_OFI_OPEN", stat.ofiOpen],
      ["AUDIT_TOTAL", stat.total],
      ["AUDIT_CLOSED_PCT", stat.closedPct],
    ]

    for (const [metric, value] of metrics) {
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
          unit: metric.endsWith("_PCT") ? "%" : "count",
          source: "import",
        },
      })
    }

    console.log(`  ✓ ${company.name}: AUDIT_TOTAL=${stat.total}, AUDIT_CLOSED_PCT=${stat.closedPct}%`)
    applied++
  }

  // Save summary in org.settings
  const currentSettings = (org.settings as Record<string, unknown> | null) ?? {}
  const auditSummary = Object.fromEntries(
    [...byCompany.entries()].map(([code, stat]) => [
      code,
      {
        total: stat.total,
        majorOpen: stat.majorOpen,
        minorOpen: stat.minorOpen,
        observationOpen: stat.observationOpen,
        ofiOpen: stat.ofiOpen,
        closedPct: stat.closedPct,
      },
    ]),
  )

  await prisma.organization.update({
    where: { id: org.id },
    data: {
      settings: {
        ...currentSettings,
        auditFollowup: auditSummary,
        auditFollowupUpdatedAt: TODAY,
      } as unknown as Prisma.InputJsonValue,
    },
  })
  console.log(`\n✓ org.settings.auditFollowup updated`)
  console.log(`\nDone. ${applied} compan${applied === 1 ? "y" : "ies"} updated.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
