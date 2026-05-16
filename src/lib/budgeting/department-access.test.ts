import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getUserDepartments,
  canAccessDepartment,
  canEditDepartment,
  canApproveDepartment,
  buildDeptFilter,
} from "./department-access"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetDepartmentOwner: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"

type MockFn = { mockResolvedValue: (v: unknown) => void; mockReset: () => void }

beforeEach(() => {
  ;(prisma.budgetDepartmentOwner.findMany as unknown as MockFn).mockReset()
  ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockReset()
})

describe("getUserDepartments", () => {
  it("admin → full access, no DB read", async () => {
    const out = await getUserDepartments("org1", "u1", "admin")
    expect(out).toEqual({ departmentIds: [], isFullAccess: true })
    expect(prisma.budgetDepartmentOwner.findMany).not.toHaveBeenCalled()
  })

  it("manager → full access, no DB read", async () => {
    const out = await getUserDepartments("org1", "u1", "manager")
    expect(out).toEqual({ departmentIds: [], isFullAccess: true })
    expect(prisma.budgetDepartmentOwner.findMany).not.toHaveBeenCalled()
  })

  it("editor → fetches owned departments", async () => {
    ;(prisma.budgetDepartmentOwner.findMany as unknown as MockFn).mockResolvedValue([
      { departmentId: "d1" },
      { departmentId: "d2" },
    ])
    const out = await getUserDepartments("org1", "u1", "editor")
    expect(out).toEqual({
      departmentIds: ["d1", "d2"],
      isFullAccess: false,
    })
  })

  it("editor with no owned departments → empty list (sees nothing)", async () => {
    ;(prisma.budgetDepartmentOwner.findMany as unknown as MockFn).mockResolvedValue([])
    const out = await getUserDepartments("org1", "u1", "viewer")
    expect(out.departmentIds).toEqual([])
    expect(out.isFullAccess).toBe(false)
  })
})

describe("canAccessDepartment", () => {
  it("admin → true without DB read", async () => {
    expect(await canAccessDepartment("org1", "u1", "admin", "d1")).toBe(true)
    expect(prisma.budgetDepartmentOwner.findUnique).not.toHaveBeenCalled()
  })

  it("manager → true without DB read", async () => {
    expect(await canAccessDepartment("org1", "u1", "manager", "d1")).toBe(true)
  })

  it("editor with owner row → true", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue({
      id: "own1",
      canEdit: false,
    })
    expect(await canAccessDepartment("org1", "u1", "editor", "d1")).toBe(true)
  })

  it("editor without owner row → false", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue(null)
    expect(await canAccessDepartment("org1", "u1", "editor", "d1")).toBe(false)
  })
})

describe("canEditDepartment", () => {
  it("admin → true without DB read", async () => {
    expect(await canEditDepartment("org1", "u1", "admin", "d1")).toBe(true)
  })

  it("editor with canEdit=true on owner row → true", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue({
      canEdit: true,
    })
    expect(await canEditDepartment("org1", "u1", "editor", "d1")).toBe(true)
  })

  it("editor with canEdit=false on owner row → false (access yes, edit no)", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue({
      canEdit: false,
    })
    expect(await canEditDepartment("org1", "u1", "editor", "d1")).toBe(false)
  })

  it("editor without owner row → false", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue(null)
    expect(await canEditDepartment("org1", "u1", "editor", "d1")).toBe(false)
  })
})

describe("canApproveDepartment", () => {
  it("admin → true without DB read", async () => {
    expect(await canApproveDepartment("org1", "u1", "admin", "d1")).toBe(true)
  })

  it("editor with null departmentId → false (defensive)", async () => {
    expect(await canApproveDepartment("org1", "u1", "editor", null)).toBe(false)
    expect(prisma.budgetDepartmentOwner.findUnique).not.toHaveBeenCalled()
  })

  it("editor with canApprove=true on owner row → true", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue({
      canApprove: true,
    })
    expect(await canApproveDepartment("org1", "u1", "editor", "d1")).toBe(true)
  })

  it("editor with canApprove=false → false", async () => {
    ;(prisma.budgetDepartmentOwner.findUnique as unknown as MockFn).mockResolvedValue({
      canApprove: false,
    })
    expect(await canApproveDepartment("org1", "u1", "editor", "d1")).toBe(false)
  })
})

describe("buildDeptFilter", () => {
  it("admin → undefined (no filter; full access)", async () => {
    expect(await buildDeptFilter("org1", "u1", "admin")).toBeUndefined()
  })

  it("manager → undefined", async () => {
    expect(await buildDeptFilter("org1", "u1", "manager")).toBeUndefined()
  })

  it("editor with owned departments → Prisma { departmentId: { in: [...] } }", async () => {
    ;(prisma.budgetDepartmentOwner.findMany as unknown as MockFn).mockResolvedValue([
      { departmentId: "d1" },
      { departmentId: "d2" },
    ])
    expect(await buildDeptFilter("org1", "u1", "editor")).toEqual({
      departmentId: { in: ["d1", "d2"] },
    })
  })

  it("editor with no owned departments → { departmentId: { in: [] } } (sees nothing)", async () => {
    ;(prisma.budgetDepartmentOwner.findMany as unknown as MockFn).mockResolvedValue([])
    expect(await buildDeptFilter("org1", "u1", "viewer")).toEqual({
      departmentId: { in: [] },
    })
  })
})
