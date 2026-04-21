import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { loadAndCompute } from "@/lib/cost-model/db"
import { resolveCostModelKey } from "@/lib/budgeting/cost-model-map"

const resolveCostsSchema = z.object({
  keys: z.array(z.string().max(200)).min(1).max(100),
}).strict()

/**
 * POST /api/budgeting/resolve-costs
 * Body: { keys: string[] }
 * Returns: { data: Record<string, number> }
 *
 * Resolves cost model keys to current values.
 * Used by TemplateSeedButton to pre-fill plannedAmount from cost model.
 */
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
    data = resolveCostsSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { keys } = data

  const costModel = await loadAndCompute(orgId).catch(() => null)
  if (!costModel) {
    return NextResponse.json({ success: true, data: {} })
  }

  const resolved: Record<string, number> = {}
  for (const key of keys) {
    resolved[key] = resolveCostModelKey(costModel, key)
  }

  return NextResponse.json({ success: true, data: resolved })
}
