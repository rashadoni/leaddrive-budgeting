/**
 * The two invariants that let an English demo ship to an Azerbaijani client.
 *
 * 2026-07-31 (11.75) — reported as «меню на азербайджанском, инфографики на
 * английском». The catalogues were not missing anything: en/az/ru each held
 * exactly 4467 keys, so every "are there gaps?" check passed. 136 az values
 * and 98 ru values were simply the English string copied across — including
 * `nav.riskTerminal` "Risk Terminal", `nav.aiImport` "Data Import" and
 * `nav.complianceHub` "Compliance Hub", sitting in the sidebar next to
 * properly translated items.
 *
 * A parity check cannot see that, because parity was never broken. This file
 * pins the two things that were:
 *
 *   (a) all three catalogues carry the same leaf keys, and
 *   (b) an English PHRASE is never reused verbatim as a translation.
 *
 * On (b), the line is drawn at phrases on purpose. Single labels and
 * abbreviations are legitimately identical in Azerbaijani — Status, Plan,
 * Risk, Normal, Median, Audit, Bank, Terminal — as are COGS, EBITDA, SWIFT,
 * Bloomberg and format strings like `{count}/{total}`. Listing all ~160 of
 * those would produce an allow-list nobody reads and everybody appends to.
 * Two or more English words together are different: that is prose, and prose
 * is never accidentally identical in another language.
 *
 * Measured on the commit that introduced this file: the rule flags 67
 * violations against the catalogues as they were, and 3 after the sweep —
 * all three deliberate, listed below. That ratio is what makes it worth
 * having; a guard that has never been seen to fail is not evidence.
 */

import { describe, it, expect } from "vitest"
import az from "../../../messages/az.json"
import en from "../../../messages/en.json"
import ru from "../../../messages/ru.json"

type Catalogue = Record<string, unknown>

function flatten(obj: Catalogue, prefix = "", out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object") flatten(v as Catalogue, key, out)
    else out[key] = String(v)
  }
  return out
}

const EN = flatten(en as Catalogue)
const AZ = flatten(az as Catalogue)
const RU = flatten(ru as Catalogue)

/**
 * Keys whose English value is a phrase AND must stay verbatim in every
 * locale. Deliberately tiny — anything added here needs a reason on the line.
 */
const PHRASE_ALLOW_LIST: Record<string, string> = {
  // Command syntax the user literally types. Translating the example would
  // teach the wrong commands.
  "terminal.commandBar.placeholder": "keystroke syntax example, not prose",
  // "Status" is the same word in Azerbaijani; "(MNG)" is the management-
  // accounts abbreviation used in the client's own reporting.
  "adminCompliance.thStatusMng": "Azerbaijani cognate + client abbreviation",
  "adminCompliance.drilldownStatusMng": "Azerbaijani cognate + client abbreviation",
}

/**
 * A phrase is two or more alphabetic words carrying at least eight letters.
 *
 * ICU placeholders are stripped first, so `Plan: {plan}` counts as one word
 * and stays out of scope, while `Cost Model` and `Balance sheet` are in.
 */
function isPhrase(value: string): boolean {
  const words = value
    .replace(/\{[^}]*\}/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-z]{2}/.test(w))
  return words.length >= 2 && value.replace(/[^A-Za-z]/g, "").length >= 8
}

describe("message catalogues", () => {
  it("carry identical leaf keys in en, az and ru", () => {
    const keys = {
      en: new Set(Object.keys(EN)),
      az: new Set(Object.keys(AZ)),
      ru: new Set(Object.keys(RU)),
    }
    const missing = (from: Set<string>, against: Set<string>) =>
      [...from].filter((k) => !against.has(k)).sort()

    expect(
      { missingInAz: missing(keys.en, keys.az), missingInRu: missing(keys.en, keys.ru) },
    ).toEqual({ missingInAz: [], missingInRu: [] })

    // And nothing extra either — a key only az has is an unreachable string.
    expect(
      { extraInAz: missing(keys.az, keys.en), extraInRu: missing(keys.ru, keys.en) },
    ).toEqual({ extraInAz: [], extraInRu: [] })
  })

  it("never reuse an English phrase as an Azerbaijani or Russian translation", () => {
    const untranslated: string[] = []
    for (const [key, value] of Object.entries(EN)) {
      if (!isPhrase(value) || key in PHRASE_ALLOW_LIST) continue
      if (AZ[key] === value) untranslated.push(`az  ${key} = ${JSON.stringify(value)}`)
      if (RU[key] === value) untranslated.push(`ru  ${key} = ${JSON.stringify(value)}`)
    }
    expect(
      untranslated,
      `English phrases left verbatim in a translated catalogue. Translate them, ` +
        `or add the key to PHRASE_ALLOW_LIST with a reason if it genuinely must ` +
        `stay in English:\n${untranslated.join("\n")}`,
    ).toEqual([])
  })

  it("keep every allow-list entry earning its place", () => {
    // An allow-list that outlives the strings it exempts is how the next
    // batch slips through unnoticed.
    for (const key of Object.keys(PHRASE_ALLOW_LIST)) {
      expect(EN[key], `${key} is allow-listed but no longer exists`).toBeDefined()
      expect(
        AZ[key] === EN[key] || RU[key] === EN[key],
        `${key} is allow-listed but is now translated — drop it from the list`,
      ).toBe(true)
    }
  })
})
