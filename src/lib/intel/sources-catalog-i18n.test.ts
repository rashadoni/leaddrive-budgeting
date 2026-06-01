import { describe, it, expect } from "vitest";
import { localizedSource } from "./sources-catalog-i18n";
import { getDataSourceByCode } from "./sources-catalog";

const cbar = getDataSourceByCode("cbar-official-fx")!;

describe("localizedSource", () => {
  it("returns native Russian prose for the ru locale", () => {
    const L = localizedSource(cbar, "ru");
    expect(L.whatItIs).toBe(cbar.whatItIsRu);
    expect(L.businessValue).toBe(cbar.businessValueRu);
    expect(L.cadence).toBe(cbar.cadenceRu);
    expect(L.displayName).toBe(cbar.displayNameRu);
  });

  it("returns English prose for the en locale (not the Russian fields)", () => {
    const L = localizedSource(cbar, "en");
    expect(L.whatItIs).not.toBe(cbar.whatItIsRu);
    expect(L.whatItIs).toMatch(/exchange rates/i);
    expect(L.cadence).toMatch(/daily/i);
    expect(L.displayName).toBe(cbar.displayNameEn);
  });

  it("falls back to English (never Russian) for the az locale until AZ prose exists", () => {
    const L = localizedSource(cbar, "az");
    expect(L.whatItIs).toMatch(/exchange rates/i);
    expect(L.whatItIs).not.toBe(cbar.whatItIsRu);
  });

  it("falls back to the Russian field when a source has no i18n entry", () => {
    const fake = { ...cbar, sourceCode: "does-not-exist" };
    const L = localizedSource(fake, "en");
    expect(L.whatItIs).toBe(cbar.whatItIsRu);
  });

  it("covers every catalog source with an EN translation (no Russian leaks in EN)", () => {
    // Guards against a new source being added without its EN prose.
    for (const code of [
      "cbar-official-fx", "eia-energy", "fao-food-prices", "yahoo-grains", "yahoo-metals",
      "yahoo-fuel-bdi", "openmeteo-forecast", "az-stat-cpi", "un-comtrade-az", "wb-indicators",
      "usda-nass", "google-trends-az",
    ]) {
      const s = getDataSourceByCode(code)!;
      const L = localizedSource(s, "en");
      expect(L.whatItIs, `${code} whatItIs should be EN`).not.toBe(s.whatItIsRu);
      expect(L.businessValue, `${code} businessValue should be EN`).not.toBe(s.businessValueRu);
    }
  });
});
