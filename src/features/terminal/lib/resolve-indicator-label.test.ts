import { describe, it, expect } from "vitest";
import { resolveIndicatorLabel } from "./resolve-indicator-label";

describe("resolveIndicatorLabel (Tier-3 sub-30 Stage 3)", () => {
  const fullLocaleCoverage = {
    code: "IND_GROSS_MARGIN",
    nameEn: "Gross Margin",
    nameRu: "Валовая маржа",
    nameAz: "Ümumi marja",
  };

  it("returns Russian name when locale is 'ru' AND nameRu is present", () => {
    expect(resolveIndicatorLabel(fullLocaleCoverage, "ru")).toBe(
      "Валовая маржа",
    );
  });

  it("returns Azerbaijani name when locale is 'az' AND nameAz is present", () => {
    expect(resolveIndicatorLabel(fullLocaleCoverage, "az")).toBe(
      "Ümumi marja",
    );
  });

  it("returns English name for any other locale (default)", () => {
    expect(resolveIndicatorLabel(fullLocaleCoverage, "en")).toBe(
      "Gross Margin",
    );
    expect(resolveIndicatorLabel(fullLocaleCoverage, "fr")).toBe(
      "Gross Margin",
    );
  });

  it("falls back to nameEn when nameRu missing for 'ru' locale", () => {
    const partial = { code: "X", nameEn: "Eng only" };
    expect(resolveIndicatorLabel(partial, "ru")).toBe("Eng only");
  });

  it("falls back to nameEn when nameAz missing for 'az' locale", () => {
    const partial = { code: "X", nameEn: "Eng only" };
    expect(resolveIndicatorLabel(partial, "az")).toBe("Eng only");
  });

  it("falls back to code when nameEn is missing too", () => {
    const codeOnly = { code: "IND_X" };
    expect(resolveIndicatorLabel(codeOnly, "en")).toBe("IND_X");
    expect(resolveIndicatorLabel(codeOnly, "ru")).toBe("IND_X");
    expect(resolveIndicatorLabel(codeOnly, "az")).toBe("IND_X");
  });

  it("falls back to code when nameEn is empty string (falsy)", () => {
    const empty = { code: "IND_X", nameEn: "" };
    expect(resolveIndicatorLabel(empty, "en")).toBe("IND_X");
  });

  it("falls back to code when nameRu is null for 'ru' locale", () => {
    const nullRu = {
      code: "IND_X",
      nameEn: "English",
      nameRu: null,
    };
    expect(resolveIndicatorLabel(nullRu, "ru")).toBe("English");
  });

  it("treats empty-string locale-specific name as 'missing' (falls back)", () => {
    const emptyRu = { code: "X", nameEn: "Eng", nameRu: "" };
    expect(resolveIndicatorLabel(emptyRu, "ru")).toBe("Eng");
  });
});
