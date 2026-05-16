import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { enforceRateLimit } from "@/lib/rate-limit"
import {
  PRODUCT_CODES,
  PRODUCT_NAMES,
  PRODUCT_UNITS,
  SALES_SHEETS,
} from "@/lib/import/aac-products"
import ExcelJS from "exceljs"
import {
  looksLikeCostAccount,
  isIndirectCostHeader,
  isRawMaterialHeader,
  HEADER_COST_CENTER_LOWER,
  HEADER_NON_RAW_MATERIAL_PREFIX_LOWER,
  HEADER_RAW_MATERIAL_PREFIX_LOWER,
} from "@/lib/import/keywords"
import { deriveRoleFromCode } from "@/lib/budgeting/coa-role"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeysForMonths } from "@/lib/budgeting/period-lock-http"
import { chunkedCreateMany } from "@/lib/db/chunked-create-many"

// App Router handles body parsing via request.formData() — no Pages-era
// `config = { api: { bodyParser: false } }` needed (deprecated in Next 16).
export const maxDuration = 120

// Excel import is expensive (file parsing + many DB writes). Limit to 2 imports/min per org.
const IMPORT_RATE_LIMIT = { name: "import-excel", windowMs: 60_000, max: 2 }
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB cap to prevent memory DoS

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function getCellValue(cell: ExcelJS.Cell): any {
  let v = cell.value
  if (v && typeof v === "object" && "result" in v) v = (v as any).result
  if (v && typeof v === "object" && "text" in v) v = (v as any).text
  if (v && typeof v === "object" && "richText" in v)
    v = (v as any).richText.map((rt: any) => rt.text).join("")
  return v
}

function getNumericValue(cell: ExcelJS.Cell): number {
  const v = getCellValue(cell)
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ""))
    return isNaN(n) ? 0 : n
  }
  return 0
}

// Phase 7.G Turn LXXV (Phase 5.1) — delegates to canonical
// `deriveRoleFromCode` (single source of truth for prefix matching).
// Maps the finer 8-bucket role back to the legacy 3-bucket
// `accountType` shape for backwards-compat with existing consumers.
// New code reading ChartOfAccount.role should NOT go through this.
function classifyAccount(code: string): string {
  const role = deriveRoleFromCode(code)
  if (role === "revenue") return "revenue"
  if (role === "cogs") return "cogs"
  return "expense" // opex/finance/tax_costs/non_operating/tax/unknown
}

function categoryFromCode(code: string): string | null {
  if (code.startsWith("601")) return "sales"
  if (code.startsWith("602")) return "returns"
  if (code.startsWith("603")) return "discounts"
  if (code.startsWith("701")) return "cogs"
  const map: Record<string, string> = {
    "711-02": "staff", "721-02": "staff",
    "711-03": "utilities", "721-03": "utilities",
    "711-04": "services", "721-04": "services",
    "711-05": "communication", "721-05": "communication",
    "711-06": "maintenance", "721-06": "maintenance",
    "711-07": "materials", "721-07": "materials",
    "711-08": "transport", "721-08": "transport",
    "711-09": "other_expense", "721-09": "other_expense",
    "711-10": "marketing",
    "731": "finance", "751": "non_operating", "761": "non_operating", "771": "non_operating",
    "801": "tax",
  }
  for (const [prefix, cat] of Object.entries(map)) {
    if (code.startsWith(prefix)) return cat
  }
  return null
}

// Cost type definitions from P&L structure
const COST_TYPE_DEFS = [
  { key: "staff", label: "İşçi heyəti xərcləri (Staff costs)", sortOrder: 1 },
  { key: "utilities", label: "Kommunal xərclər (Utilities)", sortOrder: 2 },
  { key: "services", label: "Alınmış xidmətlər (Services)", sortOrder: 3 },
  { key: "communication", label: "Rabitə xərcləri (Communication)", sortOrder: 4 },
  { key: "maintenance", label: "Təmir-istismar xərcləri (Maintenance)", sortOrder: 5 },
  { key: "materials", label: "Mal-materiallar (Materials)", sortOrder: 6 },
  { key: "transport", label: "Nəqliyyat xərcləri (Transport)", sortOrder: 7 },
  { key: "other_expense", label: "Digər xərclər (Other expenses)", sortOrder: 8 },
  { key: "marketing", label: "Marketinq xərcləri (Marketing)", sortOrder: 9 },
  { key: "finance", label: "Maliyyə xərcləri (Finance costs)", sortOrder: 10 },
  { key: "non_operating", label: "Qeyri-əməliyyat xərcləri (Non-operating)", sortOrder: 11 },
  { key: "tax", label: "Vergilər (Taxes)", sortOrder: 12 },
  { key: "depreciation", label: "Amortizasiya (Depreciation)", sortOrder: 13 },
]

// Assumption sheet mapping
const ASSUMPTION_SHEETS: { sheet: string; category: string; label: string }[] = [
  { sheet: "A0", category: "returns_transport", label: "Qaytarma, daşıma normaları" },
  { sheet: "A1", category: "mhb_transport", label: "MHB/əhəng daşıma" },
  { sheet: "A2", category: "pallet_export", label: "Poddon, ixrac" },
  { sheet: "A3", category: "waste", label: "Zay tullantı" },
  { sheet: "A4", category: "food", label: "Yemək xərci" },
  { sheet: "A5-POG", category: "prepaid", label: "Qabaqcadan ödəniş" },
  { sheet: "A6", category: "utilities", label: "Kommunal xərclər" },
  { sheet: "A7", category: "mining", label: "Mədən xərcləri" },
  { sheet: "A8", category: "repair", label: "Təmir-istismar" },
  { sheet: "A9", category: "mhb_recipe", label: "MHB resepti / sərfiyyat" },
  { sheet: "A10-P-baza", category: "labor_base", label: "İşçilik bazası" },
  { sheet: "A11-P", category: "labor_summary", label: "İşçilik svod" },
  { sheet: "A12", category: "marketing", label: "Marketinq" },
  { sheet: "A13", category: "depreciation", label: "Amortizasiya" },
  { sheet: "A14", category: "other", label: "Digər xərclər" },
]

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

  // Per-org rate limit — protects against accidental/malicious import spam
  const rateLimited = enforceRateLimit(orgId, IMPORT_RATE_LIMIT)
  if (rateLimited) return rateLimited

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    // Reject oversized files before loading into memory
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB allowed, got ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
        { status: 413 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const wb = new ExcelJS.Workbook()
    // exceljs expects the node Buffer-ish type; recent @types/node narrows our generic Buffer<ArrayBuffer>.
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    const year = parseInt(formData.get("year") as string) || 2026

    // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). Excel import
    // creates a NEW annual plan + writes 12 months of data into it, AND
    // (Section 15 below, line ~985) destructively replaces the org's
    // rolling forecast plans (deleteMany on existing rolling plans, lines
    // and forecasts). Reject if the target year OR any month within it
    // OR any quarter within it is locked. Year-level check is sufficient
    // because the month/quarter checks all roll up to year ⊂ container.
    const importMonths = Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }))
    const importLock = await findFirstActiveLockInPeriods(
      prisma,
      orgId,
      containingPeriodKeysForMonths(importMonths),
    )
    if (importLock) return lockedResponse(importLock, { prisma, orgId, userId, route: "POST /api/budgeting/import-excel" })

    const results: Record<string, number> = {}
    // Collect per-row skip/warning information so the UI can surface what was ignored.
    // Capped to avoid memory blowup on large workbooks with many malformed rows.
    type ImportIssue = { sheet: string; row?: number; reason: string; rawValue?: string }
    const issues: ImportIssue[] = []
    const ISSUE_CAP = 500
    let issuesTruncated = false
    const pushIssue = (i: ImportIssue) => {
      if (issues.length < ISSUE_CAP) issues.push(i)
      else issuesTruncated = true
    }

    // Wrap all plan-scoped writes in an interactive transaction so a mid-import
    // failure rolls back every row (no half-imported state). maxWait/timeout are
    // generous because large workbooks can take up to a minute to persist.
    // Transaction returns the created plan so section 15 (outside tx) can clone from it.
    const plan = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ═══════════════════════════════════════════════════════
      // 1. CREATE BUDGET PLAN
      // ═══════════════════════════════════════════════════════
      const planRow = await tx.budgetPlan.create({
        data: {
          organizationId: orgId,
          name: `Budget ${year} (Imported)`,
          periodType: "annual",
          year,
          status: "draft",
        },
      })
      results.planCreated = 1

      // ═══════════════════════════════════════════════════════
      // 2. CHART OF ACCOUNTS from P&L sheet
      // ═══════════════════════════════════════════════════════
      const plSheet = wb.getWorksheet("P&L")
      const chartOfAccounts: any[] = []
      const seenCodes = new Set<string>()

      if (plSheet) {
        for (let r = 4; r <= plSheet.rowCount; r++) {
          const row = plSheet.getRow(r)
          const code = getCellValue(row.getCell(1))
          const name = getCellValue(row.getCell(2))
          if (!code || typeof code !== "string" || !code.match(/^\d{3}/)) continue
          if (!name || typeof name !== "string" || name.trim() === "") continue

          const codeStr = code.trim()
          if (seenCodes.has(codeStr)) {
            // Duplicate code with different name — append to make unique
            const uniqueCode = `${codeStr}-r${r}`
            if (seenCodes.has(uniqueCode)) continue
            seenCodes.add(uniqueCode)
            // Skip duplicates — they are the same account used for different products
            continue
          }
          seenCodes.add(codeStr)

          const parts = codeStr.split("-")
          const parentCode = parts.length > 2 ? parts.slice(0, 2).join("-") : parts.length > 1 ? parts[0] : null
          const accountType = classifyAccount(codeStr)
          // Phase 7.G Turn LXXV (Phase 5.1) — stamp the canonical
          // P&L-bucket role at insert. Future per-org override UI will
          // be able to manually re-set this; default is the AAC-prefix
          // derivation. Refresh on upsert too so existing rows backfill
          // when import re-runs (covers cases where the migration's
          // SQL backfill missed the row, e.g. row created post-migration
          // but pre-this-fix).
          const role = deriveRoleFromCode(codeStr)

          chartOfAccounts.push({
            organizationId: orgId,
            code: codeStr,
            name: name.trim(),
            nameAz: name.trim(),
            parentCode,
            accountType,
            role,
            category: categoryFromCode(codeStr),
            sortOrder: r,
            isActive: true,
          })
        }

        // Upsert chart of accounts
        for (const coa of chartOfAccounts) {
          await tx.chartOfAccount.upsert({
            where: { organizationId_code: { organizationId: orgId, code: coa.code } },
            update: { name: coa.name, nameAz: coa.nameAz, parentCode: coa.parentCode, accountType: coa.accountType, role: coa.role, category: coa.category, sortOrder: coa.sortOrder },
            create: coa,
          })
        }
        results.chartOfAccounts = chartOfAccounts.length
      }

      // Load accountId lookup so downstream sections can set the FK on every
      // plan-scoped row. Any code that isn't in the Chart of Accounts just
      // leaves accountId null — legacy string fallback still works.
      const allAccounts = await tx.chartOfAccount.findMany({
        where: { organizationId: orgId },
        select: { id: true, code: true },
      })
      const accountIdByCode = new Map<string, string>(
        allAccounts.map((a: { id: string; code: string }) => [a.code, a.id]),
      )

      // ═══════════════════════════════════════════════════════
      // 3. BUDGET COST TYPES
      // ═══════════════════════════════════════════════════════
      const costTypeIds: Record<string, string> = {}
      for (const ct of COST_TYPE_DEFS) {
        const created = await tx.budgetCostType.upsert({
          where: { organizationId_key: { organizationId: orgId, key: ct.key } },
          update: { label: ct.label, sortOrder: ct.sortOrder },
          create: { organizationId: orgId, key: ct.key, label: ct.label, sortOrder: ct.sortOrder, isActive: true },
        })
        costTypeIds[ct.key] = created.id
      }
      results.costTypes = COST_TYPE_DEFS.length

      // ═══════════════════════════════════════════════════════
      // 4. BUDGET DEPARTMENTS (from product lines as revenue depts)
      // ═══════════════════════════════════════════════════════
      const DEPT_DEFS = [
        { key: "production", label: "İstehsalat (Production)", hasRevenue: false, sortOrder: 1 },
        { key: "sales", label: "Satış və marketinq (Sales & Marketing)", hasRevenue: true, sortOrder: 2 },
        { key: "admin", label: "İnzibati (Administrative)", hasRevenue: false, sortOrder: 3 },
        { key: "finance", label: "Maliyyə (Finance)", hasRevenue: false, sortOrder: 4 },
        { key: "logistics", label: "Logistika (Logistics)", hasRevenue: false, sortOrder: 5 },
        { key: "mhb", label: "MHB (Qaz beton)", hasRevenue: true, sortOrder: 10 },
        { key: "lime_burnt", label: "Yandırılmış əhəng", hasRevenue: true, sortOrder: 11 },
        { key: "lime_slaked", label: "Söndürülmüş əhəng", hasRevenue: true, sortOrder: 12 },
        { key: "adhesive", label: "Yapışqan", hasRevenue: true, sortOrder: 13 },
        { key: "ublock", label: "U-block", hasRevenue: true, sortOrder: 14 },
        { key: "lime_waste", label: "Tullantı əhəng", hasRevenue: true, sortOrder: 15 },
      ]
      const deptIds: Record<string, string> = {}
      for (const d of DEPT_DEFS) {
        const created = await tx.budgetDepartment.upsert({
          where: { organizationId_key: { organizationId: orgId, key: d.key } },
          update: { label: d.label, hasRevenue: d.hasRevenue, sortOrder: d.sortOrder },
          create: { organizationId: orgId, key: d.key, label: d.label, hasRevenue: d.hasRevenue, sortOrder: d.sortOrder, isActive: true },
        })
        deptIds[d.key] = created.id
      }
      results.departments = DEPT_DEFS.length

      // ═══════════════════════════════════════════════════════
      // 5. PRODUCT LINES
      // ═══════════════════════════════════════════════════════
      const createdProducts: any[] = []
      for (let i = 0; i < PRODUCT_CODES.length; i++) {
        const product = await tx.productLine.upsert({
          where: { organizationId_code: { organizationId: orgId, code: PRODUCT_CODES[i] } },
          update: { name: PRODUCT_NAMES[i], unit: PRODUCT_UNITS[i] },
          create: { organizationId: orgId, code: PRODUCT_CODES[i], name: PRODUCT_NAMES[i], unit: PRODUCT_UNITS[i], sortOrder: i },
        })
        createdProducts.push(product)
      }
      results.productLines = createdProducts.length

      // ═══════════════════════════════════════════════════════
      // 6. BUDGET LINES from P&L
      // ═══════════════════════════════════════════════════════
      if (plSheet) {
        const budgetLines: any[] = []
        for (let r = 4; r <= plSheet.rowCount; r++) {
          const row = plSheet.getRow(r)
          const code = getCellValue(row.getCell(1))
          const name = getCellValue(row.getCell(2))
          const nameStr = typeof name === "string" ? name.trim() : ""
          const codeStr = typeof code === "string" ? code.trim() : ""
          if (!nameStr) continue // truly empty rows — not a real skip, no need to log
          if (!codeStr || !codeStr.match(/^\d{3}/)) {
            pushIssue({ sheet: "P&L", row: r, reason: "Account code missing or malformed", rawValue: `code=${code ?? ""} name=${nameStr}` })
            continue
          }

          const lineType = classifyAccount(codeStr)

          for (let m = 0; m < 12; m++) {
            const val = getNumericValue(row.getCell(4 + m))
            if (val !== 0) {
              budgetLines.push({
                organizationId: orgId,
                planId: planRow.id,
                accountId: accountIdByCode.get(codeStr) ?? null,
                category: nameStr,
                department: codeStr,
                lineType,
                plannedAmount: Math.abs(val),
                forecastAmount: Math.abs(val),
                isAutoPlanned: false,
                isAutoActual: false,
                notes: `Imported from P&L row ${r}, ${MONTHS[m]} (account ${codeStr})`,
                sortOrder: r * 100 + m,
                // Phase 7.G Turn XL (A.1): explicit 0-indexed month. The
                // legacy `sortOrder = r * 100 + m` heuristic packs both
                // row position and month into one int (mod-100 = month);
                // monthIndex is the canonical source going forward.
                monthIndex: m,
              })
            }
          }
        }
        if (budgetLines.length > 0) {
          // Phase 1.1 (Turn CXXIII) — chunked savepoints for large imports.
          // 5000-row chunks; small payloads skip savepoint overhead.
          await chunkedCreateMany(tx, tx.budgetLine, budgetLines, {
            skipDuplicates: true,
            savepointPrefix: "budgetlines",
          })
          results.budgetLines = budgetLines.length
        }
      }

      // ═══════════════════════════════════════════════════════
      // 7. SALES BUDGET LINES from S-1..S-6
      // ═══════════════════════════════════════════════════════
      const salesData: any[] = []
      for (let si = 0; si < SALES_SHEETS.length; si++) {
        const sheet = wb.getWorksheet(SALES_SHEETS[si])
        if (!sheet || !createdProducts[si]) continue

        let qtyRow = 0, amountRow = 0, priceRow = 0

        for (let r = 1; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r)
          const yearVal = getCellValue(row.getCell(2))
          const typeVal = getCellValue(row.getCell(3))
          const catVal = getCellValue(row.getCell(4))

          if (yearVal !== year && yearVal !== String(year)) continue
          if (!typeVal || typeof typeVal !== "string") continue
          const catStr = catVal && typeof catVal === "string" ? catVal.toLowerCase() : ""

          if (typeVal === "Miqdar" && catStr.includes("cəmi")) qtyRow = r
          if (typeVal === "Məbləğ" && catStr.includes("cəmi")) amountRow = r
          if (typeVal === "Qiymət" && catStr && !catStr.includes("cəmi") && !priceRow) priceRow = r
        }

        for (let m = 0; m < 12; m++) {
          const qty = qtyRow ? getNumericValue(sheet.getRow(qtyRow).getCell(5 + m)) : 0
          const amount = amountRow ? getNumericValue(sheet.getRow(amountRow).getCell(5 + m)) : 0
          let price = priceRow ? getNumericValue(sheet.getRow(priceRow).getCell(5 + m)) : 0
          if (price === 0 && qty > 0 && amount > 0) price = amount / qty

          if (qty > 0 || amount > 0) {
            salesData.push({
              organizationId: orgId,
              planId: planRow.id,
              productLineId: createdProducts[si].id,
              year,
              month: m + 1,
              quantity: qty,
              unitPrice: price,
              amount: amount || qty * price,
            })
          }
        }
      }
      if (salesData.length > 0) {
        await chunkedCreateMany(tx, tx.salesBudgetLine, salesData, {
          skipDuplicates: true,
          savepointPrefix: "salesbudget",
        })
        results.salesBudgetLines = salesData.length
      }

      // ═══════════════════════════════════════════════════════
      // 8. SALES FORECAST (from S-all consolidated sheet)
      // ═══════════════════════════════════════════════════════
      const sAllSheet = wb.getWorksheet("S-all")
      if (sAllSheet) {
        const productDeptMap: Record<string, string> = {
          "mhb": "mhb", "qaz beton": "mhb",
          "yandırılmış": "lime_burnt", "yanmış": "lime_burnt", "əhəng yanmış": "lime_burnt",
          "söndürülmüş": "lime_slaked", "sönmüş": "lime_slaked", "əhəng sönmüş": "lime_slaked",
          "yapışqan": "adhesive",
          "u-block": "ublock", "u block": "ublock",
          "tullantı": "lime_waste",
        }
        let forecastCount = 0

        // S-all structure: header rows have product name in col 2,
        // "CƏMİ məbləğ:" total rows have amounts in cols 3-14 (Jan-Dec)
        // Track current product section from header rows
        let currentDept: string | null = null

        for (let r = 1; r <= sAllSheet.rowCount; r++) {
          const row = sAllSheet.getRow(r)
          const col2 = getCellValue(row.getCell(2))
          if (!col2 || typeof col2 !== "string") continue
          const col2Lower = col2.toLowerCase().trim()

          // Check if this is a product header row (has month names in cols 3+)
          const col3Val = getCellValue(row.getCell(3))
          if (col3Val === "Jan" || col3Val === "Yan") {
            // This is a header row — match product name
            for (const [keyword, deptKey] of Object.entries(productDeptMap)) {
              if (col2Lower.includes(keyword)) { currentDept = deptKey; break }
            }
            continue
          }

          // Check if this is a "CƏMİ məbləğ:" total row or a "Məbləğ" row
          const isTotal = col2Lower.includes("cəmi") && col2Lower.includes("məbləğ")
          const col3 = getCellValue(row.getCell(3))
          const isMebleg = col3 === "Məbləğ"

          if (!isTotal && !isMebleg) continue
          if (!currentDept || !deptIds[currentDept]) continue

          // Values are in cols 3-14 (for CƏMİ rows) or cols 5-16 (for Məbləğ rows)
          const startCol = isTotal ? 3 : 5

          for (let m = 0; m < 12; m++) {
            const val = getNumericValue(row.getCell(startCol + m))
            if (val !== 0) {
              await tx.salesForecast.upsert({
                where: {
                  organizationId_departmentId_year_month: {
                    organizationId: orgId,
                    departmentId: deptIds[currentDept]!,
                    year,
                    month: m + 1,
                  },
                },
                update: { amount: Math.abs(val) },
                create: {
                  organizationId: orgId,
                  departmentId: deptIds[currentDept]!,
                  year,
                  month: m + 1,
                  amount: Math.abs(val),
                },
              })
              forecastCount++
            }
          }

          // Reset dept after consuming total to prevent double-matching
          if (isTotal) currentDept = null
        }
        results.salesForecasts = forecastCount
      }

      // ═══════════════════════════════════════════════════════
      // 9. BALANCE SHEET LINES from BS sheet
      // ═══════════════════════════════════════════════════════
      const bsSheet = wb.getWorksheet("BS")
      if (bsSheet) {
        const bsLines: any[] = []
        const skipPatterns = ["CƏMİ", "KONTROL", "KAPİTAL", "QISAMÜDDƏTLİ AKTİV", "UZUNMÜDDƏTLİ AKTİV", "QISAMÜDDƏTLİ ÖHDƏLİK", "UZUNMÜDDƏTLİ ÖHDƏLİK"]
        const parentNames = [
          "torpaq, tikili və avadanlıqlar", "qeyri-maddi aktivlər",
          "pul vəsaitləri və onların ekvivalentləri", "qısamüddətli debitor borcları",
          "sair qısamüddətli aktivlər", "ehtiyatlar",
          "uzunmüddətli faiz xərcləri yaradan öhdəliklər", "qısamüddətli kreditor borcları",
          "sair qısamüddətli öhdəliklər", "vergi və sair məcburi ödənişlər üzrə öhdəliklər",
          "ödənilmiş nominal (nizamnamə) kapital", "bölüşdürülməmiş mənfəət (ödənilməmiş zərər)",
        ]

        for (let r = 4; r <= Math.min(180, bsSheet.rowCount); r++) {
          const row = bsSheet.getRow(r)
          const name = getCellValue(row.getCell(2))
          if (!name || typeof name !== "string" || name.trim() === "") continue

          const nameUpper = name.toUpperCase().trim()
          const nameLower = name.toLowerCase().trim()
          if (skipPatterns.some(p => nameUpper === p || nameUpper.startsWith(p + " ") || nameUpper.startsWith(p + "L"))) {
            pushIssue({ sheet: "BS", row: r, reason: "Section header (summary row, not imported)", rawValue: name })
            continue
          }
          if (parentNames.includes(nameLower)) {
            pushIssue({ sheet: "BS", row: r, reason: "Parent aggregate row (imported as children)", rawValue: name })
            continue
          }

          let lineType = "asset"
          if ((nameLower.includes("öhdəlik") || nameLower.includes("kreditor") ||
               nameLower.includes("kredit") || nameLower.includes("maliyyələşmə") ||
               nameLower.includes("maliyyələşdirmə") || nameLower.includes("sığorta") ||
               nameLower.includes("vergi öhdəlik") || (nameLower.includes("alınmış") && nameLower.includes("avans"))) &&
              !nameLower.includes("debitor")) lineType = "liability"
          else if ((nameLower.includes("kapital") && !nameLower.includes("kapitallaşdırılması")) ||
                   nameLower.includes("mənfəət") || nameLower.includes("ehtiyat") ||
                   nameLower.includes("bölüşdürülməmiş") || nameLower.includes("nizamnamə") ||
                   nameLower.includes("yenidən qiymət") || nameLower.includes("səhmdar") ||
                   nameLower.includes("divident") || nameLower.includes("emissiya")) lineType = "equity"

          for (let m = 0; m < 12; m++) {
            const val = getNumericValue(row.getCell(5 + m))
            bsLines.push({
              organizationId: orgId,
              planId: planRow.id,
              accountCode: `BS-${r}`,
              accountName: name.trim(),
              lineType,
              year,
              month: m + 1,
              amount: val,
            })
          }
        }
        if (bsLines.length > 0) {
          await chunkedCreateMany(tx, tx.balanceSheetLine, bsLines, {
            skipDuplicates: true,
            savepointPrefix: "balancesheet",
          })
          results.balanceSheetLines = bsLines.length
        }
      }

      // ═══════════════════════════════════════════════════════
      // 10. COGS BUDGET LINES from COGS sheet
      // ═══════════════════════════════════════════════════════
      // COGS sheet structure:
      //   Section header (col 2): "MHB maya dəyəri", "Əhəng (yanmış) maya dəyəri", etc.
      //   "Məbləğ" row (col 3 = "Məbləğ"): actual cost amounts in cols 5-16 (Jan-Dec)
      //   "Daşıma" section has "Məbləğ" row too
      const cogsSheet = wb.getWorksheet("COGS")
      if (cogsSheet) {
        const cogsData: any[] = []
        let currentProductId: string | null = null

        for (let r = 1; r <= cogsSheet.rowCount; r++) {
          const row = cogsSheet.getRow(r)
          const col2 = getCellValue(row.getCell(2))
          const col3 = getCellValue(row.getCell(3))

          // Detect product section headers (col 2 has product name)
          if (col2 && typeof col2 === "string") {
            const nameLower = col2.toLowerCase()
            if (nameLower.includes("mhb") || nameLower.includes("qaz beton")) currentProductId = createdProducts[0]?.id
            else if ((nameLower.includes("əhəng") && nameLower.includes("yanmış")) || nameLower.includes("yandırılmış")) currentProductId = createdProducts[1]?.id
            else if ((nameLower.includes("əhəng") && nameLower.includes("sönmüş")) || nameLower.includes("söndürülmüş")) currentProductId = createdProducts[2]?.id
            else if (nameLower.includes("yapışqan")) currentProductId = createdProducts[3]?.id
            else if (nameLower.includes("u-block") || nameLower.includes("u block")) currentProductId = createdProducts[4]?.id
            else if (nameLower.includes("tullantı")) currentProductId = createdProducts[5]?.id
            else if (nameLower.includes("daşıma")) currentProductId = null // transport = service COGS, skip product
            else if (nameLower.includes("istehsaldan") || nameLower.includes("cəmi")) currentProductId = null
          }

          // Look for "Məbləğ" rows (col 3 = "Məbləğ") — these have the actual cost values
          if (col3 !== "Məbləğ") continue
          if (!currentProductId) continue

          // Values in cols 5-16 (Jan-Dec)
          for (let m = 0; m < 12; m++) {
            const val = getNumericValue(row.getCell(5 + m))
            if (val !== 0) {
              cogsData.push({
                organizationId: orgId,
                planId: planRow.id,
                productLineId: currentProductId,
                year,
                month: m + 1,
                totalCost: Math.abs(val),
              })
            }
          }
        }
        // Aggregate by productLineId+month (unique constraint: planId+productLineId+year+month)
        // Multiple sub-products (e.g. MHB 1-ci növ + 2-ci növ) must be summed
        const cogsAgg = new Map<string, any>()
        for (const c of cogsData) {
          const key = `${c.productLineId}||${c.month}`
          const existing = cogsAgg.get(key)
          if (existing) {
            existing.totalCost += c.totalCost
          } else {
            cogsAgg.set(key, { ...c })
          }
        }
        const cogsAggData = [...cogsAgg.values()]
        if (cogsAggData.length > 0) {
          await chunkedCreateMany(tx, tx.cOGSBudgetLine, cogsAggData, {
            skipDuplicates: true,
            savepointPrefix: "cogsbudget",
          })
          results.cogsLines = cogsAggData.length
        }
      }

      // ═══════════════════════════════════════════════════════
      // 10b. COGS COST DETAILS from C-1..C-4 sheets (drill-down breakdown)
      // ═══════════════════════════════════════════════════════
      // Each C-sheet: multi-stage or single-stage with sections:
      //   "Qeyri-xammal xərclər (703)" / "istehsal xərci" → indirect costs (SAP codes 703-*)
      //   "Xammal xərcləri:" → raw materials
      //   "İstehsal:" / "İstehsalat" → production qty
      //   "Vahid maya dəyəri" → unit cost (final row of each stage)
      // Month columns vary per sheet — detect from header row
      const C_SHEET_MAP: { sheet: string; productIdx: number | null }[] = [
        { sheet: "C-1", productIdx: null },       // Qum (sand) — intermediate, link to all lime
        { sheet: "C-2", productIdx: 1 },          // Yandırılmış əhəng
        { sheet: "C-3", productIdx: 2 },          // Söndürülmüş əhəng
        { sheet: "C-4", productIdx: 0 },          // MHB
      ]
      const detailRows: any[] = []

      for (const cMap of C_SHEET_MAP) {
        const sheet = wb.getWorksheet(cMap.sheet)
        if (!sheet || cMap.productIdx === null) continue
        const productId = createdProducts[cMap.productIdx]?.id
        if (!productId) continue

        // Detect month header row — scan first 5 rows for "Jan" or "Yanvar"
        let monthStartCol = 0
        for (let r = 1; r <= 5; r++) {
          const row = sheet.getRow(r)
          for (let c = 1; c <= 20; c++) {
            const v = getCellValue(row.getCell(c))
            if (v && typeof v === "string" && /^(jan|yan)/i.test(v.toString().trim())) {
              monthStartCol = c
              break
            }
          }
          if (monthStartCol > 0) break
        }
        if (monthStartCol === 0) continue

        let currentStage: string | null = null
        let currentSection: "indirect" | "raw_material" | null = null
        let sortCounter = 0

        for (let r = 1; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r)
          // Concatenate all text cells to find labels across various columns
          const cellTexts: string[] = []
          for (let c = 1; c <= 6; c++) {
            const v = getCellValue(row.getCell(c))
            if (v && typeof v === "string") cellTexts.push(v.trim())
          }
          const joined = cellTexts.join(" | ").toLowerCase()

          // Detect stage headers (for multi-stage like C-2: partladılmış, yararlı, yanmış)
          if (joined.includes("partladılmış")) { currentStage = "partladılmış"; currentSection = null; continue }
          if (joined.includes("yararlı") && joined.includes("əhəng")) { currentStage = "yararlı"; currentSection = null; continue }
          if (joined.includes("yanmış") && joined.includes("əhəng")) { currentStage = "yanmış"; currentSection = null; continue }
          if (joined.includes("sönmüş") && joined.includes("əhəng")) { currentStage = "sönmüş"; currentSection = null; continue }

          // Detect section boundaries (Turn LXV — Phase 2.2: matchers
          // moved to `src/lib/import/keywords.ts` shared catalog).
          if (isIndirectCostHeader(joined)) currentSection = "indirect"
          if (isRawMaterialHeader(joined)) currentSection = "raw_material"

          // Parse detail rows (have monthly numeric values)
          // Find a label — first non-empty text cell
          let label = ""
          let accountCode: string | null = null
          for (let c = 1; c <= 6; c++) {
            const v = getCellValue(row.getCell(c))
            if (!v) continue
            if (typeof v === "string" && v.trim().length > 2) {
              const s = v.trim()
              // SAP code pattern (703-xxx) — Turn LXV: shared keyword catalog.
              if (looksLikeCostAccount(s)) { accountCode = s; continue }
              if (!label) label = s
            }
          }
          if (!label) continue

          // Skip section headers themselves (no numeric values in month cols).
          // Turn LXV: HEADER_COST_CENTER_LOWER + HEADER_NON_RAW_MATERIAL_PREFIX_LOWER
          // moved to shared catalog. `startsWith` semantics preserved verbatim.
          const labelLower = label.toLowerCase()
          if (labelLower === HEADER_COST_CENTER_LOWER || labelLower.startsWith(HEADER_NON_RAW_MATERIAL_PREFIX_LOWER)) continue
          if (labelLower.startsWith(HEADER_RAW_MATERIAL_PREFIX_LOWER)) continue

          // Collect monthly values
          const monthlyVals: number[] = []
          let hasValues = false
          for (let m = 0; m < 12; m++) {
            const v = getNumericValue(row.getCell(monthStartCol + m))
            monthlyVals.push(v)
            if (v !== 0) hasValues = true
          }
          if (!hasValues) continue

          // Classify cost type
          let costType: "raw_material" | "indirect" | "production" | "unit_cost" = "indirect"
          if (labelLower.includes("vahid maya dəyəri")) costType = "unit_cost"
          else if (labelLower === "istehsal:" || labelLower === "istehsalat" || labelLower === "istehsal") costType = "production"
          else if (currentSection === "raw_material") costType = "raw_material"
          else if (currentSection === "indirect") costType = "indirect"
          else continue // skip rows outside known sections

          sortCounter++
          for (let m = 0; m < 12; m++) {
            if (monthlyVals[m] === 0) continue
            detailRows.push({
              organizationId: orgId,
              planId: planRow.id,
              productLineId: productId,
              costType,
              label: label.substring(0, 200),
              accountCode,
              stage: currentStage,
              year,
              month: m + 1,
              amount: Math.abs(monthlyVals[m]),
              sortOrder: sortCounter,
            })
          }
        }
      }

      if (detailRows.length > 0) {
        await chunkedCreateMany(tx, tx.cOGSCostDetail, detailRows, {
          skipDuplicates: true,
          savepointPrefix: "cogsdetail",
        })
        results.cogsCostDetails = detailRows.length
      }

      // ═══════════════════════════════════════════════════════
      // 11. COST COMPONENTS (raw material recipes from A9)
      // ═══════════════════════════════════════════════════════
      const a9Sheet = wb.getWorksheet("A9")
      if (a9Sheet && createdProducts[0]) {
        let compCount = 0
        // A9 has material names in col 2, monthly consumption in col 3+
        for (let r = 7; r <= Math.min(20, a9Sheet.rowCount); r++) {
          const row = a9Sheet.getRow(r)
          const name = getCellValue(row.getCell(2))
          if (!name || typeof name !== "string" || name.trim() === "") continue

          // Get average monthly consumption as rate
          let total = 0, count = 0
          for (let m = 0; m < 12; m++) {
            const v = getNumericValue(row.getCell(3 + m))
            if (v > 0) { total += v; count++ }
          }
          const avgConsumption = count > 0 ? total / count : 0
          if (avgConsumption <= 0) continue

          await tx.costComponent.upsert({
            where: {
              id: `${orgId}-${createdProducts[0].id}-${name.trim().substring(0, 30)}`,
            },
            update: { consumptionRate: avgConsumption },
            create: {
              organizationId: orgId,
              productLineId: createdProducts[0].id,
              name: name.trim(),
              unit: "AZN",
              consumptionRate: avgConsumption,
              unitCost: 0,
              sortOrder: r,
            },
          }).catch(() => {
            // If upsert by generated ID fails, create new
            return tx.costComponent.create({
              data: {
                organizationId: orgId,
                productLineId: createdProducts[0].id,
                name: name.trim(),
                unit: "AZN",
                consumptionRate: avgConsumption,
                unitCost: 0,
                sortOrder: r,
              },
            })
          })
          compCount++
        }
        results.costComponents = compCount
      }

      // ═══════════════════════════════════════════════════════
      // 12. BUDGET ASSUMPTIONS from A0..A14
      // ═══════════════════════════════════════════════════════
      let assumptionCount = 0
      for (const aDef of ASSUMPTION_SHEETS) {
        const sheet = wb.getWorksheet(aDef.sheet)
        if (!sheet) continue

        for (let r = 1; r <= sheet.rowCount; r++) {
          const row = sheet.getRow(r)
          // Try to find rows with label + value pattern
          let label = ""
          let accountCode = ""
          let value = 0
          let unit = ""

          // Collect all string candidates from first 6 cols
          // Prefer descriptive text (longer, contains letters) over SAP codes
          const textCandidates: string[] = []
          for (let c = 1; c <= 6; c++) {
            const cv = getCellValue(row.getCell(c))
            if (typeof cv === "string" && cv.trim().length > 2) {
              const s = cv.trim()
              // Detect SAP account code pattern (3 digits + dash, e.g. 721-11-01, 703-105)
              if (/^\d{3}(-\d+)+$/.test(s)) {
                if (!accountCode) accountCode = s
              } else {
                textCandidates.push(s)
              }
            }
            if (typeof cv === "number" && cv !== 0 && value === 0) {
              value = cv
            }
          }
          // Pick the longest descriptive text as label (skip pure numeric/unit strings)
          label = textCandidates.sort((a, b) => b.length - a.length)[0] || accountCode

          // Also check for unit hints
          for (let c = 1; c <= 6; c++) {
            const cv = getCellValue(row.getCell(c))
            if (typeof cv === "string") {
              const lower = cv.toLowerCase()
              if (lower === "azn" || lower === "%" || lower === "ton" || lower === "m3" ||
                  lower === "ədəd" || lower === "ay" || lower === "litr") {
                unit = cv
              }
            }
          }

          if (!label || label.length > 200) continue // truly empty / junk row — skip silently
          if (value === 0) {
            pushIssue({ sheet: aDef.sheet, row: r, reason: "Zero value — assumption row not imported", rawValue: label })
            continue
          }

          // Skip header-like rows
          const labelLower = label.toLowerCase()
          if (labelLower.includes("cəmi") || labelLower.includes("total") || labelLower.includes("hesablanmış")) {
            pushIssue({ sheet: aDef.sheet, row: r, reason: "Summary row (cəmi/total/hesablanmış) — not imported", rawValue: label })
            continue
          }

          await tx.budgetAssumption.create({
            data: {
              organizationId: orgId,
              planId: planRow.id,
              category: aDef.category,
              key: `${aDef.sheet}-r${r}`,
              label: label.substring(0, 200),
              value,
              unit: unit || null,
              period: null,
              notes: accountCode ? `${accountCode} — ${aDef.label} (${aDef.sheet}, row ${r})` : `${aDef.label} (${aDef.sheet}, row ${r})`,
              sortOrder: r,
            },
          })
          assumptionCount++
        }
      }
      results.assumptions = assumptionCount

      // ═══════════════════════════════════════════════════════
      // 13. CASH FLOW from CF sheet
      // ═══════════════════════════════════════════════════════
      const cfSheet = wb.getWorksheet("CF")
      if (cfSheet) {
        let cfCount = 0
        // Determine activity type and entry type from row position
        let currentActivity = "operating"
        let currentEntryType = "inflow"

        for (let r = 3; r <= cfSheet.rowCount; r++) {
          const row = cfSheet.getRow(r)
          // Labels are in column 1 (not column 2) in this sheet
          const labelCol1 = getCellValue(row.getCell(1))
          const labelCol2 = getCellValue(row.getCell(2))
          const label = (typeof labelCol1 === "string" && labelCol1.trim().length > 2)
            ? labelCol1
            : (typeof labelCol2 === "string" && labelCol2.trim().length > 2) ? labelCol2 : null
          if (!label || typeof label !== "string") continue
          const labelLower = label.toLowerCase().trim()

          // Detect activity sections
          if (labelLower.includes("əsas fəaliyyəti") || labelLower.includes("cari fəaliyyət")) currentActivity = "operating"
          else if (labelLower.includes("maliyyə fəaliyyəti")) currentActivity = "financing"
          else if (labelLower.includes("investisiya fəaliyyəti")) currentActivity = "investing"

          // Detect in/out
          if (labelLower.includes("mədaxil")) currentEntryType = "inflow"
          else if (labelLower.includes("məxaric")) currentEntryType = "outflow"

          // Skip section headers, totals, balances
          if (labelLower.includes("cəmi") || labelLower.includes("kontrol") ||
              labelLower.includes("sona qalıq") || labelLower.includes("əvvələ qalıq") ||
              labelLower.includes("pul hərəkəti") || labelLower.includes("pul və pul")) continue

          // Extract monthly values (columns 4-15 = Jan-Dec for budget year)
          for (let m = 0; m < 12; m++) {
            const val = getNumericValue(row.getCell(4 + m))
            if (val === 0) continue

            await tx.cashFlowEntry.create({
              data: {
                organizationId: orgId,
                year,
                month: m + 1,
                entryType: currentEntryType,
                source: "excel_import",
                amount: Math.abs(val),
                description: label.trim(),
                isProjected: true,
                activityType: currentActivity,
                category: label.trim().substring(0, 100),
                plannedAmount: Math.abs(val),
              },
            })
            cfCount++
          }
        }
        results.cashFlowEntries = cfCount
      }

      // ═══════════════════════════════════════════════════════
      // 14. EXPENSE FORECAST (from P&L expense totals by cost type)
      // ═══════════════════════════════════════════════════════
      if (plSheet) {
        let efCount = 0
        // Group P&L expense lines by cost type category and sum monthly values
        const expenseByType: Record<string, number[]> = {}

        for (let r = 4; r <= plSheet.rowCount; r++) {
          const row = plSheet.getRow(r)
          const code = getCellValue(row.getCell(1))
          if (!code || typeof code !== "string" || !code.match(/^\d{3}/)) continue

          const cat = categoryFromCode(code.trim())
          if (!cat || cat === "sales" || cat === "returns" || cat === "discounts" || cat === "cogs") continue

          if (!expenseByType[cat]) expenseByType[cat] = new Array(12).fill(0)

          for (let m = 0; m < 12; m++) {
            const val = getNumericValue(row.getCell(4 + m))
            expenseByType[cat][m] += Math.abs(val)
          }
        }

        for (const [cat, months] of Object.entries(expenseByType)) {
          const ctId = costTypeIds[cat]
          if (!ctId) continue

          for (let m = 0; m < 12; m++) {
            if (months[m] === 0) continue
            await tx.expenseForecast.create({
              data: {
                organizationId: orgId,
                costTypeId: ctId,
                year,
                month: m + 1,
                amount: months[m],
              },
            })
            efCount++
          }
        }
        results.expenseForecasts = efCount
      }

      return planRow
    }, { maxWait: 10_000, timeout: 120_000 })
    // ═══════════════════════════════════════════════════════
    // 15. AUTO-CREATE ROLLING FORECAST PLAN (from imported data)
    // ═══════════════════════════════════════════════════════
    try {
      // Delete any existing rolling plans for this org (clean slate)
      const existingRolling = await prisma.budgetPlan.findMany({
        where: { organizationId: orgId, isRolling: true },
        select: { id: true },
      })
      if (existingRolling.length > 0) {
        const rollingIds = existingRolling.map((p: { id: string }) => p.id)
        await prisma.$transaction([
          prisma.budgetForecastEntry.deleteMany({ where: { planId: { in: rollingIds } } }),
          prisma.rollingForecastMonth.deleteMany({ where: { planId: { in: rollingIds } } }),
          prisma.budgetActual.deleteMany({ where: { planId: { in: rollingIds } } }),
          prisma.budgetLine.deleteMany({ where: { planId: { in: rollingIds } } }),
          prisma.budgetPlan.deleteMany({ where: { id: { in: rollingIds } } }),
        ])
      }

      const startMonth = new Date().getMonth() + 1 // current month
      const startYear = year

      const rollingPlan = await prisma.budgetPlan.create({
        data: {
          organizationId: orgId,
          name: `Rolling Forecast ${year}`,
          periodType: "monthly",
          year: startYear,
          month: startMonth,
          isRolling: true,
          rollingMonths: 12,
          status: "draft",
        },
      })

      // Create 12 rolling months
      const monthEntries: { organizationId: string; planId: string; year: number; month: number; status: string }[] = []
      let ry = startYear
      let rm = startMonth
      for (let i = 0; i < 12; i++) {
        monthEntries.push({ organizationId: orgId, planId: rollingPlan.id, year: ry, month: rm, status: "forecast" })
        rm++
        if (rm > 12) { rm = 1; ry++ }
      }
      await prisma.rollingForecastMonth.createMany({ data: monthEntries })

      // Clone budget lines from imported plan → rolling plan
      const importedLines = await prisma.budgetLine.findMany({ where: { planId: plan.id } })
      const parentLines = importedLines.filter((sl: any) => !sl.parentId)
      const childLines = importedLines.filter((sl: any) => sl.parentId)
      const idMapping = new Map<string, string>()

      for (const sl of parentLines) {
        const created = await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId: rollingPlan.id, category: sl.category,
            department: sl.department, lineType: sl.lineType,
            // Preserve the FK to Chart of Accounts so the Rolling Forecast plan
            // displays canonical names in the same way as the main budget plan.
            accountId: sl.accountId,
            plannedAmount: sl.plannedAmount, costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            lineSubtype: sl.lineSubtype, parentId: null,
          },
        })
        idMapping.set(sl.id, created.id)
      }
      for (const sl of childLines) {
        const newParentId = sl.parentId ? idMapping.get(sl.parentId) ?? null : null
        await prisma.budgetLine.create({
          data: {
            organizationId: orgId, planId: rollingPlan.id, category: sl.category,
            department: sl.department, lineType: sl.lineType,
            accountId: sl.accountId,
            plannedAmount: sl.plannedAmount, costModelKey: sl.costModelKey,
            isAutoActual: false, isAutoPlanned: false,
            notes: sl.notes, sortOrder: sl.sortOrder,
            lineSubtype: sl.lineSubtype, parentId: newParentId,
          },
        })
      }

      // Create forecast entries for rolling plan — aggregate by category+lineType per month
      const rollingLines = await prisma.budgetLine.findMany({ where: { planId: rollingPlan.id } })
      // Group imported budget lines by category+lineType to get monthly amounts
      const importedByKey = new Map<string, { category: string; lineType: string; total: number }>()
      for (const line of importedLines) {
        const key = `${line.category}||${line.lineType}`
        const existing = importedByKey.get(key)
        if (existing) {
          existing.total += line.plannedAmount
        } else {
          importedByKey.set(key, { category: line.category, lineType: line.lineType, total: line.plannedAmount })
        }
      }

      // Create forecast entries: distribute annual total / 12 for each rolling month
      const forecastEntries: any[] = []
      for (const [, data] of importedByKey) {
        const monthlyAmount = data.total / 12
        if (monthlyAmount <= 0) continue
        for (const me of monthEntries) {
          forecastEntries.push({
            organizationId: orgId,
            planId: rollingPlan.id,
            year: me.year,
            month: me.month,
            category: data.category,
            lineType: data.lineType,
            forecastAmount: Math.round(monthlyAmount * 100) / 100,
          })
        }
      }
      if (forecastEntries.length > 0) {
        await prisma.budgetForecastEntry.createMany({ data: forecastEntries })
      }

      results.rollingPlanCreated = 1
      results.rollingMonths = 12
      results.rollingForecastEntries = forecastEntries.length
    } catch (e) {
      console.error("[Import Excel] Rolling plan auto-create error:", e)
      results.rollingPlanError = (e as any)?.message || "Unknown error"
    }

    return NextResponse.json({
      success: true,
      planId: plan.id,
      planName: plan.name,
      results,
      sheetsFound: wb.worksheets.map((ws) => ws.name),
      issues,
      issuesTruncated,
      issueCount: issues.length + (issuesTruncated ? 1 : 0),
    })
  } catch (err: any) {
    console.error("[Import Excel]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
