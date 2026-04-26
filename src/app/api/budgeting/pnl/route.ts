import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"

// P&L structure sections
const PNL_SECTIONS = [
  { key: "revenue", label: "Net satış gəlirləri", codes: ["601", "602", "603"] },
  { key: "cogs", label: "Maya dəyəri", codes: ["701"] },
  { key: "gross_profit", label: "Məcmu gəlir", computed: true },
  { key: "other_income", label: "Digər gəlirlər", codes: ["611"] },
  { key: "sales_expenses", label: "Satış, marketinq və distribusiya xərcləri", codes: ["711"] },
  { key: "admin_expenses", label: "İnzibati xərclər", codes: ["721"] },
  { key: "ebitda", label: "FVƏA mənfəəti (EBITDA)", computed: true },
  { key: "depreciation", label: "Amortizasiya", codes: ["731"] },
  { key: "ebit", label: "Əməliyyat mənfəəti (EBIT)", computed: true },
  { key: "finance_costs", label: "Maliyyə xərcləri", codes: ["741", "751", "801"] },
  { key: "ebt", label: "Vergidən əvvəl mənfəət (EBT)", computed: true },
  { key: "extraordinary", label: "Fövqəladə xərclər", codes: ["761"] },
  { key: "tax", label: "Vergi xərcləri", codes: ["771"] },
  { key: "net_profit", label: "Xalis mənfəət", computed: true },
]

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  const yearOverride = searchParams.get("year")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Resolve plan year up-front — we need it to filter actuals by expenseDate.
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, deletedAt: null },
    select: { year: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  const year = yearOverride ? parseInt(yearOverride) : plan.year

  // Turn 30: per-daughter-company filter (mirrors analytics route).
  // null/undefined → org-wide consolidated; level=2 → single op-co;
  // level=1 → expand to children. Cross-tenant id → 404.
  const companyIdParam = searchParams.get("companyId")
  const companyFilter = await resolveCompanyFilter(prisma, orgId, companyIdParam)
  if (companyFilter.kind === "not_found") {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }
  const blWhere: { organizationId: string; planId: string; companyId?: { in: string[] } } = {
    organizationId: orgId,
    planId,
  }
  if (companyFilter.kind === "single") {
    if (companyFilter.companyIds.length === 0) {
      // Sub-group with no children — return empty rows; year stays correct.
      // Turn 33 (architect Round-1 ⚠️ envelope asymmetry close): include
      // `success: true` so consumers can shape-check uniformly with
      // analytics route which uses the {success, data} wrapper. Pnl
      // non-empty path returns bare body (project legacy); the `success`
      // key here is additive — non-Turn-33 consumers ignore it.
      return NextResponse.json({
        success: true,
        sections: [], rows: [], monthlyRevenue: {}, monthlyCogs: {},
        monthlyActualRevenue: {}, monthlyActualCogs: {}, actualByKey: {},
        actualMonthlyByKey: {}, sectionActuals: {}, year, hasActuals: false,
        _emptyReason: "subgroup_no_children",
      })
    }
    blWhere.companyId = { in: companyFilter.companyIds }
  }

  // Get all budget lines + sales + COGS data + actuals
  const [budgetLines, salesLines, cogsLines, actuals] = await Promise.all([
    prisma.budgetLine.findMany({
      where: blWhere,
      // Include the FK'd account so reads prefer canonical code/name from
      // the Chart of Accounts over the denormalised category/department strings
      include: { account: { select: { code: true, name: true, accountType: true } } },
    }),
    prisma.salesBudgetLine.findMany({
      where: { organizationId: orgId, planId, year },
      include: { productLine: true },
    }),
    prisma.cOGSBudgetLine.findMany({
      where: { organizationId: orgId, planId, year },
      include: { productLine: true },
    }),
    prisma.budgetActual.findMany({
      where: { organizationId: orgId, planId },
      select: {
        category: true,
        department: true,
        lineType: true,
        actualAmount: true,
        expenseDate: true,
      },
    }),
  ])

  // Monthly totals will be computed from budget_lines after filtering parents
  const monthlyRevenue: Record<number, number> = {}
  const monthlyCogs: Record<number, number> = {}
  for (let m = 1; m <= 12; m++) {
    monthlyRevenue[m] = 0
    monthlyCogs[m] = 0
  }

  // Build P&L rows grouped by account code + department name
  // This ensures products sharing the same SAP code (e.g. 601-01-02) appear as separate rows
  const accountMap = new Map<string, { code: string; name: string; type: string; sortOrder: number; monthlyAmounts: Record<number, number> }>()

  type BL = (typeof budgetLines)[number]
  budgetLines.forEach((bl: BL) => {
    // Preferred path: the FK to Chart of Accounts is set, so use canonical
    // code + name from there. Everything else is fallback for legacy rows
    // imported before Phase 2.1.
    let code: string
    let name: string
    if (bl.account) {
      code = bl.account.code
      name = bl.account.name
    } else {
      // Legacy rows: after the Phase 0 import refactor we flipped the fields,
      // so category holds the name and department holds the code — but earlier
      // rows may still be the other way around. Detect by shape.
      const maybeCode = bl.department || ""
      const maybeName = bl.category || ""
      const looksLikeCode = (s: string) => /^\d{3}/.test(s)
      code = looksLikeCode(maybeCode) ? maybeCode : (looksLikeCode(maybeName) ? maybeName : maybeCode || "other")
      name = code === maybeCode ? (maybeName || code) : (maybeCode || code)
    }
    const mapKey = `${code}::${name}` // unique key per code+name

    if (!accountMap.has(mapKey)) {
      let accountType = bl.account?.accountType ?? "expense"
      if (!bl.account) {
        if (code.startsWith("601") || code.startsWith("611")) accountType = "revenue"
        else if (code.startsWith("602") || code.startsWith("603")) accountType = "revenue"
        else if (code.startsWith("701")) accountType = "cogs"
      }

      accountMap.set(mapKey, {
        code,
        name,
        type: accountType,
        sortOrder: bl.sortOrder,
        monthlyAmounts: {},
      })
    }

    const monthFromSort = bl.sortOrder % 100
    const month = monthFromSort >= 0 && monthFromSort < 12 ? monthFromSort + 1 : 0
    if (month >= 1 && month <= 12) {
      const acct = accountMap.get(mapKey)!
      acct.monthlyAmounts[month] = (acct.monthlyAmounts[month] || 0) + bl.plannedAmount
    }
  })

  // Filter out parent summary accounts to avoid double-counting
  // A parent code is one that has child codes (e.g. 601-01 has child 601-01-02)
  //
  // Turn 30: parent detection scoped per-company. Multiple companies share
  // the SAP-style codespace; without per-company scoping, cross-company
  // aliasing dropped real revenue (company A's "601" total looked like
  // parent of company B's "601-04-99" leaf). Build (companyId → Set<code>)
  // map from raw budgetLines, then `isParentCode(code)` returns true only
  // if SOME company has both `code` AND a descendant starting with `code-`.
  const codesByCompanyPnl = new Map<string, Set<string>>()
  for (const bl of budgetLines as any[]) {
    const code = bl.account?.code ?? bl.department ?? ""
    if (!code) continue
    const cid = bl.companyId ?? ""
    let bucket = codesByCompanyPnl.get(cid)
    if (!bucket) {
      bucket = new Set<string>()
      codesByCompanyPnl.set(cid, bucket)
    }
    bucket.add(code)
  }
  const isParentCode = (code: string) => {
    for (const bucket of codesByCompanyPnl.values()) {
      if (!bucket.has(code)) continue
      for (const c of bucket) {
        if (c !== code && c.startsWith(code + "-")) return true
      }
    }
    return false
  }

  // Convert to rows sorted by sortOrder (exclude parents)
  const leafAccounts = Array.from(accountMap.values()).filter((acct) => !isParentCode(acct.code))

  // Compute monthlyRevenue and monthlyCogs from leaf-level budget_lines
  // 602 (returns) and 603 (discounts) are contra-revenue — subtract from net revenue
  // COGS stored as positive in DB, but P&L view expects negative (GP = Revenue + COGS)
  leafAccounts.forEach((acct) => {
    for (let m = 1; m <= 12; m++) {
      const val = acct.monthlyAmounts[m] || 0
      if (acct.type === "revenue") {
        const isContraRevenue = acct.code.startsWith("602") || acct.code.startsWith("603")
        monthlyRevenue[m] += isContraRevenue ? -val : val
      } else if (acct.type === "cogs") {
        monthlyCogs[m] -= val // negative for P&L subtraction
      }
    }
  })

  const pnlRows = leafAccounts
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((acct) => {
      const monthly: Record<number, number> = {}
      let total = 0
      for (let m = 1; m <= 12; m++) {
        monthly[m] = acct.monthlyAmounts[m] || 0
        total += monthly[m]
      }

      const parts = acct.code.split("-")
      const parentCode = parts.length >= 2 ? parts.slice(0, -1).join("-") : null

      return {
        accountCode: acct.code,
        accountName: acct.name,
        accountType: acct.type,
        parentCode,
        monthly,
        total,
      }
    })

  // ---- Actuals aggregation ------------------------------------------------
  // Aggregate BudgetActual rows to match the same code::name keys as the plan
  // rows. Actuals don't have an accountId FK, so we rely on the same
  // department/category string heuristic as the legacy branch above.
  const looksLikeCode = (s: string) => /^\d{3}/.test(s)
  const resolveActualKey = (dep: string | null, cat: string): { code: string; name: string; key: string } => {
    const maybeCode = dep || ""
    const maybeName = cat || ""
    const code = looksLikeCode(maybeCode)
      ? maybeCode
      : looksLikeCode(maybeName)
        ? maybeName
        : maybeCode || "other"
    const name = code === maybeCode ? (maybeName || code) : (maybeCode || code)
    return { code, name, key: `${code}::${name}` }
  }

  const actualByKey: Record<string, number> = {}
  const actualMonthlyByKey: Record<string, Record<number, number>> = {}
  const sectionActuals = { revenue: 0, cogs: 0, opex: 0, belowEbitda: 0 }
  const monthlyActualRevenue: Record<number, number> = {}
  const monthlyActualCogs: Record<number, number> = {}
  for (let m = 1; m <= 12; m++) {
    monthlyActualRevenue[m] = 0
    monthlyActualCogs[m] = 0
  }

  for (const a of actuals) {
    if (!a.expenseDate) continue
    const d = new Date(a.expenseDate)
    if (Number.isNaN(d.getTime())) continue
    if (d.getFullYear() !== year) continue
    const month = d.getMonth() + 1

    const { code, key } = resolveActualKey(a.department, a.category)
    const amount = a.actualAmount || 0

    actualByKey[key] = (actualByKey[key] || 0) + amount
    actualMonthlyByKey[key] ??= {}
    actualMonthlyByKey[key][month] = (actualMonthlyByKey[key][month] || 0) + amount

    // Section aggregation mirrors the code-prefix rules used in the view.
    if (code.startsWith("601") || code.startsWith("611")) {
      sectionActuals.revenue += amount
      monthlyActualRevenue[month] += amount
    } else if (code.startsWith("602") || code.startsWith("603")) {
      sectionActuals.revenue -= amount // contra-revenue
      monthlyActualRevenue[month] -= amount
    } else if (code.startsWith("701")) {
      sectionActuals.cogs += amount
      monthlyActualCogs[month] += amount
    } else if (code.startsWith("711") || code.startsWith("721")) {
      sectionActuals.opex += amount
    } else if (
      code.startsWith("731") ||
      code.startsWith("741") ||
      code.startsWith("751") ||
      code.startsWith("761") ||
      code.startsWith("771") ||
      code.startsWith("801")
    ) {
      sectionActuals.belowEbitda += amount
    }
  }

  // Turn 33.5 architect ⚠️: `success: true` here too (mirrors empty
  // short-circuit) — eliminates pnl-INTERNAL envelope asymmetry. Both
  // empty + non-empty paths now share the additive key.
  return NextResponse.json({
    success: true,
    sections: PNL_SECTIONS,
    rows: pnlRows,
    monthlyRevenue,
    monthlyCogs,
    monthlyActualRevenue,
    monthlyActualCogs,
    actualByKey,
    actualMonthlyByKey,
    sectionActuals,
    year,
    hasActuals: actuals.length > 0,
  })
}
