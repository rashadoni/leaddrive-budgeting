/**
 * Phase 7.M Tier 5 (2026-05-20) — Tests for production adapter registry.
 *
 * Strategy: mock the underlying parsers + batch functions so we test
 * the WIRING (input → parser → batch fn with tx), not the parsers
 * themselves (those have their own tests).
 *
 * Coverage:
 *  - Registry returns handlers for all expected dataTypes
 *  - PLF handler: parsePlfPlSheet → builds rows + expectedSums →
 *    applyToDb calls runImportBatch with tx
 *  - BS handler: similar wiring through runBalanceSheetBatch
 *  - LAND_REGISTRY handler: writes Company.settings via tx
 *  - DESCRIPTIONS handler: per-entity Company.settings updates
 *  - Context resolution (plan + companies) cached per orchestrator call
 *  - Missing entityCode for tabular handlers → throws
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PrismaClient } from "@prisma/client"

// Mock parsers BEFORE importing the registry under test
vi.mock("../adapters/azseker-plf", () => ({
  parsePlfPlSheet: vi.fn(),
  parsePlfCfSheet: vi.fn(),
}))
vi.mock("../adapters/azseker-workbook-bs", () => ({
  parseWorkbookBsSheet: vi.fn(),
}))
vi.mock("../adapters/azseker-workbook-kpi", () => ({
  parseWorkbookFarmingKpiSheet: vi.fn(),
  parseWorkbookProcessingKpiSheet: vi.fn(),
}))
vi.mock("../adapters/azseker-workbook-sales", () => ({
  parseFarmingSalesSheet: vi.fn(),
  parseProductionSalesSheet: vi.fn(),
  parseProMaltSalesSheet: vi.fn(),
}))
vi.mock("../adapters/azseker-land-registry", () => ({
  parseLandRegistrySheet: vi.fn(),
}))
vi.mock("../adapters/azseker-workbook-capex", () => ({
  parseCapexFarmSheetFromAoa: vi.fn(),
  parseCapexCpcSheetFromAoa: vi.fn(),
}))
vi.mock("../adapters/azseker-workbook-descriptions", () => ({
  parseTesvirSheet: vi.fn(),
}))
vi.mock("../adapters/azseker-farming-strategy", () => ({
  parseIcmalSheet: vi.fn(),
}))
vi.mock("../import-batch", () => ({
  runImportBatch: vi.fn(),
}))
vi.mock("../bs-import-batch", () => ({
  runBalanceSheetBatch: vi.fn(),
}))
vi.mock("../cf-import-batch", () => ({
  runCashFlowBatch: vi.fn(),
}))
vi.mock("../kpi-import-batch", () => ({
  runKpiBatch: vi.fn(),
}))

import { buildProductionAdapterRegistry } from "./production-adapter-registry"
import { parsePlfPlSheet, parsePlfCfSheet } from "../adapters/azseker-plf"
import { parseWorkbookBsSheet } from "../adapters/azseker-workbook-bs"
import { parseLandRegistrySheet } from "../adapters/azseker-land-registry"
import { parseTesvirSheet } from "../adapters/azseker-workbook-descriptions"
import { runImportBatch } from "../import-batch"
import { runBalanceSheetBatch } from "../bs-import-batch"
import { runCashFlowBatch } from "../cf-import-batch"

const fakeXLSX = {
  utils: {
    sheet_to_json: () => [],
  },
}

const fakeWorkbook = {
  Sheets: { S1: { "!ref": "A1:C3" } },
  SheetNames: ["S1"],
}

function buildPrismaStub(overrides: {
  companies?: Array<{ id: string; code: string }>
  plan?: { id: string } | null
} = {}): PrismaClient {
  const fake = {
    company: {
      findMany: vi.fn(async () => overrides.companies ?? []),
      findUnique: vi.fn(async () => ({ settings: {} })),
      update: vi.fn(async () => ({})),
    },
    budgetPlan: {
      findFirst: vi.fn(async () => overrides.plan ?? null),
      create: vi.fn(async () => ({ id: "plan_new" })),
    },
    organization: {
      findUnique: vi.fn(async () => ({ settings: {} })),
      update: vi.fn(async () => ({})),
    },
  } as unknown as PrismaClient
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("buildProductionAdapterRegistry", () => {
  it("returns handlers for all expected dataTypes", () => {
    const prisma = buildPrismaStub()
    const registry = buildProductionAdapterRegistry(prisma)
    expect(registry.get("PLF")).toBeTruthy()
    expect(registry.get("BS")).toBeTruthy()
    expect(registry.get("CF")).toBeTruthy()
    expect(registry.get("KPI_FARMING")).toBeTruthy()
    expect(registry.get("KPI_PROCESSING")).toBeTruthy()
    expect(registry.get("SALES")).toBeTruthy()
    expect(registry.get("LAND_REGISTRY")).toBeTruthy()
    expect(registry.get("CAPEX")).toBeTruthy()
    expect(registry.get("DESCRIPTIONS")).toBeTruthy()
    expect(registry.get("INFO_SUMMARY")).toBeTruthy()
    expect(registry.get("UNKNOWN")).toBeTruthy()
  })

  it("PLF handler parses, builds rows, calls runImportBatch with outer tx", async () => {
    // Stub parser output: one line, one month, amount 100.
    ;(parsePlfPlSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      lines: [
        {
          code: "PLF.01.01.01",
          accountType: "revenue",
          perMonth: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
      warnings: [],
    })
    ;(runImportBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 1 },
      reconciliation: { verdict: "green" },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const handler = registry.get("PLF")!
    const result = await handler({
      workbook: fakeWorkbook,
      sheetName: "PLF CPC",
      entityCode: "AZSEKER-CPC",
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(1)
    // Now invoke applyToDb with a fake tx
    const fakeTx = { _tx: true } as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(1)
    // Verify runImportBatch was called with the tx (not the prisma client)
    expect(runImportBatch).toHaveBeenCalledOnce()
    const [txArg, planArg] = (runImportBatch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, { organizationId: string; rows: unknown[]; planId?: string }]
    expect(txArg).toBe(fakeTx) // OUTER TX, not prisma
    expect(planArg.organizationId).toBe("org_1")
    expect(planArg.rows).toHaveLength(1)
  })

  it("BS handler routes through runBalanceSheetBatch with tx", async () => {
    ;(parseWorkbookBsSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      lines: [
        {
          code: "BS.01.01.01",
          label: "Cash",
          lineType: "asset",
          subType: "current_asset",
          monthlyAmounts: { "2026-01": 100 },
        },
      ],
      warnings: [],
    })
    ;(runBalanceSheetBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 1 },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("BS")!({
      workbook: fakeWorkbook,
      sheetName: "BS CPC",
      entityCode: "AZSEKER-CPC",
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    const fakeTx = { _tx: true } as never
    await result.applyToDb(fakeTx)
    expect(runBalanceSheetBatch).toHaveBeenCalledOnce()
    const [txArg] = (runBalanceSheetBatch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown]
    expect(txArg).toBe(fakeTx)
  })

  it("CF handler routes through runCashFlowBatch with tx", async () => {
    ;(parsePlfCfSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      entries: [
        {
          code: "CF.01.01",
          label: "Revenue",
          activityType: "operating",
          entryType: "inflow",
          perMonth: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
      warnings: [],
    })
    ;(runCashFlowBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 1 },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("CF")!({
      workbook: fakeWorkbook,
      sheetName: "CF CPC",
      entityCode: "AZSEKER-CPC",
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    const fakeTx = { _tx: true } as never
    await result.applyToDb(fakeTx)
    expect(runCashFlowBatch).toHaveBeenCalledOnce()
  })

  it("LAND_REGISTRY handler updates Company.settings via tx", async () => {
    ;(parseLandRegistrySheet as ReturnType<typeof vi.fn>).mockReturnValue({
      parcels: [{ id: "p1", hectares: 100, annualRentAzn: 5000 }],
      totalHectares: 100,
      totalAnnualRentAzn: 5000,
      warnings: [],
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_eden", code: "AZSEKER-EDEN" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("LAND_REGISTRY")!({
      workbook: fakeWorkbook,
      sheetName: "Sheet1",
      entityCode: "AZSEKER-EDEN",
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    const txCompanyUpdate = vi.fn(
      async (args: { data: { settings: Record<string, unknown> } }) => args,
    )
    const txCompanyFind = vi.fn(async () => ({ settings: {} }))
    const fakeTx = {
      company: {
        findUnique: txCompanyFind,
        update: txCompanyUpdate,
      },
    } as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(1)
    expect(txCompanyUpdate).toHaveBeenCalledOnce()
    // settings should include landParcels payload
    const settings = txCompanyUpdate.mock.calls[0][0].data.settings as {
      landParcels: unknown[]
      landTotalHectares: number
    }
    expect(settings.landParcels).toHaveLength(1)
    expect(settings.landTotalHectares).toBe(100)
  })

  it("DESCRIPTIONS handler resolves entityCode per row + updates each Company.settings", async () => {
    ;(parseTesvirSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      descriptions: [
        {
          companyCode: "AZSEKER-CPC",
          description: "CPC narrative",
          competitiveAdvantage: "x",
          fullText: "CPC narrative + x",
        },
        {
          companyCode: "AZSEKER-EDEN",
          description: "EDEN narrative",
          competitiveAdvantage: null,
          fullText: "EDEN narrative",
        },
      ],
      warnings: [],
    })
    const prisma = buildPrismaStub({
      companies: [
        { id: "c_cpc", code: "AZSEKER-CPC" },
        { id: "c_eden", code: "AZSEKER-EDEN" },
      ],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("DESCRIPTIONS")!({
      workbook: fakeWorkbook,
      sheetName: "Təsvir",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    const txCompanyUpdate = vi.fn(async () => ({}))
    const fakeTx = {
      company: {
        findUnique: vi.fn(async () => ({ settings: {} })),
        update: txCompanyUpdate,
      },
    } as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(2) // 2 entity descriptions updated
    expect(txCompanyUpdate).toHaveBeenCalledTimes(2)
  })

  it("PLF handler gracefully skips when entityCode is null", async () => {
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("PLF")!({
      workbook: fakeWorkbook,
      sheetName: "İcmal",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(0)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/no entityCode/i)
    // applyToDb should not throw and should not call any batch fn
    const fakeTx = {} as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(0)
  })

  it("context (companies + plan) is resolved once and cached across handler calls", async () => {
    ;(parsePlfPlSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      lines: [],
      warnings: [],
    })
    ;(parseWorkbookBsSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      lines: [],
      warnings: [],
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    await registry.get("PLF")!({
      workbook: fakeWorkbook,
      sheetName: "PLF CPC",
      entityCode: "AZSEKER-CPC",
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    await registry.get("BS")!({
      workbook: fakeWorkbook,
      sheetName: "BS CPC",
      entityCode: "AZSEKER-CPC",
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    // company.findMany + budgetPlan.findFirst should each fire ONCE
    // (not twice, even though two handlers ran).
    expect(
      (prisma.company.findMany as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1)
    expect(
      (prisma.budgetPlan.findFirst as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1)
  })

  it("UNKNOWN/INFO_SUMMARY noop handlers don't crash on missing entity", async () => {
    const prisma = buildPrismaStub({ plan: { id: "plan_2026" } })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("UNKNOWN")!({
      workbook: fakeWorkbook,
      sheetName: "X",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(0)
    const apply = await result.applyToDb({} as never)
    expect(apply.rowsInserted).toBe(0)
  })
})
