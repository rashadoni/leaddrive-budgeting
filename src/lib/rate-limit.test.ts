import { describe, expect, it } from "vitest"
import type { NextRequest } from "next/server"
import { getClientIp } from "./rate-limit"

function requestWith(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as NextRequest
}

describe("getClientIp", () => {
  it("prefers nginx's overwritten X-Real-IP over a spoofable XFF prefix", () => {
    const request = requestWith({
      "x-real-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.77, 203.0.113.9",
    })
    expect(getClientIp(request)).toBe("203.0.113.9")
  })

  it("falls back to the first forwarded address when no trusted edge header exists", () => {
    const request = requestWith({
      "x-forwarded-for": "198.51.100.77, 203.0.113.9",
    })
    expect(getClientIp(request)).toBe("198.51.100.77")
  })
})
