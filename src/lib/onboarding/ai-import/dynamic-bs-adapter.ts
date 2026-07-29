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
import { numericCellValue } from "../numeric-cell"
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
import { runBalanceSheetBatch, type BsImportRow } from "../bs-import-batch"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import type { ColumnMappingProposal } from "../ai-mapper/types"
import {
  createCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"
import {
  findApprovedSemanticCoaDecision,
  isDerivedFinancialLabel,
  loadSemanticCoaAccounts,
  rankSemanticCoaCandidates,
  resolveSemanticCoaLabel,
} from "./semantic-coa-mapper"

// ─────────────────────────────────────────────────────────────────────────────
// BS account classification (mirrors classifyBsLineType in azseker-workbook-bs.ts)
// ─────────────────────────────────────────────────────────────────────────────

type BsLineType = "asset" | "liability" | "equity"
type BsSubType = "non_current" | "current" | "long_term" | "short_term" | null

interface BsClassification {
  lineType: BsLineType
  subType: BsSubType
}

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
  semanticLabelFallback: boolean
}

function resolveColumnsPartial(
  columns: ColumnMappingProposal[],
  /** Phase 11.10 — target year. Roles that declare a DIFFERENT year are
   *  skipped; year-less roles remain eligible. */
  targetYear?: number,
): { ok: true; columns: PartialResolvedColumns } | { ok: false; reason: string } {
  let codeCol = -1
  let labelCol = -1
  const monthCols = new Map<number, number>()
  /** Phase 11.10 — years we saw but rejected, so the caller can tell
   *  "this sheet is for another year" (a legitimate skip) apart from
   *  "this sheet has no month columns at all" (a real failure). */
  const droppedYears = new Set<string>()

  for (const c of columns) {
    if (c.role === "code") {
      if (codeCol !== -1) return { ok: false, reason: `Multiple "code" columns` }
      codeCol = c.sourceIndex
    } else if (c.role === "label") {
      if (labelCol !== -1) return { ok: false, reason: `Multiple "label" columns` }
      labelCol = c.sourceIndex
    } else if (c.role.startsWith("amount:")) {
      const period = c.role.slice("amount:".length).toLowerCase()
      // Phase 11.10 (2026-07-29) — honour the year the role declares.
      //
      // This used to strip the year and take the FIRST column matching a
      // month index. On a two-year sheet (Jan-Dec 2025 + Jan-Dec 2026 — the
      // reporting-pack shape, and the mapper prompt itself instructs the LLM
      // to emit 24 such roles) the first 12 columns won regardless of the
      // requested year: the losing range was not merely mislabelled, its
      // numbers were written UNDER the requested year while the correct
      // range was discarded. Year-less roles stay eligible — plenty of
      // single-year sheets label columns "jan".."dec" with no year at all.
      const declaredYear = period.match(/20\d{2}/)?.[0]
      if (declaredYear && targetYear && Number(declaredYear) !== targetYear) {
        droppedYears.add(declaredYear)
        continue
      }
      const monthToken = period.replace(/20\d{2}/, "").trim()
      const monthIdx = MONTH_INDEX[monthToken]
      if (monthIdx !== undefined && !monthCols.has(monthIdx)) {
        monthCols.set(monthIdx, c.sourceIndex)
      }
    }
    // role === "skip" → ignored
  }

  if (labelCol === -1) return { ok: false, reason: 'No "label" column in proposal' }
  if (monthCols.size === 0) {
    // Distinguish the two zero-column outcomes: a sheet that belongs to
    // another year is skipped quietly (a workbook legitimately ships one
    // tab per year), while a sheet with no month columns at all is a real
    // mapping failure that blocks.
    if (droppedYears.size > 0) {
      return {
        ok: false,
        reason: `YEAR_MISMATCH:${[...droppedYears].sort().join(",")}`,
      }
    }
    return { ok: false, reason: "No month columns in proposal — sheet may be annual-only" }
  }

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
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run dynamic structure detection + extraction for a BS-classified sheet
 * whose format the hard-coded AZSEKER parser did not recognise.
 *
 * @param input      Standard adapter input (workbook, sheetName, XLSX, …).
 * @param planId     Budget-plan ID — resolved by the calling handler from OrgContext.
 * @param prisma     Used for existing CoA label/code matches before static fallback.
 * @param companyId  Phase 7.O — optional company scope for per-entity resolver
 *                   queries (inventory, equity ratios, etc.). Pass null when
 *                   entityCode cannot be resolved to a company DB row.
 */
export async function runDynamicBsAdapter(
  input: AdapterRunInput,
  planId: string,
  prisma: PrismaClient,
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
  // Phase 8 D3(w) (2026-05-28) — AdapterRunInput.workbook is
  // typed XLSXType.WorkBook; no cast needed.
  const mapperInputResult = extractMapperInput(
    input.workbook,
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
      // Phase 11.3 — a hard failure, NOT an empty sheet. Without this the
      // zero-row return passed the orchestrator's success filter and
      // committed green with no data.
      blocked: { reason: `dynamic BS detection failed (LLM error): ${msg}` },
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
      // Phase 11.3 — a hard failure, NOT an empty sheet. Without this the
      // zero-row return passed the orchestrator's success filter and
      // committed green with no data.
      blocked: {
        reason: `dynamic BS detection confidence ${proposal.overallConfidence.toFixed(2)} < 0.50 — refusing to guess the layout`,
      },
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 4. Resolve column positions (partial — BS may be mid-year) ────────────
  const colsResult = resolveColumnsPartial(proposal.columns, input.year)
  if (!colsResult.ok) {
    // Phase 11.10 — a sheet whose month columns all belong to ANOTHER year is
    // a legitimate skip (a workbook may ship one tab per year), not a mapping
    // failure. Skipping quietly keeps it out of the blocking gate.
    if (colsResult.reason.startsWith("YEAR_MISMATCH:")) {
      const otherYears = colsResult.reason.slice("YEAR_MISMATCH:".length)
      return {
        summary: `Dynamic BS: sheet "${input.sheetName}" carries ${otherYears} columns, not ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic BS: every month column on sheet "${input.sheetName}" belongs to ${otherYears}, but the import year is ${input.year} — skipped. Re-run the import with year=${otherYears.split(",")[0]} to load it.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    return {
      summary: `Dynamic BS: column resolution failed — ${colsResult.reason}`,
      itemCount: 0,
      warnings: [
        `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
        cacheHit ? "(cache hit)" : "(cache miss — LLM called)",
        `Column mapping incomplete: ${colsResult.reason}`,
      ],
      // Phase 11.3 — a hard failure, NOT an empty sheet.
      blocked: {
        reason: `dynamic BS column mapping incomplete: ${colsResult.reason}`,
      },
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
      // 2026-07-15 — a year mismatch must SKIP, not adopt the sheet's year.
      // The caller resolved planId/periodScope for `input.year`; writing
      // `detectedYear` rows through them lands another year's balances in
      // this year's plan (cross-year contamination) and its 0-row siblings
      // used to false-trip the (year-less) collision gate when a workbook
      // legitimately ships one BS tab per year. Mirrors the PLF adapter's
      // strict year filter: re-run the import with the sheet's own year.
      return {
        summary: `BS sheet "${input.sheetName}" is for ${detectedYear}, not the requested ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic BS: sheet "${input.sheetName}" carries ${detectedYear} data but the import year is ${input.year} — skipped. Re-run the import with year=${detectedYear} to load it.`,
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
      // 2026-07-15 — none of the sheet's years is the requested one (e.g. a
      // "BS 2025" tab with a 2024-12 opening column, imported with
      // year=2026). Defaulting to input.year would relabel a foreign year's
      // balances as this year's. Skip, same contract as the single-year
      // mismatch above.
      return {
        summary: `BS sheet "${input.sheetName}" covers ${detectedYear.conflict.join("/")}, not the requested ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic BS: sheet "${input.sheetName}" carries ${detectedYear.conflict.join("/")} data but the import year is ${input.year} — skipped. Re-run the import with the matching year to load it.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    yearWarnings.push(
      `Dynamic BS: multiple years in proposal (${detectedYear.conflict.join(", ")}) — defaulting to input.year=${input.year}`,
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
  const rows: BsImportRow[] = []
  const expectedSums = new Map<ReconciliationKey, number>()
  const lineLabelByCode = new Map<string, string>()
  const semanticAccounts = await loadSemanticCoaAccounts(
    prisma,
    input.organizationId,
    "BS",
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
    if (!BS_LEAF_RE.test(code)) {
      if (!semanticLabelFallback && /^BS\./i.test(code)) continue
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
        if (BS_LEAF_RE.test(approved.targetCode)) {
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
              `Dynamic BS semantic CoA review needed: "${label}" has invalid approved BS code "${approved.targetCode}"`,
            )
            semanticCoaReviewItems.push({
              dataType: "BS",
              sourceLabel: label,
              reason: `Approved code "${approved.targetCode}" is not a valid Balance Sheet leaf code`,
              candidates: toSemanticCoaCandidates(
                rankSemanticCoaCandidates({
                  dataType: "BS",
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
          dataType: "BS",
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
              `Dynamic BS semantic CoA review needed: "${label}" did not confidently map to a BS code`,
            )
            semanticCoaReviewItems.push({
              dataType: "BS",
              sourceLabel: label,
              reason: "No high-confidence Balance Sheet code match",
              candidates: toSemanticCoaCandidates(
                rankSemanticCoaCandidates({
                  dataType: "BS",
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
            `Dynamic BS semantic CoA: "${label}" -> ${semantic.code} (${Math.round(
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
    const classification = bsAccountTypeLocal(code)
    if (!classification) continue
    if (label) lineLabelByCode.set(code, label)

    // accountCode uses compound key: entityCode prefix + BS code
    const accountCode = `${input.entityCode}-${code}`

    for (const [monthIdx, colIdx] of monthCols) {
      const cellVal = row[colIdx]
      // Phase 11.31 — canonical parser. This used to do
      // `Number(cellVal.replace(",", "."))`, treating a comma as a DECIMAL
      // separator, while the named BS parser this is the fallback FOR stripped
      // commas as thousands grouping. Same cell, two answers, 10x apart.
      const raw = numericCellValue(cellVal)

      if (raw === null || !Number.isFinite(raw) || raw === 0) continue

      // BS snapshots are point-in-time — store as-is, no sign inversion
      const amount = raw
      const month = monthIdx + 1
      const period = `${effectiveYear}-${String(month).padStart(2, "0")}`

      rows.push({
        planId,
        companyId: companyId ?? null, // Phase 7.O — company scope for resolver queries
        accountCode,
        // Placeholder — overwritten in applyToDb resolution map.
        accountId: "",
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
    ...(semanticLabelFallback
      ? ["No code column detected — semantic CoA mapper used labels as account keys"]
      : []),
    ...semanticMatches,
    ...semanticReview,
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
  const extra: { expectedSums?: Map<ReconciliationKey, number> } =
    rows.length > 0 ? { expectedSums } : {}

  return {
    summary: `${rows.length} dynamic BS rows for ${input.entityCode} (conf=${proposal.overallConfidence.toFixed(2)}, sheet="${input.sheetName}")`,
    itemCount: rows.length,
    warnings: baseWarnings,
    semanticCoa: {
      mappings: semanticCoaMappings,
      reviewItems: semanticCoaReviewItems,
    },
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
          // Phase 2.1 session 3: BsImportRow no longer carries accountName
          // (dropped column); use accountCode as the default display name.
          defaultName: lineLabelByCode.get(lineCode) ?? r.accountCode,
          defaultAccountType: r.lineType,
        })
        accountIdByLineCode.set(lineCode, id)
      }
      const resolvedRows = rows.map((r) => {
        const lineCode = r.accountCode.startsWith(`${entityCode}-`)
          ? r.accountCode.slice(entityCode.length + 1)
          : r.accountCode
        const accountId = accountIdByLineCode.get(lineCode)
        if (!accountId) {
          throw new Error(
            `[dynamic-bs] accountId not resolved for lineCode="${lineCode}"`,
          )
        }
        return { ...r, accountId }
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
      return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
    },
  }
}
