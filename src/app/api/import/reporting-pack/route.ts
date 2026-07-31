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
import { getActivePeriodLock } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { acquireImportLock, type ImportLock } from "@/lib/onboarding/import-lock"

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

  // ── Period-lock gate (Phase 11.34) ──────────────────────────────
  // 11.13 put this on /api/import/ai-auto-multi, the other bulk-import
  // mutation, and left this route without it. Both write the same
  // BudgetLine / CashFlowEntry rows for a year, so a locked period stayed
  // rewritable through whichever door had no gate.
  //
  // APPLY only: a preview writes nothing, and refusing to LOOK at a closed
  // year is not what a lock means.
  if (shouldApply) {
    const lock = await getActivePeriodLock(prisma, orgId, String(year))
    if (lock) {
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId: session.userId ?? null,
        route: "POST /api/import/reporting-pack",
      })
    }
  }

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

  // entityCode → companyId for the post-apply recompute.
  // Phase 11.11 — was filtered to `startsWith: "AZSEKER"`, so any other
  // entity in the org silently got no recompute after its rows landed.
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, status: { not: "archived" } },
    select: { id: true, code: true },
  })
  const codeToId = new Map(companies.map((c) => [c.code, c.id]))

  // 11.40 — a recompute that silently downgraded to year-only has to say so
  // on the screen. The trigger reports it; this route listened to nothing.
  const recomputeWarnings: string[] = []

  // ── 11.41: mutual exclusion, APPLY only ──────────────────────────
  // A preview writes nothing, so concurrent previews are harmless and must
  // not be refused. 11.8 put this lock on /api/import/ai-auto-multi and left
  // this route without it — and both are clean-slate (archive-in-scope, then
  // insert) over the SAME BudgetLine / CashFlowEntry rows for a year. Two
  // concurrent applies interleave as: A archives N and inserts N, B archives
  // 0 (A already did) and inserts N — a full duplicate set.
  // `assertNoCollateralDeletion` cannot see it (it fires on OVER-deletion; B
  // under-deleted) and CashFlowEntry carries no unique constraint that would
  // reject the second copy.
  //
  // Same scope string as ai-auto-multi on purpose: the two routes write the
  // same rows, so this must also exclude a concurrent AI Auto Import.
  let importLock: ImportLock | null = null
  if (shouldApply) {
    try {
      importLock = await acquireImportLock(orgId, year)
    } catch (err) {
      // The acquire dials its OWN pg connection. Outside a try, a missing DSN
      // or refused connection threw straight out of POST and Next rendered
      // the raw pg message — which carries host:port — defeating the whole
      // point of the sanitising catch below.
      return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 500 })
    }
    if (!importLock.acquired) {
      // Released even when NOT acquired: release() is what closes the
      // dedicated client, so skipping it leaks a connection per refusal.
      await importLock.release()
      return NextResponse.json(
        {
          ok: false,
          error:
            `Another import is already running for this organization and ${year}. ` +
            "Wait for it to finish before starting a second one — running both " +
            "would duplicate every row they share.",
          code: "IMPORT_IN_PROGRESS",
          scope: importLock.scope,
        },
        { status: 409 },
      )
    }
  }

  try {
    const result = await runReportingPackImport(
      {
        workbook: wb,
        organizationId: orgId,
        year,
        mode: shouldApply ? "apply" : "preview",
        // 11.60 — a run id is what makes the importer persist an
        // ImportBatchReport for this apply. Without one the newest row in
        // `import_batch_reports` still described the PREVIOUS import, and
        // that row is what /api/import/reports presents as reconciliation
        // evidence. A preview passes none: it writes nothing to attest to.
        ...(shouldApply
          ? {
              runId: `reporting-pack:${orgId}:${year}:${Date.now()}`,
              filenames: [fileName],
              actorUserId: session.userId ?? null,
            }
          : {}),
      },
      {
        prisma,
        XLSX,
        onAfterApply: async (entityCodes) => {
          const affected = entityCodes
            .map((code) => codeToId.get(code))
            .filter((id): id is string => Boolean(id))
            .map((companyId) => ({ companyId, year }))
          if (affected.length > 0) {
            // 11.40 — this pack is MONTHLY: every detail sheet is account ×
            // month. The reset deletes "YYYY", "YYYY-Qn" and "YYYY-MM"
            // IndicatorValue rows alike (`archive.ts:824-831`), but this call
            // took the default `granularity: 'year'`, so a reset followed by a
            // reporting-pack re-import rebuilt ONE period out of seventeen and
            // left every monthly and quarterly cell — and the 12-slot
            // sparklines that read them — empty. The ai-auto-multi
            // orchestrator writes the same rows and has always opted in
            // (`multi-file-orchestrator.ts:1823`); this route simply never did.
            const rc = await runRecomputeForCompanies(
              prisma,
              orgId,
              affected,
              {},
              { granularity: "year+quarter+month" },
            )
            // The trigger silently falls back to year-only past its fan-out
            // ceiling and reports it ONLY through this flag. Swallowing it
            // would recreate the same empty-cell surprise the fix removes,
            // just less often.
            if (rc.granularityDowngraded) {
              recomputeWarnings.push(
                "Recompute exceeded the granular fan-out ceiling and fell back to YEAR periods only — monthly and quarterly indicator cells were NOT refreshed by this import.",
              )
            }
          }
        },
      },
    )
    return NextResponse.json({
      ok: true,
      ...result,
      warnings: [...result.warnings, ...recomputeWarnings],
    })
  } catch (err) {
    // Sanitised — never leak raw provider/DB internals to the import screen.
    return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 500 })
  } finally {
    // Every exit path, the sanitised 500 included: the lock pins a REAL pg
    // connection (session-scoped), so a missed release leaks it AND blocks
    // every later import of this (org, year) until the process dies.
    //
    // Swallowed deliberately. A throw from `finally` DISCARDS the returned
    // response, so a rejecting release() would report a COMMITTED apply as a
    // 500 — and the operator re-runs the import, producing exactly the
    // duplicate set this lock exists to prevent. The unlock is best-effort
    // regardless: release() marks itself released first and ends its client
    // in its own finally, and Postgres drops a session lock when the
    // connection dies.
    try {
      await importLock?.release()
    } catch {
      /* best-effort — see above */
    }
  }
}
