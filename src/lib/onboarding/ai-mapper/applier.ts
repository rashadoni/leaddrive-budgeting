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
}

/**
 * Merge user-provided overrides on top of the saved proposal. UI lets the
 * reviewer flip specific column roles (e.g. say "this column the AI marked
 * as `skip` is actually `amount:Jan`") — overrides win on a per-column
 * basis. accountTypeOverrides merge by code (override wins).
 */
function mergeProposal(
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
): { ok: true; columns: ResolvedColumns } | { ok: false; reason: string } {
  let codeCol = -1;
  let labelCol = -1;
  const monthCols = new Array<number>(12).fill(-1);

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
      // `amount:Total` / `amount:Plan` / etc. — annual or aggregate columns.
      // Skip them at apply time; we sum the 12 monthly amounts ourselves
      // from the per-month columns. Annual-only sheets are not supported
      // by this Turn 2b — covered by Turn 2c if needed.
      const monthIdx = MONTH_INDEX[period];
      if (monthIdx === undefined) continue;
      if (monthCols[monthIdx] !== -1) {
        return {
          ok: false,
          reason: `Multiple columns mapped to month ${period} (cols ${monthCols[monthIdx]} and ${c.sourceIndex})`,
        };
      }
      monthCols[monthIdx] = c.sourceIndex;
    }
    // role === 'skip' → ignored.
  }

  if (codeCol === -1) {
    return { ok: false, reason: 'Proposal has no "code" column — cannot identify accounts' };
  }
  if (labelCol === -1) {
    return { ok: false, reason: 'Proposal has no "label" column — cannot describe accounts' };
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

  return { ok: true, columns: { codeCol, labelCol, monthCols } };
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
 * Apply the proposal to a workbook — returns ParsedBudgetLine[] with
 * dedup + reconciliation already applied. Caller (apply route) wraps the
 * insert in a transaction.
 */
export function applyProposal(
  workbook: XLSX.WorkBook,
  sheetName: string,
  proposal: MappingProposal,
  xlsx: typeof XLSX,
  userOverrides?: Partial<MappingProposal>,
):
  | ParseResult
  | { error: string } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { error: `Sheet "${sheetName}" not found in workbook` };
  }

  const merged = mergeProposal(proposal, userOverrides);
  const colsResult = resolveColumns(merged.columns);
  if (!colsResult.ok) return { error: colsResult.reason };
  const { codeCol, labelCol, monthCols } = colsResult.columns;

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
  let skipped = 0;

  for (let r = headerEndRow; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const code = toTrimmedString(row[codeCol]);
    if (!code) {
      skipped += 1;
      continue;
    }
    // Reject anything that doesn't look like a SAP-style code. Catches
    // category-header rows where the code col is blank but other cells
    // are set, plus garbage rows.
    if (!/^\d{3,}(-\d+)*$/.test(code)) {
      skipped += 1;
      continue;
    }

    // Silent-skip for 4xx / 5xx / 8xx codes BEFORE consulting accountType
    // overrides. These are informational rows in AZ accounting workbooks
    // (statistical accounts, off-balance items) — they MUST never land in
    // BudgetLine even if the LLM optimistically suggested an account type
    // override for them. Matches azmade-sopl invariant.
    const firstDigit = code.replace(/^[^\d]+/, '').charAt(0);
    if (firstDigit === '4' || firstDigit === '5' || firstDigit === '8') {
      skipped += 1;
      continue;
    }

    const label = toTrimmedString(row[labelCol]);

    // Account-type resolution: explicit override wins; fall back to
    // SAP-prefix heuristic. Codes that match neither get a warning.
    let accountType: AccountType | null = acctByCode.get(code) ?? null;
    if (!accountType) accountType = accountTypeFromCode(code);
    if (!accountType) {
      warnings.push({
        row: r + 1,
        reason: `code "${code}" didn't map to any accountType (no override + no SAP prefix match)`,
      });
      skipped += 1;
      continue;
    }

    // Sign convention: AZ accounting workbooks store cogs/expense as
    // negative. ChartOfAccount.accountType='cogs'/'expense' wants the
    // absolute amount (positive). Flip at apply time.
    const flipSign =
      accountType === 'cogs' || accountType === 'expense' ? -1 : 1;

    const perMonth: number[] = [];
    let annual = 0;
    for (const monthCol of monthCols) {
      const v = toNumberOrNull(row[monthCol]);
      const n = (v ?? 0) * flipSign;
      perMonth.push(n);
      annual += n;
    }

    if (annual === 0 && perMonth.every((v) => v === 0)) {
      skipped += 1;
      continue;
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
  };
}
