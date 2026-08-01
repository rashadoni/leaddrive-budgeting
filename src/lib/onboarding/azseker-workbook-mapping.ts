/**
 * AzerSheker × Workbook CoA mapping.
 *
 * Workbook Consulting prepared a 5-year consolidated financial forecast
 * (P&L + Balance Sheet + Cash Flow) for 4 AzerSheker entities (CPC,
 * AZSF, EDEN, Malt) using their own hierarchical coding convention:
 *
 *   PLF.01            REVENUE
 *   PLF.01.01         Revenue from Farming Activities
 *   PLF.01.01.05      Revenue from Sale of Wheat
 *   BS.01.01          NON-CURRENT ASSETS
 *   CF.01.01          INFLOW FROM OPERATING ACTIVITIES
 *
 * This module ships **pure classifiers** that map any Workbook code →
 * BudgetPro's internal taxonomy. Consumed by:
 *   - AI Data Mapper's anomaly-rules.ts (recognises Workbook prefix
 *     pattern → bypasses generic anomaly classification)
 *   - applier.ts when writing BudgetLine.lineType / BalanceSheetLine /
 *     CashFlowEntry.activityType from a Workbook-shaped upload
 *
 * All 681 distinct codes across 4 entities share the same prefix tree;
 * one classifier covers every entity. New leaf-codes added by Workbook
 * inherit their parent's classification automatically.
 *
 * The PLF code map is NOT restated here. It lives in
 * `src/lib/budgeting/plf-chart.ts`, which the importer and the reporting layer
 * also read — this file only translates that classification into the
 * `WorkbookAccountType` union. Restating it is what produced three
 * independent answers for `PLF.07` and one 13,453,098 AZN defect.
 *
 * Code map (non-PLF sections, which this file still owns):
 *   BS.01     asset
 *   BS.02     equity
 *   BS.03     liability
 *   CF.01     operating (CashFlowEntry.activityType)
 *   CF.02     investing
 *   CF.03     financing
 *   CF.04-07  SKIP — bridge rows (FX change, net change, opening, closing)
 */

import { plfNature } from "../budgeting/plf-chart";

export type WorkbookAccountType =
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

const WORKBOOK_PREFIX_RE = /^(PLF|BS|CF)\.\d/;

/**
 * Detects whether a string looks like a Workbook-format code.
 *
 * Examples that match: "PLF.01", "PLF.01.01", "PLF.01.01.05",
 *   "BS.01.01.01.01", "CF.01.02.03", "PLF.05.R" (regions section).
 *
 * Used by AI Data Mapper anomaly-rules to short-circuit on recognised
 * customer-specific coding conventions.
 */
export function isWorkbookCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return WORKBOOK_PREFIX_RE.test(code.trim());
}

/**
 * Maps a Workbook PLF.* / BS.* / CF.* code to BudgetPro's internal
 * account-type taxonomy.
 *
 * Returns "skip" for computed totals (gross margin / EBITDA / net
 * profit) and CF bridge rows (FX change / opening / closing balance) —
 * caller should NOT persist these as BudgetLine / BalanceSheetLine.
 */
export function classifyWorkbookCode(code: string): WorkbookAccountType {
  if (!isWorkbookCode(code)) return "skip";
  const norm = code.trim();

  // PLF — P&L Forecast.
  //
  // 2026-08-01 — this branch used to restate the section map inline, and it
  // was the THIRD copy of it in the repo. It happened to be the one that got
  // PLF.07 right (income under `.01/.02`) while `azseker-plf.ts` typed the
  // same codes as expense from the section number — one chart, two answers,
  // 13,453,098 AZN. Both now read `plf-chart.ts`.
  if (norm.startsWith("PLF.")) {
    switch (plfNature(norm)) {
      case "revenue":
      case "other_operating_income":
        return "revenue";
      case "cogs":
        return "cogs";
      case "opex":
      case "other_operating_expense":
      case "below_ebitda":
        return "expense";
      case "subtotal":
        return "skip";
      case null:
        // Unrecognised PLF section — bias to expense (conservative; AI Mapper
        // surfaces it as an anomaly to the reviewer).
        return "expense";
    }
  }

  // BS — Balance Sheet
  if (norm.startsWith("BS.")) {
    if (norm.startsWith("BS.01")) return "asset";
    if (norm.startsWith("BS.02")) return "equity";
    if (norm.startsWith("BS.03")) return "liability";
    return "skip";
  }

  // CF — Cash Flow — handled via classifyWorkbookCashFlowActivity().
  // For the BudgetLine taxonomy CF rows are skipped (they live in the
  // CashFlowEntry table, not BudgetLine).
  if (norm.startsWith("CF.")) return "skip";

  return "skip";
}

/**
 * Maps a Workbook CF.* code to the operating/investing/financing taxonomy
 * BudgetPro uses on `CashFlowEntry.activityType`. Non-CF codes + CF
 * bridge rows return "skip".
 */
export function classifyWorkbookCashFlowActivity(code: string): CashFlowActivity {
  if (!isWorkbookCode(code) || !code.startsWith("CF.")) return "skip";
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
 * Sheet name → entity company code resolution for the Workbook workbook.
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
 * Cost-center label prefix → AZSEKER child entity code. Used by the
 * Farming KPI parser to route per-row data (multiple farms per sheet)
 * to the right operational entity. Driven entirely by config — to
 * onboard a new farm, add one row here.
 *
 * Cost-center labels in Farming KPI look like:
 *   "EDN – Füzuli Qayıdış Əkinçilik"     ← prefix EDN
 *   "AZS- Əkinçilik Yevlax təsərrüfatı"  ← prefix AZS
 *   "QT - Beyləqan təsərrufatı …"         ← prefix QT (Qarabağ Taxıl)
 *   "DAS- Əkinçilik Yevlax …"             ← prefix DAS (Dastan)
 *   "Ağcabədi təsərrüfatı - BO"           ← suffix BO (Əkinçi BO)
 *
 * The matcher (`resolveEntityFromCostCenter`) scans the label for any
 * 2-5 letter uppercase token (word-bounded) and looks it up in this
 * map. First match wins.
 *
 * Phase 7.M (2026-05-19, Azik confirmation): QT/DAS/BO farms are
 * operated under Eden Agro (= AZSEKER-EDEN) — there is no separate
 * "AZSEKER-FARM" legal entity. All farming cost-centers route to EDEN.
 */
export const WORKBOOK_COST_CENTER_PREFIX_TO_ENTITY: Readonly<Record<string, string>> = {
  EDN: "AZSEKER-EDEN",
  AZS: "AZSEKER-AZSF",
  QT: "AZSEKER-EDEN",   // Qarabağ Taxıl — operated under Eden Agro
  DAS: "AZSEKER-EDEN",  // Dastan — operated under Eden Agro
  BO: "AZSEKER-EDEN",   // Əkinçi BO — operated under Eden Agro
  CPC: "AZSEKER-CPC",
  MALT: "AZSEKER-MALT",
};

/**
 * Resolve a cost-center / farm-name label to an AZSEKER child entity
 * code via prefix-token lookup. Returns null if no recognised token
 * appears.
 */
export function resolveEntityFromCostCenter(label: string): string | null {
  if (typeof label !== "string" || label.trim() === "") return null;
  // Match any 2-5 uppercase letter token at a word boundary
  const tokens = label.match(/\b[A-Z]{2,5}\b/g) ?? [];
  for (const t of tokens) {
    const entity = WORKBOOK_COST_CENTER_PREFIX_TO_ENTITY[t];
    if (entity) return entity;
  }
  return null;
}

/**
 * Sheet name → statement / KPI family. Returns null for sheets that
 * don't match a known scenario.
 *
 *   "PLF CPC" / "PL Malt"  → PLF (P&L)
 *   "BS CPC" / "BS Malt"   → BS  (Balance Sheet)
 *   "CF CPC" / "CF Malt"   → CF  (Cash Flow)
 *   "Farming KPI"           → KPI_FARMING (per-row multi-entity yield data)
 *   "CPC KPI"               → KPI_PROCESSING (single-entity processing metrics)
 *
 * Sales plan sheets ("Farming Budget sales plan",
 * "Production Budget sales plan", "Satış ProMalt") are recognised but
 * not yet dispatched — returned as null until the SALES_PLAN adapter
 * is wired in a follow-up.
 */
export function classifyWorkbookSheetFamily(
  name: string,
): "PLF" | "BS" | "CF" | "KPI_FARMING" | "KPI_PROCESSING" | null {
  const trimmed = name.trim();
  if (/^PLF?\s+\w+/.test(trimmed)) return "PLF"; // both "PLF" and "PL Malt"
  if (/^BS\s+\w+/.test(trimmed)) return "BS";
  if (/^CF\s+\w+/.test(trimmed)) return "CF";
  // KPI sheet families:
  // "Farming KPI" — multi-entity per-row farm yield data (header row
  //   has İl/Məhsul/Sezon/...). Per-row entity resolution via
  //   `resolveEntityFromCostCenter`.
  if (/^Farming\s+KPI\s*$/i.test(trimmed)) return "KPI_FARMING";
  // "<Entity> KPI" — single-entity processing/operational metrics.
  // The entity is encoded in the sheet name prefix and matched by the
  // same prefix table the cost-center resolver uses.
  if (/^(?:CPC|AZSF|EDEN|MALT|Farm|Farming|Sugarbeet|Horizon)\s+KPI\s*$/i.test(trimmed)) {
    return "KPI_PROCESSING";
  }
  return null;
}

/**
 * Resolve the entity for a `KPI_PROCESSING` sheet (single-entity).
 * Sheet name pattern: "<ENTITY> KPI" — pull the token before "KPI"
 * and run it through the same prefix-to-entity map. Returns null if
 * no match.
 */
export function resolveEntityFromProcessingKpiSheet(
  sheetName: string,
): string | null {
  const trimmed = sheetName.trim();
  const m = /^([A-Za-z]+)\s+KPI\s*$/i.exec(trimmed);
  if (!m) return null;
  const token = m[1].toUpperCase();
  return WORKBOOK_COST_CENTER_PREFIX_TO_ENTITY[token] ?? null;
}
