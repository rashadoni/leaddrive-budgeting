# AI Import Learning System Task Plan

Purpose: make AI Import smarter for future unknown Excel formats while keeping financial correctness strict. The target is not blind auto-commit. The target is: AI builds a full preview, asks for only risky confirmations, remembers approved decisions, and makes repeat imports nearly automatic.

## Target Outcomes

- New unknown Excel formats: 80-88% automatic understanding before human review.
- Repeated approved formats: 95-98% close to manual-import quality.
- Zero silent data corruption: no broad deletes, no wrong holding/company routing, no budget/actual mixups.
- Risk Terminal updates only after successful import plus recompute.

## Execution Rules

- Keep every change behind preview/reconciliation/safety gates.
- Do not reduce existing clean-slate, conflict, or collateral-deletion protections.
- Do not let low-confidence AI output write directly to production tables.
- Convert every human correction into a reusable template/rule.
- Verify on a corpus of real or anonymized Excel files before production rollout.

## Task 1 - Baseline Import Benchmark

Status: done

Build a repeatable benchmark command for AI Import.

Deliverables:
- `scripts/benchmark-ai-import.ts`
- corpus folder or documented fixture list
- metrics output for classification, entity routing, parsed rows, skipped rows, reconciliation, recompute, and required human confirmations

Acceptance:
- Benchmark runs locally without DB writes by default.
- Produces a before/after score per workbook.
- Covers current AzerSheker files, reporting pack, multi-BU file, no-code P&L, no-code BS, no-code CF, elimination sheets, summary/pivot sheets, and malformed/partial files.

Implemented:
- `scripts/benchmark-ai-import.ts`
- `npm run benchmark:ai-import`
- `docs/AI_IMPORT_BENCHMARK_CORPUS.md`
- `MultiFileImportResult.parseMetrics` for dry-run benchmark counters

Verification:
- `npm run benchmark:ai-import -- --list`
- `npx vitest run src/lib/onboarding/ai-import/multi-file-orchestrator.test.ts`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026`

Latest local baseline:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T17-22-35-622Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 60
- Human confirmations: 16
- Conflicts: 0
- Parsed: 5,823 items / 5,588 reconciliation cells

## Task 2 - Workbook Brain

Status: todo

Add a workbook-level profiling layer before sheet classification.

Deliverables:
- `WorkbookProfile` builder
- source vs summary detection signals
- actual vs budget signals
- month/header/entity/BU/formula/total/subtotal/elimination signals
- duplicate-sheet and repeated-data hints

Acceptance:
- Profile is available in AI Import preview.
- Classifier receives richer workbook context without sending full workbook content.
- Existing imports behave the same or better.

## Task 3 - Approved Template Memory

Status: todo

Persist confirmed workbook decisions so repeated formats become mostly automatic.

Deliverables:
- `ImportTemplate` storage or equivalent existing-table extension
- structure hash and versioning
- approved sheet map: dataType, planKind, source/derived, entity mapping, BU mapping, skip rules, column roles, CoA mapping
- UI actions: save template, use template, update template

Acceptance:
- A successful GREEN import can be saved as a reusable template.
- Re-uploading the same/similar workbook uses the approved template before calling AI.
- Template use still runs preview and reconciliation before apply.

## Task 4 - Semantic CoA Mapper

Status: todo

Support P&L, Balance Sheet, and Cash Flow files that do not contain `PLF.*`, `BS.*`, or `CF.*` codes.

Deliverables:
- label-to-CoA matching layer
- confidence scoring
- review UI for ambiguous rows
- saved CoA mappings in template memory

Acceptance:
- Rows like Revenue, Raw materials, Admin expenses, Cash equivalents, Receivables, Loans payable can map to CoA candidates.
- High-confidence mappings can be prefilled.
- Low-confidence mappings require confirmation before apply.
- Confirmed mappings are reused on future imports.

## Task 5 - Entity Intelligence

Status: todo

Improve company/holding/elimination routing.

Deliverables:
- UI-managed alias dictionary
- entity alias matching for filenames, cells, BU columns, and headers
- elimination detection for EJE/AJE/Elim/Consolidation-style values
- holding vs operational-company review rules
- routing grid for multi-company sheets

Acceptance:
- Common aliases route automatically after approval.
- Elimination rows/sheets default to skip, not company write.
- Holding-consolidated guesses remain review-grade unless template-approved.

## Task 6 - Guided Fix UI

Status: todo

Turn warnings into direct actions.

Deliverables:
- no-entity fix: company dropdown
- ambiguous actual/budget fix: Actual/Budget selector
- source/summary/skip selector
- unknown CoA line selector
- conflict resolution UI: winning file / skip cell
- apply fixes -> rerun preview -> save template flow

Acceptance:
- User can resolve import blockers without leaving AI Import.
- Each fix invalidates stale preview and reruns validation.
- Confirmed fixes can be saved into template memory.

## Task 7 - Visible Safety Receipt

Status: todo

Make the safety state explicit before and after apply.

Deliverables:
- before apply: rows to write, rows to archive, affected companies, affected plans, sections detected, skipped sheets, reconciliation verdict, Risk Terminal recompute targets
- after apply: committed groups, recompute ok/unknown/failed, Risk Terminal links, Indicator Health links, rollback/reset path

Acceptance:
- A demo user can see whether import is fully complete or only written with recompute pending.
- Failed recompute is visible and retryable.

## Task 8 - Rollout And Production Verification

Status: todo

Roll out in safe phases.

Deliverables:
- preview-only rollout first
- benchmark before/after report
- focused tests for template reuse, no-code CoA mapping, entity routing, eliminations, conflict handling, recompute status
- production smoke checklist

Acceptance:
- Repeat AzerSheker import needs no unnecessary manual steps.
- P&L, Sales, COGS populate from imported P&L lines.
- BS and CF populate when source workbook contains real BS/CF data.
- EJE/eliminations do not write as companies.
- Unknown sheets cannot silently corrupt import.
- Risk Terminal recompute is triggered and visibly reported.

## Completion Metrics

- 85%+ correct sheet classification on benchmark corpus.
- 90%+ correct entity routing on known formats.
- 95%+ repeat-import success after template approval.
- 0 silent overwrite or collateral-deletion regressions.
- Recompute result shown after every apply.

## Recommended Order

1. Baseline Import Benchmark
2. Workbook Brain
3. Approved Template Memory
4. Guided Fix UI
5. Semantic CoA Mapper
6. Entity Intelligence
7. Visible Safety Receipt
8. Rollout And Production Verification
