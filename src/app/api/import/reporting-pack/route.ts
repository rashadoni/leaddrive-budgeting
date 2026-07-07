/**
 * Reporting-pack import endpoint (FO Holding monthly "Reporting YYYY.xlsx").
 *
 *   POST /api/import/reporting-pack   (multipart/form-data)
 *     file   — xlsx blob (required)
 *     year   — target year (default: current year)
 *     apply  — "1"/"true" to commit (default: preview, ZERO DB writes)
 *
 * Auth: admin. Rate-limit: 6/hour/org.
 *
 * Drives `runReportingPackImport`:
 *   • preview — pure parsers, no DB writes → per-entity line counts + totals
 *   • apply   — per-entity writes through the audited production handlers in
 *               one transaction, then recompute the touched companies.
 *
 * This is the prod-safe path: the containerised app already reaches the
 * Postgres on the internal docker network, so the monthly pack is imported by
 * uploading it here — no SSH, no CLI, no direct DB access.
 */
// rls-scan-ignore: admin-only monthly reporting-pack import (maxDuration 300).
// runReportingPackImport writes every entity through the audited production
// handlers inside its OWN prisma.$transaction, then onAfterApply fires
// runRecomputeForCompanies — neither fits a single 5s interactive withOrgScope
// tx (nested interactive tx is disallowed). Every query is orgId-scoped in
// code; it runs on the BYPASSRLS `prismaAdmin` client (passed into the importer
// + recompute).
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { runReportingPackImport } from "@/lib/onboarding/adapters/reporting-pack-importer"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"

export const maxDuration = 300

const RATE_LIMIT = { name: "import-reporting-pack", max: 6, windowMs: 60 * 60_000 }
const MAX_BYTES = MAX_IMPORT_UPLOAD_BYTES // shared cap — see src/lib/import/upload-limits.ts

export async function POST(request: NextRequest) {
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

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid multipart/form-data body" },
      { status: 400 },
    )
  }
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    )
  }
  // Require an .xlsx (mirrors /api/onboarding/import/analyze). XLSX.read
  // would reject a non-workbook anyway, but failing fast keeps the error
  // clear. Browser uploads carry the real filename; a missing name defaults
  // to a passing one so programmatic .xlsx blobs aren't rejected.
  const fileName = (file as Blob & { name?: string }).name ?? "upload.xlsx"
  if (!/\.xlsx$/i.test(fileName)) {
    return NextResponse.json(
      { ok: false, error: "Only .xlsx files are supported" },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File too large (${(file.size / 1e6).toFixed(1)} MB > 20 MB)` },
      { status: 413 },
    )
  }
  // Bounded-integer year — reject NaN / fractional / absurd values instead
  // of silently importing into a nonsensical year (Number("x") || fallback
  // also swallowed "year=0.5", "year=99999").
  const yearRaw = form.get("year")
  let year = new Date().getFullYear()
  if (yearRaw != null && String(yearRaw).trim() !== "") {
    const parsed = Number(yearRaw)
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      return NextResponse.json(
        { ok: false, error: "year must be an integer between 2000 and 2100" },
        { status: 400 },
      )
    }
    year = parsed
  }
  const applyVal = String(form.get("apply") ?? "").toLowerCase()
  const shouldApply = applyVal === "1" || applyVal === "true"

  let wb: XLSX.WorkBook
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    wb = XLSX.read(buf, { cellFormula: false, cellHTML: false, type: "buffer" })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Invalid xlsx: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  // DoS guard: a small compressed .xlsx can expand to a huge cell grid, and
  // the parsers run sheet_to_json over every sheet. Bound each sheet before
  // parsing (mirrors /api/onboarding/import/analyze).
  for (const sheetName of wb.SheetNames) {
    const ref = wb.Sheets[sheetName]?.["!ref"]
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)
    const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
    if (cells > 500_000) {
      return NextResponse.json(
        { ok: false, error: `Sheet "${sheetName}" is too large (${cells.toLocaleString()} cells)` },
        { status: 413 },
      )
    }
  }

  // entityCode → companyId for the post-apply recompute (AZSEKER tree).
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, code: { startsWith: "AZSEKER" } },
    select: { id: true, code: true },
  })
  const codeToId = new Map(companies.map((c) => [c.code, c.id]))

  try {
    const result = await runReportingPackImport(
      { workbook: wb, organizationId: orgId, year, mode: shouldApply ? "apply" : "preview" },
      {
        prisma,
        XLSX,
        onAfterApply: async (entityCodes) => {
          const affected = entityCodes
            .map((code) => codeToId.get(code))
            .filter((id): id is string => Boolean(id))
            .map((companyId) => ({ companyId, year }))
          if (affected.length > 0) {
            await runRecomputeForCompanies(prisma, orgId, affected)
          }
        },
      },
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    // Sanitised — never leak raw provider/DB internals to the import screen.
    return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 500 })
  }
}
