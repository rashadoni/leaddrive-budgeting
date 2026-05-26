/**
 * Dynamic BS adapter — fallback for unknown Balance Sheet Excel layouts.
 *
 * When `parseWorkbookBsSheet()` (hard-coded AZSEKER adapter) returns 0 rows
 * on a non-empty sheet, `makeBsHandler` in `production-adapter-registry.ts`
 * delegates here. Shares the LLM + 24h cache pipeline with
 * `dynamic-plf-adapter.ts`.
 *
 * Key differences from the PLF adapter:
 *   • BS amounts are point-in-time month-end SNAPSHOTS — no sign inversion.
 *   • Month coverage is partial — BS sheets often span many years. We accept
 *     whatever months the proposal maps rather than requiring all 12.
 *   • Calls `runBalanceSheetBatch` instead of `runImportBatch`.
 *   • Account classification returns { lineType, subType } not a single string.
 */

import type { PrismaClient, Prisma } from "@prisma/client"
import type { AdapterRunInput, AdapterRunResult } from "./adapter-registry"
import { extractMapperInput } from "../ai-mapper/extract"
import { getOrCreateProposal } from "../ai-mapper/proposal-cache"
import { detectProposalYear } from "../ai-mapper/applier"
import { runBalanceSheetBatch, type BsImportRow } from "../bs-import-batch"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import type { ColumnMappingProposal } from "../ai-mapper/types"
import {
  createCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"

// ─────────────────────────────────────────────────────────────────────────────
// BS account classification (mirrors classifyBsLineType in azseker-workbook-bs.ts)
// ─────────────────────────────────────────────────────────────────────────────

type BsLineType = "asset" | "liability" | "equity"
type BsSubType = "non_current" | "current" | "long_term" | "short_term" | null

interface BsClassification {
  lineType: BsLineType
  subType: BsSubType
}

/**
 * Returns null for codes that aren't BS leaf rows or belong to unknown
 * top-level families (e.g. BS.04.* if introduced in the future).
 */
function bsAccountTypeLocal(code: string): BsClassification | null {
  const m = code.match(/^BS\.(\d{2})\.(\d{2})/)
  if (!m) return null
  const top = m[1]
  const sub = m[2]
  if (top === "01") {
    // Assets
    if (sub === "01") return { lineType: "asset", subType: "non_current" }
    if (sub === "02") return { lineType: "asset", subType: "current" }
    return { lineType: "asset", subType: null }
  }
  if (top === "02") return { lineType: "equity", subType: null }
  if (top === "03") {
    // Liabilities
    if (sub === "01") return { lineType: "liability", subType: "long_term" }
    if (sub === "02") return { lineType: "liability", subType: "short_term" }
    return { lineType: "liability", subType: null }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Header-band detection (same heuristic as dynamic-plf-adapter.ts)
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_DETECTION_LIMIT = 20
const MIN_NON_EMPTY = 3
const MAX_HEADER_CELL_LEN = 80
const DEFAULT_HEADER_END_ROW = 5

function detectHeaderEndRow(aoa: Array<Array<string | number | null>>): number {
  for (let r = 0; r < Math.min(HEADER_DETECTION_LIMIT, aoa.length); r++) {
    const row = aoa[r] ?? []
    const nonEmpty = row.filter(
      (v) => v !== null && v !== undefined && v !== "",
    )
    if (nonEmpty.length < MIN_NON_EMPTY) continue
    if (!nonEmpty.every((v) => typeof v === "string")) continue
    if (
      !nonEmpty.every(
        (v) => typeof v === "string" && v.length <= MAX_HEADER_CELL_LEN,
      )
    )
      continue
    return r + 1
  }
  return DEFAULT_HEADER_END_ROW
}

// ─────────────────────────────────────────────────────────────────────────────
// BS leaf code filter
// ─────────────────────────────────────────────────────────────────────────────

/** Matches leaf codes like BS.01.01.01, BS.03.02.04 (3-segment with numeric leaf) */
const BS_LEAF_RE = /^BS\.\d{2}\.\d{2}\.\d{1,2}$/

// ─────────────────────────────────────────────────────────────────────────────
// Partial column resolver — BS sheets may not have all 12 months present
// (e.g. sheet uploaded in April only has Jan-Apr columns for the current year).
// Unlike resolveColumns() in applier.ts this does NOT reject partial coverage.
// ─────────────────────────────────────────────────────────────────────────────

/** Month abbreviation (lowercase) → 0-based index */
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
}

interface PartialResolvedColumns {
  codeCol: number
  labelCol: number
  /** monthIndex (0-11) → source column index; sparse — only mapped months present */
  monthCols: Map<number, number>
}

function resolveColumnsPartial(
  columns: ColumnMappingProposal[],
): { ok: true; columns: PartialResolvedColumns } | { ok: false; reason: string } {
  let codeCol = -1
  let labelCol = -1
  const monthCols = new Map<number, number>()

  for (const c of columns) {
    if (c.role === "code") {
      if (codeCol !== -1) return { ok: false, reason: `Multiple "code" columns` }
      codeCol = c.sourceIndex
    } else if (c.role === "label") {
      if (labelCol !== -1) return { ok: false, reason: `Multiple "label" columns` }
      labelCol = c.sourceIndex
    } else if (c.role.startsWith("amount:")) {
      const period = c.role.slice("amount:".length).toLowerCase()
      // Strip 4-digit year (e.g. "jan2026" → "jan"; "january2026" → "january")
      const monthToken = period.replace(/20\d{2}/, "").trim()
      const monthIdx = MONTH_INDEX[monthToken]
      if (monthIdx !== undefined && !monthCols.has(monthIdx)) {
        monthCols.set(monthIdx, c.sourceIndex)
      }
    }
    // role === "skip" → ignored
  }

  if (codeCol === -1) return { ok: false, reason: 'No "code" column in proposal' }
  if (labelCol === -1) return { ok: false, reason: 'No "label" column in proposal' }
  if (monthCols.size === 0) return { ok: false, reason: "No month columns in proposal — sheet may be annual-only" }

  return { ok: true, columns: { codeCol, labelCol, monthCols } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run dynamic structure detection + extraction for a BS-classified sheet
 * whose format the hard-coded AZSEKER parser did not recognise.
 *
 * @param input      Standard adapter input (workbook, sheetName, XLSX, …).
 * @param planId     Budget-plan ID — resolved by the calling handler from OrgContext.
 * @param _prisma    Injected for future CoA lookups; not used in v1.
 * @param companyId  Phase 7.O — optional company scope for per-entity resolver
 *                   queries (inventory, equity ratios, etc.). Pass null when
 *                   entityCode cannot be resolved to a company DB row.
 */
export async function runDynamicBsAdapter(
  input: AdapterRunInput,
  planId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prisma: PrismaClient,
  companyId?: string | null,
): Promise<AdapterRunResult> {
  // ── Guard: cross-entity sheets have no entityCode ─────────────────────────
  if (!input.entityCode) {
    return {
      summary: `Dynamic BS: sheet "${input.sheetName}" has no entityCode — skipped`,
      itemCount: 0,
      warnings: [
        `Sheet "${input.sheetName}" dynamic BS detection skipped: no entityCode`,
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 1. Extract compact sheet metadata ─────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapperInputResult = extractMapperInput(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input.workbook as any,
    input.sheetName,
    input.XLSX,
    { companyName: input.entityCode },
  )
  if ("error" in mapperInputResult) {
    return {
      summary: `Dynamic BS: extraction error — ${mapperInputResult.error}`,
      itemCount: 0,
      warnings: [`Dynamic BS detection failed: ${mapperInputResult.error}`],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  const cacheKeyHint = `${input.organizationId.slice(0, 8)}:${input.sheetName}`

  // ── 2. LLM call + 24h cache via AIMapperProposalCache ─────────────────────
  let proposalResult: Awaited<ReturnType<typeof getOrCreateProposal>>
  try {
    proposalResult = await getOrCreateProposal(mapperInputResult, {
      orgId: input.organizationId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      summary: `Dynamic BS: LLM error — ${msg}`,
      itemCount: 0,
      warnings: [
        `Dynamic BS LLM error (hint: ${cacheKeyHint}): ${msg}`,
        "Sheet not imported — upload again once API is available.",
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }
  const { proposal, cacheHit } = proposalResult

  // ── 3. Confidence gate ────────────────────────────────────────────────────
  if (proposal.overallConfidence < 0.5) {
    return {
      summary: `Dynamic BS: low confidence ${proposal.overallConfidence.toFixed(2)} — skipped`,
      itemCount: 0,
      warnings: [
        `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
        cacheHit ? "(cache hit — no LLM cost)" : "(cache miss — LLM called)",
        `Low confidence (${proposal.overallConfidence.toFixed(2)} < 0.50) — no rows imported. Review sheet "${input.sheetName}" manually.`,
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 4. Resolve column positions (partial — BS may be mid-year) ────────────
  const colsResult = resolveColumnsPartial(proposal.columns)
  if (!colsResult.ok) {
    return {
      summary: `Dynamic BS: column resolution failed — ${colsResult.reason}`,
      itemCount: 0,
      warnings: [
        `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
        cacheHit ? "(cache hit)" : "(cache miss — LLM called)",
        `Column mapping incomplete: ${colsResult.reason}`,
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }
  const { codeCol, labelCol, monthCols } = colsResult.columns

  // ── 5. Detect effective year ───────────────────────────────────────────────
  const detectedYear = detectProposalYear(proposal.columns)
  let effectiveYear = input.year
  const yearWarnings: string[] = []

  if (typeof detectedYear === "number") {
    effectiveYear = detectedYear
    if (detectedYear !== input.year) {
      yearWarnings.push(
        `Dynamic BS: proposal year ${detectedYear} differs from requested year ${input.year} — using proposal year`,
      )
    }
  } else if (
    detectedYear !== null &&
    typeof detectedYear === "object" &&
    "conflict" in detectedYear
  ) {
    yearWarnings.push(
      `Dynamic BS: multiple years in proposal (${detectedYear.conflict.join(", ")}) — defaulting to input.year=${input.year}`,
    )
  }

  // ── 6. Build AOA from the sheet ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheet = (input.workbook as any).Sheets[input.sheetName]
  const aoa = input.XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<string | number | null>>

  const headerEndRow = detectHeaderEndRow(aoa)

  // ── 7. Extract rows ───────────────────────────────────────────────────────
  const rows: BsImportRow[] = []
  const expectedSums = new Map<ReconciliationKey, number>()

  for (let r = headerEndRow; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[codeCol]
    const code =
      typeof codeRaw === "string"
        ? codeRaw.trim()
        : typeof codeRaw === "number"
          ? String(codeRaw)
          : ""
    if (!code) continue
    if (!BS_LEAF_RE.test(code)) continue

    const classification = bsAccountTypeLocal(code)
    if (!classification) continue

    const labelRaw = row[labelCol]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code

    // accountCode uses compound key: entityCode prefix + BS code
    const accountCode = `${input.entityCode}-${code}`

    for (const [monthIdx, colIdx] of monthCols) {
      const cellVal = row[colIdx]
      const raw =
        typeof cellVal === "number"
          ? cellVal
          : typeof cellVal === "string" && cellVal.trim() !== ""
            ? Number(cellVal.replace(",", "."))
            : null

      if (raw === null || !Number.isFinite(raw) || raw === 0) continue

      // BS snapshots are point-in-time — store as-is, no sign inversion
      const amount = raw
      const month = monthIdx + 1
      const period = `${effectiveYear}-${String(month).padStart(2, "0")}`

      rows.push({
        planId,
        companyId: companyId ?? null, // Phase 7.O — company scope for resolver queries
        accountCode,
        accountName: label,
        lineType: classification.lineType,
        subType: classification.subType,
        year: effectiveYear,
        month,
        amount,
        sourceCell: `dynamic-detect#${input.sheetName}!${code}@${period}`,
      })

      const key = buildReconKey(planId, accountCode, period)
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
    }
  }

  // ── 8. Assemble result ────────────────────────────────────────────────────
  const baseWarnings = [
    `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
    cacheHit ? "(cache hit — no LLM cost)" : "(cache miss — LLM called)",
    ...(proposal.overallConfidence < 0.7
      ? [`Confidence ${proposal.overallConfidence.toFixed(2)} < 0.70 — review imported rows`]
      : []),
    ...yearWarnings,
  ]

  // periodScope derived from mapped months (may be partial year)
  const periodScope = [...monthCols.keys()]
    .sort((a, b) => a - b)
    .map((m) => `${effectiveYear}-${String(m + 1).padStart(2, "0")}`)

  // Expose expectedSums for orchestrator cross-file conflict detection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra = rows.length > 0 ? { expectedSums } : ({} as any)

  return {
    summary: `${rows.length} dynamic BS rows for ${input.entityCode} (conf=${proposal.overallConfidence.toFixed(2)}, sheet="${input.sheetName}")`,
    itemCount: rows.length,
    warnings: baseWarnings,
    ...extra,
    applyToDb: async (tx: Prisma.TransactionClient) => {
      if (rows.length === 0) return { rowsInserted: 0 }
      // Phase 2.1 session 1 — resolve CoA FK for every unique BS code.
      const coaCache = createCoACache()
      const entityCode = input.entityCode ?? ""
      const accountIdByLineCode = new Map<string, string>()
      for (const r of rows) {
        const lineCode = r.accountCode.startsWith(`${entityCode}-`)
          ? r.accountCode.slice(entityCode.length + 1)
          : r.accountCode
        if (accountIdByLineCode.has(lineCode)) continue
        const id = await resolveOrCreateAccountId(tx, coaCache, {
          organizationId: input.organizationId,
          code: lineCode,
          defaultName: r.accountName,
          defaultAccountType: r.lineType,
        })
        accountIdByLineCode.set(lineCode, id)
      }
      const resolvedRows = rows.map((r) => {
        const lineCode = r.accountCode.startsWith(`${entityCode}-`)
          ? r.accountCode.slice(entityCode.length + 1)
          : r.accountCode
        return {
          ...r,
          accountId: accountIdByLineCode.get(lineCode) ?? null,
        }
      })
      const result = await runBalanceSheetBatch(tx, {
        organizationId: input.organizationId,
        label: `Dynamic BS ${input.entityCode} ${effectiveYear}`,
        actorUserId: "ai-dynamic-import",
        sourceDocument: `dynamic-detect:${input.sheetName}`,
        planIds: [planId],
        periodScope,
        rows: resolvedRows,
        expectedSums,
      })
      return { rowsInserted: result.metrics.rowsInserted }
    },
  }
}
