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
`docs/superpowers/specs/2026-06-22-deterministic-sheet-routing-design.md`. Core
module + 15 tests committed; orchestrator wiring + the reporting-pack config map
remain (tracked in `docs/CARRYOVER.md`). The earlier BS/CF-single-file spec
(`2026-06-22-bs-cf-single-sheet-routing.md`) is superseded by this.

See also [[project-import-clean-slate-guard]] (the delete-scope corruption
sibling) and [[feedback-server-side-gates]].
