// @vitest-environment happy-dom
/**
 * Truth-infra E.4 — guard tests for TerminalLockedPeriodBanner.
 *
 * Locks: renders nothing when no period / no lock / period mismatch;
 * renders amber strip + lock icon + period when matrix period matches
 * an active org lock; aria-label and testid contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"

const { useMatrixMock, fetchMock } = vi.hoisted(() => ({
  useMatrixMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock("../hooks/use-matrix", () => ({
  useMatrix: useMatrixMock,
}))

import { TerminalLockedPeriodBanner } from "./TerminalLockedPeriodBanner"

beforeEach(() => {
  useMatrixMock.mockReset()
  fetchMock.mockReset()
  // Default: no fetch should be invoked by tests that bail early
  ;(global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
})

function mockLocksResponse(locks: Array<{ period: string; lockedAt: string; lockedBy: string; reason?: string }>) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ locks }),
  } as Response)
}

describe("TerminalLockedPeriodBanner", () => {
  it("renders nothing when matrix has no period yet (initial load)", () => {
    useMatrixMock.mockReturnValue({ matrix: null })
    const { container } = render(<TerminalLockedPeriodBanner />)
    expect(container.innerHTML).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("renders nothing when org has no locks", async () => {
    useMatrixMock.mockReturnValue({ matrix: { period: "2026-Q1" } })
    mockLocksResponse([])
    const { container } = render(<TerminalLockedPeriodBanner />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/budgeting/period-locks")
    })
    expect(container.querySelector("[data-testid=terminal-locked-period-banner]")).toBeNull()
  })

  it("renders nothing when locks exist but none matches active matrix period", async () => {
    useMatrixMock.mockReturnValue({ matrix: { period: "2026-Q1" } })
    mockLocksResponse([
      { period: "2025-Q4", lockedAt: "x", lockedBy: "u_admin", reason: "FY25 close" },
    ])
    render(<TerminalLockedPeriodBanner />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(screen.queryByTestId("terminal-locked-period-banner")).toBeNull()
  })

  it("renders banner when matrix period matches a lock", async () => {
    useMatrixMock.mockReturnValue({ matrix: { period: "2026-Q1" } })
    mockLocksResponse([
      { period: "2026-Q1", lockedAt: "2026-04-01T00:00:00Z", lockedBy: "u_admin", reason: "Q1 close" },
    ])
    render(<TerminalLockedPeriodBanner />)
    const banner = await screen.findByTestId("terminal-locked-period-banner")
    expect(banner).toBeTruthy()
    expect(banner.textContent).toContain("2026-Q1")
    // role="status" for assistive tech — soft announcement, not alert
    expect(banner.getAttribute("role")).toBe("status")
    expect(banner.getAttribute("aria-label")).toBeTruthy()
  })

  it("uses amber color + cursor-help affordance (tooltip hint)", async () => {
    useMatrixMock.mockReturnValue({ matrix: { period: "2026" } })
    mockLocksResponse([
      { period: "2026", lockedAt: "2027-01-01T00:00:00Z", lockedBy: "u_admin" },
    ])
    render(<TerminalLockedPeriodBanner />)
    const banner = await screen.findByTestId("terminal-locked-period-banner")
    expect(banner.className).toContain("amber")
    expect(banner.className).toContain("cursor-help")
  })

  it("renders nothing when fetch fails (graceful degradation)", async () => {
    useMatrixMock.mockReturnValue({ matrix: { period: "2026-Q1" } })
    fetchMock.mockRejectedValue(new Error("net down"))
    const { container } = render(<TerminalLockedPeriodBanner />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    expect(container.querySelector("[data-testid=terminal-locked-period-banner]")).toBeNull()
  })
})
