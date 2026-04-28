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

  it('sorts alphabetically within same severity', () => {
    const r1 = {
      id: 'r1',
      name: 'r1',
      description: '',
      severity: 'critical' as const,
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
});
