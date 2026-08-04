/**
 * 2026-08-04 audit — selecting the holding row emptied the whole HeatMap.
 *
 * The matrix's row universe is operating companies plus sub-groups; the holding
 * (`role: 'holding'`, level 1) is in neither, so the old filter
 * `c.code === activeCompanyCode` could never match it. The result: click the top
 * row of the tree — the one the terminal's own welcome card tells a new user to
 * click, and the only row carrying a holding-wide score (R66, 39/97 coverage on
 * production) — and Panel 2 went blank while Panel 4 said "Company not in
 * current matrix: AZSEKER."
 *
 * Selecting a parent now means the parent and everything under it, resolved
 * through the real parentCompanyId graph rather than by splitting codes on "-",
 * because the hierarchy is data and not a naming convention. These tests pin
 * both shapes the API can return (nested children, flat parent links) and the
 * degenerate cases that must not hang or throw during render.
 */

import { describe, it, expect } from "vitest";
import { companyScopeCodes, type ScopeNode } from "./company-scope";

/** The production shape: a holding with operating subsidiaries beneath it. */
const NESTED: ScopeNode[] = [
  {
    id: "h1",
    code: "AZSEKER",
    children: [
      { id: "c1", code: "AZSEKER-EDEN", parentCompanyId: "h1" },
      { id: "c2", code: "AZSEKER-CPC", parentCompanyId: "h1" },
      { id: "c3", code: "AZSEKER-DASTAN", parentCompanyId: "h1" },
    ],
  },
];

/** Same holding, delivered flat — only parentCompanyId links the rows. */
const FLAT: ScopeNode[] = [
  { id: "h1", code: "AZSEKER" },
  { id: "c1", code: "AZSEKER-EDEN", parentCompanyId: "h1" },
  { id: "c2", code: "AZSEKER-CPC", parentCompanyId: "h1" },
  { id: "c3", code: "AZSEKER-DASTAN", parentCompanyId: "h1" },
];

describe("companyScopeCodes", () => {
  it("scopes a holding to itself and every subsidiary", () => {
    expect([...companyScopeCodes("AZSEKER", NESTED)].sort()).toEqual([
      "AZSEKER",
      "AZSEKER-CPC",
      "AZSEKER-DASTAN",
      "AZSEKER-EDEN",
    ]);
  });

  it("finds the same subtree when the tree arrives flat", () => {
    expect([...companyScopeCodes("AZSEKER", FLAT)].sort()).toEqual([
      "AZSEKER",
      "AZSEKER-CPC",
      "AZSEKER-DASTAN",
      "AZSEKER-EDEN",
    ]);
  });

  it("scopes a leaf to itself alone", () => {
    // Selecting one operating company must still narrow to its single row —
    // the behaviour that already worked and must not regress.
    expect([...companyScopeCodes("AZSEKER-EDEN", NESTED)]).toEqual([
      "AZSEKER-EDEN",
    ]);
  });

  it("walks more than one level down", () => {
    const deep: ScopeNode[] = [
      {
        id: "h1",
        code: "GROUP",
        children: [
          {
            id: "s1",
            code: "GROUP-SUB",
            parentCompanyId: "h1",
            children: [{ id: "l1", code: "GROUP-SUB-LEAF", parentCompanyId: "s1" }],
          },
        ],
      },
    ];
    expect([...companyScopeCodes("GROUP", deep)].sort()).toEqual([
      "GROUP",
      "GROUP-SUB",
      "GROUP-SUB-LEAF",
    ]);
  });

  it("falls back to the code alone before the tree has loaded", () => {
    // The tree is fetched async. Until it lands, scoping to the selected code
    // reproduces exactly the old behaviour rather than showing everything.
    expect([...companyScopeCodes("AZSEKER-EDEN", null)]).toEqual(["AZSEKER-EDEN"]);
    expect([...companyScopeCodes("AZSEKER-EDEN", [])]).toEqual(["AZSEKER-EDEN"]);
  });

  it("falls back to the code alone when the code is not in the tree", () => {
    expect([...companyScopeCodes("GHOST-CO", NESTED)]).toEqual(["GHOST-CO"]);
  });

  it("returns nothing when nothing is selected", () => {
    expect(companyScopeCodes(null, NESTED).size).toBe(0);
    expect(companyScopeCodes(undefined, NESTED).size).toBe(0);
    expect(companyScopeCodes("", NESTED).size).toBe(0);
  });

  it("terminates on a cycle in the data", () => {
    // A parent pointing at its own descendant would otherwise hang the render
    // loop rather than fail visibly.
    const cyclic: ScopeNode[] = [
      { id: "a", code: "A", parentCompanyId: "b" },
      { id: "b", code: "B", parentCompanyId: "a" },
    ];
    expect([...companyScopeCodes("A", cyclic)].sort()).toEqual(["A", "B"]);
  });
});
