import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { getAnthropicClientForOrg, AI_MODEL, hasAnthropicKeyForOrg } from "@/lib/ai/client"
// Клиент организации резолвится по её настройкам, поэтому маршруту нужен
// доступ к Organization. Запрос orgId-скоупнут в коде — тот же BYPASSRLS
// клиент, что и у соседних маршрутов импорта.
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin"
import { aiErrorBody } from "@/lib/ai/ai-error"
import { checkBudget, recordUsage } from "@/lib/llm/cost-budget"
import {
  parseImportDoctorRequestBody,
  runImportDoctorFixSuggestion,
} from "@/lib/onboarding/ai-import/import-doctor"

const log = getLogger("api:import:ai-auto-multi:doctor:suggest-fix")

const RATE_LIMIT = {
  name: "import-doctor-suggest-fix",
  max: 30,
  windowMs: 60 * 60_000,
}

const ESTIMATED_INPUT_TOKENS = 8_000

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { ok: false, error: "No organization in session" },
      { status: 400 },
    )
  }

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${session.orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON" },
      { status: 400 },
    )
  }

  const parsed = parseImportDoctorRequestBody(body)
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    )
  }

  if (!(await hasAnthropicKeyForOrg(prisma, session.orgId))) {
    return NextResponse.json(
      { ok: false, error: "ai_unavailable", code: "ai_unavailable" },
      { status: 503 },
    )
  }

  const budgetCheck = await checkBudget(
    session.orgId,
    undefined,
    ESTIMATED_INPUT_TOKENS,
  )
  if (!budgetCheck.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `LLM budget exceeded (${budgetCheck.reason}). Resets at ${budgetCheck.resetAt.toISOString()}`,
      },
      { status: 429 },
    )
  }

  try {
    const result = await runImportDoctorFixSuggestion({
      client: await getAnthropicClientForOrg(prisma, session.orgId),
      model: AI_MODEL,
      payload: parsed.payload,
    })
    if (result.usage.inputTokens + result.usage.outputTokens > 0) {
      await recordUsage(session.orgId, {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      }).catch(() => {
        /* non-fatal */
      })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    log.error("import doctor fix suggestion failed", {
      err: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ ok: false, ...aiErrorBody(err) }, { status: 502 })
  }
}
