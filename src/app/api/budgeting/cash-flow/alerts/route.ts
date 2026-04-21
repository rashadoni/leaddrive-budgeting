import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const resolveAlertSchema = z.object({
  alertId: z.string().min(1).max(100),
}).strict()

// GET — list active cash flow alerts
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get("year") || new Date().getFullYear().toString())

  const alerts = await prisma.cashFlowAlert.findMany({
    where: { organizationId: orgId, year, isResolved: false },
    orderBy: [{ month: "asc" }],
  })

  return NextResponse.json(alerts)
}

// POST — resolve an alert
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
    data = resolveAlertSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { alertId } = data

  await prisma.cashFlowAlert.updateMany({
    where: { id: alertId, organizationId: orgId },
    data: { isResolved: true },
  })

  return NextResponse.json({ success: true })
}
