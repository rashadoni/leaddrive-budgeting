import { describe, it, expect, vi } from "vitest"
import {
  buildRegistryWith,
  type AdapterHandler,
  type AdapterRunResult,
} from "./adapter-registry"
import type { Prisma } from "@prisma/client"

const fakeTx = {} as Prisma.TransactionClient

function makeHandler(label: string): AdapterHandler {
  return async () => ({
    summary: `parsed ${label}`,
    itemCount: 1,
    warnings: [],
    applyToDb: async () => ({ rowsInserted: 1 }),
  })
}

describe("buildRegistryWith", () => {
  it("returns null for unregistered dataTypes", () => {
    const registry = buildRegistryWith({})
    expect(registry.get("PLF")).toBeNull()
    expect(registry.get("UNKNOWN")).toBeNull()
  })

  it("returns registered handlers", () => {
    const plfHandler = makeHandler("plf")
    const registry = buildRegistryWith({ PLF: plfHandler })
    expect(registry.get("PLF")).toBe(plfHandler)
    expect(registry.list()).toContain("PLF")
  })

  it("isolated handlers — adapter X doesn't leak into Y", async () => {
    const plf = makeHandler("plf")
    const bs = makeHandler("bs")
    const registry = buildRegistryWith({ PLF: plf, BS: bs })
    const h1 = registry.get("PLF")!
    const h2 = registry.get("BS")!
    const r1 = await h1({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "X",
      entityCode: null,
      year: 2026,
      organizationId: "org",
      XLSX: {},
    })
    const r2 = await h2({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "Y",
      entityCode: null,
      year: 2026,
      organizationId: "org",
      XLSX: {},
    })
    expect(r1.summary).toMatch(/plf/)
    expect(r2.summary).toMatch(/bs/)
  })

  it("handler can return arbitrary itemCount + warnings", async () => {
    const adapter: AdapterHandler = async () => ({
      summary: "17 land parcels, 22,595 ha",
      itemCount: 17,
      warnings: ["Row 4: missing annual rent — defaulted to 0"],
      applyToDb: async () => ({ rowsInserted: 17 }),
    })
    const registry = buildRegistryWith({ LAND_REGISTRY: adapter })
    const h = registry.get("LAND_REGISTRY")!
    const result: AdapterRunResult = await h({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "Sheet1",
      entityCode: "AZSEKER-EDEN",
      year: 2026,
      organizationId: "org",
      XLSX: {},
    })
    expect(result.itemCount).toBe(17)
    expect(result.warnings).toHaveLength(1)
    expect(result.summary).toContain("22,595")
  })

  it("applyToDb is callable independently from parsing", async () => {
    const applyToDbMock = vi.fn(async () => ({ rowsInserted: 42 }))
    const adapter: AdapterHandler = async () => ({
      summary: "parsed",
      itemCount: 1,
      warnings: [],
      applyToDb: applyToDbMock,
    })
    const registry = buildRegistryWith({ CAPEX: adapter })
    const h = registry.get("CAPEX")!
    const result = await h({
      workbook: { Sheets: {}, SheetNames: [] },
      sheetName: "CAPEX_Farm",
      entityCode: "AZSEKER-EDEN",
      year: 2026,
      organizationId: "org",
      XLSX: {},
    })
    expect(applyToDbMock).not.toHaveBeenCalled() // parsing alone doesn't call it
    const applied = await result.applyToDb(fakeTx)
    expect(applied.rowsInserted).toBe(42)
    expect(applyToDbMock).toHaveBeenCalledOnce()
  })

  it("list() returns only registered keys", () => {
    const registry = buildRegistryWith({
      PLF: makeHandler("plf"),
      BS: makeHandler("bs"),
      CF: makeHandler("cf"),
    })
    const list = registry.list().sort()
    expect(list).toEqual(["BS", "CF", "PLF"])
  })
})
