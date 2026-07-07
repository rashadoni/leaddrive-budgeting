import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getOrgId } from "@/lib/api-auth"

const TEMPLATE_PACKS = {
  "it-saas": {
    name: "IT / SaaS",
    templates: [
      { name: "Salaries", lineType: "expense", costModelKey: "coreLabor", defaultAmount: 0, sortOrder: 1 },
      { name: "IT Infrastructure", lineType: "expense", costModelKey: "techInfraTotal", defaultAmount: 0, sortOrder: 2 },
      { name: "Office Rent", lineType: "expense", defaultAmount: 0, sortOrder: 3 },
      { name: "Software Licenses", lineType: "expense", defaultAmount: 0, sortOrder: 4 },
      { name: "Marketing", lineType: "expense", defaultAmount: 0, sortOrder: 5 },
      { name: "Overhead Expenses", lineType: "expense", costModelKey: "adminOverhead", defaultAmount: 0, sortOrder: 6 },
      { name: "Risk Reserve", lineType: "expense", costModelKey: "riskCost", defaultAmount: 0, sortOrder: 7 },
      { name: "Other Expenses", lineType: "expense", defaultAmount: 0, sortOrder: 8 },
      { name: "Service Revenue", lineType: "revenue", costModelKey: "serviceRevenues.total", defaultAmount: 0, sortOrder: 10 },
      { name: "Cost of Goods Sold", lineType: "cogs", defaultAmount: 0, sortOrder: 20 },
    ],
  },
  "service": {
    name: "Service Company",
    templates: [
      { name: "Salaries", lineType: "expense", defaultAmount: 0, sortOrder: 1 },
      { name: "Office Rent", lineType: "expense", defaultAmount: 0, sortOrder: 2 },
      { name: "Travel & Business Trips", lineType: "expense", defaultAmount: 0, sortOrder: 3 },
      { name: "Equipment", lineType: "expense", defaultAmount: 0, sortOrder: 4 },
      { name: "Marketing", lineType: "expense", defaultAmount: 0, sortOrder: 5 },
      { name: "Software Licenses", lineType: "expense", defaultAmount: 0, sortOrder: 6 },
      { name: "Other Expenses", lineType: "expense", defaultAmount: 0, sortOrder: 7 },
      { name: "Consulting", lineType: "revenue", lineSubtype: "service", defaultAmount: 0, sortOrder: 10 },
      { name: "Project Work", lineType: "revenue", lineSubtype: "service", defaultAmount: 0, sortOrder: 11 },
    ],
  },
  "startup": {
    name: "Startup",
    templates: [
      { name: "Salaries", lineType: "expense", defaultAmount: 0, sortOrder: 1 },
      { name: "Cloud Infrastructure", lineType: "expense", defaultAmount: 0, sortOrder: 2 },
      { name: "Marketing & Acquisition", lineType: "expense", defaultAmount: 0, sortOrder: 3 },
      { name: "Legal Services", lineType: "expense", defaultAmount: 0, sortOrder: 4 },
      { name: "Office Rent", lineType: "expense", defaultAmount: 0, sortOrder: 5 },
      { name: "SaaS MRR", lineType: "revenue", lineSubtype: "service", defaultAmount: 0, sortOrder: 10 },
      { name: "Professional Services", lineType: "revenue", lineSubtype: "service", defaultAmount: 0, sortOrder: 11 },
    ],
  },
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { pack } = await req.json().catch(() => ({ pack: "all" }))

  const packs = pack === "all" ? Object.values(TEMPLATE_PACKS) : TEMPLATE_PACKS[pack as keyof typeof TEMPLATE_PACKS] ? [TEMPLATE_PACKS[pack as keyof typeof TEMPLATE_PACKS]] : []

  // Stage 3 RLS — count + de-dupe + seed loop in one org-scoped tx.
  const created = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.budgetDirectionTemplate.count({ where: { organizationId: orgId } })
    let created = 0
    for (const p of packs) {
      for (const t of p.templates) {
        // Skip if template with same name + lineType already exists
        const exists = await tx.budgetDirectionTemplate.findFirst({
          where: { organizationId: orgId, name: t.name, lineType: t.lineType },
        })
        if (exists) continue

        await tx.budgetDirectionTemplate.create({
          data: {
            organizationId: orgId,
            name: t.name,
            lineType: t.lineType,
            lineSubtype: (t as any).lineSubtype ?? null,
            defaultAmount: t.defaultAmount,
            costModelKey: (t as any).costModelKey ?? null,
            sortOrder: t.sortOrder + (existing + created),
            isActive: true,
          },
        })
        created++
      }
    }
    return created
  })

  return NextResponse.json({ success: true, created })
}
