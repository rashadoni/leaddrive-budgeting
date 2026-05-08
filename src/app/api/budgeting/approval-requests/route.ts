/**
 * Phase 7.G Turn LXXI (Phase 4.3 — approval workflow MVP).
 *
 * GET — list approval requests for the caller's org. Filters:
 *   - `?status=pending|approved|rejected|cancelled` (optional)
 *   - `?planId=<id>` (optional)
 *   Default order: requestedAt DESC. Visible to any authenticated org
 *   member (a team can see what's pending review even if they can't
 *   approve). Pagination is `take` only (50) for v1; ROADMAP follow-up
 *   if list grows beyond a single screen.
 *
 * POST — create an approval request. Any authenticated user can request
 *   (the typical case is a manager hitting a 403/423 wall and asking
 *   admin to bless the change). Validates `requestType` against the
 *   `proposedChange` shape via `isValidProposedChange`. Status starts
 *   as `pending`.
 *
 * Audit: POST does NOT emit an audit event for the create itself —
 * the request is metadata, not a budget mutation. PATCH-approve emits
 * `period_lock_remove` / line/actual mutation events as appropriate
 * (see `[id]/route.ts`).
 *
 * Rate-limit: 30/min keyed on userId. Higher than period-locks (10/min)
 * because legitimate bulk-edit sessions might fire multiple requests
 * back-to-back.
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { enforceRateLimit } from "@/lib/rate-limit"
import { isValidProposedChange } from "@/lib/budgeting/approval-request"
import type { Prisma } from "@prisma/client"

const RATE_LIMIT = { name: "approval-requests-create", max: 30, windowMs: 60_000 }
const LIST_TAKE = 50

const requestTypeEnum = z.enum([
  "budget_line_create",
  "budget_line_update",
  "budget_line_delete",
  "budget_actual_create",
  "budget_actual_update",
  "budget_actual_delete",
  "period_unlock",
])

const statusEnum = z.enum(["pending", "approved", "rejected", "cancelled"])

const createBodySchema = z
  .object({
    requestType: requestTypeEnum,
    planId: z.string().max(100).optional().nullable(),
    targetType: z.string().max(50).optional().nullable(),
    targetId: z.string().max(100).optional().nullable(),
    proposedChange: z.unknown(), // shape-validated downstream via isValidProposedChange
    reason: z.string().max(500).optional(),
  })
  .strict()

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const url = req.nextUrl
  const statusRaw = url.searchParams.get("status")
  const planIdRaw = url.searchParams.get("planId")

  // Validate status param if provided — silent ignore on bad value would
  // mask client bugs.
  let statusFilter: ReturnType<typeof statusEnum.safeParse>["data"] | undefined
  if (statusRaw) {
    const parsed = statusEnum.safeParse(statusRaw)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 })
    }
    statusFilter = parsed.data
  }

  const where: Prisma.ApprovalRequestWhereInput = {
    organizationId: session.orgId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(planIdRaw ? { planId: planIdRaw } : {}),
  }

  const requests = await prisma.approvalRequest.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }],
    take: LIST_TAKE,
  })

  return NextResponse.json({ requests })
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = createBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Shape-validate proposedChange against the requestType. Json blob
  // gives us flexibility; the guard is the runtime brake.
  if (!isValidProposedChange(parsed.requestType, parsed.proposedChange)) {
    return NextResponse.json(
      {
        error: "proposedChange shape does not match requestType",
        requestType: parsed.requestType,
      },
      { status: 400 },
    )
  }

  // Cross-tenant guard for planId (when provided). Don't let a user
  // request approval against a plan in another org.
  if (parsed.planId) {
    const planOwned = await prisma.budgetPlan.findFirst({
      where: { id: parsed.planId, organizationId: session.orgId },
      select: { id: true },
    })
    if (!planOwned) {
      return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
    }
  }

  const created = await prisma.approvalRequest.create({
    data: {
      organizationId: session.orgId,
      planId: parsed.planId ?? null,
      requestType: parsed.requestType,
      targetType: parsed.targetType ?? null,
      targetId: parsed.targetId ?? null,
      proposedChange: parsed.proposedChange as Prisma.InputJsonValue,
      reason: parsed.reason ?? null,
      requestedBy: session.userId,
      // status defaults to 'pending' via schema
    },
  })

  return NextResponse.json({ request: created }, { status: 201 })
}
