import { describe, it, expect, afterEach } from "vitest"
import { GET } from "./route"
import type { NextRequest } from "next/server"

function mkReq(auth?: string): NextRequest {
  return {
    headers: { get: (k: string) => (k === "authorization" ? (auth ?? null) : null) },
  } as unknown as NextRequest
}

// The auth gate short-circuits BEFORE any external fetch / DB work, so these
// run without hitting the feeds or a database. The happy path (valid secret →
// ingest + recompute) is exercised by the underlying ingest/recompute tests +
// runs only in the deployed cron.
describe("GET /api/cron/refresh-feeds — auth gate", () => {
  const orig = process.env.CRON_SECRET
  afterEach(() => {
    if (orig === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = orig
  })

  it("503 when CRON_SECRET is not configured (refuses to run)", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(mkReq("Bearer anything"))
    expect(res.status).toBe(503)
  })

  it("401 when the bearer token does not match", async () => {
    process.env.CRON_SECRET = "s3cret"
    const res = await GET(mkReq("Bearer wrong"))
    expect(res.status).toBe(401)
  })

  it("401 when there is no authorization header", async () => {
    process.env.CRON_SECRET = "s3cret"
    const res = await GET(mkReq(undefined))
    expect(res.status).toBe(401)
  })
})
