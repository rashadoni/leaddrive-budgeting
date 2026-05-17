/**
 * AzerSheker × Guvven CoA mapping.
 *
 * Guvven Consulting prepared a 5-year consolidated financial forecast
 * (P&L + Balance Sheet + Cash Flow) for 4 AzerSheker entities (CPC,
 * AZSF, EDEN, Malt) using their own hierarchical coding convention:
 *
 *   PLF.01            REVENUE
 *   PLF.01.01         Revenue from Farming Activities
 *   PLF.01.01.05      Revenue from Sale of Wheat
 *   BS.01.01          NON-CURRENT ASSETS
 *   CF.01.01          INFLOW FROM OPERATING ACTIVITIES
 *
 * This module ships **pure classifiers** that map any Guvven code →
 * BudgetPro's internal taxonomy. Consumed by:
 *   - AI Data Mapper's anomaly-rules.ts (recognises Guvven prefix
 *     pattern → bypasses generic anomaly classification)
 *   - applier.ts when writing BudgetLine.lineType / BalanceSheetLine /
 *     CashFlowEntry.activityType from a Guvven-shaped upload
 *
 * All 681 distinct codes across 4 entities share the same prefix tree;
 * one classifier covers every entity. New leaf-codes added by Guvven
 * inherit their parent's classification automatically.
 *
 * Code map (top-level sections):
 *   PLF.01    revenue
 *   PLF.02    cogs
 *   PLF.03    SKIP — Gross Margin (computed = revenue − cogs)
 *   PLF.04    expense (Sales & Marketing functions)
 *   PLF.05    expense (G&A — head office + regions)
 *   PLF.07.01 revenue (interest income, non-operating)
 *   PLF.07.02 revenue (non-operating income)
 *   PLF.07.03 expense (non-operating expenses)
 *   PLF.07.04 expense (gain/loss on disposal — net, classified as expense)
 *   PLF.08    SKIP — EBITDA (computed)
 *   PLF.09.01 expense (shareholders' expense)
 *   PLF.09.02 expense (interest expense, finance cost)
 *   PLF.09.03 expense (D&A)
 *   PLF.09.04 expense (profit tax)
 *   PLF.10    SKIP — Net Profit (computed)
 *   PLF.12    expense (provisions)
 *   BS.01     asset
 *   BS.02     equity
 *   BS.03     liability
 *   CF.01     operating (CashFlowEntry.activityType)
 *   CF.02     investing
 *   CF.03     financing
 *   CF.04-07  SKIP — bridge rows (FX change, net change, opening, closing)
 */

export type GuvvenAccountType =
  | "revenue"
  | "cogs"
  | "expense"
  | "asset"
  | "liability"
  | "equity"
  | "skip"; // computed totals + bridge rows — not stored as accounts

export type CashFlowActivity =
  | "operating"
  | "investing"
  | "financing"
  | "skip";

const GUVVEN_PREFIX_RE = /^(PLF|BS|CF)\.\d/;

/**
 * Detects whether a string looks like a Guvven-format code.
 *
 * Examples that match: "PLF.01", "PLF.01.01", "PLF.01.01.05",
 *   "BS.01.01.01.01", "CF.01.02.03", "PLF.05.R" (regions section).
 *
 * Used by AI Data Mapper anomaly-rules to short-circuit on recognised
 * customer-specific coding conventions.
 */
export function isGuvvenCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return GUVVEN_PREFIX_RE.test(code.trim());
}

/**
 * Maps a Guvven PLF.* / BS.* / CF.* code to BudgetPro's internal
 * account-type taxonomy.
 *
 * Returns "skip" for computed totals (gross margin / EBITDA / net
 * profit) and CF bridge rows (FX change / opening / closing balance) —
 * caller should NOT persist these as BudgetLine / BalanceSheetLine.
 */
export function classifyGuvvenCode(code: string): GuvvenAccountType {
  if (!isGuvvenCode(code)) return "skip";
  const norm = code.trim();

  // PLF — P&L Forecast
  if (norm.startsWith("PLF.")) {
    // Computed totals — not stored.
    if (
      norm === "PLF.03" ||
      norm.startsWith("PLF.03.") ||
      norm === "PLF.08" ||
      norm.startsWith("PLF.08.") ||
      norm === "PLF.10" ||
      norm.startsWith("PLF.10.")
    ) {
      return "skip";
    }
    // Revenue family.
    if (norm.startsWith("PLF.01")) return "revenue";
    // COGS.
    if (norm.startsWith("PLF.02")) return "cogs";
    // S&M + G&A — expenses.
    if (norm.startsWith("PLF.04") || norm.startsWith("PLF.05")) {
      return "expense";
    }
    // Other operating: 07.01 interest income + 07.02 non-op income
    // are revenue; 07.03 non-op expense + 07.04 gain/loss on disposal
    // are expense.
    if (norm.startsWith("PLF.07.01") || norm.startsWith("PLF.07.02")) {
      return "revenue";
    }
    if (
      norm.startsWith("PLF.07.03") ||
      norm.startsWith("PLF.07.04") ||
      norm === "PLF.07"
    ) {
      // Parent "PLF.07 OTHER OPERATING INCOME/EXPENSES" header — skip.
      return norm === "PLF.07" ? "skip" : "expense";
    }
    // Below EBITDA: finance + tax + D&A — expense.
    if (norm.startsWith("PLF.09")) return "expense";
    // Provisions.
    if (norm.startsWith("PLF.12")) return "expense";
    // Unrecognised PLF leaf — bias to expense (conservative; AI Mapper
    // surfaces as anomaly to reviewer).
    return "expense";
  }

  // BS — Balance Sheet
  if (norm.startsWith("BS.")) {
    if (norm.startsWith("BS.01")) return "asset";
    if (norm.startsWith("BS.02")) return "equity";
    if (norm.startsWith("BS.03")) return "liability";
    return "skip";
  }

  // CF — Cash Flow — handled via classifyGuvvenCashFlowActivity().
  // For the BudgetLine taxonomy CF rows are skipped (they live in the
  // CashFlowEntry table, not BudgetLine).
  if (norm.startsWith("CF.")) return "skip";

  return "skip";
}

/**
 * Maps a Guvven CF.* code to the operating/investing/financing taxonomy
 * BudgetPro uses on `CashFlowEntry.activityType`. Non-CF codes + CF
 * bridge rows return "skip".
 */
export function classifyGuvvenCashFlowActivity(code: string): CashFlowActivity {
  if (!isGuvvenCode(code) || !code.startsWith("CF.")) return "skip";
  const norm = code.trim();
  // CF.04 NET FOREX CHANGE / CF.05 NET / CF.06 OPENING / CF.07 CLOSING
  // are bridge/total rows — not single-activity entries.
  if (
    norm === "CF.04" ||
    norm.startsWith("CF.04.") ||
    norm === "CF.05" ||
    norm.startsWith("CF.05.") ||
    norm === "CF.06" ||
    norm.startsWith("CF.06.") ||
    norm === "CF.07" ||
    norm.startsWith("CF.07.")
  ) {
    return "skip";
  }
  if (norm.startsWith("CF.01")) return "operating";
  if (norm.startsWith("CF.02")) return "investing";
  if (norm.startsWith("CF.03")) return "financing";
  return "skip";
}

/**
 * Sheet name → entity company code resolution for the Guvven workbook.
 * Each financial sheet is named "<FAMILY> <ENTITY>":
 *   "PLF CPC" / "BS CPC" / "CF CPC" → AZSEKER-CPC
 *   "PLF AZSF" / "BS AZSF" / "CF AZSF" → AZSEKER-AZSF
 *   "PLF EDEN" / "BS EDEN" / "CF EDEN" → AZSEKER-EDEN
 *   "PL Malt" / "BS Malt" / "CF Malt" → AZSEKER-MALT (new — Session 9)
 *
 * Returns null for non-financial sheets (sales plans, KPI separators).
 */
export function resolveEntityFromSheetName(
  name: string,
): string | null {
  const trimmed = name.trim();
  // Family prefix "PLF" or "PL" or "BS" or "CF" then space + entity token.
  const match = /^(?:PLF|PL|BS|CF)\s+([A-Za-z]+)\s*$/.exec(trimmed);
  if (!match) return null;
  const entity = match[1].toUpperCase();
  switch (entity) {
    case "CPC": return "AZSEKER-CPC";
    case "AZSF": return "AZSEKER-AZSF";
    case "EDEN": return "AZSEKER-EDEN";
    case "MALT": return "AZSEKER-MALT";
    default: return null;
  }
}

/**
 * Sheet name → statement family (PLF / BS / CF). Returns null for
 * sheets that aren't a financial statement.
 */
export function classifyGuvvenSheetFamily(
  name: string,
): "PLF" | "BS" | "CF" | null {
  const trimmed = name.trim();
  if (/^PLF?\s+\w+/.test(trimmed)) return "PLF"; // both "PLF" and "PL Malt"
  if (/^BS\s+\w+/.test(trimmed)) return "BS";
  if (/^CF\s+\w+/.test(trimmed)) return "CF";
  return null;
}
