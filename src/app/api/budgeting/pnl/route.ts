import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { looksLikeCode } from "@/lib/import/keywords"
import {
  deriveRoleFromCode,
  isContraRevenueCode,
  pnlSectionFromRole,
} from "@/lib/budgeting/coa-role"

/**
 * GET /api/budgeting/pnl
 *
 * Response envelope (accepted-asymmetry per Turn-30 architect ⚠️ closure
 * Turn-33.5 + Turn-Y retroactive documentation):
 *   `{success: true, sections, rows, monthlyRevenue, ..., year, ...}`
 *   — flat shape: `success` flag at root + payload fields at root.
 *
 * Sibling route `/api/budgeting/analytics` uses a DIFFERENT envelope:
 *   `{success: true, data: {plan, totalPlanned, ...}}`
 *   — wrapped shape: `success` flag at root + payload nested under `data`.
 *
 * Both have `success: true` so consumers can distinguish "successful empty"
 * from "error" (architect's stated concern). Convergence on a single
 * envelope shape is NOT scheduled — pre-existing convention; pnl pre-dates
 * analytics; both stable; convergence would be a breaking change for
 * `/budgeting` page (pnl) and Risk Terminal (analytics) consumers without
 * customer-visible benefit. If a future cross-route consumer needs unified
 * shape, file a fresh 🔄 with migration plan.
 */

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
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.orgId

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

  // Phase 7.F sub-group RBAC — narrow companyFilter further if user is
  // restricted. Org-wide consolidated → restrict to allowed companies.
  // Single-company → 404 if outside scope. Sub-group expansion → keep
  // only allowed children.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null) {
    if (companyFilter.kind === "single") {
      const filtered = companyFilter.companyIds.filter((id) => scope.ids!.has(id))
      if (filtered.length === 0) {
        return NextResponse.json({ error: "Company not found" }, { status: 404 })
      }
      companyFilter.companyIds = filtered
    }
  }

  const blWhere: { organizationId: string; planId: string; deletedAt: null; companyId?: { in: string[] } } = {
    organizationId: orgId,
    planId,
    deletedAt: null,
  }
  // For org-wide queries on a restricted user, narrow to scoped companies.
  if (companyFilter.kind === "all" && scope.ids != null) {
    blWhere.companyId = { in: Array.from(scope.ids) }
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
      // Turn 35: per-company filter applies to actuals too. Pre-Turn-35
      // actuals lacked companyId column → filter was silently global,
      // making per-daughter-company drilldown show org-wide actuals
      // against per-company plan (nonsense variance %). companyId
      // populated by Turn-35+ seed/import paths; legacy nullable
      // actuals fall through global aggregation.
      where: companyFilter.kind === "single"
        ? { organizationId: orgId, planId, companyId: { in: companyFilter.companyIds } }
        : { organizationId: orgId, planId },
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
      // so department holds the code — detect by shape.
      const maybeCode = bl.department || ""
      const maybeName = bl.account?.name ?? bl.account?.code ?? ""
      // Turn LXV — `looksLikeCode` extracted to `@/lib/import/keywords`
      // (inline lambda was duplicated at line 283 below + analytics route).
      code = looksLikeCode(maybeCode) ? maybeCode : (looksLikeCode(maybeName) ? maybeName : maybeCode || "other")
      name = code === maybeCode ? (maybeName || code) : (maybeCode || code)
    }
    // When code falls back to "other" (non-SAP category like PLF codes),
    // include lineType + raw category in the key so revenue/cogs/expense
    // lines don't collapse into one "other::other" bucket and steal each
    // other's type (e.g. PLF revenue being misclassified as expense because
    // an expense line with the same "other" key was processed first).
    const mapKey = (code === "other")
      ? `other::${bl.lineType}::${bl.account?.code ?? bl.department ?? "unknown"}`
      : `${code}::${name}`

    if (!accountMap.has(mapKey)) {
      let accountType = bl.account?.accountType ?? "expense"
      if (!bl.account) {
        // Turn 36 fix: prefer bl.lineType when explicitly set (parser-provided
        // source-of-truth), fall back to code-prefix heuristic only if lineType
        // is the default "expense" (legacy rows). This fixes ATL-MRKZ rollup
        // codes (ROLLUP-REVENUE / ROLLUP-COGS / ROLLUP-OPEX-*) that don't
        // match SAP 601/611/602/603/701 prefixes — pre-fix they were silently
        // classified as "expense" → ATL-MRKZ revenue undercounted as 0.05M
        // YTD vs expected ~3.6M (10.8M annual / 12 × 4 months).
        // Phase 7.G Turn LXXV (Phase 5.1): code-prefix branch now delegates
        // to canonical `deriveRoleFromCode` (single source of truth).
        if (bl.lineType === "revenue") accountType = "revenue"
        else if (bl.lineType === "cogs") accountType = "cogs"
        else {
          const role = deriveRoleFromCode(code)
          if (role === "revenue") accountType = "revenue"
          else if (role === "cogs") accountType = "cogs"
        }
      }

      accountMap.set(mapKey, {
        code,
        name,
        type: accountType,
        sortOrder: bl.sortOrder,
        monthlyAmounts: {},
      })
    }

    // PLF/imported lines carry month in monthIndex (sortOrder is always 0).
    // Legacy SAP-code lines encode month as sortOrder % 100. Prefer monthIndex
    // when it is non-null and in range; fall back to sortOrder.
    const monthFromIndex = bl.monthIndex != null && bl.monthIndex >= 0 && bl.monthIndex < 12
      ? bl.monthIndex + 1 : null
    const monthFromSort = bl.sortOrder % 100
    const month = monthFromIndex ?? (monthFromSort >= 0 && monthFromSort < 12 ? monthFromSort + 1 : 0)
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
    // Turn 36 fix: skip parent-detection for synthetic ROLLUP-* codes.
    // The rollup parser produces flat semantic categories (ROLLUP-REVENUE,
    // ROLLUP-REVENUE-OTHER, ROLLUP-COGS, ROLLUP-OPEX-GA, etc.) that use
    // dashes as separators NOT hierarchy markers — so ROLLUP-REVENUE is
    // NOT a parent of ROLLUP-REVENUE-OTHER. Pre-fix, dedup logic dropped
    // ROLLUP-REVENUE (10.65M) as "parent" of ROLLUP-REVENUE-OTHER (150k),
    // making ATL-MRKZ revenue YTD plan show as 0.05M instead of ~3.55M.
    // Same opt-out is documented in the rollup parser's `dedupeParentRollups`
    // call (azmade-sopl.ts:482 — `enabled: false`).
    if (code.startsWith("ROLLUP-")) return false
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
        const isContraRevenue = isContraRevenueCode(acct.code)
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
  // Turn LXV — `looksLikeCode` from shared `@/lib/import/keywords` catalog.
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

    // Section aggregation. Phase 7.G Turn LXXV (Phase 5.1) — uses canonical
    // `pnlSectionFromRole(deriveRoleFromCode(code))` instead of inline
    // prefix matching. Contra-revenue (602/603) still folds into `revenue`
    // section but with sign-flip — `isContraRevenueCode` is the explicit
    // predicate.
    const role = deriveRoleFromCode(code)
    const section = pnlSectionFromRole(role)
    if (section === "revenue") {
      const sign = isContraRevenueCode(code) ? -1 : 1
      sectionActuals.revenue += sign * amount
      monthlyActualRevenue[month] += sign * amount
    } else if (section === "cogs") {
      sectionActuals.cogs += amount
      monthlyActualCogs[month] += amount
    } else if (section === "opex") {
      sectionActuals.opex += amount
    } else if (section === "belowEbitda") {
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
