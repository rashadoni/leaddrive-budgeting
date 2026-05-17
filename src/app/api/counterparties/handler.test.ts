// @vitest-environment node
/**
 * Handler test for GET /api/counterparties.
 *
 * Locks:
 *  - Auth gate (401 when session missing)
 *  - companyId / role / period query plumbing
 *  - HHI math = Σ(sharePct/100)²
 *  - singleSourceSuppliers count
 *  - orderBy [{role}, {sharePct desc}]
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    counterparty: { findMany: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.counterparty.findMany.mockReset().mockResolvedValue([])
})

function mkCp(role: "customer" | "supplier", name: string, sharePct: number, singleSource = false) {
  return {
    id: `cp_${name}`,
    companyId: "co_a",
    role,
    name,
    sharePct,
    annualAmount: null,
    contractExpiry: null,
    paymentTermsDays: 30,
    singleSource,
    notes: null,
    period: "2026",
  }
}

describe("GET /api/counterparties — handler", () => {
  it("returns counterparties + summary with HHI per role", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.counterparty.findMany.mockResolvedValue([
      mkCp("customer", "A", 40),
      mkCp("customer", "B", 30),
      mkCp("customer", "C", 30),
      mkCp("supplier", "S1", 60, true),
      mkCp("supplier", "S2", 40, false),
    ])
    const res = await GET(makeRequest("/api/counterparties"))
    const body = await res.json()
    expect(body.counterparties.length).toBe(5)
    expect(body.summary.customerCount).toBe(3)
    expect(body.summary.supplierCount).toBe(2)
    // HHI customer = (0.4² + 0.3² + 0.3²) = 0.16+0.09+0.09 = 0.34
    expect(body.summary.customerHhi).toBeCloseTo(0.34, 2)
    // HHI supplier = (0.6² + 0.4²) = 0.52
    expect(body.summary.supplierHhi).toBeCloseTo(0.52, 2)
    expect(body.summary.singleSourceSuppliers).toBe(1)
  })

  it("passes companyId + role filter into prisma where clause", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/counterparties?companyId=co_a&role=supplier&period=2026"))
    const arg = prismaMock.counterparty.findMany.mock.calls[0]?.[0]
    expect(arg.where).toMatchObject({
      organizationId: ORG_ID,
      period: "2026",
      companyId: "co_a",
      role: "supplier",
    })
  })

  it("orderBy is [{role: 'asc'}, {sharePct: 'desc'}]", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/counterparties"))
    const arg = prismaMock.counterparty.findMany.mock.calls[0]?.[0]
    expect(arg.orderBy).toEqual([{ role: "asc" }, { sharePct: "desc" }])
  })
})
