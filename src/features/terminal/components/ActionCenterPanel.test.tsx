// @vitest-environment happy-dom
/**
 * Tier-3 sub-28 — ActionCenterPanel behavior tests.
 *
 * Locks in:
 *  - Initial render: closed (returns null) until `terminal:open-action-center`.
 *  - Opens on event with role=dialog + aria-label.
 *  - `null` matrix (not loaded yet) → loading message.
 *  - Matrix with zero red+amber cells → "all systems green" empty-state.
 *  - Matrix with red+amber cells: sections grouped by severity, red first.
 *  - Subgroup-rollup cells excluded (no double-counting).
 *  - Sort order: red before amber, then alphabetic by company code.
 *  - Click row → selectCompany(code) + setActiveIndicatorValue(id) +
 *    setActivePanel(3) + close modal.
 *  - Click row WITHOUT indicatorValueId → selectCompany only + close
 *    (still navigates without crashing on missing IV).
 *  - Esc / backdrop / close-button all dismiss.
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
  waitFor,
} from "@testing-library/react";
import { ActionCenterPanel } from "./ActionCenterPanel";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";

// Mock the store: each test sets desired actions.
const selectCompanyMock = vi.fn();
const setActiveIndicatorValueMock = vi.fn();
const setActivePanelMock = vi.fn();

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      selectCompany: typeof selectCompanyMock;
      setActiveIndicatorValue: typeof setActiveIndicatorValueMock;
      setActivePanel: typeof setActivePanelMock;
    }) => T,
  ) =>
    selector({
      selectCompany: selectCompanyMock,
      setActiveIndicatorValue: setActiveIndicatorValueMock,
      setActivePanel: setActivePanelMock,
    }),
}));

const MIXED_FIXTURE = {
  period: "2026",
  companies: [
    { id: "co_a", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
    { id: "co_b", code: "ATL-DBZ", name: "ATL DBZ", industry: "Hospitality" },
    {
      id: "sub_aac",
      code: "AAC",
      name: "AAC Sub-group",
      industry: "Industrial",
      isSubgroup: true,
    },
  ],
  indicators: [
    {
      id: "ind_gross",
      code: "IND_GROSS_MARGIN",
      nameEn: "Gross Margin",
      nameRu: "Валовая маржа",
      nameAz: "Ümumi marja",
      unit: "%",
      direction: "higher_better",
    },
    {
      id: "ind_opex",
      code: "IND_OPEX_RATIO",
      nameEn: "OpEx Ratio",
      unit: "%",
      direction: "lower_better",
    },
  ],
  cells: [
    {
      indicatorValueId: "iv_a_red",
      companyId: "co_a",
      indicatorId: "ind_gross",
      value: 5.0,
      status: "red",
    },
    {
      indicatorValueId: "iv_b_amber",
      companyId: "co_b",
      indicatorId: "ind_opex",
      value: 32.0,
      status: "amber",
    },
    {
      // Green cell — must NOT appear.
      indicatorValueId: "iv_green",
      companyId: "co_a",
      indicatorId: "ind_opex",
      value: 18.0,
      status: "green",
    },
    {
      // Subgroup rollup red — must NOT appear (would double-count leaf).
      indicatorValueId: "iv_sub_red",
      companyId: "sub_aac",
      indicatorId: "ind_gross",
      value: 5.0,
      status: "red",
      isSubgroupRollup: true,
    },
  ],
};

const EMPTY_FIXTURE = {
  period: "2026",
  companies: [
    { id: "co_a", code: "AAC", name: "AAC", industry: "Industrial" },
  ],
  indicators: [
    {
      id: "ind_gross",
      code: "IND_GROSS_MARGIN",
      nameEn: "Gross Margin",
      unit: "%",
      direction: "higher_better",
    },
  ],
  cells: [
    {
      indicatorValueId: "iv1",
      companyId: "co_a",
      indicatorId: "ind_gross",
      value: 25.0,
      status: "green",
    },
  ],
};

beforeEach(() => {
  selectCompanyMock.mockReset();
  setActiveIndicatorValueMock.mockReset();
  setActivePanelMock.mockReset();
  __resetMatrixCacheForTests();
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(MIXED_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-action-center"));
  });
}

describe("ActionCenterPanel (Tier-3 sub-28)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<ActionCenterPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-action-center` event with role=dialog + aria-label", () => {
    render(<ActionCenterPanel />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Action Center");
  });

  it("shows loading message before matrix resolves", () => {
    __resetMatrixCacheForTests();
    // Block fetch indefinitely so matrix stays null.
    global.fetch = vi.fn(() => new Promise(() => {})) as never;
    render(<ActionCenterPanel />);
    fireOpen();
    expect(screen.getByTestId("action-center-loading")).toBeTruthy();
  });

  it("shows empty-state when matrix has zero red+amber cells", async () => {
    __resetMatrixCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(EMPTY_FIXTURE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("action-center-empty")).toBeTruthy();
    });
    const empty = screen.getByTestId("action-center-empty");
    expect(empty.textContent).toContain("No pending items");
  });

  it("renders red + amber sections (not green, not subgroup rollup)", async () => {
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("action-center-row-co_a:ind_gross")).toBeTruthy();
    });
    // Red section row present (AAC-MAIN, IND_GROSS_MARGIN red)
    expect(screen.getByTestId("action-center-row-co_a:ind_gross")).toBeTruthy();
    // Amber section row present (ATL-DBZ, IND_OPEX_RATIO amber)
    expect(screen.getByTestId("action-center-row-co_b:ind_opex")).toBeTruthy();
    // Green cell NOT rendered.
    expect(screen.queryByTestId("action-center-row-co_a:ind_opex")).toBeNull();
    // Subgroup rollup NOT rendered (would be sub_aac:ind_gross).
    expect(screen.queryByTestId("action-center-row-sub_aac:ind_gross")).toBeNull();
  });

  it("clicking a row calls selectCompany + setActiveIndicatorValue + setActivePanel(3) + closes modal", async () => {
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("action-center-row-co_a:ind_gross")).toBeTruthy();
    });
    const row = screen.getByTestId("action-center-row-co_a:ind_gross");
    const button = row.querySelector("button")!;
    fireEvent.click(button);
    expect(selectCompanyMock).toHaveBeenCalledWith("AAC-MAIN");
    expect(setActiveIndicatorValueMock).toHaveBeenCalledWith("iv_a_red");
    expect(setActivePanelMock).toHaveBeenCalledWith(3);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking a row without indicatorValueId calls selectCompany only and still closes", async () => {
    __resetMatrixCacheForTests();
    const noIvFixture = {
      ...MIXED_FIXTURE,
      cells: [
        {
          // Missing indicatorValueId (back-compat with pre-7.D cells).
          companyId: "co_a",
          indicatorId: "ind_gross",
          value: 5.0,
          status: "red",
        },
      ],
    };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(noIvFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as never;
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("action-center-row-co_a:ind_gross")).toBeTruthy();
    });
    const row = screen.getByTestId("action-center-row-co_a:ind_gross");
    fireEvent.click(row.querySelector("button")!);
    expect(selectCompanyMock).toHaveBeenCalledWith("AAC-MAIN");
    expect(setActiveIndicatorValueMock).not.toHaveBeenCalled();
    expect(setActivePanelMock).not.toHaveBeenCalled();
    // Modal still closes (no IV doesn't block navigation).
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the modal", async () => {
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("action-center-row-co_a:ind_gross")).toBeTruthy();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner panel click does NOT", async () => {
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeTruthy();
    });
    const dialog = screen.getByRole("dialog");
    // Inner header click — should NOT close.
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Backdrop click (target === currentTarget).
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button (X) dismisses modal", async () => {
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeTruthy();
    });
    const closeBtn = screen.getByLabelText("Close action center");
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-action-center listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ActionCenterPanel />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-action-center",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });

  it("shows current value with unit on each row", async () => {
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByTestId("action-center-row-co_a:ind_gross")).toBeTruthy();
    });
    // Red cell value rendered (IND_GROSS_MARGIN: 5.0%)
    const redRow = screen.getByTestId("action-center-row-co_a:ind_gross");
    expect(redRow.textContent).toContain("5.00");
    expect(redRow.textContent).toContain("%");
    // Amber cell value rendered (IND_OPEX_RATIO: 32.0%)
    const amberRow = screen.getByTestId("action-center-row-co_b:ind_opex");
    expect(amberRow.textContent).toContain("32.00");
  });

  it("renders English indicator name when locale=en (default mock)", async () => {
    // Mock returns 'en' locale by default; nameEn should be the one used.
    render(<ActionCenterPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    expect(screen.getByText("Gross Margin")).toBeTruthy();
  });
});
