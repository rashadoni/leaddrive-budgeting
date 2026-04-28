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
    ...(isSubgroupRollup ? { isSubgroupRollup: true } : {}),
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
    const matches = RULE_COMPANY_MOSTLY_RED.match(ctx);
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
    expect(RULE_COMPANY_MOSTLY_RED.match(ctx)).toHaveLength(0);
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
    expect(RULE_COMPANY_MOSTLY_RED.match(ctx)).toHaveLength(0);
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
    const matches = RULE_COMPANY_MOSTLY_RED.match(ctx);
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
    const matches = RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx);
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
    expect(RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx)).toHaveLength(0);
  });

  it('does NOT trigger when company has no scoreable cells', () => {
    const ctx: AlertContext = {
      companies: [company('co_aac', 'AAC-MAIN')],
      indicators: [IND_GROSS],
      cells: [cell('co_aac', 'ind_gross', 'unknown')],
    };
    expect(RULE_COMPANY_CRITICAL_COMPOSITE.match(ctx)).toHaveLength(0);
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
    const matches = RULE_SECTOR_AMBER_CLUSTER.match(ctx);
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
    const matches = RULE_SECTOR_AMBER_CLUSTER.match(ctx);
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
    expect(RULE_SECTOR_AMBER_CLUSTER.match(ctx)).toHaveLength(0);
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
    const matches = RULE_SECTOR_RED_SPREAD.match(ctx);
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
    expect(RULE_SECTOR_RED_SPREAD.match(ctx)).toHaveLength(0);
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
    const matches = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx);
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
    expect(RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx)).toHaveLength(0);
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
    expect(RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx)).toHaveLength(0);
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
    const matches = RULE_CRITICAL_INDICATOR_ORG_WIDE.match(ctx);
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

  it('multi-trigger company appears in multiple rule matches', () => {
    const ctx = buildFixture();
    const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx);
    // co_a triggers: company-mostly-red (4 reds ≥ 3), company-critical-
    // composite (4 red + 8 amber → score (0+0+0+0+50·8)/12 ≈ 33),
    // critical-indicator-org-wide (red IND_NET_MARGIN), sector-red-spread
    // (Industrial has co_a red + co_b/co_d red).
    const aMatches = matches.filter((m) => m.affectedCompanyIds.includes('co_a'));
    expect(aMatches.length).toBeGreaterThanOrEqual(3);
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

  it('engine respects caller-provided cellsByCompany (no double-build)', () => {
    const ctx = buildFixture();
    const customIndex = new Map<string, HeatMapCell[]>();
    customIndex.set('co_only', [cell('co_only', 'ind_gross', 'red')]);
    const ctxWithIndex: AlertContext = { ...ctx, cellsByCompany: customIndex };
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
    // Engine passed the SAME map through — caller wins.
    expect(observed).toBe(customIndex);
  });
});
