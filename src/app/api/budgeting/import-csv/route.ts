// rls-scan-ignore: DEPRECATED bulk importer (replacedBy /api/import/ai-auto-multi).
// Its per-row loop creates up to 50k budget_actuals — that cannot run inside a
// single interactive withOrgScope tx (timeout + long lock hold), and the route
// is pending removal. It therefore uses the explicit `prismaAdmin` (BYPASSRLS)
// client with per-query `organizationId` filters (app-layer scoping preserved),
// which survives the Stage-3 env-flip without a risky giant transaction. When
// the route is deleted this marker goes with it.
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession } from "@/lib/api-auth"
import { logBudgetChange } from "@/lib/prisma"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { deriveMonthIndex } from "@/lib/budgeting/derive-month-index"
import { withDeprecation } from "@/lib/api-deprecation"
import { getLogger } from "@/lib/log"

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("api:budgeting:import-csv")

const importCsvSchema = z.object({
  planId: z.string().min(1).max(100),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
  integrationId: z.string().max(100).optional().nullable(),
  fileName: z.string().max(500).optional(),
}).strict()

// POST — import CSV data as budget actuals
// Accepts JSON array of rows: [{ category, department, amount, date, description, lineType }]
async function _POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = importCsvSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { planId, rows, integrationId, fileName } = data

  const MAX_ROWS = 50000
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Maximum ${MAX_ROWS} rows allowed` }, { status: 400 })
  }

  // Verify planId belongs to caller's org (prevents cross-tenant attribution)
  // + extend select with period fields for the period-lock check below.
  const planOwned = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { id: true, periodType: true, year: true, month: true, quarter: true },
  })
  if (!planOwned) {
    return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
  }

  // Phase 7.G Turn LXIX (Phase 4.2 bulk-mutation gate). CSV import writes
  // bulk actuals against the plan's period — reject if the plan's period
  // is locked (CFO post-close protection). Single Org read.
  const csvLock = await getActivePeriodLock(prisma, orgId, derivePeriodKey(planOwned))
  if (csvLock) return lockedResponse(csvLock, { prisma, orgId, userId, route: "POST /api/budgeting/import-csv" })

  // Verify integrationId (if given) belongs to caller's org
  if (integrationId) {
    const integrationOwned = await prisma.accountingIntegration.findFirst({
      where: { id: integrationId, organizationId: orgId },
      select: { id: true },
    })
    if (!integrationOwned) {
      return NextResponse.json({ error: "Integration not found in this organization" }, { status: 404 })
    }
  }

  // Create import record
  const importRecord = await prisma.accountingImport.create({
    data: {
      organizationId: orgId,
      planId,
      integrationId: integrationId || null,
      fileName: fileName || "manual-import.csv",
      importType: "csv",
      status: "processing",
      totalRows: rows.length,
    },
  })

  let matched = 0
  let unmatched = 0
  const errors: Array<{ row: number; error: string }> = []

  // Get category mapping if integration exists
  let categoryMapping: Record<string, string> = {}
  if (integrationId) {
    const integration = await prisma.accountingIntegration.findFirst({
      where: { id: integrationId, organizationId: orgId },
    })
    if (integration?.categoryMapping) {
      categoryMapping = integration.categoryMapping as Record<string, string>
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, any>
    try {
      const rawCategory: string = row.category || row.Category || row.account || row.Account || ""
      const category = categoryMapping[rawCategory] || rawCategory

      if (!category) {
        unmatched++
        errors.push({ row: i + 1, error: "Missing category" })
        continue
      }

      const amount = parseFloat(row.amount || row.Amount || row.sum || row.Sum || "0")
      if (isNaN(amount) || amount === 0) {
        unmatched++
        errors.push({ row: i + 1, error: "Invalid amount" })
        continue
      }

      const expenseDate = row.date || row.Date || null
      await prisma.budgetActual.create({
        data: {
          organizationId: orgId,
          planId,
          category,
          department: row.department || row.Department || null,
          lineType: row.lineType || row.type || "expense",
          actualAmount: Math.abs(amount),
          expenseDate,
          // Phase 3.1 v1.2 — derive monthIndex for VarianceTab sparkline.
          monthIndex: deriveMonthIndex(expenseDate),
          description: row.description || row.Description || row.memo || null,
        },
      })
      matched++
    } catch (err: unknown) {
      log.error("CSV row import error", {
        row: i + 1,
        err: err instanceof Error ? err.message : String(err),
      })
      unmatched++
      errors.push({ row: i + 1, error: "Failed to process row" })
    }
  }

  // Update import record (scoped to org for defense-in-depth)
  await prisma.accountingImport.updateMany({
    where: { id: importRecord.id, organizationId: orgId },
    data: {
      status: errors.length === rows.length ? "failed" : errors.length > 0 ? "completed" : "completed",
      matchedRows: matched,
      unmatchedRows: unmatched,
      errors: errors.length > 0 ? errors : undefined,
    },
  })

  // Update integration sync status (scoped to org)
  if (integrationId) {
    await prisma.accountingIntegration.updateMany({
      where: { id: integrationId, organizationId: orgId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: unmatched > 0 ? "partial" : "success",
        lastSyncError: errors.length > 0 ? `${unmatched} rows failed` : null,
      },
    })
  }

  logBudgetChange({
    orgId,
    planId,
    entityType: "import",
    entityId: importRecord.id,
    action: "create",
    snapshot: { matched, unmatched, total: rows.length },
  })

  return NextResponse.json({
    success: true,
    importId: importRecord.id,
    totalRows: rows.length,
    matchedRows: matched,
    unmatchedRows: unmatched,
    errors: errors.slice(0, 20), // limit errors in response
  })
}

// Phase 7.M Tier 7 Phase 6 — advertise replacement while keeping the route live.
export const POST = withDeprecation({
  replacedBy: "/api/import/ai-auto-multi",
  reason:
    "use AI Import - recognises BUDGET_ACTUALS shape (category|amount|date|department|description|lineType|companyCode); route at /budgeting/admin/ai-import",
})(_POST)

// GET — list import history
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")

  const where: any = { organizationId: orgId }
  if (planId) where.planId = planId

  const imports = await prisma.accountingImport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { integration: { select: { name: true, provider: true } } },
  })

  return NextResponse.json(imports)
}
