import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Stage 3 RLS — read in the org-scoped tx.
  const accounts = await withOrgScope(orgId, (tx) =>
    tx.chartOfAccount.findMany({
      where: { organizationId: orgId },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
  )
  return NextResponse.json(accounts)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  // Stage 3 RLS — create in the org-scoped tx (organizationId forced from
  // the session, never the body — WITH CHECK rejects any mismatch anyway).
  const account = await withOrgScope(orgId, (tx) =>
    tx.chartOfAccount.create({
      data: { ...body, organizationId: orgId },
    }),
  )
  return NextResponse.json(account, { status: 201 })
}
