import { describe, it, expect } from 'vitest';
import {
  canonicalizeHeaders,
  normalizeRow,
  findWorkbookDuplicates,
  type NormalizedRow,
  type ImportRow,
} from './companies-import';

describe('canonicalizeHeaders', () => {
  it('maps any casing / whitespace to camelCase keys', () => {
    const out = canonicalizeHeaders([
      {
        CODE: 'HLT',
        ' Name ': 'Hilton',
        INDUSTRY: 'hospitality',
        Level: '2',
        parentCompanyCode: 'AAC',
      },
    ]);
    expect(out[0]).toEqual({
      code: 'HLT',
      name: 'Hilton',
      industry: 'hospitality',
      level: '2',
      parentCompanyCode: 'AAC',
    });
  });

  it('drops unknown columns silently (organizationId leak guard)', () => {
    const out = canonicalizeHeaders([
      { code: 'X', name: 'Y', organizationId: 'attacker-org' },
    ]);
    expect(out[0]).toEqual({ code: 'X', name: 'Y' });
    expect('organizationId' in out[0]).toBe(false);
  });
});

describe('normalizeRow — required fields', () => {
  it('flags missing code', () => {
    const r = normalizeRow({ name: 'Hilton' }, 0);
    expect('reason' in r && r.reason).toMatch(/code is required/);
  });

  it('flags missing name', () => {
    const r = normalizeRow({ code: 'HLT' }, 0);
    expect('reason' in r && r.reason).toMatch(/name is required/);
  });

  it('reports row numbers as 1-based + header offset (first data row = 2)', () => {
    const r = normalizeRow({ name: 'X' }, 0);
    expect('row' in r && r.row).toBe(2);
    const r2 = normalizeRow({ name: 'X' }, 5);
    expect('row' in r2 && r2.row).toBe(7);
  });

  it('rejects oversize code / name', () => {
    const r = normalizeRow({ code: 'X'.repeat(65), name: 'OK' }, 0);
    expect('reason' in r && r.reason).toMatch(/code max length/);
    const r2 = normalizeRow({ code: 'OK', name: 'X'.repeat(256) }, 0);
    expect('reason' in r2 && r2.reason).toMatch(/name max length/);
  });
});

describe('normalizeRow — level parsing', () => {
  it('defaults level=2 when column is blank', () => {
    const r = normalizeRow(
      { code: 'HLT', name: 'Hilton', industry: 'hospitality', parentCompanyCode: 'AAC' },
      0,
    );
    expect('level' in r && r.level).toBe(2);
  });

  it('accepts level=1 (sub-group)', () => {
    const r = normalizeRow({ code: 'AAC', name: 'AAC Group', level: 1 }, 0);
    expect('level' in r && r.level).toBe(1);
  });

  it('rejects level other than 1 or 2', () => {
    const r = normalizeRow({ code: 'X', name: 'Y', level: 3 }, 0);
    expect('reason' in r && r.reason).toMatch(/level must be 1 or 2/);
  });

  it('rejects non-numeric level', () => {
    const r = normalizeRow({ code: 'X', name: 'Y', level: 'abc' }, 0);
    expect('reason' in r && r.reason).toMatch(/level must be 1 or 2/);
  });
});

describe('normalizeRow — level/parent/industry cross-rules', () => {
  it('rejects level=1 with a parentCompanyCode', () => {
    const r = normalizeRow(
      { code: 'AAC', name: 'AAC', level: 1, parentCompanyCode: 'FO' },
      0,
    );
    expect('reason' in r && r.reason).toMatch(
      /level=1 must not have a parentCompanyCode/,
    );
  });

  it('rejects level=2 without parentCompanyCode', () => {
    const r = normalizeRow(
      { code: 'HLT', name: 'Hilton', industry: 'hospitality' },
      0,
    );
    expect('reason' in r && r.reason).toMatch(/level=2 requires parentCompanyCode/);
  });

  it('rejects level=2 without industry', () => {
    const r = normalizeRow(
      { code: 'HLT', name: 'Hilton', parentCompanyCode: 'AAC' },
      0,
    );
    expect('reason' in r && r.reason).toMatch(/level=2 requires industry/);
  });

  it('accepts valid level=2 row', () => {
    const r = normalizeRow(
      {
        code: 'HLT',
        name: 'Hilton',
        industry: 'hospitality',
        parentCompanyCode: 'AAC',
      },
      0,
    );
    expect('code' in r).toBe(true);
    if ('code' in r) {
      expect(r.code).toBe('HLT');
      expect(r.industry).toBe('hospitality');
      expect(r.level).toBe(2);
      expect(r.parentCompanyCode).toBe('AAC');
    }
  });

  it('accepts valid level=1 row (industry optional)', () => {
    const r = normalizeRow({ code: 'AAC', name: 'AAC Group', level: 1 }, 0);
    expect('code' in r).toBe(true);
    if ('code' in r) {
      expect(r.level).toBe(1);
      expect(r.industry).toBeNull();
      expect(r.parentCompanyCode).toBeNull();
    }
  });
});

describe('normalizeRow — string trimming', () => {
  it('trims whitespace from code / name / industry / parentCompanyCode', () => {
    const r = normalizeRow(
      {
        code: '  HLT  ',
        name: ' Hilton ',
        industry: '  hospitality  ',
        parentCompanyCode: '  AAC  ',
      },
      0,
    );
    if ('code' in r) {
      expect(r.code).toBe('HLT');
      expect(r.name).toBe('Hilton');
      expect(r.industry).toBe('hospitality');
      expect(r.parentCompanyCode).toBe('AAC');
    }
  });

  it('treats whitespace-only industry as null', () => {
    const r = normalizeRow(
      {
        code: 'AAC',
        name: 'AAC',
        level: 1,
        industry: '   ',
      },
      0,
    );
    if ('code' in r) expect(r.industry).toBeNull();
  });

  it('canonicalizes industry to snake_case_lowercase (FK-safe)', () => {
    // Inputs users will actually paste from Excel — canonicalize before write
    // so the Industry.code FK resolves even with "Hospitality" or "Real Estate".
    const r1 = normalizeRow(
      { code: 'X', name: 'Y', industry: 'Hospitality', parentCompanyCode: 'P' },
      0,
    );
    if ('industry' in r1) expect(r1.industry).toBe('hospitality');
    const r2 = normalizeRow(
      { code: 'X', name: 'Y', industry: 'Real Estate', parentCompanyCode: 'P' },
      0,
    );
    if ('industry' in r2) expect(r2.industry).toBe('real_estate');
  });
});

describe('findWorkbookDuplicates', () => {
  function norm(code: string): NormalizedRow {
    return {
      code,
      name: code,
      industry: null,
      level: 1,
      parentCompanyCode: null,
    };
  }

  it('flags the SECOND occurrence of a duplicate code', () => {
    const dups = findWorkbookDuplicates([norm('HLT'), norm('HLT')]);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toEqual({
      row: 3,
      reason: 'duplicate code "HLT" (first seen at row 2)',
    });
  });

  it('returns no errors on unique codes', () => {
    expect(findWorkbookDuplicates([norm('A'), norm('B')])).toEqual([]);
  });

  it('flags every subsequent occurrence, keeping first-seen stable', () => {
    const dups = findWorkbookDuplicates([
      norm('X'), // row 2 — first
      norm('Y'), // row 3
      norm('X'), // row 4 — dup
      norm('X'), // row 5 — dup
    ]);
    expect(dups).toHaveLength(2);
    expect(dups[0].row).toBe(4);
    expect(dups[1].row).toBe(5);
  });
});

describe('canonicalizeHeaders + normalizeRow together', () => {
  it('strips an attacker-supplied organizationId column and validates normally', () => {
    const raw: Record<string, unknown>[] = [
      {
        ORGANIZATIONID: 'not-my-org',
        Code: 'HLT',
        Name: 'Hilton',
        Industry: 'hospitality',
        Level: 2,
        ParentCompanyCode: 'AAC',
      },
    ];
    const canonical = canonicalizeHeaders(raw);
    expect('organizationId' in (canonical[0] as ImportRow)).toBe(false);
    const result = normalizeRow(canonical[0], 0);
    expect('code' in result).toBe(true);
  });
});
