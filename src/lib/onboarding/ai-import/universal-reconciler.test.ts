import { describe, it, expect } from "vitest"
import {
  reconcileAllSheets,
  decideAction,
} from "./universal-reconciler"

describe("reconcileAllSheets", () => {
  it("emits green when every sheet matches bit-perfect", () => {
    const sheets = [
      {
        sheetName: "PLF CPC",
        dataType: "PLF",
        entityCode: "AZSEKER-CPC",
        expectedSums: new Map([["k1", 100], ["k2", 200]]),
        actualSums: new Map([["k1", 100], ["k2", 200]]),
      },
      {
        sheetName: "BS CPC",
        dataType: "BS",
        entityCode: "AZSEKER-CPC",
        expectedSums: new Map([["b1", 50]]),
        actualSums: new Map([["b1", 50]]),
      },
    ]
    const report = reconcileAllSheets(sheets)
    expect(report.overallVerdict).toBe("green")
    expect(report.summary.greenSheets).toBe(2)
    expect(report.summary.redSheets).toBe(0)
    expect(report.ok).toBe(true)
  })

  it("emits red when any sheet has drift > 1%", () => {
    const sheets = [
      {
        sheetName: "PLF CPC",
        dataType: "PLF",
        entityCode: "AZSEKER-CPC",
        expectedSums: new Map([["k1", 1000]]),
        actualSums: new Map([["k1", 2000]]), // 100% drift
      },
      {
        sheetName: "BS CPC",
        dataType: "BS",
        entityCode: "AZSEKER-CPC",
        expectedSums: new Map([["b1", 50]]),
        actualSums: new Map([["b1", 50]]),
      },
    ]
    const report = reconcileAllSheets(sheets)
    expect(report.overallVerdict).toBe("red")
    expect(report.summary.redSheets).toBe(1)
    expect(report.summary.greenSheets).toBe(1)
    expect(report.ok).toBe(false)
  })

  it("emits yellow when small drift but no red", () => {
    const sheets = [
      {
        sheetName: "Sales",
        dataType: "SALES",
        entityCode: "AZSEKER-EDEN",
        expectedSums: new Map([["k1", 10000]]),
        actualSums: new Map([["k1", 10050]]), // 0.5% drift
      },
    ]
    const report = reconcileAllSheets(sheets)
    expect(report.overallVerdict).toBe("yellow")
    expect(report.ok).toBe(true)
  })

  it("reports missing/extra keys per sheet", () => {
    const sheets = [
      {
        sheetName: "PLF",
        dataType: "PLF",
        entityCode: "AZSEKER-CPC",
        expectedSums: new Map([
          ["k1", 100],
          ["k2", 200],
          ["k3", 300],
        ]),
        actualSums: new Map([
          ["k1", 100],
          ["k4", 999],
        ]),
      },
    ]
    const report = reconcileAllSheets(sheets)
    expect(report.perSheet[0].missingCount).toBe(2) // k2, k3
    expect(report.perSheet[0].extraCount).toBe(1) // k4
    expect(report.perSheet[0].topMissing).toEqual(["k2", "k3"])
    expect(report.perSheet[0].topExtra).toEqual(["k4"])
    expect(report.overallVerdict).toBe("red")
  })

  it("caps drift details at 5 per sheet", () => {
    const expected = new Map<string, number>()
    const actual = new Map<string, number>()
    for (let i = 0; i < 20; i++) {
      expected.set(`k${i}`, 100)
      actual.set(`k${i}`, 200) // all drift
    }
    const report = reconcileAllSheets([
      {
        sheetName: "X",
        dataType: "PLF",
        entityCode: null,
        expectedSums: expected,
        actualSums: actual,
      },
    ])
    expect(report.perSheet[0].driftCount).toBe(20)
    expect(report.perSheet[0].topDrift.length).toBe(5)
  })

  it("handles empty sheet list (no data)", () => {
    const report = reconcileAllSheets([])
    expect(report.overallVerdict).toBe("green")
    expect(report.summary.totalSheets).toBe(0)
    expect(report.ok).toBe(true)
  })
})

describe("decideAction", () => {
  it("commits on green", () => {
    const report = reconcileAllSheets([
      {
        sheetName: "X",
        dataType: "PLF",
        entityCode: null,
        expectedSums: new Map([["k", 100]]),
        actualSums: new Map([["k", 100]]),
      },
    ])
    expect(decideAction(report)).toBe("commit")
  })

  it("aborts on red", () => {
    const report = reconcileAllSheets([
      {
        sheetName: "X",
        dataType: "PLF",
        entityCode: null,
        expectedSums: new Map([["k", 1000]]),
        actualSums: new Map([["k", 2000]]),
      },
    ])
    expect(decideAction(report)).toBe("abort")
    expect(decideAction(report, { allowYellow: true })).toBe("abort")
  })

  it("aborts on yellow by default, commits-with-warning when allowYellow", () => {
    const report = reconcileAllSheets([
      {
        sheetName: "X",
        dataType: "SALES",
        entityCode: null,
        expectedSums: new Map([["k", 10000]]),
        actualSums: new Map([["k", 10050]]), // 0.5% drift = yellow
      },
    ])
    expect(decideAction(report)).toBe("abort")
    expect(decideAction(report, { allowYellow: true })).toBe(
      "commit_with_warning",
    )
  })
})
