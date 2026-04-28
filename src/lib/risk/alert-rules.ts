/**
 * Phase C6 (Bloomberg uplift plan) — multi-indicator alert rules engine.
 *
 * A "rule" is a named predicate that scans the current matrix snapshot
 * (companies × indicators × cells) and returns zero or more matches.
 * Each match is a structured alert with severity, human message, and
 * pointers to the offending entities (companyIds + indicatorCodes) so
 * the UI can navigate the user directly to the trouble spot.
 *
 * Plan §C6 quote: "≥3 amber in a sector → red rollup". This module
 * generalises that pattern: a rule is data + predicate, the engine is
 * a stateless `evaluateAlertRules(rules, ctx) → AlertMatch[]` that
 * runs every rule against every (company, sector) cross-section and
 * returns the union of matches.
 *
 * v1 ships 5 default rules covering the common Bloomberg-style patterns:
 *   - companyMostlyRed: company has N+ red indicators
 *   - companyCriticalComposite: composite score < threshold
 *   - sectorAmberCluster: industry has N+ amber cells across companies
 *   - sectorRedSpread: industry has N+ red cells (more urgent)
 *   - criticalIndicatorOrgWide: a key indicator is red for N+ companies
 *
 * UI integration is a separate concern — this module is pure data + logic.
 * Tests lock the rule semantics so future calibration tweaks don't drift
 * silently.
 */

import type { HeatMapCell } from './heatmap-matrix';
import { computeCompositeScore } from './composite-score';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertCompany {
  id: string;
  code: string;
  name: string;
  industry?: string | null;
  isSubgroup?: boolean;
}

export interface AlertIndicator {
  id: string;
  code: string;
}

export interface AlertContext {
  companies: readonly AlertCompany[];
  indicators: readonly AlertIndicator[];
  cells: readonly HeatMapCell[];
  /**
   * Optional pre-built index from `companyId` → that company's non-rollup
   * cells. Populated by `evaluateAlertRules` exactly once per call (so
   * each rule's `match` doesn't re-walk the full cells array). Callers
   * who construct an `AlertContext` manually can omit this — the
   * `cellsForCompany` helper falls back to a linear filter. Phase F
   * matters here: 60 cos × 80 inds × 5 rules = 24K filter passes per
   * evaluation without the index, vs 5 × 4800 + 1 × 4800 = 28K ops
   * with it. Architect Round-1 sub-9 flag.
   */
  cellsByCompany?: ReadonlyMap<string, readonly HeatMapCell[]>;
}

export interface AlertMatch {
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  /** Human-readable message; safe to render directly in UI. */
  message: string;
  /** Companies the user should drill into to investigate. */
  affectedCompanyIds: readonly string[];
  /** Indicator codes that triggered the alert (when applicable). */
  affectedIndicatorCodes?: readonly string[];
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  /**
   * In-severity sort tiebreaker. Lower = more urgent within the same
   * severity tier. CRO-mental-model priority: sector contagion (10)
   * runs ahead of org-wide-indicator (20) ahead of single-company
   * problems (30+) within `critical`. Engine falls back to alphabetic
   * `ruleName` when priorities tie. Default 100 — set explicitly per rule.
   */
  priority: number;
  /**
   * Returns zero or more matches. Pure function — caller treats output
   * as immutable. Returning an empty array means "rule did not trigger".
   */
  match: (ctx: AlertContext) => AlertMatch[];
}

/**
 * Evaluate every rule against the given context, return the flat union
 * of all matches sorted by severity (critical → warning → info), then
 * by `priority` (lower first) within severity, then by `ruleName`
 * (alphabetic) for stable determinism on tied priorities.
 */
export function evaluateAlertRules(
  rules: readonly AlertRule[],
  ctx: AlertContext,
): AlertMatch[] {
  const ruleMeta = new Map<string, { priority: number }>();
  for (const r of rules) ruleMeta.set(r.id, { priority: r.priority });
  // Pre-index cells by companyId once (filtering rollup rows) so each
  // rule's `match(ctx)` can read company-scoped cells in O(1) lookups
  // instead of O(N) per call. Architect Round-1 sub-9 closure: at
  // Phase F (60 cos × 80 inds × 5 rules) the index saves ~1.4M ops
  // per evaluation vs the per-rule filter pattern.
  const indexed: AlertContext = ctx.cellsByCompany
    ? ctx
    : { ...ctx, cellsByCompany: buildCellsByCompany(ctx.cells) };
  const out: AlertMatch[] = [];
  for (const rule of rules) {
    const matches = rule.match(indexed);
    out.push(...matches);
  }
  return out.sort((a, b) => {
    const severityRank = (s: AlertSeverity): number =>
      s === 'critical' ? 0 : s === 'warning' ? 1 : 2;
    const sd = severityRank(a.severity) - severityRank(b.severity);
    if (sd !== 0) return sd;
    const pa = ruleMeta.get(a.ruleId)?.priority ?? 100;
    const pb = ruleMeta.get(b.ruleId)?.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return a.ruleName.localeCompare(b.ruleName);
  });
}

/**
 * Build a `companyId → non-rollup cells` index in a single linear pass.
 * Used by `evaluateAlertRules` to amortize the filter across every rule
 * that reads the same context (architect Round-1 sub-9 closure).
 */
function buildCellsByCompany(
  cells: readonly HeatMapCell[],
): ReadonlyMap<string, readonly HeatMapCell[]> {
  const out = new Map<string, HeatMapCell[]>();
  for (const c of cells) {
    if (c.isSubgroupRollup) continue;
    const list = out.get(c.companyId);
    if (list) list.push(c);
    else out.set(c.companyId, [c]);
  }
  return out;
}

/**
 * Helper: get cells belonging to a given company id, excluding rollup
 * rows (Phase C5 composite contract). Reads the pre-built index when
 * present (engine populates it once per `evaluateAlertRules` call) and
 * falls back to a linear filter for direct callers (e.g. unit tests
 * exercising a single rule's `match`).
 */
function cellsForCompany(
  ctx: AlertContext,
  companyId: string,
): readonly HeatMapCell[] {
  if (ctx.cellsByCompany) {
    return ctx.cellsByCompany.get(companyId) ?? [];
  }
  return ctx.cells.filter(
    (c) => c.companyId === companyId && !c.isSubgroupRollup,
  );
}

// ────────────────────────────────────────────────────────────────────────
// Default rule pack
// ────────────────────────────────────────────────────────────────────────

export const RULE_COMPANY_MOSTLY_RED: AlertRule = {
  id: 'company-mostly-red',
  name: 'Company has 3+ red indicators',
  description:
    'Flags companies with three or more red indicators — typical signal of a struggling sub-co needing executive attention.',
  severity: 'critical',
  priority: 30,
  match(ctx) {
    const out: AlertMatch[] = [];
    for (const co of ctx.companies) {
      if (co.isSubgroup) continue;
      const redCells = cellsForCompany(ctx, co.id).filter(
        (c) => c.status === 'red',
      );
      if (redCells.length >= 3) {
        const indicatorIdToCode = new Map(
          ctx.indicators.map((i) => [i.id, i.code]),
        );
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${co.code} has ${redCells.length} red indicators — needs review`,
          affectedCompanyIds: [co.id],
          affectedIndicatorCodes: redCells
            .map((c) => indicatorIdToCode.get(c.indicatorId))
            .filter((code): code is string => typeof code === 'string'),
        });
      }
    }
    return out;
  },
};

export const RULE_COMPANY_CRITICAL_COMPOSITE: AlertRule = {
  id: 'company-critical-composite',
  name: 'Composite score below 40',
  description:
    'Flags companies whose composite risk score (Phase C5) is below 40 — overall poor health regardless of which specific indicators are red.',
  severity: 'critical',
  priority: 40,
  match(ctx) {
    const out: AlertMatch[] = [];
    for (const co of ctx.companies) {
      if (co.isSubgroup) continue;
      const cells = cellsForCompany(ctx, co.id);
      const composite = computeCompositeScore(cells);
      if (composite.score !== null && composite.score < 40) {
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${co.code} composite score ${composite.score}/100 (${composite.contributingCount}/${composite.totalCount} indicators)`,
          affectedCompanyIds: [co.id],
        });
      }
    }
    return out;
  },
};

export const RULE_SECTOR_AMBER_CLUSTER: AlertRule = {
  id: 'sector-amber-cluster',
  name: 'Sector has 5+ amber cells',
  description:
    'Flags industries where amber cells aggregate across multiple companies — suggests sector-wide stress (FX, commodity, regulatory) rather than single-company issues.',
  severity: 'warning',
  priority: 10,
  match(ctx) {
    const out: AlertMatch[] = [];
    const byIndustry = new Map<string, { companyIds: Set<string>; amberCount: number }>();
    for (const co of ctx.companies) {
      if (co.isSubgroup || !co.industry) continue;
      const amberCells = cellsForCompany(ctx, co.id).filter(
        (c) => c.status === 'amber',
      );
      if (amberCells.length === 0) continue;
      let bucket = byIndustry.get(co.industry);
      if (!bucket) {
        bucket = { companyIds: new Set(), amberCount: 0 };
        byIndustry.set(co.industry, bucket);
      }
      bucket.companyIds.add(co.id);
      bucket.amberCount += amberCells.length;
    }
    for (const [industry, bucket] of byIndustry) {
      if (bucket.amberCount >= 5) {
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${industry} sector: ${bucket.amberCount} amber cells across ${bucket.companyIds.size} companies`,
          affectedCompanyIds: Array.from(bucket.companyIds),
        });
      }
    }
    return out;
  },
};

export const RULE_SECTOR_RED_SPREAD: AlertRule = {
  id: 'sector-red-spread',
  name: 'Sector has 3+ red cells across multiple companies',
  description:
    'Flags industries where red cells appear in 2+ companies — suggests sector contagion rather than isolated company problem.',
  severity: 'critical',
  priority: 10,
  match(ctx) {
    const out: AlertMatch[] = [];
    const byIndustry = new Map<string, { companyIds: Set<string>; redCount: number }>();
    for (const co of ctx.companies) {
      if (co.isSubgroup || !co.industry) continue;
      const redCells = cellsForCompany(ctx, co.id).filter(
        (c) => c.status === 'red',
      );
      if (redCells.length === 0) continue;
      let bucket = byIndustry.get(co.industry);
      if (!bucket) {
        bucket = { companyIds: new Set(), redCount: 0 };
        byIndustry.set(co.industry, bucket);
      }
      bucket.companyIds.add(co.id);
      bucket.redCount += redCells.length;
    }
    for (const [industry, bucket] of byIndustry) {
      if (bucket.redCount >= 3 && bucket.companyIds.size >= 2) {
        out.push({
          ruleId: this.id,
          ruleName: this.name,
          severity: this.severity,
          message: `${industry} sector: ${bucket.redCount} red cells across ${bucket.companyIds.size} companies — possible contagion`,
          affectedCompanyIds: Array.from(bucket.companyIds),
        });
      }
    }
    return out;
  },
};

export const RULE_CRITICAL_INDICATOR_ORG_WIDE: AlertRule = {
  id: 'critical-indicator-org-wide',
  name: 'Net margin red for 3+ companies',
  description:
    'Flags org-wide net-margin pressure: if 3+ companies have IND_NET_MARGIN red, the holding has a profitability problem at the consolidated level.',
  severity: 'critical',
  priority: 20,
  match(ctx) {
    const target = ctx.indicators.find((i) => i.code === 'IND_NET_MARGIN');
    if (!target) return [];
    const redCells = ctx.cells.filter(
      (c) =>
        c.indicatorId === target.id &&
        c.status === 'red' &&
        !c.isSubgroupRollup,
    );
    if (redCells.length < 3) return [];
    const uniqueCompanyIds = Array.from(
      new Set(redCells.map((c) => c.companyId)),
    );
    return [
      {
        ruleId: this.id,
        ruleName: this.name,
        severity: this.severity,
        message: `IND_NET_MARGIN red for ${uniqueCompanyIds.length} companies — consolidated profitability under pressure`,
        affectedCompanyIds: uniqueCompanyIds,
        affectedIndicatorCodes: ['IND_NET_MARGIN'],
      },
    ];
  },
};

/**
 * Default rule pack shipped with the engine. Customers can override or
 * extend by passing their own `AlertRule[]` to `evaluateAlertRules`.
 */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  RULE_COMPANY_MOSTLY_RED,
  RULE_COMPANY_CRITICAL_COMPOSITE,
  RULE_SECTOR_RED_SPREAD,
  RULE_SECTOR_AMBER_CLUSTER,
  RULE_CRITICAL_INDICATOR_ORG_WIDE,
];
