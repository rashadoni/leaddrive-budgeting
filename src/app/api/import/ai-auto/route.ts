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
 *     nextStep?: "POST /api/admin/import-workbook with the discovered ENTITIES"
 *   }
 *
 * Auth: admin role. Rate-limit: 6/hour/org (LLM-bounded).
 *
 * **Important**: this endpoint v1 ships in CLASSIFY-ONLY mode. The apply
 * step calls into existing `/api/admin/import-workbook` which already
 * has bit-perfect reconciliation. The UI flow is:
 *
 *   1. User uploads xlsx → POST /api/import/ai-auto (apply=false)
 *   2. Server returns classification + entity sheet map
 *   3. User reviews + confirms
 *   4. UI POSTs same xlsx to /api/admin/import-workbook for the actual write
 *
 * This two-step keeps the user in control + reuses the already-audited
 * Phase 7.M import pipeline.
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { checkBudget, recordUsage } from "@/lib/llm/cost-budget"
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractWorkbookMeta } from "@/lib/onboarding/ai-import/sheet-meta-extractor"
import { classifySheets } from "@/lib/onboarding/ai-import/sheet-classifier"
import {
  buildEntitySheetMaps,
} from "@/lib/onboarding/ai-import/wire-azseker-adapters"
import { prisma } from "@/lib/prisma"

export const maxDuration = 60

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

  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    )
  }
  const yearStr = (form.get("year") as string | null) ?? "2026"
  const year = Number(yearStr) || new Date().getFullYear()
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
    select: { code: true },
  })
  const knownEntityCodes = entities.map((e: { code: string }) => e.code)

  // Org context (industry hint)
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const orgIndustry =
    org?.settings && typeof org.settings === "object"
      ? ((org.settings as Record<string, unknown>).industry as string | undefined)
      : undefined

  // Extract metas
  const metas = extractWorkbookMeta(wb, XLSX, {
    sampleRows: 4,
    maxColumns: 12,
    profileRows: 60,
  })

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
    return NextResponse.json(
      {
        ok: false,
        error: `Classifier failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    )
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

  // Group by entity → ready-to-call ENTITIES array for downstream
  // /api/admin/import-workbook
  const entitySheetMaps = buildEntitySheetMaps(classifierResult.classifications)

  // In v1 we DO NOT apply from this endpoint — caller chains to
  // /api/admin/import-workbook with the discovered ENTITIES. That
  // endpoint has the battle-tested 5-phase bit-perfect pipeline.
  if (shouldApply) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "apply=true not yet supported in v1. Use this endpoint for classify preview, then POST to /api/admin/import-workbook to commit.",
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
    llmUsage: classifierResult.usage,
    skippedLLM: classifierResult.skippedLLM,
    durationMs: Date.now() - t0,
    nextStep:
      "Confirm the entity sheet map, then POST /api/admin/import-workbook with this xlsx to commit.",
  })
}
