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
  parsePlfEbitdaSubtotal: vi.fn(() => []),
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
  parseSalesPlanSheet: vi.fn(),
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
vi.mock("../operational-facts-import", () => ({
  parseOperationalFactsWorkbook: vi.fn(),
}))
vi.mock("../budget-actuals-import", () => ({
  parseBudgetActualsWorkbook: vi.fn(),
}))
vi.mock("../actuals-import-batch", () => ({
  runActualsBatch: vi.fn(),
}))
vi.mock("../sales-forecast-import", () => ({
  parseSalesForecastWorkbook: vi.fn(),
}))
vi.mock("../sales-forecast-batch", () => ({
  runSalesForecastBatch: vi.fn(),
}))

import { buildProductionAdapterRegistry } from "./production-adapter-registry"
import { parsePlfPlSheet, parsePlfCfSheet, parsePlfEbitdaSubtotal } from "../adapters/azseker-plf"
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
  departments?: Array<{ id: string; label: string }>
  coa?: Array<{ id: string; code: string }>
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
    // Phase 7.M Tier 7 (Phase 4) — SALES_FORECAST handler reads
    // revenue-generating BudgetDepartments to build label → id map.
    budgetDepartment: {
      findMany: vi.fn(async () => overrides.departments ?? []),
    },
    chartOfAccount: {
      findMany: vi.fn(async () => overrides.coa ?? []),
      // Phase 2.1 session 1 (2026-05-26) — adapters now call upsert
      // via resolveOrCreateAccountId during applyToDb. Return a
      // deterministic synthetic id so tests can assert downstream
      // payload shape without spinning up real Postgres.
      upsert: vi.fn(
        async (args: {
          where: { organizationId_code: { code: string } }
          create: { code: string }
        }) => ({
          id: `coa_${args.where.organizationId_code.code}`,
        }),
      ),
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
    expect(registry.get("COMPANIES")).toBeTruthy()
    // Phase 7.M Tier 7 — OPS_FACTS handler registered.
    expect(registry.get("OPS_FACTS")).toBeTruthy()
    // Phase 7.M Tier 7 Phase 3 — BUDGET_ACTUALS handler registered.
    expect(registry.get("BUDGET_ACTUALS")).toBeTruthy()
    // Phase 7.M Tier 7 Phase 4 — SALES_FORECAST handler registered.
    expect(registry.get("SALES_FORECAST")).toBeTruthy()
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
    // Phase 2.1 session 1: applyToDb now calls tx.chartOfAccount.upsert
    // via resolveOrCreateAccountId before runImportBatch. Test tx must
    // include the upsert stub returning a synthetic CoA id.
    const fakeTx = {
      _tx: true,
      chartOfAccount: {
        upsert: vi.fn(async (args: {
          where: { organizationId_code: { code: string } }
        }) => ({ id: `coa_${args.where.organizationId_code.code}` })),
      },
      // 2026-05-31: PLF handler also captures the EBITDA subtotal into
      // pl_ebitda operational_facts (parsePlfEbitdaSubtotal mocked → []).
      operationalFact: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
    } as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(1)
    // Verify runImportBatch was called with the tx (not the prisma client)
    expect(runImportBatch).toHaveBeenCalledOnce()
    const [txArg, planArg] = (runImportBatch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, { organizationId: string; rows: unknown[]; planId?: string }]
    expect(txArg).toBe(fakeTx) // OUTER TX, not prisma
    expect(planArg.organizationId).toBe("org_1")
    expect(planArg.rows).toHaveLength(1)
    // EBITDA subtotal capture is wired into the PLF handler (2026-05-31) — it
    // reads the source EBITDA row for the imported sheet+year into pl_ebitda
    // so the recompute reports true EBITDA (not net).
    expect(parsePlfEbitdaSubtotal).toHaveBeenCalledWith(
      expect.anything(),
      "PLF CPC",
      expect.anything(),
      { preferYear: 2026 },
    )
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
    // Phase 2.1 session 1 — BS applyToDb now resolves CoA FK before
    // runBalanceSheetBatch via tx.chartOfAccount.upsert.
    const fakeTx = {
      _tx: true,
      chartOfAccount: {
        upsert: vi.fn(async (args: {
          where: { organizationId_code: { code: string } }
        }) => ({ id: `coa_${args.where.organizationId_code.code}` })),
      },
    } as never
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
    // Phase 2.1 session 1 — CF applyToDb upserts CoA before runCashFlowBatch.
    const fakeTx = {
      _tx: true,
      chartOfAccount: {
        upsert: vi.fn(async (args: {
          where: { organizationId_code: { code: string } }
        }) => ({ id: `coa_${args.where.organizationId_code.code}` })),
      },
    } as never
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

  it("COMPANIES handler parses xlsx rows and upserts into Company table via tx (Phase 7.M Tier 6)", async () => {
    const prisma = buildPrismaStub()
    const registry = buildProductionAdapterRegistry(prisma)
    const handler = registry.get("COMPANIES")!
    // Simulate XLSX.sheet_to_json producing 2 rows: 1 parent + 1 child.
    const xlsxStub = {
      utils: {
        sheet_to_json: () => [
          {
            code: "ROOT",
            name: "Root Holding",
            industry: "agriculture_grains",
            level: "1",
            parentCompanyCode: "",
          },
          {
            code: "SUB1",
            name: "Sub Co 1",
            industry: "agriculture_grains",
            level: "2",
            parentCompanyCode: "ROOT",
          },
        ],
      },
    }
    const result = await handler({
      workbook: { Sheets: { Companies: {} }, SheetNames: ["Companies"] },
      sheetName: "Companies",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: xlsxStub,
    })
    expect(result.itemCount).toBe(2)
    expect(result.warnings).toEqual([])

    const upsertCalls: Array<{ where: unknown; create: unknown; update: unknown }> = []
    const fakeTx = {
      company: {
        upsert: vi.fn(
          async (args: { where: unknown; create: unknown; update: unknown }) => {
            upsertCalls.push(args)
            return { id: "c_" + upsertCalls.length, code: "x" }
          },
        ),
        findMany: vi.fn(async () => [{ id: "c_1", code: "ROOT" }]),
      },
    } as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(2)
    expect(upsertCalls).toHaveLength(2) // 1 level=1 + 1 level=2
    // Level 1 upserted first
    expect((upsertCalls[0].create as { level: number }).level).toBe(1)
    expect((upsertCalls[1].create as { level: number; parentCompanyId: string }).level).toBe(2)
    expect((upsertCalls[1].create as { parentCompanyId: string }).parentCompanyId).toBe("c_1")
  })

  it("COMPANIES handler emits warning when parent code is missing from DB or batch", async () => {
    const prisma = buildPrismaStub()
    const registry = buildProductionAdapterRegistry(prisma)
    const handler = registry.get("COMPANIES")!
    const xlsxStub = {
      utils: {
        sheet_to_json: () => [
          {
            code: "ORPHAN",
            name: "Orphan",
            industry: "services",
            level: "2",
            parentCompanyCode: "MISSING_PARENT",
          },
        ],
      },
    }
    const result = await handler({
      workbook: { Sheets: { Companies: {} }, SheetNames: ["Companies"] },
      sheetName: "Companies",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: xlsxStub,
    })
    const fakeTx = {
      company: {
        upsert: vi.fn(async () => ({ id: "c_x", code: "x" })),
        findMany: vi.fn(async () => []), // parent not in DB
      },
    } as never
    const apply = await result.applyToDb(fakeTx)
    expect(apply.rowsInserted).toBe(0)
    expect(result.warnings.some((w) => w.includes("MISSING_PARENT"))).toBe(true)
  })

  it("SALES handler routes 'Sales plan' sheet to per-product forward-volume parser (Phase 7.M Tier 6)", async () => {
    const { parseSalesPlanSheet } = await import(
      "../adapters/azseker-farming-strategy"
    )
    ;(parseSalesPlanSheet as ReturnType<typeof vi.fn>).mockReturnValue({
      facts: [
        {
          year: 2027,
          productLabel: "Glucose Pack",
          productSlug: "glucose_pack",
          group: "Qlukoza",
          location: "Azerbaijan",
          volumeTons: 3500,
        },
        {
          year: 2028,
          productLabel: "Glucose Pack",
          productSlug: "glucose_pack",
          group: "Qlukoza",
          location: "Export",
          volumeTons: 1000,
        },
      ],
      warnings: [],
      rowsExamined: 2,
    })
    const { runKpiBatch } = await import("../kpi-import-batch")
    ;(runKpiBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 2 },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("SALES")!({
      workbook: fakeWorkbook,
      sheetName: "Sales plan",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(2)
    const fakeTx = { _tx: true } as never
    await result.applyToDb(fakeTx)
    expect(runKpiBatch).toHaveBeenCalledOnce()
    const [txArg, payload] = (runKpiBatch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [unknown, { rows: Array<{ companyId: string; metric: string; date: string; value: number }> }]
    expect(txArg).toBe(fakeTx)
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows[0]).toMatchObject({
      companyId: "c_cpc",
      metric: "sales_volume_glucose_pack_azerbaijan",
      date: "2027-12-31",
      value: 3500,
    })
    expect(payload.rows[1]).toMatchObject({
      metric: "sales_volume_glucose_pack_export",
      date: "2028-12-31",
      value: 1000,
    })
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

  // ────────────────────────────────────────────────────────────────────
  // Phase 7.M Tier 7 — OPS_FACTS handler (generic flat ops-facts sheet)
  // ────────────────────────────────────────────────────────────────────

  it("OPS_FACTS handler parses sheet, resolves companyCode via ctx, calls runKpiBatch with outer tx", async () => {
    const { parseOperationalFactsWorkbook } = await import(
      "../operational-facts-import"
    )
    ;(parseOperationalFactsWorkbook as ReturnType<typeof vi.fn>).mockReturnValue({
      rows: [
        {
          rowNumber: 2,
          companyCode: "AZSEKER-CPC",
          metric: "broiler_weight_avg_kg",
          date: "2026-03-15",
          value: 2.45,
          unit: "kg",
          sourceNote: null,
        },
        {
          rowNumber: 3,
          companyCode: "AZSEKER-EDEN",
          metric: "yield_per_hectare",
          date: "2026-06-01",
          value: 4.2,
          unit: "t/ha",
          sourceNote: null,
        },
      ],
      errors: [],
      warnings: [],
    })
    const { runKpiBatch } = await import("../kpi-import-batch")
    ;(runKpiBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 2 },
    })
    const prisma = buildPrismaStub({
      companies: [
        { id: "c_cpc", code: "AZSEKER-CPC" },
        { id: "c_eden", code: "AZSEKER-EDEN" },
      ],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("OPS_FACTS")!({
      workbook: { Sheets: { OpsFacts: {} }, SheetNames: ["OpsFacts"] },
      sheetName: "OpsFacts",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(2)
    expect(result.warnings).toEqual([])

    const fakeTx = { _tx: true } as never
    await result.applyToDb(fakeTx)
    expect(runKpiBatch).toHaveBeenCalledOnce()
    const [txArg, payload] = (runKpiBatch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [
      unknown,
      {
        rows: Array<{
          companyId: string
          metric: string
          date: string
          value: number
          source: string
        }>
        companyIds: ReadonlyArray<string>
        dateScope: ReadonlyArray<string>
      },
    ]
    expect(txArg).toBe(fakeTx)
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows[0]).toMatchObject({
      companyId: "c_cpc",
      metric: "broiler_weight_avg_kg",
      date: "2026-03-15",
      value: 2.45,
      source: "ai_import_ops_facts",
    })
    expect(payload.rows[1]).toMatchObject({
      companyId: "c_eden",
      metric: "yield_per_hectare",
      value: 4.2,
    })
    expect(payload.dateScope).toEqual(["2026"])
    expect(payload.companyIds).toEqual(
      expect.arrayContaining(["c_cpc", "c_eden"]),
    )
  })

  it("OPS_FACTS handler warns when companyCode is not in org, skips year-mismatch rows", async () => {
    const { parseOperationalFactsWorkbook } = await import(
      "../operational-facts-import"
    )
    ;(parseOperationalFactsWorkbook as ReturnType<typeof vi.fn>).mockReturnValue({
      rows: [
        {
          rowNumber: 2,
          companyCode: "AZSEKER-CPC",
          metric: "broiler_weight_avg_kg",
          date: "2026-03-15",
          value: 2.45,
          unit: "kg",
          sourceNote: null,
        },
        {
          rowNumber: 3,
          companyCode: "AZSEKER-UNKNOWN",
          metric: "broiler_weight_avg_kg",
          date: "2026-04-15",
          value: 2.5,
          unit: "kg",
          sourceNote: null,
        },
        {
          rowNumber: 4,
          companyCode: "AZSEKER-CPC",
          metric: "broiler_weight_avg_kg",
          date: "2025-12-15",
          value: 2.4,
          unit: "kg",
          sourceNote: null,
        },
      ],
      errors: [{ rowNumber: 5, reason: "bad unit" }],
      warnings: [{ rowNumber: 6, message: "value high" }],
    })
    const { runKpiBatch } = await import("../kpi-import-batch")
    ;(runKpiBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 1 },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("OPS_FACTS")!({
      workbook: { Sheets: { OpsFacts: {} }, SheetNames: ["OpsFacts"] },
      sheetName: "OpsFacts",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(1) // only c_cpc 2026-03-15 row
    // 4 warnings: 1 hard error from parser, 1 soft warning from parser,
    // 1 unknown company, 1 year-out-of-scope
    expect(result.warnings).toHaveLength(4)
    expect(result.warnings.some((w) => w.includes("AZSEKER-UNKNOWN"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("outside year 2026"))).toBe(
      true,
    )
    expect(result.warnings.some((w) => w.includes("bad unit"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("value high"))).toBe(true)
  })

  it("OPS_FACTS handler returns warning when sheet missing from workbook", async () => {
    const prisma = buildPrismaStub({ plan: { id: "plan_2026" } })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("OPS_FACTS")!({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "MissingSheet",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(0)
    expect(result.warnings).toEqual([`Sheet "MissingSheet" not found`])
    const apply = await result.applyToDb({} as never)
    expect(apply.rowsInserted).toBe(0)
  })

  // ────────────────────────────────────────────────────────────────────
  // Phase 7.M Tier 7 (Phase 3) — BUDGET_ACTUALS handler
  // ────────────────────────────────────────────────────────────────────

  it("BUDGET_ACTUALS handler parses sheet, resolves planId via ctx, calls runActualsBatch with outer tx", async () => {
    const { parseBudgetActualsWorkbook } = await import(
      "../budget-actuals-import"
    )
    ;(parseBudgetActualsWorkbook as ReturnType<typeof vi.fn>).mockReturnValue({
      rows: [
        {
          rowNumber: 2,
          category: "Office Rent",
          amount: 5000,
          date: "2026-03-15",
          monthIndex: 2,
          department: "Admin",
          description: "March rent",
          lineType: "expense",
          companyCode: null,
        },
        {
          rowNumber: 3,
          category: "Sales Revenue",
          amount: 12000,
          date: "2026-03-20",
          monthIndex: 2,
          department: "Sales",
          description: "Q1 revenue",
          lineType: "revenue",
          companyCode: "AZSEKER-CPC",
        },
      ],
      errors: [],
      warnings: [],
    })
    const { runActualsBatch } = await import("../actuals-import-batch")
    ;(runActualsBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 2 },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("BUDGET_ACTUALS")!({
      workbook: { Sheets: { Actuals: {} }, SheetNames: ["Actuals"] },
      sheetName: "Actuals",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(2)
    expect(result.warnings).toEqual([])

    const fakeTx = { _tx: true } as never
    await result.applyToDb(fakeTx)
    expect(runActualsBatch).toHaveBeenCalledOnce()
    const [txArg, payload] = (runActualsBatch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [
      unknown,
      {
        planId: string
        rows: Array<{
          category: string
          amount: number
          date: string
          monthIndex: number
          lineType: string
          companyId: string | null
        }>
        dateScope: ReadonlyArray<string>
      },
    ]
    expect(txArg).toBe(fakeTx)
    expect(payload.planId).toBe("plan_2026")
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows[0]).toMatchObject({
      category: "Office Rent",
      amount: 5000,
      date: "2026-03-15",
      monthIndex: 2,
      department: "Admin",
      lineType: "expense",
      companyId: null,
    })
    expect(payload.rows[1]).toMatchObject({
      category: "Sales Revenue",
      lineType: "revenue",
      companyId: "c_cpc",
    })
    expect(payload.dateScope).toEqual(["2026"])
  })

  it("BUDGET_ACTUALS handler warns on year-out-of-scope + unknown companyCode (keeps row, companyId null)", async () => {
    const { parseBudgetActualsWorkbook } = await import(
      "../budget-actuals-import"
    )
    ;(parseBudgetActualsWorkbook as ReturnType<typeof vi.fn>).mockReturnValue({
      rows: [
        {
          rowNumber: 2,
          category: "Cat1",
          amount: 100,
          date: "2026-01-15",
          monthIndex: 0,
          department: null,
          description: null,
          lineType: "expense",
          companyCode: "AZSEKER-MISSING",
        },
        {
          rowNumber: 3,
          category: "Cat2",
          amount: 200,
          date: "2025-12-31",
          monthIndex: 11,
          department: null,
          description: null,
          lineType: "expense",
          companyCode: null,
        },
      ],
      errors: [{ rowNumber: 4, reason: "bad date" }],
      warnings: [{ rowNumber: 5, message: "description truncated" }],
    })
    const { runActualsBatch } = await import("../actuals-import-batch")
    ;(runActualsBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsInserted: 1 },
    })
    const prisma = buildPrismaStub({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
      plan: { id: "plan_2026" },
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("BUDGET_ACTUALS")!({
      workbook: { Sheets: { Actuals: {} }, SheetNames: ["Actuals"] },
      sheetName: "Actuals",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    // 1 row kept (Cat1 in-year, unknown company → companyId null),
    // 1 row dropped (Cat2 wrong year)
    expect(result.itemCount).toBe(1)
    // 4 warnings: 1 parser error + 1 parser warning + 1 unknown-company +
    // 1 year-out-of-scope
    expect(result.warnings).toHaveLength(4)
    expect(result.warnings.some((w) => w.includes("AZSEKER-MISSING"))).toBe(
      true,
    )
    expect(result.warnings.some((w) => w.includes("outside year 2026"))).toBe(
      true,
    )
  })

  it("BUDGET_ACTUALS handler returns warning when sheet missing from workbook", async () => {
    const prisma = buildPrismaStub({ plan: { id: "plan_2026" } })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("BUDGET_ACTUALS")!({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "MissingSheet",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(0)
    expect(result.warnings).toEqual([`Sheet "MissingSheet" not found`])
    const apply = await result.applyToDb({} as never)
    expect(apply.rowsInserted).toBe(0)
  })

  // ────────────────────────────────────────────────────────────────────
  // Phase 7.M Tier 7 (Phase 4) — SALES_FORECAST handler
  // ────────────────────────────────────────────────────────────────────

  it("SALES_FORECAST handler resolves dept labels via ctx, calls runSalesForecastBatch with outer tx", async () => {
    const { parseSalesForecastWorkbook } = await import(
      "../sales-forecast-import"
    )
    ;(parseSalesForecastWorkbook as ReturnType<typeof vi.fn>).mockReturnValue({
      entries: [
        { rowNumber: 2, departmentLabel: "sales", month: 1, amount: 1000 },
        { rowNumber: 2, departmentLabel: "sales", month: 2, amount: 1100 },
        { rowNumber: 3, departmentLabel: "marketing", month: 1, amount: 500 },
      ],
      errors: [],
      warnings: [],
    })
    const { runSalesForecastBatch } = await import("../sales-forecast-batch")
    ;(runSalesForecastBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsUpserted: 3 },
    })
    const prisma = buildPrismaStub({
      plan: { id: "plan_2026" },
      departments: [
        { id: "d_sales", label: "Sales" },
        { id: "d_mk", label: "Marketing" },
      ],
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("SALES_FORECAST")!({
      workbook: { Sheets: { Forecast: {} }, SheetNames: ["Forecast"] },
      sheetName: "Forecast",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(3)
    expect(result.warnings).toEqual([])

    const fakeTx = { _tx: true } as never
    await result.applyToDb(fakeTx)
    expect(runSalesForecastBatch).toHaveBeenCalledOnce()
    const [txArg, payload] = (runSalesForecastBatch as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [
      unknown,
      {
        year: number
        organizationId: string
        rows: Array<{ departmentId: string; month: number; amount: number }>
      },
    ]
    expect(txArg).toBe(fakeTx)
    expect(payload.year).toBe(2026)
    expect(payload.organizationId).toBe("org_1")
    expect(payload.rows).toHaveLength(3)
    expect(payload.rows[0]).toMatchObject({
      departmentId: "d_sales",
      month: 1,
      amount: 1000,
    })
    expect(payload.rows[2]).toMatchObject({
      departmentId: "d_mk",
      month: 1,
      amount: 500,
    })
  })

  it("SALES_FORECAST handler warns once per unknown dept label, skips its rows", async () => {
    const { parseSalesForecastWorkbook } = await import(
      "../sales-forecast-import"
    )
    ;(parseSalesForecastWorkbook as ReturnType<typeof vi.fn>).mockReturnValue({
      entries: [
        { rowNumber: 2, departmentLabel: "sales", month: 1, amount: 1000 },
        { rowNumber: 3, departmentLabel: "unknown-dept", month: 1, amount: 500 },
        { rowNumber: 3, departmentLabel: "unknown-dept", month: 2, amount: 600 },
        { rowNumber: 4, departmentLabel: "another-missing", month: 1, amount: 700 },
      ],
      errors: [],
      warnings: [],
    })
    const { runSalesForecastBatch } = await import("../sales-forecast-batch")
    ;(runSalesForecastBatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      metrics: { rowsUpserted: 1 },
    })
    const prisma = buildPrismaStub({
      plan: { id: "plan_2026" },
      departments: [{ id: "d_sales", label: "Sales" }],
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("SALES_FORECAST")!({
      workbook: { Sheets: { Forecast: {} }, SheetNames: ["Forecast"] },
      sheetName: "Forecast",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    // Only the "sales" row kept
    expect(result.itemCount).toBe(1)
    // 2 unique unknown labels → 2 warnings (deduplicated per label)
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings.some((w) => w.includes("unknown-dept"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("another-missing"))).toBe(
      true,
    )
  })

  it("SALES_FORECAST handler returns warning when sheet missing", async () => {
    const prisma = buildPrismaStub({
      plan: { id: "plan_2026" },
      departments: [],
    })
    const registry = buildProductionAdapterRegistry(prisma)
    const result = await registry.get("SALES_FORECAST")!({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "MissingSheet",
      entityCode: null,
      year: 2026,
      organizationId: "org_1",
      XLSX: fakeXLSX,
    })
    expect(result.itemCount).toBe(0)
    expect(result.warnings).toEqual([`Sheet "MissingSheet" not found`])
  })
})
