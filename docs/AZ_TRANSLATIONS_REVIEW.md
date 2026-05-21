# AZ Translations Review Checklist — Phase 7.M Tier 6

**Generated:** 2026-05-21 by /goal CARRYOVER sweep
**Scope:** 80 indicator hints with EN/RU/AZ translations (Architect Turn-XI 💡 #2 — native-speaker review pending)

## How to review

1. Walk down each row.
2. Check AZ vs EN/RU for: (a) calques (literal English word-order), (b) wrong domain term (finance jargon should match Azerbaijani financial press, not direct EN translation), (c) gendered forms / agreement.
3. Flag any line that needs a fix — open a PR with corrected `hintTemplateAz` strings in the relevant `*-seeds.ts` file.
4. After review, close CARRYOVER row "Architect Turn-XI 💡 #2".

## Heuristic flags

Heuristic indicators of potentially-awkward AZ phrasing (not absolute — needs native confirmation):

| Code | Flags | EN | AZ |
|---|---|---|---|
| `AGRO_FERTILIZER_INTENSITY` | EN-word-leak | Fertilizer {value} kg/ha — {status}. High values without yield gain → N-leaching | Gübrə {value} kq/ha — {status}. Məhsuldarlıq artmadan yüksək — azot yuyulması ri |
| `PHARMA_NET_MARGIN` | EN-word-leak | Net margin {value}%. Regulatory + R&D amortisation compress net margin; below 2% | Xalis mənfəət {value}%. Tənzimləyici + R&D amortizasiyası net margin-i sıxır; 2% |
| `PHARMA_RD_INTENSITY` | EN-word-leak | R&D intensity {value}%. Industry avg 17%; below 5% means no new-product pipeline | R&D intensivliyi {value}%. Sənaye orta göstəricisi 17%; 5%-dən aşağı — yeni-məhs |
| `EDU_TUITION_COLLECTION` | EN-word-leak | Tuition collection {value}%. Below 90% means arrears are building — tighten paym | Təhsil haqqı yığımı {value}%. 90%-dən aşağı — borclar artır; ödəniş şərtlərini s |
| `POULTRY_FEED_COST_SHARE` | EN-word-leak | Feed is {value}% of COGS. Sweet spot 58-72%; above 78% means feed-price exposure | Yem COGS-un {value}%-i. Sweet spot 58–72%; 78%-dən yuxarı — yem-qiymət riski yük |
| `FP_INVENTORY_TURNS` | EN-word-leak | Inventory turns = {value}/year. Perishable food targets 12-24; below 8 = spoilag | Anbar dövriyyəsi {value}/il. Tezxarabolan qida hədəfi 12–24; 8-dən aşağı = xarab |
| `IND_REVENUE_TOTAL` | EN-word-leak | Total revenue {value} AZN. Persists raw $ for rollup() and fact() composites; ri | Ümumi gəlir {value} AZN. Rollup() və fact() kompozitləri üçün xam $ saxlayır; ri |

## Full review table

### operational (53)

#### `HOSP_OCC` — Occupancy

- **EN**: Occupancy is {value}% — {status}. Target is 70%+ for stabilised hospitality assets.
- **RU**: Загрузка {value}% — {status}. Целевой ориентир для устойчивого hospitality актива — 70%+.
- **AZ**: Doluluq {value}% — {status}. Sabitləşmiş hospitality aktivi üçün hədəf — 70%+.

#### `HOSP_REVPAR` — RevPAR (Revenue Per Available Room)

- **EN**: RevPAR of {value} AZN — combines rate and occupancy. Flag if trending below last-year same-month.
- **RU**: RevPAR {value} AZN — комбинирует тариф и загрузку. Сигнал: тренд ниже того же месяца прошлого года.
- **AZ**: RevPAR {value} AZN — qiymət və doluluğun birləşməsi. Siqnal: keçən il eyni ayın altında trend.

#### `AGRO_YIELD` — Yield per Hectare

- **EN**: Yield is {value} t/ha. Below 2.5 usually signals irrigation, seed-quality, or pest issues — investigate.
- **RU**: Урожайность {value} т/га. Ниже 2.5 — обычно сигнал ирригации, качества семян или вредителей; разбираться.
- **AZ**: Məhsuldarlıq {value} t/ha. 2.5-dən aşağı — adətən suvarma, toxum keyfiyyəti və ya zərərvericilər siqnalı; araşdırın.

#### `AGRO_YIELD_PER_HA` — Direct-entry Yield per Hectare

- **EN**: Yield {value} t/ha — {status}. Sugarcane: target 60+ t/ha; below 40 signals irrigation or variety drift.
- **RU**: Урожайность {value} т/га — {status}. Тростник: цель 60+; ниже 40 — ирригация или сорт.
- **AZ**: Məhsuldarlıq {value} t/ha — {status}. Qamış: hədəf 60+; 40-dan aşağı — suvarma və ya sort.

#### `AGRO_SUGAR_CONTENT` — Sugar Content of Harvest

- **EN**: Sucrose content {value}% — {status}. Below 10% usually means late harvest, drought stress, or variety drift.
- **RU**: Содержание сахарозы {value}% — {status}. Ниже 10% обычно — поздняя уборка, засушливый стресс или дрейф сорта.
- **AZ**: Saxaroza miqdarı {value}% — {status}. 10%-dən aşağı: gec biçim, quraqlıq stresi və ya sort dreyfi.

#### `AGRO_WATER_INTENSITY` — Water Use Intensity

- **EN**: Water use {value} m³/ha — {status}. Above 18,000 signals irrigation inefficiency (canal losses, poor scheduling).
- **RU**: Расход воды {value} м³/га — {status}. Выше 18 000 — неэффективная ирригация (потери в каналах, плохое расписание).
- **AZ**: Su istifadəsi {value} m³/ha — {status}. 18 000-dən yuxarı: səmərəsiz suvarma (kanal itkiləri, zəif planlaşdırma).

#### `AGRO_FERTILIZER_INTENSITY` — Fertilizer Use Intensity

- **EN**: Fertilizer {value} kg/ha — {status}. High values without yield gain → N-leaching risk + cost drag.
- **RU**: Удобрений {value} кг/га — {status}. Высокий расход без роста урожая — риск вымывания азота + лишние затраты.
- **AZ**: Gübrə {value} kq/ha — {status}. Məhsuldarlıq artmadan yüksək — azot yuyulması riski + əlavə xərc.

#### `AGRO_CUT_TO_MILL` — Cut-to-Mill Time

- **EN**: Cut-to-mill {value}h — {status}. Sucrose drops ~2% per 12h post-cut; >48h means visible Brix loss at mill assay.
- **RU**: Срез → завод {value} ч — {status}. Сахароза падает ~2% за 12 ч; >48 ч — заметная потеря Brix при приёмке.
- **AZ**: Kəsim → zavod {value} saat — {status}. Saxaroza hər 12 saatda ~2% azalır; >48 saat — zavod analizində Brix itkisi.

#### `AGRO_HARVEST_PROGRESS` — Harvest Plan Completion

- **EN**: Harvest completion {value}% — {status}. <70% near season end means standing crop will degrade (Brix drops past peak); investigate labor/weather/equipment.
- **RU**: Выполнение уборки {value}% — {status}. <70% к концу сезона — несобранный тростник теряет Brix; проверить трудовые ресурсы / погоду / технику.
- **AZ**: Yığım icrası {value}% — {status}. Sezon sonu <70% — yığılmayan qamış Brix-i itirir; işçi qüvvəsi / hava / texnika yoxlayın.

#### `IND_GROSS_MARGIN` — Gross Margin

- **EN**: Gross margin {value}% — revenue left after COGS. Industrial benchmark 25–35%; below 15% means pricing or input-cost discipline is broken.
- **RU**: Валовая маржа {value}% — доход после прямых затрат. Промышленный бенчмарк 25–35%; ниже 15% значит сломан pricing или контроль затрат.
- **AZ**: Ümumi mənfəət {value}% — gəlirin COGS-dan sonrakı qalığı. Sənaye benchmark 25–35%; 15%-dən aşağı qiymətləmə və ya giriş-xərc nizamı pozulub.

#### `IND_NET_MARGIN` — Net Margin

- **EN**: Net margin {value}%. Below 3% — a single input-cost spike or FX move erases profit. Fix OpEx or revenue mix.
- **RU**: Чистая маржа {value}%. Ниже 3% — один скачок цен на сырьё или FX-движение съедает прибыль. Чините OpEx или микс выручки.
- **AZ**: Xalis mənfəət {value}%. 3%-dən aşağı — bir giriş-xərc sıçrayışı və ya FX hərəkəti mənfəəti silir. OpEx-i və ya gəlir miksini düzəltməlisiniz.

#### `IND_OPEX_RATIO` — OpEx Ratio

- **EN**: Operating expenses are {value}% of revenue. Above 35% suggests overhead bloat — review payroll, rent, SG&A.
- **RU**: Операционные расходы — {value}% от выручки. Выше 35% — раздутый overhead, проверьте ФОТ, аренду, SG&A.
- **AZ**: Əməliyyat xərcləri gəlirin {value}%-dir. 35%-dən yuxarı şişmiş overhead — əmək haqqı fondu, icarə, SG&A-nı yoxlayın.

#### `IND_COGS_INTENSITY` — COGS Intensity

- **EN**: COGS is {value}% of revenue. Above 85% — one bad raw-material cycle flips the company to a loss.
- **RU**: Себестоимость {value}% от выручки. Выше 85% — один неудачный цикл сырья переводит компанию в убыток.
- **AZ**: COGS gəlirin {value}%-dir. 85%-dən yuxarı — bir uğursuz xammal dövrü şirkəti zərərə keçirir.

#### `IND_OPERATING_LEVERAGE` — Operating Leverage

- **EN**: Operating leverage = {value}. Above 2.0 means gross profit comfortably covers fixed-cost overhead; below 1.0 every revenue dip eats payroll/rent/admin.
- **RU**: Операционный рычаг = {value}. Выше 2.0 — валовая прибыль уверенно покрывает постоянные расходы; ниже 1.0 любое падение выручки съедает ФОТ/аренду/админ.
- **AZ**: Əməliyyat leveric = {value}. 2.0-dən yuxarı ümumi mənfəət sabit xərcləri rahat örtür; 1.0-dən aşağı hər gəlir azalması əmək haqqı/icarə/inzibatı yeyir.

#### `IND_OPEX_TO_COGS` — OpEx-to-COGS Balance

- **EN**: OpEx is {value}% of COGS. Industrial baseline 15-30%; above 50% means non-production costs are too heavy relative to direct production — restructure or reclassify.
- **RU**: OpEx составляет {value}% от COGS. Промышленный baseline 15–30%; выше 50% — непроизводственные расходы слишком тяжёлые относительно прямого производства, реструктуризируйте или переклассифицируйте.
- **AZ**: OpEx COGS-un {value}%-dir. Sənaye baseline 15–30%; 50%-dən yuxarı — qeyri-istehsal xərcləri birbaşa istehsala nisbətən çox ağırdır, yenidən qurun və ya təsnif edin.

#### `SVC_GROSS_MARGIN` — Services Gross Margin

- **EN**: Services gross margin {value}%. Healthy benchmarks run 40-60%; below 25% means pricing power is eroding or direct-service-delivery costs are out of line.
- **RU**: Валовая маржа услуг {value}%. Здоровые бенчмарки 40–60%; ниже 25% — pricing power размывается или прямые затраты на оказание услуг вышли из-под контроля.
- **AZ**: Xidmət ümumi mənfəəti {value}%. Sağlam benchmark 40–60%; 25%-dən aşağı — qiymətləmə gücü aşınır və ya birbaşa xidmət-çatdırılma xərcləri sıradan çıxır.

#### `SVC_NET_MARGIN` — Services Net Margin

- **EN**: Net margin {value}%. Services businesses below 0% are losing money on operations — investigate pricing, utilization, and overhead allocation.
- **RU**: Чистая маржа {value}%. Сервисные бизнесы ниже 0% теряют деньги на операциях — проверьте pricing, утилизацию и распределение overhead.
- **AZ**: Xalis mənfəət {value}%. 0%-dən aşağı xidmət bizneslər əməliyyatlarda pul itirir — qiymətləmə, utilizasiya və overhead bölgüsünü yoxlayın.

#### `SVC_OPEX_RATIO` — Services OpEx Ratio

- **EN**: OpEx {value}% of revenue. Services baseline 50-70% (personnel-heavy); above 85% suggests depreciation or overhead is too large for the revenue base.
- **RU**: OpEx — {value}% от выручки. Сервисный baseline 50–70% (персонал-центричный); выше 85% — амортизация или overhead слишком велики для базы выручки.
- **AZ**: OpEx gəlirin {value}%-dir. Xidmət baseline 50–70% (personalla yüklü); 85%-dən yuxarı — amortizasiya və ya overhead gəlir bazası üçün çox böyükdür.

#### `SVC_COGS_INTENSITY` — Services COGS Intensity

- **EN**: COGS {value}% of revenue. Services above 60% usually means low-margin re-selling or high third-party pass-through costs.
- **RU**: COGS {value}% от выручки. Услуги выше 60% — обычно низкомаржинальная перепродажа или высокие сторонние pass-through расходы.
- **AZ**: COGS gəlirin {value}%-dir. Xidmətdə 60%-dən yuxarı — adətən aşağı-marja yenidən-satış və ya yüksək üçüncü-tərəf pass-through xərcləri.

#### `PHARMA_GROSS_MARGIN` — Pharma Gross Margin

- **EN**: Pharma gross margin {value}%. Branded products run 70-80%, generics 40-55%, pure distribution 10-20%. Below 30% usually means no IP differentiation.
- **RU**: Валовая маржа фармы {value}%. Брендированные 70–80%, generics 40–55%, чистая дистрибуция 10–20%; ниже 8% — обычно дистрибуторская модель давит на цены.
- **AZ**: Pharma ümumi mənfəəti {value}%. Brendli 70–80%, generics 40–55%, saf distribusiya 10–20%; 8%-dən aşağı — adətən distribütor modeli qiymətləri sıxır.

#### `PHARMA_NET_MARGIN` — Pharma Net Margin

- **EN**: Net margin {value}%. Regulatory + R&D amortisation compress net margin; below 2% is structurally loss-prone.
- **RU**: Чистая маржа {value}%. Регуляторные + R&D амортизация сжимают net margin; ниже 2% — структурно убыточно.
- **AZ**: Xalis mənfəət {value}%. Tənzimləyici + R&D amortizasiyası net margin-i sıxır; 2%-dən aşağı — strukturca zərərlidir.

#### `PHARMA_RD_INTENSITY` — R&D Intensity

- **EN**: R&D intensity {value}%. Industry avg 17%; below 5% means no new-product pipeline — revenue cliff risk when patents expire.
- **RU**: Интенсивность R&D {value}%. Среднее по индустрии 17%; ниже 5% — нет new-product pipeline → riск revenue cliff.
- **AZ**: R&D intensivliyi {value}%. Sənaye orta göstəricisi 17%; 5%-dən aşağı — yeni-məhsul pipeline yoxdur → gəlir uçurumu riski.

#### `PHARMA_INVENTORY_DAYS` — Inventory Days

- **EN**: Inventory days = {value}. Above 120 means product is sitting on shelves — check for near-expiry stock or demand overestimation.
- **RU**: Inventory days = {value}. Выше 120 — продукт лежит на складе; проверьте near-expiry и pricing.
- **AZ**: Anbar günləri = {value}. 120-dən yuxarı — məhsul rəfdə yatır; istifadə-müddəti yaxınlaşan və qiymətləməni yoxlayın.

#### `PHARMA_OPEX_RATIO` — Pharma OpEx Ratio

- **EN**: OpEx {value}% of revenue. Pharma SG&A runs 25-40% with sales force + reg compliance. Above 45% suggests overhead isn't scaling with revenue.
- **RU**: OpEx {value}% от выручки. Pharma SG&A 25–40% (sales force + reg compliance). Выше 45% — sales-force overcapacity или compliance lag.
- **AZ**: OpEx gəlirin {value}%-dir. Pharma SG&A 25–40% (sales force + reg compliance). 45%-dən yuxarı — sales-force həddən artıq və ya compliance gecikmələri.

#### `RE_GROSS_MARGIN` — Real Estate NOI Margin

- **EN**: NOI margin {value}%. Commercial real estate baseline 65-85%; below 45% signals high operating expenses (utilities, property tax, maintenance) relative to rent.
- **RU**: NOI margin {value}%. Коммерческая недвижимость baseline 65–85%; ниже 45% — высокие операционные расходы или ослабление аренды.
- **AZ**: NOI marja {value}%. Kommersiya daşınmaz əmlak baseline 65–85%; 45%-dən aşağı — yüksək əməliyyat xərcləri və ya icarənin zəifləməsi.

#### `RE_OCCUPANCY` — Occupancy Rate

- **EN**: Occupancy {value}%. Stabilised commercial assets run 90%+; below 75% usually means pricing or product-market fit problem.
- **RU**: Заполняемость {value}%. Стабилизированные коммерческие активы 90%+; ниже 75% — проблемы pricing или продукта.
- **AZ**: Doluluq {value}%. Sabitləşmiş kommersiya aktivlər 90%+; 75%-dən aşağı — qiymətləmə və ya məhsul problemləri.

#### `RE_DEBT_SERVICE_COVERAGE` — Debt Service Coverage (DSCR)

- **EN**: DSCR {value}. Below 1.15 means NOI barely covers interest + principal — any rent drop triggers default risk.
- **RU**: DSCR {value}. Ниже 1.15 — NOI едва покрывает проценты + principal; любое падение аренды триггерит default.
- **AZ**: DSCR {value}. 1.15-dən aşağı — NOI faizləri + əsas borcu çətinliklə örtür; istənilən icarə azalması default-u tetikləyir.

#### `RE_RENT_COLLECTION` — Rent Collection Rate

- **EN**: Rent collection {value}%. Commercial target 98%+; below 92% means tenants can't pay — recession indicator.
- **RU**: Сбор аренды {value}%. Коммерческий target 98%+; ниже 92% — tenants не платят, индикатор рецессии.
- **AZ**: İcarə yığımı {value}%. Kommersiya hədəfi 98%+; 92%-dən aşağı — kirayəçilər ödəyə bilmir, resessiya göstəricisi.

#### `RE_OPEX_RATIO` — Real Estate OpEx Ratio

- **EN**: OpEx {value}% of revenue. Commercial RE baseline 25-40% (property mgmt + utilities + tax). Above 50% cuts distributable cash flow.
- **RU**: OpEx {value}% от выручки. Коммерческая недвижимость baseline 25–40% (property mgmt + utilities + tax). Выше 50% — vacancy growing или maintenance unaddressed.
- **AZ**: OpEx gəlirin {value}%-dir. Kommersiya daşınmaz əmlak baseline 25–40% (mülkiyyət idarəçiliyi + kommunal + vergi). 50%-dən yuxarı — boşluq artır və ya texniki xidmət həll edilməyib.

#### `ENT_ATTENDANCE_UTIL` — Attendance Utilization

- **EN**: Attendance utilization {value}%. Below 50% usually fails to cover fixed costs — pricing or marketing needs rework.
- **RU**: Утилизация посещений {value}%. Ниже 50% — обычно не покрывает фиксированные расходы; pricing или маркетинг misalignment.
- **AZ**: İştirak utilizasiyası {value}%. 50%-dən aşağı — adətən sabit xərcləri ödəmir; qiymətləmə və ya marketinq yanlış uyğunlaşması.

#### `ENT_REVENUE_PER_VISIT` — Revenue per Visit

- **EN**: Revenue/visit = {value} AZN. Healthy venues drive ancillary revenue (F&B, merch) to 30-50% of total. Below 12 usually means the ancillary channel isn't working.
- **RU**: Выручка/визит = {value} AZN. Здоровые площадки выводят ancillary revenue (F&B, merch) до 30–50% общего.
- **AZ**: Gəlir/ziyarət = {value} AZN. Sağlam məkanlar yardımçı gəlirləri (F&B, suvenir) ümuminin 30–50%-nə çıxarır.

#### `ENT_GROSS_MARGIN` — Entertainment Gross Margin

- **EN**: Gross margin {value}%. Entertainment operators run 50-65%; below 30% means costs-of-delivery (content, licensing, staff) are eating the ticket price.
- **RU**: Валовая маржа {value}%. Развлечения 50–65%; ниже 30% — costs-of-delivery (контент, площадка) выходят из-под контроля.
- **AZ**: Ümumi mənfəət {value}%. Əyləncə 50–65%; 30%-dən aşağı — çatdırılma xərcləri (kontent, məkan) nəzarətdən çıxır.

#### `ENT_SEASONALITY_CONCENTRATION` — Seasonality Concentration (Top-3 Month Share)

- **EN**: {value}% of revenue lands in the peak 3 months. Above 55% means a single bad season kills the year — diversify programming.
- **RU**: {value}% выручки в peak 3 месяца. Выше 55% — один плохой сезон убивает год; диверсифицируйте off-season offerings.
- **AZ**: Gəlirin {value}%-i pik 3 ayda. 55%-dən yuxarı — bir pis mövsüm ili məhv edir; off-season təklifləri diversifikasiya edin.

#### `EDU_ENROLLMENT_FILL` — Enrollment Fill Rate

- **EN**: Enrollment fill {value}%. Below 80% usually signals a pricing or reputation issue relative to competitors — fixed costs don't scale down.
- **RU**: Заполняемость зачисления {value}%. Ниже 80% — обычно сигнал pricing или репутации относительно конкурентов.
- **AZ**: Qeydiyyat doluluğu {value}%. 80%-dən aşağı — adətən rəqiblərlə müqayisədə qiymətləmə və ya reputasiya siqnalıdır.

#### `EDU_TUITION_COLLECTION` — Tuition Collection Rate

- **EN**: Tuition collection {value}%. Below 90% means arrears are building — tighten payment terms or risk cash-flow crunch.
- **RU**: Сбор обучения {value}%. Ниже 90% — задолженность растёт; ужесточите payment terms или risk cascade.
- **AZ**: Təhsil haqqı yığımı {value}%. 90%-dən aşağı — borclar artır; ödəniş şərtlərini sərtləşdirin və ya risk kaskadı.

#### `EDU_GROSS_MARGIN` — Education Gross Margin

- **EN**: Gross margin {value}%. Private education baselines 40-55%; below 20% means teacher cost + facility cost nearly equal tuition revenue.
- **RU**: Валовая маржа {value}%. Частное образование baseline 40–55%; ниже 20% — teacher cost + facility перевешивают tuition revenue.
- **AZ**: Ümumi mənfəət {value}%. Özəl təhsil baseline 40–55%; 20%-dən aşağı — müəllim xərci + tikili təhsil haqqı gəlirini üstələyir.

#### `EDU_STUDENT_TEACHER_RATIO` — Student-Teacher Ratio

- **EN**: Student-teacher ratio {value}. Sweet spot 10-20; above 25 erodes quality, 6-10 suggests over-staffing.
- **RU**: Соотношение студент-учитель {value}. Sweet spot 10–20; выше 25 эродирует качество, 6–10 — over-staffing.
- **AZ**: Tələbə-müəllim nisbəti {value}. Sweet spot 10–20; 25-dən yuxarı keyfiyyəti aşır, 6–10 — həddən artıq personal.

#### `POULTRY_FCR` — Feed Conversion Ratio

- **EN**: FCR = {value}. Best-in-class 1.6-1.7; above 1.9 usually means feed formulation, water quality, or temperature management issues.
- **RU**: FCR = {value}. Best-in-class 1.6–1.7; выше 1.9 — обычно feed formulation, water quality или температура.
- **AZ**: FCR = {value}. Best-in-class 1.6–1.7; 1.9-dən yuxarı — adətən yem formulyasiyası, su keyfiyyəti və ya temperatur.

#### `POULTRY_MORTALITY` — Flock Mortality Rate

- **EN**: Mortality {value}%. Target ≤4%; above 7% is a disease or environmental red flag — inspect ventilation, biosecurity, vaccination schedule.
- **RU**: Смертность {value}%. Цель ≤4%; выше 7% — болезнь или environmental red flag; проверяйте вентиляцию + биобезопасность.
- **AZ**: Ölüm {value}%. Hədəf ≤4%; 7%-dən yuxarı — xəstəlik və ya ətraf-mühit qırmızı bayrağı; ventilyasiya + biotəhlükəsizliyi yoxlayın.

#### `POULTRY_GROSS_MARGIN` — Poultry Gross Margin

- **EN**: Gross margin {value}%. Poultry is thin-margin commodity (typical 12-20%); below 5% a feed-price spike turns the cycle to a loss.
- **RU**: Валовая маржа {value}%. Поултри — тонкомаржинальный коммодити (типично 12–20%); ниже 5% feed-price скачок флипает в loss.
- **AZ**: Ümumi mənfəət {value}%. Quş əti incə-marjalı əmtəədir (tipik 12–20%); 5%-dən aşağı yem-qiymət sıçrayışı zərərə çevirir.

#### `FP_YIELD_LOSS` — Yield Loss Rate

- **EN**: Yield loss {value}%. Best-in-class 2-6%; above 10% means raw-material waste — inspect cutting, cooking, packaging lines.
- **RU**: Потеря выхода {value}%. Best-in-class 2–6%; выше 10% — отходы сырья; проверьте резку, варку, упаковку.
- **AZ**: Çıxış itkisi {value}%. Best-in-class 2–6%; 10%-dən yuxarı — xammal tullantısı; kəsmə, bişirmə, qablaşdırma yoxlayın.

#### `FP_GROSS_MARGIN` — Food Processing Gross Margin

- **EN**: Gross margin {value}%. Branded 30-40%, private-label 20-28%, commodity 10-18%. Below 12% means no pricing power.
- **RU**: Валовая маржа {value}%. Брендированный 30–40%, private-label 20–28%, commodity 10–18%. Ниже 12% — нет pricing power, продукт коммодити.
- **AZ**: Ümumi mənfəət {value}%. Brendli 30–40%, private-label 20–28%, əmtəə 10–18%. 12%-dən aşağı — qiymətləmə gücü yoxdur, məhsul əmtəədir.

#### `FP_INVENTORY_TURNS` — Inventory Turnover

- **EN**: Inventory turns = {value}/year. Perishable food targets 12-24; below 8 = spoilage risk.
- **RU**: Оборот инвентаря {value}/год. Скоропортящаяся еда target 12–24; ниже 8 = риск порчи.
- **AZ**: Anbar dövriyyəsi {value}/il. Tezxarabolan qida hədəfi 12–24; 8-dən aşağı = xarablanma riski.

#### `FP_OPEX_RATIO` — Food Processing OpEx Ratio

- **EN**: OpEx {value}% of revenue. Food processing runs 12-22%; above 28% is structurally heavy for the margin profile.
- **RU**: OpEx {value}% от выручки. Food processing 12–22%; выше 28% — структурно тяжело для маржи (логистика + стоимость холода).
- **AZ**: OpEx gəlirin {value}%-dir. Qida emalı 12–22%; 28%-dən yuxarı — marja üçün strukturca ağır (logistika + soyuq saxlama).

#### `FP_EXTRACTION_RATE` — Extraction / Recovery Rate

- **EN**: Extraction rate {value}% — {status}. Below 75% signals juice loss in mills, bagasse moisture too high, or evaporator scale.
- **RU**: Выход {value}% — {status}. Меньше 75% — потери сока на мельницах, влажность жома, накипь в выпарных.
- **AZ**: Çıxım {value}% — {status}. 75%-dən aşağı: dəyirmanda şirə itkisi, baqas nəmlik, evaporatorda təbəqə.

#### `BEV_GROSS_MARGIN` — Beverage Gross Margin

- **EN**: Gross margin {value}%. Cross-segment floor: branded 50-60%, alcohol 35-50%, commodity 25-35%. Below 15% no sub-segment is sustainable; 15-25% verify against your sub-segment.
- **RU**: Валовая маржа {value}%. Cross-segment floor: брендированный 50–60%, alcohol 35–50%, commodity 25–35%. Ниже 20% — переключение на коммодити-сегмент.
- **AZ**: Ümumi mənfəət {value}%. Cross-segment alt həddi: brendli 50–60%, alkoqol 35–50%, əmtəə 25–35%. 20%-dən aşağı — əmtəə-seqmentinə keçid.

#### `BEV_OPEX_RATIO` — Beverage OpEx Ratio

- **EN**: OpEx {value}% of revenue. Beverage SG&A is distribution + marketing-heavy; above 35% means brand investment isn't translating to volume.
- **RU**: OpEx {value}% от выручки. Beverage SG&A — distribution + marketing-heavy; выше 35% — brand investment overshoots margin.
- **AZ**: OpEx gəlirin {value}%-dir. Beverage SG&A — distribusiya + marketinq ağırlığı; 35%-dən yuxarı — brend investisiyası marjanı üstələyir.

#### `RETAIL_GROSS_MARGIN` — Retail Gross Margin

- **EN**: Gross margin {value}%. Grocery 20-28%, electronics 18-25%, fashion 45-55%, specialty 35-50%. Below 18% suggests pricing pressure or stale-inventory mark-downs.
- **RU**: Валовая маржа {value}%. Grocery 20–28%, electronics 18–25%, fashion 45–55%, specialty 35–50%. Ниже 12% — pricing pressure или mix shift.
- **AZ**: Ümumi mənfəət {value}%. Grocery 20–28%, electronics 18–25%, moda 45–55%, specialty 35–50%. 12%-dən aşağı — qiymətləmə təzyiqi və ya miks dəyişikliyi.

#### `RETAIL_INVENTORY_TURNS` — Retail Inventory Turnover

- **EN**: Inventory turns = {value}/year. Cross-segment floor: grocery 14-26, electronics 6-12, fashion 4-8, specialty 3-6. Below 3 no sub-segment is healthy; 3-6 verify against your sub-segment (specialty / slow-moving = OK, fashion = warning).
- **RU**: Оборот инвентаря {value}/год. Cross-segment floor: grocery 14–26, electronics 6–12, fashion 4–8, specialty 3–6. Ниже floor — обычно мёртвый запас.
- **AZ**: Anbar dövriyyəsi {value}/il. Cross-segment alt həddi: grocery 14–26, electronics 6–12, moda 4–8, specialty 3–6. Alt həddən aşağı — adətən ölü ehtiyat.

#### `LOG_OPEX_RATIO` — Logistics OpEx Ratio

- **EN**: OpEx {value}% of revenue. Trucking + warehousing run 70-90% structurally (driver pay, fuel, fleet); above 90% means margin is gone.
- **RU**: OpEx {value}% от выручки. Trucking + warehousing структурно 70–90% (driver pay, fuel, fleet); выше 92% — fleet underutilized или fuel hedge missing.
- **AZ**: OpEx gəlirin {value}%-dir. Trucking + warehousing strukturca 70–90% (sürücü əmək haqqı, yanacaq, parkomat); 92%-dən yuxarı — parkomat dolu deyil və ya yanacaq hedge yoxdur.

#### `LOG_GROSS_MARGIN` — Logistics Gross Margin

- **EN**: Gross margin {value}%. 3PL 12-20%, freight forwarding 8-15%, specialty 18-25%. Below 7% likely loss-making post-overhead.
- **RU**: Валовая маржа {value}%. 3PL 12–20%, freight forwarding 8–15%, specialty 18–25%. Ниже 7% — likely loss-making контракты.
- **AZ**: Ümumi mənfəət {value}%. 3PL 12–20%, freight forwarding 8–15%, specialty 18–25%. 7%-dən aşağı — çox güman ki zərərli müqavilələr.

#### `CONSTR_GROSS_MARGIN` — Construction Gross Margin

- **EN**: Gross margin {value}%. Heavy civil 8-14%, building 10-18%, specialty 18-25%. Below 8% means cost overruns are eating contingency.
- **RU**: Валовая маржа {value}%. Heavy civil 8–14%, building 10–18%, specialty 18–25%. Ниже 8% — cost overruns или mispriced bids.
- **AZ**: Ümumi mənfəət {value}%. Ağır mülki 8–14%, tikili 10–18%, ixtisaslaşmış 18–25%. 8%-dən aşağı — xərc aşımı və ya yanlış qiymətləndirilmiş təkliflər.

#### `CONSTR_OPEX_RATIO` — Construction OpEx Ratio

- **EN**: OpEx {value}% of revenue. Construction SG&A is structurally light (4-12%); above 10% means overhead growing faster than project backlog.
- **RU**: OpEx {value}% от выручки. Construction SG&A структурно лёгкий (4–12%); выше 10% — overhead растёт быстрее backlog.
- **AZ**: OpEx gəlirin {value}%-dir. Tikinti SG&A strukturca yüngüldür (4–12%); 10%-dən yuxarı — overhead backlog-dan tez artır.

### fx (2)

#### `HOSP_FX_EXPOSURE` — FX Exposure

- **EN**: {value}% of revenue is FX-denominated. A 10% AZN devaluation moves EBITDA by roughly the same share.
- **RU**: {value}% выручки в FX. Девальвация AZN на 10% двигает EBITDA примерно на ту же долю.
- **AZ**: Gəlirin {value}%-i FX-də. AZN-in 10% devalvasiyası EBITDA-nı təxminən eyni payda hərəkət etdirir.

#### `FX_IMPORTED_INPUT` — Imported-Input FX Exposure

- **EN**: {value}% of input costs are imported. AZN weakness hits gross margin directly.
- **RU**: {value}% затрат на сырьё — импорт. Ослабление AZN бьёт по валовой марже напрямую.
- **AZ**: Giriş xərclərinin {value}%-i idxaldır. AZN-in zəifləməsi ümumi mənfəətə birbaşa təsir edir.

### geopolitical (3)

#### `HOSP_SOURCE_HHI` — Source-Country Concentration (HHI)

- **EN**: HHI = {value}. Above 2500 means a single source market dominates — one travel restriction can sink the quarter.
- **RU**: HHI = {value}. Выше 2500 — один source-market доминирует; одно travel-ограничение топит квартал.
- **AZ**: HHI = {value}. 2500-dən yuxarı bir mənbə bazar üstünlük təşkil edir; bir səyahət məhdudiyyəti rübü batırır.

#### `IND_REVENUE_HHI` — Revenue Concentration (HHI)

- **EN**: Revenue HHI = {value}. Above 3000 means a single product/customer dominates — diversify the pipeline before regulatory or demand shock.
- **RU**: HHI выручки = {value}. Выше 3000 — один продукт/клиент доминирует; диверсифицируйте pipeline до регуляторного или спросового шока.
- **AZ**: Gəlir HHI = {value}. 3000-dən yuxarı bir məhsul/müştəri üstünlük təşkil edir — tənzimləyici və ya tələb şokundan əvvəl pipeline-ı diversifikasiya edin.

#### `SVC_REVENUE_CONCENTRATION` — Revenue Concentration (HHI)

- **EN**: Revenue HHI = {value}. Above 3000 means a single client dominates — losing them jeopardises the business. Diversify the pipeline.
- **RU**: HHI выручки = {value}. Выше 3000 — один клиент доминирует; его потеря угрожает бизнесу. Диверсифицируйте pipeline.
- **AZ**: Gəlir HHI = {value}. 3000-dən yuxarı bir müştəri üstünlük təşkil edir — onu itirmək biznesi təhlükəyə atır. Pipeline-ı diversifikasiya edin.

### macro (2)

#### `AGRO_DROUGHT_RISK` — Drought Risk Index

- **EN**: Drought index at {value}/100 — above 60 is the historical threshold for >20% yield loss in the region.
- **RU**: Индекс засухи {value}/100 — выше 60 — исторический порог для >20% потери урожая в регионе.
- **AZ**: Quraqlıq indeksi {value}/100 — 60-dan yuxarı bölgə üçün >20% məhsul itkisinin tarixi həddi.

#### `AGRO_WEATHER_RAINFALL` — Trailing 90-day Rainfall

- **EN**: Trailing 90-day rainfall {value} mm — {status}. Below 30 mm in growing season indicates drought stress on cane.
- **RU**: Осадки за 90 дней {value} мм — {status}. Меньше 30 мм в вегетацию — засушливый стресс на тростнике.
- **AZ**: Son 90 günün yağıntısı {value} mm — {status}. Vegetasiyada 30 mm-dən aşağı qamış üçün quraqlıq stresidir.

### commodity (3)

#### `AGRO_COMMODITY_VOL` — Commodity Price Volatility

- **EN**: Trailing-12M price volatility is {value}%. Above 25% — consider forward contracts to lock margins.
- **RU**: Скользящая 12-месячная волатильность цены {value}%. Выше 25% — рассмотрите forward-контракты для фиксации маржи.
- **AZ**: Sürüşkən 12-aylıq qiymət volatilliyi {value}%. 25%-dən yuxarı — marjanı bağlamaq üçün forvard müqavilələrini nəzərdən keçirin.

#### `AGRO_SUGAR_PRICE_TREND` — Sugar Price (vs 12M mean)

- **EN**: Sugar price {value}% vs 12M mean — {status}. Below −10% suggests forward-contract a slice of next-quarter output.
- **RU**: Цена сахара {value}% от 12-мес среднего — {status}. Ниже −10% — стоит застраховать часть выпуска следующего квартала.
- **AZ**: Şəkər qiyməti 12 aylıq ortalamadan {value}% — {status}. −10%-dən aşağı: növbəti rübün bir hissəsini forvard etmək.

#### `POULTRY_FEED_COST_SHARE` — Feed Cost Share of COGS

- **EN**: Feed is {value}% of COGS. Sweet spot 58-72%; above 78% means feed-price exposure is too high — hedge or forward-contract.
- **RU**: Feed = {value}% от COGS. Sweet spot 58–72%; выше 78% — feed-price exposure высокая, хеджируйте grain или закройте feed-mill.
- **AZ**: Yem COGS-un {value}%-i. Sweet spot 58–72%; 78%-dən yuxarı — yem-qiymət riski yüksəkdir, dəni hedge edin və ya feed-mill bağlayın.

### commercial (1)

#### `AGRO_BUYER_CONCENTRATION` — Sugar-Mill Buyer Concentration

- **EN**: Top-buyer share {value}% — {status}. >70% means a single mill's 30-day delay creates immediate cash crisis. Diversify or hedge with payment-term contracts.
- **RU**: Доля топ-покупателя {value}% — {status}. >70% — задержка одним заводом на 30 дней = кассовый разрыв. Диверсифицировать или хеджировать условиями оплаты.
- **AZ**: Əsas alıcının payı {value}% — {status}. >70%: bir zavodun 30 günlük gecikməsi = pul böhranı. Diversifikasiya və ya ödəniş şərtləri ilə hedcinq.

### concentration (2)

#### `CUSTOMER_HHI` — Customer Concentration (HHI)

- **EN**: Customer HHI is {value}. Above 0.25 = one buyer holds enough share to threaten cash flow on a single delayed payment.
- **RU**: HHI клиентов = {value}. Выше 0.25 — один покупатель держит достаточно доли, чтобы поставить под угрозу cash flow при единственной задержке платежа.
- **AZ**: Müştəri HHI = {value}. 0.25-dən yuxarı — bir alıcının payı bir gecikmiş ödənişlə pul axınını təhdid etmək üçün kifayət edir.

#### `SUPPLIER_HHI` — Supplier Concentration (HHI)

- **EN**: Supplier HHI is {value}. Above 0.35 + presence of single-source suppliers makes COGS extremely fragile.
- **RU**: HHI поставщиков = {value}. Выше 0.35 + наличие single-source поставщиков делает COGS крайне хрупким.
- **AZ**: Tədarükçü HHI = {value}. 0.35-dən yuxarı + tək mənbəli tədarükçülərin olması COGS-i çox kövrək edir.

### internal (2)

#### `IND_REVENUE_TOTAL` — Revenue (Total)

- **EN**: Total revenue {value} AZN. Persists raw $ for rollup() and fact() composites; risk classification lives on margin indicators.
- **RU**: Общая выручка {value} AZN. Сохраняет сырые $ для rollup() и fact() композитов; классификация рисков на других индикаторах.
- **AZ**: Ümumi gəlir {value} AZN. Rollup() və fact() kompozitləri üçün xam $ saxlayır; risk təsnifatı digər göstəricilərdə.

#### `IND_HOLDING_REVENUE` — Holding Revenue (rollup)

- **EN**: Holding-wide revenue {value} AZN, summed across direct children. 0 = no operational sub-cos contributing yet. Most meaningful at parent (level=1) companies.
- **RU**: Выручка холдинга {value} AZN, суммарно по прямым дочерним компаниям. 0 = ни одна операционная саб-ко не дала вклад.
- **AZ**: Holdinqin gəliri {value} AZN, birbaşa törəmə şirkətlər üzrə cəmi. 0 = heç bir əməliyyat törəməsi töhfə verməyib.

### esg (10)

#### `IND_CARBON_SCOPE_1` — Carbon emissions — Scope 1 (direct)

- **EN**: Direct emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: revenue × sector intensity factor.
- **RU**: Прямые выбросы (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: выручка × коэффициент интенсивности.
- **AZ**: Birbaşa emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: gəlir × sənaye intensivlik əmsalı.

#### `IND_CARBON_SCOPE_2` — Carbon emissions — Scope 2 (purchased electricity)

- **EN**: Purchased electricity emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 2 intensity.
- **RU**: Выбросы покупной энергии (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 2 по отрасли.
- **AZ**: Alınan elektrikdən emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 2 intensivliyi.

#### `IND_CARBON_SCOPE_3` — Carbon emissions — Scope 3 (supply chain)

- **EN**: Supply-chain emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 3 intensity.
- **RU**: Выбросы цепочки поставок (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 3 по отрасли.
- **AZ**: Təchizat zənciri emissiyaları (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 3 intensivliyi.

#### `IND_ESG_COMPOSITE` — ESG composite score

- **EN**: ESG composite {value}/100 — {status}. INDUSTRY MODEL: 100 − (total emissions / size). v2.2 derived from sector intensity; v3 will weight E + S + G separately.
- **RU**: ESG композит {value}/100 — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: 100 − (общие выбросы / размер). v2.2 на отраслевом коэффициенте; v3 будет взвешивать E + S + G раздельно.
- **AZ**: ESG kompozit {value}/100 — {status}. SƏNAYE MODELİ: 100 − (ümumi emissiya / həcm). v2.2 sənaye əmsalı; v3 E + S + G ayrı çəkiləcək.

#### `IND_GOV_CLIMATE_SCORE` — Azerbaijan government climate readiness

- **EN**: AZ government climate readiness {value}/100 — {status}. MACRO: static literal from public reports; v3 wires to live data feed.
- **RU**: Климатическая готовность Азербайджана {value}/100 — {status}. МАКРО: статичное значение из публичных отчётов; v3 — живой фид.
- **AZ**: Azərbaycanın iqlim hazırlığı {value}/100 — {status}. MAKRO: ictimai hesabatlardan statik dəyər; v3 canlı feed.

#### `IND_CARBON_SCOPE_1` — Carbon emissions — Scope 1 (direct)

- **EN**: Direct emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: revenue × sector intensity factor.
- **RU**: Прямые выбросы (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: выручка × коэффициент интенсивности.
- **AZ**: Birbaşa emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: gəlir × sənaye intensivlik əmsalı.

#### `IND_CARBON_SCOPE_2` — Carbon emissions — Scope 2 (purchased electricity)

- **EN**: Purchased electricity emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 2 intensity.
- **RU**: Выбросы покупной энергии (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 2 по отрасли.
- **AZ**: Alınan elektrikdən emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 2 intensivliyi.

#### `IND_CARBON_SCOPE_3` — Carbon emissions — Scope 3 (supply chain)

- **EN**: Supply-chain emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 3 intensity.
- **RU**: Выбросы цепочки поставок (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 3 по отрасли.
- **AZ**: Təchizat zənciri emissiyaları (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 3 intensivliyi.

#### `IND_ESG_COMPOSITE` — ESG composite score

- **EN**: ESG composite {value}/100 — {status}. INDUSTRY MODEL: 100 − (total emissions / size). v2.2 derived from sector intensity; v3 will weight E + S + G separately.
- **RU**: ESG композит {value}/100 — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: 100 − (общие выбросы / размер). v2.2 на отраслевом коэффициенте; v3 будет взвешивать E + S + G раздельно.
- **AZ**: ESG kompozit {value}/100 — {status}. SƏNAYE MODELİ: 100 − (ümumi emissiya / həcm). v2.2 sənaye əmsalı; v3 E + S + G ayrı çəkiləcək.

#### `IND_GOV_CLIMATE_SCORE` — Azerbaijan government climate readiness

- **EN**: AZ government climate readiness {value}/100 — {status}. MACRO: static literal from public reports; v3 wires to live data feed.
- **RU**: Климатическая готовность Азербайджана {value}/100 — {status}. МАКРО: статичное значение из публичных отчётов; v3 — живой фид.
- **AZ**: Azərbaycanın iqlim hazırlığı {value}/100 — {status}. MAKRO: ictimai hesabatlardan statik dəyər; v3 canlı feed.

### news (2)

#### `IND_NEWS_SENTIMENT_30D` — News sentiment (30-day)

- **EN**: News sentiment {value}/100 over last 30 days — {status}. AI-scored from {n_items} articles tagged with this company.
- **RU**: Тональность новостей {value}/100 за 30 дней — {status}. AI-оценка по {n_items} статьям с упоминанием компании.
- **AZ**: Xəbər tonallığı {value}/100 son 30 gün — {status}. AI-qiymətləndirmə şirkət haqqında {n_items} məqalədən.

#### `IND_NEWS_SENTIMENT_30D` — News sentiment (30-day)

- **EN**: News sentiment {value}/100 over last 30 days — {status}. AI-scored from {n_items} articles tagged with this company.
- **RU**: Тональность новостей {value}/100 за 30 дней — {status}. AI-оценка по {n_items} статьям с упоминанием компании.
- **AZ**: Xəbər tonallığı {value}/100 son 30 gün — {status}. AI-qiymətləndirmə şirkət haqqında {n_items} məqalədən.
