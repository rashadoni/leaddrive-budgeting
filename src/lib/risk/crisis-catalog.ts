/**
 * Phase 1 "Crisis Brief" — scenario catalog as B2 economic shocks (spec §B).
 *
 * Pure data + types. The DB seeding runner lives in
 * `scripts/seed-crisis-scenarios.ts` and imports CRISIS_CATALOG from here, so
 * the catalog is unit-testable without a database.
 */
import type { ScenarioShock } from './scenario-shock'

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
    code: 'REVENUE_DROP_30',
    category: 'climate_agro',
    flagship: true,
    nameEn: 'Revenue −30% (drought / lost customer)',
    nameRu: 'Падение выручки −30% (засуха / потеря клиента)',
    nameAz: 'Gəlir −30% (quraqlıq / müştəri itkisi)',
    description: 'Sales volume −30% → revenue + revenue-per-ha + yield fall.',
    shock: { revenueShock: -0.3, yieldShock: -0.3 },
  },
  {
    code: 'AZN_DEVAL_20',
    category: 'fx_macro',
    flagship: true,
    nameEn: 'AZN devaluation −20%',
    nameRu: 'Девальвация маната −20%',
    nameAz: 'Manatın −20% devalvasiyası',
    description: 'AZN −20% → cost rises on the assumed 30% imported-input share.',
    shock: { fxShock: 0.2, assumedImportShare: 0.3 },
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
  {
    code: 'REVENUE_DROP_50',
    category: 'climate_agro',
    nameEn: 'Severe drought — revenue −50%',
    nameRu: 'Сильная засуха — выручка −50%',
    nameAz: 'Güclü quraqlıq — gəlir −50%',
    description: 'Extreme volume tail.',
    shock: { revenueShock: -0.5, yieldShock: -0.5 },
  },
  {
    code: 'REVENUE_DROP_20',
    category: 'customers',
    nameEn: 'Lose major customer −20%',
    nameRu: 'Потеря крупного клиента −20%',
    nameAz: 'Böyük müştəri itkisi −20%',
    description: 'Top-customer loss → volume −20%.',
    shock: { revenueShock: -0.2 },
  },
  {
    code: 'AZN_DEVAL_15',
    category: 'fx_macro',
    nameEn: 'AZN devaluation −15%',
    nameRu: 'Девальвация маната −15%',
    nameAz: 'Manatın −15% devalvasiyası',
    description: 'Milder FX shock on the assumed import share.',
    shock: { fxShock: 0.15, assumedImportShare: 0.3 },
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
