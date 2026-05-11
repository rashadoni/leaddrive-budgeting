import { describe, it, expect, vi, beforeEach } from "vitest"
import { getCompanyScope } from "./company-scope"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"

describe("getCompanyScope — Phase 7.F sub-group RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("admin role returns null (full access) without DB read", async () => {
    const out = await getCompanyScope("org1", "u1", "admin")
    expect(out.ids).toBeNull()
    expect(out.bypassed).toBe(true)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("missing user fails closed (empty set, sees nothing)", async () => {
    ;(prisma.user.findFirst as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(null)
    const out = await getCompanyScope("org1", "deleted", "viewer")
    expect(out.ids).toEqual(new Set())
    expect(out.bypassed).toBe(false)
  })

  it("user with empty allowedSubGroupIds gets full access (legacy default)", async () => {
    ;(prisma.user.findFirst as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      allowedSubGroupIds: [],
    })
    const out = await getCompanyScope("org1", "u1", "viewer")
    expect(out.ids).toBeNull()
    expect(prisma.company.findMany).not.toHaveBeenCalled()
  })

  it("user with allowed sub-groups gets ID set including children", async () => {
    ;(prisma.user.findFirst as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      allowedSubGroupIds: ["atl-id"],
    })
    ;(prisma.company.findMany as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      { id: "atl-id" },
      { id: "atl-mrkz-id" },
      { id: "atl-dbz-id" },
    ])
    const out = await getCompanyScope("org1", "u1", "viewer")
    expect(out.ids).toEqual(new Set(["atl-id", "atl-mrkz-id", "atl-dbz-id"]))
    expect(out.bypassed).toBe(false)
    // Verify the OR query — allowed IDs OR children of those IDs
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org1",
        OR: [
          { id: { in: ["atl-id"] } },
          { parentCompanyId: { in: ["atl-id"] } },
        ],
      },
      select: { id: true },
    })
  })

  it("does NOT include sibling sub-groups (e.g. SPARK when only ATL allowed)", async () => {
    ;(prisma.user.findFirst as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      allowedSubGroupIds: ["atl-id"],
    })
    ;(prisma.company.findMany as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      { id: "atl-id" },
      { id: "atl-mrkz-id" },
    ])
    const out = await getCompanyScope("org1", "u1", "viewer")
    expect(out.ids?.has("spark-id")).toBe(false)
    expect(out.ids?.has("ztp-id")).toBe(false)
  })
})
