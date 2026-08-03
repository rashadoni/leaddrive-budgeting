// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("@/lib/db/prisma-admin", () => ({
  prismaAdmin: { $queryRawUnsafe: queryMock },
}))

import { GET } from "./route"

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue([{ ok: 1 }])
  delete process.env.APP_REVISION
})

describe("GET /api/health", () => {
  it("returns 200 only when the database is reachable", async () => {
    process.env.APP_REVISION = "abc123"
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok", service: "budgetpro", revision: "abc123" })
  })

  it("returns 503 without leaking the database error", async () => {
    queryMock.mockRejectedValue(new Error("secret connection detail"))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ status: "error", service: "budgetpro" })
  })
})
