/**
 * Phase 7.H F4.v2.3.1 — operational KPI bulk import template download.
 *
 * GET /api/operational-facts/import/template
 *   → xlsx with header row + one pre-filled example per cataloged
 *     metric (21 rows). Users edit the file in Excel and re-upload via
 *     POST /api/operational-facts/import.
 *
 * Any-member access — the template is informational; nothing sensitive
 * leaks (just metric names, units, example values, and one company
 * code as a placeholder).
 */

import { NextRequest, NextResponse } from "next/server"
import * as XLSX from "xlsx"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import {
  OPERATIONAL_METRIC_RULES,
  type MetricValidationRule,
} from "@/lib/risk/metric-validation-rules"

function exampleValue(r: MetricValidationRule): number {
  if (r.warnMin != null && r.warnMax != null) {
    return Math.round(((r.warnMin + r.warnMax) / 2) * 100) / 100
  }
  if (r.warnMax != null) {
    return Math.round(r.warnMax * 0.5 * 100) / 100
  }
  if (r.warnMin != null) {
    return Math.round(r.warnMin * 1.5 * 100) / 100
  }
  return 1
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const co = await prisma.company.findFirst({
    where: { organizationId: session.orgId, isActive: true, role: "operational" },
    select: { code: true },
    orderBy: { sortOrder: "asc" },
  })
  const companyCode = co?.code ?? "AAC-MAIN"

  const today = new Date()
  const isoDate = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`

  const aoa: Array<Array<string | number>> = [
    ["companyCode", "metric", "date", "value", "unit", "sourceNote"],
    ...OPERATIONAL_METRIC_RULES.map((r) => [
      companyCode,
      r.metric,
      isoDate,
      exampleValue(r),
      r.unit,
      r.hintEn ?? "",
    ]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 50 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "OperationalFacts")
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        'attachment; filename="operational-facts-template.xlsx"',
      "cache-control": "no-store",
    },
  })
}
