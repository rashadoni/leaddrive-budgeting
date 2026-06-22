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
import type { PrismaClient } from "@prisma/client"
import { buildReconKey } from "../reconciliation"

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
})
