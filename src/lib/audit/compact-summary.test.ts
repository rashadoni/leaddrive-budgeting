/**
 * Tests for `summarizeAuditEvent` — single source of truth for audit
 * event summarization, consumed by AuditFeed (verbose) and AuditTicker
 * (compact). Closes Turn-40-sub3 architect ⚠️ on drift between the two
 * formerly-local helpers.
 *
 * Coverage strategy: one happy-path case per AuditAction enum member,
 * checking BOTH `compact` and `verbose` outputs. Unknown-action and
 * missing-metadata fallbacks each have a dedicated case.
 */
import { describe, it, expect } from 'vitest';
import {
  summarizeAuditEvent,
  stringField,
  numberField,
  type AuditEventLike,
} from './compact-summary';
import type { AuditAction } from '@prisma/client';

function ev(
  action: AuditAction,
  metadata: Record<string, unknown> = {},
  entityType = 'Entity',
): AuditEventLike {
  return { action, metadata, entityType };
}

describe('summarizeAuditEvent — per-action coverage', () => {
  it('company_role_change', () => {
    const out = summarizeAuditEvent(
      ev('company_role_change', { companyCode: 'AAC', from: 'admin', to: 'manager' }),
    );
    expect(out.compact).toBe('AAC');
    expect(out.verbose).toBe('AAC · admin → manager');
  });

  it('company_role_change without code falls back to entityType', () => {
    const out = summarizeAuditEvent(
      ev('company_role_change', { from: 'admin', to: 'manager' }, 'Company'),
    );
    expect(out.compact).toBe('Company');
    expect(out.verbose).toBe('admin → manager');
  });

  it('company_status_change shows from → to transition', () => {
    const out = summarizeAuditEvent(
      ev('company_status_change', { companyCode: 'AZSF', from: 'pending', to: 'active' }),
    );
    expect(out.compact).toBe('AZSF');
    expect(out.verbose).toBe('AZSF · pending → active');
  });

  it('company_industry_change shows from → to; null renders as —', () => {
    // null → code (industry was unset, now set)
    const out = summarizeAuditEvent(
      ev('company_industry_change', { companyCode: 'EDEN', from: null, to: 'agro_crops' }),
    );
    expect(out.compact).toBe('EDEN');
    expect(out.verbose).toBe('EDEN · — → agro_crops');

    // code → null (industry cleared for placeholder company)
    const out2 = summarizeAuditEvent(
      ev('company_industry_change', { companyCode: 'EDEN', from: 'agro_crops', to: null }),
    );
    expect(out2.verbose).toBe('EDEN · agro_crops → —');
  });

  it('import_budget_create', () => {
    const out = summarizeAuditEvent(
      ev('import_budget_create', { companyCode: 'AAC', year: 2026, inserted: 42 }),
    );
    expect(out.compact).toBe('AAC');
    expect(out.verbose).toBe('AAC · 2026 · 42 lines');
  });

  it('import_budget_create without inserted count', () => {
    const out = summarizeAuditEvent(
      ev('import_budget_create', { companyCode: 'AAC', year: 2026 }),
    );
    expect(out.compact).toBe('AAC');
    expect(out.verbose).toBe('AAC · 2026');
  });

  it('import_staging_apply', () => {
    const out = summarizeAuditEvent(
      ev('import_staging_apply', { year: 2026, inserted: 42, deleted: 12 }),
    );
    expect(out.compact).toBe('2026');
    expect(out.verbose).toBe('2026 · 42 inserted · 12 deleted');
  });

  it('import_staging_apply with only year', () => {
    const out = summarizeAuditEvent(ev('import_staging_apply', { year: 2026 }));
    expect(out.compact).toBe('2026');
    expect(out.verbose).toBe('2026');
  });

  it('import_staging_expired', () => {
    const out = summarizeAuditEvent(
      ev('import_staging_expired', {
        triggeredBy: 'lazy_apply',
        expiresAt: '2026-04-25T12:00:00.000Z',
      }),
    );
    expect(out.compact).toBe('via lazy_apply');
    // verbose includes locale-formatted timestamp; assert the prefix only
    // (timestamp output varies by environment locale).
    expect(out.verbose).toMatch(/^via lazy_apply · expired /);
  });

  it('budget_plan_create', () => {
    const out = summarizeAuditEvent(
      ev('budget_plan_create', { planName: '2026 Budget', year: 2026 }),
    );
    expect(out.compact).toBe('2026 Budget');
    expect(out.verbose).toBe('2026 Budget · 2026');
  });

  it('budget_plan_approve', () => {
    const out = summarizeAuditEvent(
      ev('budget_plan_approve', { planName: '2026 Budget', priorStatus: 'draft' }),
    );
    expect(out.compact).toBe('2026 Budget');
    expect(out.verbose).toBe('2026 Budget · was draft');
  });

  it.each<AuditAction>([
    'indicator_override_create',
    'indicator_override_update',
    'indicator_override_delete',
  ])('%s with formula+thresholds tags', (action) => {
    const out = summarizeAuditEvent(
      ev(action, { code: 'IND_GROSS_MARGIN', formulaChanged: true, thresholdsChanged: true }),
    );
    expect(out.compact).toBe('IND_GROSS_MARGIN');
    expect(out.verbose).toBe('IND_GROSS_MARGIN · formula, thresholds');
  });

  it('indicator_override_create without tags', () => {
    const out = summarizeAuditEvent(
      ev('indicator_override_create', { code: 'IND_NET_MARGIN' }),
    );
    expect(out.compact).toBe('IND_NET_MARGIN');
    expect(out.verbose).toBe('IND_NET_MARGIN');
  });

  it.each<AuditAction>([
    'ai_variance_explainer_run',
    'ai_forecast_explainer_run',
  ])('%s with code + language', (action) => {
    const out = summarizeAuditEvent(
      ev(action, { indicatorCode: 'SVC_NET_MARGIN', language: 'ru' }),
    );
    expect(out.compact).toBe('SVC_NET_MARGIN · RU');
    expect(out.verbose).toBe('SVC_NET_MARGIN · RU');
  });

  it('ai_variance_explainer_run with only code (no language)', () => {
    const out = summarizeAuditEvent(
      ev('ai_variance_explainer_run', { indicatorCode: 'IND_GROSS_MARGIN' }),
    );
    expect(out.compact).toBe('IND_GROSS_MARGIN');
    expect(out.verbose).toBe('IND_GROSS_MARGIN');
  });

  it('alert_thresholds_update with rule count', () => {
    const out = summarizeAuditEvent(
      ev(
        'alert_thresholds_update',
        { before: null, after: { 'mostly-red': {}, 'critical-composite': {} } },
        'Organization',
      ),
    );
    expect(out.compact).toBe('Organization');
    expect(out.verbose).toBe('Organization · 2 rules');
  });

  it('alert_thresholds_update with one rule (singular)', () => {
    const out = summarizeAuditEvent(
      ev('alert_thresholds_update', { before: null, after: { 'mostly-red': {} } }, 'Organization'),
    );
    expect(out.verbose).toBe('Organization · 1 rule');
  });

  it('alert_thresholds_update with empty after-map (0 rules) → compact-form (Turn-W 💡 #2)', () => {
    const out = summarizeAuditEvent(
      ev('alert_thresholds_update', { before: null, after: {} }, 'Organization'),
    );
    expect(out.compact).toBe('Organization');
    // 0 rules → ruleCount > 0 guard fails → falls back to compact form.
    expect(out.verbose).toBe('Organization');
  });

  it('alert_thresholds_update with non-object after → compact-form', () => {
    const out = summarizeAuditEvent(
      ev('alert_thresholds_update', { before: null, after: null }, 'Organization'),
    );
    expect(out.verbose).toBe('Organization');
  });
});

describe('summarizeAuditEvent — fallbacks', () => {
  it('unknown action returns entityType + JSON preview', () => {
    // Cast to AuditAction so TS lets us simulate an enum member added in
    // DB but not yet recognised by the helper. Runtime semantics: switch
    // misses, falls through to the unknown-action default.
    const fakeAction = 'totally_made_up_action' as unknown as AuditAction;
    const out = summarizeAuditEvent(
      ev(fakeAction, { foo: 'bar', n: 42 }, 'Mystery'),
    );
    expect(out.compact).toBe('Mystery');
    expect(out.verbose).toBe('{"foo":"bar","n":42}');
  });

  it('JSON preview truncates at 80 chars with ellipsis', () => {
    const big = { msg: 'x'.repeat(200) };
    const fakeAction = 'big_payload_action' as unknown as AuditAction;
    const out = summarizeAuditEvent(ev(fakeAction, big));
    expect(out.verbose.length).toBeLessThanOrEqual(80);
    expect(out.verbose.endsWith('…')).toBe(true);
  });

  it('action with no metadata returns entityType', () => {
    const out = summarizeAuditEvent(ev('import_budget_create', {}, 'BudgetPlan'));
    expect(out.compact).toBe('BudgetPlan');
    // Empty metadata → JSON preview "{}" for unknown handler, but
    // import_budget_create has a known handler that falls back to compact
    // when key fields are missing.
    expect(out.verbose).toBe('BudgetPlan');
  });
});

describe('field-extraction helpers', () => {
  it('stringField returns null for missing / empty / non-string', () => {
    expect(stringField({}, 'missing')).toBeNull();
    expect(stringField({ k: '' }, 'k')).toBeNull();
    expect(stringField({ k: 42 }, 'k')).toBeNull();
    expect(stringField({ k: null }, 'k')).toBeNull();
    expect(stringField({ k: 'value' }, 'k')).toBe('value');
  });

  it('numberField returns null for missing / non-number / non-finite', () => {
    expect(numberField({}, 'missing')).toBeNull();
    expect(numberField({ k: 'not-a-number' }, 'k')).toBeNull();
    expect(numberField({ k: NaN }, 'k')).toBeNull();
    expect(numberField({ k: Infinity }, 'k')).toBeNull();
    expect(numberField({ k: 0 }, 'k')).toBe(0);
    expect(numberField({ k: -3.14 }, 'k')).toBe(-3.14);
  });
});
