import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { previewCompanyImportReset } from "@/lib/server/archive"
import { parseDeleteSelection, parseCompanyCodes } from "@/lib/server/delete-request"
import { parseLockedPeriods } from "@/lib/budgeting/period-lock"

interface PreviewBody {
  entityKind?: unknown
  companyCode?: unknown
  companyCodes?: unknown
  year?: unknown
  years?: unknown
  include?: unknown
  includeUnscoped?: unknown
  includeManualActuals?: unknown
  yearIndex?: unknown
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }

  let body: PreviewBody
  try {
    body = (await request.json()) as PreviewBody
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  if (body.entityKind !== "AllImportData") {
    return NextResponse.json(
      { ok: false, error: "Preview currently supports entityKind=AllImportData only" },
      { status: 400 },
    )
  }

  const companyCodes = parseCompanyCodes(body)

  if (companyCodes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one company is required" },
      { status: 400 },
    )
  }

  const selection = parseDeleteSelection(body)

  try {
    const preview = await previewCompanyImportReset({
      prisma,
      organizationId: session.orgId,
      companyCodes,
      ...selection,
      yearIndex: body.yearIndex === true,
    })
    // Locks travel with the preview so the UI can grey out a closed year
    // BEFORE the operator types a confirmation token and eats a 423.
    const org = await prisma.organization.findUnique({
      where: { id: session.orgId },
      select: { lockedPeriods: true },
    })
    const locks = parseLockedPeriods(org?.lockedPeriods).map((l) => ({
      period: l.period,
      lockedAt: l.lockedAt,
      lockedBy: l.lockedBy,
      reason: l.reason,
    }))
    return NextResponse.json({ ok: true, preview, locks })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
