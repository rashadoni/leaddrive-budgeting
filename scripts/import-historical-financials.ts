/**
 * import-historical-financials.ts (2026-06-03, user «полная история 2023-25»)
 *
 * Loads the historical P&L (PLF), Balance Sheet (BS), and Cash Flow (CF) for
 * 2023–2025 from `Guvven Fin.xlsx` into the CURRENT schema, for the four
 * AzerSheker entities. Replaces the stale `import-historical-actuals.mjs`,
 * whose writes targeted the pre-Phase-2.1 schema (`accountId: null`,
 * `accountCode`/`category` columns since dropped).
 *
 * Why: the DB only ever had 2026 financials loaded — 2025 (and earlier) P&L
 * were never persisted, so `revenue=0` for 2025 and IND_EBITDA_MARGIN couldn't
 * compute (it showed `unknown`). Without 2025 loaded, the terminal cannot show
 * a complete prior-year headline (EDEN 2025 = 5.57M rev / 1.56M EBITDA / 28%).
 *
 * Design — reuse the PROVEN parsing from the old script (header detection, leaf
 * regexes, PLF/BS/CF classifiers, the revenue-positive / cost-negated sign
 * convention that produced today's 2026 rows) and fix ONLY the writes:
 *   • resolve `accountId` from the EXISTING ChartOfAccount by code (the 2026
 *     import already created every PLF/BS/CF code); auto-create any code missing
 *     from the CoA so no real line is dropped.
 *   • BudgetLine: drop `category`; set `accountId`, `companyId`, `monthIndex`.
 *   • BalanceSheetLine: drop `accountCode`/`accountName`; set `accountId` +
 *     `companyId`; soft-delete scoped by (plan, year, COMPANY) — the old script
 *     deleted by (plan, year) only, which on the shared org-level plan wiped
 *     other companies' BS rows for that year (latent bug — fixed here).
 *   • CashFlowEntry: drop `category`; set `accountId`; keep `sourceId`
 *     `<entity>::<cfCode>` for per-company attribution (CF has no companyId col).
 *
 * Distinct source tags keep historical rows separate from the 2026 import
 * (`multi-import` / `azseker-workbook-cf`), so re-runs never touch 2026.
 *
 *   DRY=1 npx tsx scripts/import-historical-financials.ts   # parse + report, NO writes
 *         npx tsx scripts/import-historical-financials.ts   # apply + recompute
 */
import { PrismaClient } from "@prisma/client"
import * as XLSX from "xlsx"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()
const WORKBOOK = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const DRY = process.env.DRY === "1"
const ACTOR = "historical-import-2026-06-03"
const SRC_DOC = "historical-import:Guvven Fin.xlsx"
const CF_SOURCE = "workbook-cf-historical"
const MIN_YEAR = 2023
const MAX_YEAR = 2025 // 2026 is already loaded by the AI import — never touch it

// Per-entity sheet + available years (intersected with [MIN_YEAR, MAX_YEAR]).
const PLF_SHEETS: Record<string, { sheet: string; years: number[] }> = {
  "AZSEKER-CPC": { sheet: "PLF CPC", years: [2023, 2024, 2025] },
  "AZSEKER-AZSF": { sheet: "PLF AZSF", years: [2023, 2024, 2025] },
  "AZSEKER-EDEN": { sheet: "PLF EDEN", years: [2023, 2024, 2025] },
  "AZSEKER-MALT": { sheet: "PL Malt", years: [2025] },
}
const BS_SHEETS: Record<string, { sheet: string; years: number[] }> = {
  "AZSEKER-CPC": { sheet: "BS CPC", years: [2023, 2024, 2025] },
  "AZSEKER-AZSF": { sheet: "BS AZSF", years: [2023, 2024, 2025] },
  "AZSEKER-EDEN": { sheet: "BS EDEN", years: [2024, 2025] },
  "AZSEKER-MALT": { sheet: "BS Malt", years: [2025] },
}
const CF_SHEETS: Record<string, { sheet: string; years: number[] }> = {
  "AZSEKER-CPC": { sheet: "CF CPC", years: [2023, 2024, 2025] },
  "AZSEKER-AZSF": { sheet: "CF AZSF", years: [2023, 2024, 2025] },
  "AZSEKER-EDEN": { sheet: "CF EDEN", years: [2023, 2024, 2025] },
  "AZSEKER-MALT": { sheet: "CF Malt", years: [2025] },
}

// ── Excel serial → {year, month 0-based} ────────────────────────────────────
function excelToYM(cell: unknown): { year: number; month: number } | null {
  if (typeof cell !== "number" || !Number.isFinite(cell)) return null
  if (cell < 43000 || cell > 50000) return null // ~2017-2036
  const d = new Date((cell - 25569) * 86400 * 1000)
  if (isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  if (y < 2019 || y > 2031) return null
  return { year: y, month: d.getUTCMonth() }
}

// Find header row + 12 monotonic month-column positions for a target year.
function findHeaderRow(aoa: unknown[][], preferYear: number): { row: number; monthCols: number[] } | null {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? []
    const byYear = new Map<number, number[]>()
    for (let c = 0; c < row.length; c++) {
      const ym = excelToYM(row[c])
      if (!ym) continue
      if (!byYear.has(ym.year)) byYear.set(ym.year, Array(12).fill(-1))
      const cols = byYear.get(ym.year)!
      if (cols[ym.month] === -1) cols[ym.month] = c
    }
    if (!byYear.has(preferYear)) continue
    const cols = byYear.get(preferYear)!
    if (cols.filter((v) => v !== -1).length < 12) continue
    let mono = true
    for (let k = 1; k < 12; k++) if (cols[k] <= cols[k - 1]) { mono = false; break }
    if (mono) return { row: i, monthCols: cols }
  }
  return null
}

// ── classifiers (verbatim from the proven import-historical-actuals.mjs) ─────
const PLF_LEAF_RE = /^PLF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/
function plfAccountType(code: string): "revenue" | "cogs" | "expense" | null {
  const m = code.trim().match(/^PLF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  if (s === "01") return "revenue"
  if (s === "02") return "cogs"
  if (s === "10") return null // computed Net Profit subtotal — skip
  if (/^0[3-9]$/.test(s) || s === "12") return "expense"
  return null
}
function classifyBs(code: string): { lineType: "asset" | "liability" | "equity" | null; subType: string | null } {
  const m = code.trim().match(/^BS\.(\d{2})\.(\d{2})?/)
  if (!m) return { lineType: null, subType: null }
  const top = m[1], sub = m[2]
  if (top === "01") {
    if (sub === "01") return { lineType: "asset", subType: "non_current" }
    if (sub === "02") return { lineType: "asset", subType: "current" }
    return { lineType: "asset", subType: null }
  }
  if (top === "02") return { lineType: "equity", subType: null }
  if (top === "03") {
    if (sub === "01") return { lineType: "liability", subType: "long_term" }
    if (sub === "02") return { lineType: "liability", subType: "short_term" }
    return { lineType: "liability", subType: null }
  }
  return { lineType: null, subType: null }
}
const CF_LEAF_RE = /^CF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/
function cfActivityType(code: string): "operating" | "investing" | "financing" | null {
  const m = code.trim().match(/^CF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  if (s === "01") return "operating"
  if (s === "02") return "investing"
  if (s === "03") return "financing"
  return null
}
function cfEntryType(label: string): "inflow" | "outflow" {
  const l = (label || "").toLowerCase()
  if (l.includes("inflow") || l.includes("daxilolma") || l.includes("receipt")) return "inflow"
  return "outflow"
}

function parentOf(code: string): string | null {
  const parts = code.split(".")
  return parts.length > 1 ? parts.slice(0, -1).join(".") : null
}

type CoaEntry = { id: string; accountType: string }

async function main() {
  console.log(`${DRY ? "DRY (no writes)" : "APPLY"} — historical financials ${MIN_YEAR}–${MAX_YEAR} from Guvven Fin.xlsx\n`)
  const wb = XLSX.readFile(WORKBOOK, { cellFormula: false, cellHTML: false })

  const org = await prisma.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error("no organization")
  const companies = await prisma.company.findMany({
    where: { code: { in: Object.keys(PLF_SHEETS) } },
    select: { id: true, code: true },
  })
  const codeToId = new Map(companies.map((c) => [c.code, c.id]))

  // CoA map: code → {id, accountType}. Auto-created codes get added here.
  const coaRows = await prisma.chartOfAccount.findMany({ where: { organizationId: org.id }, select: { id: true, code: true, accountType: true } })
  const coa = new Map<string, CoaEntry>(coaRows.map((a) => [a.code, { id: a.id, accountType: a.accountType }]))
  let createdAccounts = 0
  const missing = new Set<string>()

  async function resolveAccountId(code: string, accountType: string, name: string): Promise<string | null> {
    const hit = coa.get(code)
    if (hit) return hit.id
    missing.add(code)
    if (DRY) return null
    const created = await prisma.chartOfAccount.create({
      data: { organizationId: org!.id, code, name: name || code, accountType, parentCode: parentOf(code), isActive: true },
      select: { id: true },
    })
    coa.set(code, { id: created.id, accountType })
    createdAccounts++
    return created.id
  }

  const planCache = new Map<number, string>()
  async function getPlanId(year: number): Promise<string> {
    if (planCache.has(year)) return planCache.get(year)!
    let plan = await prisma.budgetPlan.findFirst({ where: { organizationId: org!.id, year, kind: "actual", name: { contains: "Actuals" } }, select: { id: true } })
    if (!plan && !DRY) {
      plan = await prisma.budgetPlan.create({
        data: { name: `Azərşəkər ${year} Actuals`, year, organizationId: org!.id, status: "active", periodType: "monthly", kind: "actual" },
        select: { id: true },
      })
      console.log(`  📋 created plan: Azərşəkər ${year} Actuals (${plan.id})`)
    }
    const id = plan?.id ?? `DRY-${year}`
    planCache.set(year, id)
    return id
  }

  const affected = new Set<string>() // `${companyId}:${year}`
  let totalPLF = 0, totalBS = 0, totalCF = 0

  const aoaOf = (sheet: string) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: null, blankrows: false }) as unknown[][]

  // ── 1. PLF → BudgetLine ────────────────────────────────────────────────────
  console.log("=== PLF (P&L) → BudgetLine ===")
  for (const [entity, cfg] of Object.entries(PLF_SHEETS)) {
    const companyId = codeToId.get(entity)
    if (!companyId || !wb.Sheets[cfg.sheet]) { console.warn(`  ${entity}: missing company/sheet — skip`); continue }
    const aoa = aoaOf(cfg.sheet)
    for (const year of cfg.years) {
      if (year < MIN_YEAR || year > MAX_YEAR) continue
      const hdr = findHeaderRow(aoa, year)
      if (!hdr) { console.log(`  ${entity} ${year}: no 12-month header`); continue }
      const planId = await getPlanId(year)
      const rows: { organizationId: string; planId: string; companyId: string; lineType: string; plannedAmount: number; currencyCode: string; exchangeRate: null; monthIndex: number; sortOrder: number; accountId: string; sourceDocument: string }[] = []
      for (let ri = hdr.row + 1; ri < aoa.length; ri++) {
        const row = aoa[ri] ?? []
        const code = typeof row[0] === "string" ? (row[0] as string).trim() : ""
        if (!PLF_LEAF_RE.test(code)) continue
        const accountType = plfAccountType(code)
        if (!accountType) continue
        const label = typeof row[1] === "string" ? (row[1] as string).trim() : code
        const accountId = await resolveAccountId(code, accountType, label)
        const normalizeSign = accountType === "cogs" || accountType === "expense"
        for (let m = 0; m < 12; m++) {
          const c = hdr.monthCols[m]
          if (c === -1) continue
          const val = row[c]
          const num = typeof val === "number" ? val : parseFloat(String(val))
          if (!Number.isFinite(num) || num === 0) continue
          if (!accountId) continue // DRY: counted as missing
          rows.push({
            organizationId: org.id, planId, companyId, lineType: accountType,
            plannedAmount: normalizeSign ? -num : num, currencyCode: "AZN", exchangeRate: null,
            monthIndex: m, sortOrder: m + 1, accountId, sourceDocument: `${SRC_DOC}#${cfg.sheet}@${year}`,
          })
        }
      }
      if (!DRY && rows.length > 0) {
        await prisma.budgetLine.updateMany({ where: { organizationId: org.id, planId, companyId, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: ACTOR } })
        await prisma.budgetLine.createMany({ data: rows })
      }
      if (rows.length > 0) affected.add(`${companyId}:${year}`)
      totalPLF += rows.length
      console.log(`  ${DRY ? "·" : "✓"} ${entity} ${year}: ${rows.length} PLF rows`)
    }
  }

  // ── 2. BS → BalanceSheetLine ───────────────────────────────────────────────
  console.log("\n=== BS (Balance Sheet) → BalanceSheetLine ===")
  for (const [entity, cfg] of Object.entries(BS_SHEETS)) {
    const companyId = codeToId.get(entity)
    if (!companyId || !wb.Sheets[cfg.sheet]) { console.warn(`  ${entity}: missing company/sheet — skip`); continue }
    const aoa = aoaOf(cfg.sheet)
    for (const year of cfg.years) {
      if (year < MIN_YEAR || year > MAX_YEAR) continue
      const hdr = findHeaderRow(aoa, year)
      if (!hdr) { console.log(`  ${entity} ${year}: no 12-month BS header`); continue }
      const planId = await getPlanId(year)
      const rows: { organizationId: string; planId: string; companyId: string; accountId: string; lineType: string; subType: string | null; year: number; month: number; amount: number; notes: string }[] = []
      for (let ri = hdr.row + 1; ri < aoa.length; ri++) {
        const row = aoa[ri] ?? []
        const code = typeof row[0] === "string" ? (row[0] as string).trim() : ""
        if (!/^BS\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/.test(code)) continue
        const { lineType, subType } = classifyBs(code)
        if (!lineType) continue
        const label = typeof row[1] === "string" ? (row[1] as string).trim() : code
        const accountId = await resolveAccountId(code, lineType, label)
        for (let m = 0; m < 12; m++) {
          const c = hdr.monthCols[m]
          if (c === -1) continue
          const val = row[c]
          const num = typeof val === "number" ? val : parseFloat(String(val))
          if (!Number.isFinite(num) || num === 0) continue
          if (!accountId) continue
          rows.push({ organizationId: org.id, planId, companyId, accountId, lineType, subType, year, month: m + 1, amount: num, notes: `${entity} | ${SRC_DOC}#${cfg.sheet}` })
        }
      }
      if (!DRY && rows.length > 0) {
        // SCOPED by company — the old script deleted by (plan,year) only, wiping siblings on the shared plan.
        await prisma.balanceSheetLine.updateMany({ where: { organizationId: org.id, planId, companyId, year, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: ACTOR } })
        await prisma.balanceSheetLine.createMany({ data: rows })
      }
      if (rows.length > 0) affected.add(`${companyId}:${year}`)
      totalBS += rows.length
      console.log(`  ${DRY ? "·" : "✓"} ${entity} ${year}: ${rows.length} BS rows`)
    }
  }

  // ── 3. CF → CashFlowEntry ──────────────────────────────────────────────────
  console.log("\n=== CF (Cash Flow) → CashFlowEntry ===")
  for (const [entity, cfg] of Object.entries(CF_SHEETS)) {
    const companyId = codeToId.get(entity)
    if (!companyId || !wb.Sheets[cfg.sheet]) { console.warn(`  ${entity}: missing company/sheet — skip`); continue }
    const aoa = aoaOf(cfg.sheet)
    for (const year of cfg.years) {
      if (year < MIN_YEAR || year > MAX_YEAR) continue
      const hdr = findHeaderRow(aoa, year)
      if (!hdr) { console.log(`  ${entity} ${year}: no 12-month CF header`); continue }
      const rows: { organizationId: string; year: number; month: number; entryType: string; source: string; sourceId: string; amount: number; currencyCode: string; description: string; activityType: string; accountId: string; isProjected: boolean }[] = []
      for (let ri = hdr.row + 1; ri < aoa.length; ri++) {
        const row = aoa[ri] ?? []
        const code = typeof row[0] === "string" ? (row[0] as string).trim() : ""
        if (!CF_LEAF_RE.test(code)) continue
        const activityType = cfActivityType(code)
        if (!activityType) continue
        const label = typeof row[1] === "string" ? (row[1] as string).trim() : code
        const entryType = cfEntryType(label)
        const accountId = await resolveAccountId(code, entryType === "inflow" ? "revenue" : "expense", label)
        for (let m = 0; m < 12; m++) {
          const c = hdr.monthCols[m]
          if (c === -1) continue
          const val = row[c]
          const num = typeof val === "number" ? val : parseFloat(String(val))
          if (!Number.isFinite(num) || num === 0) continue
          if (!accountId) continue
          rows.push({ organizationId: org.id, year, month: m + 1, entryType, source: CF_SOURCE, sourceId: `${entity}::${code}`, amount: Math.abs(num), currencyCode: "AZN", description: label, activityType, accountId, isProjected: false })
        }
      }
      if (!DRY && rows.length > 0) {
        await prisma.cashFlowEntry.deleteMany({ where: { organizationId: org.id, year, source: CF_SOURCE, sourceId: { startsWith: `${entity}::` } } })
        await prisma.cashFlowEntry.createMany({ data: rows })
      }
      if (rows.length > 0) affected.add(`${companyId}:${year}`)
      totalCF += rows.length
      console.log(`  ${DRY ? "·" : "✓"} ${entity} ${year}: ${rows.length} CF rows`)
    }
  }

  console.log(`\nTotals — PLF ${totalPLF}, BS ${totalBS}, CF ${totalCF}.  Accounts ${DRY ? "MISSING" : "created"}: ${DRY ? missing.size : createdAccounts}`)
  if (missing.size > 0) console.log(`  ${DRY ? "missing" : "created"} codes (${missing.size}): ${[...missing].sort().join(", ").slice(0, 800)}`)

  if (!DRY && affected.size > 0) {
    const aff = [...affected].map((k) => { const [companyId, year] = k.split(":"); return { companyId, year: Number(year) } })
    const years = [...new Set(aff.map((a) => a.year))].sort()
    console.log(`\nRecomputing ${aff.length} company-years (${years.join(",")})…`)
    const rc = await runRecomputeForCompanies(prisma, org.id, aff)
    console.log(`recompute: ${JSON.stringify(rc)}`)
  }
  await prisma.$disconnect()
  console.log(`\n${DRY ? "DRY done — re-run without DRY=1 to apply." : "DONE. Verify 2025 vs source."}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
