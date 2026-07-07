import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { withOrgScope } from "@/lib/db/with-org-scope"
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

  const orgId = session.orgId
  const comments = await withOrgScope(orgId, (tx) =>
    tx.budgetApprovalComment.findMany({
      where: { planId, organizationId: orgId },
      orderBy: { createdAt: "asc" },
    }),
  )

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
  const orgId = session.orgId

  const created = await withOrgScope(orgId, async (tx) => {
    // Verify plan exists and belongs to org
    const plan = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId },
    })
    if (!plan) return null

    return tx.budgetApprovalComment.create({
      data: {
        organizationId: orgId,
        planId,
        userId: session.userId,
        userName: session.name,
        status: status || "comment",
        comment,
      },
    })
  })
  if (!created) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }

  return NextResponse.json(created, { status: 201 })
}
