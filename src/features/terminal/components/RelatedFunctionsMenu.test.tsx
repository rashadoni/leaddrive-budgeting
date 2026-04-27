// @vitest-environment happy-dom
/**
 * Phase A4 (Bloomberg uplift plan) — smoke for `RelatedFunctionsMenu`.
 *
 * Locks in:
 *  - Renders `⋯` toggle button initially, with menu closed.
 *  - Click opens menu showing 4 entries (P&L / Compare / Forecast / Audit).
 *  - Without active company: "Org-wide" header + links omit `?company=`.
 *  - With active company + companyMap loaded: "For <CODE>" header + links
 *    include `?company=<id>` where id is resolved via /api/companies fetch.
 *  - Audit link uses `/budgeting/audit` page route, not tab param.
 *  - Walks both flat-array and hierarchical-children company shapes.
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
  renderHook,
} from "@testing-library/react";
import { RelatedFunctionsMenu } from "./RelatedFunctionsMenu";
import { useTerminalStore } from "../store/terminalStore";

const COMPANIES = [
  { id: "atl_id_root", code: "ATL", name: "Azertexnolayn", children: [
    { id: "atl_main_id", code: "ATL-MAIN", name: "ATL Main" },
  ] },
  { id: "aac_main_id", code: "AAC-MAIN", name: "AAC Main" },
];

function useStoreActions() {
  return useTerminalStore((s) => ({
    setCompany: s.setCompany,
    clearState: s.clearState,
  }));
}

beforeEach(() => {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(COMPANIES), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
  // Reset active company between tests via hooks-in-renderHook pattern
  const { result } = renderHook(() => useStoreActions());
  act(() => {
    result.current.clearState();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setActiveCompany(code: string | null) {
  const { result } = renderHook(() => useStoreActions());
  act(() => {
    if (code === null) result.current.clearState();
    else result.current.setCompany(code);
  });
}

describe("RelatedFunctionsMenu (Phase A4)", () => {
  it("renders ⋯ toggle button with menu closed initially", async () => {
    render(<RelatedFunctionsMenu />);
    const button = screen.getByRole("button", { name: /Related functions/i });
    expect(button.textContent).toBe("⋯");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // No menu items yet
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("click opens menu with 4 entries (P&L, Compare, Forecast, Audit)", async () => {
    render(<RelatedFunctionsMenu />);
    const button = screen.getByRole("button", { name: /Related functions/i });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("menu")).toBeTruthy();
    expect(screen.queryByText("P&L")).toBeTruthy();
    expect(screen.queryByText("Compare")).toBeTruthy();
    expect(screen.queryByText("Forecast")).toBeTruthy();
    expect(screen.queryByText("Audit")).toBeTruthy();
  });

  it("without active company: 'Org-wide' header + links omit ?company= param", async () => {
    setActiveCompany(null);
    render(<RelatedFunctionsMenu />);
    fireEvent.click(screen.getByRole("button", { name: /Related functions/i }));
    expect(screen.queryByText("Org-wide")).toBeTruthy();
    const pnlLink = screen.getByText("P&L").closest("a");
    expect(pnlLink?.getAttribute("href")).toBe("/budgeting?tab=pnl-report");
    const auditLink = screen.getByText("Audit").closest("a");
    expect(auditLink?.getAttribute("href")).toBe("/budgeting/audit");
  });

  it("with active company + companyMap loaded: includes ?company=<id>", async () => {
    setActiveCompany("AAC-MAIN");
    render(<RelatedFunctionsMenu />);
    // Wait for /api/companies fetch to resolve + companyMap state to flush
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /Related functions/i });
      fireEvent.click(button);
      expect(screen.queryByText("For AAC-MAIN")).toBeTruthy();
    });
    const pnlLink = screen.getByText("P&L").closest("a");
    expect(pnlLink?.getAttribute("href")).toBe(
      "/budgeting?tab=pnl-report&company=aac_main_id",
    );
    const auditLink = screen.getByText("Audit").closest("a");
    expect(auditLink?.getAttribute("href")).toBe(
      "/budgeting/audit?company=aac_main_id",
    );
  });

  it("walks hierarchical children to resolve nested company codes", async () => {
    setActiveCompany("ATL-MAIN");
    render(<RelatedFunctionsMenu />);
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /Related functions/i });
      fireEvent.click(button);
      expect(screen.queryByText("For ATL-MAIN")).toBeTruthy();
    });
    const pnlLink = screen.getByText("P&L").closest("a");
    expect(pnlLink?.getAttribute("href")).toContain("company=atl_main_id");
  });

  it("Escape closes the menu (Round-1 ⚠️ closure)", async () => {
    render(<RelatedFunctionsMenu />);
    const button = screen.getByRole("button", { name: /Related functions/i });
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("click outside closes the menu (Round-1 ⚠️ closure)", async () => {
    render(
      <div>
        <button data-testid="outside-target">outside</button>
        <RelatedFunctionsMenu />
      </div>,
    );
    const button = screen.getByRole("button", { name: /Related functions/i });
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeTruthy();
    const outside = screen.getByTestId("outside-target");
    act(() => {
      fireEvent.mouseDown(outside);
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("falls back to no-company when fetch fails", async () => {
    global.fetch = vi.fn(async () =>
      new Response("error", { status: 500 }),
    ) as never;
    setActiveCompany("AAC-MAIN");
    render(<RelatedFunctionsMenu />);
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /Related functions/i });
      fireEvent.click(button);
    });
    // Menu still renders; AAC-MAIN active but companyMap empty so
    // resolved id = null, links omit company param
    const pnlLink = screen.getByText("P&L").closest("a");
    expect(pnlLink?.getAttribute("href")).toBe("/budgeting?tab=pnl-report");
  });
});
