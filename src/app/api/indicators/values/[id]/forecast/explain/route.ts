/**
 * Phase C2 v2 — POST /api/indicators/values/[id]/forecast/explain
 *
 * Mirror of `/api/indicators/values/[id]/explain` (Phase 7.E AI Variance
 * Explainer) tailored for forward-looking forecast narration.
 *
 * Body: `{ language?: 'en' | 'ru' | 'az' }` (default 'en').
 * URL param `:id` = `IndicatorValue.id`.
 *
 * Flow:
 *   1. Auth + rate-limit (manager+ role; 30/min/org cap, same as variance).
 *   2. Fetch IV + Definition + Company + sparkline (org-scoped).
 *   3. Compute the forecast via `forecastNextPeriod()` (sub-13 v1 helper);
 *      reject with 400 if insufficient data (<3 non-null points).
 *   4. Shape `ForecastExplainerInput` and call `runForecastExplainer()`.
 *   5. Emit `ai_forecast_explainer_run` audit event (non-blocking).
 *   6. Return `{ indicatorValueId, narrative, driverHypotheses,
 *      riskFactors, confidence, modelName, promptVersion, usage }`.
 *
 * Auth: `manager` role + caller's org must match the IV row's
 * organizationId (404 on mismatch — never leak existence).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { hasAnthropicKey } from "@/lib/ai/client";
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log";
import {
  runForecastExplainer,
  type ForecastExplainerInput,
  type ForecastExplainerLanguage,
} from "@/lib/risk/forecast-explainer";
import { forecastNextPeriod, forecastHorizon } from "@/lib/risk/forecast";

const DIRECTIONS = ["higher_better", "lower_better", "band"] as const;
type Direction = (typeof DIRECTIONS)[number];
function isDirection(s: string): s is Direction {
  return (DIRECTIONS as readonly string[]).includes(s);
}

/**
 * Map `Company.role` + `level` to the tag set the forecast-explainer
 * SYSTEM_PROMPT recognizes (`admin`, `cost_centre`, `rollup_sourced`).
 * Architect sub-22 closure — was hard-coded `[]` previously.
 *
 * Mapping rationale:
 *  - role='admin' → tag 'admin' + 'cost_centre' (pure cost-centre,
 *    no revenue base; LLM should NOT recommend revenue growth).
 *  - role='holding' → tag 'admin' (top-level aggregator; same
 *    revenue-skip semantic).
 *  - level=1 → tag 'rollup_sourced' (sub-group rollup; numbers come
 *    from worst-of-children synthesis, not direct line-items).
 *  - role='operational' → no tags (default LLM behavior applies).
 */
function companyTags(role: string, level: number): string[] {
  const tags: string[] = [];
  if (role === "admin") {
    tags.push("admin", "cost_centre");
  } else if (role === "holding") {
    tags.push("admin");
  }
  if (level === 1 && !tags.includes("rollup_sourced")) {
    tags.push("rollup_sourced");
  }
  return tags;
}

export const maxDuration = 30;

const RATE_LIMIT = {
  name: "forecast-explain-indicator",
  max: 30,
  windowMs: 60_000,
};

const LANGUAGES: readonly ForecastExplainerLanguage[] = ["en", "ru", "az"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      {
        error:
          "AI Forecast Explainer unavailable: ANTHROPIC_API_KEY not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  const session = await requireRole(request, "manager");
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    );
  }
  const orgId = session.orgId;

  const rateLimitError = enforceRateLimit(
    `${orgId}:${getClientIp(request)}`,
    RATE_LIMIT,
  );
  if (rateLimitError) return rateLimitError;

  const { id: ivId } = await params;
  if (typeof ivId !== "string" || ivId.trim() === "") {
    return NextResponse.json(
      { error: "Invalid indicator-value id" },
      { status: 400 },
    );
  }

  // Body parse — empty body is fine (defaults).
  let body: { language?: string } = {};
  try {
    const text = await request.text();
    if (text.trim() !== "") body = JSON.parse(text);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }
  const language: ForecastExplainerLanguage =
    typeof body.language === "string" &&
    (LANGUAGES as readonly string[]).includes(body.language)
      ? (body.language as ForecastExplainerLanguage)
      : "en";

  // Org-scoped fetch (mirror of /explain — 404 on either missing OR
  // cross-tenant; never leak existence).
  const iv = await prisma.indicatorValue.findFirst({
    where: { id: ivId, organizationId: orgId },
    select: {
      id: true,
      value: true,
      status: true,
      period: true,
      sparkline: true,
      companyId: true,
      indicator: {
        select: {
          code: true,
          nameEn: true,
          unit: true,
          direction: true,
          hintTemplateEn: true,
        },
      },
      company: {
        select: {
          name: true,
          industry: true,
          // Architect sub-22 💡 closure: role + level feed the
          // tag-aware branch in forecast-explainer's SYSTEM_PROMPT
          // ('admin' / 'cost_centre' / 'rollup_sourced'). Without
          // these, the prompt branch was dead code today.
          role: true,
          level: true,
        },
      },
    },
  });
  if (!iv) {
    return NextResponse.json(
      { error: "Indicator value not found" },
      { status: 404 },
    );
  }

  if (!isDirection(iv.indicator.direction)) {
    return NextResponse.json(
      {
        error: `Indicator definition has invalid direction "${iv.indicator.direction}" — data corruption. Expected one of: ${DIRECTIONS.join(", ")}.`,
      },
      { status: 500 },
    );
  }

  // Sparkline check + forecast compute. v1 contract from sub-13:
  // `forecastNextPeriod()` returns null if <3 non-null points.
  const sparkline = (iv.sparkline ?? []) as (number | null)[];
  const forecast = forecastNextPeriod(sparkline);
  if (!forecast) {
    return NextResponse.json(
      {
        error:
          "Insufficient sparkline data for forecast (need ≥3 non-null points). Re-run sparkline computation: npm run sparklines:refresh",
      },
      { status: 400 },
    );
  }

  // Phase C2 v2 sub-23 — also compute 3-step horizon so the LLM
  // narrates trajectory across the next quarter, not just one period.
  // `forecastHorizon` returns null only if the underlying fit fails;
  // since `forecastNextPeriod` succeeded, horizon will too.
  const horizonResult = forecastHorizon(sparkline, 3);

  // Status type assertion: schema column is unconstrained string but
  // matrix endpoint emits only 4 IndicatorStatus values. Defensive
  // cast for the LLM input.
  const status: ForecastExplainerInput["current"]["status"] =
    iv.status === "green" ||
    iv.status === "amber" ||
    iv.status === "red" ||
    iv.status === "unknown"
      ? iv.status
      : "unknown";

  const explainerInput: ForecastExplainerInput = {
    indicator: {
      code: iv.indicator.code,
      nameEn: iv.indicator.nameEn,
      unit: iv.indicator.unit,
      direction: iv.indicator.direction,
      hintTemplateEn: iv.indicator.hintTemplateEn,
    },
    current: {
      value: iv.value,
      status,
      period: iv.period,
    },
    forecast: {
      predicted: forecast.predicted,
      confidence: forecast.confidence,
      slope: forecast.slope,
      intercept: forecast.intercept,
      r2: forecast.r2,
      contributingCount: forecast.contributingCount,
      method: forecast.method,
    },
    horizon: horizonResult?.horizon,
    series: sparkline,
    company: {
      name: iv.company.name,
      industry: iv.company.industry,
      // Architect sub-22 💡 closure: derive tags from role + level so
      // the SYSTEM_PROMPT's tag-aware branches (skip-revenue-side for
      // admin entities) actually fire on real holding-tree data.
      tags: companyTags(iv.company.role, iv.company.level),
    },
    language,
  };

  try {
    const startedAt = Date.now();
    const output = await runForecastExplainer(explainerInput);
    const durationMs = Date.now() - startedAt;

    // Audit emission — non-blocking. Mirror of variance-explainer
    // pattern: forecast confidence band + R² + contributingCount give
    // compliance the full attestation trail (forecast quality + LLM
    // model + token cost).
    void logAuditEvent(prisma, {
      organizationId: orgId,
      actorUserId: session.userId || null,
      event: {
        action: "ai_forecast_explainer_run",
        entityType: "IndicatorValue",
        entityId: iv.id,
        metadata: {
          indicatorCode: iv.indicator.code,
          companyId: iv.companyId,
          period: iv.period,
          language,
          forecastConfidence: forecast.confidence,
          forecastR2: forecast.r2,
          contributingCount: forecast.contributingCount,
          tokensIn: output.usage?.inputTokens ?? 0,
          tokensOut: output.usage?.outputTokens ?? 0,
          durationMs,
          modelName: output.modelName,
          promptVersion: output.promptVersion,
        },
      },
      context: buildAuditContext({
        route: "/api/indicators/values/[id]/forecast/explain",
        userAgent: request.headers.get("user-agent") ?? undefined,
      }),
    }).catch((err) => {
      console.error(
        "[forecast/explain] audit emission failed (non-blocking):",
        err,
      );
    });

    return NextResponse.json({
      indicatorValueId: iv.id,
      ...output,
      // Sub-23 — return the multi-step horizon so the UI can render
      // step+1/+2/+3 badges alongside the LLM narrative.
      horizon: horizonResult?.horizon,
      // Sub-24 — return 95% prediction interval for the next-period
      // estimate so UI can render `predicted ±marginOfError` numeric
      // band alongside the categorical confidence label.
      predictionInterval: forecast.predictionInterval,
    });
  } catch (err) {
    console.error("[forecast/explain] runForecastExplainer failed:", err);
    return NextResponse.json(
      {
        error: `Forecast explainer failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
}
