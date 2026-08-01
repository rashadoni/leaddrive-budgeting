/**
 * Turn a flat list of import warnings into something a finance reader can act on.
 *
 * 2026-07-31 (11.69) — the owner, looking at a real preview: «это надо сделать
 * более понятным, тут ничего не поймёшь, всё так записано». He was right, and
 * the run he was looking at shows why. Twelve warnings, and SIX of them said
 * the same thing:
 *
 *   PLF Actual 2025 [AZSEKER-CPC] — carries 2025 data, but this run imports 2026 — skipped
 *   PLF Actual 2025 [AZSEKER-AZSF] — carries 2025, 2029 data, but this run imports 2026 — skipped
 *   … four more, identical in substance
 *
 * A routine, expected skip repeated six times sat in the same undifferentiated
 * list as an actual structural failure ("Missing required column(s)"), in
 * English, on an Azerbaijani page. Volume buried meaning: nothing was hidden
 * and nothing was legible.
 *
 * 2026-08-01 (11.82) — the owner, on the same screen, one grouping later:
 * «как теперь финансисту решить, или отдельно добавить, или понять почему не
 * смогло прочесть? тут нужен реальный рабочий инструмент». Grouping made the
 * list short; it did not make any single line answerable. Three sheets came
 * back as "could not read" and they were three different events:
 *
 *   Tech            a two-column Product|Yes/No reference list. Classified
 *                   INFO_SUMMARY — a dataType whose contract is to write
 *                   nothing. Nothing was attempted, so nothing failed.
 *   Satış İcmalı    a product × month sales grid. Read as OPS_FACTS and
 *                   rejected by the flat-facts reader.
 *   Müştəri İcmalı  371 customer rows that reach nothing, taking
 *                   CUSTOMER_HHI / TOP_CUSTOMER_SHARE / TOP3_CUSTOMER_SHARE /
 *                   SUPPLIER_HHI with them.
 *
 * One heading, three consequences. So this module now does two things beyond
 * grouping:
 *
 *   1. It separates DELIBERATELY NOT READ from TRIED AND FAILED. The evidence
 *      is the pipeline's own contract, not the sheet's name: a dataType in
 *      `NO_WRITE_DATATYPES` was never going to write a row, and a sheet routed
 *      `derived_summary` was skipped on purpose. Neither is a warning; both
 *      belong in a quiet line.
 *   2. For a real failure it emits a BRIEFING — what the sheet holds, what
 *      stays empty, what to do next — as i18n keys plus params, so the strings
 *      live in messages/{en,az,ru}.json and this module stays testable.
 *
 * On not inventing things. Every fact a briefing states is one the preview
 * payload already carries: sheet dimensions and the detected header offset
 * come from `workbookProfile.sheets[]`, the dataType and confidence from the
 * classifier, the indicator list from the same projection the Analysis tab
 * renders. Two facts are deliberately NOT stated because they are not
 * knowable here — see `SheetFacts.preambleRows` and `NAMEABLE_STAKES_MAX`.
 *
 * This module only CLASSIFIES — it does no I/O and renders nothing, so the
 * grouping can be unit-tested against the real strings from a production run
 * rather than against a mock. The rendering layer adds the localized text.
 *
 * Matching is on the English message text because that is what the pipeline
 * emits; every producer is in this repo. A string that matches nothing lands
 * in `other`, which is displayed in full — an unrecognised warning must never
 * be quietly swallowed by the tidying that was supposed to clarify it.
 */

export type WarningGroupKey =
  /** Sheet or rows belong to a year this run is not importing. Expected. */
  | "off-year"
  /** A product/label was imported under its own code, mapping worth review. */
  | "dictionary"
  /** A unit was auto-corrected (tonnes that were really kilograms). */
  | "unit-fix"
  /** A sheet could not be parsed — missing columns, no header row. */
  | "structure"
  /** A sheet's rows could not be attached to a company. */
  | "unattributed"
  /**
   * The pipeline never intended to read this sheet. Not a warning: a
   * statement of intent. Rendered as a quiet line, outside the amber block,
   * and excluded from the warning count.
   */
  | "by-design"
  /** Anything unrecognised. Always shown in full. */
  | "other"

/** Groups the reader must act on, versus ones that are merely reported. */
export const ACTIONABLE_GROUPS: ReadonlySet<WarningGroupKey> = new Set([
  "structure",
  "unattributed",
  "other",
])

/**
 * Groups that must NOT be counted as warnings or drawn in amber.
 *
 * A sheet the pipeline deliberately skipped has the same standing as a sheet
 * it never saw. Counting it inflates the "N warnings" badge with events that
 * have no reader and no remedy — which is the exact failure mode 11.69 set
 * out to fix, reintroduced one level down.
 */
export const QUIET_GROUPS: ReadonlySet<WarningGroupKey> = new Set(["by-design"])

/**
 * dataTypes whose handler contract is "writes nothing to the database".
 *
 * Deliberately just one entry. `INFO_SUMMARY` is the classifier's verdict
 * "this is a summary / index / section separator"; its rule in
 * `datatype-indicator-map.ts` reads «Ничего — это section separator» with the
 * note «лист пропускается без записи в БД», and it projects zero indicators.
 * A sheet the pipeline was never going to write from cannot have failed.
 *
 * `UNKNOWN` looks similar and is NOT here on purpose: "the AI could not type
 * this sheet" is a failure to understand the file, not a decision about it.
 * Quieting it would hide the one case where the operator's judgement is the
 * only thing left. `SALES` / `CAPEX` / `BUDGET_ACTUALS` also project zero
 * indicators, but they write real rows — empty indicator impact is not the
 * same as an empty write contract, and conflating the two would silence
 * genuine data loss.
 */
export const NO_WRITE_DATATYPES: ReadonlySet<string> = new Set(["INFO_SUMMARY"])

/**
 * dataTypes whose writer is `OperationalFact`, which the Data-entry admin
 * screen (`/budgeting/admin/data-entry`) can also write by hand — 13
 * operational metrics × all companies. Enough to correct a figure, not
 * enough to replace a sheet, and the copy says exactly that.
 *
 * There is no equivalent screen for counterparties: `/api/counterparties`
 * exposes GET only and `ConcentrationPanel` is read-only. So a COUNTERPARTY
 * failure gets told the truth — the file has to carry it — rather than being
 * pointed at a page that cannot accept it.
 */
const MANUAL_ENTRY_DATATYPES: ReadonlySet<string> = new Set([
  "OPS_FACTS",
  "KPI_FARMING",
  "KPI_PROCESSING",
  "LAND_REGISTRY",
])

/**
 * Above this many projected indicators, the list stops describing the SHEET
 * and starts describing the dataType.
 *
 * `affectedIndicatorsForDataType("COUNTERPARTY")` returns exactly four —
 * CUSTOMER_HHI, TOP_CUSTOMER_SHARE, TOP3_CUSTOMER_SHARE, SUPPLIER_HHI —
 * because the `counterparty:` requiredInput prefix has one writer. Naming
 * them is a claim about this sheet and it is true.
 *
 * `OPS_FACTS` matches every `operationalFact:*` token and returns 24 (capped
 * to 12 by the API), spanning poultry FCR, school enrolment and rent
 * collection. Printing that under "what you lose" for a sales grid would be
 * a fabricated loss. Past the cap the briefing says so instead, and points at
 * the classification as the thing to check — which is the real defect.
 */
export const NAMEABLE_STAKES_MAX = 6

/** An i18n message key plus its ICU params. No English lives in this module. */
export interface I18nLine {
  key: string
  params: Record<string, string | number>
}

/**
 * What the preview already knows about one sheet, at the moment a warning
 * about it is rendered. Every field is optional: a briefing degrades to
 * whatever is actually in hand rather than filling gaps with plausible text.
 */
export interface SheetFacts {
  sheetName: string
  filename?: string | null
  /** Classifier verdict — "COUNTERPARTY", "OPS_FACTS", "INFO_SUMMARY", … */
  dataType?: string | null
  /** Classifier confidence, 0..1. */
  confidence?: number | null
  /** Deterministic routing role. `derived_summary` = skipped on purpose. */
  role?: "source" | "derived_summary" | null
  /**
   * Rows below the detected header, within the sheet's used range after
   * blank rows are dropped. On the live `Müştəri İcmalı` this is 371 — the
   * exact customer count.
   */
  dataRows?: number | null
  /** Columns in the used range. */
  columns?: number | null
  /**
   * Non-empty rows sitting ABOVE the header, in the same blank-stripped view.
   *
   * NOT the Excel row number, and the copy never claims it is. `!ref` starts
   * at A2 on this workbook and `extractWorkbookMeta` reads the sheet with
   * `blankrows: false`, so the header at index 3 is Excel row 6, not row 5 —
   * off-by-one in both directions at once. Saying "3 rows sit above the
   * header" is exactly true of what the pipeline saw; saying "row 5" would be
   * a lie and "row 6" is not derivable from anything the payload carries.
   * See the report for the 6-line change to `SheetMeta` that would make the
   * absolute row available.
   */
  preambleRows?: number | null
  /** False when no header row could be identified at all. */
  headerFound?: boolean
  /** Indicator codes this sheet was projected to feed (Analysis-tab list). */
  indicatorCodes?: readonly string[]
}

/** One warning, with everything the reader needs to decide what to do. */
export interface WarningBriefing {
  /** The original line, unmodified. Nothing is paraphrased away. */
  message: string
  filename: string | null
  sheetName: string | null
  group: WarningGroupKey
  /** Why this is a quiet line rather than a warning. Only on `by-design`. */
  byDesignReason: I18nLine | null
  /** WHAT is in the sheet. */
  contains: I18nLine[]
  /** WHAT YOU LOSE. Null on `by-design` — nothing was going to be written. */
  stakes: I18nLine | null
  /** Indicator codes safe to print as a list (empty when not nameable). */
  stakeCodes: string[]
  /** WHAT TO DO. Ordered; the first line is the primary remedy. */
  actions: I18nLine[]
}

export interface WarningGroup {
  key: WarningGroupKey
  /** Original messages, unmodified — nothing is paraphrased away. */
  messages: string[]
  /** Years named by an off-year warning, so the UI can offer the remedy. */
  years: number[]
  /** Per-message briefing, index-aligned with `messages`. */
  briefings: WarningBriefing[]
}

/**
 * Ordered by CONSEQUENCE, not by how the pipeline happens to emit them.
 *
 * A single warning line routinely staples several notes together with " · ",
 * so whichever rule matches first decides the heading it appears under. The
 * first version of this list was ordered by convenience and put `off-year`
 * on top — which swallowed the sales line that read
 *
 *   "1516 row(s) outside 2026 skipped · … the values are kilograms;
 *    divided by 1000 so price/volume read per tonne"
 *
 * under "expected skips", hiding the one note in the whole run that CHANGED
 * THE NUMBERS. Caught by the test that runs the real production list rather
 * than fixtures. Most consequential wins:
 *
 *   unit-fix      the data was transformed on the way in
 *   structure     a sheet did not parse at all
 *   unattributed  rows resolved to no company
 *   dictionary    it landed, but under a code worth reviewing
 *   off-year      nothing happened, on purpose
 */
const RULES: ReadonlyArray<{ key: WarningGroupKey; test: RegExp }> = [
  { key: "unit-fix", test: /the values are kilograms|divided by 1000/i },
  {
    key: "structure",
    test: /missing required column|could not locate year-header|no counterparty blocks/i,
  },
  { key: "unattributed", test: /could not be attributed to a company/i },
  { key: "dictionary", test: /outside the approved dictionary/i },
  // "carries 2025 data, but this run imports 2026 — skipped"
  // "1516 row(s) outside 2026 skipped (import that year separately)"
  { key: "off-year", test: /but this run imports|outside \d{4} skipped/i },
]

/**
 * Groups that can be demoted to `by-design` when the sheet's contract says
 * nothing was ever going to be written.
 *
 * `unit-fix` and `dictionary` are absent deliberately: those describe writes
 * that DID happen, so no contract can make them uninteresting. `off-year` is
 * absent because it is already quiet enough and its remedy (tick the
 * multi-year box) is real.
 */
const DEMOTABLE: ReadonlySet<WarningGroupKey> = new Set([
  "structure",
  "unattributed",
  "other",
])

function baseClassify(message: string): WarningGroupKey {
  for (const rule of RULES) if (rule.test.test(message)) return rule.key
  return "other"
}

/** Every 4-digit year 2000-2099 named in the text, deduped. */
function yearsIn(message: string): number[] {
  return [...new Set(message.match(/\b20\d{2}\b/g) ?? [])].map(Number)
}

/**
 * Warnings are emitted as `<filename>: sheet "<name>" — <text>`, sometimes
 * behind a `[2026] ` year tag added when a run covers several years
 * (ai-auto-multi/route.ts). Anything that does not match this shape simply
 * has no sheet, and its briefing falls back to the raw message.
 */
const SHEET_PREFIX =
  /^(?:\[\d{4}\]\s*)?(?<file>[^:]+?):\s*sheet\s+"(?<sheet>[^"]+)"\s*[—–-]\s*/u

export function parseWarningSource(message: string): {
  filename: string | null
  sheetName: string | null
} {
  const m = SHEET_PREFIX.exec(message)
  return {
    filename: m?.groups?.file?.trim() ?? null,
    sheetName: m?.groups?.sheet?.trim() ?? null,
  }
}

/** `Expected headers: a, b, c (optional: d).` → "a, b, c" */
function expectedHeadersIn(message: string): string | null {
  const m = /Expected headers:\s*([^.(]+)/i.exec(message)
  const list = m?.[1]?.trim().replace(/[,\s]+$/, "")
  return list && list.length > 0 ? list : null
}

function factsKey(filename: string | null, sheetName: string): string {
  return `${filename ?? ""}::${sheetName}`
}

function buildFactsIndex(facts: readonly SheetFacts[]) {
  const byPair = new Map<string, SheetFacts>()
  const bySheet = new Map<string, SheetFacts>()
  for (const f of facts) {
    if (!f?.sheetName) continue
    byPair.set(factsKey(f.filename ?? null, f.sheetName), f)
    // Last one wins on a bare-name collision; the pair lookup is tried first,
    // so this only matters for a warning with no filename prefix.
    bySheet.set(f.sheetName, f)
  }
  return (filename: string | null, sheetName: string | null) => {
    if (!sheetName) return null
    return byPair.get(factsKey(filename, sheetName)) ?? bySheet.get(sheetName) ?? null
  }
}

/** WHAT IS IN IT — dimensions and how the classifier read it. */
function describeContents(f: SheetFacts | null): I18nLine[] {
  const out: I18nLine[] = []
  const rows = f?.dataRows
  const cols = f?.columns
  if (typeof rows === "number" && typeof cols === "number") {
    if (f?.headerFound === false) {
      out.push({ key: "contains.noHeader", params: { rows, cols } })
    } else if (typeof f?.preambleRows === "number" && f.preambleRows > 0) {
      out.push({
        key: "contains.table",
        params: { rows, cols, preamble: f.preambleRows },
      })
    } else {
      out.push({ key: "contains.tablePlain", params: { rows, cols } })
    }
  } else {
    out.push({ key: "contains.unknown", params: {} })
  }

  if (f?.dataType && f.dataType !== "UNKNOWN") {
    out.push({
      key: "contains.readAs",
      params: {
        dataType: f.dataType,
        pct: Math.round((f.confidence ?? 0) * 100),
      },
    })
  } else {
    out.push({ key: "contains.readAsNone", params: {} })
  }
  return out
}

/** WHAT YOU LOSE — gated so the list never over-claims. See NAMEABLE_STAKES_MAX.
 *
 * `coveredElsewhere` holds the indicators that a DIFFERENT sheet in the same
 * run feeds and that raised no warning of its own. Subtracting it is the
 * difference between a briefing and a scare.
 *
 * 2026-08-01 (11.85) — without it this card told the owner that
 * `Müştəri İcmalı` cost four indicators. It cost none: that sheet is a
 * pre-computed summary, and CUSTOMER_HHI / TOP_CUSTOMER_SHARE /
 * TOP3_CUSTOMER_SHARE / SUPPLIER_HHI are derived per operating company from
 * the sales fact sheets, where every row names its customer. Production held
 * 276 such rows for AZSEKER-CPC in 2025. Acting on the false claim would have
 * written a third, unreconciled set of figures over the same revenue.
 */
function describeStakes(
  f: SheetFacts | null,
  coveredElsewhere: ReadonlySet<string> = new Set(),
): {
  stakes: I18nLine
  stakeCodes: string[]
} {
  const all = [...(f?.indicatorCodes ?? [])]
  const codes = all.filter((c) => !coveredElsewhere.has(c))
  if (all.length > 0 && codes.length === 0) {
    // Every indicator this sheet would have fed is already fed by a sheet that
    // imported cleanly. Nothing is lost, and saying so is the whole point.
    return {
      stakes: { key: "stakes.coveredElsewhere", params: { n: all.length } },
      stakeCodes: [],
    }
  }
  if (!f?.dataType || f.dataType === "UNKNOWN") {
    return { stakes: { key: "stakes.untyped", params: {} }, stakeCodes: [] }
  }
  if (codes.length === 0) {
    return {
      stakes: { key: "stakes.none", params: { dataType: f.dataType } },
      stakeCodes: [],
    }
  }
  if (codes.length > NAMEABLE_STAKES_MAX) {
    return {
      stakes: { key: "stakes.broad", params: { dataType: f.dataType, n: codes.length } },
      stakeCodes: [],
    }
  }
  return {
    stakes: {
      key: "stakes.indicators",
      params: { n: codes.length, codes: codes.join(", ") },
    },
    stakeCodes: codes,
  }
}

/**
 * WHAT TO DO — only remedies that exist.
 *
 * The primary one is the "Guided fixes" tab already on this page: it lists
 * every sheet with no resolved company (both live failures qualify) and its
 * Role dropdown writes `role: "derived_summary"` into the next preview, at
 * which point the sheet is skipped and this module demotes it to the quiet
 * line. That is a closed loop the user can walk today.
 *
 * Import Doctor is the second: `sheet_fix` proposals carry the same patch and
 * are applied in-page.
 *
 * "Enter it manually" is offered ONLY where a screen accepts it. For
 * counterparties none does, and the copy says so instead of inventing one.
 */
function describeActions(
  message: string,
  f: SheetFacts | null,
  stakeCodes: string[],
): I18nLine[] {
  const out: I18nLine[] = []
  const expected = expectedHeadersIn(message)
  if (expected) {
    out.push({ key: "action.expectedHeaders", params: { expected } })
  }
  out.push({ key: "action.roleOrDoctor", params: {} })

  const dt = f?.dataType ?? ""
  if (dt === "COUNTERPARTY") {
    out.push({ key: "action.manualNone", params: {} })
  } else if (MANUAL_ENTRY_DATATYPES.has(dt)) {
    out.push({ key: "action.manualDataEntry", params: {} })
  }
  if (stakeCodes.length > 0) out.push({ key: "action.backlog", params: {} })
  return out
}

function buildBriefing(
  message: string,
  group: WarningGroupKey,
  f: SheetFacts | null,
  coveredElsewhere: ReadonlySet<string> = new Set(),
): WarningBriefing {
  const { filename, sheetName } = parseWarningSource(message)
  const base = {
    message,
    filename,
    sheetName,
    group,
    contains: describeContents(f),
  }

  if (group === "by-design") {
    const reason: I18nLine =
      f && NO_WRITE_DATATYPES.has(f.dataType ?? "")
        ? { key: "byDesign.infoSummary", params: { dataType: f.dataType ?? "" } }
        : { key: "byDesign.derived", params: {} }
    return {
      ...base,
      byDesignReason: reason,
      stakes: null,
      stakeCodes: [],
      actions: [],
    }
  }

  if (!ACTIONABLE_GROUPS.has(group)) {
    // off-year / dictionary / unit-fix already read as sentences and have
    // their own group-level hint. A three-part briefing would add words, not
    // information.
    return {
      ...base,
      contains: [],
      byDesignReason: null,
      stakes: null,
      stakeCodes: [],
      actions: [],
    }
  }

  const { stakes, stakeCodes } = describeStakes(f, coveredElsewhere)
  return {
    ...base,
    byDesignReason: null,
    stakes,
    stakeCodes,
    actions: describeActions(message, f, stakeCodes),
  }
}

/**
 * Group warnings, preserving first-appearance order of the groups.
 *
 * Ordering is deliberate: whatever the reader must act on comes first, and
 * the deliberately-skipped sheets come last. A six-line block of expected
 * skips at the top is precisely what made the real list unreadable.
 *
 * @param facts  Per-sheet context from the preview payload. Optional — with
 *   no facts the function behaves exactly as it did before 11.82, which is
 *   what every caller that only has the warning strings gets.
 */
export function groupImportWarnings(
  warnings: readonly string[],
  facts: readonly SheetFacts[] = [],
): WarningGroup[] {
  const lookup = buildFactsIndex(facts)
  const byKey = new Map<WarningGroupKey, WarningGroup>()

  // Which indicators are already fed by a sheet that raised no warning of its
  // own. A sheet that failed cannot cover for another sheet that failed, so
  // the warned sheets are excluded from the union rather than merely from
  // their own subtraction.
  const warnedSheets = new Set(
    warnings
      .filter((m) => typeof m === "string" && m.trim() !== "")
      .map((m) => {
        const { filename, sheetName } = parseWarningSource(m)
        return `${filename ?? ""}\u0000${sheetName ?? ""}`
      }),
  )
  const coveredElsewhere = new Set<string>()
  for (const fact of facts) {
    if (warnedSheets.has(`${fact.filename ?? ""}\u0000${fact.sheetName ?? ""}`)) continue
    for (const code of fact.indicatorCodes ?? []) coveredElsewhere.add(code)
  }

  for (const message of warnings) {
    if (typeof message !== "string" || message.trim() === "") continue
    const { filename, sheetName } = parseWarningSource(message)
    const f = lookup(filename, sheetName)

    let key = baseClassify(message)
    // The demotion. Evidence only: a no-write contract, or a sheet the
    // router already decided to skip. Never the sheet's name.
    if (
      f &&
      DEMOTABLE.has(key) &&
      (NO_WRITE_DATATYPES.has(f.dataType ?? "") || f.role === "derived_summary")
    ) {
      key = "by-design"
    }

    const briefing = buildBriefing(message, key, f, coveredElsewhere)
    const hit = byKey.get(key)
    if (hit) {
      hit.messages.push(message)
      hit.briefings.push(briefing)
      for (const y of yearsIn(message)) if (!hit.years.includes(y)) hit.years.push(y)
    } else {
      byKey.set(key, {
        key,
        messages: [message],
        years: yearsIn(message),
        briefings: [briefing],
      })
    }
  }

  const groups = [...byKey.values()]
  for (const g of groups) g.years.sort((a, b) => a - b)
  // 0 = act on it, 1 = reported, 2 = never attempted.
  const rank = (k: WarningGroupKey) =>
    ACTIONABLE_GROUPS.has(k) ? 0 : QUIET_GROUPS.has(k) ? 2 : 1
  return groups.sort((a, b) => rank(a.key) - rank(b.key))
}

/**
 * How many of these lines are actually warnings.
 *
 * The badge and the "N warning(s)" headline must not count sheets the
 * pipeline chose not to read.
 */
export function countRealWarnings(groups: readonly WarningGroup[]): number {
  return groups.reduce(
    (n, g) => (QUIET_GROUPS.has(g.key) ? n : n + g.messages.length),
    0,
  )
}
