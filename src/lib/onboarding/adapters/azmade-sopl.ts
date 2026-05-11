/**
 * AZMADE holding SOPL (Statement of P&L) xlsx adapter.
 *
 * Parses one SOPL-shaped sheet from an AZMADE budget workbook and returns a
 * flat `ParsedBudgetLine[]` ready for insertion into `BudgetLine` rows.
 *
 * --- SOPL shape (observed 2026-04-24) ---
 *
 * A SOPL sheet inside any of `rev6-LLS.xlsx`, `rev7-SPARK.xlsx`,
 * `rev8-ZTP.xlsx`, `rev 9-ATL.xlsx` has:
 *   - a few title/signature rows at the top (merged across the sheet)
 *   - one **header row** with the AZ month labels `Yanvar Fevral … Dekabr`
 *     in consecutive columns. This is the anchor for parsing — everything
 *     below it is data.
 *   - data rows — each with an optional account code (`KOD`) in one of the
 *     leftmost columns and an AZ label immediately after.
 *     - **leaf row**: KOD present → 12 monthly `plannedAmount` values →
 *       one `BudgetLine` per row
 *     - **category-header row**: KOD empty, label is uppercase ("SATIŞDAN
 *       GƏLİRLƏR"), values are group rollups → skip
 *     - **subtotal / calc row**: KOD empty, label is mixed case → skip
 *     - **signature row** at the bottom — skip
 *
 * --- Account-type inference from KOD prefix ---
 *
 *   6xx        → revenue     (601-04 Məhsul satışı, 611-01 Sair gəlir, ...)
 *   70x / 71x  → cogs        (701-01 Məhsul satış maya dəyəri, 711-02 …)
 *   72x..79x   → expense     (721-02 İşçi heyəti, 731 / 741 / 751 / …)
 *   1xx        → asset
 *   2xx        → liability
 *   3xx        → equity
 *
 * This is the same SAP-style prefix convention the CoA templates in
 * `src/lib/onboarding/coa-templates.ts` already use, so `accountType`
 * derived here lines up with what the `budgetLine` recompute resolver
 * expects to read from `ChartOfAccount.accountType`.
 *
 * --- Adapter contract notes ---
 *
 * 1. Each parsed line carries BOTH `plannedAnnual` (sum across the 12
 *    monthly columns) AND `perMonth: number[]` (length 12, index 0=Jan).
 *    Persistence (CLI `import-azmade-budgets.ts` + Onboarding `/apply`
 *    routes) writes 12 BudgetLine rows per parsed line at sortOrder=0..11
 *    (Turn 34 monthly-distribution contract). The `budgetLine` recompute
 *    resolver scopes by sortOrder for monthly/quarterly anchors (Turn-42-
 *    sub-3) so sparklines reflect real per-month variation.
 * 2. Only `Yanvar`..`Dekabr` columns are read. Annual-total columns like
 *    "Toplam" are ignored to prevent double-counting if the workbook's
 *    formula is broken.
 * 3. Codes with a non-numeric first character are skipped with a warning
 *    — anything outside `6xx`/`7xx`/`1xx`/`2xx`/`3xx` isn't mappable to an
 *    `accountType` and shouldn't silently land as NULL.
 */

import type * as XLSX from 'xlsx';

export type AccountType =
  | 'revenue'
  | 'cogs'
  | 'expense'
  | 'asset'
  | 'liability'
  | 'equity';

/**
 * AZ label → accountType + synthetic code map for the `5-2` summary rollup
 * sheet in rev9-ATL.xlsx. Unlike a SOPL sheet (per-KOD leaves), 5-2 gives
 * only category-level annual rollups per sub-entity. We generate one
 * `ParsedBudgetLine` per matched rollup row so the recompute pipeline's
 * `budgetLine` resolver aggregates them identically to leaf rows.
 */
// `[Iİ]` character class handles the Turkish vs Latin `I` split: JS's
// default `.toUpperCase()` on `i` produces Latin `I` (U+0049), while AZ
// Excel labels use Turkish `İ` (U+0130). Accepting both makes matching
// work regardless of how the string was produced.
const ROLLUP_LABEL_MAP: readonly {
  pattern: RegExp;
  accountType: AccountType;
  code: string;
}[] = [
  { pattern: /^GƏL[Iİ]RLƏR$/i, accountType: 'revenue', code: 'ROLLUP-REVENUE' },
  { pattern: /^D[Iİ]GƏR GƏL[Iİ]RLƏR$/i, accountType: 'revenue', code: 'ROLLUP-REVENUE-OTHER' },
  { pattern: /^SATIŞIN MAYA DƏYƏR[Iİ]/i, accountType: 'cogs', code: 'ROLLUP-COGS' },
  { pattern: /^ÜMUM[Iİ] VƏ [Iİ]NZ[Iİ]BAT[Iİ]/i, accountType: 'expense', code: 'ROLLUP-OPEX-GA' },
  { pattern: /^SATIŞ.*MARKET[Iİ]NQ/i, accountType: 'expense', code: 'ROLLUP-OPEX-MARKETING' },
  { pattern: /^D[Iİ]GƏR XƏRCLƏR$/i, accountType: 'expense', code: 'ROLLUP-OPEX-OTHER' },
  { pattern: /^AMORT[Iİ]ZAS[Iİ]YA/i, accountType: 'expense', code: 'ROLLUP-OPEX-DEPRECIATION' },
  { pattern: /^FA[Iİ]Z XƏRCLƏR[Iİ]$/i, accountType: 'expense', code: 'ROLLUP-OPEX-INTEREST' },
  { pattern: /^MƏNFƏƏT VERG[Iİ]S[Iİ]/i, accountType: 'expense', code: 'ROLLUP-OPEX-TAX' },
];

export function matchRollupLabel(label: string):
  | { accountType: AccountType; code: string }
  | null {
  // AZ letters `İ / ə / Ş` use Turkish-locale case folding that the default
  // JS `/i` regex flag doesn't apply. Uppercase the input explicitly so
  // `"gəlirlər"` matches `/^GƏLİRLƏR$/i` the same as the canonical form.
  const l = label.trim().toUpperCase();
  for (const row of ROLLUP_LABEL_MAP) {
    if (row.pattern.test(l)) {
      return { accountType: row.accountType, code: row.code };
    }
  }
  return null;
}

export interface ParsedBudgetLine {
  code: string;
  label: string;
  accountType: AccountType;
  plannedAnnual: number;
  perMonth: number[]; // length 12, index 0=Jan ... 11=Dec
}

export interface ParseWarning {
  row: number; // 1-based spreadsheet row number
  reason: string;
}

export interface ParseResult {
  sheetName: string;
  lines: ParsedBudgetLine[];
  warnings: ParseWarning[];
  /** rows that were inspected but filtered out (not errors — subtotals etc). */
  skippedRowCount: number;
  /** Parent-rollup codes that were dropped because their leaf children are
   *  present in the same sheet (summing both would double-count). Empty for
   *  sheets that only list leaves (AAC, ATL, SPARK, ZTP). */
  parentRollupsDropped: Array<{ code: string; label: string; plannedAnnual: number }>;
  /** Synthetic `<parent>-__UNALLOCATED__` leaves injected by the dedup step
   *  when a parent's plannedAnnual exceeded the sum of its children by more
   *  than the reconciliation tolerance. Preserves the delta so finance data
   *  isn't silently lost. Empty when every dropped parent reconciles. */
  parentRollupsUnallocated: Array<{ code: string; parentCode: string; plannedAnnual: number }>;
}

// --- Pure helpers -----------------------------------------------------------

const AZ_MONTHS: readonly string[] = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'İyun',
  'İyul',
  'Avqust',
  'Sentyabr',
  'Oktyabr',
  'Noyabr',
  'Dekabr',
];

// Accepted header aliases per month index (0=Jan … 11=Dec). Both AZ and EN
// short / long forms are recognised — AAC's workbook uses English short
// abbreviations (`Jan`, `Feb`, ...), while the ATL/LLS/SPARK/ZTP workbooks
// use AZ (`Yanvar`, `Fevral`, ...). Case-insensitive via `normalizeHeader`;
// match is exact after whitespace collapse, except for the `<Month>Plan`
// variant handled in `isPlanMonthHeader`.
export const MONTH_ALIASES: readonly (readonly string[])[] = [
  ['Yanvar', 'Jan', 'January', 'Январь', 'Янв'],
  ['Fevral', 'Feb', 'February', 'Февраль', 'Фев'],
  ['Mart', 'Mar', 'March', 'Март'],
  ['Aprel', 'Apr', 'April', 'Апрель', 'Апр'],
  ['May', 'Май'],
  ['İyun', 'Iyun', 'Jun', 'June', 'Июнь'],
  ['İyul', 'Iyul', 'Jul', 'July', 'Июль'],
  ['Avqust', 'Aug', 'August', 'Август', 'Авг'],
  ['Sentyabr', 'Sep', 'September', 'Сентябрь', 'Сен'],
  ['Oktyabr', 'Oct', 'October', 'Октябрь', 'Окт'],
  ['Noyabr', 'Nov', 'November', 'Ноябрь', 'Ноя'],
  ['Dekabr', 'Dec', 'December', 'Декабрь', 'Дек'],
];

/**
 * Infer account type from KOD prefix. Returns null when the code doesn't
 * match any known prefix — caller must decide whether to skip the row or
 * surface a warning.
 */
export function accountTypeFromCode(code: string): AccountType | null {
  const trimmed = code.trim();
  // Peel off any non-digit prefix (occasional "№" etc.) — SAP codes start
  // with a digit, separators are "-".
  const firstDigitMatch = trimmed.match(/(\d+)/);
  if (!firstDigitMatch) return null;
  const digits = firstDigitMatch[1];
  const first = digits[0];
  if (first === '6') return 'revenue';
  if (first === '7') {
    // 70x / 71x = cogs; 72x..79x = opex.
    const second = digits[1];
    if (second === '0' || second === '1') return 'cogs';
    return 'expense';
  }
  if (first === '1') return 'asset';
  if (first === '2') return 'liability';
  if (first === '3') return 'equity';
  // 9xx in the AZ chart of accounts = profit-tax / reserve-adjustment codes
  // (e.g. 901-01 Cari mənfəət vergisi üzrə xərclər). Treated as expense for
  // P&L — they deduct from net income the same way.
  if (first === '9') return 'expense';
  return null;
}

/**
 * Normalise a header cell to its canonical lowercase-no-whitespace form so
 * variants like `"Yanvar"`, `"  Yanvar  "`, `"Yanvar\nPlan"`, `"Yanvarplan"`
 * all collapse to a comparable key. Used by both month detection and
 * label/code discovery.
 */
function normalizeHeader(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/\s+/g, '').toLowerCase();
}

/**
 * True when `cell` is a plan-shape header for month at `monthIndex`
 * (0=Jan...11=Dec). Accepts:
 *   - any alias from `MONTH_ALIASES[monthIndex]` (AZ: `Yanvar`, EN: `Jan`)
 *   - any of those + `Plan` suffix in any whitespace form (`YanvarPlan`,
 *     `Jan Plan`, `Yanvar\nPlan`)
 *
 * Does NOT match `<Month>Fakt` / `<Month>LE` / `<Month>Budget` — only
 * plan-shaped so we pick the Plan column, not Fact. Known limitation:
 * `<Month>Budget` / `<Month>Plan2026` are intentionally NOT matched; if a
 * real workbook uses those, the sheet parses zero rows — extend this
 * function with the additional suffix when such a layout lands.
 */
export function isPlanMonthHeader(cell: unknown, monthIndex: number): boolean {
  const n = normalizeHeader(cell);
  if (!n) return false;
  const aliases = MONTH_ALIASES[monthIndex];
  for (const alias of aliases) {
    const a = alias.toLowerCase();
    if (n === a || n === a + 'plan') return true;
  }
  return false;
}

/** Header row = first row whose cells cover all 12 months (AZ or EN). */
export function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row) continue;
    const allPresent = MONTH_ALIASES.every((_, idx) =>
      row.some((cell) => isPlanMonthHeader(cell, idx)),
    );
    if (allPresent) return i;
  }
  return -1;
}

export interface ColumnMap {
  codeCol: number;
  labelCol: number;
  monthCols: number[]; // length 12, one index per month
  /** True when codeCol was derived heuristically (`labelCol - 2`) rather than
   *  from an explicit `KOD` header. Surfaced to callers so they can log when
   *  a new workbook layout silently falls back to the default shape. */
  codeColFromFallback: boolean;
}

/**
 * Figure out which columns carry the account code, label, and the 12 monthly
 * plan amounts. The SOPL layouts we've seen put the code one or two columns
 * left of the label (sometimes with empty-merge cells in between), and the
 * 12 months start at or after the label column.
 */
export function mapColumns(headerRow: unknown[]): ColumnMap | null {
  const monthCols: number[] = [];

  // For each month index, pick the FIRST column whose cell matches any
  // plan-shape alias (`Yanvar` / `Jan` / `January` / `YanvarPlan` / `Jan Plan` / …).
  // Later plan-fact columns for the same month are ignored — we read only
  // the Plan value, never Fact.
  for (let monthIdx = 0; monthIdx < MONTH_ALIASES.length; monthIdx += 1) {
    const idx = headerRow.findIndex((v) => isPlanMonthHeader(v, monthIdx));
    if (idx === -1) return null;
    monthCols.push(idx);
  }
  // Sanity: 12 plan columns should be monotonically increasing. If not, the
  // header was mixed (Plan then Fakt then Plan again) and we picked the
  // wrong column. Bail — caller emits a warning.
  for (let i = 1; i < monthCols.length; i++) {
    if (monthCols[i] <= monthCols[i - 1]) return null;
  }

  const isLabelLikeString = (v: unknown): boolean => {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (!s) return false;
    if (/^\d+(\.\d+)?$/.test(s)) return false; // bare number string
    if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(s)) return false; // dd.mm.yyyy
    return true;
  };

  // Check for an explicit "KOD"/"Код"/"Code" header cell anywhere left of
  // the months. If found it's unambiguously the code column, and the label
  // column is the nearest label-like header to its right.
  let codeCol = -1;
  let codeColFromFallback = false;
  for (let c = 0; c < monthCols[0]; c++) {
    const v = typeof headerRow[c] === 'string' ? (headerRow[c] as string).trim() : '';
    if (/^(kod|код|code|№)$/i.test(v)) {
      codeCol = c;
      break;
    }
  }

  let labelCol = -1;
  if (codeCol !== -1) {
    for (let c = codeCol + 1; c < monthCols[0]; c++) {
      if (isLabelLikeString(headerRow[c])) {
        labelCol = c;
        break;
      }
    }
    if (labelCol === -1) labelCol = codeCol + 1;
  } else {
    // No explicit KOD header. Fall back to the leftmost label-like column
    // before the first month — this is the real label ("GƏLİR/XƏRC MADDƏLƏRİ"
    // in LLS / ZTP). Code column = 2 cols further left (matches LLS/ZTP layout
    // where KOD sits in col B, label in col D). Caller should log a warning
    // when this fallback is used so a 4th unseen layout doesn't silently
    // shift KOD to a different offset and skip the whole sheet.
    for (let c = 0; c < monthCols[0]; c++) {
      if (isLabelLikeString(headerRow[c])) {
        labelCol = c;
        break;
      }
    }
    if (labelCol === -1) labelCol = Math.max(0, monthCols[0] - 1);
    codeCol = Math.max(0, labelCol - 2);
    codeColFromFallback = true;
  }

  return { codeCol, labelCol, monthCols, codeColFromFallback };
}

export function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    // xlsx sometimes stringifies numerics when cell format is irregular.
    const n = Number(v.replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTrimmedString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// --- Core parser ------------------------------------------------------------

/**
 * Parse a SOPL sheet. Pure — caller supplies an already-read XLSX.WorkBook.
 *
 * Errors are returned in `warnings`, not thrown, so one malformed row
 * doesn't abort the whole import.
 */
/**
 * Parse a "5-2 2026 büdcə" summary rollup sheet for a single sub-entity.
 *
 * Layout (as seen in rev9-ATL.xlsx):
 *   Row 2: header — " Gəlir/xərc maddələri | Azertexnolayn | ∅ | Mərkəz |
 *           Polad Boru Zavodu | Polietilen ... | Texniki ... | Concol ..."
 *   Row 3+: per-category rollup — col 0 holds the AZ category label
 *           (`GƏLİRLƏR`, `SATIŞIN MAYA DƏYƏRİ`, etc.); each entity column
 *           has the annual rollup value.
 *
 * For the requested `targetColumnHeader` (e.g. "Mərkəz"), this function
 * locates the column and emits one `ParsedBudgetLine` per matched rollup
 * row. Non-matching categories (`MƏCMU GƏLİR`, `EBITDA`, `Məcmu gəlir (%)`,
 * etc.) are silent-skipped — they're derived figures, not source P&L lines.
 *
 * MVP simplification: monthly breakdown isn't available in 5-2 (only annual
 * totals), so `perMonth` is filled with an even 1/12 split. Good enough for
 * year-level indicators; sparkline will need a different source.
 */
export function parseSummaryRollupSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  targetColumnHeader: string,
  xlsx: typeof XLSX,
): ParseResult {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      sheetName,
      lines: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }],
      skippedRowCount: 0,
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    };
  }
  const aoa = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as unknown[][];

  // Find the header row — the one that contains `targetColumnHeader` as a
  // cell. In 5-2 sheets that's row 2 (R2 in the workbook).
  let headerRowIdx = -1;
  let targetCol = -1;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const row = aoa[i] ?? [];
    const idx = row.findIndex(
      (v) => typeof v === 'string' && v.trim() === targetColumnHeader.trim(),
    );
    if (idx !== -1) {
      headerRowIdx = i;
      targetCol = idx;
      break;
    }
  }
  if (headerRowIdx === -1 || targetCol === -1) {
    return {
      sheetName,
      lines: [],
      warnings: [
        {
          row: 0,
          reason: `Target column "${targetColumnHeader}" not found in first 5 rows`,
        },
      ],
      skippedRowCount: 0,
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    };
  }

  const lines: ParsedBudgetLine[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const label = toTrimmedString(row[0]);
    if (!label) {
      skipped += 1;
      continue;
    }
    const match = matchRollupLabel(label);
    if (!match) {
      skipped += 1;
      continue;
    }
    const raw = toNumberOrNull(row[targetCol]);
    if (raw === null) {
      skipped += 1;
      continue;
    }
    // Sign flip for cogs/expense — 5-2 stores costs as negative the same
    // way leaf SOPL does.
    const flipSign = match.accountType === 'cogs' || match.accountType === 'expense' ? -1 : 1;
    const annual = raw * flipSign;
    if (annual === 0) {
      skipped += 1;
      continue;
    }
    // Even 1/12 split for monthly breakdown — rollup doesn't carry monthly
    // detail; sparkline resolvers will need a different source.
    const monthly = annual / 12;
    const perMonth = Array.from({ length: 12 }, () => monthly);

    lines.push({
      code: match.code,
      label,
      accountType: match.accountType,
      plannedAnnual: annual,
      perMonth,
    });
  }

  // Opt out of dedup — synthetic rollup codes (`ROLLUP-REVENUE` vs
  // `ROLLUP-REVENUE-OTHER`) use dashes as semantic separators, not
  // hierarchy markers. See `DedupeOptions.enabled` jsdoc.
  const { kept, dropped, synthetic } = dedupeParentRollups(lines, {
    enabled: false,
  });
  return {
    sheetName,
    lines: kept,
    warnings,
    skippedRowCount: skipped,
    parentRollupsDropped: dropped,
    parentRollupsUnallocated: synthetic,
  };
}

/**
 * Drop parent rollup rows whose leaf children are present in the same sheet.
 *
 * AZ SAP-style Chart of Accounts uses **dash-delimited hierarchy** in KODs:
 *   - `721-02`          parent  (Personnel total)
 *     - `721-02-01`     leaf    (Salary)
 *     - `721-02-02`     leaf    (DSMF)
 *     - ...
 *
 * Some workbooks (LLS `rev6`) list BOTH the parent category total AND every
 * leaf item, each with an independent plannedAmount ≈ sum-of-children.
 * Importing both double-counts every affected category in the `budgetLine`
 * resolver — LLS OpEx ran 254% of revenue because `721-02`, `721-04`, and
 * `721-11` all appeared alongside their leaves.
 *
 * **Parent-detection rule.** A row with code `C` is a parent iff there
 * exists another row in the same sheet with code `C-<anything>`. Dash is
 * the sole hierarchy separator — codes like `721A`, `72102`, or `721X1`
 * are NOT treated as children of `721`. Single-level codes like `601-04`
 * or `771-01` with no descendants are always leaves.
 *
 * **Reconciliation guard — finance-safe.** When a parent is identified, we
 * compare its `plannedAnnual` to `sum(children.plannedAnnual)`:
 *
 *   - **|parent − Σchildren| ≤ ε (tolerance)** → safe to drop. The parent
 *     row adds nothing children don't already carry; import just leaves.
 *     Tolerance is `max(1, |parent| × 0.01)` — 1 currency unit or 1% of
 *     the parent amount, whichever is larger. Handles both rounding noise
 *     (AZN cents) and off-by-one cell edits in Excel.
 *
 *   - **|parent − Σchildren| > ε** → parent carries an *unallocated* or
 *     *catchall* amount that no child covers. Silently dropping would
 *     lose finance data. Instead we **inject a synthetic leaf**:
 *       code = `<parent>-__UNALLOCATED__`
 *       plannedAnnual = parent − Σchildren
 *       perMonth[i] = parent.perMonth[i] − Σchildren.perMonth[i]
 *       label = `<parent label> (unallocated)`
 *       accountType = parent.accountType
 *     This preserves the total and the sign convention while still
 *     removing the double-count. The synthetic code is a leaf (contains
 *     `__UNALLOCATED__` segment which never itself has children), so
 *     subsequent re-runs of dedup are idempotent.
 *
 * Returned `dropped` list reports every parent that was removed with its
 * original plannedAnnual — finance audit trail. `synthetic` list (new)
 * reports any `__UNALLOCATED__` rows injected, so the caller can surface
 * them as informational messages rather than silent data.
 *
 * Workbooks that only list leaves (AAC, ATL, SPARK, ZTP `rev7/8/9`)
 * are unaffected — the parent set is empty so nothing is dropped.
 *
 * Exposed for unit-testing.
 */
export interface DedupeOptions {
  /** When false, the helper short-circuits and returns every input as-is
   *  in `kept` (no dropped, no synthetic). Used by `parseSummaryRollupSheet`
   *  whose synthetic codes (`ROLLUP-REVENUE`, `ROLLUP-REVENUE-OTHER`, …)
   *  treat dashes as semantic separators rather than hierarchy markers —
   *  SOPL dedup would mis-classify `ROLLUP-REVENUE` as a parent of
   *  `ROLLUP-REVENUE-OTHER`. Defaults to true; callers with non-
   *  hierarchical codespaces pass `enabled: false` explicitly. */
  enabled?: boolean;
}

export function dedupeParentRollups(
  lines: ParsedBudgetLine[],
  options: DedupeOptions = {},
): {
  kept: ParsedBudgetLine[];
  dropped: Array<{ code: string; label: string; plannedAnnual: number }>;
  synthetic: Array<{ code: string; parentCode: string; plannedAnnual: number }>;
} {
  const { enabled = true } = options;
  if (!enabled) {
    return { kept: [...lines], dropped: [], synthetic: [] };
  }
  // Parent detection uses ANY descendant (transitive) — presence of `C-X-Y`
  // means `C` has children and is a parent.
  //
  // Reconciliation uses the set of **topmost descendants** of `C` — those
  // descendants whose ancestor-walk back to `C` does NOT pass through any
  // other code present in the set. For complete hierarchies this equals the
  // "direct children" (`C-02` when `C-02-01` / `C-02-02` are leaves deeper).
  // For sparse hierarchies (`721` and `721-02-01` with NO intermediate
  // `721-02`), topmost-descendants correctly picks `721-02-01` as the
  // effective child, avoiding double-counting with the missing middle level.
  //
  // Without this, a 3-level hierarchy `721 / 721-02 / 721-02-01` would
  // reconcile `721` against BOTH `721-02` AND `721-02-01` (transitive sum)
  // and trigger a false synthetic-unallocated injection.
  const codeSet = new Set(lines.map((l) => l.code));
  const hasDescendant = (parent: string): boolean => {
    const prefix = parent + '-';
    for (const c of codeSet) {
      if (c.length > prefix.length && c.startsWith(prefix)) return true;
    }
    return false;
  };
  /** Walk up D by stripping the last `-<...>` segment. Returns null once we
   *  hit the top. Assumes dash-delimited hierarchy. */
  const stripLastSegment = (code: string): string | null => {
    const i = code.lastIndexOf('-');
    return i === -1 ? null : code.slice(0, i);
  };
  /** True when descendant D reaches parent C via ancestor walk without
   *  passing through any other code present in the set. */
  const isTopmostDescendantOf = (descendantCode: string, parent: string): boolean => {
    let current = stripLastSegment(descendantCode);
    while (current !== null) {
      if (current === parent) return true;
      if (codeSet.has(current)) return false; // another parent is in the way
      current = stripLastSegment(current);
    }
    return false;
  };
  const topmostDescendantsOf = (parent: string): ParsedBudgetLine[] => {
    const prefix = parent + '-';
    return lines.filter(
      (l) =>
        l.code.length > prefix.length &&
        l.code.startsWith(prefix) &&
        isTopmostDescendantOf(l.code, parent),
    );
  };
  const kept: ParsedBudgetLine[] = [];
  const dropped: Array<{ code: string; label: string; plannedAnnual: number }> = [];
  const synthetic: Array<{ code: string; parentCode: string; plannedAnnual: number }> = [];

  for (const l of lines) {
    if (!hasDescendant(l.code)) {
      // No descendants → guaranteed leaf, keep as-is.
      kept.push(l);
      continue;
    }
    const children = topmostDescendantsOf(l.code);
    if (children.length === 0) {
      // No descendants → guaranteed leaf, keep as-is.
      kept.push(l);
      continue;
    }

    // Parent detected. Reconcile against children before dropping.
    const childAnnualSum = children.reduce((s, c) => s + c.plannedAnnual, 0);
    const delta = l.plannedAnnual - childAnnualSum;
    const tol = Math.max(1, Math.abs(l.plannedAnnual) * 0.01);

    if (Math.abs(delta) <= tol) {
      // Children fully explain the parent — safe drop.
      dropped.push({
        code: l.code,
        label: l.label,
        plannedAnnual: l.plannedAnnual,
      });
      continue;
    }

    // Unexplained delta → preserve it as a synthetic __UNALLOCATED__ leaf.
    // Per-month delta computed in the same basis as plannedAnnual (children
    // may not cover every month — if a child has no `perMonth[i]`, treat as 0).
    const childMonthly = new Array<number>(12).fill(0);
    for (const c of children) {
      for (let i = 0; i < 12; i++) {
        childMonthly[i] += c.perMonth[i] ?? 0;
      }
    }
    const unallocatedPerMonth = l.perMonth.map((v, i) => v - childMonthly[i]);

    const syntheticCode = `${l.code}-__UNALLOCATED__`;
    kept.push({
      code: syntheticCode,
      label: `${l.label} (unallocated)`,
      accountType: l.accountType,
      plannedAnnual: delta,
      perMonth: unallocatedPerMonth,
    });
    synthetic.push({
      code: syntheticCode,
      parentCode: l.code,
      plannedAnnual: delta,
    });
    dropped.push({
      code: l.code,
      label: l.label,
      plannedAnnual: l.plannedAnnual,
    });
  }

  return { kept, dropped, synthetic };
}

export function parseSoplSheet(
  workbook: XLSX.WorkBook,
  sheetName: string,
  xlsx: typeof XLSX,
): ParseResult {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      sheetName,
      lines: [],
      warnings: [{ row: 0, reason: `Sheet "${sheetName}" not found` }],
      skippedRowCount: 0,
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    };
  }
  const aoa = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as unknown[][];

  const headerRowIdx = findHeaderRow(aoa);
  if (headerRowIdx === -1) {
    return {
      sheetName,
      lines: [],
      warnings: [
        { row: 0, reason: `Header row with "Yanvar" marker not found` },
      ],
      skippedRowCount: 0,
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    };
  }

  const columns = mapColumns(aoa[headerRowIdx]);
  if (!columns) {
    return {
      sheetName,
      lines: [],
      warnings: [
        {
          row: headerRowIdx + 1,
          reason: `Could not map all 12 month columns in header row`,
        },
      ],
      skippedRowCount: 0,
      parentRollupsDropped: [],
      parentRollupsUnallocated: [],
    };
  }

  const lines: ParsedBudgetLine[] = [];
  const warnings: ParseWarning[] = [];
  let skipped = 0;

  // Surface when code column was guessed (`labelCol - 2`) rather than keyed
  // off an explicit "KOD"/"Code" header — a new unseen workbook layout that
  // shifts the KOD offset would silently parse 0 rows otherwise.
  if (columns.codeColFromFallback) {
    warnings.push({
      row: headerRowIdx + 1,
      reason: `codeCol guessed via labelCol-2 fallback (no KOD/Code header found); verify parsed rows look right`,
    });
  }

  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const code = toTrimmedString(row[columns.codeCol]);
    const label = toTrimmedString(row[columns.labelCol]);

    // No KOD → category / subtotal / signature / summary-calc row. Skip silently.
    if (!code) {
      skipped += 1;
      continue;
    }
    // Accept only SAP-style KODs: 3+ digit group (leading) then optional
    // sub-groups separated by hyphens (e.g. "601", "601-04", "721-02-15").
    // First-group length ≥3 rules out index-column noise ("0", "1", "99")
    // that appears in ZTP's leftmost column. Rejects text, decimals,
    // negatives.
    if (!/^\d{3,}(-\d+)*$/.test(code)) {
      skipped += 1;
      continue;
    }

    const accountType = accountTypeFromCode(code);
    if (!accountType) {
      // 4xx / 5xx / 8xx rows are informational (quantity metrics,
      // transfer-style codes) mixed into SOPL sheets — they aren't P&L
      // items. Silent skip. Anything truly unusual (non-standard prefix)
      // still lands as a warning so operators notice mis-coded rows.
      const firstDigit = code[0];
      if (firstDigit === '4' || firstDigit === '5' || firstDigit === '8') {
        skipped += 1;
      } else {
        warnings.push({
          row: r + 1,
          reason: `code "${code}" didn't map to any accountType prefix (${label})`,
        });
      }
      continue;
    }

    // AZ SOPL display convention: costs are shown as negative numbers.
    // `ChartOfAccount.accountType='cogs'/'expense'` is meant to carry the
    // absolute amount spent (positive); the sign lives on the formula side.
    // Normalise at parse time so the recompute pipeline (`budgetLine`
    // resolver) sees `cogs >= 0`, `opex >= 0`, and `gross_profit = revenue
    // - cogs` produces a correct sign. Revenue and balance-sheet items stay
    // as-authored.
    const flipSign =
      accountType === 'cogs' || accountType === 'expense' ? -1 : 1;

    const perMonth: number[] = [];
    let annual = 0;
    for (const monthCol of columns.monthCols) {
      const v = toNumberOrNull(row[monthCol]);
      const n = (v ?? 0) * flipSign;
      perMonth.push(n);
      annual += n;
    }

    // Ignore rows that are all-zero across every month — the workbook uses
    // zero-filled rows for "placeholder" leaf codes that never got data.
    // These produce no P&L signal and bloat the BudgetLine table.
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
  return {
    sheetName,
    lines: kept,
    warnings,
    // `dropped.length` is the raw parent-row count removed from the sheet.
    // `synthetic.length` is how many of those spawned an __UNALLOCATED__
    // leaf (which is counted in `kept`, not skipped), so subtract those
    // from the skipped bump to avoid over-counting.
    skippedRowCount: skipped + dropped.length - synthetic.length,
    parentRollupsDropped: dropped,
    parentRollupsUnallocated: synthetic,
  };
}
