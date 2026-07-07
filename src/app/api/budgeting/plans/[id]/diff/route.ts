import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

interface DiffLine {
  category: string
  department: string | null
  lineType: string
  planA: number
  planB: number
  delta: number
  status: "added" | "removed" | "changed" | "unchanged"
}

// GET — compute diff between two plan versions
// ?compareWith=OTHER_PLAN_ID
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: planIdA } = await params
  const planIdB = req.nextUrl.searchParams.get("compareWith")

  if (!planIdB) {
    return NextResponse.json({ error: "compareWith query parameter required" }, { status: 400 })
  }

  const { linesA, linesB } = await withOrgScope(orgId, async (tx) => {
    const linesA = await tx.budgetLine.findMany({ where: { planId: planIdA, organizationId: orgId, deletedAt: null }, include: { account: { select: { code: true, name: true } } } })
    const linesB = await tx.budgetLine.findMany({ where: { planId: planIdB, organizationId: orgId, deletedAt: null }, include: { account: { select: { code: true, name: true } } } })
    return { linesA, linesB }
  })

  // Build maps by composite key: account.code + department + lineType
  const keyFn = (l: any) => `${l.account?.code ?? ""}||${l.department || ""}||${l.lineType}`

  const mapA = new Map<string, any>()
  for (const l of linesA) mapA.set(keyFn(l), l)

  const mapB = new Map<string, any>()
  for (const l of linesB) mapB.set(keyFn(l), l)

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()])
  const diff: DiffLine[] = []

  for (const key of allKeys) {
    const a = mapA.get(key)
    const b = mapB.get(key)

    if (a && !b) {
      diff.push({
        category: a.account?.code ?? "",
        department: a.department,
        lineType: a.lineType,
        planA: a.plannedAmount,
        planB: 0,
        delta: -a.plannedAmount,
        status: "removed",
      })
    } else if (!a && b) {
      diff.push({
        category: b.account?.code ?? "",
        department: b.department,
        lineType: b.lineType,
        planA: 0,
        planB: b.plannedAmount,
        delta: b.plannedAmount,
        status: "added",
      })
    } else if (a && b) {
      const delta = b.plannedAmount - a.plannedAmount
      diff.push({
        category: a.account?.code ?? "",
        department: a.department,
        lineType: a.lineType,
        planA: a.plannedAmount,
        planB: b.plannedAmount,
        delta,
        status: Math.abs(delta) < 0.01 ? "unchanged" : "changed",
      })
    }
  }

  // Sort: changed first, then added, removed, unchanged
  const order = { changed: 0, added: 1, removed: 2, unchanged: 3 }
  diff.sort((a, b) => order[a.status] - order[b.status])

  return NextResponse.json({
    planA: planIdA,
    planB: planIdB,
    totalChanges: diff.filter((d) => d.status !== "unchanged").length,
    diff,
  })
}
