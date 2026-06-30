import { describe, expect, it } from "vitest"
import { pickDefaultAnalysisSheet, type SheetClassificationCandidate } from "./sheet-selection"

const sheet = (
  sheetName: string,
  dataType = "PLF",
  confidence = 0.8,
): SheetClassificationCandidate => ({
  sheetName,
  dataType,
  confidence,
})

describe("pickDefaultAnalysisSheet", () => {
  it("prefers the target-year PLF sheet over a higher-confidence previous-year PLF", () => {
    expect(
      pickDefaultAnalysisSheet(
        [
          sheet("PLF Actual 2025", "PLF", 0.95),
          sheet("PLF Actual 2026", "PLF", 0.81),
        ],
        2026,
      ),
    ).toBe("PLF Actual 2026")
  })

  it("keeps the old confidence-first PLF fallback when no target-year PLF exists", () => {
    expect(
      pickDefaultAnalysisSheet(
        [
          sheet("PLF Actual 2025", "PLF", 0.95),
          sheet("Balance Sheet 2026", "BS", 0.99),
          sheet("PLF Budget", "PLF", 0.7),
        ],
        2026,
      ),
    ).toBe("PLF Actual 2025")
  })

  it("uses the highest-confidence PLF when no preferred year is provided", () => {
    expect(
      pickDefaultAnalysisSheet([
        sheet("PLF Actual 2025", "PLF", 0.95),
        sheet("PLF Actual 2026", "PLF", 0.81),
      ]),
    ).toBe("PLF Actual 2025")
  })
})
