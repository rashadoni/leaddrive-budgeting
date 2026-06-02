# BudgetPro / AzerSheker — Demo Checklist

> Prepared 2026-06-02. Numbers verified against the live DB + source files this session.
> Honest-by-design: the **Caveats** section lists what NOT to over-claim.

## 0. Pre-demo setup (2 min)

- [ ] Dev server up: `http://localhost:3000` (LaunchAgent; restart `launchctl kickstart -k gui/501/com.budgetpro.dev` if needed).
- [ ] Logged in (Admin). Pick the demo language via the globe switcher (EN / RU / AZ) — UI + AI output follow it.
- [ ] One browser tab; zoom ~100%.

---

## 1. Risk Terminal — the flagship  (`/budgeting/terminal`)

**Show:** HeatMap (companies × indicators, colour + shape coded), composite score per company, CompanyTree drill-down (FO Holding → AZSEKER → entities).

**Expected live state (2026), verified:**

| Entity | 🟢 green | 🟡 amber | 🔴 red | ⚪ pending |
|---|--:|--:|--:|--:|
| AZSEKER-AZSF (Sugar) | 11 | 3 | 5 | 14 |
| AZSEKER-CPC (Corn proc.) | 12 | 5 | 4 | 12 |
| AZSEKER-EDEN (Farming) | 11 | 3 | 7 | 18 |
| AZSEKER-MALT | 11 | 4 | 7 | 11 |

**Talking points:**
- Real risk signals on 4 operational entities — financial, operational, compliance, legal indicators.
- Compliance/Legal live from client data: 218 audit findings + 54 court cases parsed from the workbooks.
- Colour-blind-safe (shape + colour). Drill from holding → entity → indicator.

**Don't dwell on:** HORIZON & PROMALT — mostly ⚪ unknown (data-pending entities; the empty-state is correct, not a bug).

---

## 2. Budgeting Workspace — plan vs actual  (`/budgeting?tab=workspace`)

**Opens on "Azərşəkər 2026 Budget" by default** (the populated budget plan — execution shows immediately). Empty placeholder plans are marked " · ∅" in the picker.

**Expected cards (holding "Azərşəkər" selected), verified:**

| Card | План (budget) | Факт (actual, Jan–Apr) | Исполнение |
|---|--:|--:|--:|
| Доходы | 72,033,200 ₼ | 9,527,381 ₼ | **13%** |
| Себестоимость | 38,699,923 ₼ | 7,762,027 ₼ | **20%** |
| Расходы | 19,017,618 ₼ | 4,538,918 ₼ | **24%** |

- [ ] Point at the **amber context banner**: "Исполнение = факт ÷ годовой бюджет. Факт за **4 из 12 мес** — низкий % в начале года нормален для сезонной (урожайной) выручки." → pre-empts the "why only 13%?" question.
- [ ] Switch company to a child (e.g. **CPC** or **EDEN**) — budget is split per entity (EDEN 39.7M / CPC 18.6M / AZSF 5.5M / MALT 8.2M revenue).

**Story:** budget = the İcmal 2026 plan; actual = realized Jan–Apr from the workbook; execution tracks against it. Revenue is harvest-seasonal (H2-weighted), so H1 % is intentionally low.

---

## 3. IFRS Conformance  (`/budgeting/admin/ifrs-conformance`)

**Show:** 8 IAS-1 checks per company, 0–100 score, the "why <100%" panel + IAS chips.

**Talking points:** it genuinely **discriminates** (balance ties, sections present, current/non-current split, P&L↔equity linkage) — not a rubber stamp. Click a company to see exactly which check failed and why.

---

## 4. AI Import — "any spreadsheet"  (`/budgeting/admin/ai-import`) — optional wow

**Show:** upload a workbook → AI classifies each sheet (P&L / BS / CF / KPI / CAPEX / budget) → bit-perfect import.

**Talking points:** the classifier now **distinguishes actuals from budget** and routes each to the right plan; multi-file upload with cross-file conflict detection; cost ~$0.13/run.

---

## 5. The credibility close — data integrity

This is the trust close. State plainly:

- **Every number in the system reconciles bit-for-bit to the client's source files** — P&L, Balance Sheet, Cash Flow (all 3 sections), Land (17 parcels / 22,596 ha), CAPEX (total + per-entity). Verified this session.
- **A re-import reproduces everything automatically** — actuals (incl. the cash-flow refund-sign fix) AND the İcmal budget — no manual steps.
- **Only real client figures** — no synthetic/placeholder data.

---

## Caveats — do NOT over-claim

- **Actuals = Jan–Apr 2026 only** (4 months) — the file has no May+ yet. Execution % is partial-year by design; say so.
- **HORIZON / PROMALT** are data-pending (mostly ⚪). Don't present them as fully analysed.
- **Budget revenue (72M) includes ~13.2M subsidies** as other income; actual revenue (9.5M) is sales-only — the execution % is directional, not a like-for-like margin.
- **Cash-flow page** is the only place CF data surfaces; the Terminal/P&L don't use CF.
- If a screen looks off live, ping me — I'll verify the data behind it on the spot (browser automation is offline, so I can't click through with you, but I can check any number instantly).
