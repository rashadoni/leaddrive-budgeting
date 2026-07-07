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
      channelId: true,
    },
  })
  const channels = await prisma.tradeChannel.findMany({
    where: { organizationId: session.orgId },
    select: { id: true, name: true },
  })
  const channelNameById = new Map(channels.map((c) => [c.id, c.name]))
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

  // R9 — localized headers (?lang=en|ru|az; body labels stay data-driven).
  const lang = (["en", "ru", "az"].includes(request.nextUrl.searchParams.get("lang") ?? "")
    ? request.nextUrl.searchParams.get("lang")
    : "en") as "en" | "ru" | "az"
  const H: Record<string, string[]> = {
    en: ["Date", "Kind", "Spend type", "Accrual method", "Channel", "Campaign", "Amount", "Currency", "Note", "Posted by"],
    ru: ["Дата", "Тип записи", "Вид затрат", "Метод начисления", "Канал", "Кампания", "Сумма", "Валюта", "Примечание", "Провёл"],
    az: ["Tarix", "Yazılış növü", "Xərc növü", "Hesablama metodu", "Kanal", "Kampaniya", "Məbləğ", "Valyuta", "Qeyd", "Yazan"],
  }
  const HS: Record<string, string[]> = {
    en: ["Spend type", "Accrual method", "Plan", "Accrued", "Actual", "Control", "TOTAL"],
    ru: ["Вид затрат", "Метод начисления", "План", "Начислено", "Факт", "Контроль", "ИТОГО"],
    az: ["Xərc növü", "Hesablama metodu", "Plan", "Hesablanmış", "Fakt", "Kontrol", "CƏMİ"],
  }
  const entriesAoa: Array<Array<string | number>> = [
    H[lang],
    ...entries.map((e) => [
      e.entryDate.toISOString().slice(0, 10),
      e.entryKind,
      e.spendType.label,
      e.spendType.accrualMethod,
      e.channelId ? (channelNameById.get(e.channelId) ?? "") : "",
      e.campaignId ? (campaignName.get(e.campaignId) ?? "") : "",
      e.amount,
      e.currencyCode,
      e.sourceDocument ?? "",
      userName.get(e.createdBy) ?? e.createdBy,
    ]),
  ]

  const { byType, totals } = summarizeLedger(entries)
  const summaryAoa: Array<Array<string | number>> = [
    HS[lang].slice(0, 6),
    ...byType.map((r) => [r.label, r.accrualMethod, r.plan, r.accrued, r.actual, r.control]),
    [HS[lang][6], "", totals.plan, totals.accrued, totals.actual, totals.control],
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
