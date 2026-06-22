---
name: project-import-plankind-routing
description: Multi-file import routes budget/actual only via >>> section sheets — tab-based files (Reporting 2026) silently misroute budget→actual + collide derived views; deterministic-routing fix in progress
metadata: 
  node_type: memory
  type: project
  originSessionId: d1fd1674-9dd2-462e-a31f-ba6077edf4da
---

The multi-file AI import (`runMultiFileImport`) determines each sheet's
`planKind` (actual vs budget) ONLY from in-workbook `>>>` section-separator
sheets (`sheet-meta-extractor.ts` detects names matching `/>>>|<<<|━+|═+/`);
`planKindForSheet` then **silently defaults to `actual`** when no section fires.
It also has no source-vs-derived notion, so every same-`dataType` sheet writes
(clean-slates) into the same plan.

**Why this is a #1-risk (budget-wipe class) gap:** a workbook that keeps budget
vs actual in separate NAMED TABS (e.g. AzerSheker `Reporting 2026.xlsx` —
`Budget PLF` / `Actual PLF`, no `>>>` separators) routes its BUDGET tabs to the
ACTUALS plan, and its ~6 derived views (`CONS PL`, `BS Pivot`, `Marginality`,
`PL Comparison`, `BS Data`, `BU PL`) clean-slate each other. CONFIRMED by a real
apply 2026-06-22: no budget plan written (all `kind=actual`), EDEN balance sheet
collapsed to 4 rows (vs ~70). Plus the route caps at 20MB (Reporting is 25MB)
and the LLM classifier flips dataType between identical runs.

**Fix (in progress, user-approved 2026-06-22, Codex-vetted):** a deterministic
`src/lib/onboarding/ai-import/sheet-routing.ts` `resolveSheetRouting` (authority
chain `>>>` section > per-org sheet-map config > tab-name keyword > dataType
rule; the LLM is advisory ONLY and never appears there; returns `null` instead
of a silent `actual` default) + 4 block-don't-guess gates (ambiguity, collision,
completeness, skip-derived). **Key safety rule:** never silently route an
unresolved sheet to `actual` — BUT the unresolved policy must be WORKBOOK-AWARE
(a pure-actuals file like Guvven Fin has no budget signal → default actual is
safe there; only a MIXED workbook blocks; otherwise the working Guvven import
regresses). Spec + remaining build order:
`docs/superpowers/specs/2026-06-22-deterministic-sheet-routing-design.md`. **SHIPPED 2026-06-22 (commits `fb4e082e`→`04764ed5`, pushed):** the full chain
— classifier wiring, all 4 gates, `REPORTING_PACK_SHEET_MAP`, route cap 20→40MB
+ reporting-pack auto-detect. Codex code-reviewed (P0
conflict-resolution-map-doesn't-gate-the-actual-writes flagged separately → chip
`task_961c2ce8`). 239 tests; Reporting dry-run GREEN. The earlier
BS/CF-single-file spec (`2026-06-22-bs-cf-single-sheet-routing.md`) is superseded.

**APPLY-VERIFY FINDING (the real demo blocker, 2026-06-22):** Reporting 2026's
structured financials (`Actual PLF`/`BS Actual`/`CF Actual`/`Budget PLF`/`Budget
CF`) are **CONSOLIDATED / cross-entity** — classified entityCode=null. The
adapter CORRECTLY refuses them per-company (`Actual PLF`+entity=CPC → 773 items;
+null → 0 + "no entityCode — likely cross-entity"), so importing Reporting
per-company → **0 rows BY DESIGN** (the old "732" was the corrupt collapse, now
correctly gone — NOT a regression). **Per-company account-level data lives in
Guvven Fin** (`PLF CPC`/`PLF EDEN` → 1128/996). Reporting = HOLDING-level
(consolidated budget = the 58.88M strategic plan, [[project-azsheker-budget-is-strategy]]);
to make "drop Reporting" import, default a cross-entity plan-relevant sheet's
entityCode to the org's holding company. User paused on the data-model strategy.

**SHIPPED 2026-06-22 (commit `0bcb4901`, pushed):** cross-entity→holding done.
Per-sheet config override (`SheetMapEntry.entityCode` = `HOLDING_ENTITY_SENTINEL`,
resolved at apply-time to the org's level-1 holding); `effectiveEntityCode`
first-class via the `writeEntity(r)` helper through ALL gates + post-write
bookkeeping (preserves an intentional null no-op, never the classifier guess);
BUDGET-ONLY (Budget PLF/CF carry the sentinel → holding; consolidated ACTUAL tabs
stay null→0-row no-ops, so budget≠actual → NO double-count); PER-FILE sheet-map
(`files[].sheetMap`, so a sibling file's same-named tab isn't overridden);
holding = exactly-one level-1 else no-op. **Codex 4-round-reviewed (thread
019ef023) — no data-corruption concern.** Apply-verified on the real Reporting:
holding AZSEKER got 2057 `kind=budget` lines; the four children kept `kind=actual`
unchanged. Path A complete. (The P0 conflict-resolution-doesn't-gate-writes chip
`task_961c2ce8` is still separate/open. Non-blocking: make an unresolved sentinel
a RED gate for operability.)

See also [[project-import-clean-slate-guard]] (the delete-scope corruption
sibling) and [[feedback-server-side-gates]].
