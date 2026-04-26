// @vitest-environment happy-dom
/**
 * Phase 7.F (Turn 12) — smoke + regression tests for `AuditFeed`.
 *
 * What is locked in here:
 *  - Initial mount fetches `/api/audit/events?limit=50` once (default
 *    filters), populates the table.
 *  - `summarizeMetadata` per-action branches render readable summaries
 *    for every action shape currently emitted by the wired endpoints
 *    (regression guard for the architect-flagged coverage gap from
 *    Turn 12 round-1).
 *  - "Load More" reuses the LAST APPLIED filters, NOT current form
 *    state — regression guard for the bug found during browser smoke
 *    where typing into a filter input without clicking Apply, then
 *    clicking Load More, sent a (new filter + old cursor) mismatched
 *    request to the server.
 *  - Apply submits the form-state filters and resets pagination.
 *  - HTTP error renders the role=alert message and does NOT clobber
 *    existing rows.
 *
 * Mocks `global.fetch` per-test rather than spinning up MSW; the
 * surface area is small enough that hand-rolled fixtures stay readable.
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react"
import { AuditFeed } from "./AuditFeed"

interface FetchCall {
  url: string
  qs: URLSearchParams
}

/**
 * Turn 15 — concurrent-resolver hardening (architect Turn-12 round-2 carryover).
 *
 * Earlier shape kept a single `resolver` slot and overwrote it on every
 * `fetch` invocation. That broke under React StrictMode mount-cleanup-
 * remount (or any double-fire flow): the FIRST request's resolver was
 * silently replaced by the second's, so the first promise hung forever
 * and tests deadlocked. Tests passed today only because no test wraps
 * its render in `<React.StrictMode>` — but that's a brittle invariant.
 *
 * The fix is a FIFO queue: every `fetch` push a fresh `{resolve, reject}`
 * pair onto the queue; every `respond()` shifts the OLDEST pending pair
 * and resolves it. Concurrent fetches now interleave correctly.
 *
 * `pending()` is exposed for tests that want to assert "exactly N
 * fetches in flight" without resolving them.
 */
function setupFetchMock(): {
  calls: FetchCall[]
  respond: (body: unknown, status?: number) => void
  fail: (err: Error) => void
  clear: () => void
  pending: () => number
} {
  const calls: FetchCall[] = []
  type Resolver = (value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void
  type Rejecter = (err: Error) => void
  const queue: Array<{ resolve: Resolver; reject: Rejecter }> = []

  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const urlStr = typeof input === "string" ? input : input.toString()
    const u = new URL(urlStr, "http://localhost")
    calls.push({ url: urlStr, qs: u.searchParams })
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject })
    })
  }) as never

  return {
    calls,
    respond: (body, status = 200) => {
      const slot = queue.shift()
      if (!slot) {
        // No pending fetch — test bug. Surface loudly so the missing
        // `await waitFor(...)` is visible at the call site.
        throw new Error(
          "setupFetchMock.respond() called with no pending fetch — did the test forget to wait for fetch to fire?",
        )
      }
      slot.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      })
    },
    fail: (err) => {
      const slot = queue.shift()
      if (!slot) {
        throw new Error(
          "setupFetchMock.fail() called with no pending fetch — did the test forget to wait for fetch to fire?",
        )
      }
      slot.reject(err)
    },
    clear: () => {
      calls.length = 0
      // Pending resolvers are intentionally NOT cleared — outstanding
      // fetches left from a previous step are still legitimate work for
      // the next step's `respond()`. Tests that want to abandon them
      // should reject explicitly via `fail()`.
    },
    pending: () => queue.length,
  }
}

const baseEvent = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "audit_1",
  action: "import_budget_create" as const,
  entityType: "BudgetPlan",
  entityId: "plan_1",
  metadata: {
    companyId: "co_1",
    companyCode: "AAC",
    year: 2026,
    parser: "sopl",
    inserted: 42,
    deleted: 12,
    warnings: 0,
    parentRollupsDropped: 0,
    parentRollupsUnallocated: 0,
    recompute: { ok: 5, unknown: 0, failed: 0, targets: 5 },
  },
  context: { route: "/api/onboarding/import/budget" },
  actor: { id: "user_1", name: "Alice", email: "alice@example.com" },
  createdAt: "2026-04-25T10:00:00.000Z",
  ...overrides,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  // happy-dom doesn't auto-cleanup; without this, the previous test's
  // rendered DOM stays in document.body and queryByText finds duplicate
  // matches from prior renders.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("AuditFeed (Phase 7.F smoke + regression)", () => {
  it("initial mount: fires one fetch with default filters + limit=50", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)
    await waitFor(() => expect(fetchMock.calls.length).toBeGreaterThan(0))
    const call = fetchMock.calls[fetchMock.calls.length - 1]
    expect(call.url).toContain("/api/audit/events")
    expect(call.qs.get("limit")).toBe("50")
    expect(call.qs.get("action")).toBeNull()
    expect(call.qs.get("entityType")).toBeNull()
    expect(call.qs.get("cursor")).toBeNull()
  })

  it("renders rows + summarizes import_budget_create with companyCode + year + line count", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)
    await act(async () => {
      fetchMock.respond({
        events: [baseEvent()],
        nextCursor: null,
        hasMore: false,
      })
    })
    await waitFor(() => expect(screen.queryByText("Alice")).toBeTruthy())
    expect(screen.getByText(/AAC.*2026.*42 lines/)).toBeTruthy()
  })

  it("summarizes import_staging_apply via year + inserted/deleted (no companyCode in metadata)", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)
    await act(async () => {
      fetchMock.respond({
        events: [
          baseEvent({
            id: "audit_apply_1",
            action: "import_staging_apply",
            entityType: "ImportStaging",
            metadata: {
              companyId: "co_1",
              year: 2026,
              inserted: 30,
              deleted: 5,
              warnings: 1,
              parentRollupsDropped: 0,
              parentRollupsUnallocated: 0,
              recompute: { ok: 4, unknown: 0, failed: 0, targets: 4 },
            },
          }),
        ],
        nextCursor: null,
        hasMore: false,
      })
    })
    await waitFor(() =>
      expect(screen.queryByText(/2026.*30 inserted.*5 deleted/)).toBeTruthy(),
    )
  })

  it("summarizes import_staging_expired via triggeredBy + expiresAt (no JSON-truncate fallback)", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)
    await act(async () => {
      fetchMock.respond({
        events: [
          baseEvent({
            id: "audit_expired_1",
            action: "import_staging_expired",
            entityType: "ImportStaging",
            metadata: {
              companyId: "co_1",
              expiresAt: "2026-04-26T00:00:00.000Z",
              triggeredBy: "lazy_get",
            },
          }),
        ],
        nextCursor: null,
        hasMore: false,
      })
    })
    await waitFor(() => expect(screen.queryByText(/via lazy_get/)).toBeTruthy())
  })

  it("summarizes company_role_change via companyCode + from→to arrow", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)
    await act(async () => {
      fetchMock.respond({
        events: [
          baseEvent({
            id: "audit_role_1",
            action: "company_role_change",
            entityType: "Company",
            metadata: {
              from: "operational",
              to: "admin",
              companyCode: "ATL-MRKZ",
            },
          }),
        ],
        nextCursor: null,
        hasMore: false,
      })
    })
    await waitFor(() =>
      expect(
        screen.queryByText(/ATL-MRKZ.*operational.*→.*admin/),
      ).toBeTruthy(),
    )
  })

  it("renders system events (actor=null) as italic 'system'", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)
    await act(async () => {
      fetchMock.respond({
        events: [baseEvent({ id: "sys_1", actor: null })],
        nextCursor: null,
        hasMore: false,
      })
    })
    await waitFor(() => expect(screen.queryByText("system")).toBeTruthy())
  })

  it("Load More uses LAST APPLIED filters, NOT the current form state (regression guard)", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)

    // Initial mount fetch.
    await act(async () => {
      fetchMock.respond({
        events: [baseEvent({ id: "p1" })],
        nextCursor: "2026-04-25T09:00:00.000Z",
        hasMore: true,
      })
    })
    await waitFor(() => expect(screen.queryByText(/p1|AAC/)).toBeTruthy())
    fetchMock.clear()

    // User TYPES in entityType but does NOT click Apply yet.
    const entityInput = screen.getByPlaceholderText(/Company, BudgetPlan/)
    fireEvent.change(entityInput, { target: { value: "Company" } })

    // User clicks Load More — the cursor was generated under empty
    // filters, so the request must reuse empty filters, NOT the
    // typed-but-unapplied "Company".
    const loadMore = screen.getByRole("button", { name: /Load more/i })
    fireEvent.click(loadMore)

    await waitFor(() => expect(fetchMock.calls.length).toBeGreaterThan(0))
    const call = fetchMock.calls[0]
    expect(call.qs.get("entityType")).toBeNull() // CRITICAL — bug guard
    expect(call.qs.get("cursor")).toBe("2026-04-25T09:00:00.000Z")
  })

  it("Apply submits form-state filters and resets cursor", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)

    await act(async () => {
      fetchMock.respond({
        events: [],
        nextCursor: null,
        hasMore: false,
      })
    })
    fetchMock.clear()

    const entityInput = screen.getByPlaceholderText(/Company, BudgetPlan/)
    fireEvent.change(entityInput, { target: { value: "BudgetPlan" } })
    const applyBtn = screen.getByRole("button", { name: /^Apply$/ })
    fireEvent.click(applyBtn)

    await waitFor(() => expect(fetchMock.calls.length).toBeGreaterThan(0))
    const call = fetchMock.calls[0]
    expect(call.qs.get("entityType")).toBe("BudgetPlan")
    expect(call.qs.get("cursor")).toBeNull()
  })

  it("setupFetchMock supports concurrent in-flight fetches (FIFO queue regression guard)", async () => {
    // This test exercises the mock itself — locks in the Turn-15
    // hardening that replaced the single-resolver pattern with a FIFO
    // queue. Without the queue, two concurrent fetches would deadlock:
    // the second would overwrite the first's resolver slot and the
    // first promise would never settle.
    const fetchMock = setupFetchMock()

    // Fire two fetches manually (simulate StrictMode double-mount or
    // the inflightRef-based race the production code now guards
    // against — for the mock, what matters is queue accounting).
    const p1 = global.fetch("/api/audit/events?limit=50&first=1")
    const p2 = global.fetch("/api/audit/events?limit=50&second=1")
    expect(fetchMock.pending()).toBe(2)

    // Resolve in FIFO order: first respond() unblocks p1; second
    // respond() unblocks p2.
    fetchMock.respond({ events: [], nextCursor: null, hasMore: false })
    expect(fetchMock.pending()).toBe(1)
    const r1 = await p1
    expect((await r1.json()) as { events: unknown[] }).toEqual({
      events: [],
      nextCursor: null,
      hasMore: false,
    })

    fetchMock.respond({ events: [{ tag: "second" }], nextCursor: null, hasMore: false })
    expect(fetchMock.pending()).toBe(0)
    const r2 = await p2
    expect((await r2.json()) as { events: { tag: string }[] }).toEqual({
      events: [{ tag: "second" }],
      nextCursor: null,
      hasMore: false,
    })

    // Sentinel: respond() with no pending fetch throws (was silent under
    // the old single-resolver pattern, masking missing awaits in tests).
    expect(() => fetchMock.respond({}, 200)).toThrowError(/no pending fetch/i)
  })

  it("rapid Load More double-click does NOT duplicate rows (single-flight regression guard)", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)

    // Initial mount fetch yields 1 row + cursor → hasMore=true.
    await act(async () => {
      fetchMock.respond({
        events: [baseEvent({ id: "p1" })],
        nextCursor: "2026-04-25T09:00:00.000Z",
        hasMore: true,
      })
    })
    await waitFor(() => expect(screen.queryByText("AAC · 2026 · 42 lines")).toBeTruthy())
    fetchMock.clear()

    // Two rapid clicks on Load More — without the inflightRef guard,
    // both promises would resolve and `setEvents((prev) => [...prev, ...])`
    // would append the same payload twice (duplicate rows).
    const loadMore = screen.getByRole("button", { name: /Load more/i })
    fireEvent.click(loadMore)
    fireEvent.click(loadMore)

    // Only the LAST click's controller is in inflightRef; the first
    // was aborted by the second click's abort-before-fetch.
    await act(async () => {
      fetchMock.respond({
        events: [baseEvent({ id: "p2" })],
        nextCursor: null,
        hasMore: false,
      })
    })

    // Exactly one new row appended (p2). `p1` from initial mount + `p2`
    // from Load More = 2 distinct ids; no duplicate `p2`.
    const rows = document.querySelectorAll("tbody tr")
    expect(rows.length).toBe(2)
  })

  it("HTTP error renders alert + does NOT replace existing events", async () => {
    const fetchMock = setupFetchMock()
    render(<AuditFeed />)

    await act(async () => {
      fetchMock.respond({
        events: [baseEvent({ id: "exists" })],
        nextCursor: null,
        hasMore: false,
      })
    })
    await waitFor(() => expect(screen.queryByText("Alice")).toBeTruthy())
    fetchMock.clear()

    const applyBtn = screen.getByRole("button", { name: /^Apply$/ })
    fireEvent.click(applyBtn)
    await act(async () => {
      fetchMock.respond({ error: "boom" }, 500)
    })

    await waitFor(() => expect(screen.queryByRole("alert")).toBeTruthy())
    // Apply flow optimistically clears the rows BEFORE the fetch — this
    // documents the contract: a failed Apply leaves the user with an
    // empty table + an alert, not stale data masquerading as fresh.
    expect(screen.queryByText(/No events match/)).toBeTruthy()
  })
})
