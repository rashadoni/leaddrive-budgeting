/**
 * Trade master-data import — `POST /api/trade/master-import` (Phase 9.2).
 *
 * multipart/form-data:
 *   file  — xlsx blob (required)
 *   kind  — master_outlets | master_skus | master_reps (required)
 *   mode  — preview | apply (default preview)
 *   sheetName — optional; defaults to the first sheet
 *
 * preview: parses + validates, returns columnMap/rowCount/sample/errors.
 * Nothing is written. apply: same parse, then upserts inside one
 * transaction, batch-scoped via TradeImportBatch (content-hash idempotent —
 * re-uploading an already-applied file is a no-op). Regions/channels are
 * auto-derived from outlet/rep rows (codeFromName); reps referenced by
 * outlets but not yet imported become placeholder rows (name = code) that a
 * later master_reps import fills in.
 *
 * Deterministic header-synonym mapping only — no LLM (see
 * src/lib/trade/master-import.ts). Auth: manager (matches the other import
 * producers). Audit: trade_import_apply on successful apply.
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { createHash } from "crypto"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"
import { logAuditEvent } from "@/lib/audit/log"
import {
  parseMasterCells,
  deriveDimensionPlan,
  codeFromName,
  type MasterKind,
  type OutletRow,
  type SkuRow,
  type RepRow,
} from "@/lib/trade/master-import"

export const maxDuration = 60

const RATE_LIMIT = { name: "trade-master-import", max: 20, windowMs: 60 * 60_000 }
const KINDS: readonly MasterKind[] = ["master_outlets", "master_skus", "master_reps"]
const SAMPLE_SIZE = 20
const UPDATE_CHUNK = 50

interface ApplyCounts {
  created: number
  updated: number
  regionsCreated: number
  channelsCreated: number
  placeholderRepsCreated: number
}

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
  if (file.size > MAX_IMPORT_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: `File too large (${(file.size / 1e6).toFixed(1)} MB > 10 MB)` },
      { status: 413 },
    )
  }
  const filename = (file as Blob & { name?: string }).name ?? "upload.xlsx"
  if (!/\.xlsx$/i.test(filename)) {
    return NextResponse.json({ ok: false, error: "Only .xlsx files are accepted" }, { status: 415 })
  }

  const kind = String(form.get("kind") ?? "").trim() as MasterKind
  if (!KINDS.includes(kind)) {
    return NextResponse.json(
      { ok: false, error: `Invalid 'kind' — expected one of: ${KINDS.join(", ")}` },
      { status: 400 },
    )
  }
  const mode = String(form.get("mode") ?? "preview").trim()
  if (mode !== "preview" && mode !== "apply") {
    return NextResponse.json({ ok: false, error: "Invalid 'mode' — expected preview | apply" }, { status: 400 })
  }

  let workbook: XLSX.WorkBook
  let buf: Buffer
  try {
    buf = Buffer.from(await file.arrayBuffer())
    workbook = XLSX.read(buf, { type: "buffer", cellFormula: false, cellHTML: false })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Invalid xlsx: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }
  const sheetName = String(form.get("sheetName") ?? "").trim() || workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return NextResponse.json({ ok: false, error: `Sheet "${sheetName}" not found in workbook` }, { status: 400 })
  }
  // Same DoS guard as /api/onboarding/import/analyze — bound the grid
  // before sheet_to_json expands it.
  const ref = sheet["!ref"]
  if (ref) {
    const range = XLSX.utils.decode_range(ref)
    const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1)
    if (cells > 500_000) {
      return NextResponse.json(
        { ok: false, error: `Sheet "${sheetName}" is too large (${cells.toLocaleString()} cells)` },
        { status: 413 },
      )
    }
  }

  const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
  const parsed = parseMasterCells(kind, cells)

  if (mode === "preview") {
    return NextResponse.json({
      ok: true,
      mode,
      kind,
      sheetName,
      headerRowIndex: parsed.headerRowIndex,
      columnMap: parsed.columnMap,
      rowCount: parsed.rows.length,
      sample: parsed.rows.slice(0, SAMPLE_SIZE),
      errors: parsed.errors,
      warnings: parsed.warnings,
      canApply: parsed.errors.length === 0,
    })
  }

  // ── apply ──────────────────────────────────────────────────────────────
  if (parsed.errors.length > 0) {
    return NextResponse.json(
      { ok: false, error: "File has validation errors — fix them and re-upload", errors: parsed.errors },
      { status: 422 },
    )
  }

  const fileHash = createHash("sha256").update(buf).digest("hex")
  const existing = await prisma.tradeImportBatch.findUnique({
    where: {
      organizationId_kind_sourceSystem_fileHash: {
        organizationId: orgId,
        kind,
        sourceSystem: "file",
        fileHash,
      },
    },
    select: { id: true, status: true, appliedAt: true },
  })
  if (existing && existing.status === "applied") {
    return NextResponse.json({
      ok: true,
      mode,
      kind,
      alreadyImported: true,
      batchId: existing.id,
      appliedAt: existing.appliedAt?.toISOString() ?? null,
    })
  }

  const plan = deriveDimensionPlan(kind, parsed.rows)
  const counts: ApplyCounts = {
    created: 0,
    updated: 0,
    regionsCreated: 0,
    channelsCreated: 0,
    placeholderRepsCreated: 0,
  }

  const batchId = await prisma.$transaction(
    async (tx) => {
      // 1. Dimensions referenced by the rows (create-if-missing; existing
      //    codes keep their current name — renames go through a UI, not a
      //    side effect of an import).
      if (plan.regions.length > 0) {
        const have = await tx.tradeRegion.findMany({
          where: { organizationId: orgId, code: { in: plan.regions.map((r) => r.code) } },
          select: { code: true },
        })
        const haveSet = new Set(have.map((r) => r.code))
        const missing = plan.regions.filter((r) => !haveSet.has(r.code))
        if (missing.length > 0) {
          await tx.tradeRegion.createMany({
            data: missing.map((r) => ({ organizationId: orgId, code: r.code, name: r.name })),
          })
          counts.regionsCreated = missing.length
        }
      }
      if (plan.channels.length > 0) {
        const have = await tx.tradeChannel.findMany({
          where: { organizationId: orgId, code: { in: plan.channels.map((c) => c.code) } },
          select: { code: true },
        })
        const haveSet = new Set(have.map((c) => c.code))
        const missing = plan.channels.filter((c) => !haveSet.has(c.code))
        if (missing.length > 0) {
          await tx.tradeChannel.createMany({
            data: missing.map((c) => ({
              organizationId: orgId,
              code: c.code,
              name: c.name,
              channelType: c.channelType,
            })),
          })
          counts.channelsCreated = missing.length
        }
      }

      const regionIdByCode = new Map(
        (
          await tx.tradeRegion.findMany({
            where: { organizationId: orgId },
            select: { id: true, code: true },
          })
        ).map((r) => [r.code, r.id]),
      )
      const channelIdByCode = new Map(
        (
          await tx.tradeChannel.findMany({
            where: { organizationId: orgId },
            select: { id: true, code: true },
          })
        ).map((c) => [c.code, c.id]),
      )

      // 2. Placeholder reps for codes referenced by outlet rows.
      if (plan.referencedRepCodes.length > 0) {
        const have = await tx.tradeSalesRep.findMany({
          where: { organizationId: orgId, externalCode: { in: plan.referencedRepCodes } },
          select: { externalCode: true },
        })
        const haveSet = new Set(have.map((r) => r.externalCode))
        const missing = plan.referencedRepCodes.filter((c) => !haveSet.has(c))
        if (missing.length > 0) {
          await tx.tradeSalesRep.createMany({
            data: missing.map((code) => ({ organizationId: orgId, externalCode: code, name: code })),
          })
          counts.placeholderRepsCreated = missing.length
        }
      }
      const repIdByCode = new Map(
        (
          await tx.tradeSalesRep.findMany({
            where: { organizationId: orgId },
            select: { id: true, externalCode: true },
          })
        ).map((r) => [r.externalCode, r.id]),
      )

      // 3. Entity rows — split create vs update by externalCode.
      if (kind === "master_outlets") {
        const rows = parsed.rows as OutletRow[]
        const have = new Set(
          (
            await tx.tradeOutlet.findMany({
              where: { organizationId: orgId, externalCode: { in: rows.map((r) => r.externalCode) } },
              select: { externalCode: true },
            })
          ).map((o) => o.externalCode),
        )
        const toData = (r: OutletRow) => ({
          name: r.name,
          legalName: r.legalName ?? null,
          taxId: r.taxId ?? null,
          chainCode: r.chainCode ?? null,
          regionId: regionIdByCode.get(codeFromName(r.regionName))!,
          channelId: channelIdByCode.get(codeFromName(r.channelName))!,
          salesRepId: r.repCode ? (repIdByCode.get(r.repCode) ?? null) : null,
          isActive: true,
          deletedAt: null,
          deletedBy: null,
        })
        const fresh = rows.filter((r) => !have.has(r.externalCode))
        if (fresh.length > 0) {
          await tx.tradeOutlet.createMany({
            data: fresh.map((r) => ({ organizationId: orgId, externalCode: r.externalCode, ...toData(r) })),
          })
          counts.created = fresh.length
        }
        const stale = rows.filter((r) => have.has(r.externalCode))
        for (let i = 0; i < stale.length; i += UPDATE_CHUNK) {
          await Promise.all(
            stale.slice(i, i + UPDATE_CHUNK).map((r) =>
              tx.tradeOutlet.update({
                where: {
                  organizationId_externalCode: { organizationId: orgId, externalCode: r.externalCode },
                },
                data: toData(r),
              }),
            ),
          )
        }
        counts.updated = stale.length
      } else if (kind === "master_skus") {
        const rows = parsed.rows as SkuRow[]
        const have = new Set(
          (
            await tx.tradeSku.findMany({
              where: { organizationId: orgId, externalCode: { in: rows.map((r) => r.externalCode) } },
              select: { externalCode: true },
            })
          ).map((s) => s.externalCode),
        )
        const toData = (r: SkuRow) => ({
          name: r.name,
          brand: r.brand,
          category: r.category,
          barcode: r.barcode ?? null,
          packageSize: r.packageSize ?? null,
          ...(r.unit ? { unit: r.unit } : {}),
          isActive: true,
          deletedAt: null,
          deletedBy: null,
        })
        const fresh = rows.filter((r) => !have.has(r.externalCode))
        if (fresh.length > 0) {
          await tx.tradeSku.createMany({
            data: fresh.map((r) => ({ organizationId: orgId, externalCode: r.externalCode, ...toData(r) })),
          })
          counts.created = fresh.length
        }
        const stale = rows.filter((r) => have.has(r.externalCode))
        for (let i = 0; i < stale.length; i += UPDATE_CHUNK) {
          await Promise.all(
            stale.slice(i, i + UPDATE_CHUNK).map((r) =>
              tx.tradeSku.update({
                where: {
                  organizationId_externalCode: { organizationId: orgId, externalCode: r.externalCode },
                },
                data: toData(r),
              }),
            ),
          )
        }
        counts.updated = stale.length
      } else {
        const rows = parsed.rows as RepRow[]
        const have = new Set(
          (
            await tx.tradeSalesRep.findMany({
              where: { organizationId: orgId, externalCode: { in: rows.map((r) => r.externalCode) } },
              select: { externalCode: true },
            })
          ).map((r) => r.externalCode),
        )
        const toData = (r: RepRow) => ({
          name: r.name,
          regionId: r.regionName ? (regionIdByCode.get(codeFromName(r.regionName)) ?? null) : null,
          channelId: r.channelName ? (channelIdByCode.get(codeFromName(r.channelName)) ?? null) : null,
          isActive: true,
          deletedAt: null,
          deletedBy: null,
        })
        const fresh = rows.filter((r) => !have.has(r.externalCode))
        if (fresh.length > 0) {
          await tx.tradeSalesRep.createMany({
            data: fresh.map((r) => ({ organizationId: orgId, externalCode: r.externalCode, ...toData(r) })),
          })
          counts.created = fresh.length
        }
        const stale = rows.filter((r) => have.has(r.externalCode))
        for (let i = 0; i < stale.length; i += UPDATE_CHUNK) {
          await Promise.all(
            stale.slice(i, i + UPDATE_CHUNK).map((r) =>
              tx.tradeSalesRep.update({
                where: {
                  organizationId_externalCode: { organizationId: orgId, externalCode: r.externalCode },
                },
                data: toData(r),
              }),
            ),
          )
        }
        counts.updated = stale.length
      }

      // 4. Supersede the previous active batch of this kind, then record
      //    this one as the active source of truth.
      const prev = await tx.tradeImportBatch.findFirst({
        where: { organizationId: orgId, kind, isActive: true },
        select: { id: true },
      })
      if (prev) {
        await tx.tradeImportBatch.update({
          where: { id: prev.id },
          data: { isActive: false, status: "superseded" },
        })
      }
      const batch = await tx.tradeImportBatch.create({
        data: {
          organizationId: orgId,
          kind,
          sourceSystem: "file",
          sourceFile: filename,
          fileHash,
          status: "applied",
          isActive: true,
          rowCount: parsed.rows.length,
          totals: counts as unknown as object,
          validation: { errors: 0, warnings: parsed.warnings.length } as unknown as object,
          supersedesBatchId: prev?.id ?? null,
          createdBy: session.userId,
          appliedAt: new Date(),
        },
        select: { id: true },
      })
      return batch.id
    },
    { timeout: 60_000, maxWait: 10_000 },
  )

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "trade_import_apply",
      entityType: "TradeImportBatch",
      entityId: batchId,
      metadata: { kind, sourceFile: filename, rowCount: parsed.rows.length, ...counts },
    },
  })

  return NextResponse.json({ ok: true, mode, kind, batchId, rowCount: parsed.rows.length, counts })
}
