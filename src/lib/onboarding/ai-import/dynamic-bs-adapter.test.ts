/**
 * Unit tests for `runDynamicBsAdapter`.
 * All external dependencies are mocked — no DB, no real LLM calls.
 *
 * Locks in:
 *   - extractMapperInput error → 0 rows, getOrCreateProposal not called
 *   - overallConfidence < 0.5 → 0 rows, low-confidence warning
 *   - Valid proposal, cache miss → rows extracted, runBalanceSheetBatch called
 *   - Valid proposal, cache hit → warnings include "(cache hit)"
 *   - No "code" column → 0 rows, reason in warnings
 *   - Account classification: BS.01.01.* → asset/non_current, BS.02.* → equity,
 *     BS.03.01.* → liability/long_term, BS.03.02.* → liability/short_term
 *   - BS amounts stored as-is (no sign inversion — snapshot values)
 *   - Partial month coverage accepted (resolveColumnsPartial, not resolveColumns)
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

vi.mock("@/lib/onboarding/bs-import-batch", () => ({
  runBalanceSheetBatch: vi.fn(),
}))

import { runDynamicBsAdapter } from "./dynamic-bs-adapter"
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { getOrCreateProposal } from "@/lib/onboarding/ai-mapper/proposal-cache"
import { runBalanceSheetBatch } from "@/lib/onboarding/bs-import-batch"

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** Minimal valid MappingProposal for a BS sheet (all 12 months). */
function buildProposal(overallConfidence = 0.9, months = MONTH_NAMES) {
  return {
    sourceFile: "test.xlsx",
    sourceSheet: "BS TEST",
    overallConfidence,
    summary: "Balance sheet with monthly columns",
    columns: [
      { sourceIndex: 0, role: "code" as const, confidence: 0.95, reasoning: "BS codes" },
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
  // asset leaf (non-current)
  ["BS.01.01.01", "Land",         ...Array(12).fill(0).map((_, i) => i === 0 ? 5000000 : 0)],
  // asset leaf (current)
  ["BS.01.02.01", "Cash",         ...Array(12).fill(0).map((_, i) => i === 0 ? 200000 : 0)],
  // equity leaf
  ["BS.02.01.01", "Share Capital",...Array(12).fill(0).map((_, i) => i === 0 ? 3000000 : 0)],
  // liability leaf (long-term)
  ["BS.03.01.01", "LT Loans",     ...Array(12).fill(0).map((_, i) => i === 0 ? 1500000 : 0)],
  // liability leaf (short-term)
  ["BS.03.02.01", "ST Payables",  ...Array(12).fill(0).map((_, i) => i === 0 ? 700000 : 0)],
  // non-leaf / parent row → should be skipped (code has no 4th segment)
  ["BS.01",       "Total Assets", ...Array(12).fill(5200000)],
]

function makeFakeWorkbook(aoa = SAMPLE_AOA) {
  const sheet: Record<string, unknown> = { "!ref": "A1:N8" }
  aoa.forEach((row, r) => {
    row.forEach((val, c) => {
      const colLetter = String.fromCharCode(65 + c)
      sheet[`${colLetter}${r + 1}`] = { v: val }
    })
  })
  return {
    Sheets: { "BS TEST": sheet },
    SheetNames: ["BS TEST"],
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
  overrides: Partial<Parameters<typeof runDynamicBsAdapter>[0]> = {},
) {
  return {
    workbook: makeFakeWorkbook(),
    sheetName: "BS TEST",
    entityCode: "TEST-ENTITY",
    year: 2026,
    organizationId: "org_test_123",
    XLSX: makeFakeXLSX(),
    ...overrides,
  }
}

const FAKE_PRISMA = {} as PrismaClient
// Phase 2.1 session 1 — applyToDb resolves accountId via
// tx.chartOfAccount.upsert before runBalanceSheetBatch.
const FAKE_TX = {
  chartOfAccount: {
    upsert: vi.fn(async (args: {
      where: { organizationId_code: { code: string } }
    }) => ({ id: `coa_${args.where.organizationId_code.code}` })),
  },
} as unknown as Prisma.TransactionClient

const MOCK_MAPPER_INPUT = {
  sourceFile: "test.xlsx",
  sourceSheet: "BS TEST",
  columns: [],
  sampleRows: [],
  headerRowIndex: 0,
} as any

function mockBatchOk() {
  vi.mocked(runBalanceSheetBatch).mockResolvedValue({
    batchId: "b1",
    startedAt: "",
    finishedAt: "",
    durationMs: 10,
    plan: { label: "", sourceDocument: "", planIds: [], periodScope: [] },
    metrics: { rowsInserted: 5, resetArchived: 0, resetPurged: 0 },
    reconciliation: { verdict: "green", checks: [] },
  } as any)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runDynamicBsAdapter", () => {
  beforeEach(() => { vi.clearAllMocks() })

  // ── 1. Guard: extractMapperInput error ────────────────────────────────────

  it("extractMapperInput error → 0 rows, getOrCreateProposal not called", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({ error: "Sheet empty" })

    const result = await runDynamicBsAdapter(makeFakeInput(), "plan_1", FAKE_PRISMA)

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.includes("Dynamic BS detection failed"))).toBe(true)
    expect(getOrCreateProposal).not.toHaveBeenCalled()
  })

  // ── 2. Confidence gate ────────────────────────────────────────────────────

  it("overallConfidence < 0.5 → 0 rows, low-confidence warning", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.3),
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "claude-3-5", promptVersion: "v1" },
    })

    const result = await runDynamicBsAdapter(makeFakeInput(), "plan_1", FAKE_PRISMA)

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.toLowerCase().includes("low confidence"))).toBe(true)
    expect(runBalanceSheetBatch).not.toHaveBeenCalled()
  })

  // ── 3. Happy path: cache miss ─────────────────────────────────────────────

  it("valid proposal (cache miss) → rows extracted, runBalanceSheetBatch called", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: false,
      usage: { inputTokens: 500, outputTokens: 200, modelName: "claude-3-5", promptVersion: "v1" },
    })
    mockBatchOk()

    const result = await runDynamicBsAdapter(makeFakeInput(), "plan_1", FAKE_PRISMA)

    // 5 BS leaf rows, each with 1 non-zero Jan value = 5 rows
    expect(result.itemCount).toBe(5)
    expect(result.warnings.some((w) => w.includes("Dynamic detection used"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("cache miss"))).toBe(true)

    await result.applyToDb(FAKE_TX)
    expect(runBalanceSheetBatch).toHaveBeenCalledOnce()

    const callTx = vi.mocked(runBalanceSheetBatch).mock.calls[0][0]
    expect(callTx).toBe(FAKE_TX)
    const plan = vi.mocked(runBalanceSheetBatch).mock.calls[0][1]
    expect(plan.organizationId).toBe("org_test_123")
    expect(plan.planIds).toEqual(["plan_1"])
  })

  // ── 4. Cache hit path ─────────────────────────────────────────────────────

  it("cache hit → warnings include '(cache hit)'", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.95),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "claude-3-5", promptVersion: "v1" },
    })
    mockBatchOk()

    const result = await runDynamicBsAdapter(makeFakeInput(), "plan_1", FAKE_PRISMA)
    expect(result.warnings.some((w) => w.includes("cache hit"))).toBe(true)
  })

  // ── 5. Missing "code" column falls back to semantic CoA review ───────────

  it("proposal with no code column and unknown label → 0 rows + CoA review", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    const noCodeProposal = {
      ...buildProposal(0.9),
      columns: [
        // label is present but code is missing
        { sourceIndex: 1, role: "label" as const, confidence: 0.9, reasoning: "" },
        { sourceIndex: 2, role: "amount:Jan2026" as `amount:${string}`, confidence: 0.9, reasoning: "" },
      ],
    }
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: noCodeProposal,
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "m", promptVersion: "v" },
    })

    const unknownAoa = [
      ["Code", "Label", "Jan 2026"],
      ["", "Mystery balance item", 1000],
    ]

    const result = await runDynamicBsAdapter(
      makeFakeInput({
        workbook: makeFakeWorkbook(unknownAoa),
        XLSX: makeFakeXLSX(unknownAoa),
      }),
      "plan_1",
      FAKE_PRISMA,
    )
    expect(result.itemCount).toBe(0)
    expect(result.semanticCoa?.reviewItems[0]).toMatchObject({
      dataType: "BS",
      sourceLabel: "Mystery balance item",
    })
    expect(runBalanceSheetBatch).not.toHaveBeenCalled()
  })

  it("no code column → semantic mapper imports common BS labels", async () => {
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
      ["Cash equivalents", 100000, ""],
      ["Receivables", 50000, ""],
      ["Loans payable", -30000, ""],
      ["Total assets", 150000, ""],
    ]
    const result = await runDynamicBsAdapter(
      makeFakeInput({
        workbook: makeFakeWorkbook(noCodeAoa),
        XLSX: makeFakeXLSX(noCodeAoa),
      }),
      "plan_1",
      FAKE_PRISMA,
    )

    expect(result.itemCount).toBe(3)
    expect(result.semanticCoa?.mappings.map((m) => m.targetCode)).toEqual([
      "BS.01.02.01",
      "BS.01.02.02",
      "BS.03.02.01",
    ])
    expect(result.semanticCoa?.reviewItems).toEqual([])
  })

  // ── 6. Partial month coverage accepted ───────────────────────────────────

  it("proposal with only 4 months → rows extracted for those months (partial OK)", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    // Only Jan-Apr columns in proposal
    const partialMonths = ["Jan", "Feb", "Mar", "Apr"]
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9, partialMonths),
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    // Build AOA with all 12 month columns so XLSX parsing returns values for Jan-Apr only
    const partialAoa = [
      ["Code", "Label", "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"],
      ["BS.01.02.01", "Cash", 100000, 110000, 120000, 130000],
    ]
    const result = await runDynamicBsAdapter(
      makeFakeInput({
        workbook: makeFakeWorkbook(partialAoa),
        XLSX: makeFakeXLSX(partialAoa),
      }),
      "plan_1",
      FAKE_PRISMA,
    )

    // 1 leaf × 4 non-zero months = 4 rows
    expect(result.itemCount).toBe(4)
    expect(result.itemCount).toBeGreaterThan(0)
  })

  // ── 7. Account classification ─────────────────────────────────────────────

  it("BS.01.01→asset/non_current, BS.01.02→asset/current, BS.02→equity, BS.03.01→liability/long_term, BS.03.02→liability/short_term", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const classAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      ["BS.01.01.01", "Fixed Asset",  ...Array(12).fill(1000)],
      ["BS.01.02.01", "Current Asset",...Array(12).fill(500)],
      ["BS.02.01.01", "Equity",       ...Array(12).fill(800)],
      ["BS.03.01.01", "LT Debt",      ...Array(12).fill(-300)],
      ["BS.03.02.01", "ST Payable",   ...Array(12).fill(-200)],
      ["BS.01",       "Total Assets", ...Array(12).fill(5000)], // parent → skip
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(classAoa),
      XLSX: makeFakeXLSX(classAoa),
    })
    const result = await runDynamicBsAdapter(input, "plan_1", FAKE_PRISMA)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runBalanceSheetBatch).mock.calls[0][1].rows as any[]
    const getRow = (code: string, m: number) =>
      rows.find((r) => r.accountCode.includes(code) && r.month === m + 1)

    const fixedAsset = getRow("BS.01.01.01", 0)
    expect(fixedAsset?.lineType).toBe("asset")
    expect(fixedAsset?.subType).toBe("non_current")

    const currentAsset = getRow("BS.01.02.01", 0)
    expect(currentAsset?.lineType).toBe("asset")
    expect(currentAsset?.subType).toBe("current")

    const equity = getRow("BS.02.01.01", 0)
    expect(equity?.lineType).toBe("equity")
    expect(equity?.subType).toBeNull()

    const ltDebt = getRow("BS.03.01.01", 0)
    expect(ltDebt?.lineType).toBe("liability")
    expect(ltDebt?.subType).toBe("long_term")

    const stPayable = getRow("BS.03.02.01", 0)
    expect(stPayable?.lineType).toBe("liability")
    expect(stPayable?.subType).toBe("short_term")
  })

  // ── 8. BS amounts stored as-is (no sign inversion) ───────────────────────

  it("negative amount in Excel stored as negative in DB (no sign flip)", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    mockBatchOk()

    const signAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      // Liability stored as negative in Excel (some BS formats do this)
      ["BS.03.02.01", "Payable", -500000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]
    const input = makeFakeInput({
      workbook: makeFakeWorkbook(signAoa),
      XLSX: makeFakeXLSX(signAoa),
    })
    const result = await runDynamicBsAdapter(input, "plan_1", FAKE_PRISMA)
    await result.applyToDb(FAKE_TX)

    const rows = vi.mocked(runBalanceSheetBatch).mock.calls[0][1].rows as any[]
    expect(rows[0].amount).toBe(-500000) // stored as-is, no negation
  })

  // ── 9. no entityCode → 0 rows, no LLM ────────────────────────────────────

  it("no entityCode → 0 rows without calling LLM", async () => {
    const result = await runDynamicBsAdapter(
      makeFakeInput({ entityCode: null }),
      "plan_1",
      FAKE_PRISMA,
    )
    expect(result.itemCount).toBe(0)
    expect(extractMapperInput).not.toHaveBeenCalled()
    expect(getOrCreateProposal).not.toHaveBeenCalled()
  })

  // ── 10. LLM throws → 0 rows, warning ─────────────────────────────────────

  it("LLM error → 0 rows + warning, applyToDb is a no-op", async () => {
    vi.mocked(extractMapperInput).mockReturnValue(MOCK_MAPPER_INPUT)
    vi.mocked(getOrCreateProposal).mockRejectedValue(new Error("Rate limit"))

    const result = await runDynamicBsAdapter(makeFakeInput(), "plan_1", FAKE_PRISMA)
    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.includes("Rate limit"))).toBe(true)
    const { rowsInserted } = await result.applyToDb(FAKE_TX)
    expect(rowsInserted).toBe(0)
    expect(runBalanceSheetBatch).not.toHaveBeenCalled()
  })
})
