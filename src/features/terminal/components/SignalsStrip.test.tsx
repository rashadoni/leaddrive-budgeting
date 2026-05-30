// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SignalsStrip } from "./SignalsStrip";

const SIGNALS = [
  { id: "fx-depreciation", severity: "high", label: "Девальвация маната", detail: "форвард", suggestedScenarioCode: "AZN_DEVAL_15", asOf: "2026-05-24", stale: false },
  { id: "drought", severity: "high", label: "Низкие осадки", detail: "11.5мм", suggestedScenarioCode: "DROUGHT_2026", asOf: "2026-05-28", stale: false },
];

function mockFetch(signals: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ signals }) })) as never);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SignalsStrip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a chip per signal", async () => {
    mockFetch(SIGNALS);
    render(<SignalsStrip />);
    await waitFor(() => expect(screen.getByTestId("signal-fx-depreciation")).toBeTruthy());
    expect(screen.getByTestId("signal-drought")).toBeTruthy();
    expect(screen.getByText(/AZN_DEVAL_15/)).toBeTruthy();
  });

  it("clicking a signal dispatches terminal:open-scenario with the scenario code", async () => {
    mockFetch(SIGNALS);
    const onOpen = vi.fn();
    window.addEventListener("terminal:open-scenario", onOpen as EventListener);
    render(<SignalsStrip />);
    await waitFor(() => expect(screen.getByTestId("signal-drought")).toBeTruthy());
    fireEvent.click(screen.getByTestId("signal-drought"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    const evt = onOpen.mock.calls[0][0] as CustomEvent;
    expect(evt.detail).toEqual({ scenarioCode: "DROUGHT_2026" });
    window.removeEventListener("terminal:open-scenario", onOpen as EventListener);
  });

  it("renders nothing when there are no signals", async () => {
    mockFetch([]);
    const { container } = render(<SignalsStrip />);
    // give the effect a tick
    await waitFor(() => expect(container.querySelector('[data-testid="signals-strip"]')).toBeNull());
  });
});
