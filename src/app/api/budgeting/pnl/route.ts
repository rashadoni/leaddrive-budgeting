import { NextRequest, NextResponse } from "next/server"
import { buildMissingData } from "@/lib/budgeting/missing-data"
import { Prisma } from "@prisma/client"
import { getSession } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { resolvePnlEliminationScope } from "@/lib/onboarding/ai-import/pnl-elimination-scope"
import { looksLikeCode } from "@/lib/import/keywords"
import {
  deriveRoleFromCode,
  otherOperatingContribution,
  pnlSectionFromCode,
  pnlSectionFromRole,
  revenueContribution,
} from "@/lib/budgeting/coa-role"
import { isDaCode } from "@/lib/budgeting/da-codes"
import { summarizeCorrections } from "@/lib/budgeting/correction-summary"

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
  // 13.6 — a total that silently contains hand-entered money is the same
  // failure this phase keeps finding: the number is right and the sentence
  // around it is missing. Corrections DO belong in the total (that is why they
  // are rows and not overrides); what they must not do is arrive unannounced.
  origin: true,
  correctionReviewAt: true,
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

  // Stage 3 RLS — the whole aggregation reads run in one org-scoped tx.
  // getCompanyScope resolves via prismaAdmin (auth-adjacent) so it stays
  // outside the tx contract; every model read below uses `tx`.
  return withOrgScope(orgId, async (tx) => {
  // Resolve plan year up-front — we need it to filter actuals by expenseDate.
  const plan = await tx.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, year: true, kind: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  const year = yearOverride ? parseInt(yearOverride) : plan.year
  const activeKind = plan.kind === "actual" || plan.kind === "budget" ? plan.kind : "legacy"
  const counterpartKind = activeKind === "actual" ? "budget" : activeKind === "budget" ? "actual" : null
  const counterpartPlan = counterpartKind
    ? await tx.budgetPlan.findFirst({
        where: { organizationId: orgId, year, kind: counterpartKind, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, year: true, kind: true },
      })
    : null

  // Turn 30: per-daughter-company filter (mirrors analytics route).
  // null/undefined → org-wide consolidated; level=2 → single op-co;
  // level=1 → expand to children. Cross-tenant id → 404.
  const companyIdParam = searchParams.get("companyId")
  const companyFilter = await resolveCompanyFilter(tx, orgId, companyIdParam)
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

  /**
   * 2026-08-18 — the group's intragroup eliminations, and who may see them.
   *
   * These rows carry `companyId: null` (see `BudgetLine.isElimination`). An
   * unrestricted org-wide query has no company filter and would sweep them in
   * by accident; every narrowed query has one and would drop them silently.
   * Neither is a decision anyone made, and the second hands two people with
   * the same entitlement two different EBITDAs. So decide explicitly, then
   * write a WHERE that says it: entity rows for the companies in scope, OR
   * the elimination rows when — and only when — this query is the whole group.
   */
  const elimination = resolvePnlEliminationScope({
    filterKind: companyFilter.kind === "single" ? "single" : "all",
    restricted: scope.ids != null,
  })

  const blWhere: {
    organizationId: string
    deletedAt: null
    companyId?: { in: string[] }
    isElimination?: boolean
  } = {
    organizationId: orgId,
    deletedAt: null,
  }
  // For org-wide queries on a restricted user, narrow to scoped companies.
  if (companyFilter.kind === "all" && scope.ids != null) {
    blWhere.companyId = { in: Array.from(scope.ids) }
  }
  if (!elimination.includeEliminations) {
    // Excluded for a single company and for any restricted view. The client's
    // EJE block nets result across ALL of its entities at once, so applying it
    // to a subset would subtract trades with companies that are not on screen.
    blWhere.isElimination = false
  }
  // The remaining case — an unrestricted org-wide read — carries no company
  // filter at all, so the null-company elimination rows are already in scope.
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
        monthlyOtherOperating: {},
        monthlyActualRevenue: {}, monthlyActualCogs: {}, monthlyActualOpex: {},
        monthlyActualOtherOperating: {},
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
  const budgetLines = await tx.budgetLine.findMany({
    where: { ...blWhere, planId },
    // Narrow select (FK'd account included) so reads prefer canonical
    // code/name from the Chart of Accounts over the denormalised
    // category/department strings — only the columns the aggregation uses.
    select: BUDGET_LINE_SELECT,
  })
  const actuals = await tx.budgetActual.findMany({
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
  })
  const counterpartBudgetLines = counterpartPlan
    ? await tx.budgetLine.findMany({
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
  // Other operating income/(expense) — signed, income-positive.
  const monthlyOtherOperating: Record<number, number> = {}
  for (let m = 1; m <= 12; m++) {
    monthlyRevenue[m] = 0
    monthlyCogs[m] = 0
    monthlyOtherOperating[m] = 0
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
        // `storedAs: bl.lineType` used to live here, feeding
        // `revenueContribution`'s sign flip. Both are gone: the importer no
        // longer writes other-operating income under the cost convention, so
        // there is one convention per section and nothing to reconcile.
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
  // 2026-07-15 — classify by pnlSectionFromCode, NOT by accountType.
  // 2026-08-01 — and other operating income no longer lands in `revenue`.
  // It used to: the importer stored PLF.07.01/.02 negative under the expense
  // convention, `pnlSectionFromCode` routed it into revenue and
  // `revenueContribution` flipped the sign back. Net Profit came out right and
  // Revenue read 72,333,200 against the workbook's 58,880,102. Both halves of
  // that compensation are gone; the money is its own line above EBITDA.
  leafAccounts.forEach((acct) => {
    const section = pnlSectionFromCode(acct.code, acct.type)
    for (let m = 1; m <= 12; m++) {
      const val = acct.monthlyAmounts[m] || 0
      if (section === "revenue") {
        monthlyRevenue[m] += revenueContribution(acct.code, val)
      } else if (section === "cogs") {
        monthlyCogs[m] -= val // negative for P&L subtraction
      } else if (section === "otherOperating") {
        monthlyOtherOperating[m] += otherOperatingContribution(acct.code, val)
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
  const sectionActuals = { revenue: 0, cogs: 0, opex: 0, otherOperating: 0, belowEbitda: 0 }
  const monthlyActualRevenue: Record<number, number> = {}
  const monthlyActualCogs: Record<number, number> = {}
  const monthlyActualOpex: Record<number, number> = {}
  const monthlyActualOtherOperating: Record<number, number> = {}
  const monthlyActualBelowEbitda: Record<number, number> = {}
  const monthlyActualDa: Record<number, number> = {}
  let hasActualRowsForYear = false
  for (let m = 1; m <= 12; m++) {
    monthlyActualRevenue[m] = 0
    monthlyActualCogs[m] = 0
    monthlyActualOpex[m] = 0
    monthlyActualOtherOperating[m] = 0
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
    // with a sign flip, inside `revenueContribution`.
    const section = pnlSectionFromCode(code, a.lineType)
    if (isDaCode(code)) {
      monthlyActualDa[month] += Math.abs(amount)
    }
    if (section === "revenue") {
      const signed = revenueContribution(code, amount)
      sectionActuals.revenue += signed
      monthlyActualRevenue[month] += signed
    } else if (section === "cogs") {
      sectionActuals.cogs += amount
      monthlyActualCogs[month] += amount
    } else if (section === "otherOperating") {
      const signed = otherOperatingContribution(code, amount)
      sectionActuals.otherOperating += signed
      monthlyActualOtherOperating[month] += signed
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
    copyMonthlyValues(monthlyActualOtherOperating, actualLineComparison.monthlyOtherOperating)
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
    monthlyOtherOperating,
    monthlyActualRevenue,
    monthlyActualCogs,
    monthlyActualOpex,
    monthlyActualOtherOperating,
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
            monthlyOtherOperating: monthlyActualOtherOperating,
            monthlyBelowEbitda: monthlyActualBelowEbitda,
            monthlyDa: monthlyActualDa,
            sectionTotals: sectionActuals,
            byKey: actualByKey,
            hasRows: hasActualRowsForYear,
          },
      // 13.6 — summarised over the SELECTED plan's own lines, which are the
      // ones this page's totals are built from.
      corrections: summarizeCorrections(budgetLines),
      hasBudgetLines: budgetLineComparison.hasRows,
      hasActualLines: actualLineComparison.hasRows || hasActualRowsForYear,
      // 11.90 — codes, not sentences. The locale belongs to the viewer.
      missingData: buildMissingData({
        dataset: "pnl",
        missingCounterpartKind:
          counterpartKind && !counterpartPlan ? counterpartKind : null,
        year,
        hasBudgetRows: budgetLineComparison.hasRows,
        hasActualRows: actualLineComparison.hasRows || hasActualRowsForYear,
      }),
    },
    year,
    hasActuals: hasActualRowsForYear,
  })
  })
}

type MonthlyMap = Record<number, number>

interface PnlLineComparisonBuckets {
  monthlyRevenue: MonthlyMap
  monthlyCogs: MonthlyMap
  monthlyOpex: MonthlyMap
  /** Other operating income/(expense) — SIGNED, income-positive. */
  monthlyOtherOperating: MonthlyMap
  monthlyBelowEbitda: MonthlyMap
  monthlyDa: MonthlyMap
  sectionTotals: {
    revenue: number
    cogs: number
    opex: number
    otherOperating: number
    belowEbitda: number
  }
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
    monthlyOtherOperating: emptyMonthlyMap(),
    monthlyBelowEbitda: emptyMonthlyMap(),
    monthlyDa: emptyMonthlyMap(),
    sectionTotals: { revenue: 0, cogs: 0, opex: 0, otherOperating: 0, belowEbitda: 0 },
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
      const signedAmount = revenueContribution(code, amount)
      buckets.monthlyRevenue[month] += signedAmount
      buckets.sectionTotals.revenue += signedAmount
    } else if (section === "otherOperating") {
      const signedAmount = otherOperatingContribution(code, amount)
      buckets.monthlyOtherOperating[month] += signedAmount
      buckets.sectionTotals.otherOperating += signedAmount
    } else if (section === "cogs") {
      buckets.monthlyCogs[month] += amount
      buckets.sectionTotals.cogs += amount
    } else if (section === "opex") {
      buckets.monthlyOpex[month] += amount
      buckets.sectionTotals.opex += amount
    } else if (section === "belowEbitda") {
      buckets.monthlyBelowEbitda[month] += amount
      buckets.sectionTotals.belowEbitda += amount
    }
  }

  // 2026-07-15 — normalise each cost section to the cost-as-positive
  // convention ONCE, on the total, instead of Math.abs()-ing every row.
  //
  // Per-row abs made a reversal ADD to cost instead of subtracting: the FO
  // 2026 actuals carry 21 credit notes worth −0.129M, which inflated OpEx by
  // exactly 2× that (6.08M → 6.34M) and moved Net Profit from −4.20M to
  // −4.43M against the workbook. The sibling path (`aggregateRowsForEbitda`)
  // already abs's the summed total, so the same route disagreed with itself.
  // Abs on the total keeps the original defensive intent — a section stored
  // wholly negative still reads positive — without eating reversals.
  //
  // `otherOperating` is deliberately NOT in this list: it is the one signed
  // bucket (income positive, expense negative), and a net-expense period is a
  // real outcome, not a stored-sign accident.
  for (const s of ["cogs", "opex", "belowEbitda"] as const) {
    if (buckets.sectionTotals[s] >= 0) continue
    buckets.sectionTotals[s] = -buckets.sectionTotals[s]
    const monthly =
      s === "cogs"
        ? buckets.monthlyCogs
        : s === "opex"
          ? buckets.monthlyOpex
          : buckets.monthlyBelowEbitda
    for (const m of Object.keys(monthly)) {
      monthly[Number(m)] = -monthly[Number(m)]
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
