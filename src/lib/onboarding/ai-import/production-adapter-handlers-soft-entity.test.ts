// @vitest-environment node
/**
 * Phase 11.26 — the land-registry and risk-register handlers must not
 * hardcode one client's company.
 *
 * Both did `input.entityCode ?? "AZSEKER-EDEN"` and then, when the code
 * resolved to nothing, returned `rowsInserted: 0`. For any other organization
 * that is a guaranteed no-op under a green report — the silent-drop class 11.3
 * exists to close, still live here after 11.11 removed the same hardcode from
 * the financial path.
 */
import { describe, it, expect, vi } from "vitest"
import * as XLSX from "xlsx"
import {
  makeRiskRegisterHandler,
  makeLandRegistryHandler,
} from "./production-adapter-handlers-soft"
import type { OrgContext } from "./prod-adapter-context"
import type { PrismaClient } from "@prisma/client"

function ctxWith(codes: Array<[string, string]>): OrgContext {
  return {
    organizationId: "org_1",
    year: 2026,
    codeToId: new Map(codes),
    planId: "p",
    orgCompanies: [],
    deptLabelToId: new Map(),
  } as unknown as OrgContext
}

function book(name: string): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([["H"], ["x"]])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

const FAKE_PRISMA = {} as unknown as PrismaClient

function input(entityCode: string | null, sheetName = "S") {
  return {
    workbook: book(sheetName),
    sheetName,
    entityCode,
    year: 2026,
    organizationId: "org_1",
    XLSX,
  } as never
}

describe.each([
  ["risk register", makeRiskRegisterHandler],
  ["land registry", makeLandRegistryHandler],
])("%s handler — entity resolution", (label, make) => {
  function handler(codes: Array<[string, string]>) {
    const c = ctxWith(codes)
    return make(FAKE_PRISMA, { value: c }, async () => c)
  }

  it("BLOCKS instead of silently writing nothing when the entity is unknown", async () => {
    // The regression: an org without AZSEKER-EDEN got rowsInserted: 0 and a
    // green report, i.e. the whole sheet vanished without a signal.
    const r = await handler([["ATL-MAIN", "co_atl"]])(input("ATL-OTHER"))
    expect(r.itemCount).toBe(0)
    expect(r.blocked?.reason).toMatch(/does not exist in this organization/)
    expect(await r.applyToDb({} as never)).toEqual({ rowsInserted: 0 })
  })

  it("BLOCKS when no entity is given and this org has no AZSEKER-EDEN", async () => {
    // Never invent another tenant's company as a fallback.
    const r = await handler([["ATL-MAIN", "co_atl"]])(input(null))
    expect(r.blocked?.reason).toMatch(/no AZSEKER-EDEN to fall back to/)
  })

  it("keeps the legacy AZSEKER default when that org DOES have it", async () => {
    // AZSEKER's existing imports must behave exactly as before.
    const r = await handler([["AZSEKER-EDEN", "co_eden"]])(input(null))
    expect(r.blocked).toBeUndefined()
  })

  it("uses an explicitly classified entity when it resolves", async () => {
    const r = await handler([
      ["AZSEKER-EDEN", "co_eden"],
      ["ATL-MAIN", "co_atl"],
    ])(input("ATL-MAIN"))
    expect(r.blocked).toBeUndefined()
  })
})

