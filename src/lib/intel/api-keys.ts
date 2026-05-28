/**
 * Phase 7.K Phase 5a — Per-org API key helper.
 *
 * Adapters that need external API keys (EIA Energy, USDA NASS,
 * SerpAPI/Google Trends) read their keys per-org from
 * `Organization.settings.apiKeys.<source>` instead of `.env`. This
 * makes the platform multi-tenant ready — each org enters its own key
 * via /admin/api-keys.
 *
 * **Storage shape** (in Organization.settings JSON):
 * ```json
 * {
 *   "apiKeys": {
 *     "eia": "ABC123XYZ...",
 *     "usda": "DEF456...",
 *     "gtrends": "GHI789..."
 *   }
 * }
 * ```
 *
 * **Encryption note**: v1 stores keys in plain JSON. Acceptable
 * for dev / single-tenant deployment. v1.1 will add column-level
 * encryption via Prisma extension when we onboard external tenants.
 *
 * **Graceful degradation**: `getApiKey` returns `null` (not throws)
 * when the key is missing. Adapter contracts emit
 * `api_key_missing` / `not_configured` error and empty `dataPoints`.
 * Scheduler runs continue; Drift Dashboard surfaces the gap.
 */

/** Known external API key sources. Keep in sync with
 *  `ExtendedAdapterOptions.apiKeys` in `commodity/index.ts`.
 *  `anthropic` (Phase 8 C4, 2026-05-28) lets each org BYO Claude
 *  key instead of sharing the global ANTHROPIC_API_KEY env. When
 *  set the org's key wins; absent → env fallback. */
export const KNOWN_API_KEY_SOURCES = [
  "eia",
  "usda",
  "gtrends",
  "anthropic",
] as const

export type ApiKeySource = (typeof KNOWN_API_KEY_SOURCES)[number]

/** Minimal Prisma client shape — keeps this helper unit-testable
 *  without a live DB. */
interface PrismaLike {
  organization: {
    findUnique(args: {
      where: { id: string }
      select: { settings: true }
    }): Promise<{ settings: unknown } | null>
    update(args: {
      where: { id: string }
      data: { settings: unknown }
    }): Promise<unknown>
  }
}

interface SettingsShape {
  apiKeys?: Partial<Record<ApiKeySource, string | null>>
  [k: string]: unknown
}

/**
 * Read all API keys for an org. Returns a frozen record with all
 * known sources keyed, null for missing keys. Never throws.
 */
export async function listApiKeys(
  prisma: PrismaLike,
  orgId: string,
): Promise<Record<ApiKeySource, string | null>> {
  const out: Record<ApiKeySource, string | null> = {
    eia: null,
    usda: null,
    gtrends: null,
    anthropic: null,
  }
  if (!orgId) return out
  let org: { settings: unknown } | null = null
  try {
    org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    })
  } catch {
    return out
  }
  if (!org) return out
  const settings = (org.settings ?? {}) as SettingsShape
  const apiKeys = (settings.apiKeys ?? {}) as Partial<Record<ApiKeySource, string | null>>
  for (const src of KNOWN_API_KEY_SOURCES) {
    const v = apiKeys[src]
    out[src] = typeof v === "string" && v.length > 0 ? v : null
  }
  return out
}

/**
 * Read one API key. Convenience wrapper over `listApiKeys`.
 */
export async function getApiKey(
  prisma: PrismaLike,
  orgId: string,
  source: ApiKeySource,
): Promise<string | null> {
  const keys = await listApiKeys(prisma, orgId)
  return keys[source] ?? null
}

/**
 * Update API keys for an org. Pass `null` (or omit the entry) to
 * clear a key. Non-listed sources in `updates` are left as-is.
 *
 * Validates key shape (length + non-whitespace) but does NOT verify
 * with the upstream provider — that's the adapter's job at fetch time.
 */
export async function setApiKeys(
  prisma: PrismaLike,
  orgId: string,
  updates: Partial<Record<ApiKeySource, string | null>>,
): Promise<{
  updated: ApiKeySource[]
  cleared: ApiKeySource[]
  errors: string[]
}> {
  const errors: string[] = []
  const updated: ApiKeySource[] = []
  const cleared: ApiKeySource[] = []
  if (!orgId) {
    return { updated, cleared, errors: ["orgId required"] }
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  })
  if (!org) {
    return { updated, cleared, errors: [`organization ${orgId} not found`] }
  }
  const settings = (org.settings ?? {}) as SettingsShape
  const currentKeys = { ...(settings.apiKeys ?? {}) } as Partial<
    Record<ApiKeySource, string | null>
  >

  for (const [rawSource, rawValue] of Object.entries(updates)) {
    if (!KNOWN_API_KEY_SOURCES.includes(rawSource as ApiKeySource)) {
      errors.push(`unknown source: ${rawSource}`)
      continue
    }
    const source = rawSource as ApiKeySource
    if (rawValue == null || (typeof rawValue === "string" && rawValue.trim() === "")) {
      delete currentKeys[source]
      cleared.push(source)
      continue
    }
    if (typeof rawValue !== "string") {
      errors.push(`${source}: value must be a string`)
      continue
    }
    const trimmed = rawValue.trim()
    if (trimmed.length < 8) {
      errors.push(`${source}: key too short (≥8 chars expected)`)
      continue
    }
    if (trimmed.length > 256) {
      errors.push(`${source}: key too long (≤256 chars expected)`)
      continue
    }
    currentKeys[source] = trimmed
    updated.push(source)
  }

  if (updated.length === 0 && cleared.length === 0) {
    return { updated, cleared, errors }
  }

  const newSettings: SettingsShape = { ...settings, apiKeys: currentKeys }
  await prisma.organization.update({
    where: { id: orgId },
    data: { settings: newSettings as unknown as Record<string, unknown> },
  })
  return { updated, cleared, errors }
}

/**
 * Redact keys to "ABCD…WXYZ" form for safe display in admin UI /
 * audit logs. First 4 chars + ellipsis + last 4 chars. Empty / short
 * keys returned as "***".
 */
export function redactApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== "string") return "***"
  if (key.length <= 12) return "***"
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
