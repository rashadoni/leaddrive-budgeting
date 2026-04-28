// @vitest-environment happy-dom
/**
 * Phase C6 v2 — smoke + behavior tests for `AlertsPanel` modal.
 *
 * What is locked in:
 *  - Initial render: closed (returns null) until `terminal:open-alerts`.
 *  - Opens on event with role=dialog + aria-label.
 *  - `null` matches (matrix not loaded) → loading message.
 *  - Empty matches array → "all systems green" empty-state.
 *  - Populated matches: renders one section per severity in
 *    critical → warning → info order; sections labeled correctly.
 *  - Clicking a company chip calls `selectCompany(code)` AND closes modal.
 *  - Escape closes; backdrop click closes; close-X button closes.
 *  - Listener cleanup on unmount.
 */

import React from "react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { AlertsPanel } from "./AlertsPanel";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

// Mock the store so we can control alertMatches + capture selectCompany.
const selectCompanyMock = vi.fn();
let mockMatches:
  | null
  | Array<{
      ruleId: string;
      ruleName: string;
      severity: "critical" | "warning" | "info";
      message: string;
      affectedCompanyIds: readonly string[];
      affectedIndicatorCodes?: readonly string[];
    }> = null;

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      alertMatches: typeof mockMatches;
      selectCompany: typeof selectCompanyMock;
    }) => T,
  ) => selector({ alertMatches: mockMatches, selectCompany: selectCompanyMock }),
}));

beforeEach(() => {
  mockMatches = null;
  selectCompanyMock.mockReset();
  // Sub-19: reset useCompanies module cache between tests so each
  // test's fetch mock controls the resolved data (without this the
  // first test's payload sticks for the rest of the file).
  __resetCompaniesCacheForTests();
  // Mock /api/companies fetch — flat array shape with id+code.
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/companies")) {
      return new Response(
        JSON.stringify([
          { id: "co_a_id", code: "AAC-MAIN" },
          { id: "co_b_id", code: "ATL-DBZ" },
          { id: "co_c_id", code: "SPARK-MAIN" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-alerts"));
  });
}

describe("AlertsPanel (Phase C6 v2)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<AlertsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-alerts` event with role=dialog + aria-label", () => {
    render(<AlertsPanel />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Alerts panel");
  });

  it("shows loading message when alertMatches is null (matrix not loaded yet)", () => {
    mockMatches = null;
    render(<AlertsPanel />);
    fireOpen();
    expect(screen.getByTestId("alerts-loading")).toBeTruthy();
  });

  it("shows empty-state when no rules triggered", () => {
    mockMatches = [];
    render(<AlertsPanel />);
    fireOpen();
    const empty = screen.getByTestId("alerts-empty");
    expect(empty.textContent).toContain("No alerts triggered");
  });

  it("renders sections grouped by severity in critical→warning→info order", () => {
    mockMatches = [
      {
        ruleId: "crit-rule",
        ruleName: "Critical Rule",
        severity: "critical",
        message: "Critical message",
        affectedCompanyIds: ["co_a_id"],
      },
      {
        ruleId: "warn-rule",
        ruleName: "Warning Rule",
        severity: "warning",
        message: "Warning message",
        affectedCompanyIds: ["co_b_id"],
      },
    ];
    render(<AlertsPanel />);
    fireOpen();
    const critSection = screen.getByLabelText("Critical alerts");
    const warnSection = screen.getByLabelText("Warning alerts");
    expect(critSection).toBeTruthy();
    expect(warnSection).toBeTruthy();
    // Critical comes BEFORE warning in the DOM order.
    const dialog = screen.getByRole("dialog");
    const critPos = dialog.innerHTML.indexOf("Critical Rule");
    const warnPos = dialog.innerHTML.indexOf("Warning Rule");
    expect(critPos).toBeGreaterThan(-1);
    expect(warnPos).toBeGreaterThan(-1);
    expect(critPos).toBeLessThan(warnPos);
  });

  it("clicking a company chip calls selectCompany(code) and closes modal", async () => {
    mockMatches = [
      {
        ruleId: "crit-rule",
        ruleName: "Critical Rule",
        severity: "critical",
        message: "msg",
        affectedCompanyIds: ["co_a_id"],
      },
    ];
    render(<AlertsPanel />);
    fireOpen();
    // Wait for /api/companies fetch + state update before chip becomes enabled.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const chip = screen.getByText("AAC-MAIN");
    expect((chip as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(chip);
    expect(selectCompanyMock).toHaveBeenCalledWith("AAC-MAIN");
    // Modal dismissed.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the modal", () => {
    mockMatches = [];
    render(<AlertsPanel />);
    fireOpen();
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner panel click does NOT", () => {
    mockMatches = [];
    render(<AlertsPanel />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    // Inner click on header — should NOT close.
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Backdrop click (target === currentTarget).
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button (X) dismisses modal", () => {
    mockMatches = [];
    render(<AlertsPanel />);
    fireOpen();
    const closeBtn = screen.getByLabelText("Close alerts panel");
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-alerts listener on unmount", () => {
    mockMatches = [];
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<AlertsPanel />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-alerts",
    );
    expect(removed).toBe(true);
  });

  // REGRESSION: architect Round-1 sub-16 ⚠️ closure — empty-companies
  // tenant (newly-onboarded, /api/companies returns []) must NOT leave
  // the loading pill stuck on. `companiesFetched` boolean now tracks
  // resolution separately from idToCode.size.
  it("loading pill clears when /api/companies resolves with empty array (zero-co tenant)", async () => {
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    mockMatches = [
      {
        ruleId: "crit-rule",
        ruleName: "Critical Rule",
        severity: "critical",
        message: "msg",
        affectedCompanyIds: ["co_a_id"],
      },
    ];
    render(<AlertsPanel />);
    fireOpen();
    // Wait for fetch resolution + companiesFetched flip.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Loading pill must be gone (was: stuck-on permanently pre-fix).
    expect(screen.queryByTestId("alerts-codes-loading")).toBeNull();
    // Chip renders with truncated id (no code in empty map).
    expect(screen.getByText(/^co_a_id/)).toBeTruthy();
  });

  // REGRESSION: architect Round-1 sub-10 closure (sub-16) — chips show
  // "Loading codes…" pill BEFORE /api/companies resolves, NOT N
  // disabled `unknown_xxx…` chips flashing for 50-200ms.
  it("shows 'Loading codes…' pill before /api/companies resolves", () => {
    // Block fetch — never resolves during this test.
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(() => new Promise(() => {})) as never;
    mockMatches = [
      {
        ruleId: "crit-rule",
        ruleName: "Critical Rule",
        severity: "critical",
        message: "msg",
        affectedCompanyIds: ["co_a_id", "co_b_id", "co_c_id"],
      },
    ];
    render(<AlertsPanel />);
    fireOpen();
    // Loading pill present, no chip buttons rendered for the affected ids.
    expect(screen.getByTestId("alerts-codes-loading")).toBeTruthy();
    // None of the codes appear yet (would be `unknown_xxx…` mid-flash
    // pre-fix; now they're absent until fetch resolves).
    expect(screen.queryByText(/^unknown_/)).toBeNull();
  });

  it("renders truncated id with ellipsis if company code lookup fails", async () => {
    // /api/companies returns NO match for the given id.
    mockMatches = [
      {
        ruleId: "crit-rule",
        ruleName: "Critical Rule",
        severity: "critical",
        message: "msg",
        affectedCompanyIds: ["unknown_id_12345"],
      },
    ];
    render(<AlertsPanel />);
    fireOpen();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // Map fetched but doesn't contain the id → button shows "unknown_…"
    const chip = screen.getByText(/^unknown_/);
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(chip.textContent).toContain("unknown_");
  });
});
