// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"

afterEach(cleanup)
import type { MappingProposal, SourceColumn, ColumnMappingProposal } from "@/lib/onboarding/ai-mapper/types"
import { MappingReviewTable } from "./MappingReviewTable"

const proposal: MappingProposal = {
  sourceFile: "x.xlsx",
  sourceSheet: "PL",
  columns: [
    { sourceIndex: 0, role: "code", confidence: 0.9, reasoning: "codes" },
    { sourceIndex: 1, role: "skip", confidence: 0.4, reasoning: "unsure" },
  ],
  anomalies: [{ row: 5, severity: "warning", category: "sign_inversion", description: "neg revenue" }],
  overallConfidence: 0.65,
  summary: "P&L sheet",
}
const sourceColumns: SourceColumn[] = [
  { index: 0, headerText: "Kod", samples: ["601", "602"] },
  { index: 1, headerText: "Qeyd", samples: ["note"] },
]

describe("MappingReviewTable", () => {
  it("renders columns, samples, anomalies and the low-confidence warning", () => {
    render(
      <MappingReviewTable
        proposal={proposal}
        sourceColumns={sourceColumns}
        edited={proposal.columns.map((c) => ({ ...c }))}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText("Kod")).toBeTruthy()
    expect(screen.getByText("Qeyd")).toBeTruthy()
    expect(screen.getByText(/neg revenue/)).toBeTruthy()
    // 1 column < 0.6 → low-confidence note
    expect(screen.getByText(/низкой уверенностью/)).toBeTruthy()
  })

  it("calls onChange with the new role when a select changes", () => {
    const onChange = vi.fn()
    const edited: ColumnMappingProposal[] = proposal.columns.map((c) => ({ ...c }))
    render(
      <MappingReviewTable
        proposal={proposal}
        sourceColumns={sourceColumns}
        edited={edited}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText("Роль колонки 0"), { target: { value: "label" } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as ColumnMappingProposal[]
    expect(next.find((c) => c.sourceIndex === 0)?.role).toBe("label")
    // other column untouched
    expect(next.find((c) => c.sourceIndex === 1)?.role).toBe("skip")
  })
})
