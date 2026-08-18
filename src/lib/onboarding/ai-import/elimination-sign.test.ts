/**
 * 2026-08-18 — an elimination block classified its own cost signs, and read
 * them backwards.
 *
 * Found on production minutes after the feature shipped: group EBITDA showed
 * −388k where the client workbook's own `PLF.08` says 255,942.
 *
 * The cause is a property of what an elimination IS. It is a reversal, so its
 * cost rows are CREDITS and carry the opposite sign to every other block in
 * the same file. `resolveCostSigns` looks at the rows in front of it, saw
 * three positive cost rows, concluded "positive costs (debit convention)",
 * and declined to flip — so 321,798 of cost credit landed as cost. EBITDA
 * moves by twice that, because the credit is lost AND a cost is invented.
 *
 * 11.36 had already written the rule down for the per-BU split: the
 * convention is a property of the FILE, and somebody who can see the whole
 * file decides once. The elimination handler simply did not ask. It now reads
 * the verdict off a sibling entity block — same file, same statement, and the
 * one place whose signs are not inverted by construction.
 *
 * These tests drive the handler's parse path directly: a fixture in the real
 * shape (entity sheets plus an `[ELIMINATIONS]` sheet, all in one workbook)
 * and the assertion that the reversal keeps its credit.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "../adapters/azseker-plf"

/** 12 monthly cells: `v` in January, zeros after. */
const jan = (v: number) => [v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

function sheet(rows: unknown[][]): XLSX.WorkSheet {
  const header = [
    "Code",
    "Label",
    ...Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 1))),
  ]
  return XLSX.utils.aoa_to_sheet([["PLF"], header, ...rows])
}

/**
 * The workbook the splitter hands the handlers: one sheet per entity plus the
 * elimination sheet, every name sharing the parent prefix.
 *
 * The entity block is a NEGATIVE-cost file (the AZSEKER convention): revenue
 * positive, cost negative. The elimination block reverses a sale between two
 * group members, so its revenue is negative and its cost POSITIVE.
 */
function workbook(): XLSX.WorkBook {
  return {
    SheetNames: ["PLF Actual 2026 [AZSEKER-CPC]", "PLF Actual 2026 [ELIMINATIONS]"],
    Sheets: {
      "PLF Actual 2026 [AZSEKER-CPC]": sheet([
        ["PLF.01.01.01", "Revenue from Sale of Starch", ...jan(1_000_000)],
        ["PLF.02.01.01", "Cost of Starch", ...jan(-600_000)],
      ]),
      "PLF Actual 2026 [ELIMINATIONS]": sheet([
        ["PLF.01.01.04", "Intragroup sale reversal", ...jan(-225_932.87)],
        ["PLF.02.01.04", "Intragroup cost reversal", ...jan(224_607.41)],
      ]),
    },
  } as XLSX.WorkBook
}

/** The sibling lookup the handler performs, in one line. */
function conventionFromSibling(wb: XLSX.WorkBook, elimSheet: string) {
  const prefix = elimSheet.replace(/ \[ELIMINATIONS\](?: #\d+)?$/, " [")
  for (const name of wb.SheetNames) {
    if (name === elimSheet || !name.startsWith(prefix)) continue
    const sib = parsePlfPlSheet(wb, name, XLSX, { preferYear: 2026 })
    const c = sib.signConvention
    if (!c || c.blockedReason) continue
    if (c.cogsConvention === "no_evidence" && c.expenseConvention === "no_evidence") continue
    return c
  }
  return undefined
}

describe("elimination blocks inherit the file's cost-sign convention", () => {
  it("classifies its own rows backwards when left alone — the shipped defect", () => {
    const wb = workbook()
    const alone = parsePlfPlSheet(wb, "PLF Actual 2026 [ELIMINATIONS]", XLSX, {
      preferYear: 2026,
    })
    // Read in isolation the block looks like a debit-convention file, so the
    // cost credit is NOT flipped and lands as a positive cost.
    expect(alone.signConvention?.cogsConvention).toBe("positive_costs")
    const cost = alone.lines.find((l) => l.code === "PLF.02.01.04")!
    expect(cost.perMonth[0]).toBeCloseTo(224_607.41, 2)
  })

  it("keeps the credit a credit when the sibling states the convention", () => {
    const wb = workbook()
    const signOverride = conventionFromSibling(wb, "PLF Actual 2026 [ELIMINATIONS]")
    expect(signOverride?.cogsConvention).toBe("negative_costs")

    const fixed = parsePlfPlSheet(wb, "PLF Actual 2026 [ELIMINATIONS]", XLSX, {
      preferYear: 2026,
      signOverride,
    })
    const cost = fixed.lines.find((l) => l.code === "PLF.02.01.04")!
    // Flipped with the rest of the file: a cost CREDIT, stored negative.
    expect(cost.perMonth[0]).toBeCloseTo(-224_607.41, 2)
    // Revenue is never flipped either way; only the cost side was ever wrong.
    const rev = fixed.lines.find((l) => l.code === "PLF.01.01.04")!
    expect(rev.perMonth[0]).toBeCloseTo(-225_932.87, 2)
  })

  it("moves EBITDA by twice the credit — why the screen was off by 643,596", () => {
    const wb = workbook()
    const ebitda = (o?: ReturnType<typeof conventionFromSibling>) => {
      const p = parsePlfPlSheet(wb, "PLF Actual 2026 [ELIMINATIONS]", XLSX, {
        preferYear: 2026,
        ...(o ? { signOverride: o } : {}),
      })
      // Stored convention: revenue positive, cost positive-as-cost.
      const rev = p.lines.filter((l) => l.accountType === "revenue")
      const cogs = p.lines.filter((l) => l.accountType === "cogs")
      const sum = (ls: typeof p.lines) => ls.reduce((a, l) => a + l.perMonth[0], 0)
      return sum(rev) - sum(cogs)
    }
    const wrong = ebitda()
    const right = ebitda(conventionFromSibling(wb, "PLF Actual 2026 [ELIMINATIONS]"))
    expect(right).toBeCloseTo(-1_325.46, 2) // the block's own bottom line
    expect(right - wrong).toBeCloseTo(2 * 224_607.41, 2)
  })
})
