/**
 * Depreciation & Amortization account-code prefixes for AZMADE
 * (Azerbaijani SAP chart of accounts).
 *
 * Verified Turn 38 sub-turn 4 via psql against `chart_of_accounts`:
 *   703-11 = "Amortizasiya xərcləri- maya dəyəri"   (D&A inside COGS)
 *   721-11 = "Amortizasiya xərcləri"                (D&A inside OpEx)
 *
 * Why this matters:
 *   - True EBITDA = Earnings Before Interest, Tax, Depreciation, Amortization
 *   - The naive "Rev − COGS − OpEx" gives EBIT, not EBITDA, because COGS
 *     and OpEx already have D&A subtracted via the 703-11 / 721-11 lines.
 *   - To get correct EBITDA: add D&A back (D&A_in_COGS + D&A_in_OpEx).
 *
 * Pre-Turn-38-sub4 the Margin Trends chart on /budgeting?tab=pnl-report
 * mislabeled the "EBIT" line as "EBITDA Margin" — finance audience would
 * spot it immediately.
 */
export const DA_CODE_PREFIXES = ["703-11", "721-11"] as const;

export function isDaCode(code: string): boolean {
  return DA_CODE_PREFIXES.some((p) => code.startsWith(p));
}
