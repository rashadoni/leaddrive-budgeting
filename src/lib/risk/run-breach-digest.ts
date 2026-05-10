/**
 * Phase 7.G Turn CIV (Phase 7.E #3 v2 E.2e LLM wire) — breach-digest runner.
 *
 * Glue layer: pulls predicted breaches → ranks → builds prompt → calls LLM
 * → validates response → emits audit. Mirrors `runExplainer` pattern from
 * variance-explainer.ts but emits to audit log + integrates with the
 * per-org token budget gate (cost-budget.ts).
 *
 * **Failure modes:**
 *   - Budget exceeded → throws 429-tagged Error (caller surfaces 429 OR logs)
 *   - LLM truncated / empty / invalid JSON → throws (caller decides degrade)
 *   - Audit emit failure → swallowed (logger never-throws contract)
 *
 * **No persistence layer** for the digest narrative itself — it's
 * ephemeral per-call output. Caller may persist via separate path
 * (e.g. cache for repeated reads in a 24h window — deferred). Audit row
 * is the authoritative trail of "this digest was generated, here's its
 * shape + spend".
 */

import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client"
import { extractJsonFromText } from "@/lib/onboarding/ai-mapper/json-extract"
import { prisma as defaultPrisma } from "@/lib/prisma"
import { logAuditEvent } from "@/lib/audit/log"
import { withTokenBudget, type TokenBudget } from "@/lib/llm/cost-budget"
import { getPredictiveBreaches } from "./breach-persist"
import {
  selectTopBreaches,
  buildDigestPrompt,
  validateDigestResponse,
  topCompaniesFrom,
  DIGEST_SYSTEM_PROMPT,
  DIGEST_PROMPT_VERSION,
  type BreachDigestOutput,
  type DigestLanguage,
  type SelectTopBreachesOptions,
} from "./breach-digest"

export interface RunBreachDigestInput {
  organizationId: string
  period: string
  language?: DigestLanguage
  /** Forwarded to selectTopBreaches. */
  selectOpts?: SelectTopBreachesOptions
  /** Token budget for THIS call (overrides org default). Optional. */
  budget?: TokenBudget
}

export interface RunBreachDigestOptions {
  /** Test seam — inject Anthropic client. */
  client?: ReturnType<typeof getAnthropicClient>
  /** Test seam — override prisma. */
  prisma?: typeof defaultPrisma
  /** Override model id. Default = AI_MODEL constant. */
  model?: string
  /** Override max-tokens. Default 1024 (single paragraph ≤120 words). */
  maxTokens?: number
  /** When true, skip cost-budget pre-check (caller already enforced).
   *  Audit emit still runs. Default: false. */
  skipBudget?: boolean
  /** Audit context (route + actor). actorUserId=null → system event. */
  audit?: { route?: string; actorUserId?: string | null }
}

export interface RunBreachDigestResult {
  /** Full digest output (narrative + metadata). */
  digest: BreachDigestOutput
  /** Number of breaches the LLM saw (after rank+cap). */
  breachesAnalyzed: number
  /** True when audit insert succeeded; false when logger swallowed an error
   *  (e.g. enum value not yet in DB). Caller may surface as `auditStale`. */
  auditPersisted: boolean
}

export class BreachDigestEmptyError extends Error {
  constructor(message: string = "No breaches to digest") {
    super(message)
    this.name = "BreachDigestEmptyError"
  }
}

/**
 * Run a single breach digest cycle for an org. Returns the narrative +
 * audit-emit status. Throws on LLM failures + budget overruns.
 *
 * Empty-input handling: if no breaches survive `selectTopBreaches`, throws
 * `BreachDigestEmptyError` (caller decides whether to silently skip the
 * call vs. emit "no breaches" narrative). Avoids burning tokens on a
 * known-trivial generation.
 */
export async function runBreachDigest(
  input: RunBreachDigestInput,
  opts: RunBreachDigestOptions = {},
): Promise<RunBreachDigestResult> {
  const prisma = opts.prisma ?? defaultPrisma
  const language: DigestLanguage = input.language ?? "en"

  // 1. Fetch breaches
  const allBreaches = await getPredictiveBreaches(input.organizationId, {
    period: input.period,
  })

  // 2. Rank + cap
  const top = selectTopBreaches(allBreaches, input.selectOpts)
  if (top.length === 0) {
    throw new BreachDigestEmptyError(
      `No breaches surfaced for org=${input.organizationId} period=${input.period} at the chosen confidence floor`,
    )
  }

  // 3. Build prompt
  const userMessage = buildDigestPrompt({
    organizationId: input.organizationId,
    breaches: top,
    period: input.period,
    language,
  })

  // 4. LLM call (optionally cost-budget gated)
  const client = opts.client ?? getAnthropicClient()
  const model = opts.model ?? AI_MODEL
  const maxTokens = opts.maxTokens ?? 1024

  const callLLM = async (): Promise<{
    digest: BreachDigestOutput
    usage: { inputTokens: number; outputTokens: number }
  }> => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: DIGEST_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })

    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `Breach digest truncated at max_tokens=${maxTokens}. Bump maxTokens for RU/AZ output.`,
      )
    }

    const textBlocks = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
    if (textBlocks.length === 0) {
      throw new Error(
        `Breach digest: response had no text content (got: ${JSON.stringify(response.content.map((b) => b.type))})`,
      )
    }
    const raw = textBlocks.join("\n").trim()
    const jsonText = extractJsonFromText(raw)
    if (!jsonText) {
      throw new Error(`Breach digest: response did not contain valid JSON. Raw: ${raw.slice(0, 200)}…`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (err) {
      throw new Error(
        `Breach digest: JSON parse failed: ${err instanceof Error ? err.message : String(err)}. Raw: ${raw.slice(0, 200)}…`,
      )
    }

    const usage = response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      : { inputTokens: 0, outputTokens: 0 }

    const digest = validateDigestResponse(
      parsed,
      topCompaniesFrom(top),
      top.length,
      response.model ?? model,
      usage,
    )
    return { digest, usage }
  }

  let digest: BreachDigestOutput
  let usage: { inputTokens: number; outputTokens: number }
  if (opts.skipBudget) {
    const r = await callLLM()
    digest = r.digest
    usage = r.usage
  } else {
    // withTokenBudget pre-checks budget, calls fn, records usage post-call.
    digest = await withTokenBudget(
      input.organizationId,
      async () => {
        const r = await callLLM()
        return { result: r.digest, usage: r.usage }
      },
      input.budget,
    )
    // Pull usage from digest (validateDigestResponse threaded it through).
    usage = digest.usage ?? { inputTokens: 0, outputTokens: 0 }
  }

  // 5. Emit audit (Pattern B — fire-and-forget; never throws)
  const auditResult = await logAuditEvent(prisma, {
    organizationId: input.organizationId,
    actorUserId: opts.audit?.actorUserId ?? null,
    event: {
      action: "ai_breach_digest",
      entityType: "Organization",
      entityId: input.organizationId,
      metadata: {
        period: input.period,
        language,
        breachCount: top.length,
        topCompanies: digest.topCompanies,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        modelName: digest.modelName,
        promptVersion: digest.promptVersion ?? DIGEST_PROMPT_VERSION,
      },
    },
    context: opts.audit?.route ? { route: opts.audit.route } : null,
  })

  return {
    digest,
    breachesAnalyzed: top.length,
    auditPersisted: auditResult.ok,
  }
}
