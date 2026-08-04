// @vitest-environment happy-dom
/**
 * Panel 4 — the explainer's language picker must START on the interface
 * language.
 *
 * 2026-08-04: it was hardcoded to "en". An owner running the terminal in
 * Azerbaijani opened Panel 4, got an English narrative, pressed AZ, and paid
 * for a second LLM call — every single time. The picker stays (all three
 * languages are read here), this only pins where it opens.
 *
 * The global `vitest.setup.ts` mock returns `useLocale: () => 'en'`, so the
 * main panel suite cannot see this regression: under that mock the old
 * hardcoded default and the new locale-derived one are the same value. Hence a
 * separate file that re-mocks `next-intl` per locale.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  // The panel renders idle until an explicit Explain action, so no request
  // should fire on mount. Fail loudly if that ever changes — an auto-fetch on
  // mount would spend provider tokens on a cell click.
  global.fetch = vi.fn(async () => {
    throw new Error("Panel 4 must not call the API before an explicit action");
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function mountInLocale(locale: string) {
  vi.resetModules();
  vi.doMock("next-intl", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next-intl")>();
    return {
      ...actual,
      useLocale: () => locale,
      // Identity translator: this file asserts on the picker's pressed state,
      // not on copy.
      useTranslations: () => {
        const t = (key: string) => key;
        (t as unknown as { rich: unknown }).rich = (key: string) => key;
        (t as unknown as { has: () => boolean }).has = () => true;
        return t as never;
      },
    };
  });
  // A cell must be selected, otherwise the panel renders its "pick a cell"
  // empty state, which has no language picker at all.
  vi.doMock("../store/terminalStore", () => ({
    useTerminalStore: <T,>(selector: (s: Record<string, unknown>) => T) =>
      selector({
        activeIndicatorValueId: "iv_test",
        activeCompanyCode: "AZSF",
        alertMatches: [],
      }),
  }));

  const { VarianceExplainerPanel } = await import("./VarianceExplainerPanel");
  render(<VarianceExplainerPanel />);
}

/** The one selected language button, by its `aria-checked` state. */
function selectedLanguage(): string {
  const pressed = ["EN", "RU", "AZ"].filter((label) => {
    const button = screen.getByRole("radio", { name: label });
    return button.getAttribute("aria-checked") === "true";
  });
  expect(pressed).toHaveLength(1);
  return pressed[0];
}

describe("Panel 4 language default", () => {
  it("opens on AZ when the interface is Azerbaijani", async () => {
    await mountInLocale("az");
    expect(selectedLanguage()).toBe("AZ");
  });

  it("opens on RU when the interface is Russian", async () => {
    await mountInLocale("ru");
    expect(selectedLanguage()).toBe("RU");
  });

  it("opens on EN when the interface is English", async () => {
    await mountInLocale("en");
    expect(selectedLanguage()).toBe("EN");
  });

  it("falls back to EN for a locale the explainer cannot write", async () => {
    // next-intl could hand us any configured locale; the LLM prompt only has
    // en/ru/az. Anything else must degrade, not render a broken picker with
    // nothing selected.
    await mountInLocale("tr");
    expect(selectedLanguage()).toBe("EN");
  });
});
