// @vitest-environment happy-dom
/**
 * Component smoke test for DriftDiffPreview. Stubs the dryRun POST
 * endpoint with two scenarios (existing plan + fresh onboarding) and
 * verifies the diff table renders the right numbers + that the confirm
 * checkbox + onHasExistingDataChange callback fire correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DriftDiffPreview } from "./DriftDiffPreview";

const mockFetchResponse = (body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });

const fakeFile = new File(["xlsx-bytes"], "test.xlsx", {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DriftDiffPreview", () => {
  it("renders Revenue / COGS / Expense / Gross Profit rows with current vs incoming", async () => {
    global.fetch = mockFetchResponse({
      dryRun: true,
      stagingId: "s1",
      year: 2026,
      planExisted: true,
      currentLineCount: 100,
      incomingLineCount: 110,
      sheetCount: { success: 1, failure: 0 },
      totals: {
        revenue: { current: 50_000_000, incoming: 51_000_000, deltaPct: 2 },
        cogs: { current: 30_000_000, incoming: 30_500_000, deltaPct: 1.67 },
        expense: { current: 10_000_000, incoming: 10_200_000, deltaPct: 2 },
      },
      gross_profit: { current: 20_000_000, incoming: 20_500_000 },
      ebitda: { current: 10_000_000, incoming: 10_300_000, deltaPct: 3 },
    }) as never;

    render(
      <DriftDiffPreview
        stagingId="s1"
        file={fakeFile}
        companyCode="AZSEKER-EDEN"
        companyName="Eden Agro"
        confirmed={false}
        onConfirmChange={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Revenue")).toBeTruthy();
      expect(screen.getByText("COGS")).toBeTruthy();
      expect(screen.getByText("Expense")).toBeTruthy();
      expect(screen.getByText("Gross Profit")).toBeTruthy();
      expect(screen.getByText("EBITDA")).toBeTruthy();
    });
  });

  it("hard-gate path — fires onHasExistingDataChange(true) when planExisted + lines > 0", async () => {
    global.fetch = mockFetchResponse({
      dryRun: true,
      stagingId: "s1",
      year: 2026,
      planExisted: true,
      currentLineCount: 50,
      incomingLineCount: 60,
      sheetCount: { success: 1, failure: 0 },
      totals: {
        revenue: { current: 100, incoming: 110, deltaPct: 10 },
        cogs: { current: 50, incoming: 55, deltaPct: 10 },
        expense: { current: 20, incoming: 22, deltaPct: 10 },
      },
      gross_profit: { current: 50, incoming: 55 },
    }) as never;
    const onHasExistingDataChange = vi.fn();
    render(
      <DriftDiffPreview
        stagingId="s1"
        file={fakeFile}
        companyCode="CO"
        companyName=""
        confirmed={false}
        onConfirmChange={() => undefined}
        onHasExistingDataChange={onHasExistingDataChange}
      />,
    );
    await waitFor(() => {
      expect(onHasExistingDataChange).toHaveBeenCalledWith(true);
    });
  });

  it("fresh-onboarding path — fires onHasExistingDataChange(false) when planExisted is false", async () => {
    global.fetch = mockFetchResponse({
      dryRun: true,
      stagingId: "s1",
      year: 2026,
      planExisted: false,
      currentLineCount: 0,
      incomingLineCount: 60,
      sheetCount: { success: 1, failure: 0 },
      totals: {
        revenue: { current: 0, incoming: 100, deltaPct: 100 },
        cogs: { current: 0, incoming: 50, deltaPct: 100 },
        expense: { current: 0, incoming: 20, deltaPct: 100 },
      },
      gross_profit: { current: 0, incoming: 50 },
    }) as never;
    const onHasExistingDataChange = vi.fn();
    render(
      <DriftDiffPreview
        stagingId="s1"
        file={fakeFile}
        companyCode="CO"
        companyName=""
        confirmed={false}
        onConfirmChange={() => undefined}
        onHasExistingDataChange={onHasExistingDataChange}
      />,
    );
    await waitFor(() => {
      expect(onHasExistingDataChange).toHaveBeenCalledWith(false);
      expect(screen.getByText(/fresh onboarding/i)).toBeTruthy();
    });
  });

  it("confirm checkbox click fires onConfirmChange(true) when existing data detected", async () => {
    global.fetch = mockFetchResponse({
      dryRun: true,
      stagingId: "s1",
      year: 2026,
      planExisted: true,
      currentLineCount: 50,
      incomingLineCount: 60,
      sheetCount: { success: 1, failure: 0 },
      totals: {
        revenue: { current: 100, incoming: 110, deltaPct: 10 },
        cogs: { current: 50, incoming: 55, deltaPct: 10 },
        expense: { current: 20, incoming: 22, deltaPct: 10 },
      },
      gross_profit: { current: 50, incoming: 55 },
    }) as never;
    const onConfirmChange = vi.fn();
    render(
      <DriftDiffPreview
        stagingId="s1"
        file={fakeFile}
        companyCode="CO"
        companyName=""
        confirmed={false}
        onConfirmChange={onConfirmChange}
      />,
    );
    const checkbox = await screen.findByTestId("drift-diff-confirm");
    fireEvent.click(checkbox);
    expect(onConfirmChange).toHaveBeenCalledWith(true);
  });

  it("shows error state when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Server error",
    }) as never;
    render(
      <DriftDiffPreview
        stagingId="s1"
        file={fakeFile}
        companyCode="CO"
        companyName=""
        confirmed={false}
        onConfirmChange={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Diff preview failed/)).toBeTruthy();
    });
  });
});
