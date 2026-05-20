/**
 * Pure-function tests for DataEntryAdmin's tree flattening — locks the
 * fix that surfaces operational leaves (AZSEKER-EDEN / AAC-MAIN / etc.)
 * in the company dropdown alongside their level-1 parents.
 *
 * 2026-05-16 parity with the fc9c7fb fix that closed the same bug on
 * the budgeting filter dropdown.
 */
import { describe, it, expect } from "vitest";
import { flattenCompanies } from "./DataEntryAdmin";

describe("flattenCompanies", () => {
  it("returns roots when there are no children", () => {
    const result = flattenCompanies([
      { id: "1", code: "A", name: "A Co" },
      { id: "2", code: "B", name: "B Co" },
    ]);
    expect(result.map((c) => c.code)).toEqual(["A", "B"]);
  });

  it("walks 1 level of children depth-first", () => {
    const result = flattenCompanies([
      {
        id: "az",
        code: "AZSEKER",
        name: "AzərŞəkər",
        children: [
          { id: "eden", code: "AZSEKER-EDEN", name: "Eden" },
          { id: "promalt", code: "AZSEKER-PROMALT", name: "Promalt MMC" },
        ],
      },
    ]);
    expect(result.map((c) => c.code)).toEqual([
      "AZSEKER",
      "AZSEKER-EDEN",
      "AZSEKER-PROMALT",
    ]);
  });

  it("walks 2 levels (AZMADE → AAC → AAC-MAIN) depth-first stable order", () => {
    const result = flattenCompanies([
      {
        id: "azm",
        code: "AZMADE",
        name: "AZMADE",
        children: [
          {
            id: "aac",
            code: "AAC",
            name: "AAC",
            children: [
              { id: "aac_main", code: "AAC-MAIN", name: "AAC Main" },
            ],
          },
          {
            id: "atl",
            code: "ATL",
            name: "ATL",
            children: [
              { id: "atl_dbz", code: "ATL-DBZ", name: "ATL DBZ" },
              { id: "atl_pmz", code: "ATL-PMZ", name: "ATL PMZ" },
            ],
          },
        ],
      },
    ]);
    expect(result.map((c) => c.code)).toEqual([
      "AZMADE",
      "AAC",
      "AAC-MAIN",
      "ATL",
      "ATL-DBZ",
      "ATL-PMZ",
    ]);
  });

  it("strips the children field from emitted rows (dropdown consumers only need id/code/name)", () => {
    const [root, child] = flattenCompanies([
      {
        id: "az",
        code: "AZSEKER",
        name: "AzərŞəkər",
        children: [{ id: "eden", code: "AZSEKER-EDEN", name: "Eden" }],
      },
    ]);
    expect("children" in root).toBe(false);
    expect("children" in child).toBe(false);
  });

  it("handles the real FO Holding shape (2 roots × nested ops cos)", () => {
    const result = flattenCompanies([
      {
        id: "azm",
        code: "AZMADE",
        name: "AZMADE",
        children: [
          { id: "aac", code: "AAC", name: "AAC", children: [{ id: "aac_main", code: "AAC-MAIN", name: "AAC Main" }] },
          { id: "atl", code: "ATL", name: "ATL", children: [{ id: "atl_dbz", code: "ATL-DBZ", name: "ATL DBZ" }] },
        ],
      },
      {
        id: "az",
        code: "AZSEKER",
        name: "AzərŞəkər",
        children: [
          { id: "eden", code: "AZSEKER-EDEN", name: "Eden" },
          { id: "azsf", code: "AZSEKER-AZSF", name: "AZSF" },
        ],
      },
    ]);
    // Before the fix, the dropdown showed only ["AZMADE", "AZSEKER"].
    // After: every level surfaces.
    expect(result.map((c) => c.code)).toContain("AZSEKER-EDEN");
    expect(result.map((c) => c.code)).toContain("AAC-MAIN");
    // 2 roots (AZMADE + AZSEKER) + 2 mid (AAC + ATL) + 2 ops cos under
    // AZMADE (AAC-MAIN, ATL-DBZ) + 2 ops cos under AZSEKER (EDEN, AZSF)
    // = 8 flattened rows.
    expect(result).toHaveLength(8);
  });
});
