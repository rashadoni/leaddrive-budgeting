---
name: Visual gate — distinguish data-drift from layout-drift
description: HeatMap baseline diffs from seed re-run / recompute are data-drift, not source regression. Commit message must say which. Layout-neutral source edits should not silently absorb data-drift baseline regens.
type: feedback
---

When the visual baseline gate fails (`npm run test:e2e -- visual-baseline`), the commit's `BASELINE UPDATE:` token must explicitly distinguish:

- **Data-drift**: source delta is layout-neutral; baseline diff comes from values shifting under recompute / new seed values landing / different timestamps.
- **Layout-drift**: source delta touches HeatMap.tsx / CompanyTree.tsx / PanelGrid.tsx / *.module.css inside src/features/terminal/ / src/app/globals.css / tailwind.config.ts.

**Why:** Phase 7.G Turns VI/VIII/X/XI all regenerated the HeatMap baseline. Each regen was driven by data — demo seed (Turn VI), 13 indicator translations seed re-run (Turn VIII), unrelated source edits + sub-pixel drift (Turn X), 43 indicator translations seed re-run (Turn XI). 4 consecutive turns of "BASELINE UPDATE: <reason>" weakens the gate's signal — if the 5th turn ships a layout regression, reviewers / auditors trained to expect data-drift may rubber-stamp it. Per `feedback_visual_verification_gate.md` the gate exists to catch color-blind-shape regressions; data-drift regens that don't touch terminal/* are not the threat the gate was built to catch.

**How to apply:**
- When baseline diff fails AND the source diff is layout-neutral (no terminal/* HeatMap-related edits): `BASELINE UPDATE: data-drift from <seed/recompute/etc.> — source edits in <unrelated path> are layout-neutral`
- When baseline diff fails AND the source diff touches terminal/* layout: `BASELINE UPDATE: layout change at <file:line> — <reason>`. This is the load-bearing case the gate was built for.
- Reviewers checking commit messages should treat data-drift regens as routine; layout-drift regens require diff'd PNGs in the commit + architect verification that the new baseline is intentional.
- If `feedback_visual_verification_gate.md` says baseline regen requires diff'd PNGs in the commit, the data-drift case can attach the diff PNG too — but architect should not block on it (data-drift is expected when seeds change).

**Counter-example pattern (4 turns this Phase 7.G autonomy block):**
- Turn VI: regenerated HeatMap baseline because demo seed added 24 op-cos × ~12 lit cells. Source edits: synthetic-rollup click handler (layout-neutral). 18000-pixel diff.
- Turn VIII: regenerated because 13-indicator seed run inflated values. Source edits: i18n hint paragraph render (Panel 3, NOT HeatMap). 51480-pixel diff.
- Turn X: regenerated because unrelated session activity + sub-pixel drift. Source edits: i18n e2e test (test-only, no source touch). 860-pixel diff (close to 200-pixel threshold).
- Turn XI: regenerated because 43-indicator seed run shifted values. Source edits: indicator-seeds.ts hint translations (data only). Magnitude unspecified.

In all 4, the BASELINE UPDATE token was present but didn't distinguish the data-drift cause. Going forward, distinguish explicitly.

**Future enhancement (~1h, defer):** Visual baseline spec could fingerprint the underlying data state (`SELECT count(*), sum(value) FROM indicator_values`) and skip baseline regen when the data fingerprint changed but the layout didn't. Files as future-improvement only — not blocking.
