/**
 * Universal Import — `/api/onboarding/import/analyze-multi` (multi-sheet producer).
 *
 * Companion to `/analyze` for a workbook with SEVERAL P&L sheets belonging to
 * ONE company (apply-multi merges all sheets' lines under a single companyId).
 *
 *   POST   multipart/form-data
 *     file        — xlsx (required)
 *     sheetNames  — comma-separated sheet names (required, 2..20)
 *     companyId   — target Company.id (required)
 *
 *   → runs the AI mapper per sheet → persists ONE ImportStaging whose proposal
 *   is a MultiSheetProposal { sheets: [{sheetName, proposal}] } → returns the
 *   per-sheet proposals + source columns for the review UI. The reviewer edits
 *   each sheet's mapping; apply happens via /staging/[id]/apply-multi.
 *
 * Nothing is written to financial tables here. Auth: manager. Rate-limited +
 * cost-budgeted (one mapper call per sheet, each cached 24h).
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { checkBudget, recordUsage } from "@/lib/llm/cost-budget"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { runMapper } from "@/lib/onboarding/ai-mapper/mapper"
import { computeStructureHash } from "@/lib/onboarding/ai-mapper/structure-hash"
import type { MappingProposal, SourceColumn } from "@/lib/onboarding/ai-mapper/types"
import { prisma } from "@/lib/prisma"
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"

export const maxDuration = 120

const MAX_FILE_SIZE = MAX_IMPORT_UPLOAD_BYTES // shared cap — see src/lib/import/upload-limits.ts
const MAX_SHEETS = 20
const RATE_LIMIT = { name: "onboarding-analyze-multi", max: 6, windowMs: 60 * 60_000 }
const TOKEN_PER_SHEET = 8000
const STAGING_TTL_MS = 24 * 60 * 60_000

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

  const sheetNames = String(form.get("sheetNames") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (sheetNames.length < 2) {
    return NextResponse.json(
      { ok: false, error: "Provide ≥2 sheet names (use /analyze for a single sheet)" },
      { status: 400 },
    )
  }
  if (sheetNames.length > MAX_SHEETS) {
    return NextResponse.json({ ok: false, error: `Too many sheets (max ${MAX_SHEETS})` }, { status: 400 })
  }
  const companyId = String(form.get("companyId") ?? "").trim()
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "Missing 'companyId' field" }, { status: 400 })
  }

  // Budget: one mapper call per sheet (cache hits are free but reserve worst-case).
  const budgetCheck = await checkBudget(orgId, undefined, TOKEN_PER_SHEET * sheetNames.length)
  if (!budgetCheck.ok) {
    return NextResponse.json(
      { ok: false, error: `LLM budget exceeded (${budgetCheck.reason}). Resets at ${budgetCheck.resetAt.toISOString()}` },
      { status: 429 },
    )
  }

  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { id: true, code: true, name: true, industry: true },
  })
  if (!company) {
    return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 })
  }

  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), {
      type: "buffer",
      cellFormula: false,
      cellHTML: false,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Invalid xlsx: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  // Run the mapper per sheet, collecting proposals + source columns + hashes.
  const sheets: Array<{ sheetName: string; proposal: MappingProposal; sourceColumns: SourceColumn[] }> = []
  const hashes: string[] = []
  let totalIn = 0
  let totalOut = 0
  try {
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) {
        return NextResponse.json({ ok: false, error: `Sheet "${sheetName}" not found` }, { status: 400 })
      }
      const ref = sheet["!ref"]
      if (ref) {
        const range = XLSX.utils.decode_range(ref)
        const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
        if (cells > 500_000) {
          return NextResponse.json(
            { ok: false, error: `Sheet "${sheetName}" too large (${cells.toLocaleString()} cells)` },
            { status: 413 },
          )
        }
      }
      const mapperInput = extractMapperInput(workbook, sheetName, XLSX, {
        sourceFile: filename,
        companyName: company.name,
        industry: company.industry ?? undefined,
      })
      if ("error" in mapperInput) {
        return NextResponse.json({ ok: false, error: `${sheetName}: ${mapperInput.error}` }, { status: 400 })
      }
      const proposal = await runMapper(mapperInput, { orgId })
      sheets.push({ sheetName, proposal, sourceColumns: mapperInput.columns })
      hashes.push(computeStructureHash(mapperInput))
      totalIn += proposal.usage?.inputTokens ?? 0
      totalOut += proposal.usage?.outputTokens ?? 0
    }
  } catch (err) {
    return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 500 })
  }

  if (totalIn > 0 || totalOut > 0) {
    await recordUsage(orgId, { inputTokens: totalIn, outputTokens: totalOut }).catch(() => {})
  }

  const staging = await prisma.importStaging.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      sourceFile: filename,
      // sourceSheet carries the first sheet for display; the multi proposal
      // holds them all.
      sourceSheet: sheetNames[0],
      proposal: {
        sheets: sheets.map((s) => ({ sheetName: s.sheetName, proposal: s.proposal })),
        __structureHash: hashes.join("|"),
      } as unknown as object,
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
    multi: true,
    sheets,
  })
}
