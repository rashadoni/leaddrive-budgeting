/**
 * Phase 7.M Tier 7 (Phase 3, 2026-05-21) — Budget-actuals bulk Excel parser.
 *
 * Pure module — no Prisma. Parses a single-sheet xlsx into validated
 * BudgetActual rows. Mirrors the shape of `operational-facts-import.ts`
 * but targets the `budget_actuals` table (plan-scoped expense/revenue
 * transactions vs operational_facts which is company×metric×date).
 *
 * **Workbook contract:** one sheet, headers in row 0. Column names are
 * case-insensitive and order-flexible — we look up by header text, not
 * column index.
 *
 *   category    — non-empty string (mapped via integration.categoryMapping
 *                 later by the route, not here)
 *   amount      — finite non-zero number; absolute value is stored
 *   date        — YYYY-MM-DD string; Excel serials also accepted; used
 *                 to derive monthIndex (0-11)
 *   department  — optional string (free-form or BudgetDepartment.name —
 *                 caller resolves to departmentId if known)
 *   description — optional free-text, max 500 chars
 *   lineType    — optional, one of: expense | revenue | other (default
 *                 "expense")
 *   companyCode — optional; if present, must match a Company.code in
 *                 the org (caller resolves to companyId)
 *
 * Each row becomes one `ParsedActualRow` after validation. Invalid rows
 * (missing required headers, non-finite amount, malformed date) go into
 * `errors` — same red/yellow split convention as `operational-facts-import`.
 *
 * Pure module — no Prisma, no audit, no DB. The handler / API route
 * wraps this with org-scope checks + plan resolution + companyCode→id
 * resolution + audit events.
 */
import type * as XLSX from "xlsx"
import {
  resolveCostSigns,
  type CostSignDecision,
} from "./ai-import/cost-sign"

export interface ParsedActualRow {
  /** 1-based row number in the workbook (matches Excel UI). */
  rowNumber: number
  category: string
  /** ABSOLUTE value of the amount (sign discarded per CSV-route convention). */
  amount: number
  /** ISO `YYYY-MM-DD`. */
  date: string
  /** 0-indexed month (0=Jan..11=Dec) derived from `date`. */
  monthIndex: number
  department: string | null
  description: string | null
  /** "expense" | "revenue" | "other" — defaults to "expense". */
  lineType: string
  /** Optional Company.code — caller resolves to companyId. */
  companyCode: string | null
}

export interface ImportRowError {
  rowNumber: number
  reason: string
  category?: string
}

export interface ImportRowWarning {
  rowNumber: number
  message: string
  category?: string
}

export interface ImportParseResult {
  /** Phase 11.15 — which cost-sign convention the FILE was found to use, and
   *  whether expense amounts were flipped to the DB's charge-positive
   *  convention as a result. */
  signConvention?: CostSignDecision
  rows: ParsedActualRow[]
  errors: ImportRowError[]
  warnings: ImportRowWarning[]
}

const REQUIRED_HEADERS = ["category", "amount", "date"] as const

type RequiredHeader = (typeof REQUIRED_HEADERS)[number]

const ALLOWED_LINE_TYPES = new Set(["expense", "revenue", "other"])

const HEADER_ALIASES: Record<string, string[]> = {
  category: ["category", "account"],
  amount: ["amount", "sum", "value"],
  date: ["date", "period", "expensedate"],
  department: ["department", "dept", "departmentname"],
  description: ["description", "memo", "note", "comment"],
  linetype: ["linetype", "type"],
  companycode: ["companycode", "company", "code"],
}

function normalizeHeader(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.replace(/\s+/g, "").toLowerCase()
}

/** Parse Excel date serial or ISO string → `YYYY-MM-DD`. Returns null
 *  on malformed input. */
function parseDateCell(raw: unknown): string | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null
    return raw.toISOString().slice(0, 10)
  }
  if (typeof raw === "number") {
    // Excel serial: days since 1900-01-01 (with 1900 leap-year bug)
    // Use built-in xlsx convention via JS Date: Excel epoch is
    // 1899-12-30 (account for 1900 bug); 1 day = 86400000 ms.
    const ms = (raw - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  if (typeof raw === "string") {
    const s = raw.trim()
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    // DD.MM.YYYY or DD/MM/YYYY
    const eu = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
    if (eu) {
      const [, d, m, y] = eu
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
    }
    // ISO with time → take date part
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10)
    // Try Date parser fallback
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  return null
}

function deriveMonthFromIso(iso: string): number | null {
  const m = iso.match(/^\d{4}-(\d{2})/)
  if (!m) return null
  const mo = Number(m[1])
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return null
  return mo - 1
}

/**
 * Parse a budget-actuals workbook → validated rows. Reads
 * `workbook.SheetNames[0]` by default. Pure: no DB, no LLM.
 */
export function parseBudgetActualsWorkbook(
  workbook: XLSX.WorkBook,
  xlsx: typeof XLSX,
): ImportParseResult {
  const errors: ImportRowError[] = []
  const warnings: ImportRowWarning[] = []
  const rows: ParsedActualRow[] = []

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    errors.push({ rowNumber: 0, reason: "Workbook has no sheets." })
    return { rows, errors, warnings }
  }
  const sheet = workbook.Sheets[sheetName]
  const aoa = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<unknown>>

  if (aoa.length < 2) {
    errors.push({
      rowNumber: 0,
      reason:
        "Workbook must have a header row and at least one data row. Expected headers: category, amount, date (+ optional department, description, lineType, companyCode).",
    })
    return { rows, errors, warnings }
  }

  const headerRow = aoa[0] ?? []
  // Map header alias group → column index in row 0
  const colIdx: Record<string, number> = {
    category: -1,
    amount: -1,
    date: -1,
    department: -1,
    description: -1,
    linetype: -1,
    companycode: -1,
  }
  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeHeader(headerRow[i])
    if (!norm) continue
    for (const key of Object.keys(HEADER_ALIASES)) {
      if (HEADER_ALIASES[key].includes(norm)) {
        if (colIdx[key] === -1) colIdx[key] = i
        break
      }
    }
  }

  // Required headers must be present
  for (const req of REQUIRED_HEADERS) {
    if (colIdx[req] === -1) {
      errors.push({
        rowNumber: 0,
        reason: `Missing required header "${req}". Headers seen: ${headerRow
          .filter((h) => h != null && h !== "")
          .join(", ")}`,
      })
    }
  }
  if (errors.length > 0) return { rows, errors, warnings }

  for (let r = 1; r < aoa.length; r++) {
    const rowNumber = r + 1 // 1-based for UI
    const cells = aoa[r] ?? []

    const rawCategory = cells[colIdx.category]
    const category =
      typeof rawCategory === "string"
        ? rawCategory.trim()
        : rawCategory != null
          ? String(rawCategory).trim()
          : ""
    if (!category) {
      errors.push({ rowNumber, reason: "Missing category" })
      continue
    }

    const rawAmount = cells[colIdx.amount]
    let amountNum: number
    if (typeof rawAmount === "number") {
      amountNum = rawAmount
    } else {
      // Strip currency symbols/spaces, then require what remains to actually
      // BE a number. Phase 11.15: the old code did `Number(stripped)` and
      // relied on the later `=== 0` check to catch junk — but "abc" strips to
      // "" and `Number("")` is 0, not NaN. Now that an explicit 0 is
      // legitimate data, that shortcut would have let garbage land silently
      // as a zero. Emptiness and non-numeric shapes are rejected explicitly.
      const stripped = String(rawAmount ?? "").replace(/[^\d.\-]/g, "")
      amountNum = /^-?\d*\.?\d+$/.test(stripped) ? Number(stripped) : NaN
    }
    if (!Number.isFinite(amountNum)) {
      errors.push({ rowNumber, reason: "Invalid amount", category })
      continue
    }
    // Phase 11.15 (2026-07-29) — an explicit 0 is DATA, not an error.
    // It used to be rejected alongside unparseable cells, so a genuine zero
    // both vanished from the import and showed up in the error list as a
    // parse failure. In a phase whose premise is "every number, down to the
    // last zero", dropping the zeros was the one thing that could not stand.
    //
    // The sign is kept RAW here; the file's cost convention is inferred after
    // the loop and applied in pass 2. `Math.abs()` used to run on this line,
    // which turned every credit note and reversal into a CHARGE: a -500
    // correction landed as +500 and inflated the actual instead of reducing
    // it. Removing abs alone would not be right either — a sheet that stores
    // expenses negative would then flip every actual negative, which is the
    // same convention trap Phase 11.9 closed for the P&L parsers.
    const amount = amountNum

    const dateIso = parseDateCell(cells[colIdx.date])
    if (!dateIso) {
      errors.push({ rowNumber, reason: "Malformed date", category })
      continue
    }
    const monthIndex = deriveMonthFromIso(dateIso)
    if (monthIndex === null) {
      errors.push({ rowNumber, reason: "Date out of range", category })
      continue
    }

    const department =
      colIdx.department === -1 ? null : String(cells[colIdx.department] ?? "").trim() || null

    const description =
      colIdx.description === -1
        ? null
        : (() => {
            const raw = String(cells[colIdx.description] ?? "").trim()
            if (!raw) return null
            if (raw.length > 500) {
              warnings.push({
                rowNumber,
                message: `description truncated to 500 chars`,
                category,
              })
              return raw.slice(0, 500)
            }
            return raw
          })()

    let lineType = "expense"
    if (colIdx.linetype !== -1) {
      const raw = String(cells[colIdx.linetype] ?? "").trim().toLowerCase()
      if (raw && !ALLOWED_LINE_TYPES.has(raw)) {
        warnings.push({
          rowNumber,
          message: `unknown lineType "${raw}" → defaulting to "expense"`,
          category,
        })
      } else if (raw) {
        lineType = raw
      }
    }

    const companyCode =
      colIdx.companycode === -1
        ? null
        : String(cells[colIdx.companycode] ?? "").trim() || null

    rows.push({
      rowNumber,
      category,
      amount,
      date: dateIso,
      monthIndex,
      department,
      description,
      lineType,
      companyCode,
    })
  }

  // ── Pass 2: apply the INFERRED cost-sign convention ──────────────────
  // `BudgetActual.actualAmount` follows the DB convention: a charge is
  // positive, a reversal negative. Which direction the FILE uses is inferred
  // from its own expense rows rather than assumed, exactly as in
  // azseker-plf.ts (Phase 11.9b). Revenue rows are never flipped.
  const expenseRawAnnuals = rows
    .filter((r) => r.lineType === "expense")
    .map((r) => r.amount)
  const signDecision = resolveCostSigns([], expenseRawAnnuals)
  if (signDecision.flipExpense) {
    for (const r of rows) {
      if (r.lineType === "expense") r.amount = -r.amount
    }
  }
  if (signDecision.blockedReason) {
    warnings.push({
      rowNumber: 0,
      message: `BLOCKED: ${signDecision.blockedReason}`,
      category: "",
    })
  }

  return { rows, errors, warnings, signConvention: signDecision }
}
