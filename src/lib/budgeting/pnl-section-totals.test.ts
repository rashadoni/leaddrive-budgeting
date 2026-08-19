/**
 * 2026-08-19 — rows to section totals, pinned on the client's own January–May.
 *
 * The decisive assertion is the last one: these rows, classified and composed,
 * must reproduce 255,942 — the EBITDA the client's workbook states for itself
 * in `PLF.08` and the figure the P&L screen shows. The first version of the
 * year-end screen missed it by nearly six million because it read budget costs
 * from a place in the payload where they do not live, and nothing caught that
 * until someone looked at the screen. This is that catch, written down.
 */
import { describe, it, expect } from "vitest"
import { sectionTotalsFromRows, type ClassifiableRow } from "./pnl-section-totals"
import { computeEbitda } from "./ebitda"
import {
  pnlSectionFromCode,
  revenueContribution,
  otherOperatingContribution,
} from "./coa-role"
import { isDaCode } from "./da-codes"

/** The canonical classifiers, injected exactly as the route injects them. */
const CLASSIFY = {
  section: (code: string, accountType: string | null) => pnlSectionFromCode(code, accountType),
  revenue: revenueContribution,
  otherOperating: otherOperatingContribution,
  isDa: isDaCode,
}

/**
 * The client's consolidated January–May 2026 actuals, by account, summed to
 * the leaf codes that matter for each section. Every figure is theirs.
 */
const JAN_MAY: ClassifiableRow[] = [
  { code: "PLF.01.01.01", accountType: "revenue", month: 1, amount: 12_725_933 },
  { code: "PLF.02.01.01", accountType: "expense", month: 1, amount: 9_896_711 },
  { code: "PLF.04.01.01", accountType: "expense", month: 1, amount: 536_036 },
  { code: "PLF.05.01.01", accountType: "expense", month: 1, amount: 5_054_161 },
  { code: "PLF.12.01.01", accountType: "expense", month: 1, amount: 491_618 },
  // Other operating: income above, the one expense line below.
  { code: "PLF.07.01.01", accountType: "revenue", month: 1, amount: 243_037 },
  { code: "PLF.07.02.02", accountType: "revenue", month: 1, amount: 3_011_174 },
  { code: "PLF.07.02.03", accountType: "revenue", month: 1, amount: 124_686 },
  { code: "PLF.07.02.04", accountType: "revenue", month: 1, amount: 152_615 },
  { code: "PLF.07.02.99", accountType: "revenue", month: 1, amount: 27_071 },
  { code: "PLF.07.03.99", accountType: "expense", month: 1, amount: 50_048 },
  { code: "PLF.09.03.01", accountType: "expense", month: 1, amount: 4_471_271 },
]

describe("section totals from rows", () => {
  const t = sectionTotalsFromRows(JAN_MAY, [1], CLASSIFY)

  it("sorts the client's accounts into the sections the P&L uses", () => {
    expect(t.totalRevenue).toBe(12_725_933)
    expect(t.totalCogs).toBe(9_896_711)
    expect(t.totalOpex).toBe(536_036 + 5_054_161 + 491_618)
    expect(t.totalBelowEbitda).toBe(4_471_271)
  })

  it("nets other operating income against its expense side", () => {
    // 3,558,583 of income less 50,048 of expense. Summing PLF.07 raw would
    // overstate it by twice the expense line.
    expect(t.totalOtherOperating).toBeCloseTo(3_508_535, 0)
  })

  it("reproduces the EBITDA the client's own workbook states", () => {
    // PLF.08 in their book, and the figure on the P&L card: 255,942.
    expect(computeEbitda(t).ebitda).toBeCloseTo(255_942, 0)
  })

  it("ignores months outside the window", () => {
    const other = sectionTotalsFromRows(JAN_MAY, [7], CLASSIFY)
    expect(other.totalRevenue).toBe(0)
    expect(computeEbitda(other).ebitda).toBe(0)
  })

  it("refuses the sheet's own subtotal rows", () => {
    // PLF.08 IS the stated EBITDA. Counting it as a line would add the answer
    // to itself.
    const withSubtotal = sectionTotalsFromRows(
      [...JAN_MAY, { code: "PLF.08", accountType: "revenue", month: 1, amount: 255_942 }],
      [1],
      CLASSIFY,
    )
    expect(computeEbitda(withSubtotal).ebitda).toBeCloseTo(255_942, 0)
  })

  it("does not silently lose costs when a section yields nothing", () => {
    // The shape of the defect this file exists to prevent: opex reading as
    // zero leaves EBITDA overstated by exactly the missing costs.
    const noOpex = sectionTotalsFromRows(
      JAN_MAY.filter((r) => !r.code.startsWith("PLF.04") && !r.code.startsWith("PLF.05") && !r.code.startsWith("PLF.12")),
      [1],
      CLASSIFY,
    )
    expect(computeEbitda(noOpex).ebitda - computeEbitda(t).ebitda).toBeCloseTo(6_081_815, 0)
  })
})
