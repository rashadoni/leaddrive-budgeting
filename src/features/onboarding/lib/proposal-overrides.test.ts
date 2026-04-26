import { describe, it, expect } from "vitest"
import type { ColumnMappingProposal } from "@/lib/onboarding/ai-mapper/types"
import {
  diffColumnOverrides,
  buildUserOverrides,
  confidenceBand,
} from "./proposal-overrides"

const col = (
  i: number,
  role: ColumnMappingProposal["role"],
  conf = 0.9,
): ColumnMappingProposal => ({
  sourceIndex: i,
  role,
  confidence: conf,
  reasoning: "AI",
})

describe("diffColumnOverrides", () => {
  it("returns empty when nothing changed", () => {
    const orig = [col(0, "code"), col(1, "label"), col(2, "amount:Jan")]
    const edited = [...orig]
    expect(diffColumnOverrides(orig, edited)).toEqual([])
  })

  it("includes only the changed column with confidence=1 and override note", () => {
    const orig = [col(0, "code"), col(1, "skip"), col(2, "amount:Jan")]
    const edited = [col(0, "code"), col(1, "label"), col(2, "amount:Jan")]
    const diff = diffColumnOverrides(orig, edited)
    expect(diff).toHaveLength(1)
    expect(diff[0]).toMatchObject({
      sourceIndex: 1,
      role: "label",
      confidence: 1,
    })
    expect(diff[0].reasoning).toContain("skip")
  })

  it("handles multiple changes", () => {
    const orig = [col(0, "code"), col(1, "label"), col(2, "skip")]
    const edited = [
      col(0, "code"),
      col(1, "amount:Total"),
      col(2, "amount:Plan"),
    ]
    expect(diffColumnOverrides(orig, edited)).toHaveLength(2)
  })

  it("treats edited columns missing from original as overrides", () => {
    // Defensive: if the edited array somehow has a column the original
    // didn't, we still record it (rather than silently drop) — the user
    // expressed intent, surface it.
    const orig = [col(0, "code")]
    const edited = [col(0, "code"), col(5, "amount:Jan")]
    const diff = diffColumnOverrides(orig, edited)
    expect(diff).toHaveLength(1)
    expect(diff[0].sourceIndex).toBe(5)
    expect(diff[0].reasoning).toBe("Manual override")
  })
})

describe("buildUserOverrides", () => {
  const baseProposal = (cols: ColumnMappingProposal[]) => ({
    sourceFile: "x.xlsx",
    sourceSheet: "S",
    columns: cols,
    anomalies: [],
    overallConfidence: 0.9,
    summary: "ok",
  })

  it("returns undefined when proposal is untouched", () => {
    const proposal = baseProposal([col(0, "code")])
    expect(
      buildUserOverrides(proposal, [...proposal.columns]),
    ).toBeUndefined()
  })

  it("returns columns array with only changed entries", () => {
    const proposal = baseProposal([col(0, "code"), col(1, "skip")])
    const edited = [col(0, "code"), col(1, "label")]
    const out = buildUserOverrides(proposal, edited)
    expect(out).toBeDefined()
    expect(out!.columns).toHaveLength(1)
    expect(out!.columns![0].sourceIndex).toBe(1)
  })
})

describe("confidenceBand", () => {
  it.each([
    [1, "high"],
    [0.85, "high"],
    [0.84, "med"],
    [0.6, "med"],
    [0.59, "low"],
    [0, "low"],
  ] as const)("classifies %s as %s", (input, expected) => {
    expect(confidenceBand(input)).toBe(expected)
  })
})
