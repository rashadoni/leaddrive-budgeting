// @vitest-environment node
/**
 * 2026-08-04 — the header that decides whether the feeds work at all.
 *
 * Node's global fetch identifies as `User-Agent: node`, and api.worldbank.org
 * answers 403 to exactly that. Both World Bank adapters had therefore never
 * succeeded in production while curl from the same box worked. `worldbank-cpi`
 * was fixed alone and `wb-indicators` kept 403ing — the fix had gone to the
 * adapter the error list named rather than to every caller of that API. These
 * cases exist so the shared constant cannot quietly regress to `node`, and so
 * the rate-limit retry is exercised without waiting a real second.
 */
import { describe, it, expect, vi } from "vitest"
import {
  OUTBOUND_USER_AGENT,
  OUTBOUND_FETCH_INIT,
  fetchWithRateLimitRetry,
} from "./outbound-agent"

function res(status: number, retryAfter?: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => (k === "Retry-After" ? (retryAfter ?? null) : null) },
  } as unknown as Response
}

describe("OUTBOUND_USER_AGENT", () => {
  it("is not the bare `node` that World Bank refuses", () => {
    expect(OUTBOUND_USER_AGENT).not.toBe("node")
  })

  it("identifies the app honestly rather than impersonating a browser", () => {
    expect(OUTBOUND_USER_AGENT).toContain("BudgetPro")
    expect(OUTBOUND_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari/)
  })

  it("ships a ready header bag carrying it", () => {
    expect(
      (OUTBOUND_FETCH_INIT.headers as Record<string, string>)["User-Agent"],
    ).toBe(OUTBOUND_USER_AGENT)
  })
})

describe("fetchWithRateLimitRetry", () => {
  it("sends the User-Agent on the request", async () => {
    const seen: RequestInit[] = []
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      seen.push(init ?? {})
      return res(200)
    })
    await fetchWithRateLimitRetry(fetchImpl as unknown as typeof fetch, "https://x")
    expect((seen[0].headers as Record<string, string>)["User-Agent"]).toBe(
      OUTBOUND_USER_AGENT,
    )
  })

  it("returns a good response untouched, without sleeping", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () => res(200))
    const r = await fetchWithRateLimitRetry(
      fetchImpl as unknown as typeof fetch,
      "https://x",
      sleep,
    )
    expect(r.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("retries once on 429 — what Comtrade's preview tier asks for", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(200))
    const r = await fetchWithRateLimitRetry(
      fetchImpl as unknown as typeof fetch,
      "https://x",
      sleep,
    )
    expect(r.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1100)
  })

  it("honours Retry-After when the server states its own quota", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(429, "3"))
      .mockResolvedValueOnce(res(200))
    await fetchWithRateLimitRetry(
      fetchImpl as unknown as typeof fetch,
      "https://x",
      sleep,
    )
    expect(sleep).toHaveBeenCalledWith(3000)
  })

  it("caps an absurd Retry-After rather than stalling the whole run", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(429, "86400"))
      .mockResolvedValueOnce(res(200))
    await fetchWithRateLimitRetry(
      fetchImpl as unknown as typeof fetch,
      "https://x",
      sleep,
    )
    expect(sleep).toHaveBeenCalledWith(10_000)
  })

  it("gives up after one retry — a still-throttled feed is reported, not hidden", async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () => res(429))
    const r = await fetchWithRateLimitRetry(
      fetchImpl as unknown as typeof fetch,
      "https://x",
      sleep,
    )
    expect(r.status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("does not retry a plain failure — 403 is not a rate limit", async () => {
    const fetchImpl = vi.fn(async () => res(403))
    const r = await fetchWithRateLimitRetry(
      fetchImpl as unknown as typeof fetch,
      "https://x",
    )
    expect(r.status).toBe(403)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
