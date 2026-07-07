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
// Stage 3 — pin the app-client mock (same reason as with-org-scope.test.ts).
vi.mock("@/lib/db/prisma-app", async () => {
  const { prisma } = await import("@/lib/prisma")
  return { getPrismaApp: () => prisma, prismaApp: prisma }
})

import { withOrgScope } from "./with-org-scope"

const ORG_ID = "cm3abcdefghijklmnopqrst" // valid cuid-length

describe("withOrgScope bypass deprecation warning (Phase 5.2 Stage 2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let prevLogInTests: string | undefined
  beforeEach(() => {
    // Phase 8 D4 continuation — with-org-scope migrated to structured
    // logger which mutes in test env by default. Opt into LOG_IN_TESTS=1
    // so the existing console.warn spy still observes the emission.
    prevLogInTests = process.env.LOG_IN_TESTS
    process.env.LOG_IN_TESTS = "1"
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
    if (prevLogInTests === undefined) delete process.env.LOG_IN_TESTS
    else process.env.LOG_IN_TESTS = prevLogInTests
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
