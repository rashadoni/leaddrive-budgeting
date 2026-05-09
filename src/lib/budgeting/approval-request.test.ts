// @vitest-environment node
/**
 * Phase 7.G Turn LXXI — guard tests for approval-request state machine.
 */

import { describe, it, expect, vi } from "vitest"
import {
  canTransition,
  nextStatus,
  isTerminalStatus,
  isValidProposedChange,
  consumeApprovalRequest,
  markApprovalRequestApplied,
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

describe("consumeApprovalRequest — mutation-route bypass guard (Turn LXXII)", () => {
  const APPROVED_REQUEST: Record<string, unknown> = {
    id: "req1",
    organizationId: "org_demo",
    requestType: "budget_line_create",
    status: "approved",
    requestedBy: "u_requester",
    targetType: null,
    targetId: null,
    appliedAt: null,
  }

  function buildPrismaMock(overrides: Record<string, unknown> | null) {
    const findFirst = vi.fn().mockResolvedValue(overrides ? { ...APPROVED_REQUEST, ...overrides } : null)
    return { approvalRequest: { findFirst } } as unknown as Parameters<typeof consumeApprovalRequest>[0]
  }

  it("returns the request on full match (approved + type + requester + not-applied)", async () => {
    const result = await consumeApprovalRequest(buildPrismaMock({}), {
      requestId: "req1",
      orgId: "org_demo",
      userId: "u_requester",
      expectedType: "budget_line_create",
    })
    expect(result).not.toBeNull()
    expect(result?.id).toBe("req1")
  })

  it("returns null when request not found (or in different org)", async () => {
    const result = await consumeApprovalRequest(buildPrismaMock(null), {
      requestId: "req_missing",
      orgId: "org_demo",
      userId: "u_requester",
      expectedType: "budget_line_create",
    })
    expect(result).toBeNull()
  })

  it("returns null when status is not approved", async () => {
    for (const status of ["pending", "rejected", "cancelled"]) {
      const result = await consumeApprovalRequest(buildPrismaMock({ status }), {
        requestId: "req1",
        orgId: "org_demo",
        userId: "u_requester",
        expectedType: "budget_line_create",
      })
      expect(result).toBeNull()
    }
  })

  it("returns null when requestType doesn't match", async () => {
    const result = await consumeApprovalRequest(buildPrismaMock({ requestType: "budget_line_update" }), {
      requestId: "req1",
      orgId: "org_demo",
      userId: "u_requester",
      expectedType: "budget_line_create",
    })
    expect(result).toBeNull()
  })

  it("returns null when caller is NOT the original requester (cross-user safe)", async () => {
    const result = await consumeApprovalRequest(buildPrismaMock({}), {
      requestId: "req1",
      orgId: "org_demo",
      userId: "u_other",
      expectedType: "budget_line_create",
    })
    expect(result).toBeNull()
  })

  it("returns null when request was already applied (one-shot enforcement)", async () => {
    const result = await consumeApprovalRequest(
      buildPrismaMock({ appliedAt: new Date("2026-05-09T00:00:00Z") }),
      {
        requestId: "req1",
        orgId: "org_demo",
        userId: "u_requester",
        expectedType: "budget_line_create",
      },
    )
    expect(result).toBeNull()
  })

  it("returns null when expectedTargetId mismatches request.targetId", async () => {
    const result = await consumeApprovalRequest(
      buildPrismaMock({ requestType: "budget_line_update", targetId: "ln_real" }),
      {
        requestId: "req1",
        orgId: "org_demo",
        userId: "u_requester",
        expectedType: "budget_line_update",
        expectedTargetId: "ln_other",
      },
    )
    expect(result).toBeNull()
  })

  it("matches when expectedTargetId equals request.targetId", async () => {
    const result = await consumeApprovalRequest(
      buildPrismaMock({ requestType: "budget_line_update", targetId: "ln_real" }),
      {
        requestId: "req1",
        orgId: "org_demo",
        userId: "u_requester",
        expectedType: "budget_line_update",
        expectedTargetId: "ln_real",
      },
    )
    expect(result).not.toBeNull()
  })
})

describe("markApprovalRequestApplied — sets appliedAt", () => {
  it("calls update with current Date for appliedAt", async () => {
    const update = vi.fn().mockResolvedValue({})
    const prismaMock = { approvalRequest: { update } } as unknown as Parameters<
      typeof markApprovalRequestApplied
    >[0]
    await markApprovalRequestApplied(prismaMock, "req1")
    expect(update).toHaveBeenCalledTimes(1)
    const arg = update.mock.calls[0][0]
    expect(arg.where.id).toBe("req1")
    expect(arg.data.appliedAt).toBeInstanceOf(Date)
  })
})
