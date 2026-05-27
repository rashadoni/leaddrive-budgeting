# BudgetPro — User Guide

> **Enterprise Holding Risk Terminal**
> What it is, how to use it, what and where to check.
> For the client, CFO, and holding administrator.

---

## Table of Contents

1. [What This Is and Why](#1-what-this-is-and-why)
2. [Login and Navigation](#2-login-and-navigation)
3. [Risk Terminal — Daily Workflow for Finance Teams](#3-risk-terminal--daily-workflow-for-finance-teams)
4. [Board Deck — Snapshot for the Board](#4-board-deck--snapshot-for-the-board)
5. [Budgeting](#5-budgeting)
6. [Onboarding a New Company](#6-onboarding-a-new-company)
7. [Admin Tools — 16 Tools in 4 Groups](#7-admin-tools--16-tools-in-4-groups)
8. [AI Auto Import — Import Any Excel](#8-ai-auto-import--import-any-excel)
9. [Risk Registry — Qualitative Risk Flags](#9-risk-registry--qualitative-risk-flags)
   - [9.1 Compliance & Legal — Real Indicators](#91-compliance--legal--real-indicators-from-audit-reports-and-courts)
   - [9.2 Concentration — Who Controls Your Revenue](#92-concentration--who-controls-your-revenue)
10. [AI Features — What, Where, How Much](#10-ai-features--what-where-how-much)
11. [Audit Log](#11-audit-log)
12. [Self-Check Checklist](#12-self-check-checklist)

---

## 1. What This Is and Why

**BudgetPro is a terminal for the CFO of a holding with 60+ companies.**

One goal: understand in 5 minutes each morning **which of your companies are currently at risk**, **why**, and **what to do about it**.

### Three Levels of Questions the System Answers

| Question | Where to Look | Time Required |
|---|---|---|
| "What's on fire today?" | **Risk Terminal** — HeatMap + Morning Brief | 30 seconds |
| "Why is this indicator red?" | **Variance Explainer** (click cell → Explain) | 10 seconds + ~15 seconds AI |
| "What should I show the board of directors?" | **Board Deck** — PDF/PPTX in one click | 20 seconds |

### What's Inside
- **6 live entities** of AZSEKER holding (Sugar / Eden Agro / CPC / Malt / Horizon / Farm / Promalt MMC + parent)
- **47 indicators** (P&L, Balance Sheet, Cash Flow, KPI, ESG, operational)
- **AI agents** on Anthropic Claude: Excel classifier, variance explainer, Board Deck generator, morning briefing
- **Complete audit trail** — every change is logged in an IFRS-compatible journal for 365 days

---

## 2. Login and Navigation

### 2.1 Login

URL: **`http://localhost:3000/login`** (dev) or your production domain.

![Login](guide/screenshots/01-login.webp)

Credentials are issued by the system administrator. If you are that administrator and have just deployed the environment — the password is from `scripts/create-admin.ts` or from your deployment secrets.

> 🔒 Passwords are not published in open documentation.

### 2.2 Side Navigation

After login, there are 6 main sections on the left:

| Icon | Section | Purpose |
|---|---|---|
| 📊 | **Budgeting** | Plan/actual, P&L, BS, CF — traditional FP&A |
| 🎯 | **Risk Terminal** | Bloomberg-style terminal — main screen of the day |
| 📋 | **Board Deck** | Snapshot for board of directors (print / PPTX / PDF) |
| 🚀 | **Onboarding** | Company readiness + import new ones via AI |
| 📜 | **Audit Log** | Log of all significant changes |
| 🛠️ | **Admin Tools** | 16 utilities in 4 groups |
| ⚙️ | **Settings** | Profile + language + preferences |

---

## 3. Risk Terminal — Daily Workflow for Finance Teams

**URL:** `/budgeting/terminal`

![Risk Terminal](guide/screenshots/02-terminal.webp)

This is the **main screen**. Open it in the morning — everything you need is here.

### Four Panels

#### Panel 1 · Company Tree (top left)
Tree of all holding companies with a **composite-score** badge for each:
- 🟢 **green %** — composite score (0-100)
- 🔴 **R##** — number of red indicators
- **Chips:** `Sub` / `Opq` / `NoD` — qualitative risk flags (see section 9)

**What to check:** click on a company → the HeatMap on the right filters to that company.

#### Panel 2 · Risk HeatMap (top right)
**Matrix: companies × indicators.** Cell color = status (green/amber/red/n/a).

Each cell is marked not only by color but also by **shape** (▲ / ● / ○) — for clinical color-blind safety (Phase M7 regression scan prohibits rollback).

At the top:
- Quarter filter (2026 / Q1...Q4 / M1...M12)
- `Material only` — hide non-applicable indicators
- Counter: `54G / 30A / 16R / 88?`

**What to check:** hover over a cell → tooltip with number + planned range.

#### Panel 3 · Indicator Detail (bottom left)
By default shows **"Today's brief"** — morning AI briefing.

When clicking on a HeatMap cell, it transforms into **indicator detail:**
- Formula (`counterparty_hhi_customer`)
- Resolved variables
- Source rows from BudgetLine
- Buttons: `Discuss` / `Benchmark` / **`Explain →`**

#### Panel 4 · Company Snapshot / Variance Explainer (bottom right)
- By default: hint "Pick a HeatMap cell, then click Explain →"
- After clicking on a company: **Company Snapshot** (top alerts + breakdown)
- After clicking `Explain →`: **AI Variance Explainer** — narrative + 3 recommendations

### What to Check in 60 Seconds
1. Expand AZSEKER tree → should show 7 sub-cos with composite-score
2. Click on a red cell → Panel 3 shows formula, Panel 4 — Explain button
3. Press Explain → in ~15 seconds a narrative appears with TOP DRIVERS and RECOMMENDATIONS
4. At the bottom — EVENTS feed (recent LLM calls) and MARKET (USD/AZN, EUR/AZN, Brent)

---

## 4. Board Deck — Snapshot for the Board

**URL:** `/budgeting/board-deck?period=2026`

![Board Deck](guide/screenshots/03-board-deck.webp)

**Purpose:** one-page document for the board of directors. Open → read → press "Print to PDF" → send to chat.

### What's in It
1. **Narrative headline** — AI generates one phrase like *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"*
2. **Holding composite score** — large number
3. **Top movers** — who is above/below plan the most
4. **Alerts** — critical threshold violations
5. **🆕 Qualitative Risk Flags** — section with companies that have qualitative risk flags

### Screenshot of Qualitative Risks Section (bottom of page)

![Board Deck Risk Flags](guide/screenshots/14-board-deck-risk-flags.webp)

Here you can see:
- **AZSEKER-EDEN** Eden Agro — `Subsidy dependency`
- **AZSEKER-AZSF** Azərşəkər Sugar — `Non-transparent structure` + `Data absence`
- **AZSEKER-CPC** CPC — `Subsidy dependency` + `Non-transparent structure`

These flags **automatically reduce the company's composite score** and appear in the morning briefing (see section 9).

### Export Buttons
- `Export PPTX` — byte-for-byte identical PowerPoint presentation
- `Export PDF` — PDF via server-side rendering
- `Print to PDF` — browser printing
- `Open Risk Terminal →` — navigate to live terminal for drill-down

---

## 5. Budgeting

**URL:** `/budgeting`

![Budgeting](guide/screenshots/04-budgeting.webp)

**This is the "regular" FP&A workspace** — what the finance professional used to do in Excel is now done here.

### Left Sidebar — Work Structure

**FINANCE** — three classic reports:
- 📈 **P&L** — profit and loss statement
- 💰 **Sales** — sales breakdown
- 📑 **Balance Sheet** — balance sheet
- 💸 **Cash Flow** — cash flow statement
- 📐 **Assumptions** — model assumptions

**PLANNING** — what we plan:
- 🗂️ **Workspace** — main budget screen (in screenshot)
- 📊 **P&L (Plan)** — plan in P&L format
- 🔮 **Forecast** — forecast
- ⚖️ **Comparison** — plan vs actual vs forecast
- 📅 **Plans** — list of all plans

**ANALYTICS** — Report Builder for arbitrary slicing.

**SETTINGS** — Import / Configuration.

**ADMIN** — deep settings (Period Locks, Approvals, Chart of Accounts, User Access, Drift Dashboard, Source Registry, Data Sources, **Company Settings ← Risk Registry is here**).

### What's on the Main Workspace Screen
- 4 KPI cards at the top: **Revenues / COGS / Expenses / Operating Profit** with execution % and variance
- **Waterfall analysis** — Budget → Forecast → Actual → Variance → Projection
- **Budget execution** — donut 85% / 65% composite score
- **Plan/Forecast/Actual by category** — detailed table

### What to Check
1. Top right of the title — plan selector (`Azərşəkər 2026 Budget — 2026`) and companies (`All companies (consolidated)`)
2. `+ Create plan` button — creates a new plan
3. Bottom right — `AI Analysis` button (purple)

---

## 6. Onboarding a New Company

**URL:** `/budgeting/onboarding`

![Onboarding](guide/screenshots/11-onboarding.webp)

**Purpose:** show data entry progress for each holding company and help complete "empty" sections.

### What's Visible
- **Company cards** with level (LEVEL 1 = parent, LEVEL 2 = sub-co)
- **Readiness percentage** + status: `VERIFIED` (>90%), `PENDING` (<90%)
- **Color highlighting:** green CPC (90%), purple — selected for drill-down

### What's Shown in Our Demo
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

## 7. Admin Tools — 16 Tools in 4 Groups

**URL:** `/budgeting/admin`

![Admin Tools landing](guide/screenshots/05-admin-landing.webp)

**This is the "engineering panel"** — what to use **before client demos** and for day-to-day support.

### Four Groups

#### 🧪 Data Ingestion
| Card | What It Does |
|---|---|
| **Data Import** `Phase 7.M Tier 7` | Drag-drop any xlsx → AI determines type (P&L/BS/CF/KPI/Land/CAPEX/Descriptions/Forecast) and routes to the correct adapter. One screen instead of 5 different forms. |
| **Data Entry** | Manual entry of KPIs and ESG disclosures for non-engineer admin. |
| **Data Sources Catalog** | Client-facing list of external feeds: business value, sample value, dependencies. |
| **Source Registry** | Drift-watchdog: list of allowed xlsx sources for ingest. |

#### 🩺 Data Quality
| Card | What It Does |
|---|---|
| **Indicator Health** `Phase 7.M` | Per-indicator green/amber/red/unknown with remediation guidance. Use **before** client demos. |
| **Drift Dashboard** | Recent drift events + reference-feed freshness + stalled onboarding cases. |
| **Companies Readiness** | Per-entity 7-area scoring with tiers (complete/good/partial/thin/empty). CSV export. |
| **Data Archive** | Self-service archive + restore: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty. |
| **Intel Health** | External feed adapter status + recent crawls + news pipeline diagnostics. |

#### 🔒 Operations
- **Period Locks** — closing locked periods from mutations
- **Approvals** — workflow for change approvals
- **AI Usage** — LLM cost monitoring with 30-day trend

#### 👥 Access
- **User Access** — user and role management
- **API Keys** — machine keys for external integrations

### 7.1 Indicator Health — Must-Check Before Demo

**URL:** `/budgeting/admin/indicator-health`

![Indicator Health](guide/screenshots/09-indicator-health.webp)

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

**At the bottom:** list of specific indicators with issues + one-line remediation.

**What to check before demo:**
1. **AGRO_COMMODITY_VOL** → 75 cells, need to investigate
2. **FP_INVENTORY_TURNS** → 49 cells, need `inventory` in BS
3. **FP_YIELD_LOSS** → 49 cells, need `raw_input` in production KPI
4. **AGRO_DROUGHT_RISK** → 37 cells, need `drought_index` per entity

### 7.2 Companies Readiness — Readiness Grid

**URL:** `/budgeting/admin/companies-readiness`

![Companies Readiness](guide/screenshots/08-companies-readiness.webp)

Per-entity scoring across 7 areas: P&L / BS / CF / KPI / Counterparty / FX tags / Strategic narrative.

Columns:
- **Score** — 0-100%
- **Tier** — Complete / Good / Partial / Thin / Empty
- **Top missing** — what needs to be added to raise tier

**Screenshot shows:**
- HORIZON 15% Thin → need P&L (budget lines), balance sheet, counterparties
- PROMALT 25% Thin → same
- MALT 65% Good → need operational KPIs, strategic narrative, FX tags
- AZSF 80% Good → strategic narrative, FX tags
- EDEN 83% Good → counterparties, FX tags
- CPC 88% Complete → strategic narrative, FX tags

**Export CSV** button copies gap-list for email.

### 7.3.6 Indicator Backlog — What's Missing Per Company

**URL:** `/budgeting/admin/indicator-backlog`

**Purpose:** exactly one page where you can see "what hasn't been uploaded per entity" — without useless checkboxes, with a concrete action plan.

**Structure:**
- **5 summary cards:** Entities / Applicable indicators / With data / Missing / Overall readiness %
- **By-owner aggregate** — clickable badges "Risk Officer owes 5 items", "Sales Director owes 12", "CFO owes 8"
- **Filters:** Category / Owner / Hide entities with 0 missing
- **Per-entity rows** — expand → table of all missing indicators with per-row owner + scope + action

**Per-row actions:**
- 📧 **Email** — opens mailto: with pre-filled body to owner with specific list of requested data
- ⬆️ **Upload file** (entity-level) — deep-link to `/admin/ai-import?forEntity=AZSEKER-AZSF`
- 📥 **CSV** (entity-level) — gap-list export for sending to client
- 📨 **Email all owners** (entity-level) — bulk mailto with grouping by owner

**Integration with AI Auto Import:**
After successful import in `/admin/ai-import`, a banner appears:
> ✅ Closed 7 items from Indicator Backlog
> - AZSEKER-AZSF → AUDIT_CLOSED_PCT
> - AZSEKER-CPC → AUDIT_MAJOR_OPEN
> - ...
> [Open Indicator Backlog →]

**Owner mapping** — who is responsible for what:

| Data Category | Owner Role |
|---|---|
| Audit findings | Internal Audit / Hüquq Şöbəsi |
| Court cases | Hüquq Şöbəsi (Legal) |
| Customers (counterparty) | Sales Director / Commercial Manager |
| Suppliers | Procurement / Təchizat Şöbəsi |
| P&L / BS / CF | CFO / Finance Manager |
| Strategic narrative + Risk Registry + competitors + NPS | Risk Officer (Nəcəf M) |
| Operational KPIs (harvest / yield / sugar content) | Farm Manager / QA / Production |
| Commodity / weather / news | BudgetPro System (auto-populated) |

**Per-org customization:** for each organization (FO Holding, in the future azmade / tabia), owner mapping can be overridden via `Organization.settings.dataOwners` JSON — add real names and emails. Without override, generic role labels are used.

### 7.3.5 Compliance Hub — Single Screen for Audit Findings + Court Cases

**URL:** `/budgeting/admin/compliance`

**Purpose:** one page for compliance/legal officer — all 218 audit findings (Major/Minor/Observation/OFI) + 54 court cases across 6 entities, with filters and CSV export.

**What's inside:**
- **2 tabs** — Audit findings / Court cases
- **5 summary cards at the top** for active tab (Total / Open / Major / Minor / Observation for audit; Total / Open / Defendant / Plaintiff / Money claims for courts)
- **Table with color-coded** severity chips: Major (rose), Minor (amber), Observation (slate), OFI (sky)
- **Filters:** Entity (one of 6) / Severity / Status (Open/Closed/All)
- **Export CSV** of filtered slice with timestamp in filename

**Data source:** already in DB from Phase 7.N (`Company.settings.auditFindings.items` + `courtDisputes.cases`). No new tables.

**What to check:**
- AZSF aud: 6 Major / 30 Minor / 42 Observation = 159 total → CSV should give 159 rows
- CPC ct: 8 cases, all open, 7 as defendant
- Filter `Status: Open only` + `Entity: AZSEKER-AZSF` + `Severity: Major` → should be 6 rows

### 7.3 Data Archive — Soft-Delete with Restore

**URL:** `/budgeting/admin/data-archive`

![Data Archive](guide/screenshots/10-data-archive.webp)

**Why:** made a mistake with import → need to remove rows from calculation, **but not delete physically** for IFRS audit.

**How it works:**
- Archiving hides data from HeatMap, recompute, reports
- Data is **not physically deleted** — restoration possible within **90 days**
- All actions are written to audit trail
- After 90 days — daily cron `soft-delete-purge` physically deletes

**Form:**
- **Action:** Archive / Restore
- **Type:** P&L / BS / CF / Counterparty
- **Company + Year**
- **Reason** (goes to audit log)
- **Confirmation:** enter `ALL` to prevent typo

---

## 8. AI Auto Import — Import Any Excel

**URL:** `/budgeting/admin/ai-import`

![AI Auto Import](guide/screenshots/06-ai-import.webp)

**This is the killer of manual mapping.** Before Phase 7.M Tier 7, each new xlsx required code. Now:

### How It Works (5 Phases)
1. **AI Classifier** (Anthropic) — determines sheet dataType: P&L / BS / CF / Sales / KPI / Land / CAPEX / Descriptions / Forecast
2. **Adapter Router** — selects the correct adapter from registry (11 dataTypes)
3. **5-Phase Import** — parse → validate → upsert CoA → write → recompute
4. **Mandatory Reconciliation** — every import is reconciled with source
5. **GREEN verdict** — no discrepancies or you see diff

### Two Modes
- **`1 file`** — standard, for one workbook
- **`Multiple files`** 🆕 — multi-file orchestrator (Phase 7.M Tier 5)
  - 1-10 files simultaneously
  - **Group-level atomicity** — either all groups are written or none
  - **Cross-file conflict detection** — if two files write different values to the same cell → 409 with diff
  - One recompute after all groups (instead of N)

### What to Check
1. Drag-drop any xlsx into `Drop xlsx file here` zone
2. Press `Step 1: AI sheet analysis`
3. AI returns classification + suggests plan import
4. Confirm → file imports → automatic recompute

### Limitations
- Single file: ≤ 20 MB
- Multi file: ≤ 10 files, ≤ 20 MB total
- Rate limit: 3 multi-file imports/hour/org
- Cost cap: checked in advance (N × 35K tokens)

---

## 9. Risk Registry — Qualitative Risk Flags

**URL:** `/budgeting/admin/companies` → section **"Company Settings"** → expand company card

![Company Settings + Risk Registry](guide/screenshots/15-risk-registry.webp)

**This is the latest feature (Phase 7.N, May 2026).** Qualitative financial-operational risks that HeatMap doesn't show quantitatively.

### Three Canonical Flags

| Flag | Emoji | Meaning | Composite Penalty |
|---|---|---|---|
| `subsidy_dependency` | ⚠️ | Revenue or margin substantially depends on subsidies or regulated prices | **−5** |
| `non_transparent_structure` | 🛡 | Related-party or unaudited cost-allocation pattern | **−8** |
| `data_absence` | ⚪ | Key financial or operational data is missing | **−12** |

### How to Set
1. `/budgeting/admin/companies`
2. Section **"Company Settings"** (bottom of page)
3. Expand company card (e.g., AZSEKER-EDEN)
4. Find **"Risk Registry"** — sorted into 8 categories with severity dots `● ● ●` (emerald → amber → rose)
5. Click on needed flag — it highlights, penalty applies after saving

### Where These Flags Appear (4 Channels, End-to-End Verified)

| Channel | Where You'll See It |
|---|---|
| **Composite score badges** | Risk Terminal → Company Tree (chips `Sub` / `Opq` / `NoD` next to name) |
| **Morning Brief narrative** | Risk Terminal → Today's Brief (phrases like *"exposure to government policy/subsidy regime"*) |
| **Board Deck section** | Board Deck → section **"Qualitative Risk Flags"** with FLAGGED ENTITIES count |
| **Variance Explainer** | Risk Terminal → click cell → Explain → recommendation #3 cites flag |

### Current DB State
- **AZSEKER-AZSF** → `non_transparent_structure` + `data_absence` = **−20 to composite**
- **AZSEKER-CPC** → `subsidy_dependency` + `non_transparent_structure` = **−13**
- **AZSEKER-EDEN** → `subsidy_dependency` = **−5**

### Detailed Risk Registry Per Entity

In addition to 3 canonical flags, each company may have a detailed risk registry (KRI list) — displayed in admin panel:
**`/budgeting/admin/companies` → expand company card → section "Risk Registry"**.

**Current state:**

| Entity | KRIs | Source |
|---|---|---|
| **EDEN** | 15 | `Top risk - EDEN AGRO MMC.xlsx` (file from client) |
| **AZSF / CPC / MALT / HORIZON / PROMALT / FARM** | 0 | ⏳ Pending — awaiting from Nəcəf M (CARRYOVER L2) |

Registries for other entities are **intentionally not filled** — we do NOT generate risks ourselves, waiting for real KRIs from holding's Risk Officer. There should be no fabricated data here: financial CFO makes decisions based on these indicators.

---

## 9.1 Compliance & Legal — Real Indicators from Audit Reports and Courts

**Where:** Risk Terminal → HeatMap (3 new columns) + Board Deck → section "Compliance"

Three new indicators, fed from client files (`Follow up - For GTC.xlsx` + `Açıq məhkəmə mübahisələri.xlsx`):

| Code | What It Measures | Green | Amber | Red |
|---|---|---|---|---|
| `AUDIT_CLOSED_PCT` | % of closed audit findings (PBC) | ≥ 80% | 60–79% | < 60% |
| `AUDIT_MAJOR_OPEN` | Open **Major** audit findings | ≤ 1 | 2–5 | > 5 |
| `LEGAL_CASES_ACTIVE` | Active court cases | ≤ 2 | 3–9 | ≥ 10 |

### What's Currently in DB (Live)

| Entity | AUDIT_CLOSED_PCT | AUDIT_MAJOR_OPEN | LEGAL_CASES_ACTIVE |
|---|---|---|---|
| **AZSEKER-AZSF** | 🔴 51% | 🔴 6 | 🔴 29 |
| **AZSEKER-CPC** | 🔴 39% | 🟡 3 | 🟡 7 |
| **AZSEKER-EDEN** | ⚪ no data | ⚪ no data | 🟡 4 |
| MALT / FARM / HORIZON / PROMALT | ⚪ no data in client files | | |

### Where It Comes From

- **AUDIT_CLOSED_PCT** + **AUDIT_MAJOR_OPEN** — client's internal audit log: 218 findings (Major / Minor / Observation / OFI). AZSF = 159 findings (51% closed, 6 Major open). CPC = 59 findings (39% closed, 3 Major open). Full list available via `Company.settings.auditFindings` for drill-down.
- **LEGAL_CASES_ACTIVE** — registry of open court cases: 54 cases. AZSF — defendant in 26 (29 open). CPC — defendant in 7 (8 open). EDEN — plaintiff only (4 open). Full registry in `Company.settings.courtDisputes`.

### What to Check
- 3 new columns appeared in HeatMap (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN / LEGAL_CASES_ACTIVE)
- Click on red cell AZSF/AUDIT_MAJOR_OPEN → Variance Explainer should cite open Major findings in narrative
- Board Deck → section "Critical alerts" now contains compliance/legal warnings

> **Money-at-risk per case (AZN):** removed from indicators 2026-05-27. Regex covered only 4 out of 54 cases (7%) — misleading floor estimate. Will be reimplemented when full registry of claim amounts arrives from Hüquq Şöbəsi.

---

## 9.2.5 FX Risk — What Portion of Revenue Is Vulnerable to Exchange Rate

**Where:** Risk Terminal → HeatMap column `REVENUE_FX_EXPOSURE`.

Stored in `Company.settings.fxRevenueAzn/Usd/Eur/Rub` — % of revenue in each currency. Formula: **100 − fxRevenueAzn** = % non-AZN.

**Current state:**

| Entity | AZN | USD | EUR | FX Exposure | Source |
|---|---|---|---|---|---|
| **CPC** | 84% | 14% | 2% | 🟢 16% | `Farming strategy/Sales plan` — real volume splits 2027-2035 |
| AZSF / MALT / EDEN / HORIZON / PROMALT | — | — | — | ⚪ Pending | Awaiting from N. Nəcəfzadə file "Müştəri İcmalı" (CARRYOVER L1) |

Only CPC has real data (calculated from client's forward plan). For the other 5 entities we intentionally do NOT fill split — `REVENUE_FX_EXPOSURE` shows `unknown` until verified per-customer FX breakdown arrives.

**Thresholds:**
- 🟢 ≤ 20% — domestic market dominates
- 🟡 20–50% — mixed exposure
- 🔴 > 50% — FX fluctuations dominate revenue

**Relation to `FX_IMPORTED_INPUT`** (cost-side): two indicators together will give **NET FX position** when everyone has revenue split. If cost ≈ revenue in one currency → natural hedge.

---

## 9.2 Concentration — Who Controls Your Revenue

**Where:** Risk Terminal → HeatMap (3 columns) + Board Deck → top movers/alerts.

In addition to HHI (mathematically correct but poorly communicated to CFO), we added **direct concentration indicators** that are immediately readable:

| Code | What It Measures | Green | Amber | Red |
|---|---|---|---|---|
| `CUSTOMER_HHI` | Herfindahl-Hirschman index (mathematical concentration) | ≤ 0.15 | 0.15–0.25 | > 0.25 |
| `TOP_CUSTOMER_SHARE` | % of revenue from **one** largest customer | ≤ 20% | 20–30% | > 30% |
| `TOP3_CUSTOMER_SHARE` | % of revenue from **top 3** largest customers | ≤ 50% | 50–75% | > 75% |

### Live Data

| Entity | TOP_CUSTOMER | TOP3_CUSTOMER | CUSTOMER_HHI | Who Dominates |
|---|---|---|---|---|
| **HORIZON** | 🔴 80% | 🔴 100% | 🔴 0.68 | 2 customers only |
| **EDEN** | 🔴 65% | 🔴 93% | 🔴 0.47 | likely AZSF (intercompany) |
| **MALT** | 🔴 42% | 🔴 80% | 🔴 0.27 | Carlsberg single-buyer |
| **AZSF** | 🔴 32% | 🟡 65% | 🟡 0.19 | Bakı Şirniyyat (confectionery) |
| **CPC** | 🟡 28% | 🟡 64% | 🟡 0.18 | Hacı Şəkər Bakı |
| **PROMALT** | ⚪ no data | ⚪ | ⚪ | (JV with Azersun) |

### Why Both Indicators
- **TOP_CUSTOMER_SHARE** — "loss of one customer" (e.g. AZSF loses Bakı Şirniyyat → −32% revenue overnight)
- **TOP3_CUSTOMER_SHARE** — "long-tail health" (MALT 80% means almost nothing after top-3 — cannot replace if all 3 leave)
- **CUSTOMER_HHI** — academically correct measure, for regulators / due diligence

---

## 10. AI Features — What, Where, How Much

All LLM calls go to **Anthropic Claude** via server-side API (cost mode + retry policy).

### 10.1 Morning Brief

**Where:** Risk Terminal → Panel 3 → section "Today's Brief"

**What it does:** describes the day's risk cluster in one phrase + lists "top worst" by sectors. Considers qualitative risk flags.

**Example output (live, from DB):**
> *Food processing cluster under severe margin pressure; agro revenue collapse at Eden. Three food processing units show critical distress: Azərşəkər posts −143% EBITDA margin, Malt −95% with 114% OpEx, and CPC flags ESG compliance gap (33.3/100) amid related-party audit caveats. Eden Agro revenue cratered to 64 AZN/ha (1004% MoM) with exposure to subsidy-regime shifts; Azərşəkər Sugar Q4Y rejected at 535 despite partial metric coverage. Horizon shows client concentration risk (HHI 0.48). External environment: no major commodity or policy news overnight, suggesting internal-operational breakdowns rather than market-driven shock.*

**Languages:** EN / RU / AZ (switcher in top right corner of panel).

**How caching works:** sha256 of prompt text + dataset hash. Change prompt → old cache automatically invalidated.

### 10.2 Variance Explainer

**Where:** Risk Terminal → click on HeatMap cell → button `Explain →`

![Variance Explainer](guide/screenshots/13-variance-explainer.webp)

**What it does:** narrative (1-3 sentences) + 3 actionable recommendations + list of TOP DRIVERS.

**Example output for EDEN Customer HHI:**
> NARRATIVE: *Customer HHI is 0.4738, well above the 0.25 critical threshold, meaning a single buyer (likely the state sugar-beet processor AZSF) controls ~67% of Eden Agro's 4,000 ha Salyan sugar-beet sales, creating acute cash-flow vulnerability if payment delays occur.*
>
> RECOMMENDATIONS:
> 1. Negotiate pre-payment or rolling credit terms with AZSF tied to monthly harvest delivery milestones during Q3...
> 2. Diversify buyer base: contract 20-30% of Q3 yield to alternative processors or export markets before next planting cycle.
> 3. Strengthen governance: audit state farmgate-price subsidy flows and establish third-party benchmarks for AZSF **intercompany subsidy dependence**.

Notice — recommendation #3 cites the `subsidy_dependency` risk flag from Risk Registry page.

**Cost:** ~1200 in + ~240 out tokens per call (~ $0.01).

### 10.3 Board Deck Narration

**Where:** automatically generated when opening Board Deck.

**What it does:** turns quantitative signals into one headline phrase like *"Food processing margin squeeze and agro yield shortfall drive five critical alerts across four companies"*.

Cached on (orgId, period) — one call per hour maximum.

### 10.4 AI Auto Import Classifier

**Where:** Admin → AI Auto Import → drag-drop file.

**What it does:** smart-routing for any xlsx. Costs ~$0.13 per full workbook (23 sheets / 14 entities in test). No new adapters — AI itself determines type and selects correct pipeline.

---

## 11. Audit Log

**URL:** `/budgeting/audit`

![Audit Log](guide/screenshots/12-audit-log.webp)

**Purpose:** IFRS-compatible log of all significant changes. Stored for 365 days.

### What's Logged
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

### What to Check
- Table shows entries `ai_morning_brief_run`, `ai_news_summary_run`, `ai_variance_explainer_run`, `ai_board_deck_narration_run`
- ACTOR column — `Admin` for manual actions
- SUMMARY contains JSON with `model`, `inputTokens`, `outputTokens`, `language`, `fromCache`
- Entries sorted newest first

---

## 12. Self-Check Checklist

Go through this list **now**, clicking in the live application. If something doesn't match — there's a bug somewhere, fix needs to be queued.

### Basic Navigation
- [ ] `/login` → login with admin credentials → redirect to `/budgeting`
- [ ] Sidebar shows 6 items: Budgeting / Risk Terminal / Board Deck / Onboarding / Audit Log / Admin Tools + Settings
- [ ] Theme switcher (sun/moon) in top right corner works

### Risk Terminal (`/budgeting/terminal`)
- [ ] Panel 1: AZSEKER tree expands, showing 7 sub-cos with composite-score (59%, 65%, 83%, 80%, 15%, ...)
- [ ] Panel 1: next to EDEN there's a `Sub` label, next to AZSF — `Opq` + `NoD`
- [ ] Panel 2: HeatMap shows 3 AZSEKER-* rows (MALT 63, EDEN 64, AZSF 62)
- [ ] Panel 3: "Today's brief" loads, text contains mentions of "subsidy-regime" or "non-transparent" (this is AI Morning Brief with risk flags)
- [ ] Click on red cell EDEN row, column CUSTOMER_HHI → Panel 3 shows formula `counterparty_hhi_customer`
- [ ] Click `Explain →` → in ~15s narrative appears + 3 recommendations
- [ ] In recommendation #3 there's a phrase with **subsidy dependency** (or related)

### Board Deck (`/budgeting/board-deck?period=2026`)
- [ ] AI headline is present (something like "Food processing margin squeeze...")
- [ ] Holding composite score = **59** (at time of writing)
- [ ] Scroll down → section **"Qualitative Risk Flags"** is visible
- [ ] FLAGGED ENTITIES = **3**
- [ ] AZSEKER-EDEN card → `Subsidy dependency` chip (amber)
- [ ] AZSEKER-AZSF card → `Non-transparent structure` (rose) + `Data absence` (slate)
- [ ] AZSEKER-CPC card → `Subsidy dependency` + `Non-transparent structure`
- [ ] Buttons `Export PPTX`, `Export PDF`, `Print to PDF` are present

### Budgeting (`/budgeting`)
- [ ] 4 KPI cards at top (Revenues / COGS / Expenses / Operating Profit)
- [ ] Waterfall chart with tooltip on hover (Actual 31,039,477 ₼ -55% vs budget)
- [ ] Plan selector `Azərşəkər 2026 Budget — 2026`
- [ ] Sidebar: ANALYTICS → Report Builder works

### Onboarding (`/budgeting/onboarding`)
- [ ] 8 entity cards: AZSEKER (100%) + 7 sub-cos
- [ ] PROMALT MMC = 30% PENDING — the only one with PENDING
- [ ] Others ≥ 80% VERIFIED

### Admin Tools (`/budgeting/admin`)
- [ ] Landing shows 16 cards in 4 groups
- [ ] Cards `Data Import` and `Indicator Health` marked with `Phase 7 M` badge
- [ ] All cards are clickable

### AI Auto Import (`/budgeting/admin/ai-import`)
- [ ] Two tabs: `1 file` / `Multiple files` (new one marked `new`)
- [ ] Drop-zone is present
- [ ] Button `Step 1: AI sheet analysis` exists

### Indicator Health (`/budgeting/admin/indicator-health`)
- [ ] Summary: GREEN 258 / AMBER 193 / RED 73 / UNKNOWN 677 / COMPUTED 43.6%
- [ ] Breakdown by error code is visible
- [ ] Filter chips: All / External feed needed / Input gap / Formula edge case / Data not loaded / Rollup correct fix? / Code bug

### Companies Readiness (`/budgeting/admin/companies-readiness`)
- [ ] Table of 6 entities sorts by Score asc (worst first)
- [ ] HORIZON and PROMALT MMC at bottom with Thin tier
- [ ] Button `Export CSV` works

### Data Archive (`/budgeting/admin/data-archive`)
- [ ] Form with fields Action / Data type / Company / Year / Reason / `ALL` confirmation
- [ ] Radio `Archive (hide from calculations)` selected by default

### Company Settings + Risk Registry (`/budgeting/admin/companies`)
- [ ] At top Role & Status table with 8 entities
- [ ] At bottom "Company Settings" with expandable cards
- [ ] Inside EDEN card — section **Risk Registry** with 8 categories
- [ ] Categories: Regulatory & compliance / Financial / Operational / Strategic / ESG / Market / Cyber / Reputational
- [ ] Severity displayed with dots `● ● ●` (emerald / amber / rose)

### Compliance & Legal (`/budgeting/terminal` HeatMap)
- [ ] HeatMap has columns `AUDIT_CLOSED_PCT`, `AUDIT_MAJOR_OPEN`, `LEGAL_CASES_ACTIVE`
- [ ] AZSF — all 3 cells **red** (51% closed / 6 Major / 29 cases)
- [ ] CPC — `AUDIT_CLOSED_PCT` 🔴, `AUDIT_MAJOR_OPEN` 🟡, `LEGAL_CASES_ACTIVE` 🟡
- [ ] EDEN — `LEGAL_CASES_ACTIVE` 🟡 (4 cases, all as plaintiff)
- [ ] Click on red cell AZSF/AUDIT_MAJOR_OPEN → Variance Explainer cites Major findings

### Audit Log (`/budgeting/audit`)
- [ ] Event table, newest first
- [ ] Entries `ai_morning_brief_run`, `ai_variance_explainer_run` are present
- [ ] SUMMARY contains JSON with tokens + language + fromCache

### AI Calls (via Audit Log)
- [ ] At least one `ai_variance_explainer_run` in last 24 hours
- [ ] `ai_morning_brief_run` exists for today
- [ ] `ai_board_deck_narration_run` exists (generated when opening Board Deck)
- [ ] `fromCache: true` for repeated requests with identical parameters

---

## Where to Go If Something Broke

| Symptom | Where to Look |
|---|---|
| Composite score didn't recalculate | `Risk Terminal → Recompute` button |
| AI brief is old | Audit Log → find last `ai_morning_brief_run` → check `fromCache` |
| HeatMap is empty | `Indicator Health` → check UNKNOWN breakdown |
| Import failed | `Admin → Drift Dashboard` → recent events |
| Need to rollback import | `Admin → Data Archive` → select data type + year + reason → ALL |
| Accidentally locked period | `Admin → Period Locks` → unlock + audit |

---

## Technical Details for Reviewer

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
