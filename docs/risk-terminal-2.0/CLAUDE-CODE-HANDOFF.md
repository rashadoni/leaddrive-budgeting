# Claude Code handoff, Risk Terminal 2.0

## 1. Purpose

This file is the execution handoff for Claude Code. It does not authorize a big-bang rewrite. Claude Code should implement Risk Terminal 2.0 as small, reviewable, testable slices while preserving existing working functionality and unrelated user changes.

## 2. First response required from Claude Code

Before editing:

1. Confirm the repository path.
2. Read `AGENTS.md`, `docs/ROADMAP.md`, `PRODUCT.md` and every file in `docs/risk-terminal-2.0/`.
3. Run `git status --short` and list protected unrelated paths.
4. Map the requested slice to existing code and tests.
5. State exact files proposed for the slice.
6. State the required tests and visual gate.
7. Identify decisions that require CFO/Risk/Finance-owner approval.
8. Stop if the requested slice would require a materially broader change than the documentation authorizes.

Do not begin by rewriting the terminal route, PanelGrid or database schema.

## 3. Non-negotiable operating rules

### 3.1 Truthfulness

Use precise status language:

- implemented;
- tested;
- visually verified;
- reconciled;
- methodology-approved;
- shadow-only;
- provisional;
- not tested;
- blocked.

Do not say `done`, `fixed`, `transferred`, `production-ready` or `audited` when only code inspection or compilation has occurred.

### 3.2 Worktree safety

- Existing dirty/untracked files belong to the user.
- Never use `git reset --hard`, destructive checkout or broad cleanup.
- Never stage with `git add .` or `git add -A`.
- Stage only explicit paths from the current slice.
- Recheck `git diff --cached` before commit.

At documentation time, protect unless explicitly scoped:

```text
.claude/settings.json
.agents/
AGENTS.md
scripts/check-sales-parse-local.ts
scripts/import-fo-workbook-local.ts
scripts/recompute-local-all.ts
```

The list may drift. Current `git status` is authoritative.

### 3.3 Development server

- Do not run `npm run dev` manually.
- The app is managed by LaunchAgent `com.budgetpro.dev`.
- Verify the effective port from `~/Library/Logs/budgetpro.log`.
- Port 3000 may be occupied by Docker; use `E2E_BASE_URL` for a temporary actual port.
- Do not edit Playwright defaults merely to match a transient port collision.

### 3.4 Database and migration safety

- Use local Prisma 6.19.3 from `node_modules`.
- Schema changes remain additive through shadow rollout.
- Do not run production migration/deploy commands without the user's explicit scope.
- Do not use `--apply-pending` in the demo check without authorization.
- Preserve legacy serving/read paths for rollback.

### 3.5 UI visual safety

Touching `PanelGrid.tsx`, `CompanyTree.tsx`, `HeatMap.tsx`, terminal CSS, `globals.css` or Tailwind requires the visual gate.

```bash
npm run test:e2e -- visual-baseline
```

If the intended layout changes:

1. Inspect actual/expected/diff PNGs.
2. Update only affected snapshots.
3. Inspect the new PNG directly.
4. Include:

```text
BASELINE UPDATE: <specific reason>
```

Never claim a screenshot proves a feature without identifying the exact visible element/region and cross-checking the DOM/accessibility contract.

### 3.6 Shipping

- User owns the ship/cut decision.
- Do not deploy manually.
- Do not expand to external clients before TLS and strong credentials are confirmed.

## 4. Architecture rules for Claude Code

- There is one canonical financial aggregation path.
- The new overview API is a façade, not a new finance/KPI engine.
- PeriodContext and DataRevision are explicit and versioned.
- Unknown remains uncertainty; it is not zero risk.
- Risk, Confidence and Coverage are separate.
- No lineage/reconciliation means no decision-grade color.
- Keep the current Expert Matrix and shortcuts available.
- Extract overlay listeners before making PanelGrid optional.
- Centralize alert data before unmounting HeatMap in the default view.
- Do not replace `terminalStore` during the shell migration.
- Do not auto-run paid/slow AI on terminal entry.
- Do not put financial formulas in React components.
- Do not certify all 110 KPIs in the first release.
- Do not build mobile HeatMap.
- Do not create a generic warehouse or KPI builder in the first release.

## 5. Required implementation order

### Stage A, documentation/ADR and protective mode

1. Add Phase 10 items to Roadmap only when work starts.
2. Add `DESIGN.md` and architecture ADRs.
3. Add feature flags resolved server-side.
4. Add `Legacy / Provisional` treatment without changing financial values.
5. Add tests proving stale/untraced data cannot look decision-grade.

Do not start the modern root UI before this stage has review.

### Stage B, trust core

1. Canonical statement mart/service for pilot scope.
2. PeriodContext and DataRevision.
3. Exact M/Q/YTD/FY/LTM invalidation.
4. KPI Registry and first 25-35 approved KPIs.
5. Immutable observation and lineage.
6. Risk × Confidence and abstention.
7. Decision-grade event eligibility.

Each sub-stage needs golden reconciliation and owner decisions.

### Stage C, zero-visual-change UI extraction

1. Extract pure view-model builders.
2. Extract `TerminalOverlayHost`.
3. Isolate `ExpertWorkspace`.
4. Preserve current events, shortcuts, layout keys and visual output.
5. Add the overview façade/provider without changing the default view.

### Stage D, modern Decision shell

1. Add server-resolved view flags.
2. Add URL view state.
3. Add shell/header/navigation.
4. Add Today/Inbox and Inspector.
5. Add Portfolio domains.
6. Add Company Workspace/KPI detail.
7. Add Data Health and Scenario Lab.
8. Add responsive, accessibility and full EN/RU/AZ.

### Stage E, shadow and cutover

1. Run old/new calculations on the same revision.
2. Classify every material difference.
3. Run silent V2 alerts.
4. Complete performance, visual and accessibility gates.
5. Complete UAT and one real close cycle.
6. Rehearse rollback.
7. Switch Today default only for approved allowlist.

## 6. Commit/PR discipline

One conceptual change per commit. Recommended series:

```text
docs(terminal): define Risk Terminal 2.0 contracts
refactor(terminal): extract reusable risk view models
refactor(terminal): centralize overview and freshness data
refactor(terminal): isolate expert workspace and overlays
feat(terminal): add decision cockpit shell
feat(terminal): add decision-first risk inbox
feat(terminal): add portfolio risk domains
feat(terminal): add company risk workspace
feat(terminal): add data health and guided scenarios
feat(terminal): make risk inbox the pilot default
```

Do not combine the Trust Core migration and all UI stages into one PR.

## 7. Verification required per slice

Minimum:

```bash
npx tsc --noEmit
npx vitest run <targeted suites>
```

Before handoff of a completed slice:

```bash
npx tsc --noEmit
npx vitest run --reporter=dot
npx prisma validate
npm run build
E2E_SKIP_LLM=true E2E_BASE_URL=http://localhost:<PORT> npm run test:e2e
```

Run the visual gate whenever the file rules require it. Do not claim a test passed if it was not run in that turn/environment.

## 8. Required implementation report format

Every Claude Code completion report must contain:

### Outcome

- what behavior changed;
- which user/job benefits;
- whether it is behind a flag;
- whether the change is provisional, shadow or default.

### Files

- exact files created/changed;
- migrations/translation/snapshot files listed separately.

### Evidence

- commands run and result counts;
- runtime route/state verified;
- reconciliation evidence where financial logic changed;
- visual diff evidence where layout changed.

### Limits

- what was not implemented;
- what was not tested;
- owner decisions still required;
- rollout stage and rollback path.

### Roadmap

- exact Phase 10 task status changed;
- dated changelog entry added;
- no other roadmap claims altered.

## 9. Stop and ask conditions

Claude Code must stop and request direction when:

- a KPI definition or threshold requires a business choice;
- an approved financial control/tolerance is unavailable;
- the change would overwrite/normalize user source data;
- a destructive/non-additive migration is proposed;
- unrelated dirty files overlap the target;
- a paid external call/canary is required;
- TLS/domain/credential decisions block client access;
- the requested deadline would require hiding failed trust gates;
- a visual direction materially contradicts this spec;
- a production deploy or merge is required and not explicitly authorized.

## 10. Copy-ready master prompt

Copy the following into Claude Code:

```text
You are implementing Risk Terminal 2.0 in the current repository root.

This is a trust-first product transformation, not a cosmetic reskin and not a big-bang rewrite.

Before editing, read completely:
1. AGENTS.md
2. docs/ROADMAP.md
3. PRODUCT.md
4. docs/risk-terminal-2.0/README.md
5. docs/risk-terminal-2.0/00-EXECUTIVE-SUMMARY-RU.md
6. docs/risk-terminal-2.0/01-AUDIT-BASELINE.md
7. docs/risk-terminal-2.0/02-PRODUCT-AND-UI-UX-SPEC.md
8. docs/risk-terminal-2.0/03-DATA-KPI-TRUST-SPEC.md
9. docs/risk-terminal-2.0/04-TECHNICAL-IMPLEMENTATION-PLAN.md
10. docs/risk-terminal-2.0/05-TEST-UAT-ROLLOUT.md
11. docs/risk-terminal-2.0/CLAUDE-CODE-HANDOFF.md

Then:
- run git status --short and protect all unrelated user changes;
- do not use git add . or git add -A;
- do not run npm run dev, the server is LaunchAgent-managed;
- verify the effective local port in the BudgetPro log;
- do not deploy or run production migrations;
- do not auto-run paid AI;
- do not remove the existing Expert Matrix;
- do not add financial/KPI logic to UI components;
- do not present Unknown/Stale/Unreconciled values as decision-grade;
- preserve existing deep links, events, layout keys and store invariants.

Implement only this slice:
<APPROVED_STAGE_OR_PR_SLICE>

First reply with:
1. current architecture evidence;
2. exact files you will touch;
3. protected dirty paths;
4. step-by-step implementation plan;
5. tests and visual gates;
6. owner decisions/blockers.

After implementation, report outcome, exact files, tests, runtime/visual evidence, limits, roadmap update and rollback path. Use precise truth labels: implemented, tested, visually verified, reconciled, methodology-approved, shadow-only, provisional, not tested or blocked.
```

`<APPROVED_STAGE_OR_PR_SLICE>` is an intentional owner-controlled input. Replace it with exactly one approved slice from sections 11–13 before sending the prompt; never ask Claude Code to implement all three at once.

## 11. Historical first-slice prompt (already executed)

Stage A has already begun and early trust-core slices now exist. Select the next slice from the current `docs/ROADMAP.md` and `IMPLEMENTATION-STATUS.md`; do not rerun this original starter prompt. It is retained below only as historical context:

```text
Implement Stage A only:
- create DESIGN.md from the approved UI/UX specification;
- add ADRs for Trust Core and Experience Shell;
- add Phase 10 tasks to docs/ROADMAP.md as In Progress only for work actually started;
- design server-resolved operational feature flags;
- implement the smallest protective Legacy/Provisional presentation that prevents stale/untraced values from appearing decision-grade;
- add focused tests;
- preserve all current Expert behavior and visual layout unless the protective state requires an intentional, reviewed baseline update.

Do not implement the modern shell, canonical mart migration or new schema in this slice.
```

## 12. Recommended UI foundation slice prompt

After Trust Core contracts are reviewed:

```text
Implement the zero-visual-change terminal architecture slice:
- extract pure build-risk-inbox, build-company-summary and build-portfolio-domains functions from existing logic;
- make current consumers use the extracted functions without output changes;
- extract all global overlay/export mounts from PanelGrid into an always-mounted TerminalOverlayHost while preserving CustomEvent names;
- wrap the existing HotkeyToolbar, CommandBar, SignalsStrip and PanelGrid in ExpertWorkspace;
- keep /budgeting/terminal default behavior identical;
- add unit/component/E2E regression coverage;
- run the mandatory visual baseline and do not update it unless a real unintended difference is diagnosed.

Do not add Today as default in this slice.
```

## 13. Recommended modern UI slice prompt

After the provider/overview contract is stable:

```text
Implement the modern Decision shell behind RISK_TERMINAL_V2_ENABLED and an org allowlist:
- TerminalShell, Header, ViewNav, ContextBar and URL view state;
- Today/Risk Inbox with persistent desktop inspector and mobile sheet;
- Risk, Confidence, Coverage, Data through and reconciliation always visible;
- no automatic AI calls;
- complete loading, empty, stale, provisional, unauthorized and error states;
- EN/RU/AZ under terminal.v2;
- WCAG keyboard/focus behavior;
- Expert remains one click and ?view=expert away;
- add deterministic Today visual baseline that masks only volatile leaves.

Do not make Today the global default yet.
```

## 14. Handoff completion checklist

- [ ] All package documents were read.
- [ ] Requested slice is singular and approved.
- [ ] Dirty worktree paths are protected.
- [ ] Required business decisions are recorded.
- [ ] Tests and visual gate are named before editing.
- [ ] Implementation does not broaden scope silently.
- [ ] Roadmap status reflects reality.
- [ ] Runtime and rollback evidence are included.
- [ ] No unsupported production-readiness claim is made.
