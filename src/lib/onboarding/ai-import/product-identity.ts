/**
 * Product identity for the sales import (2026-07-15).
 *
 * Budget sheets name products in ENGLISH ("Sales volume of Wheat", "Glucose"),
 * the transactional actuals name the SAME products in AZERBAIJANI ("Buğda",
 * "Qlükoza"). To compare budget vs actual per product they must resolve to ONE
 * ProductLine code — that mapping is the highest correctness risk in this slice,
 * so it is an EXPLICIT, reviewed dictionary here rather than fuzzy matching.
 * A label that isn't in the dictionary keeps its own slug (never silently
 * merged into a neighbour) and is reported for review.
 *
 * `ProductLine` is org-scoped with `@@unique([organizationId, code])` and
 * `SalesBudgetLine` carries no company dimension, so codes are ENTITY-
 * NAMESPACED (`<ENTITY>__<SLUG>`): two entities selling a product with the
 * same name can't overwrite each other. Deliberate v1 debt — a real company
 * dimension on ProductLine is the follow-up if cross-entity drill-down is
 * ever needed.
 *
 * Pure: no DB, no LLM.
 */

/** Section-label prefixes/suffixes a budget grid wraps around the product name. */
const LABEL_AFFIXES: RegExp[] = [
  /^sales\s+volume\s+of\s+/i,
  /^revenue\s+from\s+sales?\s+of\s+/i,
  /^price\s+of\s+/i,
  /^cogs\s+of\s+/i,
  /\s+costs?$/i,
]

/**
 * Approved AZ ↔ EN product dictionary (confirmed by the client 2026-07-15).
 * Key: normalized (lowercased, trimmed) label in EITHER language.
 * Value: canonical slug shared by budget + actual.
 *
 * Only 1:1 product identities live here. Ambiguous or aggregate labels
 * ("Digər məhsullar", "Xidmətlər") map to their own slug — they're real
 * sales lines, just not cross-language pairs.
 */
const CANONICAL_BY_LABEL: Record<string, string> = {
  // ── Farming (EDEN) — budget EN ↔ actual AZ ──
  wheat: "WHEAT",
  buğda: "WHEAT",
  bugda: "WHEAT",
  barley: "BARLEY",
  arpa: "BARLEY",
  cotton: "COTTON",
  pambıq: "COTTON",
  pambiq: "COTTON",
  "sugar beet": "SUGAR_BEET",
  "şəkər çuğunduru": "SUGAR_BEET",
  "seker cugunduru": "SUGAR_BEET",
  almond: "ALMOND",
  badam: "ALMOND",
  corn: "CORN",
  qarğıdalı: "CORN",
  qargidali: "CORN",
  mustard: "MUSTARD",
  xardal: "MUSTARD",

  // ── Processing (CPC) — budget "For PL" EN ↔ actual "Məhsul qrupu" AZ ──
  glucose: "GLUCOSE",
  qlükoza: "GLUCOSE",
  qlukoza: "GLUCOSE",
  fructose: "FRUCTOSE",
  fruktoza: "FRUCTOSE",
  "corn starch": "CORN_STARCH",
  nişasta: "CORN_STARCH",
  nisasta: "CORN_STARCH",
  "maltose syrup": "MALTOSE_SYRUP",
  "maltoza siropu": "MALTOSE_SYRUP",
  "corn oil": "CORN_OIL",
  "qarğıdalı yağı": "CORN_OIL",
  gluten: "GLUTEN",
  qlüten: "GLUTEN",
  qluten: "GLUTEN",
}

/**
 * Location/qualifier suffixes carried in a budget "For PL" value
 * (e.g. "Corn starch (Export)"). Stripped for identity, kept as a
 * separate dimension on the code so export sales stay distinguishable.
 */
const LOCATION_RE = /\s*\((export|ixrac)\)\s*$/i

/** Uppercase ASCII slug; keeps AZ letters transliterated so codes stay portable. */
export function slugifyProductLabel(label: string): string {
  const translit: Record<string, string> = {
    ə: "e", ı: "i", ö: "o", ü: "u", ç: "c", ş: "s", ğ: "g",
    Ə: "E", I: "I", Ö: "O", Ü: "U", Ç: "C", Ş: "S", Ğ: "G",
  }
  return label
    .split("")
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export interface ProductIdentity {
  /** Canonical slug shared across languages (e.g. WHEAT). */
  slug: string
  /** Entity-namespaced ProductLine.code (e.g. AZSEKER_EDEN__WHEAT). */
  code: string
  /** Human label to store on ProductLine.name (source label, affixes stripped). */
  name: string
  /** True when the label resolved through the approved dictionary. */
  known: boolean
  /** "EXPORT" etc. when the source label carried a location qualifier. */
  location?: string
}

/**
 * Resolve a raw sheet label (either language, with or without a budget-grid
 * affix) to a stable product identity for `entityCode`.
 *
 * Unknown labels are NOT dropped and NOT fuzzy-merged: they get their own
 * transliterated slug and `known:false` so the caller can surface them.
 */
export function resolveProductIdentity(
  rawLabel: string,
  entityCode: string,
): ProductIdentity {
  let label = rawLabel.trim()
  for (const re of LABEL_AFFIXES) label = label.replace(re, "")
  label = label.trim()

  let location: string | undefined
  const locMatch = label.match(LOCATION_RE)
  if (locMatch) {
    location = "EXPORT"
    label = label.replace(LOCATION_RE, "").trim()
  }

  const key = label.toLowerCase().replace(/\s+/g, " ")
  const canonical = CANONICAL_BY_LABEL[key]
  const slugBase = canonical ?? slugifyProductLabel(label)
  const slug = location ? `${slugBase}__${location}` : slugBase
  const entityPrefix = slugifyProductLabel(entityCode)
  return {
    slug,
    code: `${entityPrefix}__${slug}`,
    name: label,
    known: canonical !== undefined,
    ...(location ? { location } : {}),
  }
}

/** True when a row label is a section banner (not a product), e.g. "Satış plan, Ton". */
export function isSectionBannerLabel(label: string): boolean {
  return /^(satış plan|satis plan|sales plan)\s*,/i.test(label.trim())
}
