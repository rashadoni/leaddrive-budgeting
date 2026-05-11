// @vitest-environment node
/**
 * Phase 7.G Turn CXXIII (Phase 1.1 — chunked savepoints) — tests for
 * `chunkedCreateMany`. Locks the small-payload optimization, the
 * SAVEPOINT-per-chunk wrapping, the ROLLBACK-then-rethrow contract, and
 * the skipDuplicates passthrough.
 */

import { describe, it, expect, vi } from "vitest"
import { chunkedCreateMany } from "./chunked-create-many"
import type { Prisma } from "@prisma/client"

/** Build a fake `tx` exposing only `$executeRawUnsafe`. Records every
 *  SAVEPOINT/RELEASE/ROLLBACK statement for assertion. */
function fakeTx() {
  const sqlCalls: string[] = []
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      sqlCalls.push(sql)
      return 0
    }),
  } as unknown as Prisma.TransactionClient
  return { tx, sqlCalls }
}

function fakeDelegate(opts: { onCall?: (callIdx: number, data: unknown[]) => void; throwOnCall?: number } = {}) {
  let callCount = 0
  return {
    createMany: vi.fn(async ({ data }: { data: unknown[]; skipDuplicates?: boolean }) => {
      const idx = callCount++
      opts.onCall?.(idx, data)
      if (opts.throwOnCall === idx) {
        throw new Error(`fake createMany failure at chunk ${idx}`)
      }
      return { count: data.length }
    }),
  }
}

describe("chunkedCreateMany — small-payload fast path", () => {
  it("returns {0, 0, false} on empty data + makes zero SQL calls", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate()
    const result = await chunkedCreateMany(tx, delegate, [])
    expect(result).toEqual({ totalInserted: 0, chunkCount: 0, usedSavepoints: false })
    expect(delegate.createMany).not.toHaveBeenCalled()
    expect(sqlCalls).toEqual([])
  })

  it("data.length ≤ chunkSize → single createMany, NO savepoint overhead", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate()
    const result = await chunkedCreateMany(tx, delegate, [{ x: 1 }, { x: 2 }, { x: 3 }], {
      chunkSize: 5000,
    })
    expect(result).toEqual({ totalInserted: 3, chunkCount: 1, usedSavepoints: false })
    expect(delegate.createMany).toHaveBeenCalledOnce()
    expect(delegate.createMany).toHaveBeenCalledWith({ data: [{ x: 1 }, { x: 2 }, { x: 3 }], skipDuplicates: undefined })
    expect(sqlCalls).toEqual([]) // no SAVEPOINT calls
  })

  it("data.length === chunkSize boundary → still small-payload path", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate()
    const data = Array.from({ length: 100 }, (_, i) => ({ idx: i }))
    const result = await chunkedCreateMany(tx, delegate, data, { chunkSize: 100 })
    expect(result).toEqual({ totalInserted: 100, chunkCount: 1, usedSavepoints: false })
    expect(sqlCalls).toEqual([]) // boundary case: ≤ not <
  })
})

describe("chunkedCreateMany — chunked path with SAVEPOINTs", () => {
  it("data.length > chunkSize → multiple chunks + SAVEPOINT/RELEASE per chunk", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate()
    const data = Array.from({ length: 12 }, (_, i) => ({ i }))
    const result = await chunkedCreateMany(tx, delegate, data, { chunkSize: 5 })
    expect(result).toEqual({ totalInserted: 12, chunkCount: 3, usedSavepoints: true })
    expect(delegate.createMany).toHaveBeenCalledTimes(3)
    // 3 chunks: 5+5+2 rows
    expect(delegate.createMany.mock.calls[0][0].data).toHaveLength(5)
    expect(delegate.createMany.mock.calls[1][0].data).toHaveLength(5)
    expect(delegate.createMany.mock.calls[2][0].data).toHaveLength(2)
    // SQL: SAVEPOINT chunk_0, RELEASE chunk_0, SAVEPOINT chunk_1, RELEASE chunk_1, SAVEPOINT chunk_2, RELEASE chunk_2
    expect(sqlCalls).toEqual([
      "SAVEPOINT chunk_0",
      "RELEASE SAVEPOINT chunk_0",
      "SAVEPOINT chunk_1",
      "RELEASE SAVEPOINT chunk_1",
      "SAVEPOINT chunk_2",
      "RELEASE SAVEPOINT chunk_2",
    ])
  })

  it("custom savepointPrefix used in SQL names", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate()
    const data = Array.from({ length: 6 }, (_, i) => ({ i }))
    await chunkedCreateMany(tx, delegate, data, {
      chunkSize: 3,
      savepointPrefix: "budgetlines",
    })
    expect(sqlCalls.filter((s) => s.startsWith("SAVEPOINT"))).toEqual([
      "SAVEPOINT budgetlines_0",
      "SAVEPOINT budgetlines_1",
    ])
  })
})

describe("chunkedCreateMany — failure semantics", () => {
  it("createMany throws → ROLLBACK TO SAVEPOINT fired + error re-thrown", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate({ throwOnCall: 1 }) // 2nd chunk fails
    const data = Array.from({ length: 12 }, (_, i) => ({ i }))
    await expect(
      chunkedCreateMany(tx, delegate, data, { chunkSize: 5 }),
    ).rejects.toThrow(/fake createMany failure at chunk 1/)
    // SQL calls trace: SAVEPOINT 0, RELEASE 0, SAVEPOINT 1, ROLLBACK 1
    expect(sqlCalls).toEqual([
      "SAVEPOINT chunk_0",
      "RELEASE SAVEPOINT chunk_0",
      "SAVEPOINT chunk_1",
      "ROLLBACK TO SAVEPOINT chunk_1",
    ])
    // 3rd chunk never attempted
    expect(delegate.createMany).toHaveBeenCalledTimes(2)
  })

  it("first chunk fails → ROLLBACK to chunk_0 + re-throw + nothing else attempted", async () => {
    const { tx, sqlCalls } = fakeTx()
    const delegate = fakeDelegate({ throwOnCall: 0 })
    const data = Array.from({ length: 12 }, (_, i) => ({ i }))
    await expect(
      chunkedCreateMany(tx, delegate, data, { chunkSize: 5 }),
    ).rejects.toThrow(/fake createMany failure at chunk 0/)
    expect(sqlCalls).toEqual(["SAVEPOINT chunk_0", "ROLLBACK TO SAVEPOINT chunk_0"])
    expect(delegate.createMany).toHaveBeenCalledOnce()
  })

  it("ROLLBACK SQL itself failing is swallowed — original error still surfaces", async () => {
    const sqlCalls: string[] = []
    let rollbackCalled = false
    const tx = {
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        sqlCalls.push(sql)
        if (sql.startsWith("ROLLBACK TO SAVEPOINT")) {
          rollbackCalled = true
          throw new Error("rollback failed too")
        }
        return 0
      }),
    } as unknown as Prisma.TransactionClient
    const delegate = fakeDelegate({ throwOnCall: 0 })
    const data = Array.from({ length: 12 }, (_, i) => ({ i }))
    await expect(
      chunkedCreateMany(tx, delegate, data, { chunkSize: 5 }),
    ).rejects.toThrow(/fake createMany failure at chunk 0/) // NOT "rollback failed too"
    expect(rollbackCalled).toBe(true)
  })
})

describe("chunkedCreateMany — passthrough + validation", () => {
  it("skipDuplicates passed through to createMany on small-payload path", async () => {
    const { tx } = fakeTx()
    const delegate = fakeDelegate()
    await chunkedCreateMany(tx, delegate, [{ x: 1 }], { skipDuplicates: true })
    expect(delegate.createMany).toHaveBeenCalledWith({ data: [{ x: 1 }], skipDuplicates: true })
  })

  it("skipDuplicates passed through to every chunk on chunked path", async () => {
    const { tx } = fakeTx()
    const delegate = fakeDelegate()
    const data = Array.from({ length: 6 }, (_, i) => ({ i }))
    await chunkedCreateMany(tx, delegate, data, { chunkSize: 3, skipDuplicates: true })
    for (const call of delegate.createMany.mock.calls) {
      expect(call[0].skipDuplicates).toBe(true)
    }
  })

  it("rejects chunkSize < 1", async () => {
    const { tx } = fakeTx()
    const delegate = fakeDelegate()
    await expect(
      chunkedCreateMany(tx, delegate, [{ x: 1 }], { chunkSize: 0 }),
    ).rejects.toThrow(/chunkSize must be ≥ 1/)
  })

  it("rejects savepointPrefix with invalid SQL identifier chars (injection guard)", async () => {
    const { tx } = fakeTx()
    const delegate = fakeDelegate()
    await expect(
      chunkedCreateMany(tx, delegate, Array.from({ length: 10 }, (_, i) => ({ i })), {
        chunkSize: 5,
        savepointPrefix: "evil; DROP TABLE x;--",
      }),
    ).rejects.toThrow(/savepointPrefix must match/)
  })
})
