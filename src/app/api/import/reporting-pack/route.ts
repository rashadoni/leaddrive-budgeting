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
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { prisma } from "@/lib/prisma"
import { runReportingPackImport } from "@/lib/onboarding/adapters/reporting-pack-importer"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

export const maxDuration = 300

const RATE_LIMIT = { name: "import-reporting-pack", max: 6, windowMs: 60 * 60_000 }
const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

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

  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' field" },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File too large (${(file.size / 1e6).toFixed(1)} MB > 20 MB)` },
      { status: 413 },
    )
  }
  const year = Number(form.get("year")) || new Date().getFullYear()
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
