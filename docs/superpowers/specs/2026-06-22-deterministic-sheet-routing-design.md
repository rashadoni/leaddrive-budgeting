# Deterministic Sheet-Routing for Multi-File Import — Design

**Date:** 2026-06-22
**Status:** Approved (user "апрувлю" 2026-06-22) · Codex-vetted (thread 019eef90)
**Scope:** demo-minimal (this effort) + robust roadmap (follow-up)
**Risk class:** #1 (budget/actual plan routing = the "budget-wipe" data-corruption class)

## Problem (confirmed by a real import)

The multi-file AI import auto-classifies each sheet into `(entity, dataType, planKind)`.
`planKind` (actual vs budget) is today derived ONLY from in-workbook `>>>`
section-separator sheets; with no separator it **silently defaults to `actual`**
(`sheet-classifier.ts` `planKindForSheet`:130).

A real workbook (29-sheet reporting pack) keeps budget vs actual in separate
**named tabs** (`Budget PLF`, `Actual PLF`) with no `>>>` separators, and also
carries ~6–10 **derived/summary views** of the same numbers (consolidations,
pivots, comparisons, margin analyses) beside the **source** tabs.

Confirmed apply result (evidence, not theory):
- **Budget collapsed into actual** — only a `kind=actual` plan was written, no
  budget plan. Budget tabs routed to the actuals plan.
- **Collision** — the 6 same-`dataType` balance-sheet views clean-slated each
  other; one entity's BS ended with **4 rows instead of ~70**.
- **Non-determinism** — the LLM flipped `Actual`/`Budget` between `PLF` and
  `BUDGET_ACTUALS` across two identical runs.

## Root cause

1. `planKind` has no authority chain and an unsafe default (`→ actual`).
2. No notion of source-vs-derived → every view writes → collisions.
3. LLM is treated as authoritative for routing it cannot do reliably.

## Design (Codex-vetted)

**Authority order for `planKind` (deterministic wins; LLM is advisory only):**

```
>>> section separator  >  per-org sheet-map config  >  tab-name keyword  >  saved human decision
```

The LLM may *hint* "looks like budget" but may NEVER, by itself, send rows to a
plan. `temperature=0` buys repeatability, not correctness.

**Non-negotiable safety gates (block — never guess):**

1. **Ambiguity-block** — if `planKind` has no trusted signal → BLOCK + flag the
   sheet for review. No silent default to `actual`.
2. **Collision-block** — group writable (source) sheets by clean-slate scope
   `(org, entity, dataType, planKind, period-range)`; if ≥2 source sheets land
   in one scope → BLOCK (this is the EDEN-BS-=4 cause).
3. **Completeness-block** — if every candidate sheet for an
   `(entity, dataType, planKind)` is `derived_summary` → BLOCK (don't silently
   import nothing).
4. **Skip-derived (visible)** — `role=derived_summary` sheets are skipped and
   **recorded in the import report**, not quietly filtered.

**Product shift (honest):** "drop ANY file → AI auto-imports" becomes "drop a
file → AI proposes the mapping → known/unambiguous shapes auto-import; new or
ambiguous shapes you approve once, then the system remembers." Safer, still
AI-assisted, and it learns file shapes.

## Scope

**Demo-minimal (this effort):**
- `resolveSheetRouting(dataType, sheetName, section, config)` → `{planKind, role}`
  or `{ambiguous, reason}`; deterministic authority order; LLM advisory only.
- Sheet-map config for the reporting-pack shape (tab → dataType/planKind/role).
- The 4 safety gates wired into the orchestrator (pre-write, manifest-style).
- Raise the multi-file route cap 20 → 40 MB (verify the proxy body cap allows it).
- Verify by applying the real reporting pack: separate budget + actual plans,
  zero collisions, the previously-broken entity BS back to ~70 rows.

**Robust roadmap (after the demo):**
- Manifest preview-then-approve UI (show write/skip/block/reason before writing).
- Persist human review decisions as future deterministic signals.
- LLM *suggests* a sheet-map for unknown shapes (human approves, then saved).
- Regression fixtures for every corruption class (Codex's list).

## File structure

- Create: `src/lib/onboarding/ai-import/sheet-routing.ts` — `resolveSheetRouting`
  + the sheet-map config type + the known reporting-pack map. Pure, unit-tested.
- Create: `src/lib/onboarding/ai-import/sheet-routing.test.ts` — routing +
  every gate's block path.
- Modify: `sheet-classifier.ts` — `planKindForSheet` delegates to (or is
  replaced by) `resolveSheetRouting`; stop defaulting to `actual`.
- Modify: `multi-file-orchestrator.ts` — build the pre-write manifest, run the
  4 gates, skip derived, block on any gate.
- Modify: `src/app/api/import/ai-auto-multi/route.ts` — cap 20 → 40 MB; update
  `handler.test.ts` boundary case.

## TDD task order

1. `resolveSheetRouting` pure module + tests (routing + ambiguity-block).
2. Reporting-pack sheet-map config + tests (Budget PLF→budget/source,
   CONS PL/Pivot/Comparison/Marginality→derived, etc.).
3. Orchestrator manifest + gates (collision, completeness, skip-derived) + tests.
4. Route cap bump + handler test.
5. Codex review of the routing code (import-path #1-risk).
6. End-to-end verify: reset → apply reporting pack → assert budget+actual split,
   no collision, entity BS ~70.

## Verification (definition of done)

`reset → apply reporting pack` yields:
- a `kind=budget` plan AND a `kind=actual` plan, both populated;
- zero clean-slate collisions (each scope has exactly one source sheet);
- the entity whose BS broke (4 rows) back to its full ~70;
- ambiguous/derived sheets reported, not silently dropped.

## Discovered during implementation (2026-06-22)

Part 1 (the pure `resolveSheetRouting` core + 15 tests) is built, committed,
and passing. Wiring it into the orchestrator surfaced two subtleties the
next build session MUST honor:

1. **The unresolved-source policy must be WORKBOOK-AWARE — or it regresses
   the working files.** Guvven Fin (pure actuals) has no budget tabs. If we
   blocked every `planKind=null` source sheet, a pure-actuals workbook whose
   sheets carry no `>>>`/keyword signal would break (it currently — correctly
   — lands in the actuals plan). Policy: compute a workbook-level
   `hasBudgetSignal` (any sheet resolved to budget, or any budget keyword/
   section present). Then for a SOURCE sheet with `planKind=null`:
   `hasBudgetSignal → BLOCK` (mixed workbook, can't guess);
   `!hasBudgetSignal → actual` (pure-actuals, safe, preserves Guvven). The
   registry's existing `targetPlanKind ?? "actual"` is only safe AFTER this
   gate has run — a raw null must never reach the adapter in a mixed workbook.

2. **Entity-specific source sheets overlap the all-entity source.**
   Reporting's `PL EDEN` / `BS EDEN` carry no derived-name pattern, so the
   pure module marks them `role=source`. But they re-present numbers already
   in `Actual PLF` / `BS Actual`, so two source sheets land in the same
   `(entity, dataType, planKind)` scope → collision. Two defenses (use both):
   the **collision-block** (≥2 source → one scope → BLOCK) catches it
   generically, and the **reporting-pack config map** should mark the
   entity-view tabs `role=derived_summary` so they're skipped cleanly. Building
   that map requires inspecting which Reporting tab is the canonical source per
   scope (e.g. is `BS Actual` all-entity, or does EDEN only live in `BS EDEN`?)
   — a short data-inspection task, not a guess.

**Remaining build order (unchanged from above, with #1/#2 folded in):**
classifier stamps planKind+role via `resolveSheetRouting` (allow null) → add
`role` to `SheetClassification` → orchestrator: skip derived, workbook-aware
unresolved policy, collision-block, completeness-block → reporting-pack config
map (after inspecting tab structure) → route cap 20→40MB → Codex review →
reset+apply Reporting verify.
