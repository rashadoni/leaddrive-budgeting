# Claude next work — Risk Terminal B1.2 pure statement control builders

Date: 2026-07-19
Repository: `/home/rashad/projects/leaddrive-budgeting`
Start from: `8cff53fa4226fcd1d324eb72c2d79c16312c18d7`

## Objective

Continue B1 with the next additive, shadow-only slice: define pure canonical
statement snapshot inputs and builders for the five reconciliation controls.
Do not connect them to a database, API route, UI, recompute pipeline, alert,
score, colour or production runtime.

The five controls are:

1. balance sheet: assets = liabilities + equity;
2. cash-flow sum: CFO + CFI + CFF = net cash movement;
3. cash tie-out: closing cash from cash flow = balance-sheet cash;
4. retained earnings: opening retained earnings + net income - distributions
   + explicitly represented direct adjustments = closing retained earnings;
5. net-income link: P&L net income = the explicitly named linked statement
   value for the same organization/company/period/basis/currency/unit.

## Mandatory first steps

1. Run `git status --short` before any edit.
2. Read `AGENTS.md`, `docs/ROADMAP.md`,
   `docs/risk-terminal-2.0/IMPLEMENTATION-STATUS.md`,
   `docs/risk-terminal-2.0/03-DATA-KPI-TRUST-SPEC.md`,
   `docs/risk-terminal-2.0/06-OWNER-DECISION-PACK-T1-T5.md`,
   `src/lib/risk/statement-reconciliation.ts` and its test in full.
3. Inspect, do not silently consolidate, the existing paths:
   `src/lib/risk/pnl-aggregation.ts`,
   `src/lib/budgeting/ebitda.ts`,
   `src/lib/risk/company-financials-snapshot.ts`,
   `src/lib/audit/ifrs-checks.ts`,
   `src/lib/onboarding/reconciliation.ts` and
   `src/lib/onboarding/ai-import/universal-reconciler.ts`.
4. Use the installed Claude skills `gl-recon`, `audit-xls` and
   `3-statement-model` as review checklists. They inform control coverage;
   they do not authorize changing business methodology.

## Protected existing work

Preserve these pre-existing user changes exactly. Do not stage, edit, delete,
move or reformat them:

- `.claude/settings.json`
- `output/`
- `scripts/check-sales-parse-local.ts`
- `scripts/import-fo-workbook-local.ts`
- `scripts/recompute-local-all.ts`

Never use `git add .` or `git add -A`. Stage only exact files created or
changed for this slice.

## Required implementation

Create a pure module, preferably
`src/lib/risk/statement-control-builders.ts`, plus focused tests.

The public input contract must make the following explicit rather than infer
them from labels or global state:

- organizationId, companyId, periodKey and basis;
- currency and unit;
- revisionId and sourceRowCount for every derived side;
- opening/closing period role where relevant;
- each component used in an equation;
- sign convention for cash-flow and distributions;
- whether direct retained-earnings adjustments exist, with their explicit
  value and provenance.

Each builder must return a `StatementControlInput` for the existing evaluator.
Do not duplicate tolerance, materiality, decision-status or reason logic. Do not
add an implicit or exported default T-1 policy.

Add tests that prove:

- exact equations for all five builders;
- negative cash-flow and distribution signs are not silently inverted;
- opening and closing periods cannot be mixed;
- organization/company/basis/currency/unit mismatches are preserved for the
  evaluator to block, or rejected deterministically by the builder;
- source-row counts and revision lineage are propagated from the actual
  components, never fabricated;
- an absent component is represented as missing evidence, not silently zero,
  unless the type explicitly marks that component as an evidenced zero;
- builders are deterministic and have no I/O.

## Owner gate and stop conditions

T-1 is a proposal only. Do not call it approved, do not encode its proposed
numbers as a runtime default and do not mark B1 complete. Stop and document the
question instead of guessing if an equation requires a business choice not
already fixed in the trust spec.

Do not:

- change any existing financial value, formula path or import behavior;
- add a runtime caller, persistence, schema migration, seed or production row;
- reset a password/passwordHash or change authentication/authorization;
- store credentials or activate any paid/trial provider;
- call Anthropic, paid Google Trends, Moody's, S&P Global or FactSet;
- deploy to production.

Stage F is plan-only: Moody's is the future first read-only coverage pilot;
S&P Global versus FactSet is a later one-provider comparison after reconciled
internal truth, one real close cycle and separate commercial approval.

## Verification and documentation

Run with the existing Node runtime:

```bash
PATH=/home/rashad/.nvm/versions/node/v24.18.0/bin:$PATH npx vitest run <new-test-file>
PATH=/home/rashad/.nvm/versions/node/v24.18.0/bin:$PATH npx tsc --noEmit
PATH=/home/rashad/.nvm/versions/node/v24.18.0/bin:$PATH npx vitest run --reporter=dot
PATH=/home/rashad/.nvm/versions/node/v24.18.0/bin:$PATH npm run build
git diff --check
```

Update B1 in `docs/ROADMAP.md` and append its changelog only with the exact
implemented scope and evidence. Add a numbered slice to
`docs/risk-terminal-2.0/IMPLEMENTATION-STATUS.md`. Keep mart/runtime/cutover
blocked on T-1 and golden evidence.

Before committing, show that only the intended paths are staged. Use a
path-scoped commit. Push is allowed after tests; production deploy is not.
End with what is implemented, test counts, remaining owner gates and the exact
next safe step.
