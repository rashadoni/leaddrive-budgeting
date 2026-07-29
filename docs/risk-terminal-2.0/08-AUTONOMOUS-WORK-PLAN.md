# Автономный план работ BudgetPro — v1 (2026-07-20)

Owner: Rashad. Исполнитель: Claude (автономно, слайсами). Статусы: ⬜ / 🟡 / ✅.
Каждый слайс: реализация → tsc/vitest/build → commit → CI green → deploy →
**проверка на живом проде** (Playwright/curl, замеры — не «на слово») → отчёт.

## Постоянная автономная очередь

Между обычными слайсами не ждать одобрения владельца. После каждого live-verified
слайса сразу брать следующий доступный пунк. Останавливаться только на
жёстких гейтах из конца документа. Очередь исполнения:

1. ✅ 1.4/S1 — per-row currency evidence выкачен и live-verified 2026-07-21.
2. ✅ 1.4/S2 — CF.04–CF.07 в complete CF batch без destructive bridge-only
   reset выкачен и live-verified 2026-07-21.
3. 1.5–1.9 — подготовить import templates/checklists; при отсутствии
   данных зафиксировать гейт и идти дальше. Единый пакет владельцу:
   `09-OWNER-DATA-PACK.md`.
4. 2.1–2.4 — вопросы клиента, затем decision-экран «Обзор/Сегодня».
5. 3.1 — видео-гайды по одному разделу с отдельной приёмкой.
6. 4.1–4.3 — shadow trust core без платных providers/credentials.
7. Track 5 — UX-слайсы по накопленному фидбеку.

## Трек 1 — ДАННЫЕ (главный рычаг; терминал серый из-за входных данных)
Источник: «Data completeness backlog» в docs/ROADMAP.md (аудит 2026-07-20).

Сам (без владельца):
- ✅ 1.1 Выяснить происхождение seed'ов сахара/погоды 2026; если источник реальный —
  бэкфилл 2025 тем же способом (#6, #10). Исторические данные НЕ выдумывать.
  - ✅ 1.1A Period-safe resolvers выкачены на прод 2026-07-21: historical period
    больше не читает future rows; monthly TTM требует ровно 12 канонических месяцев
    и fail-closed на пропуске/дубликате/non-month-start. Live: 2025 сахар 6/12,
    2026 TTM 10/12; осадки без historical ряда остаются `unknown`.
  - ✅ 1.1B Бесплатный historical Yahoo `SB=F` backfill выкачен на прод
    2026-07-21: 12/12 реальных month-end close за 2025, без интерполяции.
    Live EDEN 2025: trend −10.47% (`red`), volatility 9.82% (`green`), coverage
    complete. 2026 остался честно `unknown`: нет февраля/марта.
  - ✅ 1.1C Бесплатный historical Open-Meteo rainfall backfill выкачен на
    прод 2026-07-21: 8 регионов × 12 месяцев = 96/96 точек, с сохранением
    legacy inclusive 91-day semantics `end−90..end`. EDEN честно `unknown`,
    пока не утверждено правило для его многорегиональных участков.
- 🟡 1.2 News-crawler для 4 пилотов (#7): free/keyless GDELT DOC 2.1
  retrieval-only каркас выкачен на прод 2026-07-21. Он хранит только
  source-native evidence и `sentimentScore=null`; Anthropic/платных вызовов нет.
  Запуск/запись заблокированы до owner-approved `newsEntityAliases` для 4 пилотов;
  короткие `CPC`/`MALT` принципиально не принимаются.
- ✅ 1.3 Разбор EDEN 2026 EBITDA out_of_range (#11): причина найдена,
  sign/basis guard выкачен на прод 2026-07-21. Ложное −401.79% убрано;
  текущий результат честно `unknown`: P&L Jan–May не совпадает с
  captured EBITDA Jan–Dec. До decision-grade нужен один базис: либо P&L Jun–Dec,
  либо подтверждённая EBITDA Jan–May.
- 🟡 1.4 КОД: импортер должен сохранять колонку валюты (корень #5 и FX_IMPORTED_INPUT);
  + импорт bridge-строк CF.04–CF.07 (net change) — разблокирует statement-контроли.
  - ✅ 1.4/S0 Currency contract выкачен на прод 2026-07-21:
    `plannedAmount` = base/reporting amount, `originalAmount` = source foreign amount;
    все read-consumers больше не конвертируют дважды. Foreign без finite
    positive rate/original evidence fail-closed; historical rate больше не подменяется 1:1.
  - ✅ 1.4/S1 Generic и owner-specific import выкачен на прод 2026-07-21:
    AI Mapper, single/multi/multi-entity staging и deterministic budget import
    сохраняют per-row source/base/rate evidence. Foreign без ISO/source/rate или
    без tie-out ≤1bp блокируется до replacement transaction; domestic rows в
    mixed sheets остаются base. Реальных foreign-строк на проде пока 0 — numeric
    проверка ждёт owner source data, данные не фабриковались.
  - ✅ 1.4/S2 CF.04–CF.07 выкачен на прод 2026-07-21: bridge evidence хранится
    отдельно от movements, входит в тот же complete entity/year batch и не
    удваивает UI/ODDS/AI/alerts. Blank не превращается в zero; parent/child
    выбирается по каждому месяцу; bridge-only, scope mismatch и collateral
    entity/year/forecast reset блокируются до записи. `cash_flow_sum` теперь
    использует независимо импортированный CF.05 (+ CF.04 при наличии), но
    `cash_to_balance_sheet` остаётся честно blocked без независимого BS cash.
    На проде live CF-строк сейчас 0, поэтому числовая проверка ждёт реальный
    workbook владельца; синтетические финансовые строки не создавались.

Нужны данные владельца (запрашивать, потом импортировать через AI Auto Import):
- 🟡 1.5 Операционные факты (#1, 36 ячеек) — урожай/га, сахаристость, вода,
  удобрения, extraction. Входной контракт проходит code-hardening перед
  запросом файлов: расхождение `drought_index` 0–10 в импорте против 0–100
  в seed найдено и исправлено, выкачено и live-verified 2026-07-22; реальные
  факты остаются owner gate.
- 🟡 1.6 Юр/аудит счётчики (#2, 29). Кодовый разрыв `LEGAL_CASES_TOTAL`
  закрыт 2026-07-21: импорт судебного реестра теперь пишет обе канонические
  метрики TOTAL/ACTIVE и tenant-scoped заменяет snapshot; релиз `f29a542b`
  live-verified. Реальные реестры 2025/2026 остаются owner-data gate;
  отсутствующие строки не трактуются как 0.
- ⬜ 1.7 Реестры клиентов/поставщиков (#3, 17; PROMALT пуст, 2025 без поставщиков).
- ⬜ 1.8 fxRevenueAzn ×4 (#4) · PROMALT 2025 P&L (#9) · балансы CPC/PROMALT/AZSF (#8).
  Дополнительно live-аудит 2026-07-22 подтвердил: у holding `AZSEKER`
  `baseCurrencyCode=null` и в org-справочнике нет строки `isBase=true`. UI теперь
  честно не приписывает балансам `AZN`; перед заполнением кода валюты нужно
  подтверждение владельца/источника Reporting, произвольно ставить AZN нельзя.
- ⬜ 1.9 Утвердить для EDEN правило rainfall: period-aware взвешивание по гектарам
  и срокам аренды или один primary region. Без этого `Company.settings.region`
  остаётся null; произвольный регион не выбирать. Старый
  `derive-azseker-drought-index.ts`, обходивший этот гейт, выведен из эксплуатации
  и fail-closed на проде 2026-07-22 (`a25a5091`, CI `29885819734`): он больше не
  импортирует Prisma и всегда завершает работу до DB setup. Live guard exit=2;
  fingerprint `drought_index` до/после совпал, `count=0`.

## Трек 2 — «РАБОЧАЯ ЛОШАДКА»: клиентский decision-экран
Клиенты не ориентируются в терминале → нужен простой сильный вход.
- ⬜ 2.1 СНАЧАЛА спросить владельца: 1–2 вопроса клиента («какая компания в риске и
  что делать?», «где утекает маржа?», «хватит ли денег?»). Без ответа не строить.
- ⬜ 2.2 Design-workflow → макет экрана «Обзор/Сегодня» (карточки: компания → статус →
  1 действие; язык клиента, без жаргона; терминал = «для экспертов», ссылкой).
- ⬜ 2.3 Реализация поверх существующих API (матрица/alerts/composite), az/en/ru.
- ⬜ 2.4 Внешние данные (Stage F) потом отображать ЗДЕСЬ карточками, не в терминале.

## Трек 3 — ВИДЕО-ГАЙДЫ (пилот принят владельцем)
Конвейер: scripts/produce-guides.mjs + video/scenarios/overrides.mjs (эталон: statement-controls).
- 🟡 3.1 Порядок разделов: Рабочая область (P&L) → Денежный поток → Баланс → Прогноз →
  Сравнение/Планы → Терминал (обзорно, «для экспертов») → Контроль данных группа →
  AI-импорт → Алерты → Board Deck. По одному; ≥2 мин en/ru; az длиннее — ок.
- Workspace/P&L подготовлен и live-verified 2026-07-22: 9-сценовый EN/RU/AZ
  READONLY-сценарий, 17 стабильных DOM-якорей, честная обработка как настроенной,
  так и ненастроенной Matrix. Релизы `86a40c67` + follow-up `ce98d873`, CI
  `29883628064` + `29884736631` green; production HEAD/stamp exact, smoke 8/8,
  login/terminal Playwright 3/3. Свежая живая проверка переключила Material →
  Matrix → List с `requestCount=0`, `mutating=[]`. Видео/постер/карта assets ещё
  НЕ созданы: TTS/запись и обязательная проверка тишины+кадров остаются гейтом;
  платный TTS без отдельного разрешения не запускать.
- Cash Flow подготовлен и live-verified 2026-07-22: 8-сценовый EN/RU/AZ
  READONLY-сценарий, локализованные UI/якоря и fail-closed обработка отсутствующих
  данных. ODDS считает только `inflow`/`outflow` (bridge не подменяет движение),
  а годовой revenue/expense plan-vs-actual не рисует нулевые месяцы без всех
  четырёх входов по каждому месяцу. Релиз `f0789992`, CI `29890875939` green;
  production HEAD/stamp exact, app healthy, 27 migrations current, smoke 8/8,
  login/terminal Playwright 3/3. Свежий live Playwright на EN/RU/AZ подтвердил
  Overview/Entries/ODDS/PlanFact empty-state, локальные переключения и 0
  mutating/paid-AI/5xx/browser-error запросов; API: Cash Flow movements `0`,
  source populations `0/0/0`, complete coverage `0/12`. Видео/постер/asset-map
  НЕ создавались: платный TTS и визуально-аудиальная приёмка остаются гейтом.
- Query-aware help-video resolver live-verified 2026-07-22: route patterns теперь
  могут требовать `?tab=...`, launcher реагирует на смену query и не переносит
  manual entry между вкладками. Релиз `31b8aa59`, CI `29891889960` green;
  production HEAD/stamp exact, app healthy, 27 migrations current, smoke 8/8,
  login/terminal 3/3. Live: Statement Controls сохранил опубликованный widget,
  а Workspace/Cash Flow/Balance без готовых media assets показывают 0 ложных
  widget; mutating/paid-AI/5xx/browser errors = 0. Это только маршрутизация —
  новые ролики не опубликованы.
- Balance Sheet подготовлен и live-verified 2026-07-22: 9-сценовый EN/RU/AZ
  READONLY-сценарий, 18 стабильных якорей и ровно шесть проверенных локальных
  collapse/reopen кликов Assets/Liabilities/Equity. Экран больше не подменяет
  отсутствующие месяцы нулями, отличает explicit zero, fail-close обрабатывает
  API error, неполные/материально несходящиеся sign-convention данные и D/E при
  missing/zero/negative equity. Валюта выводится только из подтверждённого
  `baseCurrencyCode`; на проде он отсутствует, поэтому unit не выдуман. Релиз
  `d2d5566e`, CI `29893931310` green; backup
  `pre-deploy-2026-07-22T054040Z-d2d5566eb9ea.sql.gz`, production HEAD/stamp
  exact, app healthy, 27 migrations current, smoke 8/8. Свежий live Playwright
  EN/RU/AZ: 86 rows (50 assets / 20 liabilities / 16 equity), latest month May,
  Jun–Dec=`—`, KPIs 134.2M / 2.6M / 131.6M / D/E 0.02x, все шесть кликов
  восстановили секции; mutating/paid-AI/5xx/browser errors = 0. Видео/постер/
  asset-map не создавались: TTS и визуально-аудиальная приёмка остаются гейтом.
- Forecast подготовлен и live-verified 2026-07-22: 9-сценовый EN/RU/AZ
  READONLY-сценарий со стабильными якорями и локальными переключениями Base /
  Optimistic / Pessimistic и раскрытием Revenue/COGS/Expenses. Экран агрегирует
  2045 исходных листовых строк в 112 уникальных category/type строк без двойного
  счёта, применяет только совпадающие год/месяц/ключ saved overrides, сохраняет
  explicit zero и не подменяет отсутствующие данные нулём. Company filter скрыт,
  потому что ForecastEntry не имеет companyId; редактирование вне Base отключено.
  Валюта выводится только при подтверждённой base currency; на проде она не
  настроена, поэтому `AZN`/`₼`/`USD` не выдумываются ни в KPI, ни в матрице.
  Релизы `87a32af2` + corrective `ce57b0c5`, CI `29896848017` + `29898834702`
  green; backups `pre-deploy-2026-07-22T063922Z-87a32af29646.sql.gz` и
  `pre-deploy-2026-07-22T071514Z-ce57b0c56398.sql.gz`; production HEAD/stamp
  exact, app healthy, 27 migrations current. Свежий live Playwright EN/RU/AZ:
  provenance `2045→112`, applied/ignored overrides `0/0`, Revenue 58.9M, EBITDA
  3.9M (точная матрица 3,909,842), margin 6.6%, Optimistic Revenue 64.8M,
  Pessimistic 53.0M; P&L и matrix согласованы; mutating/paid-AI/5xx/browser
  errors = 0. Видео/постер/asset-map не создавались: платный TTS и обязательная
  визуально-аудиальная приёмка остаются owner gate.
- Comparison подготовлен и live-verified 2026-07-22: 9-сценовый
  EN/RU/AZ READONLY-сценарий выбирает два заполненных сопоставимых
  annual Actuals; пустой Budget 2025 отключён. Идентичность строки =
  `accountCode+lineType`, поэтому одинаковые названия не склеиваются;
  absent остаётся `—`, explicit zero — `0`. Actual-vs-actual показывает по
  одной realized-колонке на период и скрывает несуществующий materiality
  фильтр; OpEx totals/deltas и zero-denominator fail-closed. Релиз `d52648b5`,
  CI `29903075467` green; backup
  `pre-deploy-2026-07-22T082258Z-d52648b596d7.sql.gz`; production HEAD/stamp
  exact, app healthy, 27 migrations current, `/login` 200. Свежий live Playwright
  EN/RU/AZ: Actuals 2026/2025, 137/147 source categories, 215/215 union rows,
  50 duplicate display-label groups сохранены, empty plans 1/1 disabled,
  base currency absent и unit не выдуман; mutating/paid-provider/HTTP errors =
  `0/0/0`. Видео/постер/asset-map не создавались: TTS и приёмка — owner gate.
- Plans подготовлен и live-verified 2026-07-22: 9-сценовый hover-only EN/RU/AZ
  READONLY-сценарий без кликов и мутаций. Карточки явно различают Budget/Actual,
  подтверждённый empty и неизвестное число строк; live: пять планов с
  `2045/934/339/2125/0` строками, где Budget 2025 доказанно пуст. Workflow,
  approval history, versions и system comments локализованы; viewer write UI
  скрыт, direct mutation API требует editor+. Version clone сохраняет kind,
  rolling-поля и snapshot, исключает deleted source, а номер версии
  сериализован advisory lock по org/root. Diff fail-close при отсутствующей
  подтверждённой base currency и не подменяет absent нулём. Релиз `887a02b0`,
  CI `29906941836` green; backup
  `pre-deploy-2026-07-22T092203Z-887a02b07f31.sql.gz`; production HEAD/stamp
  exact, app/db healthy, 27 migrations current, `/login` 200. Свежий live
  Playwright EN/RU/AZ подтвердил локали, пять карточек, v1 с 2045 live lines,
  empty approval history и недоступный currency diff; только GET, mutating /
  paid-provider / HTTP>=400 / browser errors = `0/0/0/0`. Видео/постер/asset-map
  не создавались: TTS и визуально-аудиальная приёмка остаются owner gate.
- Risk Terminal (обзор) подготовлен и live-verified 2026-07-22: 9-сценовый
  EN/RU/AZ READONLY-сценарий использует только выбор компании и ячейки; все
  действия подтверждены как локальные/GET. Обычная загрузка, Today Brief и hover
  ячейки больше не могут автоматически вызвать Anthropic: `/explain` требует
  явного `userInitiated:true` до чтения ключа, rate-limit, данных или провайдера,
  а forgeable global-event bridge удалён. Market ticker показывает FX только при
  ровно одной подтверждённой base currency и валидных положительных ставках;
  live `fxBasis=missing`, поэтому FX-пар `0`, без выдуманного AZN. Релиз
  `37dafd6c`, CI `29912783773` green; backup
  `pre-deploy-2026-07-22T105038Z-37dafd6cb075.sql.gz`; production HEAD/stamp
  exact, app/db/nginx healthy, 27 migrations current, `/login` 200. Свежий
  Playwright EN/RU/AZ после входа дождался фоновых таймеров, выбрал
  `AZSEKER-AZSF`, навёлся и открыл `FP_GROSS_MARGIN`: 11 live matrix cells,
  только GET, mutating / `/explain` / HTTP>=400 / browser errors =
  `0/0/0/0`. Видео/постер/asset-map не создавались: TTS и визуально-аудиальная
  приёмка остаются owner gate.
- Контроль данных (группа) подготовлен и live-verified 2026-07-22: 10-сценовый
  EN/RU/AZ hover-only READONLY-сценарий последовательно покрывает восемь
  admin-маршрутов (Readiness, Indicator Backlog/Health, Statement Controls,
  IFRS, Compliance, Drift и Intel Health) и не нажимает Run/Refresh/email/
  export/upload/inline-entry. До сценария исправлены границы доказательств:
  readiness учитывает только level-2 operational компании, прямой companyId
  баланса, полный non-base FX tuple при ровно одной подтверждённой base currency
  и IndicatorValue выбранного периода; IFRS не смешивает планы и берёт только
  canonical same-plan YTD строки; Indicator Health считает ровно один период и
  честно ограничен сохранёнными строками; Backlog использует org-overrides,
  universal definitions и canonical CompanyIndicator applicability. EN/RU/AZ
  тексты различают stored value, missing pair, shadow и structural check, без
  ложного decision-grade/evidence claim. Независимый adversarial review после
  исправления блокера вернул PASS. Локально: TypeScript clean; focused 7 files /
  54 tests; full Vitest 573 files / 7,282 passed / 121 skipped / 0 failed;
  production build 159 pages. Релиз `2c3add75`, CI `29917465740` green; backup
  `pre-deploy-2026-07-22T120438Z-2c3add75da2e.sql.gz`; production HEAD/stamp
  exact, app healthy, 27 migrations current, `/login` 200. Свежий Playwright
  проверил все 8 экранов во всех EN/RU/AZ (24/24 HTTP 200), включая safe GET
  IFRS scope `2026-05`, 17 BS rows и честные 0 canonical same-plan YTD P&L rows:
  mutating / paid-provider / HTTP>=400 / console+page errors = `0/0/0/0`.
  Визуально просмотрены все восемь EN-кадров и ключевые RU/AZ-кадры; наложений
  не найдено. Видео/аудио/постер/asset-map не создавались: TTS и приёмка владельца
  остаются owner gate, подробный `statement-controls` гайд сохранён отдельно.
- AI Import подготовлен и live-verified 2026-07-22: 9-сценовый EN/RU/AZ
  hover-only READONLY-сценарий остаётся на начальном single-file экране и не
  выбирает файл, не меняет tab, не запускает Analyze/Doctor, reset или Apply.
  UI больше не обещает «любой xlsx» и не утверждает, что все DB writes требуют
  GREEN: постоянное disclosure разделяет локальный file selection, возможный
  платный Anthropic + preview/staging metadata на Analyze, финансовую запись на
  Apply и отдельный destructive cleanup. Удалена ложная legacy-кнопка commit,
  single-file analysis использует год страницы вместо hard-coded 2026, RU/AZ
  reset reason локализован. Adversarial review вернул PASS. Локально: focused
  29/29, TypeScript clean, full Vitest 574 files / 7,288 passed / 121 skipped /
  0 failed, production build 159 pages. Релиз `a9b1d70f`, CI `29919726675`
  green; backup `pre-deploy-2026-07-22T123857Z-a9b1d70fad3c.sql.gz` (994,420
  bytes, mode 0600), production HEAD/stamp exact, app healthy, 27 migrations
  current. Fresh live Playwright: EN/RU/AZ 3/3 HTTP 200, Analyze disabled,
  file empty, 66 requests per locale, mutations / import-or-provider calls /
  HTTP>=400 / browser errors = `0/0/0/0`; все три кадра проверены глазами без
  перекрытий. Видео/аудио/постер/asset-map не создавались: TTS и приёмка остаются
  owner gate.
- Alerts подготовлен и live-verified 2026-07-22: 10-сценовый EN/RU/AZ
  hover-only READONLY-сценарий использует только постоянные anchors и не
  отправляет фильтр, не сбрасывает его, не загружает следующую страницу и не
  открывает terminal deep-link. Экран переименован из ложной полной «истории» в
  последний успешно сохранённый evaluation snapshot: новое успешное сохранение
  атомарно заменяет предыдущий набор, ошибка persistence может оставить старый.
  Empty не считается green; severity — configured priority, а не probability или
  materiality; pagination читает текущий snapshot. Встроенные rule/message
  локализуются по stored key/params, custom fallback остаётся исходным текстом,
  unknown severity не маскируется как info. Events API теперь применяет subgroup
  scope ко всему affected-company set, безопасно досканирует stale-ID keyset
  batches и честно показывает continuation на cap. Deep-link использует отдельный
  deterministic `companyId`, показывается только для singleton company × singleton
  indicator, а resolver повторно проверяет org/subgroup и наличие IV. Два цикла
  adversarial review закрыли pagination, code/id collision, ambiguous pair,
  persistence-copy и cap-empty блокеры; финальный вердикт PASS. Локально:
  focused 48/48, TypeScript clean, full Vitest 576 files / 7,307 passed / 121
  skipped / 0 failed, production build 159 pages. Релиз `0fc01b92`, CI
  `29923712424` green; backup
  `pre-deploy-2026-07-22T133206Z-0fc01b9263fb.sql.gz` (994,425 bytes, mode
  0600), production HEAD/stamp exact, app healthy, 27 migrations current,
  `/login` 200. Fresh live Playwright: EN/RU/AZ 3/3 HTTP 200, 7 rows each,
  localized built-in messages, 64 GET-only requests per locale, mutations /
  provider-or-write / HTTP>=400 / browser errors = `0/0/0/0`; все три кадра
  проверены глазами без наложений. Отдельный safe filter/reset probe дал 2→7
  rows и ровно два Alerts GET, без мутаций/provider/errors. Видео/аудио/постер/
  asset-map не создавались: TTS и приёмка остаются owner gate.
- Board Deck подготовлен и live-verified 2026-07-22: 10-сценовый hover-only
  EN/RU/AZ READONLY-сценарий не нажимает Generate/Refresh, export или drill-down.
  Обычная страница, смена языка, PPTX и PDF теперь читают только exact-snapshot
  cache и никогда не запускают платный AI; генерация вынесена в явный manager-only
  POST с честным cost disclosure и аудитом. Метрики/тренд/flags соблюдают
  `absent != zero/green`, subgroup scope и текущий Baku-месяц. PDF получил
  bounded Chromium runtime (2/min на пользователя/IP, максимум 2 параллельных
  render) и печатает выбранную EN/RU/AZ локаль без sidebar/header/help chrome;
  PPTX локализован тем же evidence-контрактом. Adversarial review вернул PASS.
  Локально: TypeScript clean; focused Board Deck 212+ tests; финальный full Vitest
  591 files / 7,343 passed / 121 skipped / 0 failed; production build 160 pages.
  Релизы `4394f607`, `7180d3e4`, `1e91b79d`; CI `29932400397`, `29934608187`,
  `29936766254` green. Финальный backup
  `pre-deploy-2026-07-22T162054Z-1e91b79d81b7.sql.gz` gzip-valid, mode 0600;
  production HEAD/stamp exact, app healthy, 27 migrations current, `/login` 200.
  Fresh live Playwright: EN/RU/AZ 3/3 HTTP 200, локализованная evidence boundary,
  только GET, mutations / narration endpoint / external / browser errors =
  `0/0/0/0`; PPTX 103,308 bytes и PDF RU 62,961 bytes имеют корректные
  `PK` / `%PDF-` сигнатуры. Первый PDF-кадр проверен глазами: русский текст,
  sidebar/header отсутствуют. Счётчики `board_deck_narrations|AI audit events`
  остались `5|6` до/после — платного вызова и записи не было. Видео/аудио/постер/
  asset-map не создавались: TTS и визуально-аудиальная приёмка остаются owner gate.
- Каждый: сценарий (реальные фичи, показ-в-действии) → запись az → silencedetect +
  покадровая проверка ГЛАЗАМИ → en/ru → deploy → владелец смотрит на проде.
- Реальные данные в кадре; формы открыл→отменил; READONLY на проде; NEVER клик
  сохраняющих кнопок. Карта video-assets.ts: роут → slug.

## Трек 4 — TRUST CORE (продолжение B1, shadow)
- ✅ 4.1 Условие #7: пре-регистрация валютных полов готова как
  shadow-only policy fixture 2026-07-22: `SHADOW_STATEMENT_POLICY` теперь
  заранее содержит AZN/USD/EUR/GBP/TRY/RUB в обеих floor maps и тестом
  закрепляет, что policy остаётся `provisional`. Не включает decision-grade,
  не меняет финансовые строки и не запускает runtime caller.
- ⬜ 4.2 Условие #8: builder-sign тесты на реальных импортах (после Трека 1 данных).
- ✅ 4.3 Stage F/S0 каркас: pure provider-neutral SourceArtifact-shaped contract
  строит существующий DataRevision input с `external_refresh`, явным
  `externalAsOf`, tenant/company scope и воспроизводимым hash exact bytes.
  `current_only` данные принудительно остаются context-only; все результаты
  hard-coded `shadowOnly=true`, `decisionEligible=false`. Без сети, DB write,
  провайдеров, credentials и оплат. Релиз `68fd1016` выкачен и live-verified
  2026-07-22: CI `29882411428` green, production HEAD/stamp exact, smoke 8/8,
  login/terminal Playwright 3/3, container healthy.
- Остальное (#5 scope-materiality, #9 close-cycle, dual-currency) ждёт mart/данных.

## Трек 5 — UX-полировка по фидбеку владельца
(наведённый порядок: admin=настройки; «Контроль данных»/«Данные и операции» видимые;
админ-блок внизу; единый What-if az/en/ru; динамический ярлык скрытия). Новые правки
владельца — сюда же, слайсами с live-проверкой.
- ✅ Единый продуктовый ярлык `What-if` в hotkey toolbar и related-functions
  меню для EN/RU/AZ: релиз `c48202d1`, CI `29886933385` green, production
  HEAD/stamp exact, smoke 8/8, login/terminal Playwright 3/3. Свежий live DOM
  подтвердил обе видимые точки в RU и AZ и отсутствие старых `Что-если` /
  `Nə-əgər`; координаты зафиксированы, 5xx/page/console errors = 0 в
  изолированной проверке. Проверка также обнаружила отдельный P1: обычная
  загрузка терминала сама POST-ила `/api/intel/morning-brief` (4 вызова на два
  locale reload, затем rate-limit 429), а endpoint при настроенном Anthropic
  мог вызвать платный LLM. P1 закрыт следующим слайсом ниже.
- ✅ Платный Anthropic больше не запускается при обычной загрузке терминала.
  Morning Brief (`e85cceea`, CI `29887868551`) и News Summary (`2d6c2049`,
  CI `29888701545`) переведены на явные локализованные Generate/Refresh-кнопки;
  UI передаёт `userInitiated`, а оба API fail-close с `428` до чтения ключа,
  rate-limit, DB и провайдера, если намерение отсутствует. Оба релиза прошли
  полный tsc/Vitest/build, backup+deploy; финальный production HEAD/stamp exact,
  app healthy, 27 migrations current, smoke 8/8, login/terminal Playwright 3/3.
  Свежий live Playwright без intercept на EN/RU/AZ подтвердил обе кнопки и
  **0 Morning Brief + 0 News Summary запросов** после трёх загрузок; прямые
  authenticated probes без intent вернули `428/428`. Платные кнопки не нажимались,
  LLM/provider вызов и финансовые/DB/auth/schema/layout изменения не выполнялись.
- ✅ Динамический ярлык HeatMap уже был реализован релизом `25831ab9`; повторная
  реализация не нужна. Свежий production Playwright 2026-07-22 на текущем
  `2d6c2049` подтвердил во всех EN/RU/AZ два полных цикла: collapsed-кнопка
  предлагает `Show all` / `Показать все` / `Hamısını göstər`, expanded-кнопка —
  `Hide non-applicable` / `Скрыть неприменимые` / `Uyğun olmayanları gizlət`,
  `aria-pressed` синхронно меняется `true→false→true`. Проверка: 1/1 green,
  paid AI requests = 0, browser errors = 0; код, baseline и production state
  не менялись.
- ✅ Навигационный пакет владельца (`Админ = настройки`, видимые `Контроль
  данных` / `Данные и операции`, весь admin-блок внизу) уже выпущен релизами
  `e9e39d68` и `799a217e`; повторная правка не нужна. Свежий production
  Playwright 2026-07-22 на `2d6c2049` для EN/RU/AZ подтвердил: `Settings`
  расположен перед двумя видимыми admin-группами, затем идёт последний
  `Admin Tools`; landing `/budgeting/admin` содержит ровно 8 карточек только
  `Configuration` + `Data sources`, без Statement controls/Queue. Проверка
  1/1 green, paid AI requests = 0, browser errors = 0; код и prod не менялись.
  Таким образом исходный UX-пакет Трека 5 полностью закрыт; новые замечания
  владельца добавляются отдельными слайсами.

## Жёсткие рамки (нарушать нельзя)
1. Деплой: ТОЛЬКО bash deploy/update-prod.sh, ТОЛЬКО после CI green. Бэкап делает скрипт.
2. После КАЖДОГО user-facing деплоя — проверка на живом проде свежим браузером
   (замеры DOM/чисел). Урок сессии: не говорить «готово» без этого.
3. Платные провайдеры (Moody's, S&P, FactSet, paid Google Trends…) — НЕ активировать,
   credentials НЕ хранить. Только по отдельному явному «go» владельца.
4. Prod auth/пароли/passwordHash — не трогать. Prisma-миграции — только additive,
   отдельным слайсом с ревью.
5. Защищённые пути: .claude/settings.json, output/, scripts/*-local.ts. Никогда
   git add . / -A; коммиты path-scoped.
6. Terminal-визуал: layout-файлы из CLAUDE.md → визуальный гейт (на этом боксе
   не запускается — компенсировать live-проверкой и не трогать baseline PNG).
7. i18n: az/en/ru паритет в каждом слайсе. Financial data = НЕ выдумывать
   (absent ≠ zero); shadow-поверхности не называть decision-grade.
8. Тяжёлые правки — через design-workflow → сабагент-реализация → adversarial
   review → полный гейт. Дешёвую рутину — сабагентам с дешёвой моделью.

## Гейты владельца (только это спрашивать)
- Данные Трека 1 (файлы/цифры) · вопросы клиента (2.1) · приёмка видео-разделов
  (смотрит на проде, может попросить пересъёмку) · коммерческие решения Stage F ·
  переезд прода на dev-бокс + TLS/домен (отложено) · декомиссия старого прода.
