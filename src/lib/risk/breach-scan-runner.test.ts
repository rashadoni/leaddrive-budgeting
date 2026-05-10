// @vitest-environment node
/**
 * Phase 7.G Turn C (Phase 7.E #3 v2 E.2e) — breach-scan-runner tests.
 * Tests stub Prisma → loader returns [] (in-memory fallback path);
 * direct test cases inject prismaMock with findMany returning canned rows.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { runBreachScanForOrg } from "./breach-scan-runner"
import {
  clearBreachMemoryForTests,
  getPredictiveBreaches,
} from "./breach-persist"

const ORG = "org_demo"

const HIGHER_BETTER_THRESHOLDS = {
  green: { op: ">=", value: 80 },
  amber: { op: ">=", value: 60 },
  red: { op: "<", value: 60 },
}

beforeEach(() => {
  clearBreachMemoryForTests()
})

function makePrismaWithIVs(rows: Array<Record<string, unknown>>) {
  // Deliberately omit `predictiveBreach` model so accessing
  // `prisma.predictiveBreach.upsert` throws "Cannot read properties of
  // undefined" — the TypeError pattern `isTableMissingError` already
  // handles → falls to in-memory persist.
  return {
    indicatorValue: {
      findMany: vi.fn(async () => rows),
    },
  } as unknown as typeof import("@/lib/prisma").prisma
}

describe("runBreachScanForOrg — empty / no-op cases", () => {
  it("default fallback (no Prisma model): returns zero counts, no throw", async () => {
    const result = await runBreachScanForOrg(ORG)
    expect(result.ivsLoaded).toBe(0)
    expect(result.ivsScanned).toBe(0)
    expect(result.breachesPersisted).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("zero IVs returned: zero scanned, zero persisted", async () => {
    const result = await runBreachScanForOrg(ORG, { prisma: makePrismaWithIVs([]) })
    expect(result.ivsLoaded).toBe(0)
    expect(result.breachesPersisted).toBe(0)
  })
})

describe("runBreachScanForOrg — happy path (declining trend → breach persisted)", () => {
  it("declining green-trending-amber series → emits + persists 1+ breach", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_aac",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78],
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock })
    expect(result.ivsLoaded).toBe(1)
    expect(result.ivsScanned).toBe(1)
    expect(result.breachesPersisted).toBeGreaterThan(0)
    expect(result.errors).toEqual([])

    // Verify breach is in the read-through store
    const stored = await getPredictiveBreaches(ORG)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored[0].companyId).toBe("co_aac")
    expect(stored[0].indicatorCode).toBe("REV_GROWTH")
    expect(stored[0].currentStatus).toBe("green")
  })

  it("multi-IV scan: aggregates across companies", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78], // declining
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
      {
        companyId: "co_b",
        period: "2026-Q1",
        sparkline: [90, 91, 90, 89, 91, 90, 90], // stable
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
      {
        companyId: "co_c",
        period: "2026-Q1",
        sparkline: [85, 80, 75, 70, 65, 60, 55], // declining toward red
        status: "amber",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock })
    expect(result.ivsLoaded).toBe(3)
    expect(result.ivsScanned).toBe(3)
    expect(result.breachesPersisted).toBeGreaterThan(0)
    const stored = await getPredictiveBreaches(ORG)
    const companyIds = new Set(stored.map((b) => b.companyId))
    expect(companyIds.has("co_a")).toBe(true)
    expect(companyIds.has("co_c")).toBe(true)
    expect(companyIds.has("co_b")).toBe(false) // stable trend, no breach
  })
})

describe("runBreachScanForOrg — bad shapes drop with errors", () => {
  it("malformed sparkline (non-array) drops + errors", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: "not-an-array",
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock })
    expect(result.ivsLoaded).toBe(1)
    expect(result.ivsScanned).toBe(0)
    expect(result.errors[0]).toContain("bad sparkline")
  })

  it("malformed thresholds drops + errors", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78],
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: { invalid: "shape" } },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock })
    expect(result.ivsScanned).toBe(0)
    expect(result.errors[0]).toContain("bad thresholds")
  })

  it("unknown status drops + errors", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78],
        status: "imaginary",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock })
    expect(result.ivsScanned).toBe(0)
    expect(result.errors[0]).toContain('status "imaginary"')
  })

  it("mixed-validity batch: bad rows skipped, good rows scanned", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: "bad",
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
      {
        companyId: "co_b",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78], // valid declining
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock })
    expect(result.ivsLoaded).toBe(2)
    expect(result.ivsScanned).toBe(1) // only co_b
    expect(result.errors[0]).toContain("co_a")
    expect(result.breachesPersisted).toBeGreaterThan(0)
  })
})

describe("runBreachScanForOrg — period filter", () => {
  it("passes period filter through to prisma where", async () => {
    const findManyMock = vi.fn(async (_args?: { where?: Record<string, unknown> }) => [])
    const prismaMock = {
      indicatorValue: { findMany: findManyMock },
    } as unknown as typeof import("@/lib/prisma").prisma
    await runBreachScanForOrg(ORG, { prisma: prismaMock, period: "2026-Q3" })
    expect(findManyMock).toHaveBeenCalledOnce()
    const callArgs = findManyMock.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(callArgs.where.period).toBe("2026-Q3")
    expect(callArgs.where.organizationId).toBe(ORG)
  })

  it("respects custom horizonSteps option", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78],
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    const result = await runBreachScanForOrg(ORG, { prisma: prismaMock, horizonSteps: 1 })
    // horizon=1 caps total breaches per IV at 1
    expect(result.breachesPersisted).toBeLessThanOrEqual(1)
  })
})

describe("runBreachScanForOrg — multi-tenant isolation", () => {
  it("breaches stored under given orgId only", async () => {
    const prismaMock = makePrismaWithIVs([
      {
        companyId: "co_a",
        period: "2026-Q1",
        sparkline: [100, 95, 90, 85, 82, 80, 78],
        status: "green",
        indicator: { code: "REV_GROWTH", thresholds: HIGHER_BETTER_THRESHOLDS },
      },
    ])
    await runBreachScanForOrg("org_a", { prisma: prismaMock })
    expect((await getPredictiveBreaches("org_a")).length).toBeGreaterThan(0)
    expect(await getPredictiveBreaches("org_b")).toEqual([])
  })
})
