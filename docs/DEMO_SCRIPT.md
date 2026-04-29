# Customer demo script — Friday 2026-05-01

**Target wall-time:** 16-22 minutes live + 5-min Q&A buffer (Step 4 grew 6 min → 7-7.5 min after Phase C v1 add-ons; cut-priority guidance in Step 4 lets presenter scale back to 16 min on slow takes).
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

## Step-by-step (target 16-22 min post Phase C v1)

### 1. Hub overview — P&L Report (1.5 min)

**Click:** Land on `/budgeting` after sign-in → click **P&L** in sidebar (lands at `?tab=pnl-report`).

> ⚠️ **Turn-35 reframe:** Default landing tab is Workspace (annual category breakdown). The professional FP&A view is **P&L Report tab** — full Plan vs Actual vs Variance grid (rows × Jan-Dec), color-coded favorability. Start here, not Workspace.

**Say:**
> "This is AZMADE's main P&L. 13 companies — 5 sub-groups containing 8 operational op-cos. Q1 closed, April partial — typical April-end controller view. Future months stay plan-only — that's how live FP&A works against real-time accounting integration."

**Show:**
- KPI cards: Net Revenue 250.8M plan / Q1+Apr actual ~60.9M; COGS 187.9M / actual ~45.5M; Gross Profit 63.0M (25.1%); **EBITDA 25.0M (10.0%) — true EBITDA, D&A added back from OpEx 721-11 + COGS 703-11**; Net Profit 8.5M (3.4%).
- "Revenue vs COGS — Monthly" chart: Jan-Apr actual overlay on plan bars; May-Dec plan-only.
- Margin Trends chart with **Management/Bookkeeping toggle** (default Management, finance-grade view). Management view spreads year-end accrual lumps (FX losses, interest, extraordinary, tax codes 731/751/761/771/801) evenly across 12 months; YTD totals unchanged. Toggle to Bookkeeping if customer asks "where's the verbatim xlsx data" — chart cliffs to ~−30% Net Margin Dec showing ZTP-MAIN's annual non-op + extraordinary close (codes 731-01 + 761-01 ≈ 4M ₼ in one Dec entry per AZ SAP practice). Toggle back. Run `npx tsx scripts/audit-dec-lumps.ts` to surface the evidence trail if needed.
- P&L Waterfall: full Revenue → COGS → GP → OpEx → EBITDA → D&A/Tax → Net Profit cascade.

> 💡 **Finance-audience cue (Turn 38 sub-turns 4-5):** if asked "is your EBITDA correct" — yes; D&A is two-namespace in AZ SAP (703-11 in COGS + 721-11 in OpEx) and we add both back. Use the toggle to demonstrate: numbers in Management mode are management-reporting standard; Bookkeeping mode shows the raw xlsx (faithful 1:1 reproduction, no smoothing applied).

**Click:** Company selector dropdown → select **AAC-MAIN**:

**Say (pointing at Variance %):**
> "AAC-MAIN — наш underperformer Q1. Net Revenue 19.0M plan, COGS 15.8M = Gross Margin 17% (тонкий — для industrial типично 25-30%). EBITDA 1.5M. Revenue down ~16% vs plan, costs up 8-15%. Система мгновенно highlights это в Variance column. CFO видит проблему за секунды, не за часы."

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

**Wait:** ~10-15 sec for AI Variance Explainer LLM stream (verified Turn 38 sub-7 dry-run: ~12 sec EN, ~15 sec RU).

**Say (while waiting):**
> "Behind every cell we have an AI layer that interprets the data in plain language — narrates what's driving the variance + 3 actionable recommendations. Это для CFO who doesn't want to dig into 1000+ BudgetLine rows."

**Show:** Panel 4 (Variance Explainer) renders English narrative explanation (verified live Turn 38 sub-7):
> "AAC Main lost AZN 1.76M on AZN 18.6M revenue (–9.5% margin) because total costs (AZN 20.36M) exceeded revenue by 9.5%, driven by COGS of AZN 15.79M (85% of revenue) and OpEx of AZN 4.58M (25% of revenue)."

Plus 3 specific recommendations + Top drivers (total_cost, cogs, opex).

**Click:** **`RU`** language tab + **`Re-run`** button in Panel 4 → re-fetch same explanation in Russian.

**Show:** Same indicator now in Russian (~15 sec, verified):
> "AAC Main показывает убыток −9,5%, так как общие затраты (20,4 млн манатов) превысили выручку (18,6 млн манатов) на 1,76 млн манатов..."

Plus 3 русских рекомендации (заморозить OpEx, пересмотреть ценообразование, аудит поставщиков).

**Say:**
> "Multilingual из коробки — EN + RU shipped today, AZ tab visible (sector-pack content rollout Q3). Holdings often work cross-language so the narrative isn't locked to one."

> 💡 **Compliance cue (Turn 38 sub-9):** if asked "what model generated this?" — the audit_event records modelName + promptVersion + token usage per call. CFO/auditor can attest exactly which engine answered each question. Don't volunteer this; mention only if asked.

**Fallback:** if LLM call >15 sec wait or errors → close Panel 4, say "production version будет с streaming + fallback to cached answer; в demo environment we use direct API calls to show the round-trip." Continue to Step 3.

---

### 3. Onboarding wizard — "how a new company joins" (3 min)

**Click:** Sidebar → Onboarding → `/budgeting/onboarding`

**Say:**
> "Скажем you acquire a new subsidiary. Вот как они появляются в системе за 3 минуты — not 3 weeks of consulting."

**Click:** Operational-companies dropdown → select **DEMO-CO** (pre-seeded scratch company, NOT one of the AZMADE companies — avoids Turn-23 SPARK side-effect).

**Click:** Upload xlsx → pick fresh `~/Downloads/DEMO-CO.xlsx` (pre-staged demo file, 27-row P&L sheet — generated by `scripts/seed-demo-co.ts`).

**Wait:** ~30-35 sec for `/analyze` call (verified Turn 38 sub-7: real Anthropic LLM mapping returns 14-column proposal in ~35 sec).

**Say (while waiting):**
> "Anthropic Claude analyzes the spreadsheet и proposes column mappings — KOD column, label column, plan/actual columns. Customer reviews and corrects если AI guess wrong."

**Show:** Mapping proposal table — 14 columns with role + confidence + reasoning per column.

**Click:** **"Apply to BudgetLine"** button (the wizard auto-progresses; "Step 2 Review" → "Step 3 Applied" happens on click).

**Wait:** ~5 sec for `$transaction` + recompute.

**Show:**
- "✓ Applied to BudgetLine" success header
- "INSERTED 27 / DELETED 0 / WARNINGS 0 / Indicator recompute 5 ok over 5 targets" (verified Turn 38 sub-7)
- New audit_event auto-fires (`import_staging_apply` — visible in Step 5 Audit Log)

**Say:**
> "All the BudgetLines committed atomically; the risk indicators auto-recomputed. Now посмотрим как DEMO-CO появилась в the holding view."

**Fallback:** if `/analyze` >60 sec or errors → cancel upload, switch to pre-recorded Loom snippet of successful flow (~30 sec clip).

---

### 4. Risk Terminal (`/budgeting/terminal`) — MAIN SHOWCASE (7-7.5 min post Phase C v1)

> **Cut-priority on slow takes (architect sub-21 closure):** if running long, drop in this order: BRF GO board-deck (most isolated, 30 sec) → SCN GO scenario panel (45 sec) → AlertsPanel beat (45 sec). Keep composite-badge framing + EXPLAIN drill + AUD modal as the irreducible core (Bloomberg-grade UX hook + AI inside + audit trail).

**Click:** Sidebar → Risk Terminal → `/budgeting/terminal`

**Say:**
> "This is our risk-monitoring terminal — Bloomberg-style для FP&A teams. Каждая ячейка — это indicator at the intersection of company × KPI."

**Show:** HeatMap renders 14 rows (8 op-cos + 5 sub-group rollups + DEMO-CO) × ~10 indicators = 67 active colored cells (verified Turn 38 sub-7: **24g / 25a / 18r = 67 active**, sub-group rollup synthetic cells included). Each row = company; sub-group rows show worst-of-children status.

**Point (Phase C5 — composite badges, sub-7):**
> "Each company row shows a 0-100 composite risk score next to the code — green ≥67, amber 34-66, red <34. Sub-group rows show '—' (rollup, not measurable). CFO scans one column to triage which sub-co needs attention."

**Point:**
> "Зелёный = within healthy band. Amber = warning. Red = needs attention. Сразу видно где проблемы — без открытия 50 spreadsheets."

**Click:** A red cell.

**Show:** IndicatorDetail panel populates с:
- Indicator name + description
- Computed value + threshold band
- Drill-down inputs (which BudgetLines / OperationalFacts feed it)
- **12mo trend sparkline** (Phase B3, Turn 41) — trailing-month series with Δ stat
- **Next-period forecast** (Phase C2 v1, sub-13) — linear-regression projection with confidence band ↑/↓/→ trend arrow + R² + n/12 pts

**Say:**
> "Click any cell — get the full computation chain. Every number is traceable to source BudgetLines. The forecast box shows where this metric is heading next period — high/medium/low confidence based on R² fit. Multi-step horizons + LLM-narrated explanations come in v2."

**Type:** `SPARK-MAIN CO GO` in command bar.

> ⚠️ Command-bar syntax is **target-FIRST, function-LAST, GO terminator** (per `src/features/terminal/lib/command-parser.ts:151-152` — last body token is the function). Placeholder hints `IND_OPEX_RATIO IND GO`. Function whitelist: `HOLD, GRP, CO, IND, SEC, CMP, ALT, SCN, BRF, AUD` (no `VAR`, no `LAY` — those are panel/menu UIs reachable other ways).

**Show:** CompanyTree highlights SPARK-MAIN; HeatMap focuses on its row.

**Say:**
> "Bloomberg-style command bar — keyboard-driven for speed. Every action has a verb."

**Click:** A red HeatMap cell for SPARK-MAIN (e.g. `IND_GROSS_MARGIN`).

> ✅ **Note (Turn 32 Bug #2 fix):** `<code> IND GO` command now works — typing `IND_GROSS_MARGIN IND GO` populates Panel 3 directly (verified Turn 32 browser audit). Either path (HeatMap click OR command) reaches the same state. Keyboard-driven story available if you want to flex the Bloomberg muscle.

**Show:** Indicator-detail panel populates. Then **click `EXPLAIN →`** button at the bottom of Panel 3.

**Wait:** ~10-15 sec for AI Variance Explainer LLM call (Turn 38 sub-7 verified ~12 sec EN, ~15 sec RU).

**Show:** VarianceExplainerPanel (F4) populates with English narrative — full CFO-grade output: 1-2 sentence diagnosis + up to 3 actionable recommendations + Top drivers list + token usage chip. Sample EN output (verified live):
> "AAC Main lost AZN 1.76M on AZN 18.6M revenue (–9.5% margin)... driven by COGS of AZN 15.79M (85% of revenue) and OpEx of AZN 4.58M (25% of revenue)."

> ✅ **AI Variance Explainer** triggered by **`EXPLAIN →` button** in Panel 3 (post-cell-click). Re-run for RU/AZ via language tabs (EN/RU/AZ) + Re-run button in Panel 4. Each call records audit_event with model + token usage (compliance trail).

**Say:**
> "Это и есть AI-augmented FP&A. Не replacing analyst — augmenting them. CFO gets the variance story in 5 seconds, not 5 hours."

**Press:** F1, F2, F3, F4 — show panel switching feels snappy.

**Drag:** A panel separator — show smooth resize.

**Click:** `▢ Layouts` button in the terminal top bar → LayoutMenu opens → save current layout as "demo-layout" → reload page → load "demo-layout" → restored.

> ⚠️ Layouts opens via top-bar button (no `LAY GO` command — that function code doesn't exist).

**Say:**
> "Persistent named layouts — каждый user can save их preferred view. Per-user, не per-org."

**Click:** `[alerts 🔔 N]` strip in command-bar (top-right). _(Phase C6 v2, sub-10)_

**Show:** AlertsPanel modal opens, listing rule-engine matches grouped by severity (critical → warning → info). Each match shows rule name + message + clickable affected-company chips. Default rule pack: 3+ red indicators per company / composite < 40 / sector amber cluster ≥ 5 / sector red spread (contagion) / IND_NET_MARGIN red for 3+ cos org-wide.

**Click:** A company chip in any match → modal closes, terminal pivots to that company.

**Say (Phase C6):**
> "Multi-indicator alert engine. Composite + sector contagion + org-wide signals. CFO sees one consolidated 'what needs attention' view, не один-за-другим cell scan."

**Say (verbal beat — Phase C6 sub-25, admin-tunable thresholds shipped 2026-04-29):**
> "And every threshold — '3+ red indicators', composite floor 40, sector contagion counts, the org-wide critical-indicator picklist — per-org tunable on `/settings`. Industrial holding wants 5 reds instead of 3? Admin opens settings, edits, saves. Audit log captures before/after — full compliance trail."

> ⚠️ **No click in v2 demo** — the /settings page is fully wired but adding a navigation beat costs ~20 sec of wall-time and the AlertRulesEditor has 5 cards × 7 fields which doesn't read in 2-3 sec. Mention verbally; if the customer probes ("can we tune?"), navigate to `/settings` as a follow-up after Step 4 completes (Q&A buffer).

**Press Escape.** _(Or click backdrop.)_

**Type:** `IRAN_HIGH SCN GO`. _(Phase C4 v1, sub-11. Seeded scenarios: `IRAN_HIGH` / `AZN_DEVAL_20` / `OIL_DROP_30` — see `scripts/seed-scenarios.ts`. Run `npx tsx scripts/seed-scenarios.ts` if SCN modal appears empty.)_

**Show:** ScenarioPanel modal opens, listing org's `Scenario` rows. Selected scenario shows JSON-pretty `overrides` blob (FX rates, commodity drops, regulatory shifts). `Apply` button POSTs → 202 queued response surfaces inline.

**Say:**
> "What-if scenario inspector. Real-time recompute under overrides ships in v2 with the BullMQ scheduler — today the queue acknowledgement validates the contract end-to-end."

**Press Escape.**

**Type:** `BRF GO`. _(Phase C3 v1, sub-12)_

**Navigate to:** `/budgeting/board-deck` opens — print-friendly snapshot for board sharing. Shows org name + period + composite scores table (per sub-co with status counts) + active alerts grouped by severity + status grid (companies × indicators tile-grid). Click "Print to PDF" for native browser save-as-PDF.

**Say:**
> "Board-ready risk snapshot. One-click PDF for shareholder packet. Server-side PDF render + AI-narrated executive summary + scheduled email delivery come in v2."

**Press:** Browser back / Sidebar → Risk Terminal.

**Type:** `AUD GO`.

**Show:** AuditModal opens with 30+ audit events DESC (verified Turn 38 sub-9 baseline = 31; will grow with each EXPLAIN/import during demo). Recent events:
- `ai_variance_explainer_run` rows with modelName + token counts (NEW Turn 38 sub-8 — Phase 7.E AI-suite trail)
- `import_staging_apply` for DEMO-CO (Step 3 above + sub-7 rehearsal)
- `import_budget_create` × ~24 (CLI imports — AAC + ATL + SPARK + ZTP + LLS + per-co re-imports)
- `company_role_change` × 3 (ATL-MRKZ admin flip + AAC restructure)

**Say:**
> "Full audit trail — каждое изменение who-what-when. Compliance-ready: 365-day retention, append-only, никто не может tamper."

**Press Escape:** modal closes.

---

### 5. Audit feed (`/budgeting/audit`) — full event drill (1.5 min)

**Click:** Sidebar → Audit Log → `/budgeting/audit`

**Show:** AuditFeed renders ~31 events (Turn 38 sub-9 baseline; will grow with demo activity) with summarizeMetadata:
- "AAC-MAIN · IND_NET_MARGIN · en · 905/253 tokens · claude-sonnet-4-5" (`ai_variance_explainer_run` — NEW Phase 7.E)
- "DEMO-CO · 2026 · 27 lines" (`import_staging_apply` from Step 3 rehearsal)
- "AAC-MAIN · 2026 · 90 lines" (`import_budget_create` from CLI)
- "ATL-MRKZ · operational → admin" (`company_role_change`)

**Click:** A row → expand to show full metadata JSON.

**Say:**
> "Filter by action, by entity, by date range, by actor. Export to CSV (coming Q3). Auditor opens this и sees full forensic trail."

**Click:** Load more (cursor pagination).

**Show:** Next page loads без перезагрузки страницы.

---

### 6. Roadmap walkthrough (3-5 min) — `docs/DEMO_ROADMAP.md`

**Switch to second tab** with roadmap slides.

**Slide 1 — "Working today":** P&L + Risk Terminal + AI Mapper + AI Variance Explainer + full Audit trail. **Phase C v1 (Apr 2026)** added on top: composite risk scores per company (0-100 badge in HeatMap row headers), multi-indicator alerts engine (5-rule default pack, click `[alerts]` strip → grouped severity view), what-if scenario inspector (`SCN <code> GO`), one-click board snapshot (`BRF GO` → print-PDF route), next-period predictive forecast in IndicatorDetail. _(Note: standalone "AI Analytics chat" surface was removed Turn 37 — only the floating per-section AIAnalyticsPanel + the per-cell Variance Explainer remain.)_

**Slide 2 — "Coming next quarter (v2 polish + AI suite expansion)":**
- AI Web Crawler — auto-pull industry benchmarks (Damodaran-class data) per sector _(C1 — vendor decision pending: NewsAPI / Reuters / RSS)_
- Predictive Analytics v2 — multi-step horizons (3-6 months) + LLM-narrated explanations + numeric confidence intervals _(C2 v2 — v1 next-period linear regression ships today)_
- Board Deck Generator v2 — server-side PDF render (puppeteer) + AI-narrated executive summary + scheduled email + PPTX export _(C3 v2 — v1 print-friendly route ships today)_
- Scenario Runner v2 — live HeatMap recompute under overrides + scenario CRUD UI _(C4 v2 — v1 inspector + queue ack ships today)_

**Slide 3 — "Coming next 6 months (architectural foundation)":**
- Composite indicators via fact()/rollup() formula functions (cross-period analysis) — Phase 7.A.0 architectural debt
- Background recompute scheduler — instant matrix at 60+ companies via BullMQ job queue (Phase 6) — unblocks C4 v2 live-recompute
- Cross-device starred sync via UserCompanyPreferences (B4 v2; today localStorage-only)
- User-configurable hotkey toolbar with drag-reorder + per-user persistence (B6 v2; today 8 fixed defaults)

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
| "Сколько компаний система выдержит?" | "AZMADE = 14 entities (8 operational + 5 sub-groups + DEMO-CO scratch sandbox). Architecture supports 60-100 sync today; beyond that we have BullMQ scheduler in the pipeline (slide 3). Hard limit будет per Postgres instance — multi-tenant SaaS solves that." |
| "Cколько стоит per company?" | "Pricing будет per-holding (group of companies), не per-company. Estimated $X/month для типичной 10-30 company group. Pilot — discounted." |
| "Что если у нас нестандартный COA?" | "AI Mapper handles unknown shapes — это что вы видели в Step 3. После 1-2 imports AI calibrates на ваших column patterns. Manual override always available." |
| "GDPR / data residency?" | "Self-hosted в вашем Azure/AWS tenant — данные never leave your infrastructure. SaaS option launches Q3, EU + Azerbaijan regions." |
| "Integration с 1C / SAP?" | "CSV / Excel import works today. 1C connector в Q3 backlog. SAP — на request." |
| "Кто видит чьи данные?" | "Per-org isolation enforced at app + (coming) database (RLS) layer. Within org — role-based: admin / manager / editor / viewer with audit trail of every access." |
| "А если интернет пропадёт?" | "Self-hosted — works offline-LAN. SaaS — same Anthropic dependency для AI features (graceful degradation: matrix + audit work без AI; chat + variance explainer require connectivity)." |
| "Можем ли мы настроить пороги для алертов?" / "Can we tune the alert thresholds?" | "Yes — `/settings` page (admin-only). Each rule has its threshold editable: minimum red count, composite floor, sector-cluster cutoffs, the org-wide critical-indicator picklist. Save → audit log captures before/after. Per-sector overrides + email digest scheduling — v3, в backlog. _(Phase C6 sub-25, shipped 2026-04-29.)_" |

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
| Anthropic API down | Skip Step 2 (Variance Explainer EXPLAIN) и Step 3 /analyze upload; lean harder on HeatMap visual + AuditModal which work without LLM |
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

## Performance baseline (Turn 38 sub-12, Apr 27)

Measured via Chrome DevTools `performance.timing` API on dev server (LaunchAgent Next 16). All pages **< 600ms total load**:

| Page | pageTotal | DCL | slowest API |
|---|---|---|---|
| `/budgeting?tab=pnl-report` | **264ms** | **161ms** | /lines/count = 25ms / 0 KB (Turn-38-sub12 perf fix; was 504/386 with 4.3 MB prefetch) |
| `/budgeting/terminal` | 228ms | 173ms | /matrix = 67ms / 21 KB |
| `/budgeting/audit` | 335ms | 281ms | /audit/events?limit=50 = 67ms / 15 KB |

Demo will feel snappy. /availability cache hits in 1-3ms (Turn-33 Cache-Control: max-age=30 working). /matrix fires twice on terminal (Turn-32 IND fire-and-forget; non-blocking, both <100ms).

If demo machine is slower than dev box, expect 2-3× these timings — still well under 2 sec everywhere.

## Day-5 morning checklist (run BEFORE customer arrives)

```bash
bash scripts/pre-demo-check.sh
```

Expected: 13/13 ✓ "DEMO GO". Exit non-zero = P0 fix before demo. Re-run after each fix until green.

**ADDITIONALLY before live demo (DEMO-CO state):**

If Loom backup was recorded Day-4 (which uploads to DEMO-CO), the live
demo Step 3 will re-upload to the same DEMO-CO. The `/apply` route
uses REPLACE semantics (deleteMany before insert, scoped to plan+
company), so the second upload overwrites cleanly — but to be safe, the
checklist below regenerates a fresh xlsx fixture:

```bash
npx tsx scripts/seed-demo-co.ts  # regenerates ~/Downloads/DEMO-CO.xlsx + resets DB co
```

This avoids a stale-state surprise if the recompute or audit-event
counts shift between Day-4 recording and Friday demo.

## Day-5 dry-run rubric

Mark each step pass/fail:
- [ ] Step 1: P&L renders, EBITDA card 25.0M, Management/Bookkeeping toggle works, AAC-MAIN drill = 19M Net Rev / 17% margin / 1.5M EBITDA
- [ ] Step 2: Variance Explainer EXPLAIN responds EN within 12-15 sec; RU tab + Re-run within 15-18 sec
- [ ] Step 3: analyze ~35 sec → 14-column mapping → Apply → "INSERTED 27 / 5 indicators" + audit_event fires
- [ ] Step 4: HeatMap 24g/25a/18r=67 colored + composite badges per row (Phase C5); IndicatorDetail populates with sparkline + forecast (Phase C2); 10 verbs dispatch (HOLD/GRP/CO/IND/SEC/CMP/ALT/SCN/BRF/AUD); SCN GO opens ScenarioPanel (C4); BRF GO opens /budgeting/board-deck (C3); `[alerts N]` strip click opens AlertsPanel (C6 v1) + verbal mention of `/settings` admin-tunable thresholds (C6 sub-25); F1-F4 snappy, drag smooth; AUD GO opens modal with ai_variance_explainer_run rows visible
- [ ] Step 5: AuditFeed paginates, expand row works
- [ ] Step 6: roadmap slides render
- [ ] Total wall-time: 16-22 min (Step 4 grew 6 → 7-7.5 min for Phase C v1 beats; on slow takes apply cut-priority: BRF → SCN → AlertsPanel)

If any step fails Day-5 morning → P0 fix that day → re-run dry-run afternoon. If still failing Thursday evening → trigger fallback plan (skip that step in demo OR use Loom segment).
