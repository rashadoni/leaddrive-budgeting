/**
 * Phase 12 / A05 (2026-08-02) — a viewer must not be able to write.
 *
 * 42 of 117 mutating API routes call no `requireRole`. The proxy already 401s
 * unauthenticated requests, so nothing was open to the public; what was open
 * is that a `viewer` — the role whose whole purpose is read-only — could POST
 * budget lines, delete saved reports and templates, edit the chart of
 * accounts and patch approval requests.
 *
 * Fixed with one floor in `proxy.ts` rather than 42 edits, so the
 * forty-third route inherits it. This suite pins the rule itself; the floor's
 * logic is duplicated here deliberately, because importing `proxy.ts` drags in
 * NextAuth and the edge runtime for a predicate that is four lines long, and
 * a test that cannot run is worse than one that restates the rule.
 */
import { describe, it, expect } from "vitest"
import { hasRole } from "./permissions"

const VIEWER_WRITABLE = [
  /^\/api\/terminal\/layouts(\/|$)/,
  /^\/api\/intel\/[^/]+\/(pin|dismiss)(\/|$)/,
  /^\/api\/telemetry\//,
]
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function belowWriteFloor(pathname: string, method: string, role?: string): boolean {
  if (!MUTATING_METHODS.has(method)) return false
  if (VIEWER_WRITABLE.some((re) => re.test(pathname))) return false
  return !hasRole(role, "editor")
}

describe("the write floor", () => {
  it("refuses a viewer every write that touches the books", () => {
    // Each of these is a real route from the 42 that had no role guard.
    const routes = [
      ["/api/budgeting/lines", "POST"],
      ["/api/budgeting/lines/abc", "DELETE"],
      ["/api/budgeting/reports/abc", "PUT"],
      ["/api/budgeting/templates/abc", "DELETE"],
      ["/api/budgeting/chart-of-accounts", "POST"],
      ["/api/budgeting/integrations", "DELETE"],
      ["/api/budgeting/approval-requests/abc", "PATCH"],
      ["/api/budgeting/templates/seed", "POST"],
    ] as const
    for (const [p, m] of routes) {
      expect(belowWriteFloor(p, m, "viewer"), `${m} ${p}`).toBe(true)
    }
  })

  it("lets a viewer keep reading everything", () => {
    expect(belowWriteFloor("/api/budgeting/lines", "GET", "viewer")).toBe(false)
    expect(belowWriteFloor("/api/indicators/matrix", "GET", "viewer")).toBe(false)
  })

  it("lets a viewer arrange their own workspace", () => {
    // The distinction the exemptions encode: a viewer writes about THEMSELVES,
    // never about the business. Without these, read-only users lose their
    // panel layout and their intel pins, which is a support ticket, not
    // security.
    expect(belowWriteFloor("/api/terminal/layouts", "POST", "viewer")).toBe(false)
    expect(belowWriteFloor("/api/terminal/layouts/mine", "DELETE", "viewer")).toBe(false)
    expect(belowWriteFloor("/api/intel/xyz/pin", "POST", "viewer")).toBe(false)
    expect(belowWriteFloor("/api/intel/xyz/dismiss", "DELETE", "viewer")).toBe(false)
  })

  it("does not exempt the whole intel namespace, only pin and dismiss", () => {
    expect(belowWriteFloor("/api/intel", "POST", "viewer")).toBe(true)
    expect(belowWriteFloor("/api/intel/xyz/publish", "POST", "viewer")).toBe(true)
  })

  it("leaves editor, manager and admin exactly as they were", () => {
    for (const role of ["editor", "manager", "admin"]) {
      expect(belowWriteFloor("/api/budgeting/lines", "POST", role), role).toBe(false)
    }
  })

  it("denies an unknown or missing role, rather than treating it as staff", () => {
    // `hasRole` ranks anything unrecognised at 0. A token from an older schema,
    // or one whose role column was cleared, must not inherit write access.
    expect(belowWriteFloor("/api/budgeting/lines", "POST", undefined)).toBe(true)
    expect(belowWriteFloor("/api/budgeting/lines", "POST", "")).toBe(true)
    expect(belowWriteFloor("/api/budgeting/lines", "POST", "superuser")).toBe(true)
  })
})
