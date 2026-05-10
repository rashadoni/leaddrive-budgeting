/**
 * Phase 7.G Turn CX (Phase 7.B v2 Day 4 — multi-sheet apply) —
 * `/staging/[id]/apply-multi` endpoint.
 *
 * Companion to `/analyze-multi` (CIX). Reads the saved `MultiSheetProposal`
 * from `ImportStaging.proposal`, runs `applyMultiSheetProposal()` on the
 * re-uploaded workbook, then performs a transactional flat-aggregate insert
 * of all sheets' `ParsedBudgetLine[]` rows into BudgetLine.
 *
 * **Why a separate route from /apply:** keeps the production single-sheet
 * path untouched (mirrors the analyze/analyze-multi split from CIX).
 * Multi-sheet adds proposal-shape detection + per-sheet error reporting +
 * cross-sheet aggregate write — easier as a dedicated handler.
 *
 * Auth: `manager` role + org-scoped (same as /apply).
 *
 * Per-sheet error isolation at apply time: if a sheet errors during
 * `applyProposal`, the failure is recorded BUT the transaction proceeds
 * with the OTHER sheets' lines. Rationale: caller shouldn't lose 4 good
 * sheets to 1 bad one. Caller can re-analyze the failed sheet via
 * `/analyze-multi?sheetNames=<bad>` and re-apply.
 *
 * **v1 simplifications (deferred to v1.1+):**
 *   - No dry-run support (single-sheet `/apply` has it; mirror in v1.1)
 *   - No cross-sheet line dedup — duplicate `code`s across sheets are
 *     written N times (last-write-wins in BudgetLine). Future: dedup
 *     by code with explicit conflict flag in response.
 *   - Single shared `targetYear` derived from the FIRST sheet's proposal.
 *     Multi-year multi-sheet rejected. (Same constraint as single-sheet.)
 *   - One BudgetPlan for the whole batch (matches single-sheet contract).
 *
 * Status transitions enforced (same as single-sheet):
 *   pending  → applied (happy path)
 *   pending  → expired (auto-flip if past expiresAt)
 *   applied  → 409
 *   discarded/expired → 410
 */

import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import {
  applyMultiSheetProposal,
  isMultiSheetProposal,
  detectProposalYear,
  type MultiSheetProposal,
} from "@/lib/onboarding/ai-mapper/applier"
import type { ParseResult, ParsedBudgetLine } from "@/lib/onboarding/adapters/azmade-sopl"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import type { MappingProposal } from "@/lib/onboarding/ai-mapper/types"

export const maxDuration = 120 // larger than single-sheet — N parallel writes

const MAX_FILE_SIZE = 10 * 1024 * 1024
const RATE_LIMIT = { name: "onboarding-apply-multi", max: 5, windowMs: 60_000 }

interface PerSheetSuccess {
  sheetName: string
  inserted: number
  warnings: number
  parentRollupsDropped: number
  parentRollupsUnallocated: number
}

interface PerSheetFailure {
  sheetName: string
  error: string
}

type PerSheetResult = PerSheetSuccess | PerSheetFailure

function isFailure(r: PerSheetResult): r is PerSheetFailure {
  return "error" in r
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(`${orgId}:${getClientIp(request)}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { id: stagingId } = await params
  if (typeof stagingId !== "string" || stagingId.trim() === "") {
    return NextResponse.json({ error: "Invalid staging id" }, { status: 400 })
  }

  const staging = await prisma.importStaging.findFirst({
    where: { id: stagingId, organizationId: orgId },
    select: {
      id: true,
      companyId: true,
      status: true,
      sourceSheet: true,
      proposal: true,
      expiresAt: true,
      appliedAt: true,
    },
  })
  if (!staging) {
    return NextResponse.json({ error: "Staging not found" }, { status: 404 })
  }

  // Status gating (mirrors single-sheet apply route).
  if (staging.status === "pending" && staging.expiresAt < new Date()) {
    await prisma.importStaging.updateMany({
      where: { id: staging.id, status: "pending" },
      data: { status: "expired" },
    })
    return NextResponse.json(
      { error: "Staging proposal has expired", status: "expired" },
      { status: 410 },
    )
  }
  if (staging.status === "applied") {
    return NextResponse.json(
      {
        error: "Staging already applied",
        status: "applied",
        appliedAt: staging.appliedAt?.toISOString() ?? null,
      },
      { status: 409 },
    )
  }
  if (staging.status === "discarded" || staging.status === "expired") {
    return NextResponse.json(
      { error: `Staging is ${staging.status}; cannot apply`, status: staging.status },
      { status: 410 },
    )
  }

  // Validate proposal shape — must be MultiSheetProposal. Single-sheet
  // proposals from /analyze should be sent to /apply, not here.
  const rawProposal = staging.proposal as unknown
  const isMulti =
    rawProposal !== null && typeof rawProposal === "object" && isMultiSheetProposal(rawProposal as MultiSheetProposal | MappingProposal)
  if (!isMulti) {
    return NextResponse.json(
      {
        error:
          "Staging proposal is not a MultiSheetProposal. Use /api/onboarding/import/staging/[id]/apply for single-sheet proposals.",
      },
      { status: 422 },
    )
  }
  const multi = rawProposal as MultiSheetProposal

  // Parse multipart body
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data body" }, { status: 400 })
  }
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing file. Re-upload the same xlsx that was analyzed." },
      { status: 400 },
    )
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` },
      { status: 413 },
    )
  }
  const filename = (file as Blob & { name?: string }).name ?? ""
  if (!filename || !/\.xlsx$/i.test(filename)) {
    return NextResponse.json(
      { error: "Only .xlsx files are accepted by the AI Data Mapper." },
      { status: 415 },
    )
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

  // Apply the multi-sheet proposal to the workbook.
  const multiResult = applyMultiSheetProposal(workbook, multi, XLSX)

  // Year resolution: derive from FIRST sheet's columns; if any other sheet
  // disagrees, reject (same constraint as single-sheet). Use the first
  // SUCCESSFUL sheet's proposal for year hint.
  const firstSuccess = multiResult.perSheet.find(
    (s): s is { sheetName: string; result: ParseResult } => "result" in s,
  )
  if (!firstSuccess) {
    return NextResponse.json(
      {
        error: "All sheets failed to apply",
        perSheet: multiResult.perSheet,
      },
      { status: 422 },
    )
  }
  const firstSheetProposal = multi.sheets.find(
    (s) => s.sheetName === firstSuccess.sheetName,
  )?.proposal
  let targetYear = currentBakuYearNumber()
  if (firstSheetProposal) {
    const yearHint = detectProposalYear(firstSheetProposal.columns)
    if (typeof yearHint === "number") {
      targetYear = yearHint
    } else if (yearHint && typeof yearHint === "object" && "conflict" in yearHint) {
      return NextResponse.json(
        {
          error: `First sheet has columns referencing multiple years (${yearHint.conflict.join(", ")}). MVP requires single-year workbooks.`,
        },
        { status: 400 },
      )
    }
  }

  const orgIdLocal = orgId
  const companyId = staging.companyId

  const companyForCurrency = await prisma.company.findUnique({
    where: { id: companyId },
    select: { baseCurrencyCode: true },
  })
  const baseCurrencyCode = companyForCurrency?.baseCurrencyCode ?? "AZN"

  // Aggregate per-sheet success/failure stats + flat-concat ParsedBudgetLine[]
  const perSheet: PerSheetResult[] = []
  const allLines: ParsedBudgetLine[] = []
  for (const sheetResult of multiResult.perSheet) {
    if ("error" in sheetResult) {
      perSheet.push({ sheetName: sheetResult.sheetName, error: sheetResult.error })
      continue
    }
    const r = sheetResult.result
    perSheet.push({
      sheetName: sheetResult.sheetName,
      inserted: r.lines.length,
      warnings: r.warnings.length,
      parentRollupsDropped: r.parentRollupsDropped.length,
      parentRollupsUnallocated: r.parentRollupsUnallocated.length,
    })
    allLines.push(...r.lines)
  }

  // Transactional delete-then-insert. Identical to single-sheet — operates
  // on flat aggregate from all successful sheets.
  let totalInserted = 0
  let totalDeleted = 0
  try {
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const planName = `AI-Imported ${targetYear} Budget`
        let plan = await tx.budgetPlan.findFirst({
          where: { organizationId: orgIdLocal, year: targetYear, name: planName, deletedAt: null },
          select: { id: true },
        })
        if (!plan) {
          plan = await tx.budgetPlan.create({
            data: {
              organizationId: orgIdLocal,
              name: planName,
              year: targetYear,
              periodType: "yearly",
              status: "active",
            },
            select: { id: true },
          })
        }

        const del = await tx.budgetLine.deleteMany({
          where: { organizationId: orgIdLocal, planId: plan.id, companyId },
        })

        const coaCache = new Map<string, string>()
        let inserted = 0
        for (const line of allLines) {
          let coaId = coaCache.get(line.code)
          if (!coaId) {
            const existing = await tx.chartOfAccount.findUnique({
              where: { organizationId_code: { organizationId: orgIdLocal, code: line.code } },
              select: { id: true },
            })
            if (existing) {
              coaId = existing.id
            } else {
              const created = await tx.chartOfAccount.create({
                data: {
                  organizationId: orgIdLocal,
                  code: line.code,
                  name: line.label || line.code,
                  nameEn: line.label || line.code,
                  accountType: line.accountType,
                  sortOrder: 0,
                  isActive: true,
                },
                select: { id: true },
              })
              coaId = created.id
            }
            coaCache.set(line.code, coaId)
          }
          if (!coaId) {
            throw new Error(`Internal: coaId not resolved for code ${line.code}`)
          }

          const lineType: "revenue" | "cogs" | "expense" =
            line.accountType === "revenue" || line.accountType === "cogs"
              ? line.accountType
              : "expense"

          for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
            const monthlyAmount = line.perMonth[monthIdx] ?? 0
            const data: Prisma.BudgetLineUncheckedCreateInput = {
              organizationId: orgIdLocal,
              planId: plan.id,
              companyId,
              accountId: coaId,
              category: line.code,
              department: null,
              lineType,
              plannedAmount: monthlyAmount,
              sortOrder: monthIdx,
              monthIndex: monthIdx,
              isAutoPlanned: false,
              isAutoActual: false,
              currencyCode: baseCurrencyCode,
            }
            await tx.budgetLine.create({ data })
          }
          inserted += 1
        }

        await tx.importStaging.update({
          where: { id: staging.id },
          data: { status: "applied", appliedAt: new Date() },
        })

        return { inserted, deleted: del.count }
      },
      { timeout: 120_000 },
    )
    totalInserted = result.inserted
    totalDeleted = result.deleted
  } catch (err) {
    console.error("[apply-multi] transaction failed:", err)
    return NextResponse.json(
      {
        error: `Transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        perSheet,
      },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      stagingId: staging.id,
      status: "applied",
      year: targetYear,
      inserted: totalInserted,
      deleted: totalDeleted,
      successCount: perSheet.filter((r) => !isFailure(r)).length,
      failureCount: perSheet.filter(isFailure).length,
      perSheet,
    },
    { status: 200 },
  )
}
