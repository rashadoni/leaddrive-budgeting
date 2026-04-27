# Customer demo script — Friday 2026-05-01

**Target wall-time:** 15-20 minutes live + 5-min Q&A buffer.
**Format:** Live в браузере, developer drives, customer watches (in-room or Zoom screenshare).
**Audience:** AZMADE-like multi-sector holding decision-maker (CFO / Owner / COO).
**Anchor case study:** AZMADE Group MMC — 13 companies (5 sub-groups + 8 operational op-cos including AAC-MAIN under AAC), 568 distinct line-items × 12 monthly rows = **6,816 BudgetLines** (Turn-34 monthly fix), 41 IndicatorValues across 14 sector packs.

## Pre-demo checklist (Day 5 Thursday + 30 min before)

- [ ] Dev server uptime: `tail -20 ~/Library/Logs/budgetpro.log` shows recent activity, no crashes
- [ ] LaunchAgent loaded: `launchctl list com.budgetpro.dev` returns valid PID
- [ ] DB state: `audit_events` ≥ 20 rows, `companies` = 13 (5 sub-groups AAC/ATL/SPARK/ZTP/LLS at level=1 + 8 ops at level=2 including AAC-MAIN) + 1 DEMO-CO = 14, `budget_lines` = 6,816 (568 distinct × 12 months) + any DEMO-CO post-import rows
- [ ] Anthropic API key live: `curl -s -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages` returns non-error
- [ ] Fresh-incognito browser window open at `http://localhost:3000`
- [ ] Sign in as `admin@budgetpro.com` (org=AZMADE Group MMC) — confirm via `/api/auth/session`
- [ ] Pre-warmed: run `VAR GO` once on a known indicator so cache is hot for live demo
- [ ] Pre-warmed: run AI Analytics chat one query in EN so cache is hot
- [ ] Backup pg_dump in `~/budgetpro-pre-demo-<date>.sql`
- [ ] Loom fallback recording from Day-5 dry-run accessible (URL bookmarked)
- [ ] Roadmap slides (`docs/DEMO_ROADMAP.md`) open in second tab
- [ ] Phone on Do Not Disturb

## Step-by-step (target 15-20 min)

### 1. Hub overview — P&L Report (1.5 min)

**Click:** Land on `/budgeting` after sign-in → click **P&L** in sidebar (lands at `?tab=pnl-report`).

> ⚠️ **Turn-35 reframe:** Default landing tab is Workspace (annual category breakdown). The professional FP&A view is **P&L Report tab** — full Plan vs Actual vs Variance grid (rows × Jan-Dec), color-coded favorability. Start here, not Workspace.

**Say:**
> "This is AZMADE's main P&L. 13 companies — 5 sub-groups containing 8 operational op-cos. Q1 closed, April partial — typical April-end controller view. Future months stay plan-only — that's how live FP&A works against real-time accounting integration."

**Show:**
- KPI cards: Net Revenue 240.2M plan / Q1+Apr actual ~60.9M; COGS 187.9M / actual ~45.5M; Gross Profit; EBITDA; Net Profit
- "Revenue vs COGS — Monthly" chart: Jan-Apr actual overlay on plan bars; May-Dec plan-only
- Margin Trends: % bars per period — **note December cliff:** Net Margin drops to ~−30% in Dec because ZTP-MAIN's accountant books the full annual non-operating loss + extraordinary expenses (codes 731-01 + 761-01 ≈ 4M ₼) in December as one entry per AZ SAP practice; system reproduces xlsx 1:1 без сглаживания. Run `npx tsx scripts/audit-dec-lumps.ts` to show the evidence chain if customer asks.
- P&L Waterfall: full Revenue → COGS → GP → OpEx → EBITDA → D&A/Tax → Net Profit cascade

**Click:** Company selector dropdown → select **AAC-MAIN**:

**Say (pointing at Variance %):**
> "AAC-MAIN — наш underperformer Q1. Revenue down ~16% vs plan, costs up 8-15%. Система мгновенно highlights это в Variance column. CFO видит проблему за секунды, не за часы."

**Click:** dropdown → switch to **ATL-DBZ**:

**Say:**
> "ATL-DBZ — лучший performer. Steel pipe demand Q1 drove revenue +14% over plan. Строится cash buffer для Q3-Q4 expansion."

**Click:** dropdown → switch back to **All companies (consolidated)** для общего overview перед Step 2.

**Fallback:** if P&L Report render is broken → switch to Workspace tab `?tab=workspace` (annual cards still work). Say: "Today let me focus on the risk-monitoring side which is the unique part of the platform" → skip to Step 4.

---

### 2. AI Variance Explainer (Risk Terminal Panel 4) — 1.5 min

> ⚠️ **Turn-32 reframe (Bug #5 close):** Original Step 2 described a "free-form AI Analytics chat panel" on `/budgeting`. That UI doesn't exist (verified via Turn-27 audit). The Risk Terminal **AI Variance Explainer** (Panel 4) is the closest shipped product surface — narrates indicator value with EN/RU re-run button. Pivot Step 2 here.

> ⚠️ **Turn-33 reframe (architect Round-1 ⚠️ Step 2/4 collision close):** Step 2 + Step 4 both live on `/budgeting/terminal`. Treat Step 2 as a **focused 90-sec preview** of one specific AI surface (Variance Explainer narrative) — get in, click EXPLAIN + Russian re-run, get out. Step 4 (the main 6-min Risk Terminal showcase) opens with HeatMap framing + drill-down narrative again, but expands into command bar (CO/IND/AUD), F1-F4, layouts, multi-cell flow. The repeat is intentional: Step 2 sells "AI inside" in 90 sec; Step 4 sells "Bloomberg-grade UX" with 6 min of room. Customer should leave Step 2 thinking "оно умное"; Step 4 thinking "оно мощное". Don't dwell on HeatMap mechanics in Step 2 — save that hook for Step 4.

**Click:** Sidebar → Risk Terminal → `/budgeting/terminal`

**Click:** A red HeatMap cell (e.g. `AAC IND_NET_MARGIN` red — drill down).

> Panel 3 (Indicator Detail) populates with the cell — formula, resolved variables, aggregates.

**Click:** **`EXPLAIN →`** button at the bottom of Panel 3.

**Wait:** ~5-10 sec for AI Variance Explainer LLM stream.

**Say (while waiting):**
> "Behind every cell we have an AI layer that interprets the data in plain language — narrates what's driving the variance + 3 actionable recommendations. Это для CFO who doesn't want to dig into 90 BudgetLine rows."

**Show:** Panel 4 (Variance Explainer) renders English narrative explanation:
> "Net margin -9.46%. Below 3% — a single input-cost spike or FX move erases profit. Two main drivers: ..."

**Click:** **`RUN FOR RU`** button in Panel 4 → re-fetch same explanation in Russian.

**Show:** Same indicator now in Russian (~5-10 sec second LLM call).

**Say:**
> "Multilingual из коробки — EN + RU shipped today, AZ in Q3 sector-pack expansion. Holdings often work cross-language so the narrative isn't locked to one."

**Fallback:** if LLM call >15 sec wait or errors → close Panel 4, say "production version будет с streaming + fallback to cached answer; в demo environment we use direct API calls to show the round-trip." Continue to Step 3.

---

### 3. Onboarding wizard — "how a new company joins" (3 min)

**Click:** Sidebar → Onboarding → `/budgeting/onboarding`

**Say:**
> "Скажем you acquire a new subsidiary. Вот как они появляются в системе за 3 минуты — not 3 weeks of consulting."

**Click:** Operational-companies dropdown → select **DEMO-CO** (pre-seeded scratch company, NOT one of the AZMADE companies — avoids Turn-23 SPARK side-effect).

**Click:** Upload xlsx → pick fresh `~/Downloads/DEMO-CO.xlsx` (pre-staged demo file, ~50-row P&L sheet).

**Wait:** ~30 sec for `/analyze` call (real Anthropic LLM mapping).

**Say (while waiting):**
> "Anthropic Claude analyzes the spreadsheet и proposes column mappings — KOD column, label column, plan/actual columns. Customer reviews and corrects если AI guess wrong."

**Show:** Step 1 result — proposal with column mapping panel.

**Click:** Step 2 → quick scan, no overrides.

**Click:** Step 3 → Apply.

**Wait:** ~2-3 sec for `$transaction` + recompute.

**Show:**
- 200 OK toast / success message
- "Imported X BudgetLines; Y indicators recomputed"

**Say:**
> "All the BudgetLines committed atomically; the risk indicators auto-recomputed. Now посмотрим как DEMO-CO появилась в the holding view."

**Fallback:** if `/analyze` >60 sec or errors → cancel upload, switch to pre-recorded Loom snippet of successful flow (~30 sec clip).

---

### 4. Risk Terminal (`/budgeting/terminal`) — MAIN SHOWCASE (6 min)

**Click:** Sidebar → Risk Terminal → `/budgeting/terminal`

**Say:**
> "This is our risk-monitoring terminal — Bloomberg-style для FP&A teams. Каждая ячейка — это indicator at the intersection of company × KPI."

**Show:** HeatMap renders 36+ colored cells (AZMADE baseline 12g/15a/9r=36; if DEMO-CO seeded by Day 4, expect 40-50 cells total — verify exact count Day-5 dry-run and update this script before demo).

**Point:**
> "Зелёный = within healthy band. Amber = warning. Red = needs attention. Сразу видно где проблемы — без открытия 50 spreadsheets."

**Click:** A red cell.

**Show:** IndicatorDetail panel populates с:
- Indicator name + description
- Computed value + threshold band
- Drill-down inputs (which BudgetLines / OperationalFacts feed it)

**Say:**
> "Click any cell — get the full computation chain. Every number is traceable to source BudgetLines."

**Type:** `SPARK-MAIN CO GO` in command bar.

> ⚠️ Command-bar syntax is **target-FIRST, function-LAST, GO terminator** (per `src/features/terminal/lib/command-parser.ts:151-152` — last body token is the function). Placeholder hints `IND_OPEX_RATIO IND GO`. Function whitelist: `HOLD, GRP, CO, IND, SEC, CMP, ALT, SCN, BRF, AUD` (no `VAR`, no `LAY` — those are panel/menu UIs reachable other ways).

**Show:** CompanyTree highlights SPARK-MAIN; HeatMap focuses on its row.

**Say:**
> "Bloomberg-style command bar — keyboard-driven for speed. Every action has a verb."

**Click:** A red HeatMap cell for SPARK-MAIN (e.g. `IND_GROSS_MARGIN`).

> ⚠️ Note: `<code> IND GO` command is currently a no-op (Bug #2 in CARRYOVER Turn-27 — case 'ind' in `CommandBar.tsx:76` doesn't wire indicator to store). HeatMap cell click is the working path until that ships. After fix, demo can substitute `BEV_GROSS_MARGIN IND GO` for keyboard-driven story.

**Show:** Indicator-detail panel populates. Then **click `EXPLAIN →`** button at the bottom of Panel 3.

**Wait:** ~5-8 sec for AI Variance Explainer LLM call.

**Show:** VarianceExplainerPanel (F4) populates with Russian/English narrative explanation:
> "Gross margin dropped from 28% to 24% in Q1 because cost of goods rose 12% while revenue rose only 4%. Two main drivers: ..."

> ⚠️ AI Variance Explainer triggered by **`EXPLAIN →` button** in Panel 3 (post-cell-click), NOT by command. Re-run-for-RU/EN button lives in Panel 4 itself.

**Say:**
> "Это и есть AI-augmented FP&A. Не replacing analyst — augmenting them. CFO gets the variance story in 5 seconds, not 5 hours."

**Press:** F1, F2, F3, F4 — show panel switching feels snappy.

**Drag:** A panel separator — show smooth resize.

**Click:** `▢ Layouts` button in the terminal top bar → LayoutMenu opens → save current layout as "demo-layout" → reload page → load "demo-layout" → restored.

> ⚠️ Layouts opens via top-bar button (no `LAY GO` command — that function code doesn't exist).

**Say:**
> "Persistent named layouts — каждый user can save их preferred view. Per-user, не per-org."

**Type:** `AUD GO`.

**Show:** AuditModal opens with 20+ audit events DESC (exact count drifts with intervening dev actions — verify Day-5 dry-run; the visible-on-screen ordering is what matters, not the count):
- Most recent: `import_staging_apply` for DEMO-CO from Step 3 above
- Then: `import_budget_create` × 8 (CLI imports)
- Then: `company_role_change` × 3 (ATL-MRKZ flips)
- Older: backfill events

**Say:**
> "Full audit trail — каждое изменение who-what-when. Compliance-ready: 365-day retention, append-only, никто не может tamper."

**Press Escape:** modal closes.

---

### 5. Audit feed (`/budgeting/audit`) — full event drill (1.5 min)

**Click:** Sidebar → Audit Log → `/budgeting/audit`

**Show:** AuditFeed renders 50 most recent events with summarizeMetadata:
- "DEMO-CO · 2026 · 50 lines" (`import_staging_apply` row)
- "AAC · 2026 · 90 lines" (`import_budget_create`)
- "ATL-MRKZ · operational → admin" (`company_role_change`)

**Click:** A row → expand to show full metadata JSON.

**Say:**
> "Filter by action, by entity, by date range, by actor. Export to CSV (coming Q3). Auditor opens this и sees full forensic trail."

**Click:** Load more (cursor pagination).

**Show:** Next page loads без перезагрузки страницы.

---

### 6. Roadmap walkthrough (3-5 min) — `docs/DEMO_ROADMAP.md`

**Switch to second tab** with roadmap slides.

**Slide 1 — "Working today":** 5 bullet points (P&L + Risk Terminal + AI Mapper + Audit + AI Analytics chat). Recap.

**Slide 2 — "Coming next quarter":**
- AI Web Crawler — auto-pull industry benchmarks (Damodaran-class data) per sector
- Predictive Analytics — forecast next 4 quarters with confidence intervals
- Board Deck Generator — one-click executive PDF for board meetings

**Slide 3 — "Coming next 6 months":**
- Sparkline trends per indicator (12-month mini-chart in every cell)
- Composite indicators via fact()/rollup() formula functions (cross-period analysis)
- Background recompute scheduler — instant matrix at 60+ companies via job queue

**Slide 4 — "Coming year+":**
- Multi-tenant SaaS — per-customer org isolation with PostgreSQL RLS
- Per-customer sector pack expansion (currently 14 packs; target 30+)
- White-label deployment options для consulting partners

**Say (closing):**
> "Today's demo — это foundation. The risk-monitoring layer на нашей opinion это где FP&A in Azerbaijan and CIS должен пойти. Готовы запустить pilot с вашей группой когда вы ready."

---

### 7. Q&A (5 min buffer)

**Common questions + prepared answers:**

| Question | Answer |
|---|---|
| "Сколько компаний система выдержит?" | "AZMADE = 12 ops, demo also showed scaling to 30. Architecture supports 60-100 sync; beyond that we have BullMQ scheduler in the pipeline (slide 3). Hard limit будет per Postgres instance — multi-tenant SaaS solves that." |
| "Cколько стоит per company?" | "Pricing будет per-holding (group of companies), не per-company. Estimated $X/month для типичной 10-30 company group. Pilot — discounted." |
| "Что если у нас нестандартный COA?" | "AI Mapper handles unknown shapes — это что вы видели в Step 3. После 1-2 imports AI calibrates на ваших column patterns. Manual override always available." |
| "GDPR / data residency?" | "Self-hosted в вашем Azure/AWS tenant — данные never leave your infrastructure. SaaS option launches Q3, EU + Azerbaijan regions." |
| "Integration с 1C / SAP?" | "CSV / Excel import works today. 1C connector в Q3 backlog. SAP — на request." |
| "Кто видит чьи данные?" | "Per-org isolation enforced at app + (coming) database (RLS) layer. Within org — role-based: admin / manager / editor / viewer with audit trail of every access." |
| "А если интернет пропадёт?" | "Self-hosted — works offline-LAN. SaaS — same Anthropic dependency для AI features (graceful degradation: matrix + audit work без AI; chat + variance explainer require connectivity)." |

**If they ask anything off-script** → "Great question — let me check if we have it in the roadmap" → reference slide 4 or "this lives in our backlog, can dive deeper после demo."

---

## Post-demo close

- "Send me a follow-up email to schedule pilot conversation"
- Send Loom recording + roadmap slides PDF within 24h
- Schedule check-in within 1 week

---

## Hard fallbacks (if catastrophic)

| What breaks | Fallback action |
|---|---|
| Dev server crash mid-demo | Open new terminal, `launchctl kickstart -k gui/501/com.budgetpro.dev`, refresh browser (~5 sec recovery) |
| Anthropic API down | Skip Step 2 (chat) и Step 4 VAR GO; lean harder on HeatMap visual + AuditModal |
| Browser tab freezes | Cmd+R refresh; if persists, switch to backup Loom recording |
| AZMADE data looks wrong | Have screenshots from Day-5 dry-run в second tab as truth-of-record |
| Customer interrupts with "show me X feature" | "Great — let me note that and we'll cover it after the structured tour. Continuing..." |
| Q&A goes >10 min off-script | "Let me get back to you in writing for that depth — let's make sure we have time for next steps." |

## Demo-day MUST-NOT-DO list

- ❌ Don't click "Apply" on `/budgeting/onboarding` against an AZMADE company (causes parallel-plan side effect, Turn-23 SPARK pickle)
- ❌ Don't show `/budgeting` P&L if Day-4 audit found broken cells
- ❌ Don't free-explore — stick to script
- ❌ Don't show error console (DevTools закрыты)
- ❌ Don't promise specific dates for unshipped features (use "next quarter / next 6 months")
- ❌ Don't disclose customer names from other deals
- ❌ Don't show terminal logs / SQL / migrations to customer

## Day-5 dry-run rubric

Mark each step pass/fail:
- [ ] Step 1: P&L renders, sidebar visible, no console errors
- [ ] Step 2: chat responds EN + RU/AZ within 15s
- [ ] Step 3: analyze 201 + apply 200 + DEMO-CO appears in HeatMap
- [ ] Step 4: HeatMap colored, IndicatorDetail populates, all 6 verbs dispatch, F1-F4 snappy, drag smooth, AUD GO opens modal
- [ ] Step 5: AuditFeed paginates, expand row works
- [ ] Step 6: roadmap slides render
- [ ] Total wall-time: 15-22 min

If any step fails Day-5 morning → P0 fix that day → re-run dry-run afternoon. If still failing Thursday evening → trigger fallback plan (skip that step in demo OR use Loom segment).
