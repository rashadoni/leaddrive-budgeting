import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { currentBakuYearNumber } from "@/lib/risk/periods"
import ExcelJS from "exceljs"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = Number(req.nextUrl.searchParams.get("year") || currentBakuYearNumber())

  const departments = await prisma.budgetDepartment.findMany({
    where: { organizationId: orgId, hasRevenue: true, isActive: true },
    orderBy: { sortOrder: "asc" },
  })

  const entries = await prisma.salesForecast.findMany({
    where: { organizationId: orgId, year },
  })

  // Build lookup: departmentId → month → amount
  const lookup: Record<string, Record<number, number>> = {}
  for (const e of entries) {
    if (!lookup[e.departmentId]) lookup[e.departmentId] = {}
    lookup[e.departmentId][e.month] = e.amount
  }

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Forecast ${year}`)

  // Header row
  const headerRow = ["Service", ...MONTHS, "Total"]
  ws.addRow(headerRow)

  // Style header
  const header = ws.getRow(1)
  header.font = { bold: true }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } }

  // Data rows
  for (const dept of departments) {
    const values = MONTHS.map((_, i) => lookup[dept.id]?.[i + 1] || 0)
    const total = values.reduce((s, v) => s + v, 0)
    ws.addRow([dept.label, ...values, total])
  }

  // Total row
  const totalValues = MONTHS.map((_, i) => {
    const m = i + 1
    return departments.reduce((s: number, d: any) => s + (lookup[d.id]?.[m] || 0), 0)
  })
  const grandTotal = totalValues.reduce((s, v) => s + v, 0)
  const totalRow = ws.addRow(["TOTAL", ...totalValues, grandTotal])
  totalRow.font = { bold: true }
  totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCEDC8" } }

  // Column widths
  ws.getColumn(1).width = 22
  for (let i = 2; i <= 14; i++) {
    ws.getColumn(i).width = 14
    ws.getColumn(i).numFmt = "#,##0"
  }

  const buffer = await wb.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sales-forecast-${year}.xlsx"`,
    },
  })
}
