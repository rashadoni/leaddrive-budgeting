import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const createRateSchema = z.object({
  currencyCode: z.string().min(1).max(10),
  rate: z.union([z.string().min(1), z.number().min(0).max(999999999)]),
  rateDate: z.string().max(50).optional(),
}).strict()

// GET — list exchange rate history
// ?currencyCode=USD&limit=50
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const currencyCode = req.nextUrl.searchParams.get("currencyCode")
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100")

  const where: any = { organizationId: orgId }
  if (currencyCode) where.currencyCode = currencyCode

  const rates = await prisma.currencyRateHistory.findMany({
    where,
    orderBy: { rateDate: "desc" },
    take: limit,
  })

  // Also get current currencies for reference
  const currencies = await prisma.currency.findMany({
    where: { organizationId: orgId },
    orderBy: { code: "asc" },
  })

  return NextResponse.json({ rates, currencies })
}

// POST — add a new exchange rate entry
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
    data = createRateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { currencyCode, rate, rateDate } = data

  const entry = await prisma.currencyRateHistory.create({
    data: {
      organizationId: orgId,
      currencyCode,
      rate: parseFloat(String(rate)),
      rateDate: rateDate ? new Date(rateDate) : new Date(),
    },
  })

  // Also update the Currency table's exchangeRate for convenience
  await prisma.currency.updateMany({
    where: { organizationId: orgId, code: currencyCode },
    data: { exchangeRate: parseFloat(String(rate)) },
  })

  return NextResponse.json(entry, { status: 201 })
}
