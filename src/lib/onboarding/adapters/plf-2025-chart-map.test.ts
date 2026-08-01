// @vitest-environment node
/**
 * Properties of the SHIPPED table, checkable without the workbook.
 *
 * `plf-2025-workbook-dryrun.test.ts` proves the table is what the rule prints
 * for `actual-budget-v1.xlsx`, but it skips wherever that file is absent —
 * which is CI and every developer machine. These assertions run always: they
 * are the ones that catch a hand-edit, a bad merge, or a regenerate against
 * the wrong workbook, and they are the reason the generated file can be
 * trusted between dry-runs.
 */
import { describe, it, expect } from "vitest"
import {
  PLF_2025_CHART_BY_KEY,
  PLF_2025_CHART_ENTRIES,
  PLF_LEGACY_CHART_YEAR,
} from "./plf-2025-chart-map.generated"
import { legacyEntryKey, resolveLegacyAccount } from "./plf-legacy-chart"

describe("the 2025 chart map as shipped", () => {
  it("describes the 2025 chart", () => {
    expect(PLF_LEGACY_CHART_YEAR).toBe(2025)
    expect(PLF_2025_CHART_ENTRIES.length).toBe(372)
  })

  it("is indexed by (code, label), not by code", () => {
    expect(PLF_2025_CHART_BY_KEY.size).toBe(PLF_2025_CHART_ENTRIES.length)
    const codes = new Set(PLF_2025_CHART_ENTRIES.map((e) => e.code))
    // 372 pairs over fewer codes: 33 codes on the sheet carry more than one
    // label, and collapsing them is how 4,977,039 AZN of subsidies gets
    // mislabelled.
    expect(codes.size).toBeLessThan(PLF_2025_CHART_ENTRIES.length)
  })

  it("never lets two meanings share a stored code", () => {
    const byStored = new Map<string, string>()
    const clashes: string[] = []
    for (const e of PLF_2025_CHART_ENTRIES) {
      const prior = byStored.get(e.storedCode)
      if (prior !== undefined && prior !== e.label) {
        clashes.push(`${e.storedCode}: "${prior}" vs "${e.label}"`)
      } else byStored.set(e.storedCode, e.label)
    }
    expect(clashes).toEqual([])
  })

  it("mints only where something else claims the code, and says what", () => {
    for (const e of PLF_2025_CHART_ENTRIES) {
      if (e.storedCode === e.code) {
        expect(e.mintedBecause).toBeUndefined()
        continue
      }
      if (e.kind === "renumbered") continue
      expect(e.kind).toBe("own_account")
      // `.FY2025`, or `.FY2025.N` when the 2025 sheet itself carries two
      // meanings under one code — the `PLF.12.01.*` provisions block renames
      // "Accrual - CoGS" to "Provision - CoGS" partway down.
      expect(e.storedCode).toMatch(
        new RegExp(`^${e.code.replace(/\./g, "\\.")}\\.FY2025(\\.\\d+)?$`),
      )
      expect(e.mintedBecause).toBeTruthy()
    }
  })

  it("mints the ten money-carrying accounts whose codes 2026 took over", () => {
    // Every 2025 leaf that carries money and whose code the 2026 chart reuses
    // for a different account: 33,434,935 AZN that would otherwise post under
    // a 2026 name. The count over the WHOLE table is larger and is the
    // dry-run's business; these ten are the ones that move money.
    const taken: Array<[string, string]> = [
      ["PLF.01.01.06", "Revenue from Sale of Processed Corn Products"],
      ["PLF.01.02.03", "Revenue from Management Services"],
      ["PLF.02.01.06", "Processed Corn Products"],
      ["PLF.04.01.99", "Other Advertisements"],
      ["PLF.04.04.01", "Staff Salaries, Net"],
      ["PLF.04.05.03", "Business Trips Per Diem"],
      ["PLF.04.06.09", "Export Certification"],
      ["PLF.05.01.01", "Staff Salaries, Net"],
      ["PLF.05.02.01", "Business Trips Accomodation"],
      ["PLF.05.02.02", "Business Trips Travel"],
    ]
    for (const [code, label] of taken) {
      expect(resolveLegacyAccount(PLF_2025_CHART_BY_KEY, code, label)).toEqual({
        code: `${code}.FY2025`,
        name: label,
        kind: "own_account",
        rewritten: true,
      })
    }
  })

  it("keeps the section prefix on every minted code", () => {
    // A minted code must classify into the same P&L section as the code it
    // qualifies — `plfNature` reads the section by prefix.
    for (const e of PLF_2025_CHART_ENTRIES) {
      if (e.storedCode === e.code) continue
      if (e.kind !== "own_account") continue
      expect(e.storedCode.startsWith(`${e.code}.`)).toBe(true)
    }
  })

  it("routes the three PLF.07.02.04 subsidies to three different accounts", () => {
    const at = (label: string) =>
      resolveLegacyAccount(PLF_2025_CHART_BY_KEY, "PLF.07.02.04", label)
    expect(at("Subsidies - Farming")?.code).toBe("PLF.07.02.02")
    expect(at("Subsidies - Investment")?.code).toBe("PLF.07.02.03")
    expect(at("Subsidies - Product")?.code).toBe("PLF.07.02.04")
  })

  it("gives the three big 2025-only accounts their own code AND their own name", () => {
    // The owner's ruling on the three that carry the money: keep the 2025
    // account with the 2025 name, do not force them onto a 2026 code.
    const own = [
      ["PLF.01.01.06", "Revenue from Sale of Processed Corn Products"],
      ["PLF.02.01.06", "Processed Corn Products"],
      ["PLF.05.01.01", "Staff Salaries, Net"],
    ] as const
    for (const [code, label] of own) {
      const target = resolveLegacyAccount(PLF_2025_CHART_BY_KEY, code, label)
      expect(target).toMatchObject({
        kind: "own_account",
        code: `${code}.FY2025`,
        name: label,
      })
    }
  })

  it("moves 2025 D&A below the EBITDA line", () => {
    // `PLF.05.15.*` in the 2025 chart is `PLF.09.03.*` in the 2026 one, and
    // that is where the sheet's own PLF.08 puts it.
    const da = PLF_2025_CHART_ENTRIES.filter((e) =>
      e.code.startsWith("PLF.05.15."),
    )
    expect(da.length).toBeGreaterThan(0)
    for (const e of da) {
      expect(e.kind).toBe("renumbered")
      expect(e.storedCode.startsWith("PLF.09.03.")).toBe(true)
    }
  })

  it("names the duplicates instead of minting them quietly", () => {
    const dupes = PLF_2025_CHART_ENTRIES.filter((e) => e.duplicateOfCurrentCodes)
    expect(
      dupes.map((e) => [e.code, e.duplicateOfCurrentCodes?.join(",")]),
    ).toEqual([
      ["PLF.05.11.R", "PLF.05.11"],
      ["PLF.05.17.R", "PLF.05.14"],
      ["PLF.05.18.R", "PLF.05.15"],
      ["PLF.08.02", "PLF.PY"],
      ["PLF.08.03", "PLF.EDEN"],
    ])
  })

  it("refuses a code it knows under a label it does not", () => {
    expect(
      resolveLegacyAccount(PLF_2025_CHART_BY_KEY, "PLF.01.01.06", "Revenue from Sale of Almond"),
    ).toBeNull()
  })

  it("keys on the label loosely enough to survive punctuation", () => {
    expect(
      PLF_2025_CHART_BY_KEY.has(legacyEntryKey("PLF.05.03.01", "  audit   fees ")),
    ).toBe(true)
  })
})
