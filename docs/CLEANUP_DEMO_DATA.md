# Чистка демо-данных AZMADE — пошаговая инструкция

**Когда применять:** перед демо клиенту, чтобы в БД остались только реальные данные из xlsx.

**Что было:** скрипты `seed-azmade-rich.ts` / `seed-azmade-actuals.ts` / `seed-azmade-companies.ts` / `seed-demo-co.ts` / `seed-demo-companies.ts` создавали синтетические данные (Cash Flow, Balance Sheet, Sales Budget, COGS, Forecasts, Actuals) поверх реальных budget_lines клиента. Это приводило к показу выдуманных цифр в табах.

**Что станет:** только реальные данные клиента из P&L (то что импортировано через `import-azmade-budgets.ts` из 6 xlsx-файлов в `/Users/rashadrahimov/Documents/budgets azmade/` + `/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx`).

---

## TL;DR — 3 команды для полной чистки + импорта

```bash
node scripts/audit-azmade-data.cjs                    # 1. посмотреть что в БД
node scripts/cleanup-fake-azmade-data.cjs --execute    # 2. удалить фейки
bash scripts/import-azmade-all.sh                      # 3. импорт всех реальных данных (P&L + BS + CF + Sales)
```

После этого браузер:
- `/budgeting?tab=pnl-report` — реальный P&L клиента
- `/budgeting?tab=balance-sheet` — реальный BS (5/5 компаний)
- `/budgeting?tab=cash-flow` — реальный CF (5/5)
- `/budgeting?tab=sales-budget` — реальные продукты AAC
- `/budgeting/terminal` — Risk Terminal HeatMap на реальных данных

---

## Шаг 0 — Аудит (опционально, посмотреть что в БД)

```bash
node scripts/audit-azmade-data.cjs
```

Покажет: реальные vs фейковые компании, кол-во строк по таблицам, по какому source. **Ничего не удаляет.**

## Шаг 1 — Dry-run cleanup (без удаления, чтобы посмотреть что будет удалено)

```bash
node scripts/cleanup-fake-azmade-data.cjs
```

Покажет per-table counts и список фейковых компаний. **Ничего не удаляет.**

## Шаг 2 — Реальное удаление фейков

```bash
node scripts/cleanup-fake-azmade-data.cjs --execute
```

Удаляет:
- 30 фейковых компаний `AZ-*` (Demo Hospitality, Demo Agro, …) + cascade их `bookings` / `operational_facts` / `budget_lines` / `indicator_values`
- Все строки в `sales_budget_lines`, `cogs_budget_lines`, `balance_sheet_lines`, `budget_assumptions`, `sales_forecasts`, `expense_forecasts`, `rolling_forecast_months`, `budget_forecast_entries`, `budget_actuals`, `budget_departments`, `budget_cost_types`, `product_lines` для AZMADE org
- `cash_flow_entries` где `source='plan'` (это маркер seed-azmade-rich)
- `cash_flow_alerts` (регенерируются автоматически)
- Org `demo` целиком (если существует) с каскадом

**НЕ удаляет:**
- AZMADE org
- Реальные компании: AAC, ATL, SPARK, ZTP, LLS + дочки ATL (MRKZ/DBZ/PMZ/TAZ) + *-MAIN
- `budget_lines` (реальные плановые из xlsx)
- `chart_of_accounts` (реальный CoA)
- `currency_rates`, `indicator_definitions`, `industries`, `scenarios`

## Шаг 3 — Что увидит клиент после чистки

| Таб | Поведение после чистки |
|---|---|
| **P&L Report** (`?tab=pnl-report`) | ✅ Реальные плановые данные клиента, Variance vs Actual покажет 100% (потому что actuals = 0) |
| **Sales Budget** (`?tab=sales-budget`) | ⚪ Пусто (не было реальных данных) |
| **COGS** (`?tab=cogs`) | ⚪ Пусто |
| **Balance Sheet** (`?tab=balance-sheet`) | ⚪ Пусто |
| **Cash Flow** (`?tab=cash-flow`) | ⚪ Пусто; кнопка «Generate from Budget» построит из реального плана |
| **Assumptions** | ⚪ Пусто |
| **Workspace / P&L Plan / Forecast / Comparison / Plans** | ✅ Работают на реальных budget_lines |
| **Sales/Expense Forecasts / Rolling** | ⚪ Пусто |
| **Risk Terminal HeatMap** | ✅ Реальные компании AAC/ATL/SPARK/ZTP/LLS (без 30 фейков) |
| **Board Deck** | ✅ Реальные данные |

## Шаг 4 (опционально) — Сгенерировать Cash Flow из реального плана

В UI на табе Cash Flow → жми **«Generate from Budget»**. Эндпоинт `/api/budgeting/cash-flow/generate` возьмёт `budget_lines` и построит cash flow:
- `lineType=revenue` → inflow
- остальное → outflow
- Делит `plannedAmount` равномерно по месяцам периода плана

Получишь cash flow производный от плана клиента — не фейк, а derived.

## Шаг 5 — Импорт реальных BS + CF из xlsx (CXXXIV — готово!)

```bash
npx tsx scripts/import-azmade-bs-cf.ts
```

Запускает новые парсеры (`parseSofpSheet` + `parseCfsSheet`) и заполняет:

- `balance_sheet_lines` — ~2500 строк (54 BS позиции × 12 месяцев × 4 файла: LLS / SPARK / ZTP / ATL)
- `cash_flow_entries` (source=`xlsx_import`) — ~900 entries (Operating / Financing / Investing) для LLS / SPARK / ZTP / ATL + AAC

**Известное ограничение:** AAC BS использует Excel date serials как headers вместо названий месяцев — парсер их сейчас не понимает, пропустит этот sheet с warning. AAC CF (английские месяцы Jan..Dec) — работает.

После Шага 5 в UI:
- **Balance Sheet таб** — реальные данные клиента для LLS / SPARK / ZTP / ATL (consolidated)
- **Cash Flow таб** — реальные движения с разделением Operating / Financing / Investing для всех 5 компаний

## Шаг 6 — Импорт реальных Sales by product для AAC (CXXXVI — готово!)

```bash
npx tsx scripts/import-azmade-sales.ts
```

Запускает `parseAacSalesAllSheet` против AAC `S-all` → создаёт 6 ProductLine (MHB, LIME_BURNT, LIME_SLAKED, ADHESIVE, LIME_WASTE, UBLOCK) + 72 строки `sales_budget_lines` (6 продуктов × 12 месяцев). Реальные суммы из xlsx клиента:

- MHB: 13.3M ₼ годовых
- Əhəng yanmış (burnt lime): 2.6M ₼
- Əhəng sönmüş (slaked lime): 616K ₼
- Yapışqan (adhesive): 577K ₼
- Əhəng tullantı (lime waste): 8K ₼
- U-block: 65K ₼

После этого Sales Budget таб для AAC покажет реальную продуктовую разбивку. Другие компании (LLS / SPARK / ZTP / ATL) продают услуги или другие форматы — для них Sales Budget таб остаётся пустым (их revenue видна в P&L через 601-xx счета).

## Шаг 7 (опционально) — расширить парсер дальше

Что ещё в реальных файлах НЕ парсится:

| Файл | Sheet'ы НЕ парсятся | Что можно добавить |
|---|---|---|
| rev8 ZTP | `Production-2024/2025` (1000+ строк), `Satış` (1039 строк), `CAPEX-2026` | Production data + Sales detail + CAPEX schedule |
| rev9 ATL | `SOPL P-F DBZ/PMZ/TAZ 2026` (Plan-Fact) | Per-entity actuals (fakt сейчас = 0 для 2026 — нужно ждать середины года) |
| AAC | `S-1..S-6` (продуктовая разбивка MHB/Lime/...), `COGS` (детальный COGS), `Historical` | Sales by product + COGS breakdown + multi-year history |
| ATL Budce объяснит. | `material`, `maya dəyəri`, `kontragent`, `stok`, `2026 capex alış/ödəmə` | Material costs + COGS detail + AR/AP + Stock + CAPEX |

**Каждое расширение — отдельный парсер (~1-2 часа с тестами).** Файлы готовы — можно делать по приоритету клиента.

### Известные TODO:
- **AAC BS** использует Excel date serials как заголовки месяцев (`45657/46053/...`) вместо `Yanvar/Jan/...`. Нужно расширение парсера `parseSofpSheet` — детекция последовательности Excel date serials в нужном диапазоне (Jan-Dec 2026).
- **Per-entity ATL BS/CF** — `SOFP P-F DBZ 2026` / `CFS P-F DBZ 2026` есть в rev9, но требуют parser для Plan-Fact формата (текущий импорт берёт только консолидированную SOFP/CFS).

## Что было удалено из кодовой базы

5 seed-скриптов с фейками переименованы в `.disabled.ts` чтобы случайно не запустились:

```
scripts/seed-azmade-rich.disabled.ts
scripts/seed-azmade-actuals.disabled.ts
scripts/seed-azmade-companies.disabled.ts
scripts/seed-demo-co.disabled.ts
scripts/seed-demo-companies.disabled.ts
```

Чтобы вернуть (если когда-то понадобятся для теста на dev):
```bash
git mv scripts/seed-azmade-rich.disabled.ts scripts/seed-azmade-rich.ts
```

## Что осталось активным

```
scripts/seed-azmade-holding.ts        — структура реальных компаний AZMADE
scripts/import-azmade-budgets.ts      — импорт реальных P&L из 6 xlsx файлов
scripts/seed-currency-rates.ts        — фактические курсы валют
scripts/seed-indicators.ts            — каталог 52 risk-индикаторов
scripts/seed-industries.ts            — шаблоны Chart of Accounts по индустриям
scripts/seed-scenarios.ts             — сценарии для stress-test
scripts/verify-azmade-vs-xlsx.ts      — сверка БД vs xlsx (read-only)
scripts/audit-azmade-data.cjs         — НОВЫЙ read-only аудит фейк vs real
scripts/cleanup-fake-azmade-data.cjs  — НОВЫЙ удаление фейков (с --execute)
```
