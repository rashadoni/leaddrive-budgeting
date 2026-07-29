/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Auto Import endpoint.
 *
 * Universal xlsx upload: AI classifies every sheet, returns a plan
 * (or applies if `apply=true`), with mandatory reconciliation.
 *
 * Contract
 * ────────
 *   POST /api/import/ai-auto
 *   Content-Type: multipart/form-data
 *   Fields:
 *     file        — xlsx blob (required)
 *     year        — target year (default: current year)
 *     apply       — "1"/"true" to commit to DB (default: classify-only preview)
 *
 * Response (200 JSON):
 *   {
 *     ok: true,
 *     mode: "preview" | "applied",
 *     totalSheets: number,
 *     classifications: [{ sheetName, dataType, entityCode, confidence, reasoning }],
 *     entitySheetMaps: [{ code, plSheet, bsSheet, cfSheet, ... }],
 *     llmUsage: { inputTokens, outputTokens, modelName, promptVersion },
 *     durationMs: number,
 *     nextStep?: where to go to actually commit
 *   }
 *
 * Auth: admin role. Rate-limit: 6/hour/org (LLM-bounded).
 *
 * **CLASSIFY-ONLY — this endpoint never writes.**
 *
 * Phase 11.14 (2026-07-29): the header, the `nextStep` hint and the
 * `apply=true` refusal all used to direct the caller to
 * `POST /api/admin/import-workbook`. **That route does not exist** — it was
 * never built (verify: `find src/app/api -path "*import-workbook*"`), and the
 * references survived only in prose. Anyone following them hit a 404 after a
 * successful classification.
 *
 * The real write paths are `/api/import/ai-auto-multi` (the multi-file
 * orchestrator — group-atomic, cross-file conflict gate, post-write DB
 * reconciliation) and the staging apply routes under
 * `/api/onboarding/import/staging/[id]/`. This endpoint stays useful as a
 * cheap classification preview / diagnostic; the UI tab that fronts it
 * already tells the user to import through the other tabs.
 */
import { NextRequest, NextResponse } from "next/server"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { checkBudget, recordUsage } from "@/lib/llm/cost-budget"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { extractWorkbookMeta } from "@/lib/onboarding/ai-import/sheet-meta-extractor"
import { classifySheets } from "@/lib/onboarding/ai-import/sheet-classifier"
import {
  buildEntitySheetMaps,
} from "@/lib/onboarding/ai-import/wire-azseker-adapters"
import {
  affectedIndicatorsForDataType,
} from "@/lib/onboarding/ai-import/datatype-indicator-map"
// rls-scan-ignore: admin-only AI Auto Import classifier (maxDuration 120). The
// entity/org reads feed an Anthropic sheet-classifier LLM call, and the LLM
// budget helpers (checkBudget/recordUsage) read+write aITokenUsage — none fit
// one 5s interactive withOrgScope tx. Classify-only (apply=true → 501) and
// orgId-scoped in code, so it runs on the BYPASSRLS `prismaAdmin` client.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"

// 120s, not 60: a real 26MB / 29-sheet workbook took 57s end-to-end (≈10s
// parse + ≈45s classifier) — uncomfortably close to a 60s cutoff. The classify
// cost scales with sheet count, so a wider workbook needs the headroom (2026-06-21).
export const maxDuration = 120

const RATE_LIMIT = { name: "import-ai-auto", max: 6, windowMs: 60 * 60_000 }

export async function POST(request: NextRequest) {
  const t0 = Date.now()
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    )
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  // Cost-budget gate: classify uses ~1-2K input + ~1K output tokens.
  // Conservatively reserve 4K before the call.
  const budgetCheck = await checkBudget(orgId, undefined, 4000)
  if (!budgetCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `LLM budget exceeded (${budgetCheck.reason}). Resets at ${budgetCheck.resetAt.toISOString()}`,
      },
      { status: 429 },
    )
  }

  // Body-size guard. The request is buffered by the Next 16 proxy up to
  // `proxyClientMaxBodySize` (64MB, next.config.ts); a larger upload is
  // silently TRUNCATED, after which `request.formData()` throws parsing the
  // broken multipart → an uncaught, opaque 500. Reject early with a clear,
  // actionable message instead (caught the 26MB Reporting 2026.xlsx 500 on
  // 2026-06-21). Content-Length is the whole multipart body (file + fields).
  const MAX_UPLOAD_BYTES = MAX_IMPORT_UPLOAD_BYTES
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `File too large: ${(contentLength / 1024 / 1024).toFixed(0)}MB exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit. Most of an xlsx this size is pivot-cache/data-model sheets — remove those (or split the workbook), then re-upload.`,
      },
      { status: 413 },
    )
  }

  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    )
  }
  // Phase 11.5 (2026-07-29) — was a hardcoded "2026" fallback, which would
  // quietly misfile every 2027 upload. Default from the org's timezone.
  const yearStr =
    (form.get("year") as string | null) ?? String(currentBakuYearNumber())
  const year = Number(yearStr) || currentBakuYearNumber()
  const applyVal = String(form.get("apply") ?? "").toLowerCase()
  const shouldApply = applyVal === "1" || applyVal === "true"

  // Parse the workbook
  const buf = Buffer.from(await file.arrayBuffer())
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { cellFormula: false, cellHTML: false, type: "buffer" })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid xlsx: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }

  // Look up known entity codes for this org — feeds the classifier
  // a hint of what valid AZSEKER-* / AAC-* / etc codes look like.
  const entities = await prisma.company.findMany({
    where: { organizationId: orgId, status: { not: "archived" } },
    select: { code: true, industry: true },
  })
  const knownEntityCodes = entities.map((e: { code: string }) => e.code)
  const industryByCode = new Map<string, string | null>(
    entities.map((e: { code: string; industry: string | null }) => [
      e.code,
      e.industry,
    ]),
  )

  // Org context (industry hint)
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const orgIndustry =
    org?.settings && typeof org.settings === "object"
      ? ((org.settings as Record<string, unknown>).industry as string | undefined)
      : undefined

  // Extract metas. Guarded — a malformed/corrupt sheet (or an extreme
  // pivot-cache sheet) must surface as a clean 422, not an uncaught 500.
  let metas
  try {
    metas = extractWorkbookMeta(wb, XLSX, {
      sampleRows: 4,
      maxColumns: 12,
      profileRows: 60,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Could not read the workbook structure: ${err instanceof Error ? err.message : String(err)}. A sheet may be malformed or corrupt.`,
      },
      { status: 422 },
    )
  }

  // Classify via LLM
  let classifierResult
  try {
    classifierResult = await classifySheets(
      {
        sheetMetas: metas,
        knownEntityCodes,
        orgIndustry,
      },
      getAnthropicClient(),
      AI_MODEL,
    )
  } catch (err) {
    // Sanitized — the classifier is an Anthropic call; never leak the raw
    // provider message (can carry billing text) to the import screen.
    return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 500 })
  }

  // Record token spend
  if (!classifierResult.skippedLLM) {
    await recordUsage(orgId, {
      inputTokens: classifierResult.usage.inputTokens,
      outputTokens: classifierResult.usage.outputTokens,
    }).catch(() => {
      /* non-fatal */
    })
  }

  // Group by entity → the entity sheet map, rendered in the preview
  const entitySheetMaps = buildEntitySheetMaps(classifierResult.classifications)

  // 2026-05-27 — per-sheet «affected indicators» preview projection.
  // Tells the user which seed indicators each sheet's dataType will feed
  // into BEFORE they confirm apply. Narrowed by the resolved entity's
  // industry so a KPI_FARMING sheet for a food-processing entity doesn't
  // surface agro_crops-only indicators.
  const sheetImpacts = classifierResult.classifications.map((c) => {
    const entityIndustry = c.entityCode
      ? industryByCode.get(c.entityCode) ?? null
      : null
    const impact = affectedIndicatorsForDataType(c.dataType, {
      industries: entityIndustry ? [entityIndustry] : undefined,
      limit: 12,
    })
    return {
      sheetName: c.sheetName,
      dataType: c.dataType,
      entityCode: c.entityCode,
      confidence: c.confidence,
      impact,
    }
  })

  // This endpoint never writes. See the header: the route this used to point
  // at does not exist.
  if (shouldApply) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This endpoint is classification-only and never writes. To commit, " +
          "POST the same file(s) to /api/import/ai-auto-multi with apply=1 — " +
          "that path is group-atomic and reconciles against the database after " +
          "the write.",
      },
      { status: 501 },
    )
  }

  return NextResponse.json({
    ok: true,
    mode: "preview" as const,
    totalSheets: metas.length,
    classifications: classifierResult.classifications,
    entitySheetMaps,
    sheetImpacts,
    llmUsage: classifierResult.usage,
    skippedLLM: classifierResult.skippedLLM,
    durationMs: Date.now() - t0,
    nextStep:
      "Classification only — nothing was written. To commit, upload the same file via the multi-file tab (POST /api/import/ai-auto-multi with apply=1).",
  })
}
