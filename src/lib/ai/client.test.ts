/**
 * Phase 8 C4 (2026-05-28) — per-org Anthropic client tests.
 *
 * Locks the lookup order: per-org key wins over env. Throws when
 * neither is set. hasAnthropicKeyForOrg follows the same rules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const origEnvKey = process.env.ANTHROPIC_API_KEY

function makePrisma(
  orgSettingsByOrgId: Record<string, Record<string, unknown> | null>,
) {
  return {
    organization: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const settings = orgSettingsByOrgId[args.where.id]
        if (settings === undefined) return null
        return { settings }
      }),
      update: vi.fn(),
    },
  }
}

beforeEach(async () => {
  // Reset module cache so per-test env stubs land cleanly. The module
  // memoises both global + per-key clients; the helper below clears
  // them after import.
  vi.resetModules()
})

afterEach(() => {
  Object.assign(process.env, { ANTHROPIC_API_KEY: origEnvKey ?? "" })
  if (origEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY
})

describe("getAnthropicClientForOrg", () => {
  it("uses per-org key when set, even if env key also exists", async () => {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: "sk-ant-env-fallback-key-XXX",
    })
    const prisma = makePrisma({
      org1: { apiKeys: { anthropic: "sk-ant-org1-special-key-YYY" } },
    })
    const { getAnthropicClientForOrg, __resetAnthropicClientCacheForTests } =
      await import("./client")
    __resetAnthropicClientCacheForTests()
    const client = await getAnthropicClientForOrg(prisma, "org1")
    expect(client).toBeTruthy()
    // The per-org key is the one Anthropic SDK ended up with.
    // We can't peek inside the SDK directly, but we CAN assert prisma
    // was queried for that org.
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: "org1" },
      select: { settings: true },
    })
  })

  it("falls back to env key when org has no api-key entry", async () => {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: "sk-ant-env-only-zzz",
    })
    const prisma = makePrisma({
      org2: { apiKeys: {} },
    })
    const { getAnthropicClientForOrg, __resetAnthropicClientCacheForTests } =
      await import("./client")
    __resetAnthropicClientCacheForTests()
    const client = await getAnthropicClientForOrg(prisma, "org2")
    expect(client).toBeTruthy()
  })

  it("throws when neither org key nor env key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const prisma = makePrisma({
      org3: {},
    })
    const { getAnthropicClientForOrg, __resetAnthropicClientCacheForTests } =
      await import("./client")
    __resetAnthropicClientCacheForTests()
    await expect(getAnthropicClientForOrg(prisma, "org3")).rejects.toThrow(
      /No Anthropic API key available/,
    )
  })

  it("caches the SDK instance per key string (same key → same instance)", async () => {
    Object.assign(process.env, {
      ANTHROPIC_API_KEY: "sk-ant-shared-key-aaa",
    })
    const prisma = makePrisma({ org4: {}, org5: {} })
    const { getAnthropicClientForOrg, __resetAnthropicClientCacheForTests } =
      await import("./client")
    __resetAnthropicClientCacheForTests()
    const c4 = await getAnthropicClientForOrg(prisma, "org4")
    const c5 = await getAnthropicClientForOrg(prisma, "org5")
    // Both orgs fall back to env key → same SDK instance.
    expect(c4).toBe(c5)
  })
})

describe("hasAnthropicKeyForOrg", () => {
  it("returns true when env key is set (short-circuits Prisma)", async () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-env-set-bbb" })
    const prisma = makePrisma({})
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma, "any-org")).toBe(true)
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })

  it("returns true when only the per-org key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const prisma = makePrisma({
      org6: { apiKeys: { anthropic: "sk-ant-only-org-ccc" } },
    })
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma, "org6")).toBe(true)
  })

  it("returns false when neither env nor per-org key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const prisma = makePrisma({ org7: {} })
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma, "org7")).toBe(false)
  })
})
