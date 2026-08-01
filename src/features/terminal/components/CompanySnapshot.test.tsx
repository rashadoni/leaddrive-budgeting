// @vitest-environment happy-dom
/**
 * Phase B7 — CompanySnapshot tests.
 *
 * Locks in:
 *   - Loading state during fetch.
 *   - Error state on fetch failure.
 *   - Renders 3 cards (Gross/Net/OpEx) when matrix has all 3 indicators.
 *   - Each card shows nameEn, value+unit, sparkline.
 *   - Filters down gracefully when 1+ indicator absent for company.
 *   - Empty fallback when company has none of the 3 indicators.
 *   - Unknown company → "not in current matrix" message.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import * as nextIntl from "next-intl";
import { CompanySnapshot } from "./CompanySnapshot";
import { __resetMatrixCacheForTests } from "../hooks/use-matrix";
import { __resetCompaniesCacheForTests } from "../hooks/use-companies";

// Sub-35 — top-alerts section reads `alertMatches` from terminalStore.
// Module-scope mock with a let-binding so individual tests can swap in
// fixtures (top-alerts hidden when null/empty — most existing tests keep
// the default null which suppresses the section).
let mockAlertMatches:
  | null
  | Array<{
      ruleId: string;
      ruleName: string;
      severity: "critical" | "warning" | "info";
      message: string;
      messageKey?: string;
      messageParams?: Record<string, string | number>;
      affectedCompanyIds: readonly string[];
    }> = null;

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(
    selector: (s: { alertMatches: typeof mockAlertMatches }) => T,
  ) => selector({ alertMatches: mockAlertMatches }),
}));

const FULL_FIXTURE = {
  period: "2026",
  companies: [
    { id: "co_aac", code: "AAC-MAIN", name: "AAC Main", industry: "Industrial" },
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
    {
      id: "ind_net",
      code: "IND_NET_MARGIN",
      nameEn: "Net Margin",
      nameRu: "Чистая маржа",
      nameAz: "Xalis marja",
      unit: "%",
      direction: "higher_better",
    },
    {
      id: "ind_opex",
      code: "IND_OPEX_RATIO",
      nameEn: "OpEx Ratio",
      nameRu: "Доля операционных расходов",
      nameAz: "Əməliyyat xərcləri nisbəti",
      unit: "%",
      direction: "lower_better",
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
    {
      indicatorValueId: "iv2",
      companyId: "co_aac",
      indicatorId: "ind_net",
      value: -9.46,
      status: "red",
      sparkline: [-9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46, -9.46],
    },
    {
      indicatorValueId: "iv3",
      companyId: "co_aac",
      indicatorId: "ind_opex",
      value: 24.6,
      status: "amber",
      sparkline: [24, 24.5, 25, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6, 24.6],
    },
  ],
};

beforeEach(() => {
  // Sub-20: reset useMatrix module cache between tests so each test's
  // fetch mock controls the resolved data (without this the first
  // test's payload sticks for the rest of the file).
  __resetMatrixCacheForTests();
  // Phase 7.N — CompanySnapshot now subscribes to useCompanies() for
  // riskTags; reset that module cache too so the never-resolving fetch in
  // the "Loading" test (and per-test fetch overrides) don't bleed across
  // tests. Convention documented in use-companies.ts.
  __resetCompaniesCacheForTests();
  mockAlertMatches = null;
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(FULL_FIXTURE), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CompanySnapshot (Phase B7)", () => {
  it("renders Loading state during fetch", () => {
    __resetMatrixCacheForTests();
    let resolveFetch!: (value: Response) => void;
    global.fetch = vi.fn(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    ) as never;
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    expect(screen.queryByText(/Loading snapshot/i)).toBeTruthy();
    resolveFetch(
      new Response(JSON.stringify(FULL_FIXTURE), { status: 200 }),
    );
  });

  it("renders 3 cards (Gross/Net/OpEx) for company with all 3 indicators", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    expect(screen.queryByText("Net Margin")).toBeTruthy();
    expect(screen.queryByText("OpEx Ratio")).toBeTruthy();
    // Each card shows formatted value
    expect(screen.queryByText("15.1 %")).toBeTruthy();
    expect(screen.queryByText("-9.46 %")).toBeTruthy();
    expect(screen.queryByText("24.6 %")).toBeTruthy();
  });

  it("each card has a sparkline svg", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    const svgs = document.querySelectorAll("svg[role='img']");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  // 2026-05-29 — the visual-baseline-snapshotcard gate MASKS the value row
  // (status glyph + value + status color are data-driven; they recompute on
  // every IndicatorValue change). So the status→color contract is asserted
  // HERE in the DOM rather than in pixels. This also guards two invariants
  // the gate depends on: (a) the `snapshot-card-value` testid exists (the
  // mask target — a rename would silently no-op the mask, the exact bug the
  // old `.sparkline svg` selector had), and (b) one value row per card.
  it("value row carries the mask testid + correct status-color class", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    // (a) mask target exists, one per card (fixture has 3 margin cards).
    const valueRows = document.querySelectorAll(
      '[data-testid="snapshot-card-value"]',
    );
    expect(valueRows.length).toBe(3);
    // (b) status → color (same mapping as HeatMap cells):
    //   red → text-[#FF4757], amber → text-[#FFB020], green → text-[#00D4AA]
    expect(screen.getByText("-9.46 %").className).toContain("text-[#FF4757]"); // net = red
    expect(screen.getByText("15.1 %").className).toContain("text-[#FFB020]"); // gross = amber
  });

  it("Header shows active company code in highlight color", async () => {
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Gross Margin")).toBeTruthy();
    });
    expect(screen.queryByText("AAC-MAIN")).toBeTruthy();
    // Sub-27 cont'd Round-3 i18n wave 2: vitest.setup.ts EXPLICIT_LABELS
    // now maps `snapshot.title` → "Snapshot" + `snapshot.trend12mo` →
    // "12mo trend" so existing assertions match without component rewrite.
    expect(screen.queryByText(/Snapshot/)).toBeTruthy();
    expect(screen.queryByText(/12mo trend/)).toBeTruthy();
  });

  it("Falls back to no-data text when company has 0 of 3 indicators", async () => {
    const noMatchFixture = {
      ...FULL_FIXTURE,
      indicators: [
        {
          id: "ind_other",
          code: "AGRO_YIELD",
          nameEn: "Yield",
          unit: "ton/ha",
          direction: "higher_better",
        },
      ],
      cells: [],
    };
    __resetMatrixCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(noMatchFixture), { status: 200 }),
    ) as never;
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText(/No P&L margin indicators/i)).toBeTruthy();
    });
  });

  it("Shows 'not in current matrix' for unknown company code", async () => {
    render(<CompanySnapshot companyCode="GHOST-CO" />);
    await waitFor(() => {
      expect(screen.queryByText(/not in current matrix/i)).toBeTruthy();
    });
  });

  it("Renders error state on fetch failure", async () => {
    __resetMatrixCacheForTests();
    global.fetch = vi.fn(async () =>
      new Response("server error", { status: 500 }),
    ) as never;
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText(/Snapshot error/i)).toBeTruthy();
    });
  });

  // Sub-35 — top-alerts row uses i18n message body for built-in ruleIds.
  // Custom ruleIds keep the engine `m.message` fallback (BC). Verifies
  // the `t(messageKey, messageParams)` wiring at CompanySnapshot.tsx:215.
  it("renders i18n alert body in top-alerts when ruleId is built-in (sub-35)", async () => {
    mockAlertMatches = [
      {
        ruleId: "company-mostly-red",
        ruleName: "Company has many red indicators",
        severity: "critical",
        message: "ENGINE_FALLBACK_should_not_appear",
        messageKey: "alerts.messages.company-mostly-red",
        messageParams: { code: "AAC-MAIN", redCount: 5 },
        affectedCompanyIds: ["co_aac"],
      },
    ];
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText(/AAC-MAIN has 5 red indicators/)).toBeTruthy();
    });
    expect(
      screen.queryByText(/ENGINE_FALLBACK_should_not_appear/),
    ).toBeNull();
  });

  // Sub-34 — KPI labels resolve via `resolveIndicatorLabel(ind, locale)`
  // rather than `ind.nameEn` directly, so when the user switches the
  // terminal to Russian the margin cards show "Валовая маржа" / "Чистая
  // маржа" / "Доля операционных расходов" instead of the English
  // hardcoded names. Locks in the wiring (resolver call site) — the
  // resolver itself has full unit-test coverage in
  // `resolve-indicator-label.test.ts`.
  it("renders Russian indicator names when locale=ru", async () => {
    vi.spyOn(nextIntl, "useLocale").mockReturnValue("ru");
    render(<CompanySnapshot companyCode="AAC-MAIN" />);
    await waitFor(() => {
      expect(screen.queryByText("Валовая маржа")).toBeTruthy();
    });
    expect(screen.queryByText("Чистая маржа")).toBeTruthy();
    expect(screen.queryByText("Доля операционных расходов")).toBeTruthy();
    // English names should NOT be rendered in RU locale.
    expect(screen.queryByText("Gross Margin")).toBeNull();
  });
});

describe("CompanySnapshot composite applies Phase 7.N riskTag penalties", () => {
  // Regression lock for the Panel-4/Panel-1 parity bug: the snapshot's
  // composite badge ignored Company.settings.riskTags while CompanyTree
  // (Panel 1) applied them, so the same company showed two different scores
  // on one /budgeting/terminal screen. Mocks BOTH the matrix endpoint AND
  // /api/companies (the riskTags source).
  beforeEach(() => {
    __resetMatrixCacheForTests();
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/indicators/matrix")) {
        return new Response(
          JSON.stringify({
            period: "2026",
            companies: [
              { id: "co_eden", code: "EDEN", name: "Eden", industry: "Agri" },
            ],
            // 11.81 — four indicators, so the company clears the coverage
            // floor and the badge has a number for the penalty to move.
            indicators: ["ind_a", "ind_b", "ind_c", "ind_d"].map((id) => ({
              id, code: id.toUpperCase(), nameEn: id, unit: "%", direction: "higher_better",
            })),
            cells: ["ind_a", "ind_b", "ind_c", "ind_d"].map((indicatorId, n) => ({
              indicatorValueId: `iv${n}`, companyId: "co_eden", indicatorId, value: 50, status: "green",
            })),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("/api/companies")) {
        return new Response(
          JSON.stringify([
            { id: "co_eden", code: "EDEN", name: "Eden", settings: { riskTags: ["data_absence"] } },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as never;
  });

  it("penalises the active company's composite badge (100 → 88)", async () => {
    render(<CompanySnapshot companyCode="EDEN" />);
    // 88 = base 100 (all-green) minus data_absence (-12). IMPOSSIBLE without
    // the riskTags wiring — pre-fix the badge rendered 100. waitFor covers the
    // two-source async (matrix + companies both resolve).
    await waitFor(() => {
      expect(screen.getByText("88")).toBeTruthy();
    });
    // The unpenalised 100 must NOT appear anywhere once the penalty applies —
    // this is the assertion that would have caught the original bug.
    expect(screen.queryByText("100")).toBeNull();
  });

  it("11.81 — a company below the coverage floor gets a named state, not a bare dash", async () => {
    __resetMatrixCacheForTests();
    __resetCompaniesCacheForTests();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/indicators/matrix")) {
        return new Response(
          JSON.stringify({
            period: "2026",
            companies: [
              { id: "co_eden", code: "EDEN", name: "Eden", industry: "Agri" },
            ],
            indicators: ["ind_a", "ind_b", "ind_c", "ind_d"].map((id) => ({
              id, code: id.toUpperCase(), nameEn: id, unit: "%", direction: "higher_better",
            })),
            // One figure out of four applicable indicators — the DASTAN shape.
            cells: [
              { indicatorValueId: "iv0", companyId: "co_eden", indicatorId: "ind_a", value: 50, status: "red" },
              ...["ind_b", "ind_c", "ind_d"].map((indicatorId, n) => ({
                indicatorValueId: `iv${n + 1}`, companyId: "co_eden", indicatorId, value: 0, status: "unknown",
              })),
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as never;
    render(<CompanySnapshot companyCode="EDEN" />);
    await waitFor(() => {
      expect(screen.getByTestId("composite-badge-big-unscored")).toBeTruthy();
    });
    const badge = screen.getByTestId("composite-badge-big-unscored");
    expect(badge.textContent).toContain("Not enough data to score");
    expect(badge.textContent).toContain("1 of 4 indicators");
    // The old "0" verdict must not appear on the badge.
    expect(badge.textContent).not.toContain("0/100");
  });
});
