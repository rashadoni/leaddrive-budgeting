/**
 * Recompute pipeline — BudgetLine sub-aggregation matchers.
 *
 * Phase 8 D1 (2026-05-29) — extracted from `recompute.ts` to shrink the core
 * engine file. The matcher system classifies BudgetLine rows into named
 * buckets (R&D, inventory, debt-service, feed, seasonal revenue, …) for the
 * `budget_line.<sub>` namespace. Pure: every matcher reads only line fields
 * (accountCode / accountName / amountBase) — no DB, no side effects. The
 * budgetLine resolver in `recompute.ts` imports `SUB_AGGREGATION_MATCHERS` +
 * `applyBudgetLineSubMatcher` back, so behaviour is unchanged.
 */

import type { BudgetLineRow, BudgetLineSubAggregation } from './recompute-types';

// --- BudgetLine sub-aggregation matchers -------------------------------------
// Each matcher returns `{ accept, matchedBy }` per line. The driver below
// applies the matcher across all lines and produces a SubAggregation. This
// shape is deliberately verbose so the heuristics are inspectable in tests.

interface SubMatcher {
  /** Decides whether a line is in the bucket. The string returned identifies
   *  WHICH heuristic fired (`category` / `code_prefix` / `name` / `accountType`)
   *  for drill-down attribution. Return null to reject. */
  test(line: BudgetLineRow): string | null;
  /** Reduce amounts. Default = sum. Override for HHI / max / etc. */
  reduce?(samples: Array<{ line: BudgetLineRow; amountBase: number }>): number;
  /**
   * Optional validity gate AFTER lines have been collected. Used by
   * `revenueBySeason` to demand ≥ 3 distinct months — otherwise the
   * "top-3-month share" formula degenerates to 100% trivially. When this
   * returns false, the driver forces `matched_count=0` so the indicator
   * cleanly resolves to `unknown` (downstream formula sees missing var).
   * Skipping `isValid` keeps the existing behavior: matched_count = number
   * of `test()` accepts.
   */
  isValid?(samples: Array<{ line: BudgetLineRow; amountBase: number }>): boolean;
}

const startsWithCode = (line: BudgetLineRow, prefix: string): boolean =>
  line.accountCode != null && line.accountCode.startsWith(prefix);

const nameIncludes = (line: BudgetLineRow, needle: string): boolean =>
  line.accountName != null &&
  line.accountName.toLowerCase().includes(needle);

/**
 * Sub-aggregation matchers, keyed by the suffix in `budgetLine.<sub>`.
 *
 * Heuristic ladder for code-pattern-driven matchers (rd_spend, inventory,
 * debt_service, feed_cost): explicit `category` tag → SAP code prefix →
 * lowercase name substring. First hit wins — surfaced via `matched_by`
 * so users see whether they're getting an explicit tag or a fallback.
 *
 * `revenue_line_hhi` is a structural matcher (HHI on per-code revenue),
 * not a content one — implemented inline in `applyBudgetLineSubMatcher`.
 *
 * `revenueBySeason` (Phase 7.E perMonth chain phase 1, 2026-04-30) reads
 * monthly distribution from the existing 12-row-per-line persistence
 * (every import path writes 12 BudgetLine rows per parsed line, each
 * carrying one month's value, with `sortOrder` 0..11 = month index).
 * `monthIndex` on the row shape mirrors `sortOrder`; the matcher
 * groups revenue by month and uses the optional `isValid` gate to
 * reject degenerate <3-month plans (would falsely compute as 100% top-3
 * concentration).
 */
export const SUB_AGGREGATION_MATCHERS: Record<string, SubMatcher> = {
  rd_spend: {
    test(line) {
      if (line.accountCategory === 'rd' || line.accountCategory === 'r_and_d')
        return 'category';
      if (startsWithCode(line, '720')) return 'code_prefix';
      if (
        nameIncludes(line, 'r&d') ||
        nameIncludes(line, 'research') ||
        nameIncludes(line, 'r and d') ||
        nameIncludes(line, 'нир') ||
        nameIncludes(line, 'ниокр')
      )
        return 'name';
      return null;
    },
  },
  inventory: {
    // **Functionally dormant until balance-sheet ingest lands.** This
    // matcher requires `accountType='asset'` because inventory is a
    // balance, not a P&L flow. The current P&L ingest paths
    // (`/api/onboarding/import/budget` + AI Mapper `applier.ts`) write
    // only revenue/cogs/expense rows from P&L sheets — there are no
    // `accountType='asset'` BudgetLine rows in production data today.
    // PHARMA_INVENTORY_DAYS / FP_INVENTORY_TURNS therefore land as
    // `unknown` until either (a) a balance-sheet xlsx ingest lands, or
    // (b) finance teams start authoring asset-balance lines through the
    // future onboarding wizard. The matcher is correct; the upstream
    // data is the missing piece. Tracked in CARRYOVER as a follow-up.
    test(line) {
      if (line.accountType !== 'asset') return null;
      if (line.accountCategory === 'inventory') return 'category';
      if (startsWithCode(line, '103')) return 'code_prefix';
      if (
        nameIncludes(line, 'inventory') ||
        nameIncludes(line, 'запас') ||
        nameIncludes(line, 'материал')
      )
        return 'name';
      return null;
    },
  },
  debt_service: {
    test(line) {
      // Hard gate: debt service is an EXPENSE outflow, never a revenue
      // line. Without this, an "Interest Income" revenue line would
      // pollute the denominator of RE_DEBT_SERVICE_COVERAGE
      // (gross_profit / debt_service) and silently inflate coverage.
      if (line.accountType !== 'expense') return null;
      if (line.accountCategory === 'debt_service') return 'category';
      // No SAP-prefix heuristic for debt service — 75x is staff in our
      // CoA. Names are the reliable signal.
      if (
        nameIncludes(line, 'interest') ||
        nameIncludes(line, 'debt service') ||
        nameIncludes(line, 'debt-service') ||
        nameIncludes(line, 'процент') ||
        nameIncludes(line, 'обслуж') // обслуживание долга
      )
        return 'name';
      return null;
    },
  },
  feed_cost: {
    test(line) {
      if (line.accountType !== 'cogs') return null;
      if (line.accountCategory === 'feed') return 'category';
      // Poultry CoA template puts Feed at code 711 — but so does every
      // other industry (711 = first cogs line). Disambiguate via name to
      // avoid a false positive on "Raw Materials" / "Active Ingredients".
      if (
        nameIncludes(line, 'feed') ||
        nameIncludes(line, 'корм')
      )
        return 'name';
      return null;
    },
  },
  revenue_line_hhi: {
    test(line) {
      // Filter to revenue lines; the actual HHI math runs in `reduce`.
      if (line.accountType !== 'revenue') return null;
      return 'accountType';
    },
    reduce(samples) {
      if (samples.length === 0) return 0;
      // Group by accountCode (or fallback to accountName / line index for
      // un-coded legacy rows). Each unique key contributes one share.
      const byKey = new Map<string, number>();
      let i = 0;
      let total = 0;
      for (const s of samples) {
        const key =
          s.line.accountCode ??
          s.line.accountName ??
          `__line_${i++}`;
        byKey.set(key, (byKey.get(key) ?? 0) + s.amountBase);
        total += s.amountBase;
      }
      if (total <= 0) return 0;
      let hhi = 0;
      for (const v of byKey.values()) {
        const pct = (v / total) * 100;
        hhi += pct * pct;
      }
      return hhi;
    },
  },
  /**
   * **`budgetLine.revenueBySeason`** — top-3-month revenue concentration.
   *
   * Aggregates revenue lines by `monthIndex` (0..11), then returns the
   * share of annual revenue that lands in the 3 highest-grossing months
   * (range 25.0..100.0 since at least 3/12=25% can't be avoided).
   *
   * Used by `ENT_SEASONALITY_CONCENTRATION`:
   *   - Green ≤ 40 — well-diversified across the year
   *   - Amber ≤ 55 — peak quarter dominates (theme parks, ski resorts)
   *   - Red  > 55 — single bad season kills the year
   *
   * **Skip semantics** — lines without `monthIndex` (legacy single-row
   * imports / rollup-sourced flat splits) are excluded. If FEWER than 3
   * distinct months carry revenue, the indicator returns `unknown` (the
   * resolver wraps null in matched_count=0). Avoids false-100% from a
   * one-month dataset.
   */
  revenueBySeason: {
    test(line) {
      if (line.accountType !== 'revenue') return null;
      // Only monthly-distributed rows participate. Non-monthly rows
      // (rollup sources, legacy single-row plans) can't say which month
      // — bucketing them into month 0 would create fake January spikes.
      if (line.monthIndex === null) return null;
      return 'monthIndex';
    },
    /**
     * Reject the aggregation entirely if revenue lands in fewer than
     * 3 distinct months — "top-3-month share" trivially evaluates to
     * 100% with 1-2 months and a `green` ENT_SEASONALITY_CONCENTRATION
     * read on a degenerate dataset would be a false-positive. The driver
     * forces matched_count=0 in this case, which makes the indicator
     * resolve to `unknown` rather than a misleading green.
     */
    isValid(samples) {
      // Count months that carry NON-ZERO revenue. Edge case the test
      // exposed: monthlyRevenue helper creates 12 rows even for a single-
      // month plan (11 zero-amount rows + 1 with the full annual). All 12
      // pass `test()` because they have monthIndex+revenue accountType,
      // but the operational reality is "revenue arrives in 1 month" —
      // top-3-share would falsely compute as 100% (all-rev top 3 = total).
      // Filter zero-amount rows here so the structural gate matches the
      // economic intent.
      const monthsWithRevenue = new Set<number>();
      let total = 0;
      for (const s of samples) {
        if (s.line.monthIndex !== null && s.amountBase > 0) {
          monthsWithRevenue.add(s.line.monthIndex);
        }
        total += s.amountBase;
      }
      return monthsWithRevenue.size >= 3 && total > 0;
    },
    reduce(samples) {
      if (samples.length === 0) return 0;
      const byMonth = new Map<number, number>();
      let total = 0;
      for (const s of samples) {
        const m = s.line.monthIndex!;
        byMonth.set(m, (byMonth.get(m) ?? 0) + s.amountBase);
        total += s.amountBase;
      }
      // isValid already gated; reduce can assume ≥3 months + total>0.
      // Belt-and-braces: keep the guards in case isValid is bypassed.
      if (byMonth.size < 3 || total <= 0) return 0;
      // Top 3 months by absolute revenue.
      const sorted = Array.from(byMonth.values()).sort((a, b) => b - a);
      const top3 = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
      return (top3 / total) * 100;
    },
  },
};

export function applyBudgetLineSubMatcher(
  matcher: SubMatcher,
  validLines: Array<{ line: BudgetLineRow; amountBase: number }>,
): BudgetLineSubAggregation {
  const matchedSamples: Array<{
    line: BudgetLineRow;
    amountBase: number;
    by: string;
  }> = [];
  for (const v of validLines) {
    const by = matcher.test(v.line);
    if (by) matchedSamples.push({ ...v, by });
  }
  // Optional post-collection validity gate. When isValid returns false,
  // the indicator falls through to `unknown` because matched_count=0
  // suppresses `state.context.<sub>` set at the resolver level. Used
  // for sub-aggregations whose math degenerates without a minimum
  // structural condition (e.g. revenueBySeason needs ≥ 3 months).
  const valid = matcher.isValid ? matcher.isValid(matchedSamples) : true;
  const value = valid
    ? matcher.reduce != null
      ? matcher.reduce(matchedSamples)
      : matchedSamples.reduce((a, s) => a + s.amountBase, 0)
    : 0;
  // Top-3 by absolute amount for drill-down. Stable sort — preserve input
  // order on ties so identical lines don't shuffle between recomputes.
  const topLines = [...matchedSamples]
    .sort((a, b) => Math.abs(b.amountBase) - Math.abs(a.amountBase))
    .slice(0, 3)
    .map((s) => ({
      code: s.line.accountCode,
      name: s.line.accountName,
      amount: s.amountBase,
    }));
  const matchedByCounts = new Map<string, number>();
  for (const s of matchedSamples) {
    matchedByCounts.set(s.by, (matchedByCounts.get(s.by) ?? 0) + 1);
  }
  // Sort `matched_by` so its serialization is deterministic for tests +
  // diff-friendly snapshots.
  const matchedBy = Array.from(matchedByCounts.keys()).sort();
  return {
    value,
    // When isValid rejects, force matched_count=0 so the resolver
    // doesn't set `state.context[sub]` and the formula resolves to
    // `unknown` cleanly. Top-lines + matched-by are still surfaced for
    // drill-down — operators see WHICH lines were collected even when
    // the structural gate rejected the aggregation.
    matched_count: valid ? matchedSamples.length : 0,
    top_lines: topLines,
    matched_by: matchedBy,
  };
}
