/**
 * Phase 7.M Tier 5 (2026-05-20) — Multi-file AI Auto Import endpoint.
 *
 * Universal endpoint for uploading N (1-10) xlsx files at once. The
 * orchestrator (`runMultiFileImport`) handles per-file classification,
 * file-type detection, cross-file conflict gating, and group-atomic
 * commit.
 *
 * Contract
 * ────────
 *   POST /api/import/ai-auto-multi
 *   Content-Type: multipart/form-data
 *   Fields:
 *     files            — repeated xlsx blob (1-10 files)
 *     year             — target year (default current year)
 *     apply            — "1"/"true" to commit (default: dry-run preview)
 *     forceOverride    — "1" to ignore cross-file conflicts (USE WITH CAUTION)
 *     allowYellow      — "1" to commit even if a group is yellow
 *
 * Response (200):
 *   MultiFileImportResult shape (see multi-file-orchestrator.ts)
 *
 * Response (409):
 *   { ok: false, error: "Cross-file conflicts detected", conflicts: [...] }
 *
 * Response (429):
 *   { ok: false, error: "LLM budget exceeded" } or rate-limit
 *
 * Auth: admin role. Rate-limit: 3/hour/org (each request can use up to
 * 10 × 35K = 350K tokens, so heavier than single-file 6/hour).
 *
 * Cost guard: per-request estimate = N × 35K input. Pre-checked against
 * org budget; 429 if exceeded.
 */
import { NextRequest, NextResponse } from "next/server"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import { acquireImportLock } from "@/lib/onboarding/import-lock"
import {
  parseImportYears,
  worstVerdict,
  ImportYearsError,
} from "@/lib/onboarding/ai-import/import-years"
import { getActivePeriodLock } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:import:ai-auto-multi")
import { checkBudget, recordUsage } from "@/lib/llm/cost-budget"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { classifyAiError } from "@/lib/ai/ai-error"
import { buildProductionAdapterRegistry } from "@/lib/onboarding/ai-import/production-adapter-registry"
import {
  runMultiFileImport,
  type MultiFileImportInput,
  type MultiFileImportResult,
} from "@/lib/onboarding/ai-import/multi-file-orchestrator"
import {
  REPORTING_PACK_SHEET_MAP,
  REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES,
  looksLikeReportingPack,
} from "@/lib/onboarding/ai-import/reporting-pack-sheet-map"
import { applyBudgetPlfSplit } from "@/lib/onboarding/ai-import/consolidated-plf-split"
import {
  applyBuColumnSplit,
  inferStatementMeta,
} from "@/lib/onboarding/ai-import/bu-column-split"
import { extractWorkbookMeta } from "@/lib/onboarding/ai-import/sheet-meta-extractor"
import { buildWorkbookProfile } from "@/lib/onboarding/ai-import/workbook-profile"
import {
  findMatchingAiImportTemplate,
  markAiImportTemplateUsed,
} from "@/lib/onboarding/ai-import/import-template-memory"
import { buildEntityAliasMap } from "@/lib/onboarding/ai-import/entity-inference"
import { detectStaleSiblingRows } from "@/lib/onboarding/ai-import/stale-sibling-check"
import { detectProductSalesShape } from "@/lib/onboarding/ai-import/product-sales-parser"
import { logAuditEvent } from "@/lib/audit/log"
import { importConsolidatedHoldingBs } from "@/lib/onboarding/adapters/azseker-consolidated-bs-import"
import { detectWorkbookUnitScale } from "@/lib/onboarding/unit-scale"
import type { SheetMap, SheetMapEntry } from "@/lib/onboarding/ai-import/sheet-routing"
import type { SheetClassification } from "@/lib/onboarding/ai-import/sheet-classifier"
import {
  affectedIndicatorsForDataType,
  type DataTypeImpact,
} from "@/lib/onboarding/ai-import/datatype-indicator-map"
// rls-scan-ignore: admin-only multi-file AI Auto Import (maxDuration 300). It
// runs an Anthropic sheet-classifier over each file THEN commits a bulk
// multi-file, multi-entity import (runMultiFileImport — its own transactions +
// production handlers) + recompute + IFRS audit. Nested interactive
// transactions are disallowed and the LLM + apply can't fit one 5s tx. Every
// query is orgId-scoped in code; it runs on the BYPASSRLS `prismaAdmin` client.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"

// 300s (not 120) — a real 3-file AI import measured 119.2s end-to-end, i.e.
// 0.8s under the old ceiling. Multi-file batches legitimately run long; match
// the reporting-pack route precedent (also 300) so prod doesn't kill them.
export const maxDuration = 300

/** Hard caps protecting the LLM budget + dev server liveness. */
const MAX_FILES = 10
// Total SUM across all files in one batch — a memory/LLM-budget guard, NOT the
// per-file import cap (that's MAX_IMPORT_UPLOAD_BYTES, 64MB). Kept separate +
// lower on purpose: 10 files near the per-file cap would be ~640MB. Raised to
// 40 MB (2026-06-22): the multi-file flow IS the correct path for a
// comprehensive reporting pack (e.g. AzerSheker Reporting 2026 ≈ 25 MB) now that
// deterministic routing handles its budget/actual split + derived views.
const MAX_TOTAL_BYTES = 40 * 1024 * 1024 // 40 MB sum across all files
const PER_FILE_TOKEN_BUDGET = 35_000 // Phase 7.M Tier 4 measured cost

const RATE_LIMIT = {
  name: "import-ai-auto-multi",
  max: 10,
  windowMs: 60 * 60_000,
}

type GuidedSheetFixInput = {
  filename: string
  sheetName: string
  entityCode?: string
  planKind?: "actual" | "budget"
  role?: "source" | "derived_summary"
}

type SafetyReceiptStatus =
  | "blocked"
  | "preview_ready"
  | "applied_complete"
  /**
   * Phase 11.3 (2026-07-29) — writes committed, but at least one uploaded
   * file never reached the database (classification failed, file type
   * unknown, or a group did not commit). Previously these runs reported
   * `applied_complete` with `ok: true`: right after a reset that reads as
   * "your numbers imported fine" when they are simply missing.
   */
  | "applied_incomplete"
  | "applied_recompute_pending"
  | "applied_recompute_failed"
  | "applied_no_writes"

type SafetyReceipt = {
  mode: "preview" | "applied"
  status: SafetyReceiptStatus
  year: number
  rows: {
    toWrite: number
    committed: number
    toArchive: number | null
    archiveScopeCount: number
  }
  affectedCompanies: string[]
  affectedPlans: string[]
  sectionsDetected: Array<{ dataType: string; sheets: number }>
  skippedSheets: Array<{
    filename: string
    sheetName: string
    dataType: string
    reason: string
  }>
  archiveScopes: Array<{
    companyCode: string
    dataType: string
    planKind: "actual" | "budget" | "unknown"
  }>
  reconciliation: {
    verdict: MultiFileImportResult["overallVerdict"]
    conflicts: number
    /**
     * Phase 11.2 (2026-07-29) — what the verdict above is actually made of.
     * A verdict with `sheetsVerified: 0` is NOT proof of anything, and the
     * receipt has to say so: before this phase every verdict was a
     * parse-time self-compare (expected vs expected, green by construction)
     * that was being read as a database reconciliation.
     */
    evidence: {
      /** Sheets whose sums were re-queried from the DB after the write. */
      sheetsVerified: number
      /** Sheets that carry no reconcilable sums (settings JSON, zero rows). */
      sheetsUnverified: number
      unverifiedSheetNames: string[]
      /** True only when every committed group produced a DB re-read. */
      allCommittedGroupsVerified: boolean
    }
    groups: Array<{
      fileType: string
      verdict: string
      committed: boolean
      rows: number
      skipReason: string | null
      /** "db-readback" | "parse-self-check" | null (group never ran). */
      evidence: string | null
    }>
  }
  recompute: {
    status: "not_run" | "ok" | "pending" | "failed"
    predictedTargets: number
    targets: number
    ok: number
    unknown: number
    failed: number
  }
  links: {
    riskTerminal: string
    indicatorHealth: string
    rollback: string
  }
}

const PLAN_SCOPE_DATATYPES = new Set(["PLF", "BS", "CF"])

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
}

function effectiveEntityCode(classification: SheetClassification): string | null {
  return classification.entityCodeOverride ?? classification.entityCode ?? null
}

function effectivePlanKind(
  classification: SheetClassification,
): "actual" | "budget" | "unknown" {
  return classification.planKind === "actual" ||
    classification.planKind === "budget"
    ? classification.planKind
    : "unknown"
}

function buildSafetyReceipt(
  result: MultiFileImportResult,
  opts: { shouldApply: boolean; year: number },
): SafetyReceipt {
  const classifications = result.perFile.flatMap((file) =>
    file.classifications.map((classification) => ({
      filename: file.filename,
      classification,
    })),
  )
  const committedRows = result.perGroup.reduce(
    (sum, group) => sum + (group.committed ? group.totalRowsInserted : 0),
    0,
  )
  const sectionCounts = new Map<string, number>()
  for (const { classification } of classifications) {
    sectionCounts.set(
      classification.dataType,
      (sectionCounts.get(classification.dataType) ?? 0) + 1,
    )
  }

  const archiveScopeMap = new Map<
    string,
    { companyCode: string; dataType: string; planKind: "actual" | "budget" | "unknown" }
  >()
  for (const { classification } of classifications) {
    if (!PLAN_SCOPE_DATATYPES.has(classification.dataType)) continue
    if (classification.role === "derived_summary") continue
    const companyCode = effectiveEntityCode(classification)
    if (!companyCode) continue
    const planKind = effectivePlanKind(classification)
    const key = `${companyCode}\u001f${classification.dataType}\u001f${planKind}`
    archiveScopeMap.set(key, {
      companyCode,
      dataType: classification.dataType,
      planKind,
    })
  }
  const archiveScopes = Array.from(archiveScopeMap.values()).sort((a, b) =>
    `${a.companyCode}:${a.dataType}:${a.planKind}`.localeCompare(
      `${b.companyCode}:${b.dataType}:${b.planKind}`,
    ),
  )
  const affectedCompanies = uniqueSorted(
    classifications
      .map(({ classification }) => effectiveEntityCode(classification))
      .filter((code): code is string => !!code),
  )
  const affectedPlans = uniqueSorted(
    classifications
      .map(({ classification }) => effectivePlanKind(classification))
      .filter((kind) => kind !== "unknown"),
  )
  const skippedSheets = classifications
    .filter(({ classification }) => classification.role === "derived_summary")
    .map(({ filename, classification }) => ({
      filename,
      sheetName: classification.sheetName,
      dataType: classification.dataType,
      reason:
        classification.roleSignal ??
        classification.reasoning ??
        "derived_summary",
    }))

  const committedGroups = result.perGroup.filter((g) => g.committed)
  const recomputeStatus: SafetyReceipt["recompute"]["status"] = !opts.shouldApply
    ? "not_run"
    : result.recompute.failed > 0
      ? "failed"
      : result.recompute.unknown > 0
        ? "pending"
        : result.recompute.targets > 0 &&
            result.recompute.ok === result.recompute.targets
          ? "ok"
          : "not_run"
  const status: SafetyReceiptStatus =
    result.conflicts.length > 0 || result.overallVerdict === "red"
      ? "blocked"
      : !opts.shouldApply
        ? "preview_ready"
        : committedRows === 0
          ? "applied_no_writes"
          : !result.completeness.complete
            ? "applied_incomplete"
            : recomputeStatus === "failed"
              ? "applied_recompute_failed"
              : recomputeStatus === "pending" || recomputeStatus === "not_run"
                ? "applied_recompute_pending"
                : "applied_complete"

  return {
    mode: opts.shouldApply ? "applied" : "preview",
    status,
    year: opts.year,
    rows: {
      toWrite: opts.shouldApply ? committedRows : result.parseMetrics.parsedItems,
      committed: committedRows,
      toArchive: null,
      archiveScopeCount: archiveScopes.length,
    },
    affectedCompanies,
    affectedPlans,
    sectionsDetected: Array.from(sectionCounts.entries())
      .map(([dataType, sheets]) => ({ dataType, sheets }))
      .sort((a, b) => a.dataType.localeCompare(b.dataType)),
    skippedSheets,
    archiveScopes,
    reconciliation: {
      verdict: result.overallVerdict,
      conflicts: result.conflicts.length,
      evidence: {
        sheetsVerified: committedGroups.reduce(
          (n, g) => n + (g.reconciliation?.perSheet.length ?? 0),
          0,
        ),
        sheetsUnverified: committedGroups.reduce(
          (n, g) => n + (g.reconciliation?.unverified?.length ?? 0),
          0,
        ),
        unverifiedSheetNames: committedGroups.flatMap((g) =>
          (g.reconciliation?.unverified ?? []).map((u) => u.sheetName),
        ),
        allCommittedGroupsVerified:
          committedGroups.length > 0 &&
          committedGroups.every(
            (g) =>
              g.reconciliation?.evidence === "db-readback" &&
              (g.reconciliation?.perSheet.length ?? 0) > 0,
          ),
      },
      groups: result.perGroup.map((group) => ({
        fileType: group.fileType,
        verdict: group.verdict,
        committed: group.committed,
        rows: group.totalRowsInserted,
        skipReason: group.skipReason,
        evidence: group.reconciliation?.evidence ?? null,
      })),
    },
    recompute: {
      status: recomputeStatus,
      predictedTargets:
        result.recompute.targets > 0
          ? result.recompute.targets
          : archiveScopes.length > 0
            ? uniqueSorted(archiveScopes.map((scope) => scope.companyCode)).length
            : affectedCompanies.length,
      targets: result.recompute.targets,
      ok: result.recompute.ok,
      unknown: result.recompute.unknown,
      failed: result.recompute.failed,
    },
    links: {
      riskTerminal: "/budgeting/terminal",
      indicatorHealth: "/budgeting/admin/indicator-health",
      rollback: "/budgeting/admin/ai-import#import-cleanup",
    },
  }
}

export async function POST(request: NextRequest) {
  const t0 = Date.now()

  // ── Auth ─────────────────────────────────────────────────────────
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    )
  }
  const orgId = session.orgId

  // ── Rate limit ──────────────────────────────────────────────────
  const rlError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rlError) return rlError

  // ── Parse form ──────────────────────────────────────────────────
  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Body must be multipart/form-data: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }

  const fileEntries = form.getAll("files").filter((v) => v instanceof Blob) as Blob[]
  if (fileEntries.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Provide at least one file via 'files' field" },
      { status: 400 },
    )
  }
  if (fileEntries.length > MAX_FILES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Max ${MAX_FILES} files per upload (got ${fileEntries.length})`,
      },
      { status: 400 },
    )
  }
  const totalBytes = fileEntries.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Total file size ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_TOTAL_BYTES / 1024 / 1024} MB cap`,
      },
      { status: 400 },
    )
  }

  // Phase 11.5 (2026-07-29) — default from the ORG's timezone, not the
  // server process clock. `new Date().getFullYear()` on a UTC host rolls the
  // default over ~4 hours before Baku does, so an import run in the first
  // hours of 1 January silently targeted the wrong year.
  //
  // 2026-07-30 — the target may be MORE THAN ONE year.
  //
  // A workbook routinely holds several (`actual-budget-v1.xlsx` carries
  // PLF Actual 2025 and 2026 side by side), and covering it used to mean
  // running the entire flow twice by hand. `years` / `yearFrom`+`yearTo`
  // express the whole target; plain `year` still works and simply yields a
  // one-element list, so there is ONE code path, not two that can drift.
  let importYears: number[]
  try {
    importYears = parseImportYears({
      years: form.get("years") as string | null,
      yearFrom: form.get("yearFrom") as string | null,
      yearTo: form.get("yearTo") as string | null,
      year: form.get("year") as string | null,
      fallbackYear: currentBakuYearNumber(),
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof ImportYearsError
            ? err.message
            : "Invalid import year selection",
      },
      { status: 400 },
    )
  }
  // Kept for every downstream reference that is genuinely single-year
  // (lock scope, runId, log lines). The loop below rebinds per iteration.
  const year = importYears[0]
  const applyVal = String(form.get("apply") ?? "").toLowerCase()
  const shouldApply = applyVal === "1" || applyVal === "true"
  const forceOverride =
    String(form.get("forceOverride") ?? "").toLowerCase() === "1" ||
    String(form.get("forceOverride") ?? "").toLowerCase() === "true"
  const allowYellow =
    String(form.get("allowYellow") ?? "").toLowerCase() === "1" ||
    String(form.get("allowYellow") ?? "").toLowerCase() === "true"
  const useTemplate =
    !["0", "false", "off"].includes(
      String(form.get("useTemplate") ?? "1").toLowerCase(),
    )
  let shouldUseTemplate = useTemplate

  // Phase 7.M Tier 6 — per-conflict resolution map. JSON:
  //   { "<conflict-key>": { "mode": "pick", "filename": "fileA.xlsx" } }
  // OR
  //   { "<conflict-key>": { "mode": "skip" } }
  // Apply path passes this to the orchestrator which uses it to rewrite
  // expected sums / drop cells before group commit. Unparseable JSON
  // rejects with 400 — better to fail loud than to silently fall back
  // to forceOverride.
  let conflictResolutions:
    | Record<string, { mode: "pick"; filename: string } | { mode: "skip" }>
    | undefined
  const rawResolutions = form.get("conflictResolutions")
  if (typeof rawResolutions === "string" && rawResolutions.length > 0) {
    try {
      const parsed = JSON.parse(rawResolutions)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        // Validate each entry shape — defence against malformed input.
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          const r = v as { mode?: string; filename?: string }
          if (r?.mode === "pick" && typeof r.filename === "string") continue
          if (r?.mode === "skip") continue
          return NextResponse.json(
            {
              ok: false,
              error: `conflictResolutions[${k}] must be {mode:"pick",filename:string} or {mode:"skip"}`,
            },
            { status: 400 },
          )
        }
        conflictResolutions = parsed as typeof conflictResolutions
      }
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid conflictResolutions JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      )
    }
  }
  let semanticCoaMappings: MultiFileImportInput["semanticCoaMappings"] | undefined
  const rawSemanticCoaMappings = form.get("semanticCoaMappings")
  if (
    typeof rawSemanticCoaMappings === "string" &&
    rawSemanticCoaMappings.length > 0
  ) {
    try {
      const parsed = JSON.parse(rawSemanticCoaMappings) as unknown
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { ok: false, error: "semanticCoaMappings must be an array" },
          { status: 400 },
        )
      }
      semanticCoaMappings = []
      for (const [index, value] of parsed.entries()) {
        const item = value as {
          filename?: unknown
          sheetName?: unknown
          sourceLabel?: unknown
          targetCode?: unknown
          confidence?: unknown
          action?: unknown
        }
        if (
          typeof item.filename !== "string" ||
          typeof item.sheetName !== "string" ||
          typeof item.sourceLabel !== "string" ||
          !(
            typeof item.targetCode === "string" ||
            item.targetCode === null
          )
        ) {
          return NextResponse.json(
            {
              ok: false,
              error: `semanticCoaMappings[${index}] must include filename, sheetName, sourceLabel, and targetCode|string|null`,
            },
            { status: 400 },
          )
        }
        const action =
          item.action === "skip" || item.targetCode === null ? "skip" : "map"
        semanticCoaMappings.push({
          filename: item.filename,
          sheetName: item.sheetName,
          sourceLabel: item.sourceLabel,
          targetCode: item.targetCode,
          confidence:
            typeof item.confidence === "number" &&
            Number.isFinite(item.confidence)
              ? Math.max(0, Math.min(1, item.confidence))
              : 1,
          action,
        })
      }
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid semanticCoaMappings JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      )
    }
  }

  let guidedSheetFixes: GuidedSheetFixInput[] | undefined
  const rawGuidedSheetFixes = form.get("guidedSheetFixes")
  if (
    typeof rawGuidedSheetFixes === "string" &&
    rawGuidedSheetFixes.length > 0
  ) {
    try {
      const parsed = JSON.parse(rawGuidedSheetFixes) as unknown
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { ok: false, error: "guidedSheetFixes must be an array" },
          { status: 400 },
        )
      }
      guidedSheetFixes = []
      for (const [index, value] of parsed.entries()) {
        const item = value as {
          filename?: unknown
          sheetName?: unknown
          entityCode?: unknown
          planKind?: unknown
          role?: unknown
        }
        if (
          typeof item.filename !== "string" ||
          typeof item.sheetName !== "string"
        ) {
          return NextResponse.json(
            {
              ok: false,
              error: `guidedSheetFixes[${index}] must include filename and sheetName`,
            },
            { status: 400 },
          )
        }
        const fix: GuidedSheetFixInput = {
          filename: item.filename,
          sheetName: item.sheetName,
        }
        if (typeof item.entityCode === "string" && item.entityCode.trim()) {
          fix.entityCode = item.entityCode.trim()
        }
        if (item.planKind === "actual" || item.planKind === "budget") {
          fix.planKind = item.planKind
        } else if (item.planKind !== undefined && item.planKind !== null) {
          return NextResponse.json(
            {
              ok: false,
              error: `guidedSheetFixes[${index}].planKind must be "actual" or "budget"`,
            },
            { status: 400 },
          )
        }
        if (item.role === "source" || item.role === "derived_summary") {
          fix.role = item.role
        } else if (item.role !== undefined && item.role !== null) {
          return NextResponse.json(
            {
              ok: false,
              error: `guidedSheetFixes[${index}].role must be "source" or "derived_summary"`,
            },
            { status: 400 },
          )
        }
        if (!fix.entityCode && !fix.planKind && !fix.role) continue
        guidedSheetFixes.push(fix)
      }
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid guidedSheetFixes JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      )
    }
  }
  if ((guidedSheetFixes?.length ?? 0) > 0) {
    shouldUseTemplate = false
  }

  // ── Parse all workbooks before LLM call ─────────────────────────
  // If any xlsx is malformed, fail fast with 400 — no LLM cost burned.
  const files: Array<{
    filename: string
    workbook: XLSX.WorkBook
    sheetMap?: SheetMap
    templateClassifications?: SheetClassification[]
    template?: {
      id: string
      name: string
      version: number
      structureHash: string
    }
  }> = []
  for (const blob of fileEntries) {
    const filename = blob instanceof File ? blob.name : "uploaded.xlsx"
    try {
      const buf = Buffer.from(await blob.arrayBuffer())
      const wb = XLSX.read(buf, {
        cellFormula: false,
        cellHTML: false,
        type: "buffer",
      })
      // Per-FILE sheet-map: detect the reporting-pack shape on THIS file's own
      // tabs (exact-name → no-op on any other workbook). Per-file so a sibling
      // file with a same-named tab isn't wrongly overridden (Codex P0).
      files.push({
        filename,
        workbook: wb,
        sheetMap: looksLikeReportingPack(wb.SheetNames)
          ? REPORTING_PACK_SHEET_MAP
          : undefined,
      })
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: `Invalid xlsx in '${filename}': ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      )
    }
  }

  // Per-file sheet-maps were assigned during parse (looksLikeReportingPack on
  // each file's own tabs). If ANY file is a reporting pack, its consolidated
  // budget tabs carry the holding sentinel → resolve the org's holding (level-1)
  // company. Require EXACTLY ONE level-1; 0 or >1 → leave unset so the sentinel
  // no-ops rather than routing the group's budget to an arbitrary sub-group.
  const anyReportingPack = files.some((f) => f.sheetMap !== undefined)
  const level1 = anyReportingPack
    ? await prisma.company.findMany({
        where: { organizationId: orgId, level: 1 },
        select: { code: true },
        take: 2,
      })
    : []
  const holdingCompanyCode = level1.length === 1 ? level1[0].code : undefined

  // ── Pre-split the consolidated "Budget PLF" into per-entity sheets ──────
  // The reporting-pack `Budget PLF` is 5 vertically-stacked per-entity blocks
  // (EDEN/AZSF/ProMalt/CPC + a holding VAT block). Splitting it into one virtual
  // sheet per entity BEFORE classification lets the existing one-sheet→one-entity
  // pipeline write each entity's budget correctly (and the holding its own block)
  // instead of stacking all 5 onto the holding — THE recurring "delete→import
  // wrong" bug (memory project_budget_plf_five_blocks). Mutates each pack file's
  // workbook + augments its sheet-map with deterministic per-block entries.
  const budgetPlfSplits: Array<{
    filename: string
    applied: boolean
    mapping: Array<{ sheetName: string; entityCode: string; revenueAnnual: number }>
    warnings: string[]
  }> = []
  for (const f of files) {
    if (!looksLikeReportingPack(f.workbook.SheetNames)) continue
    if (!f.workbook.SheetNames.includes("Budget PLF")) continue
    const split = applyBudgetPlfSplit(f.workbook, XLSX, {
      blockEntityCodes: REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES,
      holdingCompanyCode,
    })
    if (split.applied) {
      // Per-block source entries first (exact-name match on the virtual sheets),
      // then the base pack map for every other tab. The raw "Budget PLF" entry in
      // the base map is now derived_summary, so even a stray match is a safe skip.
      f.sheetMap = [...split.sheetMapEntries, ...REPORTING_PACK_SHEET_MAP]
    }
    budgetPlfSplits.push({
      filename: f.filename,
      applied: split.applied,
      mapping: split.mapping,
      warnings: split.warnings,
    })
  }

  // ── Context: known entity codes + org industry hint ─────────────
  const entities = await prisma.company.findMany({
    where: { organizationId: orgId, status: { not: "archived" } },
    select: { code: true, industry: true },
  })
  const knownEntityCodes = entities.map((e: { code: string }) => e.code)
  // Industry per entity used downstream to narrow the «affected
  // indicators» preview projection (so a KPI_FARMING sheet for a
  // food_processing entity doesn't list agro_crops-only indicators).
  const industryByCode = new Map<string, string | null>(
    entities.map((e: { code: string; industry: string | null }) => [
      e.code,
      e.industry,
    ]),
  )
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const orgIndustry =
    org?.settings && typeof org.settings === "object"
      ? ((org.settings as Record<string, unknown>).industry as string | undefined)
      : undefined
  // Per-org entity aliases (UPPERCASE alias → canonical code), e.g.
  // { "AZSF": "AZSEKER" } — lets the cell-scan resolve a statement whose owning
  // entity is written as an abbreviation in a data column the classifier never
  // sees. Stored under Organization.settings.entityAliases.
  const entityAliases =
    org?.settings && typeof org.settings === "object"
      ? ((org.settings as Record<string, unknown>).entityAliases as
          | Record<string, string>
          | undefined)
      : undefined

  // ── Pre-split consolidated multi-BU statements (2026-06-28) ─────────────
  // Some files ship per-entity P&L/BS/CF as ONE sheet with a "BU" (business-unit)
  // column self-labeling each row's owning entity, the entities stacked in
  // vertical blocks (e.g. "PLF Actual 2025" = CPC + holding + EDEN). The flat
  // cell-scan would collapse such a sheet onto its majority block; split each one
  // into a virtual per-entity sheet (entity read from the BU column) so the
  // existing per-entity write pipeline lands each block on its own company.
  // Reporting-pack files own their own split (`applyBudgetPlfSplit`), so skip them.
  const buColumnSplits: Array<{
    filename: string
    sheetName: string
    mapping: Array<{
      sheetName: string
      entityCode: string | null
      buValue: string
      rowCount: number
      action: "write" | "skip"
      reason?: "elimination" | "unknown_alias"
    }>
    warnings: string[]
  }> = []
  const buAliasMap = buildEntityAliasMap(knownEntityCodes, entityAliases ?? {})
  for (const f of files) {
    if (looksLikeReportingPack(f.workbook.SheetNames)) continue
    const entries: SheetMapEntry[] = []
    // Snapshot the names first — applyBuColumnSplit mutates workbook.SheetNames.
    for (const sheetName of [...f.workbook.SheetNames]) {
      const meta = inferStatementMeta(sheetName)
      if (!meta) continue
      const split = applyBuColumnSplit(f.workbook, XLSX, {
        sheetName,
        dataType: meta.dataType,
        planKind: meta.planKind,
        aliasMap: buAliasMap,
      })
      if (split.applied) {
        entries.push(...split.sheetMapEntries)
        buColumnSplits.push({
          filename: f.filename,
          sheetName,
          mapping: split.mapping,
          warnings: split.warnings,
        })
      }
    }
    if (entries.length > 0) f.sheetMap = [...entries, ...(f.sheetMap ?? [])]
  }

  // ── Pin product-sales sheets deterministically (2026-07-15) ────────────
  // Volume/price/revenue-per-product sheets are recognised by SHAPE, not by the
  // LLM: the classifier only ever sees ~12 truncated columns, so a 95-column
  // banner grid with mixed AZ/EN headers is not a routing problem it can win —
  // and a misroute sends product money to the wrong table. Entity + planKind
  // still come from the normal chain (alias map / classifier / guided fix +
  // the sheet-name keyword), so nothing here is org-specific.
  const productSalesSheets: Array<{ filename: string; sheetName: string; shape: string }> = []
  for (const f of files) {
    const entries: SheetMapEntry[] = []
    for (const sheetName of f.workbook.SheetNames) {
      const shape = detectProductSalesShape(f.workbook, sheetName, XLSX)
      if (!shape) continue
      entries.push({ match: sheetName, dataType: "SALES_PRODUCTS", role: "source" })
      productSalesSheets.push({ filename: f.filename, sheetName, shape })
    }
    if (entries.length > 0) f.sheetMap = [...entries, ...(f.sheetMap ?? [])]
  }

  if ((guidedSheetFixes?.length ?? 0) > 0) {
    const knownCodes = new Set(knownEntityCodes)
    const unmatched = new Set(
      guidedSheetFixes!.map((fix) => `${fix.filename}\u001f${fix.sheetName}`),
    )
    for (const f of files) {
      const entries: SheetMapEntry[] = []
      for (const fix of guidedSheetFixes ?? []) {
        if (fix.filename !== f.filename) continue
        if (!f.workbook.SheetNames.includes(fix.sheetName)) continue
        unmatched.delete(`${fix.filename}\u001f${fix.sheetName}`)
        if (fix.entityCode && !knownCodes.has(fix.entityCode)) {
          return NextResponse.json(
            {
              ok: false,
              error: `guidedSheetFixes target company not found: ${fix.entityCode}`,
            },
            { status: 400 },
          )
        }
        entries.push({
          match: fix.sheetName,
          ...(fix.planKind ? { planKind: fix.planKind } : {}),
          ...(fix.role ? { role: fix.role } : {}),
          ...(fix.entityCode ? { entityCode: fix.entityCode } : {}),
        })
      }
      if (entries.length > 0) f.sheetMap = [...entries, ...(f.sheetMap ?? [])]
    }
    if (unmatched.size > 0) {
      const first = [...unmatched][0].split("\u001f")
      return NextResponse.json(
        {
          ok: false,
          error: `guidedSheetFixes sheet not found: ${first[0]} / ${first[1]}`,
        },
        { status: 400 },
      )
    }
  }

  // ── Approved template fast path ─────────────────────────────────
  // Build the same deterministic workbook profile the orchestrator will expose,
  // but do it before the classifier so a saved GREEN template can replace the
  // LLM call. Matching happens after deterministic pre-splits because templates
  // must remember the actual virtual sheets that will be parsed/applied.
  let templateUsage: {
    requested: boolean
    matched: boolean
    template?: {
      id: string
      name: string
      version: number
      structureHash: string
      fileCount: number
    }
    skippedAiFiles: string[]
  } = {
    requested: shouldUseTemplate,
    matched: false,
    skippedAiFiles: [],
  }
  if (shouldUseTemplate) {
    const profiles = files.map((f) => {
      const metas = extractWorkbookMeta(f.workbook, XLSX, {
        sampleRows: 5,
        maxColumns: 15,
        profileRows: 80,
      })
      return buildWorkbookProfile(f.workbook, XLSX, {
        filename: f.filename,
        sheetMetas: metas,
        knownEntityCodes,
        entityAliases,
      })
    })
    const match = findMatchingAiImportTemplate(org?.settings, profiles)
    if (match) {
      for (const matchedFile of match.files) {
        const file = files[matchedFile.profileIndex]
        file.templateClassifications = matchedFile.classifications
        file.template = {
          id: match.template.id,
          name: match.template.name,
          version: match.template.version,
          structureHash: match.template.structureHash,
        }
      }
      templateUsage = {
        requested: true,
        matched: true,
        template: {
          id: match.template.id,
          name: match.template.name,
          version: match.template.version,
          structureHash: match.template.structureHash,
          fileCount: match.template.files.length,
        },
        skippedAiFiles: files.map((f) => f.filename),
      }
      await markAiImportTemplateUsed(prisma, orgId, match.template.id).catch((err) => {
        log.warn("ai-import template usage counter failed", {
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  // ── Cost-budget gate ────────────────────────────────────────────
  // Each classifier call uses ~35K tokens. Approved templates skip the
  // classifier, so budget only the files that still need AI.
  const filesNeedingAi = files.filter((f) => !f.templateClassifications)
  const estTokens = filesNeedingAi.length * PER_FILE_TOKEN_BUDGET
  if (estTokens > 0) {
    const budgetCheck = await checkBudget(orgId, undefined, estTokens)
    if (!budgetCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `LLM budget exceeded (${budgetCheck.reason}). Resets at ${budgetCheck.resetAt.toISOString()}`,
        },
        { status: 429 },
      )
    }
  }

  // ── Snapshot backlog BEFORE apply (for closed-items diff) ──────
  // Only when shouldApply — preview runs don't change DB so no diff.
  let backlogBefore: Awaited<
    ReturnType<typeof import("@/lib/risk/indicator-backlog").computeIndicatorBacklog>
  > | null = null
  if (shouldApply) {
    try {
      const { computeIndicatorBacklog } = await import(
        "@/lib/risk/indicator-backlog"
      )
      backlogBefore = await computeIndicatorBacklog(prisma, orgId, {
        period: String(year),
      })
    } catch (e) {
      log.warn("backlog before-snapshot failed", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // ── Period-lock gate (Phase 11.13) ──────────────────────────────
  // A signed, closed period must not be silently rewritten by an import.
  // Every interactive mutation route already gates on this
  // (assumptions / sales-budget / sales-forecast / cash-flow); the bulk
  // import path — by far the largest single mutation in the product — did
  // not, so a reset + re-import could overwrite a locked year while the
  // audit trail recorded only a routine import.
  if (shouldApply) {
    const lock = await getActivePeriodLock(prisma, orgId, String(year))
    if (lock) {
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId: session.userId ?? null,
        route: "POST /api/import/ai-auto-multi",
      })
    }
  }

  // ── Mutual exclusion (Phase 11.8) ───────────────────────────────
  // Only for APPLY. A preview writes nothing, so concurrent previews are
  // harmless and must not be refused. Every import batch is clean-slate
  // (archive-in-scope, then insert), so two concurrent applies of the same
  // scope interleave as: A archives N and inserts N, B archives 0 (A already
  // did) and inserts N — a full duplicate set. `assertNoCollateralDeletion`
  // cannot see it (it fires on over-deletion; B under-deleted) and no target
  // table has a unique constraint that would reject the second copy.
  // 2026-07-30 — ONE pipeline run per requested year, in ascending order.
  //
  // The loop lives here, not inside the orchestrator, because `year` is what
  // resolves the plan, bounds the clean-slate window and drives every
  // adapter's `preferYear`. Pushing a list down there would put a cross-year
  // loop inside the very transaction boundary the reset scope depends on.
  // Each year therefore takes its OWN advisory lock — the lock is scoped
  // (org, year), so a concurrent import of a DIFFERENT year is still allowed,
  // exactly as before.
  //
  // Sequential on purpose: two years of the same holding touch the same
  // companies and the same recompute targets, and running them in parallel
  // would race the clean-slate of one against the insert of the other.
  const perYear: Array<{
    year: number
    verdict: "green" | "yellow" | "red"
    rowsInserted: number
    committedGroups: number
    warnings: number
  }> = []
  let result: Awaited<ReturnType<typeof runMultiFileImport>> | null = null
  const aggregatedWarnings: string[] = []
  const aggregatedPerGroup: Awaited<
    ReturnType<typeof runMultiFileImport>
  >["perGroup"] = []
  let aggregatedLlmIn = 0
  let aggregatedLlmOut = 0

  for (const targetYear of importYears) {
    const importLock = shouldApply
      ? await acquireImportLock(orgId, targetYear)
      : null
    if (importLock && !importLock.acquired) {
      await importLock.release()
      return NextResponse.json(
        {
          ok: false,
          error:
            `Another import is already running for this organization and ${targetYear}. ` +
            "Wait for it to finish before starting a second one — running both " +
            "would duplicate every row they share.",
          code: "IMPORT_IN_PROGRESS",
          scope: importLock.scope,
        },
        { status: 409 },
      )
    }

    let yearResult
    try {
      yearResult = await runMultiFileImport(
        {
          files,
          organizationId: orgId,
          year: targetYear,
          knownEntityCodes,
          orgIndustry,
          holdingCompanyCode,
          entityAliases,
          allowYellow,
          forceOverride,
          conflictResolutions,
          semanticCoaMappings,
          dryRun: !shouldApply,
          ...(shouldApply
            ? {
                runId: `ai-multi:${orgId}:${targetYear}:${t0}`,
                actorUserId: session.userId ?? null,
              }
            : {}),
        },
        {
          prisma,
          anthropicClient: getAnthropicClient(),
          model: AI_MODEL,
          registry: buildProductionAdapterRegistry(prisma),
          XLSX,
        },
      )
    } catch (err) {
      await importLock?.release()
      const raw = err instanceof Error ? err.message : String(err)
      log.error("multi-file import failed", { err: raw, year: targetYear })
      return NextResponse.json(
        {
          ok: false,
          error: "Multi-file import failed. Check the server logs for details.",
          code: classifyAiError(raw),
          ...(importYears.length > 1 ? { failedYear: targetYear, perYear } : {}),
        },
        { status: 500 },
      )
    }

    // Released per year: every DB write for THIS year is done (the
    // orchestrator's recompute included), and holding it across the next
    // year's LLM call would block an unrelated import for minutes.
    await importLock?.release()

    aggregatedLlmIn += yearResult.llmUsage.inputTokens
    aggregatedLlmOut += yearResult.llmUsage.outputTokens
    // Prefix only when there is more than one year, so single-year output —
    // the overwhelmingly common case — reads exactly as it always has.
    aggregatedWarnings.push(
      ...(importYears.length > 1
        ? yearResult.warnings.map((w) => `[${targetYear}] ${w}`)
        : yearResult.warnings),
    )
    aggregatedPerGroup.push(...yearResult.perGroup)
    perYear.push({
      year: targetYear,
      verdict: yearResult.overallVerdict,
      rowsInserted: yearResult.perGroup.reduce(
        (n, g) => n + (g.totalRowsInserted ?? 0),
        0,
      ),
      committedGroups: yearResult.perGroup.filter((g) => g.committed).length,
      warnings: yearResult.warnings.length,
    })
    result = yearResult
  }

  if (!result) {
    // parseImportYears guarantees a non-empty list, so this is unreachable —
    // asserted rather than assumed, because a silent undefined here would
    // surface as an opaque crash in response assembly.
    return NextResponse.json(
      { ok: false, error: "No import year was processed" },
      { status: 500 },
    )
  }

  // The response carries the LAST year's per-file classification (identical
  // across years — same files, same sheets) but the UNION of everything the
  // run wrote, so nothing a later year did is hidden behind an earlier one.
  if (importYears.length > 1) {
    result = {
      ...result,
      perGroup: aggregatedPerGroup,
      warnings: aggregatedWarnings,
      overallVerdict: worstVerdict(perYear.map((y) => y.verdict)),
      llmUsage: {
        ...result.llmUsage,
        inputTokens: aggregatedLlmIn,
        outputTokens: aggregatedLlmOut,
      },
    }
  }

  // ── Record token spend (non-fatal) ──────────────────────────────
  if (result.llmUsage.inputTokens + result.llmUsage.outputTokens > 0) {
    await recordUsage(orgId, {
      inputTokens: result.llmUsage.inputTokens,
      outputTokens: result.llmUsage.outputTokens,
    }).catch(() => {
      /* non-fatal */
    })
  }

  // ── Consolidated holding balance sheet (2026-06-23) ──────────────
  // The reporting-pack `BS` tab is the client's OFFICIAL consolidated balance
  // sheet (in thousands). runMultiFileImport skips it (role=derived_summary)
  // because it isn't a per-entity statement; import it onto the holding here so
  // the holding shows the official ~253M instead of the naive cross-company sum.
  // Apply-only + unique holding; the importer's reconciliation guard throws if
  // the parse doesn't sum to the sheet's own subtotals, so a bad parse is
  // skipped non-fatally rather than writing a wrong number.
  // Gate on a COMMITTED import (Codex P1): runMultiFileImport can return a red
  // verdict or conflicts WITHOUT writing the main data (the route 409s / returns
  // the rejection below). The holding BS must not write on a rejected import —
  // require no conflicts AND that the financial (main-financial) group itself
  // committed rows.
  const consolidatedBsWarnings: string[] = []
  if (
    shouldApply &&
    holdingCompanyCode &&
    result.conflicts.length === 0 &&
    // the financial/reporting-pack group (which carries the consolidated BS tab)
    // must itself have COMMITTED — an unrelated group's rows don't count (Codex P1).
    result.perGroup.some(
      (g) => g.fileType === "main-financial" && g.committed && g.totalRowsInserted > 0,
    )
  ) {
    for (const f of files) {
      if (!looksLikeReportingPack(f.workbook.SheetNames)) continue
      const ws = f.workbook.Sheets["BS"]
      if (!ws) continue
      try {
        const rows = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: true,
          defval: null,
        }) as unknown[][]
        // Phase 11.37 — read the money unit off the workbook rather than
        // assuming ×1000. The declaration lives on a SIBLING sheet in this
        // pack (`CONS PL_1!A1` = "AZN thousand"), which is why the scan takes
        // the whole workbook and not just the BS tab.
        const unitScan = detectWorkbookUnitScale(
          f.workbook.SheetNames.map((name) => ({
            name,
            rows: XLSX.utils.sheet_to_json(f.workbook.Sheets[name]!, {
              header: 1,
              raw: true,
              blankrows: false,
            }) as unknown[][],
          })),
          ["BS"],
        )
        if (unitScan.conflict) {
          consolidatedBsWarnings.push(`${f.filename}: ${unitScan.conflict} — using the assumed factor`)
        }
        const res = await importConsolidatedHoldingBs(prisma, {
          worksheetRows: rows,
          organizationId: orgId,
          holdingCompanyCode,
          actorUserId: session.userId,
          detectedUnit: unitScan.scale,
        })
        consolidatedBsWarnings.push(...res.warnings)
        log.info("consolidated holding BS imported", {
          file: f.filename,
          warnings: res.warnings.length,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn("consolidated holding BS import skipped (non-fatal)", {
          file: f.filename,
          err: msg,
        })
        consolidatedBsWarnings.push(
          `${f.filename}: consolidated balance sheet skipped — ${msg}`,
        )
      }
    }
  }

  // ── Decorate response with per-sheet «affected indicators» preview ──
  // 2026-05-27 — extends each classification with the indicators its
  // dataType writes will feed (matched against indicator-seeds
  // requiredInputs). UI uses this to show "под какой индикатор попадает"
  // alongside the existing confidence + reasoning. Cap at 12 to keep
  // payload bounded — full list is recomputable client-side if needed.
  function buildSheetImpacts(
    classifications: ReadonlyArray<{
      sheetName: string
      dataType: string
      entityCode: string | null
      confidence: number
    }>,
  ): Array<
    {
      sheetName: string
      dataType: string
      entityCode: string | null
      confidence: number
      impact: DataTypeImpact
    }
  > {
    return classifications.map((c) => {
      const entityIndustry = c.entityCode
        ? industryByCode.get(c.entityCode) ?? null
        : null
      const impact = affectedIndicatorsForDataType(
        // SheetDataType union is a runtime-checked subset of strings; the
        // classifier validates before returning.
        c.dataType as Parameters<typeof affectedIndicatorsForDataType>[0],
        {
          industries: entityIndustry ? [entityIndustry] : undefined,
          limit: 12,
        },
      )
      return {
        sheetName: c.sheetName,
        dataType: c.dataType,
        entityCode: c.entityCode,
        confidence: c.confidence,
        impact,
      }
    })
  }
  const sheetImpactsByFilename = new Map<
    string,
    ReturnType<typeof buildSheetImpacts>
  >()
  for (const f of result.perFile) {
    sheetImpactsByFilename.set(f.filename, buildSheetImpacts(f.classifications))
  }
  const safetyReceipt = buildSafetyReceipt(result, { shouldApply, year })

  // ── Conflict short-circuit → 409 ────────────────────────────────
  // The orchestrator already returned early when conflicts were
  // detected (without opening any tx). Surface as 409 so the UI can
  // render the diff and the user can decide.
  // Phase 7.M Tier 6 — per-conflict resolutions also bypass the 409
  // gate (each provided resolution = explicit user decision). The
  // orchestrator validates that every conflict has a resolution before
  // committing, so an incomplete map still falls through to 409.
  const hasResolutions =
    !!conflictResolutions && Object.keys(conflictResolutions).length > 0
  if (
    result.conflicts.length > 0 &&
    !forceOverride &&
    !hasResolutions
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Cross-file conflicts detected",
        ...result,
        sheetImpactsByFilename: Object.fromEntries(sheetImpactsByFilename),
        safetyReceipt,
        templateUsage,
        durationMs: Date.now() - t0,
      },
      { status: 409 },
    )
  }

  // ── Indicator backlog diff (only when apply succeeded) ─────────
  // 2026-05-27 — after a successful apply, snapshot backlog again
  // and compare against the pre-apply snapshot. Surfaces «✅ Closed
  // N backlog items» in the import response so users see immediate
  // value from each upload + a deep-link to drill into what's still
  // missing.
  //
  // Best-effort — wrap in try/catch so backlog computation never
  // breaks the import response.
  let backlogClosed: Array<{ companyCode: string; indicatorCode: string }> = []
  if (shouldApply && backlogBefore) {
    try {
      const { computeIndicatorBacklog, diffBacklogs } = await import(
        "@/lib/risk/indicator-backlog"
      )
      const after = await computeIndicatorBacklog(prisma, orgId, {
        period: String(year),
      })
      backlogClosed = diffBacklogs(backlogBefore.companies, after.companies)
    } catch (e) {
      log.warn("backlog diff failed", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // ── Stale-sibling detection (2026-07-15) ────────────────────────
  // Rows an EARLIER import attributed to a company outside this import's
  // footprint stay LIVE in the same plan and double-count against the freshly
  // written per-entity rows (the "consolidated budget once stacked onto the
  // holding" class). Pure detection — see stale-sibling-check.ts. Best-effort,
  // apply-only: a detection failure must never break a committed import.
  if (shouldApply && result.perGroup.some((g) => g.committed)) {
    try {
      const staleWarnings = await detectStaleSiblingRows(prisma, {
        organizationId: orgId,
        year,
        classifications: result.perFile.flatMap((f) => f.classifications),
      })
      result.warnings.push(...staleWarnings)
    } catch (e) {
      log.warn("stale-sibling detection failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // ── Audit trail (2026-06-23) ────────────────────────────────────
  // The AI multi-import is the PRIMARY import path but historically wrote NO
  // audit_event (only the legacy staging route + resets did) — a hole in the
  // IFRS trail. Record one committed-import event per apply. Reuse the existing
  // `import_staging_apply` action with `multiEntity:true` (its documented reuse
  // shape) so no AuditAction enum migration is needed. Best-effort: a failed
  // audit write must never roll back a committed import.
  const committedGroups = result.perGroup.filter((g) => g.committed)
  const totalInserted = committedGroups.reduce(
    (s, g) => s + g.totalRowsInserted,
    0,
  )
  if (shouldApply && committedGroups.length > 0) {
    try {
      // companyId is required on the audit metadata — anchor to the holding when
      // resolved, else the first known entity (the trail is org-scoped anyway).
      const anchor = await prisma.company.findFirst({
        where: {
          organizationId: orgId,
          ...(holdingCompanyCode ? { code: holdingCompanyCode } : {}),
        },
        select: { id: true },
      })
      await logAuditEvent(prisma, {
        organizationId: orgId,
        actorUserId: session.userId,
        event: {
          action: "import_staging_apply",
          entityType: "ImportStaging",
          entityId: `ai-multi:${year}:${t0}`,
          metadata: {
            companyId: anchor?.id ?? "unknown",
            year,
            inserted: totalInserted,
            warnings: result.warnings.length,
            // Phase 11.13 — the audit row used to carry hardcoded
            // `deleted: 0` / `parentRollupsDropped: 0` /
            // `parentRollupsUnallocated: 0`, which read as measurements and
            // were not. Dropped rather than faked; the real per-group
            // evidence now lives in `import_batch_reports`, keyed by runId.
            evidenceRunId: `ai-multi:${orgId}:${year}:${t0}`,
            reconciliationEvidence: safetyReceipt.reconciliation.evidence
              .allCommittedGroupsVerified
              ? "db-readback"
              : "partial-or-unverified",
            complete: result.completeness.complete,
            recompute: result.recompute,
            multiSheet: true,
            sheetCount: result.perFile.reduce(
              (s, f) => s + f.classifications.length,
              0,
            ),
            successCount: committedGroups.length,
            failureCount: result.perGroup.length - committedGroups.length,
            multiEntity: true,
            entityCount: new Set(committedGroups.flatMap((g) => g.filenames))
              .size,
          },
        },
      })
    } catch (e) {
      log.warn("audit event for ai-multi import failed (non-fatal)", {
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // ── Normal path ─────────────────────────────────────────────────
  // Phase 11.3 — `ok` is the client's headline signal, so it must not stay
  // true when part of the upload never landed. An apply that dropped a file
  // (classification failure, unknown type, uncommitted group) answers 409
  // with the specifics in `result.completeness`, not 200/ok:true.
  const applyIncomplete = shouldApply && !result.completeness.complete
  return NextResponse.json({
    ok: !applyIncomplete,
    mode: shouldApply ? ("applied" as const) : ("preview" as const),
    ...result,
    sheetImpactsByFilename: Object.fromEntries(sheetImpactsByFilename),
    safetyReceipt,
    templateUsage,
    backlogClosed,
    consolidatedBsWarnings,
    // 2026-07-30 — per-year outcome. Always present (a single-year run is a
    // one-element list), so a client never has to branch on "did they use the
    // multi-year form?" to find out what happened.
    importYears,
    perYear,
    budgetPlfSplits,
    buColumnSplits,
    productSalesSheets,
    durationMs: Date.now() - t0,
  }, applyIncomplete ? { status: 409 } : undefined)
}
