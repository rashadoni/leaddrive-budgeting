import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

/**
 * Phase 7.G Turn LXII — Zod-validated POST body (audit C1 closure).
 *
 * Pre-LXII: `data: { ...body, organizationId: orgId }` accepted ANY field
 * the ProductLine model has. Authenticated viewer could POST `id` /
 * `createdAt` / `updatedAt` / `organizationId` (override the auth-derived
 * value!) and Prisma would write whatever was provided. Real injection
 * surface despite auth gate.
 *
 * Post-LXII: `.strict()` Zod schema rejects unknown keys; only
 * client-writable fields make it through. Server-controlled fields
 * (id/createdAt/updatedAt/organizationId) are never accepted from the
 * client — id auto-cuid, timestamps auto, organizationId from session.
 */
const createProductLineSchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(500),
    unit: z.string().min(1).max(32),
    revenueAccountCode: z.string().max(64).optional().nullable(),
    cogsAccountCode: z.string().max(64).optional().nullable(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const lines = await prisma.productLine.findMany({
    where: { organizationId: orgId },
    include: { salesBudgetLines: true, costComponents: true },
    orderBy: { sortOrder: "asc" },
  })
  return NextResponse.json(lines)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createProductLineSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid body",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  const line = await prisma.productLine.create({
    data: { ...parsed.data, organizationId: orgId },
  })
  return NextResponse.json(line, { status: 201 })
}
