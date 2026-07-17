import { describe, expect, it, vi } from "vitest"
import {
  acquireRefreshFeedsLock,
  REFRESH_FEEDS_LOCK_KEY,
} from "./refresh-feeds-lock"

function makeClient(locked: boolean) {
  const connect = vi.fn().mockResolvedValue(undefined)
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ locked }] })
    .mockResolvedValueOnce({ rows: [{ unlocked: true }] })
  const end = vi.fn().mockResolvedValue(undefined)
  return { client: { connect, query, end }, connect, query, end }
}

describe("refresh-feeds advisory lock", () => {
  it("holds and releases the lock on the same dedicated client", async () => {
    const fixture = makeClient(true)
    const lock = await acquireRefreshFeedsLock(() => fixture.client)

    expect(lock.acquired).toBe(true)
    expect(fixture.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [REFRESH_FEEDS_LOCK_KEY],
    )
    expect(fixture.end).not.toHaveBeenCalled()

    await lock.release()
    expect(fixture.query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock($1::bigint) AS unlocked",
      [REFRESH_FEEDS_LOCK_KEY],
    )
    expect(fixture.end).toHaveBeenCalledOnce()
  })

  it("closes a busy-lock connection without issuing unlock", async () => {
    const fixture = makeClient(false)
    const lock = await acquireRefreshFeedsLock(() => fixture.client)

    expect(lock.acquired).toBe(false)
    await lock.release()

    expect(fixture.query).toHaveBeenCalledOnce()
    expect(fixture.end).toHaveBeenCalledOnce()
  })

  it("closes the client when lock acquisition throws", async () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn().mockRejectedValue(new Error("db unavailable"))
    const end = vi.fn().mockResolvedValue(undefined)

    await expect(
      acquireRefreshFeedsLock(() => ({ connect, query, end })),
    ).rejects.toThrow("db unavailable")
    expect(end).toHaveBeenCalledOnce()
  })
})
