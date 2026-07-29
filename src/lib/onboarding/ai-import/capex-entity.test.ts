// @vitest-environment node
/**
 * Phase 11.33 — CAPEX must not skip companies silently.
 *
 * `applyToDb` did `if (!companyId) continue` with no warning, while the
 * summary still announced "N initiatives across M companies". The codes come
 * from `resolveEntityFromCostCenter(...) ?? "AZSEKER-EDEN"`, so for any org
 * without those companies EVERY code resolves to nothing: zero rows written,
 * green summary, no signal. Same class as 11.26, in the handler 11.26 missed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }))
vi.mock("../adapters/azseker-workbook-capex", () => ({
  parseCapexFarmSheetFromAoa: parseMock,
  parseCapexCpcSheetFromAoa: parseMock,
  resolveEntityFromCostCenter: vi.fn(() => null),
}))

import { makeCapexHandler } from "./production-adapter-handlers-soft"
import type { OrgContext } from "./prod-adapter-context"
import type { PrismaClient } from "@prisma/client"

const FAKE_PRISMA = {} as unknown as PrismaClient

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

function handler(codes: Array<[string, string]>) {
  const c = ctxWith(codes)
  return makeCapexHandler(FAKE_PRISMA, { value: c }, async () => c)
}

/** Minimal input — the parser is mocked, so the sheet only has to exist. */
const input = {
  workbook: { Sheets: { CAPEX_CPC: {} }, SheetNames: ["CAPEX_CPC"] },
  sheetName: "CAPEX_CPC",
  entityCode: null,
  year: 2026,
  organizationId: "org_1",
  XLSX: { utils: { sheet_to_json: () => [[]] } },
} as never

beforeEach(() => parseMock.mockReset())

function initiatives(codes: string[]) {
  parseMock.mockReturnValue({
    initiatives: codes.map((companyCode, i) => ({
      companyCode,
      name: `Init ${i}`,
      amount: 1000,
    })),
    warnings: [],
  })
}

describe("CAPEX handler — unresolved companies", () => {
  it("BLOCKS when no company in the sheet exists in this org", async () => {
    initiatives(["AZSEKER-EDEN", "AZSEKER-CPC"])
    const r = await handler([["ATL-MAIN", "co_atl"]])(input)
    expect(r.blocked?.reason).toMatch(/none of the companies/)
    expect(await r.applyToDb({} as never)).toEqual({ rowsInserted: 0 })
  })

  it("WARNS per unresolved company when only some resolve", async () => {
    initiatives(["AZSEKER-EDEN", "GHOST-CO"])
    const r = await handler([["AZSEKER-EDEN", "co_eden"]])(input)
    expect(r.blocked).toBeUndefined()
    expect(r.warnings.some((w) => w.includes("GHOST-CO"))).toBe(true)
    // The summary must not claim companies it cannot write to.
    expect(r.summary).toMatch(/1 unresolved/)
  })

  it("stays quiet when every company resolves", async () => {
    initiatives(["AZSEKER-EDEN"])
    const r = await handler([["AZSEKER-EDEN", "co_eden"]])(input)
    expect(r.blocked).toBeUndefined()
    expect(r.warnings.some((w) => w.includes("not in this organization"))).toBe(false)
  })
})
