/**
 * AI Data Mapper — types & schemas (Phase 7.B NEW).
 *
 * The mapper takes a raw xlsx sheet (any layout) from a new-onboarding
 * company and proposes:
 *   - column-mapping: which sheet column corresponds to which canonical
 *     CoA code / accountType, with a confidence score and brief reasoning.
 *   - anomalies: rows or values that look implausible (negative revenue,
 *     COGS > revenue × 5, single-row 99% of total, foreign-currency mix-up,
 *     etc.) — flagged BEFORE DB commit so finance reviewer catches them.
 *
 * Why this exists: every new xlsx today requires a programmer to write a
 * sheet-specific adapter (see `azmade-sopl.ts`). With ~60 companies to
 * onboard, this is the bottleneck. The AI mapper proposes a mapping; user
 * reviews & confirms in UI; then a generic xlsx-import path applies it.
 *
 * This file is types only — pure, no LLM dependency.
 */

export type AccountType =
  | 'revenue'
  | 'cogs'
  | 'expense'
  | 'asset'
  | 'liability'
  | 'equity';

/** A single column in the source xlsx sheet. */
export interface SourceColumn {
  /** 0-based column index in the sheet. */
  index: number;
  /** Header cell text as-extracted (may be empty/whitespace). */
  headerText: string;
  /** Up to 5 sample data values from the column (for the LLM to disambiguate). */
  samples: Array<string | number | null>;
}

/** Mapping proposal for one source column. */
export interface ColumnMappingProposal {
  /** 0-based source column index this proposal refers to. */
  sourceIndex: number;
  /**
   * One of:
   *   - `'code'` — column carries account codes (e.g. `601-04`)
   *   - `'label'` — column carries human labels (e.g. `Məhsul satışı`)
   *   - `'amount:<period>'` — column is a monthly/annual amount; `<period>`
   *     is `Jan..Dec` for monthly, `Total` for annual sum, `Plan|Actual`
   *     for plan-vs-actual columns.
   *   - `'skip'` — column should be ignored (notes, dates, formulas, etc.)
   */
  role:
    | 'code'
    | 'label'
    | `amount:${string}`
    | 'skip';
  /** 0..1 confidence score from the LLM. Below 0.6 → ask user to confirm. */
  confidence: number;
  /** One-line LLM-generated reasoning (short, for UI tooltip). */
  reasoning: string;
}

/** A single anomaly found by the LLM during analysis. */
export interface Anomaly {
  /** 1-based spreadsheet row number where the anomaly appears (or null for sheet-level). */
  row: number | null;
  /** Severity tier — UI surfaces critical as red, warning as amber. */
  severity: 'critical' | 'warning' | 'info';
  /** Anomaly category for filtering / aggregation. */
  category:
    | 'sign_inversion'         // revenue stated as negative or cost as positive
    | 'magnitude_outlier'      // single value 99% of column total
    | 'category_mismatch'      // row labeled "revenue" but in expense section
    | 'duplicate_row'          // same code appearing twice with different amounts
    | 'missing_breakdown'      // parent total without children
    | 'currency_mix'           // some rows in AZN, others in foreign without rate
    | 'implausible_ratio'      // gross margin > 100% or < -200%
    | 'other';
  /** Human-readable description for the finance reviewer. */
  description: string;
}

/** Top-level proposal returned by the AI mapper. */
export interface MappingProposal {
  /** Source workbook + sheet combination. */
  sourceFile: string;
  sourceSheet: string;
  /** All column-level proposals. Length matches input column count. */
  columns: ColumnMappingProposal[];
  /** Account-type inference per CODE rows (e.g. `601-04` → `revenue`). */
  accountTypeOverrides?: Array<{
    code: string;
    accountType: AccountType;
    confidence: number;
    reasoning: string;
  }>;
  /** Anomalies found during analysis. May be empty on a clean sheet. */
  anomalies: Anomaly[];
  /**
   * Overall LLM confidence in the proposal as a whole (0..1). Below 0.7 →
   * UI defaults to "manual review" instead of "looks good, click apply".
   */
  overallConfidence: number;
  /**
   * Free-form summary the LLM produced (1-3 sentences). Surfaced to the
   * reviewer as the AI's "what I saw" message.
   */
  summary: string;
  /**
   * Tokens consumed (Anthropic API usage) — for budget tracking.
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Input bundle for the LLM call. */
export interface MapperInput {
  sourceFile: string;
  sourceSheet: string;
  /** All columns from the sheet, with samples. */
  columns: SourceColumn[];
  /** Up to 30 sample data rows (header + body) for the LLM to inspect structure. */
  sampleRows: Array<Array<string | number | null>>;
  /**
   * Hint about which company this is for (industry helps the LLM know
   * what categories to expect, e.g. agro vs hospitality).
   */
  companyContext?: {
    name?: string;
    industry?: string;
  };
}
