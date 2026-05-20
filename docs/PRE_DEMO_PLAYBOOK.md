# Pre-Demo Playbook

Run this checklist **before any client-facing session** with the Risk Terminal.
Two scripts cover two different failure modes. Run **both**.

## 0. Daily automation (Phase 7.M Step 4 follow-up)

A LaunchAgent runs every morning at 06:00 local time and does the
intel-feed refresh + zombie cleanup + smoke test for you. If anything
goes 🔴 you get a macOS notification before you sit down at your desk.

**One-time install:**

```bash
cp scripts/com.budgetpro.quality.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.budgetpro.quality.plist
```

**Verify the agent is loaded:**

```bash
launchctl list | grep com.budgetpro.quality
```

**Trigger a run on demand (without waiting for 06:00):**

```bash
launchctl kickstart -k gui/$(id -u)/com.budgetpro.quality
# or simply: bash scripts/daily-quality-check.sh
```

**Read today's log:**

```bash
tail -40 ~/Library/Logs/budgetpro-quality.log
```

**Pause the agent (e.g. before a long offline trip):**

```bash
launchctl unload -w ~/Library/LaunchAgents/com.budgetpro.quality.plist
# Re-enable with `launchctl load -w …` of the same path.
```

**Email fallback** (Phase 7.M Tier2 #5): when the Mac is off / lid
closed at 06:00, the macOS notification never fires. Set the
`QUALITY_ALERT_EMAIL` environment variable in the LaunchAgent plist
so the script falls back to email on 🔴 / 🟡:

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>QUALITY_ALERT_EMAIL</key>
    <string>your-email@example.com</string>
    <!-- existing PATH / HOME entries stay -->
</dict>
```

The script uses the system `mail` CLI by default. To use a custom
SMTP transport, set `QUALITY_ALERT_MAIL_CMD` to a command that takes
the body on stdin (e.g. `msmtp --read-envelope-from`).

**Log rotation:** the log file grows ~50 KB/day. Manually truncate when
it gets too big:

```bash
# Keep the last 1000 lines, archive the rest:
tail -1000 ~/Library/Logs/budgetpro-quality.log > ~/Library/Logs/budgetpro-quality.log.new
mv ~/Library/Logs/budgetpro-quality.log{.new,}
```

The wrapper is self-locating — works from `~/Documents/leaddrive-budgeting`
OR from any `.claude/worktrees/...` checkout without editing paths.

## 1. Code & infrastructure health

```bash
npm run demo:check
```

Exits non-zero on:
- TypeScript compile errors
- Vitest failures
- Missing demo fixtures
- Dev server unhealthy
- Migration drift
- DB row-count out of expected band (AZMADE seed sanity)

## 2. Data quality (Phase 7.M Step 3)

```bash
npm run smoke-test
```

Exit codes: `0` = green / `1` = yellow (proceed with caveats) / `2` = red (do NOT demo).

Scans the holding's IndicatorValue + IntelDataPoint state for the six bug
classes that have surfaced as client-visible embarrassments:

| # | Check | What it catches |
|---|---|---|
| 1 | Extreme-magnitude IV values | The −$23B trade-balance class (UN Comtrade partial-year fragments) |
| 2 | Status=red on value=0 | False negatives — threshold classifier mistook missing data for danger |
| 3 | Macro-broadcast pollution | One value cloned across ≥3 companies and ranked into Top-3 Worst |
| 4 | Stale adapters (>30 days) | A feed that hasn't refreshed will display fresh-looking but old numbers |
| 5 | Low-readiness companies (<50 budget_lines) | Variance Explainer hallucinates on thin data |
| 6 | Zombie cells (value=0 + green/amber) | Phase 7.L zombie-row guard leakage |

The script is read-only — safe to run any time.

## 3. If red

**Do NOT start the demo.** Resolve each 🔴 item:

| Issue | Resolution |
|---|---|
| Extreme magnitude | Find the source `intel_data_points` row → confirm the plausibility rule should reject it → either tighten the rule (in `src/lib/intel/commodity/plausibility.ts`) and re-run scheduler, or `DELETE` the offending row directly. |
| Macro broadcast | Mark the indicator's `valueSource = 'macro'` in the seed file so the HeatMap picker filters it from per-company rankings. |
| Stale adapter | `DATABASE_URL=… npx tsx scripts/intel-scheduler-bootstrap.ts --once` to refresh, or fix the adapter if it errors. |
| Low readiness | Either onboard real data via the import flow, or hide the company from the demo (set `status='pending'`). |
| Zombies | Investigate why the recompute zombie-row guard didn't fire — check `state.inputs.aggregates.budget_line.line_count` for the offending company. |
| Red on zero | If the indicator is a composite (e.g. `IND_ESG_COMPOSITE`) and 0 = no data, consider switching its `direction` or adding an `unknown` band so missing data doesn't read as danger. |

## 4. Plausibility rules (Step 1)

When a finance user spots a bogus number on screen:

1. Identify the metric + value.
2. Add or tighten a rule in `src/lib/intel/commodity/plausibility.ts`.
3. Add a regression test in `src/lib/intel/commodity/plausibility.test.ts`
   so the band is locked.
4. Re-run `npm run smoke-test` to confirm the bad value is now rejected.

The registry is a **deny-list of known-impossible bands**, not a whitelist.
Adding a new adapter does NOT require adding a rule, but reviewing the
adapter's typical-value range and adding one is the recommended habit.

## 5. Signal confidence (Step 2)

Every HeatMap cell now carries a `signalConfidence` tier on the wire:

- **high** — disclosed by finance OR computed from real budget / booking
  / operational-fact data. No recompute error.
- **medium** — modeled (industry-factor proxy) or macro-broadcast input.
- **low** — zombie guard fired OR out-of-range plausibility clamp.

`low` cells render with a subtle amber inset ring in the HeatMap so the
finance reviewer sees at a glance "this number is not certain".

## 7. Phase 7.M Tier 3 + Tier 4 — new admin tools (2026-05-19)

Все admin pages now reachable from sidebar **Admin Tools** или прямо через `/budgeting/admin`.

### Workflow для client demo

1. **Open `/budgeting/admin/indicator-health`** — посмотри % computed + breakdown unknown по error category.
   - Green tile ≥ 50% — demo proceeds.
   - 🔌 External-feed gaps → check Drift Dashboard, refresh feeds if needed.
   - 📥 Ingest-gap → fill via Data Entry или ask client for missing column.
   - ⚪ Data not entered → enter via Data Entry или explain как gaps в demo briefing.
   - 📊 Leaf-rollup → correct behavior, ignore.
   - 🐛 Code-bug → investigate immediately.

2. **Open `/budgeting/admin/drift`** — все external feed cards 🟢 FRESH.

3. **`npm run smoke-test`** из CLI — финальный smoke.

4. **При новом xlsx от клиента**: `/budgeting/admin/ai-import` — drag-drop ANY xlsx → AI классифицирует листы → preview classification table → confirm → bit-perfect 5-phase pipeline с reconciliation.

5. **При AzerSheker-specific workbook**: `/budgeting/admin/import-workbook` — стандартный bit-perfect path с заранее известной структурой.

### New admin tools matrix

| Tool | What it does | URL |
|---|---|---|
| **AI Auto Import** 🆕 | Universal xlsx → AI classifier → bit-perfect import | /budgeting/admin/ai-import |
| **Import Workbook** 🆕 | AzerSheker 5-phase pipeline (P&L→BS→KPI→CF→Recompute) | /budgeting/admin/import-workbook |
| **Indicator Health** 🆕 | % computed + unknown breakdown + remediation guidance | /budgeting/admin/indicator-health |
| Admin Landing | Hub with all 18 admin tools grouped by workflow | /budgeting/admin |
| Drift Dashboard | External feed freshness + stalled onboarding | /budgeting/admin/drift |
| Data Entry | Manual KPI / ESG disclosure entry | /budgeting/admin/data-entry |
| Data Archive | Self-service archive/restore for 4 tables | /budgeting/admin/data-archive |
| Companies Readiness | Per-company 7-area scoring | /budgeting/admin/companies-readiness |

### Risk Terminal Panel 4 — Strategic Context Card

Каждая company с настройками теперь показывает:
- 📋 Бизнес-модель (Təsvir parsed description) + competitive advantage
- 🌾 Land registry summary (EDEN: 22,596 ha · 17 parcels · 5 regions)
- 🏗 CAPEX 2026 (top 3 initiatives by amount + total + CAPEX/OPEX split)
- 📈 Forward forecast 10-year (consolidated holding, from İcmal sheet)

### Helper scripts (Phase 7.M)

```bash
# Sync AZSEKER entities (создаёт PROMALT, archive FARM)
npx tsx scripts/sync-azseker-entities.ts

# Apply strategic descriptions (Təsvir sheet → Company.settings)
npx tsx scripts/apply-azseker-descriptions.ts

# Apply CAPEX initiatives (CAPEX_Farm + CAPEX_CPC sheets → Company.settings)
npx tsx scripts/apply-azseker-capex.ts

# Apply land registry (Çıxarışların uçotu.xlsx → AZSEKER-EDEN.settings)
npx tsx scripts/apply-azseker-land.ts

# Apply forward forecast (İcmal sheet → Org.settings.forwardForecast)
npx tsx scripts/apply-azseker-forward-forecast.ts

# Derive drought_index from weather + land registry → operational_facts
npx tsx scripts/derive-azseker-drought-index.ts

# Mark AZSEKER as fxExposureSource=all_domestic (all-AZN confirmed by Azik)
npx tsx scripts/set-azseker-fx-all-domestic.ts

# Backfill news companyTags (parent → children broadcast)
npx tsx scripts/backfill-azseker-news-tags.ts

# Full bit-perfect re-import with --purge cleanup
npx tsx scripts/import-azseker-workbook-batch.ts --purge --year=2026

# Clean-slate AZSEKER (delete all live data, keep companies)
npx tsx scripts/clean-slate-azseker.ts
```

## 6. Quick reference

```bash
# Code + infra
npm run demo:check

# Data quality
npm run smoke-test

# Refresh sparklines (visual smoothness)
npm run sparklines:refresh

# Re-pull external feeds (full scheduler pass)
DATABASE_URL=… npx tsx scripts/intel-scheduler-bootstrap.ts --once

# Recompute all AZSEKER + AAC + ATL + etc.
DATABASE_URL=… npx tsx scripts/recompute-fo-2026.ts

# Recompute all indicators for the current period
# (via API, requires dev server up + admin auth)
POST /api/indicators/recompute

# Indicator Health snapshot (JSON; same data UI page shows)
curl -H "Cookie: ..." http://localhost:3000/api/admin/indicator-health | jq .summary
```
