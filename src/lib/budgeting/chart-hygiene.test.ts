/**
 * 2026-08-19 — retiring dead chart entries.
 *
 * Almost every test here is about the same failure: acting on a list that was
 * true when the screen rendered and is not true any more. Deactivation is a
 * soft flag, so getting it wrong fails silently — the account simply stops
 * appearing — which is why the guard is tested harder than the happy path.
 */
import { describe, it, expect } from "vitest"
import { planDeactivation, hintFor, foldUsage, isDead } from "./chart-hygiene"

const eligible = (...ids: string[]) => new Set(ids)
const counts = (m: Record<string, number>) => new Map(Object.entries(m))

describe("deactivation guard", () => {
  it("retires an entry that still carries nothing", () => {
    const p = planDeactivation({
      ids: ["a", "b"],
      freshCounts: counts({}),
      eligible: eligible("a", "b"),
    })
    expect(p.approved.sort()).toEqual(["a", "b"])
    expect(p.refused).toHaveLength(0)
  })

  it("refuses an entry that gained rows since the screen rendered", () => {
    // The whole reason the count is re-read at write time. An import between
    // render and click is not hypothetical here: this client ran eight in two
    // days.
    const p = planDeactivation({
      ids: ["a", "b"],
      freshCounts: counts({ b: 24 }),
      eligible: eligible("a", "b"),
    })
    expect(p.approved).toEqual(["a"])
    expect(p.refused).toEqual([{ id: "b", reason: "no_longer_dead", rows: 24 }])
  })

  it("refuses on a single row, with no threshold", () => {
    // There is no amount of money small enough that hiding the account
    // carrying it becomes acceptable.
    const p = planDeactivation({
      ids: ["a"],
      freshCounts: counts({ a: 1 }),
      eligible: eligible("a"),
    })
    expect(p.approved).toHaveLength(0)
    expect(p.refused[0].reason).toBe("no_longer_dead")
  })

  it("refuses anything not eligible instead of trusting the request", () => {
    // Ids arrive from a client. Another organisation's id, or one already
    // retired, must not be actionable just because it was asked for.
    const p = planDeactivation({
      ids: ["mine", "someone_elses"],
      freshCounts: counts({}),
      eligible: eligible("mine"),
    })
    expect(p.approved).toEqual(["mine"])
    expect(p.refused).toEqual([{ id: "someone_elses", reason: "not_eligible" }])
  })

  it("does not act twice on a repeated id", () => {
    const p = planDeactivation({
      ids: ["a", "a", "a"],
      freshCounts: counts({}),
      eligible: eligible("a"),
    })
    expect(p.approved).toEqual(["a"])
  })

  it("approves nothing when nothing was asked for", () => {
    const p = planDeactivation({ ids: [], freshCounts: counts({}), eligible: eligible("a") })
    expect(p.approved).toHaveLength(0)
    expect(p.refused).toHaveLength(0)
  })
})

describe("why an entry looks dead", () => {
  const live = [
    { code: "PLF.05.10.99", name: "Other Repair & Maintenance Expenses" },
    { code: "PLF.05.01.08", name: "Catering Expenses" },
  ]

  it("recognises an R-suffixed shadow of a live sibling", () => {
    const h = hintFor(
      { id: "1", code: "PLF.05.10.99.R", name: "Other Repair & Maintenance Expenses", kind: "account" },
      live,
    )
    expect(h).toBe("shadow_of_live_sibling")
  })

  it("recognises a name that a live code already carries", () => {
    // PLF.05.01.28 sits beside a populated PLF.05.01.08 of the same name.
    expect(hintFor({ id: "2", code: "PLF.05.01.28", name: "Catering Expenses", kind: "account" }, live))
      .toBe("duplicate_name")
  })

  it("says nothing rather than guessing when the chart does not explain it", () => {
    expect(hintFor({ id: "3", code: "PLF.99.99.99", name: "Something unique", kind: "account" }, live))
      .toBe("none")
  })

  it("does not call an R-suffixed code a shadow when the sibling is gone", () => {
    // Without a live base the suffix means nothing, and claiming otherwise
    // would invite retiring the only copy.
    expect(hintFor({ id: "4", code: "PLF.07.07.07.R", name: "Orphan", kind: "account" }, live))
      .toBe("none")
  })
})

describe("what counts as usage", () => {
  const tbl = (...pairs: Array<[string, number]>) => pairs.map(([id, rows]) => ({ id, rows }))

  it("keeps a balance-sheet account alive though it holds no P&L row", () => {
    // Production, 2026-08-19: judged on budget lines alone, all 23
    // balance-sheet accounts read as dead — Cash (941 rows), Inventories
    // (1016), Share capital (1016). Retiring them would have hidden the
    // balance sheet from every screen that lists accounts.
    const budgetLines = tbl()
    const balanceLines = tbl(["cash", 941], ["inventories", 1016], ["capital", 1016])
    const u = foldUsage([budgetLines, balanceLines], [])
    expect(isDead(u.get("cash"))).toBe(false)
    expect(isDead(u.get("inventories"))).toBe(false)
  })

  it("counts an account dead when only archived rows remain", () => {
    // The other half of the same measurement: treating archived rows as
    // usage leaves 0 dead of 315, and the screen has nothing to offer.
    const u = foldUsage([tbl()], [tbl(["superseded", 40])])
    expect(isDead(u.get("superseded"))).toBe(true)
    expect(u.get("superseded")?.archived).toBe(40)
  })

  it("keeps an account alive on one live row beside a thousand archived ones", () => {
    const u = foldUsage([tbl(["mixed", 1])], [tbl(["mixed", 1000])])
    expect(isDead(u.get("mixed"))).toBe(false)
  })

  it("sums the same entry across tables rather than taking the last", () => {
    const u = foldUsage([tbl(["a", 3]), tbl(["a", 4])], [tbl(["a", 5])])
    expect(u.get("a")).toEqual({ live: 7, archived: 5 })
  })

  it("treats an entry no table mentions as dead", () => {
    expect(isDead(foldUsage([], []).get("absent"))).toBe(true)
    expect(isDead(undefined)).toBe(true)
  })
})
