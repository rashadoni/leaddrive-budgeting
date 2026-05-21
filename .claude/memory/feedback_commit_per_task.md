# Commit + push after EACH task — user wants to see on prod

User direction (Phase 7.M Tier 7 Turn 6, 2026-05-21):
> «закоммить а потом продолжи и не надо разбасывать всё я хочу в конце
> всё видеть на проде. после каждой задачи. ЗАПОМНИ!»

## Rule

After every task / phase completes (tests green, tsc clean), the developer
MUST:

1. **One commit per task.** Do NOT scatter into many small commits inside
   the same phase. Stage all phase files together (specific filenames —
   never `git add .`), single descriptive commit.
2. **Push to `origin/main` immediately after commit.** User wants the
   work visible on prod (Vercel auto-deploy from main) right after
   each phase, not batched at session end.
3. **Update `docs/ROADMAP.md` changelog in the same commit.** Per
   project CLAUDE.md — completion status + changelog entry both belong
   in the same commit as the implementation diff.

## What «не разбасывать» means

- ✗ Multiple commits per phase (e.g. separate "tests" / "code" / "docs"
  commits)
- ✗ Holding work locally until session end then bulk-pushing
- ✗ Pushing partial / WIP phases
- ✓ One commit per Phase containing implementation + tests + ROADMAP
  changelog + memory updates, then `git push origin main`

## Why

User runs FO Holding production directly off main. Mid-session pushes
mean Finance team sees incremental progress on /budgeting/admin/* — the
loop closes when something works on prod, not when a session ends.
Batching commits to «end of session» kills that feedback loop.

## Workflow per phase

```
<implement Phase N>
npx tsc --noEmit          # must be clean
npx vitest run             # must be green
<update docs/ROADMAP.md + changelog>
git add <specific files for Phase N>
git commit -m "feat(...): Phase N short description"
git push origin main       # triggers Vercel deploy → prod
<announce next Phase>
```

## Cross-reference

- Pairs with `feedback_decide_next_step.md` (announce next, don't ask)
- Pairs with `feedback_fix_before_build.md` (don't start Phase N+1 until
  Phase N is committed + pushed + green)
- Supersedes any prior pattern of «commit at session end» — none exists
  explicitly in older memory but was the implicit default
