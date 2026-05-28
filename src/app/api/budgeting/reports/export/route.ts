import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { executeBudgetReport, getEntityFields, type BudgetReportConfig, type ReportRow } from "@/lib/budgeting/report-engine"

function escapeCSV(val: unknown): string {
  if (val == null) return ""
  const s = String(val)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function flattenRow(row: ReportRow): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        flat[`${k}.${sk}`] = sv
      }
    } else {
      flat[k] = v
    }
  }
  return flat
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const format = body.format ?? "csv"
  if (!["csv", "xlsx"].includes(format)) {
    return NextResponse.json({ error: "format must be csv or xlsx" }, { status: 400 })
  }

  const entityType = body.entityType || body.entity
  if (!entityType) {
    return NextResponse.json({ error: "entityType is required" }, { status: 400 })
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
    limit: Math.min(body.limit ?? 10000, 10000),
  }

  if (config.columns.length === 0) {
    config.columns = getEntityFields(entityType).map(f => ({ field: f.name }))
  }

  try {
    const result = await executeBudgetReport(orgId, config)
    const rows = result.data

    if (rows.length === 0) {
      return NextResponse.json({ error: "No data to export" }, { status: 404 })
    }

    // Determine column headers
    const fields = getEntityFields(entityType)
    const headers = config.columns.map(c => {
      if (c.label) return c.label
      const fd = fields.find(f => f.name === c.field)
      return fd?.label ?? c.field
    })
    const fieldKeys = config.columns.map(c => c.field)

    if (format === "csv") {
      const csvLines: string[] = [headers.map(escapeCSV).join(",")]
      for (const row of rows) {
        const flat = flattenRow(row)
        csvLines.push(fieldKeys.map(k => escapeCSV(flat[k])).join(","))
      }
      const csv = csvLines.join("\n")
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${entityType}_report.csv"`,
        },
      })
    }

    // XLSX via ExcelJS
    const ExcelJS = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    const sheetName = body.planName
      ? `${entityType} — ${body.planName}`.substring(0, 31)
      : entityType.substring(0, 31)
    const sheet = workbook.addWorksheet(sheetName)

    // Header row
    const headerRow = sheet.addRow(headers)
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } }
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }

    // Identify field types for formatting
    const numericFieldNames = new Set(fields.filter(f => f.type === "number").map(f => f.name))
    const percentFields = new Set(["execution_pct", "margin_pct", "variancePct"])
    const varianceFields = new Set(["variance"])

    // Data rows
    for (const row of rows) {
      const flat = flattenRow(row)
      const values = fieldKeys.map(k => flat[k] ?? "")
      const dataRow = sheet.addRow(values)

      // Conditional formatting for variance columns (green positive, red negative)
      fieldKeys.forEach((k, idx) => {
        if (varianceFields.has(k) || k === "variance") {
          const cell = dataRow.getCell(idx + 1)
          const val = Number(cell.value) || 0
          cell.font = { color: { argb: val >= 0 ? "FF10B981" : "FFEF4444" } }
        }
      })
    }

    // Column formatting + auto-width by data content
    fieldKeys.forEach((k, idx) => {
      const col = sheet.getColumn(idx + 1)

      // Calculate max width from actual data
      let maxLen = headers[idx].length
      for (let r = 2; r <= rows.length + 1; r++) {
        const cell = sheet.getRow(r).getCell(idx + 1)
        const len = String(cell.value ?? "").length
        if (len > maxLen) maxLen = len
      }
      col.width = Math.min(Math.max(maxLen + 3, 10), 40)

      if (percentFields.has(k)) {
        col.numFmt = "0.0%"
        col.alignment = { horizontal: "right" }
        // Convert raw percent values (e.g. 75.3 → 0.753) for Excel percent format
        for (let r = 2; r <= rows.length + 1; r++) {
          const cell = sheet.getRow(r).getCell(idx + 1)
          if (typeof cell.value === "number") {
            cell.value = cell.value / 100
          }
        }
      } else if (numericFieldNames.has(k)) {
        col.numFmt = "#,##0.00"
        col.alignment = { horizontal: "right" }
      }
    })

    // Summary row with SUM formulas
    const colLetters = fieldKeys.map((_, idx) => {
      if (idx < 26) return String.fromCharCode(65 + idx)
      return String.fromCharCode(64 + Math.floor(idx / 26)) + String.fromCharCode(65 + (idx % 26))
    })
    const summaryValues = fieldKeys.map((k, idx) => {
      if (numericFieldNames.has(k) && !percentFields.has(k)) {
        return { formula: `SUM(${colLetters[idx]}2:${colLetters[idx]}${rows.length + 1})` }
      }
      return idx === 0 ? "TOTAL" : ""
    })
    const summaryRow = sheet.addRow(summaryValues)
    summaryRow.font = { bold: true }
    summaryRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } }

    // Freeze header + auto-filter
    sheet.views = [{ state: "frozen", ySplit: 1 }]
    sheet.autoFilter = { from: "A1", to: `${colLetters[headers.length - 1]}1` }

    const buffer = await workbook.xlsx.writeBuffer()
    // ExcelJS returns Node's Buffer; copy into a fresh ArrayBuffer so
    // NextResponse's BodyInit accepts it (Buffer's underlying memory may
    // be SharedArrayBuffer on some node versions, which BodyInit rejects).
    const u8 =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBufferLike)
    const ab = new ArrayBuffer(u8.byteLength)
    new Uint8Array(ab).set(u8)
    return new NextResponse(ab, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${entityType}_report.xlsx"`,
      },
    })
  } catch (e: unknown) {
    console.error("Report export error:", e)
    const message = e instanceof Error ? e.message : "Export failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
