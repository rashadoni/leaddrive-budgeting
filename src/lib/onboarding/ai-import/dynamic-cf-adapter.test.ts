/**
 * Unit tests for `runDynamicCfAdapter`.
 * All external dependencies are mocked — no DB, no real LLM calls.
 *
 * Locks in:
 *   - extractMapperInput error → 0 rows, getOrCreateProposal not called
 *   - overallConfidence < 0.5 → 0 rows, low-confidence warning
 *   - Valid proposal, cache miss → rows extracted, runCashFlowBatch called
 *   - Valid proposal, cache hit → warnings include "(cache hit)"
 *   - No "code" column → 0 rows, reason in warnings
 *   - Activity classification: CF.01.* → operating, CF.02.* → investing,
 *     CF.03.* → financing; CF.04–07 bridge rows → preserved
 *   - Entry type: CF.XX.01.* → inflow, CF.XX.02.* → outflow; fallback from sign
 *   - CF amounts stored as Math.abs (direction encoded in entryType)
 *   - Partial month coverage accepted
 *   - no entityCode → 0 rows, no LLM
 *   - LLM throws → 0 rows, warning, applyToDb no-op
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PrismaClient, Prisma } from "@prisma/client"

vi.mock("@/lib/onboarding/ai-mapper/extract", () => ({
  extractMapperInput: vi.fn(),
}))

vi.mock("@/lib/onboarding/ai-mapper/proposal-cache", () => ({
  getOrCreateProposal: vi.fn(),
}))

vi.mock("@/lib/onboarding/cf-import-batch", () => ({
  runCashFlowBatch: vi.fn(),
}))

import { runDynamicCfAdapter } from "./dynamic-cf-adapter"
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { getOrCreateProposal } from "@/lib/onboarding/ai-mapper/proposal-cache"
import { runCashFlowBatch } from "@/lib/onboarding/cf-import-batch"

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function buildProposal(overallConfidence = 0.9, months = MONTH_NAMES) {
  return {
    sourceFile: "test.xlsx",
    sourceSheet: "CF TEST",
    overallConfidence,
    summary: "Cash flow sheet with monthly columns",
    columns: [
      { sourceIndex: 0, role: "code" as const, confidence: 0.95, reasoning: "CF codes" },
      { sourceIndex: 1, role: "label" as const, confidence: 0.95, reasoning: "labels" },
      ...months.map((m, i) => ({
        sourceIndex: i + 2,
        role: `amount:${m}2026` as `amount:${string}`,
        confidence: 0.9,
        reasoning: `month ${m}`,
      })),
    ],
    accountTypeOverrides: [],
    anomalies: [],
  }
}

const SAMPLE_AOA = [
  // header row
  ["Code", "Description", ...MONTH_NAMES.map((m) => `${m} 2026`)],
  // operating inflow
  ["CF.01.01.01", "Revenue received", ...Array(12).fill(0).map((_, i) => i === 0 ? 500000 : 0)],
  // operating outflow (stored as negative in Excel)
  ["CF.01.02.01", "Payments to suppliers", ...Array(12).fill(0).map((_, i) => i === 0 ? -200000 : 0)],
  // investing inflow
  ["CF.02.01.01", "Asset sale proceeds", ...Array(12).fill(0).map((_, i) => i === 1 ? 150000 : 0)],
  // financing outflow
  ["CF.03.02.01", "Loan repayment", ...Array(12).fill(0).map((_, i) => i === 2 ? -80000 : 0)],
  // bridge row — preserved in the same complete batch
  ["CF.04.01.01", "FX change", ...Array(12).fill(5000)],
  // parent row (no 4th segment) → must be skipped
  ["CF.01", "Total operating", ...Array(12).fill(300000)],
]

function makeFakeWorkbook(aoa = SAMPLE_AOA) {
  const sheet: Record<string, unknown> = { "!ref": "A1:N7" }
  aoa.forEach((row, r) => {
    row.forEach((val, c) => {
      const colLetter = String.fromCharCode(65 + c)
      sheet[`${colLetter}${r + 1}`] = { v: val }
    })
  })
  return {
    Sheets: { "CF TEST": sheet },
    SheetNames: ["CF TEST"],
  }
}

function makeFakeXLSX(aoa = SAMPLE_AOA) {
  return {
    utils: {
      sheet_to_json: vi.fn(() => aoa),
    },
  }
}

function makeFakeInput(
  overrides: Partial<Parameters<typeof runDynamicCfAdapter>[0]> = {},
) {
  return {
    workbook: makeFakeWorkbook(),
    sheetName: "CF TEST",
    entityCode: "TEST-ENTITY",
    year: 2026,
    organizationId: "org_test_123",
    XLSX: makeFakeXLSX(),
    ...overrides,
  }
}

const FAKE_PRISMA = {} as PrismaClient
// Phase 2.1 session 1 — applyToDb resolves accountId via
// tx.chartOfAccount.upsert before runCashFlowBatch.
const FAKE_TX = {
  chartOfAccount: {
    upsert: vi.fn(async (args: {
      where: { organizationId_code: { code: string } }
    }) => ({ id: `coa_${args.where.organizationId_code.code}` })),
  },
} as unknown as Prisma.TransactionClient

const MOCK_MAPPER_INPUT = {
  sourceFile: "test.xlsx",
  sourceSheet: "CF TEST",
  columns: [],
  sampleRows: [],
  headerRowIndex: 0,
} as any

function mockBatchOk() {
  vi.mocked(runCashFlowBatch).mockResolvedValue({
    batchId: "c1",
    startedAt: "",
    finishedAt: "",
    durationMs: 10,
    plan: { label: "", sourceDocument: "", sourceTag: "", periodScope: [] },
    metrics: { rowsInserted: 4, resetArchived: 0, resetPurged: 0 },
    reconciliation: { verdict: "green", checks: [] },
  } as any)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runDynamicCfAdapter", () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ── 1. Guard: extractMapperInput error ────────────────────────────────────

  it("extractMapperInput error → 0 rows, getOrCreateProposal not called", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({ error: "Sheet empty" })

    const result = await runDynamicCfAdapter(makeFakeInput(), FAKE_PRISMA)

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.includes("Dynamic CF detection failed"))).toBe(true)
    expect(getOrCreateProposal).not.toHaveBeenCalled()
  })

  // ── 2. Confidence gate ────────────────────────────────────────────────────

  it("overallConfidence < 0.5 → 0 rows, low-confidence warning", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.2),
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "claude-3-5", promptVersion: "v1" },
    })

    const result = await runDynamicCfAdapter(makeFakeInput(), FAKE_PRISMA)

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.toLowerCase().includes("low confidence"))).toBe(true)
    expect(runCashFlowBatch).not.toHaveBeenCalled()
  })

  // ── 3. Happy path: cache miss ─────────────────────────────────────────────

  it("valid proposal (cache miss) → rows extracted, runCashFlowBatch called", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: false,
      usage: { inputTokens: 500, outputTokens: 200, modelName: "claude-3-5", promptVersion: "v1" },
    })
    mockBatchOk()

    const result = await runDynamicCfAdapter(makeFakeInput(), FAKE_PRISMA)

    // 4 movement rows + 12 months of evidenced CF.04 bridge values.
    expect(result.itemCount).toBe(16)
    expect(result.warnings.some((w) => w.includes("Dynamic detection used"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("cache miss"))).toBe(true)

    await result.applyToDb(FAKE_TX)
    expect(runCashFlowBatch).toHaveBeenCalledOnce()

    const callTx = vi.mocked(runCashFlowBatch).mock.calls[0][0]
    expect(callTx).toBe(FAKE_TX)
    const plan = vi.mocked(runCashFlowBatch).mock.calls[0][1]
    expect(plan.organizationId).toBe("org_test_123")
    expect(plan.sourceTag).toBe("dynamic-cf")
  })

  // ── 4. Cache hit path ─────────────────────────────────────────────────────

  it("cache hit → warnings include '(cache hit)'", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.95),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const result = await runDynamicCfAdapter(makeFakeInput(), FAKE_PRISMA)
    expect(result.warnings.some((w) => w.includes("cache hit"))).toBe(true)
  })

  // ── 5. Missing "code" column falls back to semantic CoA review ───────────

  it("proposal with no code column and unknown label → 0 rows + CoA review", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: {
        ...buildProposal(0.9),
        columns: [
          { sourceIndex: 1, role: "label" as const, confidence: 0.9, reasoning: "" },
          { sourceIndex: 2, role: "amount:Jan2026" as `amount:${string}`, confidence: 0.9, reasoning: "" },
        ],
      },
      cacheHit: false,
      usage: { inputTokens: 50, outputTokens: 20, modelName: "m", promptVersion: "v" },
    })

    const unknownAoa = [
      ["Code", "Label", "Jan 2026"],
      ["", "Mystery cash item", 1000],
    ]
    const result = await runDynamicCfAdapter(
      makeFakeInput({
        workbook: makeFakeWorkbook(unknownAoa),
        XLSX: makeFakeXLSX(unknownAoa),
      }),
      FAKE_PRISMA,
    )
    expect(result.itemCount).toBe(0)
    expect(result.semanticCoa?.reviewItems[0]).toMatchObject({
      dataType: "CF",
      sourceLabel: "Mystery cash item",
    })
    expect(runCashFlowBatch).not.toHaveBeenCalled()
  })

  it("no code column → semantic mapper imports common CF labels", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: {
        ...buildProposal(0.9, ["Jan"]),
        columns: [
          { sourceIndex: 0, role: "label" as const, confidence: 0.95, reasoning: "" },
          { sourceIndex: 1, role: "amount:Jan2026" as `amount:${string}`, confidence: 0.9, reasoning: "" },
          { sourceIndex: 2, role: "skip" as const, confidence: 0.9, reasoning: "" },
        ],
      },
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const noCodeAoa = [
      ["Line", "Jan 2026", "Notes"],
      ["Cash received from customers", 100000, ""],
      ["Payments to suppliers", -40000, ""],
      ["CAPEX", -20000, ""],
      ["Loan repayment", -10000, ""],
      ["Closing cash balance", 30000, ""],
    ]
    const result = await runDynamicCfAdapter(
      makeFakeInput({
        workbook: makeFakeWorkbook(noCodeAoa),
        XLSX: makeFakeXLSX(noCodeAoa),
      }),
      FAKE_PRISMA,
    )

    expect(result.itemCount).toBe(4)
    expect(result.semanticCoa?.mappings.map((m) => m.targetCode)).toEqual([
      "CF.01.01.01",
      "CF.01.02.01",
      "CF.02.02.01",
      "CF.03.02.01",
    ])
    expect(result.semanticCoa?.reviewItems).toEqual([])
  })

  // ── 6. Activity type classification ──────────────────────────────────────

  it("CF.01→operating, CF.02→investing, CF.03→financing; CF.04→bridge", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const classAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.01.01", "Op inflow",   ...Array(12).fill(100)],
      ["CF.02.01.01", "Inv inflow",  ...Array(12).fill(50)],
      ["CF.03.02.01", "Fin outflow", ...Array(12).fill(-80)],
      ["CF.04.01.01", "FX change",   ...Array(12).fill(5)],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(classAoa),
      XLSX: makeFakeXLSX(classAoa),
    })
    const result = await runDynamicCfAdapter(input, FAKE_PRISMA)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    const actTypes = new Set(rows.map((r) => r.activityType))
    expect(actTypes.has("operating")).toBe(true)
    expect(actTypes.has("investing")).toBe(true)
    expect(actTypes.has("financing")).toBe(true)
    const bridge = rows.filter((r) => r.cfCode === "CF.04.01.01")
    expect(bridge).toHaveLength(12)
    expect(bridge.every((r) => r.activityType === "bridge")).toBe(true)
  })

  // ── 7. Entry type from sub-segment ───────────────────────────────────────

  it("CF.XX.01.* → inflow, CF.XX.02.* → outflow", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const entryAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.01.01", "Op inflow",   ...Array(12).fill(200)],  // segment 01 → inflow
      ["CF.01.02.01", "Op outflow",  ...Array(12).fill(-150)], // segment 02 → outflow
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(entryAoa),
      XLSX: makeFakeXLSX(entryAoa),
    })
    await runDynamicCfAdapter(input, FAKE_PRISMA).then((r) => r.applyToDb(FAKE_TX))

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    const inf  = rows.find((r: any) => r.cfCode === "CF.01.01.01")
    const out  = rows.find((r: any) => r.cfCode === "CF.01.02.01")
    expect(inf?.entryType).toBe("inflow")
    expect(out?.entryType).toBe("outflow")
  })

  // ── 8. CF amounts stored as Math.abs ─────────────────────────────────────

  it("negative Excel amount stored as positive (Math.abs) with outflow entryType", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const absAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      // Outflow stored as -300000 in Excel → DB amount = 300000, entryType = outflow
      ["CF.01.02.01", "Supplier payments", -300000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(absAoa),
      XLSX: makeFakeXLSX(absAoa),
    })
    const result = await runDynamicCfAdapter(input, FAKE_PRISMA)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    expect(rows[0].amount).toBe(300000) // Math.abs(-300000)
    expect(rows[0].entryType).toBe("outflow")
  })

  it("bridge rows preserve explicit zero, omit blank, and preserve a negative sign", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const bridgeAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.01.01", "Movement", 10, ...Array(11).fill(null)],
      ["CF.05", "Net change", 0, null, -5, ...Array(9).fill(null)],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(bridgeAoa),
      XLSX: makeFakeXLSX(bridgeAoa),
    })

    const result = await runDynamicCfAdapter(input, FAKE_PRISMA)
    expect(result.itemCount).toBe(3)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    const bridge = rows.filter((row) => row.cfCode === "CF.05")
    expect(bridge).toMatchObject([
      { month: 1, amount: 0, entryType: "inflow", activityType: "bridge" },
      { month: 3, amount: 5, entryType: "outflow", activityType: "bridge" },
    ])
    expect(bridge.some((row) => row.month === 2)).toBe(false)
  })

  it("uses leaf-most bridge rows when a subtotal ancestor is also present", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const bridgeAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.01.01", "Movement", 10, ...Array(11).fill(null)],
      ["CF.04", "FX subtotal", 7, ...Array(11).fill(null)],
      ["CF.04.01.01", "FX evidenced leaf", 7, ...Array(11).fill(null)],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(bridgeAoa),
      XLSX: makeFakeXLSX(bridgeAoa),
    })

    const result = await runDynamicCfAdapter(input, FAKE_PRISMA)
    expect(result.itemCount).toBe(2)
    expect(result.warnings.some((warning) => warning.includes("CF.04 skipped"))).toBe(true)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    expect(rows.map((row) => row.cfCode)).toEqual([
      "CF.01.01.01",
      "CF.04.01.01",
    ])
  })

  it("suppresses a bridge ancestor per period, preserving sparse parent evidence", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const bridgeAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.01.01", "Movement", 10, ...Array(11).fill(null)],
      ["CF.04", "FX subtotal", 7, 8, ...Array(10).fill(null)],
      ["CF.04.01.01", "FX evidenced leaf", 7, null, ...Array(10).fill(null)],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(bridgeAoa),
      XLSX: makeFakeXLSX(bridgeAoa),
    })

    const result = await runDynamicCfAdapter(input, FAKE_PRISMA)
    expect(result.itemCount).toBe(3)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    expect(
      rows.map((row) => ({ code: row.cfCode, month: row.month, amount: row.amount })),
    ).toEqual([
      { code: "CF.01.01.01", month: 1, amount: 10 },
      { code: "CF.04", month: 2, amount: 8 },
      { code: "CF.04.01.01", month: 1, amount: 7 },
    ])
  })

  it("blocks bridge-only sheets before CoA or batch writes", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    const bridgeOnlyAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.05", "Net change", 0, ...Array(11).fill(null)],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(bridgeOnlyAoa),
      XLSX: makeFakeXLSX(bridgeOnlyAoa),
    })

    const result = await runDynamicCfAdapter(input, FAKE_PRISMA)
    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((warning) => warning.includes("bridge-only"))).toBe(true)
    expect(await result.applyToDb(FAKE_TX)).toEqual({ rowsInserted: 0 })
    expect(runCashFlowBatch).not.toHaveBeenCalled()
    expect((FAKE_TX as any).chartOfAccount.upsert).not.toHaveBeenCalled()
  })

  // ── 9. Partial month coverage accepted ───────────────────────────────────

  it("proposal with only 3 months → rows extracted for those months", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9, ["Jan", "Feb", "Mar"]),
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const threeMonthAoa = [
      ["Code", "Label", "Jan 2026", "Feb 2026", "Mar 2026"],
      ["CF.01.01.01", "Receipts", 100, 200, 300],
    ]
    const result = await runDynamicCfAdapter(
      makeFakeInput({
        workbook: makeFakeWorkbook(threeMonthAoa),
        XLSX: makeFakeXLSX(threeMonthAoa),
      }),
      FAKE_PRISMA,
    )
    // 1 leaf × 3 non-zero months = 3 rows
    expect(result.itemCount).toBe(3)
  })

  // ── 10. no entityCode → 0 rows, no LLM ───────────────────────────────────

  it("no entityCode → 0 rows without calling LLM", async () => {
    const result = await runDynamicCfAdapter(
      makeFakeInput({ entityCode: null }),
      FAKE_PRISMA,
    )
    expect(result.itemCount).toBe(0)
    expect(extractMapperInput).not.toHaveBeenCalled()
    expect(getOrCreateProposal).not.toHaveBeenCalled()
  })

  // ── 11. LLM throws → 0 rows, warning, applyToDb no-op ───────────────────

  it("LLM error → 0 rows + warning, applyToDb is a no-op", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockRejectedValue(new Error("Connection refused"))

    const result = await runDynamicCfAdapter(makeFakeInput(), FAKE_PRISMA)
    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.includes("Connection refused"))).toBe(true)
    const { rowsInserted } = await result.applyToDb(FAKE_TX)
    expect(rowsInserted).toBe(0)
    expect(runCashFlowBatch).not.toHaveBeenCalled()
  })

  // ── 12. Year-mismatch guard (2026-07-15) — same contract as PLF/BS ───────

  it("proposal year ≠ input.year → sheet skipped with re-run warning, no write", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const result = await runDynamicCfAdapter(makeFakeInput({ year: 2025 }), FAKE_PRISMA)

    expect(result.itemCount).toBe(0)
    expect(
      result.warnings.some((w) => w.includes("Re-run the import with year=2026")),
    ).toBe(true)
    const { rowsInserted } = await result.applyToDb(FAKE_TX)
    expect(rowsInserted).toBe(0)
    expect(runCashFlowBatch).not.toHaveBeenCalled()
  })

  // ── Phase 11.19 — per-month reversals keep their direction ───────────────
  it("a refund month inside an outflow line becomes an INFLOW, not another outflow", async () => {
    // lineEntryType classified the whole line and Math.abs stripped each
    // cell's sign, so a refund was recorded as another outflow — adding to
    // the total it should reduce. The named CF handler never had this bug.
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    // Outflow line stored negative (the convention the other fixtures use),
    // with a single positive month = a supplier refund.
    const aoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.02.01", "Supplier payments", -1000, -1000, 250, -1000, -1000, -1000, -1000, -1000, -1000, -1000, -1000, -1000],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(aoa),
      XLSX: makeFakeXLSX(aoa),
    })
    await runDynamicCfAdapter(input, FAKE_PRISMA).then((r) => r.applyToDb(FAKE_TX))

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    const march = rows.find((r: any) => r.month === 3)
    const jan = rows.find((r: any) => r.month === 1)
    expect(jan?.entryType).toBe("outflow")
    expect(march?.entryType).toBe("inflow")
    expect(march?.amount).toBe(250)
  })

  it("keeps every month an outflow when the line uses positive magnitudes", async () => {
    // The mirror convention: an outflow-coded line storing positive
    // magnitudes must NOT have all 12 months flipped to inflow.
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const aoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["CF.01.02.01", "Supplier payments", ...Array(12).fill(1000)],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(aoa),
      XLSX: makeFakeXLSX(aoa),
    })
    await runDynamicCfAdapter(input, FAKE_PRISMA).then((r) => r.applyToDb(FAKE_TX))

    const rows = vi.mocked(runCashFlowBatch).mock.calls[0][1].rows as any[]
    expect(rows.every((r: any) => r.entryType === "outflow")).toBe(true)
  })
})
