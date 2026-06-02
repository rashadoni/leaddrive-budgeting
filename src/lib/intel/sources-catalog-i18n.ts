/**
 * EN (+ future AZ) translations for the Data Sources Catalog card prose.
 *
 * The catalog (`sources-catalog.ts`) stores prose Russian-only (`whatItIsRu`,
 * `businessValueRu`, `sampleLatest.interpretation`, `cadenceRu`) and is read by
 * adapters by `sourceCode`, so we DON'T touch it. Instead this map carries the
 * localized prose keyed by `sourceCode`, and `localizedSource()` picks the right
 * language for the View. RU comes from the catalog; EN from here; AZ falls back
 * to EN until native AZ card prose is authored (see AZ_TRANSLATIONS_REVIEW).
 *
 * Fixes "the English UI showed Russian card text" (2026-06-01).
 */
import type { DataSourceEntry } from "./sources-catalog";

interface SourceProseI18n {
  displayName?: { en: string; az?: string };
  whatItIs: { en: string; az?: string };
  businessValue: { en: string; az?: string };
  interpretation: { en: string; az?: string };
  cadence: { en: string; az?: string };
}

export const SOURCE_PROSE_I18N: Record<string, SourceProseI18n> = {
  "cbar-official-fx": {
    whatItIs: {
      en: "Official daily AZN exchange rates against 6 currencies (USD, EUR, RUB, TRY, GBP, CNY), published by the CBAR at cbar.az.",
    },
    businessValue: {
      en: "Every holding company with imports or exports books revenue and cost of goods in AZN through these rates. A 1% move in AZN/USD means ~$200K of difference per quarter for an import-dependent company.",
    },
    interpretation: {
      en: "AZN/USD runs on a peg. A sharp move >2% is an FX-shock signal for pharma importers.",
    },
    cadence: { en: "daily (business days)" },
  },
  "eia-energy": {
    whatItIs: {
      en: "Benchmark world prices: Brent (crude, ICE), WTI (crude, NYMEX), Henry Hub (natural gas, NYMEX). A U.S. government agency — the most authoritative official price in the world.",
    },
    businessValue: {
      en: "Brent is the base oil price for logistics (diesel), manufacturing (electricity) and food processing (packaging, raw-material transport). Gas drives the cost of heating plants and LNG imports.",
    },
    interpretation: {
      en: "Brent sustained above $80–100 — pressure on the margins of logistics and industrial companies (fuel, packaging, transport).",
    },
    cadence: { en: "monthly (some series weekly)" },
  },
  "fao-food-prices": {
    whatItIs: {
      en: "Monthly index of world food prices, split into 5 categories: meat, dairy, cereals, vegetable oils, sugar. Base 2014-2016=100.",
    },
    businessValue: {
      en: "An index above 130 = a global food crisis, with worldwide procurement prices up ~10-15% YoY. AZSEKER-AZSF / CPC / MALT pay for imported raw materials at these prices.",
    },
    interpretation: {
      en: "Index above 130 (2014-2016 base=100) → 🟡 elevated pressure on food-processing procurement prices.",
    },
    cadence: { en: "monthly (first Friday)" },
  },
  "yahoo-grains": {
    whatItIs: {
      en: "Front-month futures for 5 crops: corn (ZC), wheat (ZW), soybeans (ZS), oats (ZO, a barley proxy), cotton (CT). Converted to USD/tonne.",
    },
    businessValue: {
      en: "Grain is the main raw input for food processing (flour, feed) and poultry farms. Soy/cotton signal demand for livestock feed and consumer demand for textiles.",
    },
    interpretation: {
      en: "Wheat below the $250/t threshold → 🟢 a good window to buy flour 6 months forward.",
    },
    cadence: { en: "monthly (daily also available when needed)" },
  },
  "yahoo-metals": {
    whatItIs: {
      en: "Front-month futures: copper HG (electrical, wiring), aluminum ALI (packaging), steel HRC (construction, metalwork), lumber LBR (construction). Converted to USD/tonne.",
    },
    businessValue: {
      en: "Copper and aluminum are raw inputs for ATL (pipes, polyethylene, metalworking). Steel and lumber drive construction cost and real-estate prices.",
    },
    interpretation: {
      en: "Copper above the $11k/t threshold → 🔴 high raw-material pressure. ATL-DBZ / ATL-PMZ / ZTP buy copper at high prices.",
    },
    cadence: { en: "monthly" },
  },
  "yahoo-fuel-bdi": {
    whatItIs: {
      en: "Diesel (HO, ULSD), gasoline (RB, RBOB), and the BDRY maritime-freight index (tracks the Baltic Dry Index via 3-month rolling Capesize/Panamax/Supramax futures).",
    },
    businessValue: {
      en: "Diesel fuels logistics trucking (LLS); gasoline fuels the passenger fleet. The BDI is the world cost of shipping bulk cargo (grain, metal, coal) by sea; it rises when global trade picks up.",
    },
    interpretation: {
      en: "Diesel above the $0.90/L threshold → 🔴 direct pressure on LLS logistics margins.",
    },
    cadence: { en: "monthly" },
  },
  "openmeteo-forecast": {
    whatItIs: {
      en: "14-day forecast: daily rainfall (mm), average and maximum temperature for 8 Azerbaijani regions (Salyan, Imishli, Sabirabad, Yevlakh, Shamkir, Fizuli, Aghjabadi, Beylagan).",
    },
    businessValue: {
      en: "EDEN/FARM — Azərşəkər farms sow sugar beet and grain in these regions. A rainfall forecast <10mm = threat to the harvest; >30mm = good moisture. It also shifts hospitality demand (tourism in a hot week).",
    },
    interpretation: {
      en: "Salyan rainfall forecast: >30mm over 14 days → 🟢 sufficient moisture for beet; <10mm → harvest threat.",
    },
    cadence: { en: "daily" },
  },
  "az-stat-cpi": {
    whatItIs: {
      en: "Monthly consumer price index (base 2010=100) split into 4 categories: all items, food + beverages + tobacco, non-food, paid services. Downloaded as XLSX from stat.gov.az.",
    },
    businessValue: {
      en: "A direct inflation benchmark for indexing the holding's product prices. Food CPI > 105% YoY = you can raise selling prices ~5% without losing competitiveness. Services drive hiring cost + office-rent pressure.",
    },
    interpretation: {
      en: "Food CPI above 105% YoY → 🟡 retail can lift price tags without risking traffic loss; food processing gets the same headroom.",
    },
    cadence: { en: "monthly (~14th of the following month)" },
  },
  "un-comtrade-az": {
    whatItIs: {
      en: "Annual official statistics of Azerbaijan's merchandise exports/imports. The source for the trade balance, which the UN aggregates from the country's state statistics.",
    },
    businessValue: {
      en: "The trade balance is a macro signal for every import-dependent holding business (food processing, pharma, retail). A sharp drop in the surplus = AZN under pressure = currency risk.",
    },
    interpretation: {
      en: "Comtrade preview data may show a negative balance due to a publication lag (not all oil counted yet). We'll re-read it once the UN catches the data up.",
    },
    cadence: { en: "annual (2-3 quarter lag)" },
  },
  "wb-indicators": {
    whatItIs: {
      en: "Annual AZ macro indicators from the World Bank database: international tourism (arrivals + spending + receipts), education (secondary-school enrollment, government spending, % of population aged 0-14).",
    },
    businessValue: {
      en: "Tourism drives hospitality (Hilton, Marriott, Four Seasons) and entertainment (concerts, F1, Crystal Hall). Education is the addressable market for private universities (ADA, Khazar) + children's retail.",
    },
    interpretation: {
      en: "Tourist arrivals below the pre-COVID ~3.2M/year → 🔴 hospitality still in a recovery zone.",
    },
    cadence: { en: "annual (1-2 year lag)" },
  },
  "usda-nass": {
    whatItIs: {
      en: "Monthly/weekly wholesale prices: broilers ($/lb), eggs ($/doz), chick placements. The U.S. is the global benchmark; local AZ prices lag by 4-6 weeks.",
    },
    businessValue: {
      en: "Broiler $/lb is a leading indicator for AZ poultry (Azersun, Gilan Quba). A U.S. drop below $1/lb predicts a demand-side shock in AZ within 1-2 months. Feed-chicks are the production pipeline.",
    },
    interpretation: {
      en: "Broiler below the $1.00/lb threshold → 🔴 margin-compression risk for poultry farms (AZ with a ~2-month lag).",
    },
    cadence: { en: "monthly + some series weekly" },
  },
  "google-trends-az": {
    whatItIs: {
      en: "Normalized 0-100 search-interest index across 4 categories: food (yemək/grocery), apparel (moda/fashion), electronics (iPhone/electronics), tourism (tour/travel) — geo:AZ.",
    },
    businessValue: {
      en: "Search demand is the earliest leading indicator of consumer behavior. A 30% drop in the food trend in a month = retail sales fall within 2-4 weeks. The travel trend leads hospitality bookings by ~30 days.",
    },
    interpretation: {
      en: "Food search interest below 80 → 🔴 expect weak grocery-store traffic over the next 2-4 weeks.",
    },
    cadence: { en: "weekly" },
  },
};

export interface LocalizedSourceProse {
  displayName: string;
  whatItIs: string;
  businessValue: string;
  interpretation: string;
  cadence: string;
}

/**
 * Resolve a catalog entry's prose for the active UI locale. RU reads the
 * catalog's native fields; EN reads SOURCE_PROSE_I18N; AZ uses AZ when present
 * and falls back to EN (never Russian) so an AZ-locale user never sees the
 * wrong language. Any source missing an EN entry falls back to its RU prose.
 */
export function localizedSource(s: DataSourceEntry, locale: string): LocalizedSourceProse {
  const i = SOURCE_PROSE_I18N[s.sourceCode];
  const lang: "en" | "az" = locale === "az" ? "az" : "en";
  const pick = (ru: string, t?: { en: string; az?: string }): string => {
    if (locale === "ru" || !t) return ru;
    return (lang === "az" ? t.az ?? t.en : t.en) ?? ru;
  };
  const displayName =
    locale === "ru"
      ? s.displayNameRu
      : (lang === "az" ? i?.displayName?.az ?? i?.displayName?.en : i?.displayName?.en) ?? s.displayNameEn;
  return {
    displayName,
    whatItIs: pick(s.whatItIsRu, i?.whatItIs),
    businessValue: pick(s.businessValueRu, i?.businessValue),
    interpretation: pick(s.sampleLatest.interpretation, i?.interpretation),
    cadence: pick(s.cadenceRu, i?.cadence),
  };
}
