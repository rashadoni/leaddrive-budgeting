# AZ Translations Review — Terminal UI + Indicator Hints

**Generated:** 2026-06-01 (regenerated to include the terminal i18n sweep + signal i18n additions).
**Scope:** 960 terminal UI strings (`messages/az.json terminal.*`) + 44 live indicator hint templates (isActive, DB). EN/RU/AZ side-by-side for native-AZ-speaker review.

Supersedes the 2026-05-21 version (which covered only the 80 indicator hints). Closes the data-currency gap flagged in CARRYOVER «Architect Turn-XI 💡 #2» after the 2026-06-01 i18n work added ~150 new machine-authored AZ UI strings (scenarioDesc/Panel/Form, cards, signals).

> Hints cover **live** indicators (`isActive` + non-null AZ hint). Inactive/un-seeded indicators are intentionally excluded — they are not shown to users.

## How to review

1. Skim the **Heuristic flags** first — fastest path to likely-awkward strings (English business terms left in the AZ text).
2. Then scan the full tables. Check AZ vs EN/RU for: (a) calques (literal EN word-order), (b) wrong domain term (finance jargon should match the Azerbaijani financial press, not a direct EN translation), (c) agreement / case, (d) English words left untranslated where a native term reads better.
3. Fix path — **UI strings:** edit `messages/az.json` (+ `en`/`ru` only if the key itself is wrong) at the listed key. **Hints:** edit `hintTemplateAz` in the relevant `src/lib/risk/seeds/*.ts` (or `esg-seeds.ts`) then re-seed. ALWAYS keep `{placeholders}` and technical tokens (FAO/Brent/AZN/CAPEX/EBITDA/…) intact.
4. After review, close the CARRYOVER «AZ translations native-speaker review» row.

## Heuristic flag candidates (11) — EN-word-leak, verify with native speaker

*Candidates only* — a curated English-business-term match in the AZ string. Some may be intentional; a native speaker confirms.

| Where | Key / Code | Flagged | EN | AZ |
|---|---|---|---|---|
| UI | `help.legendUnitRatio` | leverage | Ratio (e.g. operating leverage) | Nisbət (məs. operating leverage) |
| UI | `indicatorDetail.pipelineNote` | Pipeline | Pipeline note | Pipeline qeydi |
| UI | `scenario.subtitle` | pipeline | What-if overrides on the org's indicator pipeline. Press Esc to close. | Org göstərici pipeline üzərində what-if dəyişiklikləri. Esc bağlamaq üçün. |
| UI | `scenarioDesc.IRAN_HIGH` | COGS | Sanctions regime tightens — petrochem feedstock cost +20%, AZN/USD spread widens, foreign-currency import lines repriced at the higher rate. Stress-tests cogs/opex against AGRO_FX_RISK + IND_NET_MARGIN. | Sanksiya rejimi sərtləşir — neft-kimya xammalı xərci +20%, AZN/USD spredi genişlənir, xarici valyuta idxal xətləri daha yüksək məzənnə ilə yenidən qiymətləndirilir. AGRO_FX_RISK + IND_NET_MARGIN üzrə COGS/OpEx stress-testi. |
| UI | `scenarioDesc.SUGAR_PRICE_DROP_20` | COGS | Global sugar price −20%: margin falls faster than revenue (COGS fixed). | Dünya şəkər qiyməti −20%: marja gəlirdən sürətli düşür (COGS sabit). |
| hint | `IND_EBITDA_MARGIN` | leverage | EBITDA margin: {value}%. ≥20% = strong operating leverage; 10-19% = adequate; <10% = thin margin risk. D&A (703-11/721-11) is added back from budget lines — equals EBIT when D&A codes are absent. | FVƏA marjası: {value}%. ≥20% = güclü əməliyyat leverage; 10-19% = qənaətbəxş; <10% = nazik marja riski. D&A (703-11/721-11) büdcə sətrlərindən geri əlavə edilir. |
| hint | `SUPPLIER_HHI` | COGS | Supplier HHI is {value}. Above 0.35 + presence of single-source suppliers makes COGS extremely fragile. | Tədarükçü HHI = {value}. 0.35-dən yuxarı + tək mənbəli tədarükçülərin olması COGS-i çox kövrək edir. |
| hint | `SVC_COGS_INTENSITY` | COGS | COGS {value}% of revenue. Services above 60% usually means low-margin re-selling or high third-party pass-through costs. | COGS gəlirin {value}%-dir. Xidmətdə 60%-dən yuxarı — adətən aşağı-marja yenidən-satış və ya yüksək üçüncü-tərəf pass-through xərcləri. |
| hint | `SVC_NET_MARGIN` | overhead | Net margin {value}%. Services businesses below 0% are losing money on operations — investigate pricing, utilization, and overhead allocation. | Xalis mənfəət {value}%. 0%-dən aşağı xidmət bizneslər əməliyyatlarda pul itirir — qiymətləmə, utilizasiya və overhead bölgüsünü yoxlayın. |
| hint | `SVC_OPEX_RATIO` | overhead | OpEx {value}% of revenue. Services baseline 50-70% (personnel-heavy); above 85% suggests depreciation or overhead is too large for the revenue base. | OpEx gəlirin {value}%-dir. Xidmət baseline 50–70% (personalla yüklü); 85%-dən yuxarı — amortizasiya və ya overhead gəlir bazası üçün çox böyükdür. |
| hint | `SVC_REVENUE_CONCENTRATION` | Pipeline | Revenue HHI = {value}. Above 3000 means a single client dominates — losing them jeopardises the business. Diversify the pipeline. | Gəlir HHI = {value}. 3000-dən yuxarı bir müştəri üstünlük təşkil edir — onu itirmək biznesi təhlükəyə atır. Pipeline-ı diversifikasiya edin. |

## Section A — Terminal UI strings (960)

### `actionCenter` (17)

| Key | EN | RU | AZ |
|---|---|---|---|
| `actionCenter.alertChipAriaLabel` | Jump to {code} | Перейти к {code} | {code}-a keç |
| `actionCenter.alertsSectionAriaLabel` | Rule-engine alerts grouped above cell items | Алерты движка правил, сгруппированы над ячейками | Qayda mühərriki xəbərdarlıqları, xanaların üstündə qruplaşdırılıb |
| `actionCenter.alertsSectionTitle` | Active rule alerts ({count}) | Активные алерты правил ({count}) | Aktiv qayda xəbərdarlıqları ({count}) |
| `actionCenter.closeAriaLabel` | Close action center | Закрыть очередь действий | Tədbir Mərkəzini bağla |
| `actionCenter.currentValue` | Value | Значение | Dəyər |
| `actionCenter.dialogAriaLabel` | Action Center | Очередь действий | Tədbir Mərkəzi |
| `actionCenter.itemAriaLabel` | Review {company} {indicator} | Разобрать {company} {indicator} | {company} {indicator} baxılmalıdır |
| `actionCenter.itemReviewHint` | Click → jump to {company} · {indicator} | Клик → перейти к {company} · {indicator} | Klik → {company} · {indicator}-a keç |
| `actionCenter.matrixLoading` | Matrix loading… work items populate after first refresh. | Матрица загружается… элементы появятся после первого обновления. | Matris yüklənir… elementlər ilk yenilənmədən sonra görünəcək. |
| `actionCenter.noWorkItems` | ✓ No pending items — all systems green. | ✓ Нет открытых элементов — всё зелёное. | ✓ Açıq element yoxdur — bütün sistemlər yaşıl. |
| `actionCenter.openVerb` | ACT | ACT | ACT |
| `actionCenter.openVerbHint` | Open Action Center | Открыть очередь действий | Tədbir Mərkəzini aç |
| `actionCenter.severityAmber` | Amber — watch closely ({count}) | Amber — наблюдение ({count}) | Amber — diqqət ({count}) |
| `actionCenter.severityRed` | Red — needs review ({count}) | Red — требует разбора ({count}) | Red — baxılmalıdır ({count}) |
| `actionCenter.severitySectionAriaLabel` | {severity} work items | Элементы — {severity} | {severity} elementlər |
| `actionCenter.subtitle` | Pending review queue across the holding. Click any row to jump to the offending cell. Press Esc to close. | Очередь требующих внимания строк по холдингу. Кликните строку чтобы перейти к ячейке. Esc для закрытия. | Holdinq üzrə baxılması gözlənilən növbə. Sətrə klikləyin — uyğun xanaya keçin. Bağlamaq üçün Esc. |
| `actionCenter.title` | Action Center ({count}) | Очередь действий ({count}) | Tədbir Mərkəzi ({count}) |

### `agroDashboard` (23)

| Key | EN | RU | AZ |
|---|---|---|---|
| `agroDashboard.emptyBody` | Enter your first observation via <kpi>KPI GO</kpi> or bulk-import an Excel sheet at <path>/budgeting/admin/data-entry</path>. The cells below light up green / amber / red as soon as values land. | Введите первое наблюдение через <kpi>KPI GO</kpi> или загрузите Excel-таблицу массово на <path>/budgeting/admin/data-entry</path>. Ячейки ниже загораются зелёным / жёлтым / красным, как только появляются значения. | İlk müşahidənizi <kpi>KPI GO</kpi> vasitəsilə daxil edin və ya <path>/budgeting/admin/data-entry</path> ünvanında Excel cədvəlini toplu şəkildə idxal edin. Dəyərlər daxil olan kimi aşağıdakı xanalar yaşıl / sarı / qırmızı işıqlanır. |
| `agroDashboard.emptyTitle` | No agronomy data yet | Агрономических данных пока нет | Hələ aqronomiya məlumatı yoxdur |
| `agroDashboard.hectaresPlanted` | {ha} ha planted | {ha} га засеяно | {ha} ha əkilib |
| `agroDashboard.hintExtraction` | Modern cane refineries 85–92% | Современные тростниковые заводы 85–92% | Müasir qamış zavodları 85–92% |
| `agroDashboard.hintFertilizer` | Cane: ~300–600 kg/ha NPK or urea | Тростник: ~300–600 кг/га NPK или мочевина | Qamış: ~300–600 kq/ha NPK və ya karbamid |
| `agroDashboard.hintHarvest` | Total tonnage harvested for the period | Общий собранный тоннаж за период | Dövr ərzində yığılan ümumi tonaj |
| `agroDashboard.hintSugarContent` | Cane: 14%+ green · 10–14 amber · <10 red | Тростник: 14%+ зелёный · 10–14 жёлтый · <10 красный | Qamış: 14%+ yaşıl · 10–14 sarı · <10 qırmızı |
| `agroDashboard.hintWater` | Cane: <12,000 efficient · 12–18k typical | Тростник: <12 000 эффективно · 12–18 тыс. типично | Qamış: <12 000 səmərəli · 12–18 min adi |
| `agroDashboard.hintYield` | Sugarcane target 60+ t/ha · sugar beet 40–70 | Сахарный тростник — цель 60+ т/га · сахарная свёкла 40–70 | Şəkər qamışı hədəfi 60+ t/ha · şəkər çuğunduru 40–70 |
| `agroDashboard.labelExtraction` | Extraction (%) | Извлечение (%) | Çıxarış (%) |
| `agroDashboard.labelFertilizer` | Fertilizer (kg/ha) | Удобрение (кг/га) | Gübrə (kq/ha) |
| `agroDashboard.labelHarvest` | Harvest (tons) | Урожай (тонн) | Məhsul (ton) |
| `agroDashboard.labelSugarContent` | Sugar content (%) | Сахаристость (%) | Şəkərlilik (%) |
| `agroDashboard.labelWater` | Water (m³/ha) | Вода (м³/га) | Su (m³/ha) |
| `agroDashboard.labelYield` | Yield (t/ha) | Урожайность (т/га) | Məhsuldarlıq (t/ha) |
| `agroDashboard.loading` | Loading agronomy data… | Загрузка агрономических данных… | Aqronomiya məlumatları yüklənir… |
| `agroDashboard.notApplicable` | Agro dashboard applies to <strong>agro_crops</strong> and <strong>food_processing</strong> companies. | Агро-дашборд применим к компаниям <strong>agro_crops</strong> и <strong>food_processing</strong>. | Aqrar idarə paneli <strong>agro_crops</strong> və <strong>food_processing</strong> şirkətlərinə aiddir. |
| `agroDashboard.notApplicableActive` | Active company {company} is | Активная компания {company} — | Aktiv şirkət {company} — |
| `agroDashboard.observations` | {count, plural, one {# observation} other {# observations}} | {count, plural, one {# наблюдение} few {# наблюдения} many {# наблюдений} other {# наблюдения}} | {count, plural, one {# müşahidə} other {# müşahidə}} |
| `agroDashboard.recentEntries` | Recent agronomy entries | Недавние агрономические записи | Son aqronomiya qeydləri |
| `agroDashboard.recentEntriesEmpty` | Empty — first KPI entry will appear here as a row with date, metric, value, unit. | Пусто — первая запись KPI появится здесь строкой с датой, метрикой, значением и единицей. | Boşdur — ilk KPI qeydi burada tarix, metrika, dəyər və vahidlə bir sətir kimi görünəcək. |
| `agroDashboard.selectCompany` | Select a company in the company tree to view agro dashboard. | Выберите компанию в дереве компаний, чтобы открыть агро-дашборд. | Aqrar idarə panelini görmək üçün şirkət ağacında şirkət seçin. |
| `agroDashboard.yieldTarget` | target {value} t/ha | цель {value} т/га | hədəf {value} t/ha |

### `agronomyEntry` (23)

| Key | EN | RU | AZ |
|---|---|---|---|
| `agronomyEntry.bulkTip` | Tip: bulk uploads (Excel with companyCode + metric + date + value columns) are at <code></code>. | Совет: массовая загрузка (Excel со столбцами companyCode + metric + date + value) доступна по адресу <code></code>. | Məsləhət: kütləvi yükləmələr (companyCode + metric + date + value sütunları olan Excel) <code></code> ünvanındadır. |
| `agronomyEntry.dateLabel` | Date | Дата | Tarix |
| `agronomyEntry.emptyState` | Select a company in the company tree to log an agronomy entry. | Выберите компанию в дереве компаний, чтобы внести агрономическую запись. | Aqronomiya qeydi əlavə etmək üçün şirkət ağacından şirkət seçin. |
| `agronomyEntry.errSelectCompany` | Select a company first. | Сначала выберите компанию. | Əvvəlcə şirkət seçin. |
| `agronomyEntry.errValueNotFinite` | Value must be a finite number. | Значение должно быть конечным числом. | Dəyər sonlu ədəd olmalıdır. |
| `agronomyEntry.metricAreaPlanted` | Area planted (ha) | Засеянная площадь (га) | Əkilmiş sahə (ha) |
| `agronomyEntry.metricExtractionRate` | Extraction rate (%) | Коэффициент извлечения (%) | Çıxarış əmsalı (%) |
| `agronomyEntry.metricFertilizer` | Fertilizer (kg/ha) | Расход удобрений (kg/ha) | Gübrə istifadəsi (kg/ha) |
| `agronomyEntry.metricHarvest` | Harvest (tons) | Урожай (тонн) | Yığım (ton) |
| `agronomyEntry.metricLabel` | Metric | Метрика | Metrik |
| `agronomyEntry.metricSugarContent` | Sugar content (%) | Сахаристость (%) | Şəkərlilik (%) |
| `agronomyEntry.metricWaterUse` | Water use (m³/ha) | Расход воды (m³/ha) | Su istifadəsi (m³/ha) |
| `agronomyEntry.metricYield` | Yield (tons/ha) | Урожайность (тонн/га) | Məhsuldarlıq (ton/ha) |
| `agronomyEntry.noteLabel` | Source / note (optional) | Источник / примечание (необязательно) | Mənbə / qeyd (istəyə bağlı) |
| `agronomyEntry.notePlaceholder` | e.g. on-site weighing 2026-04-30, batch #12 | напр. взвешивание на месте 2026-04-30, партия №12 | məs. yerində çəki 2026-04-30, partiya №12 |
| `agronomyEntry.readOnlyBadge` | Read-only (viewer role) | Только чтение (роль наблюдателя) | Yalnız oxuma (izləyici rolu) |
| `agronomyEntry.saveAnyway` | Save anyway | Сохранить всё равно | Yenə də yadda saxla |
| `agronomyEntry.saveEntry` | Save entry | Сохранить запись | Qeydi yadda saxla |
| `agronomyEntry.saved` | Saved | Сохранено | Yadda saxlanıldı |
| `agronomyEntry.softWarningsHeading` | Soft warnings: | Мягкие предупреждения: | Yumşaq xəbərdarlıqlar: |
| `agronomyEntry.softWarningsHint` | Tap "{action}" to confirm and persist. | Нажмите «{action}», чтобы подтвердить и сохранить. | Təsdiqləmək və yadda saxlamaq üçün «{action}» düyməsinə toxunun. |
| `agronomyEntry.title` | Agronomy entry | Агрономическая запись | Aqronomiya qeydi |
| `agronomyEntry.valueLabel` | Value | Значение | Dəyər |

### `alerts` (13)

| Key | EN | RU | AZ |
|---|---|---|---|
| `alerts.empty` | No alerts firing | Нет активных алертов | Aktiv xəbərdarlıq yoxdur |
| `alerts.loading` | Checking rules… | Проверка правил… | Qaydalar yoxlanılır… |
| `alerts.messages.company-critical-composite` | {code} composite score {score}/100 ({contributing}/{total} indicators) | {code}: композитный балл {score}/100 ({contributing}/{total} индикаторов) | {code}: kompozit bal {score}/100 ({contributing}/{total} göstərici) |
| `alerts.messages.company-mostly-red` | {code} has {redCount} red indicators — needs review | {code}: {redCount} красных индикаторов — требуется проверка | {code}: {redCount} qırmızı göstərici — yoxlama tələb olunur |
| `alerts.messages.critical-indicator-org-wide` | {code} red for {companyCount} companies — consolidated pressure on critical metric | {code} красный у {companyCount} компаний — консолидированное давление на критическую метрику | {code} {companyCount} şirkətdə qırmızı — kritik metrika üzrə konsolidasiya təzyiqi |
| `alerts.messages.sector-amber-cluster` | {industry} sector: {amberCount} amber cells across {companyCount} companies | Сектор {industry}: {amberCount} амбер-ячеек у {companyCount} компаний | {industry} sektoru: {companyCount} şirkətdə {amberCount} sarı xana |
| `alerts.messages.sector-red-spread` | {industry} sector: {redCount} red cells across {companyCount} companies — possible contagion | Сектор {industry}: {redCount} красных ячеек у {companyCount} компаний — возможна цепная реакция | {industry} sektoru: {companyCount} şirkətdə {redCount} qırmızı xana — yayılma riski var |
| `alerts.rules.company-critical-composite` | Composite score below threshold | Композитный балл ниже порога | Kompozit bal həddən aşağıdır |
| `alerts.rules.company-mostly-red` | Company has many red indicators | У компании много красных индикаторов | Şirkətin çoxsaylı qırmızı göstəriciləri var |
| `alerts.rules.critical-indicator-org-wide` | Critical indicator org-wide | Критический индикатор по холдингу | Holdinq üzrə kritik göstərici |
| `alerts.rules.sector-amber-cluster` | Sector amber cluster | Янтарный кластер сектора | Sektorun sarı klasteri |
| `alerts.rules.sector-red-spread` | Sector red contagion | Красное распространение в секторе | Sektorda qırmızının yayılması |
| `alerts.title` | Alerts | Алерты | Xəbərdarlıqlar |

### `alertsPanel` (14)

| Key | EN | RU | AZ |
|---|---|---|---|
| `alertsPanel.closeAriaLabel` | Close alerts panel | Закрыть панель алертов | Xəbərdarlıq panelini bağla |
| `alertsPanel.companyCodeNotLoaded` | Company code not loaded — try reopening | Код компании не загружен — попробуйте переоткрыть | Şirkət kodu yüklənmədi — yenidən açmağa cəhd et |
| `alertsPanel.couldNotLoadCodes` | Could not load company codes — chips show ids: {error} | Не удалось загрузить коды компаний — чипы показывают id: {error} | Şirkət kodları yüklənmədi — çiplər id-ləri göstərir: {error} |
| `alertsPanel.dialogAriaLabel` | Alerts panel | Панель алертов | Xəbərdarlıq paneli |
| `alertsPanel.jumpToCompany` | Jump to {code} | Перейти к {code} | {code}-a keç |
| `alertsPanel.loadingCodes` | Loading codes… | Загрузка кодов… | Kodlar yüklənir… |
| `alertsPanel.matrixLoading` | Matrix loading… alerts populate after first refresh. | Матрица загружается… алерты появятся после первого обновления. | Matris yüklənir… xəbərdarlıqlar ilk yenilənmədən sonra görünəcək. |
| `alertsPanel.noAlerts` | ✓ No alerts triggered — all systems green. | ✓ Алерты не сработали — всё зелёное. | ✓ Xəbərdarlıq yoxdur — bütün sistemlər yaşıl. |
| `alertsPanel.severityCritical` | Critical | Критично | Kritik |
| `alertsPanel.severityInfo` | Info | Инфо | İnfo |
| `alertsPanel.severitySectionAriaLabel` | {severity} alerts | Алерты — {severity} | {severity} xəbərdarlıqları |
| `alertsPanel.severityWarning` | Warning | Предупреждение | Xəbərdarlıq |
| `alertsPanel.subtitle` | Multi-indicator rule matches across the holding. Press Esc to close. | Совпадения мульти-индикаторных правил по холдингу. Esc для закрытия. | Holdinq üzrə çox-göstəricili qayda uyğunluqları. Bağlamaq üçün Esc. |
| `alertsPanel.title` | Alerts ({count}) | Алерты ({count}) | Xəbərdarlıqlar ({count}) |

### `auditModal` (4)

| Key | EN | RU | AZ |
|---|---|---|---|
| `auditModal.close` | Close | Закрыть | Bağla |
| `auditModal.closeAriaLabel` | Close audit log | Закрыть журнал аудита | Audit jurnalını bağla |
| `auditModal.subtitle` | High-business-impact writes. Press Esc to close. | Записи с высоким бизнес-эффектом. Esc для закрытия. | Yüksək biznes-təsirli yazılar. Bağlamaq üçün Esc. |
| `auditModal.title` | Audit Log | Журнал аудита | Audit Jurnalı |

### `auditTicker` (5)

| Key | EN | RU | AZ |
|---|---|---|---|
| `auditTicker.ariaLabel` | Recent audit events — click to open full audit log | Недавние события аудита — клик откроет полный журнал | Son audit hadisələri — tam jurnalı açmaq üçün klik |
| `auditTicker.events` | EVENTS | СОБЫТИЯ | HADİSƏLƏR |
| `auditTicker.loading` | loading… | загрузка… | yüklənir… |
| `auditTicker.noEvents` | no events yet | событий пока нет | hələ hadisə yoxdur |
| `auditTicker.title` | Click for full audit log | Кликните для полного журнала аудита | Tam audit jurnalı üçün klik |

### `benchmark` (12)

| Key | EN | RU | AZ |
|---|---|---|---|
| `benchmark.close` | Close | Закрыть | Bağla |
| `benchmark.cohort` | among {sector} sector companies | среди компаний сектора {sector} | {sector} sektoru şirkətləri arasında |
| `benchmark.insufficientPeers` | Only {count} other companies in your industry — need ≥ 3 for median + quartiles. | В вашей отрасли только {count} других компаний — нужно ≥ 3 для медианы и квартилей. | Sənayənizdə yalnız {count} digər şirkət — median + kvartillər üçün ≥ 3 lazımdır. |
| `benchmark.loading` | Computing median + quartiles… | Считаем медиану и квартили… | Median və kvartillər hesablanır… |
| `benchmark.median` | Industry median | Медиана отрасли | Sənaye medianı |
| `benchmark.medianLabel` | Median | Медиана | Median |
| `benchmark.rank` | Your rank | Ваш ранг | Sıralamanız |
| `benchmark.rankOf` | of | из | / |
| `benchmark.title` | Industry peer benchmark | Сравнение с конкурентами по отрасли | Sənaye üzrə müqayisə |
| `benchmark.topQuartile` | Top quartile | Топ-25% отрасли | Top kvartil |
| `benchmark.topQuartileLabel` | Top 25% | Топ-25% | Top 25% |
| `benchmark.you` | You | Вы | Siz |

### `boardDeck` (40)

| Key | EN | RU | AZ |
|---|---|---|---|
| `boardDeck.exports.errorFallback` | Export failed | Экспорт не удался | Eksport baş tutmadı |
| `boardDeck.exports.pdfAriaLabel` | Export board snapshot to PDF | Экспортировать board snapshot в PDF | Board snapshot-u PDF-ə eksport et |
| `boardDeck.exports.pdfLabel` | Export PDF | Экспорт PDF | PDF eksport |
| `boardDeck.exports.pdfRendering` | Rendering… | Рендер… | Render… |
| `boardDeck.exports.pptxAriaLabel` | Export board snapshot to PPTX | Экспортировать board snapshot в PPTX | Board snapshot-u PPTX-ə eksport et |
| `boardDeck.exports.pptxExporting` | Exporting… | Экспортирую… | Eksport olunur… |
| `boardDeck.exports.pptxLabel` | Export PPTX | Экспорт PPTX | PPTX eksport |
| `boardDeck.exports.printAriaLabel` | Print board snapshot to PDF | Распечатать board snapshot в PDF | Board snapshot-u PDF-ə çap et |
| `boardDeck.exports.printLabel` | Print to PDF | Печать в PDF | PDF-ə çap et |
| `boardDeck.footer.ariaLabel` | Page actions | Действия страницы | Səhifə əməliyyatları |
| `boardDeck.footer.eyebrow` | Share + drill-down | Поделиться + детализация | Paylaş + detallar |
| `boardDeck.footer.subtitle` | Export the deck, print it, or open the live Risk Terminal for operational drill-down. | Экспортируйте презентацию, распечатайте или откройте Risk Terminal для операционной детализации. | Təqdimatı ixrac edin, çap edin və ya əməliyyat detalları üçün Risk Terminal-ı açın. |
| `boardDeck.footer.terminalCta` | Open Risk Terminal | Открыть Risk Terminal | Risk Terminal aç |
| `boardDeck.hero.aiAttribution` | AI-generated · {model} · prompt {version} | AI-сгенерировано · {model} · промпт {version} | AI-yaradıb · {model} · prompt {version} |
| `boardDeck.hero.ariaLabel` | Board deck hero | Заглавный блок отчёта | Board deck baş bölmə |
| `boardDeck.hero.contributingCount` | {contributing} of {total} sub-cos scored | {contributing} из {total} суб-компаний | {contributing} / {total} sub-co |
| `boardDeck.hero.cta` | Read full report | Полный отчёт | Tam hesabatı oxu |
| `boardDeck.hero.eyebrowSuffix` | Review | обзор | icmalı |
| `boardDeck.hero.fallbackHeadline` | {org} · {period} period review | {org} · обзор за {period} | {org} · {period} icmalı |
| `boardDeck.hero.scoreLabel` | Holding composite score / 100 | Сводный балл холдинга / 100 | Holding mürəkkəb balı / 100 |
| `boardDeck.metrics.indicatorCoverageContext` | across {sectors} sectors | в {sectors} секторах | {sectors} sektorda |
| `boardDeck.metrics.indicatorCoverageLabel` | Indicators tracked | Индикаторы под наблюдением | İzlənən göstəricilər |
| `boardDeck.metrics.redCellsContext` | of {total} total cells | из {total} всего | {total} ümumi xanadan |
| `boardDeck.metrics.redCellsLabel` | Red cells | Красные ячейки | Qırmızı xanalar |
| `boardDeck.metrics.redSubCosContext` | of {total} operational | из {total} операционных | {total} əməliyyatdan |
| `boardDeck.metrics.redSubCosLabel` | Sub-cos in red band | Суб-компании в красной зоне | Qırmızı zonada sub-co |
| `boardDeck.metrics.sectionAriaLabel` | Supporting metrics | Дополнительные метрики | Əlavə göstəricilər |
| `boardDeck.metrics.trendAriaLabel` | 12-month composite trend | 12-месячный тренд сводного балла | 12 aylıq mürəkkəb bal trendi |
| `boardDeck.metrics.trendEmpty` | No monthly data yet for this org. The trend chart populates once 2+ monthly snapshots are recomputed. | Нет месячных данных для этого холдинга. График заполнится после 2+ месячных пересчётов. | Hələ aylıq məlumat yoxdur. Qrafik 2+ aylıq snapshot hesablandıqdan sonra dolacaq. |
| `boardDeck.metrics.trendTitle` | Composite trend (12 months) | Тренд сводного балла (12 месяцев) | Mürəkkəb bal trendi (12 ay) |
| `boardDeck.narrative.ariaLabel` | Executive narrative | Аналитический обзор | İcraçı icmal |
| `boardDeck.narrative.attribution` | Generated by {model} · prompt {version} · snapshot {generatedAt} | Сгенерировано {model} · промпт {version} · снимок {generatedAt} | {model} · prompt {version} · snapshot {generatedAt} |
| `boardDeck.narrative.eyebrow` | Executive narrative | Аналитический обзор | İcraçı icmal |
| `boardDeck.narrative.languagePickerAriaLabel` | Narrative language | Язык повествования | Hekayə dili |
| `boardDeck.topAlerts.affectedCount` | {count, plural, one {# affected sub-co} other {# affected sub-cos}} | {count, plural, one {# затронутая суб-компания} few {# затронутые суб-компании} other {# затронутых суб-компаний}} | {count, plural, one {# təsirə uğrayan sub-co} other {# təsirə uğrayan sub-co}} |
| `boardDeck.topAlerts.allClear` | ✓ No alerts triggered — all systems green. | ✓ Алертов нет — все системы зелёные. | ✓ Xəbərdarlıq yoxdur — bütün sistemlər yaşıl. |
| `boardDeck.topAlerts.ariaLabel` | Top alerts | Главные алерты | Əsas xəbərdarlıqlar |
| `boardDeck.topAlerts.eyebrow` | Top alerts for the board | Главные алерты для совета | Şura üçün əsas xəbərdarlıqlar |
| `boardDeck.topAlerts.showingOf` | Showing {showing} of {total} | Показано {showing} из {total} | {showing} / {total} göstərilir |
| `boardDeck.topAlerts.viewAll` | View all alerts in Risk Terminal | Все алерты в Risk Terminal | Risk Terminal-da bütün xəbərdarlıqlar |

### `breach` (24)

| Key | EN | RU | AZ |
|---|---|---|---|
| `breach.bandHigh` | high only | только высокая | yalnız yüksək |
| `breach.bandLow` | low+ | от низкой | aşağıdan |
| `breach.bandMedium` | medium+ | от средней | ortadan |
| `breach.closeAriaLabel` | Close breach panel | Закрыть панель прогноза | Proqnoz panelini bağla |
| `breach.companyFew` | companies | компании | şirkət |
| `breach.companyMany` | companies | компаний | şirkət |
| `breach.companyOne` | company | компания | şirkət |
| `breach.dialogAriaLabel` | Predictive Breach Forecasts | Прогноз нарушений индикаторов | İndikator pozuntuları proqnozu |
| `breach.emptyPrefix` | No breach forecasts at the current filter. Try lowering Min confidence to | Нет прогнозов нарушений по текущему фильтру. Снизьте «Мин. уверенность» до | Cari filtrlə pozuntu proqnozu yoxdur. «Min. inam» səviyyəsini |
| `breach.emptySuffix` | . | . | səviyyəsinə endirin. |
| `breach.footerNote` | Forecasts use linear regression on indicator sparklines (≥3 non-null points). Worsening transitions only (green→amber/red, amber→red). Confidence degrades by horizon step. | Прогнозы используют линейную регрессию по спарклайнам индикаторов (≥3 ненулевых точки). Только переходы к ухудшению (зелёный→жёлтый/красный, жёлтый→красный). Уверенность снижается с ростом шага горизонта. | Proqnozlar indikator sparkline-ları üzrə xətti reqressiyadan istifadə edir (≥3 boş olmayan nöqtə). Yalnız pisləşmə keçidləri (yaşıl→sarı/qırmızı, sarı→qırmızı). İnam səviyyəsi üfüq addımı ilə azalır. |
| `breach.forecastFew` | forecasts | прогноза | proqnoz |
| `breach.forecastMany` | forecasts | прогнозов | proqnoz |
| `breach.forecastOne` | forecast | прогноз | proqnoz |
| `breach.loading` | Loading… | Загрузка… | Yüklənir… |
| `breach.loadingForecasts` | Loading breach forecasts… | Загрузка прогнозов… | Pozuntu proqnozları yüklənir… |
| `breach.minConfidenceLabel` | Min confidence | Мин. уверенность | Min. inam |
| `breach.periodLabel` | Period | Период | Dövr |
| `breach.periodPlaceholder` | e.g. 2026 or 2026-Q1 | напр. 2026 или 2026-Q1 | məs. 2026 və ya 2026-Q1 |
| `breach.refresh` | Refresh | Обновить | Yenilə |
| `breach.stepLabel` | step | шаг | addım |
| `breach.subtitle` | Predictive trend-based breach detection (linear regression on indicator sparklines) | Предиктивное обнаружение нарушений по тренду (линейная регрессия по спарклайнам индикаторов) | Trendə əsaslanan prediktiv pozuntu aşkarlanması (indikator sparkline-ları üzrə xətti reqressiya) |
| `breach.summaryAcross` | across | по | — |
| `breach.title` | Breach Forecasts | Прогноз нарушений | Pozuntu proqnozları |

### `buttons` (8)

| Key | EN | RU | AZ |
|---|---|---|---|
| `buttons.apply` | Apply | Применить | Tətbiq et |
| `buttons.cancel` | Cancel | Отмена | Ləğv et |
| `buttons.close` | Close | Закрыть | Bağla |
| `buttons.compare` | Compare | Сравнить | Müqayisə et |
| `buttons.drill` | Drill down | Детально | Detalı bax |
| `buttons.explain` | Explain | Объяснить | İzah et |
| `buttons.reset` | Reset to defaults | Сбросить | Standartlara qaytar |
| `buttons.save` | Save | Сохранить | Yadda saxla |

### `commandBar` (12)

| Key | EN | RU | AZ |
|---|---|---|---|
| `commandBar.aiUsageAriaLabel` | Open AI Usage Dashboard | Открыть AI Usage Dashboard | AI İstifadə Dashboard-ı aç |
| `commandBar.aiUsageCalls` | calls | вызовов | çağırış |
| `commandBar.aiUsageClickHint` | Click to open holding-wide AI Usage → | Открыть статистику по всему холдингу → | Bütün holdinq üzrə statistikanı aç → |
| `commandBar.aiUsageMtd` | Month-to-date | С начала месяца | Ayın əvvəlindən |
| `commandBar.aiUsageTitle` | Your AI usage | Ваш расход AI | Sizin AI istifadəniz |
| `commandBar.aiUsageToday` | Today | Сегодня | Bu gün |
| `commandBar.alertsAriaLabel` | Open alerts panel | Открыть панель алертов | Xəbərdarlıq panelini aç |
| `commandBar.alertsLoading` | Alerts: loading… | Алерты: загрузка… | Xəbərdarlıqlar: yüklənir… |
| `commandBar.alertsTitle` | {count} red+amber indicators across the org — click to open alerts panel | {count} red+amber индикаторов в холдинге — кликните чтобы открыть панель алертов | Holdinqdə {count} red+amber göstərici — xəbərdarlıq panelini açmaq üçün klik |
| `commandBar.feedsFreshOk` | ✓ All reference feeds fresh, no recent drift events | ✓ Все reference-фиды свежие, нет недавних drift events | ✓ Bütün istinad feed-ləri təzədir, son drift hadisəsi yoxdur |
| `commandBar.healthAriaLabel` | Open Drift Dashboard | Открыть Drift Dashboard | Drift Dashboard-ı aç |
| `commandBar.placeholder` | HOLD GO · AAC CO GO · IND_OPEX_RATIO IND GO (Cmd+K) | HOLD GO · AAC CO GO · IND_OPEX_RATIO IND GO (Cmd+K) | HOLD GO · AAC CO GO · IND_OPEX_RATIO IND GO (Cmd+K) |

### `comments` (12)

| Key | EN | RU | AZ |
|---|---|---|---|
| `comments.closeAriaLabel` | Close comments | Закрыть комментарии | Şərhləri bağla |
| `comments.dialogAriaLabel` | Comments overlay | Слой комментариев | Şərh qatı |
| `comments.draftAriaLabel` | Comment draft | Черновик комментария | Şərh qaralaması |
| `comments.draftPlaceholder` | Type a comment, @mention with @name… | Введите комментарий, @mention через @name… | Şərh yazın, @ad ilə @mention edin… |
| `comments.empty` | No comments yet — start the discussion below. | Комментариев пока нет — начните обсуждение ниже. | Hələ şərh yoxdur — aşağıda müzakirə başlayın. |
| `comments.localOnlyBanner` | v1: comments are stored locally in your browser (localStorage). Teammates won't see them and no notifications fire. Real sync arrives in v2 (backend + WebSocket). | v1: комментарии хранятся локально в вашем браузере (localStorage). Коллеги их не увидят и уведомлений не получат. Реальная синхронизация — в v2 (нужен backend + WebSocket). | v1: şərhlər brauzerinizdə lokal saxlanılır (localStorage). Komanda yoldaşları görməz və bildiriş gəlməz. Real sinxronizasiya v2-də (backend + WebSocket). |
| `comments.noActiveCell` | No active cell — click a HeatMap cell (Panel 2) and then open this panel to attach a comment thread. | Нет активной ячейки — кликните ячейку HeatMap (Панель 2) и затем откройте эту панель, чтобы прикрепить тред. | Aktiv xana yoxdur — HeatMap xanasına klikləyin (Panel 2) və sonra bu paneli açın. |
| `comments.send` | Send | Отправить | Göndər |
| `comments.sendAriaLabel` | Post comment | Опубликовать комментарий | Şərhi yerləşdir |
| `comments.subtitle` | Per-cell @mention threads. Tag a teammate (@cfo, @aac-finance) to discuss a specific data point. Press Esc to close. | Тред @mention на каждую ячейку. Тегните коллегу (@cfo, @aac-finance) чтобы обсудить конкретную точку данных. Esc для закрытия. | Hər xana üçün @mention tred. Konkret məlumat nöqtəsini müzakirə etmək üçün komanda yoldaşını tag edin (@cfo, @aac-finance). Bağlamaq üçün Esc. |
| `comments.threadFor` | Thread for {key} | Тред для {key} | {key} üçün tred |
| `comments.title` | Comments ({count} threads) | Комментарии ({count} тредов) | Şərhlər ({count} tred) |

### `companyTree` (23)

| Key | EN | RU | AZ |
|---|---|---|---|
| `companyTree.alertedAriaLabel` | Alerted companies | Компании с алертами | Xəbərdarlıq olan şirkətlər |
| `companyTree.allRowAriaLabel` | Show all companies on the HeatMap | Показать все компании на HeatMap | HeatMap-da bütün şirkətləri göstər |
| `companyTree.allRowDescription` | Show every company on the HeatMap | Показать все компании на HeatMap | HeatMap-da bütün şirkətləri göstər |
| `companyTree.allRowLabel` | ALL | ВСЕ | HAMI |
| `companyTree.filterAriaLabel` | Filter company tree | Фильтр дерева компаний | Şirkət ağacı filtri |
| `companyTree.filterPlaceholder` | filter companies… | фильтр компаний… | şirkət filtri… |
| `companyTree.loading` | Loading… | Загрузка… | Yüklənir… |
| `companyTree.loadingAlerts` | Loading alerts… | Загрузка алертов… | Xəbərdarlıqlar yüklənir… |
| `companyTree.noCompanies` | No companies. Import via /budgeting/onboarding. | Компаний нет. Импортируйте через /budgeting/onboarding. | Şirkət yoxdur. /budgeting/onboarding ilə idxal et. |
| `companyTree.noMatchPrefix` | No match for | Нет совпадений для | Uyğunluq yoxdur: |
| `companyTree.pendingHidden` | +pending | +pending | +pending |
| `companyTree.pendingPill` | pending | pending | pending |
| `companyTree.pendingPillAriaLabel` | Onboarding pending | В процессе онбординга | Onboardinq prosesindədir |
| `companyTree.pendingShown` | −pending | −pending | −pending |
| `companyTree.sectorTreeAriaLabel` | Companies grouped by sector | Компании, сгруппированные по сектору | Sektor üzrə qruplaşdırılmış şirkətlər |
| `companyTree.showPendingAriaLabel` | Toggle visibility of onboarding-pending companies | Переключить видимость компаний в процессе онбординга | Onboardinq prosesindəki şirkətlərin görünürlüyünü dəyişdir |
| `companyTree.showPendingTitle` | Show / hide onboarding-pending companies (admin) | Показать / скрыть компании в процессе онбординга (admin) | Onboardinq prosesindəki şirkətləri göstər / gizlət (admin) |
| `companyTree.starredAriaLabel` | Starred companies | Избранные компании | Seçilmiş şirkətlər |
| `companyTree.tabAll` | ALL | ВСЕ | HAMISI |
| `companyTree.tabRecent` | RECENT | НЕДАВНИЕ | SON |
| `companyTree.tabSector` | SECTOR | СЕКТОР | SEKTOR |
| `companyTree.tabsAriaLabel` | Company watchlist filter | Фильтр списка наблюдения компаний | Şirkət izləmə filtri |
| `companyTree.treeAriaLabel` | Companies | Компании | Şirkətlər |

### `compare` (9)

| Key | EN | RU | AZ |
|---|---|---|---|
| `compare.close` | Close | Закрыть | Bağla |
| `compare.closeAriaLabel` | Close compare panel | Закрыть панель сравнения | Müqayisə panelini bağla |
| `compare.dialogAriaLabel` | Compare {lhs} vs {rhs} | Сравнение {lhs} и {rhs} | {lhs} ilə {rhs} müqayisəsi |
| `compare.error` | Error | Ошибка | Xəta |
| `compare.headerTitle` | Compare: | Сравнение: | Müqayisə: |
| `compare.headerVs` | vs | vs | vs |
| `compare.indicatorColumn` | Indicator | Индикатор | Göstərici |
| `compare.loadingMatrix` | Loading matrix… | Загрузка матрицы… | Matris yüklənir… |
| `compare.subtitle` | Side-by-side indicators · Δ = RHS − LHS · Esc to close | Side-by-side индикаторы · Δ = правая − левая · Esc для закрытия | Yan-yana göstəricilər · Δ = sağ − sol · Esc bağlamaq |

### `concentration` (27)

| Key | EN | RU | AZ |
|---|---|---|---|
| `concentration.colContract` | Contract | Контракт | Müqavilə |
| `concentration.colCustomer` | Customer | Клиент | Müştəri |
| `concentration.colNetDays` | Net days | Отсрочка, дн. | Ödəniş günləri |
| `concentration.colNotes` | Notes | Примечания | Qeydlər |
| `concentration.colSource` | Source | Источник | Mənbə |
| `concentration.colSupplier` | Supplier | Поставщик | Təchizatçı |
| `concentration.contractOpen` | open | бессрочный | müddətsiz |
| `concentration.customerHhi` | Customer HHI | HHI по клиентам | Müştəri HHI |
| `concentration.customerHhiCompetitive` | competitive | конкурентная | rəqabətli |
| `concentration.customerHhiHigh` | high — single-buyer risk | высокая — риск единственного покупателя | yüksək — tək alıcı riski |
| `concentration.customerHhiModerate` | moderate | умеренная | orta |
| `concentration.failedToLoad` | Failed to load: {error} | Ошибка загрузки: {error} | Yüklənmə xətası: {error} |
| `concentration.heading` | Concentration — {code} | Концентрация — {code} | Cəmlənmə — {code} |
| `concentration.loading` | Loading… | Загрузка… | Yüklənir… |
| `concentration.noCustomers` | No customers registered | Клиенты не зарегистрированы | Qeydiyyatda müştəri yoxdur |
| `concentration.noSuppliers` | No suppliers registered | Поставщики не зарегистрированы | Qeydiyyatda təchizatçı yoxdur |
| `concentration.pickCompanyPrompt` | Pick a company in the tree to load its counterparty register. | Выберите компанию в дереве, чтобы загрузить реестр её контрагентов. | Qarşı tərəflərin reyestrini yükləmək üçün ağacdan şirkət seçin. |
| `concentration.singleSourceCount` | {count} single-source | {count} с единственным источником | {count} tək mənbəli |
| `concentration.sourceMulti` | multi | несколько | çoxlu |
| `concentration.sourceSingle` | single | единственный | tək |
| `concentration.summaryLine` | Period {period} · {customers} customers · {suppliers} suppliers | Период {period} · клиентов: {customers} · поставщиков: {suppliers} | Dövr {period} · müştəri: {customers} · təchizatçı: {suppliers} |
| `concentration.supplierHhi` | Supplier HHI | HHI по поставщикам | Təchizatçı HHI |
| `concentration.supplierHhiDiversified` | diversified | диверсифицированная | diversifikasiya olunmuş |
| `concentration.supplierHhiHigh` | high — supply-chain fragile | высокая — уязвимая цепочка поставок | yüksək — kövrək təchizat zənciri |
| `concentration.supplierHhiModerate` | moderate | умеренная | orta |
| `concentration.topCustomers` | Top customers | Крупнейшие клиенты | Ən böyük müştərilər |
| `concentration.topSuppliers` | Top suppliers | Крупнейшие поставщики | Ən böyük təchizatçılar |

### `fxExposure` (17)

| Key | EN | RU | AZ |
|---|---|---|---|
| `fxExposure.allCompanies` | All companies | Все компании | Bütün şirkətlər |
| `fxExposure.balanced` | balanced | сбалансировано | balanslı |
| `fxExposure.baseCurrency` | base currency | базовая валюта | baza valyuta |
| `fxExposure.colCogs` | COGS | Себестоимость | MMD |
| `fxExposure.colCurrency` | Currency | Валюта | Valyuta |
| `fxExposure.colExpense` | Expense | Расходы | Xərc |
| `fxExposure.colNet` | Net | Чистая | Xalis |
| `fxExposure.colRevenue` | Revenue | Выручка | Gəlir |
| `fxExposure.hedgeFootnote` | Pair with the CBAR forward curve panel to size 3/6/12-month hedges against the open exposure. | Сопоставьте с панелью форвардной кривой ЦБАР для расчёта 3/6/12-мес хеджей под открытую экспозицию. | Açıq ekspozisiya üçün 3/6/12 aylıq hedcləri ölçmək üçün CBAR forvard əyrisi paneli ilə birləşdirin. |
| `fxExposure.loadFailed` | Failed to load: {error} | Ошибка загрузки: {error} | Yüklənmə xətası: {error} |
| `fxExposure.loading` | Loading… | Загрузка… | Yüklənir… |
| `fxExposure.longHint` | {cur}-long → hedge sells {cur} | {cur}-длинная → хедж продаёт {cur} | {cur}-uzun → hedc {cur} satır |
| `fxExposure.netExposureHeader` | Net exposure by currency | Чистая экспозиция по валютам | Valyuta üzrə xalis ekspozisiya |
| `fxExposure.pnlHeader` | Per-currency P&L breakdown | P&L по валютам | Valyuta üzrə P&L bölgüsü |
| `fxExposure.shortHint` | {cur}-short → hedge buys {cur} | {cur}-короткая → хедж покупает {cur} | {cur}-qısa → hedc {cur} alır |
| `fxExposure.subtitle` | Year {year} · base {base} · {count} budget lines aggregated | Год {year} · база {base} · агрегировано строк бюджета: {count} | İl {year} · baza {base} · {count} büdcə sətri toplandı |
| `fxExposure.title` | FX Exposure — {scope} | Валютная экспозиция — {scope} | Valyuta ekspozisiyası — {scope} |

### `heatMap` (30)

| Key | EN | RU | AZ |
|---|---|---|---|
| `heatMap.aiSummaryGenerating` | 💬 Generating AI summary… | 💬 Генерирую AI-сводку… | 💬 AI xülasəsi yaradılır… |
| `heatMap.cellClickHint` | Click → drill-down (Panel 3) | Клик → drill-down (Панель 3) | Klik → ətraflı (Panel 3) |
| `heatMap.companyColumn` | Company | Компания | Şirkət |
| `heatMap.compositeScoreTitle` | Composite {score}/100 · {contributing}/{total} indicators | Композитный {score}/100 · {contributing}/{total} индикаторов | Kompozit {score}/100 · {contributing}/{total} göstərici |
| `heatMap.errEval` | Formula eval error — one of the inputs is missing. | Ошибка вычисления формулы — отсутствует одна из переменных. | Formula hesablama xətası — daxil olan dəyişənlərdən biri əksikdir. |
| `heatMap.errMissingBaseline` | Missing {year} baseline data — import {year} Actuals via Onboarding and run Recompute. | Нет данных за {year} год — загрузите Actuals {year} через Onboarding и запустите Перерасчёт. | {year} ili üçün baseline məlumat yoxdur — Onboarding-dan {year} Actuals yükləyin və Yenidən hesabla işə salın. |
| `heatMap.errNonFinite` | Couldn't compute (division by zero or NaN). Check input data completeness. | Не удалось посчитать (деление на 0 или NaN). Проверьте полноту входных данных. | Hesablamaq mümkün olmadı (sıfıra bölmə və ya NaN). Daxil olan məlumatları yoxlayın. |
| `heatMap.errParse` | Indicator formula has a syntax error — contact admin. | Ошибка в формуле индикатора — обратитесь к админу. | Göstərici formulasında sintaksis xətası — admin ilə əlaqə saxlayın. |
| `heatMap.errorPrefix` | Error: | Ошибка: | Xəta: |
| `heatMap.filterAriaLabel` | Filter heatmap rows | Фильтр строк карты рисков | Risk xəritəsi sətr filtri |
| `heatMap.filterRowsPlaceholder` | filter rows… | фильтр строк… | sətr filtri… |
| `heatMap.loading` | Loading… | Загрузка… | Yüklənir… |
| `heatMap.loadingHeatmap` | Loading heatmap… | Загрузка карты рисков… | Risk xəritəsi yüklənir… |
| `heatMap.noCompaniesMatch` | No companies match | Нет совпадений для | Uyğunluq yoxdur: |
| `heatMap.noCompaniesYet` | No companies or indicators yet. Import via /budgeting/onboarding and seed indicators (scripts/seed-indicators.ts). | Компаний или индикаторов ещё нет. Импортируйте через /budgeting/onboarding и запустите seed индикаторов (scripts/seed-indicators.ts). | Şirkət və ya göstərici hələ yoxdur. /budgeting/onboarding ilə idxal et və göstərici seed-i işə sal (scripts/seed-indicators.ts). |
| `heatMap.noScoreableIndicators` | No scoreable indicators | Нет индикаторов для оценки | Qiymətləndiriləcək göstərici yoxdur |
| `heatMap.notApplicable` | N/A — indicator does not apply to industry «{industry}» | Н/Д — индикатор не применим к индустрии «{industry}» | Tətbiq olunmur — indikator «{industry}» sənayesinə aid deyil |
| `heatMap.revertToBase` | Return to baseline data | Вернуться к базовым данным | Baza məlumatlarına qayıt |
| `heatMap.scenarioBanner` | ⚡ SCENARIO: {label} | ⚡ СЦЕНАРИЙ: {label} | ⚡ SSENARİ: {label} |
| `heatMap.sparklineTrendAriaLabel` | {indCode} 12-month trend for {coCode} | {indCode} тренд за 12 месяцев для {coCode} | {indCode} {coCode} üçün 12 aylıq trend |
| `heatMap.sparklineTrendAriaLabelSelf` | {indCode} 12-month trend | {indCode} тренд за 12 месяцев | {indCode} 12 aylıq trend |
| `heatMap.tableAriaLabel` | Risk heatmap | Карта рисков | Risk xəritəsi |
| `heatMap.tooltipCompositeScore` | Composite score: | Композитный балл: | Kompozit bal: |
| `heatMap.tooltipDirBand` | in band | в диапазоне | diapazonda |
| `heatMap.tooltipDirHigher` | higher = better | выше = лучше | yüksək = yaxşı |
| `heatMap.tooltipDirLower` | lower = better | ниже = лучше | aşağı = yaxşı |
| `heatMap.tooltipIndicators` | indicators | индикаторов | göstərici |
| `heatMap.tooltipNoData` | — no data | — нет данных | — məlumat yoxdur |
| `heatMap.tooltipSparkline12mo` | 12mo | 12 мес | 12 ay |
| `heatMap.tooltipUnit` | unit: | ед. изм: | vahid: |

### `help` (48)

| Key | EN | RU | AZ |
|---|---|---|---|
| `help.close` | Close | Закрыть | Bağla |
| `help.cmdActDesc` | Show open actions assigned to you. | Открытые действия, назначенные вам. | Sizə təyin edilmiş açıq tapşırıqlar. |
| `help.cmdAltDesc` | Show the active alert list. | Показать активные алёрты. | Aktiv alertləri göstər. |
| `help.cmdAudDesc` | Show audit trail of recent mutations. | Журнал недавних изменений. | Son dəyişikliklərin audit izi. |
| `help.cmdBreachDesc` | Show predicted threshold breaches (forecast). | Прогнозируемые превышения порогов. | Proqnozlaşdırılan hədd aşımları. |
| `help.cmdBrfDesc` | Open the Board Deck — narrative snapshot for executive review. | Открыть Board Deck — нарратив для совета директоров. | Board Deck aç — icraçı baxış üçün narrativ. |
| `help.cmdChtDesc` | Open a multi-period chart of the active indicator. | Многопериодный график активного индикатора. | Aktiv indikatorun çoxdövrlü qrafiki. |
| `help.cmdCmpDesc` | Compare two companies side-by-side. | Сравнение двух компаний. | İki şirkəti yan-yana müqayisə et. |
| `help.cmdCmtDesc` | Open cell comments for the selected indicator. | Комментарии к ячейкам по активному индикатору. | Aktiv indikatorun hüceyrə şərhləri. |
| `help.cmdCoDesc` | Open a specific company. Prefix with company code, e.g. `AAC CO GO`. | Открыть компанию. Введите код, напр. `AAC CO GO`. | Şirkət aç. Kodu yazın, məs. `AAC CO GO`. |
| `help.cmdGrpDesc` | Switch focus to a sub-group (level 1 entity). | Переключиться на под-группу (уровень 1). | Alt-qrupa keç (səviyyə 1). |
| `help.cmdHelpDesc` | Open this command reference. | Открыть этот справочник. | Bu arayışı aç. |
| `help.cmdHoldDesc` | Switch focus to holding-level rollup. | Переключиться на сводку холдинга. | Holdinq səviyyəsi rolluquna keç. |
| `help.cmdIndDesc` | Open an indicator's drill-down. Prefix with code, e.g. `IND_GM IND GO`. | Детализация индикатора. Префикс — код, напр. `IND_GM IND GO`. | İndikator detalları. Prefiks — kod, məs. `IND_GM IND GO`. |
| `help.cmdIntDesc` | Open the Intel feed (market + macro context). | Лента Intel (рынок + макро). | Intel lenti (bazar + makro). |
| `help.cmdScnDesc` | Activate a scenario overlay (preset stress test). | Активировать сценарий (стресс-тест). | Ssenari overlay-ı aktivləşdir (stress-test). |
| `help.cmdSecDesc` | Switch focus to a sector (industry). | Переключиться на сектор (отрасль). | Sektora keç (sənaye). |
| `help.cmdSubDesc` | Subscribe to alerts for the active entity. | Подписаться на алёрты по активной сущности. | Aktiv obyekt üzrə alertlərə abunə ol. |
| `help.examplePrefix` | Example: | Пример: | Misal: |
| `help.legendCellAmber` | Warning zone | Зона предупреждения | Xəbərdarlıq zonası |
| `help.legendCellGreen` | Within healthy threshold | В пределах здорового порога | Sağlam həddə daxil |
| `help.legendCellRed` | Critical — exceeds threshold | Критично — превышен порог | Kritik — hədd aşıldı |
| `help.legendCellTitle` | HeatMap cell colors | Цвета ячеек HeatMap | HeatMap hüceyrə rəngləri |
| `help.legendCellUnknown` | No data / formula failed | Нет данных / формула не сработала | Məlumat yox / düstur işləmədi |
| `help.legendCompositeAmber` | Watch | Внимание | Diqqət |
| `help.legendCompositeGreen` | Healthy | Здорово | Sağlam |
| `help.legendCompositeRed` | Critical | Критично | Kritik |
| `help.legendCompositeTitle` | Composite Risk Score (CompanyTree badges) | Composite Risk Score (бэйджи в Дереве компаний) | Composite Risk Score (Şirkət ağacı bedjləri) |
| `help.legendDirBand` | Target band (good = within range) | Целевой коридор (хорошо = в диапазоне) | Hədəf zolaq (yaxşı = diapazonda) |
| `help.legendDirHigher` | Higher = better (e.g. gross margin) | Выше = лучше (напр. валовая маржа) | Yuxarı = daha yaxşı (məs. ümumi marja) |
| `help.legendDirLower` | Lower = better (e.g. opex ratio) | Ниже = лучше (напр. opex ratio) | Aşağı = daha yaxşı (məs. opex ratio) |
| `help.legendDirectionTitle` | Indicator direction (column header marker) | Направление индикатора (маркер в заголовке колонки) | İndikator istiqaməti (sütun başlığı markeri) |
| `help.legendUnitAzn` | Azerbaijani Manat | Азербайджанский манат | Azərbaycan manatı |
| `help.legendUnitIndex` | Index (e.g. HHI 0–10000; >2500 = concentrated) | Индекс (напр. HHI 0–10000; >2500 = концентрация) | İndeks (məs. HHI 0–10000; >2500 = konsentrasiya) |
| `help.legendUnitPercent` | Percentage (e.g. margins, ratios) | Процент (маржа, доли) | Faiz (marja, paylar) |
| `help.legendUnitPp` | Percentage points (delta vs baseline) | Процентные пункты (дельта vs базис) | Faiz vahidləri (delta vs baza) |
| `help.legendUnitRatio` | Ratio (e.g. operating leverage) | Отношение (напр. operating leverage) | Nisbət (məs. operating leverage) |
| `help.legendUnitTonHa` | Tons per hectare (agro yield) | Тонн с гектара (агро-урожайность) | Hektara ton (kənd təsərrüfatı məhsuldarlığı) |
| `help.legendUnitsTitle` | Common units | Распространённые единицы | Ümumi vahidlər |
| `help.recentEmpty` | No commands run yet — try `HOLD GO` to see the holding overview. | Команды ещё не запускались — попробуйте `HOLD GO` для обзора холдинга. | Hələ komanda işlədilməyib — `HOLD GO` ilə holdinq icmalını yoxlayın. |
| `help.recentTitle` | Recent commands | Недавние команды | Son komandalar |
| `help.sectionAlerts` | Alerts & Briefs | Алёрты и брифы | Alertlər və briflər |
| `help.sectionAnalysis` | Analysis | Анализ | Analiz |
| `help.sectionLegend` | Legend — how to read the screen | Легенда — как читать экран | Leqenda — ekranı necə oxumalı |
| `help.sectionNavigation` | Navigation | Навигация | Naviqasiya |
| `help.sectionOther` | Other | Прочее | Digər |
| `help.subtitle` | Press the command, then GO (or Enter). | Введите команду и нажмите GO (или Enter). | Komandanı yazın və GO (və ya Enter) basın. |
| `help.title` | Command Reference | Справочник команд | Komanda arayışı |

### `hints` (4)

| Key | EN | RU | AZ |
|---|---|---|---|
| `hints.detail` | Press F3 to focus this panel · Click EXPLAIN for AI narrative | Нажмите F3 для фокуса · Кликните EXPLAIN для AI-объяснения | F3 ilə fokuslayın · AI izahı üçün EXPLAIN klikləyin |
| `hints.heatMap` | Click any cell for indicator detail · Press / to search | Кликните на ячейку для деталей · Нажмите / для поиска | Detallar üçün xanaya klikləyin · Axtarış üçün / basın |
| `hints.snapshot` | Hover sparklines for monthly values · Click cards to compare | Наведите на спарклайн для месячных значений · Клик для сравнения | Aylıq dəyərlər üçün spark üzərinə gətirin · Klik müqayisə üçün |
| `hints.tree` | Click any company to focus drill-down panels | Кликните на компанию чтобы сфокусировать другие панели | Digər panelləri fokuslamaq üçün şirkətə klikləyin |

### `hotkeys` (56)

| Key | EN | RU | AZ |
|---|---|---|---|
| `hotkeys.actions` | ACTIONS | ДЕЙСТВИЯ | FƏALİYYƏT |
| `hotkeys.actionsTitle` | Open Action Center — AI recommendations (ACT GO equivalent) | Открыть Центр действий — рекомендации AI (эквивалент ACT GO) | Fəaliyyət Mərkəzini aç — AI tövsiyələri (ACT GO ekvivalenti) |
| `hotkeys.alerts` | ALERTS | АЛЕРТЫ | XƏBƏRDARLIQLAR |
| `hotkeys.alertsTitle` | Open Audit Log overlay (AUD GO equivalent) | Открыть журнал аудита (эквивалент AUD GO) | Audit jurnalı modal pəncərəsi (AUD GO ekvivalenti) |
| `hotkeys.breach` | BREACH | ПРОГНОЗ | PROQNOZ |
| `hotkeys.breachTitle` | Open Breach Forecasts overlay (BREACH GO equivalent) | Открыть прогноз нарушений (эквивалент BREACH GO) | Pozuntu proqnozları panelini aç (BREACH GO ekvivalenti) |
| `hotkeys.chat` | CHAT | ЧАТ | ÇAT |
| `hotkeys.chatTitle` | Open SubCo Finance Chat (CHT GO equivalent) | Открыть чат с финансами sub-co (эквивалент CHT GO) | Sub-co maliyyə çatını aç (CHT GO ekvivalenti) |
| `hotkeys.comments` | COMMENTS | КОММЕНТАРИИ | ŞƏRHLƏR |
| `hotkeys.commentsTitle` | Open Comments overlay on matrix cells (CMT GO equivalent) | Открыть слой комментариев к ячейкам (эквивалент CMT GO) | Matris xanalarına şərhləri aç (CMT GO ekvivalenti) |
| `hotkeys.compact` | COMPACT | КОМПАКТ | KOMPAKT |
| `hotkeys.compactAriaLabel` | Toggle compact mode | Переключить компактный режим | Kompakt rejimi açıb-bağla |
| `hotkeys.compactTitle` | Toggle compact mode (Ctrl+/) | Переключить компактный режим (Ctrl+/) | Kompakt rejimi açıb-bağla (Ctrl+/) |
| `hotkeys.compare` | COMPARE | СРАВНИТЬ | MÜQAYİSƏ |
| `hotkeys.compareTitle` | Focus command bar with 'CMP ' prefilled — type 2 codes + GO | Фокус командной строки с префиксом 'CMP ' — введите 2 кода + GO | Komanda sətrinə 'CMP ' prefiksi — 2 kod + GO yazın |
| `hotkeys.exportPdf` | PDF | PDF | PDF |
| `hotkeys.exportPdfTitle` | Export Risk Matrix as a multi-page PDF report | Экспортировать Risk Matrix как многостраничный PDF-отчёт | Risk Matrix-i çoxsəhifəli PDF hesabat olaraq ixrac et |
| `hotkeys.exportXlsx` | XLSX | XLSX | XLSX |
| `hotkeys.exportXlsxTitle` | Export Risk Matrix as an Excel workbook (Summary / Matrix / Today's Brief) | Экспортировать Risk Matrix как Excel-книгу (Summary / Матрица / Сводка дня) | Risk Matrix-i Excel kitabı kimi ixrac et (Summary / Matris / Gün xülasəsi) |
| `hotkeys.help` | Help | Справка | Kömək |
| `hotkeys.helpTitle` | Open command reference (HELP GO) | Открыть справочник команд (HELP GO) | Komanda arayışını aç (HELP GO) |
| `hotkeys.impact` | Impact | Импакт | İmpakt |
| `hotkeys.impactResult` | Impact {result} | Импакт {result} | İmpakt {result} |
| `hotkeys.impactRunning` | Impact… | Импакт… | İmpakt… |
| `hotkeys.impactTitle` | Run impact-forecast scan for all external feed crossings (FAO / Brent / AZN-USD / CPI). Generates forecasts on EN + RU + AZ in one click. | Запустить impact-forecast scan для всех external feed crossings (FAO / Brent / AZN-USD / CPI). Генерирует прогнозы на EN + RU + AZ за один клик. | Bütün xarici feed kəsişmələri (FAO / Brent / AZN-USD / CPI) üçün impact-forecast scan işə sal. Bir kliklə EN + RU + AZ üzrə proqnozlar yaradır. |
| `hotkeys.impactTitleRunning` | Running impact-forecast scan on EN + RU + AZ (~8-12 min) | Запускается impact-forecast scan на EN + RU + AZ (~8-12 мин) | EN + RU + AZ üzrə impact-forecast scan işə salınır (~8-12 dəq) |
| `hotkeys.import` | IMPORT | ИМПОРТ | İDXAL |
| `hotkeys.importTitle` | Upload a budget xlsx via Onboarding wizard | Загрузить xlsx бюджета через мастер онбординга | Onboard sehrbazı vasitəsilə xlsx büdcəsini yüklə |
| `hotkeys.intel` | INTEL | НОВОСТИ | XƏBƏRLƏR |
| `hotkeys.intelTitle` | Open full AI news feed (INT GO equivalent) | Открыть полную ленту AI-новостей (эквивалент INT GO) | AI xəbər lentini aç (INT GO ekvivalenti) |
| `hotkeys.label` | HOTKEYS | ХОТКЕИ | QISA YOLLAR |
| `hotkeys.newPlan` | NEW PLAN | НОВЫЙ ПЛАН | YENİ PLAN |
| `hotkeys.newPlanTitle` | Open Plans tab in /budgeting (create / approve plans) | Открыть вкладку Планов в /budgeting (создание / утверждение) | Planlar bölməsini aç (/budgeting — yaratma / təsdiq) |
| `hotkeys.paletteAriaLabel` | Open command palette | Открыть командную палитру | Komanda palitrasını aç |
| `hotkeys.paletteLabel` | {count}+ more | ещё {count}+ | +{count} daha |
| `hotkeys.paletteTitle` | Open the command bar (⌘K) — {count} more commands inside (CMP / SCN / WX / etc.) | Открыть командную строку (⌘K) — внутри ещё {count} команд (CMP / SCN / WX / etc.) | Komanda sətrini aç (⌘K) — daxildə {count} əlavə komanda (CMP / SCN / WX / etc.) |
| `hotkeys.peer` | PEER | ПИРЫ | PİRLƏR |
| `hotkeys.peerTitle` | Cross-company benchmarking — prefills PEER, type codes + GO | Бенчмаркинг между компаниями — подставит PEER, введите коды + GO | Şirkətlər arası benchmarking — PEER ilə doldurar, kodlar + GO |
| `hotkeys.recent` | RECENT | НЕДАВНИЕ | SON |
| `hotkeys.recentTitle` | Filter Company Tree to recently-viewed companies | Фильтр дерева компаний по недавно открытым | Şirkət ağacını yaxınlarda baxılanlara filtrlə |
| `hotkeys.recompute` | RECOMPUTE | ПЕРЕРАСЧЁТ | YENİDƏN HESABLAMA |
| `hotkeys.recomputeNoPeriod` | Loading matrix… recompute available once period is known | Загрузка матрицы… перерасчёт будет доступен после определения периода | Matris yüklənir… dövr müəyyən olunduqdan sonra yenidən hesablama mümkün olacaq |
| `hotkeys.recomputeRunning` | Recompute in progress… | Перерасчёт в процессе… | Yenidən hesablama prosesdədir… |
| `hotkeys.recomputeTitle` | Trigger indicator-matrix recompute (POST /api/indicators); SSE refreshes when done | Запустить перерасчёт матрицы индикаторов (POST /api/indicators); SSE обновит когда готово | Göstərici matrisini yenidən hesabla (POST /api/indicators); hazır olduqda SSE yeniləyir |
| `hotkeys.running` | RUNNING… | ВЫПОЛНЯЕТСЯ… | İCRA OLUNUR… |
| `hotkeys.scenario` | SCENARIO | СЦЕНАРИЙ | SSENARİ |
| `hotkeys.scenarioTitle` | Open Scenarios — prefills SCN, type code + GO | Открыть сценарии — подставит SCN, введите код + GO | Ssenariləri aç — SCN ilə doldurar, kod + GO yazın |
| `hotkeys.search` | SEARCH | ПОИСК | AXTAR |
| `hotkeys.searchTitle` | Focus the search input in the active panel (same as /) | Сфокусировать поиск в активной панели (то же что /) | Aktiv paneldə axtarışı fokuslayır (/ kimi) |
| `hotkeys.starred` | STARRED | ИЗБРАННОЕ | SEÇİLMİŞLƏR |
| `hotkeys.starredTitle` | Filter Company Tree to starred companies | Фильтр дерева компаний по избранным | Şirkət ağacını seçilmişlərə filtrlə |
| `hotkeys.subs` | SUBS | ПОДПИСКИ | ABUNƏLİK |
| `hotkeys.subsTitle` | Open AI Subscriptions — notification settings (SUB GO equivalent) | Открыть AI-подписки — настройки уведомлений (эквивалент SUB GO) | AI Abunəlikləri aç — bildiriş tənzimləmələri (SUB GO ekvivalenti) |
| `hotkeys.toolbarAriaLabel` | Terminal hotkeys | Горячие клавиши терминала | Terminal qısayolları |
| `hotkeys.whatif` | WHAT-IF | ЧТО-ЕСЛИ | NƏ-ƏGƏR |
| `hotkeys.whatifTitle` | Open ad-hoc preview: nudge FX rates and see indicators recompute live | Открыть ad-hoc превью: подвинуть курсы FX и увидеть пересчёт индикаторов | Ad-hoc önbax: FX kurslarını dəyiş və indikatorların yenidən hesablanmasını gör |

### `impactForecasts` (12)

| Key | EN | RU | AZ |
|---|---|---|---|
| `impactForecasts.confHigh` | high conf. | выс. увер. | yüksək etibar |
| `impactForecasts.confLow` | low conf. | низ. увер. | aşağı etibar |
| `impactForecasts.confMed` | med conf. | сред. увер. | orta etibar |
| `impactForecasts.emptyState` | No recent feed-crossing impact forecasts for this company. When an external feed (FAO/Brent/AZN-USD/CPI/etc) crosses a threshold, an automatic LLM analysis will appear here. | Нет недавних feed-crossing impact-прогнозов для этой компании. Когда external feed (FAO/Brent/AZN-USD/CPI/etc) пересечёт threshold — автоматический LLM-анализ появится здесь. | Bu şirkət üçün son feed-crossing impact-proqnozları yoxdur. Xarici feed (FAO/Brent/AZN-USD/CPI/və s.) həddi keçdikdə avtomatik LLM-təhlil burada görünəcək. |
| `impactForecasts.loadError` | Error loading impact forecasts: {error} | Ошибка загрузки impact-прогнозов: {error} | Impact-proqnozların yüklənməsi xətası: {error} |
| `impactForecasts.loading` | Loading impact forecasts… | Загружаю impact-прогнозы… | Impact-proqnozlar yüklənir… |
| `impactForecasts.recommendations` | Recommendations | Рекомендации | Tövsiyələr |
| `impactForecasts.relatedNews` | Related news | Связанные новости | Əlaqəli xəbərlər |
| `impactForecasts.scenarioBest` | best | лучший | ən yaxşı |
| `impactForecasts.scenarioLikely` | likely | вероятный | ehtimal |
| `impactForecasts.scenarioWorst` | worst | худший | ən pis |
| `impactForecasts.title` | Impact forecasts by feed events ({count}) | Impact-прогнозы по feed-событиям ({count}) | Feed hadisələri üzrə impact-proqnozlar ({count}) |

### `indicatorDetail` (83)

| Key | EN | RU | AZ |
|---|---|---|---|
| `indicatorDetail.aggregates` | Aggregates | Агрегаты | Aqreqatlar |
| `indicatorDetail.benchmarkButton` | Benchmark | Бенчмарк | Müqayisə |
| `indicatorDetail.benchmarkTitle` | Compare to other companies in your industry (median + top-quartile) | Сравнение с другими компаниями вашей отрасли (медиана + топ-квартиль) | Sənayənizdəki digər şirkətlərlə müqayisə et (median + top-kvartil) |
| `indicatorDetail.commentsButton` | Discuss | Обсудить | Müzakirə et |
| `indicatorDetail.commentsButtonTitle` | Attach a comment to this cell. Stored locally in your browser (v2 — team sync). | Прикрепить комментарий к этой ячейке. Хранится локально в вашем браузере (v2 — синхронизация с командой). | Bu xanaya şərh əlavə edin. Brauzerinizdə lokal saxlanılır (v2 — komanda sinxronizasiyası). |
| `indicatorDetail.confidenceHigh` | high | высокая | yüksək |
| `indicatorDetail.confidenceLow` | low | низкая | aşağı |
| `indicatorDetail.confidenceMedium` | medium | средняя | orta |
| `indicatorDetail.damodaranBanner` | ⚠ Calibrated against US benchmark (Damodaran). AZ-market data pending — treat as directional signal only. | ⚠ Калиброван по бенчмарку США (Damodaran). Данные по AZ-рынку ожидаются — используйте только как индикативный сигнал. | ⚠ ABŞ benchmarkına (Damodaran) görə kalibrlənmiş. AZ bazarına aid məlumat gözlənilir — yalnız istiqamətli siqnal kimi qiymətləndirin. |
| `indicatorDetail.directionBand` | band | диапазон | diapazon |
| `indicatorDetail.directionHigherBetter` | higher is better | больше — лучше | böyük — daha yaxşı |
| `indicatorDetail.directionLowerBetter` | lower is better | меньше — лучше | kiçik — daha yaxşı |
| `indicatorDetail.drilldown.amount` | Amount (AZN) | Сумма (AZN) | Məbləğ (AZN) |
| `indicatorDetail.drilldown.code` | Code | Код | Kod |
| `indicatorDetail.drilldown.empty` | No budget lines for this period | Нет строк бюджета для этого периода | Bu dövr üçün büdcə sətri yoxdur |
| `indicatorDetail.drilldown.hide` | Hide | Скрыть | Gizlət |
| `indicatorDetail.drilldown.lines` | lines | строк | sətir |
| `indicatorDetail.drilldown.loading` | Loading… | Загрузка… | Yüklənir… |
| `indicatorDetail.drilldown.monthlySeries` | 12-month history (AZN) | 12-месячная история (AZN) | 12-aylıq tarix (AZN) |
| `indicatorDetail.drilldown.name` | Account | Счёт | Hesab |
| `indicatorDetail.drilldown.show` | Show | Показать | Göstər |
| `indicatorDetail.drilldown.title` | Source rows (BudgetLine) | Источники (BudgetLine) | Mənbə sətirləri (BudgetLine) |
| `indicatorDetail.drilldown.truncated` | Showing first 500 rows — more exist | Показаны первые 500 строк — есть ещё | İlk 500 sətir göstərilir — daha çoxu var |
| `indicatorDetail.emptyDrillDown` | Click any HeatMap cell to drill down. | Кликните на любую ячейку HeatMap для детализации. | Detal üçün istənilən xanaya klikləyin. |
| `indicatorDetail.emptyOrTypePrefix` | Or type | Или введите | Yaxud yazın |
| `indicatorDetail.emptyOrTypeSuffix` | in the command bar. | в командной строке. | komanda sətrində. |
| `indicatorDetail.error` | Error: | Ошибка: | Xəta: |
| `indicatorDetail.explainButton` | Explain → | Объяснить → | İzah et → |
| `indicatorDetail.explainGreenDisabled` | Variance explainer is for amber / red / unknown only | Variance explainer работает только с amber / red / unknown | Variance explainer yalnız amber / red / unknown üçündür |
| `indicatorDetail.explainTitle` | Open AI Variance Explainer in Panel 4 + run for current cell | Открыть AI Variance Explainer в Панели 4 + запустить для текущей ячейки | Panel 4-də AI Variance Explainer aç + cari xana üçün işə sal |
| `indicatorDetail.explaining` | Explaining… | Объясняю… | İzah edirəm… |
| `indicatorDetail.extrapolationCaveat` | linear extrapolation; uncertainty grows with horizon | линейная экстраполяция; неопределённость растёт с горизонтом | xətti ekstrapolyasiya; üfüq artdıqca qeyri-müəyyənlik artır |
| `indicatorDetail.forecastCITitle` | 95% prediction interval | 95% интервал предсказания | 95% proqnoz intervalı |
| `indicatorDetail.forecastConfidence` | confidence | уверенность | inam |
| `indicatorDetail.forecastExplainFailed` | Forecast explain failed | Объяснение прогноза не удалось | Proqnoz izahı uğursuz oldu |
| `indicatorDetail.forecastHorizon` | Horizon | Горизонт | Üfüq |
| `indicatorDetail.forecastNextPeriod` | Next-period forecast | Прогноз след. периода | Növbəti dövrə proqnoz |
| `indicatorDetail.forecastNoChange` | no change expected | изменений не ожидается | dəyişiklik gözlənilmir |
| `indicatorDetail.forecastPts` | pts | точек | xal |
| `indicatorDetail.formula` | Formula | Формула | Formula |
| `indicatorDetail.likelyDrivers` | Likely drivers | Возможные драйверы | Mümkün sürücülər |
| `indicatorDetail.llmConfidence` | LLM confidence | Уверенность LLM | LLM inamı |
| `indicatorDetail.loading` | Loading... | Загрузка... | Yüklənir... |
| `indicatorDetail.materiality.lowMateriality` | Low materiality | Низкая материальность | Aşağı materiallıq |
| `indicatorDetail.materiality.notMaterial` | Not material | Не материально | Materialli deyil |
| `indicatorDetail.materiality.tooltipSuffix` | SASB materiality: this metric is not a priority for the sector. | SASB-материальность: показатель не приоритетен для этой отрасли. | SASB materiallıq: bu göstərici bu sektor üçün prioritet deyil. |
| `indicatorDetail.metaDirection` | direction | направление | istiqamət |
| `indicatorDetail.metaPeriod` | period | период | dövr |
| `indicatorDetail.metaUnit` | unit | ед. | vahid |
| `indicatorDetail.missingCellAction` | Onboard data via /budgeting/onboarding or trigger a recompute. | Загрузите данные через /budgeting/onboarding или запустите пересчёт. | /budgeting/onboarding vasitəsilə məlumat yükləyin və ya yenidən hesablayın. |
| `indicatorDetail.missingCellHint` | {indicator} has no computed value for {company} yet. | {indicator} ещё не вычислен для {company}. | {indicator} hələ {company} üçün hesablanmayıb. |
| `indicatorDetail.none` | (none) | (нет) | (yoxdur) |
| `indicatorDetail.noneMissingData` | (none — likely missing-data / unknown status) | (нет — вероятно отсутствуют данные / unknown-статус) | (yoxdur — ehtimal ki, məlumat çatışmır / unknown statusu) |
| `indicatorDetail.openSourceButton` | Open source | Источник | Mənbə |
| `indicatorDetail.openSourceTitle` | Open the underlying commodity / weather feed in a new window | Открыть базовый commodity / weather фид в новом окне | Müvafiq commodity / weather mənbəsini yeni pəncərədə aç |
| `indicatorDetail.pipelineNote` | Pipeline note | Замечание pipeline | Pipeline qeydi |
| `indicatorDetail.provenance.computed` | Computed | Расчётный | Hesablanıb |
| `indicatorDetail.provenance.computedTitle` | Derived from real BudgetLine / OperationalFact / Booking data. Financial reality. | Производное от реальных данных BudgetLine / OperationalFact / Booking. Финансовая реальность. | Real BudgetLine / OperationalFact / Booking məlumatlarından əldə edilib. Maliyyə reallığı. |
| `indicatorDetail.provenance.confidenceLabel` | Model confidence: {tier} (A — best, D — worst). | Доверие модели: {tier} (A — лучшее, D — худшее). | Model etibarlılığı: {tier} (A — ən yaxşı, D — ən pis). |
| `indicatorDetail.provenance.disclosed` | Disclosed | Раскрыто | Açıqlanıb |
| `indicatorDetail.provenance.disclosedTitle` | Company-reported value (manual entry / import). A real measured figure. | Значение раскрыто компанией (ручной ввод / импорт). Реальный измеренный показатель. | Şirkət tərəfindən açıqlanmış dəyər (əl ilə daxil edilmə / idxal). Real ölçülmüş göstərici. |
| `indicatorDetail.provenance.macro` | Macro indicator | Макропоказатель | Makro göstərici |
| `indicatorDetail.provenance.macroTitle` | Macro context — a single value applied to every company. Not a measurement of this entity, but environmental context (e.g. Azerbaijan climate readiness). | Макро-контекст — одно значение применяется ко всем компаниям. Не измерение конкретной компании, а характеристика среды (например климатическая готовность Азербайджана). | Makro kontekst — bütün şirkətlərə tətbiq olunan vahid dəyər. Bu qurumun ölçüsü deyil, ətraf mühit konteksti (məsələn Azərbaycanın iqlim hazırlığı). |
| `indicatorDetail.provenance.modeled_generic` | Generic estimate | Общая оценка | Ümumi təxmin |
| `indicatorDetail.provenance.modeled_genericTitle` | V1 PLACEHOLDER: formula × generic factor (e.g. revenue × 0.5 kg CO₂/AZN for carbon indicators). Not a real measurement; v2 will swap in an industry-specific factor or disclosed value. | V1 ЗАГЛУШКА: формула × общий коэффициент (например выручка × 0.5 кг CO₂/AZN для углеродных индикаторов). Не реальное измерение; v2 заменит на отраслевой коэффициент или раскрытие. | V1 KEÇİCİ: formula × ümumi əmsal (məs. karbon göstəriciləri üçün gəlir × 0.5 kq CO₂/AZN). Real ölçü deyil; v2 sənaye əmsalı və ya açıqlanmış dəyərlə əvəz edəcək. |
| `indicatorDetail.provenance.modeled_industry` | Industry estimate | Отраслевая оценка | Sənaye təxmini |
| `indicatorDetail.provenance.modeled_industryTitle` | Estimate using an industry-specific intensity factor. Not a company disclosure, but closer to reality than the generic factor. | Оценка по отраслевому коэффициенту интенсивности. Не реальное раскрытие компании, но ближе к правде, чем общий коэффициент. | Sənayeyə xas intensivlik əmsalı ilə təxmin. Şirkət açıqlaması deyil, lakin ümumi əmsaldan daha dəqiqdir. |
| `indicatorDetail.reRun` | Re-run | Перезапуск | Yenidən |
| `indicatorDetail.recompute` | Recompute | Пересчитать | Yenidən hesabla |
| `indicatorDetail.recomputeDone` | Updated | Обновлено | Yeniləndi |
| `indicatorDetail.recomputeFailed` | Failed | Ошибка | Xəta |
| `indicatorDetail.recomputeTitle` | Recompute this indicator value with up-to-date sparkline | Пересчитать значение индикатора со свежей sparkline-кривой | Bu göstərici dəyərini yenilənmiş sparkline ilə yenidən hesabla |
| `indicatorDetail.recomputing` | Recomputing… | Пересчёт… | Hesablama… |
| `indicatorDetail.resolvedVariables` | Resolved variables | Резолвленные переменные | Həll edilmiş dəyişənlər |
| `indicatorDetail.riskFactors` | Risk factors | Факторы риска | Risk faktorları |
| `indicatorDetail.rollupAction` | Sub-group cells aggregate child values (avg + worst-of-children status). No single canonical IV row exists at the parent level. | Ячейки подгруппы агрегируют дочерние значения (среднее + worst-of-children статус). Канонической IV-строки на уровне родителя не существует. | Alt-qrup xanaları törəmə dəyərləri birləşdirir (orta + worst-of-children status). Valideyn səviyyəsində kanonik IV sətri mövcud deyil. |
| `indicatorDetail.rollupHint` | {indicator} for {company} is a sub-group rollup — averaged across {count} operational children. Click an operational sub-co in the tree on the left for the canonical drill-down. | {indicator} для {company} — агрегат подгруппы (среднее по {count} операционным дочерним компаниям). Кликните по операционной дочерней компании в дереве слева для канонического drill-down. | {indicator} {company} üçün alt-qrup birləşməsidir — {count} əməliyyat törəmə şirkət üzrə orta. Kanonik drill-down üçün soldakı ağacda əməliyyat törəməsinə klikləyin. |
| `indicatorDetail.source` | Source | Источник | Mənbə |
| `indicatorDetail.trust.lastAudited` | Audited | Сверено | Yoxlanıldı |
| `indicatorDetail.trust.notReconciled` | Not yet reconciled | Ещё не сверено | Hələ yoxlanılmayıb |
| `indicatorDetail.trust.source` | Source | Источник | Mənbə |
| `indicatorDetail.trust.sourceNotRecorded` | Source not recorded | Источник не зафиксирован | Mənbə qeydə alınmayıb |
| `indicatorDetail.whatIsThis` | What is this? | Что это? | Bu nədir? |

### `intelFeedPanel` (14)

| Key | EN | RU | AZ |
|---|---|---|---|
| `intelFeedPanel.closeAriaLabel` | Close intel feed | Закрыть ленту Intel | Intel lentini bağla |
| `intelFeedPanel.dialogAriaLabel` | Intel feed | Лента Intel | Intel lenti |
| `intelFeedPanel.dismissAriaLabel` | Dismiss item | Скрыть | Gizlət |
| `intelFeedPanel.emptyAdmin` | No recent intel. Click Refresh to crawl now. | Нет свежих новостей. Нажмите Обновить, чтобы запустить сбор сейчас. | Son xəbərlər yoxdur. İndi axtarış üçün Yenilə düyməsinə basın. |
| `intelFeedPanel.emptyViewer` | No recent intel. Ask an admin to refresh. | Нет свежих новостей. Попросите администратора обновить. | Son xəbərlər yoxdur. Adminə yeniləməsi üçün müraciət edin. |
| `intelFeedPanel.loading` | Loading intel… | Загрузка Intel… | Intel yüklənir… |
| `intelFeedPanel.pinAriaLabel` | Pin item | Закрепить | Sabitlə |
| `intelFeedPanel.refreshAriaLabel` | Refresh intel feed | Обновить ленту Intel | Intel lentini yenilə |
| `intelFeedPanel.refreshLabel` | Refresh | Обновить | Yenilə |
| `intelFeedPanel.refreshingLabel` | Refreshing… | Обновление… | Yenilənir… |
| `intelFeedPanel.relevanceAriaLabel` | Relevance {tone} {score} | Релевантность {tone} {score} | Aidiyyət {tone} {score} |
| `intelFeedPanel.subtitle` | AI-curated news on your portfolio's industries + companies. | AI-подборка новостей по индустриям и компаниям вашего портфеля. | Portfelinizin sənayələri və şirkətləri üzrə AI-tərəfindən seçilmiş xəbərlər. |
| `intelFeedPanel.title` | Intel feed | Лента Intel | Intel lenti |
| `intelFeedPanel.unpinAriaLabel` | Unpin item | Открепить | Sabitlikdən çıxar |

### `layoutMenu` (25)

| Key | EN | RU | AZ |
|---|---|---|---|
| `layoutMenu.applyPresetTitle` | Apply {label} preset | Применить пресет «{label}» | «{label}» şablonunu tətbiq et |
| `layoutMenu.closeMenuAriaLabel` | Close menu | Закрыть меню | Menyunu bağla |
| `layoutMenu.confirmDeleteBody` | Delete layout "{name}"? This cannot be undone. | Удалить раскладку «{name}»? Действие нельзя отменить. | «{name}» layoutu silinsin? Əməliyyat geri alınmır. |
| `layoutMenu.confirmDeleteCancel` | Cancel | Отмена | Ləğv et |
| `layoutMenu.confirmDeleteConfirm` | Delete | Удалить | Sil |
| `layoutMenu.confirmDeleteTitle` | Delete layout? | Удалить раскладку? | Layout silinsin? |
| `layoutMenu.deleteAriaLabel` | Delete {name} | Удалить {name} | {name} sil |
| `layoutMenu.deleteTitle` | Delete | Удалить | Sil |
| `layoutMenu.errorInvalidLayout` | Layout "{name}" has invalid sizes — likely from an older panel structure. Delete + re-save. | Раскладка «{name}» имеет некорректные размеры — вероятно от старой структуры панелей. Удалите и пересохраните. | «{name}» layoutu yanlış ölçülərə malikdir — köhnə panel strukturundan ola bilər. Sil və yenidən saxla. |
| `layoutMenu.errorInvalidName` | Name must be 1-40 chars, no leading/trailing whitespace, no control chars. | Имя должно быть 1–40 символов, без пробелов в начале/конце, без управляющих символов. | Ad 1–40 simvol olmalıdır, başında/sonunda boşluq və idarə simvolları olmamalıdır. |
| `layoutMenu.label` | Layouts | Layouts | Layoutlar |
| `layoutMenu.loadTitle` | Load "{name}" (saved {time}) | Загрузить «{name}» (сохранено {time}) | «{name}» yüklə (saxlanma vaxtı {time}) |
| `layoutMenu.loading` | Loading… | Загрузка… | Yüklənir… |
| `layoutMenu.namePlaceholder` | name this layout… | имя раскладки… | layout adı… |
| `layoutMenu.noSaved` | No saved layouts. | Сохранённых раскладок нет. | Saxlanmış layout yoxdur. |
| `layoutMenu.presetLabel.analyst` | Analyst Drill-down | Аналитик — детализация | Analitik — detallaşdırma |
| `layoutMenu.presetLabel.auditMode` | Audit Mode | Режим аудита | Audit rejimi |
| `layoutMenu.presetLabel.bloomberg` | Bloomberg | Bloomberg | Bloomberg |
| `layoutMenu.presetLabel.default` | Default 2×2 | Default 2×2 | Default 2×2 |
| `layoutMenu.presetLabel.investorMode` | Investor Mode | Режим инвестора | İnvestor rejimi |
| `layoutMenu.presetLabel.morningBrief` | Morning Brief | Утренний брифинг | Səhər brifinqi |
| `layoutMenu.presets` | Presets | Пресеты | Hazır şablonlar |
| `layoutMenu.save` | Save | Сохранить | Saxla |
| `layoutMenu.saved` | Saved | Сохранённые | Saxlanmış |
| `layoutMenu.title` | Save / load named pane layouts | Сохранить / загрузить именованные раскладки панелей | Adlı pəncərə layoutlarını saxla / yüklə |

### `lockedPeriodBanner` (7)

| Key | EN | RU | AZ |
|---|---|---|---|
| `lockedPeriodBanner.ariaLabel` | Active matrix period {period} is locked — mutations rejected | Активный период {period} заблокирован — изменения отклоняются | Aktiv dövr {period} kilidlənib — dəyişikliklər rədd edilir |
| `lockedPeriodBanner.at` | Locked at: {when} | Заблокировано: {when} | Kilidlənmə vaxtı: {when} |
| `lockedPeriodBanner.by` | Locked by: {who} | Заблокировал: {who} | Kilidləyən: {who} |
| `lockedPeriodBanner.locked` | Period {period} is locked | Период {period} заблокирован | {period} dövrü kilidlənib |
| `lockedPeriodBanner.reason` | Reason: {reason} | Причина: {reason} | Səbəb: {reason} |
| `lockedPeriodBanner.subtitle` | Mutations rejected | Изменения отклоняются | Dəyişikliklər rədd edilir |
| `lockedPeriodBanner.title` | Period {period} is locked | Период {period} заблокирован | {period} dövrü kilidlənib |

### `marketTicker` (5)

| Key | EN | RU | AZ |
|---|---|---|---|
| `marketTicker.ariaLabel` | Market ticker — FX rates and commodities | Рыночная строка — курсы и сырьё | Bazar lenti — valyuta və xammal |
| `marketTicker.clickHint` | Source: {source} · click for catalog | Источник: {source} · клик — каталог | Mənbə: {source} · kataloq üçün klik |
| `marketTicker.entryAriaLabel` | Open Data Sources for {label} | Открыть Data Sources для {label} | {label} üçün Data Sources-u aç |
| `marketTicker.label` | Market | Рынок | Bazar |
| `marketTicker.loading` | Loading quotes… | Загрузка котировок… | Kotirovkalar yüklənir… |

### `mobileBanner` (3)

| Key | EN | RU | AZ |
|---|---|---|---|
| `mobileBanner.ariaLabel` | Mobile viewport advisory | Уведомление об узком окне просмотра | Dar pəncərə xəbərdarlığı |
| `mobileBanner.dismissAriaLabel` | Dismiss mobile viewport advisory | Скрыть уведомление об узком окне | Dar pəncərə xəbərdarlığını bağla |
| `mobileBanner.text` | Risk Terminal is optimized for ≥1024px viewports. Some panels may not display fully on this screen — switch to a wider monitor for the full experience. | Risk Terminal оптимизирован для экранов ≥1024px. На этом экране некоторые панели могут отображаться не полностью — для полного опыта используйте более широкий монитор. | Risk Terminal ≥1024px ekranlar üçün optimallaşdırılıb. Bu ekranda bəzi panellər tam görünməyə bilər — tam təcrübə üçün daha geniş monitor istifadə edin. |

### `morningBrief` (6)

| Key | EN | RU | AZ |
|---|---|---|---|
| `morningBrief.cached` | from cache | из кэша | keşdən |
| `morningBrief.calmMorning` | Calm morning — no red indicators or active alerts. | Спокойное утро — без красных индикаторов и активных алёртов. | Sakit səhər — qırmızı indikator və aktiv xəbərdarlıq yoxdur. |
| `morningBrief.fresh` | freshly generated | сгенерировано сейчас | yeni yaradıldı |
| `morningBrief.header` | AI Morning Brief | Утренний бриф AI | AI səhər icmalı |
| `morningBrief.loading` | AI composing today's brief… | AI собирает сводку дня… | AI gün üçün icmal hazırlayır… |
| `morningBrief.refresh` | Refresh brief | Обновить бриф | İcmalı yenilə |

### `panelGrid` (1)

| Key | EN | RU | AZ |
|---|---|---|---|
| `panelGrid.panel` | PANEL | ПАНЕЛЬ | PANEL |

### `panels` (10)

| Key | EN | RU | AZ |
|---|---|---|---|
| `panels.companyTree` | Company Tree | Дерево компаний | Şirkət ağacı |
| `panels.companyTreeShort` | TREE | ДЕРЕВО | AĞAC |
| `panels.heatMap` | Risk Heat Map | Карта рисков | Risk istilik xəritəsi |
| `panels.heatMapShort` | HEATMAP | КАРТА | XƏRİTƏ |
| `panels.indicatorDetail` | Indicator Detail | Детализация индикатора | Göstərici detalları |
| `panels.indicatorDetailShort` | DETAIL | ДЕТАЛИ | DETAL |
| `panels.popOutAria` | Open panel in separate window | Открыть панель в отдельном окне | Paneli ayrı pəncərədə aç |
| `panels.popOutTitle` | Open in separate window (Bloomberg multi-monitor) | Открыть в отдельном окне (Bloomberg multi-monitor) | Ayrı pəncərədə aç (Bloomberg multi-monitor) |
| `panels.snapshot` | Company Snapshot | Снимок компании | Şirkət portreti |
| `panels.snapshotShort` | SNAPSHOT | СНИМОК | PORTRET |

### `peer` (7)

| Key | EN | RU | AZ |
|---|---|---|---|
| `peer.close` | Close | Закрыть | Bağla |
| `peer.colIndicator` | Indicator | Индикатор | İndikator |
| `peer.dialogAriaLabel` | Peer comparison: {codes} | Peer-сравнение: {codes} | Peer müqayisəsi: {codes} |
| `peer.loading` | Loading matrix… | Загрузка матрицы… | Matris yüklənir… |
| `peer.someNotFound` | Only {found} of {total} companies matched in the active matrix. | Найдено {found} из {total} компаний в активной матрице. | {total} şirkətdən {found}-i aktiv matrisdə tapıldı. |
| `peer.subtitle` | Side-by-side indicator values. ▲ = best in row, ▼ = worst in row, by indicator direction. | Side-by-side значения индикаторов. ▲ = лучший, ▼ = худший в строке, по направлению индикатора. | Side-by-side indikator dəyərləri. ▲ = ən yaxşı, ▼ = ən pis, indikator istiqamətinə görə. |
| `peer.title` | Peer Comparison ({count} companies) | Сравнение peer ({count} компаний) | Peer müqayisəsi ({count} şirkət) |

### `periodChips` (4)

| Key | EN | RU | AZ |
|---|---|---|---|
| `periodChips.annualHint` | Full year {year} | Полный год {year} | Tam il {year} |
| `periodChips.ariaLabel` | Period selector | Выбор периода | Dövr seçici |
| `periodChips.monthHint` | Month {m} of {year} | Месяц {m} {year} | Ay {m} {year} |
| `periodChips.quarterHint` | Q{q} of {year} | Q{q} {year} | Q{q} {year} |

### `relatedFunctions` (10)

| Key | EN | RU | AZ |
|---|---|---|---|
| `relatedFunctions.ariaLabel` | Related functions | Связанные функции | Əlaqəli funksiyalar |
| `relatedFunctions.audit` | Audit | Аудит | Audit |
| `relatedFunctions.compare` | Compare | Сравнение | Müqayisə |
| `relatedFunctions.forCompany` | For {code} | Для {code} | {code} üçün |
| `relatedFunctions.forecast` | Forecast | Прогноз | Proqnoz |
| `relatedFunctions.orgWide` | Org-wide | По всему холдингу | Bütün holdinq |
| `relatedFunctions.pnl` | P&L | P&L | P&L |
| `relatedFunctions.titleForCompany` | Open {code} in P&L / Compare / Variance / Forecast / Audit | Открыть {code} в P&L / Compare / Variance / Forecast / Audit | {code} üçün P&L / Müqayisə / Sapma / Proqnoz / Audit aç |
| `relatedFunctions.titleOrgWide` | Open holding-wide P&L / Compare / Variance / Forecast / Audit | Открыть P&L / Compare / Variance / Forecast / Audit для всего холдинга | Bütün holdinq üçün P&L / Müqayisə / Sapma / Proqnoz / Audit aç |
| `relatedFunctions.variance` | Variance | Отклонения | Sapma |

### `scenario` (16)

| Key | EN | RU | AZ |
|---|---|---|---|
| `scenario.apply` | Apply | Применить | Tətbiq et |
| `scenario.applyFailed` | Apply failed | Применить не удалось | Tətbiq alınmadı |
| `scenario.applying` | Applying… | Применяется… | Tətbiq edilir… |
| `scenario.available` | Available | Доступно | Mövcud |
| `scenario.closeAriaLabel` | Close scenario panel | Закрыть панель сценариев | Ssenari panelini bağla |
| `scenario.detailAriaLabel` | Scenario detail | Детали сценария | Ssenari detalları |
| `scenario.dialogAriaLabel` | Scenario runner | Симулятор сценариев | Ssenari Runner |
| `scenario.listAriaLabel` | Scenario list | Список сценариев | Ssenari siyahısı |
| `scenario.loading` | Loading… | Загрузка… | Yüklənir… |
| `scenario.noScenarios` | No scenarios seeded for this org. | Сценарии для этой org не засеяны. | Bu org üçün ssenari seed-i yoxdur. |
| `scenario.noSelected` | No scenario selected. | Сценарий не выбран. | Ssenari seçilməyib. |
| `scenario.overrides` | Overrides | Overrides | Overrides |
| `scenario.period` | Period | Период | Dövr |
| `scenario.selectFromList` | Select a scenario from the list to inspect overrides. | Выберите сценарий из списка чтобы посмотреть overrides. | Override-lara baxmaq üçün siyahıdan ssenari seçin. |
| `scenario.subtitle` | What-if overrides on the org's indicator pipeline. Press Esc to close. | What-if изменения для индикаторного pipeline org. Esc для закрытия. | Org göstərici pipeline üzərində what-if dəyişiklikləri. Esc bağlamaq üçün. |
| `scenario.title` | Scenario Runner | Симулятор сценариев | Ssenari Runner |

### `scenarioDesc` (20)

| Key | EN | RU | AZ |
|---|---|---|---|
| `scenarioDesc.AZN_DEVAL_15` | AZN/USD to 1.955 (from the live ~1.70) → −15% manat; milder FX shock on the assumed import share. | Курс AZN/USD до 1.955 (с текущего ~1.70) → −15% манат; умеренный FX-шок на предполагаемую долю импорта. | AZN/USD 1.955-ə (cari ~1.70-dən) → −15% manat; ehtimal olunan idxal payına yumşaq FX şoku. |
| `scenarioDesc.AZN_DEVAL_20` | AZN/USD to 2.04 (from the live CBAR rate ~1.70) → −20% manat; cost rises on the assumed 30% imported-input share. | Курс AZN/USD до 2.04 (с текущего курса ЦБАР ~1.70) → −20% манат; затраты растут на предполагаемой 30% доле импортных ресурсов. | AZN/USD 2.04-ə (cari CBAR məzənnəsi ~1.70-dən) → −20% manat; ehtimal olunan 30% idxal resurs payında xərclər artır. |
| `scenarioDesc.BORDER_CLOSURE` | Exporter volume −25%. | Объём экспортёра −25%. | İxracatçı həcmi −25%. |
| `scenarioDesc.BRENT_TO_140` | Brent climbs to $140 (from the live ~110) → energy/fertilizer input cost rises. | Brent растёт до $140 (с текущих ~110) → растут затраты на энергию/удобрения. | Brent $140-a qalxır (cari ~110-dan) → enerji/gübrə xərcləri artır. |
| `scenarioDesc.DROUGHT_2026` | Harvest −30%: revenue + yield fall but seeds/fertilizer/labour/irrigation are already spent (costRigidity 0.8) → agro margins crushed. | Урожай −30%: выручка и урожайность падают, но семена/удобрения/труд/орошение уже потрачены (costRigidity 0.8) → агро-маржа обрушена. | Məhsul −30%: gəlir və məhsuldarlıq düşür, lakin toxum/gübrə/əmək/suvarma artıq xərclənib (costRigidity 0.8) → aqrar marja əzilir. |
| `scenarioDesc.DROUGHT_SEVERE_50` | Extreme drought tail: harvest −50%, costs largely sunk (costRigidity 0.8). | Экстремальная засуха (хвостовой риск): урожай −50%, затраты в основном уже понесены (costRigidity 0.8). | Ekstremal quraqlıq (quyruq riski): məhsul −50%, xərclər əsasən çəkilib (costRigidity 0.8). |
| `scenarioDesc.INPUT_COST_30` | Input cost +30% (FX-import / sugar / grain) → margins compress across food-processing. | Входная стоимость +30% (FX-импорт / сахар / зерно) → маржа сжимается по всей пищепереработке. | Giriş xərci +30% (FX-idxal / şəkər / taxıl) → ərzaq emalında marjalar sıxılır. |
| `scenarioDesc.INPUT_COST_50` | Severe input-cost tail. | Тяжёлый хвостовой риск роста входной стоимости. | Ağır giriş-xərci quyruq riski. |
| `scenarioDesc.IRAN_HIGH` | Sanctions regime tightens — petrochem feedstock cost +20%, AZN/USD spread widens, foreign-currency import lines repriced at the higher rate. Stress-tests cogs/opex against AGRO_FX_RISK + IND_NET_MARGIN. | Ужесточение санкционного режима — стоимость нефтехимического сырья +20%, спред AZN/USD расширяется, валютные импортные позиции переоценены по более высокому курсу. Стресс-тест COGS/OpEx против AGRO_FX_RISK + IND_NET_MARGIN. | Sanksiya rejimi sərtləşir — neft-kimya xammalı xərci +20%, AZN/USD spredi genişlənir, xarici valyuta idxal xətləri daha yüksək məzənnə ilə yenidən qiymətləndirilir. AGRO_FX_RISK + IND_NET_MARGIN üzrə COGS/OpEx stress-testi. |
| `scenarioDesc.IRAN_SANCTIONS` | FX + cost pressure (assumed import share). | FX + ценовое давление (предполагаемая доля импорта). | FX + xərc təzyiqi (ehtimal olunan idxal payı). |
| `scenarioDesc.LOSE_TOP_CUSTOMER_20` | Top-customer loss → produce less; cost fully variable (margins ~flat, absolutes fall). | Потеря крупного клиента → меньше производства; затраты полностью переменные (маржа ~неизменна, абсолютные значения падают). | Əsas müştərinin itkisi → daha az istehsal; xərc tam dəyişkən (marja ~sabit, mütləq dəyərlər düşür). |
| `scenarioDesc.OIL_DROP_30` | Global crude price falls 30% — revenue compression for petrochem-tied lines, secondary impact on regional FX (manat soft-peg loosens). Stress-tests revenue side + IND_GROSS_MARGIN under price-pressure regime. | Мировая цена нефти падает на 30% — сжатие выручки по нефтехимическим позициям, вторичное влияние на региональный FX (мягкая привязка маната слабеет). Стресс-тест выручки + IND_GROSS_MARGIN в режиме ценового давления. | Dünya neft qiyməti 30% düşür — neft-kimya xətləri üzrə gəlir sıxılır, regional FX-ə ikincili təsir (manatın yumşaq bağlanması zəifləyir). Qiymət təzyiqi rejimində gəlir + IND_GROSS_MARGIN stress-testi. |
| `scenarioDesc.PRICE_DROP_20` | Output price −20% (sugar/commodity) → margin compresses. | Цена реализации −20% (сахар/сырьё) → маржа сжимается. | Satış qiyməti −20% (şəkər/əmtəə) → marja sıxılır. |
| `scenarioDesc.PRICE_DROP_40` | Severe price-crash tail. | Тяжёлый хвостовой риск обвала цены. | Ağır qiymət çöküşü quyruq riski. |
| `scenarioDesc.REVENUE_DROP_20` | Top-customer loss → volume −20%. | Потеря крупного клиента → объём −20%. | Əsas müştərinin itkisi → həcm −20%. |
| `scenarioDesc.REVENUE_DROP_30` | Sales volume −30% → revenue + revenue-per-ha + yield fall. | Объём продаж −30% → падают выручка + выручка-на-га + урожайность. | Satış həcmi −30% → gəlir + hektar başına gəlir + məhsuldarlıq düşür. |
| `scenarioDesc.REVENUE_DROP_50` | Extreme volume tail. | Экстремальный хвостовой риск падения объёма. | Ekstremal həcm quyruq riski. |
| `scenarioDesc.STAGFLATION` | Combined cost-push + demand-drop. | Комбинированный шок: рост издержек + падение спроса. | Birləşmiş şok: xərc artımı + tələbin düşməsi. |
| `scenarioDesc.SUGAR_PRICE_DROP_20` | Global sugar price −20%: margin falls faster than revenue (COGS fixed). | Мировая цена сахара −20%: маржа падает сильнее выручки (COGS фиксированы). | Dünya şəkər qiyməti −20%: marja gəlirdən sürətli düşür (COGS sabit). |
| `scenarioDesc.SUGAR_PRICE_TO_70` | FAO sugar index falls to 70 (from the live ~88.5) → output-price drop compresses sugar-producer margins. | Индекс сахара FAO падает до 70 (с текущего ~88.5) → падение цены реализации сжимает маржу производителей сахара. | FAO şəkər indeksi 70-ə düşür (cari ~88.5-dən) → satış qiymətinin düşməsi şəkər istehsalçılarının marjasını sıxır. |

### `scenarioForm` (27)

| Key | EN | RU | AZ |
|---|---|---|---|
| `scenarioForm.cancel` | Cancel | Отмена | Ləğv et |
| `scenarioForm.closeAria` | Close form | Закрыть форму | Formanı bağla |
| `scenarioForm.codeHint` | UPPERCASE letters, digits and underscores only. Cannot be changed after creation. | Только UPPERCASE буквы, цифры и подчёркивания. Нельзя изменить после создания. | Yalnız BÖYÜK hərflər, rəqəmlər və alt xətt. Yaradıldıqdan sonra dəyişdirilə bilməz. |
| `scenarioForm.codeLabel` | Scenario code * | Код сценария * | Ssenari kodu * |
| `scenarioForm.codesHelpPrefix` | Examples: | Примеры: | Nümunələr: |
| `scenarioForm.codesHelpSuffix` | Full list — in the indicator matrix (HOLD GO → indicators). | Полный список — в матрице индикаторов (HOLD GO → индикаторы). | Tam siyahı — indikator matrisində (HOLD GO → indikatorlar). |
| `scenarioForm.codesHelpSummary` | Help: allowed indicator codes | Справка: допустимые коды индикаторов | Kömək: icazə verilən indikator kodları |
| `scenarioForm.create` | Create | Создать | Yarat |
| `scenarioForm.createTitle` | New scenario | Новый сценарий | Yeni ssenari |
| `scenarioForm.descLabel` | Description | Описание | Təsvir |
| `scenarioForm.descPlaceholder` | Brief description of the shock and assumptions | Краткое описание шока и предпосылок | Şokun və ehtimalların qısa təsviri |
| `scenarioForm.editTitle` | Edit: {code} | Редактировать: {code} | Redaktə: {code} |
| `scenarioForm.errAdminRequired` | Admin role required to manage scenarios | Для управления сценариями нужна роль Admin | Ssenariləri idarə etmək üçün Admin rolu tələb olunur |
| `scenarioForm.errCodeExists` | Scenario code already exists | Сценарий с таким кодом уже существует | Bu kodlu ssenari artıq mövcuddur |
| `scenarioForm.errCodeFormat` | Code must be UPPERCASE letters, digits, and underscores only | Код — только UPPERCASE буквы, цифры и подчёркивания | Kod yalnız BÖYÜK hərflər, rəqəmlər və alt xətt olmalıdır |
| `scenarioForm.errCodeNameRequired` | Code and English name are required | Код и название (EN) обязательны | Kod və ad (EN) tələb olunur |
| `scenarioForm.errJsonNoAdjustments` | JSON must contain an "adjustments" array with at least one entry | JSON должен содержать массив "adjustments" хотя бы с одним элементом | JSON ən azı bir elementi olan "adjustments" massivini ehtiva etməlidir |
| `scenarioForm.errJsonParse` | JSON parse error: {message} | Ошибка разбора JSON: {message} | JSON təhlil xətası: {message} |
| `scenarioForm.errNetwork` | Network error | Ошибка сети | Şəbəkə xətası |
| `scenarioForm.errServer` | Server error {status} | Ошибка сервера {status} | Server xətası {status} |
| `scenarioForm.nameEnLabel` | Name (EN) * | Название (EN) * | Ad (EN) * |
| `scenarioForm.nameRuLabel` | Name (RU) | Название (RU) | Ad (RU) |
| `scenarioForm.nameRuPlaceholder` | Sugar price −20% | Цена сахара −20% | Şəkər qiyməti −20% |
| `scenarioForm.overridesLabel` | Overrides (JSON) * | Overrides (JSON) * | Overrides (JSON) * |
| `scenarioForm.saving` | Saving… | Сохранение… | Saxlanılır… |
| `scenarioForm.structureValid` | Structure valid. <m>multiply</m> and <m>delta</m> are interchangeable. | Структура корректна. <m>multiply</m> и <m>delta</m> — взаимозаменяемы. | Struktur düzgündür. <m>multiply</m> və <m>delta</m> bir-birini əvəz edir. |
| `scenarioForm.update` | Update | Обновить | Yenilə |

### `scenarioPanel` (52)

| Key | EN | RU | AZ |
|---|---|---|---|
| `scenarioPanel.aiLangAria` | AI narrative language | Язык AI-нарратива | AI mətn dili |
| `scenarioPanel.applyHeatMap` | ✓ Apply to HeatMap | ✓ Применить к HeatMap | ✓ HeatMap-ə tətbiq et |
| `scenarioPanel.baseScenario` | ← Base scenario | ← Базовый сценарий | ← Baza ssenari |
| `scenarioPanel.briefGenerating` | 🤖 AI brief generating… | 🤖 AI-бриф генерируется… | 🤖 AI brifi yaradılır… |
| `scenarioPanel.cascadeRunning` | Crisis cascading across the map… | Кризис разворачивается на карте… | Böhran xəritə üzrə yayılır… |
| `scenarioPanel.category.__other__` | 🧪 Other (multiplier) | 🧪 Другие (множитель) | 🧪 Digər (multiplikator) |
| `scenarioPanel.category.climate_agro` | ☀️ Climate / agro | ☀️ Климат / агро | ☀️ İqlim / aqro |
| `scenarioPanel.category.commodity` | 🌾 Commodities | 🌾 Сырьё | 🌾 Xammal |
| `scenarioPanel.category.customers` | 👥 Customers | 👥 Клиенты | 👥 Müştərilər |
| `scenarioPanel.category.fx_macro` | 💱 FX / macro | 💱 Валюта / макро | 💱 Valyuta / makro |
| `scenarioPanel.category.geopolitics` | 🌍 Geopolitics | 🌍 Геополитика | 🌍 Geosiyasət |
| `scenarioPanel.checked` | Checked: <strong>{count}</strong> indicators | Проверено: <strong>{count}</strong> индикаторов | Yoxlanıldı: <strong>{count}</strong> indikator |
| `scenarioPanel.close` | Close | Закрыть | Bağla |
| `scenarioPanel.codePeriod` | {code} · period: {period} | {code} · период: {period} | {code} · dövr: {period} |
| `scenarioPanel.colBaseline` | Baseline | Базовый | Baza |
| `scenarioPanel.colCompany` | Company | Компания | Şirkət |
| `scenarioPanel.colIndicator` | Indicator | Индикатор | İndikator |
| `scenarioPanel.colScenario` | Scenario | Сценарий | Ssenari |
| `scenarioPanel.colValueNow` | Value now | Значение стало | Dəyər oldu |
| `scenarioPanel.colValueWas` | Value was | Значение было | Dəyər idi |
| `scenarioPanel.createAria` | Create scenario | Создать сценарий | Ssenari yarat |
| `scenarioPanel.crisisError` | Modelling error: {message} | Ошибка моделирования: {message} | Modelləşdirmə xətası: {message} |
| `scenarioPanel.deleteAria` | Delete {code} | Удалить {code} | {code} sil |
| `scenarioPanel.deleteConfirm` | Delete this scenario? It will be hidden but the data is preserved. | Удалить этот сценарий? Он будет скрыт, но данные сохранятся. | Bu ssenari silinsin? Gizlədiləcək, lakin məlumatlar saxlanılacaq. |
| `scenarioPanel.dialogAria` | Scenario analysis | Сценарный анализ | Ssenari təhlili |
| `scenarioPanel.editAria` | Edit {code} | Редактировать {code} | {code} redaktə et |
| `scenarioPanel.empty` | No scenarios found | Сценарии не найдены | Ssenari tapılmadı |
| `scenarioPanel.error` | Error: {message} | Ошибка: {message} | Xəta: {message} |
| `scenarioPanel.financialHealth` | Financial health | Финансовое здоровье | Maliyyə sağlamlığı |
| `scenarioPanel.holdingComposite` | Holding composite | Композит холдинга | Holdinq kompoziti |
| `scenarioPanel.improved` | Improved: <strong>{count}</strong> | Улучшились: <strong>{count}</strong> | Yaxşılaşdı: <strong>{count}</strong> |
| `scenarioPanel.loading` | Loading… | Загрузка… | Yüklənir… |
| `scenarioPanel.measures` | Measures | Меры | Tədbirlər |
| `scenarioPanel.narrativeUnavailable` | AI narrative unavailable — see indicator changes below. | AI-нарратив недоступен — см. изменения индикаторов ниже. | AI mətni əlçatmazdır — aşağıdakı indikator dəyişikliklərinə baxın. |
| `scenarioPanel.new` | New | Новый | Yeni |
| `scenarioPanel.noColorChange` | No indicator changes colour under this scenario. | Ни один индикатор не меняет цвет при этом сценарии. | Bu ssenaridə heç bir indikator rəngini dəyişmir. |
| `scenarioPanel.noneAvailable` | No scenarios available | Нет доступных сценариев | Əlçatan ssenari yoxdur |
| `scenarioPanel.quickCalc` | ⚡ Quick calc | ⚡ Быстрый расчёт | ⚡ Sürətli hesablama |
| `scenarioPanel.reset` | Reset: {label} | Сбросить: {label} | Sıfırla: {label} |
| `scenarioPanel.runCrisis` | Run crisis | Запустить кризис | Böhranı işə sal |
| `scenarioPanel.scenariosCount` | Scenarios ({count}) | Сценарии ({count}) | Ssenarilər ({count}) |
| `scenarioPanel.selectLeft` | Pick a scenario on the left | Выбери сценарий слева | Soldan ssenari seç |
| `scenarioPanel.simulating` | Modelling… | Моделирование… | Modelləşdirilir… |
| `scenarioPanel.simulatingCrisis` | Modelling crisis… | Моделирование кризиса… | Böhran modelləşdirilir… |
| `scenarioPanel.sourceTitle` | Source: {asOf} | Источник: {asOf} | Mənbə: {asOf} |
| `scenarioPanel.staleSuffix` | (stale) | (устарело) | (köhnəlmiş) |
| `scenarioPanel.subtitle` | Live modelling — pick a scenario → Simulate → Apply to HeatMap | Живое моделирование — выбери сценарий → Смоделировать → Применить к HeatMap | Canlı modelləşdirmə — ssenari seç → Simulyasiya et → HeatMap-ə tətbiq et |
| `scenarioPanel.title` | Scenario Analysis (What-if) | Сценарный анализ (What-if) | Ssenari Təhlili (What-if) |
| `scenarioPanel.unchangedCount` | Unchanged: <strong>{count}</strong> | Без изменений: <strong>{count}</strong> | Dəyişməz: <strong>{count}</strong> |
| `scenarioPanel.unsupportedShock` | ⚠ This scenario has no <code>shock</code> block — run «Quick calc» (legacy multiplier). | ⚠ У этого сценария нет блока <code>shock</code> — запусти «Быстрый расчёт» (старый множитель). | ⚠ Bu ssenaridə <code>shock</code> bloku yoxdur — «Sürətli hesablama» işə sal (köhnə multiplikator). |
| `scenarioPanel.unsupportedSim` | ⚠ This scenario doesn't support simulation (no adjustments field). Update it via the seed-scenarios command. | ⚠ Этот сценарий не поддерживает симуляцию (нет поля adjustments). Обновите сценарий командой seed-scenarios. | ⚠ Bu ssenari simulyasiyanı dəstəkləmir (adjustments sahəsi yoxdur). seed-scenarios əmri ilə yeniləyin. |
| `scenarioPanel.worsened` | Worsened: <strong>{count}</strong> | Ухудшились: <strong>{count}</strong> | Pisləşdi: <strong>{count}</strong> |

### `severity` (3)

| Key | EN | RU | AZ |
|---|---|---|---|
| `severity.critical` | Critical | Критично | Kritik |
| `severity.info` | Info | Информация | Məlumat |
| `severity.warning` | Warning | Предупреждение | Xəbərdarlıq |

### `shortcuts` (27)

| Key | EN | RU | AZ |
|---|---|---|---|
| `shortcuts.closeAriaLabel` | Close shortcuts | Закрыть подсказку | Qısayolları bağla |
| `shortcuts.cmdAct` | Open Action Center (pending review queue) | Открыть очередь действий | Tədbir Mərkəzini aç |
| `shortcuts.cmdAud` | Open Audit Log overlay | Открыть журнал аудита | Audit jurnalını aç |
| `shortcuts.cmdBrf` | Open Board Deck (PDF-friendly) | Открыть Board Deck (PDF-friendly) | Board Deck-i aç (PDF-friendly) |
| `shortcuts.cmdCht` | Open Sub-Co Finance Chat (per-sub-co channels) | Открыть чат с финансами sub-co (по каналам) | Sub-co maliyyə çatını aç (kanal üzrə) |
| `shortcuts.cmdCmp` | Compare two companies side-by-side | Сравнить две компании side-by-side | İki şirkəti yan-yana müqayisə et |
| `shortcuts.cmdCmt` | Open Comments overlay (per-cell @mention threads) | Открыть слой комментариев (треды @mention на ячейках) | Şərh qatını aç (xanada @mention tredləri) |
| `shortcuts.cmdCo` | Activate company by code | Активировать компанию по коду | Kod ilə şirkəti aktivləşdir |
| `shortcuts.cmdHold` | Holding view (root of tree) | Просмотр холдинга (корень дерева) | Holdinq görünüşü (ağacın kökü) |
| `shortcuts.cmdInd` | Open indicator detail by code | Открыть детали индикатора по коду | Kod ilə göstərici detalını aç |
| `shortcuts.cmdScn` | Open scenario runner | Открыть симулятор сценариев | Ssenari simulyatorunu aç |
| `shortcuts.cmdSub` | Open AI Subscriptions (notify-me-when-X manager) | Открыть AI-подписки (уведоми когда X) | AI abunələri aç (X olduqda xəbər ver) |
| `shortcuts.commandFocus` | Focus the Command Bar | Сфокусировать командную строку | Komanda sətrini fokusla |
| `shortcuts.compact` | Toggle compact mode | Переключить компактный режим | Kompakt rejimi açıb-bağla |
| `shortcuts.escape` | Close any open modal / dropdown | Закрыть открытое модальное окно | Açıq modalı bağla |
| `shortcuts.f1` | Focus Company Tree (Panel 1) | Сфокусировать Дерево компаний (Панель 1) | Şirkət ağacını fokusla (Panel 1) |
| `shortcuts.f2` | Focus HeatMap (Panel 2) | Сфокусировать HeatMap (Панель 2) | HeatMap-ı fokusla (Panel 2) |
| `shortcuts.f3` | Focus Indicator Detail (Panel 3) | Сфокусировать детали индикатора (Панель 3) | Göstərici detallarını fokusla (Panel 3) |
| `shortcuts.f4` | Focus Company Snapshot (Panel 4) | Сфокусировать Snapshot компании (Панель 4) | Şirkət portretini fokusla (Panel 4) |
| `shortcuts.footer` | Tip: every keyboard verb in this list works without the mouse. | Совет: каждая команда в списке работает без мыши. | İpucu: hər qısayol siçansız işləyir. |
| `shortcuts.groupCommands` | Command bar | Командная строка | Komanda sətri |
| `shortcuts.groupGlobal` | Global | Глобально | Qlobal |
| `shortcuts.groupPanels` | Panels | Панели | Panellər |
| `shortcuts.help` | Open this help modal | Открыть это окно справки | Bu kömək pəncərəsini aç |
| `shortcuts.search` | Focus search input in the active panel | Сфокусировать поиск в активной панели | Aktiv paneldə axtarışı fokusla |
| `shortcuts.subtitle` | Press ? again or Esc to close. | Нажмите ? снова или Esc чтобы закрыть. | Bağlamaq üçün ? və ya Esc. |
| `shortcuts.title` | Keyboard shortcuts | Горячие клавиши | Klaviatura qısayolları |

### `signals` (9)

| Key | EN | RU | AZ |
|---|---|---|---|
| `signals.drought.detail` | Min 14d rainfall {rain} mm (< 15 mm) — drought risk | Мин. осадки 14д {rain} мм (< 15 мм) — риск засухи | Min 14g yağıntı {rain} mm (< 15 mm) — quraqlıq riski |
| `signals.drought.label` | Low rainfall forecast in agro regions | Низкий прогноз осадков в агрорегионах | Aqrar regionlarda aşağı yağıntı proqnozu |
| `signals.fxDepreciation.detail` | 12M USD/AZN forward {fwd} vs spot {spot} ({premium}) | Форвард USD/AZN 12М {fwd} vs спот {spot} ({premium}) | 12 aylıq USD/AZN forvard {fwd} vs spot {spot} ({premium}) |
| `signals.fxDepreciation.label` | Market is pricing in manat devaluation | Рынок закладывает девальвацию маната | Bazar manatın devalvasiyasını qiymətləndirir |
| `signals.newsDetail` | 📰 {source} · sentiment {score} | 📰 {source} · тон {score} | 📰 {source} · ton {score} |
| `signals.oilElevated.detail` | Brent ${brent}/bbl (> $95) — energy/fertilizer cost pressure | Brent ${brent}/баррель (> $95) — давление на энергию/удобрения | Brent ${brent}/barel (> $95) — enerji/gübrə xərc təzyiqi |
| `signals.oilElevated.label` | Brent elevated | Brent на повышенном уровне | Brent yüksək səviyyədə |
| `signals.sugarPressure.detail` | FAO sugar index {sugar} (< 90) | FAO индекс сахара {sugar} (< 90) | FAO şəkər indeksi {sugar} (< 90) |
| `signals.sugarPressure.label` | Sugar price under pressure | Цена сахара под давлением | Şəkər qiyməti təzyiq altında |

### `signalsStrip` (2)

| Key | EN | RU | AZ |
|---|---|---|---|
| `signalsStrip.staleAt` | stale {asOf} | устарело {asOf} | köhnəlmiş {asOf} |
| `signalsStrip.title` | 📡 Signals | 📡 Сигналы | 📡 Siqnallar |

### `snapshot` (14)

| Key | EN | RU | AZ |
|---|---|---|---|
| `snapshot.companyNotInMatrix` | Company not in current matrix: | Компания не в текущей матрице: | Şirkət cari matrisdə yoxdur: |
| `snapshot.compositeScore` | Composite Risk Score | Композитный балл риска | Kompozit risk balı |
| `snapshot.error` | Snapshot error | Ошибка снимка | Snapshot xətası |
| `snapshot.footerHint` | Click any HeatMap cell for the full Variance Explainer narrative. | Кликните на ячейку HeatMap для полного объяснения отклонения. | Tam izah üçün istənilən xəritə xanasına klikləyin. |
| `snapshot.forecastConfidence` | Forecast confidence | Достоверность прогноза | Proqnoz inamı |
| `snapshot.indicators` | indicators | индикаторов | göstərici |
| `snapshot.lastAudit` | Last audit | Последний аудит | Son audit |
| `snapshot.loading` | Loading snapshot… | Загрузка снимка… | Snapshot yüklənir… |
| `snapshot.noPlIndicators` | No P&L margin indicators available for | Индикаторы P&L margin недоступны для | P&L margin göstəriciləri əlçatan deyil: |
| `snapshot.noScoreableIndicators` | No scoreable indicators (rollup row) | Нет оцениваемых индикаторов (агрегатная строка) | Qiymətləndirilə bilən göstərici yoxdur (yığma sətr) |
| `snapshot.scoreLabel` | Score | Балл | Bal |
| `snapshot.title` | Snapshot | Снимок | Portret |
| `snapshot.topAlerts` | Top alerts | Топ алертов | Əsas xəbərdarlıqlar |
| `snapshot.trend12mo` | 12-month trend | Тренд 12 мес | 12 aylıq trend |

### `status` (4)

| Key | EN | RU | AZ |
|---|---|---|---|
| `status.amber` | Watch | Внимание | Diqqət |
| `status.green` | Healthy | В норме | Sağlam |
| `status.red` | Critical | Критично | Kritik |
| `status.unknown` | No data | Нет данных | Məlumat yox |

### `strategicContext` (13)

| Key | EN | RU | AZ |
|---|---|---|---|
| `strategicContext.businessModel` | Business model | Бизнес-модель | Biznes-model |
| `strategicContext.contractsExpiring` | ⚠ {count} contracts expiring within 2 years | ⚠ {count} договоров истекают в течение 2 лет | ⚠ {count} müqavilə 2 il ərzində bitir |
| `strategicContext.kriEntered` | KRI entered | KRI занесены | KRI daxil edilib |
| `strategicContext.landRegistry` | 🌾 Land registry | 🌾 Земельный реестр | 🌾 Torpaq reyestri |
| `strategicContext.leased` | leased | арендованы | icarəyə götürülüb |
| `strategicContext.loadError` | Load error: {error} | Ошибка загрузки: {error} | Yükləmə xətası: {error} |
| `strategicContext.loading` | Loading strategic context… | Загружаю стратегический контекст… | Strateji kontekst yüklənir… |
| `strategicContext.parcels` | parcels | участков | sahə |
| `strategicContext.perYear` | /yr | /год | /il |
| `strategicContext.regionsLabel` | Regions: | Регионы: | Regionlar: |
| `strategicContext.riskPending` | ⚠️ Pending client verification — the KRI registry hasn't been provided by the company's finance team yet. Risk indicators will show «unknown» until the xlsx is uploaded. | ⚠️ Pending client verification — реестр KRI ещё не передан финансовой командой компании. Покажет «unknown» по риск-индикаторам, пока xlsx не загружен. | ⚠️ Müştəri təsdiqi gözlənilir — KRI reyestri hələ şirkətin maliyyə komandası tərəfindən təqdim edilməyib. xlsx yüklənənə qədər risk indikatorları «unknown» göstərəcək. |
| `strategicContext.sourceLabel` | source: {source} | источник: {source} | mənbə: {source} |
| `strategicContext.title` | 📋 Strategic context | 📋 Стратегический контекст | 📋 Strateji kontekst |

### `subcoChat` (17)

| Key | EN | RU | AZ |
|---|---|---|---|
| `subcoChat.channelListAriaLabel` | Channel list | Список каналов | Kanal siyahısı |
| `subcoChat.channels` | Channels | Каналы | Kanallar |
| `subcoChat.closeAriaLabel` | Close chat | Закрыть чат | Çatı bağla |
| `subcoChat.dialogAriaLabel` | Sub-co finance chat | Чат с финансами sub-co | Sub-co maliyyə çatı |
| `subcoChat.draftAriaLabel` | Chat draft | Черновик чата | Çat qaralaması |
| `subcoChat.draftPlaceholder` | Message {channel}… | Сообщение для {channel}… | {channel} üçün mesaj… |
| `subcoChat.emptyThread` | No messages yet — say hello. | Сообщений пока нет — скажите привет. | Hələ mesaj yoxdur — salam deyin. |
| `subcoChat.from` | You | Вы | Siz |
| `subcoChat.loading` | Loading channels… | Загрузка каналов… | Kanallar yüklənir… |
| `subcoChat.localOnlyBanner` | v1: messages are stored locally (localStorage). The sub-co finance manager will NOT see them and no notifications fire. Use phone/email/Slack until v2 (backend + push) ships. | v1: сообщения хранятся локально (localStorage). Финансовый менеджер sub-co их НЕ увидит и уведомление не получит. Используйте телефон/email/Slack пока v2 (backend + push) не выйдет. | v1: mesajlar lokal saxlanılır (localStorage). Sub-co maliyyə meneceri onları GÖRMƏYƏCƏK və bildiriş ALMAYACAQ. v2 (backend + push) çıxana qədər telefon/email/Slack istifadə edin. |
| `subcoChat.noChannels` | No companies yet — import via /budgeting/onboarding to enable channels. | Компаний пока нет — импортируйте через /budgeting/onboarding. | Şirkət yoxdur — /budgeting/onboarding ilə idxal et. |
| `subcoChat.pickChannel` | Pick a channel from the left to start a conversation. | Выберите канал слева чтобы начать разговор. | Söhbətə başlamaq üçün soldan kanal seçin. |
| `subcoChat.send` | Send | Отправить | Göndər |
| `subcoChat.sendAriaLabel` | Send message | Отправить сообщение | Mesaj göndər |
| `subcoChat.subtitle` | Direct channels to each sub-co's finance manager. Press Esc to close. | Прямые каналы с финансовым менеджером каждой sub-co. Esc для закрытия. | Hər sub-co maliyyə menecerinə birbaşa kanal. Bağlamaq üçün Esc. |
| `subcoChat.threadAriaLabel` | Thread messages | Сообщения треда | Tred mesajları |
| `subcoChat.title` | Sub-Co Finance Chat | Чат с финансами sub-co | Sub-co Maliyyə Çatı |

### `subscriptions` (29)

| Key | EN | RU | AZ |
|---|---|---|---|
| `subscriptions.closeAriaLabel` | Close subscriptions | Закрыть подписки | Abunələri bağla |
| `subscriptions.comparatorAriaLabel` | Comparator | Оператор сравнения | Müqayisə operatoru |
| `subscriptions.createSubmit` | Create | Создать | Yarat |
| `subscriptions.createTitle` | Create subscription | Создать подписку | Abunə yarat |
| `subscriptions.deleteAriaLabel` | Delete {label} | Удалить {label} | {label} sil |
| `subscriptions.deleteTitle` | Delete subscription | Удалить подписку | Abunəni sil |
| `subscriptions.dialogAriaLabel` | AI subscriptions manager | Менеджер AI-подписок | AI abunə meneceri |
| `subscriptions.empty` | No subscriptions yet — create one above. | Подписок пока нет — создайте выше. | Abunə yoxdur — yuxarıda yaradın. |
| `subscriptions.labelAriaLabel` | Subscription label | Имя подписки | Abunə adı |
| `subscriptions.labelPlaceholder` | What should this be called? e.g. "AAC composite drop" | Как назвать? Например «AAC composite drop» | Necə adlandıraq? Məs. «AAC composite drop» |
| `subscriptions.lastFiredLabel` | fired | сработала | işə düşüb |
| `subscriptions.lastFiredTitle` | Last time this subscription matched a HeatMap cell | Когда подписка в последний раз совпала с ячейкой | Abunənin son dəfə nə vaxt xanaya uyğun gəldiyi |
| `subscriptions.listAriaLabel` | Subscription list | Список подписок | Abunə siyahısı |
| `subscriptions.listTitle` | Subscriptions | Подписки | Abunələr |
| `subscriptions.pauseAriaLabel` | Pause {label} | Пауза для {label} | {label} dayandır |
| `subscriptions.pauseTitle` | Pause this subscription | Поставить подписку на паузу | Abunəni dayandır |
| `subscriptions.resumeAriaLabel` | Resume {label} | Возобновить {label} | {label} davam etdir |
| `subscriptions.resumeTitle` | Resume this subscription | Возобновить подписку | Abunəni davam etdir |
| `subscriptions.scopeAny` | Any company | Любая компания | İstənilən şirkət |
| `subscriptions.scopeAriaLabel` | Subscription scope | Область подписки | Abunə əhatəsi |
| `subscriptions.scopeCompany` | Specific company | Конкретная компания | Konkret şirkət |
| `subscriptions.scopeIndicator` | Specific indicator | Конкретный индикатор | Konkret göstərici |
| `subscriptions.scopeValueAriaLabel` | Scope value | Значение области | Əhatə dəyəri |
| `subscriptions.scopeValueCompanyPlaceholder` | Company code (e.g. AAC-MAIN) | Код компании (например AAC-MAIN) | Şirkət kodu (məs. AAC-MAIN) |
| `subscriptions.scopeValueDisabledPlaceholder` | (scope: any) | (область: любая) | (əhatə: istənilən) |
| `subscriptions.scopeValueIndicatorPlaceholder` | Indicator code (e.g. IND_NET_MARGIN) | Код индикатора (например IND_NET_MARGIN) | Göstərici kodu (məs. IND_NET_MARGIN) |
| `subscriptions.subtitle` | Notify-me-when-X conditions on the live matrix. Press Esc to close. | Условия «уведоми когда X» по живой матрице. Esc для закрытия. | Canlı matrisin üzərində «X olduqda xəbər ver» şərtləri. Bağlamaq üçün Esc. |
| `subscriptions.thresholdAriaLabel` | Threshold (0-100) | Порог (0–100) | Hədd (0–100) |
| `subscriptions.title` | AI Subscriptions ({active} active · {paused} paused) | AI-подписки ({active} активных · {paused} на паузе) | AI Abunələr ({active} aktiv · {paused} dayandırılmış) |

### `timeMachine` (8)

| Key | EN | RU | AZ |
|---|---|---|---|
| `timeMachine.annual` | All of {year} | Весь {year} | Bütün {year} |
| `timeMachine.ariaLabel` | Time machine — scrub through months | Машина времени — прокрутка по месяцам | Zaman maşını — aylar üzrə sürüşdür |
| `timeMachine.pause` | Pause | Пауза | Dayandır |
| `timeMachine.play` | Play (M1 → M12) | Воспроизвести (M1 → M12) | Oynat (M1 → M12) |
| `timeMachine.reset` | Reset (full year) | Сбросить (весь год) | Sıfırla (tam il) |
| `timeMachine.sliderLabel` | Month | Месяц | Ay |
| `timeMachine.stepBack` | Step back one month | На месяц назад | Bir ay geri |
| `timeMachine.stepForward` | Step forward one month | На месяц вперёд | Bir ay irəli |

### `todayBrief` (15)

| Key | EN | RU | AZ |
|---|---|---|---|
| `todayBrief.alertsTitle` | Active alerts | Активные алёрты | Aktiv xəbərdarlıqlar |
| `todayBrief.empty` | (no data) | (нет данных) | (məlumat yox) |
| `todayBrief.footerHint` | Click any row → drill-down. Click a HeatMap cell to swap this view. | Клик по строке → drill-down. Клик по ячейке HeatMap заменит этот вид. | Sətirə klik → ətraflı. HeatMap hüceyrəsinə klik bu görünüşü əvəz edəcək. |
| `todayBrief.moversTitle` | Top 5 movers by sector (12-mo) | Топ-5 движений по секторам (12 мес.) | Sektor üzrə Top 5 dəyişən (12 ay) |
| `todayBrief.newsCached` | from cache | из кэша | keş |
| `todayBrief.newsEmpty` | No fresh news — run the AI Crawler from admin. | Свежих новостей нет — запустите AI-крауллер через админку. | Təzə xəbər yoxdur — admin panelindən AI Crawler işə salın. |
| `todayBrief.newsFresh` | fresh response | свежий ответ | təzə cavab |
| `todayBrief.newsHeader` | Holding news | Новости холдинга | Holdinq xəbərləri |
| `todayBrief.newsItems` | sources | источников | mənbə |
| `todayBrief.newsLoading` | AI preparing summary… | AI готовит сводку… | AI icmal hazırlayır… |
| `todayBrief.newsPopOut` | Open news in a separate window | Открыть новости в отдельном окне | Xəbərləri ayrı pəncərədə aç |
| `todayBrief.newsRefresh` | Refresh summary | Обновить сводку | İcmalı yenilə |
| `todayBrief.subtitle` | What needs your attention right now | Что требует вашего внимания прямо сейчас | İndi diqqətinizi tələb edən |
| `todayBrief.title` | Today's Brief | Сводка дня | Bu günkü icmal |
| `todayBrief.worstTitle` | Top worst (by sector) | Топ худших (по секторам) | Ən pis (sektor üzrə) |

### `varianceExplainer` (25)

| Key | EN | RU | AZ |
|---|---|---|---|
| `varianceExplainer.askingModel` | Asking the model… | Запрос к модели… | Modela sorğu… |
| `varianceExplainer.clickInfix` | in Panel 3 (or hit | в Панели 3 (или нажмите | Panel 3-də (yaxud aşağıdakı |
| `varianceExplainer.clickPrefix` | Click | Кликните | Klikləyin |
| `varianceExplainer.clickSuffix` | below) to fetch the AI narrative for this cell. | ниже) чтобы получить AI-объяснение для этой ячейки. | düyməsinə basın) bu xana üçün AI izahını gətirmək üçün. |
| `varianceExplainer.confidenceTitle` | LLM self-rated confidence (0-100%) | Самооценка уверенности LLM (0-100%) | LLM özünüqiymətləndirmə inamı (0-100%) |
| `varianceExplainer.error` | Error | Ошибка | Xəta |
| `varianceExplainer.explainArrow` | Explain → | Объяснить → | İzah et → |
| `varianceExplainer.factCheck.allMatched` | All {total} cited values matched the snapshot. | Все {total} упомянутых чисел совпали со снимком. | Bütün {total} sitat gətirilən rəqəm şəkilcə ilə uyğundur. |
| `varianceExplainer.factCheck.summary` | {matched} of {total} cited values matched the indicator snapshot. | {matched} из {total} упомянутых чисел совпали со снимком индикатора. | {matched} / {total} sitat gətirilən rəqəm göstərici şəkilcəsi ilə uyğundur. |
| `varianceExplainer.factCheck.title` | Fact-check | Проверка фактов | Fakt yoxlanışı |
| `varianceExplainer.fullHint` | AI Variance Explainer — narrates what's driving the indicator + 3 actionable recommendations. LLM calls are user-triggered (Explain / Re-run) — never auto-fired on cell-click navigation. | AI Variance Explainer — объясняет что движет индикатором + 3 actionable рекомендации. LLM-вызовы запускаются пользователем (Explain / Re-run) — никогда не срабатывают автоматически при клике на ячейку. | AI Dəyişiklik İzahçısı — göstəricinin nə ilə hərəkət etdiyini + 3 əməli tövsiyə bildirir. LLM çağırışları istifadəçi tərəfindən tetiklənir (Explain / Re-run) — xanaya klikdə avtomatik baş vermir. |
| `varianceExplainer.greenNoVariance.body` | This cell is in the green band — no variance from target. Explanations are available for amber, red, and unknown cells. | Ячейка в зелёной зоне — отклонений от цели нет. Объяснение доступно для жёлтых, красных и неизвестных ячеек. | Bu xana yaşıl zonadadır — hədəfdən sapma yoxdur. İzahlar yalnız sarı, qırmızı və naməlum xanalar üçün mümkündür. |
| `varianceExplainer.greenNoVariance.title` | Nothing to explain | Нечего объяснять | İzah ediləcək bir şey yoxdur |
| `varianceExplainer.narrative` | Narrative | Объяснение | İzah |
| `varianceExplainer.pickCellPrefix` | Pick a HeatMap cell, then click | Выберите ячейку HeatMap, затем кликните | Xəritədən xana seçin, sonra klikləyin |
| `varianceExplainer.reRun` | Re-run | Перезапуск | Yenidən |
| `varianceExplainer.reRunTitle` | Force a fresh LLM call (bypasses cache) | Форсировать свежий LLM-вызов (минуя кэш) | Yeni LLM çağırışını məcburi et (kəşi keçir) |
| `varianceExplainer.recommendations` | Recommendations | Рекомендации | Tövsiyələr |
| `varianceExplainer.runFor` | Run for | Запустить для | İşə sal |
| `varianceExplainer.shortHint` | AI Variance Explainer — narrates what's driving an indicator + 3 actionable recommendations. Click any HeatMap cell, then | AI Variance Explainer — объясняет что движет индикатором + 3 actionable рекомендации. Кликните на ячейку HeatMap, затем | AI Dəyişiklik İzahçısı — göstəricinin nə ilə hərəkət etdiyini + 3 əməli tövsiyə bildirir. Xəritə xanasına klikləyin, sonra |
| `varianceExplainer.title` | Variance Explainer | Анализ отклонений | Dəyişiklik İzahçısı |
| `varianceExplainer.tokens` | tokens | токены | tokenlər |
| `varianceExplainer.tokensIn` | in | вход | giriş |
| `varianceExplainer.tokensOut` | out | выход | çıxış |
| `varianceExplainer.topDrivers` | Top drivers | Топ драйверы | Əsas sürücülər |

### `verbs` (10)

| Key | EN | RU | AZ |
|---|---|---|---|
| `verbs.ALT` | Alerts panel | Панель алертов | Xəbərdarlıqlar paneli |
| `verbs.AUD` | Audit log modal | Модальное окно аудита | Audit modal pəncərəsi |
| `verbs.BRF` | Board deck (printable) | Совет директоров (печать) | Direktorlar şurası (çap) |
| `verbs.CMP` | Compare two companies | Сравнить две компании | İki şirkəti müqayisə et |
| `verbs.CO` | Single company drill-in | Одна компания | Bir şirkət |
| `verbs.GRP` | Sub-group focus | Фокус на суб-группу | Alt-qrup fokusu |
| `verbs.HOLD` | Holding view (entire portfolio) | Холдинг (весь портфель) | Holdinq baxışı (bütün portfel) |
| `verbs.IND` | Indicator detail (Panel 3) | Детализация индикатора (Панель 3) | Göstərici detalı (Panel 3) |
| `verbs.SCN` | Scenario stress-test | Сценарный стресс-тест | Ssenari stress-testi |
| `verbs.SEC` | Sector view | Вид по сектору | Sektor görünüşü |

### `welcome` (8)

| Key | EN | RU | AZ |
|---|---|---|---|
| `welcome.autoFade` | auto-fades in 12s | авто-закрытие через 12с | 12s sonra avto-bağlanır |
| `welcome.dismiss` | Got it | Понятно | Aydındır |
| `welcome.dismissAriaLabel` | Dismiss welcome hint | Закрыть приветствие | Salamlamanı bağla |
| `welcome.step1` | Panel 1 — Company tree. Click any company to drill down. | Панель 1 — дерево компаний. Кликните на компанию для drill-down. | Panel 1 — şirkət ağacı. Detal üçün istənilən şirkətə klikləyin. |
| `welcome.step2` | Panel 2 — HeatMap. Hover red/amber cells for AI summary; click for full detail. | Панель 2 — HeatMap. Наведите на red/amber ячейку для AI-сводки; клик — полная детализация. | Panel 2 — HeatMap. Qırmızı/sarı xanaya hover edin AI xülasəsi üçün; klik tam detal verir. |
| `welcome.step3` | Panel 3 — Indicator detail with sparkline + AI forecast. | Панель 3 — детали индикатора со sparkline и AI-прогнозом. | Panel 3 — sparkline + AI proqnozu ilə göstərici detalları. |
| `welcome.step4` | Panel 4 — Composite score, alerts, and margin trio for the active company. | Панель 4 — composite score, алерты и трио маржи для активной компании. | Panel 4 — aktiv şirkət üçün kompozit bal, xəbərdarlıqlar, marja trio. |
| `welcome.title` | Welcome to Risk Terminal | Добро пожаловать в Risk Terminal | Risk Terminala xoş gəlmisiniz |

### `whatif` (53)

| Key | EN | RU | AZ |
|---|---|---|---|
| `whatif.closeAriaLabel` | Close What-If | Закрыть What-If | Nə-əgər bağla |
| `whatif.colBaseline` | Baseline | Базовое | Baza |
| `whatif.colDelta` | Δ% | Δ% | Δ% |
| `whatif.colIndicator` | Indicator | Индикатор | İndikator |
| `whatif.colScenario` | Scenario | Сценарий | Ssenari |
| `whatif.dialogAriaLabel` | What-If preview | What-If превью | Nə-əgər önbax |
| `whatif.footerNote` | Preview is not persisted. Save an override set via Scenario → Save (v2). | Превью не пишется в БД. Чтобы сохранить набор overrides — используйте «Сценарий → Сохранить» (v2). | Önbax bazaya yazılmır. Override-ları saxlamaq üçün Ssenari → Saxla (v2) istifadə edin. |
| `whatif.fxOverridesHeader` | Currency rates (override) | Курсы валют (override) | Valyuta kursları (override) |
| `whatif.groups.agro` | Agricultural | Агро | Aqrar |
| `whatif.groups.commodity` | Commodities | Сырьё | Əmtəələr |
| `whatif.groups.fx` | FX Rates | Курсы валют | Valyuta məzənnələri |
| `whatif.groups.macro` | Macro | Макро | Makro |
| `whatif.idleHint` | Adjust variables above → click Run preview | Измените переменные выше → нажмите «Запустить превью» | Yuxarıda dəyişənləri tənzimləyin → «Önbaxı işə sal» düyməsinə basın |
| `whatif.noAffected` | No affected indicators in current scope. | Нет затронутых индикаторов в текущей области видимости. | Cari görmə əhatəsində təsirlənmiş indikator yoxdur. |
| `whatif.noChanges` | Adjust at least one variable, then run preview | Измените хотя бы одну переменную, затем запустите превью | Ən azı bir dəyişəni tənzimləyin, sonra önbaxı işə salın |
| `whatif.periodLabel` | Period | Период | Dövr |
| `whatif.presetDescs.aznPeg` | 2015 devaluation replay: AZN −15%, inflation +6pp, gas costs rise | Повтор девальвации 2015: манат −15%, инфляция +6пп, рост цен на газ | 2015 devalvasiyasının təkrarı: AZN −15%, inflyasiya +6pp, qaz xərcləri artır |
| `whatif.presetDescs.drought` | Catastrophic drought: rainfall −86%, heat +13°C — EDEN agro yield shock | Катастрофическая засуха: осадки −86%, жара +13°C — шок урожайности EDEN | Fəlakətli quraqlıq: yağıntı −86%, istilik +13°C — EDEN məhsuldarlıq şoku |
| `whatif.presetDescs.fullShock` | Oil crash + AZN devaluation + grain crisis + drought — tail risk stress test | Обвал нефти + девальвация маната + зерновой кризис + засуха — стресс-тест хвостового риска | Neft çöküşü + manat devalvasiyası + taxıl böhranı + quraqlıq — quyruq riski stress-testi |
| `whatif.presetDescs.grain` | 2022 Ukraine war replay: wheat +81%, corn +45%, gas ×2 — import food shock | Повтор войны 2022 в Украине: пшеница +81%, кукуруза +45%, газ ×2 — импортный продшок | 2022 Ukrayna müharibəsinin təkrarı: buğda +81%, qarğıdalı +45%, qaz ×2 — idxal ərzaq şoku |
| `whatif.presetDescs.opec` | Brent $40 — below AZ fiscal break-even; partial AZN weakening −10% | Brent $40 — ниже бюджетной безубыточности AZ; частичное ослабление маната −10% | Brent $40 — AZ büdcə nöqtəsindən aşağı; manatın qismən zəifləməsi −10% |
| `whatif.presetDescs.tryCrash` | TRY −44% (2021 replay) — Turkish import flood + tourism revenue hit | TRY −44% (повтор 2021) — наплыв турецкого импорта + удар по доходам туризма | TRY −44% (2021 təkrarı) — türk idxalı axını + turizm gəlirinə zərbə |
| `whatif.presets.aznPeg` | AZN Peg Break | Слом привязки маната | Manatın bağlanmasının qırılması |
| `whatif.presets.drought` | Kura-Araz Drought | Засуха Кура-Араз | Kür-Araz quraqlığı |
| `whatif.presets.fullShock` | Full External Shock | Полный внешний шок | Tam xarici şok |
| `whatif.presets.grain` | Black Sea Grain Crisis | Зерновой кризис Чёрного моря | Qara dəniz taxıl böhranı |
| `whatif.presets.opec` | OPEC+ Breakdown | Развал ОПЕК+ | OPEC+ dağılması |
| `whatif.presets.tryCrash` | Turkish Lira Crash | Обвал турецкой лиры | Türk lirəsinin çöküşü |
| `whatif.presetsHeader` | Quick Scenarios | Быстрые сценарии | Sürətli ssenarilər |
| `whatif.previewLoading` | Computing | Считаем | Hesablanır |
| `whatif.previewRun` | Run preview | Запустить превью | Önbaxı işə sal |
| `whatif.resetToBase` | Reset to baseline | Сбросить к базовым | Baza dəyərlərə qaytar |
| `whatif.subtitle` | Stress-test FX, commodities, and macro variables → recompute affected indicators. Esc to close. | Тест-сценарии для FX, сырья и макро → пересчёт затронутых индикаторов без записи в БД. Esc для закрытия. | FX, əmtəə qiymətləri və makro dəyişənləri test edin → təsirlənən indikatorlar bazaya yazılmadan yenidən hesablanır. Bağlamaq üçün Esc. |
| `whatif.summaryBreaches` | will breach | нарушат порог | hədd aşacaq |
| `whatif.summaryImproved` | improved | улучшатся | yaxşılaşacaq |
| `whatif.summaryLine` | Affected {affected} indicators · {cells} cells across {companies} companies | Затронуто {affected} индикаторов · {cells} ячеек по {companies} компаниям | Təsirlənmiş {affected} indikator · {cells} xana, {companies} şirkət üzrə |
| `whatif.summaryStable` | stable | стабильных | sabit |
| `whatif.title` | What-If preview | What-If превью | Nə-əgər önbax |
| `whatif.vars.az_cpi_all_latest` | AZ CPI (all items) | ИПЦ Азербайджан (всё) | AZ İQİ (bütün mallar) |
| `whatif.vars.az_cpi_food_latest` | AZ Food CPI | ИПЦ продовольствие | AZ ərzaq İQİ |
| `whatif.vars.az_cpi_housing_latest` | AZ Housing CPI | ИПЦ жильё | AZ mənzil İQİ |
| `whatif.vars.brent_price_latest` | Brent Crude | Нефть Brent | Brent nefti |
| `whatif.vars.corn_price_latest` | Corn / Maize | Кукуруза | Qarğıdalı |
| `whatif.vars.cotton_price_latest` | Cotton (ICE #2) | Хлопок (ICE #2) | Pambıq (ICE #2) |
| `whatif.vars.fx_eur` | AZN per 1 EUR | AZN за 1 EUR | 1 EUR üçün AZN |
| `whatif.vars.fx_rub` | AZN per 1 RUB | AZN за 1 RUB | 1 RUB üçün AZN |
| `whatif.vars.fx_try` | AZN per 1 TRY | AZN за 1 TRY | 1 TRY üçün AZN |
| `whatif.vars.fx_usd` | AZN per 1 USD | AZN за 1 USD | 1 USD üçün AZN |
| `whatif.vars.natgas_price_latest` | Natural Gas | Природный газ | Təbii qaz |
| `whatif.vars.rainfall_mm_90d` | Rainfall (90-day) | Осадки (90 дн) | Yağıntı (90 gün) |
| `whatif.vars.sugar_price_latest` | Sugar (ICE #11) | Сахар (ICE #11) | Şəkər (ICE #11) |
| `whatif.vars.temp_avg_c_30d` | Avg Temperature | Средняя температура | Orta temperatur |
| `whatif.vars.wheat_price_latest` | Wheat (CBOT) | Пшеница (CBOT) | Buğda (CBOT) |

## Section B — Indicator hint templates (44 live)

| Code | EN | RU | AZ |
|---|---|---|---|
| `AGRO_BUYER_CONCENTRATION` | Top-buyer share {value}% — {status}. >70% means a single mill's 30-day delay creates immediate cash crisis. Diversify or hedge with payment-term contracts. | Доля топ-покупателя {value}% — {status}. >70% — задержка одним заводом на 30 дней = кассовый разрыв. Диверсифицировать или хеджировать условиями оплаты. | Əsas alıcının payı {value}% — {status}. >70%: bir zavodun 30 günlük gecikməsi = pul böhranı. Diversifikasiya və ya ödəniş şərtləri ilə hedcinq. |
| `AGRO_COMMODITY_VOL` | Trailing-12M sugar price volatility is {value}% (CV). Above 25% — consider forward contracts to lock refining margins. | Скользящая 12-месячная волатильность цены сахара {value}% (CV). Выше 25% — рассмотрите форвардные контракты для фиксации маржи переработки. | Sürüşkən 12-aylıq şəkər qiyməti volatilliyi {value}% (CV). 25%-dən yuxarı — emal marjasını bağlamaq üçün forvard müqavilələrini nəzərdən keçirin. |
| `AGRO_COST_PER_HA` | Input cost {value} AZN/ha — {status}. Above 3 500 AZN/ha per quarter means direct production costs are outpacing revenue; audit seed, labour, and irrigation spend. | Себестоимость {value} AZN/га — {status}. Выше 3 500 AZN/га в квартал — прямые затраты опережают выручку; проверьте семена, труд и орошение. | Dəyər {value} AZN/ha — {status}. Rübdə 3 500 AZN/ha-dan yuxarı — birbaşa xərclər gəliri üstəlir; toxum, əmək, suvarma xərclərini yoxlayın. |
| `AGRO_CUT_TO_MILL` | Cut-to-mill {value}h — {status}. Sucrose drops ~2% per 12h post-cut; >48h means visible Brix loss at mill assay. | Срез → завод {value} ч — {status}. Сахароза падает ~2% за 12 ч; >48 ч — заметная потеря Brix при приёмке. | Kəsim → zavod {value} saat — {status}. Saxaroza hər 12 saatda ~2% azalır; >48 saat — zavod analizində Brix itkisi. |
| `AGRO_DROUGHT_RISK` | Drought index at {value}/100 — above 60 is the historical threshold for >20% yield loss in the region. | Индекс засухи {value}/100 — выше 60 — исторический порог для >20% потери урожая в регионе. | Quraqlıq indeksi {value}/100 — 60-dan yuxarı bölgə üçün >20% məhsul itkisinin tarixi həddi. |
| `AGRO_FERTILIZER_INTENSITY` | Fertilizer {value} kg/ha — {status}. High values without yield gain → N-leaching risk + cost drag. | Удобрений {value} кг/га — {status}. Высокий расход без роста урожая — риск вымывания азота + лишние затраты. | Gübrə {value} kq/ha — {status}. Məhsuldarlıq artmadan yüksək — azot yuyulması riski + əlavə xərc. |
| `AGRO_HARVEST_PROGRESS` | Harvest completion {value}% — {status}. <70% near season end means standing crop will degrade (Brix drops past peak); investigate labor/weather/equipment. | Выполнение уборки {value}% — {status}. <70% к концу сезона — несобранный тростник теряет Brix; проверить трудовые ресурсы / погоду / технику. | Yığım icrası {value}% — {status}. Sezon sonu <70% — yığılmayan qamış Brix-i itirir; işçi qüvvəsi / hava / texnika yoxlayın. |
| `AGRO_REVENUE_PER_HA` | Revenue {value} AZN/ha — {status}. Below 1 500 AZN/ha per quarter usually signals under-planted area or weak farmgate pricing. | Выручка {value} AZN/га — {status}. Ниже 1 500 AZN/га в квартал: либо незасеянная площадь, либо слабая закупочная цена. | Gəlir {value} AZN/ha — {status}. Rübdə 1 500 AZN/ha-dan aşağı: əkilməmiş sahə və ya zəif əkin qiyməti. |
| `AGRO_SUGAR_CONTENT` | Sucrose content {value}% — {status}. Below 10% usually means late harvest, drought stress, or variety drift. | Содержание сахарозы {value}% — {status}. Ниже 10% обычно — поздняя уборка, засушливый стресс или дрейф сорта. | Saxaroza miqdarı {value}% — {status}. 10%-dən aşağı: gec biçim, quraqlıq stresi və ya sort dreyfi. |
| `AGRO_SUGAR_PRICE_TREND` | Sugar price {value}% vs 12M mean — {status}. Below −10% suggests forward-contract a slice of next-quarter output. | Цена сахара {value}% от 12-мес среднего — {status}. Ниже −10% — стоит застраховать часть выпуска следующего квартала. | Şəkər qiyməti 12 aylıq ortalamadan {value}% — {status}. −10%-dən aşağı: növbəti rübün bir hissəsini forvard etmək. |
| `AGRO_WATER_INTENSITY` | Water use {value} m³/ha — {status}. Above 18,000 signals irrigation inefficiency (canal losses, poor scheduling). | Расход воды {value} м³/га — {status}. Выше 18 000 — неэффективная ирригация (потери в каналах, плохое расписание). | Su istifadəsi {value} m³/ha — {status}. 18 000-dən yuxarı: səmərəsiz suvarma (kanal itkiləri, zəif planlaşdırma). |
| `AGRO_WEATHER_RAINFALL` | Trailing 90-day rainfall {value} mm — {status}. Below 30 mm in growing season indicates drought stress on cane. | Осадки за 90 дней {value} мм — {status}. Меньше 30 мм в вегетацию — засушливый стресс на тростнике. | Son 90 günün yağıntısı {value} mm — {status}. Vegetasiyada 30 mm-dən aşağı qamış üçün quraqlıq stresidir. |
| `AGRO_YIELD` | Yield is {value} t/ha. Below 2.5 usually signals irrigation, seed-quality, or pest issues — investigate. | Урожайность {value} т/га. Ниже 2.5 — обычно сигнал ирригации, качества семян или вредителей; разбираться. | Məhsuldarlıq {value} t/ha. 2.5-dən aşağı — adətən suvarma, toxum keyfiyyəti və ya zərərvericilər siqnalı; araşdırın. |
| `AGRO_YIELD_EFFICIENCY` | Gross profit {value} AZN/ha — {status}. Below 500 AZN/ha per quarter the land generates insufficient margin to cover overhead and capital costs. | Валовая прибыль {value} AZN/га — {status}. Ниже 500 AZN/га в квартал — земля не покрывает накладные и капитальные расходы. | Ümumi mənfəət {value} AZN/ha — {status}. Rübdə 500 AZN/ha-dan aşağı — ərazi yük və kapital xərclərini ödəmək üçün kifayət qədər marja yaratmır. |
| `AGRO_YIELD_PER_HA` | Yield {value} t/ha — {status}. Sugarcane: target 60+ t/ha; below 40 signals irrigation or variety drift. | Урожайность {value} т/га — {status}. Тростник: цель 60+; ниже 40 — ирригация или сорт. | Məhsuldarlıq {value} t/ha — {status}. Qamış: hədəf 60+; 40-dan aşağı — suvarma və ya sort. |
| `AUDIT_CLOSED_PCT` | PBC audit findings closed: {value}%. ≥80% = on-track remediation; 60-79% = lagging; <60% = systemic non-compliance with audit actions. | Закрыто аудиторских замечаний: {value}%. ≥80% — своевременное устранение; 60-79% — отставание; <60% — системная неустранимость замечаний. | Audit tapıntılarından bağlananlar: {value}%. ≥80% — vaxtında aradan qaldırma; 60-79% — gecikmə; <60% — sistemli uyumsuzluq. |
| `AUDIT_MAJOR_OPEN` | Open major audit findings: {value}. 0-1 = controlled; 2-5 = elevated control risk; >5 = systemic weakness requiring board escalation. | Открытых серьёзных замечаний: {value}. 0-1 — под контролем; 2-5 — повышенный риск; >5 — системные недостатки, требуют эскалации. | Açıq əsas audit tapıntıları: {value}. 0-1 — nəzarət altında; 2-5 — yüksəlmiş risk; >5 — sistemli zəiflik, idarə heyətinə çatdırılmalı. |
| `CUSTOMER_HHI` | Customer HHI is {value}. Above 0.25 = one buyer holds enough share to threaten cash flow on a single delayed payment. | HHI клиентов = {value}. Выше 0.25 — один покупатель держит достаточно доли, чтобы поставить под угрозу cash flow при единственной задержке платежа. | Müştəri HHI = {value}. 0.25-dən yuxarı — bir alıcının payı bir gecikmiş ödənişlə pul axınını təhdid etmək üçün kifayət edir. |
| `FP_EXTRACTION_RATE` | Extraction rate {value}% — {status}. Below 75% signals juice loss in mills, bagasse moisture too high, or evaporator scale. | Выход {value}% — {status}. Меньше 75% — потери сока на мельницах, влажность жома, накипь в выпарных. | Çıxım {value}% — {status}. 75%-dən aşağı: dəyirmanda şirə itkisi, baqas nəmlik, evaporatorda təbəqə. |
| `FP_GROSS_MARGIN` | Gross margin {value}%. Branded 30-40%, private-label 20-28%, commodity 10-18%. Below 12% means no pricing power. | Валовая маржа {value}%. Брендированный 30–40%, private-label 20–28%, commodity 10–18%. Ниже 12% — нет pricing power, продукт коммодити. | Ümumi mənfəət {value}%. Brendli 30–40%, private-label 20–28%, əmtəə 10–18%. 12%-dən aşağı — qiymətləmə gücü yoxdur, məhsul əmtəədir. |
| `FP_INVENTORY_TURNS` | Inventory turns = {value}/year. Perishable food targets 12-24; below 8 = spoilage risk. | Оборот инвентаря {value}/год. Скоропортящаяся еда target 12–24; ниже 8 = риск порчи. | Anbar dövriyyəsi {value}/il. Tezxarabolan qida hədəfi 12–24; 8-dən aşağı = xarablanma riski. |
| `FP_OPEX_RATIO` | OpEx {value}% of revenue. Food processing runs 12-22%; above 28% is structurally heavy for the margin profile. | OpEx {value}% от выручки. Food processing 12–22%; выше 28% — структурно тяжело для маржи (логистика + стоимость холода). | OpEx gəlirin {value}%-dir. Qida emalı 12–22%; 28%-dən yuxarı — marja üçün strukturca ağır (logistika + soyuq saxlama). |
| `FP_YIELD_LOSS` | Yield loss {value}%. Best-in-class 2-6%; above 10% means raw-material waste — inspect cutting, cooking, packaging lines. | Потеря выхода {value}%. Best-in-class 2–6%; выше 10% — отходы сырья; проверьте резку, варку, упаковку. | Çıxış itkisi {value}%. Best-in-class 2–6%; 10%-dən yuxarı — xammal tullantısı; kəsmə, bişirmə, qablaşdırma yoxlayın. |
| `FX_IMPORTED_INPUT` | {value}% of input costs are imported. AZN weakness hits gross margin directly. | {value}% затрат на сырьё — импорт. Ослабление AZN бьёт по валовой марже напрямую. | Giriş xərclərinin {value}%-i idxaldır. AZN-in zəifləməsi ümumi mənfəətə birbaşa təsir edir. |
| `IND_CARBON_SCOPE_1` | Direct emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: revenue × sector intensity factor. | Прямые выбросы (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: выручка × коэффициент интенсивности. | Birbaşa emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: gəlir × sənaye intensivlik əmsalı. |
| `IND_CARBON_SCOPE_2` | Purchased electricity emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 2 intensity. | Выбросы покупной энергии (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 2 по отрасли. | Alınan elektrikdən emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 2 intensivliyi. |
| `IND_CARBON_SCOPE_3` | Supply-chain emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 3 intensity. | Выбросы цепочки поставок (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 3 по отрасли. | Təchizat zənciri emissiyaları (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 3 intensivliyi. |
| `IND_EBITDA_MARGIN` | EBITDA margin: {value}%. ≥20% = strong operating leverage; 10-19% = adequate; <10% = thin margin risk. D&A (703-11/721-11) is added back from budget lines — equals EBIT when D&A codes are absent. | Рентабельность EBITDA: {value}%. ≥20% = сильный операционный рычаг; 10-19% = приемлемо; <10% = риск тонкой маржи. D&A (703-11/721-11) добавляется обратно из бюджетных строк. | FVƏA marjası: {value}%. ≥20% = güclü əməliyyat leverage; 10-19% = qənaətbəxş; <10% = nazik marja riski. D&A (703-11/721-11) büdcə sətrlərindən geri əlavə edilir. |
| `IND_ESG_COMPOSITE` | ESG composite {value}/100 — {status}. INDUSTRY MODEL: 100 − (total emissions / size). v2.2 derived from sector intensity; v3 will weight E + S + G separately. | ESG композит {value}/100 — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: 100 − (общие выбросы / размер). v2.2 на отраслевом коэффициенте; v3 будет взвешивать E + S + G раздельно. | ESG kompozit {value}/100 — {status}. SƏNAYE MODELİ: 100 − (ümumi emissiya / həcm). v2.2 sənaye əmsalı; v3 E + S + G ayrı çəkiləcək. |
| `IND_GOV_CLIMATE_SCORE` | AZ government climate readiness {value}/100 — {status}. MACRO: static literal from public reports; v3 wires to live data feed. | Климатическая готовность Азербайджана {value}/100 — {status}. МАКРО: статичное значение из публичных отчётов; v3 — живой фид. | Azərbaycanın iqlim hazırlığı {value}/100 — {status}. MAKRO: ictimai hesabatlardan statik dəyər; v3 canlı feed. |
| `IND_HOLDING_REVENUE` | Holding-wide revenue {value} AZN, summed across direct children. 0 = no operational sub-cos contributing yet. Most meaningful at parent (level=1) companies. | Выручка холдинга {value} AZN, суммарно по прямым дочерним компаниям. 0 = ни одна операционная саб-ко не дала вклад. | Holdinqin gəliri {value} AZN, birbaşa törəmə şirkətlər üzrə cəmi. 0 = heç bir əməliyyat törəməsi töhfə verməyib. |
| `IND_NEWS_SENTIMENT_30D` | News sentiment {value}/100 over last 30 days — {status}. AI-scored from {n_items} articles tagged with this company. | Тональность новостей {value}/100 за 30 дней — {status}. AI-оценка по {n_items} статьям с упоминанием компании. | Xəbər tonallığı {value}/100 son 30 gün — {status}. AI-qiymətləndirmə şirkət haqqında {n_items} məqalədən. |
| `IND_REVENUE_TOTAL` | Total revenue {value} AZN. Persists raw $ for rollup() and fact() composites; risk classification lives on margin indicators. | Общая выручка {value} AZN. Сохраняет сырые $ для rollup() и fact() композитов; классификация рисков на других индикаторах. | Ümumi gəlir {value} AZN. Rollup() və fact() kompozitləri üçün xam $ saxlayır; risk təsnifatı digər göstəricilərdə. |
| `LEGAL_CASES_ACTIVE` | Active court cases: {value}. ≤2 = normal SME exposure; 3-9 = elevated; ≥10 = systemic legal risk (staff + legal fees + reputation drain). | Активных судебных дел: {value}. ≤2 — норма для СМБ; 3-9 — повышенная нагрузка; ≥10 — системный правовой риск (ресурсы + репутация). | Aktiv məhkəmə işləri: {value}. ≤2 — KOS üçün norm; 3-9 — yüksəlmiş; ≥10 — sistemli hüquqi risk (xərclər + nüfuz). |
| `LEGAL_CASES_TOTAL` | Total court cases YTD: {value}. High count signals litigation-prone relationships or regulatory non-compliance. | Всего судебных дел с начала года: {value}. Высокое число — признак конфликтных отношений или нарушений регуляторики. | Ümumi məhkəmə işləri (il ərzində): {value}. Yüksək say — münaqişəli münasibətlər və ya normativ pozuntular. |
| `REVENUE_FX_EXPOSURE` | {value}% of revenue is collected in non-AZN currency. ≤20% = domestic dominant; 20-50% = mixed; >50% = FX moves dominate revenue. | {value}% выручки в валюте отличной от AZN. ≤20% — внутренний рынок доминирует; 20-50% — смешанная; >50% — FX доминирует. | Gəlirin {value}%-i AZN olmayan valyutadadır. ≤20% — daxili bazar üstünlük təşkil edir; 20-50% — qarışıq; >50% — FX dəyişiklikləri üstünlük təşkil edir. |
| `SUPPLIER_HHI` | Supplier HHI is {value}. Above 0.35 + presence of single-source suppliers makes COGS extremely fragile. | HHI поставщиков = {value}. Выше 0.35 + наличие single-source поставщиков делает COGS крайне хрупким. | Tədarükçü HHI = {value}. 0.35-dən yuxarı + tək mənbəli tədarükçülərin olması COGS-i çox kövrək edir. |
| `SVC_COGS_INTENSITY` | COGS {value}% of revenue. Services above 60% usually means low-margin re-selling or high third-party pass-through costs. | COGS {value}% от выручки. Услуги выше 60% — обычно низкомаржинальная перепродажа или высокие сторонние pass-through расходы. | COGS gəlirin {value}%-dir. Xidmətdə 60%-dən yuxarı — adətən aşağı-marja yenidən-satış və ya yüksək üçüncü-tərəf pass-through xərcləri. |
| `SVC_GROSS_MARGIN` | Services gross margin {value}%. Healthy benchmarks run 40-60%; below 25% means pricing power is eroding or direct-service-delivery costs are out of line. | Валовая маржа услуг {value}%. Здоровые бенчмарки 40–60%; ниже 25% — pricing power размывается или прямые затраты на оказание услуг вышли из-под контроля. | Xidmət ümumi mənfəəti {value}%. Sağlam benchmark 40–60%; 25%-dən aşağı — qiymətləmə gücü aşınır və ya birbaşa xidmət-çatdırılma xərcləri sıradan çıxır. |
| `SVC_NET_MARGIN` | Net margin {value}%. Services businesses below 0% are losing money on operations — investigate pricing, utilization, and overhead allocation. | Чистая маржа {value}%. Сервисные бизнесы ниже 0% теряют деньги на операциях — проверьте pricing, утилизацию и распределение overhead. | Xalis mənfəət {value}%. 0%-dən aşağı xidmət bizneslər əməliyyatlarda pul itirir — qiymətləmə, utilizasiya və overhead bölgüsünü yoxlayın. |
| `SVC_OPEX_RATIO` | OpEx {value}% of revenue. Services baseline 50-70% (personnel-heavy); above 85% suggests depreciation or overhead is too large for the revenue base. | OpEx — {value}% от выручки. Сервисный baseline 50–70% (персонал-центричный); выше 85% — амортизация или overhead слишком велики для базы выручки. | OpEx gəlirin {value}%-dir. Xidmət baseline 50–70% (personalla yüklü); 85%-dən yuxarı — amortizasiya və ya overhead gəlir bazası üçün çox böyükdür. |
| `SVC_REVENUE_CONCENTRATION` | Revenue HHI = {value}. Above 3000 means a single client dominates — losing them jeopardises the business. Diversify the pipeline. | HHI выручки = {value}. Выше 3000 — один клиент доминирует; его потеря угрожает бизнесу. Диверсифицируйте pipeline. | Gəlir HHI = {value}. 3000-dən yuxarı bir müştəri üstünlük təşkil edir — onu itirmək biznesi təhlükəyə atır. Pipeline-ı diversifikasiya edin. |
| `TOP_CUSTOMER_SHARE` | Top customer accounts for {value}% of revenue. ≤20% = diversified; 20-30% = elevated; >30% = single delayed payment threatens cash flow. | Топ-клиент держит {value}% выручки. ≤20% — диверсифицировано; 20-30% — повышенная концентрация; >30% — одна задержка платежа угрожает cash flow. | Ən böyük müştəri gəlirin {value}%-ni təşkil edir. ≤20% — diversifikasiya; 20-30% — yüksəlmiş; >30% — bir gecikmiş ödəniş pul axınını təhdid edir. |
| `TOP3_CUSTOMER_SHARE` | Top-3 customers together account for {value}% of revenue. ≤50% = healthy long-tail; >75% = oligopsony — losing any one tips the equation. | Топ-3 клиента вместе держат {value}% выручки. ≤50% — здоровый длинный хвост; >75% — олигопсония, потеря любого роняет показатели. | Top-3 müştəri birlikdə gəlirin {value}%-ni təşkil edir. ≤50% — sağlam uzun quyruq; >75% — oliqopsoniya — birini itirmək balansı pozur. |

