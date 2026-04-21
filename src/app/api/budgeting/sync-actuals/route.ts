import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"

const syncActualsSchema = z.object({
  planId: z.string().min(1).max(100),
}).strict()

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
    data = syncActualsSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId } = data

  const [plan, lines] = await Promise.all([
    prisma.budgetPlan.findFirst({ where: { id: planId, organizationId: orgId } }),
    prisma.budgetLine.findMany({ where: { planId, organizationId: orgId, isAutoActual: true } }),
  ])

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  if (lines.length === 0) {
    return NextResponse.json({ success: true, data: { synced: 0 } })
  }

  const costModel = await loadAndCompute(orgId).catch(() => null)
  if (!costModel) {
    return NextResponse.json({ error: "Cost model unavailable" }, { status: 503 })
  }

  const now = new Date()
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  let synced = 0

  for (const line of lines) {
    if (!line.costModelKey) continue
    const amount = resolveCostModelKey(costModel, line.costModelKey)
    if (amount <= 0) continue

    // Upsert: find existing actual for this category+month or create new
    const existing = await prisma.budgetActual.findFirst({
      where: {
        planId,
        organizationId: orgId,
        category: line.category,
        description: { startsWith: "auto-sync:" },
      },
    })

    if (existing) {
      await prisma.budgetActual.update({
        where: { id: existing.id },
        data: { actualAmount: amount, expenseDate: currentDate },
      })
    } else {
      await prisma.budgetActual.create({
        data: {
          organizationId: orgId,
          planId,
          category: line.category,
          department: line.department,
          lineType: line.lineType,
          actualAmount: amount,
          expenseDate: currentDate,
          description: `auto-sync: ${line.costModelKey}`,
        },
      })
    }
    synced++
  }

  return NextResponse.json({ success: true, data: { synced } })
}
