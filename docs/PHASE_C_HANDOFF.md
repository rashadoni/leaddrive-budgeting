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

### 1. Multi-company-in-one-sheet (entity as a first-class dimension)
A sheet with a "business unit / company" column (e.g. the reporting-pack `Actual PLF` BU column) currently imports as ONE company via the generic path. Make entity a per-row dimension:
- Add a column role like `entity` (a column whose value routes each row to a company), OR a per-section entity (like the bespoke BU-split).
- `applyProposal` must emit lines tagged with their entity; the apply route must route them to multiple companies in ONE transaction.
- **Hard constraint:** `ImportStaging.companyId` is a SINGLE company today (schema `prisma/schema.prisma:1669`), and `apply` writes to that one company with a clean-slate-then-insert scoped to `(org, plan, company)`. Multi-company means the clean-slate + insert must run per-entity — **this is the #1 corruption surface; see `memory/project_import_clean_slate_guard.md` + `feedback_server_side_gates.md`.** The collateral-deletion guard must hold per-entity.
- **Reference implementation that already does this correctly:** the bespoke `src/lib/onboarding/adapters/reporting-pack-detail.ts` + `reporting-pack-importer.ts` (BU-split AzerSheker → per-entity, kopeck-verified). Mirror its per-entity transactional pattern in the generic path.

### 2. Sign + currency as first-class dimensions
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
