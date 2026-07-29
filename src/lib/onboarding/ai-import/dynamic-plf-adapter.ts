/**
 * Dynamic PLF adapter — fallback for unknown Excel layouts.
 *
 * When `parsePlfPlSheet()` (hard-coded AZSEKER adapter) returns 0 rows on a
 * non-empty sheet, `makePlfHandler` in `production-adapter-registry.ts`
 * delegates here.  This adapter:
 *
 *  1. Calls `extractMapperInput()` to get a compact sheet summary.
 *  2. Calls `getOrCreateProposal()` — one Claude call + 24h cache in
 *     `AIMapperProposalCache`.  Same-template re-uploads are free (cache hit).
 *  3. Uses `resolveColumns()` to find the code / label / month columns from
 *     the proposal's role strings (`amount:Jan2026`, `code`, `label`).
 *  4. Walks the sheet rows, extracts PLF leaf codes, normalises signs, builds
 *     `ImportBatchRow[]`, and returns an `AdapterRunResult` compatible with the
 *     orchestrator's apply pipeline.
 *
 * Cost:
 *   AZSEKER files      → $0  (hard-coded adapter handles them; dynamic never called)
 *   New format, first  → ~$0.05–0.10 one LLM call
 *   New format, next   → $0  (cache hit)
 */

import type { PrismaClient, Prisma } from "@prisma/client"
import {
  createCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"
import type {
  AdapterRunInput,
  AdapterRunResult,
  AdapterSemanticCoaCandidate,
  AdapterSemanticCoaMapping,
  AdapterSemanticCoaReviewItem,
} from "./adapter-registry"
import { extractMapperInput } from "../ai-mapper/extract"
import { getOrCreateProposal } from "../ai-mapper/proposal-cache"
import { resolveColumns, detectProposalYear } from "../ai-mapper/applier"
import type { ColumnMappingProposal } from "../ai-mapper/types"
import { runImportBatch, type ImportBatchRow } from "../import-batch"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import {
  findApprovedSemanticCoaDecision,
  isDerivedFinancialLabel,
  loadSemanticCoaAccounts,
  rankSemanticCoaCandidates,
  resolveSemanticCoaLabel,
} from "./semantic-coa-mapper"

// ─────────────────────────────────────────────────────────────────────────────
// PLF account-type helper (mirrors private function in azseker-plf.ts)
// ─────────────────────────────────────────────────────────────────────────────

type PlfAccountType = "revenue" | "cogs" | "expense"

/** Returns null for PLF.10.* (computed net-profit rows — skip them). */
function plfAccountTypeLocal(code: string): PlfAccountType | null {
  const m = code.match(/^PLF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  if (s === "01") return "revenue"
  if (s === "02") return "cogs"
  if (s === "10") return null // net profit — skip
  if (/^0[3-9]$/.test(s) || s === "12") return "expense"
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Header-band detection (identical heuristic to extract.ts + applier.ts)
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
    return r + 1 // data starts the row after the header
  }
  return DEFAULT_HEADER_END_ROW
}

// ─────────────────────────────────────────────────────────────────────────────
// PLF leaf code filter
// ─────────────────────────────────────────────────────────────────────────────

/** Matches leaf codes like PLF.05.01.01, PLF.12.01.R, PLF.03.04.AB */
const PLF_LEAF_RE =
  /^PLF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/

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

interface SemanticPlfColumns {
  codeCol: number
  labelCol: number
  monthCols: number[]
  semanticLabelFallback: boolean
}

function resolveColumnsWithSemanticFallback(
  columns: ColumnMappingProposal[],
): { ok: true; columns: SemanticPlfColumns } | { ok: false; reason: string } {
  const strict = resolveColumns(columns)
  if (strict.ok) {
    return {
      ok: true,
      columns: {
        codeCol: strict.columns.codeCol,
        labelCol: strict.columns.labelCol,
        monthCols: strict.columns.monthCols,
        semanticLabelFallback: false,
      },
    }
  }

  let labelCol = -1
  const monthCols = new Array<number>(12).fill(-1)
  for (const c of columns) {
    if (c.role === "label") {
      if (labelCol !== -1) return { ok: false, reason: `Multiple "label" columns` }
      labelCol = c.sourceIndex
    } else if (c.role.startsWith("amount:")) {
      const period = c.role.slice("amount:".length).toLowerCase()
      const monthToken = period.replace(/20\d{2}/g, "").trim()
      const monthIdx = MONTH_INDEX[monthToken]
      if (monthIdx !== undefined && monthCols[monthIdx] === -1) {
        monthCols[monthIdx] = c.sourceIndex
      }
    }
  }
  if (labelCol === -1) return { ok: false, reason: strict.reason }
  if (monthCols.some((col) => col === -1)) return { ok: false, reason: strict.reason }
  return {
    ok: true,
    columns: {
      codeCol: labelCol,
      labelCol,
      monthCols,
      semanticLabelFallback: true,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run dynamic structure detection + extraction for a PLF-classified sheet
 * whose format the hard-coded AZSEKER parser did not recognise.
 *
 * @param input      Standard adapter input (workbook, sheetName, XLSX, …).
 * @param planId     Budget-plan ID — resolved by the calling handler from OrgContext.
 * @param companyId  DB company row ID — resolved by the calling handler.
 * @param prisma     Used for existing CoA label/code matches before static fallback.
 */
export async function runDynamicPlfAdapter(
  input: AdapterRunInput,
  planId: string,
  companyId: string,
  prisma: PrismaClient,
): Promise<AdapterRunResult> {
  // ── Guard: cross-entity sheets have no entityCode ─────────────────────────
  if (!input.entityCode) {
    return {
      summary: `Dynamic PLF: sheet "${input.sheetName}" has no entityCode — skipped`,
      itemCount: 0,
      warnings: [
        `Sheet "${input.sheetName}" dynamic detection skipped: no entityCode`,
      ],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 1. Extract compact sheet metadata ─────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapperInputResult = extractMapperInput(
    // Phase 8 D3(w) (2026-05-28) — AdapterRunInput.workbook is
    // already typed XLSXType.WorkBook; no cast needed.
    input.workbook,
    input.sheetName,
    input.XLSX,
    { companyName: input.entityCode },
  )
  if ("error" in mapperInputResult) {
    return {
      summary: `Dynamic PLF: extraction error — ${mapperInputResult.error}`,
      itemCount: 0,
      warnings: [`Dynamic detection failed: ${mapperInputResult.error}`],
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }
  const mapperInput = mapperInputResult

  // ── Short cache-key hint for logs / warnings ───────────────────────────────
  // (the full cache key is computed inside getOrCreateProposal)
  const cacheKeyHint = `${input.organizationId.slice(0, 8)}:${input.sheetName}`

  // ── 2. LLM call + 24h cache via AIMapperProposalCache ─────────────────────
  let proposalResult: Awaited<ReturnType<typeof getOrCreateProposal>>
  try {
    proposalResult = await getOrCreateProposal(mapperInput, {
      orgId: input.organizationId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      summary: `Dynamic PLF: LLM error — ${msg}`,
      itemCount: 0,
      warnings: [
        `Dynamic detection LLM error (hint: ${cacheKeyHint}): ${msg}`,
        "Sheet not imported — upload again once API is available.",
      ],
      // Phase 11.3 — a hard failure, NOT an empty sheet. Without this the
      // zero-row return passed the orchestrator's success filter and
      // committed green with no data.
      blocked: { reason: `dynamic PLF detection failed (LLM error): ${msg}` },
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }
  const { proposal, cacheHit } = proposalResult

  // ── 3. Confidence gate ────────────────────────────────────────────────────
  if (proposal.overallConfidence < 0.5) {
    return {
      summary: `Dynamic PLF: low confidence ${proposal.overallConfidence.toFixed(2)} — skipped`,
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
        reason: `dynamic PLF detection confidence ${proposal.overallConfidence.toFixed(2)} < 0.50 — refusing to guess the layout`,
      },
      applyToDb: async () => ({ rowsInserted: 0 }),
    }
  }

  // ── 4. Resolve column positions from proposal roles ───────────────────────
  const colsResult = resolveColumnsWithSemanticFallback(proposal.columns)
  if (!colsResult.ok) {
    return {
      summary: `Dynamic PLF: column resolution failed — ${colsResult.reason}`,
      itemCount: 0,
      warnings: [
        `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
        cacheHit ? "(cache hit)" : "(cache miss — LLM called)",
        `Column mapping incomplete: ${colsResult.reason}`,
      ],
      // Phase 11.3 — a hard failure, NOT an empty sheet.
      blocked: {
        reason: `dynamic PLF column mapping incomplete: ${colsResult.reason}`,
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
      // The caller's planId/periodScope target `input.year`; adopting the
      // sheet's year writes another fiscal year's rows into this year's plan.
      // A workbook shipping one statement tab per year (e.g. "PLF Actual
      // 2025" + "PLF Actual 2026") is loaded by running the import once per
      // year — each run picks up exactly its own tabs.
      return {
        summary: `PLF sheet "${input.sheetName}" is for ${detectedYear}, not the requested ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic PLF: sheet "${input.sheetName}" carries ${detectedYear} data but the import year is ${input.year} — skipped. Re-run the import with year=${detectedYear} to load it.`,
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
        summary: `PLF sheet "${input.sheetName}" covers ${detectedYear.conflict.join("/")}, not the requested ${input.year} — skipped`,
        itemCount: 0,
        warnings: [
          `Dynamic PLF: sheet "${input.sheetName}" carries ${detectedYear.conflict.join("/")} data but the import year is ${input.year} — skipped. Re-run the import with the matching year to load it.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    yearWarnings.push(
      `Dynamic detection: multiple years in proposal (${detectedYear.conflict.join(", ")}) — defaulting to input.year=${input.year}`,
    )
  }
  // null → no year in roles → keep input.year

  // ── 6. Build AOA from the sheet ───────────────────────────────────────────
  const sheet = input.workbook.Sheets[input.sheetName]
  const aoa = (input.XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
  }) as Array<Array<string | number | null>>)

  const headerEndRow = detectHeaderEndRow(aoa)

  // ── 7. Build account-type override map from proposal ─────────────────────
  const acctOverrides = new Map<string, PlfAccountType>()
  for (const o of proposal.accountTypeOverrides ?? []) {
    if (
      o.accountType === "revenue" ||
      o.accountType === "cogs" ||
      o.accountType === "expense"
    ) {
      acctOverrides.set(o.code, o.accountType as PlfAccountType)
    }
  }

  // ── 8. Extract rows ───────────────────────────────────────────────────────
  const rows: ImportBatchRow[] = []
  const expectedSums = new Map<ReconciliationKey, number>()
  const lineLabelByCode = new Map<string, string>()
  const semanticAccounts = await loadSemanticCoaAccounts(
    prisma,
    input.organizationId,
    "PLF",
  )
  const semanticMatches: string[] = []
  const semanticReview: string[] = []
  const semanticCoaMappings: AdapterSemanticCoaMapping[] = []
  const semanticCoaReviewItems: AdapterSemanticCoaReviewItem[] = []
  const semanticMappedLabels = new Set<string>()
  const semanticReviewLabels = new Set<string>()

  const periodScope: string[] = Array.from({ length: 12 }, (_, m) =>
    `${effectiveYear}-${String(m + 1).padStart(2, "0")}`,
  )

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
    if (!PLF_LEAF_RE.test(code)) {
      if (!semanticLabelFallback && /^PLF\./i.test(code)) continue
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
        if (PLF_LEAF_RE.test(approved.targetCode)) {
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
              `Dynamic PLF semantic CoA review needed: "${label}" has invalid approved PLF code "${approved.targetCode}"`,
            )
            semanticCoaReviewItems.push({
              dataType: "PLF",
              sourceLabel: label,
              reason: `Approved code "${approved.targetCode}" is not a valid P&L leaf code`,
              candidates: toSemanticCoaCandidates(
                rankSemanticCoaCandidates({
                  dataType: "PLF",
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
          dataType: "PLF",
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
              `Dynamic PLF semantic CoA review needed: "${label}" did not confidently map to a P&L code`,
            )
            semanticCoaReviewItems.push({
              dataType: "PLF",
              sourceLabel: label,
              reason: "No high-confidence P&L code match",
              candidates: toSemanticCoaCandidates(
                rankSemanticCoaCandidates({
                  dataType: "PLF",
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
            `Dynamic PLF semantic CoA: "${label}" -> ${semantic.code} (${Math.round(
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
    if (label) lineLabelByCode.set(code, label)

    // Determine account type — inline rule first, LLM override as fallback
    let accountType = plfAccountTypeLocal(code)
    if (!accountType) {
      accountType = acctOverrides.get(code) ?? null
    }
    if (!accountType) continue // net-profit or unrecognised prefix — skip

    // Sign convention: COGS and expense values are stored as positive in DB.
    // The Excel may store them as negative — negate so they become positive.
    // If they're ALREADY positive (e.g. reversal rows), negation makes them
    // negative, which correctly reduces the annual total (same as azseker-plf.ts).
    const normalizeSign = accountType === "cogs" || accountType === "expense"
    const categoryCode = `${input.entityCode}-${code}`

    for (let m = 0; m < 12; m++) {
      const cellVal = row[monthCols[m]]
      const raw =
        typeof cellVal === "number"
          ? cellVal
          : typeof cellVal === "string" && cellVal.trim() !== ""
            ? Number(cellVal.replace(",", "."))
            : null

      if (raw === null || !Number.isFinite(raw) || raw === 0) continue

      const amount = normalizeSign ? -raw : raw
      const period = periodScope[m]

      rows.push({
        companyId,
        category: categoryCode,
        lineType: accountType,
        period,
        monthIndex: m,
        plannedAmount: amount,
        currencyCode: "AZN",
        exchangeRate: null,
        planId,
        // accountId resolved inside applyToDb via resolveOrCreateAccountId
        // Placeholder — overwritten in applyToDb resolution map.
        accountId: "",
        sourceCell: `dynamic-detect#${input.sheetName}!${code}@${period}`,
      })

      const key = buildReconKey(
        input.entityCode!,
        categoryCode,
        period,
      )
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
    }
  }

  // ── 9. Assemble result ────────────────────────────────────────────────────
  const baseWarnings = [
    `Dynamic detection used, cache key hint: ${cacheKeyHint}`,
    cacheHit ? "(cache hit — no LLM cost)" : "(cache miss — LLM called)",
    ...(semanticLabelFallback
      ? ["No code column detected — semantic CoA mapper used labels as account keys"]
      : []),
    ...semanticMatches,
    ...semanticReview,
    ...(proposal.overallConfidence < 0.7
      ? [
          `Confidence ${proposal.overallConfidence.toFixed(2)} < 0.70 — review imported rows`,
        ]
      : []),
    ...yearWarnings,
  ]

  // Expose expectedSums for orchestrator cross-file conflict detection
  // (same pattern as hard-coded PLF handler — not on public AdapterRunResult type).
  const extra: { expectedSums?: Map<ReconciliationKey, number> } =
    rows.length > 0 ? { expectedSums } : {}

  return {
    summary: `${rows.length} dynamic PLF rows for ${input.entityCode} (conf=${proposal.overallConfidence.toFixed(2)}, sheet="${input.sheetName}")`,
    itemCount: rows.length,
    warnings: baseWarnings,
    semanticCoa: {
      mappings: semanticCoaMappings,
      reviewItems: semanticCoaReviewItems,
    },
    ...extra,
    applyToDb: async (tx: Prisma.TransactionClient) => {
      if (rows.length === 0) return { rowsInserted: 0 }
      // Phase 2.1 session 1 — resolve every unique line.code to a real
      // CoA FK before insert. Auto-create with role='unknown' if the
      // CoA doesn't have a match yet (admin can reclassify via
      // /budgeting/admin/chart-of-accounts).
      const coaCache = createCoACache()
      const entityCode = input.entityCode ?? ""
      const accountIdByLineCode = new Map<string, string>()
      // Walk rows to collect unique line codes (recovered from the
      // entity-prefixed category string).
      const seenCodes = new Set<string>()
      for (const r of rows) {
        const lineCode = r.category.startsWith(`${entityCode}-`)
          ? r.category.slice(entityCode.length + 1)
          : r.category
        if (seenCodes.has(lineCode)) continue
        seenCodes.add(lineCode)
        const id = await resolveOrCreateAccountId(tx, coaCache, {
          organizationId: input.organizationId,
          code: lineCode,
          defaultName: lineLabelByCode.get(lineCode) ?? lineCode,
          defaultAccountType: r.lineType,
        })
        accountIdByLineCode.set(lineCode, id)
      }
      const resolvedRows = rows.map((r) => {
        const lineCode = r.category.startsWith(`${entityCode}-`)
          ? r.category.slice(entityCode.length + 1)
          : r.category
        const accountId = accountIdByLineCode.get(lineCode)
        if (!accountId) {
          throw new Error(
            `[dynamic-plf] accountId not resolved for lineCode="${lineCode}"`,
          )
        }
        return { ...r, accountId }
      })
      const result = await runImportBatch(tx, {
        organizationId: input.organizationId,
        label: `Dynamic P&L ${input.entityCode} ${effectiveYear}`,
        actorUserId: "ai-dynamic-import",
        sourceDocument: `dynamic-detect:${input.sheetName}`,
        companyIds: [companyId],
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
