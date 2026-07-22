// @vitest-environment happy-dom
/**
 * Sub-37 architect Round-34 closure — DOM-assertion regression test
 * for the route-conditional `<main>` className in DashboardLayout.
 *
 * Ensures `/budgeting/terminal` gets full-bleed sizing
 * (`flex-1 min-h-0 overflow-hidden`, NO `p-8`, NO `overflow-y-auto`)
 * and other dashboard routes keep the standard padded scrollable main
 * (`flex-1 overflow-y-auto p-8`). A future Tailwind purge / refactor
 * silently flipping the className would now fail CI.
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
import { render, screen, cleanup } from "@testing-library/react";

// Hoisted mocks — must declare before importing layout (vi.mock auto-hoists).
let mockPathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Test", organizationName: "TestOrg" } } }),
}));
vi.mock("@/components/sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));
vi.mock("@/components/header", () => ({
  Header: ({ orgName }: { orgName: string }) => (
    <header data-testid="header">{orgName}</header>
  ),
}));

import DashboardLayout from "./layout";

beforeEach(() => {
  mockPathname = "/dashboard";
});

afterEach(() => {
  cleanup();
});

describe("DashboardLayout — route-conditional <main> className (sub-37)", () => {
  it("/budgeting/terminal: <main> is full-bleed (no p-8, no overflow-y-auto)", () => {
    mockPathname = "/budgeting/terminal";
    render(
      <DashboardLayout>
        <div data-testid="child">terminal</div>
      </DashboardLayout>,
    );
    const main = screen.getByRole("main");
    expect(screen.getByTestId("dashboard-sidebar-slot").className).toBe("hidden md:contents");
    expect(main.className).toMatch(/min-h-0/);
    expect(main.className).toMatch(/overflow-hidden/);
    expect(main.className).not.toMatch(/\bp-8\b/);
    expect(main.className).not.toMatch(/overflow-y-auto/);
  });

  it("non-terminal routes: <main> keeps standard p-8 + overflow-y-auto", () => {
    mockPathname = "/budgeting";
    render(
      <DashboardLayout>
        <div data-testid="child">budgeting</div>
      </DashboardLayout>,
    );
    const main = screen.getByRole("main");
    expect(screen.getByTestId("dashboard-sidebar-slot").className).toBe("contents");
    expect(main.className).toMatch(/\bp-8\b/);
    expect(main.className).toMatch(/overflow-y-auto/);
    expect(main.className).not.toMatch(/min-h-0/);
  });

  it("dashboard root: standard padded main", () => {
    mockPathname = "/dashboard";
    render(
      <DashboardLayout>
        <div data-testid="child">root</div>
      </DashboardLayout>,
    );
    const main = screen.getByRole("main");
    expect(main.className).toMatch(/\bp-8\b/);
  });

  it("Board Deck hides application chrome and removes fixed-height clipping in print", () => {
    mockPathname = "/budgeting/board-deck";
    render(
      <DashboardLayout>
        <div data-testid="child">deck</div>
      </DashboardLayout>,
    );
    expect(screen.getByTestId("dashboard-sidebar-slot").className).toContain("print:hidden");
    expect(screen.getByTestId("dashboard-header-slot").className).toContain("print:hidden");
    expect(screen.getByTestId("dashboard-help-video-slot").className).toContain("print:hidden");
    const main = screen.getByRole("main");
    expect(main.className).toContain("print:p-0");
    expect(main.className).toContain("print:overflow-visible");
  });

  it("audit log: standard padded main", () => {
    mockPathname = "/audit-log";
    render(
      <DashboardLayout>
        <div data-testid="child">audit</div>
      </DashboardLayout>,
    );
    const main = screen.getByRole("main");
    expect(main.className).toMatch(/\bp-8\b/);
  });

  it("/budgeting/terminal/anything: prefix match keeps full-bleed", () => {
    mockPathname = "/budgeting/terminal/sub-route";
    render(
      <DashboardLayout>
        <div data-testid="child">deep</div>
      </DashboardLayout>,
    );
    const main = screen.getByRole("main");
    expect(main.className).not.toMatch(/\bp-8\b/);
    expect(main.className).toMatch(/min-h-0/);
  });
});
