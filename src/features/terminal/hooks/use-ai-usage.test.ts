// @vitest-environment happy-dom
/**
 * Unit tests for Phase 7.O C2 `useAiUsage` + `formatTokens`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useAiUsage, formatTokens } from "./use-ai-usage"

describe("formatTokens", () => {
  it("renders zero / negative as '0'", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(-5)).toBe("0")
  })

  it("renders sub-1000 as a plain integer", () => {
    expect(formatTokens(450)).toBe("450")
    expect(formatTokens(999)).toBe("999")
  })

  it("renders thousands with K suffix", () => {
    expect(formatTokens(1500)).toBe("1.5K")
    expect(formatTokens(12_300)).toBe("12.3K")
    expect(formatTokens(100_000)).toBe("100K")
  })

  it("renders millions with M suffix", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M")
    expect(formatTokens(12_300_000)).toBe("12.3M")
  })
})

describe("useAiUsage hook", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          today: { tokensIn: 800, tokensOut: 200, calls: 2, total: 1000 },
          mtd: { tokensIn: 8000, tokensOut: 2000, calls: 25, total: 10_000 },
          updatedAt: new Date().toISOString(),
        }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads usage from /api/me/ai-usage and exposes today + mtd", async () => {
    const { result } = renderHook(() => useAiUsage())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.today.total).toBe(1000)
    expect(result.current.mtd.total).toBe(10_000)
    expect(result.current.error).toBeNull()
  })

  it("treats 401 / 403 as a silent no-op (chip stays at zero)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    )
    const { result } = renderHook(() => useAiUsage())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.today.total).toBe(0)
    expect(result.current.error).toBeNull()
  })

  it("captures network errors as state.error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    const { result } = renderHook(() => useAiUsage())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe("offline")
  })
})
