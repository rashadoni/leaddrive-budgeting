import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

const categoryMappingSchema = z.object({
  integrationId: z.string().min(1).max(100),
  mapping: z.record(z.string(), z.string().max(500)),
}).strict()

// GET — get category mapping for an integration
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const integrationId = req.nextUrl.searchParams.get("integrationId")
  if (!integrationId) {
    return NextResponse.json({ error: "integrationId required" }, { status: 400 })
  }

  // Stage 3 RLS — both reads in one org-scoped tx.
  const result = await withOrgScope(orgId, async (tx) => {
    const integration = await tx.accountingIntegration.findFirst({
      where: { id: integrationId, organizationId: orgId },
      select: { categoryMapping: true, name: true },
    })
    if (!integration) return null
    const costTypes = await tx.budgetCostType.findMany({
      where: { organizationId: orgId },
      select: { id: true, key: true, label: true },
      orderBy: { label: "asc" },
    })
    return { integration, costTypes }
  })

  if (!result) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 })
  }

  return NextResponse.json({
    mapping: result.integration.categoryMapping,
    integrationName: result.integration.name,
    costTypes: result.costTypes,
  })
}

// POST — update category mapping
export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = categoryMappingSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { integrationId, mapping } = data

  const updated = await withOrgScope(orgId, (tx) =>
    tx.accountingIntegration.updateMany({
      where: { id: integrationId, organizationId: orgId },
      data: { categoryMapping: mapping },
    }),
  )

  if (updated.count === 0) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
