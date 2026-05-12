/**
 * Phase 7.H F4.v2.3.1 — operational KPI bulk Excel import.
 *
 * Closes the v2.3 single-row-at-a-time bottleneck: realistic onboarding
 * is 13 metrics × 12 months × N companies = 1000+ rows that nobody is
 * typing manually. This module is the parser + per-row validator that
 * powers both the preview and apply endpoints.
 *
 * **Workbook contract:** one sheet, six columns, first row is the
 * header. Column names are case-insensitive but order-flexible — we
 * look up by header text, not column index.
 *
 *   companyCode  — Company.code (must exist in caller's org)
 *   metric       — must be one of OPERATIONAL_METRIC_KEYS
 *   date         — YYYY-MM-DD; Excel serials also accepted
 *   value        — finite number
 *   unit         — must match `MetricValidationRule.unit` exactly
 *   sourceNote   — optional; free text, max 500 chars
 *
 * Every row is validated against `metric-validation-rules.ts`:
 *  - unknown metric → error
 *  - wrong unit for the metric → error
 *  - value outside [min, max] → error
 *  - value crossing warnMin/warnMax → warning (apply still permitted)
 *
 * Pure module — no Prisma. Tested at
 * `operational-facts-import.test.ts`. The API route wraps this with
 * org-scope checks + company-code→id resolution + audit events.
 */

import type * as XLSX from "xlsx";
import {
  getOperationalRule,
  validateValue,
  OPERATIONAL_METRIC_KEYS,
} from "@/lib/risk/metric-validation-rules";

export interface ParsedRow {
  /** 1-based row number in the workbook (matches Excel UI). */
  rowNumber: number;
  companyCode: string;
  metric: string;
  date: string;
  value: number;
  unit: string;
  sourceNote: string | null;
}

export interface ImportRowError {
  rowNumber: number;
  reason: string;
  /** When set, the row was parsed enough to identify which company /
   *  metric pair failed — useful for UI grouping. */
  companyCode?: string;
  metric?: string;
}

export interface ImportRowWarning {
  rowNumber: number;
  message: string;
  companyCode?: string;
  metric?: string;
}

export interface ImportParseResult {
  /** Rows that passed hard validation. Soft warnings may still apply. */
  rows: ParsedRow[];
  /** Rows that failed hard validation — value out of range, unknown
   *  metric, malformed date, missing required column, etc. */
  errors: ImportRowError[];
  /** Rows that passed but tripped a soft bound (e.g. unusually high
   *  occupancy). UI should surface these and require explicit confirm. */
  warnings: ImportRowWarning[];
}

const REQUIRED_HEADERS = [
  "companyCode",
  "metric",
  "date",
  "value",
  "unit",
] as const;

type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

/**
 * Header-name lookup is case-insensitive. Excel users routinely
 * capitalize column names ("CompanyCode") or insert spaces ("Company
 * Code"); normalize to lower-no-space for matching.
 */
function normalizeHeader(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, "").toLowerCase();
}

const HEADER_ALIASES: Record<RequiredHeader, string[]> = {
  companyCode: ["companycode", "company", "code"],
  metric: ["metric", "metricname", "kpi"],
  date: ["date", "period"],
  value: ["value", "amount", "qty", "quantity"],
  unit: ["unit", "units", "uom"],
};

/**
 * Excel stores dates as serial days since 1900 (or 1904 on Mac). When
 * `cellDates` is false during parsing, we receive numbers. When true,
 * we receive JS Dates. Accept both + ISO strings. Returns YYYY-MM-DD or
 * null on unparseable input.
 */
function coerceDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Excel serial → JS Date. Excel epoch is 1899-12-30 (1900-01-00 in
    // Excel's broken model). Days × 86400 seconds.
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + raw * 86_400_000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
    // US / EU date — let Date.parse try. Bail if it returns NaN.
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Parse + validate a workbook buffer. Returns { rows, errors, warnings }
 * for the caller (API route) to surface back to the UI. Does NOT hit
 * the database — company-code resolution happens at apply time.
 */
export function parseOperationalFactsWorkbook(
  workbook: XLSX.WorkBook,
  xlsx: typeof XLSX,
): ImportParseResult {
  const errors: ImportRowError[] = [];
  const warnings: ImportRowWarning[] = [];
  const rows: ParsedRow[] = [];

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    errors.push({ rowNumber: 0, reason: "Workbook has no sheets." });
    return { rows, errors, warnings };
  }

  const sheet = workbook.Sheets[sheetName];
  const aoa = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<unknown>>;

  if (aoa.length < 2) {
    errors.push({
      rowNumber: 0,
      reason:
        "Workbook must have a header row and at least one data row. Download the template for the expected shape.",
    });
    return { rows, errors, warnings };
  }

  // Map each known header alias to its column index in row 0.
  const headerRow = aoa[0] ?? [];
  const colIdx: Record<RequiredHeader, number> = {
    companyCode: -1,
    metric: -1,
    date: -1,
    value: -1,
    unit: -1,
  };
  let sourceNoteCol = -1;

  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeHeader(headerRow[i]);
    if (!norm) continue;
    for (const key of REQUIRED_HEADERS) {
      if (HEADER_ALIASES[key].includes(norm)) {
        colIdx[key] = i;
        break;
      }
    }
    if (norm === "sourcenote" || norm === "note" || norm === "comment") {
      sourceNoteCol = i;
    }
  }

  const missing = REQUIRED_HEADERS.filter((k) => colIdx[k] === -1);
  if (missing.length > 0) {
    errors.push({
      rowNumber: 1,
      reason: `Missing required column(s): ${missing.join(", ")}. Expected headers: ${REQUIRED_HEADERS.join(", ")} (optional: sourceNote).`,
    });
    return { rows, errors, warnings };
  }

  // Iterate data rows. Excel row numbers are 1-indexed; data starts at
  // row 2 (header is row 1) — surface that number to the UI so errors
  // map cleanly to what the user sees in Excel.
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const excelRow = r + 1;

    const companyCodeRaw = row[colIdx.companyCode];
    const metricRaw = row[colIdx.metric];
    const dateRaw = row[colIdx.date];
    const valueRaw = row[colIdx.value];
    const unitRaw = row[colIdx.unit];
    const sourceNoteRaw =
      sourceNoteCol >= 0 ? row[sourceNoteCol] : null;

    // Skip fully-empty rows silently (common in user-edited xlsx).
    const allEmpty =
      (companyCodeRaw == null || companyCodeRaw === "") &&
      (metricRaw == null || metricRaw === "") &&
      (dateRaw == null || dateRaw === "") &&
      (valueRaw == null || valueRaw === "") &&
      (unitRaw == null || unitRaw === "");
    if (allEmpty) continue;

    const companyCode =
      typeof companyCodeRaw === "string"
        ? companyCodeRaw.trim()
        : String(companyCodeRaw ?? "").trim();
    if (!companyCode) {
      errors.push({ rowNumber: excelRow, reason: "Missing companyCode." });
      continue;
    }

    const metric =
      typeof metricRaw === "string"
        ? metricRaw.trim()
        : String(metricRaw ?? "").trim();
    if (!metric) {
      errors.push({
        rowNumber: excelRow,
        companyCode,
        reason: "Missing metric.",
      });
      continue;
    }
    if (!OPERATIONAL_METRIC_KEYS.includes(metric)) {
      errors.push({
        rowNumber: excelRow,
        companyCode,
        metric,
        reason: `Unknown metric "${metric}". Allowed: ${OPERATIONAL_METRIC_KEYS.join(", ")}.`,
      });
      continue;
    }

    const date = coerceDate(dateRaw);
    if (!date) {
      errors.push({
        rowNumber: excelRow,
        companyCode,
        metric,
        reason: `Invalid date "${String(dateRaw)}". Use YYYY-MM-DD format.`,
      });
      continue;
    }

    const valueNum =
      typeof valueRaw === "number"
        ? valueRaw
        : typeof valueRaw === "string"
          ? Number(valueRaw.replace(/[\s,]/g, ""))
          : NaN;
    if (!Number.isFinite(valueNum)) {
      errors.push({
        rowNumber: excelRow,
        companyCode,
        metric,
        reason: `Invalid value "${String(valueRaw)}". Expected a finite number.`,
      });
      continue;
    }

    const unit =
      typeof unitRaw === "string"
        ? unitRaw.trim()
        : String(unitRaw ?? "").trim();
    if (!unit) {
      errors.push({
        rowNumber: excelRow,
        companyCode,
        metric,
        reason: "Missing unit.",
      });
      continue;
    }

    const rule = getOperationalRule(metric)!;
    const validation = validateValue(rule, valueNum, unit);
    if (!validation.ok) {
      // Hard validation failures — wrong unit, out of range, NaN. The
      // first error per row is sufficient; users fix one at a time.
      errors.push({
        rowNumber: excelRow,
        companyCode,
        metric,
        reason: validation.errors.join(" "),
      });
      continue;
    }
    for (const w of validation.warnings) {
      warnings.push({ rowNumber: excelRow, companyCode, metric, message: w });
    }

    const sourceNote =
      typeof sourceNoteRaw === "string" && sourceNoteRaw.trim().length > 0
        ? sourceNoteRaw.trim().slice(0, 500)
        : null;

    rows.push({
      rowNumber: excelRow,
      companyCode,
      metric,
      date,
      value: valueNum,
      unit,
      sourceNote,
    });
  }

  return { rows, errors, warnings };
}
