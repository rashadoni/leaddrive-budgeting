/**
 * Phase 7.H F4.v2.4 — SASB-style ESG materiality matrix.
 *
 * Today every company sees the same 5 ESG indicators (Scope 1/2/3 +
 * composite + macro). For a software-services company, Scope 1 direct
 * emissions are essentially zero (we already model this with
 * services=0.02 in industry-emission-factors.ts), but the cell still
 * shows green at the same visual weight as a load-bearing metric.
 * Result: heatmap noise.
 *
 * Materiality fixes the visual layer without changing the data:
 *  - `material` (default)    — full visual presence, status color, badge
 *  - `low_materiality`       — dimmed to ~30% opacity in HeatMap, soft
 *                              "LOW MATERIALITY" badge in Panel 3.
 *                              Still drill-downable.
 *  - `not_material`          — 12% opacity, no status color, "NOT
 *                              MATERIAL" badge. Effectively says
 *                              "this metric doesn't apply to this
 *                              sector — ignore the value." Still
 *                              visible so analyst can confirm it's
 *                              hidden intentionally (not missing).
 *
 * **Calibration**: SASB Materiality Map cross-referenced with MSCI ESG
 * Industry Materiality framework. Most ESG/financial cells default to
 * `material`; this module ONLY enumerates overrides. Defensive default
 * = `material` so a new indicator/sector pair doesn't accidentally
 * hide.
 *
 * Pure module — no DB, no Prisma. Imported by the matrix API +
 * IndicatorDetail UI. Tests at `esg-materiality.test.ts` lock the
 * SASB calibration so a future contributor can't silently flip
 * services × Scope 1 from `not_material` → `material` (which would
 * re-introduce the heatmap noise the v2.4 was built to remove).
 */

export type MaterialityRating = "material" | "low_materiality" | "not_material";

/**
 * Per-(industry, indicatorCode) override. Absent entries default to
 * `material` (full visual presence). The matrix is sparse on purpose —
 * the override list is shorter than the full Cartesian product, and a
 * sparse default-material approach means we don't accidentally hide
 * cells when a new indicator lands without a materiality call.
 */
interface MaterialityOverride {
  industry: string;
  indicatorCode: string;
  rating: MaterialityRating;
  /** Short calibration note — surfaces in the Indicator Detail materiality
   *  tooltip, which a client-facing AZ/RU operator reads. `note` is the EN
   *  fallback; `noteAz` / `noteRu` are the localized forms. */
  note: string;
  noteAz?: string;
  noteRu?: string;
}

/**
 * SASB-style materiality calibration for our 14 industries × 5 ESG
 * indicators. Only `low_materiality` and `not_material` entries are
 * listed — everything else defaults to `material`.
 *
 * Source: SASB Materiality Finder (https://sasb.ifrs.org/standards/materiality-finder/)
 *         + MSCI ESG Industry Materiality Map 2023.
 *
 * Logic:
 *  - Software services / consulting / education → Scope 1 effectively
 *    zero (no direct combustion); Scope 3 supply chain irrelevant
 *    (no physical product). Mark `not_material`.
 *  - Entertainment / venue ops → Scope 1 minimal (no production heat);
 *    Scope 3 light (no physical supply chain). `low_materiality`.
 *  - Real estate / retail → Scope 1 minimal (no production heat —
 *    building HVAC dominates). `low_materiality`.
 *  - Government climate macro indicator → never company-specific;
 *    `low_materiality` everywhere except resource-heavy sectors
 *    (industrial, construction, agro, poultry, logistics) where AZ
 *    policy directly impacts ops.
 */
export const ESG_MATERIALITY_OVERRIDES: readonly MaterialityOverride[] = [
  // --- services: low-physical sector ---------------------------------
  {
    industry: "services",
    indicatorCode: "IND_CARBON_SCOPE_1",
    rating: "not_material",
    note: "No direct combustion / production heat. Scope 1 effectively zero.",
    noteAz: "Birbaşa yanma / istehsalat istiliyi yoxdur. Scope 1 faktiki olaraq sıfırdır.",
    noteRu: "Прямого сжигания и технологического тепла нет. Scope 1 фактически нулевой.",
  },
  {
    industry: "services",
    indicatorCode: "IND_CARBON_SCOPE_3",
    rating: "low_materiality",
    note: "Supply chain limited to office goods + business travel. Low relative to financial metrics.",
    noteAz: "Təchizat zənciri ofis malları və işgüzar səfərlərlə məhdudlaşır. Maliyyə göstəriciləri ilə müqayisədə aşağı əhəmiyyətlidir.",
    noteRu: "Цепочка поставок ограничена офисными товарами и командировками. Низкая значимость по сравнению с финансовыми показателями.",
  },

  // --- education ------------------------------------------------------
  {
    industry: "education",
    indicatorCode: "IND_CARBON_SCOPE_1",
    rating: "not_material",
    note: "Campus operations dominated by purchased electricity (Scope 2), not direct combustion.",
    noteAz: "Kampus əməliyyatlarında birbaşa yanma deyil, satın alınan elektrik enerjisi (Scope 2) üstünlük təşkil edir.",
    noteRu: "В работе кампуса преобладает закупаемая электроэнергия (Scope 2), а не прямое сжигание.",
  },
  {
    industry: "education",
    indicatorCode: "IND_CARBON_SCOPE_3",
    rating: "low_materiality",
    note: "Limited physical supply chain (textbooks, food service). Not a primary materiality driver.",
    noteAz: "Fiziki təchizat zənciri məhduddur (dərsliklər, iaşə). Əsas maddilik amili deyil.",
    noteRu: "Физическая цепочка поставок ограничена (учебники, питание). Не является ключевым фактором существенности.",
  },

  // --- entertainment --------------------------------------------------
  {
    industry: "entertainment",
    indicatorCode: "IND_CARBON_SCOPE_1",
    rating: "low_materiality",
    note: "Venue HVAC + lighting dominates electricity (Scope 2); direct combustion limited.",
    noteAz: "Məkanın iqlim sistemi və işıqlandırması elektrik istehlakında üstünlük təşkil edir (Scope 2); birbaşa yanma məhduddur.",
    noteRu: "В электропотреблении преобладают вентиляция/кондиционирование и освещение площадки (Scope 2); прямое сжигание ограничено.",
  },
  {
    industry: "entertainment",
    indicatorCode: "IND_CARBON_SCOPE_3",
    rating: "low_materiality",
    note: "Visitor travel + concessions — moderate supply chain footprint.",
    noteAz: "Qonaqların səyahəti və satış nöqtələri — təchizat zəncirinin izi ortadır.",
    noteRu: "Поездки посетителей и точки общепита — умеренный след цепочки поставок.",
  },

  // --- real_estate ----------------------------------------------------
  {
    industry: "real_estate",
    indicatorCode: "IND_CARBON_SCOPE_1",
    rating: "low_materiality",
    note: "Building boilers + heating (limited). Scope 2 (tenant electricity) is the primary metric.",
    noteAz: "Binanın qazanxanaları və istilik sistemi (məhdud). Əsas göstərici Scope 2-dir (icarəçilərin elektrik enerjisi).",
    noteRu: "Котельные и отопление здания (ограниченно). Основной показатель — Scope 2 (электроэнергия арендаторов).",
  },

  // --- retail ---------------------------------------------------------
  {
    industry: "retail",
    indicatorCode: "IND_CARBON_SCOPE_1",
    rating: "low_materiality",
    note: "Store HVAC + lighting are the dominant operations cost (Scope 2). Direct combustion limited.",
    noteAz: "Mağazanın iqlim sistemi və işıqlandırması əməliyyat xərclərində üstünlük təşkil edir (Scope 2). Birbaşa yanma məhduddur.",
    noteRu: "Вентиляция/кондиционирование и освещение магазина — основная операционная статья (Scope 2). Прямое сжигание ограничено.",
  },

  // --- IND_GOV_CLIMATE_SCORE: macro context, low materiality for non-resource-heavy sectors ---
  {
    industry: "services",
    indicatorCode: "IND_GOV_CLIMATE_SCORE",
    rating: "low_materiality",
    note: "Macro AZ climate-readiness has limited direct impact on light-operations services.",
    noteAz: "Azərbaycanın makro iqlim hazırlığının yüngül əməliyyatlı xidmət şirkətlərinə birbaşa təsiri məhduddur.",
    noteRu: "Макропоказатель климатической готовности Азербайджана слабо влияет напрямую на сервисные компании с лёгкими операциями.",
  },
  {
    industry: "education",
    indicatorCode: "IND_GOV_CLIMATE_SCORE",
    rating: "low_materiality",
    note: "Macro AZ climate-readiness has limited direct impact on education sector ops.",
    noteAz: "Azərbaycanın makro iqlim hazırlığının təhsil sektorunun əməliyyatlarına birbaşa təsiri məhduddur.",
    noteRu: "Макропоказатель климатической готовности Азербайджана слабо влияет напрямую на операции сектора образования.",
  },
  {
    industry: "entertainment",
    indicatorCode: "IND_GOV_CLIMATE_SCORE",
    rating: "low_materiality",
    note: "Macro AZ climate-readiness has limited direct impact on entertainment sector ops.",
    noteAz: "Azərbaycanın makro iqlim hazırlığının əyləncə sektorunun əməliyyatlarına birbaşa təsiri məhduddur.",
    noteRu: "Макропоказатель климатической готовности Азербайджана слабо влияет напрямую на операции индустрии развлечений.",
  },
  {
    industry: "retail",
    indicatorCode: "IND_GOV_CLIMATE_SCORE",
    rating: "low_materiality",
    note: "Macro AZ climate-readiness has limited direct impact on retail sector ops.",
    noteAz: "Azərbaycanın makro iqlim hazırlığının pərakəndə sektorunun əməliyyatlarına birbaşa təsiri məhduddur.",
    noteRu: "Макропоказатель климатической готовности Азербайджана слабо влияет напрямую на операции розничного сектора.",
  },
  {
    industry: "real_estate",
    indicatorCode: "IND_GOV_CLIMATE_SCORE",
    rating: "low_materiality",
    note: "Macro AZ climate-readiness has limited direct impact on real-estate ops.",
    noteAz: "Azərbaycanın makro iqlim hazırlığının daşınmaz əmlak əməliyyatlarına birbaşa təsiri məhduddur.",
    noteRu: "Макропоказатель климатической готовности Азербайджана слабо влияет напрямую на операции с недвижимостью.",
  },

  // ─── Phase 7.I — financial-indicator materiality for agro/food_processing ───
  // For harvest-cycle agribusinesses, working-capital indicators (DPO / CCC /
  // inventory turns) are vestigial — payables align with planting cycle,
  // standing crop ≠ B2B inventory. Operational metrics (yield, sugar content,
  // water/fertilizer intensity) and external metrics (commodity price, weather)
  // carry the operational signal. Marking those WC ratios as low/not material
  // dims them visually so the client sees what matters first.
  //
  // **DSO is the EXCEPTION for cane-growers/sellers** (AzerSheker pilot, 2026-05-16):
  // a cane grower's revenue lands in 1-2 harvest pulses per year, but each
  // pulse goes to 1-2 sugar-mill buyers. If one mill delays payment 30 days,
  // the entire post-harvest cash plan unravels. Buyer concentration × annual
  // billing cycle = DSO is MORE material here, not less. Hence: `material`.
  //
  // For downstream food_processing (sugar refining, beverage), inventory turns
  // + DSO are RESTORED to material — refined sugar IS B2B inventory on a
  // normal credit cycle.
  {
    industry: "agro_crops",
    indicatorCode: "IND_DSO",
    rating: "material",
    note: "Cane-seller revenue concentrates into 1-2 buyer payments per harvest — late payment from a single sugar mill creates immediate cash crisis. DSO is the early warning.",
    noteAz: "Şəkər qamışı satıcısının gəliri hər məhsul dövründə 1-2 alıcı ödənişində cəmlənir — bir şəkər zavodunun ödənişi gecikdirməsi dərhal nağd pul böhranı yaradır. DSO erkən xəbərdarlıq siqnalıdır.",
    noteRu: "Выручка продавца тростника концентрируется в 1-2 платежах покупателей за урожай — задержка оплаты одним сахарным заводом сразу создаёт кассовый кризис. DSO здесь — ранний сигнал.",
  },
  {
    industry: "agro_crops",
    indicatorCode: "IND_DPO",
    rating: "low_materiality",
    note: "Payables aligned with planting/fertilizer cycle, not steady B2B credit terms.",
    noteAz: "Kreditor borcları sabit B2B kredit şərtlərinə deyil, əkin və gübrə tsiklinə bağlıdır.",
    noteRu: "Кредиторская задолженность привязана к циклу посева и внесения удобрений, а не к ровным условиям B2B-кредита.",
  },
  {
    industry: "agro_crops",
    indicatorCode: "IND_CCC",
    rating: "low_materiality",
    note: "Cash conversion cycle distorted by harvest seasonality — read DSO/DPO individually.",
    noteAz: "Nağd pul dövriyyəsi tsikli məhsul mövsümiliyi ilə təhrif olunur — DSO və DPO-nu ayrılıqda oxuyun.",
    noteRu: "Цикл конверсии денежных средств искажён сезонностью урожая — читайте DSO и DPO по отдельности.",
  },
  {
    industry: "agro_crops",
    indicatorCode: "IND_INVENTORY_TURNS",
    rating: "not_material",
    note: "Standing crop ≠ retail/B2B inventory; turns metric doesn't apply.",
    noteAz: "Tarlada duran məhsul pərakəndə/B2B ehtiyatı deyil; dövretmə göstəricisi tətbiq olunmur.",
    noteRu: "Урожай на корню — не розничные и не B2B-запасы; показатель оборачиваемости неприменим.",
  },
  // food_processing keeps WC indicators material because B2B sugar/processed
  // food has normal credit cycle + warehouse rotation. The cane-side metrics
  // (sugar content, extraction rate) apply via the dedicated AGRO_/FP_ seeds.

  // Indicators that DON'T apply to non-banking businesses — DEBT_TO_EBITDA / CCC
  // for the agro side are dimmed, mirroring the working-capital rationale.
  {
    industry: "agro_crops",
    indicatorCode: "IND_LEVERAGE",
    rating: "low_materiality",
    note: "Asset-heavy seasonal capital; benchmarks read against agri-finance peers, not service-sector ratios.",
    noteAz: "Aktivlərlə yüklü mövsümi kapital; bençmarklar xidmət sektorunun əmsalları ilə deyil, aqro-maliyyə üzrə oxşar şirkətlərlə müqayisə edilir.",
    noteRu: "Сезонный капитал с высокой долей активов; бенчмарки сравниваются с аграрно-финансовыми аналогами, а не с коэффициентами сферы услуг.",
  },
];

/**
 * Lookup materiality for an (industry, indicatorCode) pair. Returns the
 * override when present; otherwise `material` (the visual default).
 * `null` industry → `material` (defensive — don't accidentally hide
 * cells when a company has no industry tagged).
 */
export function getMateriality(
  industry: string | null | undefined,
  indicatorCode: string,
): MaterialityRating {
  if (!industry) return "material";
  const row = ESG_MATERIALITY_OVERRIDES.find(
    (r) => r.industry === industry && r.indicatorCode === indicatorCode,
  );
  return row?.rating ?? "material";
}

/**
 * Lookup the calibration note for the (industry, indicatorCode) pair
 * when there's a non-default rating. Returns null for `material` cells
 * (no need to surface "this is default"). Used by IndicatorDetail's
 * materiality badge tooltip.
 */
export function getMaterialityNote(
  industry: string | null | undefined,
  indicatorCode: string,
): string | null {
  if (!industry) return null;
  const row = ESG_MATERIALITY_OVERRIDES.find(
    (r) => r.industry === industry && r.indicatorCode === indicatorCode,
  );
  return row?.note ?? null;
}

/**
 * Localized twin of `getMaterialityNote`. Returns `{ en, az, ru }` so the API
 * can ship all three and the client can pick by active locale (mirrors the
 * `hintTemplateEn/Az/Ru` contract on indicator definitions). AZ/RU fall back
 * to EN when a row has no translation yet.
 */
export function getMaterialityNoteI18n(
  industry: string | null | undefined,
  indicatorCode: string,
): { en: string; az: string; ru: string } | null {
  if (!industry) return null;
  const row = ESG_MATERIALITY_OVERRIDES.find(
    (r) => r.industry === industry && r.indicatorCode === indicatorCode,
  );
  if (!row) return null;
  return {
    en: row.note,
    az: row.noteAz ?? row.note,
    ru: row.noteRu ?? row.note,
  };
}

/**
 * The 5 ESG indicators that v2.4 originally calibrated. Kept as the
 * canonical "ESG group" for tests + admin UI grouping. After Phase 7.I
 * (AzerSheker pilot) materiality is no longer ESG-only — any indicator
 * with at least one override row in `ESG_MATERIALITY_OVERRIDES` is
 * considered materiality-scoped. See `isMaterialityScoped()`.
 */
export const ESG_INDICATOR_CODES: readonly string[] = [
  "IND_CARBON_SCOPE_1",
  "IND_CARBON_SCOPE_2",
  "IND_CARBON_SCOPE_3",
  "IND_ESG_COMPOSITE",
  "IND_GOV_CLIMATE_SCORE",
];

/**
 * Derived set of every indicator code that participates in the
 * materiality framework — i.e. has at least one (industry, indicatorCode)
 * override row in `ESG_MATERIALITY_OVERRIDES`. Computed once at module
 * load; lookup is O(1).
 *
 * Phase 7.I: previously hard-coded to the 5 ESG codes. Now generalized
 * so adding agro/food_processing financial-override rows auto-enables
 * materiality dimming in the HeatMap for those codes without touching
 * the gating function.
 */
const MATERIALITY_SCOPED_CODES: ReadonlySet<string> = new Set([
  ...ESG_INDICATOR_CODES,
  ...ESG_MATERIALITY_OVERRIDES.map((r) => r.indicatorCode),
]);

/**
 * True if the indicator participates in the materiality framework.
 * Returns true for any indicator with at least one override row.
 */
export function isMaterialityScoped(indicatorCode: string): boolean {
  return MATERIALITY_SCOPED_CODES.has(indicatorCode);
}
