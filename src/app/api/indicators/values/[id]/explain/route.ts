/**
 * Phase 7.E AI Variance Explainer — POST endpoint.
 *
 * Body: `{ language?: 'en' | 'ru' | 'az' }` (default 'en').
 * URL param `:id` = `IndicatorValue.id`.
 *
 * Flow: fetch IndicatorValue + Definition + Company (org-scoped) →
 * shape `VarianceExplainerInput` from the persisted snapshot →
 * `runExplainer()` → return `{ narrative, recommendations, confidence,
 * topDrivers, usage }`.
 *
 * Auth: `manager` role + caller's org must match the IV row's
 * organizationId (404 on mismatch — never leak existence).
 *
 * Rate limit: 30/min/org (cheaper than full mapper since prompt is
 * small + caller is a single CFO clicking a cell).
 *
 * Status precondition: only `amber` / `red` / `unknown` rows are
 * explainable — `green` returns 400 (no anomaly to explain).
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { hasAnthropicKey } from "@/lib/ai/client"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import {
  runExplainer,
  type ExplainableStatus,
  type ExplainerLanguage,
  type VarianceExplainerInput,
} from "@/lib/risk/variance-explainer"

const DIRECTIONS = ["higher_better", "lower_better", "band"] as const
type Direction = (typeof DIRECTIONS)[number]
function isDirection(s: string): s is Direction {
  return (DIRECTIONS as readonly string[]).includes(s)
}

export const maxDuration = 30

const RATE_LIMIT = { name: "explain-indicator", max: 30, windowMs: 60_000 }

const LANGUAGES: readonly ExplainerLanguage[] = ["en", "ru", "az"]

function isExplainableStatus(s: string): s is ExplainableStatus {
  return s === "amber" || s === "red" || s === "unknown"
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      {
        error:
          "AI Variance Explainer unavailable: ANTHROPIC_API_KEY not configured on this deployment.",
      },
      { status: 503 },
    )
  }

  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${orgId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const { id: ivId } = await params
  if (typeof ivId !== "string" || ivId.trim() === "") {
    return NextResponse.json({ error: "Invalid indicator-value id" }, { status: 400 })
  }

  // Body parse — empty body is fine (defaults). Malformed JSON → 400.
  let body: { language?: string } = {}
  try {
    const text = await request.text()
    if (text.trim() !== "") body = JSON.parse(text)
  } catch (err) {
    return NextResponse.json(
      {
        error: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    )
  }
  const language: ExplainerLanguage =
    typeof body.language === "string" &&
    (LANGUAGES as readonly string[]).includes(body.language)
      ? (body.language as ExplainerLanguage)
      : "en"

  // Org-scoped fetch. 404 on either missing OR cross-tenant — same
  // response, never leak existence.
  const iv = await prisma.indicatorValue.findFirst({
    where: { id: ivId, organizationId: orgId },
    select: {
      id: true,
      value: true,
      status: true,
      period: true,
      inputs: true,
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
        },
      },
    },
  })
  if (!iv) {
    return NextResponse.json(
      { error: "Indicator value not found" },
      { status: 404 },
    )
  }

  if (!isExplainableStatus(iv.status)) {
    return NextResponse.json(
      {
        error: `Status '${iv.status}' has nothing to explain. Only amber / red / unknown rows are explainable.`,
      },
      { status: 400 },
    )
  }

  // Shape inputs from the persisted snapshot. `inputs` is JSON; access
  // its fields defensively in case an older row has a different shape.
  const inputsJson = (iv.inputs ?? {}) as Record<string, unknown>
  const resolved =
    inputsJson.resolved && typeof inputsJson.resolved === "object"
      ? (inputsJson.resolved as Record<string, number>)
      : {}
  const aggregates =
    inputsJson.aggregates && typeof inputsJson.aggregates === "object"
      ? (inputsJson.aggregates as Record<string, unknown>)
      : {}
  const errorPayload =
    inputsJson.error &&
    typeof inputsJson.error === "object" &&
    typeof (inputsJson.error as { code?: unknown }).code === "string" &&
    typeof (inputsJson.error as { reason?: unknown }).reason === "string"
      ? {
          code: (inputsJson.error as { code: string }).code,
          reason: (inputsJson.error as { reason: string }).reason,
        }
      : undefined

  // `IndicatorDefinition.direction` is `String` in schema (legacy — pre-
  // dates the typed Direction union). Defend at runtime against schema
  // drift / hand-corrupted rows: a malformed direction would otherwise
  // feed garbage into the LLM "Direction:" line.
  if (!isDirection(iv.indicator.direction)) {
    return NextResponse.json(
      {
        error: `Indicator definition has invalid direction "${iv.indicator.direction}" — data corruption. Expected one of: ${DIRECTIONS.join(", ")}.`,
      },
      { status: 500 },
    )
  }

  // tags are reserved for the cost-centre role taxonomy (CARRYOVER:
  // "Cost-centre role taxonomy"). Once `Company.role` is migrated +
  // backfilled, populate from the role + a join on rollup-sourced
  // companies. For now: empty so the SYSTEM_PROMPT branch that mentions
  // "admin/cost_centre/rollup_sourced" stays inert rather than firing on
  // assumptions we can't back.
  const explainerInput: VarianceExplainerInput = {
    indicator: {
      code: iv.indicator.code,
      nameEn: iv.indicator.nameEn,
      unit: iv.indicator.unit,
      direction: iv.indicator.direction,
      hintTemplateEn: iv.indicator.hintTemplateEn,
    },
    result: {
      value: iv.value,
      status: iv.status,
      period: iv.period,
    },
    resolved,
    aggregates,
    error: errorPayload,
    company: {
      name: iv.company.name,
      industry: iv.company.industry,
      tags: [],
    },
    language,
  }

  try {
    const startedAt = Date.now()
    const output = await runExplainer(explainerInput)
    const durationMs = Date.now() - startedAt

    // Phase 7.E AI-suite audit emission. Records WHAT indicator + WHO
    // (via session.userId) + LANGUAGE + token cost — sufficient for
    // CFO/compliance attestation without storing the LLM prompt or
    // narrative body. Failure is non-blocking: explanation still
    // returned to the caller, audit gap surfaces via background scan.
    void logAuditEvent(prisma, {
      organizationId: orgId,
      actorUserId: session.userId || null,
      event: {
        action: "ai_variance_explainer_run",
        entityType: "IndicatorValue",
        entityId: iv.id,
        metadata: {
          indicatorCode: iv.indicator.code,
          companyId: iv.companyId,
          period: iv.period,
          status: iv.status as "amber" | "red" | "unknown",
          language,
          tokensIn: output.usage?.inputTokens ?? 0,
          tokensOut: output.usage?.outputTokens ?? 0,
          durationMs,
          modelName: output.modelName,
          promptVersion: output.promptVersion,
        },
      },
      context: buildAuditContext({
        route: "/api/indicators/values/[id]/explain",
        userAgent: request.headers.get("user-agent") ?? undefined,
      }),
    }).catch((err) => {
      console.error("[explain] audit emission failed (non-blocking):", err)
    })

    return NextResponse.json({
      indicatorValueId: iv.id,
      ...output,
    })
  } catch (err) {
    console.error("[explain] runExplainer failed:", err)
    // LLM-side issues = 502 (bad gateway). Catches max_tokens, malformed
    // JSON, shape violations — all "the upstream model misbehaved".
    return NextResponse.json(
      {
        error: `Variance explainer failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    )
  }
}
