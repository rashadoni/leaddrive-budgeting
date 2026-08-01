/**
 * The AJE/EJE discriminator (11.83).
 *
 * Every case below is the shape of a real block in `actual-budget-v1.xlsx`:
 * AJE's parent dimension names a company (BU_1 = EDEN on all 394 rows), EJE's
 * parent dimension names ITSELF on all four sheets that carry one. The rule
 * reads that hierarchy; it does not interpret the label.
 */
import { describe, it, expect } from "vitest"
import {
  findBuDimensionColumns,
  resolveAdjustmentOwner,
  type BuDimensionColumn,
} from "./bu-adjustment"
import { isAdjustmentEntityValue, isEliminationLikeEntityValue } from "./entity-alias-utils"

const aliasMap: Record<string, string> = {
  EDEN: "AZSEKER-EDEN",
  CPC: "AZSEKER-CPC",
  AZSF: "AZSEKER",
  PROMALT: "AZSEKER-PROMALT",
}
const resolveEntity = (label: string): string | null => aliasMap[label] ?? null

/** `PLF Budget 2026` header: BU_1 | BU_2 | BU_3 (entity) | BU_4. */
const BUDGET_DIMS: BuDimensionColumn[] = [
  { col: 3, headerRow: 0, header: "BU_1" },
  { col: 4, headerRow: 0, header: "BU_2" },
  { col: 5, headerRow: 0, header: "BU_3" },
  { col: 6, headerRow: 0, header: "BU_4" },
]
/** n AJE rows exactly as the budget sheet writes them. */
const ajeRows = (n: number, parent = "EDEN"): unknown[][] =>
  Array.from({ length: n }, () => ["PLF.05.12.06", "Non-Recoverable VAT Expense", -1000, parent, "Core", "AJE", "Combined"])

describe("isAdjustmentEntityValue", () => {
  it("is a SUBSET of the elimination-like set for AJE — both must stay true", () => {
    // The subset relation is load-bearing: everything that asks "is this a
    // company?" must keep saying no, while the splitter asks the narrower
    // question and gets a different answer.
    expect(isEliminationLikeEntityValue("AJE")).toBe(true)
    expect(isAdjustmentEntityValue("AJE")).toBe(true)
  })
  it("is FALSE for a true elimination — that is the whole discriminator", () => {
    // ("Eliminations", plural, is not in ELIMINATION_ENTITY_RE — a pre-existing
    // gap that changes nothing here: it falls through to `unknown_alias` and is
    // skipped either way, and it is never adjustment-like.)
    expect(isAdjustmentEntityValue("Eliminations")).toBe(false)
    for (const v of ["EJE", "ELIM", "Elimination", "Intercompany", "CONSOLIDATED"]) {
      expect(isEliminationLikeEntityValue(v)).toBe(true)
      expect(isAdjustmentEntityValue(v)).toBe(false)
    }
  })
  it("matches short codes exactly and long forms as a phrase", () => {
    expect(isAdjustmentEntityValue("adj")).toBe(true)
    expect(isAdjustmentEntityValue("Management adjustments")).toBe(true)
    expect(isAdjustmentEntityValue("Корректировки")).toBe(true)
    // Not an adjustment: a company whose name merely starts with the code.
    expect(isAdjustmentEntityValue("ADJARA HOLDING")).toBe(false)
    expect(isAdjustmentEntityValue("")).toBe(false)
  })
})

describe("findBuDimensionColumns", () => {
  it("finds every BU/BU_N header, left to right", () => {
    const aoa: unknown[][] = [["Code", "Name", "Jan", "BU_1", "BU_2", "BU_3", "BU_4"]]
    expect(findBuDimensionColumns(aoa).map((d) => d.header)).toEqual([
      "BU_1",
      "BU_2",
      "BU_3",
      "BU_4",
    ])
  })
  it("finds a plain 'BU' beside a numbered sibling", () => {
    const aoa: unknown[][] = [["Code", "BU", "BU_1"]]
    expect(findBuDimensionColumns(aoa).map((d) => d.col)).toEqual([1, 2])
  })
  it("ignores non-dimension headers and text below the scan window", () => {
    const aoa: unknown[][] = [["Code", "Business Unit", "BUDGET"], ...Array(10).fill(["x", "BU_9"])]
    expect(findBuDimensionColumns(aoa, 1)).toEqual([])
  })
})

describe("resolveAdjustmentOwner — the workbook's own hierarchy", () => {
  it("attributes AJE to the company its BU_1 names (PLF Budget 2026)", () => {
    const owner = resolveAdjustmentOwner({
      buValue: "AJE",
      blockRows: ajeRows(394),
      entityColumn: 5,
      dimensionColumns: BUDGET_DIMS,
      resolveEntity,
    })
    expect(owner).toEqual({
      ok: true,
      entityCode: "AZSEKER-EDEN",
      viaHeader: "BU_1",
      label: "EDEN",
    })
  })

  it("REFUSES an elimination even when a parent column names a company", () => {
    // The guard that keeps EJE out is the label, not the data — an EJE block
    // that happened to inherit an entity tag must still never be folded.
    const owner = resolveAdjustmentOwner({
      buValue: "EJE",
      blockRows: [["PLF.01.01.01", "Elim", -3, "EDEN", "Core", "EJE", "Combined"]],
      entityColumn: 5,
      dimensionColumns: BUDGET_DIMS,
      resolveEntity,
    })
    expect(owner.ok).toBe(false)
  })

  it("refuses EJE's real shape: its own parent dimension is EJE (PLF Actual 2025)", () => {
    const owner = resolveAdjustmentOwner({
      buValue: "AJE", // even under the permissive label, the DATA refuses
      blockRows: Array(19).fill(["PLF.01.01.01", "Elim", -3, "EJE"]),
      entityColumn: 2,
      dimensionColumns: [
        { col: 2, headerRow: 0, header: "BU" },
        { col: 3, headerRow: 0, header: "BU_1" },
      ],
      resolveEntity,
    })
    expect(owner.ok).toBe(false)
    if (!owner.ok) expect(owner.reason).toMatch(/no BU dimension column attributes it/)
  })

  it("refuses a block whose parent column names two different entities", () => {
    const owner = resolveAdjustmentOwner({
      buValue: "AJE",
      blockRows: [...ajeRows(3, "EDEN"), ...ajeRows(3, "CPC")],
      entityColumn: 5,
      dimensionColumns: BUDGET_DIMS,
      resolveEntity,
    })
    expect(owner.ok).toBe(false)
    if (!owner.ok) expect(owner.reason).toMatch(/BU_1 names 2 different parents/)
  })

  it("refuses when the parent label is not a known company", () => {
    const owner = resolveAdjustmentOwner({
      buValue: "AJE",
      blockRows: ajeRows(4, "SOME-NEW-CO"),
      entityColumn: 5,
      dimensionColumns: BUDGET_DIMS,
      resolveEntity,
    })
    expect(owner.ok).toBe(false)
    if (!owner.ok) expect(owner.reason).toMatch(/not a known company/)
  })

  it("refuses when the sheet has no other BU dimension column", () => {
    const owner = resolveAdjustmentOwner({
      buValue: "AJE",
      blockRows: [["PLF.05.12.06", "VAT", -1000, "AJE"]],
      entityColumn: 3,
      dimensionColumns: [{ col: 3, headerRow: 0, header: "BU" }],
      resolveEntity,
    })
    expect(owner.ok).toBe(false)
    if (!owner.ok) expect(owner.reason).toMatch(/no other BU dimension column/)
  })

  it("refuses when two qualifying columns disagree about the owner", () => {
    const rows: unknown[][] = Array(4).fill(["PLF.05.12.06", "VAT", -1000, "EDEN", "CPC", "AJE"])
    const owner = resolveAdjustmentOwner({
      buValue: "AJE",
      blockRows: rows,
      entityColumn: 5,
      dimensionColumns: [
        { col: 3, headerRow: 0, header: "BU_1" },
        { col: 4, headerRow: 0, header: "BU_2" },
        { col: 5, headerRow: 0, header: "BU_3" },
      ],
      resolveEntity,
    })
    expect(owner.ok).toBe(false)
    if (!owner.ok) expect(owner.reason).toMatch(/disagree about the owner/)
  })

  it("ignores non-entity dimensions (BU_2=Core, BU_4=Combined) rather than failing on them", () => {
    const owner = resolveAdjustmentOwner({
      buValue: "AJE",
      blockRows: ajeRows(10),
      entityColumn: 5,
      dimensionColumns: BUDGET_DIMS,
      resolveEntity,
    })
    expect(owner.ok).toBe(true)
  })
})
