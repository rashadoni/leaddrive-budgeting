/**
 * 2026-08-18 (second pass) — the cause must reach EVERY import screen.
 *
 * The first pass fixed the multi-file screen only. The other three forms
 * (`AIImportForm`, `MultiSheetImportForm`, `UniversalImportForm`) did
 * `throw new Error(body?.error ?? …)`, and `body.error` is the fixed literal
 * `"ai_unavailable"` that `aiErrorBody` returns for back-compat. So the server
 * classified the failure, shipped `code` over the wire, and the form dropped
 * it — the single-file screen showed the bare word «ai_unavailable», which
 * names neither the cause nor the remedy.
 *
 * These pin the two halves of that fix: the mapping helper, and the fact that
 * no AI call site silently discards `code` again.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import en from "../../../../../../messages/en.json"
import ru from "../../../../../../messages/ru.json"
import az from "../../../../../../messages/az.json"
import {
  AI_ERROR_CODES,
  aiOutageFromBody,
  isAiOutageCode,
  localizeAiOutage,
  type ImportTranslator,
} from "./import-message-i18n"

const HERE = join(process.cwd(), "src/app/(dashboard)/budgeting/admin/ai-import")

/** Resolves against the real catalogue so wording drift shows up here. */
function translator(catalogue: Record<string, unknown>): ImportTranslator {
  const shared = (
    (catalogue.adminAiImport as Record<string, unknown>).shared as Record<string, unknown>
  )
  return (key, values) => {
    let node: unknown = shared
    for (const part of key.split(".")) {
      node = (node as Record<string, unknown>)?.[part]
    }
    if (typeof node !== "string") throw new Error(`missing catalogue key: ${key}`)
    return node.replace(/\{(\w+)\}/g, (m, k) =>
      values && k in values ? String(values[k]) : m,
    )
  }
}

describe("the outage sentence reaches every import screen", () => {
  it("turns the wire code into a sentence that names cause and remedy", () => {
    const msg = localizeAiOutage(translator(ru), "ai_credits", "classify")
    expect(msg).toMatch(/средства/i)
    expect(msg).toMatch(/Anthropic/)
    // The whole point: the file is exonerated.
    expect(msg).toMatch(/с файлом всё в порядке/i)
  })

  it("names the step that failed, so «the file is fine» stays specific", () => {
    const classify = localizeAiOutage(translator(ru), "ai_credits", "classify")
    const analyze = localizeAiOutage(translator(ru), "ai_credits", "analyze")
    expect(classify).toContain("определения типа файла")
    expect(analyze).toContain("сопоставления столбцов")
    expect(classify).not.toEqual(analyze)
    // A leftover `{step}` would ship an ICU placeholder to the reader.
    expect(classify).not.toContain("{step}")
    expect(analyze).not.toContain("{step}")
  })

  it("reads the code out of a real error body", () => {
    const body = { ok: false, error: "ai_unavailable", code: "ai_credits" }
    expect(aiOutageFromBody(translator(en), body, "classify")).toMatch(/out of credit/i)
  })

  it("returns null for a failure that is NOT a provider outage", () => {
    // A validation error must keep its own precise message. Relabelling it as
    // an outage would tell the reader to top up a balance that is fine.
    expect(aiOutageFromBody(translator(en), { ok: false, error: "Invalid import year selection" }, "classify")).toBeNull()
    expect(aiOutageFromBody(translator(en), null, "classify")).toBeNull()
    expect(aiOutageFromBody(translator(en), "not an object", "classify")).toBeNull()
    expect(aiOutageFromBody(translator(en), { code: "something_else" }, "classify")).toBeNull()
  })

  it("accepts exactly the codes the server can emit", () => {
    // Drift here means a server code renders as a missing-key crash.
    expect([...AI_ERROR_CODES].sort()).toEqual(
      ["ai_bad_response", "ai_credits", "ai_rate_limit", "ai_unavailable"].sort(),
    )
    expect(isAiOutageCode("ai_credits")).toBe(true)
    expect(isAiOutageCode("ai_credits ")).toBe(false)
  })

  it("carries all four codes and both steps in all three languages", () => {
    for (const [lang, catalogue] of [["en", en], ["ru", ru], ["az", az]] as const) {
      const t = translator(catalogue as unknown as Record<string, unknown>)
      for (const code of AI_ERROR_CODES) {
        for (const step of ["classify", "analyze"] as const) {
          const msg = localizeAiOutage(t, code, step)
          expect(msg.length, `${lang}/${code}/${step}`).toBeGreaterThan(20)
          expect(msg, `${lang}/${code}/${step}`).not.toContain("{step}")
        }
      }
    }
  })

  it("keeps ONE copy of the wording — the multi-file screen reads the shared one", () => {
    // The strings lived under `multi.result.aiOutage` and were moved to
    // `shared.msg.aiOutage` when three more screens needed them. A second copy
    // would drift: the same outage would read differently per tab.
    for (const catalogue of [en, ru, az]) {
      const multi = (
        ((catalogue.adminAiImport as Record<string, unknown>).multi as Record<string, unknown>)
          .result as Record<string, unknown>
      )
      expect(multi.aiOutage).toBeUndefined()
    }
  })
})

describe("no import form silently drops the cause again", () => {
  /** Routes whose failure carries an `aiErrorBody` code. */
  const AI_ROUTES = [
    "/api/import/ai-auto",
    "/api/onboarding/import/analyze",
    "/api/onboarding/import/analyze-multi",
  ]

  const forms = readdirSync(HERE).filter(
    (f) => f.endsWith("Form.tsx") && !f.includes(".test."),
  )

  it("covers the forms this rule is about", () => {
    // A form renamed or added must not quietly fall out of the scan below.
    expect(forms.sort()).toEqual([
      "AIImportForm.tsx",
      "MultiFileForm.tsx",
      "MultiSheetImportForm.tsx",
      "UniversalImportForm.tsx",
    ])
  })

  /**
   * The window after a fetch, where the response is checked. Scoped rather
   * than file-wide on purpose: these forms also call plain CRUD endpoints
   * (`/api/companies`, staging apply) whose failures are NOT provider outages
   * and must keep `body.error` verbatim. A file-wide ban would fail on those
   * and push the next author to weaken the rule instead of honouring it.
   */
  function windowAfter(src: string, marker: string): string {
    const at = src.indexOf(marker)
    if (at < 0) return ""
    return src.slice(at, at + 700)
  }

  for (const form of forms) {
    it(`${form}: every AI fetch branches on the outage code`, () => {
      const src = readFileSync(join(HERE, form), "utf8")
      const aiCalls = AI_ROUTES.map((r) => `fetch("${r}"`).filter((m) => src.includes(m))

      if (aiCalls.length === 0) {
        // MultiFileForm reaches its route through a helper; it renders the
        // banner from the orchestrator's `aiOutage` field instead.
        expect(src).toContain("localizeAiOutage")
        return
      }

      for (const marker of aiCalls) {
        const scope = windowAfter(src, marker)
        expect(scope, `${form} · ${marker}`).toContain("aiOutageFromBody")
        // The exact shape of the original defect: taking `body.error` — always
        // the literal "ai_unavailable" — while `body.code` goes unread.
        expect(scope, `${form} · ${marker}`).not.toMatch(
          /throw new Error\(body\?\.error \?\? `HTTP \$\{res\.status\}`\)/,
        )
      }
    })
  }
})
