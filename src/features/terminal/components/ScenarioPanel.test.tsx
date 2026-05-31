// @vitest-environment happy-dom
/**
 * Phase 7.N — ScenarioPanel v2 tests (live What-if).
 *
 * What is locked in (updated for Phase 7.N simulate flow):
 *  - Closed initial render.
 *  - Opens on `terminal:open-scenario` window event.
 *  - Loading / empty / error states while /api/scenarios pending.
 *  - Lists scenarios + auto-selects when activeScenarioCode matches.
 *  - Simulate button calls GET /api/scenarios/[id]/simulate.
 *  - Delta table renders on success.
 *  - "Применить к HeatMap" calls setScenarioDelta with correct map.
 *  - Simulate error shown (including 422 unsupported).
 *  - Esc + backdrop + X button close.
 *  - Listener cleanup on unmount.
 *  - auto-select does not clobber manual row click on incidental re-render.
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

// ─── Store mock ───────────────────────────────────────────────────────────────
// Phase 7.N: mock includes setScenarioDelta + clearScenarioDelta + activeScenarioLabel

let mockActiveScenarioCode: string | null = null;
let mockActiveScenarioLabel: string | null = null;
const mockSetScenarioDelta = vi.fn();
const mockClearScenarioDelta = vi.fn();

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: {
      activeScenarioCode: string | null;
      activeScenarioLabel: string | null;
      setScenarioDelta: typeof mockSetScenarioDelta;
      clearScenarioDelta: typeof mockClearScenarioDelta;
    }) => T,
  ) =>
    selector({
      activeScenarioCode: mockActiveScenarioCode,
      activeScenarioLabel: mockActiveScenarioLabel,
      setScenarioDelta: mockSetScenarioDelta,
      clearScenarioDelta: mockClearScenarioDelta,
    }),
}));

// ─── Sample data ──────────────────────────────────────────────────────────────

const SAMPLE_SCENARIOS = [
  {
    id: "sc_id_a",
    code: "AZN_DEVAL_20",
    nameEn: "AZN devalues 20%",
    nameRu: "Девальвация маната −20%",
    description: "FX shock — manat devalues 20% vs USD.",
    overrides: {
      adjustments: [
        { codes: ["FX_IMPORTED_INPUT"], multiply: 1.20, note: "AZN/USD +20%" },
      ],
    },
    isActive: true,
  },
  {
    id: "sc_id_b",
    code: "OIL_DROP_30",
    nameEn: "Oil drops 30%",
    nameRu: "Нефть −30%",
    description: "Commodity downturn.",
    overrides: {
      adjustments: [
        { codes: ["AGRO_COMMODITY_VOL"], multiply: 0.85, note: "Oil-linked volatility eases" },
      ],
    },
    isActive: true,
  },
];

const SAMPLE_SIM_RESULT = {
  scenarioId: "sc_id_a",
  scenarioCode: "AZN_DEVAL_20",
  scenarioNameRu: "Девальвация маната −20%",
  scenarioNameEn: "AZN devalues 20%",
  period: "2026",
  deltas: [
    {
      companyId: "co_1",
      companyCode: "AZSEKER-CPC",
      companyName: "CPC",
      code: "FX_IMPORTED_INPUT",
      baselineStatus: "green",
      scenarioStatus: "amber",
      baselineValue: 25,
      scenarioValue: 30,
      changed: true,
      note: "AZN/USD +20%",
    },
  ],
  changed: 1,
  unchanged: 10,
  worsened: 1,
  improved: 0,
  deltaMap: { "co_1:FX_IMPORTED_INPUT": "amber" },
};

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function makeFetch(opts: {
  scenariosStatus?: number;
  simulateStatus?: number;
  simulateBody?: unknown;
} = {}) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/simulate")) {
      const status = opts.simulateStatus ?? 200;
      const body = opts.simulateBody ?? SAMPLE_SIM_RESULT;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/api/scenarios")) {
      const status = opts.scenariosStatus ?? 200;
      const body = status === 200 ? SAMPLE_SCENARIOS : "server error";
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as never;
}

beforeEach(() => {
  mockActiveScenarioCode = null;
  mockActiveScenarioLabel = null;
  mockSetScenarioDelta.mockClear();
  mockClearScenarioDelta.mockClear();
  makeFetch();
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ScenarioPanel (Phase C4 v1)", () => {
  it("renders nothing initially", () => {
    const { container } = render(<ScenarioPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("opens on `terminal:open-scenario` event with role=dialog + aria-modal", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBeTruthy();
  });

  it("shows loading state until /api/scenarios resolves", () => {
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
    // Auto-selected row renders simulate button (detail panel visible).
    await waitFor(() => {
      expect(screen.getByTestId("scenario-simulate-button")).toBeTruthy();
    });
    // The selected row button should have amber/highlighted styling.
    const selectedRow = screen.getByTestId("scenario-row-OIL_DROP_30");
    expect(selectedRow.className).toContain("FFB800");
  });

  it("clicking a row shows the simulate button", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    expect(screen.getByTestId("scenario-simulate-button")).toBeTruthy();
  });

  it("Simulate button calls GET /api/scenarios/[id]/simulate", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    const simBtn = screen.getByTestId("scenario-simulate-button");
    fireEvent.click(simBtn);
    await waitFor(() => {
      // "Применить к HeatMap" appears after simulation completes.
      expect(screen.getByTestId("scenario-apply-heatmap")).toBeTruthy();
    });
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const simCall = calls.find((c) => String(c[0]).includes("/simulate"));
    expect(simCall).toBeTruthy();
    expect(String(simCall?.[0])).toContain("sc_id_a");
  });

  it("delta table shows changed indicators after simulate", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    fireEvent.click(screen.getByTestId("scenario-simulate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("scenario-apply-heatmap")).toBeTruthy();
    });
    // Delta table should contain the changed indicator code.
    expect(screen.getByText("FX_IMPORTED_INPUT")).toBeTruthy();
  });

  it("Apply button calls setScenarioDelta with correct map", async () => {
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    fireEvent.click(screen.getByTestId("scenario-simulate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("scenario-apply-heatmap")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("scenario-apply-heatmap"));
    expect(mockSetScenarioDelta).toHaveBeenCalledOnce();
    const [deltaMap, label] = mockSetScenarioDelta.mock.calls[0];
    expect(deltaMap.get("co_1:FX_IMPORTED_INPUT")).toBe("amber");
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });

  it("simulate 422 shows unsupported message", async () => {
    makeFetch({ simulateStatus: 422, simulateBody: { error: "no adjustments" } });
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    fireEvent.click(screen.getByTestId("scenario-simulate-button"));
    await waitFor(() => {
      // Unsupported state renders an amber warning (no data-testid, check text).
      // i18n'd via terminal.scenarioPanel.unsupportedSim (en mirror in vitest.setup EXPLICIT_LABELS).
      expect(screen.getByText(/support simulation/i)).toBeTruthy();
    });
  });

  it("simulate server error shows error message", async () => {
    makeFetch({ simulateStatus: 500, simulateBody: "Internal" });
    render(<ScenarioPanel />);
    fireOpen();
    const row = await screen.findByTestId("scenario-row-AZN_DEVAL_20");
    fireEvent.click(row);
    fireEvent.click(screen.getByTestId("scenario-simulate-button"));
    await waitFor(() => {
      expect(screen.getByTestId("scenario-apply-error")).toBeTruthy();
    });
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
    fireEvent.click(screen.getByLabelText("Close"));
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
    makeFetch({ scenariosStatus: 500 });
    render(<ScenarioPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.getByTestId("scenarios-fetch-error")).toBeTruthy();
    });
  });

  it("fetch-error path does NOT render empty-state copy", async () => {
    makeFetch({ scenariosStatus: 500 });
    render(<ScenarioPanel />);
    fireOpen();
    await waitFor(() => {
      expect(screen.getByTestId("scenarios-fetch-error")).toBeTruthy();
    });
    expect(screen.queryByTestId("scenarios-empty")).toBeNull();
  });

  // REGRESSION: auto-select must NOT clobber a user's manual row click.
  // Phase 7.N variant: no scenario-overrides testid — use simulate button
  // visibility + selected row styling as oracle.
  it("auto-select does not clobber manual row click on incidental re-render", async () => {
    mockActiveScenarioCode = "AZN_DEVAL_20";
    render(<ScenarioPanel />);
    fireOpen();
    // First open: auto-selects AZN_DEVAL_20 — simulate button visible.
    await waitFor(() => {
      expect(screen.getByTestId("scenario-simulate-button")).toBeTruthy();
    });
    // AZN_DEVAL_20 row should be highlighted.
    expect(screen.getByTestId("scenario-row-AZN_DEVAL_20").className).toContain("FFB800");
    // User clicks the OTHER row.
    const otherRow = screen.getByTestId("scenario-row-OIL_DROP_30");
    fireEvent.click(otherRow);
    // OIL_DROP_30 row now highlighted; AZN_DEVAL_20 not.
    expect(screen.getByTestId("scenario-row-OIL_DROP_30").className).toContain("FFB800");
    expect(screen.getByTestId("scenario-row-AZN_DEVAL_20").className).not.toContain("FFB800");
    // Force a re-render via the open event (activeScenarioCode unchanged).
    act(() => {
      window.dispatchEvent(new Event("terminal:open-scenario"));
    });
    // Manual selection (OIL_DROP_30) preserved.
    expect(screen.getByTestId("scenario-row-OIL_DROP_30").className).toContain("FFB800");
    expect(screen.getByTestId("scenario-row-AZN_DEVAL_20").className).not.toContain("FFB800");
  });
});
