#!/usr/bin/env python3
"""Phase 7.G Turn XI — bulk-inject hintTemplateRu + hintTemplateAz.

ONE-SHOT TOOLING (not routine seed-add path).

For routine seed additions (1-3 new indicators), DO NOT use this script
— add `hintTemplateRu` and `hintTemplateAz` inline alongside
`hintTemplateEn` at seed-author time. Cleaner, no formatting fix-up
required.

Use case: bulk batches of 40+ indicators needing RU/AZ at once. The
regex injector saves time vs manual edits but requires post-run
cleanup:
    python3 scripts/translate-hints.py
    npx prettier --write src/lib/risk/indicator-seeds.ts
    # then strip phantom blank lines via:
    #   sed -E 's/(",)\\n\\n(    hintTemplate(Ru|Az):)/\\1\\n\\2/g'

Translations: domain-accurate finance/operations Russian + idiomatic
Azerbaijani. {value} and {status} placeholders preserved verbatim.

Per architect Turn-VIII residual 🔄 — 44 non-AZMADE-active indicators
× 2 locales = 88 strings. Actual count post-grep = 43 indicators (one
already accounted for via Turn VIII's 13 production-active list; total
seeds = 56 minus 13 = 43).
"""
import re
from pathlib import Path

PATH = Path("/Users/rashadrahimov/Documents/leaddrive-budgeting/src/lib/risk/indicator-seeds.ts")
text = PATH.read_text(encoding="utf-8")

# Map: code -> (ru, az)
TRANSLATIONS = {
    # ── Hospitality (4) ────────────────────────────────────────────
    "HOSP_OCC": (
        "Загрузка {value}% — {status}. Целевой ориентир для устойчивого hospitality актива — 70%+.",
        "Doluluq {value}% — {status}. Sabitləşmiş hospitality aktivi üçün hədəf — 70%+.",
    ),
    "HOSP_REVPAR": (
        "RevPAR {value} AZN — комбинирует тариф и загрузку. Сигнал: тренд ниже того же месяца прошлого года.",
        "RevPAR {value} AZN — qiymət və doluluğun birləşməsi. Siqnal: keçən il eyni ayın altında trend.",
    ),
    "HOSP_FX_EXPOSURE": (
        "{value}% выручки в FX. Девальвация AZN на 10% двигает EBITDA примерно на ту же долю.",
        "Gəlirin {value}%-i FX-də. AZN-in 10% devalvasiyası EBITDA-nı təxminən eyni payda hərəkət etdirir.",
    ),
    "HOSP_SOURCE_HHI": (
        "HHI = {value}. Выше 2500 — один source-market доминирует; одно travel-ограничение топит квартал.",
        "HHI = {value}. 2500-dən yuxarı bir mənbə bazar üstünlük təşkil edir; bir səyahət məhdudiyyəti rübü batırır.",
    ),
    # ── Agro (3) ───────────────────────────────────────────────────
    "AGRO_YIELD": (
        "Урожайность {value} т/га. Ниже 2.5 — обычно сигнал ирригации, качества семян или вредителей; разбираться.",
        "Məhsuldarlıq {value} t/ha. 2.5-dən aşağı — adətən suvarma, toxum keyfiyyəti və ya zərərvericilər siqnalı; araşdırın.",
    ),
    "AGRO_DROUGHT_RISK": (
        "Индекс засухи {value}/100 — выше 60 — исторический порог для >20% потери урожая в регионе.",
        "Quraqlıq indeksi {value}/100 — 60-dan yuxarı bölgə üçün >20% məhsul itkisinin tarixi həddi.",
    ),
    "AGRO_COMMODITY_VOL": (
        "Скользящая 12-месячная волатильность цены {value}%. Выше 25% — рассмотрите forward-контракты для фиксации маржи.",
        "Sürüşkən 12-aylıq qiymət volatilliyi {value}%. 25%-dən yuxarı — marjanı bağlamaq üçün forvard müqavilələrini nəzərdən keçirin.",
    ),
    # ── Industrial rollup (2) ──────────────────────────────────────
    "IND_REVENUE_TOTAL": (
        "Общая выручка {value} AZN. Сохраняет сырые $ для rollup() и fact() композитов; классификация рисков на других индикаторах.",
        "Ümumi gəlir {value} AZN. Rollup() və fact() kompozitləri üçün xam $ saxlayır; risk təsnifatı digər göstəricilərdə.",
    ),
    "IND_HOLDING_REVENUE": (
        "Выручка холдинга {value} AZN, суммарно по прямым дочерним компаниям. 0 = ни одна операционная саб-ко не дала вклад.",
        "Holdinqin gəliri {value} AZN, birbaşa törəmə şirkətlər üzrə cəmi. 0 = heç bir əməliyyat törəməsi töhfə verməyib.",
    ),
    # ── Pharma (5) ─────────────────────────────────────────────────
    "PHARMA_GROSS_MARGIN": (
        "Валовая маржа фармы {value}%. Брендированные 70–80%, generics 40–55%, чистая дистрибуция 10–20%; ниже 8% — обычно дистрибуторская модель давит на цены.",
        "Pharma ümumi mənfəəti {value}%. Brendli 70–80%, generics 40–55%, saf distribusiya 10–20%; 8%-dən aşağı — adətən distribütor modeli qiymətləri sıxır.",
    ),
    "PHARMA_NET_MARGIN": (
        "Чистая маржа {value}%. Регуляторные + R&D амортизация сжимают net margin; ниже 2% — структурно убыточно.",
        "Xalis mənfəət {value}%. Tənzimləyici + R&D amortizasiyası net margin-i sıxır; 2%-dən aşağı — strukturca zərərlidir.",
    ),
    "PHARMA_RD_INTENSITY": (
        "Интенсивность R&D {value}%. Среднее по индустрии 17%; ниже 5% — нет new-product pipeline → riск revenue cliff.",
        "R&D intensivliyi {value}%. Sənaye orta göstəricisi 17%; 5%-dən aşağı — yeni-məhsul pipeline yoxdur → gəlir uçurumu riski.",
    ),
    "PHARMA_INVENTORY_DAYS": (
        "Inventory days = {value}. Выше 120 — продукт лежит на складе; проверьте near-expiry и pricing.",
        "Anbar günləri = {value}. 120-dən yuxarı — məhsul rəfdə yatır; istifadə-müddəti yaxınlaşan və qiymətləməni yoxlayın.",
    ),
    "PHARMA_OPEX_RATIO": (
        "OpEx {value}% от выручки. Pharma SG&A 25–40% (sales force + reg compliance). Выше 45% — sales-force overcapacity или compliance lag.",
        "OpEx gəlirin {value}%-dir. Pharma SG&A 25–40% (sales force + reg compliance). 45%-dən yuxarı — sales-force həddən artıq və ya compliance gecikmələri.",
    ),
    # ── Real Estate (5) ────────────────────────────────────────────
    "RE_GROSS_MARGIN": (
        "NOI margin {value}%. Коммерческая недвижимость baseline 65–85%; ниже 45% — высокие операционные расходы или ослабление аренды.",
        "NOI marja {value}%. Kommersiya daşınmaz əmlak baseline 65–85%; 45%-dən aşağı — yüksək əməliyyat xərcləri və ya icarənin zəifləməsi.",
    ),
    "RE_OCCUPANCY": (
        "Заполняемость {value}%. Стабилизированные коммерческие активы 90%+; ниже 75% — проблемы pricing или продукта.",
        "Doluluq {value}%. Sabitləşmiş kommersiya aktivlər 90%+; 75%-dən aşağı — qiymətləmə və ya məhsul problemləri.",
    ),
    "RE_DEBT_SERVICE_COVERAGE": (
        "DSCR {value}. Ниже 1.15 — NOI едва покрывает проценты + principal; любое падение аренды триггерит default.",
        "DSCR {value}. 1.15-dən aşağı — NOI faizləri + əsas borcu çətinliklə örtür; istənilən icarə azalması default-u tetikləyir.",
    ),
    "RE_RENT_COLLECTION": (
        "Сбор аренды {value}%. Коммерческий target 98%+; ниже 92% — tenants не платят, индикатор рецессии.",
        "İcarə yığımı {value}%. Kommersiya hədəfi 98%+; 92%-dən aşağı — kirayəçilər ödəyə bilmir, resessiya göstəricisi.",
    ),
    "RE_OPEX_RATIO": (
        "OpEx {value}% от выручки. Коммерческая недвижимость baseline 25–40% (property mgmt + utilities + tax). Выше 50% — vacancy growing или maintenance unaddressed.",
        "OpEx gəlirin {value}%-dir. Kommersiya daşınmaz əmlak baseline 25–40% (mülkiyyət idarəçiliyi + kommunal + vergi). 50%-dən yuxarı — boşluq artır və ya texniki xidmət həll edilməyib.",
    ),
    # ── Entertainment (4) ──────────────────────────────────────────
    "ENT_ATTENDANCE_UTIL": (
        "Утилизация посещений {value}%. Ниже 50% — обычно не покрывает фиксированные расходы; pricing или маркетинг misalignment.",
        "İştirak utilizasiyası {value}%. 50%-dən aşağı — adətən sabit xərcləri ödəmir; qiymətləmə və ya marketinq yanlış uyğunlaşması.",
    ),
    "ENT_REVENUE_PER_VISIT": (
        "Выручка/визит = {value} AZN. Здоровые площадки выводят ancillary revenue (F&B, merch) до 30–50% общего.",
        "Gəlir/ziyarət = {value} AZN. Sağlam məkanlar yardımçı gəlirləri (F&B, suvenir) ümuminin 30–50%-nə çıxarır.",
    ),
    "ENT_GROSS_MARGIN": (
        "Валовая маржа {value}%. Развлечения 50–65%; ниже 30% — costs-of-delivery (контент, площадка) выходят из-под контроля.",
        "Ümumi mənfəət {value}%. Əyləncə 50–65%; 30%-dən aşağı — çatdırılma xərcləri (kontent, məkan) nəzarətdən çıxır.",
    ),
    "ENT_SEASONALITY_CONCENTRATION": (
        "{value}% выручки в peak 3 месяца. Выше 55% — один плохой сезон убивает год; диверсифицируйте off-season offerings.",
        "Gəlirin {value}%-i pik 3 ayda. 55%-dən yuxarı — bir pis mövsüm ili məhv edir; off-season təklifləri diversifikasiya edin.",
    ),
    # ── Education (4) ──────────────────────────────────────────────
    "EDU_ENROLLMENT_FILL": (
        "Заполняемость зачисления {value}%. Ниже 80% — обычно сигнал pricing или репутации относительно конкурентов.",
        "Qeydiyyat doluluğu {value}%. 80%-dən aşağı — adətən rəqiblərlə müqayisədə qiymətləmə və ya reputasiya siqnalıdır.",
    ),
    "EDU_TUITION_COLLECTION": (
        "Сбор обучения {value}%. Ниже 90% — задолженность растёт; ужесточите payment terms или risk cascade.",
        "Təhsil haqqı yığımı {value}%. 90%-dən aşağı — borclar artır; ödəniş şərtlərini sərtləşdirin və ya risk kaskadı.",
    ),
    "EDU_GROSS_MARGIN": (
        "Валовая маржа {value}%. Частное образование baseline 40–55%; ниже 20% — teacher cost + facility перевешивают tuition revenue.",
        "Ümumi mənfəət {value}%. Özəl təhsil baseline 40–55%; 20%-dən aşağı — müəllim xərci + tikili təhsil haqqı gəlirini üstələyir.",
    ),
    "EDU_STUDENT_TEACHER_RATIO": (
        "Соотношение студент-учитель {value}. Sweet spot 10–20; выше 25 эродирует качество, 6–10 — over-staffing.",
        "Tələbə-müəllim nisbəti {value}. Sweet spot 10–20; 25-dən yuxarı keyfiyyəti aşır, 6–10 — həddən artıq personal.",
    ),
    # ── Poultry (4) ────────────────────────────────────────────────
    "POULTRY_FCR": (
        "FCR = {value}. Best-in-class 1.6–1.7; выше 1.9 — обычно feed formulation, water quality или температура.",
        "FCR = {value}. Best-in-class 1.6–1.7; 1.9-dən yuxarı — adətən yem formulyasiyası, su keyfiyyəti və ya temperatur.",
    ),
    "POULTRY_MORTALITY": (
        "Смертность {value}%. Цель ≤4%; выше 7% — болезнь или environmental red flag; проверяйте вентиляцию + биобезопасность.",
        "Ölüm {value}%. Hədəf ≤4%; 7%-dən yuxarı — xəstəlik və ya ətraf-mühit qırmızı bayrağı; ventilyasiya + biotəhlükəsizliyi yoxlayın.",
    ),
    "POULTRY_GROSS_MARGIN": (
        "Валовая маржа {value}%. Поултри — тонкомаржинальный коммодити (типично 12–20%); ниже 5% feed-price скачок флипает в loss.",
        "Ümumi mənfəət {value}%. Quş əti incə-marjalı əmtəədir (tipik 12–20%); 5%-dən aşağı yem-qiymət sıçrayışı zərərə çevirir.",
    ),
    "POULTRY_FEED_COST_SHARE": (
        "Feed = {value}% от COGS. Sweet spot 58–72%; выше 78% — feed-price exposure высокая, хеджируйте grain или закройте feed-mill.",
        "Yem COGS-un {value}%-i. Sweet spot 58–72%; 78%-dən yuxarı — yem-qiymət riski yüksəkdir, dəni hedge edin və ya feed-mill bağlayın.",
    ),
    # ── Food Processing (4) ────────────────────────────────────────
    "FP_YIELD_LOSS": (
        "Потеря выхода {value}%. Best-in-class 2–6%; выше 10% — отходы сырья; проверьте резку, варку, упаковку.",
        "Çıxış itkisi {value}%. Best-in-class 2–6%; 10%-dən yuxarı — xammal tullantısı; kəsmə, bişirmə, qablaşdırma yoxlayın.",
    ),
    "FP_GROSS_MARGIN": (
        "Валовая маржа {value}%. Брендированный 30–40%, private-label 20–28%, commodity 10–18%. Ниже 12% — нет pricing power, продукт коммодити.",
        "Ümumi mənfəət {value}%. Brendli 30–40%, private-label 20–28%, əmtəə 10–18%. 12%-dən aşağı — qiymətləmə gücü yoxdur, məhsul əmtəədir.",
    ),
    "FP_INVENTORY_TURNS": (
        "Оборот инвентаря {value}/год. Скоропортящаяся еда target 12–24; ниже 8 = риск порчи.",
        "Anbar dövriyyəsi {value}/il. Tezxarabolan qida hədəfi 12–24; 8-dən aşağı = xarablanma riski.",
    ),
    "FP_OPEX_RATIO": (
        "OpEx {value}% от выручки. Food processing 12–22%; выше 28% — структурно тяжело для маржи (логистика + стоимость холода).",
        "OpEx gəlirin {value}%-dir. Qida emalı 12–22%; 28%-dən yuxarı — marja üçün strukturca ağır (logistika + soyuq saxlama).",
    ),
    # ── Beverage (2) ───────────────────────────────────────────────
    "BEV_GROSS_MARGIN": (
        "Валовая маржа {value}%. Cross-segment floor: брендированный 50–60%, alcohol 35–50%, commodity 25–35%. Ниже 20% — переключение на коммодити-сегмент.",
        "Ümumi mənfəət {value}%. Cross-segment alt həddi: brendli 50–60%, alkoqol 35–50%, əmtəə 25–35%. 20%-dən aşağı — əmtəə-seqmentinə keçid.",
    ),
    "BEV_OPEX_RATIO": (
        "OpEx {value}% от выручки. Beverage SG&A — distribution + marketing-heavy; выше 35% — brand investment overshoots margin.",
        "OpEx gəlirin {value}%-dir. Beverage SG&A — distribusiya + marketinq ağırlığı; 35%-dən yuxarı — brend investisiyası marjanı üstələyir.",
    ),
    # ── Retail (2) ─────────────────────────────────────────────────
    "RETAIL_GROSS_MARGIN": (
        "Валовая маржа {value}%. Grocery 20–28%, electronics 18–25%, fashion 45–55%, specialty 35–50%. Ниже 12% — pricing pressure или mix shift.",
        "Ümumi mənfəət {value}%. Grocery 20–28%, electronics 18–25%, moda 45–55%, specialty 35–50%. 12%-dən aşağı — qiymətləmə təzyiqi və ya miks dəyişikliyi.",
    ),
    "RETAIL_INVENTORY_TURNS": (
        "Оборот инвентаря {value}/год. Cross-segment floor: grocery 14–26, electronics 6–12, fashion 4–8, specialty 3–6. Ниже floor — обычно мёртвый запас.",
        "Anbar dövriyyəsi {value}/il. Cross-segment alt həddi: grocery 14–26, electronics 6–12, moda 4–8, specialty 3–6. Alt həddən aşağı — adətən ölü ehtiyat.",
    ),
    # ── Logistics (2) ──────────────────────────────────────────────
    "LOG_OPEX_RATIO": (
        "OpEx {value}% от выручки. Trucking + warehousing структурно 70–90% (driver pay, fuel, fleet); выше 92% — fleet underutilized или fuel hedge missing.",
        "OpEx gəlirin {value}%-dir. Trucking + warehousing strukturca 70–90% (sürücü əmək haqqı, yanacaq, parkomat); 92%-dən yuxarı — parkomat dolu deyil və ya yanacaq hedge yoxdur.",
    ),
    "LOG_GROSS_MARGIN": (
        "Валовая маржа {value}%. 3PL 12–20%, freight forwarding 8–15%, specialty 18–25%. Ниже 7% — likely loss-making контракты.",
        "Ümumi mənfəət {value}%. 3PL 12–20%, freight forwarding 8–15%, specialty 18–25%. 7%-dən aşağı — çox güman ki zərərli müqavilələr.",
    ),
    # ── Construction (2) ───────────────────────────────────────────
    "CONSTR_GROSS_MARGIN": (
        "Валовая маржа {value}%. Heavy civil 8–14%, building 10–18%, specialty 18–25%. Ниже 8% — cost overruns или mispriced bids.",
        "Ümumi mənfəət {value}%. Ağır mülki 8–14%, tikili 10–18%, ixtisaslaşmış 18–25%. 8%-dən aşağı — xərc aşımı və ya yanlış qiymətləndirilmiş təkliflər.",
    ),
    "CONSTR_OPEX_RATIO": (
        "OpEx {value}% от выручки. Construction SG&A структурно лёгкий (4–12%); выше 10% — overhead растёт быстрее backlog.",
        "OpEx gəlirin {value}%-dir. Tikinti SG&A strukturca yüngüldür (4–12%); 10%-dən yuxarı — overhead backlog-dan tez artır.",
    ),
}

print(f"Translations prepared: {len(TRANSLATIONS)} indicators × 2 locales = {len(TRANSLATIONS)*2} strings")

# Inject hintTemplateRu + hintTemplateAz right after hintTemplateEn for each.
# Pattern: find `code: "X"` block, locate hintTemplateEn within, append after.
inserted = 0
skipped_no_en = 0
already_has_ru = 0

# Process per-block to avoid cross-contamination
def process_block(match):
    global inserted, skipped_no_en, already_has_ru
    block = match.group(0)
    code_match = re.search(r'code:\s*"([A-Z_]+)"', block)
    if not code_match:
        return block
    code = code_match.group(1)
    if code not in TRANSLATIONS:
        return block
    if "hintTemplateRu:" in block:
        already_has_ru += 1
        return block
    en_match = re.search(r'(\s+hintTemplateEn:\s*\n?\s*"[^"]+",\n)', block)
    if not en_match:
        skipped_no_en += 1
        return block
    en_full = en_match.group(1)
    indent = re.match(r'(\s+)', en_full).group(1)
    ru, az = TRANSLATIONS[code]
    insertion = (
        f'{indent}hintTemplateRu:\n{indent}  "{ru}",\n'
        f'{indent}hintTemplateAz:\n{indent}  "{az}",\n'
    )
    new_block = block.replace(en_full, en_full + insertion, 1)
    inserted += 1
    return new_block

# Split into seed blocks. Each block starts with `  {\n    code: "..."` and
# ends before the next `  {\n    code:` or end of `]`.
# Simpler: process line-by-line, accumulate a block, flush when we see the
# closing `  },\n  {\n    code:` boundary.
blocks = re.split(r'(?=  \{\s*\n\s*code: ")', text)
new_blocks = []
for b in blocks:
    if b.startswith('  {'):
        b = process_block(re.match(r'.*', b, re.DOTALL))
    new_blocks.append(b)
new_text = "".join(new_blocks)

PATH.write_text(new_text, encoding="utf-8")
print(f"Inserted: {inserted}")
print(f"Already had Ru (skipped): {already_has_ru}")
print(f"Missing En (could not insert): {skipped_no_en}")
