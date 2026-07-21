import { describe, expect, it } from "vitest";
import {
  buildCompanyNewsQuery,
  readApprovedNewsAliases,
} from "./entity-aliases";

const PILOTS = new Set(["AZSEKER-AZSF", "AZSEKER-CPC", "AZSEKER-EDEN", "AZSEKER-MALT"]);

describe("free news entity aliases", () => {
  it("accepts only owner-approved, sufficiently specific aliases for current pilot companies", () => {
    const aliases = readApprovedNewsAliases(
      {
        newsEntityAliases: {
          "AZSEKER-EDEN": [" Eden Agro ", "EDEN AGRO", "Eden Agro"],
          "AZSEKER-CPC": ["CPC", "CPC MMC"],
          OTHER: ["Unrelated Company"],
        },
      },
      PILOTS,
    );

    expect(aliases.get("AZSEKER-EDEN")).toEqual(["Eden Agro"]);
    expect(aliases.get("AZSEKER-CPC")).toEqual(["CPC MMC"]);
    expect(aliases.has("OTHER")).toBe(false);
  });

  it("fails closed for bare short/ambiguous CPC and MALT aliases", () => {
    const aliases = readApprovedNewsAliases(
      { newsEntityAliases: { "AZSEKER-CPC": ["CPC"], "AZSEKER-MALT": ["Malt"] } },
      PILOTS,
    );

    expect(aliases.size).toBe(0);
  });

  it("does not reuse the import-routing entityAliases dictionary", () => {
    const aliases = readApprovedNewsAliases(
      { entityAliases: { EDEN: "AZSEKER-EDEN" } },
      PILOTS,
    );
    expect(aliases.size).toBe(0);
  });

  it("quotes and escapes approved aliases before they become a source query", () => {
    expect(buildCompanyNewsQuery(['Eden "Agro"', "Eden Agro LLC"])).toBe(
      '("Eden \\"Agro\\"" OR "Eden Agro LLC")',
    );
    expect(buildCompanyNewsQuery([])).toBeNull();
  });
});
