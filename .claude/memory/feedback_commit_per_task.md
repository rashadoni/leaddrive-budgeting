# Commit + push after EACH task (one commit per task, push immediately)

User direction (Phase 7.M Tier 7 Turn 6, 2026-05-21):
> «закоммить а потом продолжи и не надо разбасывать всё я хочу в конце
> всё видеть на проде. после каждой задачи. ЗАПОМНИ!»

Re-confirmed 2026-05-30: when asked why push at all for a local project,
user said «ну я забыл что ты делал бекап тогда пуши» — i.e. the value is
the off-machine BACKUP. Keep pushing per task.

## ⚠️ Rationale correction (2026-05-30) — push ≠ deploy on this repo

Earlier versions of this memory said "push triggers Vercel auto-deploy →
prod". **That is FALSE for the current repo** — verified 2026-05-30:

- Repo is PRIVATE; the only push automation is `.github/workflows/ci.yml`,
  which runs tests/build only (NO deploy step). No `vercel.json`.
- GitHub Deployments API is empty — no deploy integration has ever run.
- Prod (Phase 8) is a self-hosted VM, deployed MANUALLY by the user
  (`deploy/first-deploy.sh` + nginx) — NOT triggered by push.
- The demo runs LOCAL (localhost:3000 via LaunchAgent); the local Postgres
  holds the client data (NOT in git — xlsx folder untracked, `.env`/dumps
  gitignored). Push does not touch the demo and does not expose data.

So a push = (1) off-machine backup of the *code* to a private GitHub repo
+ (2) a clean-machine CI run. It does NOT reach clients or prod.
**DO NOT hold pushes "for a coordinated prod release"** — that conflates
push with deploy and cost real confusion this session. Push freely per
task; deploying to the VM is a separate, manual, user-owned step.

## Rule

After every task / phase completes (tests green, tsc clean), the developer
MUST:

1. **One commit per task.** Do NOT scatter into many small commits inside
   the same phase. Stage all phase files together (specific filenames —
   never `git add .`), single descriptive commit.
2. **Push to `origin/main` immediately after commit.** The point is the
   off-machine backup + CI verification, not a deploy. Don't batch pushes
   to session end — a laptop failure mid-session loses everything since
   the last push.
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

The work lives on ONE machine until pushed. A disk failure, accidental
`rm`, or corrupted file loses everything since the last push. The private
GitHub repo is the off-site copy; CI re-verifies the committed state builds
from scratch on a clean machine. (Original Phase 7.M framing — "Finance
sees progress on prod off main" — is superseded: prod is now a manual VM
deploy and the active demo is local. The push value is backup + CI.)

## Workflow per phase

```
<implement Phase N>
npx tsc --noEmit          # must be clean
npx vitest run             # must be green
<update docs/ROADMAP.md + changelog>
git add <specific files for Phase N>
git commit -m "feat(...): Phase N short description"
git push origin main       # off-machine backup + clean-machine CI (NOT a deploy)
<announce next Phase>
```

## Cross-reference

- Pairs with `feedback_decide_next_step.md` (announce next, don't ask)
- Pairs with `feedback_fix_before_build.md` (don't start Phase N+1 until
  Phase N is committed + pushed + green)
- Supersedes any prior pattern of «commit at session end»
- See also `feedback_parallel_session_reconcile.md` — when a parallel
  session is committing to main, `git fetch` + check divergence before
  pushing (this session verified 0 divergence before the 2026-05-30 push).
