/**
 * Spend ledger XLSX export — `GET /api/trade/spend/export?year&month`
 * (T7, audit §1.7 — "every meeting in this industry ends with Excel").
 * Sheet 1: the month's live entries; sheet 2: Plan/Accrued/Actual/Control
 * summary per spend type. Viewer role.
 */
import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { summarizeLedger } from "@/lib/trade/ledger"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const now = new Date()
  const year = Number(request.nextUrl.searchParams.get("year") ?? now.getUTCFullYear())
  const month = Number(request.nextUrl.searchParams.get("month") ?? now.getUTCMonth() + 1)

  const entries = await prisma.tradeSpendLedger.findMany({
    where: { organizationId: session.orgId, year, month, voidedAt: null },
    orderBy: { entryDate: "asc" },
    select: {
      entryDate: true,
      entryKind: true,
      amount: true,
      currencyCode: true,
      sourceDocument: true,
      createdBy: true,
      spendType: { select: { id: true, key: true, label: true, accrualMethod: true } },
      campaignId: true,
    },
  })
  const campaigns = await prisma.tradeCampaign.findMany({
    where: { organizationId: session.orgId, id: { in: [...new Set(entries.map((e) => e.campaignId).filter((v): v is string => !!v))] } },
    select: { id: true, name: true },
  })
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]))
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.createdBy))] } },
    select: { id: true, name: true, email: true },
  })
  const userName = new Map(users.map((u) => [u.id, u.name || u.email]))

  const entriesAoa: Array<Array<string | number>> = [
    ["Date", "Kind", "Spend type", "Accrual method", "Campaign", "Amount", "Currency", "Note", "Posted by"],
    ...entries.map((e) => [
      e.entryDate.toISOString().slice(0, 10),
      e.entryKind,
      e.spendType.label,
      e.spendType.accrualMethod,
      e.campaignId ? (campaignName.get(e.campaignId) ?? "") : "",
      e.amount,
      e.currencyCode,
      e.sourceDocument ?? "",
      userName.get(e.createdBy) ?? e.createdBy,
    ]),
  ]

  const { byType, totals } = summarizeLedger(entries)
  const summaryAoa: Array<Array<string | number>> = [
    ["Spend type", "Accrual method", "Plan", "Accrued", "Actual", "Control"],
    ...byType.map((r) => [r.label, r.accrualMethod, r.plan, r.accrued, r.actual, r.control]),
    ["TOTAL", "", totals.plan, totals.accrued, totals.actual, totals.control],
  ]

  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet(entriesAoa)
  ws1["!cols"] = [{ wch: 11 }, { wch: 9 }, { wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 12 }, { wch: 9 }, { wch: 40 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws1, "Entries")
  const ws2 = XLSX.utils.aoa_to_sheet(summaryAoa)
  ws2["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws2, "Summary")
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer

  const fileName = `trade-spend-${year}-${String(month).padStart(2, "0")}.xlsx`
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  })
}
