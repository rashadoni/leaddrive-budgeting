# Layout-touching commits MUST run the visual gate

## Why

Phase 7.G Turn E (2026-05-03) closed CARRYOVER L132 — a 19-turn-old architect ⚠️
documenting that "tsc + vitest pass, but UI is broken" was costing ~2 wasted commits
per round of layout work × ~30 min per recovery. The empirical pattern was: a CSS
or styling change shipped, both type-check and unit-test stayed green, the UI
regressed, and the regression was caught only when the developer manually ran
`mcp__computer-use__screenshot` ad-hoc.

Phase 7.G Turn D shipped Playwright (10 cases / 1.0min, all DOM-level). Turn E
extended the harness with a `toHaveScreenshot()` baseline on the highest-leverage
layout surface: the Risk Terminal HeatMap at `/budgeting/terminal`. The gate is now
hard — silent-pass on a layout regression is mathematically impossible.

This memory codifies the **rule** part of the closure (the **teeth** part is the
spec + baseline + `pre-demo-check.sh` wiring). Without the rule, future autonomous
Claude sessions might reflexively run `npm run test:e2e -- --update-snapshots` to
"fix" a baseline diff, silently re-baselining the regression.

## The rule

**Layout-touching commits MUST run the visual gate before commit. Snapshot drift
is an *intentional* baseline regeneration, not a bypass.**

A commit is **layout-touching** if it modifies any of:

- `src/features/terminal/components/HeatMap.tsx`
- `src/features/terminal/components/CompanyTree.tsx`
- `src/features/terminal/components/PanelGrid.tsx`
- Any `*.module.css` file inside `src/features/terminal/`
- Any global stylesheet (`src/app/globals.css`, `tailwind.config.ts`)
- Any change to a Tailwind utility class on a HeatMap/Tree/PanelGrid descendant

Workflow:

```
# 1. Make the layout change
# 2. Run the gate
npm run test:e2e -- visual-baseline

# 3a. If green → ship as normal commit
# 3b. If red → triage:
#     - Was the visual change INTENTIONAL?
#       Yes → regenerate baseline + include diff:
#         npm run test:e2e -- --update-snapshots
#         git add e2e/smoke/visual-baseline.spec.ts-snapshots/*.png
#       Commit message MUST include line:  BASELINE UPDATE: <reason>
#     - Was the change UNINTENTIONAL?
#       Fix the layout, re-run gate until green, ship.
```

The `BASELINE UPDATE:` token in commit messages is the architect-auditable signal
that a baseline was regenerated deliberately, not reflexively. Future pre-commit
hook enhancements can grep for this token when a `*.png` under
`e2e/smoke/visual-baseline.spec.ts-snapshots/` is staged.

## Rationale — why both gate AND rule

CARRYOVER L132 listed two closure paths: (A) codify rule, (B) ship gate. The plan
agent rejected each in isolation:

- **Rule-only**: a markdown bullet with no enforcement is exactly the failure mode
  L132 had been documenting for 19 turns. A future Claude session reading
  `CLAUDE.md ## Safe operations` can absorb the bullet, but absent enforcement
  the rule rots silently the moment it's inconvenient.
- **Gate-only**: snapshot files need a documented update workflow. Without the
  rule, the next layout commit will reflexively `--update-snapshots`, silently
  re-baselining the regression and defeating the gate.

The combined approach (gate + rule + `pre-demo-check.sh` drift fix) ships in one
coherent turn so the closure can't silently rot. This is the same pattern as R20
(M7 status-band scanner + pre-commit hook + memory file) — fix the class, not the
instance.

## Tolerance values — the cross-machine stability problem

The visual baseline lives at
`e2e/smoke/visual-baseline.spec.ts-snapshots/terminal-heatmap-chromium-darwin.png`.
Playwright auto-suffixes the filename with `{platform}-{browser}` so a Linux CI run
would 404 on this snapshot rather than diff-against-Mac (which would always fail
due to font subpixel differences).

Tolerance values for v1 (Mac-only, no CI):

- `maxDiffPixels: 200` — absorbs subpixel/antialiasing drift (~0.07% of a 1280×800
  viewport).
- `maxDiffPixelRatio: 0.02` — upper-bound safety net for content-area-sized noise.
- `mask: [sparklines, time, [data-volatile="true"]]` — masks data-dependent
  regions whose content drifts independently of layout.
- `animations: 'disabled'` + `caret: 'hide'` — kills the two largest frame-timing
  flake sources.
- Spec must `await page.waitForLoadState('load')` + `await
  page.evaluate(() => document.fonts.ready)` + a brief settle (e.g. `await
  page.waitForTimeout(800)`) before screenshot. **Do NOT use `networkidle`** —
  the terminal opens a long-lived SSE connection to `/api/events/stream`
  (recompute pipeline event bus) that never settles, so `networkidle` will
  hang Playwright's idle detector until test timeout. Custom fonts must be
  fully loaded or text reflows on the first run.

Linux baseline trigger event = "ship CI". Tracked as user-owned 🔄 in CARRYOVER
until that trigger fires; not blocking the v1 Mac-only baseline.

## Enforcement layers

1. **Local dev**: `npm run test:e2e -- visual-baseline` — direct invocation.
2. **Pre-prod gate**: `bash scripts/pre-demo-check.sh` runs the full Playwright
   suite (incl. visual baseline) as the last check before commit/demo.
3. **Architect review**: Stop-hook gate forces architect invocation; architect
   reviews the diff and flags any layout-touching commit that doesn't show
   `npm run test:e2e -- visual-baseline` evidence in the turn transcript.
4. **Future**: pre-commit hook enhancement could grep for `BASELINE UPDATE:`
   token when a `*.png` under the snapshots directory is staged. Out of scope
   for Turn E.

## Related memories

- `feedback_verify_one_layer_up.md` — gates are EXACTLY the kind of artifact
  this rule covers; ship the gate AND verify it catches a real regression
  (empirical regression demo) before claiming closure.
- `feedback_fix_before_build.md` — close the architect ⚠️ inline rather than
  defer to ROADMAP; Turn E closes 19-turn L132 instead of letting it rot to 20+.
- `feedback_carryover_enforcement.md` — the L132 row migrates OPEN → CLOSED
  with a closure narrative; counter-bump applies to all other OPEN rows.

## Anchor

Turn E closure narrative: see CARRYOVER.md row L132 (CLOSED section, 2026-05-03).
Plan file: `~/.claude/plans/clever-wondering-starlight.md` (approved auto-mode).
