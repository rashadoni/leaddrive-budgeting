/**
 * Phase 7.M Tier 4 (2026-05-19) — Indicator Health admin endpoint.
 *
 * GET /api/admin/indicator-health
 *
 * Aggregates current IndicatorValue.status across all entities in the org,
 * grouping unknowns by error category so admins can see WHY indicators
 * are gappy + how to fix them.
 *
 * Output:
 *   {
 *     summary: { totalIvs, green, amber, red, unknown },
 *     unknownByErrorCode: { eval: 169, non_finite: 40, ... },
 *     gappyIndicators: [
 *       {
 *         indicatorCode: "AGRO_DROUGHT_RISK",
 *         affectedEntities: ["AZSEKER-EDEN"],
 *         affectedCellCount: 18,
 *         missingVariable: "drought_index",
 *         remediation: "Wire weather-openmeteo adapter ...",
 *         category: "external-feed" | "ingest-gap" | "formula-edge-case" | "no-data" | "leaf-rollup",
 *       },
 *       ...
 *     ]
 *   }
 *
 * Auth: admin role.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"

/** Map missing-variable name → human remediation guidance. */
const REMEDIATION_MAP: Record<string, { category: string; remediation: string }> = {
  drought_index: {
    category: "external-feed",
    remediation:
      "Wire weather-openmeteo adapter to emit drought_index for each entity's primary region (set Company.settings.region).",
  },
  commodity_price_stdev: {
    category: "external-feed",
    remediation:
      "Trailing 12-month price standard deviation; needs commodity-price feed to ingest >12 monthly observations.",
  },
  news_sentiment_30d: {
    category: "external-feed",
    remediation:
      "News crawler must tag IntelItem.companyTags with entity code. Run scripts/intel-scheduler-bootstrap.ts and verify companyTags include the entity.",
  },
  sugar_content_pct: {
    category: "ingest-gap",
    remediation:
      "Add sugar_content_pct column to Farming KPI sheet for sugar beet rows, OR have admin enter via /budgeting/admin/data-entry.",
  },
  fertilizer_kg_per_ha: {
    category: "ingest-gap",
    remediation: "Add fertilizer_kg_per_ha to Farming KPI sheet or via admin data-entry.",
  },
  water_use_m3_per_ha: {
    category: "ingest-gap",
    remediation: "Add water_use_m3_per_ha to Farming KPI sheet or via admin data-entry.",
  },
  inventory: {
    category: "ingest-gap",
    remediation:
      "Balance sheet should include inventory line item (BSA.02.* code family). Verify BS xlsx parser captures it.",
  },
  raw_input: {
    category: "ingest-gap",
    remediation: "Production KPI sheet needs raw_input column (tons of cane/corn/barley processed).",
  },
  extraction_rate_pct: {
    category: "ingest-gap",
    remediation: "Processing KPI sheet should emit extraction_rate_pct (CPC KPI sheet already does for CPC).",
  },
  cane_buyer_concentration_pct: {
    category: "no-data",
    remediation:
      "Cane-seller pilot metric. Enter via /budgeting/admin/data-entry once buyer mix is known.",
  },
  cane_cut_to_mill_hours: {
    category: "no-data",
    remediation: "Cane-seller pilot metric. Operational tracking required.",
  },
  cane_hectares_harvested_pct: {
    category: "no-data",
    remediation: "Cane-seller pilot metric — % of total cane area harvested to date.",
  },
  cane_harvest_season_progress: {
    category: "no-data",
    remediation: "Cane-seller pilot metric — season progress % vs plan.",
  },
  counterparty_hhi_customer: {
    category: "no-data",
    remediation:
      "Register customers via Counterparty table. Use scripts/close-azseker-counterparties.cjs as template.",
  },
  counterparty_hhi_supplier: {
    category: "no-data",
    remediation: "Register suppliers via Counterparty table.",
  },
  imported_input_cost: {
    category: "ingest-gap",
    remediation:
      "P&L importer is dropping currencyCode. Set BudgetLine.currencyCode='USD'/'EUR' for foreign-currency rows.",
  },
}

/** Map error code → category if missing variable not in REMEDIATION_MAP. */
const ERROR_CODE_CATEGORY: Record<string, string> = {
  no_foreign_currency_lines: "ingest-gap",
  rollup_no_children: "leaf-rollup",
  non_finite: "formula-edge-case",
  no_budget_lines: "ingest-gap",
  parse: "code-bug",
  eval: "no-data",
}

function extractMissingVariable(error: string | null): string | null {
  if (!error) return null
  const match = /undefined variable: (\w+)/.exec(error)
  return match ? match[1] : null
}

interface AggregatedGap {
  indicatorCode: string
  affectedEntities: Set<string>
  affectedCellCount: number
  missingVariable: string | null
  errorCode: string
  category: string
  remediation: string
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  // Pull all IV rows with their indicator + company codes.
  const rows = await prisma.indicatorValue.findMany({
    where: { organizationId: orgId },
    select: {
      status: true,
      inputs: true,
      indicator: { select: { code: true } },
      company: { select: { code: true } },
    },
  })

  // ── Summary counts ────────────────────────────────────────────
  const summary = {
    totalIvs: rows.length,
    green: 0,
    amber: 0,
    red: 0,
    unknown: 0,
  }
  const unknownByErrorCode: Record<string, number> = {}
  const gapMap = new Map<string, AggregatedGap>()

  for (const row of rows) {
    if (row.status === "green") summary.green++
    else if (row.status === "amber") summary.amber++
    else if (row.status === "red") summary.red++
    else if (row.status === "unknown") {
      summary.unknown++
      const inputs = (row.inputs ?? {}) as Record<string, unknown>
      const errorObj = inputs.error as Record<string, unknown> | undefined
      const errorCode = (errorObj?.code as string) ?? "unknown"
      const errorReason = (errorObj?.reason as string) ?? ""
      unknownByErrorCode[errorCode] = (unknownByErrorCode[errorCode] ?? 0) + 1

      const indicatorCode = row.indicator.code
      const companyCode = row.company.code
      const missingVar = extractMissingVariable(errorReason)
      const key = `${indicatorCode}::${errorCode}::${missingVar ?? "_"}`

      let agg = gapMap.get(key)
      if (!agg) {
        // Pick the most specific remediation: missingVar map → errorCode → default.
        let remediation: { category: string; remediation: string } | undefined =
          missingVar ? REMEDIATION_MAP[missingVar] : undefined
        if (!remediation && errorCode === "no_foreign_currency_lines") {
          remediation = {
            category: "ingest-gap",
            remediation:
              "P&L importer is dropping currencyCode. Set BudgetLine.currencyCode='USD'/'EUR' for foreign lines.",
          }
        }
        if (!remediation && errorCode === "rollup_no_children") {
          remediation = {
            category: "leaf-rollup",
            remediation:
              "Correct behavior — only parent companies (level=1) should compute this rollup indicator.",
          }
        }
        if (!remediation && errorCode === "non_finite") {
          remediation = {
            category: "formula-edge-case",
            remediation:
              "Formula divides by zero in some periods. Lower-priority cleanup; system correctly emits 'unknown'.",
          }
        }
        agg = {
          indicatorCode,
          affectedEntities: new Set(),
          affectedCellCount: 0,
          missingVariable: missingVar,
          errorCode,
          category:
            remediation?.category ?? ERROR_CODE_CATEGORY[errorCode] ?? "no-data",
          remediation:
            remediation?.remediation ?? "Unrecognized error — investigate manually.",
        }
        gapMap.set(key, agg)
      }
      agg.affectedEntities.add(companyCode)
      agg.affectedCellCount++
    }
  }

  // Sort gaps by impact (most cells first)
  const gappyIndicators = Array.from(gapMap.values())
    .sort((a, b) => b.affectedCellCount - a.affectedCellCount)
    .map((g) => ({
      indicatorCode: g.indicatorCode,
      affectedEntities: Array.from(g.affectedEntities).sort(),
      affectedCellCount: g.affectedCellCount,
      missingVariable: g.missingVariable,
      errorCode: g.errorCode,
      category: g.category,
      remediation: g.remediation,
    }))

  return NextResponse.json({
    summary,
    unknownByErrorCode,
    gappyIndicators,
    generatedAt: new Date().toISOString(),
  })
}
