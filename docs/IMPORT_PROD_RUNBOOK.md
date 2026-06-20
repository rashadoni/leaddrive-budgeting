# Import runbook — multi-company file via the wizard (Phase C)

Prod is a Docker-Compose VM (Postgres internal-only, runtime is a Next
standalone bundle — no CLI/tsx/psql). **All imports run THROUGH the app**, never
a script. This is the step-by-step for importing an arbitrary client workbook
that has several companies in one sheet (a BU/entity column), in multiple
currencies and/or with a numeric/date-serial header.

## Before you start
- Log in as **admin/manager** (the import routes require it).
- Have the `.xlsx` on the machine you're browsing from.
- Know which **year** the sheet covers and which **entity (BU)** values map to
  which companies in the org tree.

## Steps — `/budgeting/admin/ai-import` → tab **«Любой файл (AI)»**

1. **Pick the target / create companies.** If a BU in the file isn't in the
   tree yet, use **«+ Новая компания»** to create it first (code/name/
   industry/baseCurrency). Each BU must resolve to a real company.
2. **Upload + classify.** Drop the file; pick the P&L sheet (e.g. `Actual PLF`).
3. **Analyze.** The AI proposes column roles. Review the table:
   - confirm the **code**, **label**, and **month** columns;
   - confirm the **entity** column (the BU column — must be roled `entity`);
   - low-confidence columns are highlighted — fix any wrong role.
4. **Multi-company mapping (appears when an `entity` column exists).** Each
   distinct BU value gets a company picker, pre-filled with the AI's best
   match. **Confirm every row.** Rules the server enforces:
   - every BU with data MUST be mapped (un-mapped → blocked);
   - **two BUs may NOT point at the same company** (would wipe data → blocked);
   - companies must belong to your org.
5. **Multi-currency (appears when the sheet has >1 currency).** Pick the
   currency to import (💱). The lines are tagged with it (`currencyCode`).
6. **Preview (0 writes — ALWAYS do this).** The dry-run shows, per company:
   line count, rows that **would be deleted** (clean-slate), the control-total
   verdict, and any **blockers**. Nothing is written yet.
   - ⛔ **blocked** (red control-total / no-revenue / ambiguous cost-sign) →
     the **Apply** button is disabled. Fix the mapping / file and re-preview.
   - ⚠️ **warn / uncertifiable** → review the findings; you must tick the
     acknowledgement(s) to proceed.
7. **Apply.** Confirm the clean-slate warning. The write is **all-or-none**
   across all companies in ONE transaction — a failure on any company rolls
   back every company. On success: per-company insert/delete counts +
   indicators recompute automatically.

## What Apply replaces
For each mapped company it **clean-slates then re-inserts** the
`(org, plan=AI-Imported <year> Budget, company)` P&L lines — scoped to THAT
company only. Companies NOT in the file are untouched. Other plans/years are
untouched.

## If something looks wrong
- **«Набор компаний (BU) изменился…» (409):** you re-uploaded a file whose BU
  set differs from what you analyzed → re-run Analyze on the current file.
- **«Файл изменился после анализа…» (409):** the columns changed since analyze
  → re-analyze.
- **Apply disabled / 409 on commit:** read the blocker text — it names the
  company + reason (control-total, no revenue, or cost-sign). The data is never
  written while a blocker stands.

## Safety guarantees (why this can't silently corrupt)
Preview is read-only; commit re-runs every gate server-side (the UI is
advisory); clean-slate is per-company scoped; the whole import is one
transaction; an ambiguous cost-sign or a non-injective BU→company map is a hard
block. See `docs/PHASE_C_PLAN.md` for the corruption invariants.
