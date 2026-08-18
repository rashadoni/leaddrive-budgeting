/**
 * Dry-run: per-product cost read from the CLIENT'S OWN workbook, checked
 * against the margin column the client computed themselves.
 *
 * Gated on `PLF_DRYRUN_WORKBOOK` like the other workbook-dependent suites, so
 * it is inert in CI and decisive on the real file. Synthetic fixtures proved
 * the parser reads a COGS banner; only this proves it reads THEIRS — the one
 * with six sections, negative costs, export variants and a by-product that
 * sells at cost.
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { parseProductSalesSheet } from "./product-sales-parser"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)
const SHEET = "Sales Budget CPC 2026"

describe.skipIf(!AVAILABLE)("per-product margin on the client workbook", () => {
  const res = AVAILABLE
    ? parseProductSalesSheet(XLSX.readFile(WORKBOOK), SHEET, XLSX, {
        entityCode: "AZSEKER-CPC",
        year: 2026,
      })
    : null

  it("reads a cost for every product that has revenue", () => {
    const withRevenue = res!.rows.filter((r) => r.amount !== 0)
    expect(withRevenue.length).toBeGreaterThan(0)
    // Byproduct sells AT cost, so its margin is zero — but its cost is not
    // absent, and the distinction is the whole point of `cost?: number`.
    expect(withRevenue.every((r) => r.cost !== undefined)).toBe(true)
  })

  it("reproduces the margins the client states in their own sheet", () => {
    const byProduct = new Map<string, { rev: number; cost: number }>()
    for (const r of res!.rows) {
      const k = r.identity.code
      const a = byProduct.get(k) ?? { rev: 0, cost: 0 }
      a.rev += r.amount
      a.cost += r.cost ?? 0
      byProduct.set(k, a)
    }
    const margin = (code: string) => {
      const a = byProduct.get(code)!
      return ((a.rev - a.cost) / a.rev) * 100
    }
    // Measured off the workbook's own GROSS PROFIT column on 2026-08-18.
    expect(margin("AZSEKER_CPC__GLUCOSE")).toBeCloseTo(47.1, 0)
    expect(margin("AZSEKER_CPC__CORN_STARCH")).toBeCloseTo(43.8, 0)
    expect(margin("AZSEKER_CPC__FRUCTOSE")).toBeCloseTo(38.2, 0)
    expect(margin("AZSEKER_CPC__CORN_STARCH__EXPORT")).toBeCloseTo(31.2, 0)
    expect(margin("AZSEKER_CPC__GLUCOSE__EXPORT")).toBeCloseTo(16.5, 0)

    const total = [...byProduct.values()].reduce(
      (a, v) => ({ rev: a.rev + v.rev, cost: a.cost + v.cost }),
      { rev: 0, cost: 0 },
    )
    expect(total.cost).toBeCloseTo(12_561_824, -1)
    expect(((total.rev - total.cost) / total.rev) * 100).toBeCloseTo(30.7, 0)
  })

  it("farming states no cost, and the parser says so instead of guessing", () => {
    // The half the owner cannot answer for: `Sales Farming Budget 2026` has
    // tonnes and no money at all. Whatever it yields, it must not invent a
    // cost — that is what would put a 100% margin on wheat.
    const farming = parseProductSalesSheet(
      XLSX.readFile(WORKBOOK),
      "Sales Farming Budget 2026",
      XLSX,
      { entityCode: "AZSEKER-EDEN", year: 2026 },
    )
    expect(farming.rows.every((r) => r.cost === undefined)).toBe(true)
  })
})
