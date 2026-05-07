/**
 * Phase 7.G Turn LVIII — canonical Industry data (single source of truth).
 *
 * Closes 80-turn-stale architect Turn-G Round-1 💡 (`industries.*` JSON
 * namespace duplicating data already in the `Industry` Prisma table).
 * Pre-LVIII state:
 *   - `scripts/seed-industries.ts` carried the canonical `INDUSTRIES[]`
 *     array → wrote rows to the `Industry` table.
 *   - `messages/{en,ru,az}.json:industries.*` had a SEPARATE slice with
 *     drift: EN held codes ("hospitality" → "hospitality"), RU held
 *     short forms ("Гостиничный бизнес" → "гостеприимство"), AZ
 *     held lowercase forms ("Qonaqpərvərlik" → "qonaqpərvərlik").
 *   - The Turn-G consistency-guard test (`alert-message-i18n.test.ts`)
 *     caught code-key drift but NOT translation-value drift.
 *
 * Post-LVIII single-source-of-truth wiring:
 *   - This file holds the canonical `INDUSTRIES[]` array.
 *   - `scripts/seed-industries.ts` imports `INDUSTRIES` from here →
 *     writes to the `Industry` table.
 *   - `scripts/build-industries-i18n.ts` imports `INDUSTRIES` from here
 *     → writes `messages/{en,ru,az}.json:industries` slices.
 *   - A NEW guard test (`industries-i18n-sync.test.ts`) asserts the JSON
 *     slices match the canonical TS data; CI catches any manual JSON
 *     edit that would drift.
 *
 * Why TS const, not Prisma at build time:
 *   - `prisma.industry.findMany()` requires a live DB connection. CI /
 *     Vercel builds run BEFORE the seed step (which populates the DB).
 *     Fetching from the DB at build time would fail on cold environments.
 *   - The TS const is plain data with no runtime cost. Both the seed
 *     script (which writes to DB) and the i18n builder (which writes to
 *     JSON) consume the same canonical fixture.
 *
 * Industry shape contract:
 *   - `code` MUST match `industries[]` arrays on `IndicatorDefinition`
 *     rows in `src/lib/risk/indicator-seeds.ts` (otherwise indicators
 *     never match a company).
 *   - `nameEn` / `nameAz` / `nameRu` MUST be human-readable proper-case
 *     names. The JSON i18n builder emits these verbatim into the
 *     `industries.*` namespace consumed by `localizeAlertMessageParams`,
 *     `IntelFeedPanel` industry pills, and AlertsPanel.
 *   - `category` is the umbrella grouping (`agro_umbrella` /
 *     `services_umbrella` / `industrial_umbrella`); used for grouping
 *     in industry pickers + segment-level reporting.
 *   - `sortOrder` drives display order in dropdowns + heatmap legend.
 *
 * To add an industry:
 *   1. Append a new `IndustrySeed` row below.
 *   2. Run `npm run i18n:industries` to regenerate JSON slices.
 *   3. Run `npx tsx scripts/seed-industries.ts` to populate the DB.
 *   4. Add the code to any relevant `industries[]` arrays in
 *      `src/lib/risk/indicator-seeds.ts`.
 *
 * To rename an industry:
 *   - Edit `nameEn` / `nameAz` / `nameRu` here, then steps 2-3 above.
 *   - The `Industry.code` is the immutable PK — do NOT rename existing
 *     codes (would orphan IndicatorDefinition + Company rows).
 */

export interface IndustrySeed {
  /** snake_case PK; matches `industries[]` on IndicatorDefinition rows. */
  code: string;
  /** Proper-case human label. Lands in `messages/en.json:industries.<code>`. */
  nameEn: string;
  /** Optional native AZ. Lands in `messages/az.json:industries.<code>`. */
  nameAz?: string;
  /** Optional native RU. Lands in `messages/ru.json:industries.<code>`. */
  nameRu?: string;
  /** Umbrella grouping (agro / services / industrial). */
  category?: string;
  /** Display order in dropdowns + legends. */
  sortOrder: number;
}

export const INDUSTRIES: readonly IndustrySeed[] = [
  {
    code: "hospitality",
    nameEn: "Hospitality",
    nameAz: "Qonaqpərvərlik",
    nameRu: "Гостиничный бизнес",
    category: "services_umbrella",
    sortOrder: 10,
  },
  {
    code: "food_processing",
    nameEn: "Food Processing",
    nameAz: "Qida emalı",
    nameRu: "Пищевая переработка",
    category: "agro_umbrella",
    sortOrder: 20,
  },
  {
    code: "agro_crops",
    nameEn: "Agro — Crops",
    nameAz: "Bitkiçilik",
    nameRu: "Растениеводство",
    category: "agro_umbrella",
    sortOrder: 30,
  },
  {
    code: "poultry",
    nameEn: "Poultry",
    nameAz: "Quşçuluq",
    nameRu: "Птицеводство",
    category: "agro_umbrella",
    sortOrder: 40,
  },
  {
    code: "pharma",
    nameEn: "Pharmaceuticals",
    nameAz: "Əczaçılıq",
    nameRu: "Фармацевтика",
    category: "industrial_umbrella",
    sortOrder: 50,
  },
  {
    code: "industrial",
    nameEn: "Industrial",
    nameAz: "Sənaye",
    nameRu: "Промышленность",
    category: "industrial_umbrella",
    sortOrder: 60,
  },
  {
    code: "real_estate",
    nameEn: "Real Estate",
    nameAz: "Daşınmaz əmlak",
    nameRu: "Недвижимость",
    category: "services_umbrella",
    sortOrder: 70,
  },
  {
    code: "entertainment",
    nameEn: "Entertainment",
    nameAz: "Əyləncə",
    nameRu: "Развлечения",
    category: "services_umbrella",
    sortOrder: 80,
  },
  {
    code: "education",
    nameEn: "Education",
    nameAz: "Təhsil",
    nameRu: "Образование",
    category: "services_umbrella",
    sortOrder: 90,
  },
  {
    code: "services",
    nameEn: "Services",
    nameAz: "Xidmətlər",
    nameRu: "Услуги",
    category: "services_umbrella",
    sortOrder: 100,
  },
  // Phase 7.C-extension — 4 sectors added 2026-04-25 to close ROADMAP
  // 44→52 indicator coverage. Codes match `industries[]` on
  // beverageIndicators / retailIndicators / logisticsIndicators /
  // constructionIndicators in src/lib/risk/indicator-seeds.ts.
  {
    code: "beverage",
    nameEn: "Beverage",
    nameAz: "İçki istehsalı",
    nameRu: "Производство напитков",
    category: "agro_umbrella",
    sortOrder: 110,
  },
  {
    code: "retail",
    nameEn: "Retail",
    nameAz: "Pərakəndə satış",
    nameRu: "Розничная торговля",
    category: "services_umbrella",
    sortOrder: 120,
  },
  {
    code: "logistics",
    nameEn: "Logistics",
    nameAz: "Logistika",
    nameRu: "Логистика",
    category: "services_umbrella",
    sortOrder: 130,
  },
  {
    code: "construction",
    nameEn: "Construction",
    nameAz: "Tikinti",
    nameRu: "Строительство",
    category: "industrial_umbrella",
    sortOrder: 140,
  },
];
