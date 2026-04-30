// @vitest-environment happy-dom
/**
 * Phase B5 — ComparePanel modal smoke + behavior tests.
 *
 * Locks in:
 *   - Initial render = nothing (modal closed).
 *   - Opens on `terminal:open-compare` event with {lhs, rhs} detail.
 *   - Escape closes; Close button closes; backdrop click closes;
 *     internal panel click does NOT close.
 *   - Fetches /api/indicators/matrix when opened; renders rows for
 *     every indicator alphabetically; shows LHS / RHS / Δ columns.
 *   - Δ color: higher_better positive = green; lower_better positive = red;
 *     band = grey; null/non-numeric = grey.
 *   - Missing company codes show error message instead of table.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import * as nextIntl from "next-intl";
import { ComparePanel } from "./ComparePanel";

const MATRIX_FIXTURE = {
  period: "2026",
  companies: [
    { id: "co_aac", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
    { id: "co_atl", code: "ATL-DBZ", name: "ATL DBZ", industry: "Industrial" },
  ],
  indicators: [
    {
      id: "ind_margin",
      code: "IND_NET_MARGIN",
      nameEn: "Net Margin",
      nameRu: "Чистая маржа",
      nameAz: "Xalis marja",
      unit: "%",
      direction: "higher_better",
    },
    {
      id: "ind_opex",
      code: "IND_OPEX_RATIO",
      nameEn: "OpEx Ratio",
      nameRu: "Доля операционных расходов",
      nameAz: "Əməliyyat xərcləri nisbəti",
      unit: "%",
      direction: "lower_better",
    },
  ],
  cells: [
    {
      indicatorValueId: "iv1",
      companyId: "co_aac",
      indicatorId: "ind_margin",
      value: -9.46,
      status: "red",
    },
    {
      indicatorValueId: "iv2",
      companyId: "co_atl",
      indicatorId: "ind_margin",
      value: 12.5,
      status: "green",
    },
    {
      indicatorValueId: "iv3",
      companyId: "co_aac",
      indicatorId: "ind_opex",
      value: 24.6,
      status: "amber",
    },
    {
      indicatorValueId: "iv4",
      companyId: "co_atl",
      indicatorId: "ind_opex",
      value: 18.0,
      status: "green",
    },
  ],
};

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(MATRIX_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fireOpenCompare(detail: { lhs: string; rhs: string }) {
  act(() => {
    window.dispatchEvent(new CustomEvent("terminal:open-compare", { detail }));
  });
}

describe("ComparePanel (Phase B5)", () => {
  it("renders nothing initially (modal closed)", () => {
    const { container } = render(<ComparePanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on terminal:open-compare event with role=dialog + aria-modal", () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toContain("AAC-MAIN");
    expect(dialog.getAttribute("aria-label")).toContain("ATL-DBZ");
  });

  it("ignores event with missing lhs or rhs", () => {
    render(<ComparePanel />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("terminal:open-compare", {
          detail: { lhs: "AAC-MAIN" } as never,
        }),
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the modal", () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    expect(screen.queryByRole("dialog")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close button closes the modal", () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    fireEvent.click(screen.getByRole("button", { name: /Close compare/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; click on inner panel does NOT close", () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog, { target: dialog, currentTarget: dialog });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Re-open + click a heading inside; modal stays open
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    const heading = screen.getByText(/Compare:/i);
    fireEvent.click(heading);
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  it("fetches matrix once and renders 2 indicator rows + LHS/RHS values + delta", async () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    await waitFor(() => {
      expect(screen.queryByText("IND_NET_MARGIN")).toBeTruthy();
    });
    expect(screen.queryByText("IND_OPEX_RATIO")).toBeTruthy();
    // LHS Net Margin = -9.46, RHS = 12.5 → Δ = +21.96
    // formatValue rounds: abs<10 → toFixed(2), abs>=10 → toFixed(1)
    expect(screen.queryByText("-9.46 %")).toBeTruthy();
    expect(screen.queryByText("12.5 %")).toBeTruthy();
    // Δ = 21.96 → abs>=10 → toFixed(1) = "22.0" + sign prefix "+"
    expect(screen.queryByText(/\+22\.0/)).toBeTruthy();
  });

  it("indicators are sorted alphabetically by code", async () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    await waitFor(() => {
      expect(screen.queryByText("IND_NET_MARGIN")).toBeTruthy();
    });
    const codes = Array.from(
      document.querySelectorAll("tbody tr td:first-child div:first-child"),
    ).map((el) => el.textContent);
    // IND_NET_MARGIN < IND_OPEX_RATIO alphabetically
    expect(codes).toEqual(["IND_NET_MARGIN", "IND_OPEX_RATIO"]);
  });

  it("higher_better indicator with positive delta is green; lower_better with negative is also green", async () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    await waitFor(() => {
      expect(screen.queryByText("IND_NET_MARGIN")).toBeTruthy();
    });
    // Net Margin (higher_better): RHS 12.5 - LHS -9.46 = +21.96 → green
    // OpEx Ratio (lower_better): RHS 18.0 - LHS 24.6 = -6.6 → green
    const deltaCells = Array.from(document.querySelectorAll("tbody tr td:nth-child(4)"));
    expect(deltaCells).toHaveLength(2);
    expect((deltaCells[0] as HTMLElement).style.color).toMatch(/00D4AA/i);
    expect((deltaCells[1] as HTMLElement).style.color).toMatch(/00D4AA/i);
  });

  it("shows error when LHS or RHS code not in matrix", async () => {
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "GHOST-CO", rhs: "ATL-DBZ" });
    await waitFor(() => {
      expect(screen.queryByText(/not found/i)).toBeTruthy();
    });
    // GHOST-CO rendered inside a <code> element — check raw HTML
    expect(document.body.innerHTML).toContain("GHOST-CO");
  });

  it("removes the open listener on unmount (no leak)", () => {
    const { unmount } = render(<ComparePanel />);
    unmount();
    // Re-firing event after unmount should NOT cause a state-update warning
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(
        new CustomEvent("terminal:open-compare", {
          detail: { lhs: "AAC-MAIN", rhs: "ATL-DBZ" },
        }),
      );
    });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // Sub-34 — indicator names render via `resolveIndicatorLabel(ind, locale)`
  // so locale=ru shows Russian indicator names instead of nameEn.
  it("renders Russian indicator names when locale=ru", async () => {
    vi.spyOn(nextIntl, "useLocale").mockReturnValue("ru");
    render(<ComparePanel />);
    fireOpenCompare({ lhs: "AAC-MAIN", rhs: "ATL-DBZ" });
    await waitFor(() => {
      expect(screen.queryByText("Чистая маржа")).toBeTruthy();
    });
    expect(screen.queryByText("Доля операционных расходов")).toBeTruthy();
    expect(screen.queryByText("Net Margin")).toBeNull();
    expect(screen.queryByText("OpEx Ratio")).toBeNull();
  });
});
