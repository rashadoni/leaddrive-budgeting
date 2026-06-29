# Import runbook — `Reporting 2026.xlsx` (FO / AzerSheker) → prod wizard

File-specific companion to `docs/IMPORT_PROD_RUNBOOK.md`. Resolves the
"multi-BU split — awaiting approach decision" blocker (commit `a2477591`).
Decision taken **2026-06-29**: split on the **granular legal-entity** BU
dimension (keeps `CPC` separate from `EDEN`, matching the org tree).

Source file: `~/Downloads/Reporting 2026.xlsx` (30 sheets).

---

## 0. FIRST — confirm prod actually needs a re-import

The 2026-06-29 audit that found "all op-cos have 0 live budget lines" ran
against the **local dev DB**, not prod. Before touching prod, confirm:

- Open the prod Risk Terminal HeatMap **or** the budgeting P&L for
  **AZSEKER-CPC** (or any op-co).
- **P&L shows numbers / HeatMap cells populated →** prod is fine. **STOP** —
  no re-import needed. (The local breakage is only the dev copy.)
- **P&L empty / ESG = 100 everywhere →** prod has the same half-imported
  state. Proceed below.

The wizard's **Preview** (step 6) is a 0-write dry-run that reports the current
live row count per company — that number is the ground truth for prod state.

---

## 1. What to import (priority order)

P&L drives the terminal (revenue → ESG, financial indicators, P&L tab,
analytics). Do P&L first; BS/CF are a follow-up with the same pattern.

| # | Sheet | Statement | Plan (year/kind) | **Entity column** | Month columns |
|---|-------|-----------|------------------|-------------------|---------------|
| 1 | `Actual PLF` | P&L | 2026 / actual | **`BU`** | the **2026** block (Jan–Dec 2026) |
| 2 | `Budget PLF` | P&L | 2026 / budget | **`BU_3`** ⚠️ | whole sheet (2026) |
| 3 | `BS Actual` | Balance Sheet | 2026 / actual | confirm at Analyze | Jan–Dec 2026 |
| 4 | `CF Actual` | Cash Flow | 2026 / actual | confirm at Analyze | the **2026** block |
| 5 | `Budget CF` | Cash Flow | 2026 / budget | confirm at Analyze | whole sheet (2026) |

⚠️ **`Actual PLF` holds BOTH 2025 and 2026** in one sheet (cols Jan2025–Dec2025
then Jan2026–Dec2026). In Analyze, make sure the month columns roled for the
2026 Actuals plan are the **2026** block, not 2025.

⚠️ **`Budget PLF` has 4 BU columns (BU_1..BU_4) that disagree.** The importer's
guard deliberately refuses to auto-pick one. **You must manually role `BU_3` as
`entity`** and leave BU_1 / BU_2 / BU_4 as ignored. Reason: BU_1 tags CPC's and
AJE's blocks as `EDEN` (a consolidation view) → would stack 3 entities onto
EDEN. BU_3 carries the true owning entity per block.

---

## 2. BU → company mapping (confirm in wizard step 4)

| BU code in file | Map to company | Status |
|-----------------|----------------|--------|
| `AZSF` | `AZSEKER-AZSF` | ✅ clean |
| `EDEN` | `AZSEKER-EDEN` | ✅ clean |
| `CPC` | `AZSEKER-CPC` | ✅ clean |
| `ProMalt` | `AZSEKER-PROMALT` | ✅ clean |
| `EJE` (Actual PLF, ~41 rows, sub-tag JV) | **your call** | Eden-related JV — map to the right company, create a new one, or skip |
| `AJE` (Budget PLF block 4, full block) | **your call** | Eden-related — map / create / skip |

Notes:
- **Do NOT** map the sub-unit dimension values — `Core`, `Farming`, `JV`,
  `Production`, `Combined`, `---`. Those live in BU_2 / BU_4 and are cost-center
  tags, not entities. Only the chosen entity column's values are companies.
- `AZSEKER-MALT` and `AZSEKER-HORIZON` exist in the tree but do **not** appear
  in this file — they stay empty unless `EJE`/`AJE` actually map to them (your
  call).
- The wizard **blocks** two BUs pointing at the same company (anti-wipe guard)
  and blocks any unmapped BU — so you cannot silently lose a block.

---

## 3. Click-path (per sheet, repeat for each row in §1)

`/budgeting/admin/ai-import` → tab **«Любой файл (AI)»** (log in as admin/manager).

1. **Upload** `Reporting 2026.xlsx`, pick the sheet (e.g. `Actual PLF`).
2. **Analyze.** Review proposed column roles:
   - confirm `code`, `label`, and the correct **month** columns (watch the
     2025-vs-2026 split on `Actual PLF` / `CF Actual`);
   - **role the entity column** per §1 (`BU` for actuals, **`BU_3`** for the
     budget P&L); make sure no other BU column is roled `entity`.
3. **Multi-company mapping** appears (entity column set) → confirm every BU per
   the §2 table. Resolve `EJE` / `AJE`.
4. **Multi-currency** (if prompted) → pick the import currency.
5. **Preview (0 writes — ALWAYS).** Check per company: line count, rows that
   would be deleted (clean-slate), control-total verdict, blockers. Red blocker
   → fix mapping/file and re-preview. Nothing is written yet.
6. **Apply.** All-or-none transaction across all mapped companies; indicators
   recompute automatically on success.

---

## 4. After the P&L imports land

- Open the Risk Terminal — op-co cells populate; **ESG composite should move off
  the flat 100** (revenue is now non-zero).
- Spot-check **AZSEKER-CPC** P&L for a sane revenue number vs the file.
- (Optional, ops) refresh stale external adapters and re-check
  `SERV_AZ_TRADE_BALANCE_SIGNAL` (showed −$23.2B on dev — adapter sign/scale,
  independent of this import).
- Re-run readiness if you have shell access: `npm run smoke-test` should clear
  the `orphaned-actuals` + low-readiness 🔴 flags (added 2026-06-29).
