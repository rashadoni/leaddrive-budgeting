// @vitest-environment node
/**
 * The RULE, on fixtures small enough to read.
 *
 * Every fixture below is a real shape from `actual-budget-v1.xlsx`, reduced to
 * the two or three rows that make the case. The full-workbook proof is
 * `plf-2025-workbook-dryrun.test.ts`; this file exists so that when the rule
 * changes, the failure names the CASE rather than a total.
 */
import { describe, it, expect } from "vitest"
import {
  checkLegacyChartMap,
  deriveLegacyChartMap,
  legacyEntryKey,
  legacyQualifiedCode,
  normaliseChartLabel,
  resolveLegacyAccount,
  type LegacyChartEntry,
  type LegacyChartRow,
} from "./plf-legacy-chart"

const leaf = (code: string, label: string): LegacyChartRow => ({
  code,
  label,
  isLeaf: true,
})
const parent = (code: string, label: string): LegacyChartRow => ({
  code,
  label,
  isLeaf: false,
})

const index = (entries: readonly LegacyChartEntry[]) =>
  new Map(entries.map((e) => [legacyEntryKey(e.code, e.label), e]))

const derive = (legacy: LegacyChartRow[], current: LegacyChartRow[]) =>
  deriveLegacyChartMap(legacy, current, 2025)

const entryFor = (
  map: { entries: LegacyChartEntry[] },
  code: string,
  label: string,
) => map.entries.find((e) => e.code === code && e.label === label)

describe("normaliseChartLabel", () => {
  it("folds case and punctuation, which is all the two charts differ by", () => {
    expect(normaliseChartLabel("Other Products' Costs")).toBe(
      normaliseChartLabel("other products costs"),
    )
    expect(normaliseChartLabel("Staff Salaries, State Social Fund Fees")).toBe(
      "staff salaries state social fund fees",
    )
  })

  it("keeps Net and Gross apart — they are a different measure", () => {
    // The owner's ruling: `PLF.05.01.01` is "Staff Salaries, Net" in 2025 and
    // "Staff Salaries, Gross" in 2026, and must NOT be merged.
    expect(normaliseChartLabel("Staff Salaries, Net")).not.toBe(
      normaliseChartLabel("Staff Salaries, Gross"),
    )
  })
})

describe("the matching rule", () => {
  it("leaves a code alone when the current chart has it under the same label", () => {
    const map = derive(
      [leaf("PLF.05.03.01", "Audit Fees")],
      [leaf("PLF.05.03.01", "Audit Fees")],
    )
    expect(entryFor(map, "PLF.05.03.01", "Audit Fees")).toMatchObject({
      kind: "identical",
      storedCode: "PLF.05.03.01",
    })
  })

  it("follows the label to a renumbered code", () => {
    // 2025 `PLF.08.01` Shareholders' expense → 2026 `PLF.09.01`, which
    // `plf-chart.ts` documents from the other direction.
    const map = derive(
      [leaf("PLF.08.01", "Shareholders' expense")],
      [leaf("PLF.09.01", "Shareholders' expense")],
    )
    expect(entryFor(map, "PLF.08.01", "Shareholders' expense")).toMatchObject({
      kind: "renumbered",
      storedCode: "PLF.09.01",
      via: "unique",
    })
  })

  it("keeps the 2025 code's own section when the label appears twice", () => {
    // "Staff Salaries, State Social Fund Fees" exists in both the Sales &
    // Marketing (PLF.04) and Head Office (PLF.05) trees, by design. The
    // functional split has to survive the renumbering.
    const label = "Staff Salaries, State Social Fund Fees"
    const current = [leaf("PLF.04.03.03", label), leaf("PLF.05.01.03", label)]
    const map = derive(
      [leaf("PLF.04.04.03", label), leaf("PLF.05.01.03", label)],
      current,
    )
    expect(entryFor(map, "PLF.04.04.03", label)).toMatchObject({
      kind: "renumbered",
      storedCode: "PLF.04.03.03",
      via: "section-kept",
    })
    expect(entryFor(map, "PLF.05.01.03", label)).toMatchObject({
      kind: "identical",
    })
    expect(map.ambiguous).toEqual([])
  })

  it("refuses to guess when the tie-break does not settle it", () => {
    const label = "Consulting Fees"
    const map = derive(
      [leaf("PLF.09.01.01", label)],
      [leaf("PLF.04.05.02", label), leaf("PLF.05.03.02", label)],
    )
    expect(map.entries).toEqual([])
    expect(map.ambiguous).toEqual([
      {
        code: "PLF.09.01.01",
        label,
        candidates: ["PLF.04.05.02", "PLF.05.03.02"],
      },
    ])
  })

  it("never posts onto a current PARENT — that would double-count its children", () => {
    // 2026 `PLF.05.15` "Commission Fees - G&A" is a parent of
    // `PLF.05.15.01`. Matching onto it would add the 2025 row on top of the
    // 2026 child's own money.
    const map = derive(
      [leaf("PLF.05.18.R", "Commission Fees - G&A")],
      [
        parent("PLF.05.15", "Commission Fees - G&A"),
        leaf("PLF.05.15.01", "Bank Commission Fees"),
      ],
    )
    expect(entryFor(map, "PLF.05.18.R", "Commission Fees - G&A")).toMatchObject({
      kind: "own_account",
      storedCode: "PLF.05.18.R",
      duplicateOfCurrentCodes: ["PLF.05.15"],
    })
  })

  it("only maps legacy LEAVES — a subtotal row has no account to collide with", () => {
    const map = derive(
      [parent("PLF.05.15", "Depreciation & Amortization")],
      [leaf("PLF.09.03", "Depreciation & Amortization")],
    )
    expect(map.entries).toEqual([])
  })
})

describe("one code, several meanings", () => {
  // `PLF.07.02.04` on `PLF Actual 2025` carries three different subsidies;
  // the 2026 chart keeps them at three codes. A code-keyed map takes the
  // first label and mislabels 4,977,039 AZN of the other two.
  const legacy = [
    leaf("PLF.07.02.04", "Subsidies - Farming"),
    leaf("PLF.07.02.04", "Subsidies - Investment"),
    leaf("PLF.07.02.04", "Subsidies - Product"),
  ]
  const current = [
    leaf("PLF.07.02.02", "Subsidies - Farming"),
    leaf("PLF.07.02.03", "Subsidies - Investment"),
    leaf("PLF.07.02.04", "Subsidies - Product"),
  ]
  const map = derive(legacy, current)

  it("splits the three meanings to the three current codes", () => {
    expect(
      map.entries.map((e) => [e.label, e.kind, e.storedCode]),
    ).toEqual([
      ["Subsidies - Farming", "renumbered", "PLF.07.02.02"],
      ["Subsidies - Investment", "renumbered", "PLF.07.02.03"],
      ["Subsidies - Product", "identical", "PLF.07.02.04"],
    ])
  })

  it("resolves each row by its OWN label, not by the code's first one", () => {
    const byKey = index(map.entries)
    expect(
      resolveLegacyAccount(byKey, "PLF.07.02.04", "Subsidies - Investment"),
    ).toMatchObject({ code: "PLF.07.02.03", name: "Subsidies - Investment" })
    expect(
      resolveLegacyAccount(byKey, "PLF.07.02.04", "Subsidies - Product"),
    ).toMatchObject({ code: "PLF.07.02.04", rewritten: false })
  })

  it("has no opinion about a label it has never seen", () => {
    // The guard that stops this AZSEKER table firing on another client's
    // PLF-coded sheet — and stops "Subsidies - Wheat" inheriting a mapping
    // that was derived for a different account.
    expect(
      resolveLegacyAccount(index(map.entries), "PLF.07.02.04", "Subsidies - Wheat"),
    ).toBeNull()
  })
})

describe("minting an own account", () => {
  it("mints when the current chart reuses the code for something else", () => {
    const map = derive(
      [leaf("PLF.01.01.06", "Revenue from Sale of Processed Corn Products")],
      [leaf("PLF.01.01.06", "Revenue from Sale of Almond")],
    )
    const entry = entryFor(
      map,
      "PLF.01.01.06",
      "Revenue from Sale of Processed Corn Products",
    )
    expect(entry).toMatchObject({
      kind: "own_account",
      storedCode: "PLF.01.01.06.FY2025",
    })
    expect(entry?.mintedBecause).toContain("Revenue from Sale of Almond")
  })

  it("mints when ANOTHER legacy row renumbers onto the code", () => {
    // Renumbering is simultaneous, not chained: 2025's `PLF.04.02.99` moves
    // ONTO `PLF.04.01.99` while 2025's own `PLF.04.01.99` is an own-account
    // row. Without the mint they would share one code under two names.
    const map = derive(
      [
        leaf("PLF.04.01.99", "Other Advertisements"),
        leaf("PLF.04.02.99", "Other Promotional & Research Expenses"),
      ],
      [leaf("PLF.04.01.99", "Other Promotional & Research Expenses")],
    )
    expect(
      entryFor(map, "PLF.04.02.99", "Other Promotional & Research Expenses"),
    ).toMatchObject({ kind: "renumbered", storedCode: "PLF.04.01.99" })
    expect(entryFor(map, "PLF.04.01.99", "Other Advertisements")).toMatchObject({
      kind: "own_account",
      storedCode: "PLF.04.01.99.FY2025",
    })
    expect(checkLegacyChartMap(map, [])).toEqual([])
  })

  it("keeps the bare code when nothing else claims it", () => {
    const map = derive([leaf("PLF.05.02.03", "Business Trips Per Diem")], [])
    expect(entryFor(map, "PLF.05.02.03", "Business Trips Per Diem")).toEqual({
      code: "PLF.05.02.03",
      label: "Business Trips Per Diem",
      kind: "own_account",
      storedCode: "PLF.05.02.03",
    })
  })

  it("indexes a second mint rather than colliding with the first", () => {
    const map = derive(
      [leaf("PLF.05.99.99", "One Thing"), leaf("PLF.05.99.99", "Another Thing")],
      [leaf("PLF.05.99.99", "A Third Thing")],
    )
    expect(map.entries.map((e) => e.storedCode)).toEqual([
      "PLF.05.99.99.FY2025",
      "PLF.05.99.99.FY2025.2",
    ])
    expect(checkLegacyChartMap(map, []).filter((v) => v.kind === "collision")).toEqual([])
  })

  it("keeps the section prefix, so downstream classifiers see the same section", () => {
    // `plfNature` reads `/^PLF\.(\d{2})/` and `plfOtherOperatingSide` reads
    // `startsWith("PLF.07.01")`. A qualified code must classify identically.
    expect(legacyQualifiedCode("PLF.07.01.02", 2025)).toBe("PLF.07.01.02.FY2025")
    expect(legacyQualifiedCode("PLF.07.01.02", 2025, 3)).toBe(
      "PLF.07.01.02.FY2025.3",
    )
  })
})

describe("checkLegacyChartMap", () => {
  it("catches a mislabel — a row landing where the current chart says otherwise", () => {
    const current = [leaf("PLF.01.01.06", "Revenue from Sale of Almond")]
    const bad = {
      entries: [
        {
          code: "PLF.01.01.06",
          label: "Revenue from Sale of Processed Corn Products",
          kind: "own_account" as const,
          storedCode: "PLF.01.01.06",
        },
      ],
      ambiguous: [],
    }
    expect(checkLegacyChartMap(bad, current)).toEqual([
      {
        kind: "mislabel",
        code: "PLF.01.01.06",
        detail: expect.stringContaining("Revenue from Sale of Almond"),
      },
    ])
  })

  it("catches two meanings landing on one stored code", () => {
    const bad = {
      entries: [
        { code: "A", label: "One", kind: "own_account" as const, storedCode: "X" },
        { code: "B", label: "Two", kind: "own_account" as const, storedCode: "X" },
      ],
      ambiguous: [],
    }
    expect(checkLegacyChartMap(bad, [])).toEqual([
      { kind: "collision", code: "X", detail: expect.stringContaining("both post to X") },
    ])
  })
})
