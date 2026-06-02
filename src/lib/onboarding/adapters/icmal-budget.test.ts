import { describe, it, expect } from "vitest"
import {
  parseIcmalBudgetLines,
  allocateIcmalBudget,
  icmalBudgetTotals,
  buildIcmalMonthlyRows,
  findIcmalYearColumn,
} from "./icmal-budget"

// İcmal-shaped AOA: col0 blank, col1=Group, col2=label, col3=2026, col4=2027.
// Blank-group rows = subtotals (skipped); "Group" literal = total row (skipped).
const AOA: unknown[][] = [
  [null, "Business Unit"],
  [null, "All"],
  [null, null, null, 2026, 2027], // year header (2026 at col 3)
  [null, "Group", "Satış gəliri", 1000, 1100], // total row → skipped
  [null, "Revenue", "Buğda", 600, 650], // → EDEN
  [null, "Revenue", "Şəkər çuğunduru", 400, 420], // → AZSF (beet)
  [null, null, "Maya dəyəri", -500, -530], // subtotal → skipped
  [null, "COGS", "Buğda", -300, -320], // EDEN cogs (abs 300)
  [null, "COGS", "Şəkər çuğunduru", -200, -210], // AZSF cogs
  [null, "OPEX", "İşçi xərcləri", -100, -110], // overhead → holding → pro-rata
  [null, "Subsidy - Farming", "Əkin subsidiyası", 50, 55], // → EDEN (revenue)
  [null, "Subsidies - Investment", "İnvestisiya subsidiyası", 30, 33], // → holding → pro-rata
  [null, "Depreciation", "Amortizasiya", -200, -210], // below-EBITDA → excluded
]

describe("icmal-budget mapping", () => {
  it("finds the year column", () => {
    expect(findIcmalYearColumn(AOA, 2026)).toBe(3)
    expect(findIcmalYearColumn(AOA, 2027)).toBe(4)
    expect(findIcmalYearColumn(AOA, 2099)).toBe(-1)
  })

  it("parses operating + subsidy lines; skips subtotals + below-EBITDA", () => {
    const { lines, excluded } = parseIcmalBudgetLines(AOA, 2026)
    const labels = lines.map((l) => `${l.group}:${l.label}`)
    expect(labels).toContain("Revenue:Buğda")
    expect(labels).toContain("COGS:Şəkər çuğunduru")
    expect(labels).toContain("Subsidy - Farming:Əkin subsidiyası")
    // skipped:
    expect(labels.find((l) => l.includes("Satış gəliri"))).toBeUndefined()
    expect(labels.find((l) => l.includes("Maya dəyəri"))).toBeUndefined()
    expect(excluded.some((e) => e.label === "Amortizasiya")).toBe(true)
  })

  it("routes products to the right company (beet → AZSF, costs positive)", () => {
    const { lines } = parseIcmalBudgetLines(AOA, 2026)
    const beetRev = lines.find((l) => l.lineType === "revenue" && l.label === "Şəkər çuğunduru")!
    expect(beetRev.companyCode).toBe("AZSEKER-AZSF")
    const wheatCogs = lines.find((l) => l.lineType === "cogs" && l.label === "Buğda")!
    expect(wheatCogs.companyCode).toBe("AZSEKER-EDEN")
    expect(wheatCogs.annual).toBe(300) // abs of -300
  })

  it("pro-rata's overhead + investment subsidy across revenue children", () => {
    const allocated = allocateIcmalBudget(parseIcmalBudgetLines(AOA, 2026).lines)
    // product revenue: EDEN 600, AZSF 400 → shares 0.6 / 0.4
    const opexEden = allocated.filter((l) => l.label === "İşçi xərcləri" && l.companyCode === "AZSEKER-EDEN")
    const opexAzsf = allocated.filter((l) => l.label === "İşçi xərcləri" && l.companyCode === "AZSEKER-AZSF")
    expect(opexEden.reduce((s, l) => s + l.annual, 0)).toBeCloseTo(60, 2)
    expect(opexAzsf.reduce((s, l) => s + l.annual, 0)).toBeCloseTo(40, 2)
    // investment subsidy 30 → EDEN 18 / AZSF 12
    const invEden = allocated.find((l) => l.label === "İnvestisiya subsidiyası" && l.companyCode === "AZSEKER-EDEN")!
    expect(invEden.annual).toBeCloseTo(18, 2)
  })

  it("totals balance after allocation (subsidies count as revenue)", () => {
    const allocated = allocateIcmalBudget(parseIcmalBudgetLines(AOA, 2026).lines)
    const t = icmalBudgetTotals(allocated)
    expect(t.revenue).toBeCloseTo(1080, 2) // 1000 product + 50 + 30 subsidy
    expect(t.cogs).toBeCloseTo(500, 2)
    expect(t.expense).toBeCloseTo(100, 2)
  })

  it("excludes subsidies when includeSubsidies=false", () => {
    const { lines } = parseIcmalBudgetLines(AOA, 2026, { includeSubsidies: false })
    expect(lines.some((l) => l.isSubsidy)).toBe(false)
    expect(icmalBudgetTotals(allocateIcmalBudget(lines)).revenue).toBeCloseTo(1000, 2)
  })

  it("expands each line into 12 monthly rows summing to the annual", () => {
    const allocated = allocateIcmalBudget(parseIcmalBudgetLines(AOA, 2026).lines)
    const rows = buildIcmalMonthlyRows(allocated)
    expect(rows.length).toBe(allocated.length * 12)
    // group by (company, coaCode) → Σ monthly = annual
    for (const l of allocated) {
      const mine = rows.filter((r) => r.companyCode === l.companyCode && r.coaCode === l.coaCode && r.lineType === l.lineType)
      expect(mine.reduce((s, r) => s + r.plannedAmount, 0)).toBeCloseTo(l.annual, 2)
    }
  })
})
