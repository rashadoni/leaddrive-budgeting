/**
 * Phase 11.33 (2026-07-29) — resolve a company from free text on the
 * cross-entity SOFT registers, without hardcoding one client's entities.
 *
 * The defect this closes
 * ──────────────────────
 * `audit-findings-parse.ts` and `court-disputes-parse.ts` each carried a
 * literal list of AzerSheker's five companies:
 *
 *   if (n.includes("cpc")) return "AZSEKER-CPC"
 *   { pattern: /eden\s*agro/i, code: "AZSEKER-EDEN" }   … etc.
 *
 * These registers are CROSS-ENTITY: one sheet lists findings or court cases
 * for every company in the group, and the company is named in a cell rather
 * than by the sheet's classification. So for any other organization every
 * single row matches nothing. In the audit parser the unmatched names are at
 * least collected; in the court parser the row was dropped by a bare
 * `continue` with no warning at all — a whole litigation register importing
 * as zero cases under a green report.
 *
 * What this does instead
 * ──────────────────────
 * Builds the matcher from the org's OWN companies — their code, the trailing
 * segment of the code (`AZSEKER-EDEN` → `EDEN`), and the words of their
 * registered name. The AzerSheker patterns are kept as a supplement, but only
 * for codes the org actually has, so this client's imports resolve exactly as
 * before while a second client resolves against its own register.
 *
 * Matching is deliberately conservative — a legal-form suffix (MMC, LLC, ASC,
 * QSC…) is not a signal, and a token must appear on a word boundary, so
 * "CPC" does not match inside "CONCEPCION". A name that resolves to two
 * different companies is reported as AMBIGUOUS rather than attributed to
 * whichever pattern happened to be listed first.
 */

/** Minimal company shape the matcher needs. */
export interface MatchableCompany {
  code: string
  name?: string | null
}

export interface CompanyMatch {
  /** Canonical company codes the text resolved to. Empty = no match. */
  codes: string[]
  /** Set when the text matched more than one company on equally strong evidence. */
  ambiguous: boolean
}

/**
 * Legal-form and generic corporate tokens that carry no identity. Matching on
 * these would attribute every row in the register to whichever company was
 * listed first.
 */
const NOISE_TOKENS = new Set([
  "MMC",
  "ASC",
  "QSC",
  "LLC",
  "LTD",
  "LIMITED",
  "INC",
  "PLC",
  "JSC",
  "OOO",
  "AO",
  "ZAO",
  "GMBH",
  "SA",
  "SRL",
  "BV",
  "NV",
  "AS",
  "OJSC",
  "CJSC",
  "COMPANY",
  "GROUP",
  "HOLDING",
  "ŞİRKƏT",
  "CƏMİYYƏT",
  "MƏHDUD",
  "MƏSULİYYƏTLİ",
  "AÇIQ",
  "QAPALI",
  "SƏHMDAR",
])

/**
 * The historical AzerSheker patterns. Applied ONLY for codes present in the
 * org, so they cannot attribute another tenant's rows. They stay because they
 * encode spellings the generic name match cannot derive — the Azerbaijani
 * "Azərşəkər" against a latinised "AzerSheker" record, and "Pro Malt" written
 * open where the code is PROMALT.
 */
const LEGACY_AZSEKER: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /cpc/i, code: "AZSEKER-CPC" },
  { pattern: /eden\s*agro/i, code: "AZSEKER-EDEN" },
  { pattern: /promalt|pro\s*malt/i, code: "AZSEKER-PROMALT" },
  { pattern: /\bmalt\b/i, code: "AZSEKER-MALT" },
  { pattern: /az[əe]r[şs][əe]k[əe]r|azersheker/i, code: "AZSEKER-AZSF" },
]

/** Upper-case, strip punctuation to spaces, collapse runs. */
function normalize(text: string): string {
  return text.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
}

/** True when `token` appears as a whole word in the normalized `haystack`. */
function hasToken(haystack: string, token: string): boolean {
  if (!token) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^| )${escaped}( |$)`, "u").test(haystack)
}

/**
 * Identity tokens for one company: its code, the code's trailing segment, and
 * the non-noise words of its name. Tokens shorter than 3 characters are
 * dropped — a 2-letter token matches far too much free text to be evidence.
 */
export function companyTokens(company: MatchableCompany): string[] {
  const tokens = new Set<string>()
  const code = normalize(company.code)
  if (code.length >= 3) tokens.add(code)

  const rawCode = company.code.toUpperCase()
  if (rawCode.includes("-")) {
    const tail = normalize(rawCode.slice(rawCode.lastIndexOf("-") + 1))
    if (tail.length >= 3) tokens.add(tail)
  }

  for (const word of normalize(company.name ?? "").split(" ")) {
    if (word.length >= 3 && !NOISE_TOKENS.has(word)) tokens.add(word)
  }
  return [...tokens]
}

export type CompanyMatcher = (text: string) => CompanyMatch

/**
 * Build a text → company-code matcher for one organization.
 *
 * `companies` should be every non-archived company in the org. When it is
 * empty the matcher falls back to the legacy AzerSheker patterns alone, which
 * preserves the behaviour of callers that have no org context to pass (the
 * pure-parser unit tests, and any code path that parses before resolving the
 * org).
 */
export function buildCompanyMatcher(companies: ReadonlyArray<MatchableCompany>): CompanyMatcher {
  const known = new Set(companies.map((c) => c.code))
  const all = companies.map((c) => ({ code: c.code, tokens: companyTokens(c) }))

  // A token shared by two companies of the same org carries no identity
  // inside it — a group called "Atlas Logistics" and "Atlas Retail" makes
  // "ATLAS" exactly as useless as "MMC". Matching on it would mark every row
  // ambiguous and drop the whole register. Shared tokens are removed; each
  // company keeps only what distinguishes it.
  const owners = new Map<string, Set<string>>()
  for (const { code, tokens } of all) {
    for (const t of tokens) {
      const set = owners.get(t) ?? new Set<string>()
      set.add(code)
      owners.set(t, set)
    }
  }
  const entries = all.map(({ code, tokens }) => ({
    code,
    tokens: tokens.filter((t) => (owners.get(t)?.size ?? 0) === 1),
  }))
  const legacy = companies.length === 0
    ? LEGACY_AZSEKER
    : LEGACY_AZSEKER.filter((m) => known.has(m.code))

  return (text: string): CompanyMatch => {
    const raw = text ?? ""
    if (!raw.trim()) return { codes: [], ambiguous: false }
    const haystack = normalize(raw)

    const hits = new Set<string>()
    for (const { code, tokens } of entries) {
      if (tokens.some((t) => hasToken(haystack, t))) hits.add(code)
    }
    // Legacy patterns run against the RAW text: they encode diacritics and
    // spacing that normalization would flatten.
    for (const { pattern, code } of legacy) {
      if (pattern.test(raw)) hits.add(code)
    }

    const codes = [...hits]
    return { codes, ambiguous: codes.length > 1 }
  }
}
