/**
 * Phase 2.2 step 1 — AAC product catalog shape lock.
 *
 * The 4 arrays (CODES + NAMES + UNITS + SALES_SHEETS) must stay
 * index-aligned because the legacy import-excel route iterates them
 * in lock-step (`for i in range(...)` PRODUCT_CODES[i] paired with
 * PRODUCT_NAMES[i] + PRODUCT_UNITS[i] + SALES_SHEETS[i]). A length
 * mismatch or duplicate-code regression would silently miswire the
 * cost-model resolver paths for AAC's xlsx import.
 */

import { describe, it, expect } from 'vitest';
import {
  PRODUCT_CODES,
  PRODUCT_NAMES,
  PRODUCT_UNITS,
  SALES_SHEETS,
  type AacProductCode,
} from './aac-products';

describe('AAC product catalog (Phase 2.2 step 1 extraction)', () => {
  it('all 4 arrays are the same length (index-aligned contract)', () => {
    expect(PRODUCT_CODES.length).toBe(6);
    expect(PRODUCT_NAMES.length).toBe(PRODUCT_CODES.length);
    expect(PRODUCT_UNITS.length).toBe(PRODUCT_CODES.length);
    expect(SALES_SHEETS.length).toBe(PRODUCT_CODES.length);
  });

  it('PRODUCT_CODES are unique', () => {
    const set = new Set(PRODUCT_CODES);
    expect(set.size).toBe(PRODUCT_CODES.length);
  });

  it('PRODUCT_CODES use uppercase + underscore convention (no spaces or lowercase)', () => {
    for (const code of PRODUCT_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });

  it('SALES_SHEETS are unique + match S-N pattern', () => {
    const set = new Set(SALES_SHEETS);
    expect(set.size).toBe(SALES_SHEETS.length);
    for (const sheet of SALES_SHEETS) {
      expect(sheet).toMatch(/^S-\d+$/);
    }
  });

  it('PRODUCT_UNITS are within the AZ unit vocabulary (m3 / ton / ədəd)', () => {
    const allowed = new Set(['m3', 'ton', 'ədəd']);
    for (const unit of PRODUCT_UNITS) {
      expect(allowed.has(unit)).toBe(true);
    }
  });

  it('AacProductCode type matches PRODUCT_CODES values exactly', () => {
    // Compile-time type assertion — runtime tautology but proves the
    // typed-tuple narrowing works for downstream callers.
    const sample: AacProductCode = 'MHB';
    expect(PRODUCT_CODES).toContain(sample);
  });

  it('first product is MHB (Qaz beton) — the AAC flagship product', () => {
    // Stability lock: a future contributor must NOT reorder the array
    // without coordinating with the cost-model resolvers that key off
    // index position (e.g. `productIdx: 0` in the C-4 sheet mapping).
    expect(PRODUCT_CODES[0]).toBe('MHB');
    expect(PRODUCT_NAMES[0]).toBe('MHB (Qaz beton)');
    expect(SALES_SHEETS[0]).toBe('S-1');
  });
});
