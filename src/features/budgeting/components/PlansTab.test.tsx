// @vitest-environment happy-dom
import React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { hooks, mutation } = vi.hoisted(() => {
  const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
  return {
    mutation,
    hooks: {
      useBudgetPlans: vi.fn(),
      useUpdateBudgetPlan: vi.fn(() => mutation),
      useDeleteBudgetPlan: vi.fn(() => mutation),
      useBudgetVersions: vi.fn(),
      useCreateBudgetVersion: vi.fn(() => mutation),
      useBudgetDiff: vi.fn(),
      useCreateRollingPlan: vi.fn(() => mutation),
      useExchangeRates: vi.fn(),
    },
  }
})

vi.mock("@/lib/budgeting/hooks", () => hooks)
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "admin", organizationId: "org-1" } } }) }))
vi.mock("next-intl", () => {
  const translator = (key: string, vars?: Record<string, unknown>) => {
    if (key === "plansLinesCount") return `${vars?.count} live lines`
    return key
  }
  translator.raw = (key: string) => key
  return { useLocale: () => "en", useTranslations: () => translator }
})
vi.mock("@/components/budget-approval-workflow", () => ({ BudgetApprovalWorkflow: () => <div data-testid="plans-approval-workflow" /> }))
vi.mock("@/components/budget-approval-history", () => ({ BudgetApprovalHistory: () => <div data-testid="plans-approval-history" /> }))
vi.mock("@/components/budget-version-history", () => ({ BudgetVersionHistory: ({ canCompare }: { canCompare: boolean }) => <div data-testid="plans-version-history" data-can-compare={String(canCompare)} /> }))
vi.mock("@/components/budget-version-diff", () => ({ BudgetVersionDiff: () => <div data-testid="plans-version-diff" /> }))

import { PlansTab } from "./PlansTab"

const query = <T,>(data: T, overrides: Record<string, unknown> = {}) => ({ data, isLoading: false, error: null, ...overrides })
const basePlan = {
  id: "p1",
  organizationId: "org-1",
  name: "FY26",
  periodType: "annual" as const,
  year: 2026,
  month: null,
  quarter: null,
  status: "draft" as const,
  kind: "budget" as const,
  _count: { lines: 12 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

beforeEach(() => {
  mutation.mutate.mockReset()
  mutation.mutateAsync.mockReset()
  hooks.useBudgetPlans.mockReset().mockReturnValue(query([basePlan]))
  hooks.useBudgetVersions.mockReset().mockReturnValue(query([]))
  hooks.useBudgetDiff.mockReset().mockReturnValue(query(null))
  hooks.useExchangeRates.mockReset().mockReturnValue(query({ currencies: [] }))
})

afterEach(cleanup)

describe("PlansTab evidence boundaries", () => {
  it("fails closed when plans cannot be loaded", () => {
    hooks.useBudgetPlans.mockReturnValue(query([], { error: new Error("boom") }))
    render(<PlansTab activePlanId="" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    expect(screen.getByTestId("plans-error")).toBeTruthy()
    expect(screen.queryByText("noPlansCardTitle")).toBeNull()
  })

  it("distinguishes populated, evidenced-empty and unknown line counts", () => {
    hooks.useBudgetPlans.mockReturnValue(query([
      basePlan,
      { ...basePlan, id: "p2", name: "Actual", kind: "actual", _count: { lines: 0 } },
      { ...basePlan, id: "p3", name: "Legacy", kind: undefined, _count: undefined },
    ]))
    render(<PlansTab activePlanId="p1" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    expect(screen.getByTestId("plans-evidence-p1").textContent).toContain("12 live lines")
    expect(screen.getByTestId("plans-evidence-p2").textContent).toContain("plansLinesEmpty")
    expect(screen.getByTestId("plans-evidence-p3").textContent).toContain("plansLinesUnknown")
    expect(screen.getByTestId("plans-evidence-p1").textContent).toContain("plansKindBudget")
    expect(screen.getByTestId("plans-evidence-p2").textContent).toContain("plansKindActual")
    expect(screen.getByTestId("plans-evidence-p3").textContent).toContain("plansKindUnknown")
  })

  it("does not expose create-version while version evidence is loading or failed", () => {
    hooks.useBudgetVersions.mockReturnValue(query([], { isLoading: true }))
    const view = render(<PlansTab activePlanId="p1" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    expect(screen.getByTestId("plans-version-loading")).toBeTruthy()
    expect(screen.queryByText("plansCreateVersionButton")).toBeNull()
    view.unmount()

    hooks.useBudgetVersions.mockReturnValue(query([], { error: new Error("boom") }))
    render(<PlansTab activePlanId="p1" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    expect(screen.getByTestId("plans-version-error")).toBeTruthy()
    expect(screen.queryByText("plansCreateVersionButton")).toBeNull()
  })

  it("keeps the guide hover-only: hovering evidence triggers no mutation", () => {
    render(<PlansTab activePlanId="p1" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    fireEvent.mouseOver(screen.getByTestId("plans-evidence-p1"))
    fireEvent.mouseOver(screen.getByTestId("plans-readonly-disclosure"))
    expect(mutation.mutate).not.toHaveBeenCalled()
    expect(mutation.mutateAsync).not.toHaveBeenCalled()
    expect(document.querySelectorAll("[data-write-control]").length).toBeGreaterThan(0)
  })

  it("hides cached currency and diff evidence after either query fails", () => {
    const version = { id: "v1", name: "FY26", status: "draft", version: 1, versionLabel: "v1", amendmentOf: null, kind: "budget", _count: { lines: 12 }, createdAt: "2026-01-01T00:00:00.000Z", approvedAt: null, approvedBy: null }
    const diff = { planA: "v1", planB: "v2", totalChanges: 1, diff: [] }
    hooks.useBudgetVersions.mockReturnValue(query([version]))
    hooks.useBudgetDiff.mockReturnValue(query(diff))
    hooks.useExchangeRates.mockReturnValue(query({ currencies: [{ code: "USD", isBase: true }] }, { error: new Error("stale") }))

    const view = render(<PlansTab activePlanId="p1" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    expect(screen.getByTestId("plans-currency-scope").textContent).toBe("plansCurrencyLoadError")
    expect(screen.getByTestId("plans-version-history").getAttribute("data-can-compare")).toBe("false")
    expect(screen.queryByTestId("plans-version-diff")).toBeNull()
    view.unmount()

    hooks.useExchangeRates.mockReturnValue(query({ currencies: [{ code: "USD", isBase: true }] }))
    hooks.useBudgetDiff.mockReturnValue(query(diff, { error: new Error("stale diff") }))
    render(<PlansTab activePlanId="p1" onSelect={vi.fn()} onShowCreate={vi.fn()} />)
    expect(screen.queryByTestId("plans-version-diff")).toBeNull()
    expect(screen.getByText("plansDiffLoadError")).toBeTruthy()
  })
})
