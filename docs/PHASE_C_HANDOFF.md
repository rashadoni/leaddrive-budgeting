# Phase C handoff — finish the canonical-model import (multi-company + sign/FX)

**Written 2026-06-20. Pick up from commit `e3d8677c` (main).**

You are continuing the "Universal Import" effort: let a non-developer import
*arbitrary* client financial workbooks (a different format per company) that
import **correctly**. The agreed contract (proven impossible to fully
automate): **AI interprets → deterministic file-internal validation →
human reviews only deltas → approved mapping is remembered per format.**

## What is already DONE (do NOT rebuild — read `docs/ROADMAP.md`, the 2026-06-20 changelog entries)

- **Phase A — validation engine (complete).** `src/lib/onboarding/ai-mapper/validate-import.ts` aggregates file-internal signals → graded verdict `certified | warn | blocked | uncertifiable`: control-total (parent vs leaf, `control-totals.ts`), per-row Total-column tie-out, coverage (zero-revenue = hard block), margin/sign sanity, **semantic section↔type conflict** ("ties-out-but-wrong"). Wired into `staging/[id]/apply` (dry-run surfaces it; commit hard-409s on `blocked`) + the wizard UI (`UniversalImportForm.tsx`).
- **Phase B — template memory (complete).** `template-store.ts` saves the human-approved mapping keyed by the file's structure-hash in `Organization.settings.importTemplates` (JSON, versioned, never-mutate). `apply` saves on success; `analyze` reuses it (skips the LLM, `fromTemplate:true`) — commit still validates. "Learn each format once."
- **Phase C slice 1 — multi-year (complete).** `resolveColumns(columns, {preferYear})` parses the year off `amount:Jan2026` roles and selects one target year when several are present; `applyProposal` threads `preferYear`; the apply route resolves the year first (form `targetYear` → single → latest → current) and no longer 400s on multi-year. Mapper prompt instructs year-qualified roles for multi-year sheets.
- **Arbitrary code schemes (done earlier today).** `applier.ts` handles non-SAP codes (e.g. `PLF.01.02`) via AI section-overrides + longest-prefix match + multilingual section-tracking + subtotal-skip; `dedupeParentRollups` handles `-` AND `.` hierarchies. SAP path unchanged.

Baseline: `npx tsc --noEmit` = 0 errors; `npx vitest run` = **5865 passing**.

## What REMAINS in Phase C (this is the task)

The canonical model Codex confirmed: **`account × period × entity × scenario × currency`**. Two big pieces left, both genuinely multi-day — this is a **canonical-model refactor, NOT a one-commit slice**:

### 1. Multi-company-in-one-sheet (entity as a first-class dimension) — ✅ DONE 2026-06-20
**COMPLETE + verified on the real file + shipped** (commits `cc0b6693`→`fa961f7b`). Full design + corruption invariants in `docs/PHASE_C_PLAN.md`; per-slice detail in the `docs/ROADMAP.md` 2026-06-20 changelog. Summary of what landed:
- `entity` column role (`types.ts`); pure `entity-split.ts` (`findEntityColumn`/`findCodeColumn`/`extractEntityValues`/`applyProposalByEntity`) splits a sheet by its BU column and runs the EXISTING `applyProposal` per entity-group (dedup/control-totals stay entity-local). Header band anchored on the CODE column (digit-bearing) — NOT the all-strings heuristic, which mis-fires on date-serial headers.
- `entity-resolve.ts` (`resolveEntityCompanies`) auto-suggests entity-value→company (injective).
- Shared `apply-lines.ts` (`applyParsedLinesToCompany`) one-company delete-then-insert primitive (clean-slate scoped to `(org,plan,company)`), reused by the new route.
- `POST /staging/[id]/apply-multi-entity` — per-entity clean-slate+insert in ONE tx; all Codex-reviewed invariants (injective `entityMap`, entity-set equality vs persisted `proposal.__multiEntity`, all-or-none, per-entity scope, RED hard-block, ack gates).
- Mapper prompt + `analyze` persist `__multiEntity` + suggest the map; `UniversalImportForm` renders the BU→company mapping step and routes commit to the multi-entity route.
- **Real-file verified:** generic split partitions `Reporting 2026.xlsx` `Actual PLF` into AZSF/EDEN/CPC/ProMalt (EJE skipped) matching the bespoke partition. The generic per-entity PARSE diverges from the bespoke kopeck parser BY DESIGN (coarser generic parser; review-gated) — the bespoke path stays kopeck-perfect for AzerSheker's own files.
- **Surfaced, NOT yet fixed (candidate next slice C2.5):** `applyProposal`'s own header detection shares the all-strings limitation → date-serial-header sheets under-parse via the generic path (fails SAFE to the review gate). A future slice could teach the generic header detector to recognize numeric/date-serial month headers (broadens Universal Import; touches the applier core → Codex-review it).

### 2. Sign + currency as first-class dimensions — ✅ DONE 2026-06-20 (Phase C Part 2)
**COMPLETE + shipped.** See the `docs/ROADMAP.md` 2026-06-20 changelog (C3.1a/C3.1b/C3.2). Summary:
- **Sign (C3.1a/b):** Codex-reviewed. `sign-infer.ts` `classifyCostSign` infers the stored-sign convention per accountType from RAW pre-flip values (abs-share AND row-count majority → `negative_costs | positive_costs | ambiguous | no_evidence`). The applier flip is now **convention-based** (two-pass): negative/no-evidence → flip (AZ default, byte-identical); positive → NO flip (the fix); ambiguous → hard-blocked by `validate-import`. Covers both apply paths (`apply-multi-entity` now runs the full `validateImport` per entity — closed Codex #5).
- **Currency (C3.2):** `ColumnMappingProposal.currencyCode?`; `resolveColumns({preferCurrency})` selects one currency on a multi-currency sheet (fail-safe error if no preference); `ParseResult.resolvedCurrency` tags `BudgetLine.currencyCode`; mapper classifies currency columns + FX-rate-as-skip; routes accept `targetCurrency`.

## PHASE C COMPLETE
The canonical model `account × period × entity × scenario × currency` is realized in the generic Universal Import: period (multi-year), entity (multi-company-in-one-sheet), sign, currency; scenario = BudgetPlan. Optional follow-ups (not blocking): UI currency-picker (routes already take `targetCurrency`), per-visual-section sign granularity (C3.1c), generic numeric/date-serial header support in `applyProposal` (C2.5).
- **Sign:** today `applier.ts` flips cogs/expense globally (`flipSign`). Codex: make sign a per-template / per-section inferred dimension; validate via subtotal equations + expected polarity; never globally flip on weak evidence.
- **FX/multi-currency:** distinguish reporting vs local vs FX-rate columns; a `valueColumn.currencyRole`; catch "USD + local as duplicate periods/entities". The mapper must classify currency role.

## Key files
- Engine: `src/lib/onboarding/ai-mapper/{applier,validate-import,control-totals,template-store,structure-hash,extract,mapper}.ts`, prompt `src/lib/llm/prompts/mapper-system.ts`.
- Routes: `src/app/api/onboarding/import/{analyze,analyze-multi,staging/[id]/apply,staging/[id]/apply-multi}/route.ts`.
- UI: `src/app/(dashboard)/budgeting/admin/ai-import/{UniversalImportForm,MultiSheetImportForm}.tsx`, `src/features/onboarding/components/MappingReviewTable.tsx`.
- Bespoke reference: `src/lib/onboarding/adapters/reporting-pack-*.ts`, `production-adapter-handlers-financial.ts`, `prod-adapter-context.ts`.

## Gotchas / conventions
- **Corruption zone.** Validate before write; clean-slate WHERE must stay scoped to (org, plan, company[, entity]); never broaden; honor the collateral guard; `deletedAt: null` on all reads.
- **Validation gates are server-side** (`apply` re-runs them; UI is advisory). Red = hard block. No fake-green; `noControl` → uncertifiable.
- **Prod = local Docker VM** (`memory/project_prod_is_docker_vm.md`): Postgres internal-only; design data-ops THROUGH app routes, not CLI. Dev DB for testing: `postgresql://rashadrahimov:@localhost:5432/budgetpro`.
- **Bias:** AzerSheker's own files use the bespoke kopeck-perfect path; the generic path is for genuinely-new companies, review-gated. Budget = the 58.88M farming/strategic plan (decision B; `memory/project_azsheker_budget_is_strategy.md`).
- **Workflow:** `npx tsc --noEmit` + `npx vitest run` mid-turn; one commit per slice with a ROADMAP changelog entry in the same commit; `git push origin main` after each (user wants it on prod). TDD the applier/route changes.
- **Verify on real files** in `~/Documents/budget azersheker/`: `Reporting 2026.xlsx` `Actual PLF` (BU column = multi-company test), `Guvven Fin.xlsx` `PLF AZSF` (multi-year, now works). Run the engine end-to-end via a temp tsx script loading `ANTHROPIC_API_KEY` from `.env` (~$0.04/run); delete the temp script after.

## Suggested first slice
Write a plan first (`/writing-plans` or just a short design), then start with **multi-company read-only**: add an `entity` column role + have `applyProposal` return lines grouped by entity (no write changes yet) + a test on `Actual PLF`. Then do the per-entity transactional apply, mirroring the reporting-pack importer. Keep the bespoke reporting-pack path as the kopeck-perfect fallback.
