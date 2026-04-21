import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const createIntegrationSchema = z.object({
  provider: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  categoryMapping: z.record(z.string(), z.unknown()).optional(),
}).strict()

const deleteIntegrationSchema = z.object({
  id: z.string().min(1).max(100),
}).strict()

// GET — list accounting integrations
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const integrations = await prisma.accountingIntegration.findMany({
    where: { organizationId: orgId },
    include: { imports: { take: 5, orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(integrations)
}

// POST — create a new integration
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
    data = createIntegrationSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { provider, name, config, categoryMapping } = data

  const integration = await prisma.accountingIntegration.create({
    data: {
      organizationId: orgId,
      provider,
      name,
      config: config || {},
      categoryMapping: categoryMapping || {},
    },
  })

  return NextResponse.json(integration, { status: 201 })
}

// DELETE — remove integration
export async function DELETE(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let delBody
  try {
    delBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let delData
  try {
    delData = deleteIntegrationSchema.parse(delBody)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { id } = delData

  await prisma.accountingIntegration.deleteMany({
    where: { id, organizationId: orgId },
  })

  return NextResponse.json({ success: true })
}
