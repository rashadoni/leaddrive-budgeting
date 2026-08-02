/**
 * Phase 12 / A10 (2026-08-02) — the response headers that were absent.
 *
 * Measured against production the same day (`curl -i http://46.225.60.142/login`):
 * no `X-Frame-Options`, no `X-Content-Type-Options`, no `Referrer-Policy`.
 * nginx set none either — its TLS server block is commented out entirely.
 *
 * The rule pinned here is not just "the header exists" but "it exists on
 * EVERY exit". `proxy.ts` has six returns — public path, static file, 401,
 * login redirect, 403 write floor, 429 rate limit, and the terminal one — and
 * `/login` leaves through the FIRST of them. Wrapping only the last would
 * have left the one page that most needs framing protection without it, and
 * would have looked done.
 *
 * The predicate is restated here rather than imported: pulling in `proxy.ts`
 * drags NextAuth and the edge runtime into a unit test for three constant
 * strings, and a test that cannot run is worse than one that duplicates a
 * list. The companion assertion below — that no bare `NextResponse` return
 * survives in the file — is what actually keeps the two in step.
 */
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

const PROXY = fs.readFileSync(
  path.join(process.cwd(), "src/proxy.ts"),
  "utf8",
)

describe("security response headers", () => {
  it("declares the three headers that were missing in production", () => {
    for (const h of [
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
    ]) {
      expect(PROXY).toContain(h)
    }
    expect(PROXY).toContain('"DENY"')
    expect(PROXY).toContain('"nosniff"')
    expect(PROXY).toContain('"strict-origin-when-cross-origin"')
  })

  it("leaves no exit from the proxy without them", () => {
    // The real assertion. Every `return NextResponse…` must be wrapped; a new
    // early return added later fails here rather than silently shipping one
    // unprotected path. `/login` is served through the first of these.
    const bare = PROXY.split("\n").filter((l) => /^\s*return NextResponse/.test(l))
    expect(bare, `unwrapped returns:\n${bare.join("\n")}`).toEqual([])
    expect(PROXY.match(/withSecurityHeaders\(/g)?.length ?? 0).toBeGreaterThanOrEqual(7)
  })

  it("does NOT set HSTS while production is plain HTTP", () => {
    // Browsers ignore Strict-Transport-Security over HTTP, so setting it now
    // would be decoration that reads as protection in an audit. It belongs in
    // the same change as the certificate.
    //
    // Asserted against the header LIST, not the file: the name appears in the
    // comment explaining this very decision, and a whole-file search would
    // fail on the documentation of its own absence.
    const list = PROXY.match(/const SECURITY_HEADERS[\s\S]*?\n\]/)?.[0] ?? ""
    expect(list, "SECURITY_HEADERS not found").not.toBe("")
    expect(list).not.toContain("Strict-Transport-Security")
    expect(list).toContain("X-Frame-Options")
  })
})
