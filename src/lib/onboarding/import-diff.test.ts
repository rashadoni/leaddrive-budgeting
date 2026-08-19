/**
 * 2026-08-19 — what an import will change.
 *
 * The cases that matter are the ones where a diff quietly stops being a diff:
 * rows arriving in a different order, one account split across two rows, and
 * an account that disappears entirely.
 */
import { describe, it, expect } from "vitest"
import { diffImportRows } from "./import-diff"

const r = (accountId: string, monthIndex: number, plannedAmount: number, companyId: string | null = "co1") =>
  ({ accountId, companyId, monthIndex, plannedAmount })

describe("import diff", () => {
  it("says plainly when a re-import changes nothing", () => {
    // The normal case for this client, who re-imported the same file eight
    // times in two days. Saying so is what makes the abnormal case visible.
    const rows = [r("a", 0, 100), r("b", 1, 250)]
    const d = diffImportRows(rows, [...rows])
    expect(d.identical).toBe(true)
    expect(d.unchangedCount).toBe(2)
    expect(d.netDelta).toBe(0)
  })

  it("is not fooled by row order", () => {
    const d = diffImportRows([r("a", 0, 100), r("b", 1, 250)], [r("b", 1, 250), r("a", 0, 100)])
    expect(d.identical).toBe(true)
  })

  it("sums an account split across two rows before comparing", () => {
    // One source writes a single line, another writes two. Same money.
    const d = diffImportRows([r("a", 0, 100)], [r("a", 0, 60), r("a", 0, 40)])
    expect(d.identical).toBe(true)
  })

  it("reports a moved amount with both sides", () => {
    const d = diffImportRows([r("a", 0, 100)], [r("a", 0, 175)])
    expect(d.changed).toHaveLength(1)
    expect(d.changed[0]).toMatchObject({ before: 100, after: 175, delta: 75 })
    expect(d.netDelta).toBe(75)
  })

  it("calls a disappearing account removed, not changed to zero", () => {
    // A deleted sheet block and a genuine zero have different causes, and only
    // the first is usually a mistake worth stopping the import for.
    const d = diffImportRows([r("a", 0, 100), r("gone", 3, 500)], [r("a", 0, 100)])
    expect(d.removed.map((x) => x.accountId)).toEqual(["gone"])
    expect(d.changed).toHaveLength(0)
    expect(d.removed[0].delta).toBe(-500)
  })

  it("distinguishes a new account from a changed one", () => {
    const d = diffImportRows([r("a", 0, 100)], [r("a", 0, 100), r("new", 2, 42)])
    expect(d.added.map((x) => x.accountId)).toEqual(["new"])
    expect(d.changed).toHaveLength(0)
    expect(d.unchangedCount).toBe(1)
  })

  it("keeps the same account under two companies apart", () => {
    // Sharing a chart across entities is the norm here; collapsing them would
    // report a change that is really two untouched balances.
    const d = diffImportRows(
      [r("a", 0, 100, "co1"), r("a", 0, 900, "co2")],
      [r("a", 0, 100, "co1"), r("a", 0, 900, "co2")],
    )
    expect(d.identical).toBe(true)
  })

  it("leads with the largest movement", () => {
    const d = diffImportRows(
      [r("small", 0, 10), r("big", 1, 1000)],
      [r("small", 0, 20), r("big", 1, 5000)],
    )
    expect(d.changed[0].accountId).toBe("big")
  })

  it("ignores float noise", () => {
    const d = diffImportRows([r("a", 0, 100)], [r("a", 0, 100.001)])
    expect(d.identical).toBe(true)
  })
})
