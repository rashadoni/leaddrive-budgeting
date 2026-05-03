/**
 * Phase C6 — alert-rules engine tests.
 *
 * Locks the semantics of each default rule + the engine's sort order
 * (critical first, alphabetic within severity).
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ALERT_RULES,
  RULE_COMPANY_MOSTLY_RED,
  RULE_COMPANY_CRITICAL_COMPOSITE,
  RULE_SECTOR_AMBER_CLUSTER,
  RULE_SECTOR_RED_SPREAD,
  RULE_CRITICAL_INDICATOR_ORG_WIDE,
  evaluateAlertRules,
  type AlertContext,
  type AlertCompany,
  type AlertIndicator,
} from './alert-rules';
import {
  DEFAULT_ALERT_THRESHOLDS,
  mergeWithDefaults,
  type ResolvedAlertThresholds,
} from './alert-thresholds-config';
import type { HeatMapCell } from './heatmap-matrix';

function company(
  id: string,
  code: string,
  industry?: string | null,
  isSubgroup = false,
): AlertCompany {
  return { id, code, name: code, industry, isSubgroup };
}

function indicator(id: string, code: string): AlertIndicator {
  return { id, code };
}

function cell(
  companyId: string,
  indicatorId: string,
  status: HeatMapCell['status'],
  isSubgroupRollup = false,
): HeatMapCell {
  return {
    companyId,
    indicatorId,
    value: 0,
    status,
    // Sub-44 cont'd architect 💡 closure — discriminated-union shape
    // (`kind: 'synthetic-rollup'` replaces the legacy `isSubgroupRollup`
    // boolean). Helper signature kept for back-compat with existing
    // tests; bool→kind translation lives here in one site.
    ...(isSubgroupRollup ? { kind: 'synthetic-rollup' as const } : {}),
  };
}

const IND_GROSS = indicator('ind_gross', 'IND_GROSS_MARGIN');
const IND_NET = indicator('ind_net', 'IND_NET_MARGIN');
const IND_OPEX = indicator('ind_opex', 'IND_OPEX_RATIO');
const IND_FX = indicator('ind_fx', 'FX_IMPORTED_INPUT');

describe('RULE_COMPANY_MOSTLY_RED (Phase C6)', () => {
  it('triggers when company has 3+ red indicators', () => {
    const ctx: AlertContext = {
      companies: [company('co_aac', 'AAC-MAIN')],
      indicators: [IND_GROSS, IND_NET, IND_OPEX, IND_FX],
      cells: [
        cell('co_aac', 'ind_gross', 'red'),
        cell('co_aac', 'ind_net', 'red'),
        cell('co_aac', 'ind_opex', 'red'),
        cell('co_aac', 'ind_fx', 'green'),
      ],
    };
    const matches = RULE_COMPANY_MOSTLY_RED.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(1);
    expect(matches[0].severity).toBe('critical');
    expect(matches[0].affectedCompanyIds).toEqual(['co_aac']);
    expect(matches[0].affectedIndicatorCodes?.length).toBe(3);
    expect(matches[0].message).toContain('AAC-MAIN');
    expect(matches[0].message).toContain('3 red');
  });

  it('does NOT trigger at 2 red indicators (below threshold)', () => {
    const ctx: AlertContext = {
      companies: [company('co_aac', 'AAC-MAIN')],
      indicators: [IND_GROSS, IND_NET],
      cells: [
        cell('co_aac', 'ind_gross', 'red'),
        cell('co_aac', 'ind_net', 'red'),
      ],
    };
    expect(RULE_COMPANY_MOSTLY_RED.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });

  it('skips sub-group rows (isSubgroup flag)', () => {
    const ctx: AlertContext = {
      companies: [company('sg', 'SG', 'Industrial', true)],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        cell('sg', 'ind_gross', 'red', true),
        cell('sg', 'ind_net', 'red', true),
        cell('sg', 'ind_opex', 'red', true),
      ],
    };
    expect(RULE_COMPANY_MOSTLY_RED.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });

  it("sub-44 cont'd: skips REAL parent-co rollup IVs (isRealParentRollup flag — gate-via-isAggregateRollup)", () => {
    // Sub-44 cont'd render-path emits parent-co rollup IVs as cells with
    // `isRealParentRollup: true`. Alert rules MUST skip these — sub-group
    // (parent) rows are navigation aggregates, not measurable entities.
    // Without the isAggregateRollup gate, a sub-group with 3 real-rollup
    // red cells would silently fire RULE_COMPANY_MOSTLY_RED, double-
    // counting the same risk that already fired on its children.
    const ctx: AlertContext = {
      companies: [company('sg', 'AAC', 'Industrial', true)],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        // 3 real parent-co rollup cells, all red. WOULD trip
        // RULE_COMPANY_MOSTLY_RED if not filtered (threshold = 3 reds).
        {
          companyId: 'sg',
          indicatorId: 'ind_gross',
          value: 0,
          status: 'red',
          kind: 'real-rollup' as const,
          indicatorValueId: 'iv_real_1',
        },
        {
          companyId: 'sg',
          indicatorId: 'ind_net',
          value: 0,
          status: 'red',
          kind: 'real-rollup' as const,
          indicatorValueId: 'iv_real_2',
        },
        {
          companyId: 'sg',
          indicatorId: 'ind_opex',
          value: 0,
          status: 'red',
          kind: 'real-rollup' as const,
          indicatorValueId: 'iv_real_3',
        },
      ],
    };
    expect(
      RULE_COMPANY_MOSTLY_RED.match(ctx, DEFAULT_ALERT_THRESHOLDS),
    ).toHaveLength(0);
  });

  it('triggers separately for each company over the threshold', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A'),
        company('co_b', 'B'),
      ],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_opex', 'red'),
        cell('co_b', 'ind_gross', 'red'),
        cell('co_b', 'ind_net', 'red'),
        cell('co_b', 'ind_opex', 'red'),
      ],
    };
    const matches = RULE_COMPANY_MOSTLY_RED.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.affectedCompanyIds[0]).sort()).toEqual([
      'co_a',
      'co_b',
    ]);
  });
});

describe('RULE_COMPANY_CRITICAL_COMPOSITE (Phase C6)', () => {
  it('triggers when composite score < 40', () => {
    // 1 green + 2 red = avg (100+0+0)/3 = 33 → below 40
    const ctx: AlertContext = {
      companies: [company('co_aac', 'AAC-MAIN')],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        cell('co_aac', 'ind_gross', 'green'),
        cell('co_aac', 'ind_net', 'red'),
        cell('co_aac', 'ind_opex', 'red'),
      ],
    };
    const matches = RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(1);
    expect(matches[0].message).toContain('33/100');
  });

  it('does NOT trigger at score = 50 (above threshold)', () => {
    // 1 green + 1 red = avg 50 → at threshold (< 40 only)
    const ctx: AlertContext = {
      companies: [company('co_aac', 'AAC-MAIN')],
      indicators: [IND_GROSS, IND_NET],
      cells: [
        cell('co_aac', 'ind_gross', 'green'),
        cell('co_aac', 'ind_net', 'red'),
      ],
    };
    expect(RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });

  it('does NOT trigger when company has no scoreable cells', () => {
    const ctx: AlertContext = {
      companies: [company('co_aac', 'AAC-MAIN')],
      indicators: [IND_GROSS],
      cells: [cell('co_aac', 'ind_gross', 'unknown')],
    };
    expect(RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });
});

describe('RULE_SECTOR_AMBER_CLUSTER (Phase C6)', () => {
  it('triggers when industry has 5+ amber cells', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Industrial'),
      ],
      indicators: [IND_GROSS, IND_NET, IND_OPEX, IND_FX],
      cells: [
        cell('co_a', 'ind_gross', 'amber'),
        cell('co_a', 'ind_net', 'amber'),
        cell('co_a', 'ind_opex', 'amber'),
        cell('co_b', 'ind_gross', 'amber'),
        cell('co_b', 'ind_net', 'amber'),
      ],
    };
    const matches = RULE_SECTOR_AMBER_CLUSTER.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(1);
    expect(matches[0].severity).toBe('warning');
    expect(matches[0].message).toContain('Industrial');
    expect(matches[0].message).toContain('5');
  });

  it('separates rules by industry', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Hospitality'),
      ],
      indicators: [IND_GROSS, IND_NET, IND_OPEX, IND_FX],
      cells: [
        cell('co_a', 'ind_gross', 'amber'),
        cell('co_a', 'ind_net', 'amber'),
        cell('co_a', 'ind_opex', 'amber'),
        cell('co_a', 'ind_fx', 'amber'),
        cell('co_a', 'ind_gross', 'amber'),
        cell('co_b', 'ind_gross', 'amber'),
        cell('co_b', 'ind_net', 'amber'),
      ],
    };
    const matches = RULE_SECTOR_AMBER_CLUSTER.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    // Industrial = 5 ambers (with dup) → triggers; Hospitality = 2 → no
    expect(matches).toHaveLength(1);
    expect(matches[0].message).toContain('Industrial');
  });

  it('skips companies with no industry', () => {
    const ctx: AlertContext = {
      companies: [company('co_a', 'A', null)],
      indicators: [IND_GROSS],
      cells: [cell('co_a', 'ind_gross', 'amber')],
    };
    expect(RULE_SECTOR_AMBER_CLUSTER.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });
});

describe('RULE_SECTOR_RED_SPREAD (Phase C6)', () => {
  it('triggers when 3+ red cells across 2+ companies in same sector', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Industrial'),
      ],
      indicators: [IND_GROSS, IND_NET],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_b', 'ind_gross', 'red'),
      ],
    };
    const matches = RULE_SECTOR_RED_SPREAD.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(1);
    expect(matches[0].severity).toBe('critical');
    expect(matches[0].message).toContain('contagion');
  });

  it('does NOT trigger when all reds in single company (not spread)', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Industrial'),
      ],
      indicators: [IND_GROSS, IND_NET, IND_OPEX, IND_FX],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_opex', 'red'),
        cell('co_a', 'ind_fx', 'red'),
        cell('co_b', 'ind_gross', 'green'),
      ],
    };
    expect(RULE_SECTOR_RED_SPREAD.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });
});

describe('RULE_CRITICAL_INDICATOR_ORG_WIDE (Phase C6)', () => {
  it('triggers when IND_NET_MARGIN red for 3+ companies', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A'),
        company('co_b', 'B'),
        company('co_c', 'C'),
      ],
      indicators: [IND_NET],
      cells: [
        cell('co_a', 'ind_net', 'red'),
        cell('co_b', 'ind_net', 'red'),
        cell('co_c', 'ind_net', 'red'),
      ],
    };
    const matches = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(1);
    expect(matches[0].affectedIndicatorCodes).toEqual(['IND_NET_MARGIN']);
    expect(matches[0].message).toContain('3 companies');
  });

  it('does NOT trigger if IND_NET_MARGIN not in indicator list', () => {
    const ctx: AlertContext = {
      companies: [company('co_a', 'A')],
      indicators: [IND_GROSS], // no IND_NET_MARGIN
      cells: [cell('co_a', 'ind_gross', 'red')],
    };
    expect(RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });

  it('skips rollup cells (does not double-count sub-group rolled red)', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A'),
        company('co_b', 'B'),
        company('sg', 'SG', null, true),
      ],
      indicators: [IND_NET],
      cells: [
        cell('co_a', 'ind_net', 'red'),
        cell('co_b', 'ind_net', 'red'),
        cell('sg', 'ind_net', 'red', true), // rollup; should not count as 3rd
      ],
    };
    expect(RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
  });
});

describe('evaluateAlertRules (Phase C6 engine)', () => {
  it('returns empty array when no rules match', () => {
    const ctx: AlertContext = {
      companies: [company('co_a', 'A', 'Industrial')],
      indicators: [IND_GROSS],
      cells: [cell('co_a', 'ind_gross', 'green')],
    };
    expect(evaluateAlertRules(DEFAULT_ALERT_RULES, ctx)).toEqual([]);
  });

  it('aggregates matches from multiple rules', () => {
    // Setup that triggers both mostly-red AND critical-composite
    const ctx: AlertContext = {
      companies: [company('co_a', 'A', 'Industrial')],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_opex', 'red'),
      ],
    };
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const ruleIds = matches.map((m) => m.ruleId);
    expect(ruleIds).toContain('company-mostly-red');
    expect(ruleIds).toContain('company-critical-composite');
  });

  it('sorts critical before warning before info', () => {
    // Mock 1 critical + 1 warning rule
    const critRule = {
      ...RULE_COMPANY_MOSTLY_RED,
      match: () =>
        [
          {
            ruleId: 'crit',
            ruleName: 'Z-critical',
            severity: 'critical' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const warnRule = {
      ...RULE_SECTOR_AMBER_CLUSTER,
      match: () =>
        [
          {
            ruleId: 'warn',
            ruleName: 'A-warning',
            severity: 'warning' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const ctx: AlertContext = {
      companies: [],
      indicators: [],
      cells: [],
    };
    const matches = evaluateAlertRules([warnRule, critRule], ctx);
    expect(matches[0].severity).toBe('critical');
    expect(matches[1].severity).toBe('warning');
  });

  it('sorts alphabetically within same severity (when priority ties)', () => {
    const r1 = {
      id: 'r1',
      name: 'r1',
      description: '',
      severity: 'critical' as const,
      priority: 50,
      match: () =>
        [
          {
            ruleId: 'r1',
            ruleName: 'Z-rule',
            severity: 'critical' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const r2 = {
      id: 'r2',
      name: 'r2',
      description: '',
      severity: 'critical' as const,
      priority: 50,
      match: () =>
        [
          {
            ruleId: 'r2',
            ruleName: 'A-rule',
            severity: 'critical' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const matches = evaluateAlertRules([r1, r2], {
      companies: [],
      indicators: [],
      cells: [],
    });
    expect(matches[0].ruleName).toBe('A-rule');
    expect(matches[1].ruleName).toBe('Z-rule');
  });

  it('sorts by priority within same severity (lower priority wins)', () => {
    const lowPriority = {
      id: 'low',
      name: 'low',
      description: '',
      severity: 'critical' as const,
      priority: 99,
      match: () =>
        [
          {
            ruleId: 'low',
            ruleName: 'A-low-priority',
            severity: 'critical' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const highPriority = {
      id: 'high',
      name: 'high',
      description: '',
      severity: 'critical' as const,
      priority: 1,
      match: () =>
        [
          {
            ruleId: 'high',
            ruleName: 'Z-high-priority',
            severity: 'critical' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const matches = evaluateAlertRules([lowPriority, highPriority], {
      companies: [],
      indicators: [],
      cells: [],
    });
    // Despite alphabetic order putting "A-low-priority" first,
    // priority=1 wins over priority=99 within the critical tier.
    expect(matches[0].ruleId).toBe('high');
    expect(matches[1].ruleId).toBe('low');
  });

  it('severity rank dominates priority across tiers', () => {
    // High-priority warning (priority=1) must NOT outrank low-priority
    // critical (priority=99) — severity is the primary key.
    const warnHighPri = {
      id: 'warn-hp',
      name: 'warn-hp',
      description: '',
      severity: 'warning' as const,
      priority: 1,
      match: () =>
        [
          {
            ruleId: 'warn-hp',
            ruleName: 'warn-hp',
            severity: 'warning' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const critLowPri = {
      id: 'crit-lp',
      name: 'crit-lp',
      description: '',
      severity: 'critical' as const,
      priority: 99,
      match: () =>
        [
          {
            ruleId: 'crit-lp',
            ruleName: 'crit-lp',
            severity: 'critical' as const,
            message: '',
            messageKey: '',
            messageParams: {},
            affectedCompanyIds: [],
          },
        ],
    };
    const matches = evaluateAlertRules([warnHighPri, critLowPri], {
      companies: [],
      indicators: [],
      cells: [],
    });
    expect(matches[0].severity).toBe('critical');
    expect(matches[1].severity).toBe('warning');
  });
});

describe('DEFAULT_ALERT_RULES (Phase C6)', () => {
  it('exports 5 default rules', () => {
    expect(DEFAULT_ALERT_RULES).toHaveLength(5);
  });

  it('each default rule has unique id', () => {
    const ids = DEFAULT_ALERT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each default rule has non-empty name + description', () => {
    for (const rule of DEFAULT_ALERT_RULES) {
      expect(rule.name.trim().length).toBeGreaterThan(0);
      expect(rule.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('each default rule has explicit priority (no fallback)', () => {
    for (const rule of DEFAULT_ALERT_RULES) {
      expect(typeof rule.priority).toBe('number');
      expect(Number.isFinite(rule.priority)).toBe(true);
    }
  });

  it('default-pack priority order: sector contagion (10) < org-wide-indicator (20) < single-co problem (30+)', () => {
    const byId = new Map(DEFAULT_ALERT_RULES.map((r) => [r.id, r.priority]));
    expect(byId.get('sector-red-spread')).toBeLessThan(
      byId.get('critical-indicator-org-wide')!,
    );
    expect(byId.get('critical-indicator-org-wide')).toBeLessThan(
      byId.get('company-mostly-red')!,
    );
    expect(byId.get('company-mostly-red')).toBeLessThan(
      byId.get('company-critical-composite')!,
    );
  });
});

describe('RULE_CRITICAL_INDICATOR_ORG_WIDE — affectedCompanyIds dedup contract', () => {
  it('deduplicates company ids when same indicator+company appears multiple times', () => {
    // Synthetic edge case: same company has 2 red cells for the same
    // indicator (shouldn't happen in production, but matrix could
    // theoretically emit duplicates — sub-group rollup pass + leaf
    // both red). Engine must dedup so AlertsPanel doesn't show
    // "AAC-MAIN" listed twice for the same alert.
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Industrial'),
        company('co_c', 'C', 'Industrial'),
      ],
      indicators: [{ id: 'ind_net', code: 'IND_NET_MARGIN' }],
      cells: [
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_net', 'red'), // synthetic duplicate
        cell('co_b', 'ind_net', 'red'),
        cell('co_c', 'ind_net', 'red'),
      ],
    };
    const matches = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, DEFAULT_ALERT_THRESHOLDS);
    expect(matches).toHaveLength(1);
    const ids = matches[0].affectedCompanyIds;
    // 4 cells but only 3 distinct companies.
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    // Message uses unique-company count, not raw cell count.
    expect(matches[0].message).toContain('3 companies');
  });
});

describe('evaluateAlertRules (Phase C6) — multi-rule integration', () => {
  // Architect Round-1 sub-9 closure: realistic 5-company × 12-indicator
  // fixture exercises rule INTERACTION (one company hits multiple
  // rules; engine sort returns them in CRO-priority order). Locks the
  // contract that v1 unit tests cover only in isolation.
  function buildFixture(): AlertContext {
    const companies: AlertCompany[] = [
      company('co_a', 'AAC-MAIN', 'Industrial'),
      company('co_b', 'ATL-DBZ', 'Industrial'),
      company('co_c', 'SPARK-MAIN', 'Hospitality'),
      company('co_d', 'ZTP-MAIN', 'Industrial'),
      company('co_e', 'LLS-MAIN', 'Hospitality'),
    ];
    const indicators: AlertIndicator[] = [
      indicator('ind_gross', 'IND_GROSS_MARGIN'),
      indicator('ind_net', 'IND_NET_MARGIN'),
      indicator('ind_opex', 'IND_OPEX_RATIO'),
      indicator('ind_curr', 'IND_CURRENT_RATIO'),
      indicator('ind_quick', 'IND_QUICK_RATIO'),
      indicator('ind_dso', 'IND_DSO'),
      indicator('ind_dpo', 'IND_DPO'),
      indicator('ind_ccc', 'IND_CCC'),
      indicator('ind_roe', 'IND_ROE'),
      indicator('ind_roa', 'IND_ROA'),
      indicator('ind_ebitda', 'IND_EBITDA_MARGIN'),
      indicator('ind_lev', 'IND_DEBT_TO_EBITDA'),
    ];
    const cells: HeatMapCell[] = [];
    // co_a: 4 reds (3+ trips company-mostly-red) — composite very low,
    // includes IND_NET_MARGIN red (org-wide trigger #1).
    for (const ind of ['ind_gross', 'ind_net', 'ind_opex', 'ind_curr']) {
      cells.push(cell('co_a', ind, 'red'));
    }
    for (const ind of ['ind_quick', 'ind_dso', 'ind_dpo', 'ind_ccc', 'ind_roe', 'ind_roa', 'ind_ebitda', 'ind_lev']) {
      cells.push(cell('co_a', ind, 'amber'));
    }
    // co_b: 1 red on IND_NET_MARGIN (org-wide trigger #2) + 4 amber
    // (sector amber cluster contributor — Industrial).
    cells.push(cell('co_b', 'ind_net', 'red'));
    for (const ind of ['ind_gross', 'ind_opex', 'ind_curr', 'ind_quick']) {
      cells.push(cell('co_b', ind, 'amber'));
    }
    // co_c: 1 red on IND_NET_MARGIN (org-wide trigger #3 → 3+ → fires).
    cells.push(cell('co_c', 'ind_net', 'red'));
    for (const ind of ['ind_gross', 'ind_opex']) {
      cells.push(cell('co_c', ind, 'amber'));
    }
    // co_d: 2 reds Industrial (sector-red-spread: 2+ Industrial cos with
    // red, 3+ red cells total → fires "contagion" rule).
    cells.push(cell('co_d', 'ind_opex', 'red'));
    cells.push(cell('co_d', 'ind_curr', 'red'));
    // co_e: clean (all green) — should NOT trigger any rule.
    for (const ind of ['ind_gross', 'ind_net', 'ind_opex', 'ind_curr']) {
      cells.push(cell('co_e', ind, 'green'));
    }
    return { companies, indicators, cells };
  }

  it('multi-trigger company co_a appears in exactly 5 rule matches (4 critical + 1 warning)', () => {
    const ctx = buildFixture();
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx);
    // co_a triggers 5 rules (4 critical + 1 warning):
    //   critical:
    //     - company-mostly-red (4 reds ≥ 3)
    //     - company-critical-composite (4 red + 8 amber → 33 < 40)
    //     - critical-indicator-org-wide (red IND_NET_MARGIN, 3 cos)
    //     - sector-red-spread (Industrial has 7 reds across 3 cos)
    //   warning:
    //     - sector-amber-cluster (Industrial has 12 amber across 2 cos)
    // Architect Round-1 sub-14 closure: was loose `≥3`; tightened to
    // `=5` so a silent regression breaks the test instead of passing
    // on N-of-5.
    const aMatches = matches.filter((m) => m.affectedCompanyIds.includes('co_a'));
    expect(aMatches).toHaveLength(5);
    // Each expected rule represented exactly once for co_a.
    const aRuleIds = aMatches.map((m) => m.ruleId).sort();
    expect(aRuleIds).toEqual([
      'company-critical-composite',
      'company-mostly-red',
      'critical-indicator-org-wide',
      'sector-amber-cluster',
      'sector-red-spread',
    ]);
  });

  it('sort order: critical → warning → info, sector-contagion (priority 10) before org-wide (20) before single-co (30+)', () => {
    const ctx = buildFixture();
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx);
    // Find indices of each rule kind.
    const sectorRedIdx = matches.findIndex((m) => m.ruleId === 'sector-red-spread');
    const orgWideIdx = matches.findIndex((m) => m.ruleId === 'critical-indicator-org-wide');
    const mostlyRedIdx = matches.findIndex((m) => m.ruleId === 'company-mostly-red');
    const compositeIdx = matches.findIndex((m) => m.ruleId === 'company-critical-composite');
    // All four critical-tier rules fire in this fixture.
    expect(sectorRedIdx).toBeGreaterThanOrEqual(0);
    expect(orgWideIdx).toBeGreaterThanOrEqual(0);
    expect(mostlyRedIdx).toBeGreaterThanOrEqual(0);
    expect(compositeIdx).toBeGreaterThanOrEqual(0);
    // Priority chain: 10 < 20 < 30 < 40.
    expect(sectorRedIdx).toBeLessThan(orgWideIdx);
    expect(orgWideIdx).toBeLessThan(mostlyRedIdx);
    expect(mostlyRedIdx).toBeLessThan(compositeIdx);
  });

  it('clean company never appears in any match', () => {
    const ctx = buildFixture();
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx);
    for (const m of matches) {
      expect(m.affectedCompanyIds).not.toContain('co_e');
    }
  });

  it('engine populates cellsByCompany when caller omits it (perf hint to rules)', () => {
    const ctx = buildFixture();
    expect(ctx.cellsByCompany).toBeUndefined();
    // Drive the engine and assert via a synthetic rule that sees the
    // pre-indexed map (architect Round-1 sub-9 closure: index built
    // once per evaluateAlertRules call, not once per rule).
    let observedIndex: ReadonlyMap<string, readonly HeatMapCell[]> | undefined;
    const probe = {
      id: 'probe',
      name: 'probe',
      description: '',
      severity: 'info' as const,
      priority: 1,
      match: (c: AlertContext) => {
        observedIndex = c.cellsByCompany;
        return [];
      },
    };
    evaluateAlertRules([probe], ctx);
    expect(observedIndex).toBeDefined();
    // Index should exclude co_e cells from any rollup-only entry, and
    // co_a should have its non-rollup cells aggregated.
    expect(observedIndex!.get('co_a')?.length).toBe(12);
    expect(observedIndex!.get('co_e')?.length).toBe(4);
  });

  it('engine respects caller-provided cellsByCompany (no double-build) + behavioral lock', () => {
    const ctx = buildFixture();
    // Bogus index: only contains 'co_only', NOT any of the rule-pack's
    // co_a..co_e. If the engine builds its own index from `ctx.cells`
    // (ignoring the caller-provided one), DEFAULT_ALERT_RULES would
    // still trigger for co_a/b/c/d. With caller-wins semantics, every
    // rule's `cellsForCompany('co_a')` reads `customIndex.get('co_a')`
    // = undefined → empty list → no rule fires.
    const customIndex = new Map<string, HeatMapCell[]>();
    customIndex.set('co_only', [cell('co_only', 'ind_gross', 'red')]);
    const ctxWithIndex: AlertContext = { ...ctx, cellsByCompany: customIndex };

    // (a) Reference-equality probe — engine passes the SAME map through.
    let observed: ReadonlyMap<string, readonly HeatMapCell[]> | undefined;
    const probe = {
      id: 'probe',
      name: 'probe',
      description: '',
      severity: 'info' as const,
      priority: 1,
      match: (c: AlertContext) => {
        observed = c.cellsByCompany;
        return [];
      },
    };
    evaluateAlertRules([probe], ctxWithIndex);
    expect(observed).toBe(customIndex);

    // (b) Behavioral assertion — DEFAULT_ALERT_RULES against the bogus
    // index. Only the rules that READ THE INDEX via `cellsForCompany`
    // honor caller-wins (mostly-red, composite, sector-amber-cluster,
    // sector-red-spread — they all use the per-company helper). The
    // org-wide indicator rule reads `ctx.cells` directly (filters by
    // indicatorId across the whole matrix) and so isn't blocked by a
    // bogus per-company index. Lock both contracts: per-company-rules
    // produce ZERO matches; org-wide still fires from ctx.cells.
    // (Architect Round-1 sub-14 closure: prior version checked only
    // reference equality; this strengthens to behavioral end-to-end.)
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctxWithIndex);
    const perCompanyRuleIds = new Set([
      'company-mostly-red',
      'company-critical-composite',
      'sector-amber-cluster',
      'sector-red-spread',
    ]);
    const perCompanyMatches = matches.filter((m) => perCompanyRuleIds.has(m.ruleId));
    expect(perCompanyMatches).toHaveLength(0);
    // Org-wide rule reads ctx.cells (NOT the index) so it still fires.
    // This is the documented exception — index covers per-company
    // queries only; org-wide / per-indicator queries walk ctx.cells.
    const orgWideMatches = matches.filter((m) => m.ruleId === 'critical-indicator-org-wide');
    expect(orgWideMatches).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Phase 7.E C6 v2 — config-driven threshold override coverage
// ────────────────────────────────────────────────────────────────────────

describe('Phase C6 v2 — externalised thresholds', () => {
  it('RULE_COMPANY_MOSTLY_RED honors raised threshold (5 reds required)', () => {
    const ctx: AlertContext = {
      companies: [company('co_a', 'A')],
      indicators: [IND_GROSS, IND_NET, IND_OPEX, IND_FX],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_opex', 'red'),
        cell('co_a', 'ind_fx', 'red'),
      ],
    };
    const tightConfig: ResolvedAlertThresholds = {
      ...DEFAULT_ALERT_THRESHOLDS,
      mostlyRed: { redCountMin: 5 },
    };
    expect(RULE_COMPANY_MOSTLY_RED.match(ctx, tightConfig)).toHaveLength(0);
    // Sanity: defaults at 3 still trigger.
    expect(RULE_COMPANY_MOSTLY_RED.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(1);
  });

  it('RULE_COMPANY_CRITICAL_COMPOSITE honors raised score floor', () => {
    // 1 green + 1 red = composite 50 (>= 40 default → no trigger).
    // Raise scoreMax to 60 → 50 < 60 → trigger.
    const ctx: AlertContext = {
      companies: [company('co_a', 'A')],
      indicators: [IND_GROSS, IND_NET],
      cells: [
        cell('co_a', 'ind_gross', 'green'),
        cell('co_a', 'ind_net', 'red'),
      ],
    };
    const looseConfig: ResolvedAlertThresholds = {
      ...DEFAULT_ALERT_THRESHOLDS,
      criticalComposite: { scoreMax: 60 },
    };
    expect(RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
    expect(RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, looseConfig)).toHaveLength(1);
  });

  it('RULE_SECTOR_AMBER_CLUSTER honors raised threshold (8 amber required)', () => {
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Industrial'),
      ],
      indicators: [IND_GROSS, IND_NET, IND_OPEX, IND_FX],
      cells: [
        cell('co_a', 'ind_gross', 'amber'),
        cell('co_a', 'ind_net', 'amber'),
        cell('co_a', 'ind_opex', 'amber'),
        cell('co_b', 'ind_gross', 'amber'),
        cell('co_b', 'ind_net', 'amber'),
      ],
    };
    const tightConfig: ResolvedAlertThresholds = {
      ...DEFAULT_ALERT_THRESHOLDS,
      sectorAmber: { amberCountMin: 8 },
    };
    expect(RULE_SECTOR_AMBER_CLUSTER.match(ctx, tightConfig)).toHaveLength(0);
    expect(RULE_SECTOR_AMBER_CLUSTER.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(1);
  });

  it('RULE_SECTOR_RED_SPREAD honors raised company-spread threshold (3 cos required)', () => {
    // 3 reds across 2 cos: triggers at default (3 reds ≥ 3, 2 cos ≥ 2),
    // but a config requiring 3 cos blocks it.
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A', 'Industrial'),
        company('co_b', 'B', 'Industrial'),
      ],
      indicators: [IND_GROSS, IND_NET],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_b', 'ind_gross', 'red'),
      ],
    };
    const tightConfig: ResolvedAlertThresholds = {
      ...DEFAULT_ALERT_THRESHOLDS,
      sectorRedSpread: { redCountMin: 3, companyCountMin: 3 },
    };
    expect(RULE_SECTOR_RED_SPREAD.match(ctx, tightConfig)).toHaveLength(0);
    expect(RULE_SECTOR_RED_SPREAD.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(1);
  });

  it('RULE_CRITICAL_INDICATOR_ORG_WIDE honors custom indicator picklist', () => {
    // Default code IND_NET_MARGIN; reds are on IND_GROSS_MARGIN. With
    // defaults → no trigger (target indicator not red). With config
    // pointing at IND_GROSS_MARGIN → fires for those reds.
    const ctx: AlertContext = {
      companies: [
        company('co_a', 'A'),
        company('co_b', 'B'),
        company('co_c', 'C'),
      ],
      indicators: [IND_GROSS, IND_NET],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_b', 'ind_gross', 'red'),
        cell('co_c', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'green'),
        cell('co_b', 'ind_net', 'green'),
        cell('co_c', 'ind_net', 'green'),
      ],
    };
    expect(RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, DEFAULT_ALERT_THRESHOLDS)).toHaveLength(0);
    const customConfig: ResolvedAlertThresholds = {
      ...DEFAULT_ALERT_THRESHOLDS,
      criticalIndicator: { indicatorCode: 'IND_GROSS_MARGIN', redCountMin: 3 },
    };
    const matches = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, customConfig);
    expect(matches).toHaveLength(1);
    expect(matches[0].affectedIndicatorCodes).toEqual(['IND_GROSS_MARGIN']);
    expect(matches[0].message).toContain('IND_GROSS_MARGIN');
    expect(matches[0].message).toContain('3 companies');
  });

  it('evaluateAlertRules: undefined config behaves identically to DEFAULT_ALERT_THRESHOLDS', () => {
    // Back-compat lock: callers from v1 pass no third arg → engine
    // resolves defaults → match output is identical to v1 behavior.
    const ctx: AlertContext = {
      companies: [company('co_a', 'A', 'Industrial')],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_opex', 'red'),
      ],
    };
    const defaultMatches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx);
    const explicitMatches = evaluateAlertRules(
      DEFAULT_ALERT_RULES,
      ctx,
      undefined,
    );
    const mergedMatches = evaluateAlertRules(
      DEFAULT_ALERT_RULES,
      ctx,
      DEFAULT_ALERT_THRESHOLDS,
    );
    expect(explicitMatches).toEqual(defaultMatches);
    expect(mergedMatches).toEqual(defaultMatches);
  });

  it('evaluateAlertRules: partial config merges with defaults (mostlyRed override only)', () => {
    // Config provides ONLY mostlyRed. Other rules must still fire on
    // their own defaults — proves the engine threads merged config to
    // every rule, not just the overridden ones.
    const ctx: AlertContext = {
      companies: [company('co_a', 'A', 'Industrial')],
      indicators: [IND_GROSS, IND_NET, IND_OPEX],
      cells: [
        cell('co_a', 'ind_gross', 'red'),
        cell('co_a', 'ind_net', 'red'),
        cell('co_a', 'ind_opex', 'red'),
      ],
    };
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx, {
      mostlyRed: { redCountMin: 5 }, // raise — should suppress mostly-red trigger
    });
    const ruleIds = matches.map((m) => m.ruleId);
    // mostly-red is suppressed (3 reds < 5 threshold)
    expect(ruleIds).not.toContain('company-mostly-red');
    // composite still uses default 40 — 1 green=0 + 3 red=0 → 0 < 40 → fires
    expect(ruleIds).toContain('company-critical-composite');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Sub-35 — messageKey / messageParams i18n contract
//
// Each rule now emits a stable `messageKey` (under
// `terminal.alerts.messages.<ruleId>`) plus an ICU-shaped `messageParams`
// object. UI render sites prefer t(messageKey, messageParams) and fall
// back to `message` when the key is missing. The English translation of
// `messageKey(messageParams)` MUST equal `message` byte-for-byte —
// locked in `alert-rules-i18n.test.ts`.
// ────────────────────────────────────────────────────────────────────────

describe('Sub-35 — alert messageKey / messageParams contract', () => {
  it('RULE_COMPANY_MOSTLY_RED emits {code, redCount}', () => {
    const ctx: AlertContext = {
      companies: [{ id: 'c1', code: 'AAC-MAIN', name: 'AAC', industry: 'Industrial' }],
      indicators: [
        { id: 'i1', code: 'X1' },
        { id: 'i2', code: 'X2' },
        { id: 'i3', code: 'X3' },
      ],
      cells: [
        { indicatorValueId: 'iv1', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'iv2', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'red' },
        { indicatorValueId: 'iv3', companyId: 'c1', indicatorId: 'i3', value: 0, status: 'red' },
      ],
    };
    const [m] = RULE_COMPANY_MOSTLY_RED.match(ctx, mergeWithDefaults(undefined));
    expect(m.messageKey).toBe('alerts.messages.company-mostly-red');
    expect(m.messageParams).toEqual({ code: 'AAC-MAIN', redCount: 3 });
  });

  it('RULE_COMPANY_CRITICAL_COMPOSITE emits {code, score, contributing, total}', () => {
    const ctx: AlertContext = {
      companies: [{ id: 'c1', code: 'BAD-CO', name: 'Bad', industry: 'Industrial' }],
      indicators: [
        { id: 'i1', code: 'X1' },
        { id: 'i2', code: 'X2' },
        { id: 'i3', code: 'X3' },
      ],
      cells: [
        { indicatorValueId: 'iv1', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'iv2', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'red' },
        { indicatorValueId: 'iv3', companyId: 'c1', indicatorId: 'i3', value: 0, status: 'red' },
      ],
    };
    const [m] = RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx, mergeWithDefaults(undefined));
    expect(m.messageKey).toBe('alerts.messages.company-critical-composite');
    expect(m.messageParams).toEqual({ code: 'BAD-CO', score: 0, contributing: 3, total: 3 });
  });

  it('RULE_SECTOR_AMBER_CLUSTER emits {industry, amberCount, companyCount}', () => {
    const ctx: AlertContext = {
      companies: [
        { id: 'c1', code: 'A', name: 'A', industry: 'Industrial' },
        { id: 'c2', code: 'B', name: 'B', industry: 'Industrial' },
      ],
      indicators: [
        { id: 'i1', code: 'X1' },
        { id: 'i2', code: 'X2' },
        { id: 'i3', code: 'X3' },
      ],
      cells: [
        // 5 amber cells across 2 companies — meets default sectorAmber.amberCountMin=5.
        { indicatorValueId: 'iv1', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'iv2', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'amber' },
        { indicatorValueId: 'iv3', companyId: 'c1', indicatorId: 'i3', value: 0, status: 'amber' },
        { indicatorValueId: 'iv4', companyId: 'c2', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'iv5', companyId: 'c2', indicatorId: 'i2', value: 0, status: 'amber' },
      ],
    };
    const [m] = RULE_SECTOR_AMBER_CLUSTER.match(ctx, mergeWithDefaults(undefined));
    expect(m.messageKey).toBe('alerts.messages.sector-amber-cluster');
    expect(m.messageParams).toEqual({ industry: 'Industrial', amberCount: 5, companyCount: 2 });
  });

  it('RULE_SECTOR_RED_SPREAD emits {industry, redCount, companyCount}', () => {
    const ctx: AlertContext = {
      companies: [
        { id: 'c1', code: 'A', name: 'A', industry: 'Industrial' },
        { id: 'c2', code: 'B', name: 'B', industry: 'Industrial' },
      ],
      indicators: [{ id: 'i1', code: 'X' }, { id: 'i2', code: 'Y' }],
      cells: [
        { indicatorValueId: 'iv1', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'iv2', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'red' },
        { indicatorValueId: 'iv3', companyId: 'c2', indicatorId: 'i1', value: 0, status: 'red' },
      ],
    };
    const [m] = RULE_SECTOR_RED_SPREAD.match(ctx, mergeWithDefaults(undefined));
    expect(m.messageKey).toBe('alerts.messages.sector-red-spread');
    expect(m.messageParams).toEqual({ industry: 'Industrial', redCount: 3, companyCount: 2 });
  });

  it('RULE_CRITICAL_INDICATOR_ORG_WIDE emits {code, companyCount}', () => {
    const ctx: AlertContext = {
      companies: [
        { id: 'c1', code: 'A', name: 'A', industry: 'Industrial' },
        { id: 'c2', code: 'B', name: 'B', industry: 'Industrial' },
        { id: 'c3', code: 'C', name: 'C', industry: 'Industrial' },
      ],
      indicators: [{ id: 'i1', code: 'IND_NET_MARGIN' }],
      cells: [
        { indicatorValueId: 'iv1', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'iv2', companyId: 'c2', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'iv3', companyId: 'c3', indicatorId: 'i1', value: 0, status: 'red' },
      ],
    };
    const [m] = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx, mergeWithDefaults(undefined));
    expect(m.messageKey).toBe('alerts.messages.critical-indicator-org-wide');
    expect(m.messageParams).toEqual({ code: 'IND_NET_MARGIN', companyCount: 3 });
  });
});

// --- Phase 7.E C6 v3 — per-sector overrides via evaluateAlertRules ----------

describe('evaluateAlertRules — per-sector overrides (C6 v3)', () => {
  it('hospitality with permissive sector override (amberCountMin=8) does NOT fire at 5 amber cells', () => {
    // Two industries with same shape; sector-specific threshold gates
    // hospitality OUT while default-threshold lets industrial in.
    const ctx: AlertContext = {
      companies: [
        { id: 'c_hosp', code: 'CO_H', name: 'Hosp', industry: 'hospitality', isSubgroup: false },
        { id: 'c_ind', code: 'CO_I', name: 'Industrial', industry: 'industrial', isSubgroup: false },
      ],
      indicators: [
        { id: 'i1', code: 'X1' }, { id: 'i2', code: 'X2' }, { id: 'i3', code: 'X3' },
        { id: 'i4', code: 'X4' }, { id: 'i5', code: 'X5' },
      ],
      cells: [
        { indicatorValueId: 'a', companyId: 'c_hosp', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'b', companyId: 'c_hosp', indicatorId: 'i2', value: 0, status: 'amber' },
        { indicatorValueId: 'c', companyId: 'c_hosp', indicatorId: 'i3', value: 0, status: 'amber' },
        { indicatorValueId: 'd', companyId: 'c_hosp', indicatorId: 'i4', value: 0, status: 'amber' },
        { indicatorValueId: 'e', companyId: 'c_hosp', indicatorId: 'i5', value: 0, status: 'amber' },
        { indicatorValueId: 'f', companyId: 'c_ind', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'g', companyId: 'c_ind', indicatorId: 'i2', value: 0, status: 'amber' },
        { indicatorValueId: 'h', companyId: 'c_ind', indicatorId: 'i3', value: 0, status: 'amber' },
        { indicatorValueId: 'i', companyId: 'c_ind', indicatorId: 'i4', value: 0, status: 'amber' },
        { indicatorValueId: 'j', companyId: 'c_ind', indicatorId: 'i5', value: 0, status: 'amber' },
      ],
    };
    const matches = evaluateAlertRules([RULE_SECTOR_AMBER_CLUSTER], ctx, {
      sectorAmber: { amberCountMin: 5 }, // org-wide → industrial fires
      bySector: {
        hospitality: { sectorAmber: { amberCountMin: 8 } }, // gate hospitality out
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].messageParams.industry).toBe('industrial');
  });

  it('hospitality with TIGHT sector override (amberCountMin=3) fires at 5 amber cells even when org-wide is 99', () => {
    const ctx: AlertContext = {
      companies: [
        { id: 'c_hosp', code: 'CO_H', name: 'Hosp', industry: 'hospitality', isSubgroup: false },
      ],
      indicators: [
        { id: 'i1', code: 'X1' }, { id: 'i2', code: 'X2' }, { id: 'i3', code: 'X3' },
        { id: 'i4', code: 'X4' }, { id: 'i5', code: 'X5' },
      ],
      cells: [
        { indicatorValueId: 'a', companyId: 'c_hosp', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'b', companyId: 'c_hosp', indicatorId: 'i2', value: 0, status: 'amber' },
        { indicatorValueId: 'c', companyId: 'c_hosp', indicatorId: 'i3', value: 0, status: 'amber' },
        { indicatorValueId: 'd', companyId: 'c_hosp', indicatorId: 'i4', value: 0, status: 'amber' },
        { indicatorValueId: 'e', companyId: 'c_hosp', indicatorId: 'i5', value: 0, status: 'amber' },
      ],
    };
    const matches = evaluateAlertRules([RULE_SECTOR_AMBER_CLUSTER], ctx, {
      sectorAmber: { amberCountMin: 99 }, // org-wide impossibly high
      bySector: {
        hospitality: { sectorAmber: { amberCountMin: 3 } }, // tight — fires
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].messageParams.industry).toBe('hospitality');
    expect(matches[0].messageParams.amberCount).toBe(5);
  });

  it('sector-red-spread per-industry override applies independently to redCountMin + companyCountMin', () => {
    // Industrial override raises both thresholds — defaults would have
    // fired (3 red across 2+ cos), but override demands 5 red across 4+
    // cos which the fixture doesn't satisfy.
    const ctx: AlertContext = {
      companies: [
        { id: 'c1', code: 'C1', name: 'C1', industry: 'industrial', isSubgroup: false },
        { id: 'c2', code: 'C2', name: 'C2', industry: 'industrial', isSubgroup: false },
        { id: 'c3', code: 'C3', name: 'C3', industry: 'industrial', isSubgroup: false },
      ],
      indicators: [{ id: 'i1', code: 'X1' }, { id: 'i2', code: 'X2' }],
      cells: [
        { indicatorValueId: 'a', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'b', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'red' },
        { indicatorValueId: 'c', companyId: 'c2', indicatorId: 'i1', value: 0, status: 'red' },
        { indicatorValueId: 'd', companyId: 'c3', indicatorId: 'i1', value: 0, status: 'red' },
      ],
    };
    const matches = evaluateAlertRules([RULE_SECTOR_RED_SPREAD], ctx, {
      bySector: {
        industrial: { sectorRedSpread: { redCountMin: 5, companyCountMin: 4 } },
      },
    });
    expect(matches).toHaveLength(0);
  });

  it('no bySector → engine falls back to org-wide for every industry (back-compat lock)', () => {
    // v2-shaped config (no bySector) produces identical output to pre-v3.
    const ctx: AlertContext = {
      companies: [
        { id: 'c1', code: 'C1', name: 'C1', industry: 'hospitality', isSubgroup: false },
      ],
      indicators: [{ id: 'i1', code: 'X1' }, { id: 'i2', code: 'X2' }, { id: 'i3', code: 'X3' }],
      cells: [
        { indicatorValueId: 'a', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'b', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'amber' },
        { indicatorValueId: 'c', companyId: 'c1', indicatorId: 'i3', value: 0, status: 'amber' },
      ],
    };
    const matches = evaluateAlertRules([RULE_SECTOR_AMBER_CLUSTER], ctx, {
      sectorAmber: { amberCountMin: 3 },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].messageParams.amberCount).toBe(3);
  });

  it('null config → defaults for every industry; 5-amber cluster fires at default threshold', () => {
    const ctx: AlertContext = {
      companies: [
        { id: 'c1', code: 'C1', name: 'C1', industry: 'industrial', isSubgroup: false },
      ],
      indicators: [
        { id: 'i1', code: 'X1' }, { id: 'i2', code: 'X2' }, { id: 'i3', code: 'X3' },
        { id: 'i4', code: 'X4' }, { id: 'i5', code: 'X5' },
      ],
      cells: [
        { indicatorValueId: 'a', companyId: 'c1', indicatorId: 'i1', value: 0, status: 'amber' },
        { indicatorValueId: 'b', companyId: 'c1', indicatorId: 'i2', value: 0, status: 'amber' },
        { indicatorValueId: 'c', companyId: 'c1', indicatorId: 'i3', value: 0, status: 'amber' },
        { indicatorValueId: 'd', companyId: 'c1', indicatorId: 'i4', value: 0, status: 'amber' },
        { indicatorValueId: 'e', companyId: 'c1', indicatorId: 'i5', value: 0, status: 'amber' },
      ],
    };
    // Default amberCountMin=5; 5 amber cells fire.
    const matches = evaluateAlertRules([RULE_SECTOR_AMBER_CLUSTER], ctx, null);
    expect(matches).toHaveLength(1);
  });
});
