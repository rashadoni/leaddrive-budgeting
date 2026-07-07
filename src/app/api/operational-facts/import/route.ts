/**
 * Phase 7.H F4.v2.3.1 — operational KPI bulk import endpoint.
 *
 * GET  /api/operational-facts/import/template
 *      → xlsx template download. Pre-filled with one example row per
 *        operational metric so users see exactly what shape is expected.
 *
 * POST /api/operational-facts/import
 *      multipart/form-data { file: xlsx, dryRun?: "true" | "false",
 *        forceWarnings?: "true" | "false" }
 *      → { rows: ParsedRow[], errors: ImportRowError[], warnings: ... }
 *      When `dryRun=true` (default), parses + validates without writing.
 *      When `false`, additionally upserts every clean row + fires an
 *        `operational_fact_create`/`operational_fact_update` audit event
 *        per row. Rejects the apply if warnings exist and
 *        `forceWarnings` is not "true" — mirrors the single-row confirm
 *        flow.
 *
 * Permissions:
 *   GET  any-member (template download is informational)
 *   POST manager+ (the same gate as the single-row create endpoint)
 */

// rls-scan-ignore: DEPRECATED bulk-import route (replacedBy /api/import/
// ai-auto-multi). It streams an xlsx parse then a per-row upsert loop that
// can run to 1000+ rows — too large for a single 5s interactive withOrgScope
// tx, and per-row audits are fire-and-forget. Writes are org-scoped in code;
// it runs on the BYPASSRLS `prismaAdmin` client and is slated for removal, so
// it is intentionally excluded from the Stage-3 wrap.
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent } from "@/lib/audit/log"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:operational-facts:import")
import {
  parseOperationalFactsWorkbook,
  type ImportParseResult,
} from "@/lib/onboarding/operational-facts-import"
import { withDeprecation } from "@/lib/api-deprecation"

async function _POST(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a file field." },
      { status: 400 },
    )
  }

  const file = form.get("file")
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "Missing or empty `file` field. Upload an xlsx workbook." },
      { status: 400 },
    )
  }
  // Bound the upload size so a malformed POST can't fill memory. 5 MB
  // is generous — a 5000-row × 6-col xlsx weighs ~80 KB.
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Upload exceeds 5 MB. Split the file into smaller batches." },
      { status: 413 },
    )
  }

  const dryRun = String(form.get("dryRun") ?? "true") !== "false"
  const forceWarnings = String(form.get("forceWarnings") ?? "false") === "true"

  let workbook: XLSX.WorkBook
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    workbook = XLSX.read(buf, { type: "buffer", cellDates: true })
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to parse workbook.",
      },
      { status: 400 },
    )
  }

  const parsed: ImportParseResult = parseOperationalFactsWorkbook(
    workbook,
    XLSX,
  )

  // Dry-run / preview path — return the parse result verbatim.
  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      rowCount: parsed.rows.length,
      errorCount: parsed.errors.length,
      warningCount: parsed.warnings.length,
      rows: parsed.rows,
      errors: parsed.errors,
      warnings: parsed.warnings,
    })
  }

  // Apply path — refuse when validation errors exist (UI should have
  // shown them and let the user fix the file). Also refuse when
  // warnings exist and the caller didn't explicitly confirm them.
  if (parsed.errors.length > 0) {
    return NextResponse.json(
      {
        error:
          "File contains validation errors. Fix them before re-uploading. Use dryRun=true to see details.",
        errorCount: parsed.errors.length,
        errors: parsed.errors,
      },
      { status: 400 },
    )
  }
  if (parsed.warnings.length > 0 && !forceWarnings) {
    return NextResponse.json(
      {
        requiresConfirm: true,
        warnings: parsed.warnings,
        rowCount: parsed.rows.length,
      },
      { status: 200 },
    )
  }

  // Resolve every distinct companyCode in the parsed rows to its
  // companyId, scoped to the caller's org. Cross-tenant codes silently
  // drop with an error row to prevent leaking which codes exist in
  // other orgs.
  const codes = Array.from(new Set(parsed.rows.map((r) => r.companyCode)))
  const cos = await prisma.company.findMany({
    where: { organizationId: session.orgId, code: { in: codes } },
    select: { id: true, code: true },
  })
  const codeToId = new Map<string, string>(
    cos.map((c: { id: string; code: string }) => [c.code, c.id]),
  )

  const appliedRows: Array<{ rowNumber: number; id: string; wasUpdate: boolean }> = []
  const rejectedRows: Array<{ rowNumber: number; reason: string }> = []

  for (const r of parsed.rows) {
    const companyId = codeToId.get(r.companyCode)
    if (!companyId) {
      rejectedRows.push({
        rowNumber: r.rowNumber,
        reason: `Unknown companyCode "${r.companyCode}" in your organization.`,
      })
      continue
    }

    const existing = await prisma.operationalFact.findFirst({
      where: {
        organizationId: session.orgId,
        companyId,
        metric: r.metric,
        date: new Date(r.date),
      },
      select: { id: true, value: true },
    })

    let savedId: string
    let wasUpdate = false
    if (existing) {
      const updated = await prisma.operationalFact.update({
        where: { id: existing.id },
        data: {
          value: r.value,
          unit: r.unit,
          source: r.sourceNote ?? "manual-bulk",
        },
        select: { id: true },
      })
      savedId = updated.id
      wasUpdate = true
    } else {
      const created = await prisma.operationalFact.create({
        data: {
          organizationId: session.orgId,
          companyId,
          metric: r.metric,
          date: new Date(r.date),
          value: r.value,
          unit: r.unit,
          source: r.sourceNote ?? "manual-bulk",
        },
        select: { id: true },
      })
      savedId = created.id
    }

    appliedRows.push({ rowNumber: r.rowNumber, id: savedId, wasUpdate })

    // Audit per row — fire-and-forget; bulk imports of 1000+ rows
    // shouldn't be blocked by an audit-table contention.
    void logAuditEvent(prisma, {
      organizationId: session.orgId,
      actorUserId: session.userId,
      event: {
        action: wasUpdate
          ? "operational_fact_update"
          : "operational_fact_create",
        entityType: "OperationalFact",
        entityId: savedId,
        metadata: {
          companyId,
          metric: r.metric,
          date: new Date(r.date).toISOString(),
          value: r.value,
          unit: r.unit,
          sourceNote: r.sourceNote ?? undefined,
          ...(wasUpdate && existing ? { previousValue: existing.value } : {}),
        },
      },
      context: { route: "/api/operational-facts/import" },
    }).catch((err) => {
      log.error("audit log failed", {
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }

  return NextResponse.json({
    dryRun: false,
    rowCount: parsed.rows.length,
    appliedCount: appliedRows.length,
    rejectedCount: rejectedRows.length,
    warnings: parsed.warnings,
    applied: appliedRows,
    rejected: rejectedRows,
  })
}

// Phase 7.M Tier 7 Phase 6 — advertise replacement while keeping the route live.
// Clients receive Sunset / Deprecation / Link headers on every response.
export const POST = withDeprecation({
  replacedBy: "/api/import/ai-auto-multi",
  reason:
    "use AI Import - recognises OPS_FACTS shape (companyCode|metric|date|value|unit); route at /budgeting/admin/ai-import",
})(_POST)
