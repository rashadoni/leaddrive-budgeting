/**
 * Phase 7.N — Post-import IFRS structural-conformance checks.
 *
 * Client feedback (verbatim): "FS ifrs uyğun yığılmasınnı yoxlamaq. importdan
 * sonra." — i.e. after importing a company's financial statements, verify the
 * statements are *assembled* in line with IFRS structural expectations.
 *
 * IMPORTANT — what this is and is NOT:
 *   - This is a STRUCTURAL conformance check, not an audit opinion. It looks at
 *     whether the imported statements have the shape IFRS (IAS 1) expects:
 *     a balancing balance sheet with all three sections, recognised revenue,
 *     cost of sales separated from operating expenses, and depreciation /
 *     amortisation identifiable as its own line.
 *   - It uses ONLY the real imported figures + the chart-of-accounts
 *     classification. It never fabricates numbers. Where a company has no data
 *     for a statement, the relevant checks are reported as `skip` (not `fail`).
 *
 * This module is intentionally PURE (no Prisma / no I/O) so the rules are unit
 * testable against real snapshots. The API route loads the data and calls
 * {@link runIfrsChecks}; the UI localises the returned `code`s.
 */

/** Snapshot of one company's imported balance sheet, summed by section. */
export interface IfrsBalanceSheetSnapshot {
  /** Whether any balance-sheet line was imported for this company. */
  present: boolean
  /** Signed sum of asset-type lines (as stored). */
  assets: number
  /** Signed sum of liability-type lines (as stored). */
  liabilities: number
  /** Signed sum of equity-type lines (as stored). */
  equity: number
  /** Distinct section presence — IAS 1 expects all three. */
  hasAssetSection: boolean
  hasLiabilitySection: boolean
  hasEquitySection: boolean
  lineCount: number
  /** Asset lines total / how many carry a current·non-current subType (IAS 1 §60). */
  assetLineCount: number
  assetSubTypedCount: number
  /** Liability lines total / how many carry a short·long-term subType. */
  liabilityLineCount: number
  liabilitySubTypedCount: number
  /** Distinct equity accounts — IAS 1 expects equity split into components. */
  equityComponentCount: number
}

/** Snapshot of one company's imported P&L, summed by account class. */
export interface IfrsPnlSnapshot {
  /** Whether any P&L (budget) line was imported for this company. */
  present: boolean
  /** Signed sum of revenue-type account lines. */
  revenue: number
  /** Signed sum of cost-of-sales (COGS) account lines. */
  cogs: number
  /** Signed sum of operating-expense account lines. */
  opex: number
  revenueAccountCount: number
  cogsAccountCount: number
  opexAccountCount: number
  /** Count of accounts identifiable as depreciation / amortisation. */
  depreciationAccountCount: number
  lineCount: number
}

export interface IfrsCheckInput {
  balanceSheet: IfrsBalanceSheetSnapshot
  pnl: IfrsPnlSnapshot
}

export type IfrsStatus = "pass" | "warn" | "fail" | "skip"

export interface IfrsCheckResult {
  /** Stable machine code — UI maps this to a localised label/explanation. */
  code: string
  status: IfrsStatus
  /** Honest English fallback (used when no localisation exists for `code`). */
  messageEn: string
  /** Numeric / string context for display + localisation interpolation. */
  values?: Record<string, number | string>
}

export interface IfrsReport {
  checks: IfrsCheckResult[]
  summary: {
    pass: number
    warn: number
    fail: number
    skip: number
    /** Conformance score 0-100 over non-skipped checks (warn counts half). */
    score: number | null
  }
}

/* ──────────────────── data shaping (pure) ──────────────────── */

/** A balance-sheet line as loaded from the DB (only the fields we need). */
export interface RawBsLine {
  /** "asset" | "liability" | "equity" */
  lineType: string
  amount: number
  /** current·non-current (assets) / short·long-term (liabilities); null if unclassified. */
  subType?: string | null
  /** Stable account identity (accountId) — for distinct equity-component counting. */
  accountKey?: string
}

/** A P&L (budget) line joined to its chart-of-accounts classification. */
export interface RawPlLine {
  amount: number
  /** ChartOfAccount.accountType: revenue | cogs | expense | asset | liability | equity */
  accountType: string
  /** Stable account identity (accountId) — for distinct-account counting. */
  accountKey: string
  /** ChartOfAccount.category, e.g. "depreciation". */
  category?: string | null
  /** Account name(s) — used to detect D&A when category is absent. */
  accountName?: string | null
}

/** Matches depreciation / amortisation across EN/RU/AZ account names. */
const DEPRECIATION_NAME_RE =
  /deprec|amort|аморт|износ|köhnəl|kohnal|yıpran|yipran/i

function isDepreciationAccount(l: RawPlLine): boolean {
  if ((l.category ?? "").toLowerCase() === "depreciation") return true
  return DEPRECIATION_NAME_RE.test(l.accountName ?? "")
}

/**
 * Shape raw DB rows into the {@link IfrsCheckInput} the checks consume.
 * Pure — the API route does the Prisma I/O and hands the rows here.
 *
 * Account counts are DISTINCT by `accountKey` (a P&L account repeats across
 * periods, but it's still one account for structural purposes).
 */
export function buildIfrsInput(bsLines: RawBsLine[], plLines: RawPlLine[]): IfrsCheckInput {
  let assets = 0
  let liabilities = 0
  let equity = 0
  let hasAssetSection = false
  let hasLiabilitySection = false
  let hasEquitySection = false
  let assetLineCount = 0
  let assetSubTypedCount = 0
  let liabilityLineCount = 0
  let liabilitySubTypedCount = 0
  const equityAccounts = new Set<string>()
  const subTyped = (s?: string | null) => !!s && s.trim() !== ""
  for (const l of bsLines) {
    switch (l.lineType) {
      case "asset":
        assets += l.amount
        hasAssetSection = true
        assetLineCount += 1
        if (subTyped(l.subType)) assetSubTypedCount += 1
        break
      case "liability":
        liabilities += l.amount
        hasLiabilitySection = true
        liabilityLineCount += 1
        if (subTyped(l.subType)) liabilitySubTypedCount += 1
        break
      case "equity":
        equity += l.amount
        hasEquitySection = true
        // Count distinct equity accounts; fall back to a per-line key when
        // no accountKey is supplied so each line still counts as a component.
        equityAccounts.add(l.accountKey ?? `eq:${equityAccounts.size}`)
        break
    }
  }

  let revenue = 0
  let cogs = 0
  let opex = 0
  const revenueAccounts = new Set<string>()
  const cogsAccounts = new Set<string>()
  const opexAccounts = new Set<string>()
  const depreciationAccounts = new Set<string>()
  for (const l of plLines) {
    switch (l.accountType) {
      case "revenue":
        revenue += l.amount
        revenueAccounts.add(l.accountKey)
        break
      case "cogs":
        cogs += l.amount
        cogsAccounts.add(l.accountKey)
        if (isDepreciationAccount(l)) depreciationAccounts.add(l.accountKey)
        break
      case "expense":
        opex += l.amount
        opexAccounts.add(l.accountKey)
        if (isDepreciationAccount(l)) depreciationAccounts.add(l.accountKey)
        break
    }
  }

  return {
    balanceSheet: {
      present: bsLines.length > 0,
      assets,
      liabilities,
      equity,
      hasAssetSection,
      hasLiabilitySection,
      hasEquitySection,
      lineCount: bsLines.length,
      assetLineCount,
      assetSubTypedCount,
      liabilityLineCount,
      liabilitySubTypedCount,
      equityComponentCount: equityAccounts.size,
    },
    pnl: {
      present: plLines.length > 0,
      revenue,
      cogs,
      opex,
      revenueAccountCount: revenueAccounts.size,
      cogsAccountCount: cogsAccounts.size,
      opexAccountCount: opexAccounts.size,
      depreciationAccountCount: depreciationAccounts.size,
      lineCount: plLines.length,
    },
  }
}

/** Relative tolerance for the balance-sheet identity (0.5% of the larger side, min 1 unit). */
function balanceTolerance(assets: number, liabPlusEquity: number): number {
  const scale = Math.max(Math.abs(assets), Math.abs(liabPlusEquity), 1)
  return Math.max(1, 0.005 * scale)
}

/**
 * The accounting identity Assets = Liabilities + Equity can be stored two ways:
 *   - Natural convention: all three positive → residual = A − L − E ≈ 0.
 *   - Signed / trial-balance convention (what this codebase imports): assets
 *     positive, liabilities & equity negative → residual = A + L + E ≈ 0.
 * We accept EITHER, so the check is convention-agnostic.
 */
function balanceResidual(bs: IfrsBalanceSheetSnapshot): {
  residual: number
  tolerance: number
} {
  const signed = bs.assets + bs.liabilities + bs.equity
  const natural = bs.assets - bs.liabilities - bs.equity
  const residual =
    Math.abs(signed) <= Math.abs(natural) ? signed : natural
  const tolerance = balanceTolerance(bs.assets, bs.liabilities + bs.equity)
  return { residual, tolerance }
}

function round(n: number): number {
  return Math.round(n)
}

/** Run the structural IFRS-conformance checks over one company's FS snapshot. */
export function runIfrsChecks(input: IfrsCheckInput): IfrsReport {
  const { balanceSheet: bs, pnl } = input
  const checks: IfrsCheckResult[] = []

  /* ── 1. Balance sheet balances (Assets = Liabilities + Equity) ── */
  if (!bs.present) {
    checks.push({
      code: "bs_balances",
      status: "skip",
      messageEn: "No balance sheet imported for this company.",
    })
  } else {
    const { residual, tolerance } = balanceResidual(bs)
    const balanced = Math.abs(residual) <= tolerance
    checks.push({
      code: "bs_balances",
      status: balanced ? "pass" : "fail",
      messageEn: balanced
        ? "Balance sheet balances: Assets = Liabilities + Equity."
        : "Balance sheet does not balance — Assets ≠ Liabilities + Equity.",
      values: {
        assets: round(bs.assets),
        liabilities: round(bs.liabilities),
        equity: round(bs.equity),
        residual: round(residual),
        tolerance: round(tolerance),
      },
    })
  }

  /* ── 2. Balance sheet completeness (all three IAS 1 sections) ── */
  if (!bs.present) {
    checks.push({
      code: "bs_sections",
      status: "skip",
      messageEn: "No balance sheet imported for this company.",
    })
  } else {
    const missing: string[] = []
    if (!bs.hasAssetSection) missing.push("assets")
    if (!bs.hasLiabilitySection) missing.push("liabilities")
    if (!bs.hasEquitySection) missing.push("equity")
    let status: IfrsStatus = "pass"
    if (missing.length === 1) status = "warn"
    else if (missing.length >= 2) status = "fail"
    checks.push({
      code: "bs_sections",
      status,
      messageEn:
        missing.length === 0
          ? "Balance sheet has all three sections (assets, liabilities, equity)."
          : `Balance sheet missing section(s): ${missing.join(", ")}.`,
      values: { missing: missing.join(",") || "—", missingCount: missing.length },
    })
  }

  /* ── 2b. Current vs non-current classification (IAS 1 §60) ── */
  if (!bs.present) {
    checks.push({
      code: "bs_current_noncurrent",
      status: "skip",
      messageEn: "No balance sheet imported for this company.",
    })
  } else {
    // A section is "classified" when at least half its lines carry a subType.
    const assetCov = bs.assetLineCount > 0 ? bs.assetSubTypedCount / bs.assetLineCount : 1
    const liabCov = bs.liabilityLineCount > 0 ? bs.liabilitySubTypedCount / bs.liabilityLineCount : 1
    const assetsClassified = bs.assetLineCount === 0 || assetCov >= 0.5
    const liabClassified = bs.liabilityLineCount === 0 || liabCov >= 0.5
    const unclassified: string[] = []
    if (!assetsClassified) unclassified.push("assets")
    if (!liabClassified) unclassified.push("liabilities")
    checks.push({
      code: "bs_current_noncurrent",
      status: unclassified.length === 0 ? "pass" : "warn",
      messageEn:
        unclassified.length === 0
          ? "Assets and liabilities are split into current vs non-current (IAS 1 §60)."
          : `No current/non-current split on: ${unclassified.join(", ")}.`,
      values: {
        assetsClassifiedPct: Math.round(assetCov * 100),
        liabilitiesClassifiedPct: Math.round(liabCov * 100),
        unclassified: unclassified.join(",") || "—",
      },
    })
  }

  /* ── 2c. Equity broken into components (IAS 1 §54/§78(e)) ── */
  if (!bs.present || !bs.hasEquitySection) {
    checks.push({
      code: "bs_equity_composition",
      status: "skip",
      messageEn: "No equity section imported for this company.",
    })
  } else if (bs.equityComponentCount >= 2) {
    checks.push({
      code: "bs_equity_composition",
      status: "pass",
      messageEn: "Equity is broken into components (e.g. share capital, retained earnings).",
      values: { equityComponents: bs.equityComponentCount },
    })
  } else {
    checks.push({
      code: "bs_equity_composition",
      status: "warn",
      messageEn: "Equity is a single lumped line — IAS 1 expects components shown separately.",
      values: { equityComponents: bs.equityComponentCount },
    })
  }

  /* ── 3. Revenue recognised ── */
  if (!pnl.present) {
    checks.push({
      code: "pnl_revenue",
      status: "skip",
      messageEn: "No income statement imported for this company.",
    })
  } else if (pnl.revenueAccountCount === 0) {
    checks.push({
      code: "pnl_revenue",
      status: "fail",
      messageEn: "No revenue accounts found in the income statement.",
      values: { revenue: round(pnl.revenue), revenueAccounts: 0 },
    })
  } else if (pnl.revenue === 0) {
    checks.push({
      code: "pnl_revenue",
      status: "warn",
      messageEn: "Revenue accounts exist but total revenue is zero.",
      values: { revenue: 0, revenueAccounts: pnl.revenueAccountCount },
    })
  } else {
    checks.push({
      code: "pnl_revenue",
      status: "pass",
      messageEn: "Revenue is recognised in the income statement.",
      values: { revenue: round(pnl.revenue), revenueAccounts: pnl.revenueAccountCount },
    })
  }

  /* ── 4. Cost of sales separated from operating expenses (IAS 1 by-function) ── */
  if (!pnl.present) {
    checks.push({
      code: "pnl_cogs_opex_separation",
      status: "skip",
      messageEn: "No income statement imported for this company.",
    })
  } else {
    const hasCogs = pnl.cogsAccountCount > 0
    const hasOpex = pnl.opexAccountCount > 0
    let status: IfrsStatus
    let messageEn: string
    if (hasCogs && hasOpex) {
      status = "pass"
      messageEn = "Cost of sales is separated from operating expenses."
    } else if (!hasCogs && !hasOpex) {
      status = "fail"
      messageEn = "No cost or expense accounts found in the income statement."
    } else {
      status = "warn"
      messageEn = hasCogs
        ? "Only cost of sales found — operating expenses are not separated."
        : "Only operating expenses found — cost of sales is not separated."
    }
    checks.push({
      code: "pnl_cogs_opex_separation",
      status,
      messageEn,
      values: {
        cogsAccounts: pnl.cogsAccountCount,
        opexAccounts: pnl.opexAccountCount,
      },
    })
  }

  /* ── 5. Depreciation / amortisation identifiable (IAS 1 disclosure) ── */
  if (!pnl.present) {
    checks.push({
      code: "pnl_depreciation",
      status: "skip",
      messageEn: "No income statement imported for this company.",
    })
  } else if (pnl.depreciationAccountCount > 0) {
    checks.push({
      code: "pnl_depreciation",
      status: "pass",
      messageEn: "Depreciation / amortisation is identifiable as its own line.",
      values: { depreciationAccounts: pnl.depreciationAccountCount },
    })
  } else {
    checks.push({
      code: "pnl_depreciation",
      status: "warn",
      messageEn:
        "No depreciation / amortisation line identified — IAS 1 expects D&A disclosed.",
      values: { depreciationAccounts: 0 },
    })
  }

  /* ── Summary ── */
  const pass = checks.filter((c) => c.status === "pass").length
  const warn = checks.filter((c) => c.status === "warn").length
  const fail = checks.filter((c) => c.status === "fail").length
  const skip = checks.filter((c) => c.status === "skip").length
  const scored = pass + warn + fail
  const score = scored === 0 ? null : Math.round((100 * (pass + 0.5 * warn)) / scored)

  return { checks, summary: { pass, warn, fail, skip, score } }
}
