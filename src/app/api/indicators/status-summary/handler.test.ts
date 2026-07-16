// @vitest-environment node
/**
 * GET /api/indicators/status-summary — handler contract.
 *
 * The summary backs the matrix header, so it must count the same operational
 * leaf surface: auth + period validation, RBAC/default-pending company scope,
 * active non-internal indicators, and pair applicability with explicit
 * CompanyIndicator overrides.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const { getCompanyScopeMock, prismaMock } = vi.hoisted(() => ({
  getCompanyScopeMock: vi.fn(),
  prismaMock: {
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    companyIndicator: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))

import { makeRequest, mockSession } from "@/test/api-harness"
import { GET } from "./route"

const ORG = "org_demo"

const OP_AGRO = {
  id: "co_agro",
  code: "AGRO",
  industry: "agriculture",
  level: 2,
  isActive: true,
  role: "operational",
}

const indicator = (
  id: string,
  industries: string[],
  organizationId: string | null = null,
) => ({
  id,
  code: id,
  organizationId,
  industries,
  isActive: true,
  category: "operational",
  requiredInputs: [],
})

beforeEach(() => {
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null, bypassed: false })
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([])
  prismaMock.companyIndicator.findMany.mockReset().mockResolvedValue([])
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/indicators/status-summary — auth and period", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/indicators/status-summary"))
    expect(res.status).toBe(401)
    expect(getCompanyScopeMock).not.toHaveBeenCalled()
  })

  it("allows an authenticated viewer", async () => {
    await mockSession({ orgId: ORG, userId: "u_viewer", role: "viewer" })
    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026"),
    )
    expect(res.status).toBe(200)
    expect(getCompanyScopeMock).toHaveBeenCalledWith(
      ORG,
      "u_viewer",
      "viewer",
    )
  })

  it.each(["2026", "2026-Q4", "2026-12"])(
    "accepts valid period %s",
    async (period) => {
      await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
      const res = await GET(
        makeRequest(`/api/indicators/status-summary?period=${period}`),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).period).toBe(period)
    },
  )

  it("defaults to the current Baku year", async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
    const res = await GET(makeRequest("/api/indicators/status-summary"))
    expect(res.status).toBe(200)
    expect((await res.json()).period).toMatch(/^\d{4}$/)
  })

  it("returns 400 before scope or DB work for a malformed period", async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026-99"),
    )
    expect(res.status).toBe(400)
    expect(getCompanyScopeMock).not.toHaveBeenCalled()
    expect(prismaMock.company.findMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/indicators/status-summary — operational applicability", () => {
  beforeEach(async () => {
    await mockSession({ orgId: ORG, userId: "u1", role: "manager" })
  })

  it("returns zero counts and skips value reads when no operational leaves exist", async () => {
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: "co_admin",
        code: "HQ",
        industry: "hospitality",
        level: 2,
        isActive: true,
        role: "admin",
      },
    ])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator("ind_hospitality", ["hospitality"]),
    ])

    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026"),
    )
    expect(await res.json()).toEqual({
      period: "2026",
      green: 0,
      amber: 0,
      red: 0,
      unknown: 0,
      total: 0,
    })
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled()
    expect(prismaMock.companyIndicator.findMany).not.toHaveBeenCalled()
  })

  it("counts only applicable operational pairs, honoring enable and disable overrides", async () => {
    const companies = [
      OP_AGRO,
      {
        id: "co_admin",
        code: "HQ",
        industry: "hospitality",
        level: 2,
        isActive: true,
        role: "admin",
      },
      {
        id: "co_unknown_shell",
        code: "UNKNOWN",
        industry: null,
        level: 2,
        isActive: true,
        role: "operational",
      },
    ]
    const definitions = [
      indicator("ind_agro", ["agriculture"]),
      indicator("ind_universal", []),
      indicator("ind_agro_disabled", ["agriculture"]),
      indicator("ind_hospitality", ["hospitality"]),
      indicator("ind_retail_enabled", ["retail"]),
    ]
    const allValues = [
      { companyId: OP_AGRO.id, indicatorId: "ind_agro", status: "green" },
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_universal",
        status: "amber",
      },
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_agro_disabled",
        status: "red",
      },
      // Stale cross-industry cache row: must not self-authorize.
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_hospitality",
        status: "red",
      },
      // Intentional cross-industry assignment: included.
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_retail_enabled",
        status: "green",
      },
      // These entities are absent from the operational company ids passed to
      // the IV query and therefore cannot affect the summary.
      {
        companyId: "co_admin",
        indicatorId: "ind_hospitality",
        status: "red",
      },
      {
        companyId: "co_unknown_shell",
        indicatorId: "ind_hospitality",
        status: "red",
      },
    ]

    prismaMock.company.findMany.mockResolvedValue(companies)
    prismaMock.indicatorDefinition.findMany.mockResolvedValue(definitions)
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_agro_disabled",
        enabled: false,
      },
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_retail_enabled",
        enabled: true,
      },
    ])
    prismaMock.indicatorValue.findMany.mockImplementation(
      async (args: { where?: { companyId?: { in?: string[] } } } = {}) => {
        const ids = new Set(args.where?.companyId?.in ?? [])
        return allValues.filter((value) => ids.has(value.companyId))
      },
    )

    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026"),
    )
    expect(await res.json()).toEqual({
      period: "2026",
      green: 2,
      amber: 1,
      red: 0,
      unknown: 0,
      total: 3,
    })

    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        period: "2026",
        companyId: { in: [OP_AGRO.id] },
        indicatorId: { in: definitions.map((definition) => definition.id) },
      },
      select: { companyId: true, indicatorId: true, status: true },
    })
  })

  it("keeps unknown in the same applicability filter and ignores future statuses", async () => {
    prismaMock.company.findMany.mockResolvedValue([OP_AGRO])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      indicator("ind_agro", ["agriculture"]),
      indicator("ind_other", ["agriculture"]),
    ])
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      { companyId: OP_AGRO.id, indicatorId: "ind_agro", status: "unknown" },
      {
        companyId: OP_AGRO.id,
        indicatorId: "ind_other",
        status: "purple-monkey",
      },
    ])

    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026"),
    )
    expect(await res.json()).toEqual({
      period: "2026",
      green: 0,
      amber: 0,
      red: 0,
      unknown: 1,
      total: 1,
    })
  })

  it("applies RBAC and the same default pending exclusion as the matrix", async () => {
    getCompanyScopeMock.mockResolvedValue({
      ids: new Set(["sg_allowed", OP_AGRO.id]),
      bypassed: false,
    })

    await GET(makeRequest("/api/indicators/status-summary?period=2026-Q1"))

    expect(prismaMock.company.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        isActive: true,
        status: { not: "pending" },
        id: { in: ["sg_allowed", OP_AGRO.id] },
      },
      select: {
        id: true,
        code: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
      },
    })
    expect(prismaMock.indicatorDefinition.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId: ORG }],
      },
      select: {
        id: true,
        code: true,
        organizationId: true,
        industries: true,
        isActive: true,
        category: true,
        requiredInputs: true,
      },
    })
  })

  it("prefers a tenant definition over the global duplicate code without double-counting", async () => {
    const globalDefinition = {
      ...indicator("ind_global", ["agriculture"]),
      code: "DUPLICATE_KPI",
    }
    const tenantDefinition = {
      ...indicator("ind_tenant", ["agriculture"], ORG),
      code: "DUPLICATE_KPI",
    }
    prismaMock.company.findMany.mockResolvedValue([OP_AGRO])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      globalDefinition,
      tenantDefinition,
    ])
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      {
        companyId: OP_AGRO.id,
        indicatorId: globalDefinition.id,
        status: "red",
      },
      {
        companyId: OP_AGRO.id,
        indicatorId: tenantDefinition.id,
        status: "green",
      },
    ])

    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026"),
    )
    expect(await res.json()).toEqual({
      period: "2026",
      green: 1,
      amber: 0,
      red: 0,
      unknown: 0,
      total: 1,
    })
    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          indicatorId: { in: [tenantDefinition.id] },
        }),
      }),
    )
  })

  it("applies tenant precedence before visibility when duplicate categories disagree", async () => {
    const globalDefinition = {
      ...indicator("ind_global_visible", ["agriculture"]),
      code: "TENANT_HIDDEN_KPI",
      category: "operational",
    }
    const tenantDefinition = {
      ...indicator("ind_tenant_internal", ["agriculture"], ORG),
      code: "TENANT_HIDDEN_KPI",
      category: "internal",
      requiredInputs: ["budgetLine"],
    }
    prismaMock.company.findMany.mockResolvedValue([OP_AGRO])
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      globalDefinition,
      tenantDefinition,
    ])
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      {
        companyId: OP_AGRO.id,
        indicatorId: globalDefinition.id,
        status: "red",
      },
    ])

    const res = await GET(
      makeRequest("/api/indicators/status-summary?period=2026"),
    )
    expect(await res.json()).toEqual({
      period: "2026",
      green: 0,
      amber: 0,
      red: 0,
      unknown: 0,
      total: 0,
    })
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled()
    expect(prismaMock.companyIndicator.findMany).not.toHaveBeenCalled()
  })
})
