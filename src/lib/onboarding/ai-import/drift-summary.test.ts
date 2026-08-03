import { describe, it, expect } from "vitest"
import { worstDrifts, describeDrift } from "./drift-summary"

const sheet = (
  sheetName: string,
  entityCode: string | null,
  lines: Array<[string, number, number, number]>,
) => ({
  sheetName,
  entityCode,
  topDrift: lines.map(([key, expected, actual, driftPct]) => ({
    key,
    expected,
    actual,
    driftPct,
  })),
})

describe("worstDrifts — what a controller has to chase", () => {
  it("ranks by absolute manat, not by percentage", () => {
    // A 90% drift on a 12 ₼ line is arithmetically dramatic and
    // operationally irrelevant. 12,014 ₼ off a nine-figure statement is the
    // one somebody has to go and find.
    const got = worstDrifts([
      sheet("PLF Actual 2025", "AZSEKER-AZSF", [
        ["AZSEKER-AZSF::PLF.09.01::2025-03", 12, 1.2, 0.9],
        ["AZSEKER-AZSF::PLF.05.12.06::2025-03", 1_677_014.63, 1_665_000, 0.007],
      ]),
    ])
    expect(got[0].account).toBe("PLF.05.12.06")
    expect(got[0].drift).toBeCloseTo(-12_014.63, 2)
    expect(got[1].account).toBe("PLF.09.01")
  })

  it("pulls the place apart so nobody has to read a composite key", () => {
    const [d] = worstDrifts([
      sheet("BS Actual 2025", "AZSEKER-CPC", [
        ["AZSEKER-CPC::BS.01.02.05::2025-07", 100, 250, 1.5],
      ]),
    ])
    expect(d).toMatchObject({
      entityCode: "AZSEKER-CPC",
      sheetName: "BS Actual 2025",
      account: "BS.01.02.05",
      period: "2025-07",
      expected: 100,
      actual: 250,
      drift: 150,
    })
  })

  it("keeps an account code that contains the separator intact", () => {
    // Truncating to the part before a stray "::" would name a DIFFERENT
    // account, and send someone to the wrong line of the workbook.
    const [d] = worstDrifts([
      sheet("S", "E", [["E::ODD::CODE::2025-01", 10, 20, 1]]),
    ])
    expect(d.account).toBe("ODD::CODE")
    expect(d.period).toBe("2025-01")
  })

  it("drops a key it cannot parse rather than inventing an account", () => {
    expect(worstDrifts([sheet("S", "E", [["nonsense", 10, 20, 1]])])).toEqual([])
  })

  it("drops a line whose figures are not numbers", () => {
    expect(
      worstDrifts([sheet("S", "E", [["E::A::2025-01", NaN, 20, 1]])]),
    ).toEqual([])
  })

  it("collects across sheets and caps the list", () => {
    const got = worstDrifts(
      [
        sheet("A", "E1", [["E1::a::2025-01", 0, 500, 1]]),
        sheet("B", "E2", [["E2::b::2025-01", 0, 900, 1]]),
        sheet("C", "E3", [["E3::c::2025-01", 0, 700, 1]]),
        sheet("D", "E4", [["E4::d::2025-01", 0, 100, 1]]),
      ],
      2,
    )
    expect(got.map((d) => d.actual)).toEqual([900, 700])
  })
})

describe("describeDrift", () => {
  it("shows BOTH sides, because the gap alone does not say who is wrong", () => {
    const [d] = worstDrifts([
      sheet("PLF Actual 2025", "AZSEKER-AZSF", [
        ["AZSEKER-AZSF::PLF.05.12.06::2025-03", 1_677_014.63, 1_665_000, 0.00716],
      ]),
    ])
    const text = describeDrift(d)
    expect(text).toContain("AZSEKER-AZSF · PLF Actual 2025 · PLF.05.12.06 · 2025-03")
    expect(text).toContain("file 1,677,014.63 ₼")
    expect(text).toContain("database 1,665,000.00 ₼")
    expect(text).toContain("-12,014.63 ₼")
    expect(text).toContain("0.7%")
  })

  it("signs a database surplus so the direction is unmistakable", () => {
    const [d] = worstDrifts([
      sheet("S", "E", [["E::A::2025-01", 100, 130, 0.3]]),
    ])
    expect(describeDrift(d)).toContain("+30.00 ₼")
  })

  it("omits an absent entity code instead of printing null", () => {
    const [d] = worstDrifts([sheet("S", null, [["E::A::2025-01", 1, 2, 1]])])
    expect(describeDrift(d).startsWith("S · A · 2025-01")).toBe(true)
  })
})
