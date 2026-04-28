// @vitest-environment happy-dom
/**
 * Phase C4 v1 — smoke + behavior tests for `ScenarioPanel` modal.
 *
 * What is locked in:
 *  - Closed initial render.
 *  - Opens on `terminal:open-scenario` window event.
 *  - Loading state while /api/scenarios pending.
 *  - Empty-state when org has zero scenarios.
 *  - Lists scenarios + auto-selects when activeScenarioCode matches.
 *  - Selecting a row renders overrides JSON.
 *  - Apply button POSTs + surfaces 202 queued response.
 *  - Apply button surfaces error response.
 *  - Esc + backdrop + X button close.
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
import { ScenarioPanel } from "./ScenarioPanel";

// Store mock — control activeScenarioCode + capture selector targets.
let mockActiveScenarioCode: string | null = null;
vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: { activeScenarioCode: string | null }) => T,
  ) => selector({ activeScenarioCode: mockActiveScenarioCode }),
}));

const SAMPLE_SCENARIOS = [
  {
    id: "sc_id_a",
    code: "AZN_DEVAL_20",
    nameEn: "AZN devalues 20%",
    description: "FX shock — ground-truth manat → USD by 20%.",
    overrides: { fx_rates: { USD: 1.9 } },
    isActive: true,
  },
  {
    id: "sc_id_b",
    code: "OIL_DROP_30",
    nameEn: "Oil drops 30%",
    description: "Commodity downturn impacting petrochem feedstock.",
    overrides: { commodity_idx: { brent: -30 } },
    isActive: true,
  },
];

beforeEach(() => {
  mockActiveScenarioCode = null;
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/api/scenarios") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify(SAMPLE_SCENARIOS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/api/scenarios") && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          message: "Scenario execution queued",
          scenarioCode: "AZN_DEVAL_20",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
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
    window.dispatchEvent(new Event("terminal:open-scenario"));
  });
}

describe("ScenarioPanel (Phase C4 v1)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<ScenarioPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-scenario` event with role=dialog + aria-label", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Scenario runner");
  });

  it("shows loading state until /api/scenarios resolves", () => {
    // Block fetch — never resolves during this test.
    global.fetch = vi.fn(() => new Promise(() => {})) as never;
    render(<ScenarioPanel />);
    fireOpen();
    expect(screen.getByTestId("scenarios-loading")).toBeTruthy();
  });

  it("shows empty-state when org has zero scenarios", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as never;
    render(<ScenarioPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.getByTestId("scenarios-empty")).toBeTruthy();
    });
  });

  it("lists scenarios after fetch resolves", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.getByTestId("scenario-row-AZN_DEVAL_20")).toBeTruthy();
      expect(screen.getByTestId("scenario-row-OIL_DROP_30")).toBeTruthy();
    });
  });

  it("auto-selects scenario when activeScenarioCode matches a row", async () => {
    mockActiveScenarioCode = "OIL_DROP_30";
    render(<ScenarioPanel />);
    fireOpen();
    // Auto-selected row renders detail panel with the matching code.
    await waitFor(() => {
      const overrides = screen.getByTestId("scenario-overrides");
      expect(overrides.textContent).toContain("brent");
    });
  });

  it("clicking a row updates the detail panel", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    const overrides = screen.getByTestId("scenario-overrides");
    expect(overrides.textContent).toContain("USD");
    expect(overrides.textContent).toContain("1.9");
  });

  it("Apply button POSTs and surfaces queued message", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    const applyBtn = screen.getByTestId("scenario-apply-button");
    fireEvent.click(applyBtn);
    await waitFor(() => {
      expect(screen.getByTestId("scenario-applied")).toBeTruthy();
    });
    expect(screen.getByTestId("scenario-applied").textContent).toContain(
      "AZN_DEVAL_20",
    );
    // Verify POST went out with correct body shape.
    const lastCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls.at(-1);
    expect(lastCall?.[0]).toBe("/api/scenarios");
    const init = lastCall?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.scenarioId).toBe("sc_id_a");
    expect(typeof body.period).toBe("string");
  });

  it("Apply button surfaces server error", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response("Internal", { status: 500 });
      }
      return new Response(JSON.stringify(SAMPLE_SCENARIOS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as never;
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    fireEvent.click(screen.getByTestId("scenario-apply-button"));
    await waitFor(() => {
      expect(screen.getByTestId("scenario-apply-error")).toBeTruthy();
    });
    expect(screen.getByTestId("scenario-apply-error").textContent).toContain(
      "500",
    );
  });

  it("Escape closes the modal", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click closes; inner click does NOT", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    const header = dialog.querySelector("header")!;
    fireEvent.click(header);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Close (X) button dismisses modal", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    fireEvent.click(screen.getByLabelText("Close scenario panel"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes terminal:open-scenario listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ScenarioPanel />);
    unmount();
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "terminal:open-scenario",
    );
    expect(removed).toBe(true);
  });

  it("surfaces /api/scenarios fetch error", async () => {
    global.fetch = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as never;
    render(<ScenarioPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.getByTestId("scenarios-fetch-error")).toBeTruthy();
    });
  });
});
