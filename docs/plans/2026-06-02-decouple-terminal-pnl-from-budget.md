# Decouple Risk Terminal P&L from the Budgeting "plan" (Variant B)

**Status:** APPROVED direction (user, 2026-06-02). Plan ready; execution pending scope confirmation.
**Goal:** Risk Terminal P&L = ACTUALS; `BudgetLine.plannedAmount` = BUDGET only; Budgeting execution = actual ÷ budget. AI import routes "Actual >>>" sheets → actuals, "Budget sales plan" → budget. Migrate existing mislabeled 2026 actuals out of the "2026 Budget" plan with no data loss.

## Verified state
- Terminal P&L is computed from `BudgetLine.plannedAmount` via `budgetLineResolver` (`src/lib/risk/recompute-resolvers-b.ts:23`), read by `listBudgetLines` (`recompute-data-source.ts:300`, scoped `(companyId, plan.year)`).
- **A decoupled financial-fact channel ALREADY exists:** `budgetLineResolver` prefers `OperationalFact metric=pl_ebitda` (company+date scoped, no plan) and only falls back to BudgetLine. The PLF import already writes `pl_ebitda`. → extend this pattern to the full P&L (Option 2 below).
- Live: "Azərşəkər 2026 Budget" (year 2026, draft) = 732 live BudgetLines summing **21,828,325.86** (CPC/AZSF/EDEN/MALT, monthIndex 0–3) — these are 2026 actuals Jan–Apr. 5,181 archived rows. `BudgetActual` = 0. "2021–2025 Actuals" plans empty.
- The classifier discards the `Actual >>>` / `KPI >>>` / `CAPEX >>>` separator sheets (`sheet-classifier.ts:165`) → the actual-vs-budget section signal is dropped but recoverable from sheet order.
- BS (`BalanceSheetLine`) and CF (`CashFlowEntry`) are coupled the same way (planId-scoped, terminal reads them).

## Data-model decision
**Option 2 (RECOMMENDED): period-scoped `OperationalFact pl_*` facts** (`pl_revenue/pl_cogs/pl_opex/pl_ebitda/pl_net_income`, company+date scoped, no plan). The codebase already does this for EBITDA. Lowest-risk true decoupling; matches the grain the "Actual >>>" PLF sheets publish (subtotals).
- Option 1 (terminal reads `BudgetActual`) — re-couples to a plan; wrong shape (no accountId FK). Rejected.
- Option 3 (new `FinancialFact` table, per-account) — cleanest long-term, biggest change. Documented escape hatch if per-account actual granularity proves necessary (FX-import split / per-SAP-code D&A).

## Phases (rollout order keeps the live terminal correct throughout)
- **Phase 0 — safety net:** parity oracle (dump current P&L indicator values per company×period as the "before"); checksum dump of plannedAmount sums (the 21.8M breakdown); add `TERMINAL_PNL_SOURCE` flag = `budgetline`(default)|`actuals`|`dual`.
- **Phase 1 — write actuals as facts (additive, reversible):** extend PLF parser/handler to emit full `pl_*` facts; migration script derives `pl_*` from the live "2026 Budget" BudgetLines (sum by accountType per company×month); verify Σ matches the checksum bit-perfect. Original BudgetLines untouched.
- **Phase 2 — dual-read resolver (flag-gated):** add `listFinancialFacts`; make `budgetLineResolver` + `getCompanyFinancialsSnapshot` source-aware (budgetline | actuals | dual). Absent facts → `unknown` (no fabrication).
- **Phase 3 — AI import routing:** carry the `Actual >>>`/budget section signal through `sheet-meta-extractor` → `sheet-classifier` (`financialKind: actual|budget`); route actual PLF → `pl_*` facts (+ optional `BudgetActual` via the already-built `runActualsBatch`), budget → `BudgetLine`.
- **Phase 4 — relabel the budget side:** rename "2026 Budget" → "2026 Actuals" (reversible, store original planId); leave a fresh empty "2026 Budget" for the real budget; bit-perfect re-verify (21,828,325.86, 732/5,181 counts). Archived rows kept until parity signed off.
- **Phase 5 — flip flag + verify parity + remove shim:** dual in staging → assert indicator values identical to Phase 0 oracle → flip to actuals in prod → re-verify → delete the budgetline branch.

## Test strategy
Unit (PLF subtotal parser, `listFinancialFacts` range math, resolver branch); handler (financialKind routing); **integration parity on real AZSEKER data** — indicator values identical before/after the switch (proves no drift) + Σ pl_facts == plannedAmount checksum (proves no loss/fabrication).

## Open questions (need user decision)
1. All terminal indicators → actuals? (recommend yes)
2. **Scope: P&L only, or also BS/CF?** (BS/CF are coupled the same way; including them is bigger but complete.)
3. Months with no actuals → `unknown`/"no data" (recommend).
4. Subtotals (Option 2) vs full per-account (Option 3) — affects FX-risk/D&A granularity (recommend Option 2; FX-risk degrades to `unknown` when the split isn't captured).
5. Archived 5,181 rows — keep (reversible) vs purge (recommend keep until parity signed off).
6. Real budget is only partial (sales-plan, revenue-only) — execution % meaningful only for revenue until a full budget is loaded.

## ⚠️ PIVOT 2026-06-02 — switched Option X (facts) → Option Y (plan.kind)

**Why:** Implementing Phase 2 surfaced that `budgetLineResolver` does TWO things — the P&L roll-up AND line-level **sub-aggregations** (`budgetLine.<sub>`: inventory, cogs, feed_cost, rd_spend, debt_service, revenue_line_hhi — matched per-line by account code/name). **Subtotal facts (Option X) structurally cannot reproduce sub-aggregations.** Verified the regression is currently nil (all 114 sub-agg-dependent indicator rows are `unknown` for AZSEKER; the one live "HHI" is CUSTOMER_HHI = the *counterparty* resolver, not budgetLine) — so facts wouldn't break anything *today*, but they'd **permanently block** those indicators once inventory/feed data is entered. Option Y keeps the rich actual LINES (roll-up + sub-aggs both keep working) and only adds a `where` filter — **less code than X and no capability loss.**

**Decision: Option Y.** The Phase-1 P&L facts (90 rows) were rolled back (`source='migration:budgetline-2026'`, unused/additive — zero impact). What carries over: the Phase-0 oracle (`phase0-baseline.json`) + checksums (still the parity reference), and the `aggregatePnlLines` refactor (the resolver still uses it to read lines). The `phase1-*` fact scripts are superseded (kept for reference).

### Revised phases (Option Y)
- **Y1 — schema:** add `BudgetPlan.kind: 'actual' | 'budget'` (Prisma migration), DEFAULT `'actual'` so every existing plan is `actual` → terminal unaffected. Backfill is the default.
- **Y2 — terminal filter (no-op until a budget plan exists):** add `plan: { kind: 'actual' }` to the terminal's BudgetLine reads (`recompute-data-source.ts listBudgetLines` + `company-financials-snapshot.ts`). With all plans `actual`, this changes nothing → verify parity vs the Phase-0 oracle (identical). Guards against future double-count.
- **Y3 — relabel + real budget plan:** rename "Azərşəkər 2026 Budget" → "Azərşəkər 2026 Actuals" (kind stays `actual`); create a fresh "Azərşəkər 2026 Budget" (kind=`budget`) for the real budget. Terminal ignores the budget plan via the Y2 filter (no double-count); re-verify oracle parity + the 21,828,325.86 checksum on the actuals plan.
- **Y4 — budgeting "actual" rewire:** budgeting analytics, for a `budget` plan, reads the matching-year `actual` plan's lines as ACTUAL (execution = budget plan ÷? actual plan). Now execution is meaningful once a real budget is loaded.
- **Y5 — AI import routing:** route "Actual >>>" financial sheets → the `actual` plan, "Budget sales plan" sheets → the `budget` plan (carry the section signal through sheet-meta-extractor → classifier, per the original Phase-3 design).

## Decision log
- **2026-06-02 — Option X confirmed (not Y).** Considered Option Y (tag plans `kind: actual|budget`, terminal filters by kind, keep rich lines). Rejected: the only real advantage (avoid subtotal-derivation granularity loss) dissolves because the BS/CF resolvers consume **subtotals only**. Option X (period-facts) wins on: follows the existing `pl_ebitda` precedent; more correct (actuals are period-scoped facts, not plan rows); flag-gated **dual-read** gives bit-perfect verifiability before flip; avoids Y's silent double-count failure mode (a forgotten `kind` filter). Tier-0 stress-test; Codex second opinion attempted but its MCP was unreachable (model unsupported for this account) — decided on own analysis, confidence High.
- **2026-06-02 — Phase 1 derivation DRY-RUN verified bit-perfect.** `scripts/phase1-derive-facts-dryrun.cjs`: derived totals (Revenue 9,527,380.56 / COGS 7,762,027 / OpEx 4,538,918.29) sum to **21,828,325.86 == Phase-0 checksum**; BS 45 keys + CF 12 keys reconcile; `account.accountType` grouping == `lineType` for this data. NO writes.
- **Phase 1 refinement:** the P&L fact vocab must include the FX split (`pl_imported_cogs/pl_domestic_cogs/pl_imported_opex/pl_domestic_opex`) and `pl_da` (D&A add-back) that `budgetLineResolver` computes per-line — so the writer must **reuse the resolver's per-line classification** (extract it into a shared pure fn) rather than re-implement, to stay bit-perfect.

## Critical files
`src/lib/risk/recompute-data-source.ts`, `recompute-resolvers-b.ts`, `company-financials-snapshot.ts`; `src/lib/onboarding/ai-import/production-adapter-handlers-financial.ts`, `sheet-classifier.ts`, `sheet-meta-extractor.ts`; `src/lib/onboarding/adapters/azseker-plf.ts`, `actuals-import-batch.ts`, `import-batch.ts`.
