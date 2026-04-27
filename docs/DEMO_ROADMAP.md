# Roadmap slides — customer demo Friday 2026-05-01

> Markdown source for the 4-slide deck closing the demo. Convert to PDF / Google Slides / Keynote Day 4 evening; ship as follow-up artifact post-demo.

---

## Slide 1 — Working today (anchor)

**Title:** _What you just saw — production-ready core_

| Capability | Status | What it does |
|---|---|---|
| Multi-company holding budgeting | ✅ Live | 8 ops + 5 sub-groups + DEMO-CO scratch = 14 companies, P&L consolidated across 14 sector packs |
| AI Data Mapper (xlsx import) | ✅ Live | Anthropic Claude proposes column mapping; user reviews; apply commits transactionally |
| Risk Indicator Terminal | ✅ Live | Bloomberg-style HeatMap, 67 active indicators (24 green / 25 amber / 18 red), sub-group rollups, drill-down to source BudgetLines |
| AI Variance Explainer | ✅ Live | Plain-language narrative for any threshold breach, EN / RU / AZ; per-call audit attestation (model + token usage) |
| AI Analytics (per-section panel) | ✅ Live | Floating side-drawer per /budgeting tab — multi-turn chat with tool-use (DB queries) + web search + PDF export |
| Audit log + compliance trail | ✅ Live | Append-only event log, 365-day retention, full forensic drill — now includes Phase 7.E AI-suite calls |
| Per-user named layouts | ✅ Live | Save/load Risk Terminal panel arrangements |

**Visual:** screenshot grid of 4 surfaces — P&L, Risk Terminal HeatMap, AuditModal, Onboarding wizard step 2.

**Talking point:**
> "За 6 недель мы построили full FP&A platform с AI augmentation. AZMADE использует это для real-world holding management — 568 budget line-items × 12 months = ~6,800 BudgetLines across 13 companies (5 sub-groups + 8 operational), real seasonal distribution per source xlsx."

---

## Slide 2 — Coming next quarter (Q3 2026)

**Title:** _Three AI features that change how the C-suite uses финансы_

> Note: framing is **Q3** (Jul-Sep 2026), not Q2. Demo is end of Q2; these
> 3 items are 0% started today, each multi-week design + implementation.
> Avoid Q2 framing on slide — overpromise risk.

### 🔍 AI Web Crawler
- **What:** Auto-pull industry benchmark data per sector (Damodaran-class margins, working-capital ratios, sector-specific KPIs)
- **Why:** Customer-supplied thresholds + auto-refreshed market benchmarks = "your numbers vs world numbers" в один клик
- **For:** "Are we performing above or below the AZ market for our sector?" — one-click answer

### 📈 Predictive Analytics
- **What:** Forecast next 4 quarters per indicator with confidence intervals
- **Methodology:** ensemble of linear regression + ARIMA + LLM-augmented narrative
- **For:** "What will our gross margin look like Q3 if current trend holds?" — auto-projected, не Excel-modeled

### 📑 Board Deck Generator
- **What:** One-click executive PDF for board meetings
- **Generates:** Holding overview + per-company drill-down + variance analysis + AI commentary
- **For:** CFO who currently spends 1-2 days assembling board pack monthly

**Talking point:**
> "Это не roadmap-fluff. Architecture готова — это implementation work, не R&D. Pilot customers получают early access."

---

## Slide 3 — Coming next 6 months (Q4 2026)

**Title:** _Advanced analytics + scale_

> Note: shifted from Q3→Q4 to honor the Slide-2 reframe. Sparkline +
> fact()/rollup() + BullMQ scheduler are queue-sequenced (each blocks
> the next; ~10 weeks total = developer estimate of 3-4 weeks/item × 3
> items, not an explicit ROADMAP commitment). Q4 (Oct-Dec) realistic
> if Phase F (post-demo) starts immediately. Speaker should treat the
> 10-week number as estimate-not-promise if customer asks.

### Sparkline trends in every cell
- 12-month mini-chart inside each HeatMap cell
- See trajectory at a glance — improving, stable, deteriorating
- **Tech:** requires `BudgetLine.perMonth Float[]` migration + minor refactor

### Composite cross-period indicators
- `fact()` + `rollup()` formula functions enable indicators that span periods
- Example: "Average revenue growth over last 4 quarters" — single indicator, multi-period
- Unlocks Predictive Analytics signal quality

### Background recompute scheduler
- Currently sync recompute caps at ~500 (company × indicator) pairs
- BullMQ + Redis job queue removes the cap → instant matrix at 60-100+ companies
- Auto-prune audit events past 365-day retention
- ImportStaging expiry cron

### 30+ sector packs
- Currently 14 packs (hospitality, retail, agro, food, beverage, services, pharma, real estate, entertainment, education, logistics, construction, poultry, industrial)
- Add: telecom, transportation, mining, energy, banking, insurance, e-commerce, healthcare, legal, education-K12, etc

**Talking point:**
> "Customers get input на priority — какие sectors появляются first определяется реальным pipeline. Если pilot в pharma → pharma extensions ship first."

---

## Slide 4 — Coming year+ (2026-Q4 → 2027)

**Title:** _SaaS + ecosystem_

### Multi-tenant SaaS
- Per-customer org isolation enforced at PostgreSQL Row-Level Security (RLS), не just app layer
- Self-service signup → 5-minute onboarding для small holdings (3-10 companies)
- Pricing: per-holding monthly subscription
- **Regions:** EU + Azerbaijan + Turkey day-one

### White-label deployment
- Consulting partners (Big-4 / regional FP&A boutiques) deploy under their brand
- Revenue-share model
- Partner gets sector-pack customization rights for their vertical specialty

### Integration ecosystem
- 1C connector (highest CIS-market priority)
- SAP / Oracle / NetSuite connectors (on-request)
- Excel live-link для transition customers
- Webhook + REST API для custom integrations
- Slack / Teams notification channels

### Enterprise features
- SSO via SAML / OIDC
- SOC 2 Type II audit (track for 2027 — needs 6+ months operational evidence)
- ISO 27001 certification
- Annual penetration test

**Talking point:**
> "Это direction. Specifics — что именно first — определит ваш pilot и follow-on customers. Предложение — присоединиться к pilot cohort, влиять на priority."

---

## Closing slide (optional 5th — single bullet)

**Title:** _Next steps_

- 🤝 **Pilot proposal** — drafted within 48h of this demo
- 📅 **Kick-off** — within 2 weeks if pilot greenlit
- 💬 **Champion access** — direct line to founding team during pilot

**Contact:**
- Rashad Rahimov — rashadrahimov@gmail.com
- Demo recording + this deck + pilot proposal → emailed to you Monday

---

## Conversion notes (Day 4 evening)

- Use either Google Slides OR Keynote — pick whichever you'll actually present from
- Keep slide text minimal — this markdown has more than slide should display; pull headlines + 3-4 bullets max per slide
- Add visual: use Cursor/v0/screenshot of actual product for slide 1; icons for slides 2-4 (Lucide-style consistent with product)
- Brand colors: match the Risk Terminal HeatMap palette (green/amber/red signal colors as accents)
- Footer on every slide: "BudgetPro · AZMADE Group anchor case · Demo 2026-05-01"
- 16:9 aspect ratio
- Export to PDF for follow-up email attachment

## What NOT to put on slides

- ❌ Specific shipping dates for Q3+ items (customers remember dates as commitments)
- ❌ Customer names from other deals
- ❌ Pricing numbers (handle in conversation, not slides — easier to negotiate)
- ❌ Tech stack details (Anthropic, Prisma, Next.js — irrelevant to CFO buyer)
- ❌ Code or screenshots of admin / internal tools
- ❌ "Currently unshipped" disclaimers — frame as "coming next quarter / next 6 months / next year" with confidence
