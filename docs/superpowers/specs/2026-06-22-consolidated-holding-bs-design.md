# Consolidated Holding Balance Sheet — Design

**Date:** 2026-06-22
**Status:** approved-approach (Variant 2 — full integration), pending build
**Risk:** #1 (import-path) + money → Codex review before merge

## Problem

The Budgeting → Balance Sheet holding view shows **Total Assets = 339M**, a NAIVE
arithmetic sum of the 4 standalone company balance sheets. It double-counts **126M of
intercompany "Investments in Joint Ventures"** (`BS.01.01.05.03`: AZSF 95.9M + EDEN
30.4M — proven intercompany by the client's own `BS EDEN EJE` elimination tab). The
app has **zero consolidation logic**.

The client's OWN consolidated balance sheet (`Reporting 2026.xlsx` → tab `BS`,
"Consolidated Balance Sheet", in **thousands**) = **253M (April 2026)**. We currently
SKIP this tab on import (role=derived_summary).

## Decision

Show the client's **official consolidated BS verbatim** on the holding entity. Do NOT
compute eliminations ourselves (money-risk) — use their authoritative numbers.

**Money-safety proof (already verified):** the 24 leaf lines of the `BS` tab, ×1000,
sum to the official subtotals to the manat:
- assets 253,320,381 vs 253,320,000 ✅ · equity −217,877,637 vs −217,878,000 ✅ ·
  liabilities −35,442,743 vs −35,443,000 ✅

## Constraints found in the source

- The consolidated `BS` tab is **label-only (no BS.xx codes)**, **3 months only**
  (2026-04, 2026-03, 2025-12), **in thousands**.
- No clean coded/monthly consolidated source exists (`BS Actual` is stacked = 361M when
  summed; `BS Data` is a 153K-row GL whose consolidation = self-computation = risk).
- The existing CoA is inconsistent (org-level `BS.xx` + entity-prefixed
  `AZSEKER-EDEN-BS.xx`) → fuzzy name-matching is unsafe.

## Architecture

Four units, each with one responsibility.

### 1. Consolidated CoA seed — `scripts/seed-consolidated-bs-accounts.ts`
Idempotent upsert of the **24 consolidated accounts** (one per official `BS` leaf):
exact official label as `name`, correct `accountType` (asset/equity/liability), code
namespace `CONS.BS.<nn>`, `organizationId`. These are distinct from the children's
granular per-entity accounts. Self-contained = the holding's consolidated statement maps
1:1 to the official tab, no reuse of the inconsistent existing CoA.

### 2. Adapter — `src/lib/onboarding/ai-import/adapters/azseker-consolidated-bs.ts`
- Input: the `BS` worksheet. Output: BalanceSheetLine rows for the holding.
- Parse the date row → month columns; for each available month, read the 24 leaves.
- **Section by position:** rows above EQUITY = asset; EQUITY block = equity; below =
  liability. Exclude the 7 subtotal rows (ASSETS / CURRENT ASSETS / Inventories /
  EQUITY / LIABILITIES / NON-CURRENT LIABILITIES / CURRENT LIABILITIES).
- **Unit conversion:** ×1000 (thousands → manat), applied once, explicit.
- **HARD reconciliation guard (money net):** after parse, for each month
  Σ(asset leaves) must equal the official ASSETS subtotal (±1 manat/rounding), same for
  equity + liability. On mismatch → THROW (abort import). Never store a mis-parsed BS.
- Map each leaf → its `CONS.BS.<nn>` account (deterministic table in the adapter).

### 3. Routing — `reporting-pack-sheet-map.ts` + orchestrator
- Change `{ match: "BS", role: "derived_summary" }` → route the consolidated `BS` tab to
  the holding entity (reuse `HOLDING_ENTITY_SENTINEL`), planKind=actual, via the new
  adapter. This is the #1-risk import-path change → Codex review.
- The per-entity `BS <co>` tabs (Guvven) are unaffected — children keep standalone BS.

### 4. View aggregation — `src/app/api/budgeting/balance-sheet/route.ts`
- Today: sums ALL lines of the plan across all companies. Adding holding lines on top of
  children would double-count (253M + 339M).
- New rule (backward-compatible): **if the plan has BS lines on the level-1 holding
  company, the default/holding view returns ONLY those (the consolidated 253M).** Add an
  optional `?companyId=` param → that company's standalone lines (drill-down). No param +
  no holding lines → sum-all (current behavior preserved for other orgs).
- Provenance in the response: `meta.consolidated = true` + source label so the UI can
  badge "Official consolidated — source: Reporting 2026".

### 5. UI — `src/components/budget-balance-sheet.tsx`
- When `meta.consolidated`, badge the view "Консолидированный (официальный)" + note the
  3 available months. Standalone child sum labelled as pre-consolidation drill-down.
- Minimal change; the existing cards/chart/donut/table render the holding's lines as-is
  (they group by accountType + account.name, which the consolidated accounts provide).

## Limitations (disclosed)
- Consolidated data is **3 months only** (the client publishes the summary for those
  dates). Monthly consolidation would require self-computation (rejected = money-risk).
- The consolidated composition uses the official taxonomy (e.g. "Property, Plant and
  Equipment") which differs from the children's labels ("Tangible Assets") — expected,
  they are different statements.

## Test plan
- Adapter unit: parses the real `BS` tab → 24 leaves × 3 months; Σ per type = official
  subtotals; ×1000 applied; reconciliation guard THROWS on a tampered fixture.
- Seed: idempotent (run twice → 24 accounts, no dupes).
- Route: holding-lines-present → returns consolidated only (253M, not 592M);
  `?companyId=child` → standalone; no holding lines → sum-all (back-compat).
- E2E: reset → import Reporting+Guvven → holding BS = 253M, child drill-down intact,
  no double-count.

## Out of scope
- Monthly consolidation, intercompany AR/AP drill-down, CONS P&L (separate follow-up).
