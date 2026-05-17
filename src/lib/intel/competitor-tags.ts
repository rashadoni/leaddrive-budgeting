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
  // ──────────────────────────────────────────────────────────────────
  // FOOD PROCESSING (AzerSheker / CPC / Malt) — Phase 7.J originals
  // ──────────────────────────────────────────────────────────────────
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
  {
    tag: "competitor:soufflet-tr",
    name: "Soufflet Group (Türkiye plant)",
    sector: "food_processing",
    why: "Largest regional malt producer; cross-border competes on brewer offtake (especially Carlsberg group)",
  },

  // ──────────────────────────────────────────────────────────────────
  // HOSPITALITY — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:hilton-az",
    name: "Hilton Baku",
    sector: "hospitality",
    why: "Marquee 5★ at Bayil; sets ADR ceiling for the Baku 5★ segment; renovation cycles drop ADR ~10% temporarily",
  },
  {
    tag: "competitor:fairmont-baku",
    name: "Fairmont Baku at Flame Towers",
    sector: "hospitality",
    why: "Premium Flame Towers location; commands 20-30% premium; affects upper-upscale segment positioning",
  },
  {
    tag: "competitor:marriott-az",
    name: "JW Marriott Absheron",
    sector: "hospitality",
    why: "Largest 5★ inventory (244 rooms); RevPAR benchmark; group/MICE pricing aggressive",
  },
  {
    tag: "competitor:four-seasons-baku",
    name: "Four Seasons Hotel Baku",
    sector: "hospitality",
    why: "Top-tier luxury; sets price floor for ultra-premium leisure",
  },

  // ──────────────────────────────────────────────────────────────────
  // PHARMA — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:nobel-ilac",
    name: "Nobel İlaç (Türkiye)",
    sector: "pharma",
    why: "Top Türkiye generic; major AZ distributor with broad therapeutic coverage",
  },
  {
    tag: "competitor:abdi-ibrahim",
    name: "Abdi İbrahim (Türkiye)",
    sector: "pharma",
    why: "Largest Türkiye pharma; aggressive AZ tender bids in govt procurement",
  },
  {
    tag: "competitor:sanofi-az",
    name: "Sanofi Azerbaijan",
    sector: "pharma",
    why: "Multinational with branded portfolio; sets price ceiling for chronic-care segment",
  },
  {
    tag: "competitor:gedeon-richter-az",
    name: "Gedeon Richter Azerbaijan",
    sector: "pharma",
    why: "Hungarian generic giant; specialty gynecology + neurology coverage",
  },

  // ──────────────────────────────────────────────────────────────────
  // RETAIL — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:bravo",
    name: "Bravo Supermarkets",
    sector: "retail",
    why: "Largest AZ supermarket chain; sets food-CPI pricing benchmark; private-label expansion 2024+",
  },
  {
    tag: "competitor:bizim",
    name: "Bizim Market",
    sector: "retail",
    why: "Value-segment competitor; aggressive promo pricing on staples",
  },
  {
    tag: "competitor:bolmart",
    name: "Bolmart",
    sector: "retail",
    why: "Mid-tier; growing fast in Baku peri-urban; affects store-traffic share",
  },
  {
    tag: "competitor:araz",
    name: "Araz Supermarkets",
    sector: "retail",
    why: "Regional-focused chain; strong in Ganja, Sumqayit, regional cities",
  },

  // ──────────────────────────────────────────────────────────────────
  // CONSTRUCTION — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:akkord",
    name: "Akkord Industry Construction Investment Corp",
    sector: "construction",
    why: "Largest AZ contractor on state infrastructure; sets bid pricing benchmark",
  },
  {
    tag: "competitor:mscm",
    name: "MSCM (Mətanət A)",
    sector: "construction",
    why: "Domestic cement + concrete leader; price-setter for materials supply",
  },
  {
    tag: "competitor:azkons",
    name: "Azkons",
    sector: "construction",
    why: "Mid-market commercial real-estate developer; volume competitor",
  },

  // ──────────────────────────────────────────────────────────────────
  // POULTRY — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:azersun-poultry",
    name: "Azersun Holding (poultry)",
    sector: "poultry",
    why: "Largest AZ vertically-integrated poultry producer; sets wholesale broiler price floor",
  },
  {
    tag: "competitor:gilan-quba",
    name: "Gilan Quba poultry",
    sector: "poultry",
    why: "Regional broiler farm; secondary supplier in NE Azerbaijan",
  },

  // ──────────────────────────────────────────────────────────────────
  // BEVERAGE — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:coca-cola-az",
    name: "Coca-Cola Azerbaijan",
    sector: "beverage",
    why: "Carbonated-drinks leader; sugar / corn-syrup demand pull through AZSF",
  },
  {
    tag: "competitor:efes-az",
    name: "Efes Pilsen Azerbaijan",
    sector: "beverage",
    why: "Top AZ brewer; principal malt offtake — Malt sub of AzerSheker is key supplier",
  },
  {
    tag: "competitor:caspian-mineral",
    name: "Caspian Mineral Water",
    sector: "beverage",
    why: "Bottled-water leader; non-sugar but signals beverage-channel demand",
  },

  // ──────────────────────────────────────────────────────────────────
  // LOGISTICS — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:azpost",
    name: "Azərpoçt",
    sector: "logistics",
    why: "State postal/parcel; sets last-mile delivery price floor",
  },
  {
    tag: "competitor:dhl-az",
    name: "DHL Azerbaijan",
    sector: "logistics",
    why: "Premium-segment courier; international gateway benchmark",
  },

  // ──────────────────────────────────────────────────────────────────
  // REAL ESTATE — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:pasha-property",
    name: "PASHA Property",
    sector: "real_estate",
    why: "Largest AZ real-estate developer; sets office cap-rate benchmark in Baku CBD",
  },
  {
    tag: "competitor:azerbaijan-baku-realty",
    name: "Baku Realty / Baku White City",
    sector: "real_estate",
    why: "Master-planned development; affects residential pricing in eastern Baku",
  },

  // ──────────────────────────────────────────────────────────────────
  // EDUCATION — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:ada-university",
    name: "ADA University",
    sector: "education",
    why: "Premium private university; sets tuition ceiling for AZ private higher-ed",
  },
  {
    tag: "competitor:khazar-university",
    name: "Khazar University",
    sector: "education",
    why: "Top-tier AZ private university; bilingual programs",
  },

  // ──────────────────────────────────────────────────────────────────
  // ENTERTAINMENT — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:baku-crystal-hall",
    name: "Baku Crystal Hall",
    sector: "entertainment",
    why: "Largest indoor venue; sets concert / event capacity benchmark",
  },
  {
    tag: "competitor:f1-baku",
    name: "Baku City Circuit (Formula 1)",
    sector: "entertainment",
    why: "Annual F1 weekend; major hospitality + entertainment demand pull",
  },

  // ──────────────────────────────────────────────────────────────────
  // SERVICES — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:az-trans",
    name: "AzeriTrans / Karwan Group",
    sector: "services",
    why: "Domestic B2B services aggregator; sets pricing benchmark for cross-border services trade",
  },

  // ──────────────────────────────────────────────────────────────────
  // INDUSTRIAL — Phase 7.K
  // ──────────────────────────────────────────────────────────────────
  {
    tag: "competitor:socar-petkim",
    name: "SOCAR Petkim",
    sector: "industrial",
    why: "Largest AZ petrochemicals group; benchmarks energy + chemical input pricing",
  },
  {
    tag: "competitor:baku-steel",
    name: "Baku Steel Company",
    sector: "industrial",
    why: "Largest domestic steel producer; sets steel input pricing for construction + manufacturing",
  },

  // ──────────────────────────────────────────────────────────────────
  // SECTOR-LEVEL THEME TAGS (not firm-specific)
  // ──────────────────────────────────────────────────────────────────
  { tag: "azerbaijan-agro", name: "Azerbaijan agro sector", sector: "agro_crops", why: "Catch-all for crop conditions, weather alerts, subsidy programs in AZ" },
  { tag: "sugar-policy", name: "Sugar policy (tariff/quota)", sector: "food_processing", why: "Sugar import tariffs, refined-sugar price controls, EU/BR/IN/TH/TR policy moves" },
  { tag: "ice-11-future", name: "ICE Sugar No. 11 future", sector: "food_processing", why: "Daily ICE #11 closing-price moves ≥3% or with named catalyst" },
  { tag: "az-tourism", name: "AZ tourism / arrivals", sector: "hospitality", why: "Arrivals data, conference bookings, F1 weekend, holiday/visa policy" },
  { tag: "drug-approval-az", name: "Drug approval / Pharmacheck", sector: "pharma", why: "Drug approvals from MoH AZ, EMA/FDA actions affecting AZ supply, recall events" },
  { tag: "food-cpi-az", name: "AZ food CPI / inflation", sector: "retail", why: "stat.gov.az food CPI breakdown moves; staples pricing pressure" },
  { tag: "construction-permit-az", name: "AZ construction permits / projects", sector: "construction", why: "New permit issuance, state-financed project tenders, materials shortage alerts" },
  { tag: "logistics-az", name: "AZ logistics / fuel / route", sector: "logistics", why: "Fuel price changes, customs delays, BTC pipeline, Caspian shipping rates" },
  { tag: "education-policy-az", name: "AZ education policy", sector: "education", why: "Ministry of Education tuition caps, accreditation actions, student loan policy" },
]

/** Returns the list of tag strings for inclusion in the crawler prompt. */
export function listCompetitorTags(): readonly string[] {
  return COMPETITOR_TAGS.map((c) => c.tag)
}

/** Look up the human name from a tag (for terminal Competitor panel). */
export function competitorNameByTag(tag: string): string | null {
  return COMPETITOR_TAGS.find((c) => c.tag === tag.toLowerCase())?.name ?? null
}
