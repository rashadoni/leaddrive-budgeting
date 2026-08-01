/**
 * Phase 7.G Turn XLIX (Board Deck v2 Turn 3) — build-trend-series tests.
 *
 * Locks: anchor-period parsing (annual/monthly/quarterly), 12-month
 * trailing walk (oldest→newest with year boundary), period-IN query
 * shape, group-by-period averaging, missing-month null gaps,
 * empty-input short-circuit, defensive prisma-required guard.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildTrendSeries,
  trailingMonths,
} from "./build-trend-series";
import type { CompositeBand } from "@/lib/risk/composite-score";

// ---------------------------------------------------------------------------
// trailingMonths
// ---------------------------------------------------------------------------

describe("trailingMonths", () => {
  it("walks back N months oldest-first, anchor is last", () => {
    const out = trailingMonths(2026, 5, 12);
    expect(out).toHaveLength(12);
    expect(out[out.length - 1]).toBe("2026-05");
    expect(out[0]).toBe("2025-06");
  });

  it("crosses year boundary correctly", () => {
    const out = trailingMonths(2026, 2, 6);
    expect(out).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("default monthsBack = 12 yields exactly 12 entries", () => {
    expect(trailingMonths(2026, 12)).toHaveLength(12);
  });

  it("supports custom monthsBack values", () => {
    expect(trailingMonths(2026, 5, 3)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
  });

  it("zero-pads single-digit months", () => {
    const out = trailingMonths(2026, 5, 12);
    expect(out).toContain("2025-06");
    expect(out).toContain("2025-09");
    expect(out).not.toContain("2025-6");
  });
});

// ---------------------------------------------------------------------------
// buildTrendSeries — anchor parsing
// ---------------------------------------------------------------------------

describe("buildTrendSeries — anchor parsing", () => {
  function makePrisma(rows: ReturnType<typeof vi.fn>) {
    return {
      indicatorValue: { findMany: rows },
    };
  }

  it("completed annual period anchors to December", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);
    await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: prisma as any, asOf: new Date("2027-01-15T00:00:00Z") },
    );
    const where = findMany.mock.calls[0][0].where;
    // Anchor at Dec 2026 → trailing 12 months covers Jan→Dec 2026.
    expect(where.period.in).toContain("2026-12");
    expect(where.period.in).toContain("2026-01");
    expect(where.period.in).not.toContain("2025-12");
    expect(where.period.in).toHaveLength(12);
    expect(where.period.in[0]).toBe("2026-01");
    expect(where.period.in[11]).toBe("2026-12");
  });

  it("current-year annual period stops at the current Baku month", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);
    await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: prisma as any, asOf: new Date("2026-07-21T12:00:00Z") },
    );
    const periods = findMany.mock.calls[0][0].where.period.in;
    expect(periods.at(-1)).toBe("2026-07");
    expect(periods).not.toContain("2026-08");
  });

  it("monthly period uses itself as anchor", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);
    await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: prisma as any },
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.period.in).toContain("2026-04");
    expect(where.period.in[where.period.in.length - 1]).toBe("2026-04");
  });

  it("quarterly period anchors to last month of the quarter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);
    await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-Q2",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: prisma as any },
    );
    const where = findMany.mock.calls[0][0].where;
    // Q2 ends in June (month 6).
    expect(where.period.in[where.period.in.length - 1]).toBe("2026-06");
  });
});

// ---------------------------------------------------------------------------
// buildTrendSeries — short-circuit + averaging
// ---------------------------------------------------------------------------

describe("buildTrendSeries — short-circuit", () => {
  it("returns null-score series when operationalIds empty", async () => {
    const result = await buildTrendSeries({
      organizationId: "org_1",
      currentPeriod: "2026-04",
      operationalIds: [],
      indicatorIds: ["ind_1"],
    });
    expect(result).toHaveLength(12);
    expect(result.every((p) => p.score === null)).toBe(true);
    // Periods still walk; chart can render flat baseline.
    expect(result[result.length - 1].period).toBe("2026-04");
  });

  it("returns null-score series when indicatorIds empty", async () => {
    const result = await buildTrendSeries({
      organizationId: "org_1",
      currentPeriod: "2026-04",
      operationalIds: ["co_1"],
      indicatorIds: [],
    });
    expect(result).toHaveLength(12);
    expect(result.every((p) => p.score === null)).toBe(true);
  });

  it("throws if prisma not injected and helper not short-circuited", async () => {
    await expect(
      buildTrendSeries({
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1"],
      }),
    ).rejects.toThrow(/prisma is required/);
  });
});

describe("buildTrendSeries — averaging", () => {
  function makePrisma(rows: unknown[]) {
    return {
      indicatorValue: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    };
  }

  it("averages composite scores per month across companies", async () => {
    // 2 companies, 1 indicator, 2 months. Each company-month has
    // one cell; composite per company = score(0|100) collapsed to
    // band → composite score depends on internal algorithm.
    // 11.81 — four indicators per company-month, so both companies clear the
    // coverage floor and this test measures the AVERAGING, not coverage.
    const IND_IDS = ["ind_1", "ind_2", "ind_3", "ind_4"];
    const monthRows = (companyId: string, status: string, period: string) =>
      IND_IDS.map((indicatorId) => ({
        companyId,
        indicatorId,
        value: 5,
        status,
        period,
      }));
    const rows = [
      // Month 2026-03: co_1 green, co_2 amber → composite scores averaged.
      ...monthRows("co_1", "green", "2026-03"),
      ...monthRows("co_2", "amber", "2026-03"),
      // Month 2026-04: co_1 only.
      ...monthRows("co_1", "red", "2026-04"),
    ];
    const result = await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1", "co_2"],
        indicatorIds: IND_IDS,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: makePrisma(rows) as any, monthsBack: 2 },
    );
    expect(result).toHaveLength(2);
    expect(result[0].period).toBe("2026-03");
    expect(result[1].period).toBe("2026-04");
    // Both months have data → score non-null.
    expect(result[0].score).not.toBeNull();
    expect(result[1].score).not.toBeNull();
    // Bands matter to the chart; verify they're set.
    expect(result[0].band).toBeTruthy();
    expect(result[1].band).toBeTruthy();
  });

  it("returns null score for months with no rows", async () => {
    const rows = ["ind_1", "ind_2", "ind_3", "ind_4"].map((indicatorId) => ({
      companyId: "co_1",
      indicatorId,
      value: 5,
      status: "green",
      period: "2026-04",
    }));
    const result = await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1", "ind_2", "ind_3", "ind_4"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: makePrisma(rows) as any, monthsBack: 3 },
    );
    expect(result).toHaveLength(3);
    // First two months have no data → null.
    expect(result[0].score).toBeNull();
    expect(result[0].band).toBeNull();
    expect(result[1].score).toBeNull();
    // 11.81 — an empty month reports its cohort as 0 of 1, not as nothing.
    expect(result[0].contributingCompanies).toBe(0);
    expect(result[0].totalCompanies).toBe(1);
    // Last month has data.
    expect(result[2].score).not.toBeNull();
    expect(result[2].contributingCompanies).toBe(1);
  });

  it("11.81 — carries the cohort behind each point, so a shrinking mean is visible", () => {
    // The one place the coverage floor can MANUFACTURE a trend instead of
    // blanking one: the cohort shrinks between months and the line still
    // plots a solid, connected point.
    const four = ["ind_1", "ind_2", "ind_3", "ind_4"];
    const rows = [
      ...four.map((indicatorId) => ({
        companyId: "co_1", indicatorId, value: 5, status: "green", period: "2026-03",
      })),
      ...four.map((indicatorId) => ({
        companyId: "co_2", indicatorId, value: 5, status: "green", period: "2026-03",
      })),
      // 2026-04: co_2 drops to a single cell — below the floor, withheld.
      ...four.map((indicatorId) => ({
        companyId: "co_1", indicatorId, value: 5, status: "green", period: "2026-04",
      })),
      { companyId: "co_2", indicatorId: "ind_1", value: 5, status: "red", period: "2026-04" },
    ];
    return buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1", "co_2"],
        indicatorIds: four,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: makePrisma(rows) as any, monthsBack: 2 },
    ).then((result) => {
      expect(result[0]).toMatchObject({
        score: 100,
        contributingCompanies: 2,
        totalCompanies: 2,
      });
      // Same score, half the cohort — and the point now says so.
      expect(result[1]).toMatchObject({
        score: 100,
        contributingCompanies: 1,
        totalCompanies: 2,
      });
    });
  });

  it("uses current indicator weights and qualitative penalties like the hero score", async () => {
    // 11.81 — padded to four cells so the company clears the coverage floor;
    // the weighted arithmetic under test is unchanged.
    const rows = [
      { companyId: "co_1", indicatorId: "green_heavy", value: 1, status: "green", period: "2026-04" },
      { companyId: "co_1", indicatorId: "green_heavy_2", value: 1, status: "green", period: "2026-04" },
      { companyId: "co_1", indicatorId: "red_light", value: 1, status: "red", period: "2026-04" },
      { companyId: "co_1", indicatorId: "red_light_2", value: 1, status: "red", period: "2026-04" },
    ];
    const result = await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1"],
        indicatorIds: ["green_heavy", "green_heavy_2", "red_light", "red_light_2"],
        weightByIndicatorId: new Map([
          ["green_heavy", 3],
          ["green_heavy_2", 3],
          ["red_light", 1],
          ["red_light_2", 1],
        ]),
        riskTagsByCompany: new Map([["co_1", ["data_absence"]]]),
      },
      // (100*6 + 0*2) / 8 = 75, then data_absence penalty 12 => 63.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: makePrisma(rows) as any, monthsBack: 1 },
    );
    expect(result[0]).toEqual({
      period: "2026-04",
      score: 63,
      band: "amber",
      contributingCompanies: 1,
      totalCompanies: 1,
    });
  });

  it("query shape: WHERE org + period IN [12 months] + companyId IN + indicatorId IN", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { indicatorValue: { findMany } };
    await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1", "co_2"],
        indicatorIds: ["ind_1", "ind_2"],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: prisma as any, monthsBack: 5 },
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe("org_1");
    expect(where.period.in).toHaveLength(5);
    expect(where.companyId.in).toEqual(["co_1", "co_2"]);
    expect(where.indicatorId.in).toEqual(["ind_1", "ind_2"]);
  });

  it("monthsBack < 1 returns empty array", async () => {
    const result = await buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1"],
        indicatorIds: ["ind_1"],
      },
      { monthsBack: 0 },
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TrendPoint band typing — sanity
// ---------------------------------------------------------------------------

describe("TrendPoint typing", () => {
  it("band can be CompositeBand or null at compile time", () => {
    const point = {
      period: "2026-04",
      score: null,
      band: null,
    };
    // Sanity: this compiles + runs.
    expect(point.band).toBeNull();

    const validBands: Array<CompositeBand | null> = [
      "green",
      "amber",
      "red",
      "unknown",
      null,
    ];
    expect(validBands).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// 11.71 — legal/compliance must not move the trend line either
// ---------------------------------------------------------------------------

/**
 * The board deck renders this 12-month line directly UNDER the hero composite.
 * They are computed from two different queries, so the scoring rule has to be
 * threaded here explicitly — this builder reads raw `IndicatorValue` rows by id
 * and never sees an `IndicatorDefinition`. Caller supplies the id set from
 * `nonScoringIndicatorIds`; `buildBoardSnapshot` exposes it precomputed so the
 * deck page and the PPTX route cannot resolve it differently.
 *
 * Product directive (11.71), not a bug fix: court cases and audit findings are
 * informational and must not interact with the financial part.
 */
describe("buildTrendSeries — non-scoring indicators (11.71)", () => {
  // 11.81 — four financial cells so a gated company still clears the coverage
  // floor and the 11.71 rule is what the assertions measure.
  const rowsFor = (period: string) => [
    { companyId: "co_1", indicatorId: "fin_1", value: 1, status: "green", period },
    { companyId: "co_1", indicatorId: "fin_2", value: 1, status: "green", period },
    { companyId: "co_1", indicatorId: "fin_3", value: 1, status: "green", period },
    { companyId: "co_1", indicatorId: "fin_4", value: 1, status: "green", period },
    { companyId: "co_1", indicatorId: "gov_1", value: 9, status: "red", period },
    { companyId: "co_1", indicatorId: "gov_2", value: 9, status: "red", period },
    { companyId: "co_1", indicatorId: "gov_3", value: 9, status: "red", period },
    { companyId: "co_1", indicatorId: "gov_4", value: 9, status: "red", period },
  ];

  function run(nonScoring?: ReadonlySet<string>) {
    const findMany = vi
      .fn()
      .mockResolvedValue([...rowsFor("2026-03"), ...rowsFor("2026-04")]);
    return buildTrendSeries(
      {
        organizationId: "org_1",
        currentPeriod: "2026-04",
        operationalIds: ["co_1"],
        indicatorIds: [
          "fin_1", "fin_2", "fin_3", "fin_4",
          "gov_1", "gov_2", "gov_3", "gov_4",
        ],
        ...(nonScoring ? { nonScoringIndicatorIds: nonScoring } : {}),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { prisma: { indicatorValue: { findMany } } as any, monthsBack: 2 },
    );
  }

  it("excludes governance cells from every month of the series", async () => {
    const result = await run(new Set(["gov_1", "gov_2", "gov_3", "gov_4"]));
    // Four green financial cells per month → 100. Ungated this is
    // round(400/8) = 50.
    expect(result.map((p) => p.score)).toEqual([100, 100]);
    expect(result.every((p) => p.band === "green")).toBe(true);
  });

  it("without the set nothing is excluded (back-compat default)", async () => {
    const result = await run();
    expect(result.map((p) => p.score)).toEqual([50, 50]);
  });

  it("applies the CURRENT rule to history, so the line has no artificial step", async () => {
    // Same treatment as `weightByIndicatorId`: re-scoring history under today's
    // formula is the point. A rule that switched on mid-series would draw a
    // cliff no company actually walked off.
    const result = await run(new Set(["gov_1", "gov_2", "gov_3", "gov_4"]));
    expect(new Set(result.map((p) => p.score)).size).toBe(1);
  });
});
