# Trade Spend Control Tower — Design Plan (Phase 9)

**Created:** 2026-07-06 · **Customer:** Mars Overseas Baku Ltd · **Status:** Plan approved-in-principle, assumptions pending customer validation.
**Design source:** Codex architect session `019f37a6-5ea7-7850-9aa3-d8a0cde5e51c` (gpt-5.5, xhigh) + customer requirements relayed by Rashad.

## 1. What the customer asked for

Trade Marketing budget monitoring & forecasting: trade budget derived from the sales plan, daily spend tracking (Plan / Accrued / Actual), remaining-budget + month-end run-rate forecast visible by day 15–20 (not month-end), alert inbox, campaign cards with approval, drill-down `region → channel → sales rep → customer/outlet → SKU/category → campaign`. Phase 2: claim/deduction matching, ROI, what-if simulation, role-based dashboards. Explicitly agreed: **no AI forecasting in MVP** — transparent run-rate math finance can verify by hand.

## 2. Customer profile (researched 2026-07-06)

Mars Overseas Baku — exclusive PepsiCo bottler/distributor in Azerbaijan since 1999. Brands: Pepsi, Mountain Dew, Lay's, Jala, Natura, Mia, Bağdan (beverages, juices, snacks). DSD distribution: modern trade chains (Bravo, Araz, OBA, Rahat…), traditional trade outlets nationwide, HoReCa/wholesale, route sales reps.
Sources: [marsoverseas.az](https://marsoverseas.az/en), [LinkedIn](https://az.linkedin.com/company/pepsi-bottlers-azerbaijan), [rocketreach profile](https://rocketreach.co/pepsi-bottlers-azerbaijan-mars-overseas-baku-ltd-profile_b7f24fbfc25d816b).

## 3. Working assumptions (VALIDATE WITH CUSTOMER — each has a fallback)

| # | Question | Assumed answer | If wrong |
|---|----------|----------------|----------|
| A1 | Data source & cadence | ✅ **CONFIRMED 2026-07-06 (Rashad ← customer):** ERP is **Mikro** today, **1C migration planned**; daily invoice-level export CAN be provided. MVP = daily file drops via existing AI Import (no API integration). File contract = §3.1 below (our best-practice proposal, pending customer sign-off). | Weekly files → pacing granularity degrades gracefully (freshness banner shows as-of date). |
| A2 | Trade spend types | on-invoice discount (auto-accrual at invoice), retro bonus (formula accrual), promo payments & listing fees (actual on payment), free goods (COGS valuation), POSM/merchandising. | `TradeSpendType` is a per-org dictionary — add/remove types without schema change. |
| A3 | Budget rule | % of monthly sales plan per channel/category/brand (beverage industry norm 3–10% of turnover; PepsiCo principal funds part of it). Mid-month changes approved by finance. | `TradeBudgetPool.budgetPct` is per-pool, editable; absolute-amount pools also supported. |
| A4 | Volume | 10–25k active outlets, 200–600 SKUs, up to ~50–100k invoice lines/day. → raw lines stay in staging; persist **daily aggregates** per date×outlet×SKU×rep×channel×region. | Aggregation grain can coarsen (drop SKU from daily fact) if volume is higher. |
| A5 | Sales plan granularity | Monthly only (from `SalesBudgetLine`). Daily pacing uses working-day profile to spread the month. | If daily route plans exist in SFA, `TradePlanDaily` ingests them directly. |
| A6 | Deduction direction | Both: distributor gives discounts downstream (traditional trade) AND receives deductions from modern-trade chains. Matching = Phase 2; `entryGroupKey` hook in ledger from day 1. | — |
| A7 | Single customer vs product | Build for Mars Overseas first but fully org-scoped (same app-layer isolation as the rest); RLS rollout unchanged (Phase 5.2). | — |

### 3.1 Daily file contract (best practice — propose to customer, 2026-07-06)

Customer asked "what is best practice?" for the daily feed. Proposal (maps 1:1 onto `TradeImportBatch` supersede design):

1. **Full-day snapshot files, not deltas.** One file per business day (`sales_YYYY-MM-DD.xlsx`), containing ALL invoices for that date. Corrections = re-send the whole day's file; the system supersedes the old batch (old rows deactivate, never delete — full audit trail). No delta/append logic to get wrong on either side.
2. **Cutoff:** day D file delivered by D+1 09:00. Late file → the dashboard shows an explicit "data as of <date>" staleness banner (freshness watchdog), never a fake low-spend signal.
3. **Returns/credit notes** appear as negative-amount lines carrying the original invoice reference — same file, no separate flow.
4. **Idempotency by content hash:** the same file uploaded twice is a no-op (`fileHash` unique per org+kind). No accidental double-counting.
5. **Control sums:** each file's grand totals (rows, gross, net) are stored on the batch and reconciled against parsed output — a mismatch fails the import loudly.
6. **No manual DB edits.** Every correction flows through a re-sent file or an approval-gated manual adjustment entry (auditable).
7. **Closed months are locked** (existing period-lock infra): restating a locked month requires an approval request, not a silent overwrite.
8. **Date semantics fixed once:** invoice date vs delivery date vs posting date — agreed in the import contract before adapter development; the system keys pacing on ONE of them consistently.

## 4. Architecture (Codex plan — accepted)

**Core decision: a separate org-scoped operational mart.** Do NOT bend `BudgetLine`/`BudgetActual`/`SalesBudgetLine` (monthly, account-level) into daily trade facts. Monthly budgeting stays the planning source; trade gets its own dimensions, facts, ledger, pacing snapshots, campaign state under `Trade*` models.

Key decisions:
- **`TradeSku` separate from `ProductLine`** (optional FK link). ProductLine = monthly planning grain; SKU/pack/barcode = invoice grain.
- **One append-only spend ledger** (`TradeSpendLedger`, `entryKind = plan|accrued|actual`), not three tables, not mutable columns. UI pivots the ledger into the three figures. `entryGroupKey` ties plan→accrual→actual postings (Phase-2 claim matching hook). Corrections via voids/negative postings, never deletes.
- **Raw invoice rows never become a permanent fact table.** `TradeImportBatch` (file hash, supersedes-chain, isActive) + `TradeSalesActualDaily` aggregates. Restatement = new batch deactivates old one.
- **Daily plan is materialized** (`TradePlanDaily`) from monthly `SalesBudgetLine` × working-day weights → pacing math is transparent and reproducible.
- **Pacing engine lives in `src/lib/trade/`**, NOT in `src/lib/risk/recompute.ts` (risk recompute is indicator/heatmap-oriented). Later trade KPIs can be exposed to the terminal as derived indicators.
- **Control number:** `controlSpendMtd` = accrued for on-invoice/retro types, actual for payment-only types — never blindly accrued+actual. Accrued and actual always shown separately.

**Pacing math (MVP, no AI):**
```
elapsedWeight          = workingDayWeight(monthStart..asOf) / workingDayWeight(month)
salesAchievementPct    = salesActualMtd / salesPlanMtd
spendPct               = controlSpendMtd / budgetMonth
forecastSpendMonth     = controlSpendMtd / elapsedWeight
forecastBudgetVariance = forecastSpendMonth - budgetMonth
```
Every `TradePacingSnapshot` row stores its inputs in a `math` Json column so finance can audit the arithmetic.

**New models (full field draft in Codex session log):** `TradeRegion`, `TradeChannel`, `TradeSalesRep`, `TradeOutlet`, `TradeSku`, `TradeBudgetPool`, `TradeBudgetAllocation`, `TradeCampaign`, `TradeCampaignScope`, `TradeSpendType`, `TradeSpendLedger`, `TradeImportBatch`, `TradeSalesActualDaily`, `TradePlanDaily`, `TradePacingSnapshot`. Enums: `TradeCampaignStatus`, `TradeAccrualMethod`, `TradeSpendEntryKind`, `TradeRiskStatus`, `TradeImportKind`, `TradeImportStatus`.

**Minimal extensions to existing models:** `Alert` gains `domain`/`dedupeKey`/`resolvedAt` (nullable); `ApprovalRequestType` gains `trade_campaign_*` + `trade_spend_manual_adjustment`; `AuditAction` gains `trade_import_apply`, `trade_campaign_submit/approve`, `trade_spend_adjustment`, `trade_pacing_recompute`.

**Reused infra:** AI Import pipeline (new `SheetDataType`s + adapters in `src/lib/onboarding/ai-import/`), `ApprovalRequest`, `Alert`/`AlertRule` evaluator (trade rules under `condition.domain="trade"`), `AuditEvent`, period locks (`lockedResponse`), freshness watchdog pattern for late/missing daily files.

**New surface:** `src/lib/trade/` (allocation, accrual, pacing, alerts, imports, drilldown + tests), `src/app/api/trade/*`, `src/app/(dashboard)/budgeting/trade/page.tsx`, `src/features/trade/components/*`, i18n EN/RU/AZ.

## 5. Shipping order (each step independently demoable)

1. ⬜ Schema foundation — dimensions, spend types, import batch. Demo: master-data lists + empty Trade page.
2. ⬜ AI Import adapters for master data (outlets/SKUs/reps). Demo: preview/apply with validation.
3. ⬜ Budget derivation from `SalesBudgetLine` — pool + allocation tree. Demo: "sales plan × % = trade budget".
4. ⬜ Campaign cards + approval workflow. Demo: draft → pending → approved/active.
5. ⬜ Daily sales-actual ingestion — invoice adapter, batch restatement, daily aggregates. Demo: drill-down actuals.
6. ⬜ Spend ledger + accrual engine (on-invoice, retro formula, payment, free goods, POSM). Demo: Plan/Accrued/Actual columns.
7. ⬜ Pacing snapshots — working-day profile, run-rate engine, `/api/trade/pacing`. Demo: transparent risk math.
8. ⬜ Trade alerts — overspend forecast, spend-ahead-of-sales, unplanned spend, unused budget, discount-without-uplift. Demo: alert inbox.
9. ⬜ Drill-down UI + performance pass — terminal-style filters, campaign drawer, export.
10. ⬜ Phase-2 hooks only — nullable claim/deduction refs. NO claim matching / ROI / what-if UI in MVP.

## 6. Risks & edge cases (from Codex review)

- **Double-counting & restatements** — the #1 risk. Batch-scope all imports; supersede old batches; voids/negative postings only. (This repo has scar tissue here — see collateral-guard work in ROADMAP changelog 2026-06-16.)
- **Campaign overlap** (same outlet/SKU/day in two campaigns) — must be explicit: flag overlap, block auto-attribution or split by priority; never silently count uplift twice.
- **Month boundaries** — campaigns cross months; pools/pacing are monthly → campaign budget allocated per-month internally.
- **Late/missing daily files** — day-20-without-file must show "data stale", not fake low-spend. Wire into freshness watchdog.
- **Returns/credit notes** — negative sales/qty, must reduce uplift. Fix invoice-date vs delivery-date vs posting-date in the import contract once, up front.
- **AZN-only MVP** — reject non-AZN files loudly.
- **No RLS** — every query/mutation carries `organizationId` (existing `withOrgScope` pattern).
- **Mikro → 1C ERP migration mid-project** (confirmed planned, no date) — file formats WILL change. Mitigation is already structural: AI Import classifier absorbs column/layout changes; `TradeImportBatch.sourceSystem` distinguishes `mikro`/`1c` batches; dimension matching keys on `externalCode`, so the 1C cutover needs only a code-mapping table if 1C re-codes outlets/SKUs. Ask the customer to preserve Mikro codes in 1C if possible.

## 6.1 Implementation status

- **9.1 schema foundation — shipped 2026-07-06.** Migration `20260706140328_trade_control_tower_foundation`: enums `TradeAccrualMethod`/`TradeImportKind`/`TradeImportStatus`; models `TradeRegion`, `TradeChannel`, `TradeSalesRep`, `TradeOutlet`, `TradeSku` (optional bridge to `ProductLine`), `TradeSpendType`, `TradeImportBatch`. Helpers + defaults in `src/lib/trade/spend-types.ts` (A2 spend-type dictionary seed, `controlKindForAccrualMethod` pacing rule).
- **9.2 master-data import + Trade page — shipped 2026-07-06.** Deterministic header-synonym parser (`src/lib/trade/master-import.ts`, Mikro/AZ/RU/EN synonyms, NO LLM — AI classifier reserved for 9.5 invoice files); `POST /api/trade/master-import` preview/apply (batch supersede, sha256 idempotency, auto-derived regions/channels, placeholder reps); `GET /api/trade/overview`; spend-type seed; `/budgeting/trade` page + sidebar «Trade Tower» + EN/RU/AZ i18n; `trade_import_apply` audit action (typed registry end-to-end). Live-verified E2E with Azeri-header xlsx; full suite 6218 green. **When first real Mikro exports arrive: extend the synonym lists in `master-import.ts` — current headers are researched defaults, not verified samples.**
- **9.4 campaign cards + approval — shipped 2026-07-06.** TradeCampaign/Scope models, activation via existing ApprovalRequest (`trade_campaign_activate`), `trade_campaign_review` audit, cards UI. Live E2E verified.
- **9.7 pacing engine — core shipped 2026-07-06.** `src/lib/trade/pacing.ts` (computePacing + weekday weights + spreadMonthlyPlan, auditable `math`), TradePlanDaily/TradePacingSnapshot models. Endpoint + snapshot generation blocked on 9.3/9.5 data.
- **9.8 alert inbox — core shipped 2026-07-06.** Alert model activated (domain/dedupeKey/resolvedAt), 3/5 rules (overspend forecast, spend-ahead-of-sales, unused budget) + auto-resolve sync, inbox UI, ack + recompute endpoints. Live E2E verified. Remaining 2 rules need 9.5/9.6 data.
- **Next: 9.3** — trade budget derivation from `SalesBudgetLine` (pool + allocation tree). **Gated on customer answers A2/A3** (spend-type inventory, budget %, principal funding split). Ready-to-send question letter: `docs/MARS_OVERSEAS_QUESTIONS.az.md`.

## 7. Before implementation starts

- [x] ~~Validate A1~~ — confirmed 2026-07-06: Mikro ERP (1C migration planned), daily export feasible. File contract (§3.1) still needs customer sign-off.
- [ ] Validate A2 (spend-type inventory + when each amount becomes known) and A3 (budget %, principal funding split, mid-month approval) — customer will answer later; work proceeds on assumptions with fallbacks.
- [ ] Get one real daily invoice export (Mikro, as-is) + one month of trade-spend records + sales plan sample + outlet/SKU master lists for adapter development.
- [ ] Confirm commercial scope (MVP steps 1–9 vs Phase 2 items) before quoting.
