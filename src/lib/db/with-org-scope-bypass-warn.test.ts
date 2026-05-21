/**
 * Phase 5.2 Stage 2 Round-2 — bypass deprecation test.
 *
 * Asserts that `withOrgScope({ bypass: true })` emits a console.warn
 * pointing callers at `prismaAdmin`. Removed on Stage 2 closure when
 * the `bypass` option is dropped entirely (2026-06-04 target).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock the prisma module so $transaction resolves without touching a
// real DB. The bypass branch runs INSIDE the transaction callback, so
// the warn fires before the test fixture sees the return value.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (
      fn: (tx: {
        $executeRawUnsafe: (sql: string) => Promise<void>
      }) => Promise<unknown>,
    ) => {
      const tx = {
        $executeRawUnsafe: async () => undefined,
      }
      return fn(tx)
    },
  },
}))

import { withOrgScope } from "./with-org-scope"

const ORG_ID = "cm3abcdefghijklmnopqrst" // valid cuid-length

describe("withOrgScope bypass deprecation warning (Phase 5.2 Stage 2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("emits a deprecation warning when bypass:true is passed", async () => {
    await withOrgScope(ORG_ID, async () => "ok", { bypass: true })
    expect(warnSpy).toHaveBeenCalledOnce()
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? "")
    expect(msg).toMatch(/bypass:true is deprecated/i)
    expect(msg).toMatch(/prismaAdmin/i)
  })

  it("does NOT warn when bypass is omitted (normal request flow)", async () => {
    await withOrgScope(ORG_ID, async () => "ok")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("does NOT warn when bypass:false is explicitly passed", async () => {
    await withOrgScope(ORG_ID, async () => "ok", { bypass: false })
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
