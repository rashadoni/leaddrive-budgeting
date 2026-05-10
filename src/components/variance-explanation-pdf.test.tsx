// @vitest-environment node
import { describe, it, expect } from "vitest"
import { VarianceExplanationPdfDoc, type VarianceExplanationPdfProps } from "./variance-explanation-pdf"

describe("VarianceExplanationPdfDoc", () => {
  const baseProps = (overrides: Partial<VarianceExplanationPdfProps> = {}): VarianceExplanationPdfProps => ({
    indicatorCode: "REV_GROWTH",
    indicatorName: "Revenue Growth",
    companyName: "AAC",
    period: "2026",
    value: -10,
    unit: "%",
    status: "red",
    language: "en",
    narrative: "Revenue dropped 10% vs prior period due to seasonal demand decline.",
    recommendations: [
      "Hedge USD exposure with 6-month forward contract",
      "Cut marketing spend by 20% across all channels",
      "Renegotiate cocoa supplier contracts",
    ],
    topDrivers: ["current_revenue", "prev_revenue", "seasonal_index"],
    confidence: 0.78,
    modelName: "claude-sonnet-4-5-20250929",
    promptVersion: "v1",
    ...overrides,
  })

  it("renders without throwing for full props", () => {
    const doc = VarianceExplanationPdfDoc(baseProps())
    expect(doc).toBeDefined()
    expect(doc.type).toBeDefined()
  })

  it("renders for amber status", () => {
    expect(VarianceExplanationPdfDoc(baseProps({ status: "amber" }))).toBeDefined()
  })

  it("renders for unknown status", () => {
    expect(VarianceExplanationPdfDoc(baseProps({ status: "unknown" }))).toBeDefined()
  })

  it("handles 0 recommendations + 0 topDrivers", () => {
    const doc = VarianceExplanationPdfDoc(baseProps({ recommendations: [], topDrivers: [] }))
    expect(doc).toBeDefined()
  })

  it("renders RU language", () => {
    const doc = VarianceExplanationPdfDoc(baseProps({ language: "ru" }))
    expect(doc).toBeDefined()
  })

  it("renders AZ language", () => {
    const doc = VarianceExplanationPdfDoc(baseProps({ language: "az" }))
    expect(doc).toBeDefined()
  })

  it("handles NaN value gracefully", () => {
    const doc = VarianceExplanationPdfDoc(baseProps({ value: NaN }))
    expect(doc).toBeDefined()
  })

  it("renders with custom generatedAt", () => {
    const doc = VarianceExplanationPdfDoc(
      baseProps({ generatedAt: "2026-05-10 21:00:00Z" }),
    )
    expect(doc).toBeDefined()
  })
})
