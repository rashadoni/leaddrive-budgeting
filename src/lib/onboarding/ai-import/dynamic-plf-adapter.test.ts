/**
 * Unit tests for `runDynamicPlfAdapter`.
 * All external dependencies are mocked — no DB, no real LLM calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PrismaClient, Prisma } from "@prisma/client"

// ── Mocks (must be declared before the import under test) ─────────────────────

vi.mock("@/lib/onboarding/ai-mapper/extract", () => ({
  extractMapperInput: vi.fn(),
}))

vi.mock("@/lib/onboarding/ai-mapper/proposal-cache", () => ({
  getOrCreateProposal: vi.fn(),
}))

vi.mock("@/lib/onboarding/import-batch", () => ({
  runImportBatch: vi.fn(),
}))

// ── Imports (after vi.mock hoisting) ──────────────────────────────────────────

import { runDynamicPlfAdapter } from "./dynamic-plf-adapter"
import { extractMapperInput } from "@/lib/onboarding/ai-mapper/extract"
import { getOrCreateProposal } from "@/lib/onboarding/ai-mapper/proposal-cache"
import { runImportBatch } from "@/lib/onboarding/import-batch"

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** Build a minimal valid MappingProposal with all 12 months for year 2026. */
function buildProposal(overallConfidence = 0.88) {
  return {
    sourceFile: "test.xlsx",
    sourceSheet: "PLF TEST",
    overallConfidence,
    summary: "P&L sheet with 12 monthly columns",
    columns: [
      { sourceIndex: 0, role: "code"  as const, confidence: 0.95, reasoning: "PLF codes" },
      { sourceIndex: 1, role: "label" as const, confidence: 0.95, reasoning: "labels" },
      ...MONTH_NAMES.map((m, i) => ({
        sourceIndex: i + 2,
        role: `amount:${m}` as `amount:${string}`,
        confidence: 0.9,
        reasoning: `month ${m}`,
      })),
    ],
    accountTypeOverrides: [],
    anomalies: [],
  }
}

/** A minimal xlsx-like AOA for a PLF sheet (header + 3 data rows). */
const SAMPLE_AOA = [
  // row 0 — header band (3+ non-empty strings ≤80 chars → detected as header)
  ["Code", "Description", ...MONTH_NAMES.map((m) => `${m}-2026`)],
  // row 1 — revenue leaf
  ["PLF.01.01.01", "Revenue from Wheat", ...Array(12).fill(0).map((_, i) => i === 2 ? 100000 : 0)],
  // row 2 — expense leaf (stored negative in Excel → should become positive in DB)
  ["PLF.05.01.01", "Staff Costs",        ...Array(12).fill(0).map((_, i) => i === 2 ? -25000 : 0)],
  // row 3 — expense reversal (stored positive in Excel → should stay negative in DB)
  ["PLF.05.01.02", "Reversal",           ...Array(12).fill(0).map((_, i) => i === 3 ? 5000 : 0)],
  // row 4 — PLF.10 net-profit row → must be skipped
  ["PLF.10.00.01", "Net Profit",         ...Array(12).fill(50000)],
  // row 5 — parent code (not a leaf) → must be skipped
  ["PLF.05",       "Total OpEx",         ...Array(12).fill(-200000)],
]

/** Build a fake workbook with the SAMPLE_AOA as its sheet content. */
function makeFakeWorkbook(aoa = SAMPLE_AOA) {
  const sheet: Record<string, unknown> = { "!ref": "A1:N7" }
  // Populate some cell keys so Object.keys(sheet).length > 1
  aoa.forEach((row, r) => {
    row.forEach((val, c) => {
      const colLetter = String.fromCharCode(65 + c)
      sheet[`${colLetter}${r + 1}`] = { v: val, t: typeof val === "number" ? "n" : "s" }
    })
  })
  return {
    Sheets: { "PLF TEST": sheet },
    SheetNames: ["PLF TEST"],
  }
}

function makeFakeXLSX(aoa = SAMPLE_AOA) {
  return {
    utils: {
      sheet_to_json: vi.fn(() => aoa),
    },
  }
}

function makeFakeInput(overrides: Partial<Parameters<typeof runDynamicPlfAdapter>[0]> = {}) {
  return {
    workbook: makeFakeWorkbook(),
    sheetName: "PLF TEST",
    entityCode: "TEST-CPC",
    year: 2026,
    organizationId: "org_test_123",
    XLSX: makeFakeXLSX(),
    ...overrides,
  }
}

const FAKE_PRISMA = {} as PrismaClient
const FAKE_TX = {} as Prisma.TransactionClient

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runDynamicPlfAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Guard: extractMapperInput returns error → 0 rows, no LLM ──────────

  it("extractMapperInput error → 0 rows, getOrCreateProposal not called", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({ error: "Sheet not found" })

    const result = await runDynamicPlfAdapter(
      makeFakeInput(),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.includes("Dynamic detection failed"))).toBe(true)
    expect(getOrCreateProposal).not.toHaveBeenCalled()
  })

  // ── 2. Confidence gate ────────────────────────────────────────────────────

  it("overallConfidence < 0.5 → 0 rows, low-confidence warning", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({
      sourceFile: "test.xlsx",
      sourceSheet: "PLF TEST",
      columns: [],
      sampleRows: [],
      headerRowIndex: 0,
    } as any)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.3),
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "claude-3-5", promptVersion: "v1" },
    })

    const result = await runDynamicPlfAdapter(
      makeFakeInput(),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.toLowerCase().includes("low confidence"))).toBe(true)
    expect(runImportBatch).not.toHaveBeenCalled()
  })

  // ── 3. Happy path: cache miss, rows extracted, runImportBatch called ──────

  it("valid proposal (cache miss) → correct rows extracted, runImportBatch called", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({
      sourceFile: "test.xlsx",
      sourceSheet: "PLF TEST",
      columns: [],
      sampleRows: [],
      headerRowIndex: 0,
    } as any)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.88),
      cacheHit: false,
      usage: { inputTokens: 500, outputTokens: 200, modelName: "claude-3-5", promptVersion: "v1" },
    })
    vi.mocked(runImportBatch).mockResolvedValue({
      metrics: { rowsInserted: 3, resetArchived: 0, resetPurged: 0 },
      reconciliation: { verdict: "green", checks: [] },
    } as any)

    const result = await runDynamicPlfAdapter(
      makeFakeInput(),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )

    // itemCount should be > 0 (we have 3 valid leaf rows: rev + 2 expense)
    expect(result.itemCount).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes("Dynamic detection used"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("cache miss"))).toBe(true)

    // applyToDb triggers runImportBatch
    await result.applyToDb(FAKE_TX)
    expect(runImportBatch).toHaveBeenCalledOnce()

    const callArg = vi.mocked(runImportBatch).mock.calls[0][0]
    expect(callArg).toBe(FAKE_TX)
    const plan = vi.mocked(runImportBatch).mock.calls[0][1]
    expect(plan.companyIds).toEqual(["company_1"])
    expect(plan.organizationId).toBe("org_test_123")
  })

  // ── 4. Cache hit path ────────────────────────────────────────────────────

  it("cache hit → warnings include '(cache hit)'", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({
      sourceFile: "test.xlsx",
      sourceSheet: "PLF TEST",
      columns: [],
      sampleRows: [],
      headerRowIndex: 0,
    } as any)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.92),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "claude-3-5", promptVersion: "v1" },
    })
    vi.mocked(runImportBatch).mockResolvedValue({
      metrics: { rowsInserted: 2, resetArchived: 0, resetPurged: 0 },
      reconciliation: { verdict: "green", checks: [] },
    } as any)

    const result = await runDynamicPlfAdapter(
      makeFakeInput(),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )

    expect(result.warnings.some((w) => w.includes("cache hit"))).toBe(true)
  })

  // ── 5. resolveColumns fails (partial proposal) → 0 rows ─────────────────

  it("proposal missing months → 0 rows, reason in warnings", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({
      sourceFile: "test.xlsx",
      sourceSheet: "PLF TEST",
      columns: [],
      sampleRows: [],
      headerRowIndex: 0,
    } as any)
    // Proposal with only 6 months → resolveColumns will fail
    const partialProposal = {
      ...buildProposal(0.88),
      columns: [
        { sourceIndex: 0, role: "code" as const, confidence: 0.9, reasoning: "" },
        { sourceIndex: 1, role: "label" as const, confidence: 0.9, reasoning: "" },
        ...["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m, i) => ({
          sourceIndex: i + 2,
          role: `amount:${m}` as `amount:${string}`,
          confidence: 0.9,
          reasoning: "",
        })),
      ],
    }
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: partialProposal,
      cacheHit: false,
      usage: { inputTokens: 100, outputTokens: 50, modelName: "claude-3-5", promptVersion: "v1" },
    })

    const result = await runDynamicPlfAdapter(
      makeFakeInput(),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )

    expect(result.itemCount).toBe(0)
    expect(
      result.warnings.some((w) => w.toLowerCase().includes("column mapping incomplete")),
    ).toBe(true)
    expect(runImportBatch).not.toHaveBeenCalled()
  })

  // ── 6. Account type classification ───────────────────────────────────────

  it("PLF.10 skipped; PLF.01→revenue, PLF.02→cogs, PLF.05→expense", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({ sourceFile: "", sourceSheet: "", columns: [], sampleRows: [], headerRowIndex: 0 } as any)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    vi.mocked(runImportBatch).mockResolvedValue({
      metrics: { rowsInserted: 3, resetArchived: 0, resetPurged: 0 },
      reconciliation: { verdict: "green", checks: [] },
    } as any)

    const testAoa = [
      ["Code", "Label", ...MONTH_NAMES.map(() => "Col")],
      ["PLF.01.01.01", "Revenue",   ...Array(12).fill(100)],
      ["PLF.02.01.01", "COGS",      ...Array(12).fill(-50)],
      ["PLF.05.01.01", "Staff",     ...Array(12).fill(-30)],
      ["PLF.10.00.01", "NetProfit", ...Array(12).fill(20)], // must be skipped
    ]

    const input = makeFakeInput({
      workbook: makeFakeWorkbook(testAoa),
      XLSX: makeFakeXLSX(testAoa),
    })

    const result = await runDynamicPlfAdapter(input, "plan_1", "company_1", FAKE_PRISMA)

    // PLF.10 skipped → only 3 leaf rows × 12 months (but only non-zero values pushed)
    // All months are non-zero (100, -50, -30) → 3 × 12 = 36 rows
    expect(result.itemCount).toBe(36)
    await result.applyToDb(FAKE_TX)
    const planArg = vi.mocked(runImportBatch).mock.calls[0][1]
    const lineTypes = new Set((planArg.rows as any[]).map((r: any) => r.lineType))
    expect(lineTypes.has("revenue")).toBe(true)
    expect(lineTypes.has("cogs")).toBe(true)
    expect(lineTypes.has("expense")).toBe(true)
  })

  // ── 7. Sign normalisation: negate, not abs ────────────────────────────────

  it("expense raw -500 → +500 (negate); reversal raw +200 → -200 (negate)", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({ sourceFile: "", sourceSheet: "", columns: [], sampleRows: [], headerRowIndex: 0 } as any)
    vi.mocked(getOrCreateProposal).mockResolvedValue({
      proposal: buildProposal(0.9),
      cacheHit: true,
      usage: { inputTokens: 0, outputTokens: 0, modelName: "m", promptVersion: "v" },
    })
    vi.mocked(runImportBatch).mockResolvedValue({
      metrics: { rowsInserted: 2, resetArchived: 0, resetPurged: 0 },
      reconciliation: { verdict: "green", checks: [] },
    } as any)

    const signAoa = [
      ["Code", "Label", ...MONTH_NAMES],
      // Jan = -500 (normal expense) → stored as +500
      ["PLF.05.01.01", "Expense",   -500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      // Jan = +200 (reversal/credit) → stored as -200
      ["PLF.05.01.02", "Reversal",   200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]

    const input = makeFakeInput({
      workbook: makeFakeWorkbook(signAoa),
      XLSX: makeFakeXLSX(signAoa),
    })

    const result = await runDynamicPlfAdapter(input, "plan_1", "company_1", FAKE_PRISMA)
    await result.applyToDb(FAKE_TX)

    const rows = [...vi.mocked(runImportBatch).mock.calls[0][1].rows] as any[]
    const expense  = rows.find((r) => r.category.includes("PLF.05.01.01"))
    const reversal = rows.find((r) => r.category.includes("PLF.05.01.02"))

    expect(expense?.plannedAmount).toBe(500)   // -(-500) = +500
    expect(reversal?.plannedAmount).toBe(-200)  // -(+200) = -200
  })

  // ── 8. no entityCode → 0 rows, no LLM ────────────────────────────────────

  it("no entityCode → 0 rows without calling LLM", async () => {
    const result = await runDynamicPlfAdapter(
      makeFakeInput({ entityCode: null }),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )
    expect(result.itemCount).toBe(0)
    expect(extractMapperInput).not.toHaveBeenCalled()
    expect(getOrCreateProposal).not.toHaveBeenCalled()
  })

  // ── 9. LLM throws → 0 rows, warning, no crash ────────────────────────────

  it("LLM error → 0 rows + warning, applyToDb is a no-op", async () => {
    vi.mocked(extractMapperInput).mockReturnValue({ sourceFile: "", sourceSheet: "", columns: [], sampleRows: [], headerRowIndex: 0 } as any)
    vi.mocked(getOrCreateProposal).mockRejectedValue(new Error("API timeout"))

    const result = await runDynamicPlfAdapter(
      makeFakeInput(),
      "plan_1",
      "company_1",
      FAKE_PRISMA,
    )

    expect(result.itemCount).toBe(0)
    expect(result.warnings.some((w) => w.includes("API timeout"))).toBe(true)
    const { rowsInserted } = await result.applyToDb(FAKE_TX)
    expect(rowsInserted).toBe(0)
    expect(runImportBatch).not.toHaveBeenCalled()
  })
})
