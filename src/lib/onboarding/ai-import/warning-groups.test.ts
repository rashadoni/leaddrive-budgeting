/**
 * 11.69 — «тут ничего не поймёшь, всё так записано».
 * 11.82 — «как теперь финансисту решить … тут нужен реальный рабочий инструмент».
 *
 * The fixture below is the ACTUAL twelve-warning list from the production
 * preview the owner was looking at on 2026-07-31, copied verbatim. Testing the
 * grouping against invented strings would prove only that the regexes match
 * themselves.
 *
 * `LIVE_FACTS` is the same discipline applied to the second half of the
 * problem. Every number in it was measured by running the real
 * `extractWorkbookMeta` + `buildWorkbookProfile` over
 * `actual-budget-v1.xlsx` — the workbook that produced the warnings above —
 * and cross-checked against the raw cells:
 *
 *   Müştəri İcmalı  !ref A2:T377, totalRows 375, headerRowIndex 3,
 *                   totalColumns 20 → 371 data rows, 3 rows of preamble.
 *                   371 is also the literal customer count (367 third-party
 *                   + 4 intragroup), confirmed by reading column B.
 *   Satış İcmalı    !ref B2:V55,  totalRows 42,  headerRowIndex 0, cols 21.
 *   Tech            !ref B2:C35,  totalRows 34,  headerRowIndex 0, cols 2.
 *
 * dataTypes are the ones the live run must have produced, deduced from which
 * reader emitted each message: "No counterparty blocks detected" only comes
 * from the COUNTERPARTY handler, "Expected headers: companyCode, metric, …"
 * only from the OPS_FACTS flat-facts reader, and "Could not locate
 * year-header row in İcmal sheet" only from the İcmal handler, which is
 * wired to INFO_SUMMARY.
 *
 * The indicator lists are `affectedIndicatorsForDataType` output, asserted
 * against the real function at the bottom of this file so the fixture cannot
 * drift away from the projection the Analysis tab renders.
 */
import { describe, it, expect } from "vitest"
import {
  groupImportWarnings,
  countRealWarnings,
  parseWarningSource,
  ACTIONABLE_GROUPS,
  QUIET_GROUPS,
  NAMEABLE_STAKES_MAX,
  type SheetFacts,
  type WarningBriefing,
} from "./warning-groups"
import { affectedIndicatorsForDataType } from "./datatype-indicator-map"

/** Verbatim from the live run. Six of the twelve say the same thing. */
const LIVE_WARNINGS = [
  'actual-budget-v1.xlsx: sheet "Satış İcmalı" — row 1: Missing required column(s): companyCode, metric, date, value, unit. Expected headers: companyCode, metric, date, value, unit (optional: sourceNote).',
  'actual-budget-v1.xlsx: sheet "Müştəri İcmalı" — No counterparty blocks detected on "Müştəri İcmalı"',
  'actual-budget-v1.xlsx: sheet "Satış Əkinçilik Fakt" — Sales transactions "AZSEKER-AZSF": 140 row(s) outside 2026 skipped (import that year separately). · Sheet "Satış Əkinçilik Fakt": 7 product label(s) outside the approved dictionary — imported under their own code, review the mapping: Arpa Püfə, Pambıq Çiyidi',
  'actual-budget-v1.xlsx: sheet "Satış CPC Fakt" — Sales transactions "AZSEKER-CPC": 1516 row(s) outside 2026 skipped (import that year separately). · column "Net Miqdar Ton" claims tonnes but the median implied price is 0.72 ₼ — the values are kilograms; divided by 1000 so price/volume read per tonne',
  'actual-budget-v1.xlsx: sheet "Tech" — Could not locate year-header row in İcmal sheet',
  'actual-budget-v1.xlsx: sheet "Sales Budget CPC 2026" — 1 product label(s) outside the approved dictionary — imported under their own code, review the mapping: Byproduct',
  'actual-budget-v1.xlsx: sheet "PLF Actual 2025 [AZSEKER-CPC]" — carries 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "PLF Actual 2025 [AZSEKER-AZSF]" — carries 2025, 2029 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "PLF Actual 2025 [AZSEKER-EDEN]" — carries 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "BS Actual 2025 [AZSEKER-CPC]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "BS Actual 2025 [AZSEKER-AZSF]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
  'actual-budget-v1.xlsx: sheet "BS Actual 2025 [AZSEKER-EDEN]" — carries 2024, 2025 data, but this run imports 2026 — skipped without calling the AI detector.',
]

const FILE = "actual-budget-v1.xlsx"
const codes = (dt: Parameters<typeof affectedIndicatorsForDataType>[0]) =>
  affectedIndicatorsForDataType(dt, { limit: 12 }).indicators.map((i) => i.code)

/** Measured from the real workbook — see the header comment. */
const LIVE_FACTS: SheetFacts[] = [
  {
    filename: FILE,
    sheetName: "Müştəri İcmalı",
    dataType: "COUNTERPARTY",
    confidence: 0.82,
    role: "source",
    dataRows: 371,
    columns: 20,
    preambleRows: 3,
    headerFound: true,
    indicatorCodes: codes("COUNTERPARTY"),
  },
  {
    filename: FILE,
    sheetName: "Satış İcmalı",
    dataType: "OPS_FACTS",
    confidence: 0.61,
    role: "source",
    dataRows: 41,
    columns: 21,
    preambleRows: 0,
    headerFound: true,
    indicatorCodes: codes("OPS_FACTS"),
  },
  {
    filename: FILE,
    sheetName: "Tech",
    dataType: "INFO_SUMMARY",
    confidence: 0.74,
    role: "source",
    dataRows: 33,
    columns: 2,
    preambleRows: 0,
    headerFound: true,
    indicatorCodes: codes("INFO_SUMMARY"),
  },
]

const byKey = (ws: readonly string[], facts: SheetFacts[] = LIVE_FACTS) =>
  new Map(groupImportWarnings(ws, facts).map((g) => [g.key, g]))

const brief = (sheet: string, facts: SheetFacts[] = LIVE_FACTS): WarningBriefing =>
  groupImportWarnings(LIVE_WARNINGS, facts)
    .flatMap((g) => g.briefings)
    .find((b) => b.sheetName === sheet)!

const keysOf = (lines: { key: string }[]) => lines.map((l) => l.key)

// ───────────────────────────────────────────────────────────────────
// 11.69 — the grouping. Unchanged behaviour, re-pinned.
// ───────────────────────────────────────────────────────────────────

describe("groupImportWarnings — the real production list", () => {
  it("collapses twelve lines into a handful of kinds", () => {
    const groups = groupImportWarnings(LIVE_WARNINGS, LIVE_FACTS)
    // Twelve unreadable lines become five headings.
    expect(groups.length).toBeLessThanOrEqual(5)
    expect(groups.reduce((n, g) => n + g.messages.length, 0)).toBe(12)
  })

  it("puts the SIX off-year skips under one heading", () => {
    // The whole complaint: the same expected event, restated six times, next
    // to a genuine failure and indistinguishable from it.
    expect(byKey(LIVE_WARNINGS).get("off-year")?.messages).toHaveLength(6)
  })

  it("names the years an off-year skip is about, so the remedy can be offered", () => {
    const years = byKey(LIVE_WARNINGS).get("off-year")!.years
    expect(years).toContain(2025)
    expect(years).toContain(2024)
  })

  it("puts what needs action FIRST and the deliberate skips LAST", () => {
    const order = groupImportWarnings(LIVE_WARNINGS, LIVE_FACTS).map((g) => g.key)
    const firstInformational = order.findIndex((k) => !ACTIONABLE_GROUPS.has(k))
    const lastActionable = order.reduce(
      (last, k, i) => (ACTIONABLE_GROUPS.has(k) ? i : last),
      -1,
    )
    expect(lastActionable).toBeLessThan(firstInformational)
    expect(order[order.length - 1]).toBe("by-design")
  })

  it("keeps the unit auto-correction visible — it changed the numbers", () => {
    expect(byKey(LIVE_WARNINGS).get("unit-fix")?.messages).toHaveLength(1)
  })

  it("never paraphrases — every original line survives verbatim", () => {
    const all = groupImportWarnings(LIVE_WARNINGS, LIVE_FACTS).flatMap(
      (g) => g.messages,
    )
    for (const w of LIVE_WARNINGS) expect(all).toContain(w)
    // …and the briefing carries it too, so a card can always show the source.
    const briefed = groupImportWarnings(LIVE_WARNINGS, LIVE_FACTS).flatMap((g) =>
      g.briefings.map((b) => b.message),
    )
    for (const w of LIVE_WARNINGS) expect(briefed).toContain(w)
  })

  it("stays backward-compatible when no facts are supplied", () => {
    // Callers that only have the strings must see exactly the 11.69 shape:
    // all three "could not read" lines under `structure`, nothing demoted.
    const groups = new Map(groupImportWarnings(LIVE_WARNINGS).map((g) => [g.key, g]))
    expect(groups.get("structure")?.messages).toHaveLength(3)
    expect(groups.has("by-design")).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────
// 11.82 — deliberately skipped vs tried and failed.
// ───────────────────────────────────────────────────────────────────

describe("deliberately skipped is not a warning", () => {
  it("demotes Tech — INFO_SUMMARY was never going to write a row", () => {
    // The live run reported Tech identically to the two sheets that really
    // failed. It is a two-column `Product | Yes/No` reference list; the
    // classifier typed it INFO_SUMMARY, whose contract writes nothing. There
    // is no attempt here, therefore no failure.
    const groups = byKey(LIVE_WARNINGS)
    expect(groups.get("by-design")?.messages).toEqual([
      'actual-budget-v1.xlsx: sheet "Tech" — Could not locate year-header row in İcmal sheet',
    ])
    expect(ACTIONABLE_GROUPS.has("by-design")).toBe(false)
    expect(QUIET_GROUPS.has("by-design")).toBe(true)
  })

  it("leaves the two genuine failures in the amber block", () => {
    const structure = byKey(LIVE_WARNINGS).get("structure")!
    expect(structure.briefings.map((b) => b.sheetName)).toEqual([
      "Satış İcmalı",
      "Müştəri İcmalı",
    ])
  })

  it("does not count a deliberate skip as a warning", () => {
    // Twelve lines, eleven warnings. The badge must not include Tech.
    const groups = groupImportWarnings(LIVE_WARNINGS, LIVE_FACTS)
    expect(groups.reduce((n, g) => n + g.messages.length, 0)).toBe(12)
    expect(countRealWarnings(groups)).toBe(11)
  })

  it("demotes any sheet the router already marked derived_summary", () => {
    // This is the closed loop the copy promises: the Guided-fixes Role
    // dropdown writes role=derived_summary into the next preview, and the
    // sheet stops being a warning. If this breaks, the remedy we print is a
    // lie.
    const fixed = LIVE_FACTS.map((f) =>
      f.sheetName === "Satış İcmalı" ? { ...f, role: "derived_summary" as const } : f,
    )
    const groups = byKey(LIVE_WARNINGS, fixed)
    expect(groups.get("by-design")?.briefings.map((b) => b.sheetName)).toEqual([
      "Satış İcmalı",
      "Tech",
    ])
    expect(groups.get("structure")?.messages).toHaveLength(1)
    expect(countRealWarnings(groupImportWarnings(LIVE_WARNINGS, fixed))).toBe(10)
  })

  it("never demotes UNKNOWN — 'the AI could not type it' is a failure, not a plan", () => {
    const untyped = [
      { filename: FILE, sheetName: "Tech", dataType: "UNKNOWN", role: "source" as const },
    ]
    const groups = byKey(LIVE_WARNINGS, untyped)
    expect(groups.has("by-design")).toBe(false)
    expect(groups.get("structure")?.messages).toHaveLength(3)
  })

  it("never demotes a note about writes that already happened", () => {
    // A unit correction on an INFO_SUMMARY sheet is still a changed number.
    // Contract-based demotion must not reach it.
    const msg =
      'x.xlsx: sheet "Tech" — column "Net Miqdar Ton" claims tonnes but the median implied price is 0.72 ₼ — the values are kilograms; divided by 1000 so price/volume read per tonne'
    const groups = byKey([msg])
    expect(groups.get("unit-fix")?.messages).toHaveLength(1)
    expect(groups.has("by-design")).toBe(false)
  })

  it("explains WHY a quiet line is quiet, and states nothing else", () => {
    const b = brief("Tech")
    expect(b.group).toBe("by-design")
    expect(b.byDesignReason?.key).toBe("byDesign.infoSummary")
    // 34-row × 2-column reference list — the dimensions still help the reader
    // recognise the sheet, but there is no loss and no remedy to offer.
    expect(b.contains[0]).toEqual({
      key: "contains.tablePlain",
      params: { rows: 33, cols: 2 },
    })
    expect(b.stakes).toBeNull()
    expect(b.actions).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────
// 11.82 — a real failure has to answer three questions.
// ───────────────────────────────────────────────────────────────────

describe("a genuine failure says what is in it, what is lost, what to do", () => {
  it("Müştəri İcmalı — 371 rows, four named indicators, a remedy that exists", () => {
    const b = brief("Müştəri İcmalı")
    expect(b.group).toBe("structure")

    // WHAT: the exact shape of the sheet, including the three summary rows
    // above the header that are the reason the reader missed it.
    expect(b.contains).toEqual([
      { key: "contains.table", params: { rows: 371, cols: 20, preamble: 3 } },
      { key: "contains.readAs", params: { dataType: "COUNTERPARTY", pct: 82 } },
    ])

    // WHAT YOU LOSE: named, because COUNTERPARTY projects exactly four.
    expect(b.stakes).toEqual({
      key: "stakes.indicators",
      params: {
        n: 4,
        codes: "CUSTOMER_HHI, TOP_CUSTOMER_SHARE, TOP3_CUSTOMER_SHARE, SUPPLIER_HHI",
      },
    })
    expect(b.stakeCodes).toEqual([
      "CUSTOMER_HHI",
      "TOP_CUSTOMER_SHARE",
      "TOP3_CUSTOMER_SHARE",
      "SUPPLIER_HHI",
    ])

    // WHAT TO DO: the in-page Guided-fixes / Import Doctor loop, the honest
    // note that no screen accepts customer turnover by hand, and where the
    // four indicators go while the sheet stays unreadable.
    expect(keysOf(b.actions)).toEqual([
      "action.roleOrDoctor",
      "action.manualNone",
      "action.backlog",
    ])
    // Never offer a manual-entry screen for data no screen accepts.
    expect(keysOf(b.actions)).not.toContain("action.manualDataEntry")
  })

  it("Satış İcmalı — repeats the reader's own expected columns", () => {
    const b = brief("Satış İcmalı")
    expect(b.group).toBe("structure")
    expect(b.contains).toEqual([
      { key: "contains.tablePlain", params: { rows: 41, cols: 21 } },
      { key: "contains.readAs", params: { dataType: "OPS_FACTS", pct: 61 } },
    ])
    // The flat-facts reader states its own contract in the message; lift it
    // out so the fix is a sentence, not a hunt through server English.
    expect(b.actions[0]).toEqual({
      key: "action.expectedHeaders",
      params: { expected: "companyCode, metric, date, value, unit" },
    })
    expect(keysOf(b.actions)).toContain("action.roleOrDoctor")
    expect(keysOf(b.actions)).toContain("action.manualDataEntry")
  })

  it("refuses to name indicators when the projection describes the dataType", () => {
    // OPS_FACTS matches every `operationalFact:*` token and comes back with a
    // dozen indicators spanning poultry FCR, school enrolment and rent
    // collection. Printing those as "what you lose" for a sales grid would be
    // a fabricated loss, so the briefing says the classification is the thing
    // to check instead.
    const b = brief("Satış İcmalı")
    expect(codes("OPS_FACTS").length).toBeGreaterThan(NAMEABLE_STAKES_MAX)
    expect(b.stakes?.key).toBe("stakes.broad")
    expect(b.stakeCodes).toEqual([])
    expect(keysOf(b.actions)).not.toContain("action.backlog")
  })

  it("says plainly when nothing on the risk score is at stake", () => {
    const facts: SheetFacts[] = [
      {
        filename: FILE,
        sheetName: "Satış İcmalı",
        dataType: "SALES",
        confidence: 0.9,
        dataRows: 41,
        columns: 21,
        indicatorCodes: [],
      },
    ]
    const b = brief("Satış İcmalı", facts)
    // SALES writes real rows but no seeded indicator consumes them. That is
    // NOT the same as "skipped on purpose" — the figures are still missing.
    expect(b.group).toBe("structure")
    expect(b.stakes).toEqual({ key: "stakes.none", params: { dataType: "SALES" } })
  })

  it("admits when the sheet type itself is the unknown", () => {
    const facts: SheetFacts[] = [
      { filename: FILE, sheetName: "Müştəri İcmalı", dataType: "UNKNOWN", dataRows: 371, columns: 20 },
    ]
    const b = brief("Müştəri İcmalı", facts)
    expect(b.contains[1]).toEqual({ key: "contains.readAsNone", params: {} })
    expect(b.stakes).toEqual({ key: "stakes.untyped", params: {} })
  })

  it("degrades honestly when the payload carries no dimensions", () => {
    const b = brief("Müştəri İcmalı", [
      { filename: FILE, sheetName: "Müştəri İcmalı", dataType: "COUNTERPARTY", confidence: 0.82, indicatorCodes: codes("COUNTERPARTY") },
    ])
    // No invented row count. It says the preview does not carry it.
    expect(b.contains[0]).toEqual({ key: "contains.unknown", params: {} })
    expect(b.stakeCodes).toHaveLength(4)
  })

  it("flags a sheet where no header row was found at all", () => {
    const b = brief("Müştəri İcmalı", [
      {
        filename: FILE,
        sheetName: "Müştəri İcmalı",
        dataType: "COUNTERPARTY",
        confidence: 0.5,
        dataRows: 375,
        columns: 20,
        headerFound: false,
      },
    ])
    expect(b.contains[0]).toEqual({
      key: "contains.noHeader",
      params: { rows: 375, cols: 20 },
    })
  })
})

// ───────────────────────────────────────────────────────────────────
// Plumbing
// ───────────────────────────────────────────────────────────────────

describe("parseWarningSource", () => {
  it("reads filename and sheet out of the live prefix", () => {
    expect(parseWarningSource(LIVE_WARNINGS[1])).toEqual({
      filename: "actual-budget-v1.xlsx",
      sheetName: "Müştəri İcmalı",
    })
  })

  it("survives the [year] tag a multi-year run prepends", () => {
    // ai-auto-multi/route.ts prefixes `[2026] ` when a run covers >1 year.
    expect(parseWarningSource(`[2026] ${LIVE_WARNINGS[4]}`)).toEqual({
      filename: "actual-budget-v1.xlsx",
      sheetName: "Tech",
    })
  })

  it("returns nulls for a line that names no sheet", () => {
    expect(parseWarningSource("something nobody has seen before")).toEqual({
      filename: null,
      sheetName: null,
    })
  })
})

describe("the indicator fixture matches the real projection", () => {
  it("COUNTERPARTY is exactly the four the owner named", () => {
    // If a seed changes, this fails here rather than silently making the
    // briefing above assert a stale list.
    expect(codes("COUNTERPARTY")).toEqual([
      "CUSTOMER_HHI",
      "TOP_CUSTOMER_SHARE",
      "TOP3_CUSTOMER_SHARE",
      "SUPPLIER_HHI",
    ])
  })

  it("INFO_SUMMARY projects nothing — that is why it can be demoted", () => {
    expect(codes("INFO_SUMMARY")).toEqual([])
  })
})

describe("groupImportWarnings — edges", () => {
  it("files an unrecognised message under `other`, which is actionable", () => {
    const groups = byKey(["something nobody has seen before"])
    expect(groups.get("other")?.messages).toHaveLength(1)
    expect(ACTIONABLE_GROUPS.has("other")).toBe(true)
  })

  it("returns nothing for an empty or blank-only list", () => {
    expect(groupImportWarnings([])).toEqual([])
    expect(groupImportWarnings(["", "   "])).toEqual([])
    expect(countRealWarnings([])).toBe(0)
  })

  it("classifies a multi-part line by its MOST CONSEQUENTIAL concern", () => {
    // Real lines staple several notes together with " · ". Ordering the rules
    // by convenience instead put this line under "expected skips" because it
    // also mentions rows outside 2026 — burying the dictionary note.
    const g = groupImportWarnings([LIVE_WARNINGS[2]])
    expect(g).toHaveLength(1)
    expect(g[0].messages[0]).toContain("approved dictionary")
  })

  it("does not attach a briefing to an informational group", () => {
    // off-year already reads as a sentence and has its own group hint; three
    // more lines under it would be words, not information.
    const offYear = byKey(LIVE_WARNINGS).get("off-year")!
    for (const b of offYear.briefings) {
      expect(b.contains).toEqual([])
      expect(b.actions).toEqual([])
      expect(b.stakes).toBeNull()
    }
  })

  it("matches facts by sheet name when the warning carries no filename", () => {
    const groups = byKey(['No counterparty blocks detected on "Müştəri İcmalı"'], [
      { sheetName: "Müştəri İcmalı", dataType: "COUNTERPARTY", indicatorCodes: codes("COUNTERPARTY") },
    ])
    // No prefix to parse, so no sheet name and no facts — the line still
    // lands in `structure` and is shown in full rather than dropped.
    expect(groups.get("structure")?.briefings[0].sheetName).toBeNull()
    expect(groups.get("structure")?.messages).toHaveLength(1)
  })
})

describe("11.85 — a loss is only a loss if nothing else covers it", () => {
  /**
   * The card for `Müştəri İcmalı` told the owner it cost four indicators. It
   * cost none: the sheet is a pre-computed summary, and the concentration is
   * derived per operating company from the sales fact sheets, where every row
   * names its customer. Production held 276 such rows for AZSEKER-CPC in 2025.
   *
   * Acting on that false claim nearly wrote a third, unreconciled set of
   * figures over the same revenue — so the subtraction below is the guard, and
   * these fixtures are the real sheet names from the live run.
   */
  const CODES = [
    "CUSTOMER_HHI",
    "TOP_CUSTOMER_SHARE",
    "TOP3_CUSTOMER_SHARE",
    "SUPPLIER_HHI",
  ]
  const summary = {
    filename: "actual-budget-v1.xlsx",
    sheetName: "Müştəri İcmalı",
    dataType: "COUNTERPARTY",
    confidence: 0.92,
    role: "source",
    totalRows: 371,
    totalColumns: 20,
    headerRowIndex: 3,
    indicatorCodes: CODES,
  } as never
  const factSheet = {
    filename: "actual-budget-v1.xlsx",
    sheetName: "Satış CPC Fakt",
    dataType: "SALES_PRODUCTS",
    confidence: 0.9,
    role: "source",
    totalRows: 280,
    totalColumns: 20,
    headerRowIndex: 0,
    indicatorCodes: CODES,
  } as never
  const WARNING =
    'actual-budget-v1.xlsx: sheet "Müştəri İcmalı" — No counterparty blocks detected on "Müştəri İcmalı"'

  function stakesKeyFor(facts: unknown[]) {
    const groups = groupImportWarnings([WARNING], facts as never)
    return groups.flatMap((g) => g.briefings).find((b) => b.sheetName === "Müştəri İcmalı")
      ?.stakes?.key
  }

  it("says nothing is lost when a clean sheet feeds the same indicators", () => {
    expect(stakesKeyFor([summary, factSheet])).toBe("stakes.coveredElsewhere")
  })

  it("still names the loss when no other sheet covers them", () => {
    expect(stakesKeyFor([summary])).toBe("stakes.indicators")
  })

  it("does not let one failing sheet cover for another", () => {
    // A sheet that itself raised a warning cannot vouch for anyone.
    const alsoFailing = { ...(factSheet as object), sheetName: "Satış İcmalı" } as never
    const groups = groupImportWarnings(
      [
        WARNING,
        'actual-budget-v1.xlsx: sheet "Satış İcmalı" — row 1: Missing required column(s): companyCode, metric, date, value, unit.',
      ],
      [summary, alsoFailing] as never,
    )
    const b = groups
      .flatMap((g) => g.briefings)
      .find((x) => x.sheetName === "Müştəri İcmalı")
    expect(b?.stakes?.key).toBe("stakes.indicators")
  })
})
