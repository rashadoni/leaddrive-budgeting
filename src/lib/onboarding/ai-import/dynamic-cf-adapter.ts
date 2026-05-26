/**
 * Dynamic CF adapter — fallback for unknown Cash Flow Excel layouts.
 *
 * When `parsePlfCfSheet()` (hard-coded AZSEKER CF parser) returns 0 entries
 * on a non-empty sheet, `makeCfHandler` in `production-adapter-registry.ts`
 * delegates here. Shares the LLM + 24h cache pipeline with
 * `dynamic-plf-adapter.ts` and `dynamic-bs-adapter.ts`.
 *
 * Key differences from the PLF adapter:
 *   • CF amounts are stored as Math.abs — direction is encoded in `entryType`
 *     ("inflow" | "outflow"), matching `parsePlfCfSheet` convention.
 *   • Activity type (operating / investing / financing) comes from the CF.XX
 *     top-level family (CF.01 / CF.02 / CF.03). CF.04-07 are bridge rows
 *     (totals, FX changes, opening/closing balances) — skipped.
 *   • Entry type (inflow / outflow) from the CF.XX.01 / CF.XX.02 sub-segment;
 *     falls back to sign-of-sum when sub-segment is absent.
 *   • Month coverage is partial (same as BS — accepts whatever months mapped).
 *   • Calls `runCashFlowBatch` instead of `runImportBatch`.
 */

import type { PrismaClient, Prisma } from "@prisma/client"
import type { AdapterRunInput, AdapterRunResult } from "./adapter-registry"
import { extractMapperInput } from "../ai-mapper/extract"
import { getOrCreateProposal } from "../ai-mapper/proposal-cache"
import { detectProposalYear } from "../ai-mapper/applier"
import { runCashFlowBatch, type CfImportRow } from "../cf-import-batch"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import type { ColumnMappingProposal } from "../ai-mapper/types"
import {
  createCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"

// ─────────────────────────────────────────────────────────────────────────────
// CF code classification helpers
// ─────────────────────────────────────────────────────────────────────────────

type CfActivityType = "operating" | "investing" | "financing"
type CfEntryType = "inflow" | "outflow"

/**
 * Maps CF.XX top-level family to activity type.
 * Returns null for bridge rows (CF.04 net-FX / CF.05 net / CF.06 opening /
 * CF.07 closing) — callers skip those rows.
 */
function cfActivityTypeLocal(code: string): CfActivityType | null {
  const m = code.match(/^CF\.(\d{2})/)
  if (!m) return null
  const top = m[1]
  if (top === "01") return "operating"
  if (top === "02") return "investing"
  if (top === "03") return "financing"
  // CF.04-07: FX change, net change, opening balance, closing balance — skip
  return null
}

/**
 * Determines entry direction from the sub-segment number in CF.XX.NN.YY.
 *   CF.XX.01.* = inflow segment
 *   CF.XX.02.* = outflow segment
 * Falls back to sign-of-sum when sub-segment is absent or unrecognised.
 */
function cfEntryTypeLocal(code: string, signHintSum: number): CfEntryType {
  const m = code.match(/^CF\.\d{2}\.(\d{2})\./)
  if (m) {
    if (m[1] === "01") return "inflow"
    if (m[1] === "02") return "outflow"
  }
  return signHintSum >= 0 ? "inflow" : "outflow"
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
// CF leaf code filter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Matches leaf CF codes like CF.01.01.01, CF.03.02.04.
 * Sub-segment codes like CF.01.01 (no leaf) are parent/total rows — skipped.
 */
const CF_LEAF_RE = /^CF\.\d{2}\.\d{2}\.\d{1,2}$/

// ─────────────────────────────────────────────────────────────────────────────
// Partial column resolver (same as dynamic-bs-adapter.ts — not shared to
// avoid cross-file coupling; both are stable ~30-line helpers)
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
  /** monthIndex (0-11) → source column index; sparse */
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
      const monthToken = period.replace(/20\d{2}/, "").trim()
      const monthIdx = MONTH_INDEX[monthToken]
      if (monthIdx !== undefined && !monthCols.has(monthIdx)) {
        monthCols.set(monthIdx, c.sourceIndex)
      }
    }
  }

  if (codeCol === -1) return { ok: false, reason: 'No "code" column in proposal' }
  if (labelCol === -1) return { ok: false, reason: 'No "label" column in proposal' }
  if (monthCols.size === 0) return { ok: false, reason: "No month columns in proposal" }

  return { ok: true, columns: { codeCol, labelCol, monthCols } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source tag for dynamic CF imports (distinct from the AZSEKER hard-coded tag)
// ─────────────────────────────────────────────────────────────────────────────

const DYNAMIC_CF_SOURCE_TAG = "dynamic-cf"

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run dynamic structure detection + extraction for a CF-classified sheet
 * whose format the hard-coded AZSEKER parser did not recognise.
 *
 * @param input      Standard adapter input (workbook, sheetName, XLSX, …).
 * @param _prisma    Injected for future lookups; not used in v1.
 */
export async function runDynamicCfAdapter(
  input: AdapterRunInput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prisma: PrismaClient,
): Promise<AdapterRunResult> {
  // ── Guard: cross-entity sheets have no entityCode ─────────────────────────
  if (!input.entityCode) {
    return {
      summary: `Dynamic CF: sheet "${input.sheetName}" has no entityCode — skipped`,
      itemCount: 0,
      warnings: [
        `Sheet "${input.sheetName}" dynamic CF detection skipped: no entityCode`,
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 1. Extract compact sheet metadata ─────────────────────────────────────
  const mapperInputResult = extractMapperInput(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input.workbook as any,
    input.sheetName,
    input.XLSX,
    { companyName: input.entityCode },
  )
  if ("error" in mapperInputResult) {
    return {
      summary: `Dynamic CF: extraction error — ${mapperInputResult.error}`,
      itemCount: 0,
      warnings: [`Dynamic CF detection failed: ${mapperInputResult.error}`],
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
      summary: `Dynamic CF: LLM error — ${msg}`,
      itemCount: 0,
      warnings: [
        `Dynamic CF LLM error (hint: ${cacheKeyHint}): ${msg}`,
        "Sheet not imported — upload again once API is available.",
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }
  const { proposal, cacheHit } = proposalResult

  // ── 3. Confidence gate ────────────────────────────────────────────────────
  if (proposal.overallConfidence < 0.5) {
    return {
      summary: `Dynamic CF: low confidence ${proposal.overallConfidence.toFixed(2)} — skipped`,
      itemCount: 0,
      warnings: [
        `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
        cacheHit ? "(cache hit — no LLM cost)" : "(cache miss — LLM called)",
        `Low confidence (${proposal.overallConfidence.toFixed(2)} < 0.50) — no rows imported. Review sheet "${input.sheetName}" manually.`,
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 4. Resolve column positions (partial — CF may be mid-year) ────────────
  const colsResult = resolveColumnsPartial(proposal.columns)
  if (!colsResult.ok) {
    return {
      summary: `Dynamic CF: column resolution failed — ${colsResult.reason}`,
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
        `Dynamic CF: proposal year ${detectedYear} differs from requested year ${input.year} — using proposal year`,
      )
    }
  } else if (
    detectedYear !== null &&
    typeof detectedYear === "object" &&
    "conflict" in detectedYear
  ) {
    yearWarnings.push(
      `Dynamic CF: multiple years in proposal (${detectedYear.conflict.join(", ")}) — defaulting to input.year=${input.year}`,
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
  const rows: CfImportRow[] = []
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
    if (!CF_LEAF_RE.test(code)) continue

    const activityType = cfActivityTypeLocal(code)
    if (!activityType) continue // bridge rows (CF.04-07) → skip

    const labelRaw = row[labelCol]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code

    // Pre-scan sum to determine inflow/outflow when sub-segment is absent
    let signHintSum = 0
    for (const [, colIdx] of monthCols) {
      const v = row[colIdx]
      if (typeof v === "number" && Number.isFinite(v)) signHintSum += v
    }
    const entryType = cfEntryTypeLocal(code, signHintSum)

    const cfCode = code
    const category = `${input.entityCode}-${cfCode}`
    const sourceId = `${input.entityCode}::${cfCode}`

    for (const [monthIdx, colIdx] of monthCols) {
      const cellVal = row[colIdx]
      const raw =
        typeof cellVal === "number"
          ? cellVal
          : typeof cellVal === "string" && cellVal.trim() !== ""
            ? Number(cellVal.replace(",", "."))
            : null

      if (raw === null || !Number.isFinite(raw) || raw === 0) continue

      // CF convention: store absolute value; direction encoded in entryType
      const amount = Math.abs(raw)
      const month = monthIdx + 1
      const period = `${effectiveYear}-${String(month).padStart(2, "0")}`

      rows.push({
        entityCode: input.entityCode,
        cfCode,
        category,
        activityType,
        entryType,
        year: effectiveYear,
        month,
        amount,
        currencyCode: "AZN",
        description: label,
        source: DYNAMIC_CF_SOURCE_TAG,
        sourceId,
      })

      const key = buildReconKey(DYNAMIC_CF_SOURCE_TAG, sourceId, period)
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

  const periodScope = [...monthCols.keys()]
    .sort((a, b) => a - b)
    .map((m) => `${effectiveYear}-${String(m + 1).padStart(2, "0")}`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra = rows.length > 0 ? { expectedSums } : ({} as any)

  return {
    summary: `${rows.length} dynamic CF entries for ${input.entityCode} (conf=${proposal.overallConfidence.toFixed(2)}, sheet="${input.sheetName}")`,
    itemCount: rows.length,
    warnings: baseWarnings,
    ...extra,
    applyToDb: async (tx: Prisma.TransactionClient) => {
      if (rows.length === 0) return { rowsInserted: 0 }
      // Phase 2.1 session 1 — resolve CoA FK for every unique cfCode.
      const coaCache = createCoACache()
      const accountIdByCfCode = new Map<string, string>()
      for (const r of rows) {
        if (accountIdByCfCode.has(r.cfCode)) continue
        const id = await resolveOrCreateAccountId(tx, coaCache, {
          organizationId: input.organizationId,
          code: r.cfCode,
          defaultName: r.description,
          defaultAccountType: r.entryType === "inflow" ? "revenue" : "expense",
        })
        accountIdByCfCode.set(r.cfCode, id)
      }
      const resolvedRows = rows.map((r) => ({
        ...r,
        accountId: accountIdByCfCode.get(r.cfCode) ?? null,
      }))
      const result = await runCashFlowBatch(tx, {
        organizationId: input.organizationId,
        label: `Dynamic CF ${input.entityCode} ${effectiveYear}`,
        actorUserId: "ai-dynamic-import",
        sourceDocument: `dynamic-detect:${input.sheetName}`,
        sourceTag: DYNAMIC_CF_SOURCE_TAG,
        periodScope,
        rows: resolvedRows,
        expectedSums,
      })
      return { rowsInserted: result.metrics.rowsInserted }
    },
  }
}
