/**
 * 11.60 — the reporting-pack apply attests to itself, and refuses bad data.
 *
 * Two defects, both invisible until 11.2 made post-write reconciliation real.
 *
 *  (a) NO ATTESTATION. The batch layer already re-reads every row it writes
 *      and reconciles it, and every adapter forwards that report — this path
 *      took `rowsInserted` and dropped `reconciliation` on the floor. So a
 *      reporting-pack apply wrote no `ImportBatchReport`, and the newest row
 *      in `import_batch_reports` still described the PREVIOUS import. That
 *      row is what `/api/import/reports` presents as reconciliation evidence,
 *      so a stale attestation is worse than none: it reads as proof of a
 *      write that never happened.
 *
 *  (b) COMMIT ON RED. With the verdict discarded, this path committed
 *      whatever the adapters produced. The ai-auto-multi orchestrator throws
 *      inside the transaction and rolls the group back. Same rows, same
 *      failure modes, opposite behaviour — and it meant a red row in
 *      `import_batch_reports` would have meant "bad data committed" rather
 *      than "import refused".
 */
import { describe, it, expect, vi } from "vitest"
import * as XLSX from "xlsx"
import type { AdapterRegistry, AdapterRunInput } from "../ai-import/adapter-registry"
import type { ReconciliationReport } from "../reconciliation"
import { runReportingPackImport } from "./reporting-pack-importer"

const M2026 = [46023, 46054, 46082, 46113, 46143, 46174, 46204, 46235, 46266, 46296, 46327, 46357]
const vals = (v: number) => Array(12).fill(v)

function buildWorkbook(): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["", "", "", ...M2026, "BU"],
    ["PLF.01.01.01", "Wheat", "", ...vals(10), "AZSF"],
  ])
  return {
    SheetNames: ["Actual PLF"],
    Sheets: { "Actual PLF": sheet },
  } as XLSX.WorkBook
}

const GREEN: ReconciliationReport = {
  verdict: "green",
  matched: 12,
  drift: [],
  missing: [],
  extra: [],
  toleranceAzn: 0.005,
}
const RED: ReconciliationReport = {
  verdict: "red",
  matched: 0,
  drift: [],
  missing: ["plan1::AZSEKER-AZSF-PLF.01.01.01::2026-01"],
  extra: ["plan1::PLF.01.01.01::2026-01"],
  toleranceAzn: 0.005,
}

function registryReturning(reconciliation: ReconciliationReport | undefined): AdapterRegistry {
  const handler = async (input: AdapterRunInput) => ({
    summary: `stub ${input.entityCode}`,
    itemCount: 7,
    warnings: [],
    applyToDb: async () => ({ rowsInserted: 5, reconciliation }),
  })
  return { get: () => handler, list: () => ["PLF", "BS", "CF"] }
}

/** Fake tx that RECORDS batch-report writes — the thing under test. */
function buildPrisma() {
  const created: Array<Record<string, unknown>> = []
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        company: { findMany: async () => [], update: async () => {} },
        importBatchReport: {
          create: async (args: { data: Record<string, unknown> }) => {
            created.push(args.data)
            return {}
          },
        },
      })
    },
  } as never
  return { prisma, created }
}

const RUN = {
  workbook: buildWorkbook(),
  organizationId: "org1",
  year: 2026,
  mode: "apply" as const,
  runId: "reporting-pack:org1:2026:123",
  filenames: ["Reporting 2026.xlsx"],
  actorUserId: "u1",
}

describe("reporting-pack — batch report", () => {
  it("writes an ImportBatchReport for an apply that carries a runId", async () => {
    const { prisma, created } = buildPrisma()

    await runReportingPackImport(RUN, {
      prisma,
      XLSX,
      registry: registryReturning(GREEN),
    })

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      organizationId: "org1",
      runId: "reporting-pack:org1:2026:123",
      fileType: "reporting-pack",
      year: 2026,
      verdict: "green",
      committed: true,
      actorUserId: "u1",
    })
    expect(created[0].filenames).toEqual(["Reporting 2026.xlsx"])
    expect(created[0].rowsInserted).toBe(5)
  })

  it("records the evidence as db-readback when the adapters really re-read", async () => {
    // The value that decides whether the receipt may be called proof. Claiming
    // db-readback for a parse self-check is the dishonesty 11.2 exists to
    // remove, so it must track the reports actually returned.
    const { prisma, created } = buildPrisma()

    await runReportingPackImport(RUN, {
      prisma,
      XLSX,
      registry: registryReturning(GREEN),
    })

    expect(created[0].evidence).toBe("db-readback")
    expect(created[0].sheetsVerified).toBe(1)
  })

  it("writes NO report for a preview — there is nothing to attest to", async () => {
    const { prisma, created } = buildPrisma()

    await runReportingPackImport(
      { ...RUN, mode: "preview" },
      { prisma, XLSX, registry: registryReturning(GREEN) },
    )

    expect(created).toHaveLength(0)
  })

  it("writes NO report when no runId is given — keeps the legacy CLI path working", async () => {
    const { prisma, created } = buildPrisma()

    await runReportingPackImport(
      { workbook: buildWorkbook(), organizationId: "org1", year: 2026, mode: "apply" },
      { prisma, XLSX, registry: registryReturning(GREEN) },
    )

    expect(created).toHaveLength(0)
  })
})

describe("reporting-pack — refuses a red verdict", () => {
  it("throws out of the transaction instead of committing", async () => {
    // The orchestrator aborts on red; this path used to commit. Same rows,
    // same failure modes, opposite behaviour.
    const { prisma } = buildPrisma()

    await expect(
      runReportingPackImport(RUN, {
        prisma,
        XLSX,
        registry: registryReturning(RED),
      }),
    ).rejects.toThrow(/Post-write reconciliation rejected/)
  })

  it("puts the NUMBERS in the rejection, not just sheet names", async () => {
    // 11.58 — diagnosing the 11.51 incident cost a four-lens code audit
    // because the message named sheets and nothing else. Equal missing/extra
    // with 0 matched is the signature of two key spaces that never intersect,
    // and the sample keys show it at a glance.
    const { prisma } = buildPrisma()

    await expect(
      runReportingPackImport(RUN, {
        prisma,
        XLSX,
        registry: registryReturning(RED),
      }),
    // `[\s\S]` rather than the `s` flag — that flag needs an es2018 target.
    ).rejects.toThrow(/0 matched[\s\S]*1 missing[\s\S]*1 extra/)
  })

  it("does not run the post-apply recompute when the apply was refused", async () => {
    // Recomputing after a rolled-back write would rebuild indicators from
    // data that is no longer there.
    const { prisma } = buildPrisma()
    const onAfterApply = vi.fn(async () => {})

    await expect(
      runReportingPackImport(RUN, {
        prisma,
        XLSX,
        registry: registryReturning(RED),
        onAfterApply,
      }),
    ).rejects.toThrow()
    expect(onAfterApply).not.toHaveBeenCalled()
  })

  it("still commits a clean apply — the gate must not block good data", async () => {
    const { prisma } = buildPrisma()
    const onAfterApply = vi.fn(async () => {})

    const res = await runReportingPackImport(RUN, {
      prisma,
      XLSX,
      registry: registryReturning(GREEN),
      onAfterApply,
    })

    expect(res.mode).toBe("applied")
    expect(res.totalRowsWritten).toBe(5)
    expect(onAfterApply).toHaveBeenCalledWith(["AZSEKER-AZSF"])
  })

  it("treats an adapter with NO reconciliation as unverified, not as a failure", async () => {
    // The soft adapters (settings JSON, zero parsed rows) have no sums to
    // reconcile. Folding those into a red would refuse every pack that
    // contains one; 11.2 counts them separately on purpose.
    const { prisma, created } = buildPrisma()

    const res = await runReportingPackImport(RUN, {
      prisma,
      XLSX,
      registry: registryReturning(undefined),
    })

    expect(res.mode).toBe("applied")
    expect(created[0].sheetsUnverified).toBe(1)
  })
})
