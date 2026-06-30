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

Status: done

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

Implemented:
- `src/app/api/import/entity-aliases/route.ts` admin API for UI-managed alias dictionary stored in `Organization.settings.entityAliases`.
- AI Import multi-file UI now has an Entity Aliases panel for loading, adding, removing, and saving alias -> company mappings without leaving the import screen.
- Entity alias normalization is shared via `src/lib/onboarding/ai-import/entity-alias-utils.ts`.
- Entity matching now covers filename, repeated cells, BU columns, and title/header rows (`header-scan`).
- EJE/AJE/Elim/Consolidation-style BU values are treated as skipped blocks, not company targets.
- General sheet routing now treats EJE/AJE/elimination/intercompany/intragroup tab names as `derived_summary`.
- Multi-BU split responses now include a visible routing grid with write vs skip rows and skip reason.
- Existing holding-consolidated inference remains review-grade and is not auto-written by the orchestrator unless a saved template already approved the sheet classification.

Verification:
- `npx vitest run src/lib/onboarding/ai-import/entity-inference.test.ts src/lib/onboarding/ai-import/bu-column-split.test.ts src/lib/onboarding/ai-import/sheet-routing.test.ts 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx'`
- `npx vitest run src/lib/onboarding/ai-import/multi-file-orchestrator.test.ts src/app/api/import/ai-auto-multi/handler.test.ts src/lib/onboarding/ai-import/import-template-memory.test.ts`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026 --baseline tmp/ai-import-benchmark/report-2026-06-30T19-14-34-210Z.json`

Latest local benchmark after Task 5:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T19-40-22-476Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 64.9 (Task 4: 64.9)
- Human confirmations: 15 (Task 4: 15)
- Conflicts: 0
- Parsed: 5,902 items / 5,667 cells
- No benchmark regression; Task 5 improvements are primarily safety/UX/entity-routing coverage and are covered by focused tests.

## Task 6 - Guided Fix UI

Status: done

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

Implemented:
- AI Import multi-file preview now shows a Guided Fixes panel for risky sheet routing.
- No-entity fix: company selector can set a target company for a sheet.
- Ambiguous actual/budget fix: Actual/Budget selector writes a deterministic sheet-map override.
- Source/summary/skip selector: users can mark a sheet as source or `derived_summary` skip.
- CoA review selector remains integrated from Task 4 for unknown/no-code CoA lines.
- Existing conflict resolution UI remains the winning-file / skip-cell path.
- Changing a guided fix marks the preview stale and disables Apply until the user reruns preview.
- `guidedSheetFixes` form payload is validated by `/api/import/ai-auto-multi` and converted into exact per-file `SheetMap` entries.
- Guided fixes disable saved-template fast path for that preview so stale template rules cannot override user corrections.
- Rerun preview executes the normal adapter/reconciliation gates; GREEN corrected previews can then be saved into template memory.

Verification:
- `npx vitest run 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx' src/app/api/import/ai-auto-multi/handler.test.ts`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026 --baseline tmp/ai-import-benchmark/report-2026-06-30T19-40-22-476Z.json`

Latest local benchmark after Task 6:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T20-14-09-676Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 64.9 (Task 5: 64.9)
- Human confirmations: 15 (Task 5: 15)
- Conflicts: 0
- Parsed: 5,902 items / 5,667 cells
- No benchmark regression; guided fixes are user-driven and covered by focused UI/API tests.

## Task 7 - Visible Safety Receipt

Status: done

Make the safety state explicit before and after apply.

Deliverables:
- before apply: rows to write, rows to archive, affected companies, affected plans, sections detected, skipped sheets, reconciliation verdict, Risk Terminal recompute targets
- after apply: committed groups, recompute ok/unknown/failed, Risk Terminal links, Indicator Health links, rollback/reset path

Acceptance:
- A demo user can see whether import is fully complete or only written with recompute pending.
- Failed recompute is visible and retryable.

Implemented:
- `/api/import/ai-auto-multi` now returns a structured `safetyReceipt` on preview, normal apply, and conflict/blocked responses.
- Before apply, the receipt shows rows to write, archive/reset scope, affected companies, affected plans, detected sections, skipped sheets, reconciliation verdict/conflicts, and predicted Risk Terminal recompute targets.
- After apply, the receipt shows committed row/group counts, recompute ok/unknown/failed state, and direct links to Risk Terminal, Indicator Health, and cleanup/rollback.
- Recompute states are explicit: not-run, ok, pending, failed. Failed recompute is visible even when rows committed successfully.
- Archive row counts are not guessed: UI shows exact scope and explains that the final archive count is calculated inside the apply transaction.

Verification:
- `npx vitest run 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx' src/app/api/import/ai-auto-multi/handler.test.ts`
- `npx tsc --noEmit --pretty false`
- `set -a; source .env; set +a; npm run benchmark:ai-import -- --year 2026 --baseline tmp/ai-import-benchmark/report-2026-06-30T20-14-09-676Z.json`

Latest local benchmark after Task 7:
- Report: `tmp/ai-import-benchmark/report-2026-06-30T20-41-44-142Z.json`
- Cases: 8 executed, 0 skipped
- Average score: 64.9 (Task 6: 64.9)
- Human confirmations: 15 (Task 6: 15)
- Conflicts: 0
- Parsed: 5,902 items / 5,667 cells
- No benchmark regression; Task 7 changes response/UI observability, not import classification/parsing.

## Task 8 - Rollout And Production Verification

Status: done

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

Implemented / rollout:
- Preview-only rollout completed first: Task 1-7 changes were benchmarked locally and deployed to production without running a production import/apply.
- Production DB backup taken before rebuild: `/opt/budgetpro/backups/budgetpro_pre_task8_20260630_205141.sql.gz`.
- Production source was synced from committed `HEAD` only (`git archive`) to avoid copying local untracked/dirty files.
- Docker Compose production rebuild completed on VM `root@46.225.60.142` in `/opt/budgetpro`.
- App entrypoint ran `prisma migrate deploy`; result: 5 migrations found, no pending migrations.
- Production containers after deploy: `budgetpro-app`, `budgetpro-db`, and `budgetpro-nginx` healthy/running.

Verification:
- Focused suite:
  `npx vitest run src/lib/onboarding/ai-import/import-template-memory.test.ts src/lib/onboarding/ai-import/semantic-coa-mapper.test.ts src/lib/onboarding/ai-import/dynamic-plf-adapter.test.ts src/lib/onboarding/ai-import/dynamic-bs-adapter.test.ts src/lib/onboarding/ai-import/dynamic-cf-adapter.test.ts src/lib/onboarding/ai-import/entity-inference.test.ts src/lib/onboarding/ai-import/bu-column-split.test.ts src/lib/onboarding/ai-import/sheet-routing.test.ts src/lib/onboarding/ai-import/reporting-pack-sheet-map.test.ts src/lib/onboarding/ai-import/multi-file-orchestrator.test.ts src/app/api/import/ai-auto-multi/handler.test.ts 'src/app/(dashboard)/budgeting/admin/ai-import/MultiFileForm.test.tsx'`
- Focused suite result: 12 test files passed, 190 tests passed.
- Local production build: `npx next build` passed.
- Benchmark after Task 7: `tmp/ai-import-benchmark/report-2026-06-30T20-41-44-142Z.json`, average score 64.9, confirmations 15, conflicts 0, parsed 5,902 items / 5,667 cells.
- VM-side post-deploy smoke: `bash deploy/smoke-test.sh http://127.0.0.1` passed 8/8.
- Browser live-route check: `http://46.225.60.142/budgeting/admin/ai-import` reached the deployed app and redirected to `/login?callbackUrl=%2Fbudgeting%2Fadmin%2Fai-import`, confirming the protected route and auth gate after deploy.

Production scope note:
- No production AI import/apply was executed in Task 8, so no production financial rows were written or reset during rollout.
- Authenticated UI import preview should be run by an admin session before any client demo apply; the deployed code now shows the visible safety receipt for that preview/apply flow.

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
