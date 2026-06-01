// @vitest-environment happy-dom
/**
 * ScenarioFormModal — friendly shock editor + validator fix (2026-06-01).
 *
 * Locks the bug reported from the live demo: editing a crisis/shock scenario
 * (e.g. BRENT_TO_140) and changing its target number used to disable Save,
 * because the JSON validator only accepted the legacy `adjustments[]` format
 * and rejected the `shock{...}` format every catalog crisis scenario uses.
 * Also covers the new friendly editor (labeled number input + effect select)
 * that lets a non-technical user change the value without touching raw JSON.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ScenarioFormModal, type ScenarioFormValues } from "./ScenarioFormModal";

const shockInitial: ScenarioFormValues = {
  id: "scn_brent",
  code: "BRENT_TO_140",
  nameEn: "Brent → $140/bbl",
  nameRu: "Brent → $140/баррель",
  description: "Brent climbs to $140.",
  overrides: JSON.stringify(
    { shock: { target: { metric: "BRENT_USD_BBL", value: 140, drives: "inputCostShock" } } },
    null,
    2,
  ),
};

const fxInitial: ScenarioFormValues = {
  id: "scn_azn",
  code: "AZN_DEVAL_20",
  nameEn: "AZN devaluation",
  nameRu: "",
  description: "",
  overrides: JSON.stringify(
    { shock: { target: { metric: "AZN_USD", value: 2.04, drives: "fxShock" }, assumedImportShare: 0.3 } },
    null,
    2,
  ),
};

const legacyInitial: ScenarioFormValues = {
  id: "scn_legacy",
  code: "LEGACY_MULT",
  nameEn: "Legacy multiplier",
  nameRu: "",
  description: "",
  overrides: JSON.stringify({ adjustments: [{ codes: ["IND_NET_MARGIN"], multiply: 0.8 }] }, null, 2),
};

function jsonText(): string {
  return (screen.getByTestId("overrides-json") as HTMLTextAreaElement).value;
}
function saveBtn(): HTMLButtonElement {
  return screen.getByTestId("scenario-form-save") as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScenarioFormModal — shock scenarios are editable (bug fix)", () => {
  it("shows the friendly editor for a shock scenario, prefilled with the target value", () => {
    render(<ScenarioFormModal initial={shockInitial} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByTestId("shock-editor")).toBeTruthy();
    expect((screen.getByTestId("shock-value-input") as HTMLInputElement).value).toBe("140");
  });

  it("does NOT show the friendly editor for a legacy adjustments[] scenario", () => {
    render(<ScenarioFormModal initial={legacyInitial} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByTestId("shock-editor")).toBeNull();
    expect(screen.getByTestId("overrides-json")).toBeTruthy();
  });

  it("changing the friendly value rewrites the JSON and keeps Save enabled", () => {
    render(<ScenarioFormModal initial={shockInitial} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId("shock-value-input"), { target: { value: "120" } });
    // JSON re-serialized with the new value, structure still valid → Save enabled.
    expect(JSON.parse(jsonText()).shock.target.value).toBe(120);
    expect(saveBtn().disabled).toBe(false);
  });

  it("editing the raw shock JSON directly does not disable Save (validator accepts shock)", () => {
    render(<ScenarioFormModal initial={shockInitial} onClose={() => {}} onSaved={() => {}} />);
    const next = JSON.stringify({ shock: { target: { metric: "BRENT_USD_BBL", value: 120, drives: "inputCostShock" } } }, null, 2);
    fireEvent.change(screen.getByTestId("overrides-json"), { target: { value: next } });
    expect(saveBtn().disabled).toBe(false);
  });

  it("still rejects genuinely malformed overrides (neither adjustments nor shock)", () => {
    render(<ScenarioFormModal initial={shockInitial} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId("overrides-json"), { target: { value: '{ "foo": 1 }' } });
    expect(saveBtn().disabled).toBe(true);
  });

  it("changing the effect select rewrites the drives in the JSON", () => {
    render(<ScenarioFormModal initial={shockInitial} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId("shock-drives-select"), { target: { value: "fxShock" } });
    expect(JSON.parse(jsonText()).shock.target.drives).toBe("fxShock");
  });

  it("surfaces assumedImportShare as its own input when present", () => {
    render(<ScenarioFormModal initial={fxInitial} onClose={() => {}} onSaved={() => {}} />);
    const share = document.getElementById("shock-import-share") as HTMLInputElement;
    expect(share).toBeTruthy();
    expect(share.value).toBe("0.3");
  });

  it("PATCHes the edited shock value to the API on Save", async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "scn_brent", code: "BRENT_TO_140", nameEn: "Brent → $140/bbl" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as never;

    render(<ScenarioFormModal initial={shockInitial} onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId("shock-value-input"), { target: { value: "120" } });
    fireEvent.click(saveBtn());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/scenarios/scn_brent");
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body as string);
    expect(body.overrides.shock.target.value).toBe(120);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
