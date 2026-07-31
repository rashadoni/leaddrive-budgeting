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
 * This module only CLASSIFIES — it does no I/O and renders nothing, so the
 * grouping can be unit-tested against the real strings from a production run
 * rather than against a mock. The rendering layer adds the localized headline.
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
  /** Anything unrecognised. Always shown in full. */
  | "other"

/** Groups the reader must act on, versus ones that are merely reported. */
export const ACTIONABLE_GROUPS: ReadonlySet<WarningGroupKey> = new Set([
  "structure",
  "unattributed",
  "other",
])

export interface WarningGroup {
  key: WarningGroupKey
  /** Original messages, unmodified — nothing is paraphrased away. */
  messages: string[]
  /** Years named by an off-year warning, so the UI can offer the remedy. */
  years: number[]
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

function classify(message: string): WarningGroupKey {
  for (const rule of RULES) if (rule.test.test(message)) return rule.key
  return "other"
}

/** Every 4-digit year 2000-2099 named in the text, deduped. */
function yearsIn(message: string): number[] {
  return [...new Set(message.match(/\b20\d{2}\b/g) ?? [])].map(Number)
}

/**
 * Group warnings, preserving first-appearance order of the groups.
 *
 * Ordering is deliberate: whatever the reader must act on comes first. A
 * six-line block of expected skips at the top is precisely what made the real
 * list unreadable.
 */
export function groupImportWarnings(
  warnings: readonly string[],
): WarningGroup[] {
  const byKey = new Map<WarningGroupKey, WarningGroup>()
  for (const message of warnings) {
    if (typeof message !== "string" || message.trim() === "") continue
    const key = classify(message)
    const hit = byKey.get(key)
    if (hit) {
      hit.messages.push(message)
      for (const y of yearsIn(message)) if (!hit.years.includes(y)) hit.years.push(y)
    } else {
      byKey.set(key, { key, messages: [message], years: yearsIn(message) })
    }
  }
  const groups = [...byKey.values()]
  for (const g of groups) g.years.sort((a, b) => a - b)
  return groups.sort((a, b) => {
    const aAct = ACTIONABLE_GROUPS.has(a.key) ? 0 : 1
    const bAct = ACTIONABLE_GROUPS.has(b.key) ? 0 : 1
    return aAct - bAct
  })
}
