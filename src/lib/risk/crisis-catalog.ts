/**
 * Phase 1 "Crisis Brief" — scenario catalog as B2 economic shocks (spec §B).
 *
 * Pure data + types. The DB seeding runner lives in
 * `scripts/seed-crisis-scenarios.ts` and imports CRISIS_CATALOG from here, so
 * the catalog is unit-testable without a database.
 */
import type { ScenarioShock } from './scenario-shock'

/**
 * Phase 16.6 (2026-08-06) — on the `assumedImportShare: 0.3` below.
 *
 * That literal used to BE the imported-input share for every company in the
 * holding: one coefficient applied to a refinery buying raw sugar abroad and to
 * a domestic logistics arm alike, which made the worst-hit ranking an artifact
 * of the constant rather than a finding.
 *
 * It is now the LAST tier of three. `resolveImportShare` prefers a company's
 * measured `imported_input_cost`, then its own `import_share` assumption, and
 * reaches this literal only when a company has stated nothing — at which point
 * the board narrative says so by name and count.
 *
 * So it stays, deliberately: a scenario must still be simulatable for a company
 * that has never filled in its drivers, and 0.3 is a defensible generic. What
 * changed is that it can no longer masquerade as this business's data.
 *
 * Phase 16.7 — the same now applies to `costRigidity: 0.8` on the two drought
 * scenarios, which asserted "seeds, fertiliser and irrigation are already
 * spent" of every company the shock touched. For a services arm that is simply
 * untrue: a volume drop scales its costs down, and 0.8 crushed a margin that
 * would not have moved. A company stating `cost_rigidity` now overrides it.
 *
 * Both literals are the LAST tier of the same registry — see COMPANY_DRIVERS.
 */

export type CrisisCategory = 'fx_macro' | 'commodity' | 'climate_agro' | 'geopolitics' | 'customers'

export interface CrisisCatalogEntry {
  code: string
  category: CrisisCategory
  flagship?: boolean
  nameEn: string
  nameRu: string
  nameAz: string
  description: string
  shock: ScenarioShock
}

/** Human-readable category labels (RU) for the grouped scenario selector. */
export const CRISIS_CATEGORY_LABEL_RU: Record<CrisisCategory, string> = {
  fx_macro: '💱 Валюта / макро',
  commodity: '🌾 Сырьё',
  climate_agro: '☀️ Климат / агро',
  geopolitics: '🌍 Геополитика',
  customers: '👥 Клиенты',
}

export const CRISIS_CATALOG: CrisisCatalogEntry[] = [
  // ── 3 flagships (spec §B.3, user-selected) ──
  {
    code: 'INPUT_COST_30',
    category: 'commodity',
    flagship: true,
    nameEn: 'Input cost +30%',
    nameRu: 'Рост входной стоимости +30%',
    nameAz: 'Giriş xərcləri +30%',
    description: 'Input cost +30% (FX-import / sugar / grain) → margins compress across food-processing.',
    shock: { inputCostShock: 0.3 },
  },
  {
    code: 'DROUGHT_2026',
    category: 'climate_agro',
    flagship: true,
    nameEn: 'Drought — harvest −30% (costs already sunk)',
    nameRu: 'Засуха — урожай −30% (затраты уже понесены)',
    nameAz: 'Quraqlıq — məhsul −30% (xərclər artıq çəkilib)',
    description:
      'Harvest −30%: revenue + yield fall but seeds/fertilizer/labour/irrigation are already spent — 0.8 sunk-cost share by default, or each company’s own where stated → agro margins crushed.',
    shock: { revenueShock: -0.3, yieldShock: -0.3, costRigidity: 0.8 },
  },
  {
    code: 'AZN_DEVAL_20',
    category: 'fx_macro',
    flagship: true,
    nameEn: 'AZN devaluation → 2.04/USD',
    nameRu: 'Девальвация маната → 2.04/USD',
    nameAz: 'Manatın devalvasiyası → 2.04/USD',
    description: 'AZN/USD to 2.04 (from the live CBAR rate ~1.70) → −20% manat; cost rises on each company’s imported-input share, or on the 30% default where none is stated.',
    shock: { target: { metric: 'AZN_USD', value: 2.04, drives: 'fxShock' }, assumedImportShare: 0.3 },
  },
  // ── secondary catalog (severity tails + categories) ──
  {
    code: 'INPUT_COST_50',
    category: 'commodity',
    nameEn: 'Input cost +50% (severe)',
    nameRu: 'Входная стоимость +50% (тяжёлый)',
    nameAz: 'Giriş xərcləri +50% (ağır)',
    description: 'Severe input-cost tail.',
    shock: { inputCostShock: 0.5 },
  },
  {
    code: 'PRICE_DROP_20',
    category: 'commodity',
    nameEn: 'Selling price −20%',
    nameRu: 'Цена реализации −20%',
    nameAz: 'Satış qiyməti −20%',
    description: 'Output price −20% (sugar/commodity) → margin compresses.',
    shock: { priceShock: -0.2 },
  },
  {
    code: 'PRICE_DROP_40',
    category: 'commodity',
    nameEn: 'Price crash −40%',
    nameRu: 'Обвал цены −40%',
    nameAz: 'Qiymət çöküşü −40%',
    description: 'Severe price-crash tail.',
    shock: { priceShock: -0.4 },
  },
  // Phase 2 — live-anchored commodity scenarios (target → fraction from feed).
  {
    code: 'SUGAR_PRICE_TO_70',
    category: 'commodity',
    nameEn: 'Sugar price → FAO 70',
    nameRu: 'Цена сахара → FAO 70',
    nameAz: 'Şəkər qiyməti → FAO 70',
    description: 'FAO sugar index falls to 70 (from the live ~88.5) → output-price drop compresses sugar-producer margins.',
    shock: { target: { metric: 'FAO_SUGAR_INDEX', value: 70, drives: 'priceShock' } },
  },
  {
    code: 'BRENT_TO_140',
    category: 'commodity',
    nameEn: 'Brent → $140/bbl',
    nameRu: 'Brent → $140/баррель',
    nameAz: 'Brent → $140/barel',
    description: 'Brent climbs to $140 (from the live ~110) → energy/fertilizer input cost rises.',
    shock: { target: { metric: 'BRENT_USD_BBL', value: 140, drives: 'inputCostShock' } },
  },
  {
    code: 'DROUGHT_SEVERE_50',
    category: 'climate_agro',
    nameEn: 'Severe drought — harvest −50%',
    nameRu: 'Сильная засуха — урожай −50%',
    nameAz: 'Güclü quraqlıq — məhsul −50%',
    description: 'Extreme drought tail: harvest −50%, costs largely sunk (costRigidity 0.8).',
    shock: { revenueShock: -0.5, yieldShock: -0.5, costRigidity: 0.8 },
  },
  {
    code: 'LOSE_TOP_CUSTOMER_20',
    category: 'customers',
    nameEn: 'Lose major customer −20%',
    nameRu: 'Потеря крупного клиента −20%',
    nameAz: 'Böyük müştəri itkisi −20%',
    description: 'Top-customer loss → produce less; cost fully variable (margins ~flat, absolutes fall).',
    shock: { revenueShock: -0.2, costRigidity: 0 },
  },
  {
    code: 'AZN_DEVAL_15',
    category: 'fx_macro',
    nameEn: 'AZN devaluation → 1.955/USD',
    nameRu: 'Девальвация маната → 1.955/USD',
    nameAz: 'Manatın devalvasiyası → 1.955/USD',
    description: 'AZN/USD to 1.955 (from the live ~1.70) → −15% manat; milder FX shock on the assumed import share.',
    shock: { target: { metric: 'AZN_USD', value: 1.955, drives: 'fxShock' }, assumedImportShare: 0.3 },
  },
  {
    code: 'STAGFLATION',
    category: 'fx_macro',
    nameEn: 'Stagflation (cost +25%, revenue −15%)',
    nameRu: 'Стагфляция (стоимость +25%, выручка −15%)',
    nameAz: 'Staqflyasiya (xərc +25%, gəlir −15%)',
    description: 'Combined cost-push + demand-drop.',
    shock: { inputCostShock: 0.25, revenueShock: -0.15 },
  },
  {
    code: 'IRAN_SANCTIONS',
    category: 'geopolitics',
    nameEn: 'Iran sanctions tighten',
    nameRu: 'Ужесточение санкций по Ирану',
    nameAz: 'İran sanksiyalarının sərtləşməsi',
    description: 'FX + cost pressure (assumed import share).',
    shock: { fxShock: 0.12, assumedImportShare: 0.3, inputCostShock: 0.1 },
  },
  {
    code: 'BORDER_CLOSURE',
    category: 'geopolitics',
    nameEn: 'Export/border closure',
    nameRu: 'Закрытие границы/экспорта',
    nameAz: 'Sərhəd/ixrac bağlanması',
    description: 'Exporter volume −25%.',
    shock: { revenueShock: -0.25 },
  },
]
