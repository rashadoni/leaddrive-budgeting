import { describe, it, expect } from "vitest"
import { explainMissingCell, remedyKey } from "./missing-input-remedy"

const kind = (inputs: string[]) => explainMissingCell(inputs).primary?.kind

describe("explainMissingCell — the six real groups", () => {
  it("routes each namespace to the place that can actually answer it", () => {
    // Every one of these is a real `requiredInputs` value from the seeds, and
    // the counts are the measured 2026 distribution across 580 empty cells.
    expect(kind(["budgetLine:revenue"]), "276 cells").toBe("import_workbook")
    expect(kind(["operationalFact:yield_per_ha"]), "172 cells").toBe("manual_entry")
    expect(kind(["commodity:sugar"]), "161 cells").toBe("external_feed")
    expect(kind(["booking"]), "35 cells").toBe("not_applicable")
    expect(kind(["company.settings.fxRevenueAzn"]), "28 cells").toBe("company_setting")
    expect(kind(["balanceSheetLine.inventory"]), "18 cells").toBe("import_workbook")
  })

  it("keeps the feeds together — none of them is fixed by uploading anything", () => {
    for (const i of [
      "commodity:wheat",
      "weather:rainfall",
      "newsSentiment",
      "currencyRate:USD",
      "industryFactor:scope_1",
    ]) {
      expect(kind([i]), i).toBe("external_feed")
    }
  })

  it("does not confuse a company SETTING with company data", () => {
    // `company.settings.` is the only `company`-prefixed namespace with its own
    // remedy, and it is the one no workbook can ever supply. A broader
    // `company` rule added later must not swallow it.
    expect(kind(["company.settings.region"])).toBe("company_setting")
  })
})

describe("when a cell waits on several things at once", () => {
  it("leads with what the reader can personally do", () => {
    // A cell needing both a workbook and a feed is not unblocked by the
    // workbook alone — but telling someone "run the feed" when they also owe a
    // file leaves them stuck twice. The actionable remedy goes first and the
    // rest stays visible.
    const e = explainMissingCell(["commodity:sugar", "budgetLine:revenue"])
    expect(e.primary?.kind).toBe("import_workbook")
    expect(e.alsoNeeds.map((r) => r.kind)).toEqual(["external_feed"])
  })

  it("puts a typed figure ahead of a file, because one person can do it now", () => {
    const e = explainMissingCell(["budgetLine:revenue", "operationalFact:harvest_tons"])
    expect(e.primary?.kind).toBe("manual_entry")
  })

  it("collapses repeats of the same remedy instead of listing them", () => {
    // Three commodity inputs are one instruction, not three.
    const e = explainMissingCell([
      "commodity:sugar",
      "commodity:wheat",
      "weather:rainfall",
    ])
    expect(e.primary?.kind).toBe("external_feed")
    expect(e.alsoNeeds).toEqual([])
  })
})

describe("what it refuses to guess", () => {
  it("says nothing when the indicator declares no inputs", () => {
    // An indicator with no `requiredInputs` is a seed-data problem. Inventing
    // advice would send somebody to fix the wrong thing; the panel falls back
    // to its old generic line.
    expect(explainMissingCell([])).toEqual({ primary: null, alsoNeeds: [] })
    expect(explainMissingCell(null)).toEqual({ primary: null, alsoNeeds: [] })
    expect(explainMissingCell(undefined)).toEqual({ primary: null, alsoNeeds: [] })
  })

  it("marks an unrecognised namespace as unknown rather than assuming import", () => {
    // Defaulting to "upload a workbook" is exactly the wrong-advice problem
    // this module exists to remove, and it would hide a new namespace instead
    // of surfacing it.
    expect(kind(["somethingNobodyHasWrittenYet:x"])).toBe("unknown")
  })

  it("ignores empty and non-string entries without crashing", () => {
    expect(kind(["", "budgetLine:x"])).toBe("import_workbook")
    expect(explainMissingCell([""]).primary).toBeNull()
  })
})

describe("remedyKey", () => {
  it("namespaces every kind under the same i18n prefix", () => {
    expect(remedyKey("manual_entry")).toBe("indicatorDetail.remedy.manual_entry")
    expect(remedyKey("external_feed")).toBe("indicatorDetail.remedy.external_feed")
  })
})
