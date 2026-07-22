# BudgetPro pilot — owner data pack (Tracks 1.5–1.9)

Date: 2026-07-22. Scope: `AZSEKER-EDEN`, `AZSEKER-CPC`,
`AZSEKER-PROMALT`, `AZSEKER-AZSF`; periods 2025 and 2026.

This is the single collection list for the remaining Risk Terminal data gaps.
Send original source workbooks where they exist. Do not replace blanks with zero,
do not copy the example values from a template, and do not translate source
status labels. A zero is accepted only when the owner explicitly certifies that
the measured population is complete and the result is genuinely zero.

## 1.5 Operational facts

Preferred shape: one `.xlsx` sheet named `OperationalFacts` with the exact
columns below. One row is one company × metric × as-of date observation.

`companyCode | metric | date | value | unit | sourceNote`

The application template is available after login at
`/api/operational-facts/import/template`. Its pre-filled rows are examples only:
delete them and retain only real observations. Preview must be run before apply.

### EDEN — agro facts

Provide the 2025 year-end observation and the latest supported 2026 observation;
monthly rows are preferred when the source is monthly. All numerator/denominator
pairs must cover the same fields and dates.

| Metric | Exact unit | Minimum evidence |
|---|---:|---|
| `harvest_tons` | `tons` | harvested tonnage and covered field/date scope |
| `area_hectares` | `hectares` | cultivated/yielding area for the same scope |
| `yield_per_ha` | `tons/ha` | owner-approved weighted average; do not copy a simple field average |
| `sugar_content_pct` | `%` | lab/quality report and sampling date |
| `water_use_m3_per_ha` | `m³/ha` | metered/allocated water and hectares denominator |
| `fertilizer_kg_per_ha` | `kg/ha` | applied fertilizer mass and hectares denominator |
| `cane_cut_to_mill_hours` | `hours` | weighted operational average and shipment population |
| `cane_hectares_harvested_pct` | `%` | harvested hectares ÷ planned harvest hectares |
| `drought_index` | `index` | canonical 0–10 value, source/method and as-of date |

`drought_index` is 0–10 end to end. The prior 0–100 seed mismatch was a code
defect, not a request to rescale source data.

### CPC / PROMALT / AZSF — processing facts

Provide the same periods for each company. For `raw_input` and
`finished_output`, rows must use identical dates and production scope.

| Metric | Exact unit | Minimum evidence |
|---|---:|---|
| `raw_input` | `kg` | accepted raw material entering production |
| `finished_output` | `kg` | saleable finished output on the same basis |
| `extraction_rate_pct` | `%` | independently reported recovery/extraction rate and method |
| `sugar_content_pct` | `%` | only where the company measures input/output sugar content |

If one company does not perform the relevant process, provide an explicit
`not applicable` business statement; do not submit numeric zero.

## 1.6 Legal and audit registers

Send original 2025 and 2026 workbooks. Preserve entity names and status text.

### Court cases

Required row fields: case/reference number, date, court, claimant, defendant,
dispute type, description, responsible department/lawyer and current status.
Each case must identify the legal entity in claimant or defendant text. The
import derives total and active cases; it must not receive hand-calculated
totals instead of the underlying register.

For a company with genuinely zero cases, supply a signed/approved zero
declaration naming company, period, population covered and approver. The current
row-based register cannot infer certified zero from a missing company block, so
missing remains `unknown` until an explicit-zero path is approved and implemented.

### Audit findings

Required row fields: severity (`Major`, `Minor`, `Observation` or `OFI`), company,
audit/reference, management status, grouping/category and follow-up status/date.
Preserve the source completion wording (the current AzerSheker parser recognises
`Yerinə yetirilib`). A company absent from the workbook is unknown, not zero
findings; use the same signed zero-declaration rule as court cases.

## 1.7 Customer and supplier populations

For each company and year, send customers and suppliers with:

`entity | role | counterparty legal name | annual turnover/spend | period`

Required coverage:

- PROMALT: customers and suppliers for 2025 and 2026;
- all four companies: suppliers for 2025;
- replacement/certification for every other partial register.

HHI is valid only when the population denominator is controlled. A `Top 10`
extract is acceptable only if those rows are the complete population or the
file also supplies total company revenue/spend so shares use the full
denominator. The existing parser normalises listed rows to 100%; therefore a
truncated Top-10 without a full denominator is not decision-grade evidence.
Duplicate legal names, aliases and intercompany counterparties must be identified.

## 1.8 Financial gaps

### Revenue currency split

For each of the four companies, provide 2025 and 2026 revenue by currency:

`company | year | AZN | USD | EUR | other | total revenue | source workbook`

Amounts are preferred over manually calculated percentages. The four currency
amounts must reconcile to total revenue. Current `Company.settings.fxRevenueAzn`
is not period-aware; one value would be reused for both years. It may be written
only if the owner certifies the same share is valid for 2025 and 2026. Otherwise
a period-aware contract must land first.

### PROMALT 2025 P&L

Send the original 12-month P&L workbook with entity code, account code/name,
monthly values, reporting currency and per-row original currency/rate evidence
where non-AZN. A partial year must remain explicitly partial; no missing month
may be copied, extrapolated or converted to zero.

### CPC / PROMALT / AZSF balance sheets

Send 2025 and 2026 balance sheets with opening balance and monthly closing
balances for assets, liabilities and equity. Inventory must be identifiable by
account name/code and split into raw material, WIP and finished goods where the
source supports it. Cash, retained earnings, current-year result and reserves
must remain separate so statement controls can use independent evidence.

### EDEN 2026 basis completion

Provide either P&L June–December 2026 or a confirmed EBITDA measure on the same
January–May basis as the existing P&L. A full-year EBITDA subtotal must not be
divided by a five-month revenue denominator.

## 1.9 EDEN rainfall policy — owner decision

Choose and approve one policy before `Company.settings.region` is populated:

1. preferred: period-aware rainfall weighted by parcel hectares and active lease
   dates; or
2. one named primary region, with written confirmation that it represents EDEN.

The free Open-Meteo history already contains 12/12 monthly points for all eight
canonical regions. Until one policy is approved, EDEN rainfall remains
`unknown`; the system will not choose an arbitrary region.

## Acceptance gates before any production write

1. File hash, filename, period and source owner recorded.
2. Company mapping is exact and tenant-scoped.
3. Units, dates and population denominator pass preview controls.
4. Blank, not-applicable and certified zero are distinguished.
5. Preview is read-only; apply is one bounded batch with audit lineage.
6. Recompute and fresh production verification follow the import.
7. No paid Anthropic/Google Trends/Moody's/S&P/FactSet call is permitted by this
   pack.
