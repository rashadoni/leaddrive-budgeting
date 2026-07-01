import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { looksLikeCode } from "@/lib/import/keywords"
import {
  deriveRoleFromCode,
  isContraRevenueCode,
  pnlSectionFromCode,
  pnlSectionFromRole,
} from "@/lib/budgeting/coa-role"
import { isDaCode } from "@/lib/budgeting/da-codes"

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

// Phase 6 (2026-06-29) perf — mirror the analytics route: load only the columns
// the P&L aggregation reads from each of the (up to thousands of) budget lines,
// not `SELECT *`. `BUDGET_LINE_SELECT` is the single source of truth for both the
// query and the row type, so any access to a non-selected field is a COMPILE
// error (tsc-driven completeness). The narrow account select keeps code/name/type
// available; the dropped wide scalars (notes / currency / vat / forecastAmount /
// sourceDocument / timestamps / etc.) were never read here.
const BUDGET_LINE_SELECT = {
  companyId: true,
  department: true,
  lineType: true,
  sortOrder: true,
  monthIndex: true,
  plannedAmount: true,
  account: { select: { code: true, name: true, accountType: true } },
} satisfies Prisma.BudgetLineSelect
type BudgetLineRow = Prisma.BudgetLineGetPayload<{ select: typeof BUDGET_LINE_SELECT }>

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
    select: { id: true, name: true, year: true, kind: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  const year = yearOverride ? parseInt(yearOverride) : plan.year
  const activeKind = plan.kind === "actual" || plan.kind === "budget" ? plan.kind : "legacy"
  const counterpartKind = activeKind === "actual" ? "budget" : activeKind === "budget" ? "actual" : null
  const counterpartPlan = counterpartKind
    ? await prisma.budgetPlan.findFirst({
        where: { organizationId: orgId, year, kind: counterpartKind, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, year: true, kind: true },
      })
    : null

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

  const blWhere: { organizationId: string; deletedAt: null; companyId?: { in: string[] } } = {
    organizationId: orgId,
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
        monthlyActualRevenue: {}, monthlyActualCogs: {}, monthlyActualOpex: {},
        monthlyActualBelowEbitda: {}, monthlyActualDa: {}, actualByKey: {},
        actualMonthlyByKey: {}, sectionActuals: {}, year, hasActuals: false,
        _emptyReason: "subgroup_no_children",
      })
    }
    blWhere.companyId = { in: companyFilter.companyIds }
  }

  // Get all budget lines + actuals. (Prior code also fetched salesBudgetLine
  // + cOGSBudgetLine here with a productLine join, but their results were never
  // read — two dead per-request queries removed 2026-06-29; the P&L is built
  // entirely from budgetLines + actuals below.)
  const [budgetLines, actuals] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { ...blWhere, planId },
      // Narrow select (FK'd account included) so reads prefer canonical
      // code/name from the Chart of Accounts over the denormalised
      // category/department strings — only the columns the aggregation uses.
      select: BUDGET_LINE_SELECT,
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
  const counterpartBudgetLines = counterpartPlan
    ? await prisma.budgetLine.findMany({
        where: { ...blWhere, planId: counterpartPlan.id },
        select: BUDGET_LINE_SELECT,
      })
    : []
  const selectedLineComparison = aggregateBudgetLinesForComparison(budgetLines)
  const counterpartLineComparison = aggregateBudgetLinesForComparison(counterpartBudgetLines)
  const budgetLineComparison = activeKind === "actual" ? counterpartLineComparison : selectedLineComparison
  const actualLineComparison = activeKind === "actual" ? selectedLineComparison : counterpartLineComparison

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

  type BL = BudgetLineRow
  budgetLines.forEach((bl: BL) => {
    // Preferred path: the FK to Chart of Accounts is set, so use canonical
    // code + name from there. Everything else is fallback for legacy rows
    // imported before Phase 2.1.
    // Phase 2.1 session 3: bl.account is guaranteed by NOT NULL FK +
    // the include above. The looksLikeCode fallback branch is dead.
    const code = bl.account.code
    const name = bl.account.name
    const mapKey = `${code}::${name}`

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
  for (const bl of budgetLines) {
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
  const monthlyActualOpex: Record<number, number> = {}
  const monthlyActualBelowEbitda: Record<number, number> = {}
  const monthlyActualDa: Record<number, number> = {}
  let hasActualRowsForYear = false
  for (let m = 1; m <= 12; m++) {
    monthlyActualRevenue[m] = 0
    monthlyActualCogs[m] = 0
    monthlyActualOpex[m] = 0
    monthlyActualBelowEbitda[m] = 0
    monthlyActualDa[m] = 0
  }

  for (const a of actuals) {
    if (!a.expenseDate) continue
    const d = new Date(a.expenseDate)
    if (Number.isNaN(d.getTime())) continue
    if (d.getFullYear() !== year) continue
    hasActualRowsForYear = true
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
    const section = pnlSectionFromCode(code, a.lineType)
    if (isDaCode(code)) {
      monthlyActualDa[month] += Math.abs(amount)
    }
    if (section === "revenue") {
      const sign = isContraRevenueCode(code) ? -1 : 1
      sectionActuals.revenue += sign * amount
      monthlyActualRevenue[month] += sign * amount
    } else if (section === "cogs") {
      sectionActuals.cogs += amount
      monthlyActualCogs[month] += amount
    } else if (section === "opex") {
      sectionActuals.opex += amount
      monthlyActualOpex[month] += amount
    } else if (section === "belowEbitda") {
      sectionActuals.belowEbitda += amount
      monthlyActualBelowEbitda[month] += amount
    }
  }

  if (!hasActualRowsForYear && actualLineComparison.hasRows) {
    copyMonthlyValues(monthlyActualRevenue, actualLineComparison.monthlyRevenue)
    copyMonthlyValues(monthlyActualCogs, actualLineComparison.monthlyCogs)
    copyMonthlyValues(monthlyActualOpex, actualLineComparison.monthlyOpex)
    copyMonthlyValues(monthlyActualBelowEbitda, actualLineComparison.monthlyBelowEbitda)
    copyMonthlyValues(monthlyActualDa, actualLineComparison.monthlyDa)
    Object.assign(sectionActuals, actualLineComparison.sectionTotals)
    Object.assign(actualByKey, actualLineComparison.byKey)
    hasActualRowsForYear = true
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
    monthlyActualOpex,
    monthlyActualBelowEbitda,
    monthlyActualDa,
    actualByKey,
    actualMonthlyByKey,
    sectionActuals,
    comparison: {
      activePlan: plan,
      comparisonPlan: counterpartPlan,
      budget: budgetLineComparison,
      actual: actualLineComparison.hasRows
        ? actualLineComparison
        : {
            monthlyRevenue: monthlyActualRevenue,
            monthlyCogs: monthlyActualCogs,
            monthlyOpex: monthlyActualOpex,
            monthlyBelowEbitda: monthlyActualBelowEbitda,
            monthlyDa: monthlyActualDa,
            sectionTotals: sectionActuals,
            byKey: actualByKey,
            hasRows: hasActualRowsForYear,
          },
      hasBudgetLines: budgetLineComparison.hasRows,
      hasActualLines: actualLineComparison.hasRows || hasActualRowsForYear,
      missingData: [
        ...(counterpartKind && !counterpartPlan ? [`No ${counterpartKind} plan exists for ${year}.`] : []),
        ...(budgetLineComparison.hasRows ? [] : ["Budget P&L rows are not available for this year."]),
        ...(actualLineComparison.hasRows || hasActualRowsForYear ? [] : ["Actual P&L rows are not available for this year."]),
      ],
    },
    year,
    hasActuals: hasActualRowsForYear,
  })
}

type MonthlyMap = Record<number, number>

interface PnlLineComparisonBuckets {
  monthlyRevenue: MonthlyMap
  monthlyCogs: MonthlyMap
  monthlyOpex: MonthlyMap
  monthlyBelowEbitda: MonthlyMap
  monthlyDa: MonthlyMap
  sectionTotals: { revenue: number; cogs: number; opex: number; belowEbitda: number }
  byKey: Record<string, number>
  hasRows: boolean
}

function emptyMonthlyMap(): MonthlyMap {
  const map: MonthlyMap = {}
  for (let m = 1; m <= 12; m++) map[m] = 0
  return map
}

function copyMonthlyValues(target: MonthlyMap, source: MonthlyMap): void {
  for (let m = 1; m <= 12; m++) target[m] = source[m] ?? 0
}

function aggregateBudgetLinesForComparison(lines: BudgetLineRow[]): PnlLineComparisonBuckets {
  const buckets: PnlLineComparisonBuckets = {
    monthlyRevenue: emptyMonthlyMap(),
    monthlyCogs: emptyMonthlyMap(),
    monthlyOpex: emptyMonthlyMap(),
    monthlyBelowEbitda: emptyMonthlyMap(),
    monthlyDa: emptyMonthlyMap(),
    sectionTotals: { revenue: 0, cogs: 0, opex: 0, belowEbitda: 0 },
    byKey: {},
    hasRows: false,
  }
  const leafLines = lines.filter((line) => !isParentBudgetLine(line, lines))
  for (const line of leafLines) {
    const month = resolveBudgetLineMonth(line.monthIndex, line.sortOrder)
    if (month == null) continue
    const code = line.account.code
    const name = line.account.name || line.department || code
    const amount = line.plannedAmount || 0
    if (amount === 0) continue

    buckets.hasRows = true
    const key = `${code}::${name}`
    buckets.byKey[key] = (buckets.byKey[key] || 0) + amount

    const section = pnlSectionFromCode(code, line.account.accountType)
    if (isDaCode(code)) buckets.monthlyDa[month] += Math.abs(amount)

    if (section === "revenue") {
      const signedAmount = isContraRevenueCode(code) ? -amount : amount
      buckets.monthlyRevenue[month] += signedAmount
      buckets.sectionTotals.revenue += signedAmount
    } else if (section === "cogs") {
      const cost = Math.abs(amount)
      buckets.monthlyCogs[month] += cost
      buckets.sectionTotals.cogs += cost
    } else if (section === "opex") {
      const cost = Math.abs(amount)
      buckets.monthlyOpex[month] += cost
      buckets.sectionTotals.opex += cost
    } else if (section === "belowEbitda") {
      const cost = Math.abs(amount)
      buckets.monthlyBelowEbitda[month] += cost
      buckets.sectionTotals.belowEbitda += cost
    }
  }
  return buckets
}

function resolveBudgetLineMonth(monthIndex: number | null, sortOrder: number): number | null {
  if (monthIndex != null && monthIndex >= 0 && monthIndex < 12) return monthIndex + 1
  const fromSort = sortOrder % 100
  if (fromSort >= 0 && fromSort < 12) return fromSort + 1
  return null
}

function isParentBudgetLine(line: BudgetLineRow, allLines: BudgetLineRow[]): boolean {
  const code = line.account.code
  if (!code || code.startsWith("ROLLUP-")) return false
  return allLines.some((candidate) => {
    if (candidate.companyId !== line.companyId) return false
    const candidateCode = candidate.account.code
    return candidateCode !== code && candidateCode.startsWith(`${code}-`)
  })
}
