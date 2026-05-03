/**
 * Phase 7.G Turn K — `resolveScenarioLabel` unit tests.
 *
 * Mirrors `resolve-indicator-label.test.ts` 1:1 in case structure since
 * the helper is structurally identical (different input table, same
 * resolver chain). Each branch of the locale-fallback ladder is
 * exercised independently to catch silent-fallthrough regressions.
 */

import { describe, it, expect } from "vitest";
import { resolveScenarioLabel } from "./resolve-scenario-label";

describe("resolveScenarioLabel", () => {
  const fullScenario = {
    code: "IRAN_HIGH",
    nameEn: "Iran sanctions tighten (high-impact)",
    nameRu: "Иран — ужесточение санкций (high)",
    nameAz: "İran sanksiyaları sərtləşir (yüksək təsir)",
  };

  it("locale='ru' returns nameRu when present", () => {
    expect(resolveScenarioLabel(fullScenario, "ru")).toBe(
      "Иран — ужесточение санкций (high)",
    );
  });

  it("locale='az' returns nameAz when present", () => {
    expect(resolveScenarioLabel(fullScenario, "az")).toBe(
      "İran sanksiyaları sərtləşir (yüksək təsir)",
    );
  });

  it("locale='en' returns nameEn", () => {
    expect(resolveScenarioLabel(fullScenario, "en")).toBe(
      "Iran sanctions tighten (high-impact)",
    );
  });

  it("locale='ru' but nameRu missing → falls back to nameEn", () => {
    const partial = { code: "X_CODE", nameEn: "X English", nameRu: null };
    expect(resolveScenarioLabel(partial, "ru")).toBe("X English");
  });

  it("locale='az' but nameAz missing → falls back to nameEn", () => {
    const partial = {
      code: "Y_CODE",
      nameEn: "Y English",
      nameAz: undefined,
    };
    expect(resolveScenarioLabel(partial, "az")).toBe("Y English");
  });

  it("locale='ru' but nameRu empty string → falls back to nameEn", () => {
    // Empty string is falsy; resolver should treat as "missing" and fall
    // back rather than rendering an empty label.
    const partial = { code: "Z", nameEn: "Z English", nameRu: "" };
    expect(resolveScenarioLabel(partial, "ru")).toBe("Z English");
  });

  it("nameEn null + locale='en' → falls back to code", () => {
    const onlyCode = { code: "BARE_CODE", nameEn: null };
    expect(resolveScenarioLabel(onlyCode, "en")).toBe("BARE_CODE");
  });

  it("nameEn empty + locale='en' → falls back to code", () => {
    const onlyCode = { code: "BARE_CODE_2", nameEn: "" };
    expect(resolveScenarioLabel(onlyCode, "en")).toBe("BARE_CODE_2");
  });

  it("unknown locale (e.g. 'fr') → falls back to nameEn (no fr branch)", () => {
    expect(resolveScenarioLabel(fullScenario, "fr")).toBe(
      "Iran sanctions tighten (high-impact)",
    );
  });
});
