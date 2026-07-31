/**
 * Phase 7.K Phase 5b — sector-specific indicator seeds powered by the
 * new external data feeds (CBAR FX / EIA Energy / FAO Food / Yahoo
 * Grains+Metals+Fuel-BDI / WB Indicators / UN Comtrade / USDA NASS /
 * AZ Stat CPI / OpenMeteo Forecast / Google Trends).
 *
 * Each entry follows the IndicatorSeed contract from
 * `./indicator-seeds.ts`. The `requiredInputs` reference
 * `commodityPrice:<varName>` variables, which the recompute pipeline
 * resolves via `COMMODITY_PRICE_ALIASES` in `recompute.ts` — that
 * table was extended in this same phase to cover all the new sources.
 *
 * Sort orders pick up from each sector's existing block:
 *   HOSP_*  → 70+
 *   PHARM_* → 130+
 *   RE_*    → 360+
 *   IND_*   → 750+
 *   CONSTR_*→ 760+
 *   LOG_*   → 790+
 *   POULT_* → 820+
 *   FP_*    → 870+
 *   BEV_*   → 950+
 *   RET_*   → 970+
 *   EDU_*   → 1020+
 *   ENT_*   → 1050+
 *   SERV_*  → 1100+
 *   AGRO_*  → 1150+
 */
import type { IndicatorSeed } from "./indicator-seeds"

/** Generic pressure-style thresholds: lower is better. */
const PRESSURE = {
  green: { op: "<=" as const, value: 15 },
  amber: { op: "<=" as const, value: 30 },
  red: { op: ">" as const, value: 30 },
}

/** Generic demand-signal: higher is better. */
const DEMAND_SIGNAL = {
  green: { op: ">=" as const, value: 100 },
  amber: { op: ">=" as const, value: 80 },
  red: { op: "<" as const, value: 80 },
}

export const phase7kSeeds: IndicatorSeed[] = [
  // ──────────────────────────────────────────────────────────────────
  // HOSPITALITY — tourism + FX
  // ──────────────────────────────────────────────────────────────────
  {
    code: "HOSP_TOURISM_ARRIVALS_SIGNAL",
    nameEn: "AZ Tourism Arrivals Signal",
    nameAz: "Turist axını siqnalı",
    nameRu: "Сигнал туристического потока AZ",
    category: "macro",
    industries: ["hospitality"],
    unit: "k arrivals",
    direction: "higher_better",
    formula: "az_tourism_arrivals_latest / 1000",
    thresholds: {
      green: { op: ">=", value: 2000 },
      amber: { op: ">=", value: 1500 },
      red: { op: "<", value: 1500 },
    },
    hintTemplateEn:
      "AZ tourism arrivals at {value}k (annual, latest reported year). Above 2M is a green demand signal; below 1.5M means hotel occupancy headwind ahead.",
    hintTemplateAz:
      "Azərbaycana turist axını {value} min nəfər (illik, son hesabat ili). 2 milyondan yuxarı — yaşıl tələb siqnalı; 1,5 milyondan aşağı otel dolğunluğu üçün qarşıda əks külək deməkdir.",
    hintTemplateRu:
      "Туристический поток в Азербайджан — {value} тыс. чел. (годовой, последний отчётный год). Выше 2 млн — зелёный сигнал спроса; ниже 1,5 млн — встречный ветер для загрузки отелей.",
    requiredInputs: ["commodityPrice:az_tourism_arrivals_latest"],
    sortOrder: 75,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // PHARMA — FX pass-through
  // ──────────────────────────────────────────────────────────────────
  {
    code: "PHARM_FX_USD_PRESSURE",
    nameEn: "Pharma USD Import FX Pressure",
    nameAz: "AZN/USD farmasevtik təzyiqi",
    nameRu: "Давление AZN/USD на фармимпорт",
    category: "fx",
    industries: ["pharma"],
    unit: "AZN/USD",
    direction: "lower_better",
    formula: "azn_usd_latest",
    thresholds: {
      green: { op: "<=", value: 1.7 },
      amber: { op: "<=", value: 1.75 },
      red: { op: ">", value: 1.75 },
    },
    hintTemplateEn:
      "AZN/USD at {value}. Pharma cost-of-goods is ~80% USD imports — every 1% AZN devaluation flows directly to gross margin.",
    hintTemplateAz:
      "AZN/USD məzənnəsi {value}. Əczaçılıqda malın maya dəyərinin ~80%-i USD idxalıdır — AZN-in hər 1% ucuzlaşması birbaşa ümumi marjaya keçir.",
    hintTemplateRu:
      "Курс AZN/USD — {value}. Около 80% себестоимости в фарме — импорт за USD: каждый 1% девальвации маната напрямую бьёт по валовой марже.",
    requiredInputs: ["commodityPrice:azn_usd_latest"],
    sortOrder: 135,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // REAL ESTATE — housing CPI
  // ──────────────────────────────────────────────────────────────────
  {
    code: "RE_HOUSING_CPI_PRESSURE",
    nameEn: "AZ Housing/Services CPI Pressure",
    nameAz: "Mənzil + xidmət İPI təzyiqi",
    nameRu: "Давление ИПЦ жилья и услуг AZ",
    category: "macro",
    industries: ["real_estate"],
    unit: "% YoY",
    direction: "higher_better",
    formula: "az_cpi_housing_latest",
    thresholds: {
      // AZ_CPI_SERVICES (paid services — rent + utility tariffs +
      // communal payments) is the monthly proxy until stat.gov.az
      // 001_4en housing-specific monthly file gets wired.
      green: { op: ">=", value: 105 },
      amber: { op: ">=", value: 100 },
      red: { op: "<", value: 100 },
    },
    hintTemplateEn:
      "AZ Services CPI (rent + utilities proxy) at {value}% YoY. ≥105 indicates rising occupancy + utility cost pass-through (tailwind for real-estate revenue); <100 = deflationary headwind.",
    hintTemplateAz:
      "Xidmətlər üzrə AZ istehlak qiymətləri indeksi (icarə + kommunal proksisi) illik {value}%. ≥105 dolğunluğun və kommunal xərclərin qiymətə ötürülməsinin artmasını göstərir (daşınmaz əmlak gəliri üçün əlverişli külək); <100 deflyasiya təzyiqidir.",
    hintTemplateRu:
      "ИПЦ услуг AZ (прокси аренды и коммунальных) — {value}% г/г. ≥105 указывает на рост заполняемости и переноса коммунальных затрат в цену (попутный ветер для доходов недвижимости); <100 — дефляционное давление.",
    requiredInputs: ["commodityPrice:az_cpi_housing_latest"],
    sortOrder: 365,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // INDUSTRIAL — input commodity exposure
  // ──────────────────────────────────────────────────────────────────
  {
    code: "IND_COPPER_PRICE_SIGNAL",
    nameEn: "Copper Price Signal",
    nameAz: "Mis qiymət siqnalı",
    nameRu: "Сигнал цены меди",
    category: "commodity",
    industries: ["industrial"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "copper_price_latest",
    thresholds: {
      green: { op: "<=", value: 9000 },
      amber: { op: "<=", value: 11000 },
      red: { op: ">", value: 11000 },
    },
    hintTemplateEn:
      "Copper at {value} USD/tonne. >$11k/t is an industrial input-cost red flag — review pass-through pricing.",
    hintTemplateAz:
      "Mis {value} USD/ton. >11 min $/ton sənaye xammal xərci üçün qırmızı siqnaldır — qiymətə ötürmə siyasətini nəzərdən keçirin.",
    hintTemplateRu:
      "Медь — {value} USD/т. Выше $11 тыс./т — красный флаг по стоимости промышленного сырья: пересмотрите перенос затрат в цену.",
    requiredInputs: ["commodityPrice:copper_price_latest"],
    sortOrder: 755,
    defaultValueSource: "macro",
  },
  {
    code: "IND_NATGAS_PRICE_SIGNAL",
    nameEn: "Natural Gas Price Signal",
    nameAz: "Təbii qaz qiymət siqnalı",
    nameRu: "Сигнал цены природного газа",
    category: "commodity",
    industries: ["industrial"],
    unit: "USD/MMBtu",
    direction: "lower_better",
    formula: "natgas_price_latest",
    thresholds: {
      green: { op: "<=", value: 4 },
      amber: { op: "<=", value: 6 },
      red: { op: ">", value: 6 },
    },
    hintTemplateEn:
      "Henry Hub natural gas at {value} USD/MMBtu. >$6 is a power + petrochem input cost red flag.",
    hintTemplateAz:
      "Henry Hub təbii qazı {value} USD/MMBtu. >6 $ enerji və neft-kimya xammalı xərci üçün qırmızı siqnaldır.",
    hintTemplateRu:
      "Природный газ Henry Hub — {value} USD/MMBtu. Выше $6 — красный флаг по стоимости энергии и нефтехимического сырья.",
    requiredInputs: ["commodityPrice:natgas_price_latest"],
    sortOrder: 756,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // CONSTRUCTION — steel + lumber
  // ──────────────────────────────────────────────────────────────────
  {
    code: "CONSTR_STEEL_PRICE_SIGNAL",
    nameEn: "Steel HRC Price Signal",
    nameAz: "Polad qiymət siqnalı",
    nameRu: "Сигнал цены стали HRC",
    category: "commodity",
    industries: ["construction"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "steel_price_latest",
    thresholds: {
      green: { op: "<=", value: 700 },
      amber: { op: "<=", value: 900 },
      red: { op: ">", value: 900 },
    },
    hintTemplateEn:
      "HRC steel {value} USD/tonne. >$900/t is a construction-margin red flag — review project bid contingencies.",
    hintTemplateAz:
      "HRC polad {value} USD/ton. >900 $/ton tikinti marjası üçün qırmızı siqnaldır — layihə tenderlərindəki ehtiyat büdcəni yoxlayın.",
    hintTemplateRu:
      "Сталь HRC — {value} USD/т. Выше $900/т — красный флаг для маржи в строительстве: проверьте резервы в тендерных расчётах.",
    requiredInputs: ["commodityPrice:steel_price_latest"],
    sortOrder: 765,
    defaultValueSource: "macro",
  },
  {
    code: "CONSTR_LUMBER_PRICE_SIGNAL",
    nameEn: "Lumber Price Signal",
    nameAz: "Ağac materialı qiymət siqnalı",
    nameRu: "Сигнал цены пиломатериалов",
    category: "commodity",
    industries: ["construction"],
    unit: "USD/MBF",
    direction: "lower_better",
    formula: "lumber_price_latest",
    thresholds: {
      green: { op: "<=", value: 400 },
      amber: { op: "<=", value: 600 },
      red: { op: ">", value: 600 },
    },
    hintTemplateEn:
      "Lumber at {value} USD/1000 board ft. >$600 is a residential-margin red flag.",
    hintTemplateAz:
      "Oduncaq {value} USD/1000 bord-fut. >600 $ yaşayış tikintisi marjası üçün qırmızı siqnaldır.",
    hintTemplateRu:
      "Пиломатериалы — {value} USD за 1000 борд-футов. Выше $600 — красный флаг для маржи жилищного строительства.",
    requiredInputs: ["commodityPrice:lumber_price_latest"],
    sortOrder: 766,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // LOGISTICS — fuel + freight index
  // ──────────────────────────────────────────────────────────────────
  {
    code: "LOG_DIESEL_PRICE_SIGNAL",
    nameEn: "Diesel Price Signal",
    nameAz: "Dizel qiymət siqnalı",
    nameRu: "Сигнал цены дизеля",
    category: "commodity",
    industries: ["logistics"],
    unit: "USD/L",
    direction: "lower_better",
    formula: "diesel_price_latest",
    thresholds: {
      green: { op: "<=", value: 0.7 },
      amber: { op: "<=", value: 0.9 },
      red: { op: ">", value: 0.9 },
    },
    hintTemplateEn:
      "ULSD diesel proxy {value} USD/L. >$0.9 is a fleet-cost red flag — review fuel-surcharge clauses.",
    hintTemplateAz:
      "ULSD dizel proksisi {value} USD/litr. >0,9 $ avtopark xərcləri üçün qırmızı siqnaldır — müqavilələrdəki yanacaq əlavəsi bəndlərini nəzərdən keçirin.",
    hintTemplateRu:
      "Прокси дизеля ULSD — {value} USD/л. Выше $0,9 — красный флаг по затратам автопарка: пересмотрите топливные надбавки в договорах.",
    requiredInputs: ["commodityPrice:diesel_price_latest"],
    sortOrder: 795,
    defaultValueSource: "macro",
  },
  {
    code: "LOG_BDI_FREIGHT_SIGNAL",
    nameEn: "Baltic Dry Freight Signal (BDRY ETF proxy)",
    nameAz: "Baltic Dry yük siqnalı (BDRY ETF)",
    nameRu: "Сигнал фрахта Baltic Dry (BDRY ETF)",
    category: "commodity",
    industries: ["logistics"],
    unit: "USD/share",
    direction: "higher_better",
    formula: "baltic_dry_latest",
    thresholds: {
      // Calibrated for the BDRY ETF (Breakwave Dry Bulk Shipping
      // Fund) which tracks BDI via 3-month rolling futures. ETF
      // historical range $5-30 covers the BDI's ~500-3000 point
      // range. Yahoo blocks ^BDIY itself so this is the proxy.
      green: { op: ">=", value: 20 },
      amber: { op: ">=", value: 10 },
      red: { op: "<", value: 10 },
    },
    hintTemplateEn:
      "BDRY ETF at {value} USD/share — proxy for Baltic Dry Index. <$10 = global freight slowdown (negative for logistics revenue); ≥$20 = freight demand strength.",
    hintTemplateAz:
      "BDRY ETF {value} USD/pay — Baltic Dry İndeksinin proksisi. <10 $ qlobal fraxtın yavaşlamasıdır (logistika gəliri üçün mənfi); ≥20 $ fraxt tələbinin güclü olmasıdır.",
    hintTemplateRu:
      "BDRY ETF — {value} USD за пай, прокси индекса Baltic Dry. Ниже $10 — замедление мирового фрахта (негатив для выручки логистики); ≥$20 — сильный спрос на фрахт.",
    requiredInputs: ["commodityPrice:baltic_dry_latest"],
    sortOrder: 796,
    defaultValueSource: "macro",
  },
  {
    code: "LOG_BRENT_OIL_SIGNAL",
    nameEn: "Brent Crude Oil Signal",
    nameAz: "Brent neft siqnalı",
    nameRu: "Сигнал нефти Brent",
    category: "commodity",
    industries: ["logistics"],
    unit: "USD/bbl",
    direction: "lower_better",
    formula: "brent_price_latest",
    thresholds: {
      green: { op: "<=", value: 80 },
      amber: { op: "<=", value: 100 },
      red: { op: ">", value: 100 },
    },
    hintTemplateEn:
      "Brent at {value} USD/bbl. >$100 is a logistics cost-pass-through red flag (drives diesel + freight rates upstream).",
    hintTemplateAz:
      "Brent {value} USD/barel. >100 $ logistika xərclərinin qiymətə ötürülməsi üçün qırmızı siqnaldır (dizel və fraxt tariflərini yuxarı çəkir).",
    hintTemplateRu:
      "Brent — {value} USD/барр. Выше $100 — красный флаг по переносу логистических затрат в цену (тянет вверх дизель и фрахтовые ставки).",
    requiredInputs: ["commodityPrice:brent_price_latest"],
    sortOrder: 797,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // POULTRY — feed cost + output prices
  // ──────────────────────────────────────────────────────────────────
  {
    code: "POULT_BROILER_PRICE_SIGNAL",
    nameEn: "Broiler Wholesale Price Signal",
    nameAz: "Broiler topdansatış qiymət siqnalı",
    nameRu: "Сигнал оптовой цены бройлера",
    category: "commodity",
    industries: ["poultry"],
    unit: "USD/lb",
    direction: "higher_better",
    formula: "broiler_price_latest",
    thresholds: {
      green: { op: ">=", value: 1.2 },
      amber: { op: ">=", value: 1.0 },
      red: { op: "<", value: 1.0 },
    },
    hintTemplateEn:
      "Wholesale broiler at {value} USD/lb (USDA). <$1.00 = margin compression risk; >$1.20 = pricing tailwind.",
    hintTemplateAz:
      "Broylerin topdansatış qiyməti {value} USD/funt (USDA). <1,00 $ marjanın sıxılma riski; >1,20 $ qiymət üzrə əlverişli küləkdir.",
    hintTemplateRu:
      "Оптовая цена бройлера — {value} USD/фунт (USDA). Ниже $1,00 — риск сжатия маржи; выше $1,20 — ценовой попутный ветер.",
    requiredInputs: ["commodityPrice:broiler_price_latest"],
    sortOrder: 825,
    defaultValueSource: "macro",
  },
  {
    code: "POULT_FEED_CORN_PRESSURE",
    nameEn: "Poultry Feed Corn Price Signal",
    nameAz: "Quş yemi qarğıdalı qiymət siqnalı",
    nameRu: "Сигнал цены кукурузы для корма",
    category: "commodity",
    industries: ["poultry"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "corn_price_latest",
    thresholds: {
      green: { op: "<=", value: 200 },
      amber: { op: "<=", value: 280 },
      red: { op: ">", value: 280 },
    },
    hintTemplateEn:
      "Corn at {value} USD/tonne — primary feed input. >$280/t squeezes broiler margin (typical feed is 65-75% of cost).",
    hintTemplateAz:
      "Qarğıdalı {value} USD/ton — əsas yem xammalı. >280 $/ton broyler marjasını sıxır (yem adətən maya dəyərinin 65-75%-idir).",
    hintTemplateRu:
      "Кукуруза — {value} USD/т, основное кормовое сырьё. Выше $280/т сжимает маржу по бройлеру (корм обычно 65-75% себестоимости).",
    requiredInputs: ["commodityPrice:corn_price_latest"],
    sortOrder: 826,
    defaultValueSource: "macro",
  },
  {
    code: "POULT_EGG_PRICE_SIGNAL",
    nameEn: "Egg Wholesale Price Signal",
    nameAz: "Yumurta qiymət siqnalı",
    nameRu: "Сигнал цены яиц",
    category: "commodity",
    industries: ["poultry"],
    unit: "USD/dozen",
    direction: "higher_better",
    formula: "egg_price_latest",
    thresholds: {
      green: { op: ">=", value: 2.0 },
      amber: { op: ">=", value: 1.5 },
      red: { op: "<", value: 1.5 },
    },
    hintTemplateEn:
      "Wholesale eggs at {value} USD/dozen (USDA). <$1.50 = layer-operation margin pressure.",
    hintTemplateAz:
      "Yumurtanın topdansatış qiyməti {value} USD/duzin (USDA). <1,50 $ yumurtalıq təsərrüfatının marjasına təzyiq deməkdir.",
    hintTemplateRu:
      "Оптовая цена яйца — {value} USD за дюжину (USDA). Ниже $1,50 — давление на маржу яичного направления.",
    requiredInputs: ["commodityPrice:egg_price_latest"],
    sortOrder: 827,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // FOOD PROCESSING — FAO + grain inputs
  // ──────────────────────────────────────────────────────────────────
  {
    code: "FP_FAO_FOOD_INDEX_SIGNAL",
    nameEn: "FAO Food Price Index Signal",
    nameAz: "FAO Qida Qiymət İndeksi siqnalı",
    nameRu: "Сигнал индекса цен FAO",
    category: "commodity",
    industries: ["food_processing"],
    unit: "index",
    direction: "lower_better",
    formula: "fao_ffpi_latest",
    thresholds: {
      green: { op: "<=", value: 120 },
      amber: { op: "<=", value: 140 },
      red: { op: ">", value: 140 },
    },
    hintTemplateEn:
      "FAO Food Price Index {value}. >140 = global food inflation pressure — passes through to all food processors' input costs.",
    hintTemplateAz:
      "FAO Ərzaq Qiymət İndeksi {value}. >140 qlobal ərzaq inflyasiyası təzyiqidir — bütün qida emalı müəssisələrinin xammal xərcinə keçir.",
    hintTemplateRu:
      "Индекс продовольственных цен FAO — {value}. Выше 140 — давление мировой продовольственной инфляции, которое переходит в стоимость сырья всех пищевых производств.",
    requiredInputs: ["commodityPrice:fao_ffpi_latest"],
    sortOrder: 875,
    defaultValueSource: "macro",
  },
  {
    code: "FP_WHEAT_PRICE_SIGNAL",
    nameEn: "Wheat Price Signal",
    nameAz: "Buğda qiymət siqnalı",
    nameRu: "Сигнал цены пшеницы",
    category: "commodity",
    industries: ["food_processing"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "wheat_price_latest",
    thresholds: {
      green: { op: "<=", value: 250 },
      amber: { op: "<=", value: 320 },
      red: { op: ">", value: 320 },
    },
    hintTemplateEn:
      "Wheat at {value} USD/tonne. >$320/t pressures bakery + milling input cost.",
    hintTemplateAz:
      "Buğda {value} USD/ton. >320 $/ton çörək-bulka və dəyirman xammalının xərcinə təzyiq edir.",
    hintTemplateRu:
      "Пшеница — {value} USD/т. Выше $320/т давит на стоимость сырья хлебопечения и мукомольного производства.",
    requiredInputs: ["commodityPrice:wheat_price_latest"],
    sortOrder: 876,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // BEVERAGE — sugar + AZ food CPI
  // ──────────────────────────────────────────────────────────────────
  {
    code: "BEV_FAO_SUGAR_INDEX_SIGNAL",
    nameEn: "FAO Sugar Index Signal",
    nameAz: "FAO Şəkər indeksi siqnalı",
    nameRu: "Сигнал индекса сахара FAO",
    category: "commodity",
    industries: ["beverage"],
    unit: "index",
    direction: "lower_better",
    formula: "fao_sugar_latest",
    thresholds: {
      green: { op: "<=", value: 110 },
      amber: { op: "<=", value: 140 },
      red: { op: ">", value: 140 },
    },
    hintTemplateEn:
      "FAO Sugar sub-index {value}. >140 = sugar pricing pressure — review syrup cost in carbonated beverage formulas.",
    hintTemplateAz:
      "FAO Şəkər alt-indeksi {value}. >140 şəkər qiyməti təzyiqidir — qazlı içki reseptlərindəki siropun maya dəyərini nəzərdən keçirin.",
    hintTemplateRu:
      "Субиндекс сахара FAO — {value}. Выше 140 — ценовое давление по сахару: пересмотрите стоимость сиропа в рецептурах газированных напитков.",
    requiredInputs: ["commodityPrice:fao_sugar_latest"],
    sortOrder: 955,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // RETAIL — food CPI + search trends
  // ──────────────────────────────────────────────────────────────────
  {
    code: "RET_AZ_FOOD_CPI_PRESSURE",
    nameEn: "AZ Food CPI Pressure",
    nameAz: "AZ Ərzaq İPI təzyiqi",
    nameRu: "Давление ИПЦ продовольствия AZ",
    category: "macro",
    industries: ["retail"],
    unit: "index",
    direction: "lower_better",
    formula: "az_cpi_food_latest",
    thresholds: {
      green: { op: "<=", value: 105 },
      amber: { op: "<=", value: 115 },
      red: { op: ">", value: 115 },
    },
    hintTemplateEn:
      "AZ food CPI at {value}. >115 = staples inflation pressure on retail margins; <105 = stable consumer-cost environment.",
    hintTemplateAz:
      "AZ ərzaq istehlak qiymətləri indeksi {value}. >115 əsas ərzaq inflyasiyasının pərakəndə marjasına təzyiqidir; <105 sabit istehlak xərci mühitidir.",
    hintTemplateRu:
      "ИПЦ продовольствия AZ — {value}. Выше 115 — инфляция базовых продуктов давит на маржу ритейла; ниже 105 — стабильная стоимость потребительской корзины.",
    requiredInputs: ["commodityPrice:az_cpi_food_latest"],
    sortOrder: 975,
    defaultValueSource: "macro",
  },
  {
    code: "RET_TREND_FOOD_SIGNAL",
    nameEn: "Food Retail Search Demand",
    nameAz: "Ərzaq pərakəndə axtarış tələbi",
    nameRu: "Поисковый спрос на продукты",
    category: "macro",
    industries: ["retail"],
    unit: "index",
    direction: "higher_better",
    formula: "az_trend_food_latest",
    thresholds: DEMAND_SIGNAL,
    hintTemplateEn:
      "Google Trends food-retail interest {value}/100. <80 = consumer demand softening; ≥100 = strong demand window.",
    hintTemplateAz:
      "Google Trends-də ərzaq pərakəndəsinə maraq {value}/100. <80 istehlak tələbinin zəifləməsi; ≥100 güclü tələb pəncərəsidir.",
    hintTemplateRu:
      "Интерес к продуктовому ритейлу по Google Trends — {value}/100. Ниже 80 — ослабление потребительского спроса; ≥100 — окно сильного спроса.",
    requiredInputs: ["commodityPrice:az_trend_food_latest"],
    sortOrder: 976,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // EDUCATION — demographic
  // ──────────────────────────────────────────────────────────────────
  {
    code: "EDU_POPULATION_0_14_SIGNAL",
    nameEn: "AZ Population Age 0-14 Signal",
    nameAz: "0-14 yaş əhali siqnalı",
    nameRu: "Сигнал населения 0–14 лет AZ",
    category: "macro",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "az_pop_age_0_14_latest",
    thresholds: {
      green: { op: ">=", value: 23 },
      amber: { op: ">=", value: 20 },
      red: { op: "<", value: 20 },
    },
    hintTemplateEn:
      "AZ population age 0-14 at {value}% of total. <20% signals long-term enrollment shrinkage; ≥23% = healthy student cohort.",
    hintTemplateAz:
      "Azərbaycanda 0-14 yaş əhalisi ümumi əhalinin {value}%-idir. <20% uzunmüddətli qəbul azalmasının siqnalıdır; ≥23% sağlam şagird kontingentidir.",
    hintTemplateRu:
      "Население Азербайджана 0-14 лет — {value}% от общего. Ниже 20% — сигнал долгосрочного сокращения набора; ≥23% — здоровая когорта учащихся.",
    requiredInputs: ["commodityPrice:az_pop_age_0_14_latest"],
    sortOrder: 1025,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // ENTERTAINMENT — travel demand
  // ──────────────────────────────────────────────────────────────────
  {
    code: "ENT_TRAVEL_DEMAND_SIGNAL",
    nameEn: "AZ Travel Search Demand",
    nameAz: "Səyahət axtarış tələbi",
    nameRu: "Поисковый спрос на путешествия",
    category: "macro",
    industries: ["entertainment", "hospitality"],
    unit: "index",
    direction: "higher_better",
    formula: "az_trend_travel_latest",
    thresholds: DEMAND_SIGNAL,
    hintTemplateEn:
      "Google Trends travel interest {value}/100. Forward demand signal for events + hospitality; ≥100 = high travel-search activity.",
    hintTemplateAz:
      "Google Trends-də səyahət marağı {value}/100. Tədbirlər və qonaqpərvərlik üçün irəliyə baxan tələb siqnalıdır; ≥100 yüksək səyahət axtarışı aktivliyidir.",
    hintTemplateRu:
      "Интерес к путешествиям по Google Trends — {value}/100. Опережающий сигнал спроса для событийной индустрии и гостеприимства; ≥100 — высокая активность поиска поездок.",
    requiredInputs: ["commodityPrice:az_trend_travel_latest"],
    sortOrder: 1055,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // SERVICES — trade balance
  // ──────────────────────────────────────────────────────────────────
  {
    code: "SERV_AZ_TRADE_BALANCE_SIGNAL",
    nameEn: "AZ Trade Balance Signal",
    nameAz: "AZ ticarət balansı siqnalı",
    nameRu: "Сигнал торгового баланса AZ",
    category: "macro",
    industries: ["services", "logistics"],
    unit: "USD",
    direction: "higher_better",
    formula: "az_trade_balance_latest",
    thresholds: {
      green: { op: ">=", value: 10_000_000_000 },
      amber: { op: ">=", value: 0 },
      red: { op: "<", value: 0 },
    },
    hintTemplateEn:
      "AZ trade balance {value} USD (annual). Negative = import-dependent; ≥$10B = strong export economy supporting services demand.",
    hintTemplateAz:
      "Azərbaycanın ticarət balansı {value} USD (illik). Mənfi göstərici idxaldan asılılıqdır; ≥10 mlrd $ xidmətlərə tələbi dəstəkləyən güclü ixrac iqtisadiyyatıdır.",
    hintTemplateRu:
      "Торговый баланс Азербайджана — {value} USD (годовой). Отрицательный — зависимость от импорта; ≥$10 млрд — сильная экспортная экономика, поддерживающая спрос на услуги.",
    requiredInputs: ["commodityPrice:az_trade_balance_latest"],
    sortOrder: 1105,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // AGRO — forward weather
  // ──────────────────────────────────────────────────────────────────
  {
    code: "AGRO_SALYAN_RAINFALL_14D_FCST",
    nameEn: "Salyan 14-Day Rainfall Forecast",
    nameAz: "Salyan 14 günlük yağıntı proqnozu",
    nameRu: "Прогноз осадков Salyan 14 дн",
    category: "macro",
    industries: ["agro_crops"],
    unit: "mm",
    direction: "higher_better",
    formula: "salyan_rainfall_forecast_14d",
    thresholds: {
      green: { op: ">=", value: 30 },
      amber: { op: ">=", value: 10 },
      red: { op: "<", value: 10 },
    },
    hintTemplateEn:
      "Salyan 14-day rainfall forecast {value} mm. <10mm = irrigation pressure for cane fields; ≥30mm = good moisture window.",
    hintTemplateAz:
      "Salyan üzrə 14 günlük yağıntı proqnozu {value} mm. <10 mm şəkər qamışı sahələri üçün suvarma təzyiqi; ≥30 mm yaxşı rütubət pəncərəsidir.",
    hintTemplateRu:
      "Прогноз осадков по Сальяну на 14 дней — {value} мм. Менее 10 мм — нагрузка на орошение плантаций тростника; ≥30 мм — хорошее окно влагообеспеченности.",
    // Maps via COMMODITY_PRICE_ALIASES → openmeteo-forecast source +
    // SALYAN_RAINFALL_MM_14D_FCST metric. Uses commodityPrice
    // namespace because we don't have a dedicated `weather:` resolver
    // for forecast metrics (only the historical-archive weatherResolver).
    requiredInputs: ["commodityPrice:salyan_rainfall_forecast_14d"],
    sortOrder: 1155,
    defaultValueSource: "macro",
  },
  // Phase 7.K Phase 5b sentinel — used by tests to verify the pack
  // landed and is in the correct ALL_INDICATOR_SEEDS slot.
  {
    code: "FP_GRAIN_COST_PRESSURE_BLEND",
    nameEn: "Grain Cost Pressure Blend",
    nameAz: "Dənli yem qarışıq xərc təzyiqi",
    nameRu: "Давление совокупной цены зерна",
    category: "commodity",
    industries: ["food_processing", "poultry"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "(corn_price_latest + wheat_price_latest) / 2",
    thresholds: {
      green: { op: "<=", value: 230 },
      amber: { op: "<=", value: 320 },
      red: { op: ">", value: 320 },
    },
    hintTemplateEn:
      "Blended corn+wheat mid-point at {value} USD/tonne. >$320/t = grain input cost stress for processors + integrated poultry.",
    hintTemplateAz:
      "Qarğıdalı və buğdanın orta qiyməti {value} USD/ton. >320 $/ton emalçılar və inteqrasiya olunmuş quşçuluq üçün taxıl xammalı xərci stressidir.",
    hintTemplateRu:
      "Средняя цена связки кукуруза+пшеница — {value} USD/т. Выше $320/т — стресс по стоимости зернового сырья для переработчиков и интегрированного птицеводства.",
    requiredInputs: [
      "commodityPrice:corn_price_latest",
      "commodityPrice:wheat_price_latest",
    ],
    sortOrder: 877,
    defaultValueSource: "macro",
  },
]

// Suppress unused-warning on the helper threshold templates above —
// they're declared at the top of the file to keep seeds DRY but TS
// won't see usage if only some seeds reference them.
void PRESSURE
