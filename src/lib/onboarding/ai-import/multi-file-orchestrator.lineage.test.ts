/**
 * Phase 11.86 — the AI import records where its numbers came from.
 *
 * The gap this closes, measured on production the morning of 2026-08-01 after
 * a full clean import of both years:
 *
 *     indicator_values                  6460
 *     with revisionId (lineage)            0
 *     rows in data_revisions               0
 *
 * `ai-auto-multi` — the route the client actually uses — contained zero
 * references to `revisionId`, `data-revision` or `import-lineage`, while
 * emitting the same `import_staging_apply` audit event as the routes that do.
 * From the outside the two paths looked identical. They were not.
 *
 * These tests run the REAL pipeline: the real orchestrator, the real
 * `buildAiImportRevisionScope`, the real `ensureDataRevision`, and the real
 * `runRecomputeForCompanies` with its real per-pair coverage rule. Only the
 * formula evaluator (`recomputeIndicator`) and Prisma are stubbed, so what is
 * under test is the whole chain from committed rows to a stamped `revisionId`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// The trigger swaps to the BYPASSRLS admin client whenever it is handed a full
// PrismaClient (post-mutation route call sites run outside any withOrgScope).
// Point that at the same stub, or the recompute would reach for a real socket
// and the orchestrator would swallow the failure as a non-fatal warning —
// exactly how the pre-existing orchestrator tests never exercise this path.
const prismaHolder: { current: unknown } = { current: null }
vi.mock("@/lib/db/prisma-admin", () => ({
  get prismaAdmin() {
    return prismaHolder.current
  },
}))

vi.mock("@/lib/risk/recompute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/risk/recompute")>()
  return {
    ...actual,
    createPrismaDataSource: vi.fn(() => ({ __mock: "datasource" })),
    recomputeIndicator: vi.fn(),
  }
})

import {
  runMultiFileImport,
  type MultiFileImportDependencies,
  type MultiFileImportInput,
} from "./multi-file-orchestrator"
import { buildRegistryWith, type AdapterHandler } from "./adapter-registry"
import type { SheetClassifierAnthropicLike } from "./sheet-classifier"
import type { SheetMap } from "./sheet-routing"
import type { PrismaClient } from "@prisma/client"
import { recomputeIndicator } from "@/lib/risk/recompute"
import { computeRevisionContentHash } from "@/lib/risk/data-revision"
import { aiWorkbookArtifactId } from "@/lib/risk/import-lineage"

const mockedRecompute = vi.mocked(recomputeIndicator)

const WORKBOOK_BYTES = Buffer.from("PK pretend this is actual-budget-v1.xlsx")
const SHA = require("node:crypto")
  .createHash("sha256")
  .update(WORKBOOK_BYTES)
  .digest("hex") as string

function classifyResponse(classifications: unknown[]) {
  return {
    stop_reason: "end_turn" as const,
    content: [{ type: "text" as const, text: JSON.stringify({ classifications }) }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }
}

function stubClient(classifications: unknown[]): SheetClassifierAnthropicLike {
  return {
    messages: { create: vi.fn(async () => classifyResponse(classifications)) },
  }
}

function handler(rowsInserted: number): AdapterHandler {
  return async () =>
    ({
      summary: "ok",
      itemCount: rowsInserted,
      warnings: [],
      expectedSums: new Map(),
      applyToDb: vi.fn(async () => ({ rowsInserted })),
    }) as unknown as Awaited<ReturnType<AdapterHandler>>
}

function ind(code: string, requiredInputs: string[]) {
  return {
    id: `def_${code}`,
    organizationId: null,
    code,
    formula: "revenue",
    sparklineFormula: null,
    thresholds: { green: { op: ">=", value: 0 } },
    requiredInputs,
    industries: [] as string[],
    isActive: true,
    unit: "AZN",
    defaultValueSource: "computed",
    aggregation: "flow",
  }
}

interface StubOpts {
  companies?: Array<{ id: string; code: string }>
  indicators?: ReturnType<typeof ind>[]
  existingRevision?: { id: string } | null
}

function stubPrisma(opts: StubOpts = {}) {
  const companies = (opts.companies ?? [{ id: "c1", code: "AZSEKER-CPC" }]).map(
    (c) => ({
      ...c,
      industry: "agriculture",
      level: 2,
      isActive: true,
      role: "operational" as const,
      baseCurrencyCode: "AZN",
    }),
  )
  const revisionCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "rev_created_1",
    ...data,
  }))
  const revisionFindFirst = vi.fn(async () => opts.existingRevision ?? null)

  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        company: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
        importBatchReport: { create: vi.fn(async () => ({})) },
      })
    }),
    company: {
      findMany: vi.fn(async (arg: { where?: { level?: number } } = {}) =>
        arg.where?.level === 1 ? [] : companies,
      ),
    },
    dataRevision: { findFirst: revisionFindFirst, create: revisionCreate },
    user: { findFirst: vi.fn(async () => null) },
    indicatorDefinition: { findMany: vi.fn(async () => opts.indicators ?? []) },
    companyIndicator: { findMany: vi.fn(async () => []) },
    // The post-recompute alert-persist and snapshot-verify blocks are both
    // wrapped in try/catch by design; leaving them unstubbed exercises that.
  } as unknown as PrismaClient

  prismaHolder.current = prisma
  return { prisma, revisionCreate, revisionFindFirst }
}

const fakeXLSX = { utils: { sheet_to_json: () => [["a", 1]] } }

/**
 * One file with a P&L tab and a balance-sheet tab — the `main-financial` shape
 * the file-type detector recognises, and the shape of the client's real
 * workbook.
 */
function input(
  over: Partial<MultiFileImportInput> = {},
  sheetMap?: SheetMap,
): MultiFileImportInput {
  return {
    files: [
      {
        filename: "actual-budget-v1.xlsx",
        workbook: {
          Sheets: {
            "PLF CPC": { "!ref": "A1:C3" },
            "BS CPC": { "!ref": "A1:C3" },
          },
          SheetNames: ["PLF CPC", "BS CPC"],
        } as never,
        contentSha256: SHA,
        ...(sheetMap ? { sheetMap } : {}),
      },
    ],
    organizationId: "org_1",
    year: 2026,
    ...over,
  }
}

function classification(over: Record<string, unknown> = {}) {
  return {
    sheetName: "PLF CPC",
    dataType: "PLF",
    entityCode: "AZSEKER-CPC",
    planKind: "actual",
    role: "source",
    confidence: 0.95,
    reasoning: "PLF prefix",
    ...over,
  }
}

interface DepsOpts {
  /** Rows the BS adapter reports writing. 0 = parsed nothing. */
  bsRows?: number
}

function deps(prisma: PrismaClient, opts: DepsOpts = {}): MultiFileImportDependencies {
  return {
    prisma,
    anthropicClient: stubClient([
      classification(),
      classification({ sheetName: "BS CPC", dataType: "BS", reasoning: "BS prefix" }),
    ]),
    model: "claude-test",
    registry: buildRegistryWith({
      PLF: handler(240),
      // Default 0: the balance-sheet tab parses nothing, so this run proves
      // only the P&L family. A sheet that wrote no rows changed nothing and
      // must buy no coverage.
      BS: handler(opts.bsRows ?? 0),
    }),
    XLSX: fakeXLSX,
  }
}

/** revisionId the trigger passed, keyed by indicator code. */
function stamps(): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>()
  for (const call of mockedRecompute.mock.calls) {
    const a = call[1] as {
      definition: { code: string }
      period: string
      revisionId?: string
    }
    if (a.period === "2026") out.set(a.definition.code, a.revisionId)
  }
  return out
}

beforeEach(() => {
  mockedRecompute.mockReset()
  mockedRecompute.mockResolvedValue({ status: "green", value: 1 } as never)
})

describe("runMultiFileImport — lineage", () => {
  it("writes a DataRevision naming the committed file, company and year", async () => {
    const { prisma, revisionCreate } = stubPrisma({
      indicators: [ind("IND_REVENUE_TOTAL", ["budgetLine"])],
    })

    const result = await runMultiFileImport(input(), deps(prisma))

    expect(result.perGroup[0].committed).toBe(true)
    expect(revisionCreate).toHaveBeenCalledTimes(1)
    const data = revisionCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(data.organizationId).toBe("org_1")
    expect(data.reason).toBe("import")
    expect(data.companyIds).toEqual(["c1"])
    // The artifact is the uploaded bytes, so an auditor can resolve it.
    expect(data.sourceArtifactIds).toEqual([aiWorkbookArtifactId(WORKBOOK_BYTES)])
    expect(data.mappingVersionIds).toHaveLength(1)
    expect(String(data.mappingVersionIds ? (data.mappingVersionIds as string[])[0] : "")).toMatch(
      /^ai-sheet-mapping:[a-f0-9]{64}$/,
    )
    expect(data.periodFrom).toBe("2026-01")
    expect(data.periodTo).toBe("2026-12")
    // The hash is the scope's, not a random id.
    expect(data.contentHash).toBe(
      computeRevisionContentHash({
        scope: {
          organizationId: "org_1",
          companyIds: ["c1"],
          sourceArtifactIds: data.sourceArtifactIds as string[],
          mappingVersionIds: data.mappingVersionIds as string[],
          periodFrom: "2026-01",
          periodTo: "2026-12",
        },
        reason: "import",
      }),
    )

    expect(result.lineage.revisionId).toBe("rev_created_1")
    expect(result.lineage.created).toBe(true)
    expect(result.lineage.companyCodes).toEqual(["AZSEKER-CPC"])
    expect(result.lineage.families).toEqual(["budgetLine"])
    expect(result.lineage.reason).toBeNull()
  })

  it("stamps the revision onto the workbook-only indicator and nothing else", async () => {
    const { prisma } = stubPrisma({
      indicators: [
        ind("IND_REVENUE_TOTAL", ["budgetLine"]),
        ind("AGRO_SUGAR_PRICE_TREND", ["commodityPrice:sugar_price_latest"]),
        ind("IND_INVENTORY_TURNOVER", ["budgetLine.cogs", "balanceSheetLine.inventory"]),
      ],
    })

    const result = await runMultiFileImport(input(), deps(prisma))

    const s = stamps()
    expect(s.get("IND_REVENUE_TOTAL")).toBe("rev_created_1")
    // A market feed is not this client's data. `external-source-lineage.ts`
    // exists precisely so feeds get their own shadow-only record instead.
    expect(s.get("AGRO_SUGAR_PRICE_TREND")).toBeUndefined()
    // The balance-sheet tab was present and parsed ZERO rows, so it changed
    // nothing and proves nothing. Presence of a sheet is not coverage.
    expect(s.get("IND_INVENTORY_TURNOVER")).toBeUndefined()
    expect(result.recompute.traced).toBeGreaterThan(0)
  })

  it("covers the cross-statement indicator once the balance sheet actually lands", async () => {
    const { prisma } = stubPrisma({
      indicators: [
        ind("IND_INVENTORY_TURNOVER", ["budgetLine.cogs", "balanceSheetLine.inventory"]),
      ],
    })

    const result = await runMultiFileImport(input(), deps(prisma, { bsRows: 60 }))

    expect(result.lineage.families).toEqual(["balanceSheetLine", "budgetLine"])
    expect(stamps().get("IND_INVENTORY_TURNOVER")).toBe("rev_created_1")
  })

  it("re-importing the same bytes reuses the revision instead of minting a second", async () => {
    const { prisma, revisionCreate } = stubPrisma({
      indicators: [ind("IND_REVENUE_TOTAL", ["budgetLine"])],
      existingRevision: { id: "rev_existing" },
    })

    const result = await runMultiFileImport(input(), deps(prisma))

    expect(revisionCreate).not.toHaveBeenCalled()
    expect(result.lineage.revisionId).toBe("rev_existing")
    expect(result.lineage.created).toBe(false)
    expect(stamps().get("IND_REVENUE_TOTAL")).toBe("rev_existing")
  })

  it("claims nothing for a BUDGET plan — no indicator reads one", async () => {
    // `listBudgetLines` pins plan.kind="actual". A forward budget import moves
    // no observation, so stamping its revision on values computed from the
    // ACTUALS of an earlier run would be a fabricated provenance.
    const { prisma, revisionCreate } = stubPrisma({
      indicators: [ind("IND_REVENUE_TOTAL", ["budgetLine"])],
    })
    // planKind is resolved deterministically by `resolveSheetRouting`, never by
    // the LLM's guess, so the budget routing comes from a sheet-map entry —
    // the same mechanism the reporting-pack config uses in production.
    const result = await runMultiFileImport(
      input({}, [
        { match: "PLF CPC", planKind: "budget" },
        { match: "BS CPC", planKind: "budget" },
      ]),
      deps(prisma),
    )

    expect(result.perGroup[0].committed).toBe(true)
    expect(revisionCreate).not.toHaveBeenCalled()
    expect(result.lineage.revisionId).toBeNull()
    expect(result.lineage.reason).toMatch(/no committed PLF\/BS\/CF actual-plan writes/)
    expect(stamps().get("IND_REVENUE_TOTAL")).toBeUndefined()
  })

  it("refuses to name a source it cannot resolve, and says so", async () => {
    // No content hash → the only remaining identifier is the filename, and two
    // unrelated uploads are routinely both called budget.xlsx. Writing a
    // filename-keyed revision would hand the second one the first's lineage.
    const { prisma, revisionCreate } = stubPrisma({
      indicators: [ind("IND_REVENUE_TOTAL", ["budgetLine"])],
    })
    const base = input()
    const noSha: MultiFileImportInput = {
      ...base,
      files: base.files.map(({ contentSha256: _dropped, ...rest }) => rest),
    }

    const result = await runMultiFileImport(noSha, deps(prisma))

    expect(result.perGroup[0].committed).toBe(true)
    expect(revisionCreate).not.toHaveBeenCalled()
    expect(result.lineage.revisionId).toBeNull()
    expect(result.warnings.join(" ")).toMatch(/Lineage not recorded/)
    expect(stamps().get("IND_REVENUE_TOTAL")).toBeUndefined()
  })

  it("writes no revision for a dry run", async () => {
    const { prisma, revisionCreate } = stubPrisma({
      indicators: [ind("IND_REVENUE_TOTAL", ["budgetLine"])],
    })

    const result = await runMultiFileImport(input({ dryRun: true }), deps(prisma))

    expect(revisionCreate).not.toHaveBeenCalled()
    expect(result.lineage.revisionId).toBeNull()
    expect(result.recompute.traced).toBe(0)
  })

  it("does not fail the import when the revision write throws", async () => {
    // Lineage is a record ABOUT an import. Failing to write it must never fail
    // the import that already committed — the honest outcome is committed rows
    // with untraced values, which is what every row in production looks like.
    const { prisma } = stubPrisma({
      indicators: [ind("IND_REVENUE_TOTAL", ["budgetLine"])],
    })
    ;(prisma.dataRevision.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("connection reset"),
    )

    const result = await runMultiFileImport(input(), deps(prisma))

    expect(result.perGroup[0].committed).toBe(true)
    expect(result.overallVerdict).toBe("green")
    expect(result.lineage.revisionId).toBeNull()
    expect(result.warnings.join(" ")).toMatch(/Lineage not recorded \(non-fatal\)/)
    expect(stamps().get("IND_REVENUE_TOTAL")).toBeUndefined()
  })
})
