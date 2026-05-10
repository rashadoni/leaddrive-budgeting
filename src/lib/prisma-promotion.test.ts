// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import {
  tryPrismaThenFallback,
  isTableMissingError,
  PRISMA_TABLE_NOT_EXIST_CODE,
} from "./prisma-promotion"

describe("isTableMissingError", () => {
  it("detects P2021 code", () => {
    expect(isTableMissingError({ code: PRISMA_TABLE_NOT_EXIST_CODE })).toBe(true)
  })

  it("detects 'does not exist in the current database' in message", () => {
    expect(
      isTableMissingError(new Error('Table "ai_mapper_proposal_cache" does not exist in the current database.')),
    ).toBe(true)
  })

  it("detects PostgreSQL 'relation X does not exist' format", () => {
    expect(
      isTableMissingError(new Error('relation "ai_token_usage" does not exist')),
    ).toBe(true)
  })

  it("returns false for generic errors", () => {
    expect(isTableMissingError(new Error("Connection refused"))).toBe(false)
    expect(isTableMissingError(new Error("FK constraint violated"))).toBe(false)
  })

  it("returns false for null/undefined/non-object", () => {
    expect(isTableMissingError(null)).toBe(false)
    expect(isTableMissingError(undefined)).toBe(false)
    expect(isTableMissingError("string error")).toBe(false)
    expect(isTableMissingError(42)).toBe(false)
  })

  it("detects test-mock TypeError (model accessor undefined)", () => {
    // Reproduces what happens when test does
    //   vi.mock("@/lib/prisma", () => ({ prisma: {} }))
    // and code calls `prisma.aiMapperProposalCache.findUnique(...)`:
    let caught: unknown = null
    try {
      const fakePrisma = {} as { aiMapperProposalCache?: { findUnique: () => unknown } }
      // @ts-expect-error — intentional to trigger TypeError
      fakePrisma.aiMapperProposalCache.findUnique({})
    } catch (e) {
      caught = e
    }
    expect(isTableMissingError(caught)).toBe(true)
  })

  it("detects TypeError for upsert / create / update / delete / findMany", () => {
    const ops = ["upsert", "create", "update", "delete", "findMany", "count", "aggregate"]
    for (const op of ops) {
      const err = new TypeError(`Cannot read properties of undefined (reading '${op}')`)
      expect(isTableMissingError(err)).toBe(true)
    }
  })

  it("does NOT swallow real TypeError from non-prisma code", () => {
    // Random TypeError without a prisma method name should bubble up
    const err = new TypeError("Cannot read properties of undefined (reading 'foo')")
    expect(isTableMissingError(err)).toBe(false)
  })
})

describe("tryPrismaThenFallback", () => {
  it("returns Prisma result when prismaFn succeeds", async () => {
    const result = await tryPrismaThenFallback(
      async () => "from-prisma",
      () => "from-memory",
    )
    expect(result).toBe("from-prisma")
  })

  it("falls to in-memory on P2021", async () => {
    const result = await tryPrismaThenFallback(
      async () => {
        const err = new Error("Table missing")
        ;(err as Error & { code: string }).code = PRISMA_TABLE_NOT_EXIST_CODE
        throw err
      },
      () => "from-memory",
    )
    expect(result).toBe("from-memory")
  })

  it("falls to in-memory on 'relation does not exist' postgres error", async () => {
    const result = await tryPrismaThenFallback(
      async () => {
        throw new Error('relation "variance_explanations" does not exist')
      },
      () => "from-memory",
    )
    expect(result).toBe("from-memory")
  })

  it("re-throws non-table-missing errors", async () => {
    await expect(
      tryPrismaThenFallback(
        async () => {
          throw new Error("Real bug — connection refused")
        },
        () => "should not reach",
      ),
    ).rejects.toThrow(/Real bug/)
  })

  it("supports async in-memory fallback", async () => {
    const result = await tryPrismaThenFallback(
      async () => {
        throw new Error("relation does not exist")
      },
      async () => {
        await new Promise((r) => setTimeout(r, 1))
        return "async-memory"
      },
    )
    expect(result).toBe("async-memory")
  })

  it("calls Prisma fn before in-memory (Prisma is primary)", async () => {
    const order: string[] = []
    await tryPrismaThenFallback(
      async () => {
        order.push("prisma")
        const err = new Error("table missing")
        ;(err as Error & { code: string }).code = PRISMA_TABLE_NOT_EXIST_CODE
        throw err
      },
      () => {
        order.push("memory")
        return "ok"
      },
    )
    expect(order).toEqual(["prisma", "memory"])
  })
})
