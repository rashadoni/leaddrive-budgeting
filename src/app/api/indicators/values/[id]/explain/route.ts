/**
 * Phase 7.E AI Variance Explainer — POST endpoint.
 *
 * Body: `{ userInitiated: true, language?: ExplainerLanguage }` (default 'en';
 * type defined in `src/lib/risk/variance-explainer.ts`).
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

// rls-scan-ignore: AI Variance Explainer (manager+, maxDuration 30). The org
// + IndicatorValue reads feed a per-org Anthropic key lookup and an LLM call
// (runExplainer) — the model round-trip can't live inside one 5s interactive
// withOrgScope tx. Read-only for tenant data (only write is a fire-and-forget
// audit on the global client) + orgId-scoped in code, so it runs on the
// BYPASSRLS `prismaAdmin` client.
import { NextRequest, NextResponse } from "next/server"
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:explain")
import {
  getAnthropicClientForOrg,
  hasAnthropicKey,
  hasAnthropicKeyForOrg,
} from "@/lib/ai/client"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import {
  runExplainer,
  type ExplainableStatus,
  type ExplainerLanguage,
  type VarianceExplainerInput,
} from "@/lib/risk/variance-explainer"
import { verifyNarrative } from "@/lib/risk/narrative-fact-check"

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
  // Cheap sync gate first — most deployments still have the env key.
  // The per-org check below catches the case where env is empty but
  // the org has set its own key via /admin/api-keys.
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  // Parse and verify explicit intent before key lookup, rate-limit
  // consumption, tenant reads or provider plumbing. Opening the terminal,
  // hovering a cell and stale clients must never spend paid AI budget.
  let body: { userInitiated?: unknown; language?: string }
  try {
    body = (await request.json()) as { userInitiated?: unknown; language?: string }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (body.userInitiated !== true) {
    return NextResponse.json(
      { error: "Explicit user action required to run AI Variance Explainer." },
      { status: 428 },
    )
  }

  // Phase 8 C4 — per-org Anthropic key check. Env fallback covered.
  if (!hasAnthropicKey() && !(await hasAnthropicKeyForOrg(prisma, orgId))) {
    return NextResponse.json(
      {
        error:
          "AI Variance Explainer unavailable: no Anthropic API key configured. Set Organization.settings.apiKeys.anthropic via /budgeting/admin/api-keys.",
      },
      { status: 503 },
    )
  }

  const rateLimitError = enforceRateLimit(
    `${orgId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const { id: ivId } = await params
  if (typeof ivId !== "string" || ivId.trim() === "") {
    return NextResponse.json({ error: "Invalid indicator-value id" }, { status: 400 })
  }

  const language: ExplainerLanguage =
    typeof body.language === "string" &&
    (LANGUAGES as readonly string[]).includes(body.language)
      ? (body.language as ExplainerLanguage)
      : "en"

  // Org-level business context for the explainer prompt. Stored in
  // Organization.settings.aiExplainerContext (plain prose ≤ 500 chars).
  // Absent → field omitted from explainer input; prompt falls back to
  // generic holding description in SYSTEM_PROMPT.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const orgSettings = (org?.settings ?? {}) as Record<string, unknown>
  const orgContext =
    typeof orgSettings.aiExplainerContext === "string" &&
    orgSettings.aiExplainerContext.trim().length > 0
      ? orgSettings.aiExplainerContext
      : undefined

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
          // Phase 7.I Track D — sector-specific context (region, cropType,
          // hectaresPlanted, totalRooms, etc.) so the variance explainer
          // can speak to the actual operational shape of the entity
          // instead of generic industry-level language. Already wired into
          // formatCompanySettings (variance-explainer.ts:163).
          settings: true,
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

  // Phase 7.F sub-group RBAC — deny if IV's company is outside scope.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(iv.companyId)) {
    return NextResponse.json({ error: "Indicator value not found" }, { status: 404 })
  }

  if (!isExplainableStatus(iv.status)) {
    return NextResponse.json(
      {
        error: `Status '${iv.status}' has nothing to explain. Only amber / red / unknown rows are explainable.`,
        code: "STATUS_NOT_EXPLAINABLE",
        status: iv.status,
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
      // Phase 7.I Track D — pass sector-specific settings to the
      // explainer so LLM gets `Settings: Sugarcane on 12,000 ha in
      // Salyan` instead of a bare "agro_crops" label.
      settings: (iv.company.settings as Record<string, unknown> | null) ?? null,
    },
    language,
    orgContext,
  }

  try {
    const startedAt = Date.now()
    // Phase 8 C4 — resolve per-org client (falls back to env when
    // org didn't set its own key). Injected via opts.client so
    // runExplainer stays test-seam friendly.
    const client = await getAnthropicClientForOrg(prisma, orgId)
    const output = await runExplainer(explainerInput, { client })
    const durationMs = Date.now() - startedAt

    // Phase 7.E AI-suite audit emission. Records WHAT indicator + WHO
    // (via session.userId) + LANGUAGE + token cost — sufficient for
    // CFO/compliance attestation without storing the LLM prompt or
    // narrative body. Failure is non-blocking: explanation still
    // returned to the caller, audit gap surfaces via background scan.
    void logAuditEvent(prisma, {
      organizationId: orgId,
      actorUserId: session.userId,
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
      log.error("audit emission failed (non-blocking)", {
        err: err instanceof Error ? err.message : String(err),
      })
    })

    // Phase 7.O C1 — fact-check the LLM narrative against the same
    // snapshot it was given. Pure / cheap (~1ms regex over a 200-word
    // string), never blocks. Result surfaced to the UI which renders an
    // inline warning banner when `flags` is non-empty.
    const factCheck = verifyNarrative(output.narrative, {
      result: explainerInput.result,
      resolved: explainerInput.resolved,
      aggregates: explainerInput.aggregates,
    })

    return NextResponse.json({
      indicatorValueId: iv.id,
      ...output,
      factCheck,
    })
  } catch (err) {
    log.error("runExplainer failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    // LLM-side issues = 502 (bad gateway). Catches max_tokens, malformed
    // JSON, shape violations — all "the upstream model misbehaved". Return a
    // sanitized code only — the raw provider message can embed billing text
    // ("credit balance too low … Plans & Billing"); never surface that.
    return NextResponse.json(aiErrorBody(err), { status: 502 })
  }
}
