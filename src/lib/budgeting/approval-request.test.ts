// @vitest-environment node
/**
 * Phase 7.G Turn LXXI — guard tests for approval-request state machine.
 */

import { describe, it, expect } from "vitest"
import {
  canTransition,
  nextStatus,
  isTerminalStatus,
  isValidProposedChange,
} from "./approval-request"

describe("canTransition — state machine", () => {
  it("pending → approve/reject/cancel all legal", () => {
    expect(canTransition("pending", "approve")).toBe(true)
    expect(canTransition("pending", "reject")).toBe(true)
    expect(canTransition("pending", "cancel")).toBe(true)
  })

  it("terminal states block all transitions", () => {
    for (const status of ["approved", "rejected", "cancelled"] as const) {
      expect(canTransition(status, "approve")).toBe(false)
      expect(canTransition(status, "reject")).toBe(false)
      expect(canTransition(status, "cancel")).toBe(false)
    }
  })
})

describe("nextStatus — action → terminal mapping", () => {
  it("approve → approved", () => {
    expect(nextStatus("approve")).toBe("approved")
  })
  it("reject → rejected", () => {
    expect(nextStatus("reject")).toBe("rejected")
  })
  it("cancel → cancelled", () => {
    expect(nextStatus("cancel")).toBe("cancelled")
  })
})

describe("isTerminalStatus", () => {
  it("identifies all 3 terminal states", () => {
    expect(isTerminalStatus("approved")).toBe(true)
    expect(isTerminalStatus("rejected")).toBe(true)
    expect(isTerminalStatus("cancelled")).toBe(true)
  })

  it("pending is NOT terminal", () => {
    expect(isTerminalStatus("pending")).toBe(false)
  })
})

describe("isValidProposedChange — shape guards", () => {
  it("returns false for null/undefined/non-object", () => {
    expect(isValidProposedChange("budget_line_create", null)).toBe(false)
    expect(isValidProposedChange("budget_line_create", undefined)).toBe(false)
    expect(isValidProposedChange("budget_line_create", "string")).toBe(false)
    expect(isValidProposedChange("budget_line_create", 42)).toBe(false)
  })

  it("budget_line_create requires category + lineType", () => {
    expect(isValidProposedChange("budget_line_create", { category: "Sales", lineType: "revenue" })).toBe(true)
    expect(isValidProposedChange("budget_line_create", { category: "Sales" })).toBe(false)
    expect(isValidProposedChange("budget_line_create", { lineType: "revenue" })).toBe(false)
    expect(isValidProposedChange("budget_line_create", { category: 42, lineType: "revenue" })).toBe(false)
  })

  it("budget_actual_create requires category + lineType + actualAmount as number", () => {
    expect(
      isValidProposedChange("budget_actual_create", {
        category: "Sales",
        lineType: "revenue",
        actualAmount: 100,
      }),
    ).toBe(true)
    // Missing actualAmount
    expect(
      isValidProposedChange("budget_actual_create", { category: "Sales", lineType: "revenue" }),
    ).toBe(false)
    // actualAmount as string fails (must be number)
    expect(
      isValidProposedChange("budget_actual_create", {
        category: "Sales",
        lineType: "revenue",
        actualAmount: "100",
      }),
    ).toBe(false)
  })

  it("update requests require fieldChanges object", () => {
    expect(isValidProposedChange("budget_line_update", { fieldChanges: { plannedAmount: { from: 100, to: 200 } } })).toBe(true)
    expect(isValidProposedChange("budget_line_update", { fieldChanges: null })).toBe(false)
    expect(isValidProposedChange("budget_line_update", {})).toBe(false)
    expect(isValidProposedChange("budget_actual_update", { fieldChanges: { actualAmount: { from: 50, to: 75 } } })).toBe(true)
  })

  it("delete requests require snapshot object", () => {
    expect(isValidProposedChange("budget_line_delete", { snapshot: { id: "x", category: "Y" } })).toBe(true)
    expect(isValidProposedChange("budget_line_delete", { snapshot: null })).toBe(false)
    expect(isValidProposedChange("budget_line_delete", {})).toBe(false)
  })

  it("period_unlock requires period in valid format", () => {
    expect(isValidProposedChange("period_unlock", { period: "2026" })).toBe(true)
    expect(isValidProposedChange("period_unlock", { period: "2026-Q1" })).toBe(true)
    expect(isValidProposedChange("period_unlock", { period: "2026-03" })).toBe(true)
    // Invalid formats
    expect(isValidProposedChange("period_unlock", { period: "2026-Q5" })).toBe(false)
    expect(isValidProposedChange("period_unlock", { period: "2026-13" })).toBe(false)
    expect(isValidProposedChange("period_unlock", { period: "not-a-period" })).toBe(false)
    expect(isValidProposedChange("period_unlock", { period: "" })).toBe(false)
  })
})
