# BudgetPro — User Guide

> **Enterprise Holding Risk Terminal**
> What it is, how to use it, what and where to check.
> For the client, CFO, and holding administrator.

---

## Table of Contents

1. [What it is and why](#1-what-it-is-and-why)
2. [Login and navigation](#2-login-and-navigation)
3. [Risk Terminal — the finance professional's workday](#3-risk-terminal--the-finance-professionals-workday)
4. [Board Deck — snapshot for the board](#4-board-deck--snapshot-for-the-board)
5. [Budgeting](#5-budgeting)
6. [Onboarding a new company](#6-onboarding-a-new-company)
7. [Admin Tools — 16 tools in 4 groups](#7-admin-tools--16-tools-in-4-groups)
8. [AI Auto Import — import any Excel](#8-ai-auto-import--import-any-excel)
9. [Risk Registry — qualitative risk flags](#9-risk-registry--qualitative-risk-flags)
   - [9.1 Compliance & Legal — real indicators](#91-compliance--legal--real-indicators-from-audit-reports-and-courts)
10. [AI features — what, where, how much it costs](#10-ai-features--what-where-how-much-it-costs)
11. [Audit log](#11-audit-log)
12. [Self-check checklist](#12-self-check-checklist)

---

## 1. What it is and why

**BudgetPro is a terminal for the CFO of a holding with 60+ companies.**

One goal: understand in 5 minutes each morning **which of your companies are currently at risk**, **why**, and **what to do about it**.

### Three levels of questions the system answers

| Question | Where to look | Time required |
|---|---|---|
| "What's on fire today?" | **Risk Terminal** — HeatMap + Morning Brief | 30 seconds |
| "Why is this indicator red?" | **Variance Explainer** (click cell → Explain) | 10 seconds + ~15 seconds AI |
| "What should I show the board of directors?" | **Board Deck** — PDF/PPTX in one click | 20 seconds |

### What's inside
- **6 live entities** of the AZSEKER holding (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + parent)
- **47 indicators** (P&L, Balance Sheet, Cash Flow, KPI, ESG, operational)
- **AI agents** on Anthropic Claude: Excel classifier, variance explainer, Board Deck generator, morning briefing
- **Full audit trail** — every change is written to an IFRS-compliant journal for 365 days

---

## 2. Login and navigation

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) or your production domain.

![Login](guide/screenshots/01-login.png)

Credentials are provided by the system administrator. If you are that administrator and just deployed the environment — the password is from `scripts/create-admin.ts` or from your deployment secrets.

> 🔒 Passwords are not published in open documentation.

### 2.2 Sidebar navigation

After login, on the left — 6 main sections:

| Icon | Section | Purpose |
|---|---|---|
| 📊 | **Budgeting** | Plan/actual, P&L, BS, CF — traditional FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-style terminal — main screen of the day |
| 📋 | **Board Deck** | Snapshot for the board of directors (print / PPTX / PDF) |
| 🚀 | **Onboarding** | Companies readiness + import new ones via AI |
| 📜 | **Audit Log** | Log of all significant changes |
| 🛠️ | **Admin Tools** | 16 utilities in 4 groups |
| ⚙️ | **Settings** | Profile + language + preferences |

---

## 3. Risk Terminal — the finance professional's workday

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.png)

This is **the main screen**. Open it in the morning — everything you need is here.

### Four panels

#### Panel 1 · Company Tree (top left)
Tree of all holding companies with **composite-score** badge for each:
- 🟢 **green %** — composite score (0-100)
- 🔴 **R##** — number of red indicators
- **Chips:** `Sub` / `Opq` / `NoD` — qualitative risk flags (see section 9)

**What to check:** click on a company → right HeatMap filters to that company.

#### Panel 2 · Risk HeatMap (top right)
**Matrix: companies × indicators.** Cell color = status (green/amber/red/n/a).

Each cell is marked not only by color, but also by **shape** (▲ / ● / ○) — for clinical color-blind safety (Phase M7 regression scan prohibits rollback).

At the top:
- Quarter filter (2026 / Q1...Q4 / M1...M12)
- `Material only` — hide non-applicable indicators
- Counter: `54G / 30A / 16R / 88?`

**What to check:** hover over a cell → tooltip with number + planned range.

#### Panel 3 · Indicator Detail (bottom left)
By default shows **"Today's brief"** — morning AI briefing.

When clicking on a HeatMap cell, turns into **indicator detail:**
- Formula (`counterparty_hhi_customer`)
- Resolved variables
- Source rows from BudgetLine
- Buttons: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (bottom right)
- By default: hint "Pick a HeatMap cell, then click Explain →"
- After clicking on a company: **Company Snapshot** (top alerts + breakdown)
- After clicking `Explain →`: **AI Variance Explainer** — narrative + 3 recommendations

### What to check in 60 seconds
1. Expand AZSEKER tree → should be 7 sub-cos with composite-score
2. Click on a red cell → Panel 3 shows formula, Panel 4 — Explain button
3. Press Explain → in ~15 seconds narrative with TOP DRIVERS and RECOMMENDATIONS appears
4. At the bottom — EVENTS feed (recent LLM calls) and MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — snapshot for the board

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.png)

**Goal:** one-page document for the board of directors. Open → read → click "Print to PDF" → send to chat.

### What's in it
1. **Title narrative** — AI generates one phrase like *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"*
2. **Holding composite score** — large number
3. **Top movers** — who is above/below plan the most
4. **Alerts** — critical threshold violations
5. **🆕 Qualitative Risk Flags** — section with companies that have qualitative risk flags

### Screenshot of qualitative risks section (bottom of page)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.png)

Here you can see:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

These flags **automatically reduce the company's composite score** and appear in the morning briefing (see section 9).

### Export buttons
- `Export PPTX` — byte-for-byte identical PowerPoint presentation
- `Export PDF` — PDF via server-side render
- `Print to PDF` — browser print
- `Open Risk Terminal →` — go to live terminal for drill-down

---

## 5. Budgeting

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.png)

**This is the "regular" FP&A workspace** — what the finance professional used to do in Excel, now does here.

### Left sidebar — work structure

**FINANCE** — three classic reports:
- 📈 **P&L** — profit and loss statement
- 💰 **Sales** — sales detail
- 📑 **Balance Sheet** — balance sheet
- 💸 **Cash Flow** — cash flow
- 📐 **Assumptions** — model assumptions

**PLANNING** — what we plan:
- 🗂️ **Workspace** — main budget screen (in screenshot)
- 📊 **P&L (Plan)** — plan in P&L format
- 🔮 **Forecast** — forecast
- ⚖️ **Comparison** — plan vs actual vs forecast
- 📅 **Plans** — list of all plans

**ANALYTICS** — Report Builder for arbitrary slices.

**SETTINGS** — Import / Configuration.

**ADMIN** — deep settings (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← Risk Registry here**).

### What's on the main Workspace screen
- 4 KPI cards at the top: **Revenues / COGS / Expenses / Operating Profit** with execution % and variance
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — 85% donut / 65% composite score
- **Plan/Forecast/Actual by category** — detailed table

### What to check
1. At the top right of the title — plan selector (`Azərşəkər 2026 Budget — 2026`) and companies (`All companies (consolidated)`)
2. `+ Create plan` button — creates new plan
3. Bottom right — `AI Analysis` button (purple)

---

## 6. Onboarding a new company

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.png)

**Goal:** show data input progress for each holding company and help complete "empty" sections.

### What you see
- **Company cards** with level (LEVEL 1 = parent, LEVEL 2 = sub-co)
- **Readiness percentage** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Color highlighting:** green CPC (90%), purple — selected for drill-down

### What's shown in our demo
| Code | Name | Industry | Readiness | Status |
|---|---|---|---|---|
| AZSEKER | Azərşəkər | food_processing | 100% | ✅ VERIFIED |
| AZSEKER-MALT | Malt | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-EDEN | Eden Agro | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-AZSF | Azərşəkər Sugar | food_processing | 90% | ✅ VERIFIED |
| AZSEKER-HORIZON | Horizon | services | 80% | ✅ VERIFIED |
| AZSEKER-FARM | Farm | agro_crops | 90% | ✅ VERIFIED |
| AZSEKER-PROMALT | Promalt MMC | food_processing | 30% | ⏳ PENDING |
| AZSEKER-CPC | CPC | food_processing | 90% | ✅ VERIFIED |

**What to check:** click on a card → detail expands showing which sections (P&L / BS / CF / KPI / Descriptions / Land / CAPEX) are filled and which need to be completed.

---

## 7. Admin Tools — 16 tools in 4 groups

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.png)

**This is the "engineering panel"** — what to use **before client demo** and for day-to-day support.

### Four groups

#### 🧪 Data Ingestion
| Card | What it does |
|---|---|
| **Data Import** `Phase 7.M Tier 7` | Drag-drop any xlsx → AI determines sheet type (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) and routes to the correct adapter. One screen instead of 5 different forms. |
| **Data Entry** | Manual KPI and ESG disclosures entry for non-engineer admin. |
| **Data Sources Catalog** | Client-facing list of external feeds: business value, sample value, dependencies. |
| **Source Registry** | Drift-watchdog: list of allowed xlsx sources for ingest. |

#### 🩺 Data Quality
| Card | What it does |
|---|---|
| **Indicator Health** `Phase 7.M` | Per-indicator green/amber/red/unknown with remediation guidance. Use **before** client demo. |
| **Drift Dashboard** | Recent drift events + reference-feed freshness + stalled onboarding cases. |
| **Companies Readiness** | Per-entity 7-area scoring with tiers (complete/good/partial/thin/empty). CSV export. |
| **Data Archive** | Self-service archive + restore: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | External feed adapter status + recent crawls + news pipeline diagnostics. |

#### 🔒 Operations
- **Period Locks** — closing closed periods from mutations
- **Approvals** — workflow for change approvals
- **AI Usage** — LLM expense monitoring with 30-day trend

#### 👥 Access
- **User Access** — user and role management
- **API Keys** — machine keys for external integrations

### 7.1 Indicator Health — must-check before demo

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.png)

**At the top:** counters
- 🟢 GREEN: 258 (21.5%)
- 🟡 AMBER: 193
- 🔴 RED: 73
- ⚪ UNKNOWN: 677 (43.6% computed out of 1201 total IVs)

**Unknown breakdown by error code:**
- `eval: 430` — formulas failed
- `non_finite: 123` — division by zero / NaN
- `no_budget_lines: 64` — no sources in P&L
- `no_foreign_currency_lines: 35`
- `rollup_no_children: 22`
- `parse: 2`
- `out_of_range: 1`

**At the bottom:** list of specific indicators with issues + remediation in one line.

**What to check before demo:**
1. **AGRO_COMMODITY_VOL** → 75 cells, need to investigate
2. **FP_INVENTORY_TURNS** → 49 cells, need `inventory` in BS
3. **FP_YIELD_LOSS** → 49 cells, need `raw_input` in production KPI
4. **AGRO_DROUGHT_RISK** → 37 cells, need `drought_index` per entity

### 7.2 Companies Readiness — readiness grid

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.png)

Per-entity scoring across 7 areas: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Columns:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — what needs to be added to raise tier

**On screenshot:**
- HORIZON 15% Thin → need P&L (budget lines), balance sheet, counterparties
- PROMALT 25% Thin → same
- MALT 65% Good → need operational KPIs, strategic narrative, FX tags
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** button copies gap-list for email.

### 7.3 Data Archive — soft-delete with restore

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.png)

**Why:** made an import mistake → need to remove rows from calculation, **but not physically delete** for IFRS audit.

**How it works:**
- Archiving hides data from HeatMap, recompute, reports
- Data is physically **not deleted** — restore is possible within **90 days**
- All actions are written to audit trail
- After 90 days — daily cron `soft-delete-purge` physically deletes

**Form:**
- **Action:** Archive / Restore
- **Type:** P&L / BS / CF / Counterparty
- **Company + Year**
- **Reason** (goes to audit log)
- **Confirmation:** enter `ALL` to exclude typo

---

## 8. AI Auto Import — import any Excel

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.png)

**This is the manual mapping killer.** Before Phase 7.M Tier 7, each new xlsx required code. Now:

### How it works (5 phases)
1. **AI Classifier** (Anthropic) — determines sheet dataType: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — selects correct adapter from registry (11 dataTypes)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — each import is reconciled with source
5. **GREEN verdict** — no discrepancies or you see diff

### Two modes
- **`1 file`** — standard, for one workbook
- **`Multiple files`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - 1-10 files simultaneously
  - **Group-level atomicity** — either all groups write or none
  - **Cross-file conflict detection** — if two files write different values to same cell → 409 with diff
  - One recompute after all groups (instead of N)

### What to check
1. Drag-drop any xlsx into zone `Drop xlsx file here`
2. Click `Step 1: AI sheet analysis`
3. AI returns classification + suggests import plan
4. Confirm → file imports → automatic recompute

### Limits
- Single file: ≤ 20 MB
- Multi file: ≤ 10 files, ≤ 20 MB total
- Rate limit: 3 multi-file imports/hour/org
- Cost cap: checked in advance (N × 35K tokens)

---

## 9. Risk Registry — qualitative risk flags

**URL:** `/budgeting/admin/companies` → **"Company Settings"** section → expand company card

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.png)

**This is the newest feature (Phase 7.N, May 2026).** Qualitative financial-operational risks that HeatMap doesn't show quantitatively.

### Three canonical flags

| Flag | Emoji | What it means | Composite penalty |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Revenue or margin substantially depends on subsidies or regulated prices | **−5** |
| `non_transparent_structure` | 🛡 | Related-party or unaudited cost-allocation pattern | **−8** |
| `data_absence` | ⚪ | Key financial or operational data is absent | **−12** |

### How to set
1. `/budgeting/admin/companies`
2. **"Company Settings"** section (bottom of page)
3. Expand company card (e.g., AZSEKER-EDEN)
4. Find **"Risk Registry"** — sorted by 8 categories with severity dots `● ● ●` (emerald → amber → rose)
5. Click on needed flag — it highlights, penalty applies after save

### Where these flags appear (4 channels, tested end-to-end)

| Channel | Where you'll see |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (chips `Sub` / `Opq` / `NoD` next to name) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (phrases like *"exposure to government policy/subsidy regime"*) |
| **Board Deck section** | Board Deck → **"Qualitative Risk Flags"** section with FLAGGED ENTITIES count |
| **Variance Explainer** | Risk Terminal → click cell → Explain → recommendation #3 cites flag |

### Current DB state
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **−20 to composite**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

---

## 9.1 Compliance & Legal — real indicators from audit reports and courts

**Where:** Risk Terminal → HeatMap (3 new columns) + Board Deck → "Compliance" section

Three new indicators, fed by client files (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | What it measures | Green | Amber | Red |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | % of closed audit findings (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Open **Major** audit findings | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Active court cases | ≤ 2 | 3–9 | ≥ 10 |

### What's currently in DB (live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ no data | ⚪ no data | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ no data in client files | | |

### Where it comes from

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — client's internal audit journal: 218 findings (Major / Minor / Observation / OFI). AZSF = 159 findings (51% closed, 6 Major open). CPC = 59 findings (39% closed, 3 Major open). Full list available via `Company.settings.auditFindings` for drill-down.
- **LEGAL_CASES_ACTIVE** — registry of open court cases: 54 cases. AZSF — defendant in 26 (29 open). CPC — defendant in 7 (8 open). EDEN — plaintiff only (4 open). Full registry in `Company.settings.courtDisputes`.

### What to check
- In HeatMap 3 new columns appeared (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- Click on red cell AZSF/AUDIT_MAJOR_OPEN → Variance Explainer should cite open Major findings in narrative
- Board Deck → "Critical alerts" section now contains compliance/legal warnings

---

## 10. AI features — what, where, how much it costs

All LLM calls go to **Anthropic Claude** via server-side API (cost mode + retry policy).

### 10.1 Morning Brief

**Where:** Risk Terminal → Panel 3 → "Today's Brief" section

**What it does:** in one phrase describes the risk cluster of the day + lists "top worst" by sectors. Takes into account qualitative risk flags.

**Example output (live, from DB):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Languages:** EN / RU / AZ (switcher in top right corner of panel).

**How cache works:** sha256 of prompt text + dataset hash. Change prompt → old cache invalidated automatically.

### 10.2 Variance Explainer

**Where:** Risk Terminal → click HeatMap cell → `Explain →` button

![Variance Explainer](guide/screenshots/13-variance-explainer.png)

**What it does:** narrative (1-3 sentences) + 3 actionable recommendations + TOP DRIVERS list.

**Example output for EDEN Customer HHI:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Note — recommendation #3 cites the `subsidy_dependency` risk flag from the Risk Registry page.

**Cost:** ~1200 in + ~240 out tokens per call (~ $0.01).

### 10.3 Board Deck Narration

**Where:** automatically generated when opening Board Deck.

**What it does:** turns quantitative signals into one title phrase like *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"*.

Cached on (orgId, period) — one call per hour maximum.

### 10.4 AI Auto Import Classifier

**Where:** Admin → AI Auto Import → drag-drop file.

**What it does:** smart-routing for any xlsx. Costs ~$0.13 per full workbook (23 sheets / 14 entities in test). No new adapters needed — AI itself determines type and selects correct pipeline.

---

## 11. Audit log

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.png)

**Goal:** IFRS-compliant journal of all significant changes. Stored for 365 days.

### What gets logged
- All imports (filename, rows changed, status)
- All mapper applies
- Role changes
- Indicator overrides
- LLM calls (model, prompt version, tokens, fromCache)
- **Soft-delete and physical purge** (Phase 1.4 cron)

### Filters
- **Action** — event type
- **Entity type** — Organization / Company / IndicatorValue / ChartOfAccount
- **From / To** — date range
- **Buttons:** Apply / Reset

### What to check
- Table shows `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run` entries
- ACTOR column — `Admin` for manual actions
- SUMMARY contains JSON with `model`, `inputTokens`, `outputTokens`, `language`, `fromCache`
- Entries sorted newest first

---

## 12. Self-check checklist

Go through this list **now**, clicking in the live application. If something doesn't match — there's a bug somewhere, fix needs to be queued.

### Basic navigation
- [ ] `/login` → log in with admin credentials → redirect to `/budgeting`
- [ ] Sidebar shows 6 items: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Theme switcher (sun/moon) in top right corner works

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER tree expands, 7 sub-cos visible with composite-score (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: next to EDEN `Sub` label visible, next to AZSF — `Opq` + `NoD`
- [ ] Panel 2: HeatMap shows 3 AZSEKER-* rows (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: "Today's brief" loads, text contains mentions of "subsidy-regime" or "non-transparent" (this is AI Morning Brief with risk flags)
- [ ] Click on red cell EDEN row, CUSTOMER_HHI column → Panel 3 shows formula `counterparty_hhi_customer`
- [ ] Click `Explain →` → in ~15s narrative + 3 recommendations appear
- [ ] In recommendation #3 phrase with **subsidy dependency** (or related) is cited

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI title present (something like "Food processing margin squeeze...")
- [ ] Holding composite score = **59** (at time of writing)
- [ ] Scroll down → **"Qualitative Risk Flags"** section visible
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN card → `Subsidy dependency` chip (amber)
- [ ] AZSEKER-AZSF card → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC card → `Subsidy dependency` + `Non-transparent structure`
- [ ] Buttons `Export PPTX`, `Export PDF`, `Print to PDF` present

### Budgeting (`/budgeting`)
- [ ] 4 KPI cards at top (Revenues / COGS / Expenses / Operating Profit)
- [ ] Waterfall chart with tooltip on hover (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan selector `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder works

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity cards: AZSEKER (100%) + 7 sub-cos
- [ ] PROMALT MMC = 30% PENDING — only one with PENDING
- [ ] Rest ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Landing shows 16 cards in 4 groups
- [ ] Cards `Data Import` and `Indicator Health` marked with `Phase 7 M` badge
- [ ] All cards are clickable

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] Two tabs: `1 file` / `Multiple files` (new one marked `new`)
- [ ] Drop-zone present
- [ ] Button `Step 1: AI sheet analysis` present

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Summary: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Breakdown by error code visible
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] Table of 6 entities sorted by Score asc (worst first)
- [ ] HORIZON and PROMALT MMC at bottom with Thin tier
- [ ] `Export CSV` button works

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Form with fields Action / Data type / Company / Year / Reason / `ALL` confirmation
- [ ] Radio `Archive (hide from calculations)` selected by default

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] At top Role & Status table with 8 entities
- [ ] At bottom "Company Settings" with expandable cards
- [ ] Inside EDEN card — **Risk Registry** section with 8 categories
- [ ] Categories: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Severity shown with dots `● ● ●` (emerald / amber / rose)

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] In HeatMap there are columns `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE`
- [ ] AZSF — all 3 cells **red** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 cases, all as plaintiff)
- [ ] Click on red cell AZSF/AUDIT_MAJOR_OPEN → Variance Explainer cites Major findings

### Audit Log (`/budgeting/audit`)
- [ ] Event table, newest first
- [ ] Entries `ai_morning_brief_run`, `ai_variance_explainer_run` present
- [ ] SUMMARY contains JSON with tokens + language + fromCache

### AI calls (via Audit Log)
- [ ] At least one `ai_variance_explainer_run` in last 24 hours
- [ ] `ai_morning_brief_run` present for today
- [ ] `ai_board_deck_narration_run` present (generated when opening Board Deck)
- [ ] `fromCache: true` for repeated requests with same parameters

---

## Where to go if something breaks

| Symptom | Where to look |
|---|---|
| Composite score not recalculated | `Risk Terminal → Recompute` button |
| AI brief is old | Audit Log → find last `ai_morning_brief_run` → check `fromCache` |
| HeatMap empty | `Indicator Health` → check UNKNOWN breakdown |
| Import failed | `Admin → Drift Dashboard` → recent events |
| Need to roll back import | `Admin → Data Archive` → select data type + year + reason → ALL |
| Accidentally locked period | `Admin → Period Locks` → unlock + audit |

---

## Technical details for reviewer

- **Stack:** Next.js 16 (Turbopack) + Prisma 6.19 + PostgreSQL 16 + Redis (BullMQ)
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` with serverside caching
- **Auth:** NextAuth credentials provider (`/login`)
- **Dev server:** LaunchAgent on port 3000 (`launchctl kickstart -k gui/501/com.budgetpro.dev`)
- **Tests:** `npx vitest run` (5042 passing) + `npx tsc --noEmit` (CI gate)
- **Pre-commit:** M7 status-band scanner + secret scanner (~150ms)
- **Migration policy:** all migrations via Prisma + audit; soft-delete with 90-day physical purge cron
- **Cost guard rails:** rate-limits + token budgets + LLM kill switch in env

---

> Document generated May 26, 2026, after closing Phase 7.N (risk flags in all 4 channels).
> Screenshot source: live dev environment, headless Playwright 1.59.1, viewport 1600×900 @2x.
