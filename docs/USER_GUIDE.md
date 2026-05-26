# BudgetPro — Руководство пользователя

> **Enterprise Holding Risk Terminal**
> Что это, как пользоваться, что и где проверить.
> Для клиента, финансового директора и админа холдинга.

---

## Содержание

1. [Что это и зачем](#1-что-это-и-зачем)
2. [Вход и навигация](#2-вход-и-навигация)
3. [Risk Terminal — рабочий день финансиста](#3-risk-terminal--рабочий-день-финансиста)
4. [Board Deck — снимок для совета](#4-board-deck--снимок-для-совета)
5. [Бюджетирование](#5-бюджетирование)
6. [Онбординг новой компании](#6-онбординг-новой-компании)
7. [Admin Tools — 16 инструментов в 4 группах](#7-admin-tools--16-инструментов-в-4-группах)
8. [AI Auto Import — импорт любого Excel](#8-ai-auto-import--импорт-любого-excel)
9. [Risk Registry — качественные флаги риска](#9-risk-registry--качественные-флаги-риска)
10. [AI функции — что, где, сколько стоит](#10-ai-функции--что-где-сколько-стоит)
11. [Журнал аудита](#11-журнал-аудита)
12. [Чек-лист самопроверки](#12-чек-лист-самопроверки)

---

## 1. Что это и зачем

**BudgetPro — это терминал для CFO холдинга из 60+ компаний.**

Одна цель: за 5 минут утром понять, **какие из ваших компаний сейчас в зоне риска**, **почему**, и **что с этим делать**.

### Три уровня вопросов, на которые система отвечает

| Вопрос | Где смотреть | Сколько времени |
|---|---|---|
| «Что сегодня горит?» | **Risk Terminal** — HeatMap + Morning Brief | 30 секунд |
| «Почему этот показатель красный?» | **Variance Explainer** (клик по ячейке → Explain) | 10 секунд + ~15 секунд AI |
| «Что показать совету директоров?» | **Board Deck** — PDF/PPTX в один клик | 20 секунд |

### Что внутри
- **6 живых entity** холдинга AZSEKER (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + материнская)
- **47 индикаторов** (P&L, Balance Sheet, Cash Flow, KPI, ESG, операционные)
- **AI-агенты** на Anthropic Claude: классификатор Excel, объяснитель отклонений, генератор Board Deck, утренний брифинг
- **Полный аудит-трейл** — каждое изменение пишется в IFRS-совместимый журнал на 365 дней

---

## 2. Вход и навигация

### 2.1 Логин

URL: **`http://localhost:3000/login`** (dev) или ваш production-домен.

![Login](guide/screenshots/01-login.png)

**Дефолтные креды для тестового стенда:**
- Email: `admin@budgetpro.com`
- Password: `Admin123!`

> ⚠️ После первого подключения клиента — обязательно ротировать пароль (Phase 0.1 ROADMAP).

### 2.2 Боковая навигация

После входа слева — 6 основных разделов:

| Иконка | Раздел | Зачем |
|---|---|---|
| 📊 | **Budgeting** | План/факт, P&L, BS, CF — традиционный FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-стиль терминал — главный экран дня |
| 📋 | **Board Deck** | Снимок для совета директоров (печать / PPTX / PDF) |
| 🚀 | **Onboarding** | Готовность компаний + импорт новых через AI |
| 📜 | **Audit Log** | Журнал всех значимых изменений |
| 🛠️ | **Admin Tools** | 16 утилит в 4 группах |
| ⚙️ | **Settings** | Профиль + язык + предпочтения |

---

## 3. Risk Terminal — рабочий день финансиста

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.png)

Это **главный экран**. Открываете утром — всё нужное здесь.

### Четыре панели

#### Panel 1 · Company Tree (слева сверху)
Дерево всех компаний холдинга с **composite-score** бейджем для каждой:
- 🟢 **зелёный %** — composite score (0-100)
- 🔴 **R##** — количество красных индикаторов
- **Чипы:** `Sub` / `Opq` / `NoD` — качественные риск-флаги (см. раздел 9)

**Что проверить:** клик по компании → правая HeatMap фильтруется на эту компанию.

#### Panel 2 · Risk HeatMap (справа сверху)
**Матрица: компании × индикаторы.** Цвет ячейки = статус (зелёный/янтарный/красный/н/д).

Каждая ячейка размечена не только цветом, но и **формой** (▲ / ● / ○) — для clinical color-blind safety (Phase M7 регрессионный скан запрещает откат).

Сверху:
- Фильтр квартала (2026 / Q1...Q4 / M1...M12)
- `Material only` — спрятать неприменимые индикаторы
- Счётчик: `54G / 30A / 16R / 88?`

**Что проверить:** наведите курсор на ячейку → tooltip с числом + плановым диапазоном.

#### Panel 3 · Indicator Detail (слева снизу)
По умолчанию показывает **«Today's brief»** — утренний AI-брифинг.

При клике на ячейку HeatMap превращается в **детализацию индикатора:**
- Формула (`counterparty_hhi_customer`)
- Resolved variables
- Source rows из BudgetLine
- Кнопки: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (справа снизу)
- По умолчанию: подсказка «Pick a HeatMap cell, then click Explain →»
- После клика на компанию: **Company Snapshot** (топ алерты + breakdown)
- После клика `Explain →`: **AI Variance Explainer** — narrative + 3 рекомендации

### Что проверить за 60 секунд
1. Раскройте дерево AZSEKER → должно быть 7 sub-cos с composite-score
2. Кликните на красную ячейку → Panel 3 покажет формулу, Panel 4 — кнопка Explain
3. Нажмите Explain → через ~15 секунд появится narrative с TOP DRIVERS и RECOMMENDATIONS
4. Внизу — лента EVENTS (последние LLM-вызовы) и MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — снимок для совета

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.png)

**Цель:** одностраничный документ для совета директоров. Открываете → читаете → нажимаете «Print to PDF» → отправляете в чат.

### Что в нём
1. **Заголовок-нарратив** — AI генерирует одну фразу типа *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»*
2. **Holding composite score** — крупное число
3. **Top movers** — кто выше/ниже плана сильнее всех
4. **Alerts** — критические нарушения порогов
5. **🆕 Qualitative Risk Flags** — секция с компаниями, у которых стоят качественные риск-флаги

### Скриншот секции качественных рисков (низ страницы)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.png)

Здесь видно:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

Эти флаги **автоматически уменьшают composite score** компании и попадают в утренний брифинг (см. раздел 9).

### Кнопки экспорта
- `Export PPTX` — байт-в-байт идентичная презентация PowerPoint
- `Export PDF` — PDF через серверный рендер
- `Print to PDF` — браузерная печать
- `Open Risk Terminal →` — переход в живой терминал для drill-down

---

## 5. Бюджетирование

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.png)

**Это «обычный» FP&A workspace** — то, что финансист делал в Excel, теперь делает здесь.

### Левая sidebar — структура работы

**FINANCE** — три классических отчёта:
- 📈 **P&L** — отчёт о прибылях/убытках
- 💰 **Sales** — детализация продаж
- 📑 **Balance Sheet** — баланс
- 💸 **Cash Flow** — движение денежных средств
- 📐 **Assumptions** — допущения для модели

**PLANNING** — что планируем:
- 🗂️ **Workspace** — главный экран бюджета (на скриншоте)
- 📊 **P&L (Plan)** — план в формате P&L
- 🔮 **Forecast** — прогноз
- ⚖️ **Comparison** — план vs факт vs forecast
- 📅 **Plans** — список всех планов

**ANALYTICS** — Report Builder для произвольных срезов.

**SETTINGS** — Import / Configuration.

**ADMIN** — глубокие настройки (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← здесь Risk Registry**).

### Что на главном Workspace экране
- 4 KPI-карточки сверху: **Revenues / COGS / Expenses / Operating Profit** с execution % и variance
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — донат 85% / 65% composite score
- **Plan/Forecast/Actual by category** — детальная таблица

### Что проверить
1. Сверху правее заголовка — селектор плана (`Azərşəkər 2026 Budget — 2026`) и компаний (`All companies (consolidated)`)
2. Кнопка `+ Create plan` — создаёт новый план
3. Внизу справа — кнопка `AI Analysis` (фиолетовая)

---

## 6. Онбординг новой компании

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.png)

**Цель:** показать прогресс ввода данных по каждой компании холдинга и помочь добить «пустые» секции.

### Что видно
- **Карточки компаний** с уровнем (LEVEL 1 = материнская, LEVEL 2 = sub-co)
- **Процент готовности** + статус: `VERIFIED` (>90%), `PENDING` (<90%)
- **Цветовая подсветка:** зелёный CPC (90%), фиолетовый — выбранный для drill-down

### Что показано в нашем демо
| Code | Name | Industry | Готовность | Статус |
|---|---|---|---|---|
| AZSEKER | Azərşəkər | food_processing | 100% | ✅ VERIFIED |
| AZSEKER-MALT | Malt | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-EDEN | Eden Agro | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-AZSF | Azərşəkər Sugar | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-HORIZON | Horizon | services | 80% | ✅ VERIFIED |
| AZSEKER-FARM | Farm | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-PROMALT | Promalt MMC | food_processing | 30% | ⏳ PENDING |
| AZSEKER-CPC | CPC | food_processing | 90% | ✅ VERIFIED |

**Что проверить:** клик по карточке → раскрывается detail с тем, какие секции (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) заполнены, а какие нужно добить.

---

## 7. Admin Tools — 16 инструментов в 4 группах

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.png)

**Это «инженерная панель»** — что использовать **перед клиентским демо** и для повседневной поддержки.

### Четыре группы

#### 🧪 Data Ingestion (загрузка данных)
| Карточка | Что делает |
|---|---|
| **Импорт данных** `Phase 7.M Tier 7` | Drag-drop любого xlsx → AI определит тип (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) и роутит на правильный adapter. Один экран вместо 5 разных форм. |
| **Data Entry** | Ручной ввод KPI и ESG disclosures для non-engineer admin. |
| **Data Sources Catalog** | Client-facing список внешних feeds: business value, sample value, dependencies. |
| **Source Registry** | Drift-watchdog: список разрешённых xlsx-источников для ingest. |

#### 🩺 Data Quality (качество данных)
| Карточка | Что делает |
|---|---|
| **Indicator Health** `Phase 7.M` | Per-indicator green/amber/red/unknown с remediation guidance. Используйте **перед** клиентским демо. |
| **Drift Dashboard** | Recent drift events + reference-feed freshness + stalled onboarding cases. |
| **Companies Readiness** | Per-entity 7-area scoring с tiers (complete/good/partial/thin/empty). CSV export. |
| **Data Archive** | Self-service архив + restore: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | Статус external feed adapter + recent crawls + news pipeline diagnostics. |

#### 🔒 Operations (операции)
- **Period Locks** — закрытие закрытых периодов от mutations
- **Approvals** — workflow для согласований изменений
- **AI Usage** — мониторинг LLM-расходов с 30-дневным трендом

#### 👥 Access (доступы)
- **User Access** — управление пользователями и ролями
- **API Keys** — машинные ключи для внешних интеграций

### 7.1 Indicator Health — must-check перед демо

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.png)

**Сверху:** счётчики
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (43.6% computed из 1201 total IVs)

**Unknown breakdown by error code:**
- `eval: 430` — формулы упали
- `non_finite: 123` — деление на ноль / NaN
- `no_budget_lines: 64` — нет источников в P&L
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**Внизу:** список конкретных индикаторов с проблемами + remediation в одну строку.

**Что проверить перед демо:**
1. **AGRO_COMMODITY_VOL** → 75 cells, нужно investigate
2. **FP_INVENTORY_TURNS** → 49 cells, нужно `inventory` в BS
3. **FP_YIELD_LOSS** → 49 cells, нужен `raw_input` в production KPI
4. **AGRO_DROUGHT_RISK** → 37 cells, нужен `drought_index` per entity

### 7.2 Companies Readiness — сетка готовности

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.png)

Per-entity scoring по 7 областям: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Колонки:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — что нужно добавить, чтобы поднять tier

**На скрине видно:**
- HORIZON 15% Thin → нужны P&L (budget lines), balance sheet, counterparties
- PROMALT 25% Thin → то же
- MALT 65% Good → нужны operational KPIs, strategic narrative, FX tags
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

Кнопка **Export CSV** копирует gap-list для email.

### 7.3 Data Archive — soft-delete с restore

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.png)

**Зачем:** ошиблись с импортом → нужно убрать строки из расчёта, **но не удалять физически** для IFRS-аудита.

**Как работает:**
- Архивирование скрывает данные из HeatMap, recompute, отчётов
- Физически данные **не удаляются** — восстановление возможно в течение **90 дней**
- Все действия пишутся в audit trail
- Через 90 дней — daily cron `soft-delete-purge` физически удаляет

**Форма:**
- **Действие:** Архивировать / Восстановить
- **Тип:** P&L / BS / CF / Counterparty
- **Компания + Год**
- **Причина** (попадает в audit log)
- **Подтверждение:** ввести `ALL` чтобы исключить опечатку

---

## 8. AI Auto Import — импорт любого Excel

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.png)

**Это убийца ручного маппинга.** До Phase 7.M Tier 7 каждый новый xlsx требовал кода. Теперь:

### Как работает (5 фаз)
1. **AI Classifier** (Anthropic) — определяет dataType листа: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — выбирает правильный adapter из реестра (11 dataTypes)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — каждый импорт сверяется с источником
5. **GREEN verdict** — без расхождений или вы видите diff

### Два режима
- **`1 файл`** — стандартный, для одного workbook
- **`Несколько файлов`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - 1-10 файлов одновременно
  - **Group-level atomicity** — либо все группы пишутся, либо ни одна
  - **Cross-file conflict detection** — если два файла пишут в одну ячейку разное → 409 с diff
  - Один recompute после всех групп (вместо N)

### Что проверить
1. Drag-drop любого xlsx в зону `Перетащите xlsx файл сюда`
2. Нажмите `Шаг 1: AI-анализ листов`
3. AI вернёт классификацию + предложит plan import
4. Подтверждаете → файл импортируется → автоматический recompute

### Ограничения
- Single file: ≤ 20 MB
- Multi file: ≤ 10 файлов, ≤ 20 MB total
- Rate limit: 3 multi-file импорта/час/org
- Cost cap: проверяется заранее (N × 35K tokens)

---

## 9. Risk Registry — качественные флаги риска

**URL:** `/budgeting/admin/companies` → раздел **«Настройки компаний»** → expand карточку компании

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.png)

**Это самая свежая фича (Phase 7.N, май 2026).** Качественные финансово-операционные риски, которые HeatMap количественно не показывает.

### Три канонических флага

| Флаг | Эмодзи | Что значит | Штраф к composite |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Доход или маржа существенно зависят от субсидий или регулируемых цен | **−5** |
| `non_transparent_structure` | 🛡 | Related-party или unaudited cost-allocation паттерн | **−8** |
| `data_absence` | ⚪ | Ключевые финансовые или операционные данные отсутствуют | **−12** |

### Как ставить
1. `/budgeting/admin/companies`
2. Раздел **«Настройки компаний»** (внизу страницы)
3. Раскрыть карточку компании (например, AZSEKER-EDEN)
4. Найти **«Risk Registry»** — отсортирован по 8 категориям с дотами серьёзности `● ● ●` (emerald → amber → rose)
5. Кликнуть на нужный флаг — он подсветится, штраф применится после сохранения

### Куда эти флаги попадают (4 канала, проверены end-to-end)

| Канал | Где увидите |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (чипы `Sub` / `Opq` / `NoD` рядом с именем) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (фразы типа *«exposure to government policy/subsidy regime»*) |
| **Board Deck section** | Board Deck → секция **«Qualitative Risk Flags»** с FLAGGED ENTITIES count |
| **Variance Explainer** | Risk Terminal → click cell → Explain → рекомендация #3 цитирует флаг |

### Текущее состояние БД
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **−20 к composite**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

---

## 10. AI функции — что, где, сколько стоит

Все LLM-вызовы идут на **Anthropic Claude** через серверный API (cost mode + retry policy).

### 10.1 Morning Brief (утренний брифинг)

**Где:** Risk Terminal → Panel 3 → секция «Today's Brief»

**Что делает:** одной фразой описывает риск-кластер дня + перечисляет «top worst» по секторам. Учитывает качественные риск-флаги.

**Пример вывода (живой, из БД):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Языки:** EN / RU / AZ (переключатель в правом верхнем углу панели).

**Как работает кэш:** sha256 текста промпта + dataset hash. Меняем промпт → старый кэш инвалидируется автоматически.

### 10.2 Variance Explainer (объяснитель отклонений)

**Где:** Risk Terminal → клик на ячейку HeatMap → кнопка `Explain →`

![Variance Explainer](guide/screenshots/13-variance-explainer.png)

**Что делает:** narrative (1-3 предложения) + 3 actionable recommendations + список TOP DRIVERS.

**Пример вывода для EDEN Customer HHI:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Заметьте — рекомендация #3 цитирует риск-флаг `subsidy_dependency` со страницы Risk Registry.

**Стоимость:** ~1200 in + ~240 out tokens на вызов (~ $0.01).

### 10.3 Board Deck Narration

**Где:** автоматически генерируется при открытии Board Deck.

**Что делает:** превращает количественные сигналы в одну фразу-заголовок типа *«Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies»*.

Кэшируется на (orgId, period) — один вызов в час максимум.

### 10.4 AI Auto Import Classifier

**Где:** Admin → AI Auto Import → drag-drop файла.

**Что делает:** smart-routing для любого xlsx. Стоит ~$0.13 за полный workbook (23 листа / 14 entities на тесте). Никаких новых адаптеров — AI сам определит тип и выберет правильный pipeline.

---

## 11. Журнал аудита

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.png)

**Цель:** IFRS-совместимый журнал всех значимых изменений. Хранится 365 дней.

### Что пишется
- Все импорты (filename, rows changed, status)
- Все mapper applies
- Role changes
- Indicator overrides
- LLM calls (model, prompt version, tokens, fromCache)
- **Soft-delete и physical purge** (Phase 1.4 cron)

### Фильтры
- **Action** — тип события
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — диапазон дат
- **Кнопки:** Apply / Reset

### Что проверить
- В таблице видны записи `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run`
- Колонка ACTOR — `Admin` для ручных действий
- SUMMARY содержит JSON с `model`, `inputTokens`, `outputTokens`, `language`, `fromCache`
- Записи отсортированы новые сверху

---

## 12. Чек-лист самопроверки

Пройдите по этому списку **сейчас**, кликая в живом приложении. Если что-то не сходится — где-то баг, фикс надо ставить в очередь.

### Базовая навигация
- [ ] `/login` → войти с `admin@budgetpro.com` / `Admin123!` → редирект на `/budgeting`
- [ ] Sidebar показывает 6 пунктов: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Переключатель темы (солнце/луна) в правом верхнем углу работает

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER дерево раскрывается, видно 7 sub-cos с composite-score (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: рядом с EDEN видна метка `Sub`, рядом с AZSF — `Opq` + `NoD`
- [ ] Panel 2: HeatMap показывает 3 AZSEKER-* строки (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: «Today's brief» загружается, текст содержит упоминания «subsidy-regime» или «non-transparent» (это AI Morning Brief с риск-флагами)
- [ ] Клик на красную ячейку EDEN row, колонка CUSTOMER_HHI → Panel 3 показывает формулу `counterparty_hhi_customer`
- [ ] Click `Explain →` → через ~15с появляется narrative + 3 recommendations
- [ ] В рекомендации #3 цитируется фраза с **subsidy dependency** (или связанной)

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI-заголовок присутствует (что-то типа «Food processing margin squeeze...»)
- [ ] Holding composite score = **59** (на момент написания)
- [ ] Прокрутить вниз → секция **«Qualitative Risk Flags»** видна
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN карточка → `Subsidy dependency` чип (амбер)
- [ ] AZSEKER-AZSF карточка → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC карточка → `Subsidy dependency` + `Non-transparent structure`
- [ ] Кнопки `Export PPTX`, `Export PDF`, `Print to PDF` присутствуют

### Бюджетирование (`/budgeting`)
- [ ] 4 KPI-карточки сверху (Revenues / COGS / Expenses / Operating Profit)
- [ ] Waterfall chart с tooltip-ом при наведении (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Селектор плана `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder работает

### Онбординг (`/budgeting/onboarding`)
- [ ] 8 entity-карточек: AZSEKER (100%) + 7 sub-cos
- [ ] PROMALT MMC = 30% PENDING — единственная с PENDING
- [ ] Остальные ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Лендинг показывает 16 карточек в 4 группах
- [ ] Карточки `Импорт данных` и `Indicator Health` помечены `Phase 7 M` бейджем
- [ ] Все карточки кликабельны

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] Два таба: `1 файл` / `Несколько файлов` (нового помечен `новое`)
- [ ] Drop-zone присутствует
- [ ] Кнопка `Шаг 1: AI-анализ листов` есть

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Сводка: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Breakdown по error code виден
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] Таблица из 6 entity сортируется по Score asc (worst first)
- [ ] HORIZON и PROMALT MMC внизу с Thin tier
- [ ] Кнопка `Export CSV` работает

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Форма с полями Действие / Тип данных / Компания / Год / Причина / `ALL` подтверждение
- [ ] Радио `Архивировать (скрыть из расчётов)` выбрано по умолчанию

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] Сверху Role & Status таблица с 8 entity
- [ ] Внизу «Настройки компаний» с раскрывающимися карточками
- [ ] Внутри карточки EDEN — секция **Risk Registry** с 8 категориями
- [ ] Категории: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Серьёзность отображена дотами `● ● ●` (emerald / amber / rose)

### Audit Log (`/budgeting/audit`)
- [ ] Таблица событий, новые сверху
- [ ] Записи `ai_morning_brief_run`, `ai_variance_explainer_run` присутствуют
- [ ] SUMMARY содержит JSON с tokens + language + fromCache

### AI вызовы (через Audit Log)
- [ ] Хотя бы один `ai_variance_explainer_run` за последние 24 часа
- [ ] `ai_morning_brief_run` есть за сегодня
- [ ] `ai_board_deck_narration_run` есть (генерируется при открытии Board Deck)
- [ ] `fromCache: true` для повторных запросов с одинаковыми параметрами

---

## Куда обращаться, если что-то сломалось

| Симптом | Куда смотреть |
|---|---|
| Composite score не пересчитался | `Risk Terminal → Recompute` кнопка |
| AI brief старый | Audit Log → найти последний `ai_morning_brief_run` → проверить `fromCache` |
| HeatMap пустая | `Indicator Health` → проверить UNKNOWN breakdown |
| Импорт упал | `Admin → Drift Dashboard` → последние events |
| Нужно откатить импорт | `Admin → Data Archive` → выбрать тип данных + год + причина → ALL |
| Закрыли период случайно | `Admin → Period Locks` → unlock + audit |

---

## Технические детали для проверяющего

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** Anthropic Claude через `@anthropic-ai/sdk` с serverside caching
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** LaunchAgent на порту 3000 (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Тесты:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Migration policy:** все миграции через Prisma + audit; soft-delete с 90-day physical purge cron
- **Cost guard rails:** rate-limits + token budgets + LLM kill switch в env

---

> Документ сгенерирован 26 мая 2026 г., после закрытия Phase 7.N (риск-флаги во всех 4 каналах).
> Источник скриншотов: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.
