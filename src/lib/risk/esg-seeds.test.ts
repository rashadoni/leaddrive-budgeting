/**
 * Phase 7.H F4 — ESG seed catalog assertions.
 *
 * v2.1: locks the provenance ladder for the 5 ESG/climate indicators.
 * v2.2: upgrades the assertion — carbon scopes + composite must now be
 * `modeled_industry` (sector-specific factor) and their formulas must
 * call the new `industryFactor()` resolver instead of multiplying
 * revenue by a generic constant.
 *
 * Mirrors the closure pattern from `indicator-thresholds.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { esgIndicators } from "./esg-seeds";
import type { SeedValueSource } from "./indicator-seeds";

describe("ESG seed catalog — Phase 7.H F4.v2.2 provenance + industry-factor wire-up", () => {
  it("carbon scopes + ESG composite tagged `modeled_industry`", () => {
    const modeledCodes = [
      "IND_CARBON_SCOPE_1",
      "IND_CARBON_SCOPE_2",
      "IND_CARBON_SCOPE_3",
      "IND_ESG_COMPOSITE",
    ];
    for (const code of modeledCodes) {
      const seed = esgIndicators.find((s) => s.code === code);
      expect(seed, `seed ${code} not found in esg-seeds.ts`).toBeDefined();
      expect(
        seed?.defaultValueSource,
        `seed ${code} should be tagged modeled_industry (v2.2) to surface "ОТРАСЛЕВАЯ ОЦЕНКА" badge`,
      ).toBe<SeedValueSource>("modeled_industry");
    }
  });

  it("government climate score tagged `macro`", () => {
    const macro = esgIndicators.find((s) => s.code === "IND_GOV_CLIMATE_SCORE");
    expect(macro).toBeDefined();
    expect(
      macro?.defaultValueSource,
      "single-literal macro indicator must surface МАКРО badge, not appear as a per-entity measurement",
    ).toBe<SeedValueSource>("macro");
  });

  it("every ESG seed declares a non-`computed` provenance", () => {
    for (const seed of esgIndicators) {
      expect(
        seed.defaultValueSource,
        `seed ${seed.code} missing defaultValueSource — would default to computed and look like a real measurement`,
      ).toBeDefined();
      expect(seed.defaultValueSource).not.toBe<SeedValueSource>("computed");
    }
  });

  it("carbon scope formulas reference `industryFactor(...)` (v2.2 contract)", () => {
    const scopeCodes = [
      "IND_CARBON_SCOPE_1",
      "IND_CARBON_SCOPE_2",
      "IND_CARBON_SCOPE_3",
    ];
    for (const code of scopeCodes) {
      const seed = esgIndicators.find((s) => s.code === code)!;
      expect(
        seed.formula,
        `${code} formula must call industryFactor() — generic 0.5 placeholder is retired`,
      ).toContain("industryFactor(");
      // Required-inputs must declare the scope explicitly so the
      // resolver pre-resolves it (saves a live lookup per eval).
      expect(seed.requiredInputs.some((r) => r.startsWith("industryFactor:"))).toBe(true);
    }
  });

  it("ESG composite formula combines all 3 scopes via industryFactor", () => {
    const seed = esgIndicators.find((s) => s.code === "IND_ESG_COMPOSITE")!;
    expect(seed.formula).toContain('industryFactor("scope_1")');
    expect(seed.formula).toContain('industryFactor("scope_2")');
    expect(seed.formula).toContain('industryFactor("scope_3")');
    expect(seed.requiredInputs).toEqual(
      expect.arrayContaining([
        "industryFactor:scope_1",
        "industryFactor:scope_2",
        "industryFactor:scope_3",
      ]),
    );
  });
});
