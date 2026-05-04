// @vitest-environment happy-dom
/**
 * Phase 7.G Turn VIII — IndicatorDetail hint-paragraph i18n.
 *
 * Locks:
 *   - Render picks `hintTemplateRu` when `useLocale()` returns "ru";
 *   - Falls back to `hintTemplateEn` when the locale-specific field is
 *     null (e.g. an indicator that hasn't been translated yet);
 *   - `{status}` substitution token is localized via `tStatus()` so the
 *     inline status word matches the badge above (architect Turn-VII
 *     Round-1 sub-task closure — pre-Turn-VIII this leaked raw "RED"
 *     into translated hints).
 *
 * Each test runs in isolation via `vi.resetModules()` so the next-intl
 * mock can return a different locale per case. The canonical
 * `IndicatorDetail.test.tsx` covers the EN happy path; this file
 * exercises the RU/AZ branches + EN fallback.
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
import { render, screen, cleanup, waitFor } from "@testing-library/react";

interface IndicatorFixture {
  hintTemplateEn?: string | null;
  hintTemplateRu?: string | null;
  hintTemplateAz?: string | null;
}

function buildFixture(ind: IndicatorFixture = {}) {
  return {
    id: "iv_test",
    value: -2.79,
    status: "red" as const,
    period: "2026",
    computedAt: "2026-04-28T00:00:00Z",
    inputs: { resolved: {}, aggregates: {}, error: undefined },
    sparkline: null,
    indicator: {
      id: "ind_x",
      code: "IND_NET_MARGIN",
      nameEn: "Net Margin",
      nameRu: "Чистая маржа",
      nameAz: "Xalis mənfəət",
      unit: "%",
      direction: "higher_better" as const,
      formula: "x",
      thresholds: {},
      hintTemplateEn: "EN hint: {value}% — {status}.",
      hintTemplateRu: null,
      hintTemplateAz: null,
      requiredInputs: [],
      ...ind,
    },
    company: {
      id: "co_test",
      code: "TEST-CO",
      name: "Test Co",
      industry: "industrial",
    },
  };
}

// Note: this file's t() mock at line ~94 (camelCase-uppercased fallback)
// diverges from `vitest.setup.ts`'s explicit-labels-first global mock.
// Current render contract doesn't call t() on the hint-substitution path,
// so the divergence is harmless — but if a future tweak adds e.g.
// `t('indicatorDetail.hintPrefix')` here, this file will silently render
// different text than the canonical IndicatorDetail.test.tsx. Architect
// Turn-VIII Round-1 closure: documenting the divergence inline.
async function renderWithLocale(locale: "en" | "ru" | "az", ind: IndicatorFixture) {
  vi.resetModules();
  vi.doMock("../store/terminalStore", () => ({
    useTerminalStore: <T,>(
      selector: (s: {
        activeIndicatorValueId: string | null;
        pendingMissingCell: null;
        pendingRollupCell: null;
        setActivePanel: (id: number) => void;
      }) => T,
    ) =>
      selector({
        activeIndicatorValueId: "iv_test",
        pendingMissingCell: null,
        pendingRollupCell: null,
        setActivePanel: () => {},
      }),
  }));
  vi.doMock("next-intl", async (importOriginal) => {
    const actual = await importOriginal<typeof import("next-intl")>();
    return {
      ...actual,
      useLocale: () => locale,
      useTranslations: (namespace?: string) => {
        if (namespace === "terminal.status") {
          return ((key: string) => `${locale}:${key}`) as never;
        }
        return ((key: string) =>
          key.replace(/[A-Z]/g, " $&").toUpperCase()) as never;
      },
    };
  });
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(buildFixture(ind)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as never;
  const { IndicatorDetail } = await import("./IndicatorDetail");
  return render(<IndicatorDetail />);
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Each test re-renders via renderWithLocale with fresh mocks.
});

describe("IndicatorDetail hint i18n (Phase 7.G Turn VIII)", () => {
  it("renders hintTemplateRu + tStatus-localized {status} when locale=ru AND RU template populated", async () => {
    await renderWithLocale("ru", {
      hintTemplateEn: "EN: {value}% — {status}.",
      // Distinct sentinel text so the regex doesn't collide with the
      // indicator name field above (which is also "Чистая маржа").
      hintTemplateRu: "RU-HINT-MARKER {value}% — {status}.",
    });
    await waitFor(() => {
      expect(screen.getByText(/RU-HINT-MARKER/)).toBeTruthy();
    });
    // {value} substituted; {status} substituted via tStatus → "ru:red".
    expect(screen.getByText(/RU-HINT-MARKER .*% — ru:red\./)).toBeTruthy();
    // EN template NOT rendered.
    expect(screen.queryByText(/EN:/)).toBeNull();
  });

  it("falls back to hintTemplateEn when locale=ru AND RU template is null", async () => {
    await renderWithLocale("ru", {
      hintTemplateEn: "EN-only: {value}% — {status}.",
      hintTemplateRu: null,
      hintTemplateAz: null,
    });
    await waitFor(() => {
      expect(screen.getByText(/EN-only/)).toBeTruthy();
    });
    // EN template rendered; {status} still localized via tStatus → "ru:red".
    expect(screen.getByText(/EN-only: .*% — ru:red\./)).toBeTruthy();
  });

  it("uses hintTemplateEn when locale=en regardless of Ru/Az presence", async () => {
    await renderWithLocale("en", {
      hintTemplateEn: "EN canonical: {value}% — {status}.",
      hintTemplateRu: "ШУМ: {value}% — {status}.",
      hintTemplateAz: "Xəbərdarlıq: {value}% — {status}.",
    });
    await waitFor(() => {
      expect(screen.getByText(/EN canonical/)).toBeTruthy();
    });
    expect(screen.queryByText(/ШУМ/)).toBeNull();
    expect(screen.queryByText(/Xəbərdarlıq/)).toBeNull();
  });
});
