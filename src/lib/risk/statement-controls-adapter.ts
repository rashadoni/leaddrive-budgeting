/**
 * Phase 10 / B1 shadow slice — statement-controls adapter.
 *
 * Bridges the pure statement-reconciliation contracts
 * (`statement-reconciliation.ts` + `statement-control-builders.ts`) to this
 * database, in SHADOW mode only:
 *
 *   - The policy below is the recorded T-1 Option A SHAPE pinned at
 *     `approval: "provisional"`, so every evaluated control is "provisional"
 *     (arithmetic computed, never certifiable) — the evaluator can
 *     mathematically never emit "pass"/"fail" under it.
 *   - Evidence is never fabricated: a figure the DB cannot evidence is
 *     `evidence: null` (absent ≠ zero), `revisionId` is null everywhere
 *     (no statement row carries lineage), and `evidencedZero` is used nowhere
 *     (no zero is genuinely evidenced by this schema).
 *   - Structurally absent components (opening/independent BS cash,
 *     retained-earnings markers, distributions) yield honest BLOCKED verdicts.
 *
 * Layering: `fetchStatementEvidence` does the (read-only) Prisma I/O against a
 * caller-supplied transaction; `assembleShadowStatementControls` is pure so it
 * is unit-testable with plain objects. No fetch, no fs, no clock, no writes.
 */

import type { Prisma } from "@prisma/client"
import { CURRENT_YEAR_RESULT_RE } from "@/lib/audit/ifrs-checks"
import { classifyCashFlowCode } from "@/lib/onboarding/cf-bridge"
import {
  evaluateStatementControl,
  type StatementControlCode,
  type StatementControlResult,
  type StatementControlSide,
  type StatementReconciliationPolicy,
} from "./statement-reconciliation"
import {
  StatementControlBuilderError,
  buildBalanceSheetControl,
  buildCashFlowSumControl,
  buildCashToBalanceSheetControl,
  buildFxTranslationControl,
  buildNetIncomeLinkControl,
  buildRetainedEarningsControl,
  type FxRecomputedTerm,
  type StatementComponent,
  type StatementComponentRole,
  type StatementControlBuilderErrorCode,
  type StatementControlScope,
} from "./statement-control-builders"

/**
 * Recorded T-1 Option A SHAPE, shadow methodology only.
 *
 * `approval` MUST stay "provisional" until the owner-pack §7.1 conditions plus
 * one full shadow close cycle land. Flipping it to "approved" would mint
 * decision-grade pass/fail from unlineaged data — that flip is an OWNER
 * decision, not an engineering edit, and is guarded by a pinning unit test.
 */
export const SHADOW_STATEMENT_POLICY: StatementReconciliationPolicy = Object.freeze({
  id: "t1-option-a-shape-shadow-v1",
  approval: "provisional", // NEVER "approved" — owner-gated (§7.1); guarded by unit test
  relativeTolerance: 0.00001, // 0.1 bp, recorded T-1 Option A SHAPE
  // Owner pack §7.1 condition #7: pre-register the pilot currencies before any
  // dual-currency shadow run. Minor-unit floors are arithmetic guards only; the
  // policy remains provisional and cannot mint pass/fail.
  absoluteFloorByCurrency: Object.freeze({
    AZN: 1.0,
    USD: 0.01,
    EUR: 0.01,
    GBP: 0.01,
    TRY: 0.01,
    RUB: 0.01,
  }),
  materialityRate: 0.001,
  // Fixed non-AZN materiality floors are NOT owner-approved. Pre-registration
  // uses a zero fixed floor so non-AZN pilot scopes evaluate under the relative
  // materiality rate while condition #5 (scope-aware materiality) remains open.
  materialityFloorByCurrency: Object.freeze({
    AZN: 10_000,
    USD: 0,
    EUR: 0,
    GBP: 0,
    TRY: 0,
    RUB: 0,
  }),
})

/**
 * Which convention the stored balance sheet uses. Mirrors the audited
 * `balanceResidual` logic in `src/lib/audit/ifrs-checks.ts` (~261-272):
 * signed residual = A + L + E (trial-balance stores liabilities/equity
 * negative), natural residual = A − L − E; the convention whose residual is
 * smaller in magnitude wins. Residual-minimizing detection can mask a genuine
 * sign break — acceptable ONLY because nothing here is decision-grade; both
 * residuals plus the raw stored sums are disclosed to the caller.
 */
export function detectBsSignConvention(
  assets: number,
  liabilities: number,
  equity: number,
): { convention: "trial_balance" | "natural"; signedResidual: number; naturalResidual: number } {
  const signedResidual = assets + liabilities + equity
  const naturalResidual = assets - liabilities - equity
  return {
    convention: Math.abs(signedResidual) <= Math.abs(naturalResidual) ? "trial_balance" : "natural",
    signedResidual,
    naturalResidual,
  }
}

/** An aggregated evidence bucket. `rowCount: 0` ⇒ treat as absent downstream. */
export interface Bucket {
  sum: number
  rowCount: number
}

export interface ShadowStatementEvidence {
  organizationId: string
  companyId: string
  periodKey: string
  /** Server-derived prior calendar month (Jan → prior-year Dec) — never caller-supplied. */
  openingPeriodKey: string
  bs: {
    /**
     * Buckets are SIGN-NORMALIZED to the natural convention per
     * `signConvention` (trial_balance ⇒ liabilities/equity/CY-result negated);
     * the stored sums are preserved in `rawSums` for disclosure.
     */
    assets: Bucket
    liabilities: Bucket
    equity: Bucket
    currentYearResult: Bucket | null
    rawSums: { assets: number; liabilities: number; equity: number }
    signConvention: ReturnType<typeof detectBsSignConvention>
  }
  cf: {
    operating: Bucket
    investing: Bucket
    financing: Bucket
    fxEffectOnCash: Bucket
    netChangeInCash: Bucket
    openingCash: Bucket
    closingCash: Bucket
  }
  pl: {
    /**
     * When `ytdAligned`, buckets carry the YTD subset (monthIndex ≤
     * periodMonth−1, 0-indexed); otherwise the whole plan year (disclosure
     * only — an unaligned P&L is never used as control evidence).
     */
    revenue: Bucket
    cogs: Bucket
    expense: Bucket
    monthIndexNullCount: number
    ytdAligned: boolean
    planCount: number
  }
  fx: Array<{
    currencyCode: string
    reportedBaseSum: number
    rowCount: number
    /**
     * `rate` is the INDEPENDENT CurrencyRateHistory rate, matched as the
     * latest rate dated at or before the row's month end (may carry forward
     * from an earlier month — see the `staleIndependentRate` note); never
     * BudgetLine.exchangeRate. `rateDate` is the matched rate's own date,
     * retained so carry-forward staleness stays disclosable downstream.
     */
    rows: Array<{
      originalAmount: number | null
      monthIndex: number | null
      rate: number | null
      rateDate: Date | null
    }>
  }>
}

const BASE_CURRENCY = "AZN"
const PL_ACCOUNT_TYPES = new Set(["revenue", "cogs", "expense"])

function priorMonthKey(year: number, month: number): string {
  const y = month === 1 ? year - 1 : year
  const m = month === 1 ? 12 : month - 1
  return `${y}-${String(m).padStart(2, "0")}`
}

/**
 * Load the raw statement evidence for one company. Read-only: `tx` is used
 * exclusively for findMany/findFirst; every `where` carries explicit
 * `{ organizationId, companyId }` (+ `deletedAt: null` on soft-deleted models)
 * on top of the RLS transaction — defense in depth.
 *
 * Returns null when the company has zero balance-sheet rows AND zero
 * cash-flow rows (the route answers `noStatements`).
 */
export async function fetchStatementEvidence(
  tx: Prisma.TransactionClient,
  organizationId: string,
  companyId: string,
  requestedPeriod?: string | null,
): Promise<ShadowStatementEvidence | null> {
  // ── Balance sheet rows (all periods; the control period is resolved below) ──
  const allBsLines = await tx.balanceSheetLine.findMany({
    where: { organizationId, companyId, deletedAt: null },
    select: {
      lineType: true,
      amount: true,
      year: true,
      month: true,
      account: { select: { name: true, nameEn: true, nameRu: true, nameAz: true } },
    },
  })

  // ── Resolve the control period ──
  let periodYear: number
  let periodMonth: number
  if (requestedPeriod) {
    periodYear = Number(requestedPeriod.slice(0, 4))
    periodMonth = Number(requestedPeriod.slice(5, 7))
  } else if (allBsLines.length > 0) {
    // Latest (year, month), exactly like ifrs-check.
    let maxY = -Infinity
    let maxM = -Infinity
    for (const l of allBsLines) {
      if (l.year > maxY || (l.year === maxY && l.month > maxM)) {
        maxY = l.year
        maxM = l.month
      }
    }
    periodYear = maxY
    periodMonth = maxM
  } else {
    const latestCf = await tx.cashFlowEntry.findFirst({
      where: { organizationId, companyId, deletedAt: null },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { year: true, month: true },
    })
    if (!latestCf) return null // zero BS rows AND zero CF rows → noStatements
    periodYear = latestCf.year
    periodMonth = latestCf.month
  }
  if (allBsLines.length === 0 && requestedPeriod) {
    // A requested period still needs SOME statement to speak for.
    const anyCf = await tx.cashFlowEntry.findFirst({
      where: { organizationId, companyId, deletedAt: null },
      select: { id: true },
    })
    if (!anyCf) return null
  }
  const periodKey = `${periodYear}-${String(periodMonth).padStart(2, "0")}`
  const openingPeriodKey = priorMonthKey(periodYear, periodMonth)

  // ── Balance-sheet buckets at the control period ──
  const rawAssets: Bucket = { sum: 0, rowCount: 0 }
  const rawLiabilities: Bucket = { sum: 0, rowCount: 0 }
  const rawEquity: Bucket = { sum: 0, rowCount: 0 }
  let rawCurrentYearResult: Bucket | null = null
  for (const l of allBsLines) {
    if (l.year !== periodYear || l.month !== periodMonth) continue
    if (l.lineType === "asset") {
      rawAssets.sum += l.amount
      rawAssets.rowCount += 1
    } else if (l.lineType === "liability") {
      rawLiabilities.sum += l.amount
      rawLiabilities.rowCount += 1
    } else if (l.lineType === "equity") {
      rawEquity.sum += l.amount
      rawEquity.rowCount += 1
      const joinedName = [l.account?.name, l.account?.nameRu, l.account?.nameAz, l.account?.nameEn]
        .filter(Boolean)
        .join(" ")
      if (CURRENT_YEAR_RESULT_RE.test(joinedName)) {
        rawCurrentYearResult = rawCurrentYearResult ?? { sum: 0, rowCount: 0 }
        rawCurrentYearResult.sum += l.amount
        rawCurrentYearResult.rowCount += 1
      }
    }
  }
  const signConvention = detectBsSignConvention(rawAssets.sum, rawLiabilities.sum, rawEquity.sum)
  // Trial-balance storage ⇒ natural value = −stored for liabilities/equity/CY-result.
  const flip = signConvention.convention === "trial_balance" ? -1 : 1
  const bs: ShadowStatementEvidence["bs"] = {
    assets: rawAssets,
    liabilities: { sum: flip * rawLiabilities.sum, rowCount: rawLiabilities.rowCount },
    equity: { sum: flip * rawEquity.sum, rowCount: rawEquity.rowCount },
    currentYearResult: rawCurrentYearResult
      ? { sum: flip * rawCurrentYearResult.sum, rowCount: rawCurrentYearResult.rowCount }
      : null,
    rawSums: {
      assets: rawAssets.sum,
      liabilities: rawLiabilities.sum,
      equity: rawEquity.sum,
    },
    signConvention,
  }

  // ── Cash-flow buckets at the control period ──
  // Amounts are stored Math.abs with the direction in entryType (dynamic-cf-
  // adapter contract): signed sum = Σ(inflow ? amount : −amount). This is a
  // deterministic convention mapping, never a sign correction.
  const cfEntries = await tx.cashFlowEntry.findMany({
    where: { organizationId, companyId, deletedAt: null, year: periodYear, month: periodMonth },
    select: {
      activityType: true,
      entryType: true,
      amount: true,
      account: { select: { code: true } },
    },
  })
  const cf: ShadowStatementEvidence["cf"] = {
    operating: { sum: 0, rowCount: 0 },
    investing: { sum: 0, rowCount: 0 },
    financing: { sum: 0, rowCount: 0 },
    fxEffectOnCash: { sum: 0, rowCount: 0 },
    netChangeInCash: { sum: 0, rowCount: 0 },
    openingCash: { sum: 0, rowCount: 0 },
    closingCash: { sum: 0, rowCount: 0 },
  }
  for (const e of cfEntries) {
    const code = e.account?.code?.trim().toUpperCase() ?? ""
    const bridgeKind = e.activityType === "bridge"
      ? classifyCashFlowCode(code)?.bridgeKind
      : null
    const bucket =
      e.activityType === "operating"
        ? cf.operating
        : e.activityType === "investing"
          ? cf.investing
          : e.activityType === "financing"
            ? cf.financing
            : bridgeKind === "fx_effect_on_cash"
              ? cf.fxEffectOnCash
              : bridgeKind === "net_change_in_cash"
                ? cf.netChangeInCash
                : bridgeKind === "opening_cash"
                  ? cf.openingCash
                  : bridgeKind === "closing_cash"
                    ? cf.closingCash
            : null
    if (!bucket) continue
    bucket.sum += e.entryType === "inflow" ? e.amount : -e.amount
    bucket.rowCount += 1
  }

  // ── P&L (budget lines pinned to the control period's plan year) ──
  // NOTE: BudgetLine.exchangeRate is deliberately NOT selected — the ledger's
  // own rate blinds the fx_translation control (builder doc: the recompute
  // rate must be INDEPENDENT).
  const budgetLines = await tx.budgetLine.findMany({
    where: {
      organizationId,
      companyId,
      deletedAt: null,
      plan: { year: periodYear, deletedAt: null },
    },
    select: {
      plannedAmount: true,
      monthIndex: true,
      currencyCode: true,
      originalAmount: true,
      planId: true,
      account: { select: { accountType: true } },
    },
  })
  const plContributing = budgetLines.filter((l) => PL_ACCOUNT_TYPES.has(l.account?.accountType ?? ""))
  const monthIndexNullCount = plContributing.filter((l) => l.monthIndex == null).length
  const ytdAligned = monthIndexNullCount === 0
  const plRows = ytdAligned
    ? plContributing.filter((l) => (l.monthIndex as number) <= periodMonth - 1)
    : plContributing
  const pl: ShadowStatementEvidence["pl"] = {
    revenue: { sum: 0, rowCount: 0 },
    cogs: { sum: 0, rowCount: 0 },
    expense: { sum: 0, rowCount: 0 },
    monthIndexNullCount,
    ytdAligned,
    planCount: new Set(budgetLines.map((l) => l.planId)).size,
  }
  for (const l of plRows) {
    const bucket =
      l.account?.accountType === "revenue"
        ? pl.revenue
        : l.account?.accountType === "cogs"
          ? pl.cogs
          : pl.expense
    bucket.sum += l.plannedAmount
    bucket.rowCount += 1
  }

  // ── FX: foreign-currency budget lines + INDEPENDENT monthly rates ──
  const foreignCurrencies = [
    ...new Set(
      budgetLines
        .map((l) => l.currencyCode)
        .filter((c): c is string => c != null && c.trim().toUpperCase() !== BASE_CURRENCY),
    ),
  ].sort()
  let fx: ShadowStatementEvidence["fx"] = []
  if (foreignCurrencies.length > 0) {
    const rateRows = await tx.currencyRateHistory.findMany({
      where: { organizationId, currencyCode: { in: foreignCurrencies } },
      select: { currencyCode: true, rate: true, rateDate: true },
      orderBy: { rateDate: "asc" },
    })
    fx = foreignCurrencies.map((currencyCode) => {
      const rows = budgetLines.filter((l) => l.currencyCode === currencyCode)
      return {
        currencyCode,
        reportedBaseSum: rows.reduce((s, l) => s + l.plannedAmount, 0),
        rowCount: rows.length,
        rows: rows.map((l) => {
          let rate: number | null = null
          let rateDate: Date | null = null
          if (l.monthIndex != null) {
            // Latest org-scoped rate with rateDate ≤ that month's end. No
            // lower bound: an older rate carries forward across months — the
            // matched rateDate is retained so the assembly can disclose it.
            const monthEnd = Date.UTC(periodYear, l.monthIndex + 1, 0, 23, 59, 59, 999)
            for (const r of rateRows) {
              if (r.currencyCode === currencyCode && r.rateDate.getTime() <= monthEnd) {
                rate = r.rate
                rateDate = r.rateDate
              }
            }
          }
          return { originalAmount: l.originalAmount, monthIndex: l.monthIndex, rate, rateDate }
        }),
      }
    })
  }

  return { organizationId, companyId, periodKey, openingPeriodKey, bs, cf, pl, fx }
}

export type SideSummary = {
  label: string
  /** Non-finite side values serialize as null. */
  value: number | null
  sourceRowCount: number
  revisionId: string | null
}

export type ComponentSummary = {
  component: string
  present: boolean
  value: number | null
  sourceRowCount: number
  noteKey?: string
}

/**
 * Per-currency disclosure of the matched independent rates' own dates, so a
 * carried-forward (stale) rate is visible instead of silently feeding every
 * month. The staleness THRESHOLD is an owner methodology decision — this is
 * engineering-only disclosure; the carry-forward matching itself is unchanged.
 */
export interface FxRateDateSummary {
  /** ISO date of the oldest matched independent rate. */
  min: string
  /** ISO date of the newest matched independent rate. */
  max: string
  /** Rows whose matched rate was carried forward from an earlier calendar month. */
  staleRowCount: number
}

export type ShadowControlEntry =
  | {
      kind: "evaluated"
      code: StatementControlCode
      currency?: string
      result: StatementControlResult
      left: SideSummary
      right: SideSummary
      components: ComponentSummary[]
      notes: string[]
      fxRateDates?: FxRateDateSummary
    }
  | {
      kind: "no_evidence"
      code: StatementControlCode
      currency?: string
      reasonKey: string
      builderError?: { code: StatementControlBuilderErrorCode; component: string }
      components: ComponentSummary[]
      notes: string[]
      fxRateDates?: FxRateDateSummary
    }

function sideSummary(side: StatementControlSide): SideSummary {
  return {
    label: side.label,
    value: Number.isFinite(side.value) ? side.value : null,
    sourceRowCount: side.sourceRowCount,
    revisionId: side.revisionId,
  }
}

/**
 * Assemble and evaluate the six shadow statement controls. PURE — consumes the
 * fetched evidence only. Every component carries `revisionId: null` (no
 * lineage exists in this DB; a revision id is never fabricated) and a bucket
 * with zero rows becomes `evidence: null` (absent ≠ zero). Combined with the
 * provisional policy, `decisionEligible` is always false, so `decisionStatus`
 * is mathematically never "pass"/"fail".
 */
export function assembleShadowStatementControls(evidence: ShadowStatementEvidence): ShadowControlEntry[] {
  const scope: StatementControlScope = {
    organizationId: evidence.organizationId,
    companyId: evidence.companyId,
    periodKey: evidence.periodKey,
    basis: "plan",
    currency: BASE_CURRENCY,
    unit: BASE_CURRENCY,
  }

  const makeComponent = (
    name: string,
    role: StatementComponentRole,
    bucket: Bucket | null,
    periodKey: string = scope.periodKey,
  ): StatementComponent => ({
    component: name,
    organizationId: scope.organizationId,
    companyId: scope.companyId,
    periodKey,
    basis: scope.basis,
    currency: scope.currency,
    unit: scope.unit,
    role,
    evidence:
      bucket != null && bucket.rowCount > 0
        ? { value: bucket.sum, sourceRowCount: bucket.rowCount, revisionId: null }
        : null,
  })

  const summarize = (c: StatementComponent, noteKey?: string): ComponentSummary => ({
    component: c.component,
    present: c.evidence != null,
    value: c.evidence?.value ?? null,
    sourceRowCount: c.evidence?.sourceRowCount ?? 0,
    ...(noteKey ? { noteKey } : {}),
  })

  const entries: ShadowControlEntry[] = []

  // Each builder runs inside try/catch: a StatementControlBuilderError becomes
  // an honest no_evidence entry — one bad control must never 500 the route.
  const push = (
    code: StatementControlCode,
    components: ComponentSummary[],
    notes: string[],
    build: () => ReturnType<typeof buildBalanceSheetControl>,
    extra: { currency?: string; fxRateDates?: FxRateDateSummary } = {},
  ): void => {
    const shared = {
      ...(extra.currency ? { currency: extra.currency } : {}),
      ...(extra.fxRateDates ? { fxRateDates: extra.fxRateDates } : {}),
    }
    try {
      const input = build()
      const result = evaluateStatementControl(input, SHADOW_STATEMENT_POLICY)
      entries.push({
        kind: "evaluated",
        code,
        ...shared,
        result,
        left: sideSummary(input.left),
        right: sideSummary(input.right),
        components,
        notes,
      })
    } catch (err) {
      if (!(err instanceof StatementControlBuilderError)) throw err
      entries.push({
        kind: "no_evidence",
        code,
        ...shared,
        reasonKey: err.code,
        builderError: { code: err.code, component: err.component },
        components,
        notes,
      })
    }
  }

  // ── 1. balance_sheet — evaluable when all three buckets have rows ──
  {
    const assets = makeComponent("assets", "closing", evidence.bs.assets)
    const liabilities = makeComponent("liabilities", "closing", evidence.bs.liabilities)
    const equityC = makeComponent("equity", "closing", evidence.bs.equity)
    // translationAdjustment omitted: no CTA/FCTR marker exists in the schema —
    // supplying one would be fabrication; omitting reduces to the base equation.
    push(
      "balance_sheet",
      [summarize(assets), summarize(liabilities), summarize(equityC)],
      [],
      () => buildBalanceSheetControl(scope, { assets, liabilities, equity: equityC }),
    )
  }

  // ── 2. cash_flow_sum — evaluates only against independently imported CF.05.
  // CF.04 is optional IAS-7 FX-effect evidence on the left. We never derive
  // the right side from the movements, because that would be a tautology. ──
  {
    const operating = makeComponent("operating", "flow", evidence.cf.operating)
    const investing = makeComponent("investing", "flow", evidence.cf.investing)
    const financing = makeComponent("financing", "flow", evidence.cf.financing)
    const netChangeInCash = makeComponent("netChangeInCash", "flow", evidence.cf.netChangeInCash)
    const fxEffectOnCash = makeComponent("fxEffectOnCash", "flow", evidence.cf.fxEffectOnCash)
    const netChangeMissing = evidence.cf.netChangeInCash.rowCount === 0
    const fxPresent = evidence.cf.fxEffectOnCash.rowCount > 0
    push(
      "cash_flow_sum",
      [
        summarize(operating),
        summarize(investing),
        summarize(financing),
        ...(fxPresent ? [summarize(fxEffectOnCash)] : []),
        summarize(netChangeInCash, netChangeMissing ? "netChangeNotStored" : undefined),
      ],
      netChangeMissing ? ["netChangeNotStored"] : [],
      () => buildCashFlowSumControl(scope, {
        operating,
        investing,
        financing,
        netChangeInCash,
        ...(fxPresent ? { fxEffectOnCash } : {}),
      }),
    )
  }

  // ── 3. cash_to_balance_sheet — remains BLOCKED by design. Imported CF.06/
  // CF.07 are same-statement bridge figures, not an independent balance-sheet
  // cash marker. Using CF.07 on the right would manufacture a self tie-out. ──
  {
    const openingCash = makeComponent("openingCash", "opening", null, evidence.openingPeriodKey)
    const netChangeInCash = makeComponent("netChangeInCash", "flow", null)
    const balanceSheetCash = makeComponent("balanceSheetCash", "closing", null)
    const operating = makeComponent("operating", "flow", evidence.cf.operating)
    const investing = makeComponent("investing", "flow", evidence.cf.investing)
    const financing = makeComponent("financing", "flow", evidence.cf.financing)
    push(
      "cash_to_balance_sheet",
      [
        summarize(openingCash, "cashNotIdentifiable"),
        summarize(netChangeInCash, "netChangeNotStored"),
        summarize(balanceSheetCash, "cashNotIdentifiable"),
        summarize(operating),
        summarize(investing),
        summarize(financing),
      ],
      ["netChangeNotStored", "cashNotIdentifiable"],
      () =>
        buildCashToBalanceSheetControl(scope, evidence.openingPeriodKey, {
          openingCash,
          netChangeInCash,
          balanceSheetCash,
        }),
    )
  }

  // P&L net income, honestly YTD-aligned: only usable when every contributing
  // row carries monthIndex (stamping the periodKey on unaligned whole-plan
  // data would be misleading evidence).
  const plRowCount =
    evidence.pl.revenue.rowCount + evidence.pl.cogs.rowCount + evidence.pl.expense.rowCount
  const netIncomeBucket: Bucket | null =
    evidence.pl.ytdAligned && plRowCount > 0
      ? {
          sum: evidence.pl.revenue.sum - evidence.pl.cogs.sum - evidence.pl.expense.sum,
          rowCount: plRowCount,
        }
      : null
  const netIncomeNoteKey = !evidence.pl.ytdAligned ? "monthIndexMissing" : undefined

  // ── 4. retained_earnings — BLOCKED by design: no marker identifies
  // accumulated RE (CURRENT_YEAR_RESULT_RE names the CURRENT-YEAR line, which
  // is not retained earnings), no distribution model exists anywhere in the
  // schema (asserting evidencedZero would claim evidence the DB does not
  // hold), and direct adjustments are unknown. ──
  {
    const openingRetainedEarnings = makeComponent(
      "openingRetainedEarnings",
      "opening",
      null,
      evidence.openingPeriodKey,
    )
    const netIncome = makeComponent("netIncome", "flow", netIncomeBucket)
    const distributions = makeComponent("distributions", "flow", null)
    const directAdjustments = makeComponent("directAdjustments", "flow", null)
    const closingRetainedEarnings = makeComponent("closingRetainedEarnings", "closing", null)
    const notes = ["retainedEarningsNotIdentifiable", "distributionsNotRecorded"]
    if (netIncomeNoteKey) notes.push(netIncomeNoteKey)
    push(
      "retained_earnings",
      [
        summarize(openingRetainedEarnings, "retainedEarningsNotIdentifiable"),
        summarize(netIncome, netIncomeNoteKey),
        summarize(distributions, "distributionsNotRecorded"),
        summarize(directAdjustments),
        summarize(closingRetainedEarnings, "retainedEarningsNotIdentifiable"),
      ],
      notes,
      () =>
        buildRetainedEarningsControl(scope, evidence.openingPeriodKey, {
          openingRetainedEarnings,
          netIncome,
          distributions,
          directAdjustments,
          closingRetainedEarnings,
        }),
    )
  }

  // ── 5. net_income_link — provisional when the P&L is fully month-indexed
  // AND a CURRENT_YEAR_RESULT_RE equity line matched; blocked otherwise. ──
  {
    const pnlNetIncome = makeComponent("pnlNetIncome", "flow", netIncomeBucket)
    const linkedStatementNetIncome = makeComponent(
      "linkedStatementNetIncome",
      "flow",
      evidence.bs.currentYearResult,
    )
    const linkedNoteKey =
      evidence.bs.currentYearResult == null ? "noCurrentYearResultLine" : undefined
    const notes: string[] = []
    if (netIncomeNoteKey) notes.push(netIncomeNoteKey)
    if (linkedNoteKey) notes.push(linkedNoteKey)
    push(
      "net_income_link",
      [summarize(pnlNetIncome, netIncomeNoteKey), summarize(linkedStatementNetIncome, linkedNoteKey)],
      notes,
      () => buildNetIncomeLinkControl(scope, { pnlNetIncome, linkedStatementNetIncome }),
    )
  }

  // ── 6. fx_translation — one control per foreign source currency. Rates come
  // ONLY from CurrencyRateHistory (independent of the import); the ledger's
  // BudgetLine.exchangeRate is never read — it cancels on both sides and
  // blinds the control. Missing local amount / monthIndex / rate → the term's
  // evidence stays null → honest blocked, never fabricated. ──
  if (evidence.fx.length === 0) {
    // AZN-vs-AZN would throw source_currency_not_distinct by design — the
    // builder is deliberately not invoked when no foreign currency exists.
    entries.push({
      kind: "no_evidence",
      code: "fx_translation",
      reasonKey: "noForeignCurrencyRows",
      components: [],
      notes: [],
    })
  } else {
    for (const fxCur of evidence.fx) {
      const reportedBase = makeComponent("reportedBase", "flow", {
        sum: fxCur.reportedBaseSum,
        rowCount: fxCur.rowCount,
      })
      const recomputed: FxRecomputedTerm[] = fxCur.rows.map((r) => ({
        localAmount: r.originalAmount != null && Number.isFinite(r.originalAmount) ? r.originalAmount : null,
        rate: r.rate,
        sourceRowCount: 1,
        revisionId: null,
      }))
      const notes: string[] = []
      if (fxCur.rows.some((r) => r.originalAmount == null || !Number.isFinite(r.originalAmount))) {
        notes.push("originalAmountMissing")
      }
      if (fxCur.rows.some((r) => r.monthIndex == null)) notes.push("monthIndexMissing")
      if (fxCur.rows.some((r) => r.monthIndex != null && r.rate == null)) {
        notes.push("noIndependentRate")
      }
      // Rate-staleness disclosure (engineering-only): the match has no lower
      // date bound, so a rate can carry forward across calendar months. When
      // any matched rate's own month precedes the budget row's month, the
      // entry says so and exposes the matched-rate date range — the staleness
      // THRESHOLD stays an owner methodology decision, matching unchanged.
      const periodYear = Number(evidence.periodKey.slice(0, 4))
      const matchedTimes = fxCur.rows
        .filter((r) => r.rateDate != null)
        .map((r) => (r.rateDate as Date).getTime())
      let fxRateDates: FxRateDateSummary | undefined
      if (matchedTimes.length > 0) {
        const staleRowCount = fxCur.rows.filter(
          (r) =>
            r.rateDate != null &&
            r.monthIndex != null &&
            (r.rateDate.getUTCFullYear() < periodYear ||
              (r.rateDate.getUTCFullYear() === periodYear &&
                r.rateDate.getUTCMonth() < r.monthIndex)),
        ).length
        fxRateDates = {
          min: new Date(Math.min(...matchedTimes)).toISOString(),
          max: new Date(Math.max(...matchedTimes)).toISOString(),
          staleRowCount,
        }
        if (staleRowCount > 0) notes.push("staleIndependentRate")
      }
      const recomputable = recomputed.every((t) => t.localAmount != null && t.rate != null)
      const recomputedSummary: ComponentSummary = {
        component: "recomputed",
        present: recomputable,
        value: recomputable
          ? recomputed.reduce((s, t) => s + (t.localAmount as number) * (t.rate as number), 0)
          : null,
        sourceRowCount: fxCur.rowCount,
        ...(notes.length > 0 ? { noteKey: notes[0] } : {}),
      }
      push(
        "fx_translation",
        [summarize(reportedBase), recomputedSummary],
        notes,
        () => buildFxTranslationControl(scope, fxCur.currencyCode, "flow", { reportedBase, recomputed }),
        { currency: fxCur.currencyCode, ...(fxRateDates ? { fxRateDates } : {}) },
      )
    }
  }

  return entries
}
