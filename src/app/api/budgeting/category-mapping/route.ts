import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

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

  const integration = await prisma.accountingIntegration.findFirst({
    where: { id: integrationId, organizationId: orgId },
    select: { categoryMapping: true, name: true },
  })

  if (!integration) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 })
  }

  // Also return available budget cost types for mapping targets
  const costTypes = await prisma.budgetCostType.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, code: true, lineType: true },
    orderBy: { name: "asc" },
  })

  return NextResponse.json({
    mapping: integration.categoryMapping,
    integrationName: integration.name,
    costTypes,
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

  const updated = await prisma.accountingIntegration.updateMany({
    where: { id: integrationId, organizationId: orgId },
    data: { categoryMapping: mapping },
  })

  if (updated.count === 0) {
    return NextResponse.json({ error: "Integration not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
