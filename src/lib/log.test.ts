/**
 * Tests for the structured logger (Phase 8 D4).
 *
 * Default test env mutes everything; `LOG_IN_TESTS=1` opt-in turns
 * emission back on so we can assert on output shape.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const origNodeEnv = process.env.NODE_ENV
const origLogLevel = process.env.LOG_LEVEL
const origLogInTests = process.env.LOG_IN_TESTS

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  // NODE_ENV is read-only in Next.js types; mutate via Object.assign
  // (which the type system tolerates) to keep test isolation working.
  Object.assign(process.env, { NODE_ENV: origNodeEnv })
  if (origLogLevel === undefined) delete process.env.LOG_LEVEL
  else process.env.LOG_LEVEL = origLogLevel
  if (origLogInTests === undefined) delete process.env.LOG_IN_TESTS
  else process.env.LOG_IN_TESTS = origLogInTests
})

describe("getLogger", () => {
  it("is silent in test env by default", async () => {
    delete process.env.LOG_IN_TESTS
    const { getLogger } = await import("./log")
    const log = getLogger("test-scope")
    log.info("hello")
    log.warn("world")
    log.error("kaboom")
    expect(console.log).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it("emits when LOG_IN_TESTS=1", async () => {
    process.env.LOG_IN_TESTS = "1"
    const { getLogger } = await import("./log")
    const log = getLogger("test-scope")
    log.info("hello", { count: 42 })
    expect(console.log).toHaveBeenCalledOnce()
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(line).toContain("test-scope")
    expect(line).toContain("hello")
    expect(line).toContain("42")
  })

  it("emits errors to console.error (not console.log)", async () => {
    process.env.LOG_IN_TESTS = "1"
    const { getLogger } = await import("./log")
    const log = getLogger("test-scope")
    log.error("boom")
    expect(console.error).toHaveBeenCalledOnce()
    expect(console.log).not.toHaveBeenCalled()
  })

  it("respects LOG_LEVEL=warn — info calls are dropped", async () => {
    process.env.LOG_IN_TESTS = "1"
    process.env.LOG_LEVEL = "warn"
    const { getLogger } = await import("./log")
    const log = getLogger("test-scope")
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    // info + debug muted, warn + error pass
    expect(console.log).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledOnce()
    expect(console.error).toHaveBeenCalledOnce()
  })

  it("formats production output as JSON with stable fields", async () => {
    process.env.LOG_IN_TESTS = "1"
    Object.assign(process.env, { NODE_ENV: "production" })
    const { getLogger } = await import("./log")
    const log = getLogger("api:indicators")
    log.info("recompute fired", { pairs: 3, durationMs: 42 })
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const parsed = JSON.parse(line)
    expect(parsed.scope).toBe("api:indicators")
    expect(parsed.level).toBe("info")
    expect(parsed.msg).toBe("recompute fired")
    expect(parsed.pairs).toBe(3)
    expect(parsed.durationMs).toBe(42)
    expect(typeof parsed.ts).toBe("string")
  })

  it("handles unserializable payloads without throwing", async () => {
    process.env.LOG_IN_TESTS = "1"
    const { getLogger } = await import("./log")
    const log = getLogger("test-scope")
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => log.info("oops", cyclic)).not.toThrow()
  })
})
