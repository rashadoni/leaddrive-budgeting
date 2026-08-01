/**
 * Phase 6 — tests for the recompute processor.
 *
 * We mock `runRecomputeForCompanies` so these tests don't open Redis
 * or Postgres connections — they assert ONLY the processor's plumbing:
 * progress emission, chunking, error propagation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: vi.fn(),
}))

// Phase 8 D5(b) — withOrgScope opens a real Postgres tx. The processor
// test doesn't need real RLS; mock it to just invoke the callback with
// a no-op tx so the test still asserts chunking + progress emission.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: vi.fn(
    async (
      _orgId: string,
      fn: (tx: unknown) => Promise<unknown>,
      _opts?: unknown,
    ) => fn({} as never),
  ),
}))

import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import {
  processRecomputePair,
  processRecomputeBatch,
} from "./recompute-processor"

function fakeJob<T>(data: T) {
  const progressEvents: number[] = []
  return {
    job: {
      data,
      updateProgress: async (n: number | object) => {
        progressEvents.push(typeof n === "number" ? n : -1)
      },
    },
    progressEvents,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(runRecomputeForCompanies as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: 5,
    unknown: 1,
    failed: 0,
    targets: 6,
    traced: 0,
  })
})

describe("processRecomputePair", () => {
  it("emits 0 → 100 progress around a single recompute call", async () => {
    const { job, progressEvents } = fakeJob({
      organizationId: "org_1",
      companyId: "c_1",
      year: 2026,
    })
    const result = await processRecomputePair(
      job as unknown as Parameters<typeof processRecomputePair>[0],
    )
    expect(progressEvents).toEqual([0, 100])
    expect(result.ok).toBe(5)
    expect(runRecomputeForCompanies).toHaveBeenCalledOnce()
    const [, , affected] = (runRecomputeForCompanies as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [unknown, string, Array<{ companyId: string; year: number }>]
    expect(affected).toEqual([{ companyId: "c_1", year: 2026 }])
  })

  it("re-throws so BullMQ retry kicks in on failure", async () => {
    ;(runRecomputeForCompanies as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB down"),
    )
    const { job } = fakeJob({
      organizationId: "org_1",
      companyId: "c_1",
      year: 2026,
    })
    await expect(
      processRecomputePair(
        job as unknown as Parameters<typeof processRecomputePair>[0],
      ),
    ).rejects.toThrow("DB down")
  })
})

describe("processRecomputeBatch", () => {
  it("short-circuits empty target list with 100% progress + zero counts", async () => {
    const { job, progressEvents } = fakeJob({
      organizationId: "org_1",
      targets: [] as Array<{ companyId: string; year: number }>,
    })
    const result = await processRecomputeBatch(
      job as unknown as Parameters<typeof processRecomputeBatch>[0],
    )
    expect(progressEvents).toEqual([100])
    expect(result).toEqual({ ok: 0, unknown: 0, failed: 0, targets: 0, traced: 0 })
    expect(runRecomputeForCompanies).not.toHaveBeenCalled()
  })

  it("chunks 10 companies into ~5-per-chunk runs and emits incremental progress", async () => {
    const targets = Array.from({ length: 10 }, (_, i) => ({
      companyId: `c_${i}`,
      year: 2026,
    }))
    const { job, progressEvents } = fakeJob({
      organizationId: "org_1",
      targets,
    })
    await processRecomputeBatch(
      job as unknown as Parameters<typeof processRecomputeBatch>[0],
    )
    // First event = 0%, last = 100%. Mid-events monotonically increase.
    expect(progressEvents[0]).toBe(0)
    expect(progressEvents[progressEvents.length - 1]).toBe(100)
    for (let i = 1; i < progressEvents.length; i++) {
      expect(progressEvents[i]).toBeGreaterThanOrEqual(progressEvents[i - 1])
    }
    // 10 targets / chunk size ~1 (Math.ceil(10/10)=1) → 10 chunks → 10 recompute calls
    expect(
      (runRecomputeForCompanies as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(10)
  })

  it("aggregates ok/unknown/failed counts across chunks", async () => {
    ;(runRecomputeForCompanies as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: 3, unknown: 0, failed: 0, targets: 3 })
      .mockResolvedValueOnce({ ok: 2, unknown: 1, failed: 0, targets: 3 })
    const { job } = fakeJob({
      organizationId: "org_1",
      targets: [
        { companyId: "c_a", year: 2026 },
        { companyId: "c_b", year: 2026 },
      ],
    })
    const result = await processRecomputeBatch(
      job as unknown as Parameters<typeof processRecomputeBatch>[0],
    )
    expect(result.ok).toBe(5)
    expect(result.unknown).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.targets).toBe(6)
  })
})

describe("processRecomputeBatch — import lineage across the process boundary", () => {
  it("rehydrates the serialised claim and hands the SAME one to every chunk", () => {
    // Two properties in one assertion, both load-bearing.
    //
    // Rehydration: BullMQ stores job data as JSON, so the payload carries a
    // plain object. Passing it straight through would give the coverage lookup
    // a `Record` where it expects a `Map` — `.get()` would be undefined and
    // every value would silently come out untraced, with no type error and no
    // crash. That is the failure mode the SerializedImportLineage type and
    // `deserializeImportLineage` exist to prevent.
    //
    // Same object per chunk: chunking is a progress-reporting detail. If the
    // lineage were sliced alongside the targets, what a revision claims would
    // depend on how the worker happened to divide the batch.
    return (async () => {
      const targets = Array.from({ length: 20 }, (_, i) => ({
        companyId: `c_${i}`,
        year: 2026,
      }))
      const { job } = fakeJob({
        organizationId: "org_1",
        targets,
        lineage: {
          revisionId: "rev_import_1",
          periodFrom: "2026-01",
          periodTo: "2026-12",
          coverageByCompanyId: { c_3: ["budgetLine"] },
        },
      })

      await processRecomputeBatch(job as never)

      const calls = (runRecomputeForCompanies as ReturnType<typeof vi.fn>).mock
        .calls
      expect(calls.length).toBeGreaterThan(1)
      for (const call of calls) {
        const opts = call[4] as {
          lineage?: {
            revisionId: string
            coverageByCompanyId: ReadonlyMap<string, ReadonlySet<string>>
          }
        }
        expect(opts.lineage?.revisionId).toBe("rev_import_1")
        expect(opts.lineage?.coverageByCompanyId).toBeInstanceOf(Map)
        expect([...(opts.lineage?.coverageByCompanyId.get("c_3") ?? [])]).toEqual([
          "budgetLine",
        ])
      }
    })()
  })

  it("passes no lineage when the job carries none", async () => {
    // Today's real state for both enqueuers: the fan-out above SYNC_THRESHOLD
    // is triggered by an indicator-definition change, and the AI import never
    // reaches this queue at all (it recomputes in-process). Neither holds a
    // revision, so both stay honestly untraced.
    const { job } = fakeJob({
      organizationId: "org_1",
      targets: [{ companyId: "c_1", year: 2026 }],
    })

    await processRecomputeBatch(job as never)

    const opts = (runRecomputeForCompanies as ReturnType<typeof vi.fn>).mock
      .calls[0][4] as { lineage?: unknown }
    expect(opts.lineage).toBeUndefined()
  })

  it("aggregates the traced count across chunks", async () => {
    ;(runRecomputeForCompanies as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: 5,
      unknown: 1,
      failed: 0,
      targets: 6,
      traced: 2,
    })
    const { job } = fakeJob({
      organizationId: "org_1",
      targets: Array.from({ length: 20 }, (_, i) => ({
        companyId: `c_${i}`,
        year: 2026,
      })),
    })

    const result = await processRecomputeBatch(job as never)
    const chunks = (runRecomputeForCompanies as ReturnType<typeof vi.fn>).mock
      .calls.length
    expect(result.traced).toBe(2 * chunks)
  })
})
