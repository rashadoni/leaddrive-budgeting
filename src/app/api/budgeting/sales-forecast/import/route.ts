/**
 * Phase 7.M Tier 7 Phase 6 (2026-05-21) — DEPRECATED route.
 *
 * Original purpose: bulk Excel upload of department × month sales
 * forecast grid. ~111 LOC ExcelJS-based parser + per-row upsert into
 * SalesForecast table.
 *
 * Replacement: `POST /api/import/ai-auto-multi` — drop the same xlsx
 * onto the AI Import page (/budgeting/admin/ai-import). The classifier
 * recognises the department×month grid shape as `SALES_FORECAST`
 * dataType (added Tier 7 Phase 4) and the universal multi-file
 * orchestrator routes it to `makeSalesForecastHandler` →
 * `runSalesForecastBatch`. Same target table (SalesForecast), same
 * upsert semantics by (orgId, deptId, year, month) unique key.
 *
 * UI surface audit (Phase 5): this route had ZERO UI callers — the
 * SalesForecastTab uses inline edit via `POST /api/budgeting/sales-forecast`
 * (the non-import endpoint), not this bulk upload. Safe to return 410.
 *
 * Clients hitting this URL get:
 *   • 410 Gone status (per RFC 9110 — semantically "this resource is
 *     intentionally and permanently removed; do not retry")
 *   • `Sunset` header (RFC 8594) timestamped at the deprecation date
 *   • `Deprecation: true` header (RFC 9745)
 *   • `Link: rel="successor-version"` pointing to the replacement
 */
import { NextRequest, NextResponse } from "next/server"

const SUNSET_HEADERS = {
  // RFC 8594 Sunset: when this resource will (or has) stopped being
  // available. Set to the deprecation date itself — the route is gone
  // NOW, not eventually.
  Sunset: "Thu, 21 May 2026 00:00:00 GMT",
  // RFC 9745 Deprecation flag — boolean signal for tooling.
  Deprecation: "true",
  // RFC 8288 successor-version Link relation. Clients should retry
  // the upload via the AI Import multi-file endpoint.
  Link: '</api/import/ai-auto-multi>; rel="successor-version"',
  // Custom header for human operators reading logs/curl output.
  "X-Replaced-By": "/api/import/ai-auto-multi",
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error:
        "This endpoint is deprecated and no longer accepts uploads. Use /api/import/ai-auto-multi via /budgeting/admin/ai-import — the AI classifier recognises the department×month grid as SALES_FORECAST and routes to the same SalesForecast table.",
      replacement: "/api/import/ai-auto-multi",
      ui: "/budgeting/admin/ai-import",
      replacedAt: "2026-05-21",
      phase: "Phase 7.M Tier 7 Phase 6",
    },
    {
      status: 410,
      headers: SUNSET_HEADERS,
    },
  )
}
