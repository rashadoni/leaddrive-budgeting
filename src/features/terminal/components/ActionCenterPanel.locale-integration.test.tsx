// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XXIV — render-site locale-integration test for
 * ActionCenterPanel (sibling of AlertsPanel.locale-integration.test.tsx
 * shipped Turn XXIII). Closes 1/3 of the residual filed XXIII.
 *
 * Mirrors AlertsPanel pattern: per-test next-intl override loads real
 * messages JSON; mounts panel with sector-amber-cluster alert match;
 * asserts industry param resolves to localized string in DOM.
 *
 * ActionCenterPanel is also modal-shaped (opens on
 * `terminal:open-action-center` event). The alert-rendering branch at
 * `ActionCenterPanel.tsx:294-308` invokes the same
 * `localizeAlertMessageParams(messageParams, tIndustries)` pattern —
 * any regression there would surface here AND in AlertsPanel.
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
  cleanup,
  act,
} from "@testing-library/react";

import enMessages from "@/../messages/en.json";
import ruMessages from "@/../messages/ru.json";
import azMessages from "@/../messages/az.json";

const MESSAGES: Record<string, unknown> = {
  en: enMessages,
  ru: ruMessages,
  az: azMessages,
};

const SAMPLE_MATCH = {
  ruleId: "sector-amber-cluster",
  ruleName: "Sector amber cluster",
  severity: "warning" as const,
  message: "industrial sector: 5 amber cells across 2 companies",
  messageKey: "alerts.messages.sector-amber-cluster",
  messageParams: { industry: "industrial", amberCount: 5, companyCount: 2 },
  affectedCompanyIds: ["co_a_id", "co_b_id"] as readonly string[],
  affectedIndicatorCodes: [] as readonly string[],
};

function lookupAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function makeT(locale: string, namespace: string) {
  const nsParts = namespace ? namespace.split(".") : [];
  const fn = (key: string, values?: Record<string, unknown>) => {
    const path = [...nsParts, ...key.split(".")];
    const v = lookupAt(MESSAGES[locale], path);
    if (typeof v !== "string") return path.join(".");
    return v.replace(/\{(\w+)\}/g, (_m, k) =>
      values?.[k] != null ? String(values[k]) : `{${k}}`,
    );
  };
  (fn as unknown as { has: (key: string) => boolean }).has = (key: string) => {
    const path = [...nsParts, ...key.split(".")];
    const v = lookupAt(MESSAGES[locale], path);
    return typeof v === "string";
  };
  return fn;
}

beforeEach(() => {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/companies")) {
      return new Response(
        JSON.stringify([
          { id: "co_a_id", code: "AAC-MAIN" },
          { id: "co_b_id", code: "ATL-DBZ" },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (String(url).includes("/api/indicators/matrix")) {
      // ActionCenterPanel reads matrix for the cells section. Empty cells
      // are fine — the alerts section renders independently from matrix
      // payload + locks the i18n contract this test exercises.
      return new Response(
        JSON.stringify({
          companies: [],
          indicators: [],
          cells: [],
          period: "2026",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function mountActionCenterPanelInLocale(locale: "en" | "ru" | "az") {
  vi.resetModules();
  vi.doMock("next-intl", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next-intl")>();
    return {
      ...actual,
      useLocale: () => locale,
      useTranslations: (namespace?: string) => makeT(locale, namespace ?? ""),
      NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
        children,
    };
  });
  vi.doMock("../store/terminalStore", () => ({
    useTerminalStore: <T,>(
      selector: (s: {
        alertMatches: typeof SAMPLE_MATCH[];
        selectCompany: () => void;
        setActiveIndicatorValue: () => void;
        setActivePanel: () => void;
      }) => T,
    ) =>
      selector({
        alertMatches: [SAMPLE_MATCH],
        selectCompany: () => {},
        setActiveIndicatorValue: () => {},
        setActivePanel: () => {},
      }),
  }));
  const { ActionCenterPanel } = await import("./ActionCenterPanel");
  const result = render(<ActionCenterPanel />);
  await act(async () => {
    window.dispatchEvent(new Event("terminal:open-action-center"));
  });
  return result;
}

describe("ActionCenterPanel locale-aware industry rendering (Phase 7.G Turn XXIV)", () => {
  it("EN: industry-code 'industrial' baseline", async () => {
    await mountActionCenterPanelInLocale("en");
    expect(
      await screen.findByText(
        /industrial sector: 5 amber cells across 2 companies/i,
      ),
    ).toBeTruthy();
  });

  it("RU: industry localized to 'Промышленность' (Turn LVIII canonical)", async () => {
    await mountActionCenterPanelInLocale("ru");
    expect(
      await screen.findByText(
        /Сектор Промышленность: 5 амбер-ячеек у 2 компаний/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/industrial sector/i)).toBeNull();
  });

  it("AZ: industry localized to 'Sənaye' (Turn LVIII canonical)", async () => {
    await mountActionCenterPanelInLocale("az");
    expect(
      await screen.findByText(/Sənaye sektoru: 2 şirkətdə 5 sarı xana/),
    ).toBeTruthy();
  });
});
