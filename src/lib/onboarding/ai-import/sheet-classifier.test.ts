/**
 * Tests for sheet-classifier — uses a stub Anthropic client to keep
 * the suite hermetic + token-spend-free.
 */
import { describe, it, expect, vi } from "vitest"
import { classifySheets, type SheetClassifierAnthropicLike } from "./sheet-classifier"
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
