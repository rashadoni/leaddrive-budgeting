import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { previewCompanyImportReset } from "@/lib/server/archive"

interface PreviewBody {
  entityKind?: unknown
  companyCode?: unknown
  companyCodes?: unknown
  year?: unknown
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

  const companyCodes = Array.isArray(body.companyCodes)
    ? [
        ...new Set(
          body.companyCodes.filter(
            (c): c is string => typeof c === "string" && c.length > 0,
          ),
        ),
      ].slice(0, 200)
    : typeof body.companyCode === "string" && body.companyCode.length > 0
      ? [body.companyCode]
      : []

  if (companyCodes.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one company is required" },
      { status: 400 },
    )
  }

  const year =
    typeof body.year === "number" && Number.isInteger(body.year)
      ? body.year
      : undefined

  try {
    const preview = await previewCompanyImportReset({
      prisma,
      organizationId: session.orgId,
      companyCodes,
      year,
    })
    return NextResponse.json({ ok: true, preview })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }
}
