# Build plan — Balance-Sheet apply path (unify AI import)

Reverse-engineered 2026-06-30. Goal: let the AI import write a **Balance Sheet**
(and later Cash Flow), not just P&L — so one AI upload handles every statement
type. This is the missing wiring; the engine pieces already exist.

## Why it's missing today (root cause of the demo friction)

- **«Any file (AI)»** (`src/lib/onboarding/ai-mapper/`) writes **P&L only** —
  `validateImport()` hard-blocks on `revenue === 0` ("No revenue parsed"), and
  the applier writes `budget_lines`. A balance sheet has no revenue → blocked.
- **«1 file»** (`/api/import/ai-auto`) is **classify-only**; its apply target
  `/api/admin/import-workbook` **does not exist**.
- So there is **no end-to-end "click → balance sheet written"** path. Not a UX
  bug — an unfinished feature.

## Pieces that ALREADY exist (reuse, don't reimplement)

| Piece | File | Role |
|---|---|---|
| BU split (statement-agnostic) | `ai-import/bu-column-split.ts` | split a multi-entity sheet into per-entity virtual sheets by the BU column (PLF/BS/CF) |
| BS adapter | `ai-import/dynamic-bs-adapter.ts` → `runDynamicBsAdapter()` | parse + LLM-classify a BS sheet; returns `AdapterRunResult` with a working `applyToDb()` |
| BS writer | `onboarding/bs-import-batch.ts` → `runBalanceSheetBatch()` | writes `balance_sheet_lines`, **company+plan scoped**, with its own clean-slate (note the 2026-05-31 companyId scope fix) |
| BS classifier | `bsAccountTypeLocal()` in the adapter | maps `BS.xx.yy` codes → asset/liability/equity |

## Template to mirror

`src/app/api/onboarding/import/staging/[id]/apply-multi-entity/route.ts` (716
LOC). Reproduce its **safety structure** exactly — this is the part that must
not be rushed:

1. Parse `entityMap: { entityValue → companyId }`; **enforce injective** (two
   values → one company is a data-wipe path → 400).
2. Per-entity clean-slate WHERE = exactly `(org, plan, companyId)` — never
   plan-only (the `runBalanceSheetBatch` companyId-scope fix already does this;
   verify the WHERE matches).
3. **Preview (dry-run, 0 writes)**: per company → rows-in / rows-that-would-be-
   deleted / reconciliation verdict. Apply disabled until green.
4. **Commit**: single `prisma.$transaction` across all mapped companies
   (all-or-none). Per-entity reports.
5. Trigger recompute for affected companies + period.
6. Audit-log the apply (with `__entityMap`).

## BS-specific differences vs the P&L route

- Split with `bu-column-split.ts` (same), then per entity call
  `runDynamicBsAdapter(input, planId, prisma, companyId)` → `applyToDb()`
  (which calls `runBalanceSheetBatch`) — instead of `runImportBatch`.
- Clean-slate target = `balance_sheet_lines` (the BS batch does this); confirm
  the scope is `(planId, companyId)` and NOT plan-only.
- **No revenue/COGS/GM validation.** Replace with the BS reconciliation:
  Assets ≈ Liabilities + Equity (balance check) per entity. Green only if it
  ties within the existing tolerance band (`control-totals.ts` 0.005 abs / 1%).
- BS amounts are month-end **snapshots** — no sign inversion (the adapter
  already handles this).
- Plan scoping: BS goes into the **same plan** as the P&L (e.g. "2026 Actuals")
  but a **different table** — so it must NOT clean-slate `budget_lines`.
  ⚠️ The failed «Any file (AI)» preview showed `replaces = P&L row counts`
  precisely because it targeted `budget_lines`. The BS path must only touch
  `balance_sheet_lines`. Add a test asserting `budget_lines` are untouched.

## Route shape (new)

`POST /api/onboarding/import/staging/[id]/apply-bs` (sibling to the P&L route),
or extend the existing route with `statementType: "balance_sheet" | "pl"` that
forks step 4 to the BS batch. Prefer the param-fork to share the 716-LOC safety
scaffold (parse, injective check, preview, transaction, recompute, audit) and
only swap the per-entity writer.

## Tests (must be green before deploy)

1. Injective entityMap rejected (anti-wipe) — mirror the P&L test.
2. BS apply writes `balance_sheet_lines` for N entities; **`budget_lines`
   untouched** (the critical isolation test).
3. Per-entity clean-slate scope = `(plan, companyId)` only.
4. Balance reconciliation: Assets = Liab + Equity green/red verdict.
5. Dry-run = 0 writes.
6. Use a synthetic BS fixture (BS.01 assets / BS.02 equity / BS.03 liabilities
   with a BU column) + stub the LLM proposal (pattern from
   `dynamic-bs-adapter.test.ts`).

## UI wiring (after the route is green)

The «Any file (AI)» review screen already renders entity-map + plan + preview.
For a BS-classified sheet: skip the P&L column-role section, show the balance
reconciliation instead, and POST to the BS apply with `statementType`. Later:
collapse the 4 tabs into one — classifier decides the path (the real "one AI
upload for any format" the user asked for).

## Deploy

Local + green tests first. Then the existing proven path: rsync changed files →
`docker compose up -d --build app` on prod (8 GB now handles the build). Never
build on prod untested. Snapshot DB before (the pre-deploy backup pattern).
