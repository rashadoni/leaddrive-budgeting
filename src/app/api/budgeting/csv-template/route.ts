import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

// GET — generate a CSV template with correct category/department from current plan
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Stage 3 RLS — plan + lines reads in one org-scoped tx.
  const data = await withOrgScope(orgId, async (tx) => {
    const plan = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId },
      select: { name: true },
    })
    if (!plan) return null
    const lines = await tx.budgetLine.findMany({
      where: { planId, organizationId: orgId, deletedAt: null },
      select: { department: true, lineType: true, plannedAmount: true, account: { select: { code: true, name: true } } },
      orderBy: [{ lineType: "asc" }, { sortOrder: "asc" }, { department: "asc" }],
    })
    return { plan, lines }
  })
  if (!data) return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  const { plan, lines } = data

  // Build CSV rows — one row per budget line with example data
  const header = "category,department,amount,date,description,lineType"
  const rows = lines.map((l: any) => {
    const cat = csvEscape(l.account?.code ?? "")
    const dept = csvEscape(l.department || "")
    const type = l.lineType || "expense"
    return `${cat},${dept},,YYYY-MM-DD,,${type}`
  })

  const csv = [header, ...rows].join("\n")

  const fileName = `import_template_${plan.name.replace(/[^a-zA-Z0-9]/g, "_")}.csv`

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  })
}

function csvEscape(value: string): string {
  let escaped = value
  // Prevent CSV formula injection
  if (escaped[0] && "=+-@\t\r".includes(escaped[0])) {
    escaped = "'" + escaped
  }
  if (escaped.includes(",") || escaped.includes('"') || escaped.includes("\n")) {
    return `"${escaped.replace(/"/g, '""')}"`
  }
  return escaped
}
