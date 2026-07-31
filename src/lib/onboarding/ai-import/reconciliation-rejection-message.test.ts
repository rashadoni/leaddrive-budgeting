/**
 * 11.58 — a rejection has to carry its own evidence.
 *
 * The abort message read:
 *
 *   Post-write reconciliation rejected (verdict=red, drifted sheets=A, B, C)
 *
 * Names only. When it fired on production 2026-07-31 it took a four-lens code
 * audit to establish that balance-sheet recon keys were entity-prefixed on the
 * expected side and bare on the read-back side (11.51) — a fact the report
 * ALREADY carried in `topMissing`/`topExtra` and the message threw away.
 *
 * The two fixtures below are the two real failure shapes from that incident.
 * Each test asserts the message contains what a reader needs to tell them
 * apart WITHOUT opening the source.
 */
import { describe, it, expect } from "vitest"
import {
  describeReconciliationRejection,
  type SheetReconciliationResult,
  type UniversalReconciliationReport,
} from "./universal-reconciler"

function sheet(
  over: Partial<SheetReconciliationResult> = {},
): SheetReconciliationResult {
  return {
    sheetName: "book.xlsx::Sheet",
    dataType: "PLF",
    entityCode: "AZSEKER-CPC",
    verdict: "green",
    matched: 10,
    driftCount: 0,
    missingCount: 0,
    extraCount: 0,
    topDrift: [],
    topMissing: [],
    topExtra: [],
    ...over,
  }
}

function report(
  perSheet: SheetReconciliationResult[],
  overallVerdict: "green" | "yellow" | "red" = "red",
): UniversalReconciliationReport {
  return {
    overallVerdict,
    perSheet,
    summary: {
      totalSheets: perSheet.length,
      greenSheets: perSheet.filter((s) => s.verdict === "green").length,
      yellowSheets: perSheet.filter((s) => s.verdict === "yellow").length,
      redSheets: perSheet.filter((s) => s.verdict === "red").length,
    },
    ok: overallVerdict !== "red",
  }
}

/** Shape 1 (the 11.51 BS defect): keys never intersect. */
const KEY_MISMATCH = sheet({
  sheetName: "actual-budget-v1.xlsx::BS Actual 2026 [AZSEKER-AZSF]",
  dataType: "BS",
  verdict: "red",
  matched: 0,
  missingCount: 235,
  extraCount: 235,
  topMissing: ["plan1::AZSEKER-AZSF-BS.01.01.01::2026-03"],
  topExtra: ["plan1::BS.01.01.01::2026-03"],
})

/** Shape 2 (the 11.51 P&L defect): keys agree, amounts do not. */
const AMOUNT_DRIFT = sheet({
  sheetName: "actual-budget-v1.xlsx::PLF Budget 2026 [AZSEKER-CPC]",
  verdict: "red",
  matched: 300,
  driftCount: 1,
  topDrift: [
    {
      key: "AZSEKER-CPC::PLF.01.01.01::2026-04",
      expected: 300,
      actual: 1300,
      driftPct: 3.33,
    },
  ],
})

describe("describeReconciliationRejection", () => {
  it("distinguishes a KEY-SPACE mismatch by quoting one key from each side", () => {
    // The whole 11.51 diagnosis, readable in the message: matched 0, equal
    // missing/extra, and two keys that differ only by the entity prefix.
    const msg = describeReconciliationRejection(report([KEY_MISMATCH]))

    expect(msg).toContain("0 matched")
    expect(msg).toContain("235 missing")
    expect(msg).toContain("235 extra")
    expect(msg).toContain("plan1::AZSEKER-AZSF-BS.01.01.01::2026-03")
    expect(msg).toContain("plan1::BS.01.01.01::2026-03")
  })

  it("distinguishes an AMOUNT drift by quoting expected against actual", () => {
    const msg = describeReconciliationRejection(report([AMOUNT_DRIFT]))

    expect(msg).toContain("300 matched")
    expect(msg).toContain("1 drifted")
    expect(msg).toContain("AZSEKER-CPC::PLF.01.01.01::2026-04")
    expect(msg).toContain("expected 300")
    expect(msg).toContain("got 1300")
  })

  it("names the failing sheets and skips the green ones", () => {
    const msg = describeReconciliationRejection(
      report([sheet(), KEY_MISMATCH, sheet({ sheetName: "book.xlsx::Fine" })]),
    )

    expect(msg).toContain("BS Actual 2026 [AZSEKER-AZSF]")
    expect(msg).toContain("1 sheet(s) failed")
    expect(msg).not.toContain("book.xlsx::Fine")
  })

  it("stays bounded — a wide failure cannot produce an unreadable log line", () => {
    // The live incident failed 8 sheets at once; a 60-entity holding could
    // fail hundreds. An exception message is not a report.
    const many = Array.from({ length: 40 }, (_, i) =>
      sheet({ sheetName: `book.xlsx::Sheet${i}`, verdict: "red", matched: 0 }),
    )
    const msg = describeReconciliationRejection(report(many))

    expect(msg).toContain("40 sheet(s) failed")
    expect(msg).toContain("+34 more sheet(s)")
    expect(msg).not.toContain("Sheet39")
    expect(msg.length).toBeLessThan(2000)
  })

  it("prints a decimal amount without losing the qəpik", () => {
    const msg = describeReconciliationRejection(
      report([
        sheet({
          verdict: "red",
          driftCount: 1,
          topDrift: [
            { key: "k", expected: 1234567.89, actual: 1234567.9, driftPct: 0 },
          ],
        }),
      ]),
    )
    expect(msg).toContain("expected 1234567.89")
    expect(msg).toContain("got 1234567.90")
  })

  it("degrades honestly when nothing is actually red", () => {
    // Defensive: never invent detail that is not there.
    const msg = describeReconciliationRejection(report([sheet()], "red"))
    expect(msg).toContain("0 sheet(s) failed")
  })
})
