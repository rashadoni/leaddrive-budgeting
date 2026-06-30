# AI Import Benchmark Corpus

This file documents the default corpus used by `scripts/benchmark-ai-import.ts`.
The command always runs AI Import with `dryRun: true`; it measures preview,
classification, routing, parsing, reconciliation, recompute targets, and likely
human confirmations without committing rows.

## Default Command

```bash
npx tsx scripts/benchmark-ai-import.ts --list
DATABASE_URL=... ANTHROPIC_API_KEY=... npx tsx scripts/benchmark-ai-import.ts --org-slug azmade --year 2026
```

Reports are written under `tmp/ai-import-benchmark/`, which is ignored by git.
Use `--baseline <previous-report.json>` to print before/after score deltas.

## Cases

| ID | Coverage | Source |
| --- | --- | --- |
| `azersheker-main-financial` | current AzerSheker PLF/BS/CF/KPI/CAPEX workbook | `/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx` |
| `reporting-pack` | reporting pack, budget/actual split, derived summaries, pivots, eliminations | `/Users/rashadrahimov/Documents/budget azersheker/Reporting 2026.xlsx` |
| `actual-budget-multi-bu` | multi-BU file with BU-column entity routing | `/Users/rashadrahimov/Documents/budget azersheker/actual-budget-v1.xlsx` |
| `generated-no-code-pl` | no-code P&L labels such as Revenue, Raw materials, EBITDA | generated at runtime |
| `generated-no-code-bs` | no-code Balance Sheet labels such as Cash, Receivables, Loans payable | generated at runtime |
| `generated-no-code-cf` | no-code Cash Flow labels such as receipts, supplier payments, closing cash | generated at runtime |
| `generated-elimination-summary` | EJE/elimination tab plus pivot summary tab | generated at runtime |
| `generated-malformed-partial` | sparse/malformed workbook that should not silently write data | generated at runtime |

## Metrics

- Classification: expected file type match, classified sheets, token use.
- Entity routing: PLF/BS/CF sheets with/without concrete target entity.
- Parsing: parsed sheets, adapter item count, reconciliation keys, skipped and blocked sheets.
- Reconciliation: overall verdict, per-group verdicts, conflict count.
- Recompute: dry-run target counts stay zero; apply-mode recompute remains outside this benchmark.
- Human confirmations: estimated blockers from conflicts, unknown file types, missing entities, yellow groups, and review warnings.
