/**
 * Phase 2.2 step 2 — cost-type catalog shape lock.
 *
 * Locks the 13 manufacturing cost categories the import-excel route
 * uses to seed `BudgetCostType` rows. `sortOrder` is significant —
 * the source xlsx column-order convention drives canonical P&L row
 * layout; reordering or count drift would silently re-arrange the
 * P&L grid for every AAC import.
 */

import { describe, it, expect } from 'vitest';
import {
  COST_TYPE_DEFS,
  type CostTypeDef,
  type CostTypeKey,
} from './cost-types';

describe('COST_TYPE_DEFS (Phase 2.2 step 2 extraction)', () => {
  it('exports exactly 13 cost categories', () => {
    expect(COST_TYPE_DEFS.length).toBe(13);
  });

  it('keys are unique', () => {
    const set = new Set(COST_TYPE_DEFS.map((c) => c.key));
    expect(set.size).toBe(COST_TYPE_DEFS.length);
  });

  it('keys use snake_case convention', () => {
    for (const def of COST_TYPE_DEFS) {
      expect(def.key).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('sortOrder is contiguous 1..13 (no gaps, no duplicates)', () => {
    const sorted = [...COST_TYPE_DEFS]
      .map((c) => c.sortOrder)
      .sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('declaration order matches sortOrder (no reorder drift)', () => {
    for (let i = 0; i < COST_TYPE_DEFS.length; i++) {
      expect(COST_TYPE_DEFS[i].sortOrder).toBe(i + 1);
    }
  });

  it('label follows AZ-primary + EN-in-parens convention', () => {
    for (const def of COST_TYPE_DEFS) {
      expect(def.label).toMatch(/.+\s\([A-Z][a-zA-Z\s-]+\)$/);
    }
  });

  it('CostTypeDef shape matches expected interface', () => {
    const sample: CostTypeDef = COST_TYPE_DEFS[0];
    expect(typeof sample.key).toBe('string');
    expect(typeof sample.label).toBe('string');
    expect(typeof sample.sortOrder).toBe('number');
  });

  it('CostTypeKey type narrows to literal union of keys', () => {
    // Compile-time test — runtime tautology proves typed-tuple
    // narrowing works for downstream callers. The `as const` on
    // COST_TYPE_DEFS (without an explicit widening annotation —
    // architect Turn LV Проблема fix) makes CostTypeKey resolve to
    // the literal union "staff"|"utilities"|... not plain `string`.
    const sample: CostTypeKey = 'staff';
    const keys = COST_TYPE_DEFS.map((c) => c.key);
    expect(keys).toContain(sample);
    // @ts-expect-error — 'invalid_key' is not a member of the literal
    // union; if this line stops erroring, the type widening regression
    // is back and CostTypeKey collapsed to `string`.
    const _badSample: CostTypeKey = 'invalid_key';
    void _badSample;
  });

  it('staff is sortOrder 1 (P&L row-1 stability lock)', () => {
    // Mirror of the AAC P&L convention: staff costs lead the
    // operating-expense table. Reorder would move every downstream
    // line shift but tests would catch.
    expect(COST_TYPE_DEFS[0].key).toBe('staff');
    expect(COST_TYPE_DEFS[0].sortOrder).toBe(1);
  });

  it('depreciation is the last entry (sortOrder 13)', () => {
    // Convention: depreciation comes last because it is below-
    // operating-line in IFRS-style P&L.
    expect(COST_TYPE_DEFS[COST_TYPE_DEFS.length - 1].key).toBe(
      'depreciation',
    );
    expect(COST_TYPE_DEFS[COST_TYPE_DEFS.length - 1].sortOrder).toBe(13);
  });
});
