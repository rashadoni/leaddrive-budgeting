# Crisis Brief — UX/UI Review (Task 9)

**Date:** 2026-05-30 · Visual reference: `public/crisis-mockup.html` (user-validated).

The Risk Terminal is auth-gated and the developer does not log in (the user authenticates). So the **live** visual pass (items marked 🔍 LIVE) is the user's to run after login; everything else is verified statically here.

## Rubric

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | **Selector grouped by category** (not a flat list — closes the "только два параметра?" complaint) | ✅ DONE | `ScenarioPanel` now groups via `crisis-catalog` category map: 💱 Валюта/макро · 🌾 Сырьё · ☀️ Климат/агро · 🌍 Геополитика · 👥 Клиенты + 🧪 Другие. tsc 0; 19 panel tests green. |
| 2 | **Cascade pacing** worst-first, ≈1.5–2.5s total | 🔍 LIVE | `orderCascade` red→amber→green (3 unit tests); per-cell delay `clamp(1800/N, 35, 120)`ms; mirrors the mockup. Time it live. |
| 3 | **Score swing** baseline→scenario tween + colour + ▼ badge, readable | ✅ matches mockup / 🔍 LIVE size | `HoldingScoreSwing` (4xl, `tabular-nums`, cubic ease, struck-through baseline, ▼/▲ delta). Confirm ≥24px readability live. |
| 4 | **Narrative** streams line-by-line (tag-safe), ⚠ lead + real numbers + mitigations | ✅ logic / 🔍 LIVE | `NarrativeStream` splits on sentence boundaries (the validated mockup fix — never mid-tag); grounded prompt cites only computed numbers (4 unit tests); FX assumption note surfaced. |
| 5 | **Revert** one click restores baseline (overlay + brief cleared) | ✅ DONE | `← Базовый сценарий` + header «Сбросить» both call `clearScenarioDelta()` which now also nulls `scenarioBrief` (store test). |
| 6 | **Graceful degrade** — no AI key → cascade + swing still land + "narrative unavailable" note | ✅ DONE | route returns `narrative:null`+`narrativeError`; panel shows `crisis-narrative-unavailable`; 1 route test. |
| 7 | **Intuitiveness** for a CFO | 🔍 LIVE (user judgment) | Primary red 🔥 «Запустить кризис»; worst-hit company chips (struck-through→new score); legacy path demoted to «⚡ Быстрый расчёт». |

## 🔍 LIVE checklist for the user (≈2 min after login)

1. Log in → `/budgeting/terminal`.
2. Open the Scenario panel: type `SCN` in the command bar (or click the 🧪 Beaker).
3. Confirm the selector is **grouped** by the 5 categories (item 1).
4. Pick **INPUT_COST_30** (under 🌾 Сырьё) → click **🔥 Запустить кризис**.
5. Watch: HeatMap cells **cascade red worst-first** (item 2) → holding score **tweens 61→58** with colour shift + ▼ badge (item 3) → AI brief **streams** ⚠-led, cites MALT/CPC real numbers, lists 2-3 mitigations (item 4).
6. Try **DROUGHT_2026** (☀️) and **AZN_DEVAL_20** (💱) — confirm margins crush / FX cells flip amber.
7. Click **← Базовый сценарий** → overlay + brief vanish instantly (item 5).
8. (Optional) Switch AI language RU/EN/AZ and re-run.

If any LIVE item disappoints, tell the developer the exact element + what you saw (per `feedback_no_screenshot_lies.md` — concrete, not vibes) and it gets fixed.

## Known limitation (documented, not a UX bug)

- The **holding** number moves modestly (~3 pts) because the composite averages ~30 indicators and non-financial ones (ESG/carbon/news) don't react to a financial shock. The drama is the **cascade + per-company drops + narrative** — the honest number, not inflated. A "financial-stress" weighting is a possible future product decision (user's call).
- A revenue-normalized ESG-intensity indicator can flip green-ward under a shock (see fin-correctness doc); the narrative prompt focuses on financial drivers so the brief never highlights it.
