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
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

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
  // Sub-19: reset useCompanies module cache between tests.
  __resetCompaniesCacheForTests();
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

  it("click opens menu with 5 entries (P&L, Compare, Variance, Forecast, Audit)", async () => {
    render(<RelatedFunctionsMenu />);
    const button = screen.getByRole("button", { name: /Related functions/i });
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("menu")).toBeTruthy();
    expect(screen.queryByText("P&L")).toBeTruthy();
    expect(screen.queryByText("Compare")).toBeTruthy();
    // Phase 7.G Turn LIX — `Variance` entry added (closes 106-turn-stale
    // jsdoc deviation; real ?tab=variance route now ships).
    expect(screen.queryByText("Variance")).toBeTruthy();
    expect(screen.queryByText("Forecast")).toBeTruthy();
    expect(screen.queryByText("Audit")).toBeTruthy();
    // Variance link: org-wide tab nav (mirrors comparison/pnl-report).
    const varianceLink = screen.getByText("Variance").closest("a");
    expect(varianceLink?.getAttribute("href")).toBe("/budgeting?tab=variance");
  });

  it("What-if entry fires terminal:open-whatif and closes the menu", () => {
    render(<RelatedFunctionsMenu />);
    fireEvent.click(screen.getByRole("button", { name: /Related functions/i }));
    expect(screen.queryByRole("menu")).toBeTruthy();
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    window.addEventListener("terminal:open-whatif", handler);
    fireEvent.click(screen.getByText("What-if"));
    window.removeEventListener("terminal:open-whatif", handler);
    expect(fired).toBe(1);
    // Firing the overlay event also dismisses the breadcrumb menu.
    expect(screen.queryByRole("menu")).toBeNull();
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
    // Race-fix mirror of sub-18 `walks hierarchical children` test: href is
    // built from `companyMap` which hydrates via async `/api/companies` fetch;
    // even after menu opens (waitFor above) the map may still be empty
    // → activeCompanyId resolves null → href omits `?company=`. Wrap href
    // assertion in waitFor so the test polls until the map hydrates.
    await waitFor(() => {
      const pnlLink = screen.getByText("P&L").closest("a");
      expect(pnlLink?.getAttribute("href")).toBe(
        "/budgeting?tab=pnl-report&company=aac_main_id",
      );
    });
    const auditLink = screen.getByText("Audit").closest("a");
    expect(auditLink?.getAttribute("href")).toBe(
      "/budgeting/audit?company=aac_main_id",
    );
  });

  it("walks hierarchical children to resolve nested company codes", async () => {
    setActiveCompany("ATL-MAIN");
    render(<RelatedFunctionsMenu />);
    // Open the menu first.
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /Related functions/i });
      fireEvent.click(button);
      expect(screen.queryByText("For ATL-MAIN")).toBeTruthy();
    });
    // Architect Round-1 sub-17 closure: wait for the /api/companies
    // fetch to resolve AND companyMap to populate AND href to rebuild
    // before asserting. Prior version asserted synchronously after
    // `waitFor(menu open)` which raced against the companyMap fetch
    // — passed under default reporter timing, failed under
    // --reporter=dot due to faster worker scheduling that exposed
    // the race. The href correctly absent during the loading window
    // (activeCompanyId === null) and gains `?company=<id>` only AFTER
    // map resolves.
    await waitFor(() => {
      const pnlLink = screen.getByText("P&L").closest("a");
      expect(pnlLink?.getAttribute("href")).toContain("company=atl_main_id");
    });
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
    // Sub-19: per-test fetch override needs cache reset since the
    // beforeEach success mock would have already cached the resolved
    // promise — reset BEFORE override + re-mock so the failure path
    // is what useCompanies sees.
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response("error", { status: 500 }),
    ) as never;
    setActiveCompany("AAC-MAIN");
    render(<RelatedFunctionsMenu />);
    await waitFor(() => {
      const button = screen.getByRole("button", { name: /Related functions/i });
      fireEvent.click(button);
    });
    // Menu still renders; AAC-MAIN active but codeToId empty so
    // resolved id = null, links omit company param.
    await waitFor(() => {
      const pnlLink = screen.getByText("P&L").closest("a");
      expect(pnlLink?.getAttribute("href")).toBe("/budgeting?tab=pnl-report");
    });
  });
});
