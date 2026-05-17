/**
 * Tests for the per-org API key helper (Phase 5a).
 */
import { describe, it, expect, vi } from "vitest"
import {
  listApiKeys,
  getApiKey,
  setApiKeys,
  redactApiKey,
  KNOWN_API_KEY_SOURCES,
} from "./api-keys"

interface FakePrismaState {
  settings: Record<string, unknown>
}

function makeFakePrisma(initial: FakePrismaState = { settings: {} }) {
  const state = { ...initial }
  return {
    state,
    organization: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: unknown } }) => {
        state.settings = (data.settings ?? {}) as Record<string, unknown>
        return state
      }),
    },
  }
}

describe("listApiKeys", () => {
  it("returns all-null when org has no keys", async () => {
    const prisma = makeFakePrisma()
    const keys = await listApiKeys(prisma as never, "org-1")
    for (const src of KNOWN_API_KEY_SOURCES) {
      expect(keys[src]).toBeNull()
    }
  })

  it("returns stored keys when present", async () => {
    const prisma = makeFakePrisma({
      settings: { apiKeys: { eia: "EIA_KEY_VALUE", usda: "USDA_KEY_VALUE" } },
    })
    const keys = await listApiKeys(prisma as never, "org-1")
    expect(keys.eia).toBe("EIA_KEY_VALUE")
    expect(keys.usda).toBe("USDA_KEY_VALUE")
    expect(keys.gtrends).toBeNull()
  })

  it("returns all-null when org not found", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(),
      },
    }
    const keys = await listApiKeys(prisma as never, "missing")
    expect(keys.eia).toBeNull()
  })

  it("survives DB errors gracefully", async () => {
    const prisma = {
      organization: {
        findUnique: vi.fn(async () => {
          throw new Error("DB down")
        }),
        update: vi.fn(),
      },
    }
    const keys = await listApiKeys(prisma as never, "org-1")
    expect(keys.eia).toBeNull()
  })

  it("ignores non-string / empty key values", async () => {
    const prisma = makeFakePrisma({
      settings: { apiKeys: { eia: "", usda: 12345 as never, gtrends: "GOOD_KEY" } },
    })
    const keys = await listApiKeys(prisma as never, "org-1")
    expect(keys.eia).toBeNull()
    expect(keys.usda).toBeNull()
    expect(keys.gtrends).toBe("GOOD_KEY")
  })
})

describe("getApiKey (convenience)", () => {
  it("returns the requested source's key", async () => {
    const prisma = makeFakePrisma({
      settings: { apiKeys: { eia: "K_eia" } },
    })
    expect(await getApiKey(prisma as never, "org-1", "eia")).toBe("K_eia")
    expect(await getApiKey(prisma as never, "org-1", "usda")).toBeNull()
  })
})

describe("setApiKeys", () => {
  it("writes new keys and reports updated[]", async () => {
    const prisma = makeFakePrisma()
    const result = await setApiKeys(prisma as never, "org-1", {
      eia: "NEW_EIA_KEY_LONG",
    })
    expect(result.updated).toEqual(["eia"])
    expect(result.errors).toEqual([])
    expect(prisma.state.settings).toEqual({
      apiKeys: { eia: "NEW_EIA_KEY_LONG" },
    })
  })

  it("clears keys when passed null / empty", async () => {
    const prisma = makeFakePrisma({
      settings: { apiKeys: { eia: "OLDKEY12345", usda: "USDA_KEY_VAL" } },
    })
    const result = await setApiKeys(prisma as never, "org-1", { eia: null })
    expect(result.cleared).toEqual(["eia"])
    expect(prisma.state.settings).toEqual({
      apiKeys: { usda: "USDA_KEY_VAL" },
    })
  })

  it("rejects keys < 8 chars", async () => {
    const prisma = makeFakePrisma()
    const result = await setApiKeys(prisma as never, "org-1", { eia: "short" })
    expect(result.errors[0]).toContain("too short")
    expect(result.updated).toEqual([])
  })

  it("rejects unknown source names", async () => {
    const prisma = makeFakePrisma()
    const result = await setApiKeys(prisma as never, "org-1", {
      unknown_provider: "VALID_KEY_LONG_ENOUGH",
    } as never)
    expect(result.errors[0]).toContain("unknown source")
  })

  it("preserves unrelated settings keys", async () => {
    const prisma = makeFakePrisma({
      settings: { someOtherSetting: "X", apiKeys: { eia: "OLDEIA_KEY12" } },
    })
    await setApiKeys(prisma as never, "org-1", { usda: "NEW_USDA_KEY" })
    expect(prisma.state.settings).toEqual({
      someOtherSetting: "X",
      apiKeys: { eia: "OLDEIA_KEY12", usda: "NEW_USDA_KEY" },
    })
  })

  it("returns errors=['orgId required'] when orgId blank", async () => {
    const prisma = makeFakePrisma()
    const result = await setApiKeys(prisma as never, "", { eia: "VALID_KEY_LONG" })
    expect(result.errors[0]).toBe("orgId required")
  })

  it("doesn't update Prisma when nothing to do", async () => {
    const prisma = makeFakePrisma()
    const result = await setApiKeys(prisma as never, "org-1", {})
    expect(result.updated).toEqual([])
    expect(result.cleared).toEqual([])
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })
})

describe("redactApiKey", () => {
  it("masks the middle of a long key", () => {
    expect(redactApiKey("ABCDEFGHIJKLMNOP")).toBe("ABCD…MNOP")
  })

  it("returns *** for short / null / undefined", () => {
    expect(redactApiKey(null)).toBe("***")
    expect(redactApiKey(undefined)).toBe("***")
    expect(redactApiKey("")).toBe("***")
    expect(redactApiKey("12345")).toBe("***")
  })
})
