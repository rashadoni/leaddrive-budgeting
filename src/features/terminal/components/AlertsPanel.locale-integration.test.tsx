// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XXIII — render-site integration test for `industries.*`
 * locale flow (closes 44-turn 🔄, Phase 7.G Turn G architect Round-1 💡).
 *
 * Locks: real `useLocale()` ↔ `useTranslations('industries')` ↔
 * `localizeAlertMessageParams` ↔ AlertsPanel render path produces
 * locale-aware DOM text. Pre-XXIII coverage was at the helper-call layer
 * (10 unit tests of `localizeAlertMessageParams`); the localized-output
 * assertion was missing on every render site because `vitest.setup.ts:305`
 * mocks `useLocale: () => 'en'` globally.
 *
 * v1 scope: AlertsPanel only. Closure path called for AlertsPanel +
 * ActionCenterPanel + CompanySnapshot + CommandBar (4-5 sites). The
 * single-site coverage is enough to lock the integration contract; the
 * remaining 3 sites use the same helper at the same layer and would
 * silently inherit any regression caught here.
 *
 * Per-test override pattern mirrors `IndicatorDetail.hint-i18n.test.tsx`
 * (vi.resetModules + vi.doMock). Real messages JSON is loaded at file
 * top so the test exercises the actual translation strings, not stubs —
 * defends against drift between fixture mocks and shipped JSON.
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
  // Industry-translator-shape: provide `.has` so `localizeAlertMessageParams`
  // takes the primary path (no fallback try/catch). Cast via `unknown`
  // because the function signature doesn't structurally overlap with
  // `{ has: ... }` directly — the runtime adds the property.
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
    return new Response("not found", { status: 404 });
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function mountAlertsPanelInLocale(locale: "en" | "ru" | "az") {
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
      }) => T,
    ) =>
      selector({
        alertMatches: [SAMPLE_MATCH],
        selectCompany: () => {},
      }),
  }));
  const { AlertsPanel } = await import("./AlertsPanel");
  const result = render(<AlertsPanel />);
  // AlertsPanel is dialog-shaped; opens on terminal:open-alerts event.
  await act(async () => {
    window.dispatchEvent(new Event("terminal:open-alerts"));
  });
  return result;
}

describe("AlertsPanel locale-aware industry rendering (Phase 7.G Turn XXIII)", () => {
  it("EN: industry-code renders as 'industrial' (baseline — no translation)", async () => {
    await mountAlertsPanelInLocale("en");
    // EN messages.industries.industrial = "industrial" — same as raw code.
    // EN body template: "{industry} sector: {amberCount} amber cells across {companyCount} companies"
    const text = await screen.findByText(
      /industrial sector: 5 amber cells across 2 companies/i,
    );
    expect(text).toBeTruthy();
  });

  it("RU: industry localized to 'промышленность' in DOM, raw 'industrial' absent", async () => {
    await mountAlertsPanelInLocale("ru");
    // RU body template: "Сектор {industry}: {amberCount} амбер-ячеек у {companyCount} компаний"
    // {industry} param replaced via localizeAlertMessageParams: "industrial" → "промышленность".
    const text = await screen.findByText(
      /Сектор промышленность: 5 амбер-ячеек у 2 компаний/,
    );
    expect(text).toBeTruthy();
    // Negative assertion: raw EN code MUST NOT leak through.
    expect(screen.queryByText(/industrial sector/i)).toBeNull();
  });

  it("AZ: industry localized to 'sənaye' in DOM", async () => {
    await mountAlertsPanelInLocale("az");
    // AZ body template: "{industry} sektoru: {companyCount} şirkətdə {amberCount} sarı xana"
    // {industry} param replaced: "industrial" → "sənaye".
    const text = await screen.findByText(
      /sənaye sektoru: 2 şirkətdə 5 sarı xana/,
    );
    expect(text).toBeTruthy();
  });
});
