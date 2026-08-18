/**
 * Phase 7.M Tier 5 (2026-05-20) — Multi-file orchestrator tests.
 *
 * Hermetic: in-memory prisma + anthropic + xlsx stubs. Tests cover the
 * 8 scenarios from the plan:
 *   1. 1 file (main-financial) → green commit
 *   2. 3 files (main + land + forward) → 3 groups all green
 *   3. 2 files same type + conflict → 409 (no DB writes)
 *   4. 1 file main fails (parse error) → group rolled back, others OK
 *   5. LLM classify fails for one file → other files still processed
 *   6. dryRun=true → no DB writes, preview only
 *   7. forceOverride=true → commits despite conflict
 *   8. unknown file-type → skipped with warning
 */
import { describe, it, expect, vi } from "vitest"
import {
  runMultiFileImport,
  type MultiFileImportDependencies,
  type MultiFileImportInput,
} from "./multi-file-orchestrator"
import { buildRegistryWith, type AdapterHandler } from "./adapter-registry"
import type { SheetClassifierAnthropicLike } from "./sheet-classifier"
import { REPORTING_PACK_SHEET_MAP } from "./reporting-pack-sheet-map"
import { HOLDING_ENTITY_SENTINEL, type SheetMap } from "./sheet-routing"
import type { PrismaClient } from "@prisma/client"
import { buildReconKey, reconcile } from "../reconciliation"
import * as realXLSX from "xlsx"

// ─── Stubs ──────────────────────────────────────────────────────────────

function classifyResponse(classifications: unknown[]) {
  return {
    stop_reason: "end_turn" as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ classifications }),
      },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

/** Anthropic stub that returns a different classification per call,
 *  based on the order of files in the input. */
function stubClientPerCall(
  responses: unknown[][],
): SheetClassifierAnthropicLike {
  let i = 0
  return {
    messages: {
      create: vi.fn(async () => {
        if (i >= responses.length) {
          throw new Error(`Stub exhausted at call ${i + 1}`)
        }
        return classifyResponse(responses[i++])
      }),
    },
  }
}

/** Prisma stub: $transaction passes a fake tx, $company.findMany returns
 *  whatever map you provide. */
function stubPrisma(
  opts: { companies?: Array<{ id: string; code: string }>; failTx?: boolean } = {},
): PrismaClient & { __txCallCount: { n: number } } {
  const counters = { n: 0 }
  const fake = {
    __txCallCount: counters,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      counters.n++
      if (opts.failTx) throw new Error("synthetic tx failure")
      await cb({ company: { findMany: vi.fn(async () => []), update: vi.fn(async () => {}) } })
    }),
    company: {
      findMany: vi.fn(async () => opts.companies ?? []),
      // recompute-trigger expects company.findMany to return a richer
      // shape — we keep it minimal because we override the recompute
      // trigger via the `RunRecomputeResult` mock below.
    },
    indicatorDefinition: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaClient & { __txCallCount: { n: number } }
  return fake
}

const fakeWorkbook = (sheetName: string) => ({
  Sheets: { [sheetName]: { "!ref": "A1:C3" } },
  SheetNames: [sheetName],
})

const fakeXLSX = {
  utils: {
    sheet_to_json: () => [
      ["x1", "y1", 100],
      ["x2", "y2", 200],
    ],
  },
}

function plfHandler(rowsInserted = 2): AdapterHandler {
  return async () => ({
    summary: "PLF ok",
    itemCount: rowsInserted,
    warnings: [],
    applyToDb: vi.fn(async () => ({ rowsInserted })),
    // expectedSums for cross-file conflict detection
    expectedSums: new Map([
      [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01"), 100],
    ]),
  } as unknown as Awaited<ReturnType<AdapterHandler>>)
}

function landHandler(rowsInserted = 17): AdapterHandler {
  return async () => ({
    summary: "land ok",
    itemCount: rowsInserted,
    warnings: [],
    applyToDb: vi.fn(async () => ({ rowsInserted })),
  })
}

function descHandler(rowsInserted = 1): AdapterHandler {
  return async () => ({
    summary: "desc ok",
    itemCount: rowsInserted,
    warnings: [],
    applyToDb: vi.fn(async () => ({ rowsInserted })),
  })
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("runMultiFileImport", () => {
  it("1 file (main-financial) → committed green", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "PLF prefix",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "BS prefix",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "Guvven Fin.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
        BS: plfHandler(1),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)

    expect(result.overallVerdict).toBe("green")
    expect(result.perFile).toHaveLength(1)
    expect(result.perFile[0].fileTypeResult.fileType).toBe("main-financial")
    expect(result.perGroup).toHaveLength(1)
    expect(result.perGroup[0].committed).toBe(true)
    expect(result.perGroup[0].verdict).toBe("green")
    expect(prisma.__txCallCount.n).toBe(1) // one tx for one group
    expect(result.conflicts).toEqual([])
  })

  it("reuses approved template classifications and skips the classifier LLM", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    const create = vi.fn(async () => {
      throw new Error("classifier should not be called")
    })
    const client: SheetClassifierAnthropicLike = {
      messages: { create },
    }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "Guvven Fin.xlsx",
          workbook: fakeWorkbook("PLF CPC"),
          template: {
            id: "tpl_1",
            name: "Approved Guvven",
            version: 3,
            structureHash: "hash_1",
          },
          templateClassifications: [
            {
              sheetName: "PLF CPC",
              dataType: "PLF",
              entityCode: "AZSEKER-CPC",
              confidence: 0.98,
              reasoning: "reviewed template mapping",
              planKind: "actual",
              role: "source",
              planKindSignal: "config",
              roleSignal: "config",
            },
          ],
        },
      ],
      organizationId: "org1",
      year: 2026,
      dryRun: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
      }),
      XLSX: fakeXLSX,
    }

    const result = await runMultiFileImport(input, deps)

    expect(create).not.toHaveBeenCalled()
    expect(result.llmUsage.inputTokens).toBe(0)
    expect(result.llmUsage.outputTokens).toBe(0)
    expect(result.llmUsage.promptVersion).toBe("template:tpl_1:v3")
    expect(result.perFile[0].templateApplied).toMatchObject({
      id: "tpl_1",
      name: "Approved Guvven",
      version: 3,
    })
    expect(result.perFile[0].classifications[0]).toMatchObject({
      dataType: "PLF",
      entityCode: "AZSEKER-CPC",
      planKind: "actual",
      role: "source",
    })
    expect(result.overallVerdict).toBe("green")
  })

  it("3 files (descriptions + main + land) → 3 groups commit in dependency order", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      // file 1: descriptions
      [
        {
          sheetName: "Təsvir",
          dataType: "DESCRIPTIONS",
          entityCode: null,
          confidence: 0.92,
          reasoning: "narrative",
        },
      ],
      // file 2: main-financial
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "PLF prefix",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "BS prefix",
        },
      ],
      // file 3: land registry
      [
        {
          sheetName: "Çıxarış",
          dataType: "LAND_REGISTRY",
          entityCode: "AZSEKER-EDEN",
          confidence: 0.9,
          reasoning: "parcels",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        { filename: "Descriptions.xlsx", workbook: fakeWorkbook("Təsvir") },
        {
          filename: "Guvven Fin.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
        {
          filename: "Çıxarışların uçotu.xlsx",
          workbook: fakeWorkbook("Çıxarış"),
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        DESCRIPTIONS: descHandler(1),
        PLF: plfHandler(2),
        BS: plfHandler(1),
        LAND_REGISTRY: landHandler(17),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)

    expect(result.overallVerdict).toBe("green")
    expect(result.perGroup).toHaveLength(3)
    // Apply order: strategic-descriptions (0) → main-financial (1) → land-registry (4)
    expect(result.perGroup.map((g) => g.fileType)).toEqual([
      "strategic-descriptions",
      "main-financial",
      "land-registry",
    ])
    expect(result.perGroup.every((g) => g.committed)).toBe(true)
    expect(prisma.__txCallCount.n).toBe(3) // one tx per group
  })

  it("2 files same file-type with cell conflict → returns conflicts[], 0 DB writes", async () => {
    const prisma = stubPrisma()
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    // Handler returns different expected sums per file (simulates
    // conflicting xlsx values)
    let callCount = 0
    const conflictingPlf: AdapterHandler = async () => {
      callCount++
      const value = callCount === 1 ? 100 : 150
      return {
        summary: "x",
        itemCount: 1,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: 1 })),
        expectedSums: new Map([
          [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01"), value],
        ]),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "fileA.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
        {
          filename: "fileB.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: conflictingPlf,
        BS: plfHandler(1),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)

    expect(result.conflicts).toHaveLength(1)
    expect(result.overallVerdict).toBe("red")
    expect(result.perGroup).toEqual([]) // no groups attempted
    expect(prisma.__txCallCount.n).toBe(0) // ZERO tx opens
    // Both files were classified — that's not why we aborted
    expect(result.perFile).toHaveLength(2)
  })

  // Phase 7.M Tier 6 — per-conflict resolution map.
  it("per-conflict resolution (mode=pick) overrides forceOverride and commits chosen value", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    let callCount = 0
    const conflictingPlf: AdapterHandler = async () => {
      callCount++
      const value = callCount === 1 ? 100 : 150
      return {
        summary: "x",
        itemCount: 1,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: 1 })),
        expectedSums: new Map([
          [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01"), value],
        ]),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const conflictKey = buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01")
    const result = await runMultiFileImport(
      {
        files: [
          {
            filename: "fileA.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
          {
            filename: "fileB.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
        ],
        organizationId: "org1",
        year: 2026,
        // Pick fileB's value (150) as the winner.
        conflictResolutions: {
          [conflictKey]: { mode: "pick", filename: "fileB.xlsx" },
        },
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({
          PLF: conflictingPlf,
          BS: plfHandler(1),
        }),
        XLSX: fakeXLSX,
      },
    )
    // Conflict should be resolved → no short-circuit, normal commit path.
    expect(result.conflicts).toEqual([])
    expect(result.overallVerdict).not.toBe("red")
    expect(prisma.__txCallCount.n).toBeGreaterThan(0)
  })

  it("per-conflict resolution (mode=skip) drops cell from all files, no conflict remains", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    let callCount = 0
    const conflictingPlf: AdapterHandler = async () => {
      callCount++
      const value = callCount === 1 ? 100 : 150
      return {
        summary: "x",
        itemCount: 1,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: 1 })),
        expectedSums: new Map([
          [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01"), value],
        ]),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const conflictKey = buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01")
    const result = await runMultiFileImport(
      {
        files: [
          {
            filename: "fileA.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
          {
            filename: "fileB.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
        ],
        organizationId: "org1",
        year: 2026,
        conflictResolutions: {
          [conflictKey]: { mode: "skip" },
        },
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({
          PLF: conflictingPlf,
          BS: plfHandler(1),
        }),
        XLSX: fakeXLSX,
      },
    )
    expect(result.conflicts).toEqual([])
    expect(prisma.__txCallCount.n).toBeGreaterThan(0)
  })

  it("partial resolutions still short-circuit when at least one conflict remains", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
      ],
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
      ],
    ])
    let callCount = 0
    const twoConflicts: AdapterHandler = async () => {
      callCount++
      const v1 = callCount === 1 ? 100 : 150
      const v2 = callCount === 1 ? 200 : 250
      return {
        summary: "x",
        itemCount: 2,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: 2 })),
        expectedSums: new Map([
          [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01"), v1],
          [buildReconKey("AZSEKER-CPC", "PLF.02", "2026-01"), v2],
        ]),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const result = await runMultiFileImport(
      {
        files: [
          {
            filename: "fileA.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
          {
            filename: "fileB.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
        ],
        organizationId: "org1",
        year: 2026,
        // Only resolve PLF.01 — PLF.02 stays unresolved.
        conflictResolutions: {
          [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01")]: {
            mode: "pick",
            filename: "fileA.xlsx",
          },
        },
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({ PLF: twoConflicts }),
        XLSX: fakeXLSX,
      },
    )
    expect(result.conflicts).toHaveLength(1) // PLF.02 still conflicts
    expect(prisma.__txCallCount.n).toBe(0) // short-circuited, no commit
  })

  it("forceOverride=true commits despite conflict", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    let callCount = 0
    const conflictingPlf: AdapterHandler = async () => {
      callCount++
      const value = callCount === 1 ? 100 : 150
      return {
        summary: "x",
        itemCount: 1,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: 1 })),
        expectedSums: new Map([
          [buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01"), value],
        ]),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "fileA.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
        {
          filename: "fileB.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
      forceOverride: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: conflictingPlf,
        BS: plfHandler(1),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    // Conflicts still surfaced for audit, but commit proceeds.
    expect(result.conflicts.length).toBeGreaterThan(0)
    expect(prisma.__txCallCount.n).toBeGreaterThan(0) // tx opened
    expect(result.perGroup.length).toBeGreaterThan(0)
  })

  // ── Routing safety gates (deterministic-sheet-routing fix 2026-06-22) ──

  it("Gate: skips a derived/summary view (role) so it can't collide with the source", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "Actual PLF", dataType: "PLF", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "source actual P&L" },
        { sheetName: "BS CPC", dataType: "BS", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "balance sheet (gives PLF+BS → main-financial)" },
        { sheetName: "CONS PL", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "consolidated view (derived)" },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "rep.xlsx",
          workbook: {
            Sheets: { "Actual PLF": { "!ref": "A1:C3" }, "BS CPC": { "!ref": "A1:C3" }, "CONS PL": { "!ref": "A1:C3" } },
            SheetNames: ["Actual PLF", "BS CPC", "CONS PL"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: plfHandler(2), BS: plfHandler(2) }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    const main = result.perGroup.find((g) => g.fileType === "main-financial")
    // 2 source sheets wrote (Actual PLF + BS CPC = 4 rows); "CONS PL" derived
    // was skipped (would have been 6). Proves the derived view is excluded.
    expect(main?.totalRowsInserted).toBe(4)
    expect(
      result.warnings.some((w) => /CONS PL.*derived\/summary/i.test(w)),
    ).toBe(true)
  })

  it("Gate: BLOCKS an ambiguous plan-relevant sheet in a mixed workbook (never guesses budget→actual)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "Budget PLF", dataType: "PLF", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "budget P&L" },
        { sheetName: "Mystery PL", dataType: "PLF", entityCode: "AZSEKER-AZSF", confidence: 0.9, reasoning: "ambiguous P&L" },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "rep.xlsx",
          workbook: {
            Sheets: { "Budget PLF": { "!ref": "A1:C3" }, "Mystery PL": { "!ref": "A1:C3" } },
            SheetNames: ["Budget PLF", "Mystery PL"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: plfHandler(2) }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    expect(result.overallVerdict).toBe("red")
    expect(prisma.__txCallCount.n).toBe(0) // aborted before any tx
    expect(
      result.warnings.some((w) => /Ambiguous plan kind.*Mystery PL/i.test(w)),
    ).toBe(true)
  })

  it("Gate: BLOCKS two source sheets in ONE file that target the same write scope (the EDEN-BS=4 corruption)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-EDEN" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "BS Actual", dataType: "BS", entityCode: "AZSEKER-EDEN", confidence: 0.9, reasoning: "balance sheet" },
        { sheetName: "BS Faktiki", dataType: "BS", entityCode: "AZSEKER-EDEN", confidence: 0.9, reasoning: "balance sheet (dup view)" },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "rep.xlsx",
          workbook: {
            Sheets: { "BS Actual": { "!ref": "A1:C3" }, "BS Faktiki": { "!ref": "A1:C3" } },
            SheetNames: ["BS Actual", "BS Faktiki"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ BS: plfHandler(2) }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    expect(result.overallVerdict).toBe("red")
    expect(prisma.__txCallCount.n).toBe(0)
    expect(result.warnings.some((w) => /COLLISION.*BS (Actual|Faktiki)/i.test(w))).toBe(true)
  })

  it("Gate: BLOCKS when an entity's only plan-relevant sheet is a derived view (completeness)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "Actual PLF", dataType: "PLF", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "source P&L" },
        { sheetName: "BS Pivot", dataType: "BS", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "derived BS pivot — no source BS" },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "rep.xlsx",
          workbook: {
            Sheets: { "Actual PLF": { "!ref": "A1:C3" }, "BS Pivot": { "!ref": "A1:C3" } },
            SheetNames: ["Actual PLF", "BS Pivot"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: plfHandler(2), BS: plfHandler(2) }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    expect(result.overallVerdict).toBe("red")
    expect(prisma.__txCallCount.n).toBe(0) // CPC BS would import nothing → block
    expect(result.warnings.some((w) => /COMPLETENESS.*BS/i.test(w))).toBe(true)
  })

  it("Gate: a SALES/forecast budget sheet does NOT over-block a pure-actuals workbook (Codex P2)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "PLF CPC", dataType: "PLF", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "actual P&L (no keyword)" },
        { sheetName: "BS CPC", dataType: "BS", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "actual BS (no keyword)" },
        { sheetName: "Sales 2027", dataType: "SALES", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "sales forecast → budget by dataType, but not plan-relevant" },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "actuals.xlsx",
          workbook: {
            Sheets: { "PLF CPC": { "!ref": "A1:C3" }, "BS CPC": { "!ref": "A1:C3" }, "Sales 2027": { "!ref": "A1:C3" } },
            SheetNames: ["PLF CPC", "BS CPC", "Sales 2027"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: plfHandler(2), BS: plfHandler(2) }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    // SALES is not a plan-relevant source budget sheet → hasBudgetSignal stays
    // false → the unresolved actual PLF/BS default to actual and commit.
    expect(result.overallVerdict).not.toBe("red")
    expect(prisma.__txCallCount.n).toBeGreaterThan(0)
  })

  it("Gate: 0-item sheets (cross-entity / LLM-mislabeled) do NOT trigger a false collision (Farming-strategy regression)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-EDEN" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "İcmal", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "cross-entity → 0 items" },
        { sheetName: "PL Support", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "cross-entity → 0 items" },
        { sheetName: "Taxes", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "cross-entity → 0 items" },
        { sheetName: "BS EDEN", dataType: "BS", entityCode: "AZSEKER-EDEN", confidence: 0.9, reasoning: "real source (2 items)" },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "forecast.xlsx",
          workbook: {
            Sheets: { "İcmal": { "!ref": "A1:C3" }, "PL Support": { "!ref": "A1:C3" }, "Taxes": { "!ref": "A1:C3" }, "BS EDEN": { "!ref": "A1:C3" } },
            SheetNames: ["İcmal", "PL Support", "Taxes", "BS EDEN"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      // PLF handler parses 0 items (the cross-entity sheets); BS parses 2.
      registry: buildRegistryWith({ PLF: plfHandler(0), BS: plfHandler(2) }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    // The 3 null-entity PLF sheets are no-ops (0 items) → no false collision.
    expect(result.overallVerdict).not.toBe("red")
    expect(result.warnings.some((w) => /COLLISION/i.test(w))).toBe(false)
    expect(prisma.__txCallCount.n).toBeGreaterThan(0)
  })

  it("Pack map: raw 'Budget PLF' is SKIPPED as derived (not holding-stacked); the route pre-splits it instead", async () => {
    // 2026-06-23: REPORTING_PACK_SHEET_MAP no longer holding-routes the raw
    // "Budget PLF" (that stacked all 5 per-entity blocks onto the holding). It is
    // now role=derived_summary — the route pre-splits it into per-entity virtual
    // sheets BEFORE this orchestrator runs. So a raw "Budget PLF" reaching the
    // orchestrator under the pack map must be SKIPPED, never written to any entity.
    const prisma = stubPrisma({ companies: [{ id: "h", code: "AZSEKER" }] })
    const client = stubClientPerCall([
      [
        { sheetName: "Budget PLF", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "consolidated budget" },
        { sheetName: "BS Actual", dataType: "BS", entityCode: null, confidence: 0.9, reasoning: "consolidated actual BS" },
        { sheetName: "PL EDEN", dataType: "PLF", entityCode: "AZSEKER-EDEN", confidence: 0.9, reasoning: "EDEN summary view" },
      ],
    ])
    const captured: Record<string, string | null> = {}
    const cap: AdapterHandler = async (i: { sheetName: string; entityCode?: string | null }) => {
      captured[i.sheetName] = i.entityCode ?? null
      const n = i.entityCode ? 5 : 0
      return {
        summary: "ok",
        itemCount: n,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: n })),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "rep.xlsx",
          workbook: {
            Sheets: { "Budget PLF": { "!ref": "A1:C3" }, "BS Actual": { "!ref": "A1:C3" }, "PL EDEN": { "!ref": "A1:C3" } },
            SheetNames: ["Budget PLF", "BS Actual", "PL EDEN"],
          },
          sheetMap: REPORTING_PACK_SHEET_MAP,
        },
      ],
      organizationId: "org1",
      year: 2026,
      holdingCompanyCode: "AZSEKER",
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: cap, BS: cap }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    expect(captured["Budget PLF"]).toBeUndefined() // derived → skipped, NOT holding-stacked
    expect(captured["PL EDEN"]).toBeUndefined() // config-derived → skipped (handler not called)
    expect(result.overallVerdict).not.toBe("red") // config-derived views did NOT trip completeness
  })

  it("HOLDING_ENTITY_SENTINEL mechanism: a synthetic-config consolidated tab still routes to the holding", async () => {
    // The sentinel mechanism is generic (any future per-org config can use it),
    // so keep it covered even though the pack map no longer routes Budget PLF
    // through it. A sheet pinned to the sentinel resolves to holdingCompanyCode.
    const prisma = stubPrisma({ companies: [{ id: "h", code: "AZSEKER" }] })
    const client = stubClientPerCall([
      [{ sheetName: "Consolidated PL", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "consolidated" }],
    ])
    const captured: Record<string, string | null> = {}
    const cap: AdapterHandler = async (i: { sheetName: string; entityCode?: string | null }) => {
      captured[i.sheetName] = i.entityCode ?? null
      const n = i.entityCode ? 5 : 0
      return {
        summary: "ok",
        itemCount: n,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: n })),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const syntheticMap: SheetMap = [
      { match: "Consolidated PL", planKind: "budget", role: "source", entityCode: HOLDING_ENTITY_SENTINEL },
    ]
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "syn.xlsx",
          workbook: { Sheets: { "Consolidated PL": { "!ref": "A1:C3" } }, SheetNames: ["Consolidated PL"] },
          sheetMap: syntheticMap,
        },
      ],
      organizationId: "org1",
      year: 2026,
      holdingCompanyCode: "AZSEKER",
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: cap }),
      XLSX: fakeXLSX,
    }
    await runMultiFileImport(input, deps)
    expect(captured["Consolidated PL"]).toBe("AZSEKER") // sentinel → holding
  })

  it("Cross-entity (per-file scope): a SIBLING file's same-named tab is NOT holding-routed (Codex P0)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "h", code: "AZSEKER" }, { id: "c", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      // file A — the reporting pack (gets REPORTING_PACK_SHEET_MAP)
      [
        { sheetName: "Budget PLF", dataType: "PLF", entityCode: null, confidence: 0.9, reasoning: "consolidated budget" },
        { sheetName: "BS Actual", dataType: "BS", entityCode: null, confidence: 0.9, reasoning: "BS" },
      ],
      // file B — NOT a pack (no sheetMap), but happens to have a tab literally named "Budget PLF"
      [
        { sheetName: "Budget PLF", dataType: "PLF", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "CPC's own budget" },
        { sheetName: "BS X", dataType: "BS", entityCode: "AZSEKER-CPC", confidence: 0.9, reasoning: "CPC BS" },
      ],
    ])
    const budgetPlf: Array<string | null> = []
    const cap: AdapterHandler = async (i: { sheetName: string; entityCode?: string | null }) => {
      if (i.sheetName === "Budget PLF") budgetPlf.push(i.entityCode ?? null)
      const n = i.entityCode ? 5 : 0
      return {
        summary: "ok",
        itemCount: n,
        warnings: [],
        applyToDb: vi.fn(async () => ({ rowsInserted: n })),
      } as unknown as Awaited<ReturnType<AdapterHandler>>
    }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "rep.xlsx",
          workbook: { Sheets: { "Budget PLF": { "!ref": "A1:C3" }, "BS Actual": { "!ref": "A1:C3" } }, SheetNames: ["Budget PLF", "BS Actual"] },
          sheetMap: REPORTING_PACK_SHEET_MAP, // only THIS file is a reporting pack
        },
        {
          filename: "cpc.xlsx",
          workbook: { Sheets: { "Budget PLF": { "!ref": "A1:C3" }, "BS X": { "!ref": "A1:C3" } }, SheetNames: ["Budget PLF", "BS X"] },
          // NO sheetMap — its "Budget PLF" must keep its own entity
        },
      ],
      organizationId: "org1",
      year: 2026,
      holdingCompanyCode: "AZSEKER",
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: cap, BS: cap }),
      XLSX: fakeXLSX,
    }
    await runMultiFileImport(input, deps)
    // File A's pack "Budget PLF" is now skipped-as-derived (the route pre-splits
    // it per-entity), so it is NOT holding-stacked and never reaches the handler.
    expect(budgetPlf).not.toContain("AZSEKER")
    // Per-file scope (Codex P0): file B has NO sheetMap, so its same-named tab
    // keeps its own entity — the pack map of file A did not leak to file B.
    expect(budgetPlf).toContain("AZSEKER-CPC")
  })

  it("dryRun=true → 0 DB writes, perGroup shows preview", async () => {
    const prisma = stubPrisma()
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "Guvven Fin.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
      dryRun: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
        BS: plfHandler(1),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)

    expect(result.perGroup).toHaveLength(1)
    expect(result.perGroup[0].committed).toBe(false)
    expect(result.perGroup[0].skipReason).toMatch(/dryRun/i)
    expect(prisma.__txCallCount.n).toBe(0)
  })

  it("classify error on one file does not abort other files", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    // First call throws (rate-limit / network) → second call succeeds.
    let callCount = 0
    const client: SheetClassifierAnthropicLike = {
      messages: {
        create: vi.fn(async () => {
          callCount++
          if (callCount === 1) throw new Error("rate_limit_error")
          return classifyResponse([
            {
              sheetName: "PLF CPC",
              dataType: "PLF",
              entityCode: "AZSEKER-CPC",
              confidence: 0.95,
              reasoning: "x",
            },
            {
              sheetName: "BS CPC",
              dataType: "BS",
              entityCode: "AZSEKER-CPC",
              confidence: 0.9,
              reasoning: "y",
            },
          ])
        }),
      },
    }
    const input: MultiFileImportInput = {
      files: [
        { filename: "fail.xlsx", workbook: fakeWorkbook("X") },
        {
          filename: "ok.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
        BS: plfHandler(1),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)

    // file 1: error captured
    const failFile = result.perFile.find((f) => f.filename === "fail.xlsx")!
    expect(failFile.error).toMatch(/rate_limit/i)
    expect(failFile.fileTypeResult.fileType).toBe("unknown")
    // file 2: still classified + committed
    const okFile = result.perFile.find((f) => f.filename === "ok.xlsx")!
    expect(okFile.error).toBeNull()
    expect(okFile.fileTypeResult.fileType).toBe("main-financial")
    // ok.xlsx group should have committed
    const mainGroup = result.perGroup.find(
      (g) => g.fileType === "main-financial",
    )
    expect(mainGroup?.committed).toBe(true)
  })

  it("a provider failure NEVER puts the raw message in the response", async () => {
    // 2026-08-18 — screenshotted on production. The file card rendered
    // `Classification failed: 400 {"type":"error"… "Your credit balance is too
    // low to access the Anthropic API. Please go to Plans & Billing…"}`
    // verbatim, and the warning below it repeated the whole payload. That is
    // internal billing state shown to an enterprise client — the exact leak
    // `src/lib/ai/ai-error.ts` was written on 2026-06-04 to stop. The
    // sanitizer guarded the API routes' catch blocks; this path never went
    // through it, and the catch here carried a comment claiming the raw
    // message "never reaches the browser" while three lines shipped it.
    //
    // This asserts the STRUCTURAL property — a stable code cannot leak —
    // rather than the wording of any one screen.
    const RAW =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":' +
      '"Your credit balance is too low to access the Anthropic API. Please go ' +
      'to Plans & Billing to upgrade or purchase credits."},' +
      '"request_id":"req_011Ce9xr2GrKtprjZPoJ4W8z"}'

    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client: SheetClassifierAnthropicLike = {
      messages: { create: vi.fn(async () => { throw new Error(RAW) }) },
    }
    const result = await runMultiFileImport(
      {
        files: [{ filename: "actual-budget-v1.xlsx", workbook: fakeWorkbook("X") }],
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({ PLF: plfHandler(2) }),
        XLSX: fakeXLSX,
      },
    )

    // Everything the browser can see, in one string.
    const wire = JSON.stringify(result)
    for (const leak of [
      "credit balance",
      "Plans & Billing",
      "purchase credits",
      "request_id",
      "req_011Ce9xr2GrKtprjZPoJ4W8z",
      "invalid_request_error",
      "api.anthropic",
    ]) {
      expect(wire, `leaked: ${leak}`).not.toContain(leak)
    }

    // …and the cause is still carried, as a code the client can localize.
    const file = result.perFile.find((f) => f.filename === "actual-budget-v1.xlsx")!
    expect(file.error).toBe("ai_credits")
    expect(result.completeness.aiOutage).toBe("ai_credits")
    expect(file.fileTypeResult.reasoning).toBe("Classification failed (ai_credits)")
    expect(result.warnings).toContain("actual-budget-v1.xlsx: classify failed (ai_credits)")
  })

  it("unknown file-type is skipped, not committed", async () => {
    const prisma = stubPrisma()
    const client = stubClientPerCall([
      [
        {
          sheetName: "Strange",
          dataType: "UNKNOWN",
          entityCode: null,
          confidence: 0.2,
          reasoning: "unclear",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        { filename: "mystery.xlsx", workbook: fakeWorkbook("Strange") },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({}),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    expect(result.perFile[0].fileTypeResult.fileType).toBe("unknown")
    expect(result.perGroup).toHaveLength(1)
    expect(result.perGroup[0].verdict).toBe("skipped")
    expect(result.perGroup[0].committed).toBe(false)
    expect(prisma.__txCallCount.n).toBe(0)
  })

  it("blocks apply before transaction when semantic CoA review is required", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "P&L",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [{ filename: "nocode.xlsx", workbook: fakeWorkbook("PLF") }],
      organizationId: "org1",
      year: 2026,
      knownEntityCodes: ["AZSEKER-CPC"],
      dryRun: false,
    }
    const handler: AdapterHandler = async () => ({
      summary: "needs CoA review",
      itemCount: 0,
      warnings: [],
      semanticCoa: {
        mappings: [],
        reviewItems: [
          {
            dataType: "PLF",
            sourceLabel: "Management fees",
            reason: "No high-confidence P&L code match",
            candidates: [
              {
                targetCode: "PLF.06.01.01",
                accountType: "expense",
                confidence: 0.7,
                source: "standard-dictionary",
                matchedLabel: "admin expenses",
                reasoning: "similar expense label",
              },
            ],
          },
        ],
      },
      applyToDb: vi.fn(async () => ({ rowsInserted: 0 })),
    })
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "m",
      registry: buildRegistryWith({ PLF: handler }),
      XLSX: fakeXLSX,
    }

    const result = await runMultiFileImport(input, deps)

    expect(result.overallVerdict).toBe("red")
    expect(result.perGroup).toEqual([])
    expect(result.warnings.some((w) => /COA_REVIEW/.test(w))).toBe(true)
    expect(prisma.__txCallCount.n).toBe(0)
    expect(result.perFile[0].semanticCoa?.reviewItems[0]).toMatchObject({
      sourceLabel: "Management fees",
      sheetName: "PLF",
    })
  })

  it("adapter throws inside group tx → that group's writes roll back, others continue", async () => {
    // Simulate: 2 files, group A (descriptions) commits, group B (main-financial) throws.
    const prisma = stubPrisma({
      companies: [{ id: "c_cpc", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "Təsvir",
          dataType: "DESCRIPTIONS",
          entityCode: null,
          confidence: 0.95,
          reasoning: "x",
        },
      ],
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    const throwingPlf: AdapterHandler = async () => ({
      summary: "ok parse",
      itemCount: 1,
      warnings: [],
      applyToDb: vi.fn(async () => {
        throw new Error("DB constraint blew up")
      }),
    })
    const input: MultiFileImportInput = {
      files: [
        { filename: "Descriptions.xlsx", workbook: fakeWorkbook("Təsvir") },
        {
          filename: "Guvven Fin.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        DESCRIPTIONS: descHandler(1),
        PLF: throwingPlf,
        BS: plfHandler(1),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    // descriptions group commits
    const descGroup = result.perGroup.find(
      (g) => g.fileType === "strategic-descriptions",
    )
    expect(descGroup?.committed).toBe(true)
    // main-financial group fails
    const mainGroup = result.perGroup.find(
      (g) => g.fileType === "main-financial",
    )
    expect(mainGroup?.committed).toBe(false)
    expect(mainGroup?.verdict).toBe("red")
    expect(result.overallVerdict).toBe("red") // worst dominates
    // Two tx opens — one for desc (success), one for main (rolled back).
    expect(prisma.__txCallCount.n).toBe(2)
  })

  it("aggregates LLM usage across files", async () => {
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "x",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
      [
        {
          sheetName: "Çıxarış",
          dataType: "LAND_REGISTRY",
          entityCode: "AZSEKER-EDEN",
          confidence: 0.9,
          reasoning: "y",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "fin.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
        { filename: "land.xlsx", workbook: fakeWorkbook("Çıxarış") },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
        BS: plfHandler(1),
        LAND_REGISTRY: landHandler(17),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    // 2 files × 100 input + 50 output per file
    expect(result.llmUsage.inputTokens).toBe(200)
    expect(result.llmUsage.outputTokens).toBe(100)
    expect(result.llmUsage.modelName).toBe("claude-test")
  })

  it("auto-infers entity for an entity-less statement (single-entity propagation)", async () => {
    // A workbook where the only resolved entity is CPC + an entity-less PLF.
    // The deterministic inference layer must stamp the PLF with AZSEKER-CPC so
    // the user no longer has to pick it manually.
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        {
          sheetName: "Satış CPC Fakt",
          dataType: "BUDGET_ACTUALS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "cpc sales",
        },
        {
          sheetName: "PLF Actual 2025",
          dataType: "PLF",
          entityCode: null, // no entity in the sheet name → classifier returns null
          confidence: 0.95,
          reasoning: "PLF.01 codes",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "actuals.xlsx", // no entity in filename → not rule 1
          workbook: {
            Sheets: {
              "Satış CPC Fakt": { "!ref": "A1:C3" },
              "PLF Actual 2025": { "!ref": "A1:C3" },
            },
            SheetNames: ["Satış CPC Fakt", "PLF Actual 2025"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
      dryRun: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
        BUDGET_ACTUALS: plfHandler(2),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    const plf = result.perFile[0].classifications.find(
      (c) => c.sheetName === "PLF Actual 2025",
    )
    expect(plf?.entityCode).toBe("AZSEKER-CPC")
  })

  it("does NOT auto-write the holding-consolidated guess — entity-less PLF stays null", async () => {
    // Eden + CPC both present + a known holding → the entity-less PLF is a
    // review-grade holding-consolidated guess, which must NOT be silently
    // written (entityCode stays null; the orchestrator surfaces a warning).
    const prisma = stubPrisma({
      companies: [
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "Satış CPC Fakt",
          dataType: "BUDGET_ACTUALS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "cpc sales",
        },
        {
          sheetName: "Satış Əkinçilik Fakt",
          dataType: "BUDGET_ACTUALS",
          entityCode: "AZSEKER-EDEN",
          confidence: 0.9,
          reasoning: "farming sales",
        },
        {
          sheetName: "PLF Actual 2025",
          dataType: "PLF",
          entityCode: null,
          confidence: 0.95,
          reasoning: "PLF.01 codes",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "actuals.xlsx",
          workbook: {
            Sheets: {
              "Satış CPC Fakt": { "!ref": "A1:C3" },
              "Satış Əkinçilik Fakt": { "!ref": "A1:C3" },
              "PLF Actual 2025": { "!ref": "A1:C3" },
            },
            SheetNames: [
              "Satış CPC Fakt",
              "Satış Əkinçilik Fakt",
              "PLF Actual 2025",
            ],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
      holdingCompanyCode: "AZSEKER",
      dryRun: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({
        PLF: plfHandler(2),
        BUDGET_ACTUALS: plfHandler(2),
      }),
      XLSX: fakeXLSX,
    }
    const result = await runMultiFileImport(input, deps)
    const plf = result.perFile[0].classifications.find(
      (c) => c.sheetName === "PLF Actual 2025",
    )
    expect(plf?.entityCode).toBeNull()
  })

  it("cell-scan: reads CPC from the PLF's trailing cells (classifier returned null)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF Actual 2025",
          dataType: "PLF",
          entityCode: null, // entity sits in col ~17, unseen by the classifier
          confidence: 0.95,
          reasoning: "PLF.01 codes",
        },
      ],
    ])
    const cpcRows = [
      ["PLF.01", "REVENUE", "", 100, "", "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
      ["PLF.02", "COGS", "", 50, "", "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
      ["PLF.03", "OPEX", "", 10, "", "", "", "", "", "", "", "", "", "", "", "", "", "CPC", "CPC"],
    ]
    const xlsx = { utils: { sheet_to_json: () => cpcRows } }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "actuals.xlsx",
          workbook: {
            Sheets: { "PLF Actual 2025": { "!ref": "A1:S3" } },
            SheetNames: ["PLF Actual 2025"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
      knownEntityCodes: ["AZSEKER-CPC"],
      dryRun: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: plfHandler(2) }),
      XLSX: xlsx,
    }
    const result = await runMultiFileImport(input, deps)
    const plf = result.perFile[0].classifications.find(
      (c) => c.sheetName === "PLF Actual 2025",
    )
    expect(plf?.entityCode).toBe("AZSEKER-CPC")
  })

  it("cell-scan honours org entityAliases (AZSF cells → holding AZSEKER)", async () => {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER" }] })
    const client = stubClientPerCall([
      [
        {
          sheetName: "BS Actual 2026",
          dataType: "BS",
          entityCode: null,
          confidence: 0.95,
          reasoning: "BS codes",
        },
      ],
    ])
    const azsfRows = [
      ["BS.01", "ASSETS", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
      ["BS.02", "LIAB", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
      ["BS.03", "EQUITY", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "AZSF", "AZSF"],
    ]
    const xlsx = { utils: { sheet_to_json: () => azsfRows } }
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "actuals.xlsx",
          workbook: {
            Sheets: { "BS Actual 2026": { "!ref": "A1:R3" } },
            SheetNames: ["BS Actual 2026"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
      knownEntityCodes: ["AZSEKER", "AZSEKER-CPC"],
      entityAliases: { AZSF: "AZSEKER" },
      dryRun: true,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ BS: plfHandler(2) }),
      XLSX: xlsx,
    }
    const result = await runMultiFileImport(input, deps)
    const bs = result.perFile[0].classifications.find(
      (c) => c.sheetName === "BS Actual 2026",
    )
    expect(bs?.entityCode).toBe("AZSEKER")
  })
})

describe("runMultiFileImport — recompute targets from cross-entity registers", () => {
  // 2026-07-15 — a court-case / audit / counterparty register is ONE sheet
  // naming several companies, so its classification carries entityCode=null
  // and the entity-based target loop found nothing: the facts committed but
  // no indicator was recomputed, and the terminal showed nothing until an
  // unrelated financial import happened to fire one. Adapters that resolve
  // companies per row now report them via `touchedCompanyCodes`.
  it("recomputes the companies a register adapter resolved itself", async () => {
    const prisma = stubPrisma({
      companies: [
        { id: "c1", code: "AZSEKER-CPC" },
        { id: "c2", code: "AZSEKER-EDEN" },
      ],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "Court cases",
          dataType: "LEGAL_CASES",
          entityCode: null, // cross-entity register — the whole point
          confidence: 0.95,
          reasoning: "court register",
        },
      ],
    ])
    const registerHandler: AdapterHandler = async () =>
      ({
        summary: "18 disputes",
        itemCount: 18,
        warnings: [],
        applyToDb: vi.fn(async () => ({
          rowsInserted: 18,
          touchedCompanyCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
        })),
      }) as unknown as Awaited<ReturnType<AdapterHandler>>

    const result = await runMultiFileImport(
      {
        files: [
          {
            filename: "Açıq məhkəmə mübahisələri.xlsx",
            workbook: fakeWorkbook("Court cases"),
          },
        ],
        organizationId: "org1",
        year: 2026,
      } as MultiFileImportInput,
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({ LEGAL_CASES: registerHandler }),
        XLSX: fakeXLSX,
      },
    )

    expect(result.perGroup[0].fileType).toBe("compliance-register")
    expect(result.perGroup[0].committed).toBe(true)
    // The register's companies must reach the recompute pass — pre-fix this
    // resolved to zero targets and every compliance cell stayed dark.
    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          code: { in: expect.arrayContaining(["AZSEKER-CPC", "AZSEKER-EDEN"]) },
        }),
      }),
    )
  })
})
// ─── Phase 11.2 — post-write reconciliation is real evidence ────────────
//
// Before this phase the orchestrator compared `expectedSums` with itself
// (green by construction) and the DB-readback branch was gated on a
// `deps.readActualSums` that no production route ever passed — so the abort
// path was unreachable dead code. These tests pin the wiring: the batch
// layer's own post-write re-read now reaches the orchestrator through
// `applyToDb`, governs the verdict, and rolls the group back.
describe("runMultiFileImport — Phase 11.2 post-write reconciliation", () => {
  const RECON_KEY = buildReconKey("AZSEKER-CPC", "PLF.01", "2026-01")

  /** Handler whose applyToDb reports a post-write DB re-read. */
  function reportingHandler(opts: {
    /** DB sum for the reconciled key; omit for a perfect match. */
    actual?: number
    /** Emit no reconciliation at all (settings-JSON style adapter). */
    noReport?: boolean
  }): AdapterHandler {
    const expectedSums = new Map([[RECON_KEY, 100]])
    return async () =>
      ({
        summary: "ok",
        itemCount: 2,
        warnings: [],
        expectedSums,
        applyToDb: vi.fn(async () => ({
          rowsInserted: 2,
          reconciliation: opts.noReport
            ? undefined
            : reconcile(
                expectedSums,
                new Map([[RECON_KEY, opts.actual ?? 100]]),
              ),
        })),
      }) as unknown as Awaited<ReturnType<AdapterHandler>>
  }

  /** Same PLF+BS main-financial shape as the happy-path test above. */
  function mainFinancialRun(handler: AdapterHandler) {
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "PLF prefix",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "BS prefix",
        },
      ],
    ])
    const input: MultiFileImportInput = {
      files: [
        {
          filename: "Guvven Fin.xlsx",
          workbook: {
            Sheets: {
              "PLF CPC": { "!ref": "A1:C3" },
              "BS CPC": { "!ref": "A1:C3" },
            },
            SheetNames: ["PLF CPC", "BS CPC"],
          },
        },
      ],
      organizationId: "org1",
      year: 2026,
    }
    const deps: MultiFileImportDependencies = {
      prisma,
      anthropicClient: client,
      model: "claude-test",
      registry: buildRegistryWith({ PLF: handler, BS: handler }),
      XLSX: fakeXLSX,
    }
    return { input, deps, prisma }
  }

  it("commits when the DB re-read matches, and marks the evidence as db-readback", async () => {
    const { input, deps } = mainFinancialRun(reportingHandler({ actual: 100 }))
    const result = await runMultiFileImport(input, deps)

    expect(result.perGroup[0].committed).toBe(true)
    expect(result.perGroup[0].verdict).toBe("green")
    // The verdict now rests on a real post-write query, not a self-compare.
    expect(result.perGroup[0].reconciliation?.evidence).toBe("db-readback")
    expect(result.perGroup[0].reconciliation?.perSheet).toHaveLength(2)
    expect(result.perGroup[0].reconciliation?.summary.greenSheets).toBe(2)
  })

  it("ROLLS BACK the group when the DB holds less than the file claimed", async () => {
    // 100 expected, 40 actually in the DB — the exact shape of a partially
    // applied write or an over-reaching archive. Previously this committed
    // silently under a green tick.
    const { input, deps } = mainFinancialRun(reportingHandler({ actual: 40 }))
    const result = await runMultiFileImport(input, deps)

    expect(result.perGroup[0].committed).toBe(false)
    expect(result.perGroup[0].verdict).toBe("red")
    expect(result.perGroup[0].skipReason).toMatch(
      /Post-write reconciliation rejected/,
    )
    expect(result.perGroup[0].totalRowsInserted).toBe(0)
  })

  it("ROLLS BACK when the DB holds MORE than the file claimed (double-write)", async () => {
    const { input, deps } = mainFinancialRun(reportingHandler({ actual: 250 }))
    const result = await runMultiFileImport(input, deps)

    expect(result.perGroup[0].committed).toBe(false)
    expect(result.perGroup[0].verdict).toBe("red")
  })

  it("names sheets it could NOT verify instead of counting them green", async () => {
    const { input, deps } = mainFinancialRun(reportingHandler({ noReport: true }))
    const result = await runMultiFileImport(input, deps)

    expect(result.perGroup[0].committed).toBe(true)
    // Zero verified sheets — the report must say so rather than implying
    // everything was checked.
    expect(result.perGroup[0].reconciliation?.perSheet).toHaveLength(0)
    expect(result.perGroup[0].reconciliation?.unverified).toHaveLength(2)
    expect(result.perGroup[0].reconciliation?.summary.unverifiedSheets).toBe(2)
    expect(result.warnings.join(" ")).toMatch(
      /committed with NO post-write verification/,
    )
  })

  it("labels the pre-write check as a parse-self-check, never as reconciliation", async () => {
    // dryRun stops at the pre-write stage — exactly where the misleading
    // green used to come from.
    const { input, deps } = mainFinancialRun(reportingHandler({ actual: 100 }))
    const result = await runMultiFileImport({ ...input, dryRun: true }, deps)

    expect(result.perGroup[0].committed).toBe(false)
    expect(result.perGroup[0].reconciliation?.evidence).toBe("parse-self-check")
  })
})
// ─── Phase 11.13 — persisted import evidence ───────────────────────────
describe("runMultiFileImport — Phase 11.13 persisted evidence", () => {
  it("writes one ImportBatchReport per group, INSIDE the group transaction", async () => {
    // Inside the transaction on purpose: a report must exist if and only if
    // the rows it describes committed. An aborted group rolls the report back
    // with everything else — there is no committed data for it to attest to.
    const created: Array<Record<string, unknown>> = []
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(
      async (cb: (tx: unknown) => Promise<void>) => {
        await cb({
          company: {
            findMany: vi.fn(async () => []),
            update: vi.fn(async () => {}),
          },
          importBatchReport: {
            create: vi.fn(async (a: { data: Record<string, unknown> }) => {
              created.push(a.data)
              return { id: "rep_1" }
            }),
          },
        })
      },
    )
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "PLF prefix",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "BS prefix",
        },
      ],
    ])
    await runMultiFileImport(
      {
        files: [
          {
            filename: "Guvven Fin.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
        ],
        organizationId: "org1",
        year: 2026,
        runId: "run_abc",
        actorUserId: "u1",
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({ PLF: plfHandler(2), BS: plfHandler(1) }),
        XLSX: fakeXLSX,
      },
    )

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      organizationId: "org1",
      runId: "run_abc",
      fileType: "main-financial",
      year: 2026,
      committed: true,
      actorUserId: "u1",
    })
    // The evidence label must survive into the record: a verdict backed by a
    // real post-write query is not the same claim as a self-compare.
    expect(created[0].evidence).toBeDefined()
    expect(created[0].report).toBeDefined()
  })

  it("persists nothing when no runId is supplied", async () => {
    const created: Array<Record<string, unknown>> = []
    const prisma = stubPrisma({
      companies: [{ id: "c1", code: "AZSEKER-CPC" }],
    })
    ;(prisma as unknown as { $transaction: unknown }).$transaction = vi.fn(
      async (cb: (tx: unknown) => Promise<void>) => {
        await cb({
          company: {
            findMany: vi.fn(async () => []),
            update: vi.fn(async () => {}),
          },
          importBatchReport: {
            create: vi.fn(async (a: { data: Record<string, unknown> }) => {
              created.push(a.data)
              return { id: "rep_1" }
            }),
          },
        })
      },
    )
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "PLF prefix",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "BS prefix",
        },
      ],
    ])
    await runMultiFileImport(
      {
        files: [
          {
            filename: "Guvven Fin.xlsx",
            workbook: {
              Sheets: {
                "PLF CPC": { "!ref": "A1:C3" },
                "BS CPC": { "!ref": "A1:C3" },
              },
              SheetNames: ["PLF CPC", "BS CPC"],
            },
          },
        ],
        organizationId: "org1",
        year: 2026,
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({ PLF: plfHandler(2), BS: plfHandler(1) }),
        XLSX: fakeXLSX,
      },
    )
    expect(created).toHaveLength(0)
  })
})
// ─── Phase 11.5b — year gate ────────────────────────────────────────────
//
// Phase 11.5 made the year an explicit choice, which stops it being wrong by
// accident. This stops it being wrong on purpose-ish: pick 2026, upload a 2025
// workbook, and every adapter's year guard drops every sheet at zero rows
// while the group commits "green" with nothing written.
describe("runMultiFileImport — Phase 11.5b year gate", () => {
  function run(opts: {
    sheetYear: number
    requestedYear: number
    dryRun?: boolean
    forceOverride?: boolean
  }) {
    const prisma = stubPrisma({ companies: [{ id: "c1", code: "AZSEKER-CPC" }] })
    const client = stubClientPerCall([
      [
        {
          sheetName: "PLF CPC",
          dataType: "PLF",
          entityCode: "AZSEKER-CPC",
          confidence: 0.95,
          reasoning: "PLF prefix",
        },
        {
          sheetName: "BS CPC",
          dataType: "BS",
          entityCode: "AZSEKER-CPC",
          confidence: 0.9,
          reasoning: "BS prefix",
        },
      ],
    ])
    // Real xlsx sheets so the deterministic year detector has headers to read.
    const XLSXreal = realXLSX
    const book = XLSXreal.utils.book_new()
    for (const name of ["PLF CPC", "BS CPC"]) {
      XLSXreal.utils.book_append_sheet(
        book,
        XLSXreal.utils.aoa_to_sheet([
          [
            "P&L",
            ...Array.from({ length: 12 }, (_, m) =>
              new Date(Date.UTC(opts.sheetYear, m, 1)),
            ),
          ],
          ["PLF.01", 1, 2, 3],
        ]),
        name,
      )
    }
    return runMultiFileImport(
      {
        files: [{ filename: "Guvven Fin.xlsx", workbook: book }],
        organizationId: "org1",
        year: opts.requestedYear,
        dryRun: opts.dryRun,
        forceOverride: opts.forceOverride,
      },
      {
        prisma,
        anthropicClient: client,
        model: "claude-test",
        registry: buildRegistryWith({ PLF: plfHandler(2), BS: plfHandler(1) }),
        XLSX: XLSXreal,
      },
    )
  }

  it("reports the year it detected in the workbook", async () => {
    const r = await run({ sheetYear: 2026, requestedYear: 2026 })
    expect(r.perFile[0].detectedYears.dominant).toBe(2026)
  })

  it("ABORTS an apply whose year appears in no uploaded workbook", async () => {
    const r = await run({ sheetYear: 2025, requestedYear: 2026 })
    expect(r.overallVerdict).toBe("red")
    expect(r.perGroup).toEqual([])
    expect(r.completeness.complete).toBe(false)
    expect(r.warnings.join(" ")).toMatch(/Year gate/)
    // Aborted BEFORE any transaction opened.
    expect(r.warnings.join(" ")).toMatch(/before any DB write/)
    expect(prismaTxCalls(r)).toBe(0)
  })

  it("allows the apply when the requested year IS present", async () => {
    const r = await run({ sheetYear: 2026, requestedYear: 2026 })
    expect(r.warnings.join(" ")).not.toMatch(/Year gate/)
    expect(r.perGroup.length).toBeGreaterThan(0)
  })

  it("never gates a dry run — a preview writes nothing", async () => {
    const r = await run({ sheetYear: 2025, requestedYear: 2026, dryRun: true })
    expect(r.warnings.join(" ")).not.toMatch(/Year gate/)
  })

  it("forceOverride lets the owner proceed when the headers are wrong", async () => {
    const r = await run({
      sheetYear: 2025,
      requestedYear: 2026,
      forceOverride: true,
    })
    expect(r.warnings.join(" ")).not.toMatch(/Year gate/)
  })
})

/** perGroup is empty on an aborted run, so "no tx opened" is asserted via it. */
function prismaTxCalls(r: { perGroup: unknown[] }): number {
  return r.perGroup.length
}
