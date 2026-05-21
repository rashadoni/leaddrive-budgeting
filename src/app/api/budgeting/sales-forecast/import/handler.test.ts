// @vitest-environment node
/**
 * Phase 7.M Tier 7 Phase 6 — handler tests for the DEPRECATED
 * `/api/budgeting/sales-forecast/import` route.
 *
 * Route was rewritten to a static 410 Gone (zero UI callers found in
 * Phase 5 audit). Tests lock the 410 status, deprecation headers, and
 * the JSON body shape pointing to the replacement.
 */

import { describe, it, expect } from "vitest"
import { POST } from "./route"

function makeRequest(): Request {
  return new Request("http://localhost/api/budgeting/sales-forecast/import", {
    method: "POST",
  })
}

describe("POST /api/budgeting/sales-forecast/import — 410 Gone", () => {
  it("returns 410 for any request regardless of auth state", async () => {
    const res = await POST(makeRequest() as never)
    expect(res.status).toBe(410)
  })

  it("response body contains replacement path and UI link", async () => {
    const res = await POST(makeRequest() as never)
    const body = await res.json()
    expect(body.replacement).toBe("/api/import/ai-auto-multi")
    expect(body.ui).toBe("/budgeting/admin/ai-import")
    expect(typeof body.error).toBe("string")
  })

  it("response carries RFC 8594 Sunset + RFC 9745 Deprecation headers", async () => {
    const res = await POST(makeRequest() as never)
    expect(res.headers.get("Deprecation")).toBe("true")
    expect(res.headers.get("Sunset")).toBe("Thu, 21 May 2026 00:00:00 GMT")
    expect(res.headers.get("Link")).toContain("successor-version")
    expect(res.headers.get("X-Replaced-By")).toBe("/api/import/ai-auto-multi")
  })
})
