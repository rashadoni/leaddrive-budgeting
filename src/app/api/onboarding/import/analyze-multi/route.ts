/**
 * Phase 7.G Turn CIX (Phase 7.B v2 Day 4 — multi-sheet analyze) —
 * `/analyze-multi` endpoint.
 *
 * Multi-sheet variant of `/analyze` (Phase 7.B). Multipart upload: file +
 * companyId + (optional) `sheetNames` comma-separated filter +
 * (optional) industryHint. Runs the AI mapper on EACH selected sheet
 * (or every sheet if filter omitted), persists `MultiSheetProposal`
 * shape `{sheets: [{sheetName, proposal}]}` to `ImportStaging`, returns
 * per-sheet result/error rows.
 *
 * **Why a separate route from /analyze:** keeps the proven single-sheet
 * path untouched (production-critical for AZMADE 5-entity-template
 * imports). Multi-sheet adds N×LLM cost + per-sheet error isolation —
 * those concerns are easier to reason about as a dedicated handler.
 *
 * Auth: `manager` role + org-scoped (same as /analyze).
 *
 * Cost shape: each sheet ≈ $0.05 + 5-15s LLM call. With the 10-sheet hard
 * cap below, worst case ≈ $0.50 + 2.5min per request — within the 60s
 * function timeout for typical 3-5 sheet workbooks. Cost-budget gate
 * (LXXXXVII) enforces per-org daily caps independently.
 *
 * Per-sheet failure isolation: one sheet's mapper failure (LLM throw,
 * shape violation) does NOT abort the batch. The failed sheet is
 * recorded as `{sheetName, error}` in the response; successful sheets
 * still persist.
 *
 * **Apply-side gap (deferred):** existing `/staging/[id]/apply` route
 * expects single-sheet `MappingProposal` shape. Extending apply to
 * detect + branch on `MultiSheetProposal` is a separate-turn item —
 * the persisted shape is forward-compatible (`isMultiSheetProposal`
 * type guard from `applier.ts:229` already handles the discrimination).
 *
 * Does NOT write to BudgetLine. Only the apply endpoint does that.
 */

import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { runMapper } from "@/lib/onboarding/ai-mapper/mapper"
import { hasAnthropicKey } from "@/lib/ai/client"
import type { MappingProposal } from "@/lib/onboarding/ai-mapper/types"

export const maxDuration = 300 // 5 min — accommodates up to 10 sheets serial × ~30s each

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_SHEETS_PER_REQUEST = 10 // hard cap to bound LLM cost per call

const RATE_LIMIT = { name: "onboarding-analyze-multi", max: 3, windowMs: 60_000 }

const STAGING_TTL_MS = 24 * 60 * 60 * 1000

interface PerSheetSuccess {
  sheetName: string
  proposal: Omit<MappingProposal, "usage">
  sourceColumns: Array<{ sourceIndex: number; headerText: string }>
}

interface PerSheetFailure {
  sheetName: string
  error: string
}

type PerSheetResult = PerSheetSuccess | PerSheetFailure

function isFailure(r: PerSheetResult): r is PerSheetFailure {
  return "error" in r
}

export async function POST(request: NextRequest) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "AI Data Mapper unavailable: ANTHROPIC_API_KEY not configured on this deployment." },
      { status: 503 },
    )
  }

  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(`${orgId}:${getClientIp(request)}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data body" }, { status: 400 })
  }

  const file = form.get("file")
  const companyIdRaw = form.get("companyId")
  const sheetNamesRaw = form.get("sheetNames") // comma-separated optional filter
  const industryHintRaw = form.get("industryHint")

  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing file. Send a multipart/form-data body with a "file" field.' },
      { status: 400 },
    )
  }
  if (typeof companyIdRaw !== "string" || companyIdRaw.trim() === "") {
    return NextResponse.json({ error: "Missing companyId" }, { status: 400 })
  }
  const companyId = companyIdRaw.trim()
  const sheetFilter =
    typeof sheetNamesRaw === "string" && sheetNamesRaw.trim() !== ""
      ? sheetNamesRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : null
  const industryHint =
    typeof industryHintRaw === "string" && industryHintRaw.trim() !== ""
      ? industryHintRaw.trim()
      : undefined

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` },
      { status: 413 },
    )
  }
  const filename = (file as Blob & { name?: string }).name ?? ""
  if (!filename) {
    return NextResponse.json(
      { error: "Upload requires a filename. Send the file with a `filename=...` part." },
      { status: 400 },
    )
  }
  if (!/\.xlsx$/i.test(filename)) {
    return NextResponse.json(
      { error: "Only .xlsx files are accepted by the AI Data Mapper." },
      { status: 415 },
    )
  }

  // Cross-tenant guard
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { id: true, name: true, industry: true },
  })
  if (!company) {
    return NextResponse.json({ error: "Company not found in your organization" }, { status: 404 })
  }

  let workbook: XLSX.WorkBook
  try {
    const arrayBuffer = await file.arrayBuffer()
    workbook = XLSX.read(Buffer.from(arrayBuffer), {
      type: "buffer",
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      dense: true,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  if (workbook.SheetNames.length === 0) {
    return NextResponse.json({ error: "Workbook has no sheets" }, { status: 400 })
  }

  // Resolve target sheets
  let targetSheets: string[]
  if (sheetFilter) {
    const missing = sheetFilter.filter((s) => !workbook.SheetNames.includes(s))
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Sheets not found: ${missing.join(", ")}`,
          availableSheets: workbook.SheetNames,
        },
        { status: 400 },
      )
    }
    targetSheets = sheetFilter
  } else {
    targetSheets = [...workbook.SheetNames]
  }

  if (targetSheets.length > MAX_SHEETS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Too many sheets requested (${targetSheets.length}). Cap is ${MAX_SHEETS_PER_REQUEST}; supply sheetNames= to narrow.`,
        availableSheets: workbook.SheetNames,
      },
      { status: 400 },
    )
  }

  // Run mapper on each sheet, isolating per-sheet failures
  const perSheet: PerSheetResult[] = []
  for (const sheetName of targetSheets) {
    const inputResult = extractMapperInput(workbook, sheetName, XLSX, {
      sourceFile: filename,
      companyName: company.name,
      industry: industryHint ?? company.industry ?? undefined,
    })
    if ("error" in inputResult) {
      perSheet.push({ sheetName, error: `extract failed: ${inputResult.error}` })
      continue
    }
    let proposal
    try {
      proposal = await runMapper(inputResult)
    } catch (err) {
      perSheet.push({
        sheetName,
        error: `mapper failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { usage, ...proposalForUser } = proposal
    perSheet.push({
      sheetName,
      proposal: proposalForUser,
      sourceColumns: inputResult.columns.map((c) => ({
        sourceIndex: c.index,
        headerText: c.headerText,
      })),
    })
  }

  // Build the MultiSheetProposal shape from successful sheets only.
  // Failed sheets are recorded in the response but NOT persisted — apply
  // can only act on what was successfully mapped.
  const successes = perSheet.filter((r): r is PerSheetSuccess => !isFailure(r))
  if (successes.length === 0) {
    return NextResponse.json(
      {
        error: "No sheets analyzed successfully — all attempts failed",
        perSheet,
      },
      { status: 422 },
    )
  }

  const multiSheetProposal = {
    sheets: successes.map((s) => ({ sheetName: s.sheetName, proposal: s.proposal })),
  }

  const expiresAt = new Date(Date.now() + STAGING_TTL_MS)
  const staging = await prisma.importStaging.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      status: "pending",
      sourceFile: filename,
      sourceSheet: successes.map((s) => s.sheetName).join(","),
      proposal: multiSheetProposal as unknown as Record<string, unknown>,
      createdBy: session.userId,
      expiresAt,
    },
    select: { id: true },
  })

  return NextResponse.json(
    {
      stagingId: staging.id,
      expiresAt: expiresAt.toISOString(),
      successCount: successes.length,
      failureCount: perSheet.length - successes.length,
      perSheet,
    },
    { status: 201 },
  )
}
