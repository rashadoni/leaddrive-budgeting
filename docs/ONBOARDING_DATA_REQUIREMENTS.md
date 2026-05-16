# Company Onboarding — Data Requirements Checklist

**Audience:** finance team of an incoming company (or the FO Holding M&A
team requesting data from a portfolio sub-co). All file/field names are
in **English** so the recipient can route them to bookkeepers / ERP
admins without translation overhead.

**Outcome of full submission:** every section of BudgetPro lights up
(P&L, Sales, Balance Sheet, Cash Flow, Forecast, Assumptions, Risk
Terminal indicators) for this company; the `Verified` trust badge
appears in the Company Tree.

---

## Section 0 — Company profile (mandatory, 1 page)

| # | Field | Format | Notes |
|---|---|---|---|
| 0.1 | Legal entity name | string | "Azərşəkər MMC" |
| 0.2 | Short code | UPPER_CASE | "AZSEKER" — used throughout the app |
| 0.3 | Tax ID (VÖEN) | string | for audit / reporting compliance |
| 0.4 | Parent holding | reference | "FO Holding" / "AZMADE" / "AZSEKER" |
| 0.5 | Sub-entities (level-2 op-cos) | list | EDEN, AZSF, CPC, FARM, HORIZON |
| 0.6 | Industry classification | one of: `agro_crops`, `food_processing`, `services`, `industrial`, `hospitality`, `real_estate`, `pharma`, `entertainment`, `education`, `poultry`, `beverage`, `retail`, `logistics`, `construction` |
| 0.7 | Reporting currency | ISO code | AZN / USD / EUR |
| 0.8 | FX rate source | URL / convention | CBAR daily? End-of-month? |
| 0.9 | Fiscal year | calendar / custom | Most are Jan–Dec |
| 0.10 | Chart of Accounts template | reference | We have 10 industry templates pre-seeded; pick one or send custom |
| 0.11 | Number of employees | integer | Drives per-head productivity metrics |

---

## Section 1 — Chart of Accounts (CoA)

**Why:** every BudgetLine, BalanceSheet entry, and Indicator formula
references an account code. Without this, nothing else can be imported.

**Format:** one Excel file `CHART_OF_ACCOUNTS_<CODE>.xlsx` with columns:

| Column | Type | Example | Notes |
|---|---|---|---|
| `code` | string | `601-04-01` | Hierarchical, dash-separated |
| `name_en` | string | "Revenue from Wheat" | Mandatory |
| `name_az` | string | "Buğda satışından gəlir" | Optional |
| `name_ru` | string | "Выручка от продажи пшеницы" | Optional |
| `account_type` | enum | `revenue` / `cogs` / `expense` / `asset` / `liability` / `equity` | Per IFRS / GAAP |
| `parent_code` | string | `601-04` | For tree structure |
| `is_active` | boolean | true | inactive accounts hide in dropdowns |

**Special markers we use internally:**
- D&A codes — typically `703-11` (COGS-side) and `721-11` (OPEX-side); the
  client tells us which numbering they use so EBITDA add-back works.
- VAT-input account, VAT-output account.

---

## Section 2 — Budget (P&L plan) — monthly per company

**Why:** powers `/budgeting?tab=pnl-report` (revenue vs COGS chart, EBITDA
cards, waterfall, monthly trend).

**Format:** one file per legal entity OR one consolidated file with
sheets per entity. Each sheet contains the canonical PLF.01–PLF.10
structure (we use this for AzərŞəkər already):

```
PLF code      Label                      M1   M2  ...  M12   Annual
PLF.01        REVENUE                    ...  ...      ...   ...
PLF.01.01     Revenue from Products
PLF.01.01.01    Revenue from Wheat       ...
PLF.01.01.02    Revenue from Sugar Beet
PLF.01.02     Revenue from Other Sources
PLF.02        COST OF GOODS SOLD (negative)
PLF.02.01.01    Wheat Costs              ...
PLF.03        GROSS PROFIT (formula)
PLF.04        Sales & Marketing (negative)
PLF.05        Administrative (negative)
PLF.06        Other operating expenses
PLF.07        EBITDA (formula)
PLF.08        D&A (negative)
PLF.09        EBIT
PLF.10        NET PROFIT / (LOSS)
```

Required for: every legal entity that posts to a P&L. Currency = same
as the company's reporting currency from §0.7.

---

## Section 3 — Sales budget (product × month detail)

**Why:** powers `/budgeting?tab=sales-budget`. Without this, the Sales
tab shows "no data available" even when P&L has revenue lines.

**Format:** one file `SALES_BUDGET_<CODE>_<YEAR>.xlsx` with columns:

| Column | Type | Example |
|---|---|---|
| `product_code` | string | "WHEAT-2026" |
| `product_name` | string | "Hard red winter wheat" |
| `customer_segment` | string | "B2B wholesale" / "Export" / "Retail" |
| `unit` | string | "ton" / "litre" / "piece" / "room-night" |
| `currency` | ISO | "AZN" |
| `m1_qty` ... `m12_qty` | number | monthly volume |
| `m1_unit_price` ... `m12_unit_price` | number | monthly avg ASP |
| `m1_revenue` ... `m12_revenue` | computed | `qty × price` |
| `account_code` | string | "601-04-01" (links to CoA) |

For services companies replace `qty` with `service-units` (consulting hours,
booking-nights, support tickets, etc.).

---

## Section 4 — COGS budget (per-product cost build-up)

**Why:** powers `/budgeting?tab=cogs`. Allows gross-margin drill-down per
product.

**Format:** `COGS_BUDGET_<CODE>_<YEAR>.xlsx` with columns:

| Column | Type |
|---|---|
| `product_code` | matches Sales |
| `cost_element` | "Raw material" / "Direct labor" / "Logistics" / "Packaging" |
| `unit_cost` | per-unit |
| `m1_qty` ... `m12_qty` | volume |
| `m1_amount` ... `m12_amount` | total |
| `account_code` | CoA reference |

---

## Section 5 — Balance Sheet (annual + opening)

**Why:** `/budgeting?tab=balance-sheet` + ratio indicators
(IND_LEVERAGE, IND_INVENTORY_TURNS, IND_DSO, IND_DPO, IND_CCC).

**Format:** `BALANCE_SHEET_<CODE>_<YEAR>.xlsx`

**Assets** (12 months):
- Cash & equivalents
- Trade receivables
- Inventory (raw, WIP, finished)
- Other current assets
- PP&E (gross + accumulated depreciation)
- Intangibles
- Long-term investments

**Liabilities** (12 months):
- Trade payables
- Short-term loans
- Long-term debt
- Tax payable
- Other liabilities

**Equity**:
- Share capital
- Retained earnings
- Reserves
- Profit for period

Need opening balance at Jan 1 + closing balances at end of each month.

---

## Section 6 — Cash Flow

**Why:** `/budgeting?tab=cash-flow` + liquidity indicators.

**Format:** indirect-method statement with monthly columns:

```
Operating:
  Net income
  + D&A
  ± Δ working capital (AR, Inventory, AP)
  ± Other non-cash
Investing:
  CAPEX
  Asset disposals
  Acquisitions
Financing:
  Debt drawdown / repayment
  Dividends paid
  Equity issuance
Net change in cash
Opening cash
Closing cash
```

Alternative: provide bank statements + transaction log; we'll bucket
into the categories.

---

## Section 7 — Actuals (for variance analysis)

**Why:** `/budgeting?tab=comparison` + management view. Without actuals
the system shows only "planned" numbers.

**Format:** monthly journal extract from GL/ERP — same shape as Budget
P&L but populated from real bookings:

| Column | Notes |
|---|---|
| `period` | "2026-01" |
| `account_code` | CoA |
| `entity_code` | level-2 op-co |
| `amount` | AZN |
| `currency` | original currency |
| `fx_rate` | applied rate |
| `source_document` | invoice / receipt / bank-statement ref |
| `posted_date` | accounting date |

If the ERP can export this directly (1C, SAP, Oracle, QuickBooks),
that's the cleanest path.

---

## Section 8 — Assumptions

**Why:** `/budgeting?tab=assumptions` lets the planner stress-test the
plan against macro shifts.

**Format:** key-value list:
- AZN/USD forward curve (or single rate per year)
- AZN/EUR forward curve
- Inflation assumption (CPI %)
- Tax rate (corporate income tax %)
- VAT rate
- Salary inflation %
- Energy cost inflation %
- Subsidy amount (if any) + receipt schedule

---

## Section 9 — Approvals + access matrix

**Why:** `/budgeting/admin/approvals` + role-based access control.

**Format:** simple table:

| Person | Email | Role | Companies they can see |
|---|---|---|---|
| Alpay Mammadov | ... | admin | all |
| Rashad | ... | manager | all |
| Local CFO sub-co | ... | analyst | only this sub-co |
| Bookkeeper | ... | viewer | only this sub-co P&L |

Roles: `admin` / `manager` / `analyst` / `viewer`.

---

## Section 10 — Period locks (for signed-off quarters)

**Why:** prevents accidental edits to closed periods.

Tell us which periods are already signed off so we mark them read-only:
e.g., "Q4 2025 closed, no edits allowed". For 2026 plan year — none
locked until each quarter is reviewed and signed off.

---

# Risk Terminal — separate data requirements

The Risk Terminal (`/budgeting/terminal`) shows industry-specific KPIs
and ESG indicators that go BEYOND standard P&L. Below are per-industry
asks. Cross-industry universals are in §R.0.

## §R.0 — Universal (every company needs)

These flow from the P&L data above, but the recipient should confirm:
- Revenue ≥ 0 every month (we flag negative-revenue rows as data error)
- COGS classified separately from OPEX (not lumped as "Expenses")
- D&A line is its own row (not merged into OPEX-misc)
- A `parent_company_id` is set on every level-2 op-co (so rollup works)

### ESG (mandatory for every company per FO Holding's 2026 disclosure target):

| Indicator | Format | Notes |
|---|---|---|
| Carbon emissions Scope 1 (direct) | tCO2e per year | Boilers, vehicles, on-site combustion |
| Carbon emissions Scope 2 (purchased electricity) | tCO2e per year | grid factor × kWh |
| Carbon emissions Scope 3 (supply chain) | tCO2e per year | Optional, can be modelled if missing |
| Water consumption | m³ per year | Municipal + groundwater |
| Waste generated | tonnes per year | + % recycled |
| Workforce diversity | % women in management | Optional |
| Safety incidents | count per year | LTI / TRIR if available |

If client can't provide these — we **model** Scope 1/2 from revenue ×
industry-average intensity factor. Quality is `modeled_generic` instead
of `disclosed`; flagged accordingly in Panel 3.

---

## §R.1 — Agro / Crops (AzərŞəkər EDEN, FARM)

| # | Data | Format |
|---|---|---|
| R1.1 | Hectares planted | ha per crop per region |
| R1.2 | Regions | dropdown: Salyan / Imishli / Sabirabad / Aghdash / Other |
| R1.3 | Crop type | sugarcane / wheat / corn / cotton / barley / sugar beet |
| R1.4 | Yield target | tons / ha per crop |
| R1.5 | Yield actual (per harvest) | tons / ha |
| R1.6 | Sugar content % | % (for sugar-beet / cane) |
| R1.7 | Water consumption | m³ / ha |
| R1.8 | Fertilizer consumption | kg / ha |
| R1.9 | Pesticide cost | AZN / ha |
| R1.10 | Irrigation type | modern / traditional / dry-land |
| R1.11 | Soil quality assessment | optional, free-text |
| R1.12 | Harvest dates | start / end per crop |
| R1.13 | Storage capacity | tonnes |
| R1.14 | Subsidy receipts | AZN per year + schedule |

Auto-fetched (no client input needed):
- Weather (Open-Meteo) — rainfall, temp, drought index per region
- Sugar price ICE #11 (World Bank Pink Sheet)
- Commodity volatility

---

## §R.2 — Food processing (AZSF, CPC)

| # | Data | Format |
|---|---|---|
| R2.1 | Processing capacity | tonnes / year |
| R2.2 | Main input commodity | sugarcane / corn / wheat / etc. |
| R2.3 | Extraction rate % | output / input weight |
| R2.4 | Yield loss % | (input − output) / input |
| R2.5 | Inventory turns | per year |
| R2.6 | FX exposure on inputs | % of inputs imported |
| R2.7 | Production calendar | active months (some seasonal) |
| R2.8 | Energy cost / tonne output | AZN / tonne |
| R2.9 | Quality rejects % | % of output below spec |

---

## §R.3 — Services (HORIZON, LLS)

| # | Data | Format |
|---|---|---|
| R3.1 | Service-line breakdown | revenue per service category |
| R3.2 | Top customer concentration | HHI % (top-5 customers as % revenue) |
| R3.3 | Billable utilization | % billable hours / total hours |
| R3.4 | Average revenue per FTE | AZN / employee / year |
| R3.5 | Client retention rate | % YoY |
| R3.6 | Service margin per line | gross margin % per service |

---

## §R.4 — Industrial (AAC-MAIN, ATL-DBZ/MRKZ/PMZ/TAZ, SPARK-MAIN, ZTP-MAIN)

| # | Data | Format |
|---|---|---|
| R4.1 | Production capacity | units / month per plant |
| R4.2 | Capacity utilization % | actual / nominal |
| R4.3 | Bill-of-materials per product | input commodity × qty × price |
| R4.4 | Top-3 raw-material exposures | commodity codes + AZN volume |
| R4.5 | Customer concentration | HHI of top-10 customers |
| R4.6 | Order backlog | AZN value at month-end |
| R4.7 | Defect rate | % rejects / total output |
| R4.8 | OEE (Overall Equipment Effectiveness) | %, optional |
| R4.9 | Energy cost intensity | kWh / unit output |

---

## §R.5 — Hospitality (future Tabia onboarding)

| # | Data | Format |
|---|---|---|
| R5.1 | Total rooms | integer per property |
| R5.2 | Occupancy % | monthly per property |
| R5.3 | ADR (Avg Daily Rate) | AZN / room-night |
| R5.4 | RevPAR | ADR × Occupancy |
| R5.5 | Source mix HHI | % of bookings by channel (direct / OTA / agent) |
| R5.6 | FX exposure | % USD-denominated revenue |
| R5.7 | Seasonality profile | monthly index (Jan=0.6, Aug=1.4, etc.) |

---

## §R.6 — Real estate (future AFI onboarding)

| # | Data | Format |
|---|---|---|
| R6.1 | Total square meters by property | m² |
| R6.2 | Lease-up rate (occupancy) | % occupied |
| R6.3 | Rent collection rate | % collected on time |
| R6.4 | Debt service coverage ratio | EBITDA / debt-service |
| R6.5 | Average lease tenor | months remaining |
| R6.6 | Mortgage / loan schedule | principal + interest per month |

---

## §R.7 — Pharmacy / pharma (future)

| # | Data | Format |
|---|---|---|
| R7.1 | Inventory days | days of cover |
| R7.2 | Expiry write-offs | AZN per year |
| R7.3 | R&D intensity | R&D / revenue % |
| R7.4 | Regulatory pipeline | # drugs in trial × phase |

---

## §R.8 — Entertainment / venues

| # | Data | Format |
|---|---|---|
| R8.1 | Attendance utilization | tickets sold / capacity |
| R8.2 | Revenue per visit | AZN / attendee |
| R8.3 | Seasonality concentration | top-quarter / annual % |

---

## §R.9 — Education

| # | Data | Format |
|---|---|---|
| R9.1 | Enrollment fill rate | enrolled / capacity % |
| R9.2 | Tuition collection rate | % paid on time |
| R9.3 | Student-teacher ratio | integer |

---

## §R.10 — Poultry

| # | Data | Format |
|---|---|---|
| R10.1 | FCR (Feed Conversion Ratio) | kg feed / kg meat |
| R10.2 | Mortality % | birds lost / placed |
| R10.3 | Feed cost share | feed / total COGS % |

---

# Onboarding workflow — practical sequence

For each new sub-co, run §0–10 in this order. **Stages can ship
independently** — section 2 (P&L budget) is the minimum for the company
to appear in the terminal; sections 3–6 unlock sales/COGS/balance-sheet
tabs; sections 7–10 unlock variance + signoff.

| Stage | Sections | Time | Outcome |
|---|---|---|---|
| **Day 1** | §0, §1, §0.6 industry, §R-industry header | 1 hr | Company appears in tree, industry assigned, indicator scaffold ready |
| **Day 2–3** | §2 (P&L) | 1 day | P&L tab populated, BudgetLines live, IND_REVENUE_TOTAL computed |
| **Day 4** | §3 (Sales) + §4 (COGS) | 1 day | Sales + COGS tabs unlock, gross-margin drill-down works |
| **Day 5** | §5 (Balance Sheet) + §6 (Cash Flow) | 1 day | Liquidity + leverage indicators activate |
| **Day 6** | §7 (Actuals last 12 mo) | 1 day | Variance analysis + Phase 7.G drift detection live |
| **Day 7** | §R per-industry detail (R.1–R.10) | 0.5 day | Sector-specific indicators unlock |
| **Day 8** | §8 (Assumptions) + §9 (Access) | 0.5 day | Forecast scenarios + RBAC done |
| **Day 9** | §10 (Period locks) + sign-off | 0.5 day | Trust badge graduates to ✅ Verified |

**Total per company:** ~7 working days when client is responsive. Most
of that time is on the client's side gathering data — our import +
audit-company.cjs reconciliation runs in seconds.

---

# Quick-start: what to ask AzərŞəkər NOW

Already loaded (no need to re-request):
- ✅ §0 company profile (5 entities)
- ✅ §1 Chart of Accounts (PLF.* codes)
- ✅ §2 P&L plan (276 lines, EDEN/AZSF/CPC/FARM in xlsx)
- ✅ §10 No period locks yet

**Still missing for AZSEKER (priority order):**

1. **§3 — Sales budget (product × month)** — current tab shows "no data"
2. **§4 — COGS detail (per-product cost)**
3. **§5 — Balance Sheet** for each of 5 entities
4. **§6 — Cash Flow** statement (CF_EDEN / CF_AZSF / CF_HORIZON sheets exist in xlsx — need import handler)
5. **§7 — 2025 actuals** for variance ("25 Forecast" column exists in PL-Operat sheet but not yet imported)
6. **§R.1 — Agro KPIs**: hectares per region, crop yields, sugar-content actuals (Cost card / KPI sheets in xlsx)
7. **§R.2 — Food processing**: AZSF/CPC processing capacity, extraction rate, inventory turns

**Still missing for AZMADE entities (ATL, AAC, SPARK, ZTP, LLS):**

1. **§5 — Balance Sheet** for each level-2 op-co
2. **§6 — Cash Flow**
3. **§7 — 2025 actuals**
4. **§R.4 — Industrial KPIs**: capacity utilization, BOM, top-3 raw-material exposures, defect rate per plant
5. **§0.10 — ESG Scope 1+2 disclosure** (currently modeled, not disclosed)

---

# How we'll verify each submission

For every file you upload, our `audit-company.cjs` script runs:

1. Sum monthly columns → annual total
2. Diff against the DB value
3. Drift > 0.01% → import fails, you see the exact account code + month that doesn't reconcile
4. Pass → IV gets `lastReconciledAt` stamp, Trust Badge graduates to green
5. Industry sanity-band check (e.g. food-processing gross margin should be 10–50%; outside → red `suspicious` badge)

No silent ingestion. Every number that lands on the terminal has a
traceable source document + auditor signoff.
