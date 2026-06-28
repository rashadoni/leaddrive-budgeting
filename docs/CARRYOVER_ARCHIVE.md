# CARRYOVER — ARCHIVE (collapsed closed items)

One-line index of resolved items, **collapsed 2026-06-28** to keep the live
[`CARRYOVER.md`](CARRYOVER.md) lean (it had grown to 1.2 MB / 1352 lines with 89
already-✅ rows still sitting in `## OPEN`).

**Full resolution narratives live in [`ROADMAP.md`](ROADMAP.md) `## Changelog`
+ git history** — the verbose originals are in this repo's history at the commit
just before the collapse. This file is NOT loaded in normal sessions; consult it
only when chasing the history of a specific item.

## Collapsed from OPEN (✅-done rows that had piled up in the OPEN section)

| ✅ | date | owner | item |
|---|---|---|---|
| ✅ | 2026-06-22 | done | [RESOLVED commit 49e87a1d] Hierarchy-aware import: multi-level dotted P&L codes (e.g. PLF.05.01.01.02) over-count 4×. |
| ✅ | 2026-06-22 | done | [RESOLVED commits 82d32490 + one-off cleanup] Per-company reset left org-level ORPHAN BudgetLines (companyId=NULL) as a 1.3M "tail". |
| ✅ | 2026-06-05 | done | P&L tab EBITDA section was falsely positive (+1.75M) vs the EBITDA card (−2.8M); Overhead row read 0 — FIXED. |
| ✅ | 2026-06-05 | done | Report Builder "Fakt məlumatlar" (Actuals) source always showed "no data" — FIXED. |
| ✅ | 2026-06-05 | done | Comparison tab delta (FƏRQ) only compared the first 2 of N selected plans — FIXED. |
| ✅ | 2026-06-05 | dev/user | Budgeting WORKSPACE "Fakt" column read 0 for the 2026 budget — ROOT CAUSE + FIX. |
| ✅ | 2026-06-05 | dev/user | ROOT CAUSE of the 2026 "—" per-category actuals + FIX (re-keyed budget onto the PLF chart of accounts so budget↔actual JOIN). |
| ✅ | 2026-06-04 | done | Detailed P&L table no longer shows fake "0 / −plan" where per-category actuals don't exist — FIXED (user on the AZSEKER 2026 Budget P&L: "сколько пришло столько ушло? так в файлах указано?"). |
| ✅ | 2026-06-04 | done | Budgeting Balance Sheet tab opened EMPTY by default — FIXED (falls back to matching-year Actuals plan). |
| ✅ | 2026-06-04 | done | QA batch CLOSED — 4 client-flagged items shipped (terminal What-if polish + admin descriptions/translations + /guide). |
| ✅ | 2026-06-03 | done | AI narratives + AI drill tool double-counted financials after re-import — FIXED (deletedAt:null sweep; terminal-audit P1+P2 #1/#5). |
| ✅ | 2026-06-03 | done | Post-audit full-test pass + 3 chosen follow-ups — ALL 3 DONE (user «E2E + lint + smoke — всё»). |
| ✅ | 2026-06-03 | done | Terminal bug-audit — ALL 14 distinct confirmed findings FIXED (2 multi-agent runs, 16 raw findings incl. cross-run dupes; 0 open). |
| ✅ | 2026-06-03 | done | company-financials-snapshot summed plannedAmount with no FX conversion + no org scope — FIXED (terminal-audit run-1 #8 P3 latent). |
| ✅ | 2026-06-03 | done | Booking resolver counted foreign bookings with no FX rate at face value — FIXED (terminal-audit re-run `we2d7o4h2` #5 P2 latent). |
| ✅ | 2026-06-03 | done | EBITDA margin mixed raw-currency captured EBITDA with FX-converted revenue — FIXED (terminal-audit re-run `we2d7o4h2` #4 P2 latent). |
| ✅ | 2026-06-03 | done | What-if scenarios showed spurious "improvements" on shock-unrelated indicators (the user's "BRENT oil-spike → wheat/grain cost improved") — FIXED (terminal-audit #7 run-1 P2; stale-baseline, unit-proven). |
| ✅ | 2026-06-03 | done | Period selector desynced the terminal — only the HeatMap followed it; side panels stayed annual — FIXED + VERIFIED LIVE (terminal-audit #4 run-1 P2). |
| ✅ | 2026-06-03 | done | What-if "worst-hit companies" chips ranked parent/holding rollups alongside their own children — FIXED (terminal-audit run-1 + re-run `we2d7o4h2` #6 P2). |
| ✅ | 2026-06-03 | done | operationalFact "snapshot" latest-by-date tie-break was non-deterministic — FIXED (terminal-audit re-run `we2d7o4h2` P3 #8). |
| ✅ | 2026-06-03 | done | Indicator drilldown could diverge from the value it explains (missing `kind:'actual'` plan predicate) — FIXED (terminal-audit run-1 #6 P2). |
| ✅ | 2026-06-03 | done | HeatMap freshness badge («Updated Xh ago») never rendered — FIXED (terminal-audit re-run `we2d7o4h2` P2 #7). |
| ✅ | 2026-06-03 | done | Aggregate rollup cells double-counted in 3 terminal UI surfaces — FIXED (terminal-audit run-1 #2/#3 P2). |
| ✅ | 2026-06-03 | done | Scoped (non-admin) manager's audit trail silently truncated — FIXED (terminal-audit re-run `we2d7o4h2` P1 #3, compliance gap). |
| ✅ | 2026-06-03 | done | SSE live-update listener permanently poisoned by one first-connect failure — FIXED (terminal-audit re-run `we2d7o4h2` P1 #2; explains the live `/api/events/stream` 503). |
| ✅ | 2026-06-03 | done | Legacy scenario simulator counted unknown-baseline indicators as "improved" — FIXED (continues the user's What-if «ошибка»; terminal-audit re-run `we2d7o4h2` P1 #1). |
| ✅ | 2026-06-03 | done | Scenario re-derive miscounted unknown-baseline indicators as "improved" — FIXED (user What-if «ошибка»: devaluation → 4 improved / 0 worsened). |
| ✅ | 2026-06-02 | done | Auto-update (user chose option B via decision-stress-test) — BOTH stages DONE. |
| ✅ | 2026-06-02 | done | Data Sources cards — real feed value + date, not hardcoded examples (user «непонятно, цифра из источника или выдумана»). |
| ✅ | 2026-06-02 | done | Manual KPI entry now reversible — edit + delete on recent entries (user «как потом верну?»). |
| ✅ | 2026-06-02 | done | Data-entry form redesign — intuitive / informative / interactive (user «сделай … создай»). |
| ✅ | 2026-06-02 | done | Indicator-health remediation CTAs fixed — no dead-end "Ввести вручную" + deep-link prefill (user clicked it, landed on a blank/wrong-metric form). |
| ✅ | 2026-06-02 | done | Stale AGRO_COMMODITY_VOL IVs CLEARED (user «пересчитай»). |
| ✅ | 2026-06-02 | done | Decouple Terminal P&L from Budget plan (P&L+BS+CF) — COMPLETE (Y1–Y5b). |
| ✅ | 2026-06-02 | done | Loaded real 2026 budget → execution % now computes. |
| ✅ | 2026-06-02 | done | CF operating-cash-flow parser gap on MALT + AZSF — FIXED. |
| ✅ | 2026-06-02 | done | Indicator Health full rework + style-miss cleanup (user «все разделы где используются эти стили» + «понятнее, нет перевода, ui уродливый»). |
| ✅ | 2026-06-02 | done | Admin-area design/i18n sweep COMPLETE — user «во всех разделах, почему сочкуешь?» (not just IFRS). |
| ✅ | 2026-06-02 | done | IFRS page — professional light-mode restyle (user «уродливые цвета… красивый профессиональный стиль»). |
| ✅ | 2026-06-02 | done | IFRS page — explains WHAT it checks per IAS + WHY <100% (user «указать что именно проверяет + детально что не хватает/неправильно + причина»). |
| ✅ | 2026-06-02 | done | IFRS check v3 — statement linkage P&L↔equity SHIPPED (user «делай сцепку»). |
| ✅ | 2026-06-02 | done | IFRS check v2 — proved discrimination + 2 deeper checks (user «реально правильно проверяет? почему все 100%»). |
| ✅ | 2026-06-02 | done | Client feedback #2 — post-import IFRS conformance check SHIPPED (engine + API + admin UI). |
| ✅ | 2026-06-01 | done | Purged ALL placeholder/fake business data — financial app now shows only real numbers (user: «только реальные цифры»). |
| ✅ | 2026-06-01 | done | CLOSED 2026-06-01 — HeatMap visual-baseline micro-flake fixed (was the CommandBar cmd-line, not MarketTicker as first guessed). |
| ✅ | 2026-05-29 | done | RESOLVED 2026-05-29 (same turn) — `criticalIndicator` alert default retargeted `*_NET_MARGIN` → `IND_EBITDA_MARGIN` (follow-up to `ec0e3bf`). |
| ✅ | 2026-05-29 | done | RESOLVED 2026-05-29 — snapshotcard gate live-confirmed GREEN + the panel it tests fixed. |
| ✅ | 2026-05-31 | done | RESOLVED — Soft-delete read audit COMPLETE (phase 1 + phase 2). |
| ✅ | 2026-05-31 | done | CLOSED 2026-05-31 — all sub-findings resolved (pass COMPLETE: audit ✓ / court ✓ / risk ✓ / land ✓ / forward ✓). |
| ✅ | 2026-05-31 | done | ScenarioPanel fully i18n'd (terminal "Сценарный анализ / What-if" panel). |
| ✅ | 2026-06-01 | done | Terminal i18n sweep COMPLETE — every user-facing terminal string now localized (en/ru/az). |
| ✅ | 2026-06-01 | done | What-if UX redesign + signal explainability + signal i18n (user feedback). |
| ✅ | 2026-06-01 | done | CLOSED 2026-06-01 — diagnosed + re-baselined (data-drift, not a regression). |
| ✅ | 2026-06-01 | done | HeatMap search fields made noticeable (user «сделай заметнее»). |
| ✅ | 2026-06-01 | done | Breach Forecasts — drop fake/orphan forecasts + clarity (user «что это, не интуитивно»). |
| ✅ | 2026-06-01 | done | What-If preview made intuitive (user «не понятно как влияет, не интуитивно»). |
| ✅ | 2026-06-01 | done | Client feedback #1 — per-ha benchmark band SHIPPED. |
| ✅ | 2026-06-01 | done | HotkeyToolbar — also collapse compare/comments/chat (user «hotkeys в свёрнутых пусть будут compare chat comments также»). |
| ✅ | 2026-06-01 | done | IndicatorDetail — round resolved-variable money values (user «исправь цифры чтоб округлённые были»). |
| ✅ | 2026-06-01 | done | AI Subscriptions — company/indicator picker dropdown (user «чтоб из списка появлялись компании»). |
| ✅ | 2026-06-01 | done | AI Subscriptions v1.5 — active in-terminal toast + bell (user «да» to building real notify). |
| ✅ | 2026-06-01 | done | AI Subscriptions panel — dark restyle (user: «что это и почему так уродливый стиль»). |
| ✅ | 2026-06-01 | done | HotkeyToolbar — collapse tail into ⌘K dropdown (user: «после import остальное сверни чтоб был выпадающий»). |
| ✅ | 2026-06-01 | done | Scenario create — guided builder for non-programmers (user: «json, как добавить сценарий не программисту?»). |
| ✅ | 2026-06-01 | done | Data Sources Catalog — card prose localized (user: «тут тоже нет перевода»). |
| ✅ | 2026-06-01 | done | Crisis sim — slow-hint + hard timeout (user: «не генерирует»). |
| ✅ | 2026-06-01 | done | Crisis brief — AI language switch re-narrates (user: «меняю язык но ничего не происходит»). |
| ✅ | 2026-06-01 | done | Scenario detail — «ACTIVE» chip shows the real saved target (user: «поднял до 190, нужно чтоб показывало что 190»). |
| ✅ | 2026-06-01 | done | Scenario SAVE — server accepts `shock` overrides («Validation error» fixed). |
| ✅ | 2026-06-01 | done | ScenarioFormModal — dark redesign + friendly editor for direct levers (user: «тут не изменил и опять json коды»). |
| ✅ | 2026-06-01 | done | ScenarioPanel — dark professional redesign (user: «ужасные цвета, переработай UX/UI»). |
| ✅ | 2026-06-01 | done | Scenario edit — friendly shock editor + validator bug fix (user live-demo feedback). |
| ✅ | 2026-06-01 | done | Client-feedback #5 — intuitive indicator search in HeatMap Panel 2 (BUILT). |
| ✅ | 2026-05-20 | engineering | Sales plan parser per-product 2027-2032 |
| ✅ | 2026-05-20 | engineering | FX_IMPORTED_INPUT non_finite NaN |
| ✅ | 2026-05-20 | user | Live Chrome UI verification |
| ✅ | 2026-05-20 | engineering | Phase 7.M Tier 5 — production adapter wiring |
| ✅ | 2026-05-20 | engineering | Per-conflict UI resolution |
| ✅ | 2026-05-17 | engineering | Phase 6 BullMQ/Redis scheduler — SHIPPED 2026-05-21 |
| ✅ | 2026-05-16 | engineering | Phase 5.2 RLS — CLOSED 2026-05-21. |
| ✅ | 2026-05-31 | done | Prisma migration baseline DONE + FK drift RESOLVED (user chose B — NOT NULL). |
| ✅ | 2026-05-17 | user | STALE-CLOSED Session 9. |
| ✅ | 2026-05-17 | user | STALE-CLOSED Session 9. |
| ✅ | 2026-05-17 | user | STALE-CLOSED Session 9. |
| ✅ | 2026-05-17 | user | EXECUTED Session 9. |
| ✅ | 2026-05-07 | user | Turn-LII Board Deck v2 visual baseline gen |
| ✅ | 2026-05-17 | user | STALE-CLOSED Session 9. |
| ✅ | 2026-05-17 | user | STALE-CLOSED Session 9. |
| ✅ | 2026-05-17 | user | STALE-CLOSED Session 9. |
## Collapsed from the prior `## CLOSED (last 30 days)` section

| ✅ | date | item |
|---|---|---|
| ✅ | 2026-05-29 | Composite badge live-verification across HeatMap row headers |
| ✅ | 2026-05-10 | architect-gate.sh carve-out for hygiene/Q&A turns |
| ✅ | 2026-05-09 | actuals/[id] PUT approval-parity |
| ✅ | 2026-05-09 | Phase 4.2 bulk-mutation gate fan-out |
| ✅ | 2026-04-30 | `budgetLine.revenueBySeason` resolver |
| ✅ | 2026-05-08 | Tier 2 H1 — route smoke tests for top-3 untested critical handlers + 4 Turn-LXII M2-touched mutation handlers |
| ✅ | 2026-05-07 | Add real `?tab=variance` budgeting tab (closes Compare-as-Variance jsdoc deviation) |
| ✅ | 2026-05-07 | Collapse `industries.*` JSON namespace into `Industry` table source of truth |
| ✅ | 2026-05-05 | Re-enable IND_FX_INPUT_RISK after FX import extension (REFRAMED: retired permanently as duplicate of FX_IMPORTED_INPUT; data fix shipped, backfill filed as user-owned 🔄) |
| ✅ | 2026-05-05 | Import `/apply` `--dry-run` flag implementation (architectural debt logged) |
| ✅ | 2026-05-05 | Onboarding /apply not real-DB e2e verified post-12-row fix |
| ✅ | 2026-05-05 | Live trigger for `import_staging_expired` audit emission (closes 5/5 enum coverage) |
| ✅ | 2026-05-05 | ScenarioPanel period defaults to UTC year (paired with timezone discipline row — closed together) + Timezone discipline for default-period year — reader vs writer alignment |
| ✅ | 2026-05-05 | Sweep orphan monthly IndicatorValue rows in non-azmade orgs (premise stale — DB is clean) |
| ✅ | 2026-05-05 | Phase 7.D — PanelGrid drag-resize Playwright test (Turn-XXX residual) |
| ✅ | 2026-05-05 | Phase 7.D UI test extension (5/6 covered; PanelGrid drag-resize residual narrower-scoped) |
| ✅ | 2026-05-05 | Phase 7.G admin / product documentation (misfiled — ADMIN_RUNBOOK v1 shipped Turn-A 2026-05-03, 740 LOC / 12 sections; closure in narrative-form) |
| ✅ | 2026-05-05 | audit-stale-carryover.ts — duplicate-detector v3 (token-similarity secondary check) |
| ✅ | 2026-05-05 | Uncommitted multi-turn debt (misfiled-duplicate; row already CLOSED Turn 33) |
| ✅ | 2026-05-05 | architect-gate hook blind spot — memory-only writes bypass review (codified via convention, option b) |
| ✅ | 2026-05-05 | Render-site i18n integration test — CommandBar autocomplete (final piece; Phase 7.G Turn G+H 💡 fully closed) |
| ✅ | 2026-05-05 | Render-site i18n integration test — alert-rendering siblings batch (ActionCenter + CompanySnapshot shipped; CommandBar residual filed) |
| ✅ | 2026-05-05 | Render-site i18n integration test (AlertsPanel slice closed; residual filed for 3 sibling sites) |
| ✅ | 2026-05-05 | Per-commit architect protocol — codification path closed; hook implementation residual filed as new owner=user 🔄 (Turn-XXII Round-1 architect Sonnet caught split-closure) |
| ✅ | 2026-05-05 | Tier-2 strategic prune — 13 OPEN rows → ROADMAP §Backlog (2 NEW anchored sub-sections #bseries-v2-polish + #forward-debt) |
| ✅ | 2026-05-05 | sandbox-curl produces false HARD FAIL on healthy dev-server |
| ✅ | 2026-05-05 | demo-gate script doesn't auto-apply pending migrations |
| ✅ | 2026-05-05 | Tier-1 strategic prune — 21 OPEN rows → ROADMAP §Backlog (5 anchored sub-sections; clear re-open trigger conditions) |
| ✅ | 2026-05-05 | (a) `sparkline` formula evaluation (Phase 7.A.0) — already shipped Turn-42-sub-39; (b) `fact()` / `rollup()` formula functions (Phase 7.A.0) — already shipped Turn-42-sub-41 |
| ✅ | 2026-05-05 | CommandBar + AuditTicker status strip tooltips not Radix (3 sites — premise corrected from 5) |
| ✅ | 2026-05-05 | Audit route-handler test for orderBy + composite nextCursor (Turn-U 💡 #1 deferred) |
| ✅ | 2026-05-05 | test-gate.test.sh — preflight-jq path coverage (deferred per macOS jq-in-/usr/bin) |
| ✅ | 2026-05-05 | CompanyTree test-friendliness — `data-testid` on tree-row + memory cross-ref |
| ✅ | 2026-05-05 | 4 architect-deferred 💡 closed (translation pipeline + memory rule + mutex test + AZ-review row) |
| ✅ | 2026-05-05 | Hint-paragraph i18n residual (44 non-AZMADE indicators × 2 locales = 86 translations) |
| ✅ | 2026-05-05 | i18n locale-flow e2e regression net + stale-premise memory rule |
| ✅ | 2026-05-05 | Two misfiled ⚠️ rows + v3.4 alertEvents required not optional |
| ✅ | 2026-05-05 | Indicator hint-paragraph i18n + env-blocker re-verify memory rule |
| ✅ | 2026-05-05 | IndicatorDetail localization — close 5 untranslated render sites surfaced via screenshot |
| ✅ | 2026-05-05 | IndicatorDetail sub-group rollup branch — closes "no computed value for AAC" UX bug on every sub-group click |
| ✅ | 2026-05-05 | C6 v3.3 — UI replay viewer for AlertEvents (architect Turn-IV 💡 #2 closure) |
| ✅ | 2026-05-05 | C6 v3.1 — wire persistAlertEvents into recompute pipeline + C6 v3.2 — read API for AlertEvent replay |
| ✅ | 2026-05-05 | C6 v3 — persist Alert events to DB (Alert table population) — slice 1 of 3 (schema + write helper + tests) |
| ✅ | 2026-05-04 | C3 v2 — PPTX export (pptxgenjs) (closes 49-turn-stale Turn-42-sub12 plan-deviation) |
| ✅ | 2026-05-04 | SnapshotCard panel-only visual baseline (extends Turn-E gate scope) |
| ✅ | 2026-05-04 | Working tree state-management — commit residue or declare it (Turn-W ⚠️ #1) |
| ✅ | 2026-05-04 | Test coverage for Turn-29 Bug #1b fallback + Bug #6 availability route (DUP — all 3 sub-items shipped Turn 33.5) |
| ✅ | 2026-05-04 | audit-stale-carryover.ts — duplicate-detection cross-section warn (Turn-DD ⚠️) |
| ✅ | 2026-05-04 | AI Web Crawler + Predictive Analytics + Board Deck Generator (Phase 7.E NEW) — 3 silently-stale duplicates swept (Turn-EE Round-1) |
| ✅ | 2026-05-04 | DEMO_SCRIPT Step 2 vs Step 4 narrative collision (DUP of Turn-33.5 ✅ row with same item-text) |
| ✅ | 2026-05-04 | IND command duplicates HeatMap matrix fetch — no cache reuse |
| ✅ | 2026-05-04 | Wallpaper SSR regression guard scope clarification |
| ✅ | 2026-05-04 | IND fire-and-forget state mutation after unmount (DUP of the Turn-33.5 ✅ row with same item-text) |
| ✅ | 2026-05-04 | Audit-emission await-vs-fire-and-forget pattern inconsistency (3 routes, 3 styles) |
| ✅ | 2026-05-04 | Pnl/analytics empty-response envelope schema asymmetry |
| ✅ | 2026-05-04 | Type-safety: AuditEvent.action loose-string at API boundary (Turn-W ⚠️ #2) |
| ✅ | 2026-05-04 | Audit summary helper drift between AuditTicker + AuditFeed |
| ✅ | 2026-05-04 | `setupFetchMock.clear()` warn/throw on pending fetches |
| ✅ | 2026-05-04 | Phase 7.F — composite `(createdAt, id)` cursor for same-ms tie correctness |
| ✅ | 2026-05-03 | Document carryover retroactive-annotation policy |
| ✅ | 2026-05-03 | test-gate.sh self-test missing (`.claude/hooks/tests/test-gate.test.sh`) |
| ✅ | 2026-05-03 | Stale-tracker sweep utility (CARRYOVER hygiene) |
| ✅ | 2026-05-03 | Phase 7.G — SSE LISTEN/NOTIFY infra DESIGN (was: 21-turn-old developer-design 🔄; replaced with implementation-trigger row owner=user) |
| ✅ | 2026-05-03 | Consolidate 3 CATEGORY_* maps into single CATEGORY_META + invariant test (sub-38 architect ⚠️) |
| ✅ | 2026-05-03 | Snapshot/DOM tests for centered empty-state classes (Round-33 architect ⚠️) |
| ✅ | 2026-05-03 | Defensive industries-empty guard for rollup-bearing indicators (sub-44 architect 💡) |
| ✅ | 2026-05-03 | Phase 7.E follow-up — surface parent-co rollup IVs in matrix / HeatMap |
| ✅ | 2026-05-03 | scripts/backfill-historical-ivs.ts — make --codes filter load-bearing in runRecomputeForCompanies |
| ✅ | 2026-05-03 | scripts/backfill-historical-ivs.ts — parseCli pure-function uncovered by tests |
| ✅ | 2026-05-03 | Phase 7.E phase 3 follow-up — historical IV backfill script (sub-42 prereq #2) |
| ✅ | 2026-05-03 | Centralize `rollup:` prefix string in single exported constant (sub-44 prereq #1 architect ⚠️) |
| ✅ | 2026-05-03 | Phase 7.E phase 3 follow-up — parent-co recompute for rollup() indicators (sub-42 prereq #1) |
| ✅ | 2026-04-30 | C6 v3 — per-sector alert-threshold overrides |
| ✅ | 2026-04-30 | Dedupe sparkline buildContext adapter (recompute.ts ↔ scripts/compute-sparklines.ts) |
| ✅ | 2026-04-30 | Audit UI drill-down → POST /api/indicators body shape (sub-39 architect 💡) |
| ✅ | 2026-04-30 | ActionCenter v2 — wire alertMatches store slice for de-duped queue |
| ✅ | 2026-04-30 | Document `.githooks` activation in README |
| ✅ | 2026-04-30 | Memory: feedback_verify_one_layer_up.md (R15→R21 retrospective) |
| ✅ | 2026-04-30 | Dedup `resolveIndicatorLabel` helper (post-Tier-3 5th call site arrival) |
| ✅ | 2026-04-30 | M7 regression scanner — wire into pre-commit hook (.githooks + git config) |
| ✅ | 2026-04-30 | i18n sweep #4 — CompanySnapshot Score label + grep-guard regression test (PROMOTED from Round-10) |
| ✅ | 2026-04-30 | i18n sweep #3 — ComparePanel + HeatMap loading state (Round-10 audit gap) |
| ✅ | 2026-04-30 | M6 modal listener deps optimization (Round-8 🔄) |
| ✅ | 2026-04-30 | M4 fuzzy single-char drift threshold (Round-8 🔄) |
| ✅ | 2026-04-29 | M2 + M3 + M4 + M6 modernization sprint + IND_FX_INPUT_RISK retire |
| ✅ | 2026-04-29 | i18n wave 2.5 IV-loaded + i18n wave 3 + M1 plain-language headers + M5 smart layout presets — closures bundled |
| ✅ | 2026-04-29 | Bring Postgres up + execute seed-demo-companies (architect Round-1 ❌, user-owned blocker) |
| ✅ | 2026-04-29 | Commit sub-25 C6 v2 ship + patch CARRYOVER assertion (architect Round-1 blocker chain) |
| ✅ | 2026-04-29 | C6 v2 — rule thresholds + critical-indicator config (was hardcoded) |
| ✅ | 2026-04-29 | C2 v2 — confidence interval bands (numeric ±range) |
| ✅ | 2026-04-29 | C2 v2 — multi-step forecast horizons (3-6 months) |
| ✅ | 2026-04-29 | C2 v2 — LLM-narrated forecast explanation |
| ✅ | 2026-04-29 | Shared matrix-fetch hook needed (4 self-fetch sites; consolidate w/ 3 existing 🔄) |
| ✅ | 2026-04-29 | RelatedFunctionsMenu+AlertsPanel duplicate /api/companies fetch (4 sites) |
| ✅ | 2026-04-28 | B4 v2 — BY_SECTOR tab not shipped (plan deviation) |
| ✅ | 2026-04-28 | C5 — HeatMap sub-group rollup-skip integration test (RTL component-level) |
| ✅ | 2026-04-28 | AlertsPanel — chips show truncated-id during 50-200ms /api/companies fetch (loading microstate polish) |
| ✅ | 2026-04-28 | HeatMap full-matrix refetch on SSE — debounce + partial-event needed for scale |
| ✅ | 2026-04-28 | audit_events NOTIFY payload missing actorUserId |
| ✅ | 2026-04-28 | Sparkline e2e integration test (regression-proof for resolver↔evaluator chain) |
| ✅ | 2026-04-28 | C6 v2 — pre-index cells by companyId for Phase F scale |
| ✅ | 2026-04-28 | C6 v2 — integration test for multi-rule interaction |
| ✅ | 2026-04-28 | CompanySnapshot 3-card grid overflow at narrow Panel 4 width |
| ✅ | 2026-04-28 | useEventStream hidden-tab early-return contract undocumented |
| ✅ | 2026-04-28 | C6 v2 — alerts panel UI surface (PRIMARY 🔄 sub-9 architect Round-1) |
| ✅ | 2026-04-28 | C6 v2 — explicit rule priority field for in-severity sort |
| ✅ | 2026-04-28 | C6 v2 — affectedCompanyIds dedup contract |
| ✅ | 2026-04-28 | Phase C5 sub-group double-aggregation (worst-of-children rollup → average underestimates 80%-green sub-groups) |
| ✅ | 2026-04-28 | Pre-existing uncommitted Phase C5 WIP (working but unfinished sketch) |
| ✅ | 2026-04-28 | page.tsx broader-file i18n sweep beyond PlansTab range |
| ✅ | 2026-04-28 | 5-10 hardcoded EN strings in budgeting UI (post-Turn-42-sub4 sweep) |
| ✅ | 2026-04-28 | Demo-blocker: rollup-sourced sparkline flat-line (resolver fix needed, 7.A.0) |
| ✅ | 2026-04-28 | Recent-stack pollution from programmatic setCompany callers |
| ✅ | 2026-04-28 | ALERTED tab no-loading-state during matrix fetch |
| ✅ | 2026-04-28 | WatchlistTabs emoji → lucide-react icon swap (cross-platform) |
| ✅ | 2026-04-27 | HeatMap cell tooltip pile-up on cursor sweep + first-hover flash (same root cause: defaultOpen=true) |
| ✅ | 2026-04-27 | Counter-bump policy ambiguity (sub-15-after-final-sub-14) |
| ✅ | 2026-04-27 | HeatMap cell tooltips — Mac Sequoia bug uncured for cells |
| ✅ | 2026-04-27 | Counter-bump policy enforcement gap (memory-only, no hook) |
| ✅ | 2026-04-27 | pre-demo-check.sh script-quality issues (architect sub-13) |
| ✅ | 2026-04-27 | Loom data drift risk |
| ✅ | 2026-04-27 | DEMO_LOOM_BACKUP timing has no slack |
| ✅ | 2026-04-27 | Loom + live demo collide on DEMO-CO state |
| ✅ | 2026-04-27 | Counter bumps pattern for sub-turns inside Turn N |
| ✅ | 2026-04-27 | TemplateSeedButton fetches 4.3 MB just to check `lines.length > 0` |
| ✅ | 2026-04-27 | Audit metadata missing modelName + promptVersion (compliance gap) |
| ✅ | 2026-04-27 | Variance Explainer audit emission missing (Phase 7.E AI-suite audit-coverage gap) |
| ✅ | 2026-04-27 | Sub-group HeatMap rollup absent (P1 demo-blocker Turn-28 Bug #7) |
| ✅ | 2026-04-27 | DEMO_SCRIPT Step 3 (DEMO-CO xlsx upload) — live-rehearsal pending pre-demo |
| ✅ | 2026-04-27 | DEMO_SCRIPT Step 2 (Variance Explainer EN+RU) — cold-cache rehearsal pending |
| ✅ | 2026-04-27 | DEMO_SCRIPT browser dry-run Steps 1-7 pending user login |
| ✅ | 2026-04-27 | Var % helper extraction (`varPct`) + unit tests (Turn-38-sub3 architect Round-1 💡) |
| ✅ | 2026-04-27 | Unit tests for sign-aware execPct + Op Profit row math (Turn 38 architect Round-1 ⚠️ closure) |
| ✅ | 2026-04-26 | Cleanup duplicate AI-narrative center buttons + dead stub `/api/budgeting/ai-narrative` route |
| ✅ | 2026-04-26 | Test coverage for Bug #1b defensive fallback (Turn-29/30/32 architect ⚠️ partial) |
| ✅ | 2026-04-26 | Pnl/analytics envelope schema asymmetry (Turn-30 architect ⚠️) |
| ✅ | 2026-04-26 | IND fire-and-forget state mutation after unmount (Turn-32 architect ⚠️ — accepted-documented) |
| ✅ | 2026-04-26 | DEMO_SCRIPT Step 2 vs Step 4 narrative collision (Turn-32 architect ⚠️ — narrative-resolved) |
| ✅ | 2026-04-26 | DEMO-CO seed xlsx path portability (Turn-32 architect ⚠️) |
| ✅ | 2026-04-26 | DEMO-CO scratch company missing (Turn-27 walkthrough Bug #4) |
| ✅ | 2026-04-26 | Resolve `phase7f_audit_log` migration drift before next schema work (Turn-29 architect ⚠️) |
| ✅ | 2026-04-26 | Availability endpoint cache layer (Turn-29 architect ⚠️) |
| ✅ | 2026-04-26 | Test coverage for `resolveIndicatorByCode` (Turn-32 architect ⚠️) |
| ✅ | 2026-04-26 | Uncommitted multi-turn debt — 7 turns since last commit (Turn-32 architect ⚠️) |
| ✅ | 2026-04-26 | Risk Terminal `IND <code> GO` command no-op (Turn-27 walkthrough Bug #2) |
| ✅ | 2026-04-26 | DEMO_SCRIPT Step 2 AI Analytics surface mismatch (Turn-27 walkthrough Bug #5) |
| ✅ | 2026-04-26 | Org-wide analytics consolidated UNDER-counts due to cross-company `isParentCode` false-positive (Turn-30 verification surfaced) |
| ✅ | 2026-04-26 | Hub `/budgeting` shows 0 ₼ everywhere — analytics route + isAutoPlanned defaults bug (Turn-27 Bug #1) |
| ✅ | 2026-04-26 | Multi-tab data gap — 11 of 13 AZMADE domain tables empty; only SOPL sheet imported (Turn-28 Bug #6) |
| ✅ | 2026-04-26 | AAC restructure as level=1 sub-group (Turn-14 reframe reverted per Turn-29 user clarification) |
| ✅ | 2026-04-26 | DEMO_SCRIPT.md command syntax inverted + non-existent VAR/LAY function codes (Turn-27 Bug #3 expanded scope) |
| ✅ | 2026-04-26 | Day 1 — browser walkthrough surfacing demo-blocker bugs (P0 fix Day 2) |
| ✅ | 2026-04-26 | Delete or harden one-off `scripts/cleanup-verify-phase2.ts` |
| ✅ | 2026-04-26 | Phase-A P1 (role guards on rolling.lock + sync-actuals) + Phase-A P2 (rate-limit gaps) |
| ✅ | 2026-04-26 | Phase B scope decision — 4 enum members blocked on missing routes |
| ✅ | 2026-04-26 | CARRYOVER not touched Turn 24 (planning-only turn) |
| ✅ | 2026-04-26 | Regression test for `/api/indicators/matrix` default-period (locks in Turn 16 fix) |
| ✅ | 2026-04-26 | API integration test for `/api/onboarding/import/analyze` POST |
| ✅ | 2026-04-26 | Audit-emission happy-path runtime proof for `import_staging_apply` (apply success path) |
| ✅ | 2026-04-26 | Audit-emission write-side runtime proof — all 3 wired import endpoints (lazy-flip + budget POST happy + apply lazy-flip) |
| ✅ | 2026-04-26 | Integration test for `PATCH /api/companies/[id]` (auth gate + tenant-404 + no-op short-circuit + audit-emission shape) |
| ✅ | 2026-04-26 | Phase 7.F — wire `import_budget_create` audit event into CLI import script |
| ✅ | 2026-04-26 | Trim CARRYOVER "Last processed" preamble per-turn |
| ✅ | 2026-04-26 | Phase 7.F — wire `company_role_change` audit event (1 of 5 remaining wiring points from "extend audit-wiring" 🔄) |
| ✅ | 2026-04-26 | Services indicator thresholds — calibration strategy for AZ-market |
| ✅ | 2026-04-26 | Admin user / org-membership alignment for browser smoke verification |
| ✅ | 2026-04-26 | Matrix API default-period mismatch (Turn 16 inline fix) |
| ✅ | 2026-04-25 | Hydration audit — wallpaper-context |
| ✅ | 2026-04-25 | AuditFeed.test concurrent-resolver mock hardening |
| ✅ | 2026-04-25 | Audit-log sidebar/page client-side role gate |
| ✅ | 2026-04-25 | Dev-time stale-Prisma-client detector |
| ✅ | 2026-04-25 | Phase 7.F — wire `AUD GO` command verb + AuditModal in Risk Terminal |
| ✅ | 2026-04-25 | Broad re-audit of CLOSED rows beyond Phase 7.D PanelGrid (Explore-driven probe) |
| ✅ | 2026-04-25 | Phase 7.F — audit log viewer (API + Terminal panel) [partially closed: API + page; terminal panel deferred] |
| ✅ | 2026-04-25 | Phase 7.F — audit log |
| ✅ | 2026-04-25 | Cost-centre role taxonomy hang-tail (`role` surfaced in matrix API) |
| ✅ | 2026-04-25 | Migrate `Company.role String` → `enum CompanyRole { operational, admin, holding }` |
| ✅ | 2026-04-25 | Remove or document `c.role == null` legacy branch in `filterOperationalCompanies` |
| ✅ | 2026-04-25 | Extract `runAutoRecompute` |
| ✅ | 2026-04-25 | Re-calibrate `BEV_GROSS_MARGIN` + `RETAIL_INVENTORY_TURNS` |
| ✅ | 2026-04-25 | Phase 7.D — terminal UI test scaffold |
| ✅ | 2026-04-25 | Indicator catalog expansion (44 → 53) |
| ✅ | 2026-04-25 | Per-company budget/actual import as API endpoint |
| ✅ | 2026-04-25 | holding`) |
| ✅ | 2026-04-25 | Phase 7.D — browser smoke test (drag-resize + named-layout save/load + cmd bar + F-keys + /-search end-to-end) |
| ✅ | 2026-04-25 | Phase 7.D — multi-pane drag-resize |
| ✅ | 2026-04-25 | Phase 7.D round-1 architect fixups |
| ✅ | 2026-04-25 | Phase 7.D — saveable named layouts |
| ✅ | 2026-04-25 | Phase 7.D — function-codes parser + Panels 3/4 + F-keys + /-search + Variance Explainer UI |
| ✅ | 2026-04-25 | AI Variance Explainer (Phase 7.E NEW) — backend + round-1 hardening |
| ✅ | 2026-04-25 | budgetLine sub-resolvers + round-1 hardening |
| ✅ | 2026-04-25 | OperationalFact metrics — clarified as data, not code |
| ✅ | 2026-04-25 | Unit tests for indicator thresholds — boundary-value coverage |
| ✅ | 2026-04-25 | Sidebar visibility for Phase 7 work |
| ✅ | 2026-04-25 | AI Data Mapper Turn 3 (Onboarding wizard UI) |
| ✅ | 2026-04-24 | Carryover mechanism — cross-turn tracker of open 🔄 items |
| ✅ | 2026-04-24 | Multi-machine bootstrap — fresh clone gets protocol auto-loaded |
| ✅ | 2026-04-24 | Hook robustness — distinguish env issues from protocol violations |
| ✅ | 2026-04-25 | Regression guards — CARRYOVER + bootstrap |
| ✅ | 2026-04-25 | Band-direction validator |
| ✅ | 2026-04-25 | AI Data Mapper Turn 2b (apply endpoint) |
| ✅ | 2026-04-25 | Carryover hook race condition |
| ✅ | 2026-04-25 | AI Data Mapper Turn 2a |
| ✅ | 2026-04-25 | Greedy-regex JSON extraction in AI Mapper |
| ✅ | 2026-04-25 | Mocked-Anthropic integration tests for runMapper |
| ✅ | 2026-04-25 | AI Data Mapper POC (Phase 7.B NEW) |
| ✅ | 2026-04-24 | LLS clamp-to-unknown for OpEx/Net |
| ✅ | 2026-04-24 | Silent double-counting of parent rollup codes in AZMADE SOPL sheets |
| ✅ | 2026-04-24 | Finance-safety on xlsx re-upload |
| ✅ | 2026-04-24 | Orphan BudgetPlan risk on failed import |
| ✅ | 2026-04-24 | Manual recompute after import |
| ✅ | 2026-04-24 | Services indicator pack |
| ✅ | 2026-04-24 | Seed idempotency with industry-narrowing |
| ✅ | 2026-04-24 | Indicator catalog expansion |
| ✅ | 2026-04-24 | 100%-closure protocol v1 |
| ✅ | 2026-05-03 | Browser-visual verification pipeline — promoted to fix-before-build for layout commits |
| ✅ | 2026-05-03 | Sparkline fixed dimensions vs newly-stretched card slot |
| ✅ | 2026-05-03 | i18n — translate industry codes in sector-alert messages |
| ✅ | 2026-05-03 | CommandBar autocomplete hint — locale-aware indicator name |
| ✅ | 2026-05-03 | Extend i18n-hardcoded-strings scanner to engine modules |
| ✅ | 2026-05-03 | HeatMap pendingMissingCell.indicatorNameEn — audit consumer locale-needs |
| ✅ | 2026-05-03 | Scenario model i18n migration — nameRu/nameAz columns + helper + ScenarioPanel wire-up |
| ✅ | 2026-05-03 | dead-defense vi.resetModules() in IndicatorDetail.test.tsx — keep or remove? |
| ✅ | 2026-05-03 | WatchlistTabs prop-drill + hook hybrid cleanup |
| ✅ | 2026-05-03 | null` fallback on session.userId in audit emission call sites |
| ✅ | 2026-05-03 | Chronic Stop-hook false-positive on Python bumper invocations |
| ✅ | 2026-05-03 | BASELINE UPDATE token enforcement via pre-commit hook |
| ✅ | 2026-05-03 | SSE always-on without kill-switch (plan deviation) |
| ✅ | 2026-05-03 | RelatedFunctionsMenu companyMap stale on mid-session add/rename |
| ✅ | 2026-05-03 | RelatedFunctionsMenu Audit → page nav vs AUD GO modal-event UX split |
| ✅ | 2026-05-03 | AuditTicker has no refresh path until SSE lands (B1) |
| ✅ | 2026-05-03 | AuditTicker tab-order semantics need explicit decision |
## Notes (📝) collapsed 2026-06-28

| 📝 | 2026-05-27 | engineering | Fabricated-data cleanup DONE — removed AI-invented KRI templates / fxRevenueSplit defaults / LEGAL_MONEY_AT_RISK; kept only real client data (EDEN registry, CPC FX split, 218 audit findings + 54 court cases). |
