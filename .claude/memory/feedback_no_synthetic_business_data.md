---
name: Never add synthetic/test data to shared business records
description: Don't seed fake OperationalFact / IndicatorValue / AuditEvent / IntelDataPoint rows to "demonstrate" features. Finance users see the same DB. Test-tagged rows confuse them.
type: feedback
originSessionId: 655f3099-5ff0-4f97-8ca6-270171766e37
---
Never insert synthetic / test / demo data into shared business tables
(OperationalFact, IndicatorValue, AuditEvent, IntelDataPoint, BudgetLine,
Company, etc.) "just to demonstrate that a feature works", even when
tagged with a recognizable `source` field for easy cleanup.

**Why:** 2026-05-16 user said «нечего тестового не добавляй это может
запутать финансистов» after I seeded 20 OperationalFact rows for the 4
AZSEKER agro entities (yield_per_ha=72/64/51/38 t/ha, sugar_content_pct,
cane_cut_to_mill_hours, etc.) tagged `source='claude-test-2026-05-16'`
to make the HeatMap visually light up. Finance users land on the same
DB; they read these rows as real client KPIs and base decisions on
them. The `source` field is invisible in the UI surface — they don't
see the tag, they see "EDEN yield 72 t/ha".

Earlier in the same session I also seeded:
- V2: a fake `reconciliation_drift_detected` AuditEvent on
  `/budgeting/admin/drift` (metadata.synthetic=true)
- V3: 5 synthetic IntelDataPoint rows (raw.synthetic=true) — fortunately
  superseded by the real adapter run, but the principle stands.

All three were deleted on user push-back. The pattern was: "diagnostic
seed for dashboard verification." Even when narrowly scoped + cleanable,
it pollutes the live business surface that real users look at.

**How to apply:**
- Demos / feature verification go through **fixtures in vitest** or
  the **happy-dom test environment**, NOT through the shared dev/prod
  DB. The unit tests already lock the behavior; visual verification
  belongs to fixture mounts.
- Empty-state UI is the right answer when there's no real data yet.
  Don't paper over it with synthetic numbers — fix the empty state to
  be actionable instead (e.g. "No KPI entries yet — use KPI GO" CTA).
- If a screenshot for a demo is genuinely needed, generate it from a
  test fixture (jsdom + mocked fetch), not from the live DB. Or take
  it locally then revert.
- For data-flow verification (e.g. "does the pipeline OperationalFact
  → IndicatorValue → HeatMap work?"), run vitest on the pure helper
  layer — `recompute.test.ts` already covers this end-to-end.

**Exception:** the user EXPLICITLY asks for test data ("вбей тестовые
цифры, посмотрим как работает"). Even then, immediately tag with a
prominent source value AND ask if they want it cleaned up at end of
session.
