// @vitest-environment happy-dom
/**
 * Phase 8 E1 — ComplianceHub UI smoke for the close/reopen toggle.
 *
 * Locks:
 *  - Each audit finding renders an action button
 *  - Clicking "Close" POSTs to /api/admin/compliance/finding with
 *    companyId + findingIdx + action: "close"
 *  - Optimistic flip → button now reads "Reopen"
 *  - API failure rolls the optimistic flip back + shows an error
 */
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { ComplianceHub, type EntityComplianceData } from "./ComplianceHub"

const ENTITY: EntityComplianceData = {
  id: "co_aac_main",
  code: "AZSEKER-AZSF",
  name: "AZSF",
  industry: "food_processing",
  auditFindings: {
    summary: { total: 1, completed: 0, completedPct: 0, major_open: 1 },
    items: [
      {
        severity: "Major",
        audit: "Sample finding",
        status: "icra olunur",
        grouping: "Operations",
        findingStatusJan: "open",
      },
    ],
  },
  courtDisputes: null,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ComplianceHub close/reopen toggle", () => {
  it("renders a close button for open findings", () => {
    render(<ComplianceHub entities={[ENTITY]} />)
    const btn = screen.getByTestId("finding-toggle-AZSEKER-AZSF-0")
    expect(btn).toBeTruthy()
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it("clicking Close PATCHes the endpoint and flips the button to Reopen", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        companyCode: "AZSEKER-AZSF",
        findingIdx: 0,
        finding: { closed: true },
        summary: { total: 1, completed: 1, completedPct: 100 },
      }),
    } as Response)

    render(<ComplianceHub entities={[ENTITY]} />)
    const btn = screen.getByTestId("finding-toggle-AZSEKER-AZSF-0")
    fireEvent.click(btn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/admin/compliance/finding")
    expect(init.method).toBe("PATCH")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      companyId: "co_aac_main",
      findingIdx: 0,
      action: "close",
    })

    // After success, button should optimistically read "Reopen" and the
    // status badge becomes "Closed".
    await waitFor(() => {
      const btnAfter = screen.getByTestId("finding-toggle-AZSEKER-AZSF-0")
      expect(btnAfter.textContent ?? "").toMatch(/Reopen|Открыть|Yenidən/i)
    })
  })

  it("rolls back the optimistic flip + shows an error banner on PATCH failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: "Forbidden" }),
    } as Response)

    render(<ComplianceHub entities={[ENTITY]} />)
    const btn = screen.getByTestId("finding-toggle-AZSEKER-AZSF-0")
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toMatch(/Forbidden/)
    })
    // Optimistic state should have rolled back — button still says "Close".
    const btnAfter = screen.getByTestId("finding-toggle-AZSEKER-AZSF-0")
    expect(btnAfter.textContent ?? "").toMatch(/Close|Закрыть|Bağla/i)
  })
})
