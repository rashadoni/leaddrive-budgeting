/**
 * Integration tests for the AI Import orchestrator. Uses in-memory
 * stubs for prisma + anthropic client to keep tests hermetic.
 */
import { describe, it, expect, vi } from "vitest"
import { runAIImport } from "./orchestrator"
import { buildRegistryWith, type AdapterHandler } from "./adapter-registry"
import type { SheetClassifierAnthropicLike } from "./sheet-classifier"
import type { PrismaClient } from "@prisma/client"

function stubClient(
  classificationsJson: string,
): SheetClassifierAnthropicLike {
  return {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: classificationsJson }],
        usage: { input_tokens: 100, output_tokens: 50 },
      })),
    },
  }
}

function stubPrisma(): PrismaClient {
  return {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({})
    }),
  } as unknown as PrismaClient
}

// Mini workbook with 2 sheets (PLF CPC + a separator)
const fakeWorkbook = {
  Sheets: {
    "PLF CPC": {
      "!ref": "A1:C3",
    },
    "Actual >>>": {
      "!ref": "A1:A1",
    },
  },
  SheetNames: ["PLF CPC", "Actual >>>"],
}

// Stub XLSX module
const fakeXLSX = {
  utils: {
    sheet_to_json: (sheet: unknown, opts?: { header: number }) => {
      void opts
      // Distinguish between sheets via reference identity
      if (sheet === fakeWorkbook.Sheets["PLF CPC"]) {
        return [
          ["PLF.01", "Revenue", 100],
          ["PLF.02", "COGS", -50],
        ]
      }
      return []
    },
  },
}

describe("runAIImport", () => {
  it("orchestrates parse → classify → adapter → commit on green verdict", async () => {
    const plfApply = vi.fn(async () => ({ rowsInserted: 2 }))
    const plfHandler: AdapterHandler = async () => ({
      summary: "2 PLF rows parsed",
      itemCount: 2,
      warnings: [],
      applyToDb: plfApply,
    })

    const result = await runAIImport(
      {
        workbook: fakeWorkbook,
        XLSX: fakeXLSX,
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma: stubPrisma(),
        anthropicClient: stubClient(
          JSON.stringify({
            classifications: [
              {
                sheetName: "PLF CPC",
                dataType: "PLF",
                entityCode: "AZSEKER-CPC",
                confidence: 0.95,
                reasoning: "PLF prefix",
              },
            ],
          }),
        ),
        model: "claude-test",
        registry: buildRegistryWith({ PLF: plfHandler }),
      },
    )

    expect(result.classifications).toHaveLength(2) // PLF + separator
    expect(result.committed).toBe(true)
    expect(result.action).toBe("commit")
    expect(result.totalRowsInserted).toBe(2)
    expect(plfApply).toHaveBeenCalledOnce()
  })

  it("aborts without DB write when adapter is missing for a classification", async () => {
    const result = await runAIImport(
      {
        workbook: fakeWorkbook,
        XLSX: fakeXLSX,
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma: stubPrisma(),
        anthropicClient: stubClient(
          JSON.stringify({
            classifications: [
              {
                sheetName: "PLF CPC",
                dataType: "PLF",
                entityCode: "AZSEKER-CPC",
                confidence: 0.95,
                reasoning: "PLF prefix",
              },
            ],
          }),
        ),
        model: "claude-test",
        registry: buildRegistryWith({}), // no PLF handler!
      },
    )

    expect(result.warnings.some((w) => /no adapter/.test(w))).toBe(true)
    // Without any adapters running, nothing's parsed → reconciliation
    // is trivially green, but committed=true with 0 rows.
    expect(result.totalRowsInserted).toBe(0)
  })

  it("dryRun mode skips DB writes entirely", async () => {
    const plfApply = vi.fn(async () => ({ rowsInserted: 99 }))
    const plfHandler: AdapterHandler = async () => ({
      summary: "ok",
      itemCount: 1,
      warnings: [],
      applyToDb: plfApply,
    })
    const result = await runAIImport(
      {
        workbook: fakeWorkbook,
        XLSX: fakeXLSX,
        organizationId: "org1",
        year: 2026,
        dryRun: true,
      },
      {
        prisma: stubPrisma(),
        anthropicClient: stubClient(
          JSON.stringify({
            classifications: [
              {
                sheetName: "PLF CPC",
                dataType: "PLF",
                entityCode: "AZSEKER-CPC",
                confidence: 0.95,
                reasoning: "x",
              },
            ],
          }),
        ),
        model: "claude-test",
        registry: buildRegistryWith({ PLF: plfHandler }),
      },
    )
    expect(result.action).toBe("dry_run")
    expect(result.committed).toBe(false)
    expect(plfApply).not.toHaveBeenCalled()
  })

  it("captures adapter errors as warnings without crashing the whole import", async () => {
    const throwingHandler: AdapterHandler = async () => {
      throw new Error("parser blew up on row 42")
    }
    const result = await runAIImport(
      {
        workbook: fakeWorkbook,
        XLSX: fakeXLSX,
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma: stubPrisma(),
        anthropicClient: stubClient(
          JSON.stringify({
            classifications: [
              {
                sheetName: "PLF CPC",
                dataType: "PLF",
                entityCode: "AZSEKER-CPC",
                confidence: 0.95,
                reasoning: "x",
              },
            ],
          }),
        ),
        model: "claude-test",
        registry: buildRegistryWith({ PLF: throwingHandler }),
      },
    )
    expect(result.warnings.some((w) => /parser blew up/.test(w))).toBe(true)
  })

  it("reports LLM usage in result", async () => {
    const result = await runAIImport(
      {
        workbook: fakeWorkbook,
        XLSX: fakeXLSX,
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma: stubPrisma(),
        anthropicClient: stubClient(
          JSON.stringify({
            classifications: [
              {
                sheetName: "PLF CPC",
                dataType: "UNKNOWN",
                entityCode: null,
                confidence: 0.3,
                reasoning: "x",
              },
            ],
          }),
        ),
        model: "claude-test",
        registry: buildRegistryWith({}),
      },
    )
    expect(result.llmUsage.inputTokens).toBe(100)
    expect(result.llmUsage.outputTokens).toBe(50)
    expect(result.llmUsage.modelName).toBe("claude-test")
  })

  it("skips LLM call when all sheets are separators (zero token spend)", async () => {
    const sepWorkbook = {
      Sheets: { "Actual >>>": { "!ref": "A1:A1" } },
      SheetNames: ["Actual >>>"],
    }
    const llmCreate = vi.fn()
    const result = await runAIImport(
      {
        workbook: sepWorkbook,
        XLSX: fakeXLSX,
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma: stubPrisma(),
        anthropicClient: { messages: { create: llmCreate } },
        model: "claude-test",
        registry: buildRegistryWith({}),
      },
    )
    expect(llmCreate).not.toHaveBeenCalled()
    expect(result.llmUsage.inputTokens).toBe(0)
    expect(result.llmUsage.outputTokens).toBe(0)
  })
})
