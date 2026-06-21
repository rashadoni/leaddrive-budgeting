/**
 * AI Data Mapper — pure xlsx extraction (no LLM dependency).
 *
 * Parses a workbook into the `MapperInput` shape that the LLM call
 * consumes. Kept separate from the LLM client so the heavy parser logic
 * is unit-testable without API keys.
 */

import type * as XLSX from 'xlsx';
import type { MapperInput, SourceColumn } from './types';

const MAX_SAMPLE_ROWS = 30;
const MAX_SAMPLES_PER_COLUMN = 5;

// Header-detection heuristic constants. See header band detection block in
// `extractMapperInput` for usage rationale.
const HEADER_DETECTION_LIMIT = 20;
const MIN_NON_EMPTY = 3;
// AZ accounting headers can be long: "Faktiki məbləğ (manatla, ƏDV-siz,
// 2026-cı il üçün)" runs ~60 chars. Bump to 80 to accommodate real-world
// localised headers. Title banners ("Approved by CFO on 2026-04-01 by
// board members") typically exceed 80 anyway.
const MAX_HEADER_CELL_LEN = 80;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * An Excel date-serial used as a column HEADER (e.g. 45992 → "Dec 2025")
 * decoded to a readable month label, so the LLM maps the column to
 * `amount:<Month><Year>` instead of receiving an EMPTY header and guessing
 * `code`. Real monthly P&L exports (Reporting 2026 "Actual PLF" / "Budget PLF")
 * carry serial-date month headers, which the old `typeof v === 'string'` gate
 * dropped → the monthly amount columns all landed in account-code (live
 * 2026-06-21). Range-gated to ~[1954, 2064] so a literal year / small numeric
 * code isn't misread as a date; applied ONLY to the header cell, never to data
 * (a data amount that happens to fall in the serial range is untouched).
 */
function serialDateHeaderLabel(xlsx: typeof XLSX, n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 60000) return null;
  const ssf = (xlsx as { SSF?: { parse_date_code?: (v: number) => { y?: number; m?: number } | null } }).SSF;
  const d = ssf?.parse_date_code?.(n);
  if (!d || !d.y || !d.m) return null;
  return `${MONTH_ABBR[d.m - 1]} ${d.y}`;
}

/**
 * Walk a sheet and return the first non-empty row's column count + a few
 * sample data rows. We do NOT try to detect a header — the LLM is better
 * at that than any heuristic, especially when sheets have title banners,
 * blank rows, merged cells, etc. Just feed it the first ~30 visible rows.
 */
export function extractMapperInput(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
  context?: { sourceFile?: string; companyName?: string; industry?: string },
): MapperInput | { error: string } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { error: `Sheet "${sheetName}" not found in workbook` };
  }

  const aoa = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<string | number | null>>;

  if (aoa.length === 0) {
    return { error: `Sheet "${sheetName}" is empty` };
  }

  // Determine column count from the widest non-trivial row in the first 30.
  let colCount = 0;
  for (let i = 0; i < Math.min(30, aoa.length); i++) {
    const row = aoa[i] ?? [];
    if (row.length > colCount) colCount = row.length;
  }

  // Detect the header band — first row that LOOKS LIKE a header row, not
  // a title banner. Heuristic (cumulative, all must hold):
  //   1. ≥3 non-empty cells. Real headers are usually wide (KOD + Label +
  //      multiple amount columns). 2-cell title banners like
  //      `["Company XYZ Ltd", "Q4 2025"]` would otherwise be mis-detected.
  //   2. All non-empty cells are strings (no numbers). Data rows typically
  //      contain numbers; headers are labels.
  //   3. Each cell ≤ MAX_HEADER_CELL_LEN chars. Title banners often have
  //      prose ("Approved by …") longer than labels.
  // Searches up to HEADER_DETECTION_LIMIT rows. Falls back to row 5 if no
  // row qualifies. Known limitation: 2-column sheets won't trigger the
  // heuristic and fall back to row 5 (rare in real finance workbooks).
  let headerEndRow = Math.min(5, aoa.length); // fallback — clamp to actual length
  for (let r = 0; r < Math.min(HEADER_DETECTION_LIMIT, aoa.length); r++) {
    const row = aoa[r] ?? [];
    const nonEmptyCells = row.filter(
      (v) => v !== null && v !== undefined && v !== '',
    );
    if (nonEmptyCells.length < MIN_NON_EMPTY) continue;
    const allStrings = nonEmptyCells.every((v) => typeof v === 'string');
    // Also accept a DATE-SERIAL period header — a row whose non-empty cells are
    // all integer Excel date serials (e.g. 45658…45992 = Jan…Dec 2025). Monthly
    // P&L exports (Reporting 2026 "Actual PLF"/"Budget PLF") use these; being
    // all-numbers, the all-strings rule rejected them, so header detection fell
    // through to a data row and the monthly columns came out header-less → the
    // LLM guessed `code`. Integer + range-gated so amount rows don't match.
    const allSerialDates = nonEmptyCells.every(
      (v) => typeof v === 'number' && Number.isInteger(v) && v >= 20000 && v <= 60000,
    );
    if (allStrings) {
      const allShort = nonEmptyCells.every(
        (v) => typeof v === 'string' && v.length <= MAX_HEADER_CELL_LEN,
      );
      if (!allShort) continue;
    } else if (!allSerialDates) {
      continue;
    }
    headerEndRow = r + 1; // header is THIS row; samples start AFTER it
    break;
  }

  // Per-column samples — first non-null value from rows AFTER headerEndRow,
  // up to MAX_SAMPLES_PER_COLUMN. Header rows often have nulls in some
  // columns; samples must skip them so the LLM sees actual data values.
  //
  // headerText comes ONLY from the actual header row (index headerEndRow-1),
  // not from any banner / approval / period row above it. Otherwise a 3-cell
  // mid-banner like ["Approved", "OK", "YES"] could leak into headerText for
  // columns where the real header cell happens to be null.
  const headerRowIdx = Math.max(0, headerEndRow - 1);
  const columns: SourceColumn[] = [];
  for (let c = 0; c < colCount; c++) {
    const samples: Array<string | number | null> = [];
    let headerText = '';
    const v = aoa[headerRowIdx]?.[c];
    if (typeof v === 'string' && v.trim() !== '') {
      headerText = v.trim();
    } else if (typeof v === 'number') {
      // Numeric header — usually an Excel date-serial month column. Decode it to
      // a month label (45992 → "Dec 2025") so the LLM maps it to
      // amount:<Month><Year>; otherwise stringify (e.g. a bare year header
      // "2026") so the column is never header-less and mis-roled as `code`.
      headerText = serialDateHeaderLabel(xlsx, v) ?? String(v);
    }
    // STRATIFIED samples (C2.6) — spread the picks across the FULL data range,
    // not just the first rows. A column that changes in BLOCKS — e.g. a
    // business-unit / entity column whose values are contiguous (all AZSF, then
    // all EDEN, then CPC…) — would otherwise show only the FIRST block's value
    // repeated, so the mapper saw a constant and MISSED the entity dimension on
    // real multi-company sheets (proven on `Reporting 2026.xlsx` `Actual PLF`).
    // Picking evenly across all non-null values reveals the variation. The
    // sample COUNT is unchanged (MAX_SAMPLES_PER_COLUMN), so the structure-hash
    // sample-TYPE signature — and thus the template cache key — stays stable.
    const colNonNull: Array<string | number | null> = [];
    for (let r = headerEndRow; r < aoa.length; r++) {
      const cv = aoa[r]?.[c];
      if (cv !== null && cv !== undefined && cv !== '') colNonNull.push(cv);
    }
    if (colNonNull.length <= MAX_SAMPLES_PER_COLUMN) {
      samples.push(...colNonNull);
    } else {
      for (let i = 0; i < MAX_SAMPLES_PER_COLUMN; i++) {
        samples.push(colNonNull[Math.floor((i * colNonNull.length) / MAX_SAMPLES_PER_COLUMN)]);
      }
    }
    columns.push({ index: c, headerText, samples });
  }

  // Sample rows for structural context. Include the full header band plus
  // the first body rows (capped at MAX_SAMPLE_ROWS total).
  const sampleRows: Array<Array<string | number | null>> = [];
  const headerBand = aoa.slice(0, Math.min(headerEndRow, aoa.length));
  const bodyBand = aoa.slice(
    headerEndRow,
    headerEndRow + Math.max(0, MAX_SAMPLE_ROWS - headerBand.length),
  );
  sampleRows.push(...headerBand, ...bodyBand);

  return {
    sourceFile: context?.sourceFile ?? '<unknown>',
    sourceSheet: sheetName,
    columns,
    sampleRows,
    companyContext: context
      ? { name: context.companyName, industry: context.industry }
      : undefined,
  };
}

/**
 * Format a `MapperInput` as a compact text block for inclusion in the LLM
 * prompt. Truncates wide cells to keep token usage reasonable.
 */
export function renderInputForPrompt(input: MapperInput): string {
  const truncate = (v: unknown, max = 40): string => {
    if (v === null || v === undefined) return '∅';
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  };

  const colSummary = input.columns
    .map(
      (c) =>
        `  Col ${c.index} | header="${truncate(c.headerText, 30)}" | samples=[${c.samples
          .map((s) => truncate(s, 25))
          .join(', ')}]`,
    )
    .join('\n');

  // C2.7 — show the sample-row grid WIDE enough to cover a multi-year /
  // multi-company sheet. The old 18-column cap hid the 2nd year band (e.g.
  // 2026 months at cols 19-30) AND the business-unit column (col 37) from the
  // row grid, so the LLM mapped only the year/entity it could "see" in
  // context (proven on `Actual PLF`: only 2025 was mapped). Capped to bound
  // tokens on pathologically wide sheets; the colSummary still lists every
  // column. Display-only — does NOT affect `sampleRows` or the structure-hash.
  const MAX_DISPLAY_COLS = 48;
  const displayCols = Math.min(input.columns.length, MAX_DISPLAY_COLS);
  const rowsBlock = input.sampleRows
    .map(
      (row, i) =>
        `R${String(i + 1).padStart(2)}: ${row.slice(0, displayCols).map((v) => truncate(v, 20)).join(' | ')}`,
    )
    .join('\n');

  const ctxLine = input.companyContext
    ? `\nCompany context: name="${input.companyContext.name ?? ''}" industry="${input.companyContext.industry ?? ''}"`
    : '';

  return `Sheet "${input.sourceSheet}" from "${input.sourceFile}":${ctxLine}

Columns (${input.columns.length} total):
${colSummary}

First ${input.sampleRows.length} rows (truncated for display):
${rowsBlock}`;
}
