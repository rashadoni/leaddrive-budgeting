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

Status: done

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

Implemented:
- `src/lib/onboarding/ai-import/workbook-profile.ts`
- Workbook profile is built before sheet classification in `runMultiFileImport`
- Compact workbook profile is passed into `buildSheetClassifierUserMessage`
- Preview UI shows workbook profile chips per file
- Tests cover source/summary, actual/budget, BU/entity, formula, total/subtotal, elimination, duplicate signals, prompt wiring, and UI rendering

Verification:
- `npx vitest run src/lib/onboarding/ai-import/workbook-profile.test.ts src/lib/onboarding/ai-import/sheet-classifier.test.ts 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx'`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026 --baseline tmp/ai-import-benchmark/report-2026-06-30T17-22-35-622Z.json`

Latest local benchmark after Task 2:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T17-44-06-745Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 63.8 (Task 1 baseline: 60)
- Human confirmations: 14 (Task 1 baseline: 16)
- Conflicts: 0
- Existing real cases: unchanged scores for main-financial, reporting-pack, and multi-BU
- Generated elimination/summary case: 52.3 (+30.3 vs Task 1 baseline), GREEN

## Task 3 - Approved Template Memory

Status: done

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

Implemented:
- `src/lib/onboarding/ai-import/import-template-memory.ts`
- `Organization.settings.aiImportWorkbookTemplates` versioned template book
- Workbook/batch structure hash based on deterministic workbook profile
- Multi-file orchestrator `templateClassifications` fast path with 0-token classifier usage
- `POST /api/import/ai-auto-templates` and `GET /api/import/ai-auto-templates`
- AI Import UI actions: use saved templates, save template, update template
- Preview response `templateUsage` and per-file `templateApplied` metadata

Verification:
- `npx vitest run src/lib/onboarding/ai-import/import-template-memory.test.ts src/lib/onboarding/ai-import/multi-file-orchestrator.test.ts 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx' src/app/api/import/ai-auto-multi/handler.test.ts`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026 --baseline tmp/ai-import-benchmark/report-2026-06-30T17-44-06-745Z.json`

Latest local benchmark after Task 3:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T18-16-22-406Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 63.8 (Task 2: 63.8)
- Human confirmations: 14 (Task 2: 14)
- Conflicts: 0
- Parsed: 5,829 items / 5,594 cells
- Scores unchanged on the current corpus; template reuse is covered by focused tests because benchmark fixtures do not yet persist approved templates.

## Task 4 - Semantic CoA Mapper

Status: done

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

Implemented:
- `src/lib/onboarding/ai-import/semantic-coa-mapper.ts`
- PLF/BS/CF dynamic adapters now support no-code label fallback for leaf rows.
- Existing CoA candidates are filtered to leaf write-target codes only; parent codes such as `PLF.01` / `BS.02` are skipped to avoid ambiguous writes.
- Low-confidence no-code labels surface structured `semanticCoa.reviewItems` and block apply before any transaction.
- AI Import multi-file UI renders a CoA review table with candidate dropdowns and skip-row decision.
- `semanticCoaMappings` can be submitted on preview/apply and saved into approved template memory.
- Saved templates replay confirmed CoA mappings before semantic matching.

Verification:
- `npx vitest run src/lib/onboarding/ai-import/semantic-coa-mapper.test.ts src/lib/onboarding/ai-import/dynamic-plf-adapter.test.ts src/lib/onboarding/ai-import/dynamic-bs-adapter.test.ts src/lib/onboarding/ai-import/dynamic-cf-adapter.test.ts src/lib/onboarding/ai-import/import-template-memory.test.ts src/lib/onboarding/ai-import/multi-file-orchestrator.test.ts 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx'`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026 --baseline tmp/ai-import-benchmark/report-2026-06-30T18-16-22-406Z.json`

Latest local benchmark after Task 4:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T19-14-34-210Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 64.9 (Task 3: 63.8)
- Human confirmations: 15 (Task 3: 14)
- Conflicts: 0
- Parsed: 5,902 items / 5,667 cells
- No-code BS: 51 (+5 vs Task 3)
- No-code CF: 61.6 (+15.6 vs Task 3)
- No-code PL remains RED because generic `Revenue` / `Payroll` labels require explicit CoA confirmation in the current chart of accounts; the new review UI handles this instead of silently writing an ambiguous mapping.

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
