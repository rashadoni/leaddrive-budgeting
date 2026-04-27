# Loom backup script — happy-path 5-minute narration

> **Numbers in this script verified Apr 27 (Turn 38 sub-7).** Re-verify
> Day-4 evening before recording — if live data drifted (new import,
> recompute, schema change), update the narration counts before take.
> Check via `bash scripts/pre-demo-check.sh` (13 checks, exit 0 = green).
>
> **Purpose:** if live demo fails (network down, server crash, unexpected
> red flash), the speaker pivots to this pre-recorded Loom showing the
> exact same flow without any infrastructure dependency. Record Day-4
> evening; upload to Loom workspace; pin URL in Slack.
>
> **Recording setup:** Chrome zoomed to 110% (font readable on customer's
> projector); window pinned full-width; no DevTools; demo username
> visible top-right; close all other tabs. Quiet room — no
> notifications.
>
> **Narration language:** EN with one RU/AZ flourish on Variance
> Explainer (matches live demo Step 2 multilingual point).
>
> **Total target:** 5:30 ± 30 sec (5:00 only achievable with idealistic LLM tail; 5:30 has slack for Variance Explainer 18s + /apply 7s slow case).

> **Recording flow note:** if EXPLAIN > 18 sec on first take, skip the
> Russian re-run beat (saves 30 sec) and add a verbal "multilingual
> shipped, see Step 6 slide" cue. Better to land 5:00 EN-only than
> miss 5:30 with a stretched RU pause.

---

## 0:00–0:30 · Hub overview

**Action:** Land on `/budgeting`. Click P&L → `?tab=pnl-report`.

**Say:**
> "This is AZMADE Group's main P&L. 14 entities — 5 sub-groups, 8
> operational op-cos, plus a scratch sandbox. Q1 closed, April partial.
> Net Revenue 250M planned, 60.9M actual YTD."

**Beats:**
- KPI cards visible (Net Rev / COGS / Gross Profit / **EBITDA 25M = 10%
  margin** — emphasize "true EBITDA, D&A added back from OpEx and COGS")
- Margin Trends chart with Management toggle active
- Toggle to Bookkeeping for 2 sec to show Dec cliff, then back to
  Management → "this is how a finance team would actually present it"

---

## 0:30–1:30 · Per-company drill (the underperformer story)

**Action:** Click company selector → AAC-MAIN.

**Say:**
> "AAC-MAIN — our underperformer. 19M revenue, 17% gross margin —
> thin for industrial which typically runs 25-30%. EBITDA down to 1.5M.
> The system surfaces this in the Variance % column, no manual analysis."

**Click:** company selector → ATL-DBZ.

**Say:**
> "ATL-DBZ — the over-performer. Steel pipe demand drove revenue +14%
> over plan. Building cash buffer for Q3-Q4."

**Click:** Back to consolidated.

---

## 1:30–2:30 · Risk Terminal — HeatMap + Variance Explainer

**Action:** Click Risk Terminal in sidebar.

**Say:**
> "Bloomberg-style monitoring. 14 rows — companies + sub-group rollups.
> 67 active indicator cells. Green within healthy band, amber warning,
> red needs attention. CFO sees the entire holding's risk surface in
> one glance."

**Click:** Red cell on AAC IND_NET_MARGIN.

**Say (while Panel 3 populates):**
> "Click any cell — formula, resolved variables, audit chain. Every
> number traces back to source BudgetLines."

**Click:** EXPLAIN button.

**Wait 12-15 sec, then:**
> "AI Variance Explainer. Plain-English diagnosis plus 3 actionable
> recommendations. CFO doesn't dig through 1000 line items — gets the
> story in seconds. Token usage and model name recorded in audit log
> for compliance."

**Click:** RU language tab → Re-run.

**Wait 15 sec, then:**
> "Multilingual out of the box. Same indicator, full Russian narrative.
> AZ tab visible — content rolls out Q3."

---

## 2:30–3:30 · Onboarding wizard (the "3 minutes not 3 weeks" pitch)

**Action:** Sidebar → Onboarding. Select DEMO-CO. Upload `~/Downloads/DEMO-CO.xlsx`.

**Say:**
> "Imagine you acquire a new subsidiary. Here's how they appear in the
> system in 3 minutes — not 3 weeks of consulting."

**Click:** "Analyze with AI". Wait 35 sec.

**Say (while waiting):**
> "Anthropic Claude reads the spreadsheet, proposes column mappings —
> account code, label, plan, actual columns. Customer reviews. AI gets
> it right ~95% of the time on first pass for well-formed CoA."

**Show:** 14-column mapping proposal table.

**Click:** "Apply to BudgetLine". Wait 5 sec.

**Show:** "✓ Applied: INSERTED 27 / 5 indicators recomputed".

**Say:**
> "All committed atomically. Risk indicators auto-recomputed. Audit
> event written. Done."

---

## 3:30–4:30 · Risk Terminal deep-dive (Bloomberg muscle)

**Action:** Sidebar → Risk Terminal.

**Type in command bar:** `SPARK-MAIN CO GO`.

**Say:**
> "Keyboard-driven for speed. Target-first, function-last, GO terminator.
> Same syntax as Bloomberg. CFO who lives in this terminal isn't moving
> their hands to the mouse."

**Type:** `IND_GROSS_MARGIN IND GO`.

**Say:**
> "Direct indicator drill — the IND command takes a code, jumps to
> Panel 3."

**Press F1, F2, F3, F4 in succession.**

**Say:**
> "Panel switching feels native. Drag to resize. Save layout — every
> user has their own preferred view."

**Click:** ▢ Layouts button → save current as "demo-cfo".

**Type:** `AUD GO`.

**Say:**
> "Audit modal. 30+ events — every change who, what, when. Including
> the AI Variance Explainer calls we just made — model name and token
> usage per call. Compliance ready: 365-day retention, append-only,
> nobody can tamper."

**Press Escape.**

---

## 4:30–5:00 · Close

**Action:** Sidebar → Audit Log.

**Say:**
> "Full audit feed for an external auditor. Filter by action, by entity,
> by date. Export to CSV coming Q3."

**Cut to next slide / wrap:**
> "That's the working core. P&L, Risk Terminal, AI Mapper, AI Variance
> Explainer, full audit trail. Ready for AZMADE Group to run holding-
> level FP&A on. Let's talk pilot."

---

## Recording checklist

- [ ] Browser at 110% zoom
- [ ] Demo username `Admin` visible top-right
- [ ] No DevTools open
- [ ] All other tabs closed
- [ ] Background apps muted (Slack, email, calendar notifications)
- [ ] LaunchAgent dev server warm (visit each page once before recording so chunks are pre-loaded)
- [ ] DEMO-CO state reset before recording (`scripts/seed-demo-co.ts` regenerates the xlsx)
- [ ] `~/Downloads/DEMO-CO.xlsx` exists and is the correct 27-row file
- [ ] Audio: Loom checks levels 1× before take

## Hard-cut alternatives if a beat fails mid-record

| Beat | If it fails | Cut to |
|---|---|---|
| 0:30 EBITDA card shows wrong number | re-record from 0:00 with company selector cleared | — |
| 1:30 Variance Explainer LLM > 30 sec | cut Russian re-run, ship EN-only Loom | shave 30 sec |
| 2:30 Onboarding /apply errors | substitute pre-recorded 30 sec clip of successful apply | keep timing |
| 3:30 Command bar IND fails | use HeatMap cell click as backup path | keep narrative |
| 4:00 Layout save fails | skip ▢ Layouts beat; mention "every user has saved layouts" verbally | shave 15 sec |
| 4:30 AUD GO modal misses ai_variance rows | switch to /budgeting/audit page navigation | keep narrative |
