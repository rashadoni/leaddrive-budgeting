/**
 * External-data-source catalog — single source of truth for what each
 * feed is, why the holding cares about it, and which indicators it
 * powers. Drives:
 *   - /budgeting/admin/data-sources (in-app overview for client demos)
 *   - docs/data-sources-explained.md (export for board decks / pitches)
 *   - Risk Terminal IndicatorDetail "Источник" badge
 *   - Drift Dashboard card subtitles
 *
 * **Update rule:** when adding a new adapter, append one entry here
 * and the UI surfaces auto-pick it up.
 */

export interface DataSourceEntry {
  /** Matches `IntelDataPoint.sourceCode` + adapter.source. */
  sourceCode: string
  /** UI name in Russian (client-facing). */
  displayNameRu: string
  /** UI name in English (fallback). */
  displayNameEn: string
  /** The actual data vendor — who publishes the data. */
  vendor: string
  /** Free-form Russian explanation of WHAT the source contains. */
  whatItIsRu: string
  /** Free-form Russian explanation of WHY the holding cares. */
  businessValueRu: string
  /** Live IntelDataPoint metrics this source emits. */
  metricsEmitted: string[]
  /** Indicator codes powered (cross-reference with phase-7k-seeds.ts). */
  indicatorsPowered: string[]
  /** Realistic example value the client can interpret. */
  sampleLatest: {
    metric: string
    value: string
    interpretation: string
  }
  /** Update cadence (daily / weekly / monthly / annual). */
  cadenceRu: string
  /** Brand URL for vendor (clickable in UI). */
  vendorUrl: string
  /** Whether this adapter needs an API key. */
  keyRequired: boolean
  /** Cost: "free" / "free-tier" / "paid". */
  cost: "free" | "free-tier" | "paid"
  /** Lifecycle marker for sorting / labels. */
  status: "live" | "placeholder"
}

export const DATA_SOURCES_CATALOG: readonly DataSourceEntry[] = [
  // ── FX / денежный рынок ──────────────────────────────────────────
  {
    sourceCode: "cbar-official-fx",
    displayNameRu: "ЦБ Азербайджана · официальные курсы",
    displayNameEn: "CBAR Official FX",
    vendor: "Central Bank of Azerbaijan",
    whatItIsRu:
      "Официальные ежедневные курсы AZN к 6 валютам (USD, EUR, RUB, TRY, GBP, CNY) — публикуются ЦБА на cbar.az.",
    businessValueRu:
      "Любая компания холдинга с импортом или экспортом считает выручку и себестоимость в AZN через эти курсы. Изменение AZN/USD на 1% означает ~$200K разницы для импортозависимой компании за квартал.",
    metricsEmitted: ["AZN_USD", "AZN_EUR", "AZN_RUB", "AZN_TRY", "AZN_GBP", "AZN_CNY"],
    indicatorsPowered: ["PHARM_FX_USD_PRESSURE"],
    sampleLatest: {
      metric: "AZN_USD",
      value: "1.70",
      interpretation:
        "AZN привязан к USD на уровне 1.70. Резкое движение >2% — сигнал валютного шока для фарм-импортёров.",
    },
    cadenceRu: "ежедневно (рабочие дни)",
    vendorUrl: "https://www.cbar.az",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── энергоносители ───────────────────────────────────────────────
  {
    sourceCode: "eia-energy",
    displayNameRu: "EIA · нефть и природный газ",
    displayNameEn: "US EIA Energy",
    vendor: "U.S. Energy Information Administration",
    whatItIsRu:
      "Эталонные мировые цены: Brent (нефть, ICE), WTI (нефть, NYMEX), Henry Hub (природный газ, NYMEX). Госведомство США — самая авторитетная официальная цена в мире.",
    businessValueRu:
      "Brent — базовая цена нефти для логистики (диз. топливо), производства (электроэнергия), пищепрома (упаковка, транспорт сырья). Газ — себестоимость отопления заводов и СПГ-импорта.",
    metricsEmitted: ["BRENT_USD_BBL", "WTI_USD_BBL", "NATGAS_USD_MMBTU"],
    indicatorsPowered: ["LOG_BRENT_OIL_SIGNAL", "IND_NATGAS_PRICE_SIGNAL"],
    sampleLatest: {
      metric: "BRENT_USD_BBL",
      value: "$105.88",
      interpretation:
        "Brent выше $100 — давление на маржу логистических и промышленных компаний (топливо +10% YoY).",
    },
    cadenceRu: "ежемесячно (некоторые серии — недельно)",
    vendorUrl: "https://www.eia.gov/opendata",
    keyRequired: true,
    cost: "free-tier",
    status: "live",
  },

  // ── продовольствие глобальное ────────────────────────────────────
  {
    sourceCode: "fao-food-prices",
    displayNameRu: "FAO · Индекс продовольственных цен ООН",
    displayNameEn: "FAO Food Price Index",
    vendor: "Food and Agriculture Organization (UN)",
    whatItIsRu:
      "Месячный индекс мировых цен на продовольствие, разбитый на 5 категорий: мясо, молочная продукция, зерновые, растительные масла, сахар. База 2014-2016=100.",
    businessValueRu:
      "Индекс выше 130 = мировой пищевой кризис, повышение глобальных закупочных цен на ~10-15% YoY. AZSEKER-AZSF / CPC / MALT платят за импорт сырья по этим ценам.",
    metricsEmitted: [
      "FAO_FFPI_NOMINAL",
      "FAO_MEAT_INDEX",
      "FAO_DAIRY_INDEX",
      "FAO_CEREAL_INDEX",
      "FAO_OILS_INDEX",
      "FAO_SUGAR_INDEX",
    ],
    indicatorsPowered: ["FP_FAO_FOOD_INDEX_SIGNAL", "BEV_FAO_SUGAR_INDEX_SIGNAL"],
    sampleLatest: {
      metric: "FAO_FFPI_NOMINAL",
      value: "130.7",
      interpretation:
        "Индекс на 30.7% выше базы 2014-2016. Пищепром в зоне 🟡 amber — повышенное давление на маржу.",
    },
    cadenceRu: "ежемесячно (первая пятница)",
    vendorUrl: "https://www.fao.org/worldfoodsituation/foodpricesindex/en/",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── зерновые ─────────────────────────────────────────────────────
  {
    sourceCode: "yahoo-grains",
    displayNameRu: "Чикаго · фьючерсы на зерновые и хлопок",
    displayNameEn: "Yahoo Finance Grains",
    vendor: "CME Group / ICE (via Yahoo Chart API)",
    whatItIsRu:
      "Front-month фьючерсы 5 культур: кукуруза (ZC), пшеница (ZW), соя (ZS), овёс (ZO как прокси ячменя), хлопок (CT). Сконвертированы в USD/тонна.",
    businessValueRu:
      "Зерно — главный сырьевой вход для пищепрома (мука, корма) и птицефабрик. Соя/хлопок — индикатор спроса на корм для скота и потребительский спрос на текстиль.",
    metricsEmitted: [
      "CORN_USD_TONNE",
      "WHEAT_USD_TONNE",
      "SOYBEAN_USD_TONNE",
      "OATS_USD_TONNE",
      "COTTON_USD_TONNE",
    ],
    indicatorsPowered: [
      "FP_WHEAT_PRICE_SIGNAL",
      "FP_GRAIN_COST_PRESSURE_BLEND",
      "POULT_FEED_CORN_PRESSURE",
    ],
    sampleLatest: {
      metric: "WHEAT_USD_TONNE",
      value: "$234/т",
      interpretation:
        "Пшеница $234/т — ниже $250 порога 🟢. Хорошее время для закупок муки на 6 мес вперёд.",
    },
    cadenceRu: "ежемесячно (есть и ежедневно при необходимости)",
    vendorUrl: "https://finance.yahoo.com/quote/ZC=F",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── металлы и лесоматериалы ──────────────────────────────────────
  {
    sourceCode: "yahoo-metals",
    displayNameRu: "Биржевые металлы и пиломатериалы",
    displayNameEn: "Yahoo Finance Metals + Lumber",
    vendor: "CME / NYMEX (via Yahoo Chart API)",
    whatItIsRu:
      "Front-month фьючерсы: медь HG (электротехника, провод), алюминий ALI (упаковка), сталь HRC (стройка, металлоконструкции), лес LBR (строительство). Сконвертированы в USD/тонна.",
    businessValueRu:
      "Медь и алюминий — закупочный сырьевой вход для ATL (трубы, полиэтилен, металлообработка). Сталь и пиломатериалы — себестоимость строительства, цены недвижимости.",
    metricsEmitted: [
      "COPPER_USD_TONNE",
      "ALUMINUM_USD_TONNE",
      "STEEL_USD_TONNE",
      "LUMBER_USD_MBF",
    ],
    indicatorsPowered: [
      "IND_COPPER_PRICE_SIGNAL",
      "CONSTR_STEEL_PRICE_SIGNAL",
      "CONSTR_LUMBER_PRICE_SIGNAL",
    ],
    sampleLatest: {
      metric: "COPPER_USD_TONNE",
      value: "$13,878/т",
      interpretation:
        "Медь выше $11k — 🔴 red — industrial cost pressure. ATL-DBZ / ATL-PMZ / ZTP закупают медь по высоким ценам.",
    },
    cadenceRu: "ежемесячно",
    vendorUrl: "https://finance.yahoo.com/quote/HG=F",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── топливо + морской фрахт ──────────────────────────────────────
  {
    sourceCode: "yahoo-fuel-bdi",
    displayNameRu: "Топливо и морской фрахт",
    displayNameEn: "Yahoo Fuel + Baltic Dry Index",
    vendor: "NYMEX + Breakwave Dry Bulk ETF (via Yahoo)",
    whatItIsRu:
      "Дизель (HO, ULSD), бензин (RB, RBOB), индекс морского фрахта BDRY (отслеживает Baltic Dry Index через 3-мес роллируемые фьючерсы Capesize/Panamax/Supramax).",
    businessValueRu:
      "Дизель — топливо для грузовиков логистики (LLS), бензин — для легкового парка. BDI — мировая стоимость доставки сыпучих грузов (зерно, металл, уголь) морем; растёт при оживлении мировой торговли.",
    metricsEmitted: ["BALTIC_DRY_INDEX", "DIESEL_USD_LITRE", "GASOLINE_USD_LITRE"],
    indicatorsPowered: ["LOG_DIESEL_PRICE_SIGNAL", "LOG_BDI_FREIGHT_SIGNAL"],
    sampleLatest: {
      metric: "DIESEL_USD_LITRE",
      value: "$1.04/л",
      interpretation:
        "Дизель $1.04/л — 🔴 red — выше $0.90 порога. Прямое давление на логистическую маржу LLS.",
    },
    cadenceRu: "ежемесячно",
    vendorUrl: "https://finance.yahoo.com/quote/HO=F",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── погода прогноз ───────────────────────────────────────────────
  {
    sourceCode: "openmeteo-forecast",
    displayNameRu: "Open-Meteo · прогноз погоды 14 дней",
    displayNameEn: "Open-Meteo 14-Day Forecast",
    vendor: "open-meteo.com (ECMWF model)",
    whatItIsRu:
      "14-дневный прогноз: ежедневные осадки (мм), средняя и максимальная температура для 8 азербайджанских регионов (Сальян, Имишли, Сабирабад, Евлах, Шамкир, Физули, Агджабеди, Бейлаган).",
    businessValueRu:
      "EDEN/FARM — фермы Azərşəkər сеют сахарную свёклу и зерно в этих регионах. Прогноз осадков <10mm = угроза урожаю; >30mm = хорошее увлажнение. Также влияет на спрос для hospitality (туризм в жаркую неделю).",
    metricsEmitted: [
      "SALYAN_RAINFALL_MM_14D_FCST",
      "SALYAN_TEMP_AVG_C_14D_FCST",
      "SALYAN_TEMP_MAX_C_14D_FCST",
      "+ 7 других регионов × 3 метрики",
    ],
    indicatorsPowered: ["AGRO_SALYAN_RAINFALL_14D_FCST"],
    sampleLatest: {
      metric: "SALYAN_RAINFALL_MM_14D_FCST",
      value: "53.8 мм",
      interpretation:
        "Сальян — прогноз 53.8mm на 14 дней — 🟢 green. Достаточная влага для свёклы на пик сезона роста.",
    },
    cadenceRu: "ежедневно",
    vendorUrl: "https://open-meteo.com/",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── AZ статистика — инфляция ─────────────────────────────────────
  {
    sourceCode: "az-stat-cpi",
    displayNameRu: "ГосСтат AZ · индекс потребительских цен",
    displayNameEn: "AZ State Statistics CPI",
    vendor: "Государственный комитет статистики Азербайджана",
    whatItIsRu:
      "Месячный индекс потребительских цен (база 2010=100) с разбивкой на 4 категории: всё, продукты + напитки + табак, непродовольственные, платные услуги. Скачивается как XLSX с stat.gov.az.",
    businessValueRu:
      "Прямой бенчмарк инфляции для индексации цен на продукцию холдинга. Food CPI > 105% YoY = можно повышать отпускные цены на 5% без потери конкурентоспособности. Услуги — давление на стоимость найма + аренды офисов.",
    metricsEmitted: [
      "AZ_CPI_ALL_ITEMS",
      "AZ_CPI_FOOD",
      "AZ_CPI_NON_FOOD",
      "AZ_CPI_SERVICES",
    ],
    indicatorsPowered: [
      "RET_AZ_FOOD_CPI_PRESSURE",
      "RE_HOUSING_CPI_PRESSURE",
    ],
    sampleLatest: {
      metric: "AZ_CPI_FOOD",
      value: "105.5% YoY",
      interpretation:
        "Food CPI +5.5% YoY — 🟡 amber. Retail может повысить ценник на 5% без риска потери трафика; пищепром получит ту же надбавку.",
    },
    cadenceRu: "ежемесячно (~14 числа следующего месяца)",
    vendorUrl: "https://www.stat.gov.az/source/price_tarif/?lang=en",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── ВНЕШНЯЯ ТОРГОВЛЯ AZ ──────────────────────────────────────────
  {
    sourceCode: "un-comtrade-az",
    displayNameRu: "UN Comtrade · экспорт/импорт AZ",
    displayNameEn: "UN Comtrade — Azerbaijan",
    vendor: "United Nations Comtrade Database",
    whatItIsRu:
      "Годовая официальная статистика товарного экспорта/импорта Азербайджана. Источник для торгового баланса, который ООН агрегирует с госстатистики страны.",
    businessValueRu:
      "Торговый баланс — макросигнал для всех импортозависимых бизнесов холдинга (пищепром, фарма, retail). Резкое сокращение положительного баланса = AZN под давлением = валютные риски.",
    metricsEmitted: [
      "AZ_GOODS_EXPORTS_USD",
      "AZ_GOODS_IMPORTS_USD",
      "AZ_TRADE_BALANCE_USD",
    ],
    indicatorsPowered: ["SERV_AZ_TRADE_BALANCE_SIGNAL"],
    sampleLatest: {
      metric: "AZ_TRADE_BALANCE_USD",
      value: "-$23.2 млрд",
      interpretation:
        "Comtrade preview за 2025 показывает отрицательный баланс (-23 млрд USD). Скорее всего это лаг публикации — нефть не вся посчитана. Перечитаем когда UN докатит данные.",
    },
    cadenceRu: "ежегодно (с лагом 2-3 квартала)",
    vendorUrl: "https://comtradeplus.un.org/",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── ВСЕМИРНЫЙ БАНК ───────────────────────────────────────────────
  {
    sourceCode: "wb-indicators",
    displayNameRu: "Всемирный банк · туризм и образование AZ",
    displayNameEn: "World Bank Indicators",
    vendor: "World Bank Open Data",
    whatItIsRu:
      "Годовые макропоказатели AZ из базы World Bank: международный туризм (прибытия + расходы + доходы), образование (зачисление в среднюю школу, госрасходы, % населения 0-14 лет).",
    businessValueRu:
      "Туризм — драйвер hospitality (Hilton, Marriott, Four Seasons) и entertainment (концерты, F1, Crystal Hall). Образование — TAM для частных университетов (ADA, Khazar) + детская розница.",
    metricsEmitted: [
      "AZ_TOURISM_ARRIVALS",
      "AZ_TOURISM_RECEIPTS_USD",
      "AZ_TOURISM_EXPENDITURES_USD",
      "AZ_SCHOOL_ENROLL_SEC_PCT",
      "AZ_EDU_EXPENDITURE_PCT_GDP",
      "AZ_POP_AGE_0_14_PCT",
    ],
    indicatorsPowered: [
      "HOSP_TOURISM_ARRIVALS_SIGNAL",
      "EDU_POPULATION_0_14_SIGNAL",
    ],
    sampleLatest: {
      metric: "AZ_TOURISM_ARRIVALS",
      value: "2.3 млн чел",
      interpretation:
        "2.3 млн туристов в год — 🔴 red — ниже доковидных 3.2 млн. Hospitality в зоне восстановления.",
    },
    cadenceRu: "ежегодно (с лагом 1-2 года)",
    vendorUrl: "https://data.worldbank.org/country/AZ",
    keyRequired: false,
    cost: "free",
    status: "live",
  },

  // ── СЕЛЬХОЗ США (USDA) ───────────────────────────────────────────
  {
    sourceCode: "usda-nass",
    displayNameRu: "USDA · оптовые цены птицеводства США",
    displayNameEn: "USDA NASS Quick Stats",
    vendor: "U.S. Department of Agriculture",
    whatItIsRu:
      "Месячные/недельные опт. цены: бройлеры ($/lb), яйца ($/доз), размещение цыплят на откорм. США — глобальный benchmark, локальные AZ цены отстают на 4-6 недель.",
    businessValueRu:
      "Бройлер $/lb — leading indicator для AZ птицепрома (Azersun, Gilan Quba). Падение в США ниже $1/lb предсказывает demand-side shock в AZ через 1-2 месяца. Корм-цыплята — производственный пайплайн.",
    metricsEmitted: [
      "BROILER_PRICE_USD_LB",
      "EGG_PRICE_USD_DOZ",
      "CHICK_PLACEMENT_THOUSAND",
    ],
    indicatorsPowered: [
      "POULT_BROILER_PRICE_SIGNAL",
      "POULT_EGG_PRICE_SIGNAL",
    ],
    sampleLatest: {
      metric: "BROILER_PRICE_USD_LB",
      value: "$0.67/lb",
      interpretation:
        "Бройлер $0.67/lb — 🔴 red — ниже $1.00 порога. Margin compression risk для всех птицефабрик глобально (включая AZ через 2 мес).",
    },
    cadenceRu: "месячно + некоторые серии недельно",
    vendorUrl: "https://quickstats.nass.usda.gov/",
    keyRequired: true,
    cost: "free-tier",
    status: "live",
  },

  // ── ПОИСКОВЫЙ СПРОС ──────────────────────────────────────────────
  {
    sourceCode: "google-trends-az",
    displayNameRu: "Google Trends · поисковый спрос AZ",
    displayNameEn: "Google Trends Azerbaijan (via Scrapingdog proxy)",
    vendor: "Google (через Scrapingdog API)",
    whatItIsRu:
      "Нормализованный 0-100 индекс поискового интереса по 4 категориям: продукты питания (yemək/продукты/grocery), одежда (moda/одежда/fashion), электроника (iPhone/электроника/electronics), туризм (tour/путешествие/travel) — гео:AZ.",
    businessValueRu:
      "Поисковый спрос — самый ранний leading indicator потребительского поведения. Падение food-trend на 30% за месяц = retail продажи упадут через 2-4 недели. Travel-trend = hospitality бронирования +30 дней.",
    metricsEmitted: [
      "AZ_TREND_FOOD_RETAIL",
      "AZ_TREND_FASHION",
      "AZ_TREND_ELECTRONICS",
      "AZ_TREND_TRAVEL",
    ],
    indicatorsPowered: [
      "RET_TREND_FOOD_SIGNAL",
      "ENT_TRAVEL_DEMAND_SIGNAL",
    ],
    sampleLatest: {
      metric: "AZ_TREND_FOOD_RETAIL",
      value: "79 из 100",
      interpretation:
        "Food search interest 79 — 🔴 red — ниже 80 порога. Retail может ожидать слабый трафик в продуктовых магазинах в ближайшие 2-4 недели.",
    },
    cadenceRu: "еженедельно",
    vendorUrl: "https://trends.google.com",
    keyRequired: true,
    cost: "paid",
    status: "live",
  },
] as const

/** Lookup helper. */
export function getDataSourceByCode(code: string): DataSourceEntry | undefined {
  return DATA_SOURCES_CATALOG.find((s) => s.sourceCode === code)
}

/** Get the data-source(s) that power a specific indicator. */
export function getDataSourcesForIndicator(
  indicatorCode: string,
): readonly DataSourceEntry[] {
  return DATA_SOURCES_CATALOG.filter((s) =>
    s.indicatorsPowered.includes(indicatorCode),
  )
}
