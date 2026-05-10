/**
 * Phase 7.G Turn LXXXXI (Phase 5.1.2 — per-org CoA role override).
 *
 * PUT /api/budgeting/chart-of-accounts/[id] — admin-only manual override
 * of `ChartOfAccount.role` for non-AAC charts. Backend foundation
 * (`coa-role.ts` + `CoARole` enum) shipped Turn LXXV; this route exposes
 * the override surface.
 *
 * Auth: admin-only (security boundary — affects P&L aggregation across
 * all P&L-reading consumers per Turn LXXV §5.1).
 *
 * Cross-tenant: `where: { id, organizationId }` not just `id` (rejects
 * sibling-org rewrites).
 *
 * Audit: DEFERRED — `coa_role_change` AuditAction enum value would require
 * a Prisma migration; the dev DB has migration drift (`prisma migrate dev`
 * needs reset which would lose ~10K BudgetLines tracked in CARRYOVER 🔄
 * rows). Filed as 🔄 for future turn when drift is resolved. The PUT
 * mutation is logged in next-auth session events at the framework layer
 * via the `requireRole` audit hook (best-effort backstop).
 *
 * Rate-limit: 30/min per userId (looser than period-locks 10/min — role
 * changes are a one-time setup operation per account, not a recurring
 * action).
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { enforceRateLimit } from "@/lib/rate-limit"

const RATE_LIMIT = { name: "coa-role-update", max: 30, windowMs: 60_000 }

// Mirrors Prisma `CoARole` enum (schema.prisma:1476).
const CoARoleSchema = z.enum([
  "revenue", "cogs", "opex", "finance",
  "tax_costs", "non_operating", "tax", "unknown",
])

const updateBodySchema = z
  .object({
    role: CoARoleSchema.nullable(),
  })
  .strict()

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Missing account id" }, { status: 400 })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = updateBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Cross-tenant guard: composite where-clause rejects sibling-org rewrites.
  // updateMany returns count=0 when no row matches (vs update which throws),
  // letting us return 404 cleanly without try/catch.
  const result = await prisma.chartOfAccount.updateMany({
    where: { id, organizationId: session.orgId },
    data: { role: parsed.role },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 })
  }

  // Re-read to return current row state (Prisma updateMany doesn't return
  // the row).
  const account = await prisma.chartOfAccount.findUnique({ where: { id } })
  return NextResponse.json({ account, updated: true }, { status: 200 })
}
