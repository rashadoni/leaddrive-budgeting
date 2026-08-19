/**
 * Indirect cash flow, built from balance-sheet movements (2026-08-19).
 *
 * The "Pul axını" tab held zero rows. Everything needed was already imported —
 * it just had never been assembled.
 *
 * ## Why this starts from the balance sheet and not from net profit
 *
 * The textbook indirect statement starts at the P&L result. On this client's
 * data that does not work: over February–May the P&L reports a loss of
 * 2,786,112 while the balance sheet's own current-year line moves by 94,651.
 * A statement started from the P&L would carry that 2.7M disagreement as an
 * unexplained plug on a 7.4M cash movement — useless in exactly the part
 * people read it for.
 *
 * Built from balance movements instead, the statement reconciles by
 * construction: the balance sheet balances at every month (verified: the three
 * sections sum to within ±1 on a base of 250 million), so the movements must
 * add up to the movement in cash. What remains is classification, which is a
 * judgment written down in `BALANCE_MAP` rather than inferred.
 *
 * ## Capital contributions are their own line, and that is not cosmetic
 *
 * Equity moves for two reasons: the result of the period and money the owners
 * put in. Over this window two entities received injections — 6,393,180 and
 * 7,476,816 — and folding those into "result" would report a business that
 * earned 13.9M it did not earn. The result is therefore DERIVED as equity
 * movement minus contributions, and the contributions stand in financing where
 * they belong. Reading only the current-year equity line, which is the obvious
 * shortcut, misses this entirely: the two entities that fail to reconcile that
 * way are exactly the two that were funded.
 *
 * ## The P&L result is shown, not used
 *
 * `pnlResult` is carried through for display beside the derived figure. Where
 * they disagree the surface says so. Hiding it would bury a real defect in one
 * of the two statements, and this screen is where it is most visible.
 *
 * Pure.
 */
import { BALANCE_MAP, type BalanceAccountAmount, type BalanceBucket } from "./balance-ratios"

export interface CashFlowInputs {
  /** Balance at the opening date, as stored. */
  opening: ReadonlyArray<BalanceAccountAmount>
  /** Balance at the closing date, as stored. */
  closing: ReadonlyArray<BalanceAccountAmount>
  /**
   * Depreciation over the window, for presentation only. Supplied, operating
   * shows the conventional add-back and investing shows GROSS capex; omitted,
   * investing is net of depreciation. The bottom line is identical either way.
   */
  depreciation?: number
  /** The P&L's own result for the window, for comparison. Never used in the sum. */
  pnlResult?: number | null
}

export interface CashFlowLine {
  key: string
  /** Positive is cash in. */
  amount: number
}

export interface IndirectCashFlow {
  operating: { lines: CashFlowLine[]; total: number }
  investing: { lines: CashFlowLine[]; total: number }
  financing: { lines: CashFlowLine[]; total: number }
  netChange: number
  openingCash: number
  closingCash: number
  /**
   * Computed change minus the actual movement in cash. Zero by construction
   * when the balance sheet balances; a figure here means it does not, and is
   * shown rather than absorbed.
   */
  unreconciled: number
  /** Result derived from equity, and the P&L's own, so a reader can compare. */
  derivedResult: number
  pnlResult: number | null
  /** Null when there is nothing to compare against. */
  resultDisagreement: number | null
}

const NEGATED: ReadonlySet<BalanceBucket> = new Set<BalanceBucket>([
  "debt_short", "debt_long", "payables",
  "other_current_liabilities", "other_long_liabilities", "equity",
])

function bucketsOf(accounts: ReadonlyArray<BalanceAccountAmount>) {
  const out = new Map<BalanceBucket, number>()
  let shareCapital = 0
  for (const a of accounts) {
    const code = a.code.trim().toUpperCase()
    // Share capital is tracked apart from the rest of equity: it is the only
    // equity line that is not a result.
    if (code === "BS.02.01.01") shareCapital += -a.amount
    const bucket = BALANCE_MAP[code]
    if (!bucket) continue
    out.set(bucket, (out.get(bucket) ?? 0) + (NEGATED.has(bucket) ? -a.amount : a.amount))
  }
  return { get: (b: BalanceBucket) => out.get(b) ?? 0, shareCapital }
}

export function computeIndirectCashFlow(input: CashFlowInputs): IndirectCashFlow {
  const o = bucketsOf(input.opening)
  const c = bucketsOf(input.closing)
  const d = (b: BalanceBucket) => c.get(b) - o.get(b)

  const contributions = c.shareCapital - o.shareCapital
  // Equity grew by this much for BOTH reasons; the contributions come out.
  const derivedResult = d("equity") - contributions
  const da = input.depreciation ?? 0

  // An asset growing consumes cash; a liability growing releases it.
  const operatingLines: CashFlowLine[] = [
    { key: "result", amount: derivedResult },
    ...(da !== 0 ? [{ key: "depreciation", amount: da }] : []),
    { key: "receivables", amount: -d("receivables") },
    { key: "inventory", amount: -d("inventory") },
    { key: "biological", amount: -d("biological") },
    { key: "otherCurrentAssets", amount: -d("other_current_assets") },
    { key: "payables", amount: d("payables") },
    { key: "otherCurrentLiabilities", amount: d("other_current_liabilities") },
  ]

  const investingLines: CashFlowLine[] = [
    // Gross of depreciation when it was added back above, so the two presentations
    // differ in shape and never in the bottom line.
    { key: "nonCurrentAssets", amount: -d("non_current_assets") - da },
  ]

  const financingLines: CashFlowLine[] = [
    { key: "debtShort", amount: d("debt_short") },
    { key: "debtLong", amount: d("debt_long") },
    { key: "otherLongLiabilities", amount: d("other_long_liabilities") },
    { key: "contributions", amount: contributions },
  ]

  const sum = (l: CashFlowLine[]) => l.reduce((s, x) => s + x.amount, 0)
  const operating = { lines: operatingLines, total: sum(operatingLines) }
  const investing = { lines: investingLines, total: sum(investingLines) }
  const financing = { lines: financingLines, total: sum(financingLines) }
  const netChange = operating.total + investing.total + financing.total

  const openingCash = o.get("cash")
  const closingCash = c.get("cash")
  const pnlResult = input.pnlResult ?? null

  return {
    operating,
    investing,
    financing,
    netChange,
    openingCash,
    closingCash,
    unreconciled: netChange - (closingCash - openingCash),
    derivedResult,
    pnlResult,
    resultDisagreement: pnlResult === null ? null : derivedResult - pnlResult,
  }
}
