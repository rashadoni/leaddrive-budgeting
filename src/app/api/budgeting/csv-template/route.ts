import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// GET — generate a CSV template with correct category/department from current plan
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { name: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  const lines = await prisma.budgetLine.findMany({
    where: { planId, organizationId: orgId },
    select: { category: true, department: true, lineType: true, plannedAmount: true },
    orderBy: [{ lineType: "asc" }, { category: "asc" }, { department: "asc" }],
  })

  // Build CSV rows — one row per budget line with example data
  const header = "category,department,amount,date,description,lineType"
  const rows = lines.map((l: any) => {
    const cat = csvEscape(l.category)
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
