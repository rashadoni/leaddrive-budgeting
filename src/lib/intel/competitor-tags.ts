/**
 * Phase 7.J — competitor monitoring tag dictionary.
 *
 * Drives:
 *   1. Crawler's industryTags suggestion list (so the LLM emits
 *      "competitor:baki-sirniyyat" when a Bakı Şirniyyat news item
 *      surfaces — instead of just "food_processing")
 *   2. Sentiment scoring heuristics — competitor wins/losses flip the
 *      score sign for OUR holding ("Bakı Şirniyyat margin compression
 *      announced" is a + signal for AzerSheker, not 0.0 generic)
 *   3. Risk Terminal Competitor panel filter — surfaces items tagged
 *      with any of these strings
 *
 * Add a competitor by adding one row. The crawler prompt template
 * reads from this list at build time.
 */

export interface CompetitorTag {
  /** Tag string emitted in industryTags[] (lowercase, kebab-case). */
  tag: string
  /** Human-readable name. */
  name: string
  /** Industry sector this competitor operates in. */
  sector: string
  /** Free-text rationale shown in admin UI. */
  why: string
}

export const COMPETITOR_TAGS: readonly CompetitorTag[] = [
  // — AzerSheker domestic sugar competitors
  {
    tag: "competitor:baki-sirniyyat",
    name: "Bakı Şirniyyat Group",
    sector: "food_processing",
    why: "Largest Azeri confectionery; competes with AZSF on refined-sugar retail share, +32% of B2B AZSF customer revenue → asymmetric exposure",
  },
  {
    tag: "competitor:sirniyyat-birliyi",
    name: "Şirniyyat Birliyi cooperative",
    sector: "food_processing",
    why: "Regional sugar cooperative; competes on cane procurement + small-batch sugar pricing",
  },
  {
    tag: "competitor:gence-konfet",
    name: "Gəncə Konfet",
    sector: "food_processing",
    why: "Western Azerbaijan competitor; rising distribution share in DCFTA Georgia channel",
  },
  // — CPC starch/glucose competitors
  {
    tag: "competitor:cargill-az",
    name: "Cargill Azerbaijan",
    sector: "food_processing",
    why: "Global starch + glucose importer with growing AZ presence; threatens CPC domestic pricing",
  },
  {
    tag: "competitor:ingredion-tr",
    name: "Ingredion Türkiye",
    sector: "food_processing",
    why: "Turkish corn-starch giant; could enter AZ via DCFTA Türkiye trade channel",
  },
  // — Malt competitors
  {
    tag: "competitor:soufflet-tr",
    name: "Soufflet Group (Türkiye plant)",
    sector: "food_processing",
    why: "Largest regional malt producer; cross-border competes on brewer offtake (especially Carlsberg group)",
  },
  // — Agro / commodity policy themes (not specific firm, but content tag)
  { tag: "azerbaijan-agro", name: "Azerbaijan agro sector", sector: "agro_crops", why: "Catch-all for crop conditions, weather alerts, subsidy programs in AZ" },
  { tag: "sugar-policy", name: "Sugar policy (tariff/quota)", sector: "food_processing", why: "Sugar import tariffs, refined-sugar price controls, EU/BR/IN/TH/TR policy moves" },
  { tag: "ice-11-future", name: "ICE Sugar No. 11 future", sector: "food_processing", why: "Daily ICE #11 closing-price moves ≥3% or with named catalyst" },
]

/** Returns the list of tag strings for inclusion in the crawler prompt. */
export function listCompetitorTags(): readonly string[] {
  return COMPETITOR_TAGS.map((c) => c.tag)
}

/** Look up the human name from a tag (for terminal Competitor panel). */
export function competitorNameByTag(tag: string): string | null {
  return COMPETITOR_TAGS.find((c) => c.tag === tag.toLowerCase())?.name ?? null
}
