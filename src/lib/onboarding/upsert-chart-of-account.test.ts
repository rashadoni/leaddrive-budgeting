/**
 * Phase 2.1 session 1 — unit tests for the CoA upsert helper.
 *
 * Prisma is mocked: tests assert ONLY the cache behavior + upsert
 * payload shape, not real DB writes. Integration coverage of the
 * actual upsert lives in the adapter-level tests once the helper is
 * wired into PLF/BS/CF handlers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createCoACache,
  preWarmCoACache,
  resolveOrCreateAccountId,
} from "./upsert-chart-of-account"
import type { Prisma } from "@prisma/client"

function makeTx() {
  return {
    chartOfAccount: {
      upsert: vi.fn(),
    },
  } as unknown as Prisma.TransactionClient
}

describe("resolveOrCreateAccountId", () => {
  let tx: Prisma.TransactionClient
  let upsert: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tx = makeTx()
    upsert = (tx.chartOfAccount as unknown as { upsert: ReturnType<typeof vi.fn> })
      .upsert
    upsert.mockResolvedValue({ id: "coa_new_123" })
  })

  it("returns a fresh id when the cache is cold + caches subsequent calls", async () => {
    const cache = createCoACache()
    const first = await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "PLF.10.10.1",
    })
    expect(first).toBe("coa_new_123")
    expect(upsert).toHaveBeenCalledTimes(1)

    // Same (org, code) — cache hit, no second upsert call
    upsert.mockResolvedValue({ id: "coa_should_not_be_called" })
    const second = await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "PLF.10.10.1",
    })
    expect(second).toBe("coa_new_123")
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it("treats different orgs as different cache keys", async () => {
    const cache = createCoACache()
    upsert.mockResolvedValueOnce({ id: "coa_a" })
    upsert.mockResolvedValueOnce({ id: "coa_b" })
    const a = await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_a",
      code: "601-01",
    })
    const b = await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_b",
      code: "601-01",
    })
    expect(a).toBe("coa_a")
    expect(b).toBe("coa_b")
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it("passes default name = code when defaultName omitted", async () => {
    const cache = createCoACache()
    await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "PLF.10.10.1",
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: "PLF.10.10.1",
          role: "unknown",
          accountType: "expense", // default
        }),
      }),
    )
  })

  it("uses provided defaultName + defaultAccountType when creating", async () => {
    const cache = createCoACache()
    await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "601-01",
      defaultName: "Sugar Sales",
      defaultAccountType: "revenue",
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          name: "Sugar Sales",
          accountType: "revenue",
          role: "unknown",
        }),
      }),
    )
  })

  it("rejects unknown accountType (falls back to expense)", async () => {
    const cache = createCoACache()
    await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "X",
      defaultAccountType: "made_up_value",
    })
    const call = upsert.mock.calls[0][0] as {
      create: { accountType: string }
    }
    expect(call.create.accountType).toBe("expense")
  })

  it("sends empty update payload (never overrides admin-set fields)", async () => {
    const cache = createCoACache()
    await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "X",
    })
    const call = upsert.mock.calls[0][0] as { update: Record<string, unknown> }
    expect(call.update).toEqual({})
  })

  it("targets the (organizationId, code) compound unique key", async () => {
    const cache = createCoACache()
    await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "X",
    })
    const call = upsert.mock.calls[0][0] as {
      where: { organizationId_code: { organizationId: string; code: string } }
    }
    expect(call.where.organizationId_code).toEqual({
      organizationId: "org_1",
      code: "X",
    })
  })
})

describe("preWarmCoACache", () => {
  it("seeds the cache so the first resolve is a hit", async () => {
    const cache = createCoACache()
    preWarmCoACache(cache, "org_1", [
      { code: "601-01", id: "coa_seeded_1" },
      { code: "711-02", id: "coa_seeded_2" },
    ])
    const tx = makeTx()
    const upsert = (
      tx.chartOfAccount as unknown as { upsert: ReturnType<typeof vi.fn> }
    ).upsert
    const id = await resolveOrCreateAccountId(tx, cache, {
      organizationId: "org_1",
      code: "601-01",
    })
    expect(id).toBe("coa_seeded_1")
    expect(upsert).not.toHaveBeenCalled()
  })

  it("does not bleed across orgs", () => {
    const cache = createCoACache()
    preWarmCoACache(cache, "org_a", [{ code: "X", id: "coa_a" }])
    expect(cache.get("org_a::X")).toBe("coa_a")
    expect(cache.get("org_b::X")).toBeUndefined()
  })
})
