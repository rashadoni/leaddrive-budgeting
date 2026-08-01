// @vitest-environment node
/**
 * Sentences on the Delete data screen that make a claim about the CODE, pinned
 * against the code that has to make them true.
 *
 * These are catalogue tests on purpose. The defects they close were not
 * rendering bugs — every string rendered perfectly — they were three
 * statements about what the system does, two of which were false:
 *
 *   • «All years» "also removes records that have no year of their own".
 *     Task A is the only task that renders the chips, `categoriesFor` never
 *     returns `records` for it, and `includeUnscoped` is sent only by Tasks B
 *     and D. The chip note promised a deletion the task cannot perform, and
 *     contradicted `what.recordsNote` and `radius.recordsKept` two paragraphs
 *     away, both of which said the opposite.
 *
 *   • The headline lead ended in a full stop and every clause began in lower
 *     case, so Azerbaijani and Russian rendered a broken sentence.
 */
import { describe, it, expect } from "vitest"
import az from "@/../messages/az.json"
import en from "@/../messages/en.json"
import ru from "@/../messages/ru.json"
import { BUNDLES } from "./bundles"
import { buildPreviewRequest, categoriesFor } from "./payload"

const CATALOGUES: Record<string, unknown> = { en, az, ru }
const LANGS = ["en", "az", "ru"] as const

function block(lang: string): Record<string, Record<string, string>> {
  const cat = CATALOGUES[lang] as { adminDataDelete: unknown }
  return cat.adminDataDelete as Record<string, Record<string, string>>
}

/** Quotes differ per locale («» in az/ru prose, "" in en) — compare content. */
function unquote(s: string): string {
  return s.replace(/[«»"“”]/g, "")
}

describe("the year chips say what Task A actually deletes", () => {
  it("Task A cannot reach the year-less records tail, by construction", () => {
    for (const bundle of Object.keys(BUNDLES) as Array<keyof typeof BUNDLES>) {
      const state = { task: "clearYears" as const, bundle, exactCategories: null }
      expect(categoriesFor(state)).not.toContain("records")
      const body = buildPreviewRequest({
        ...state,
        companyCodes: ["ACME"],
        years: [],
        includeManualActuals: false,
      })
      expect(body.include).not.toContain("records")
      expect(body.includeUnscoped).toBeUndefined()
    }
  })

  it.each(LANGS)("%s: the «All years» note points records at the task that owns them", (lang) => {
    const b = block(lang)
    const note = unquote(b.years.allChipNote)
    // `what.recordsNote` names the task that DOES delete records. The chip
    // note must send the operator to the same place, not claim the job.
    const taskName = unquote(b.what.recordsNote).match(
      /(Remove one company's data|Bir şirkətin məlumatlarını silmək|Удалить данные одной компании)/,
    )?.[0]
    expect(taskName, `${lang}: what.recordsNote no longer names the task`).toBeTruthy()
    expect(note, `${lang}: the chip note does not redirect records anywhere`).toContain(
      taskName as string,
    )
  })

  it.each(LANGS)("%s: the note is a sentence, not a lowercase fragment", (lang) => {
    const note = block(lang).years.allChipNote
    expect(note.trim().endsWith(".")).toBe(true)
    expect(note[0]).toBe(note[0].toUpperCase())
  })
})

describe("the blast-radius headline reads as prose in every language", () => {
  const CLAUSES = [
    "headlineRecoverableClause",
    "headlineArchivedClause",
    "headlineReimportClause",
    "headlinePermanentClause",
    "headlineRecomputedClause",
    "headlineRecomputedEmptyClause",
    "headlineRecordsClause",
    "headlineRecordsPermanentClause",
  ]

  it.each(LANGS)("%s: the lead is a headline, so it carries no terminal stop", (lang) => {
    const radius = block(lang).radius
    expect(radius.headlineLead.trim().endsWith(".")).toBe(false)
    expect(radius.headlineRecordsOnlyLead.trim().endsWith(".")).toBe(false)
  })

  it.each(LANGS)("%s: every clause is a capitalised sentence", (lang) => {
    const radius = block(lang).radius
    for (const key of CLAUSES) {
      const clause = radius[key]
      expect(clause, `${lang}.${key} is missing`).toBeTruthy()
      expect(clause.trim().endsWith("."), `${lang}.${key}: "${clause}"`).toBe(true)
      const first = clause.trim()[0]
      expect(first === first.toUpperCase(), `${lang}.${key}: "${clause}"`).toBe(true)
    }
  })

  it.each(LANGS)("%s: every row clause names its unit next to its number", (lang) => {
    const radius = block(lang).radius
    const unit = { en: /rows?/, az: /sətir/, ru: /строк/ }[lang]
    for (const key of CLAUSES.slice(0, 6)) {
      expect(radius[key], `${lang}.${key}: "${radius[key]}"`).toMatch(unit)
    }
    // …and the records clauses name theirs, which is a different word.
    const recordUnit = { en: /records/, az: /qeyd/, ru: /запис/ }[lang]
    expect(radius.headlineRecordsClause).toMatch(recordUnit)
    expect(radius.headlineRecordsOnlyLead).toMatch(recordUnit)
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * 11.79 — sentences a reviewer read off the screen and checked against the
 * code, each of which the code contradicted. Same species as the block above:
 * catalogue tests, because the defect is in what the sentence CLAIMS, not in
 * whether it renders.
 * ──────────────────────────────────────────────────────────────────────── */
describe("the screen does not promise what the system will not do", () => {
  it.each(LANGS)("%s: the restore panel refuses keyless deletions in words", (lang) => {
    const restore = block(lang).restore as unknown as Record<string, unknown>
    const legacy = restore.legacy as Record<string, string>
    expect(legacy.title.length).toBeGreaterThan(10)
    expect(legacy.body.length).toBeGreaterThan(60)
    // The blanket "those come back when you upload the file again" caption is
    // gone: it sat over `indicatorValue`, which is in every breakdown and
    // which no file returns.
    expect(restore.reimportInstead).toBeUndefined()
    const fate = restore.fate as Record<string, string>
    expect(Object.keys(fate).sort()).toEqual(["permanent", "recomputed", "reimport"])
  })

  it.each(LANGS)("%s: the restore caveat names re-import, not just earlier deletes", (lang) => {
    // The dominant multiplier was earlier IMPORTS, not earlier deletions —
    // `runImportBatch` archives the generation it replaces and leaves it.
    const reimport = { en: /import/i, az: /yüklən/i, ru: /загруз/i }[lang]
    expect(block(lang).restore.widerCaveat).toMatch(reimport)
  })

  it.each(LANGS)("%s: 'nothing came back' names a cause that is possible", (lang) => {
    // It used to say the deletion "only removed data that comes back from the
    // file" — but such an event is filtered out of the list and never gets a
    // button. The reachable causes are the purge and a prior restore.
    const cleanup = { en: /clean-up/i, az: /təmizləmə/i, ru: /очистк/i }[lang]
    expect(block(lang).restore.doneNothing).toMatch(cleanup)
  })

  it.each(LANGS)("%s: both retention sentences quote the window, not silence", (lang) => {
    // Silence read as "no expiry" while a nightly job removes the rows.
    // `{days}` is filled from SOFT_DELETE_RETENTION_DAYS, never typed in.
    expect(block(lang).restore.retention).toContain("{days}")
    expect((block(lang).radius as Record<string, unknown>).caveat).toBeTruthy()
    expect(
      ((block(lang).radius as unknown as Record<string, Record<string, string>>)
        .caveat.retention),
    ).toContain("{days}")
  })

  it.each(LANGS)("%s: the blast radius admits the org-wide alert rebuild", (lang) => {
    // `persistAlertEvents` does `alertEvent.deleteMany({ organizationId,
    // period })` — org-wide, for every period of the year — so "what is not
    // listed here will not be touched" was false.
    const alerts = { en: /alert/i, az: /xəbərdarlıq/i, ru: /предупрежден/i }[lang]
    expect(block(lang).radius.truth).toMatch(alerts)
  })

  it.each(LANGS)("%s: 'remove one company' admits hand-entered figures survive", (lang) => {
    // `importOperationalFactWhere` matches import provenance only, so nothing
    // on this page removes a manually entered fact — and they keep feeding
    // the indicators of a company that was just "removed".
    const byHand = { en: /by hand/i, az: /əl ilə/i, ru: /вручную/i }[lang]
    expect(block(lang).removeCompany.keptNote).toMatch(byHand)
  })

  it.each(LANGS)("%s: the compliance-record warning is not over-broad", (lang) => {
    // The AI import writes courtDisputes / auditFindings / riskRegister, so
    // the RECORDS do come back from the file. Only the write-backs do not.
    const reupload = { en: /upload that file again/i, az: /yenidən yükləyəndə/i, ru: /загрузить тот файл заново/i }[lang]
    expect(block(lang).removeCompany.permanentNote).toMatch(reupload)
  })

  it.each(LANGS)("%s: 'delete everything' does not claim only the figures go", (lang) => {
    // Task D sends `includeUnscoped: true`, so it destroys the records tail
    // its own task description warns about two paragraphs earlier.
    const findings = { en: /audit findings/i, az: /audit tapıntı/i, ru: /аудиторские находки/i }[lang]
    expect(block(lang).deleteAll.keptNote).toMatch(findings)
  })
})

describe("the scope line is grammatical for one company and one year", () => {
  // `RemoveCompanyTask` hardcodes `companyCount={1}`, and Task A with one
  // company and one year is the most common delete on the screen. Rendered
  // through the real ICU formatter, because a naive `{x}` replacer is exactly
  // what let "Across 1 companies" ship.
  const CASES: Record<string, { one: string; many: string; allYears: string }> = {
    en: {
      one: "Across 1 company and 1 year.",
      many: "Across 3 companies and 2 years.",
      allYears: "Across 1 company, every year.",
    },
    ru: {
      one: "По 1 компании и 1 году.",
      many: "По 3 компаниям и 2 годам.",
      allYears: "По 1 компании, за все годы.",
    },
    az: {
      one: "1 şirkət və 1 il üzrə.",
      many: "3 şirkət və 2 il üzrə.",
      allYears: "1 şirkət üzrə, bütün illər.",
    },
  }

  it.each(LANGS)("%s", async (lang) => {
    const { default: IntlMessageFormat } = await import("intl-messageformat")
    const radius = block(lang).radius
    const fmt = (msg: string, values: Record<string, number>) =>
      String(new IntlMessageFormat(msg, lang).format(values))
    expect(fmt(radius.scope, { companies: 1, years: 1 })).toBe(CASES[lang].one)
    expect(fmt(radius.scope, { companies: 3, years: 2 })).toBe(CASES[lang].many)
    expect(fmt(radius.scopeAllYears, { companies: 1 })).toBe(CASES[lang].allYears)
  })
})
