/**
 * 2026-07-15 — guards for detectStaleSiblingRows.
 *
 * Locks the contract: live P&L rows in the target-year plan on companies
 * OUTSIDE the import's PLF footprint produce ONE warning per plan kind,
 * naming each company + row count; a clean plan produces none; detection
 * never fires without PLF classifications or resolvable footprint companies.
 */
import { describe, it, expect, vi } from "vitest"
import {
  detectStaleSiblingRows,
  type StaleSiblingDb,
} from "./stale-sibling-check"
import type { SheetClassification } from "./sheet-classifier"

function cls(
  entityCode: string,
  planKind: "actual" | "budget",
  overrides: Partial<SheetClassification> = {},
): SheetClassification {
  return {
    sheetName: `PLF X [${entityCode}]`,
    dataType: "PLF",
    entityCode,
    confidence: 1,
    reasoning: "",
    planKind,
    role: "source",
    ...overrides,
  }
}

function makeDb(opts: {
  companiesByCode?: Array<{ id: string }>
  plans?: Array<{ id: string }>
  staleGroups?: Array<{ companyId: string | null; _count: { _all: number } }>
  codeRows?: Array<{ id: string; code: string }>
}): StaleSiblingDb {
  const companyFindMany = vi
    .fn()
    // 1st call — footprint codes → ids
    .mockResolvedValueOnce(opts.companiesByCode ?? [{ id: "c_eden" }])
    // later calls — id → code resolution
    .mockResolvedValue(opts.codeRows ?? [])
  return {
    company: { findMany: companyFindMany },
    budgetPlan: { findMany: vi.fn().mockResolvedValue(opts.plans ?? []) },
    budgetLine: {
      groupBy: vi.fn().mockResolvedValue(opts.staleGroups ?? []),
    },
  } as unknown as StaleSiblingDb
}

const BASE = { organizationId: "org1", year: 2026 }

describe("detectStaleSiblingRows", () => {
  it("warns with company code + row count when out-of-footprint live rows exist", async () => {
    const db = makeDb({
      companiesByCode: [{ id: "c_eden" }],
      plans: [{ id: "plan_budget_2026" }],
      staleGroups: [{ companyId: "c_holding", _count: { _all: 2057 } }],
      codeRows: [{ id: "c_holding", code: "AZSEKER" }],
    })
    const warnings = await detectStaleSiblingRows(db, {
      ...BASE,
      classifications: [cls("AZSEKER-EDEN", "budget")],
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("STALE_SIBLING_ROWS")
    expect(warnings[0]).toContain("2026 budget plan")
    expect(warnings[0]).toContain("AZSEKER (2057 rows)")
  })

  it("returns [] when the plan has no out-of-footprint rows", async () => {
    const db = makeDb({
      plans: [{ id: "plan_budget_2026" }],
      staleGroups: [],
    })
    const warnings = await detectStaleSiblingRows(db, {
      ...BASE,
      classifications: [cls("AZSEKER-EDEN", "budget")],
    })
    expect(warnings).toEqual([])
  })

  it("returns [] when the import carries no PLF sheets", async () => {
    const db = makeDb({})
    const warnings = await detectStaleSiblingRows(db, {
      ...BASE,
      classifications: [
        cls("AZSEKER-EDEN", "actual", { dataType: "BS" }),
      ],
    })
    expect(warnings).toEqual([])
    expect(
      (db.budgetLine.groupBy as unknown as ReturnType<typeof vi.fn>),
    ).not.toHaveBeenCalled()
  })

  it("derived_summary sheets don't count into the footprint", async () => {
    const db = makeDb({ companiesByCode: [] })
    const warnings = await detectStaleSiblingRows(db, {
      ...BASE,
      classifications: [
        cls("AZSEKER-EDEN", "budget", { role: "derived_summary" }),
      ],
    })
    // Footprint empty → nothing to compare against → no detection.
    expect(warnings).toEqual([])
  })

  it("checks each plan kind separately (actual + budget in one import)", async () => {
    const companyFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "c_eden" }]) // footprint ids
      .mockResolvedValue([{ id: "c_holding", code: "AZSEKER" }])
    const db = {
      company: { findMany: companyFindMany },
      budgetPlan: {
        findMany: vi.fn().mockResolvedValue([{ id: "p1" }]),
      },
      budgetLine: {
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([
            { companyId: "c_holding", _count: { _all: 10 } },
          ])
          .mockResolvedValueOnce([]),
      },
    } as unknown as StaleSiblingDb
    const warnings = await detectStaleSiblingRows(db, {
      ...BASE,
      classifications: [
        cls("AZSEKER-EDEN", "actual"),
        cls("AZSEKER-EDEN", "budget"),
      ],
    })
    expect(warnings).toHaveLength(1)
    expect(
      (db.budgetLine.groupBy as unknown as ReturnType<typeof vi.fn>).mock
        .calls,
    ).toHaveLength(2)
  })
})
