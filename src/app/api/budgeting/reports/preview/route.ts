import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import {
  executeBudgetReport,
  getEntityConfigs,
  getEntityFields,
  getEntityComputedFields,
  ReportConfigError,
  type BudgetReportConfig,
} from "@/lib/budgeting/report-engine"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:budgeting:reports:preview")

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Normalize: accept both "entity" and "entityType"
  const entityType = body.entityType || body.entity
  if (!entityType) {
    return NextResponse.json({ error: "entityType is required" }, { status: 400 })
  }

  const configs = getEntityConfigs()
  if (!configs[entityType]) {
    return NextResponse.json({ error: `Unknown entity: ${entityType}`, available: Object.keys(configs) }, { status: 400 })
  }

  const config: BudgetReportConfig = {
    entityType,
    planId: body.planId,
    columns: body.columns ?? [],
    filters: body.filters ?? [],
    groupBy: body.groupBy,
    periodGroupBy: body.periodGroupBy,
    sortBy: body.sortBy,
    sortOrder: body.sortOrder ?? "desc",
    computedFields: body.computedFields,
    limit: Math.min(body.limit ?? 100, 10000),
  }

  // If no columns specified, use all fields for this entity
  if (config.columns.length === 0) {
    config.columns = getEntityFields(entityType).map(f => ({ field: f.name }))
  }

  try {
    const result = await executeBudgetReport(orgId, config)
    return NextResponse.json({ success: true, ...result })
  } catch (e: unknown) {
    // An invalid field name is the caller's mistake, not a server fault. The
    // Sort By and Filter pickers used to offer relation paths that Prisma
    // rejects, and the panel reported them as "Couldn't build the report".
    if (e instanceof ReportConfigError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    log.error("Report preview error", {
      entityType: config.entityType,
      err: e instanceof Error ? e.message : String(e),
    })
    const message = e instanceof Error ? e.message : "Report execution failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET — return available entities and their fields
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const configs = getEntityConfigs()
  const entities = Object.entries(configs).map(([key, config]) => ({
    key,
    label: key,
    fields: getEntityFields(key),
    hasPlanId: config.hasPlanId,
    hasYearMonth: config.hasYearMonth,
    // Which of variance / execution_pct / margin_pct this source has the
    // operands for. The picker offers only these, instead of offering all
    // three and filling two of them with fabricated numbers.
    computedFields: getEntityComputedFields(key),
  }))

  return NextResponse.json({ success: true, data: entities })
}
