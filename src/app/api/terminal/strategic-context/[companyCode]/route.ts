/**
 * Phase 7.M Tier 4 (2026-05-19) — Risk Terminal strategic-context endpoint.
 *
 * GET /api/terminal/strategic-context/[companyCode]
 *
 * Returns aggregated strategic context for the company:
 *   • strategicDescription + competitiveAdvantage (from Company.settings)
 *   • landParcels summary (total ha, total annual rent, regions, parcel count)
 *   • capexInitiatives summary (total amount, top 5 by amount, count by type)
 *   • forwardForecast (year-by-year revenue from Org.settings) — same for all companies
 *
 * All fields nullable — UI gracefully skips sections without data.
 *
 * Auth: viewer (read-only operational dashboard widget).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"

interface LandParcel {
  hectares: number
  annualRentAzn: number
  region: string | null
  leaseEnd: string | null
}

interface CapexInitiative {
  description: string
  amountAzn: number
  type: "CAPEX" | "OPEX"
  category: string | null
  financingSource: string | null
}

interface ForwardForecastYear {
  year: number
  totalRevenueAzn: number
  breakdown: Array<{ businessUnit: string; revenueAzn: number }>
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ companyCode: string }> },
) {
  const session = await requireRole(req, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const { companyCode } = await params
  const decodedCode = decodeURIComponent(companyCode)

  const company = await prisma.company.findFirst({
    where: { organizationId: session.orgId, code: decodedCode },
    select: { id: true, code: true, name: true, settings: true },
  })
  if (!company) {
    return NextResponse.json(
      { error: `Company "${decodedCode}" not found` },
      { status: 404 },
    )
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.orgId },
    select: { settings: true },
  })

  const compSettings = (company.settings ?? {}) as Record<string, unknown>
  const orgSettings = (org?.settings ?? {}) as Record<string, unknown>

  // ── Strategic description ────────────────────────────────────
  const strategicDescription =
    typeof compSettings.strategicDescription === "string"
      ? (compSettings.strategicDescription as string)
      : null
  const competitiveAdvantage =
    typeof compSettings.competitiveAdvantage === "string"
      ? (compSettings.competitiveAdvantage as string)
      : null

  // ── Land parcels summary ─────────────────────────────────────
  const parcels = Array.isArray(compSettings.landParcels)
    ? (compSettings.landParcels as LandParcel[])
    : []
  const landSummary =
    parcels.length > 0
      ? {
          parcelCount: parcels.length,
          totalHectares:
            typeof compSettings.landTotalHectares === "number"
              ? (compSettings.landTotalHectares as number)
              : parcels.reduce((s, p) => s + (p.hectares ?? 0), 0),
          totalAnnualRentAzn:
            typeof compSettings.landTotalAnnualRentAzn === "number"
              ? (compSettings.landTotalAnnualRentAzn as number)
              : parcels.reduce((s, p) => s + (p.annualRentAzn ?? 0), 0),
          regions: Array.from(
            new Set(
              parcels.map((p) => p.region).filter((r): r is string => r !== null),
            ),
          ).sort(),
          contractsExpiringWithinYears: parcels.filter((p) => {
            if (!p.leaseEnd) return false
            const end = new Date(p.leaseEnd)
            const now = new Date()
            const yearsUntilExpiry =
              (end.getTime() - now.getTime()) / (365 * 24 * 60 * 60 * 1000)
            return yearsUntilExpiry > 0 && yearsUntilExpiry < 2
          }).length,
        }
      : null

  // ── CAPEX summary ─────────────────────────────────────────────
  const initiatives = Array.isArray(compSettings.capexInitiatives)
    ? (compSettings.capexInitiatives as CapexInitiative[])
    : []
  const capexSummary =
    initiatives.length > 0
      ? {
          totalItems: initiatives.length,
          totalAzn:
            typeof compSettings.capexTotalAzn === "number"
              ? (compSettings.capexTotalAzn as number)
              : initiatives.reduce((s, i) => s + (i.amountAzn ?? 0), 0),
          capexCount: initiatives.filter((i) => i.type === "CAPEX").length,
          opexCount: initiatives.filter((i) => i.type === "OPEX").length,
          topByAmount: [...initiatives]
            .sort((a, b) => (b.amountAzn ?? 0) - (a.amountAzn ?? 0))
            .slice(0, 5)
            .map((i) => ({
              description: i.description,
              amountAzn: i.amountAzn,
              type: i.type,
              category: i.category,
            })),
        }
      : null

  // ── Forward forecast (org-level) ─────────────────────────────
  const forwardForecast =
    orgSettings.forwardForecast &&
    typeof orgSettings.forwardForecast === "object" &&
    Array.isArray(
      (orgSettings.forwardForecast as Record<string, unknown>).years,
    )
      ? {
          source: String(
            (orgSettings.forwardForecast as Record<string, unknown>).source,
          ),
          hasTerminalValue: Boolean(
            (orgSettings.forwardForecast as Record<string, unknown>)
              .hasTerminalValue,
          ),
          years: (
            (orgSettings.forwardForecast as Record<string, unknown>)
              .years as ForwardForecastYear[]
          ).map((y) => ({
            year: y.year,
            totalRevenueAzn: y.totalRevenueAzn,
            topBu: y.breakdown[0] ?? null,
          })),
        }
      : null

  return NextResponse.json({
    companyCode: company.code,
    companyName: company.name,
    strategicDescription,
    competitiveAdvantage,
    landSummary,
    capexSummary,
    forwardForecast,
    hasAnyContent: !!(
      strategicDescription ||
      landSummary ||
      capexSummary ||
      forwardForecast
    ),
  })
}
