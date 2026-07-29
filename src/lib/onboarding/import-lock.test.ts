/**
 * Phase 11.8 — AI Auto Import mutual exclusion.
 *
 * The scenario these pin: two concurrent applies of the same scope. Every
 * import batch is clean-slate, so under READ COMMITTED they interleave as
 * "A archives N and inserts N; B archives 0 (A already did) and inserts N",
 * leaving a full duplicate set that no guard or constraint catches.
 */
import { describe, it, expect, vi } from "vitest"
import {
  acquireImportLock,
  importLockScope,
  type ImportLockClientFactory,
} from "./import-lock"

function stubClient(locked: boolean) {
  const query = vi.fn(async () => ({ rows: [{ locked }] }))
  const connect = vi.fn(async () => undefined)
  const end = vi.fn(async () => undefined)
  const factory = (() => ({
    connect,
    query,
    end,
  })) as unknown as ImportLockClientFactory
  return { factory, query, connect, end }
}

describe("importLockScope", () => {
  it("scopes to (organization, year) so unrelated imports run in parallel", () => {
    // Two orgs, or one org importing different years, clean-slate disjoint
    // row sets — serialising them would be a pointless throughput cost.
    expect(importLockScope("org1", 2026)).toBe("ai-import:org1:2026")
    expect(importLockScope("org1", 2026)).not.toBe(importLockScope("org1", 2025))
    expect(importLockScope("org1", 2026)).not.toBe(importLockScope("org2", 2026))
  })
})

describe("acquireImportLock", () => {
  it("acquires and reports the scope", async () => {
    const { factory, query } = stubClient(true)
    const lock = await acquireImportLock("org1", 2026, factory)
    expect(lock.acquired).toBe(true)
    expect(lock.scope).toBe("ai-import:org1:2026")
    // Non-blocking: a second import must be REFUSED, not queued behind a
    // multi-minute run whose clean-slate would race it anyway.
    const acquireCall = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(acquireCall[0]).toContain("pg_try_advisory_lock")
    await lock.release()
  })

  it("reports NOT acquired when another import already holds it", async () => {
    const { factory, end } = stubClient(false)
    const lock = await acquireImportLock("org1", 2026, factory)
    expect(lock.acquired).toBe(false)
    await lock.release()
    // A lock we never held must not be unlocked, but the connection must
    // still be returned.
    expect(end).toHaveBeenCalledOnce()
  })

  it("unlocks on the SAME connection it locked, then closes it", async () => {
    // Prisma's pool can run acquire and release on different connections, and
    // a session lock released on the wrong connection is not released at all
    // — hence the dedicated client.
    const { factory, query, end } = stubClient(true)
    const lock = await acquireImportLock("org1", 2026, factory)
    await lock.release()
    expect(query).toHaveBeenCalledTimes(2)
    const unlockCall = query.mock.calls[1] as unknown as [string, unknown[]]
    expect(unlockCall[0]).toContain("pg_advisory_unlock")
    expect(unlockCall[1]).toEqual(["ai-import:org1:2026"])
    expect(end).toHaveBeenCalledOnce()
  })

  it("is idempotent — a second release is a no-op", async () => {
    const { factory, end } = stubClient(true)
    const lock = await acquireImportLock("org1", 2026, factory)
    await lock.release()
    await lock.release()
    expect(end).toHaveBeenCalledOnce()
  })

  it("closes the connection when the unlock query itself fails", async () => {
    // The fail-safe: closing the client releases the session lock even if
    // pg_advisory_unlock errors.
    const connect = vi.fn(async () => undefined)
    const end = vi.fn(async () => undefined)
    let call = 0
    const query = vi.fn(async () => {
      call += 1
      if (call === 1) return { rows: [{ locked: true }] }
      throw new Error("connection reset")
    })
    const lock = await acquireImportLock(
      "org1",
      2026,
      (() => ({ connect, query, end })) as unknown as ImportLockClientFactory,
    )
    await expect(lock.release()).rejects.toThrow("connection reset")
    expect(end).toHaveBeenCalledOnce()
  })

  it("closes the connection when the ACQUIRE query fails", async () => {
    const connect = vi.fn(async () => undefined)
    const end = vi.fn(async () => undefined)
    const query = vi.fn(async () => {
      throw new Error("acquire boom")
    })
    await expect(
      acquireImportLock(
        "org1",
        2026,
        (() => ({ connect, query, end })) as unknown as ImportLockClientFactory,
      ),
    ).rejects.toThrow("acquire boom")
    expect(end).toHaveBeenCalledOnce()
  })
})
