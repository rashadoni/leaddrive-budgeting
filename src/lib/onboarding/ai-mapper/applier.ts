/**
 * AI Data Mapper — applier (Phase 7.B Turn 2b).
 *
 * Takes the AI-generated `MappingProposal` (saved to `ImportStaging` by
 * /analyze) plus an xlsx workbook, and produces `ParsedBudgetLine[]` ready
 * for transactional insert into BudgetLine. Pure function — no DB / IO /
 * LLM dependency.
 *
 * Why this is a separate module from `mapper.ts`:
 *   - `mapper.ts` is the GENERATOR (LLM call → MappingProposal).
 *   - `applier.ts` is the CONSUMER (MappingProposal + xlsx → BudgetLine
 *     rows). Apply is deterministic, replayable, and runs without the
 *     LLM, so it MUST stay decoupled — re-running apply with the saved
 *     proposal must produce identical output even if the LLM no longer
 *     exists or returns something different now.
 *
 * Reuses pattern from `src/lib/onboarding/adapters/azmade-sopl.ts`:
 *   - `accountTypeFromCode()` for SAP-prefix fallback when proposal lacks
 *     an explicit override for a row's code.
 *   - `dedupeParentRollups()` for parent/leaf double-count safety +
 *     unallocated-delta reconciliation.
 */

import type * as XLSX from 'xlsx';
import {
  accountTypeFromCode,
  dedupeParentRollups,
  type AccountType,
  type ParsedBudgetLine,
  type ParseWarning,
  type ParseResult,
} from '../adapters/azmade-sopl';
import type {
  ColumnMappingProposal,
  MappingProposal,
} from './types';

const MONTH_ROLE_PREFIX = 'amount:';

/** Map of month abbreviation (lowercase) → 0-based month index. */
const MONTH_INDEX: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

interface ResolvedColumns {
  codeCol: number;
  labelCol: number;
  /** Length 12. Month index → source-column index. -1 means missing. */
  monthCols: number[];
  /** Source-column index of an "amount:Total" annual column, or -1 if none.
   *  Used as a per-row reconciliation control: Σ months must equal Total. */
  totalCol: number;
}

/**
 * Merge user-provided overrides on top of the saved proposal. UI lets the
 * reviewer flip specific column roles (e.g. say "this column the AI marked
 * as `skip` is actually `amount:Jan`") — overrides win on a per-column
 * basis. accountTypeOverrides merge by code (override wins).
 */
export function mergeProposal(
  base: MappingProposal,
  overrides: Partial<MappingProposal> | undefined,
): MappingProposal {
  if (!overrides) return base;

  // Column overrides — user can change `role` / `confidence` / `reasoning`
  // per sourceIndex. We rebuild the columns array index-by-index so a
  // partial override of just one column doesn't drop the rest.
  const colByIdx = new Map<number, ColumnMappingProposal>();
  for (const c of base.columns) colByIdx.set(c.sourceIndex, c);
  for (const c of overrides.columns ?? []) colByIdx.set(c.sourceIndex, c);
  const mergedColumns = [...colByIdx.values()].sort(
    (a, b) => a.sourceIndex - b.sourceIndex,
  );

  // Account-type overrides — merge by code.
  const acctByCode = new Map<
    string,
    NonNullable<MappingProposal['accountTypeOverrides']>[number]
  >();
  for (const a of base.accountTypeOverrides ?? []) acctByCode.set(a.code, a);
  for (const a of overrides.accountTypeOverrides ?? []) acctByCode.set(a.code, a);

  return {
    ...base,
    columns: mergedColumns,
    accountTypeOverrides: [...acctByCode.values()],
  };
}

/**
 * Resolve the proposal's column roles into concrete (codeCol, labelCol,
 * monthCols[12]) indices. Returns `null` if any required role is missing
 * or duplicated — caller surfaces a 400 to the user.
 */
export function resolveColumns(
  columns: ColumnMappingProposal[],
  opts: { preferYear?: number } = {},
): { ok: true; columns: ResolvedColumns } | { ok: false; reason: string } {
  let codeCol = -1;
  let labelCol = -1;
  let totalCol = -1;
  // Month candidates carry their (monthIdx, year) so a MULTI-YEAR sheet
  // (Jan-Dec × N years) can select a single target year instead of colliding
  // on "two Jans" (Phase C 2026-06-20). Single-year / bare-month sheets keep
  // year=null and behave exactly as before.
  const monthCandidates: Array<{ monthIdx: number; year: number | null; col: number; period: string }> = [];

  for (const c of columns) {
    if (c.role === 'code') {
      if (codeCol !== -1) {
        return { ok: false, reason: `Multiple "code" columns proposed (cols ${codeCol} and ${c.sourceIndex})` };
      }
      codeCol = c.sourceIndex;
    } else if (c.role === 'label') {
      if (labelCol !== -1) {
        return { ok: false, reason: `Multiple "label" columns proposed (cols ${labelCol} and ${c.sourceIndex})` };
      }
      labelCol = c.sourceIndex;
    } else if (c.role.startsWith(MONTH_ROLE_PREFIX)) {
      const period = c.role.slice(MONTH_ROLE_PREFIX.length).toLowerCase();
      // Split an optional 4-digit year off the month token: "jan2026" →
      // month "jan", year 2026; bare "jan" → year null.
      const ym = period.match(/(20\d{2})/);
      const year = ym ? Number(ym[1]) : null;
      const monthToken = period.replace(/20\d{2}/g, '').trim();
      const monthIdx = MONTH_INDEX[monthToken];
      if (monthIdx === undefined) {
        // `amount:Total` / `amount:Plan` — annual/aggregate columns. Capture
        // the annual "Total" (first wins) as a per-row reconciliation control.
        if (totalCol === -1 && monthToken.startsWith('total')) {
          totalCol = c.sourceIndex;
        }
        continue;
      }
      monthCandidates.push({ monthIdx, year, col: c.sourceIndex, period });
    }
    // role === 'skip' → ignored.
  }

  if (codeCol === -1) {
    return { ok: false, reason: 'Proposal has no "code" column — cannot identify accounts' };
  }
  if (labelCol === -1) {
    return { ok: false, reason: 'Proposal has no "label" column — cannot describe accounts' };
  }

  // Multi-year selection: when month roles carry >1 distinct year, keep only
  // the target year's columns (preferYear if present, else the latest year).
  const years = [
    ...new Set(monthCandidates.map((m) => m.year).filter((y): y is number => y !== null)),
  ];
  const chosenYear =
    years.length > 1
      ? opts.preferYear !== undefined && years.includes(opts.preferYear)
        ? opts.preferYear
        : Math.max(...years)
      : null;

  const monthCols = new Array<number>(12).fill(-1);
  for (const m of monthCandidates) {
    if (chosenYear !== null && m.year !== chosenYear) continue; // other year — skip
    if (monthCols[m.monthIdx] !== -1) {
      return {
        ok: false,
        reason: `Multiple columns mapped to month ${m.period} (cols ${monthCols[m.monthIdx]} and ${m.col})`,
      };
    }
    monthCols[m.monthIdx] = m.col;
  }

  const missingMonths = monthCols
    .map((c, i) => (c === -1 ? Object.entries(MONTH_INDEX).find(([, v]) => v === i)?.[0] : null))
    .filter((m): m is string => m !== null);
  if (missingMonths.length > 0) {
    return {
      ok: false,
      reason: `Proposal missing monthly columns: ${missingMonths.join(', ')}. All 12 months required for budget P&L apply.`,
    };
  }

  return { ok: true, columns: { codeCol, labelCol, monthCols, totalCol } };
}

/**
 * Detect the budget year from the proposal's column roles. Looks for
 * `amount:<Month><YYYY>` or `amount:Plan<YYYY>` patterns; returns the
 * single year present, or null if none, or `{ conflict: [year1, year2] }`
 * when multiple years are mixed (caller surfaces 400).
 */
export function detectProposalYear(
  columns: ColumnMappingProposal[],
): number | null | { conflict: number[] } {
  const years = new Set<number>();
  const yearRegex = /(20\d{2})/; // matches a 4-digit year starting with 20
  for (const c of columns) {
    if (!c.role.startsWith(MONTH_ROLE_PREFIX)) continue;
    const period = c.role.slice(MONTH_ROLE_PREFIX.length);
    const m = period.match(yearRegex);
    if (m) years.add(Number(m[1]));
  }
  if (years.size === 0) return null;
  if (years.size > 1) return { conflict: [...years].sort() };
  return [...years][0];
}

/** Coerce arbitrary cell value to number, treating strings/null as 0 fallback
 *  is unsafe — instead we return null for non-numeric, caller decides. */
function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTrimmedString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

/**
 * Phase 7.G Turn LXXXXVII (Phase 7.B v2 Day 4) — multi-sheet apply helper.
 *
 * Loops `applyProposal()` per sheet for workbooks containing multiple
 * P&L-shaped sheets (e.g. AZMADE-style multi-entity workbooks with one
 * P&L sheet per sub-entity). Returns per-sheet ParseResult or error.
 *
 * Storage shape (no schema migration — encoded in `ImportStaging.proposal`
 * Json field): `{ sheets: [{ sheetName, proposal }, ...] }`. Backward
 * compatible — single-sheet path stays as `{ ...proposal }` (the legacy
 * shape without `sheets` key).
 *
 * Caller (apply route) wraps each per-sheet insert in same transaction so
 * partial-failure rolls back ALL sheets.
 */
export type MultiSheetProposal = {
  sheets: Array<{ sheetName: string; proposal: MappingProposal }>
}

export type MultiSheetApplyResult = {
  perSheet: Array<
    | { sheetName: string; result: ParseResult }
    | { sheetName: string; error: string }
  >
}

export function isMultiSheetProposal(
  p: MappingProposal | MultiSheetProposal,
): p is MultiSheetProposal {
  return "sheets" in p && Array.isArray((p as MultiSheetProposal).sheets)
}

export function applyMultiSheetProposal(
  workbook: XLSX.WorkBook,
  multi: MultiSheetProposal,
  xlsx: typeof XLSX,
  userOverridesBySheet?: Record<string, Partial<MappingProposal>>,
): MultiSheetApplyResult {
  const perSheet: MultiSheetApplyResult["perSheet"] = []
  for (const { sheetName, proposal } of multi.sheets) {
    const overrides = userOverridesBySheet?.[sheetName]
    const result = applyProposal(workbook, sheetName, proposal, xlsx, overrides)
    if ("error" in result) {
      perSheet.push({ sheetName, error: result.error })
    } else {
      perSheet.push({ sheetName, result })
    }
  }
  return { perSheet }
}

/**
 * Apply the proposal to a workbook — returns ParsedBudgetLine[] with
 * dedup + reconciliation already applied. Caller (apply route) wraps the
 * insert in a transaction.
 */
/**
 * Map a P&L section-header label (or code) to an account type. This is the
 * accountType source for NON-SAP code schemes (e.g. "PLF.01.02") where the
 * code doesn't encode the type: the applier tracks the "current section" from
 * header rows and assigns the rows beneath it. Multilingual (EN / RU / AZ) so
 * an arbitrary client P&L resolves without per-file code. SAP-numeric codes
 * never reach this — they keep the accountTypeFromCode() prefix heuristic.
 *
 * Order matters: COGS ("cost of sales") and expenses ("sales & marketing")
 * both contain "sales", so they are matched BEFORE the generic revenue rule.
 */
export function detectSectionType(text: string | null): AccountType | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/cost of (goods|sales)|\bcogs\b|maya dəyər|maya deyer|себестоим/.test(t)) {
    return 'cogs';
  }
  if (/expense|\bopex\b|\bsg&a\b|administrativ|marketing|operating cost|depreciat|amortiz|amortis|köhnəlmə|amortizasiya|xərc|xerc|əməliyyat xərc|расход|издержк|амортизац|износ/.test(t)) {
    return 'expense';
  }
  if (/revenue|income|turnover|\bsales\b|gəlir|gelir|satış|выручк|доход|продаж/.test(t)) {
    return 'revenue';
  }
  return null;
}

/**
 * True when a label is a COMPUTED P&L subtotal (Gross Margin/Profit, EBITDA,
 * Net Profit, Operating Profit, "Total") rather than a real account line.
 * Used by the NON-SAP path to skip these — section-tracking would otherwise
 * mis-file e.g. "GROSS MARGIN" under the preceding COGS section. Multilingual.
 */
export function isSubtotalLabel(text: string | null): boolean {
  if (!text) return false;
  return /gross (margin|profit)|operating (profit|income|margin)|\bebitda\b|net (profit|loss|income)|profit before tax|\bsubtotal\b|\btotal\b|итого|ümumi mənfəət|əməliyyat mənfəət|xalis mənfəət|mənfəət \(zərər\)/i.test(
    text,
  );
}

/**
 * Resolve a non-SAP code's accountType from the AI overrides by LONGEST code
 * prefix. The mapper emits section/parent overrides (e.g. PLF.01→revenue) and
 * the importer applies a parent's type to all descendants: "PLF.01.02.05"
 * matches override "PLF.01". Longest (most specific) ancestor wins. Hierarchy
 * boundary is "." or "-" so "PLF.1" never matches "PLF.10".
 */
export function resolveTypeByPrefix(
  code: string,
  acctByCode: Map<string, AccountType>,
): AccountType | null {
  let best: { len: number; type: AccountType } | null = null;
  for (const [oc, t] of acctByCode) {
    if (
      code === oc ||
      code.startsWith(oc + '.') ||
      code.startsWith(oc + '-')
    ) {
      if (!best || oc.length > best.len) best = { len: oc.length, type: t };
    }
  }
  return best?.type ?? null;
}

export function applyProposal(
  workbook: XLSX.WorkBook,
  sheetName: string,
  proposal: MappingProposal,
  xlsx: typeof XLSX,
  userOverrides?: Partial<MappingProposal>,
  opts: { preferYear?: number } = {},
):
  | ParseResult
  | { error: string } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { error: `Sheet "${sheetName}" not found in workbook` };
  }

  const merged = mergeProposal(proposal, userOverrides);
  const colsResult = resolveColumns(merged.columns, opts);
  if (!colsResult.ok) return { error: colsResult.reason };
  const { codeCol, labelCol, monthCols, totalCol } = colsResult.columns;

  // Index account-type overrides by code for O(1) lookup.
  const acctByCode = new Map<string, AccountType>();
  for (const a of merged.accountTypeOverrides ?? []) {
    acctByCode.set(a.code, a.accountType);
  }

  const aoa = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<string | number | null>>;
  if (aoa.length === 0) {
    return { error: 'Sheet is empty' };
  }

  // Header band detection — same heuristic as ai-mapper/extract.ts. Apply
  // could in principle store the header row index in the proposal, but
  // re-detecting here lets us re-apply on a re-uploaded workbook with
  // minor row-count changes (e.g. user added a line or two before
  // re-running apply).
  const HEADER_DETECTION_LIMIT = 20;
  const MIN_NON_EMPTY = 3;
  const MAX_HEADER_CELL_LEN = 80;
  let headerEndRow = Math.min(5, aoa.length);
  for (let r = 0; r < Math.min(HEADER_DETECTION_LIMIT, aoa.length); r++) {
    const row = aoa[r] ?? [];
    const nonEmpty = row.filter((v) => v !== null && v !== undefined && v !== '');
    if (nonEmpty.length < MIN_NON_EMPTY) continue;
    const allStrings = nonEmpty.every((v) => typeof v === 'string');
    if (!allStrings) continue;
    const allShort = nonEmpty.every(
      (v) => typeof v === 'string' && v.length <= MAX_HEADER_CELL_LEN,
    );
    if (!allShort) continue;
    headerEndRow = r + 1;
    break;
  }

  const lines: ParsedBudgetLine[] = [];
  const warnings: ParseWarning[] = [];
  const rowTotalMismatches: Array<{
    code: string;
    stated: number;
    computed: number;
    delta: number;
  }> = [];
  const sectionTypeConflicts: Array<{
    code: string;
    resolvedType: string;
    sectionType: string;
  }> = [];
  let skipped = 0;

  // Tracks the current P&L section for NON-SAP code schemes (see
  // detectSectionType). SAP-numeric codes never consult it.
  let currentSection: AccountType | null = null;
  for (let r = headerEndRow; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const code = toTrimmedString(row[codeCol]);
    const label = toTrimmedString(row[labelCol]);

    // Update the current section from any header-ish row (including ones we
    // then skip) so the rows beneath a "REVENUE"/"COGS"/"EXPENSE" header
    // inherit the right type. No effect on the SAP path below.
    const sectionHit = detectSectionType(label) ?? detectSectionType(code);
    if (sectionHit) currentSection = sectionHit;

    if (!code) {
      skipped += 1;
      continue;
    }

    const isSapCode = /^\d{3,}(-\d+)*$/.test(code);
    let accountType: AccountType | null;

    if (isSapCode) {
      // ── SAP-numeric path (unchanged behaviour) ──
      // Silent-skip for 4xx / 5xx / 8xx codes BEFORE consulting accountType
      // overrides. These are informational rows in AZ accounting workbooks
      // (statistical accounts, off-balance items) — they MUST never land in
      // BudgetLine even if the LLM optimistically suggested an override for
      // them. Matches azmade-sopl invariant.
      const firstDigit = code.replace(/^[^\d]+/, '').charAt(0);
      if (firstDigit === '4' || firstDigit === '5' || firstDigit === '8') {
        skipped += 1;
        continue;
      }
      // Account-type resolution: explicit override wins; fall back to
      // SAP-prefix heuristic. Codes that match neither get a warning.
      accountType = acctByCode.get(code) ?? accountTypeFromCode(code);
      if (!accountType) {
        warnings.push({
          row: r + 1,
          reason: `code "${code}" didn't map to any accountType (no override + no SAP prefix match)`,
        });
        skipped += 1;
        continue;
      }
    } else {
      // ── Arbitrary code-scheme path (2026-06-20) ──
      // The code doesn't encode the type (e.g. "PLF.01.02"). First drop
      // computed subtotals (Gross Margin / EBITDA / Net Profit / Total) —
      // section-tracking would otherwise mis-file them under the preceding
      // section. Then resolve via an explicit override (AI/user) else the
      // tracked P&L section. A row that resolves to neither is skipped with a
      // warning — never a silent mis-map. Unlocks self-serve for non-SAP P&Ls.
      if (isSubtotalLabel(label)) {
        skipped += 1;
        continue;
      }
      // Resolution order: exact override → longest-prefix override (AI
      // section/parent classification) → tracked section header → skip.
      const overrideType =
        acctByCode.get(code) ?? resolveTypeByPrefix(code, acctByCode) ?? null;
      accountType = overrideType ?? currentSection ?? null;
      // Semantic check (the "ties-out-but-wrong" class): an override/prefix
      // type that DISAGREES with the visual section the row sits under is a
      // mis-classification signal — surface it for review, keep the override.
      if (overrideType && currentSection && overrideType !== currentSection) {
        sectionTypeConflicts.push({
          code,
          resolvedType: overrideType,
          sectionType: currentSection,
        });
        warnings.push({
          row: r + 1,
          reason: `code "${code}" classified ${overrideType} but sits under a ${currentSection} section`,
        });
      }
      if (!accountType) {
        warnings.push({
          row: r + 1,
          reason: `code "${code}" — no accountType (non-SAP code, no override, no P&L section context)`,
        });
        skipped += 1;
        continue;
      }
    }

    // Sign convention: AZ accounting workbooks store cogs/expense as
    // negative. ChartOfAccount.accountType='cogs'/'expense' wants the
    // absolute amount (positive). Flip at apply time.
    const flipSign =
      accountType === 'cogs' || accountType === 'expense' ? -1 : 1;

    const perMonth: number[] = [];
    let annual = 0;
    let rawAnnual = 0;
    for (const monthCol of monthCols) {
      const v = toNumberOrNull(row[monthCol]);
      rawAnnual += v ?? 0;
      const n = (v ?? 0) * flipSign;
      perMonth.push(n);
      annual += n;
    }

    if (annual === 0 && perMonth.every((v) => v === 0)) {
      skipped += 1;
      continue;
    }

    // Per-row control (2026-06-20): the file's own "Total" column must equal
    // Σ of the 12 monthly cells (raw, pre-sign-flip). A mismatch means the
    // months were mapped wrong — a format-independent correctness signal,
    // surfaced as a warning + recorded for the review gate.
    if (totalCol >= 0) {
      const stated = toNumberOrNull(row[totalCol]);
      if (stated !== null) {
        const tol = Math.max(1, Math.abs(stated) * 0.01);
        if (Math.abs(rawAnnual - stated) > tol) {
          rowTotalMismatches.push({
            code,
            stated,
            computed: rawAnnual,
            delta: rawAnnual - stated,
          });
          warnings.push({
            row: r + 1,
            reason: `code "${code}": Σ months ${rawAnnual.toFixed(0)} ≠ stated Total ${stated.toFixed(0)}`,
          });
        }
      }
    }

    lines.push({
      code,
      label: label || code,
      accountType,
      plannedAnnual: annual,
      perMonth,
    });
  }

  const { kept, dropped, synthetic } = dedupeParentRollups(lines);
  // skippedRowCount = sheet rows that did NOT contribute a final line.
  //   `skipped`           — rows skipped at parse time (header band, bare
  //                         labels with no code, zero-only rows, 4xx/5xx/8xx
  //                         informational codes, garbage codes).
  //   `dropped.length`    — parent-rollup rows removed by dedup. Of those,
  //                         `synthetic.length` are RE-ADDED as
  //                         `<parent>-__UNALLOCATED__` leaves preserving the
  //                         delta. So a "dropped-but-replaced-by-synthetic"
  //                         contributes back to lines (just under a synthetic
  //                         code), and isn't really skipped from the user's
  //                         perspective. Hence the subtraction.
  // Final formula: parse-skips + dropped-net-of-synthetic-replacements.
  return {
    sheetName,
    lines: kept,
    warnings,
    skippedRowCount: skipped + dropped.length - synthetic.length,
    parentRollupsDropped: dropped,
    parentRollupsUnallocated: synthetic,
    rowTotalMismatches,
    sectionTypeConflicts,
  };
}
