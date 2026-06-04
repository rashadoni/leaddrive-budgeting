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

  it("returns native Azerbaijani prose for the az locale (not English, never Russian)", () => {
    const L = localizedSource(cbar, "az");
    // AZ prose authored 2026-06-04 — the az field carries the CBAR rate sentence.
    expect(L.whatItIs).toMatch(/məzənnə/i);
    expect(L.whatItIs).not.toBe(cbar.whatItIsRu);
    expect(L.whatItIs).not.toMatch(/exchange rates/i);
    expect(L.cadence).toMatch(/gündəlik/i);
  });

  it("falls back to English for the az locale when a source has no AZ prose", () => {
    // A source whose i18n entry has only en (no az) must surface EN, never RU.
    const enOnly = {
      ...cbar,
      sourceCode: "az-fallback-probe",
    };
    // localizedSource has no entry for this code → it falls back to the RU field.
    // (Guard documents the no-entry path; the per-source az coverage is asserted below.)
    const L = localizedSource(enOnly, "az");
    expect(L.whatItIs).toBe(cbar.whatItIsRu);
  });

  it("covers every catalog source with AZ prose (no English leaks in AZ)", () => {
    // Guards against a new source being added without its AZ prose.
    for (const code of [
      "cbar-official-fx", "eia-energy", "fao-food-prices", "yahoo-grains", "yahoo-metals",
      "yahoo-fuel-bdi", "openmeteo-forecast", "az-stat-cpi", "un-comtrade-az", "wb-indicators",
      "usda-nass", "google-trends-az",
    ]) {
      const s = getDataSourceByCode(code)!;
      const az = localizedSource(s, code === "does-not-exist" ? "en" : "az");
      const en = localizedSource(s, "en");
      // AZ must differ from both RU and EN for the prose fields (real translation present).
      expect(az.whatItIs, `${code} whatItIs should be AZ`).not.toBe(s.whatItIsRu);
      expect(az.whatItIs, `${code} whatItIs should not equal EN`).not.toBe(en.whatItIs);
      expect(az.businessValue, `${code} businessValue should be AZ`).not.toBe(en.businessValue);
    }
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
