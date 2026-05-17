import { describe, it, expect } from "vitest"
import { groupByParent, type ParentAware } from "./group-by-parent"

interface Row extends ParentAware {
  category: string
  planned?: number
}

describe("groupByParent", () => {
  it("returns empty buckets for empty input", () => {
    const out = groupByParent<Row>([])
    expect(out).toEqual({ groups: [], standalone: [] })
  })

  it("puts rows without parentCategory into `standalone`", () => {
    const rows: Row[] = [
      { category: "Rent" },
      { category: "Office Supplies" },
    ]
    const out = groupByParent(rows)
    expect(out.standalone).toHaveLength(2)
    expect(out.groups).toHaveLength(0)
  })

  it("groups rows with parentCategory by parent", () => {
    const rows: Row[] = [
      { category: "Rent A", parentCategory: "Real Estate" },
      { category: "Rent B", parentCategory: "Real Estate" },
      { category: "Salaries", parentCategory: "Payroll" },
    ]
    const out = groupByParent(rows)
    expect(out.standalone).toHaveLength(0)
    expect(out.groups).toHaveLength(2)
    const re = out.groups.find((g) => g.parent === "Real Estate")
    expect(re?.children).toHaveLength(2)
    expect(re?.children.map((c) => c.category)).toEqual(["Rent A", "Rent B"])
    const pr = out.groups.find((g) => g.parent === "Payroll")
    expect(pr?.children).toHaveLength(1)
  })

  it("mixes standalone + grouped rows", () => {
    const rows: Row[] = [
      { category: "Standalone-1" },
      { category: "Grouped-A", parentCategory: "Group1" },
      { category: "Standalone-2" },
      { category: "Grouped-B", parentCategory: "Group1" },
    ]
    const out = groupByParent(rows)
    expect(out.standalone.map((s) => s.category)).toEqual([
      "Standalone-1",
      "Standalone-2",
    ])
    expect(out.groups).toHaveLength(1)
    expect(out.groups[0].children).toHaveLength(2)
  })

  it("treats null parentCategory as standalone (not grouped)", () => {
    const rows: Row[] = [
      { category: "A", parentCategory: null },
      { category: "B", parentCategory: undefined },
    ]
    const out = groupByParent(rows)
    expect(out.standalone).toHaveLength(2)
    expect(out.groups).toHaveLength(0)
  })

  it("treats empty-string parentCategory as standalone (truthy check)", () => {
    const rows: Row[] = [{ category: "A", parentCategory: "" }]
    const out = groupByParent(rows)
    expect(out.standalone).toHaveLength(1)
    expect(out.groups).toHaveLength(0)
  })

  it("preserves child order within each group (insertion order)", () => {
    const rows: Row[] = [
      { category: "First", parentCategory: "G" },
      { category: "Second", parentCategory: "G" },
      { category: "Third", parentCategory: "G" },
    ]
    const out = groupByParent(rows)
    expect(out.groups[0].children.map((c) => c.category)).toEqual([
      "First",
      "Second",
      "Third",
    ])
  })

  it("generic over row shape — works with arbitrary fields", () => {
    interface Custom extends ParentAware {
      id: string
      amount: number
    }
    const rows: Custom[] = [
      { id: "x", amount: 10, parentCategory: "P" },
      { id: "y", amount: 20 },
    ]
    const out = groupByParent(rows)
    expect(out.standalone[0].amount).toBe(20)
    expect(out.groups[0].children[0].amount).toBe(10)
  })
})
