import { describe, it, expect } from "vitest"
import { bearerMatches } from "./cron-auth"

const SECRET = "s3cr3t-cron-value-long-enough"

describe("bearerMatches", () => {
  it("accepts the exact header the scheduler sends", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it("rejects a wrong secret, a wrong scheme, and a bare secret", () => {
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(bearerMatches(`Bearer wrong`, SECRET)).toBe(false)
    expect(bearerMatches(`Basic ${SECRET}`, SECRET)).toBe(false)
    expect(bearerMatches(SECRET, SECRET)).toBe(false)
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(false)
  })

  it("rejects a missing header instead of throwing", () => {
    // `/api/cron/*` sits in the proxy's publicPaths, so an anonymous request
    // reaches this function. It must answer false, not crash the route into a
    // 500 that reveals a stack.
    expect(bearerMatches(null, SECRET)).toBe(false)
    expect(bearerMatches(undefined, SECRET)).toBe(false)
    expect(bearerMatches("", SECRET)).toBe(false)
  })

  it("rejects everything when no secret is configured", () => {
    // The routes already 503 before reaching here, but a helper whose answer
    // to "empty secret" is `true` would be a trap for the next caller.
    expect(bearerMatches("Bearer ", "")).toBe(false)
    expect(bearerMatches("Bearer anything", "")).toBe(false)
  })

  it("does not throw on a length mismatch, which is what timingSafeEqual does", () => {
    // The reason the length check exists at all: `timingSafeEqual` throws on
    // differing lengths, so removing that guard turns a failed auth attempt
    // into a 500.
    expect(() => bearerMatches("Bearer x", SECRET)).not.toThrow()
    expect(bearerMatches("Bearer x", SECRET)).toBe(false)
    expect(bearerMatches(`Bearer ${SECRET}${SECRET}`, SECRET)).toBe(false)
  })
})
