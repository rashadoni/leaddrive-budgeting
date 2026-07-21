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
 *     top-level family (CF.01 / CF.02 / CF.03). CF.04-07 are preserved as
 *     non-movement `bridge` evidence in the same complete batch.
 *   • Entry type (inflow / outflow) from the CF.XX.01 / CF.XX.02 sub-segment;
 *     falls back to sign-of-sum when sub-segment is absent.
 *   • Month coverage is partial (same as BS — accepts whatever months mapped).
 *   • Calls `runCashFlowBatch` instead of `runImportBatch`.
 */

import type { PrismaClient, Prisma } from "@prisma/client"
import type {
  AdapterRunInput,
  AdapterRunResult,
  AdapterSemanticCoaCandidate,
  AdapterSemanticCoaMapping,
  AdapterSemanticCoaReviewItem,
} from "./adapter-registry"
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
import {
  classifyCashFlowCode,
  isCashFlowBridgeActivity,
  isCashFlowMovementActivity,
  selectLeafMostCashFlowBridgeCodes,
} from "../cf-bridge"
import {
  findApprovedSemanticCoaDecision,
  isDerivedFinancialLabel,
  loadSemanticCoaAccounts,
  rankSemanticCoaCandidates,
  resolveSemanticCoaLabel,
} from "./semantic-coa-mapper"

// ─────────────────────────────────────────────────────────────────────────────
// CF code classification helpers
// ─────────────────────────────────────────────────────────────────────────────

type CfEntryType = "inflow" | "outflow"

function toSemanticCoaCandidates(
  matches: ReturnType<typeof rankSemanticCoaCandidates>,
): AdapterSemanticCoaCandidate[] {
  return matches.map((match) => ({
    targetCode: match.code,
    accountType: match.accountType,
    confidence: match.confidence,
    source: match.source,
    matchedLabel: match.matchedLabel,
    reasoning: match.reasoning,
  }))
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

function isImportableCfCode(code: string): boolean {
  const classification = classifyCashFlowCode(code)
  return (
    classification !== null &&
    (classification.activityType === "bridge" || CF_LEAF_RE.test(code))
  )
}

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
  semanticLabelFallback: boolean
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

  if (labelCol === -1) return { ok: false, reason: 'No "label" column in proposal' }
  if (monthCols.size === 0) return { ok: false, reason: "No month columns in proposal" }

  return {
    ok: true,
    columns: {
      codeCol: codeCol === -1 ? labelCol : codeCol,
      labelCol,
      monthCols,
      semanticLabelFallback: codeCol === -1,
    },
  }
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
 * @param prisma     Used for existing CoA label/code matches before static fallback.
 */
export async function runDynamicCfAdapter(
  input: AdapterRunInput,
  prisma: PrismaClient,
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
  // Phase 8 D3(w) (2026-05-28) — AdapterRunInput.workbook is now typed
  // as `XLSXType.WorkBook` (see adapter-registry.ts D3(c) tightening),
  // so the `as any` cast bypassing extractMapperInput's signature
  // is no longer needed.
  const mapperInputResult = extractMapperInput(
    input.workbook,
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
  const { codeCol, labelCol, monthCols, semanticLabelFallback } =
    colsResult.columns

  // ── 5. Detect effective year ───────────────────────────────────────────────
  const detectedYear = detectProposalYear(proposal.columns)
  let effectiveYear = input.year
  const yearWarnings: string[] = []

  if (typeof detectedYear === "number") {
    if (detectedYear !== input.year) {
      // 2026-07-15 — a year mismatch must SKIP, not adopt the sheet's year
      // (caller's planId/periodScope target `input.year`; see the identical
      // guard in dynamic-plf-adapter.ts / dynamic-bs-adapter.ts).
      return {
        summary: `CF sheet "${input.sheetName}" is for ${detectedYear}, not the requested ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic CF: sheet "${input.sheetName}" carries ${detectedYear} data but the import year is ${input.year} — skipped. Re-run the import with year=${detectedYear} to load it.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    effectiveYear = detectedYear
  } else if (
    detectedYear !== null &&
    typeof detectedYear === "object" &&
    "conflict" in detectedYear
  ) {
    if (!detectedYear.conflict.includes(input.year)) {
      // 2026-07-15 — none of the sheet's years is the requested one; see the
      // single-year mismatch guard above (same contract, dynamic-bs-adapter).
      return {
        summary: `CF sheet "${input.sheetName}" covers ${detectedYear.conflict.join("/")}, not the requested ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic CF: sheet "${input.sheetName}" carries ${detectedYear.conflict.join("/")} data but the import year is ${input.year} — skipped. Re-run the import with the matching year to load it.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    yearWarnings.push(
      `Dynamic CF: multiple years in proposal (${detectedYear.conflict.join(", ")}) — defaulting to input.year=${input.year}`,
    )
  }

  // ── 6. Build AOA from the sheet ───────────────────────────────────────────
  const sheet = input.workbook.Sheets[input.sheetName]
  const aoa = input.XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<string | number | null>>

  const headerEndRow = detectHeaderEndRow(aoa)

  // ── 7. Extract rows ───────────────────────────────────────────────────────
  const rows: CfImportRow[] = []
  const expectedSums = new Map<ReconciliationKey, number>()
  const lineLabelByCode = new Map<string, string>()
  const semanticAccounts = await loadSemanticCoaAccounts(
    prisma,
    input.organizationId,
    "CF",
  )
  const semanticMatches: string[] = []
  const semanticReview: string[] = []
  const semanticCoaMappings: AdapterSemanticCoaMapping[] = []
  const semanticCoaReviewItems: AdapterSemanticCoaReviewItem[] = []
  const semanticMappedLabels = new Set<string>()
  const semanticReviewLabels = new Set<string>()

  for (let r = headerEndRow; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const codeRaw = row[codeCol]
    let code =
      typeof codeRaw === "string"
        ? codeRaw.trim()
        : typeof codeRaw === "number"
          ? String(codeRaw)
          : ""
    const labelRaw = row[labelCol]
    const label = typeof labelRaw === "string" ? labelRaw.trim() : code
    if (!code && label) code = label
    if (!code) continue
    if (!isImportableCfCode(code)) {
      if (!semanticLabelFallback && /^CF\./i.test(code)) continue
      const approved = findApprovedSemanticCoaDecision(
        label,
        input.semanticCoaMappings,
      )
      if (approved) {
        if (approved.action === "skip" || approved.targetCode === null) {
          if (!semanticMappedLabels.has(label)) {
            semanticMappedLabels.add(label)
            semanticCoaMappings.push({
              sourceLabel: label,
              targetCode: null,
              confidence: approved.confidence,
              action: "skip",
              source: "approved",
              reasoning: `Approved decision skipped "${label}"`,
            })
          }
          continue
        }
        if (isImportableCfCode(approved.targetCode)) {
          code = approved.targetCode
          if (!semanticMappedLabels.has(label)) {
            semanticMappedLabels.add(label)
            semanticCoaMappings.push({
              sourceLabel: label,
              targetCode: approved.targetCode,
              confidence: approved.confidence,
              action: "map",
              source: "approved",
              matchedLabel: label,
              reasoning: `Approved decision mapped "${label}" to ${approved.targetCode}`,
            })
          }
        } else {
          if (!semanticReviewLabels.has(label)) {
            semanticReviewLabels.add(label)
            semanticReview.push(
              `Dynamic CF semantic CoA review needed: "${label}" has invalid approved CF code "${approved.targetCode}"`,
            )
            semanticCoaReviewItems.push({
              dataType: "CF",
              sourceLabel: label,
              reason: `Approved code "${approved.targetCode}" is not a valid Cash Flow leaf code`,
              candidates: toSemanticCoaCandidates(
                rankSemanticCoaCandidates({
                  dataType: "CF",
                  label,
                  accounts: semanticAccounts,
                  minScore: 0.35,
                  limit: 4,
                }),
              ),
            })
          }
          continue
        }
      } else {
        const semantic = resolveSemanticCoaLabel({
          dataType: "CF",
          label,
          accounts: semanticAccounts,
        })
        if (!semantic) {
          if (
            label &&
            !isDerivedFinancialLabel(label) &&
            !semanticReviewLabels.has(label)
          ) {
            semanticReviewLabels.add(label)
            semanticReview.push(
              `Dynamic CF semantic CoA review needed: "${label}" did not confidently map to a CF code`,
            )
            semanticCoaReviewItems.push({
              dataType: "CF",
              sourceLabel: label,
              reason: "No high-confidence Cash Flow code match",
              candidates: toSemanticCoaCandidates(
                rankSemanticCoaCandidates({
                  dataType: "CF",
                  label,
                  accounts: semanticAccounts,
                  minScore: 0.35,
                  limit: 4,
                }),
              ),
            })
          }
          continue
        }
        code = semantic.code
        if (!semanticMappedLabels.has(label)) {
          semanticMappedLabels.add(label)
          semanticMatches.push(
            `Dynamic CF semantic CoA: "${label}" -> ${semantic.code} (${Math.round(
              semantic.confidence * 100,
            )}%, ${semantic.source})`,
          )
          semanticCoaMappings.push({
            sourceLabel: label,
            targetCode: semantic.code,
            confidence: semantic.confidence,
            action: "map",
            source: semantic.source,
            matchedLabel: semantic.matchedLabel,
            reasoning: semantic.reasoning,
          })
        }
      }
    }

    const classification = classifyCashFlowCode(code)
    if (!classification) continue
    const activityType = classification.activityType
    const isBridge = isCashFlowBridgeActivity(activityType)
    if (label) lineLabelByCode.set(code, label)

    // Pre-scan sum to determine inflow/outflow when sub-segment is absent
    let signHintSum = 0
    for (const [, colIdx] of monthCols) {
      const v = row[colIdx]
      if (typeof v === "number" && Number.isFinite(v)) signHintSum += v
    }
    const lineEntryType = cfEntryTypeLocal(code, signHintSum)

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

      if (raw === null || !Number.isFinite(raw)) continue
      // Explicit bridge zero is evidence. Ordinary movements remain sparse.
      if (raw === 0 && !isBridge) continue

      // CF convention: store absolute value; direction encoded in entryType
      const amount = Math.abs(raw)
      const entryType: CfEntryType = isBridge
        ? raw >= 0
          ? "inflow"
          : "outflow"
        : lineEntryType
      const month = monthIdx + 1
      const period = `${effectiveYear}-${String(month).padStart(2, "0")}`

      rows.push({
        entityCode: input.entityCode,
        cfCode,
        category,
        // Placeholder — overwritten in applyToDb resolution map.
        accountId: "",
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

  const bridgeCodesByPeriod = new Map<string, string[]>()
  for (const row of rows) {
    if (!isCashFlowBridgeActivity(row.activityType)) continue
    const periodKey = `${row.entityCode}\u0000${row.year}\u0000${row.month}`
    const codes = bridgeCodesByPeriod.get(periodKey)
    if (codes) codes.push(row.cfCode)
    else bridgeCodesByPeriod.set(periodKey, [row.cfCode])
  }
  const selectedBridgeCodesByPeriod = new Map<string, ReadonlySet<string>>()
  for (const [periodKey, codes] of bridgeCodesByPeriod) {
    selectedBridgeCodesByPeriod.set(
      periodKey,
      selectLeafMostCashFlowBridgeCodes(codes),
    )
  }
  const skippedBridgeCodes = new Set<string>()
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    const periodKey = `${row.entityCode}\u0000${row.year}\u0000${row.month}`
    if (
      isCashFlowBridgeActivity(row.activityType) &&
      !selectedBridgeCodesByPeriod.get(periodKey)?.has(row.cfCode)
    ) {
      skippedBridgeCodes.add(row.cfCode)
      rows.splice(index, 1)
    }
  }
  // Rebuild after leaf-most filtering so reconciliation cannot expect a
  // skipped ancestor subtotal that was deliberately not written.
  expectedSums.clear()
  for (const row of rows) {
    const period = `${row.year}-${String(row.month).padStart(2, "0")}`
    const key = buildReconKey(DYNAMIC_CF_SOURCE_TAG, row.sourceId, period)
    expectedSums.set(key, (expectedSums.get(key) ?? 0) + row.amount)
  }

  // ── 8. Assemble result ────────────────────────────────────────────────────
  const baseWarnings = [
    `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
    cacheHit ? "(cache hit — no LLM cost)" : "(cache miss — LLM called)",
    ...(semanticLabelFallback
      ? ["No code column detected — semantic CoA mapper used labels as account keys"]
      : []),
    ...semanticMatches,
    ...semanticReview,
    ...[...skippedBridgeCodes].map(
      (code) =>
        `Bridge subtotal ${code} skipped because a more specific descendant row is present`,
    ),
    ...(proposal.overallConfidence < 0.7
      ? [`Confidence ${proposal.overallConfidence.toFixed(2)} < 0.70 — review imported rows`]
      : []),
    ...yearWarnings,
  ]

  const hasBridgeRows = rows.some((row) =>
    isCashFlowBridgeActivity(row.activityType),
  )
  const hasMovementRows = rows.some((row) =>
    isCashFlowMovementActivity(row.activityType),
  )
  if (hasBridgeRows && !hasMovementRows) {
    return {
      summary: `Dynamic CF sheet "${input.sheetName}" contains bridge evidence without cash movements — blocked`,
      itemCount: 0,
      warnings: [
        ...baseWarnings,
        `CF.04–CF.07 cannot be applied as a bridge-only batch because the entity/year reset would archive the complete cash flow. Upload one complete CF sheet containing CF.01–CF.03 and bridge rows together.`,
      ],
      semanticCoa: {
        mappings: semanticCoaMappings,
        reviewItems: semanticCoaReviewItems,
      },
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  const periodScope = [...monthCols.keys()]
    .sort((a, b) => a - b)
    .map((m) => `${effectiveYear}-${String(m + 1).padStart(2, "0")}`)

  const extra: { expectedSums?: Map<ReconciliationKey, number> } =
    rows.length > 0 ? { expectedSums } : {}

  return {
    summary: `${rows.length} dynamic CF entries for ${input.entityCode} (conf=${proposal.overallConfidence.toFixed(2)}, sheet="${input.sheetName}")`,
    itemCount: rows.length,
    warnings: baseWarnings,
    semanticCoa: {
      mappings: semanticCoaMappings,
      reviewItems: semanticCoaReviewItems,
    },
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
          defaultName: lineLabelByCode.get(r.cfCode) ?? r.description,
          defaultAccountType: r.entryType === "inflow" ? "revenue" : "expense",
        })
        accountIdByCfCode.set(r.cfCode, id)
      }
      const resolvedRows = rows.map((r) => {
        const accountId = accountIdByCfCode.get(r.cfCode)
        if (!accountId) {
          throw new Error(
            `[dynamic-cf] accountId not resolved for cfCode="${r.cfCode}"`,
          )
        }
        return { ...r, accountId }
      })
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
