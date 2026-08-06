// @vitest-environment node
/**
 * Phase 16.5 — the ASSUMPTIONS handler's WRITE path.
 *
 * The parser has its own tests; this file is about what reaches the database.
 * Two behaviours here are deliberate deviations from every other adapter and
 * are the reason this file exists:
 *
 *   · it UPSERTS instead of clean-slating, so a controller's hand-typed driver
 *     survives an import that does not mention it;
 *   · a company that does not resolve is DROPPED, never demoted to a
 *     plan-level default that would apply to the whole holding.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as XLSX from "xlsx"
import { makeAssumptionsHandler } from "./production-adapter-handlers-soft"
import type { OrgContext } from "./prod-adapter-context"
import type { PrismaClient } from "@prisma/client"

const FAKE_PRISMA = {} as unknown as PrismaClient
const SHEET = "Assumptions"

const tx = {
  budgetAssumption: {
    findMany: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    // Present so "it never deletes" is a real assertion. Were this absent the
    // test would only prove the mock lacks the method.
    deleteMany: vi.fn(),
    deleteOne: vi.fn(),
  },
}

beforeEach(() => {
  tx.budgetAssumption.findMany.mockReset().mockResolvedValue([])
  tx.budgetAssumption.deleteMany.mockReset().mockResolvedValue({ count: 0 })
  tx.budgetAssumption.deleteOne.mockReset().mockResolvedValue({ count: 0 })
  tx.budgetAssumption.update.mockReset().mockResolvedValue({ id: "x" })
  tx.budgetAssumption.create.mockReset().mockImplementation(async () => ({ id: `new_${tx.budgetAssumption.create.mock.calls.length}` }))
})

function ctx(): OrgContext {
  return {
    organizationId: "org_1",
    year: 2026,
    planId: "plan_abcdef123",
    codeToId: new Map([
      ["AZSEKER-CPC", "cmp_cpc"],
      ["AZSEKER-EDEN", "cmp_eden"],
    ]),
    orgCompanies: [
      { id: "cmp_cpc", code: "AZSEKER-CPC", name: "CPC MMC" },
      { id: "cmp_eden", code: "AZSEKER-EDEN", name: "Eden Agro MMC" },
    ],
    deptLabelToId: new Map(),
    coaByCode: new Map(),
  } as unknown as OrgContext
}

function book(aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SHEET)
  return wb
}

function run(aoa: unknown[][], entityCode: string | null = null) {
  const c = ctx()
  const handler = makeAssumptionsHandler(FAKE_PRISMA, { value: c }, async () => c)
  return handler({
    workbook: book(aoa),
    sheetName: SHEET,
    entityCode,
    year: 2026,
    organizationId: "org_1",
    XLSX,
  } as never)
}

const HEADER = ["Parameter", "Value", "Unit", "Company"]

describe("ASSUMPTIONS handler — parse-stage report", () => {
  it("counts plan-level defaults and company overrides separately", async () => {
    const r = await run([
      HEADER,
      ["Inflation", 0.06, "%", ""],
      ["Imported input share", 0.7, "%", "CPC MMC"],
    ])
    expect(r.itemCount).toBe(2)
    expect(r.summary).toMatch(/1 plan-level, 1 company override/)
  })

  it("reports a sheet with nothing readable rather than throwing", async () => {
    const r = await run([["nothing", "here"]])
    expect(r.itemCount).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe("ASSUMPTIONS handler — writes", () => {
  it("inserts a new driver with the plan from the org context", async () => {
    const r = await run([HEADER, ["Inflation", 0.06, "%", ""]])
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create).toHaveBeenCalledTimes(1)
    expect(tx.budgetAssumption.create.mock.calls[0][0].data).toMatchObject({
      organizationId: "org_1",
      planId: "plan_abcdef123",
      key: "inflation",
      value: 0.06,
      companyId: null,
    })
  })

  it("updates the existing row for the same (key, company) instead of duplicating", async () => {
    tx.budgetAssumption.findMany.mockResolvedValue([
      { id: "a1", key: "inflation", companyId: null },
    ])
    const r = await run([HEADER, ["Inflation", 0.09, "%", ""]])
    const out = await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create).not.toHaveBeenCalled()
    expect(tx.budgetAssumption.update).toHaveBeenCalledTimes(1)
    expect(tx.budgetAssumption.update.mock.calls[0][0]).toMatchObject({
      where: { id: "a1" },
      data: { value: 0.09 },
    })
    expect(out.rowsInserted).toBe(1)
  })

  it("treats the same key on a company as a DIFFERENT row from the plan default", async () => {
    tx.budgetAssumption.findMany.mockResolvedValue([
      { id: "a1", key: "import_share", companyId: null },
    ])
    const r = await run([HEADER, ["Imported input share", 0.7, "%", "CPC MMC"]])
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.update).not.toHaveBeenCalled()
    expect(tx.budgetAssumption.create.mock.calls[0][0].data).toMatchObject({
      key: "import_share",
      companyId: "cmp_cpc",
    })
  })

  it("NEVER deletes — a hand-typed driver the sheet omits must survive", async () => {
    // The financial adapters clean-slate their scope because the workbook is
    // the whole truth for it. An assumption may equally have been typed on the
    // tab, and there is no soft-delete on this table to recover from.
    tx.budgetAssumption.findMany.mockResolvedValue([
      { id: "keep", key: "typed_by_a_human", companyId: null },
    ])
    const r = await run([HEADER, ["Inflation", 0.06, "%", ""]])
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.deleteMany).not.toHaveBeenCalled()
    expect(tx.budgetAssumption.deleteOne).not.toHaveBeenCalled()
    // The untouched row is neither deleted nor rewritten.
    expect(tx.budgetAssumption.update).not.toHaveBeenCalled()
    expect(tx.budgetAssumption.create).toHaveBeenCalledTimes(1)
  })

  it("a duplicate key on ONE sheet updates the row it just created", async () => {
    const r = await run([
      HEADER,
      ["Inflation", 0.06, "%", ""],
      ["Inflyasiya", 0.09, "%", ""],
    ])
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create).toHaveBeenCalledTimes(1)
    expect(tx.budgetAssumption.update).toHaveBeenCalledTimes(1)
    expect(tx.budgetAssumption.update.mock.calls[0][0].data.value).toBe(0.09)
  })

  it("writes nothing at all when the sheet yielded no rows", async () => {
    const r = await run([["nothing", "here"]])
    const out = await r.applyToDb(tx as never)
    expect(out.rowsInserted).toBe(0)
    expect(tx.budgetAssumption.findMany).not.toHaveBeenCalled()
  })
})

describe("ASSUMPTIONS handler — company scope", () => {
  it("uses the sheet entity as the DEFAULT owner for rows that name no company", async () => {
    const r = await run([["Parameter", "Value"], ["Inflation", 0.06]], "AZSEKER-EDEN")
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create.mock.calls[0][0].data.companyId).toBe("cmp_eden")
  })

  it("a row naming its own company beats the sheet entity", async () => {
    const r = await run([HEADER, ["Imported input share", 0.7, "%", "CPC MMC"]], "AZSEKER-EDEN")
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create.mock.calls[0][0].data.companyId).toBe("cmp_cpc")
  })

  it("no sheet entity and no company column → plan-level default", async () => {
    const r = await run([["Parameter", "Value"], ["Inflation", 0.06]], null)
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create.mock.calls[0][0].data.companyId).toBeNull()
  })

  it("warns and stays plan-level when the sheet entity is not in this org", async () => {
    const r = await run([["Parameter", "Value"], ["Inflation", 0.06]], "SOMEONE-ELSE")
    expect(r.warnings.join(" ")).toMatch(/not in this organization/)
    await r.applyToDb(tx as never)
    expect(tx.budgetAssumption.create.mock.calls[0][0].data.companyId).toBeNull()
  })

  it("reports the companies it touched so the orchestrator recomputes them", async () => {
    const r = await run([
      HEADER,
      ["Imported input share", 0.7, "%", "CPC MMC"],
      ["Inflation", 0.06, "%", ""],
    ])
    const out = await r.applyToDb(tx as never)
    expect(out.touchedCompanyCodes).toEqual(["AZSEKER-CPC"])
  })
})
