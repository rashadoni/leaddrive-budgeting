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
import { runMultiFileImport } from "@/lib/onboarding/ai-import/multi-file-orchestrator"
import {
  REPORTING_PACK_SHEET_MAP,
  looksLikeReportingPack,
} from "@/lib/onboarding/ai-import/reporting-pack-sheet-map"
import type { SheetMap } from "@/lib/onboarding/ai-import/sheet-routing"
import {
  affectedIndicatorsForDataType,
  type DataTypeImpact,
} from "@/lib/onboarding/ai-import/datatype-indicator-map"
import { prisma } from "@/lib/prisma"

export const maxDuration = 120

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

  const yearStr = (form.get("year") as string | null) ?? String(new Date().getFullYear())
  const year = Number(yearStr) || new Date().getFullYear()
  if (!Number.isInteger(year) || year < 2020 || year > 2050) {
    return NextResponse.json(
      { ok: false, error: "Field 'year' must be an integer 2020-2050" },
      { status: 400 },
    )
  }
  const applyVal = String(form.get("apply") ?? "").toLowerCase()
  const shouldApply = applyVal === "1" || applyVal === "true"
  const forceOverride =
    String(form.get("forceOverride") ?? "").toLowerCase() === "1" ||
    String(form.get("forceOverride") ?? "").toLowerCase() === "true"
  const allowYellow =
    String(form.get("allowYellow") ?? "").toLowerCase() === "1" ||
    String(form.get("allowYellow") ?? "").toLowerCase() === "true"

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

  // ── Cost-budget gate ────────────────────────────────────────────
  // Each file uses ~35K tokens (input + output). Pre-check before
  // burning any spend.
  const estTokens = fileEntries.length * PER_FILE_TOKEN_BUDGET
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

  // ── Parse all workbooks before LLM call ─────────────────────────
  // If any xlsx is malformed, fail fast with 400 — no LLM cost burned.
  const files: Array<{
    filename: string
    workbook: XLSX.WorkBook
    sheetMap?: SheetMap
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

  // ── Run the orchestrator ────────────────────────────────────────
  let result
  try {
    result = await runMultiFileImport(
      {
        files,
        organizationId: orgId,
        year,
        knownEntityCodes,
        orgIndustry,
        holdingCompanyCode,
        allowYellow,
        forceOverride,
        conflictResolutions,
        // Apply only when caller asked explicitly. Default: preview-only
        // (dryRun=true) — matches the 2-step UX shipped in Tier 4.
        dryRun: !shouldApply,
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
    // Broad catch (AI classify + DB apply). Never return the raw provider
    // message (can carry billing text); log it server-side and surface a
    // generic admin message + a stable code (AI class when recognized).
    const raw = err instanceof Error ? err.message : String(err)
    log.error("multi-file import failed", { err: raw })
    return NextResponse.json(
      {
        ok: false,
        error: "Multi-file import failed. Check the server logs for details.",
        code: classifyAiError(raw),
      },
      { status: 500 },
    )
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

  // ── Normal path ─────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    mode: shouldApply ? ("applied" as const) : ("preview" as const),
    ...result,
    sheetImpactsByFilename: Object.fromEntries(sheetImpactsByFilename),
    backlogClosed,
    durationMs: Date.now() - t0,
  })
}
