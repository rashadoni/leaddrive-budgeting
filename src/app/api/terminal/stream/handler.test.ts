// @vitest-environment node
/**
 * Handler test for `/api/terminal/stream` (GET).
 *
 * Server-Sent Events endpoint for terminal push updates. Locks
 * content-type + cache headers + initial "connected" event payload.
 */

import { describe, it, expect } from "vitest"
import { GET } from "./route"

describe("GET /api/terminal/stream", () => {
  it("returns text/event-stream with no-cache headers", async () => {
    // Mock AbortController so the handler can subscribe
    const controller = new AbortController()
    const req = new Request("http://localhost/api/terminal/stream", {
      signal: controller.signal,
    })
    const res = await GET(req)
    expect(res.headers.get("Content-Type")).toBe("text/event-stream")
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform")
    expect(res.headers.get("Connection")).toBe("keep-alive")
    // Close the stream — abort the request so the handler's interval cleans up
    controller.abort()
  })

  it("first chunk is a 'connected' event with timestamp", async () => {
    const controller = new AbortController()
    const req = new Request("http://localhost/api/terminal/stream", {
      signal: controller.signal,
    })
    const res = await GET(req)
    // Read first chunk
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain("event: connected")
    expect(text).toContain("data:")
    expect(text).toContain("timestamp")
    controller.abort()
    reader.cancel()
  })
})
