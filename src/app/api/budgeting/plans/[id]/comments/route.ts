import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"

const commentSchema = z.object({
  comment: z.string().min(1).max(2000),
  status: z.string().max(50).optional(),
}).strict()

// GET — list approval comments for a plan
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: planId } = await params

  const comments = await prisma.budgetApprovalComment.findMany({
    where: { planId, organizationId: session.orgId },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(comments)
}

// POST — add an approval comment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: planId } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = commentSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { comment, status } = data

  // Verify plan exists and belongs to org
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: session.orgId },
  })
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }

  const created = await prisma.budgetApprovalComment.create({
    data: {
      organizationId: session.orgId,
      planId,
      userId: session.userId,
      userName: session.name,
      status: status || "comment",
      comment,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
