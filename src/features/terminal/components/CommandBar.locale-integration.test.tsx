// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XXV — render-site locale-integration test for
 * CommandBar autocomplete (closes XXIV residual; Phase 7.G Turn-H
 * scope-extension). Closes the i18n integration test set started by
 * AlertsPanel (XXIII) + ActionCenterPanel + CompanySnapshot (XXIV).
 *
 * Different shape from the alert-rendering siblings: CommandBar exercises
 * `resolveIndicatorLabel(ind, locale)` (lib/resolve-indicator-label.ts)
 * NOT `localizeAlertMessageParams`. The autocomplete dropdown's hint
 * field shows the locale-aware indicator name; pre-XXV no test verified
 * that RU/AZ locale actually produces `nameRu`/`nameAz` in the rendered
 * DOM.
 *
 * Verified contract (CommandBar.tsx:357-370): for each indicator in
 * matrix, suggestion `hint = resolveIndicatorLabel(ind, locale)`. Test
 * types a query that fuzzy-matches the indicator code, asserts the
 * suggestion hint text matches the locale-aware name field.
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
  waitFor,
} from "@testing-library/react";

const MATRIX_FIXTURE = {
  period: "2026",
  companies: [],
  indicators: [
    {
      id: "ind_net",
      code: "IND_NET_MARGIN",
      nameEn: "Net Margin",
      nameRu: "Чистая маржа",
      nameAz: "Xalis marja",
      unit: "%",
      direction: "higher_better",
    },
  ],
  cells: [],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MATRIX_FIXTURE),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountCommandBarInLocale(locale: "en" | "ru" | "az") {
  vi.resetModules();
  vi.doMock("next-intl", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next-intl")>();
    return {
      ...actual,
      useLocale: () => locale,
      // CommandBar's t() calls aren't load-bearing for the autocomplete
      // hint contract being tested — uppercase fallback is fine. The
      // load-bearing path is `useLocale() → resolveIndicatorLabel`.
      useTranslations: () =>
        ((key: string) =>
          key.replace(/[A-Z]/g, " $&").toUpperCase()) as never,
      NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
        children,
    };
  });
  vi.doMock("../hooks/use-matrix", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../hooks/use-matrix")>();
    actual.__resetMatrixCacheForTests();
    return actual;
  });
  vi.doMock("../store/terminalStore", () => ({
    useTerminalStore: <T,>(selector: (s: never) => T) =>
      selector({
        clearState: () => {},
        setActivePanel: () => {},
        setActiveScenario: () => {},
        selectCompany: () => {},
        setActiveIndicatorValue: () => {},
        setFeedback: () => {},
        starredCompanyCodes: new Set<string>(),
        setStarredCompanies: () => {},
      } as never),
    getTerminalSnapshot: () => ({
      activePanelId: 1,
      starredCompanyCodes: new Set<string>(),
    }),
  }));
  const { CommandBar } = await import("./CommandBar");
  return render(<CommandBar />);
}

function getInput(): HTMLInputElement {
  const el = document.querySelector(
    '[data-cmd-bar="true"]',
  ) as HTMLInputElement | null;
  if (!el) throw new Error("CommandBar input not found");
  return el;
}

describe("CommandBar autocomplete locale-aware indicator hints (Phase 7.G Turn XXV)", () => {
  it("EN: indicator suggestion hint shows nameEn 'Net Margin'", async () => {
    await mountCommandBarInLocale("en");
    const input = getInput();
    // Type a query that fuzzy-matches IND_NET_MARGIN code. Focus first
    // so the suggestion dropdown renders.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "NET" } });
    await waitFor(() => {
      expect(screen.queryByText("Net Margin")).toBeTruthy();
    });
    // Negative: RU/AZ names must NOT leak through under EN locale.
    expect(screen.queryByText("Чистая маржа")).toBeNull();
    expect(screen.queryByText("Xalis marja")).toBeNull();
  });

  it("RU: indicator suggestion hint shows nameRu 'Чистая маржа'", async () => {
    await mountCommandBarInLocale("ru");
    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "NET" } });
    await waitFor(() => {
      expect(screen.queryByText("Чистая маржа")).toBeTruthy();
    });
    expect(screen.queryByText("Net Margin")).toBeNull();
  });

  it("AZ: indicator suggestion hint shows nameAz 'Xalis marja'", async () => {
    await mountCommandBarInLocale("az");
    const input = getInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "NET" } });
    await waitFor(() => {
      expect(screen.queryByText("Xalis marja")).toBeTruthy();
    });
    expect(screen.queryByText("Net Margin")).toBeNull();
  });
});
