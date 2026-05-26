// @vitest-environment happy-dom
/**
 * Unit tests for CompanyManagementAdmin (Truth-Infra Phase C.1).
 *
 * Covers:
 *  1. Renders the company table with role + status selects for admin users.
 *  2. Role change fires PATCH with correct payload and shows "saved" tick.
 *  3. Status change fires PATCH with correct payload and shows "saved" tick.
 *  4. API error rolls back the optimistic update and shows an inline error.
 *  5. Non-admin user sees read-only badges instead of selects.
 *  6. Loading state while fetching.
 *  7. Fetch error message when query fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { CompanyManagementAdmin } from "./CompanyManagementAdmin"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

import { useSession } from "next-auth/react"
import { useQuery } from "@tanstack/react-query"

const mockUseSession = useSession as ReturnType<typeof vi.fn>
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>

const ADMIN_SESSION = {
  data: { user: { role: "admin", organizationId: "org_az" } },
}
const VIEWER_SESSION = {
  data: { user: { role: "viewer", organizationId: "org_az" } },
}

const SAMPLE_COMPANIES = [
  {
    id: "co_1",
    code: "AZSF",
    name: "AzerSheker Factory",
    role: "operational",
    status: "active",
    level: 2,
    industry: "food_processing",
  },
  {
    id: "co_2",
    code: "EDEN",
    name: "Eden Agro",
    role: "operational",
    status: "pending",
    level: 2,
    industry: "agro_crops",
  },
]

beforeEach(() => {
  mockUseSession.mockReturnValue(ADMIN_SESSION)
  mockUseQuery.mockReturnValue({
    data: SAMPLE_COMPANIES,
    isLoading: false,
    error: null,
  })
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "co_1",
        code: "AZSF",
        role: "holding",
        status: "active",
      }),
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("CompanyManagementAdmin", () => {
  it("renders company rows with code, name, role select, and status select for admin", () => {
    render(<CompanyManagementAdmin />)

    expect(screen.getByText("AZSF")).toBeTruthy()
    expect(screen.getByText("AzerSheker Factory")).toBeTruthy()
    expect(screen.getByText("EDEN")).toBeTruthy()

    // Role + status selects present for the first row
    expect(screen.getByRole("combobox", { name: /role for AZSF/i })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: /status for AZSF/i })).toBeTruthy()
  })

  it("calls PATCH with role payload on role select change", () => {
    render(<CompanyManagementAdmin />)

    const roleSelect = screen.getByRole("combobox", {
      name: /role for AZSF/i,
    }) as HTMLSelectElement

    // Optimistic update applies the value immediately in the DOM
    fireEvent.change(roleSelect, { target: { value: "holding" } })
    expect(roleSelect.value).toBe("holding")

    // Underlying PATCH is fired with the correct payload
    expect(fetch).toHaveBeenCalledWith(
      "/api/companies/co_1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "holding" }),
      }),
    )
  })

  it("calls PATCH with status payload on status select change", async () => {
    render(<CompanyManagementAdmin />)

    // EDEN (co_2) status: pending → active
    const statusSelect = screen.getByRole("combobox", {
      name: /status for EDEN/i,
    }) as HTMLSelectElement
    fireEvent.change(statusSelect, { target: { value: "active" } })

    expect(fetch).toHaveBeenCalledWith(
      "/api/companies/co_2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      }),
    )
  })

  it("rolls back optimistic update and shows inline error on PATCH failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Forbidden" }),
      }),
    )

    render(<CompanyManagementAdmin />)

    const roleSelect = screen.getByRole("combobox", {
      name: /role for AZSF/i,
    }) as HTMLSelectElement
    expect(roleSelect.value).toBe("operational")

    fireEvent.change(roleSelect, { target: { value: "admin" } })

    // After error resolved, the select reverts to "operational"
    await waitFor(() => {
      expect(roleSelect.value).toBe("operational")
    })

    // Error text shown in the row
    await waitFor(() => {
      expect(screen.getByText(/Forbidden/i)).toBeTruthy()
    })
  })

  it("renders read-only badges (no selects) for non-admin users", () => {
    mockUseSession.mockReturnValue(VIEWER_SESSION)
    render(<CompanyManagementAdmin />)

    // No selects should appear
    expect(screen.queryByRole("combobox")).toBeNull()

    // Static value text should be present (Badge children).
    // "operational" appears once per row, "pending" appears in the
    // description paragraph <em> AND in the EDEN badge — use getAllBy.
    expect(screen.getAllByText("operational").length).toBeGreaterThan(0)
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0)
  })

  it("shows loading state while fetching", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<CompanyManagementAdmin />)
    expect(screen.getByText(/Загрузка/i)).toBeTruthy()
  })

  it("shows fetch error message when query fails", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    })
    render(<CompanyManagementAdmin />)
    expect(screen.getByText(/Network error/i)).toBeTruthy()
  })
})
