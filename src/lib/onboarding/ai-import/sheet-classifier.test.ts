/**
 * Tests for sheet-classifier — uses a stub Anthropic client to keep
 * the suite hermetic + token-spend-free.
 */
import { describe, it, expect, vi } from "vitest"
import {
  classifySheets,
  planKindForSheet,
  type SheetClassifierAnthropicLike,
  type SheetDataType,
} from "./sheet-classifier"
import type { SheetMeta } from "./sheet-meta-extractor"

function meta(
  name: string,
  overrides: Partial<SheetMeta> = {},
): SheetMeta {
  return {
    sheetName: name,
    range: "A1:Z100",
    totalRows: 100,
    totalColumns: 10,
    headerRowIndex: 0,
    headers: [],
    sample: [],
    columnProfiles: [],
    isSectionSeparator: false,
    sectionContext: null,
    ...overrides,
  }
}

function stubClient(
  responseJson: string,
  usage = { input_tokens: 500, output_tokens: 200 },
): SheetClassifierAnthropicLike {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: responseJson }],
        usage,
      })),
    },
  }
}

describe("classifySheets", () => {
  it("skips LLM call entirely when all sheets are separators or empty", async () => {
    const sep = meta("Actual >>>", {
      isSectionSeparator: true,
      totalRows: 0,
    })
    const empty = meta("Empty", { totalRows: 0 })
    const create = vi.fn()
    const client: SheetClassifierAnthropicLike = {
      messages: { create },
    }
    const result = await classifySheets(
      { sheetMetas: [sep, empty] },
      client,
      "claude-test",
    )
    expect(create).not.toHaveBeenCalled()
    expect(result.skippedLLM).toBe(true)
    expect(result.classifications).toHaveLength(2)
    expect(result.classifications[0].dataType).toBe("INFO_SUMMARY")
    expect(result.classifications[1].dataType).toBe("UNKNOWN")
  })

  it("classifies a P&L sheet via LLM", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "PLF CPC",
            dataType: "PLF",
            entityCode: "AZSEKER-CPC",
            confidence: 0.95,
            reasoning: "headers contain PLF.XX codes and Revenue/COGS rows",
          },
        ],
      }),
    )
    const result = await classifySheets(
      {
        sheetMetas: [
          meta("PLF CPC", {
            headers: ["PLF.01", "REVENUE", "Jan", "Feb"],
            sample: [["PLF.01.01", "Revenue from Farming", "100", "200"]],
          }),
        ],
        knownEntityCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
      },
      client,
      "claude-test",
    )
    expect(result.skippedLLM).toBe(false)
    expect(result.classifications).toHaveLength(1)
    expect(result.classifications[0].dataType).toBe("PLF")
    expect(result.classifications[0].entityCode).toBe("AZSEKER-CPC")
    expect(result.classifications[0].confidence).toBeCloseTo(0.95)
    expect(result.usage.inputTokens).toBe(500)
    expect(result.usage.outputTokens).toBe(200)
  })

  it("passes compact workbook profile hints to the LLM prompt", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "PLF CPC",
            dataType: "PLF",
            entityCode: "AZSEKER-CPC",
            confidence: 0.95,
            reasoning: "profile says source-like PLF",
          },
        ],
      }),
    )
    await classifySheets(
      {
        sheetMetas: [meta("PLF CPC")],
        workbookProfile: {
          filename: "profiled.xlsx",
          sheetCount: 1,
          workbookPlanHint: "actual",
          sourceLikeSheets: 1,
          summaryLikeSheets: 0,
          monthLikeSheets: 1,
          sheetsWithBuColumns: 1,
          sheetsWithFormulas: 0,
          sheetsWithEliminations: 0,
          duplicateGroups: [],
          repeatedDataHints: [],
          sheets: [
            {
              sheetName: "PLF CPC",
              roleHint: "source_like",
              planHint: "actual",
              sourceScore: 95,
              summaryScore: 5,
              monthHeaderCount: 12,
              buColumnCount: 1,
              entityLikeValues: ["CPC"],
              formulaCells: 0,
              codeLikeCells: 20,
              totalRowsCount: 1,
              subtotalRowsCount: 0,
              eliminationSignalCount: 0,
              duplicateGroupId: null,
            },
          ],
        } as never,
      },
      client,
      "claude-test",
    )
    const create = client.messages.create as ReturnType<typeof vi.fn>
    const userMessage = create.mock.calls[0][0].messages[0].content
    expect(userMessage).toContain("Workbook profile hints")
    expect(userMessage).toContain('"roleHint": "source_like"')
    expect(userMessage).toContain('"buColumnCount": 1')
  })

  it("merges pre-classified separators with LLM output, preserving sheet order", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "PLF CPC",
            dataType: "PLF",
            entityCode: "AZSEKER-CPC",
            confidence: 0.9,
            reasoning: "PLF codes in column 1",
          },
          {
            sheetName: "BS CPC",
            dataType: "BS",
            entityCode: "AZSEKER-CPC",
            confidence: 0.92,
            reasoning: "BS.XX codes + Assets/Liabilities",
          },
        ],
      }),
    )
    const result = await classifySheets(
      {
        sheetMetas: [
          meta("Təsvir"),
          meta("Actual >>>", { isSectionSeparator: true }),
          meta("PLF CPC"),
          meta("BS CPC"),
        ],
      },
      client,
      "claude-test",
    )
    expect(result.classifications.map((c) => c.sheetName)).toEqual([
      "Təsvir",
      "Actual >>>",
      "PLF CPC",
      "BS CPC",
    ])
    expect(result.classifications[1].dataType).toBe("INFO_SUMMARY")
  })

  it("fills missing LLM responses with UNKNOWN so sheets aren't silently dropped", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "PLF CPC",
            dataType: "PLF",
            entityCode: "AZSEKER-CPC",
            confidence: 0.9,
            reasoning: "ok",
          },
          // BS CPC missing from LLM response!
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("PLF CPC"), meta("BS CPC")] },
      client,
      "claude-test",
    )
    expect(result.classifications).toHaveLength(2)
    const bs = result.classifications.find((c) => c.sheetName === "BS CPC")!
    expect(bs.dataType).toBe("UNKNOWN")
    expect(bs.confidence).toBe(0)
    expect(bs.reasoning).toMatch(/did not return/i)
  })

  it("rejects invalid dataType from LLM", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "PLF CPC",
            dataType: "NONSENSE_TYPE",
            entityCode: null,
            confidence: 0.9,
            reasoning: "x",
          },
        ],
      }),
    )
    await expect(
      classifySheets({ sheetMetas: [meta("PLF CPC")] }, client, "claude-test"),
    ).rejects.toThrow(/invalid dataType/)
  })

  it("throws on max_tokens truncation", async () => {
    const client: SheetClassifierAnthropicLike = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: '{"classifications":[' }],
        })),
      },
    }
    await expect(
      classifySheets({ sheetMetas: [meta("PLF CPC")] }, client, "claude-test"),
    ).rejects.toThrow(/max_tokens/)
  })

  it("clamps confidence into [0, 1]", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "X",
            dataType: "PLF",
            entityCode: null,
            confidence: 1.5,
            reasoning: "x",
          },
          {
            sheetName: "Y",
            dataType: "BS",
            entityCode: null,
            confidence: -0.2,
            reasoning: "y",
          },
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("X"), meta("Y")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].confidence).toBe(1)
    expect(result.classifications[1].confidence).toBe(0)
  })

  it("handles JSON wrapped in markdown fences", async () => {
    const client = stubClient(
      '```json\n' +
        JSON.stringify({
          classifications: [
            {
              sheetName: "X",
              dataType: "CF",
              entityCode: null,
              confidence: 0.8,
              reasoning: "test",
            },
          ],
        }) +
        '\n```',
    )
    const result = await classifySheets(
      { sheetMetas: [meta("X")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].dataType).toBe("CF")
  })

  it("accepts COMPANIES dataType from LLM (Phase 7.M Tier 6)", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "Companies",
            dataType: "COMPANIES",
            entityCode: null,
            confidence: 0.92,
            reasoning: "headers code/name/industry/level/parentCompanyCode",
          },
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("Companies")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].dataType).toBe("COMPANIES")
    expect(result.classifications[0].entityCode).toBeNull()
  })

  it("accepts OPS_FACTS dataType from LLM (Phase 7.M Tier 7)", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "OperationalFacts",
            dataType: "OPS_FACTS",
            entityCode: null,
            confidence: 0.91,
            reasoning: "headers companyCode/metric/date/value/unit",
          },
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("OperationalFacts")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].dataType).toBe("OPS_FACTS")
    expect(result.classifications[0].entityCode).toBeNull()
  })

  it("accepts BUDGET_ACTUALS dataType from LLM (Phase 7.M Tier 7 Phase 3)", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "Actuals2026",
            dataType: "BUDGET_ACTUALS",
            entityCode: null,
            confidence: 0.93,
            reasoning: "headers category/amount/date, row-per-transaction",
          },
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("Actuals2026")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].dataType).toBe("BUDGET_ACTUALS")
    expect(result.classifications[0].entityCode).toBeNull()
  })

  it("accepts SALES_FORECAST dataType from LLM (Phase 7.M Tier 7 Phase 4)", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "SalesForecast2026",
            dataType: "SALES_FORECAST",
            entityCode: null,
            confidence: 0.94,
            reasoning:
              "col 1 department labels (Sales/Marketing), cols 2-13 = Jan..Dec",
          },
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("SalesForecast2026")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].dataType).toBe("SALES_FORECAST")
    expect(result.classifications[0].entityCode).toBeNull()
  })

  it("classifies entity code as null for cross-entity sheets", async () => {
    const client = stubClient(
      JSON.stringify({
        classifications: [
          {
            sheetName: "Farming KPI",
            dataType: "KPI_FARMING",
            entityCode: null,
            confidence: 0.88,
            reasoning: "multi-farm sheet, attribution done per-row",
          },
        ],
      }),
    )
    const result = await classifySheets(
      { sheetMetas: [meta("Farming KPI")] },
      client,
      "claude-test",
    )
    expect(result.classifications[0].entityCode).toBeNull()
    expect(result.classifications[0].dataType).toBe("KPI_FARMING")
  })

  // Phase 7.M Tier 5 — filename hint propagation
  it("passes filenameHint through to user message", async () => {
    let capturedSystem = ""
    let capturedUserMsg = ""
    const client: SheetClassifierAnthropicLike = {
      messages: {
        create: vi.fn(async (params) => {
          capturedSystem = params.system
          capturedUserMsg = params.messages[0].content
          return {
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  classifications: [
                    {
                      sheetName: "Sheet1",
                      dataType: "PLF",
                      entityCode: null,
                      confidence: 0.9,
                      reasoning: "x",
                    },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }
        }),
      },
    }
    await classifySheets(
      {
        sheetMetas: [meta("Sheet1")],
        filenameHint: "Farming strategy - Guvven.xlsx",
      },
      client,
      "claude-test",
    )
    // Filename hint should appear in user message verbatim
    expect(capturedUserMsg).toContain("Farming strategy - Guvven.xlsx")
    expect(capturedUserMsg).toContain("forward-forecast")
    expect(capturedSystem).toBeTruthy() // system prompt still applied
  })
})

describe("planKindForSheet (Decouple Y5b — actual vs budget routing)", () => {
  it("section context wins over dataType default", () => {
    // A realized-P&L sheet (PLF) sitting under a 'Budget' section header
    // must route to the budget plan, not actuals.
    expect(planKindForSheet("PLF", "budget")).toBe("budget")
    // A sales sheet under an explicit 'Actual' section routes to actuals,
    // overriding the SALES→budget default.
    expect(planKindForSheet("SALES", "actual")).toBe("actual")
    expect(planKindForSheet("BUDGET_ACTUALS", "actual")).toBe("actual")
  })

  it("realized statements default to the actuals plan (terminal P&L source)", () => {
    const actualTypes: SheetDataType[] = ["PLF", "BS", "CF"]
    for (const t of actualTypes) {
      expect(planKindForSheet(t, null)).toBe("actual")
    }
  })

  it("forward plans default to the budget plan", () => {
    // SALES / SALES_FORECAST are revenue targets.
    expect(planKindForSheet("SALES", null)).toBe("budget")
    expect(planKindForSheet("SALES_FORECAST", null)).toBe("budget")
    // BUDGET_ACTUALS rows are realized spend recorded AGAINST a budget —
    // they must share the budget plan's planId so execution % computes
    // (Σactual ÷ Σplanned within ONE plan). Routing them to the actuals
    // plan would orphan them from the budgeted lines.
    expect(planKindForSheet("BUDGET_ACTUALS", null)).toBe("budget")
  })

  it("kpi / capex section contexts fall through to dataType default", () => {
    // Non actual/budget sections don't force a kind; the dataType decides.
    expect(planKindForSheet("PLF", "kpi")).toBe("actual")
    expect(planKindForSheet("SALES", "capex")).toBe("budget")
  })
})
