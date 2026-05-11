# Чистка демо-данных AZMADE — пошаговая инструкция

**Когда применять:** перед демо клиенту, чтобы в БД остались только реальные данные из xlsx.

**Что было:** скрипты `seed-azmade-rich.ts` / `seed-azmade-actuals.ts` / `seed-azmade-companies.ts` / `seed-demo-co.ts` / `seed-demo-companies.ts` создавали синтетические данные (Cash Flow, Balance Sheet, Sales Budget, COGS, Forecasts, Actuals) поверх реальных budget_lines клиента. Это приводило к показу выдуманных цифр в табах.

**Что станет:** только реальные данные клиента из P&L (то что импортировано через `import-azmade-budgets.ts` из 6 xlsx-файлов в `/Users/rashadrahimov/Documents/budgets azmade/` + `/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx`).

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

## Шаг 5 (на будущее) — Расширить парсер на BS / CF / Actuals

Сейчас `import-azmade-budgets.ts` берёт только sheet `SOPL` / `P&L` (P&L данные). В реальных файлах есть ещё:

| Файл | Доп. sheet'ы | Что можно импортировать |
|---|---|---|
| rev6 LLS | `Balans`, `CF`, `SOFP`, `CFS` | Balance Sheet (Balans/SOFP) + Cash Flow (CF/CFS) |
| rev7 SPARK | `Balans`, `CF`, `SOFP`, `CFS`, `CAPEX` | BS + CF + CAPEX |
| rev8 ZTP | `SOPL P-F`, `Production-2024/2025`, `Satış`, `CFS P-F` | Actuals (P-F = Plan-Fact) + Production data + Sales |
| rev9 ATL | `SOPL P-F DBZ/PMZ/TAZ` (Plan-Fact), `Consolidated PL/BS/CF` | Actuals для всех ATL дочек |
| AAC | `BS`, `CF`, `S-1..S-6` (продукты), `COGS`, `Historical` | BS + CF + Sales by product + COGS detail |
| ATL Budce объяснит. | `material`, `maya dəyəri`, `kontragent`, `stok`, `2026 capex alış/ödəmə` | Material costs + COGS + AR/AP + Stock + CAPEX |

**Эта работа — отдельная задача (~3-5 часов с тестами).** Расширение `parseSoplSheet` → ещё `parseBalansSheet` + `parseCashFlowSheet` + `parsePlanFactSheet` (для actuals).

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
