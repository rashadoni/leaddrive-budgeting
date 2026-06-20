# Phase C plan — finish the canonical-model import (multi-company + sign/FX)

**Written 2026-06-20. Start commit `256db707` (main). Baseline: tsc 0, vitest 5865.**

Canonical model (Codex-confirmed): **`account × period × entity × scenario × currency`**.
Phase C slice 1 (multi-year period) is already done. Two big pieces remain:
multi-company-in-one-sheet (the `entity` dimension) and sign/currency as
first-class dimensions. This is the **#1 data-corruption surface** — every
write slice honors the clean-slate guard scoped per `(org, plan, company[,
entity])`, validate-before-write, server-side gates, `deletedAt:null` reads.

## Architecture decisions (stress-tested + Codex-reviewed before any write slice)

1. **Parse PER ENTITY, mirroring `reporting-pack-importer.ts`.** Split the
   sheet into one synthetic single-entity worksheet per entity-column value,
   then run the EXISTING `applyProposal` on each. Dedup, control-totals and
   section-tracking are all entity-local — a flat parse would collapse the
   same leaf code across entities (the exact bug the bespoke BU-split fixed).
2. **A parallel `apply-multi-entity` route, NOT a retrofit of `/apply`.** The
   single-company `/apply` is the corruption-tested path scoped to
   `staging.companyId`. Multi-company changes the write fan-out (N companies,
   N clean-slates in one tx) + adds entity→company resolution. A dedicated
   route (mirroring the `apply-multi` precedent) keeps the single path
   byte-for-byte unchanged and isolates the new corruption surface.
3. **No schema migration — encode in `proposal` Json + form fields.** Matches
   the established multi-sheet / template-store / structure-hash pattern.
   `ImportStaging.companyId` stays the FK-satisfying "anchor". The
   entity→company assignment travels as an `entityMap` form field at apply
   time (reviewer-built), exactly like `userOverrides`.
4. **`entity` is a column role.** A column whose per-row value routes the row
   to a company. `resolveColumns` already ignores unknown roles, so the entity
   column is naturally excluded from code/label/month resolution.

## Corruption-critical invariants (every write slice) — Codex-reviewed 2026-06-20

- The per-entity clean-slate `deleteMany` WHERE is EXACTLY
  `(organizationId, planId, companyId)` for THAT entity — never broader, never
  the bare `(org, plan)` that would wipe siblings. The delete fires at most
  ONCE per distinct companyId.
- **`entityMap` MUST be injective** (Codex P0-1): two raw entity values mapping
  to the same `companyId` is a collateral-wipe path — `budget_lines` has no
  unique constraint, so the 2nd group's clean-slate deletes the 1st group's
  just-inserted rows (or duplicates them). Reject many-to-one with 409. (A
  consolidation mode is a separate, explicitly-designed feature, not this.)
- **Persist the reviewed entity config** (Codex P0-2): the map defines the
  destructive footprint, so it is NOT incidental input. `analyze` persists the
  discovered `entityValues` + `entityColumnIndex` into `proposal.__multiEntity`
  (reserved key, mirrors `__structureHash`). The committed map is persisted into
  `ImportStaging.userOverrides` inside the apply tx (audit snapshot of exactly
  what was written). The schema contract: staging is "the snapshot of what the
  user confirmed".
- **Entity-set equality at commit** (Codex P0-3): structure-hash guards column
  layout, NOT the BU distribution. Commit recomputes the re-uploaded file's
  distinct entity values and asserts they EQUAL the persisted reviewed set →
  409 on drift (a re-upload with the same columns but different BU values must
  not route/delete a different company set than the reviewer approved).
- **All-or-none:** any entity that fails to parse, OR any entity value present
  in the file but NOT mapped to a company → hard 409 with ZERO writes. Never
  silently drop an entity's rows.
- **Blank entity cell policy** (Codex P1-5): a blank entity value is its OWN
  bucket (surfaced as `(blank)` in preview) — NEVER silently forward-filled and
  NEVER silently dropped. If present it must be mapped to a company or the
  commit 409s.
- An entity in the map but ABSENT from the file → its existing data is
  untouched (no delete fires for it). Correct: we only clean-slate entities we
  are about to rewrite.
- Server-side gates re-run in the route (UI advisory): RED control-total = hard
  block; critical anomalies / low-confidence = ack-gated.
- One `$transaction` wraps all per-entity deletes+inserts → partial failure
  rolls back ALL entities.
- **Shared write primitive** (Codex P1-7): extract
  `applyParsedLinesToCompany(tx, {...})` (one company's delete-then-insert) and
  call it per entity — do NOT hand-copy a 4th delete/insert/audit body and let
  it drift from `/apply` + `/apply-multi`.

---

## Part 1 — Multi-company-in-one-sheet (entity dimension)

### Slice C2.1 — entity role + per-entity split parser (read-only, pure, TDD)
- `types.ts`: extend `ColumnMappingProposal['role']` with `'entity'`.
- NEW `src/lib/onboarding/ai-mapper/entity-split.ts`:
  - `findEntityColumn(columns) → number | null`
  - `extractEntityValues(workbook, sheet, entityColIdx, xlsx) → string[]`
    (distinct, blank → its own `""` bucket surfaced as `(blank)`)
  - `applyProposalByEntity(...) → { entityColumn; entityValues; perEntity:
    Array<{entityValue, result|error}> } | {error}` — AoA → keep the full
    header band in every synthetic sheet + group data rows by entity value →
    synthetic single-entity workbook per value → `applyProposal` per group.
- TDD `entity-split.test.ts`: 2-BU sheet with the same dotted leaf code in both
  BUs → 2 entities split; per-entity counts correct; **same leaf NOT
  cross-deduped** (Codex adversarial: same account code under two entities →
  two independent results); per-entity control-totals independent; distinct
  entity values; blank-entity row → `(blank)` bucket (not dropped, not
  forward-filled); no-entity-column → error.

### Slice C2.2 — entity→company resolution (pure, TDD)
- `resolveEntityCompanies(values, companies)` — auto-match each value to an org
  company by code (ci) → name (ci) → normalized-contains; returns
  `{suggestions, unresolved}`; reviewer overrides in UI. Generic, data-driven
  analogue of the bespoke `mapReportingPackBu`. **Injectivity is enforced at
  the route, not here** (the reviewer may legitimately leave duplicates to
  fix).

### Slice C2.3 — shared write primitive + `apply-multi-entity` route (THE corruption-zone slice, TDD)
- NEW `src/lib/onboarding/ai-mapper/apply-lines.ts` —
  `applyParsedLinesToCompany(tx, {orgId, planId, companyId, lines,
  baseCurrencyCode})`: the one-company delete-then-insert primitive (clean-slate
  scoped to `(org, plan, company)` + CoA upsert + 12-row monthly fan-out),
  extracted verbatim from `/apply` so the new route does NOT hand-copy it
  (Codex P1-7).
- NEW `POST /api/onboarding/import/staging/[id]/apply-multi-entity`. Mirrors
  apply/apply-multi (auth, rate-limit, status gating, file re-upload,
  structure-hash guard, dry-run). Then, BEFORE the tx:
  - recompute the file's distinct entity values; assert they EQUAL the
    persisted `proposal.__multiEntity.entityValues` (409 on drift — Codex P0-3);
  - read `entityMap` form field; assert it covers every file entity value
    (all-or-none), is **injective** (Codex P0-1), and every companyId is in-org;
  - run `applyProposalByEntity`; any entity parse error → 409 zero-write;
  - worst control-total verdict across entities; RED → hard 409; anomaly/
    low-conf ack-gated.
  - Inside ONE tx: resolve the shared plan once, then call
    `applyParsedLinesToCompany` per entity (delete fires once per distinct
    company); persist the committed `entityMap` into `userOverrides`; mark
    applied. Recompute fan-out for all affected companies; audit
    `multiEntity:true`.
- TDD `handler.test.ts` (Codex-required adversarial set): 401 / 404 /
  applied→409 / **two values→same company 409** / present-unmapped 409 /
  cross-org companyId 409 / **entity-set drift 409** / RED 409 / **one entity
  parse error → zero writes** / happy-path asserts delete fires exactly once
  per distinct company with the `(org, plan, company)` WHERE + recompute fan-out
  + same account code lands under two companyIds.

### Slice C2.4 — mapper prompt + analyze detection + UI mapping step
- prompt: a BU/company/entity column (any language) → role `entity`. Auto-bumps
  prompt version.
- ROLE_OPTIONS: add `entity`.
- analyze: when the proposal carries an `entity` column, compute the distinct
  `entityValues` and persist `proposal.__multiEntity = { entityColumnIndex,
  entityValues }` (Codex P0-2 — the reviewed set the commit checks against);
  return `entityValues` + a suggested map (`resolveEntityCompanies`) to the UI.
- UniversalImportForm: entity-mapping sub-table (value → company picker +
  create-new-company); route commit to `apply-multi-entity`. Surface per-entity
  preview + the same gate acks.

## Part 2 — Sign + currency as first-class dimensions

### Slice C3.1 — sign as a per-section/per-template inferred dimension
- Replace the global cogs/expense flip with a per-section inferred sign
  convention; validate via subtotal equations + expected polarity; ambiguous →
  `sign` finding → review gate. Current convention stays the default
  (back-compat).

### Slice C3.2 — currency role
- A `currencyRole` on value columns (reporting vs local vs FX-rate). Mapper
  classifies. Catch "USD + local as duplicate periods/entities" as a
  currency-mix (not a duplicate-month error). Tag `BudgetLine.currencyCode`
  from the column role.

## Workflow
tsc + vitest mid-slice; one commit per slice with a ROADMAP changelog entry in
the same commit; `git push origin main` after each. Verify the engine on real
files in `~/Documents/budget azersheker/` (`Reporting 2026.xlsx` `Actual PLF` —
the BU multi-company test) via a temp tsx script (~$0.04), deleted after.
