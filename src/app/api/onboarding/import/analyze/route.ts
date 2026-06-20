/**
 * Universal Import — `/api/onboarding/import/analyze` (the keystone producer).
 *
 * The "review-then-apply" backend already existed (ImportStaging table,
 * applyProposal with userOverrides, the staging /apply route with dry-run +
 * transaction + recompute + audit) but NOTHING created an ImportStaging row.
 * This endpoint is that missing producer:
 *
 *   POST /api/onboarding/import/analyze   (multipart/form-data)
 *     file       — xlsx blob (required)
 *     sheetName  — which sheet to map (required)
 *     companyId  — target Company.id this sheet belongs to (required)
 *
 *   → runs the AI mapper (cached) → persists an ImportStaging row →
 *   returns { stagingId, proposal } for the MappingReviewTable to edit.
 *
 * Nothing is written to financial tables here — the proposal is advisory.
 * The user reviews/edits it, then POSTs to /staging/[id]/apply (dry-run
 * preview first, then commit).
 *
 * Auth: manager (matches the /apply route). Rate-limited + cost-budgeted
 * (one LLM mapper call, cached 24h per template structure-hash).
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { checkBudget, recordUsage } from "@/lib/llm/cost-budget"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { runMapper } from "@/lib/onboarding/ai-mapper/mapper"
import { prisma } from "@/lib/prisma"

export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const RATE_LIMIT = { name: "onboarding-analyze", max: 10, windowMs: 60 * 60_000 }
// One mapper call is ~3-5K input + ~2K output; reserve conservatively.
const TOKEN_RESERVE = 8000
const STAGING_TTL_MS = 24 * 60 * 60_000 // 24h — matches /apply's expiry gate

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const budgetCheck = await checkBudget(orgId, undefined, TOKEN_RESERVE)
  if (!budgetCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `LLM budget exceeded (${budgetCheck.reason}). Resets at ${budgetCheck.resetAt.toISOString()}`,
      },
      { status: 429 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: "Expected multipart/form-data body" }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "Missing 'file' field" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { ok: false, error: `File too large (${(file.size / 1e6).toFixed(1)} MB > 10 MB)` },
      { status: 413 },
    )
  }
  const filename = (file as Blob & { name?: string }).name ?? "upload.xlsx"
  if (!/\.xlsx$/i.test(filename)) {
    return NextResponse.json({ ok: false, error: "Only .xlsx files are accepted" }, { status: 415 })
  }

  const sheetName = String(form.get("sheetName") ?? "").trim()
  if (!sheetName) {
    return NextResponse.json({ ok: false, error: "Missing 'sheetName' field" }, { status: 400 })
  }
  const companyId = String(form.get("companyId") ?? "").trim()
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "Missing 'companyId' field" }, { status: 400 })
  }

  // Company must belong to this org (404 — don't leak cross-org id existence).
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { id: true, code: true, name: true, industry: true },
  })
  if (!company) {
    return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 })
  }

  let workbook: XLSX.WorkBook
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    workbook = XLSX.read(buf, { type: "buffer", cellFormula: false, cellHTML: false })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Invalid xlsx: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }
  if (!workbook.Sheets[sheetName]) {
    return NextResponse.json(
      { ok: false, error: `Sheet "${sheetName}" not found in workbook` },
      { status: 400 },
    )
  }

  const mapperInput = extractMapperInput(workbook, sheetName, XLSX, {
    sourceFile: filename,
    companyName: company.name,
    industry: company.industry ?? undefined,
  })
  if ("error" in mapperInput) {
    return NextResponse.json({ ok: false, error: mapperInput.error }, { status: 400 })
  }

  let proposal
  try {
    proposal = await runMapper(mapperInput, { orgId })
  } catch (err) {
    // Sanitised — never leak raw provider/billing text to the import screen.
    return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 500 })
  }

  if (proposal.usage) {
    await recordUsage(orgId, {
      inputTokens: proposal.usage.inputTokens,
      outputTokens: proposal.usage.outputTokens,
    }).catch(() => {
      /* non-fatal */
    })
  }

  const staging = await prisma.importStaging.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      sourceFile: filename,
      sourceSheet: sheetName,
      proposal: proposal as unknown as object,
      createdBy: session.userId,
      expiresAt: new Date(Date.now() + STAGING_TTL_MS),
    },
    select: { id: true, expiresAt: true },
  })

  return NextResponse.json({
    ok: true,
    stagingId: staging.id,
    expiresAt: staging.expiresAt.toISOString(),
    company: { id: company.id, code: company.code, name: company.name },
    proposal,
    // The proposal's columns carry only role/confidence/reasoning; the
    // review table also needs each source column's header + sample values
    // to show the reviewer WHAT they're re-mapping.
    sourceColumns: mapperInput.columns,
  })
}
