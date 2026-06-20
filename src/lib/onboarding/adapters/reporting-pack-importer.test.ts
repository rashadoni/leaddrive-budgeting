import { describe, it, expect, vi } from "vitest"
import * as XLSX from "xlsx"
import type { AdapterRegistry, AdapterRunInput } from "../ai-import/adapter-registry"
import { runReportingPackImport } from "./reporting-pack-importer"

const M2026 = [
  46023, 46054, 46082, 46113, 46143, 46174, 46204, 46235, 46266, 46296, 46327,
  46357,
]
const vals = (v: number) => Array(12).fill(v)

function plfSheet(rows: unknown[][], buHeader = "BU"): XLSX.WorkSheet {
  const header = ["", "", "", ...M2026, buHeader]
  return XLSX.utils.aoa_to_sheet([header, ...rows])
}

function buildWorkbook(): XLSX.WorkBook {
  const actual = plfSheet([
    ["PLF.01", "REVENUE", "", ...vals(999), "AZSF"], // parent → skipped by leaf rule
    ["PLF.01.01.01", "Wheat", "", ...vals(10), "AZSF"],
    ["PLF.02.01.01", "COGS", "", ...vals(-5), "AZSF"],
    ["PLF.01.01.01", "Wheat", "", ...vals(20), "EDEN"],
    ["PLF.01.01.01", "Elim", "", ...vals(-3), "EJE"], // eliminations → skipped
  ])
  // Budget PLF uses the BU_3 hierarchy leaf column (matches the real file)
  const budget = plfSheet(
    [["PLF.01.01.01", "Wheat", "", ...vals(100), "AZSF"]],
    "BU_3",
  )
  return {
    SheetNames: ["Actual PLF", "Budget PLF"],
    Sheets: { "Actual PLF": actual, "Budget PLF": budget },
  } as XLSX.WorkBook
}

describe("runReportingPackImport — preview", () => {
  it("computes per-entity counts without touching the DB", async () => {
    const prisma = {
      $transaction: vi.fn(async () => {
        throw new Error("preview must not open a transaction")
      }),
    } as never

    const res = await runReportingPackImport(
      { workbook: buildWorkbook(), organizationId: "org1", year: 2026, mode: "preview" },
      { prisma, XLSX },
    )

    expect(res.mode).toBe("preview")
    expect(res.totalRowsWritten).toBe(0)
    const azsfActual = res.reports.find(
      (r) => r.sheetName === "Actual PLF" && r.buCode === "AZSF",
    )!
    expect(azsfActual.entityCode).toBe("AZSEKER-AZSF")
    expect(azsfActual.lineCount).toBe(2) // 2 leaves, parent skipped
    expect(azsfActual.skipped).toBe(false)

    const eje = res.reports.find((r) => r.buCode === "EJE")!
    expect(eje.skipped).toBe(true)

    const budget = res.reports.find((r) => r.sheetName === "Budget PLF")!
    // Budget PLF = the multi-year farming-STRATEGY budget → "strategy" plan,
    // kept separate from the operational "budget" plan (2026-06-20).
    expect(budget.planKind).toBe("strategy")
    // skipped EJE excluded from total
    expect(res.totalLineCount).toBe(2 + 1 + 1) // AZSF(2)+EDEN(1) actual + AZSF(1) budget
  })
})

describe("runReportingPackImport — apply", () => {
  it("feeds each non-skipped entity to the handler inside one tx + recomputes", async () => {
    const calls: AdapterRunInput[] = []
    const applyOrder: string[] = []
    const fakeHandler = async (input: AdapterRunInput) => {
      calls.push(input)
      return {
        summary: `stub ${input.entityCode}`,
        itemCount: 7,
        warnings: [],
        applyToDb: async () => {
          applyOrder.push(`${input.sheetName}:${input.entityCode}`)
          return { rowsInserted: 5 }
        },
      }
    }
    const registry: AdapterRegistry = {
      get: () => fakeHandler,
      list: () => ["PLF", "BS", "CF"],
    }
    const txCalls: number[] = []
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<void>) => {
        txCalls.push(1)
        await fn({})
      },
    } as never
    const onAfterApply = vi.fn(async () => {})

    const res = await runReportingPackImport(
      { workbook: buildWorkbook(), organizationId: "org1", year: 2026, mode: "apply" },
      { prisma, XLSX, registry, onAfterApply },
    )

    expect(res.mode).toBe("applied")
    // handler called for AZSF + EDEN (Actual PLF) and AZSF (Budget PLF) = 3
    expect(calls.length).toBe(3)
    // EJE never reaches the handler
    expect(calls.some((c) => c.entityCode === null)).toBe(false)
    // planKind routed from sheet config
    const budgetCall = calls.find((c) => c.sheetName === "Budget PLF")!
    expect(budgetCall.targetPlanKind).toBe("strategy")
    const actualCall = calls.find((c) => c.sheetName === "Actual PLF")!
    expect(actualCall.targetPlanKind).toBe("actual")
    // single transaction, all writes inside it
    expect(txCalls.length).toBe(1)
    expect(applyOrder.length).toBe(3)
    expect(res.totalRowsWritten).toBe(15) // 3 × 5
    // affected entities deduped, EJE excluded
    expect(res.affectedEntities.sort()).toEqual(["AZSEKER-AZSF", "AZSEKER-EDEN"])
    expect(onAfterApply).toHaveBeenCalledWith(["AZSEKER-AZSF", "AZSEKER-EDEN"])
  })
})
