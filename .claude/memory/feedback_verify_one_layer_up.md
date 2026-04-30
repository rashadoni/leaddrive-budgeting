# Verify one layer up, not just the layer you edited

## Context (R15 → R21 saga, Tier-3 sub-29)

While locking in M7 (color-blind safe palette + shape coding) the
developer needed seven architect rounds (Round-15 → Round-21) to fully
close one feature. Each round, a new gap was found that the previous
closure missed. The pattern was identical every time:

- **Round 15** — sweep claimed "across all status surfaces"; missed
  CompanySnapshot trio, HeatMap CompositeBadge tooltip, HeatMapCellTd
  tooltip, unknown-cell glyph contrast.
- **Round 16** — fixed those four; missed IndicatorDetail forecast
  badge.
- **Round 17** — fixed forecast badge; missed CompanySnapshot top-alerts
  severity dots.
- **Round 18** — fixed top-alerts dots + shipped a regression scanner
  (file-level grep). Architect demonstrated the scanner had a structural
  false-negative — deleting one rendered glyph in a multi-surface file
  still passed because the file elsewhere matched the helper-function
  definition + other call sites.
- **Round 19** — rewrote scanner to line-window 2-path detection.
  Architect demonstrated three more indirection blindspots:
  captured-color-variable consumer pattern + symmetric shape-side
  capture + pre-commit hook contested.
- **Round 20** — added Path C consumer detection + symmetric shape-side
  exclusion + ComparePanel LHS/RHS real bug surfaced + shipped
  pre-commit hook script.
- **Round 21** — pre-commit hook script was non-functional
  (`--reporter=basic` removed in vitest 4.x). Developer's claim "tested
  standalone — exits 0" was false; actual `bash .githooks/pre-commit`
  aborted on every invocation.

Total: ~5 hours of architect-round-trips on one accessibility feature
that should have been ~1 hour.

## The pattern

The developer kept verifying the change at the layer they edited
rather than at the consumer of that change:

- **Round 18** created scanner; verified `npx vitest run` for the test
  file; did not run the scanner against the real codebase to confirm
  it caught a regression.
- **Round 20** created hook script; verified `npx vitest run` for the
  scanner test; did not run `bash .githooks/pre-commit` to confirm
  the hook script itself executed and forwarded exit codes correctly.

Each layer trusted the layer below: the test passed → the scanner is
good → the hook is good. But each layer was its own contract that
needed independent verification.

## The rule

**When shipping a gate / hook / scanner / regression-test, the
verification step MUST execute the gate the way production will execute
it — not just the underlying tool the gate wraps.**

Concrete checklist for gate work:

- New regression test: run it against ≥1 real-codebase regression
  scenario (introduce the bug, confirm test fails, restore, confirm
  test passes). Don't trust unit-tests of internal helpers alone.
- New shell hook: invoke the shell hook directly (`bash hook.sh`),
  observe stdout + exit code; don't just verify the inner command.
- New CLI flag / argument plumbing: pass it through the full chain
  end-to-end, not just inspect the parser output.
- Validity of named CLI options: check actual `--help` of the runtime
  version, not memory of past versions (`vitest 4.x` removed `basic`
  reporter; my prior knowledge said it existed).

## When this rule does NOT apply

Pure-helper unit tests (e.g. `evaluateSubscription` in AISubscriptions)
don't need consumer-layer verification — they're deterministic + the
caller is type-checked. The rule applies specifically to *gates* —
artifacts whose job is to detect regressions, where a silent-pass
failure mode is the most expensive bug.

## Related memories

- `feedback_fix_before_build.md` — close architect findings inline before
  new work
- `feedback_architect_scope_audit.md` — declare TurnGoal up front so
  architect can audit scope; gates ARE in-scope artifacts to verify
- `feedback_self_check_before_transition.md` — proactive self-audit
  catches bugs in the SAME turn, never as 🔄 tail; this rule is a
  specific instance of self-check applied to gating artifacts

## Anchor commit chain

R15→R21 sub-29 saga: commits `9f291fb` → `3826b20` → `697b1c6` →
`f96fbea` → `416aa82` → `410ca44` → `491c22f`. Each commit message
documents what the prior round missed; readable end-to-end as a
case study in the rule.
