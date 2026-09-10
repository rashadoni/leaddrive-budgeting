import Anthropic from "@anthropic-ai/sdk"
import type { PrismaClient as PrismaClientType } from "@prisma/client"
import { getApiKey } from "@/lib/intel/api-keys"

// Default to the Sonnet tier — cost/quality sweet spot for finance prose.
// Opus is available by switching this constant if a client wants deeper reasoning.
export const AI_MODEL = "claude-sonnet-4-5-20250929"

// Module-scoped cache for the global (env-backed) client. Per-org
// clients are cached separately keyed by api-key string so multiple
// orgs running the same key share the Anthropic SDK instance.
let cachedGlobal: Anthropic | null = null
const cachedByKey = new Map<string, Anthropic>()

export function getAnthropicClient(): Anthropic {
  if (cachedGlobal) return cachedGlobal
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — add it to .env and restart the dev server.",
    )
  }
  cachedGlobal = new Anthropic({ apiKey: key })
  return cachedGlobal
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Phase 8 C4 (2026-05-28) — per-org client factory.
 *
 * Resolves an Anthropic client for a given org. Lookup order:
 *   1. `Organization.settings.apiKeys.anthropic` (set via
 *      /budgeting/admin/api-keys) — preferred, spend hits the org's
 *      own Anthropic billing
 *   2. `process.env.ANTHROPIC_API_KEY` — fallback, spend hits the
 *      deployment owner's billing (legacy single-tenant behaviour)
 *
 * Throws when neither is configured. Caller is expected to check
 * `hasAnthropicKeyForOrg(orgId)` first if they want a soft-fail UX.
 *
 * **Why pass prisma?** The api-keys helper is unit-tested with a
 * narrow `PrismaLike` interface; threading prisma keeps this function
 * testable without the global Prisma singleton.
 */
// Phase 8 D3 final (2026-05-29) — `Pick<PrismaClient, "organization">` so
// the real (now strictly-typed) `prisma` export is assignable at the
// production call sites (explain / forecast / api-keys routes); unit
// tests pass a 2-method stub via `as never`.
type PrismaLike = Pick<PrismaClientType, "organization">

/**
 * Включены ли платные ИИ-функции у организации.
 *
 * Зачем это отдельный переключатель, а не «есть ключ / нет ключа». Ключ здесь
 * почти всегда есть: если организация свой не завела, берётся общий ключ
 * развёртывания, то есть счёт владельца. Поэтому «ключ настроен» ничего не
 * говорит о том, ХОТЕЛИ ли платить прямо сейчас — а платные функции идут и
 * сами по себе, по расписанию, без единого пользователя в приложении.
 *
 * Значение по умолчанию — ВЫКЛЮЧЕНО. Организация, которой функцию не включали
 * осознанно, не должна тратить. Проверка строго `=== true`: отсутствующий
 * ключ, `null` и строка "true" из формы одинаково значат «не включали».
 */
export async function isAiEnabledForOrg(
  prisma: PrismaLike,
  orgId: string,
): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  const settings = (org?.settings ?? {}) as Record<string, unknown>
  return settings.aiEnabled === true
}

/** Ошибка выключенной функции — отличима от «ключа нет вовсе». */
export class AiDisabledError extends Error {
  constructor(orgId: string) {
    super(
      `AI features are switched off for org ${orgId}. Enable them at /budgeting/admin/api-keys.`,
    )
    this.name = "AiDisabledError"
  }
}

export async function getAnthropicClientForOrg(
  prisma: PrismaLike,
  orgId: string,
): Promise<Anthropic> {
  // Выключено — значит платить нельзя, даже если ключ под рукой.
  if (!(await isAiEnabledForOrg(prisma, orgId))) throw new AiDisabledError(orgId)
  const orgKey = await getApiKey(prisma, orgId, "anthropic")
  const key = orgKey ?? process.env.ANTHROPIC_API_KEY ?? null
  if (!key) {
    throw new Error(
      `No Anthropic API key available for org ${orgId} — set Organization.settings.apiKeys.anthropic via /budgeting/admin/api-keys, or configure ANTHROPIC_API_KEY in the deployment env.`,
    )
  }
  const existing = cachedByKey.get(key)
  if (existing) return existing
  const client = new Anthropic({ apiKey: key })
  cachedByKey.set(key, client)
  return client
}

/**
 * Soft check: does the org have a usable Anthropic key (either its
 * own or the env fallback)? Routes use this to gate the «AI button
 * unavailable» UX without paying for a Prisma fetch.
 *
 * The env check is sync; the org-key check is async because it hits
 * Prisma. When only the env fallback matters (no per-org override
 * needed), use the sync `hasAnthropicKey()` above.
 */
export async function hasAnthropicKeyForOrg(
  prisma: PrismaLike,
  orgId: string,
): Promise<boolean> {
  // Порядок важен: выключатель проверяется ПЕРВЫМ и до env. Иначе общий ключ
  // развёртывания сделает ответ «да» у любой организации, и интерфейс покажет
  // кнопку, которая упадёт при нажатии.
  if (!(await isAiEnabledForOrg(prisma, orgId))) return false
  if (process.env.ANTHROPIC_API_KEY) return true
  const orgKey = await getApiKey(prisma, orgId, "anthropic")
  return Boolean(orgKey)
}

/** Test-only: clear caches so per-test stubbed env / settings don't
 *  bleed across tests. */
export function __resetAnthropicClientCacheForTests(): void {
  cachedGlobal = null
  cachedByKey.clear()
}
