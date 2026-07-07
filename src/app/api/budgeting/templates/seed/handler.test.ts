// @vitest-environment node
/**
 * Handler test for `/api/budgeting/templates/seed` (POST).
 *
 * Locks template-pack seeding: dedup against existing rows + org-scope
 * isolation + pack selection (all vs specific).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetDirectionTemplate: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetDirectionTemplate.count.mockReset().mockResolvedValue(0)
  prismaMock.budgetDirectionTemplate.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.budgetDirectionTemplate.create.mockReset().mockResolvedValue({ id: "t1" })
})

describe("POST /api/budgeting/templates/seed", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/templates/seed", {
        method: "POST",
        json: { pack: "all" },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("seeds all packs when {pack: 'all'} (10 + 9 + 7 = 26 templates)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates/seed", {
        method: "POST",
        json: { pack: "all" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(26) // 10 IT/SaaS + 9 Service + 7 Startup
    expect(prismaMock.budgetDirectionTemplate.create).toHaveBeenCalledTimes(26)
  })

  it("seeds only the requested pack ({pack: 'startup'})", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates/seed", {
        method: "POST",
        json: { pack: "startup" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(7)
  })

  it("unknown pack name results in 0 created (no throw)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const res = await POST(
      makeRequest("/api/budgeting/templates/seed", {
        method: "POST",
        json: { pack: "made-up-pack" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(0)
  })

  it("dedup: skips templates that already exist (same name + lineType)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    // Every findFirst returns a row → all templates already exist
    prismaMock.budgetDirectionTemplate.findFirst.mockResolvedValue({ id: "existing" })
    const res = await POST(
      makeRequest("/api/budgeting/templates/seed", {
        method: "POST",
        json: { pack: "startup" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(0)
    expect(prismaMock.budgetDirectionTemplate.create).not.toHaveBeenCalled()
  })

  it("dedup query is org-scoped (won't merge with another org's templates)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    await POST(
      makeRequest("/api/budgeting/templates/seed", {
        method: "POST",
        json: { pack: "startup" },
      }),
    )
    expect(prismaMock.budgetDirectionTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    )
  })

  it("invalid JSON body falls back to {pack: 'all'} silently", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "editor" })
    const req = new Request("http://localhost/api/budgeting/templates/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken json",
    })
    const res = await POST(req as never)
    // Route catches the JSON parse error and uses pack='all' fallback
    expect(res.status).toBe(200)
  })
})
