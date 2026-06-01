import { describe, it, expect } from "vitest";
import { indicatorMatchScore, filterIndicatorsByQuery } from "./indicator-search";

// Fixtures mirror the real production indicator names (verified against the
// live IndicatorDefinition table 2026-06-01).
const REV_PER_HA = {
  code: "AGRO_REVENUE_PER_HA",
  nameEn: "Revenue per Hectare",
  nameRu: "Выручка на гектар",
  nameAz: "Hektara düşən Gəlir",
};
const COST_PER_HA = {
  code: "AGRO_COST_PER_HA",
  nameEn: "Input Cost per Hectare",
  nameRu: "Себестоимость на гектар",
  nameAz: "Hektara düşən Dəyər",
};
const NET_MARGIN = {
  code: "IND_NET_MARGIN",
  nameEn: "Net Margin",
  nameRu: "Чистая маржа",
  nameAz: "Xalis Marja",
};
const LIQUIDITY = {
  code: "IND_CURRENT_RATIO",
  nameEn: "Current Ratio (Liquidity)",
  nameRu: "Коэффициент текущей ликвидности",
  nameAz: "Cari Likvidlik Əmsalı",
};

const ALL = [REV_PER_HA, COST_PER_HA, NET_MARGIN, LIQUIDITY];

describe("indicatorMatchScore", () => {
  it("matches the per-hectare indicator by the client's literal query «гектару»", () => {
    // reverse-prefix tier: stored RU word «гектар» is a prefix of typed «гектару»
    expect(indicatorMatchScore("гектару", REV_PER_HA)).toBeGreaterThan(0);
    expect(indicatorMatchScore("гектар", COST_PER_HA)).toBeGreaterThan(0);
  });

  it("matches across languages regardless of which name the user types", () => {
    expect(indicatorMatchScore("hectare", REV_PER_HA)).toBeGreaterThan(0); // EN
    expect(indicatorMatchScore("гектар", REV_PER_HA)).toBeGreaterThan(0); // RU
    expect(indicatorMatchScore("hektara", REV_PER_HA)).toBeGreaterThan(0); // AZ
  });

  it("matches by code and by de-underscored code tokens", () => {
    expect(indicatorMatchScore("PER_HA", REV_PER_HA)).toBeGreaterThan(0);
    expect(indicatorMatchScore("per ha", REV_PER_HA)).toBeGreaterThan(0);
  });

  it("tolerates typos via character-drift", () => {
    expect(indicatorMatchScore("margn", NET_MARGIN)).toBeGreaterThan(0); // dropped 'i'
    expect(indicatorMatchScore("liqudity", LIQUIDITY)).toBeGreaterThan(0); // dropped 'i'
  });

  it("matches a localized word fragment («маржа», «liquid»)", () => {
    expect(indicatorMatchScore("маржа", NET_MARGIN)).toBeGreaterThan(0);
    expect(indicatorMatchScore("liquid", LIQUIDITY)).toBeGreaterThan(0);
  });

  it("requires every typed word to match (AND semantics)", () => {
    // both words live in the same indicator → matches
    expect(indicatorMatchScore("net margin", NET_MARGIN)).toBeGreaterThan(0);
    expect(indicatorMatchScore("revenue hectare", REV_PER_HA)).toBeGreaterThan(0);
    // words split across different indicators → no single one satisfies both
    expect(indicatorMatchScore("margin hectare", NET_MARGIN)).toBe(0);
    expect(indicatorMatchScore("margin hectare", REV_PER_HA)).toBe(0);
  });

  it("returns 0 for a blank query (caller treats as no-filter)", () => {
    expect(indicatorMatchScore("", REV_PER_HA)).toBe(0);
    expect(indicatorMatchScore("   ", REV_PER_HA)).toBe(0);
  });

  it("returns 0 when nothing matches", () => {
    expect(indicatorMatchScore("zzzz", REV_PER_HA)).toBe(0);
  });

  it("ranks exact/prefix matches above drift matches", () => {
    const exact = indicatorMatchScore("margin", NET_MARGIN);
    const drift = indicatorMatchScore("margn", NET_MARGIN);
    expect(exact).toBeGreaterThan(drift);
  });
});

describe("filterIndicatorsByQuery", () => {
  it("returns only matching columns, preserving original order", () => {
    const out = filterIndicatorsByQuery("hectare", ALL);
    expect(out).toEqual([REV_PER_HA, COST_PER_HA]);
  });

  it("returns the input unchanged for a blank query", () => {
    expect(filterIndicatorsByQuery("", ALL)).toBe(ALL);
    expect(filterIndicatorsByQuery("  ", ALL)).toBe(ALL);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterIndicatorsByQuery("zzzz", ALL)).toEqual([]);
  });

  it("finds all three per-ha indicators by the «per ha» code token", () => {
    const withYield = [
      ...ALL,
      { code: "AGRO_YIELD_PER_HA", nameEn: "Yield per Hectare", nameRu: "Урожайность (т/га)", nameAz: "Məhsuldarlıq" },
    ];
    const out = filterIndicatorsByQuery("per ha", withYield);
    expect(out.map((i) => i.code)).toEqual([
      "AGRO_REVENUE_PER_HA",
      "AGRO_COST_PER_HA",
      "AGRO_YIELD_PER_HA",
    ]);
  });
});
