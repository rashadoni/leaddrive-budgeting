/**
 * Trade budget pools XLSX export — `GET /api/trade/budget/export?year`
 * (T7, audit §1.7). One row per month: sales plan, %, budget, manual
 * flag; totals row. Viewer role.
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear())

  const orgId = session.orgId
  // Stage 3 RLS — read in the org-scoped tx (XLSX build stays outside).
  const pools = await withOrgScope(orgId, (tx) =>
    tx.tradeBudgetPool.findMany({
      where: { organizationId: orgId, year, grainKey: "org" },
      orderBy: { month: "asc" },
    }),
  )

  const lang = (["en", "ru", "az"].includes(request.nextUrl.searchParams.get("lang") ?? "")
    ? request.nextUrl.searchParams.get("lang")
    : "en") as "en" | "ru" | "az"
  const H: Record<string, string[]> = {
    en: ["Month", "Sales plan", "Budget %", "Trade budget", "Manual override", "Currency", "TOTAL"],
    ru: ["Месяц", "План продаж", "Бюджет %", "Trade-бюджет", "Ручное переопределение", "Валюта", "ИТОГО"],
    az: ["Ay", "Satış planı", "Büdcə %", "Trade büdcə", "Əl ilə yazılmış", "Valyuta", "CƏMİ"],
  }
  const aoa: Array<Array<string | number>> = [
    H[lang].slice(0, 6),
    ...pools.map((p) => [
      `${year}-${String(p.month).padStart(2, "0")}`,
      p.salesPlanAmount,
      p.budgetPct,
      p.budgetAmount,
      p.isManualAmount ? "yes" : "",
      p.currencyCode,
    ]),
  ]
  const totalSales = pools.reduce((s, p) => s + p.salesPlanAmount, 0)
  const totalBudget = pools.reduce((s, p) => s + p.budgetAmount, 0)
  aoa.push([
    H[lang][6],
    Math.round(totalSales * 100) / 100,
    totalSales > 0 ? Math.round((totalBudget / totalSales) * 10000) / 100 : 0,
    Math.round(totalBudget * 100) / 100,
    "",
    pools[0]?.currencyCode ?? "AZN",
  ])

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 15 }, { wch: 9 }]
  XLSX.utils.book_append_sheet(wb, ws, "TradeBudget")
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="trade-budget-${year}.xlsx"`,
      "cache-control": "no-store",
    },
  })
}
