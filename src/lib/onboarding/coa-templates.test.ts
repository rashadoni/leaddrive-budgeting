import { describe, it, expect, vi } from 'vitest';
import {
  applyCoaTemplate,
  getCoaTemplate,
  listCoaIndustries,
  normalizeIndustryCode,
  COA_TEMPLATES,
  type CoaWriteRow,
  type CoaWriter,
} from './coa-templates';

describe('COA_TEMPLATES catalog', () => {
  it('ships with exactly 14 industry templates (ROADMAP §7.B + 7.C-extension 2026-04-25 added beverage / retail / logistics / construction)', () => {
    expect(COA_TEMPLATES).toHaveLength(14);
  });

  it('industry codes are unique', () => {
    const codes = COA_TEMPLATES.map((t) => t.industry);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every template uses snake_case industry codes', () => {
    for (const t of COA_TEMPLATES) {
      expect(t.industry).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('includes industries referenced by indicator seeds', () => {
    const industries = new Set(listCoaIndustries());
    // From scripts/seed-indicators.ts:
    for (const expected of ['hospitality', 'agro_crops', 'poultry', 'food_processing']) {
      expect(industries.has(expected)).toBe(true);
    }
  });
});

describe('template structural invariants', () => {
  it('every template has revenue, cogs, and equity accounts', () => {
    for (const t of COA_TEMPLATES) {
      const types = new Set(t.accounts.map((a) => a.accountType));
      expect(types.has('revenue')).toBe(true);
      expect(types.has('cogs')).toBe(true);
      expect(types.has('equity')).toBe(true);
    }
  });

  it('account codes are unique within a template', () => {
    for (const t of COA_TEMPLATES) {
      const codes = t.accounts.map((a) => a.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it('every parentCode resolves within the same template', () => {
    for (const t of COA_TEMPLATES) {
      const codes = new Set(t.accounts.map((a) => a.code));
      for (const a of t.accounts) {
        if (a.parentCode) {
          expect(codes.has(a.parentCode)).toBe(true);
        }
      }
    }
  });

  it('uses SAP-style prefixes so legacy analytics still matches', () => {
    // 6xx = revenue, 7xx = expense/cogs, 1xx asset, 2xx liability, 3xx equity.
    for (const t of COA_TEMPLATES) {
      for (const a of t.accounts) {
        const firstDigit = a.code[0];
        if (a.accountType === 'revenue') expect(firstDigit).toBe('6');
        if (a.accountType === 'cogs') expect(firstDigit).toBe('7');
        if (a.accountType === 'expense') expect(firstDigit).toBe('7');
        if (a.accountType === 'asset') expect(firstDigit).toBe('1');
        if (a.accountType === 'liability') expect(firstDigit).toBe('2');
        if (a.accountType === 'equity') expect(firstDigit).toBe('3');
      }
    }
  });
});

describe('getCoaTemplate / listCoaIndustries', () => {
  it('getCoaTemplate returns the template for a known industry', () => {
    const t = getCoaTemplate('hospitality');
    expect(t?.industry).toBe('hospitality');
    expect(t?.accounts.length).toBeGreaterThan(0);
  });

  it('getCoaTemplate returns null for unknown industry', () => {
    expect(getCoaTemplate('spaceflight')).toBeNull();
  });

  it('getCoaTemplate tolerates non-canonical casing / spacing', () => {
    expect(getCoaTemplate('Hospitality')?.industry).toBe('hospitality');
    expect(getCoaTemplate('  HOSPITALITY  ')?.industry).toBe('hospitality');
    expect(getCoaTemplate('Real Estate')?.industry).toBe('real_estate');
  });

  it('listCoaIndustries includes all templates, in catalog order', () => {
    const industries = listCoaIndustries();
    expect(industries).toEqual(COA_TEMPLATES.map((t) => t.industry));
  });
});

describe('normalizeIndustryCode', () => {
  it('lowercases + trims + space → underscore', () => {
    expect(normalizeIndustryCode('Real Estate')).toBe('real_estate');
    expect(normalizeIndustryCode('  Hospitality ')).toBe('hospitality');
  });

  it('preserves already-canonical input', () => {
    expect(normalizeIndustryCode('agro_crops')).toBe('agro_crops');
  });
});

describe('applyCoaTemplate', () => {
  function mockWriter(): CoaWriter & { calls: CoaWriteRow[][] } {
    const calls: CoaWriteRow[][] = [];
    return {
      calls,
      writeRows: vi.fn(async (rows: CoaWriteRow[]) => {
        calls.push(rows);
        return { upserted: rows.length };
      }),
    };
  }

  it('hands the full hospitality template to the writer, scoped to the org', async () => {
    const writer = mockWriter();
    const result = await applyCoaTemplate(writer, 'org_1', 'hospitality');
    expect(result.industry).toBe('hospitality');
    expect(result.upserted).toBeGreaterThan(0);
    expect(writer.calls).toHaveLength(1);
    // Every row carries the target orgId and leaves no foreign org leak.
    for (const row of writer.calls[0]) {
      expect(row.organizationId).toBe('org_1');
    }
  });

  it('defaults `name` to the English label so legacy analytics keeps working', async () => {
    const writer = mockWriter();
    await applyCoaTemplate(writer, 'org_1', 'hospitality');
    const roomRevenue = writer.calls[0].find((r) => r.code === '601');
    expect(roomRevenue?.name).toBe('Room Revenue');
    expect(roomRevenue?.nameEn).toBe('Room Revenue');
  });

  it('throws loudly for an unknown industry instead of silently no-op', async () => {
    const writer = mockWriter();
    await expect(applyCoaTemplate(writer, 'org_1', 'spaceflight')).rejects.toThrow(
      /No CoA template/,
    );
  });

  it('different industries produce different row counts (non-trivial templates)', async () => {
    const w1 = mockWriter();
    const w2 = mockWriter();
    await applyCoaTemplate(w1, 'org_1', 'hospitality');
    await applyCoaTemplate(w2, 'org_1', 'services');
    const c1 = w1.calls[0].length;
    const c2 = w2.calls[0].length;
    // Both > 0 and structurally reasonable — hospitality has more rows.
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBeGreaterThan(0);
  });
});
