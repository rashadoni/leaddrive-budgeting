// @vitest-environment happy-dom
/**
 * The blast radius, rendered through the REAL catalogues in all three
 * languages.
 *
 * `BlastRadius.test.tsx` mocks translations to their keys, which is the right
 * way to pin structure — and is exactly why three copy defects survived it:
 * a key-shaped translator cannot show you that the Azerbaijani reads
 * «1550 sətir silinəcək. yalnız faylı…» (lowercase after a full stop), that
 * the Russian clauses had lost the word «строк», or that a delete of twelve
 * permanently destroyed records summarised itself as "0".
 *
 * These cases are the ones two reviewers actually read off the screen.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import enMessages from "@/../messages/en.json"
import ruMessages from "@/../messages/ru.json"
import azMessages from "@/../messages/az.json"

type Locale = "en" | "az" | "ru"

const MESSAGES: Record<Locale, unknown> = {
  en: enMessages,
  az: azMessages,
  ru: ruMessages,
}

/** Set by each test before rendering; read by the module-level mock. */
let locale: Locale = "en"

function lookup(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj
  for (const p of path) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else return undefined
  }
  return cur
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => {
    const path = [...namespace.split("."), ...key.split(".")]
    const v = lookup(MESSAGES[locale], path)
    if (typeof v !== "string") throw new Error(`missing ${locale} key: ${path.join(".")}`)
    return v.replace(/\{(\w+)\}/g, (_m, k) =>
      values?.[k] != null ? String(values[k]) : `{${k}}`,
    )
  },
}))

import { BlastRadius } from "./BlastRadius"

afterEach(cleanup)

const base = {
  companyCount: 3,
  checkedAt: null,
  stale: false,
  onRecheck: () => {},
}

function renderIn(
  lang: Locale,
  breakdown: Record<string, number>,
  years: number[] = [2026],
) {
  locale = lang
  render(<BlastRadius {...base} years={years} breakdown={breakdown} />)
  return {
    lead: screen.getByTestId("radius-lead").textContent ?? "",
    clauses: [...screen.getByTestId("radius-clauses").children].map(
      (li) => li.textContent ?? "",
    ),
    all: screen.getByTestId("blast-radius").textContent ?? "",
  }
}

/**
 * The word that makes a bare number mean something. (`\b` is ASCII-only in
 * JS regexes, so Cyrillic and `ə` get plain substrings.)
 */
const ROW_UNIT: Record<Locale, RegExp> = {
  en: /\brows?\b/,
  az: /sətir/,
  ru: /строк/,
}

const LANGS: Locale[] = ["en", "az", "ru"]

describe("BlastRadius — real catalogues", () => {
  describe.each(LANGS)("%s", (lang) => {
    it("carries the unit in every clause of the production case", () => {
      // This database today: 1500 hard-deleted operational facts and 50
      // indicator values. Russian printed «…: 1500 · …: 50» — 1500 what?
      const { clauses } = renderIn(lang, { operationalFact: 1500, indicatorValue: 50 })
      expect(clauses.length).toBe(2)
      for (const clause of clauses) {
        expect(clause, `${lang}: "${clause}" names no unit`).toMatch(ROW_UNIT[lang])
      }
      expect(clauses.join(" ")).toContain("1500")
      expect(clauses.join(" ")).toContain("50")
    })

    it("never starts a clause in lower case, and never ends the lead in a stop", () => {
      const { lead, clauses } = renderIn(lang, {
        budgetLine: 800,
        budgetActualManual: 50,
        operationalFact: 630,
        indicatorValue: 120,
        recordsCompliance: 3,
        complianceWriteBacks: 12,
      })
      expect(lead.trim().endsWith("."), `${lang} lead: "${lead}"`).toBe(false)
      for (const clause of clauses) {
        const first = clause.trim()[0]
        expect(
          first === first.toUpperCase(),
          `${lang}: clause starts lower case — "${clause}"`,
        ).toBe(true)
      }
    })

    it("names the records, and does not fold them into the row count", () => {
      const { lead, clauses } = renderIn(lang, {
        budgetLine: 1273,
        recordsCompliance: 3,
        complianceWriteBacks: 12,
      })
      expect(lead).toContain("1273")
      expect(clauses.join(" ")).toContain("15")
      expect(clauses.join(" ")).toContain("12")
      expect(lead).not.toContain("1288")
    })

    it("does not headline «0 rows» over records it destroys for ever", () => {
      // Case C — a company carrying only compliance records.
      const { lead, clauses } = renderIn(lang, {
        recordsCompliance: 3,
        complianceWriteBacks: 12,
      })
      expect(lead).not.toMatch(/(^|\D)0(\D|$)/)
      expect(lead).toContain("15")
      expect(clauses.join(" ")).toContain("12")
    })

    it("promises the page can bring rows back only for a single named year", () => {
      const oneYear = renderIn(lang, { budgetLine: 800 }, [2026])
      const recoverablePhrase = oneYear.clauses[0]
      cleanup()

      const allYears = renderIn(lang, { budgetLine: 800 }, [])
      expect(allYears.clauses[0]).not.toBe(recoverablePhrase)
      // The support sentence is the honest answer when the operator has none.
      const support = lookup(MESSAGES[lang], [
        "adminDataDelete",
        "radius",
        "caveat",
        "archivedSupport",
      ]) as string
      expect(allYears.all).toContain(support)
      cleanup()

      const twoYears = renderIn(lang, { budgetLine: 800 }, [2025, 2026])
      expect(twoYears.clauses[0]).toBe(allYears.clauses[0])
    })
  })

  it("renders the reviewer's Azerbaijani sentences, in full", () => {
    // Spelled out rather than pattern-matched: these three lines are what the
    // finance director reads, and a regression in them is a regression in the
    // only thing this screen is for.
    const production = renderIn("az", { operationalFact: 1500, indicatorValue: 50 })
    expect(production.lead).toBe("1550 sətir silinəcək")
    expect(production.clauses).toEqual([
      "Yalnız faylı yenidən yükləməklə qayıdır: 1500 sətir.",
      // The delete takes the SOURCE rows too (1500 operational figures), so
      // the recompute rebuilds the indicators from nothing and the matrix
      // stays grey. "Need nothing from you" was exactly wrong here.
      "Silinir və dərhal yenidən hesablanır: 50 sətir — lakin onların hesablandığı məlumat da gedir, ona görə boş qayıdacaqlar və faylı yenidən yükləyənədək risk matrisi boz qalacaq.",
    ])
    cleanup()

    const caseC = renderIn("az", { recordsCompliance: 3, complianceWriteBacks: 12 })
    expect(caseC.lead).toBe("Silinəcək maliyyə sətri yoxdur — yalnız 15 qeyd silinir")
    expect(caseC.clauses).toEqual(["Həmin qeydlərdən həmişəlik itən: 12."])
    cleanup()

    const taskB = renderIn("az", { budgetLine: 600, complianceWriteBacks: 12 }, [])
    expect(taskB.clauses[0]).toBe(
      "Sistemdən çıxarılır, lakin bazada saxlanılır: 600 sətir — bu səhifədən geri qaytarmaq mümkün deyil.",
    )
    expect(taskB.all).not.toContain("Bu səhifədən geri qaytarıla bilər")
  })
})
