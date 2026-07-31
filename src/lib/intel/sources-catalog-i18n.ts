/**
 * EN + AZ translations for the Data Sources Catalog card prose.
 *
 * The catalog (`sources-catalog.ts`) stores prose Russian-only (`whatItIsRu`,
 * `businessValueRu`, `sampleLatest.interpretation`, `cadenceRu`) and is read by
 * adapters by `sourceCode`, so we DON'T touch it. Instead this map carries the
 * localized prose keyed by `sourceCode`, and `localizedSource()` picks the right
 * language for the View. RU comes from the catalog; EN + AZ from here (AZ
 * authored 2026-06-04 — previously AZ fell back to EN).
 *
 * Fixes "the English UI showed Russian card text" (2026-06-01) +
 * "the AZ UI showed English source prose" (2026-06-04).
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
    displayName: {
      en: "CBAR Official FX",
      az: "CBAR · rəsmi valyuta məzənnələri",
    },
    whatItIs: {
      en: "Official daily AZN exchange rates against 6 currencies (USD, EUR, RUB, TRY, GBP, CNY), published by the CBAR at cbar.az.",
      az: "CBAR tərəfindən cbar.az saytında dərc olunan, 6 valyutaya (USD, EUR, RUB, TRY, GBP, CNY) qarşı rəsmi gündəlik AZN məzənnələri.",
    },
    businessValue: {
      en: "Every holding company with imports or exports books revenue and cost of goods in AZN through these rates. A 1% move in AZN/USD means ~$200K of difference per quarter for an import-dependent company.",
      az: "İdxalı və ya ixracı olan hər holdinq şirkəti gəliri və malların maya dəyərini bu məzənnələrlə AZN-də uçota alır. AZN/USD-də 1% dəyişiklik idxaldan asılı şirkət üçün rübdə ~$200K fərq deməkdir.",
    },
    interpretation: {
      en: "AZN/USD runs on a peg. A sharp move >2% is an FX-shock signal for pharma importers.",
      az: "AZN/USD bağlı (peg) rejimdə işləyir. >2% kəskin hərəkət əczaçılıq idxalçıları üçün FX-şok siqnalıdır.",
    },
    cadence: { en: "daily (business days)", az: "gündəlik (iş günləri)" },
  },
  "eia-energy": {
    displayName: {
      en: "US EIA Energy",
      az: "ABŞ EIA · neft və təbii qaz",
    },
    whatItIs: {
      en: "Benchmark world prices: Brent (crude, ICE), WTI (crude, NYMEX), Henry Hub (natural gas, NYMEX). A U.S. government agency — the most authoritative official price in the world.",
      az: "Bençmark dünya qiymətləri: Brent (xam neft, ICE), WTI (xam neft, NYMEX), Henry Hub (təbii qaz, NYMEX). ABŞ dövlət qurumu — dünyada ən nüfuzlu rəsmi qiymət.",
    },
    businessValue: {
      en: "Brent is the base oil price for logistics (diesel), manufacturing (electricity) and food processing (packaging, raw-material transport). Gas drives the cost of heating plants and LNG imports.",
      az: "Brent logistika (dizel), istehsal (elektrik) və qida emalı (qablaşdırma, xammal daşınması) üçün baza neft qiymətidir. Qaz istilik stansiyalarının və LNG idxalının xərcini müəyyən edir.",
    },
    interpretation: {
      en: "Brent sustained above $80–100 — pressure on the margins of logistics and industrial companies (fuel, packaging, transport).",
      az: "Brent davamlı olaraq $80–100-dən yuxarı — logistika və sənaye şirkətlərinin marjasına təzyiq (yanacaq, qablaşdırma, daşıma).",
    },
    cadence: { en: "monthly (some series weekly)", az: "aylıq (bəzi seriyalar həftəlik)" },
  },
  "fao-food-prices": {
    displayName: {
      en: "FAO Food Price Index",
      az: "FAO · BMT Ərzaq Qiymət İndeksi",
    },
    whatItIs: {
      en: "Monthly index of world food prices, split into 5 categories: meat, dairy, cereals, vegetable oils, sugar. Base 2014-2016=100.",
      az: "Dünya ərzaq qiymətlərinin aylıq indeksi, 5 kateqoriyaya bölünür: ət, süd, taxıl, bitki yağları, şəkər. Baza 2014-2016=100.",
    },
    businessValue: {
      en: "An index above 130 = a global food crisis, with worldwide procurement prices up ~10-15% YoY. AZSEKER-AZSF / CPC / MALT pay for imported raw materials at these prices.",
      az: "130-dan yuxarı indeks = qlobal ərzaq böhranı, dünya üzrə tədarük qiymətləri illik ~10-15% artıb. AZSEKER-AZSF / CPC / MALT idxal xammalını bu qiymətlərlə ödəyir.",
    },
    interpretation: {
      en: "Index above 130 (2014-2016 base=100) → 🟡 elevated pressure on food-processing procurement prices.",
      az: "130-dan yuxarı indeks (2014-2016 baza=100) → 🟡 qida emalı tədarük qiymətlərinə artan təzyiq.",
    },
    cadence: { en: "monthly (first Friday)", az: "aylıq (ilk cümə)" },
  },
  "yahoo-grains": {
    displayName: {
      en: "Yahoo Finance Grains",
      az: "Yahoo Finance · taxıl və pambıq fyuçersləri",
    },
    whatItIs: {
      en: "Front-month futures for 5 crops: corn (ZC), wheat (ZW), soybeans (ZS), oats (ZO, a barley proxy), cotton (CT). Converted to USD/tonne.",
      az: "5 bitki üzrə cari-ay fyuçersləri: qarğıdalı (ZC), buğda (ZW), soya (ZS), yulaf (ZO, arpa proksisi), pambıq (CT). USD/tona çevrilir.",
    },
    businessValue: {
      en: "Grain is the main raw input for food processing (flour, feed) and poultry farms. Soy/cotton signal demand for livestock feed and consumer demand for textiles.",
      az: "Taxıl qida emalının (un, yem) və quş fermalarının əsas xammalıdır. Soya/pambıq heyvandarlıq yemi və tekstil istehlak tələbini siqnal verir.",
    },
    interpretation: {
      en: "Wheat below the $250/t threshold → 🟢 a good window to buy flour 6 months forward.",
      az: "Buğda $250/t həddindən aşağı → 🟢 unu 6 ay irəli almaq üçün yaxşı pəncərə.",
    },
    cadence: { en: "monthly (daily also available when needed)", az: "aylıq (lazım olduqda gündəlik də mümkündür)" },
  },
  "yahoo-metals": {
    displayName: {
      en: "Yahoo Finance Metals + Lumber",
      az: "Yahoo Finance · birja metalları və oduncaq",
    },
    whatItIs: {
      en: "Front-month futures: copper HG (electrical, wiring), aluminum ALI (packaging), steel HRC (construction, metalwork), lumber LBR (construction). Converted to USD/tonne.",
      az: "Cari-ay fyuçersləri: mis HG (elektrik, naqil), alüminium ALI (qablaşdırma), polad HRC (tikinti, metal işləri), oduncaq LBR (tikinti). USD/tona çevrilir.",
    },
    businessValue: {
      en: "Copper and aluminum are raw inputs for ATL (pipes, polyethylene, metalworking). Steel and lumber drive construction cost and real-estate prices.",
      az: "Mis və alüminium ATL üçün xammaldır (borular, polietilen, metal emalı). Polad və oduncaq tikinti xərcini və daşınmaz əmlak qiymətlərini müəyyən edir.",
    },
    interpretation: {
      en: "Copper above the $11k/t threshold → 🔴 high raw-material pressure. ATL-DBZ / ATL-PMZ / ZTP buy copper at high prices.",
      az: "Mis $11k/t həddindən yuxarı → 🔴 yüksək xammal təzyiqi. ATL-DBZ / ATL-PMZ / ZTP misi yüksək qiymətə alır.",
    },
    cadence: { en: "monthly", az: "aylıq" },
  },
  "yahoo-fuel-bdi": {
    displayName: {
      en: "Yahoo Fuel + Baltic Dry Index",
      az: "Yahoo · yanacaq və dəniz fraxtı (Baltic Dry)",
    },
    whatItIs: {
      en: "Diesel (HO, ULSD), gasoline (RB, RBOB), and the BDRY maritime-freight index (tracks the Baltic Dry Index via 3-month rolling Capesize/Panamax/Supramax futures).",
      az: "Dizel (HO, ULSD), benzin (RB, RBOB) və BDRY dəniz-fraxt indeksi (3 aylıq rolling Capesize/Panamax/Supramax fyuçersləri ilə Baltic Dry Index-i izləyir).",
    },
    businessValue: {
      en: "Diesel fuels logistics trucking (LLS); gasoline fuels the passenger fleet. The BDI is the world cost of shipping bulk cargo (grain, metal, coal) by sea; it rises when global trade picks up.",
      az: "Dizel logistika yük daşımalarını (LLS) işlədir; benzin sərnişin parkını. BDI dənizlə yük (taxıl, metal, kömür) daşımanın dünya xərcidir; qlobal ticarət canlananda yüksəlir.",
    },
    interpretation: {
      en: "Diesel above the $0.90/L threshold → 🔴 direct pressure on LLS logistics margins.",
      az: "Dizel $0.90/L həddindən yuxarı → 🔴 LLS logistika marjasına birbaşa təzyiq.",
    },
    cadence: { en: "monthly", az: "aylıq" },
  },
  "openmeteo-forecast": {
    displayName: {
      en: "Open-Meteo 14-Day Forecast",
      az: "Open-Meteo · 14 günlük hava proqnozu",
    },
    whatItIs: {
      en: "14-day forecast: daily rainfall (mm), average and maximum temperature for 8 Azerbaijani regions (Salyan, Imishli, Sabirabad, Yevlakh, Shamkir, Fizuli, Aghjabadi, Beylagan).",
      az: "14 günlük proqnoz: 8 Azərbaycan rayonu (Salyan, İmişli, Sabirabad, Yevlax, Şəmkir, Füzuli, Ağcabədi, Beyləqan) üçün gündəlik yağıntı (mm), orta və maksimum temperatur.",
    },
    businessValue: {
      en: "EDEN/FARM — Azərşəkər farms sow sugar beet and grain in these regions. A rainfall forecast <10mm = threat to the harvest; >30mm = good moisture. It also shifts hospitality demand (tourism in a hot week).",
      az: "EDEN/FARM — Azərşəkər fermaları bu rayonlarda şəkər çuğunduru və taxıl əkir. Yağıntı proqnozu <10mm = məhsula təhlükə; >30mm = yaxşı rütubət. Həmçinin qonaqpərvərlik tələbini dəyişir (isti həftədə turizm).",
    },
    interpretation: {
      en: "Salyan rainfall forecast: >30mm over 14 days → 🟢 sufficient moisture for beet; <10mm → harvest threat.",
      az: "Salyan yağıntı proqnozu: 14 gündə >30mm → 🟢 çuğundur üçün kifayət rütubət; <10mm → məhsul təhlükəsi.",
    },
    cadence: { en: "daily", az: "gündəlik" },
  },
  "az-stat-cpi": {
    displayName: {
      en: "AZ State Statistics CPI",
      az: "AZ Dövlət Statistika Komitəsi · istehlak qiymətləri indeksi",
    },
    whatItIs: {
      en: "Monthly consumer price index (base 2010=100) split into 4 categories: all items, food + beverages + tobacco, non-food, paid services. Downloaded as XLSX from stat.gov.az.",
      az: "Aylıq istehlak qiymətləri indeksi (baza 2010=100), 4 kateqoriyaya bölünür: bütün mallar, ərzaq + içki + tütün, qeyri-ərzaq, ödənişli xidmətlər. stat.gov.az-dan XLSX kimi yüklənir.",
    },
    businessValue: {
      en: "A direct inflation benchmark for indexing the holding's product prices. Food CPI > 105% YoY = you can raise selling prices ~5% without losing competitiveness. Services drive hiring cost + office-rent pressure.",
      az: "Holdinqin məhsul qiymətlərini indeksləmək üçün birbaşa inflyasiya bençmarkı. Ərzaq CPI > illik 105% = rəqabətqabiliyyətini itirmədən satış qiymətlərini ~5% qaldıra bilərsən. Xidmətlər işə götürmə xərcini + ofis icarə təzyiqini müəyyən edir.",
    },
    interpretation: {
      en: "Food CPI above 105% YoY → 🟡 retail can lift price tags without risking traffic loss; food processing gets the same headroom.",
      az: "Ərzaq CPI illik 105%-dən yuxarı → 🟡 pərakəndə trafik itirmədən qiymət qaldıra bilər; qida emalı da eyni imkanı alır.",
    },
    cadence: { en: "monthly (~14th of the following month)", az: "aylıq (növbəti ayın ~14-də)" },
  },
  "un-comtrade-az": {
    displayName: {
      en: "UN Comtrade — Azerbaijan",
      az: "UN Comtrade · Azərbaycanın ixracı və idxalı",
    },
    whatItIs: {
      en: "Annual official statistics of Azerbaijan's merchandise exports/imports. The source for the trade balance, which the UN aggregates from the country's state statistics.",
      az: "Azərbaycanın əmtəə ixrac/idxalının illik rəsmi statistikası. BMT-nin ölkə dövlət statistikasından topladığı ticarət balansının mənbəyi.",
    },
    businessValue: {
      en: "The trade balance is a macro signal for every import-dependent holding business (food processing, pharma, retail). A sharp drop in the surplus = AZN under pressure = currency risk.",
      az: "Ticarət balansı hər idxaldan asılı holdinq biznesi (qida emalı, əczaçılıq, pərakəndə) üçün makro siqnaldır. Profisitin kəskin düşməsi = AZN təzyiq altında = valyuta riski.",
    },
    interpretation: {
      en: "Comtrade preview data may show a negative balance due to a publication lag (not all oil counted yet). We'll re-read it once the UN catches the data up.",
      az: "Comtrade ilkin məlumatları dərc gecikməsi səbəbindən mənfi balans göstərə bilər (hələ bütün neft sayılmayıb). BMT məlumatı tamamladıqda yenidən oxuyacağıq.",
    },
    cadence: { en: "annual (2-3 quarter lag)", az: "illik (2-3 rüb gecikmə)" },
  },
  "wb-indicators": {
    displayName: {
      en: "World Bank Indicators",
      az: "Dünya Bankı · Azərbaycan üzrə turizm və təhsil",
    },
    whatItIs: {
      en: "Annual AZ macro indicators from the World Bank database: international tourism (arrivals + spending + receipts), education (secondary-school enrollment, government spending, % of population aged 0-14).",
      az: "Dünya Bankı bazasından illik AZ makro göstəriciləri: beynəlxalq turizm (gəlişlər + xərclər + gəlirlər), təhsil (orta məktəbə qəbul, dövlət xərcləri, 0-14 yaş əhalinin %-i).",
    },
    businessValue: {
      en: "Tourism drives hospitality (Hilton, Marriott, Four Seasons) and entertainment (concerts, F1, Crystal Hall). Education is the addressable market for private universities (ADA, Khazar) + children's retail.",
      az: "Turizm qonaqpərvərliyi (Hilton, Marriott, Four Seasons) və əyləncəni (konsertlər, F1, Crystal Hall) müəyyən edir. Təhsil özəl universitetlər (ADA, Xəzər) + uşaq pərakəndəsi üçün hədəf bazardır.",
    },
    interpretation: {
      en: "Tourist arrivals below the pre-COVID ~3.2M/year → 🔴 hospitality still in a recovery zone.",
      az: "Turist gəlişləri COVID-dən əvvəlki ~3.2M/il-dən aşağı → 🔴 qonaqpərvərlik hələ bərpa zonasında.",
    },
    cadence: { en: "annual (1-2 year lag)", az: "illik (1-2 il gecikmə)" },
  },
  "usda-nass": {
    displayName: {
      en: "USDA NASS Quick Stats",
      az: "USDA · ABŞ quşçuluğunun topdansatış qiymətləri",
    },
    whatItIs: {
      en: "Monthly/weekly wholesale prices: broilers ($/lb), eggs ($/doz), chick placements. The U.S. is the global benchmark; local AZ prices lag by 4-6 weeks.",
      az: "Aylıq/həftəlik topdan qiymətlər: broyler ($/lb), yumurta ($/düjün), cücə yerləşdirmələri. ABŞ qlobal bençmarkdır; yerli AZ qiymətləri 4-6 həftə gecikir.",
    },
    businessValue: {
      en: "Broiler $/lb is a leading indicator for AZ poultry (Azersun, Gilan Quba). A U.S. drop below $1/lb predicts a demand-side shock in AZ within 1-2 months. Feed-chicks are the production pipeline.",
      az: "Broyler $/lb AZ quşçuluğu (Azersun, Gilan Quba) üçün qabaqcıl göstəricidir. ABŞ-da $1/lb-dən aşağı düşmə 1-2 ay ərzində AZ-də tələb şokunu proqnozlaşdırır. Yem-cücələr istehsal boru kəməridir.",
    },
    interpretation: {
      en: "Broiler below the $1.00/lb threshold → 🔴 margin-compression risk for poultry farms (AZ with a ~2-month lag).",
      az: "Broyler $1.00/lb həddindən aşağı → 🔴 quş fermaları üçün marja sıxılması riski (AZ-də ~2 ay gecikmə ilə).",
    },
    cadence: { en: "monthly + some series weekly", az: "aylıq + bəzi seriyalar həftəlik" },
  },
  "google-trends-az": {
    displayName: {
      en: "Google Trends Azerbaijan (via Scrapingdog proxy)",
      az: "Google Trends · Azərbaycanda axtarış tələbi",
    },
    whatItIs: {
      en: "Normalized 0-100 search-interest index across 4 categories: food (yemək/grocery), apparel (moda/fashion), electronics (iPhone/electronics), tourism (tour/travel) — geo:AZ.",
      az: "4 kateqoriya üzrə normallaşdırılmış 0-100 axtarış-maraq indeksi: ərzaq (yemək/grocery), geyim (moda/fashion), elektronika (iPhone/electronics), turizm (tur/travel) — geo:AZ.",
    },
    businessValue: {
      en: "Search demand is the earliest leading indicator of consumer behavior. A 30% drop in the food trend in a month = retail sales fall within 2-4 weeks. The travel trend leads hospitality bookings by ~30 days.",
      az: "Axtarış tələbi istehlakçı davranışının ən erkən qabaqcıl göstəricisidir. Ay ərzində ərzaq trendində 30% düşmə = 2-4 həftə ərzində pərakəndə satışların düşməsi. Səyahət trendi qonaqpərvərlik rezervasiyalarını ~30 gün qabaqlayır.",
    },
    interpretation: {
      en: "Food search interest below 80 → 🔴 expect weak grocery-store traffic over the next 2-4 weeks.",
      az: "Ərzaq axtarış marağı 80-dən aşağı → 🔴 növbəti 2-4 həftədə zəif baqqal trafiki gözlə.",
    },
    cadence: { en: "weekly", az: "həftəlik" },
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
