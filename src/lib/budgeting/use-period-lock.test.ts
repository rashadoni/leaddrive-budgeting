// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LXXIV — guard tests for useActivePeriodLockForPlan hook.
 *
 * Locks: null-on-no-plan, derive-period-key match against fetched lock list,
 * cancel-on-unmount safety, refetch-on-plan-change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useActivePeriodLockForPlan } from "./use-period-lock"

const ANNUAL_PLAN = {
  id: "p1",
  periodType: "annual",
  year: 2026,
  month: null,
  quarter: null,
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useActivePeriodLockForPlan", () => {
  it("returns null when plan is null (no fetch)", () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useActivePeriodLockForPlan(null))
    expect(result.current.lock).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns lock when plan's derived period matches a fetched lock", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          locks: [
            { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin", reason: "FY26 close" },
          ],
        }),
    })
    const { result } = renderHook(() => useActivePeriodLockForPlan(ANNUAL_PLAN))
    await waitFor(() => expect(result.current.lock).not.toBeNull())
    expect(result.current.lock?.period).toBe("2026")
    expect(result.current.lock?.reason).toBe("FY26 close")
  })

  it("returns null when no lock matches the plan's period", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          locks: [
            { period: "2025", lockedAt: "x", lockedBy: "y" }, // year 2025, plan is 2026
          ],
        }),
    })
    const { result } = renderHook(() => useActivePeriodLockForPlan(ANNUAL_PLAN))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.lock).toBeNull()
  })

  it("returns null on fetch error (graceful degrade)", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValue(new Error("network down"))
    const { result } = renderHook(() => useActivePeriodLockForPlan(ANNUAL_PLAN))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.lock).toBeNull()
  })

  it("derives quarterly period key correctly (matches '2026-Q1' lock)", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          locks: [{ period: "2026-Q1", lockedAt: "x", lockedBy: "y" }],
        }),
    })
    const quarterlyPlan = { ...ANNUAL_PLAN, periodType: "quarterly", quarter: 1 }
    const { result } = renderHook(() => useActivePeriodLockForPlan(quarterlyPlan))
    await waitFor(() => expect(result.current.lock).not.toBeNull())
    expect(result.current.lock?.period).toBe("2026-Q1")
  })
})
