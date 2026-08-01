/**
 * A translation that quietly drops a placeholder renders a sentence with a
 * hole in it. The key-parity guard cannot see that — the key is there, the
 * value is prose, and prose is exactly what it stops inspecting.
 *
 * On a delete screen the holes are numbers: "{rows} rows will be deleted"
 * losing its `{rows}` is a confirmation dialog that no longer says how much.
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
 * Argument NAMES only — `{count}` and `{count, plural, …}` both yield `count`,
 * so a locale that renders a plural as a plain interpolation still counts as
 * carrying the argument. Plural category bodies (`one {# account}`) start with
 * `#`, so they never match.
 */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1]).sort()
}

describe("ICU placeholder parity", () => {
  it("keeps every placeholder in az and ru that en declares", () => {
    const broken: string[] = []
    for (const [key, value] of Object.entries(EN)) {
      const want = placeholders(value)
      if (want.length === 0) continue
      for (const [lang, cat] of [
        ["az", AZ],
        ["ru", RU],
      ] as const) {
        const got = placeholders(cat[key] ?? "")
        const missing = want.filter((p) => !got.includes(p))
        if (missing.length > 0) {
          broken.push(`${lang}  ${key} — missing ${missing.map((p) => `{${p}}`).join(", ")}`)
        }
      }
    }
    expect(
      broken,
      `A translation dropped a placeholder, so the number never reaches the screen:\n${broken.join("\n")}`,
    ).toEqual([])
  })

  it("does not invent placeholders the code never passes", () => {
    // An extra `{total}` renders as the literal text "{total}".
    const invented: string[] = []
    for (const [key, value] of Object.entries(EN)) {
      const allowed = new Set(placeholders(value))
      for (const [lang, cat] of [
        ["az", AZ],
        ["ru", RU],
      ] as const) {
        for (const p of placeholders(cat[key] ?? "")) {
          if (!allowed.has(p)) invented.push(`${lang}  ${key} — unexpected {${p}}`)
        }
      }
    }
    expect(invented).toEqual([])
  })
})
