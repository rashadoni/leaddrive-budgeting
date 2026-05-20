/**
 * Phase 7.M Tier2 #1 (2026-05-19) — deterministic company-tag inference.
 *
 * Why this exists
 * ───────────────
 * The crawler asks the LLM to populate `companyTags[]` whenever a news
 * item mentions one of our portfolio companies by name. Reality (audit
 * on 2026-05-19 — 8 intel_items rows in DB, all with empty companyTags):
 * the LLM forgets, especially when the company is named in a transliter-
 * ated form (Azərşəkər vs. AzerSheker vs. АзерШекер vs. AzərŞəkər).
 *
 * The downstream cost is real: `CompanyImpactForecastsCard` filters
 * `relatedNews` by `industryTag` overlap — without `companyTags` we
 * cannot promote a news article specifically tagged to AZSEKER ahead
 * of generic agro_crops news.
 *
 * This module is the post-LLM deterministic fall-back: given a news
 * title+summary and a list of known entity name patterns, infer which
 * companyCode tags the article should carry, regardless of whether
 * the LLM remembered to emit them.
 *
 * Design
 * ──────
 *  • Pure function — no I/O. Caller pre-fetches the entity list once
 *    per crawl and passes the patterns array in.
 *  • Case-insensitive Unicode-aware substring match. We deliberately
 *    do NOT use word-boundary `\b` because Cyrillic / Azerbaijani
 *    Latin word boundaries are unreliable in JavaScript regex.
 *  • Returns the entity CODES (not the patterns) so callers can union
 *    into the existing companyTags array without de-dup logic.
 *
 * Multi-language patterns are built from `Company.name`, `nameAz`,
 * `nameRu`, `nameEn` columns — and a few hand-curated aliases (the
 * `competitor-tags.ts` module supplies competitor names; we mirror
 * that pattern for portfolio companies).
 */

export interface EntityPattern {
  /** Company code, e.g. "AZSEKER-AZSF" — the value to emit when matched. */
  code: string
  /** Case-insensitive substrings to scan for. Order doesn't matter;
   *  the first match wins per-text. */
  patterns: ReadonlyArray<string>
}

/**
 * Build a normalised lookup-ready map. Patterns are lowercased ahead
 * of time so the matcher does O(1) per pattern per text. Diacritics
 * are stripped to absorb transliteration variance (e.g. "Azərşəkər"
 * and "Azərshəkər" both normalise to "azersheker"-ish form).
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ə/g, "e")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    // Cyrillic basic letters that map cleanly to single Latin chars.
    // Lets "Азерсахар"-style mentions match Latin "Azersahar" patterns.
    .replace(/а/g, "a")
    .replace(/б/g, "b")
    .replace(/в/g, "v")
    .replace(/г/g, "g")
    .replace(/д/g, "d")
    .replace(/е/g, "e")
    .replace(/ё/g, "e")
    .replace(/з/g, "z")
    .replace(/и/g, "i")
    .replace(/й/g, "i")
    .replace(/к/g, "k")
    .replace(/л/g, "l")
    .replace(/м/g, "m")
    .replace(/н/g, "n")
    .replace(/о/g, "o")
    .replace(/п/g, "p")
    .replace(/р/g, "r")
    .replace(/с/g, "s")
    .replace(/т/g, "t")
    .replace(/у/g, "u")
    .replace(/ф/g, "f")
    .replace(/х/g, "h")
    .replace(/ц/g, "ts")
    .replace(/ы/g, "i")
    .replace(/э/g, "e")
    .replace(/ю/g, "iu")
    .replace(/я/g, "ia")
    // Multi-char Cyrillic that have multi-char Latin counterparts.
    .replace(/ж/g, "zh")
    .replace(/ч/g, "ch")
    .replace(/ш/g, "sh")
    .replace(/щ/g, "sh")
    // Transliteration variance: Latin "sh" / Azerbaijani "ş→s" /
    // Cyrillic "ш→sh" — collapse all to "s" so a pattern in any one
    // alphabet matches a mention in any other.
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/zh/g, "z")
    .replace(/kh/g, "h")
    // Strip soft/hard signs which carry no phonetic weight.
    .replace(/[ьъ]/g, "")
}

/**
 * Scan the given text for any pattern from the entity list. Returns
 * the matched entity codes in stable order (entity list order).
 *
 * Empty input or empty entity list → empty array.
 */
export function inferCompanyTags(
  text: string,
  entities: ReadonlyArray<EntityPattern>,
): string[] {
  if (!text || entities.length === 0) return []
  const normText = normalize(text)
  const out: string[] = []
  const seen = new Set<string>()
  for (const ent of entities) {
    if (seen.has(ent.code)) continue
    for (const pat of ent.patterns) {
      const normPat = normalize(pat)
      if (normPat.length < 2) continue // skip too-short patterns
      if (normText.includes(normPat)) {
        out.push(ent.code)
        seen.add(ent.code)
        break
      }
    }
  }
  return out
}

/**
 * Build the EntityPattern list from raw Company rows. Pulls in the
 * code itself (acronyms like "AAC", "SPARK"), plus any non-empty
 * `name` / `nameAz` / `nameRu` / `nameEn` field — these are the
 * Latin / Cyrillic / Azerbaijani Latin variants the user maintains.
 *
 * Patterns shorter than 2 chars are filtered (a single-letter code
 * like "X" would false-match thousands of articles).
 */
export function buildEntityPatternsFromCompanies(
  companies: ReadonlyArray<{
    code: string
    name: string | null
    nameAz: string | null
    nameRu: string | null
    nameEn: string | null
  }>,
): EntityPattern[] {
  return companies.map((c) => {
    const patterns: string[] = []
    // Always include the bare code for short acronyms (AAC / SPARK / ZTP).
    if (c.code.length >= 3) patterns.push(c.code)
    if (c.name) patterns.push(c.name)
    if (c.nameAz) patterns.push(c.nameAz)
    if (c.nameRu) patterns.push(c.nameRu)
    if (c.nameEn) patterns.push(c.nameEn)
    // Dedup by raw string.
    const unique = Array.from(new Set(patterns.filter((p) => p.length >= 2)))
    return { code: c.code, patterns: unique }
  })
}

/**
 * Merge LLM-provided + inferred tags. De-dupes case-insensitively.
 */
export function mergeCompanyTags(
  fromLlm: ReadonlyArray<string>,
  inferred: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of [...fromLlm, ...inferred]) {
    const t = tag.trim()
    if (!t) continue
    const key = t.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}
