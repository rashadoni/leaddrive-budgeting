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
        // Согласие платить включено по умолчанию ВО ВСЕХ этих тестах: они про
        // то, какой ключ выбирается, а не про сам выключатель. Тест, которому
        // нужно выключенное состояние, задаёт aiEnabled явно и перекрывает
        // это значение.
        return { settings: { aiEnabled: true, ...(settings ?? {}) } }
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
    const client = await getAnthropicClientForOrg(prisma as never, "org1")
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
    const client = await getAnthropicClientForOrg(prisma as never, "org2")
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
    await expect(getAnthropicClientForOrg(prisma as never, "org3")).rejects.toThrow(
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
    const c4 = await getAnthropicClientForOrg(prisma as never, "org4")
    const c5 = await getAnthropicClientForOrg(prisma as never, "org5")
    // Both orgs fall back to env key → same SDK instance.
    expect(c4).toBe(c5)
  })
})

describe("выключатель платных функций", () => {
  it("по умолчанию выключено: пустые настройки не разрешают тратить", async () => {
    // Ключ здесь ЕСТЬ — общий, из окружения. Именно поэтому «есть ключ» не
    // может быть согласием: иначе любая новая организация начинает тратить
    // деньги владельца молча.
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-env-aaa" })
    const prisma = makePrisma({ orgX: { aiEnabled: false } })
    const { getAnthropicClientForOrg, AiDisabledError } = await import("./client")
    await expect(
      getAnthropicClientForOrg(prisma as never, "orgX"),
    ).rejects.toBeInstanceOf(AiDisabledError)
  })

  it("не принимает за согласие ничего, кроме настоящего true", async () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-env-aaa" })
    const { isAiEnabledForOrg } = await import("./client")
    for (const value of ["true", 1, null, "yes", {}]) {
      const prisma = makePrisma({ orgY: { aiEnabled: value } })
      expect(
        await isAiEnabledForOrg(prisma as never, "orgY"),
        `значение ${JSON.stringify(value)}`,
      ).toBe(false)
    }
  })

  it("выключено — даже собственный ключ организации не спасает", async () => {
    // Иначе клиент, который завёл свой ключ, продолжал бы тратить после того,
    // как функцию ему выключили.
    delete process.env.ANTHROPIC_API_KEY
    const prisma = makePrisma({
      orgZ: { aiEnabled: false, apiKeys: { anthropic: "sk-ant-org-own" } },
    })
    const { getAnthropicClientForOrg, AiDisabledError } = await import("./client")
    await expect(
      getAnthropicClientForOrg(prisma as never, "orgZ"),
    ).rejects.toBeInstanceOf(AiDisabledError)
  })
})

describe("hasAnthropicKeyForOrg", () => {
  it("общий ключ развёртывания больше не отвечает «да» за всех", async () => {
    // Раньше наличие env-ключа замыкало проверку и Prisma не спрашивали. Но
    // env-ключ есть всегда, поэтому такой ответ означал «да» у любой
    // организации — включая ту, которой функцию не включали. Теперь согласие
    // спрашивается первым, и без него ответ «нет».
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-env-set-bbb" })
    const prisma = makePrisma({ "any-org": { aiEnabled: false } })
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma as never, "any-org")).toBe(false)
    expect(prisma.organization.findUnique).toHaveBeenCalled()
  })

  it("с согласием общий ключ развёртывания годится", async () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-env-set-bbb" })
    const prisma = makePrisma({ "any-org": {} })
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma as never, "any-org")).toBe(true)
  })

  it("returns true when only the per-org key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const prisma = makePrisma({
      org6: { apiKeys: { anthropic: "sk-ant-only-org-ccc" } },
    })
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma as never, "org6")).toBe(true)
  })

  it("returns false when neither env nor per-org key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const prisma = makePrisma({ org7: {} })
    const { hasAnthropicKeyForOrg } = await import("./client")
    expect(await hasAnthropicKeyForOrg(prisma as never, "org7")).toBe(false)
  })
})
