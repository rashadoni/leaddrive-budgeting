// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import * as XLSX from "xlsx"
import { makeCounterpartyHandler } from "./production-adapter-handlers-soft"
import type { OrgContext } from "./prod-adapter-context"

function wb(): XLSX.WorkBook {
  const aoa = [
    ["CPC MMC", "Turnover", null, "EDEN AGRO MMC", "Turnover"],
    ["Veysəloğlu", 3000, null, "AZ ŞƏKƏR", 4000],
    ["Araz", 1000, null, "Bizim", 1000],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, "Customer")
  return book
}

function stubCtx(): OrgContext {
  return {
    organizationId: "org_1",
    year: 2026,
    codeToId: new Map([
      ["AZSEKER-CPC", "co_cpc"],
      ["AZSEKER-EDEN", "co_eden"],
    ]),
    planId: "plan_1",
    orgCompanies: [],
    deptLabelToId: new Map(),
  } as unknown as OrgContext
}

function makeTx() {
  const deleteMany = vi.fn(async () => ({ count: 0 }))
  const createMany = vi.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }))
  return { tx: { counterparty: { deleteMany, createMany } } as never, deleteMany, createMany }
}

const input = {
  workbook: wb(),
  sheetName: "Customer",
  entityCode: null,
  year: 2026,
  organizationId: "org_1",
  XLSX,
} as never

describe("makeCounterpartyHandler", () => {
  it("writes Counterparty rows with derived sharePct + clean-slates the (role,period) snapshot", async () => {
    const handler = makeCounterpartyHandler({} as never, { value: null }, async () => stubCtx())
    const res = await handler(input)
    expect(res.itemCount).toBe(4) // 2 CPC + 2 EDEN

    const { tx, deleteMany, createMany } = makeTx()
    const { rowsInserted } = await res.applyToDb(tx)
    expect(rowsInserted).toBe(4)

    // clean-slate scoped to org + touched companies + this role + period
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        companyId: { in: expect.arrayContaining(["co_cpc", "co_eden"]) },
        role: "customer",
        period: "2026",
      },
    })
    const written = createMany.mock.calls[0][0].data as Array<{ companyId: string; name: string; sharePct: number; role: string }>
    const cpc = written.filter((w) => w.companyId === "co_cpc")
    expect(cpc.map((w) => w.name)).toEqual(["Veysəloğlu", "Araz"])
    expect(cpc.find((w) => w.name === "Veysəloğlu")!.sharePct).toBe(75) // 3000/4000
    expect(written.every((w) => w.role === "customer")).toBe(true)
  })

  it("no-ops (no write) when the sheet name has no customer/supplier role", async () => {
    const handler = makeCounterpartyHandler({} as never, { value: null }, async () => stubCtx())
    const res = await handler({ ...(input as Record<string, unknown>), sheetName: "Random Sheet" } as never)
    expect(res.itemCount).toBe(0)
    const { tx, createMany } = makeTx()
    await res.applyToDb(tx)
    expect(createMany).not.toHaveBeenCalled()
  })
})
