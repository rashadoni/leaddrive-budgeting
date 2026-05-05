// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XXIV — render-site locale-integration test for
 * CompanySnapshot (sibling of AlertsPanel.locale-integration.test.tsx
 * shipped Turn XXIII). Closes 2/3 of the residual filed XXIII.
 *
 * Mirrors AlertsPanel pattern: per-test next-intl override loads real
 * messages JSON; mounts panel with sector-amber-cluster alert match;
 * asserts industry param resolves to localized string in DOM.
 *
 * CompanySnapshot at `CompanySnapshot.tsx:218-236` invokes the same
 * `localizeAlertMessageParams(messageParams, tIndustries)` pattern in
 * the `companyAlerts` rendering branch — any regression there would
 * surface here AND in AlertsPanel + ActionCenterPanel.
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
  waitFor,
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
  affectedCompanyIds: ["co_aac"] as readonly string[],
  affectedIndicatorCodes: [] as readonly string[],
};

const MATRIX_FIXTURE = {
  period: "2026",
  companies: [
    {
      id: "co_aac",
      code: "AAC-MAIN",
      name: "AAC Main",
      industry: "industrial",
      level: 2,
      role: "operational",
    },
  ],
  indicators: [
    {
      id: "ind_gross",
      code: "IND_GROSS_MARGIN",
      nameEn: "Gross Margin",
      nameRu: "Валовая маржа",
      nameAz: "Ümumi marja",
      unit: "%",
      direction: "higher_better",
    },
  ],
  cells: [
    {
      indicatorValueId: "iv1",
      companyId: "co_aac",
      indicatorId: "ind_gross",
      value: 15.1,
      status: "amber",
      sparkline: [10, 11, 12, 13, 14, 15, 14, 15, 14, 15, 14, 15.1],
    },
  ],
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
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(MATRIX_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

async function mountCompanySnapshotInLocale(locale: "en" | "ru" | "az") {
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
      selector: (s: { alertMatches: typeof SAMPLE_MATCH[] }) => T,
    ) => selector({ alertMatches: [SAMPLE_MATCH] }),
  }));
  // Reset useMatrix module cache so fetch mock above controls the
  // resolved data (mirrors CompanySnapshot.test.tsx beforeEach pattern).
  const useMatrixModule = await import("../hooks/use-matrix");
  useMatrixModule.__resetMatrixCacheForTests();
  const { CompanySnapshot } = await import("./CompanySnapshot");
  return render(<CompanySnapshot companyCode="AAC-MAIN" />);
}

describe("CompanySnapshot locale-aware industry rendering (Phase 7.G Turn XXIV)", () => {
  it("EN: industry-code 'industrial' baseline in companyAlerts section", async () => {
    await mountCompanySnapshotInLocale("en");
    await waitFor(() => {
      expect(
        screen.queryByText(
          /industrial sector: 5 amber cells across 2 companies/i,
        ),
      ).toBeTruthy();
    });
  });

  it("RU: industry localized to 'промышленность'", async () => {
    await mountCompanySnapshotInLocale("ru");
    await waitFor(() => {
      expect(
        screen.queryByText(
          /Сектор промышленность: 5 амбер-ячеек у 2 компаний/,
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/industrial sector/i)).toBeNull();
  });

  it("AZ: industry localized to 'sənaye'", async () => {
    await mountCompanySnapshotInLocale("az");
    await waitFor(() => {
      expect(
        screen.queryByText(/sənaye sektoru: 2 şirkətdə 5 sarı xana/),
      ).toBeTruthy();
    });
  });
});
