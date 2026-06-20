/**
 * Phase C slice C2.1 — per-entity split parser tests.
 *
 * A sheet with a business-unit / entity column must route each row to a
 * company. The split parser groups rows by the `entity`-roled column value,
 * then runs the EXISTING `applyProposal` on each group — so dedup,
 * control-totals and section-tracking stay ENTITY-LOCAL. These tests lock the
 * correctness boundary Codex flagged (2026-06-20): a flat parse would collapse
 * the same leaf code across entities; per-entity parse must not.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  findEntityColumn,
  extractEntityValues,
  applyProposalByEntity,
} from './entity-split';
import { computeControlTotals } from './control-totals';
import type { ColumnMappingProposal, MappingProposal } from './types';

function makeWorkbook(aoa: (string | number | null)[][], sheetName = 'Sheet1') {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** code(0) + label(1) + Jan..Dec(2..13) + entity(14). */
function multiEntityProposal(): MappingProposal {
  const columns: ColumnMappingProposal[] = [
    { sourceIndex: 0, role: 'code', confidence: 0.95, reasoning: 'code' },
    { sourceIndex: 1, role: 'label', confidence: 0.95, reasoning: 'label' },
    ...MONTHS.map((m, i) => ({
      sourceIndex: 2 + i,
      role: `amount:${m}` as const,
      confidence: 0.9,
      reasoning: `${m}`,
    })),
    { sourceIndex: 14, role: 'entity', confidence: 0.9, reasoning: 'BU column' },
  ];
  return {
    sourceFile: 'multi.xlsx',
    sourceSheet: 'Sheet1',
    columns,
    accountTypeOverrides: [
      { code: 'PLF.01', accountType: 'revenue', confidence: 0.9, reasoning: 'revenue section' },
    ],
    anomalies: [],
    overallConfidence: 0.9,
    summary: 'multi-entity P&L',
  };
}

/** One data row: code, label, Jan value (rest 0), entity. */
function row(code: string, label: string, jan: number, entity: string | null): (string | number | null)[] {
  const r: (string | number | null)[] = [code, label, jan, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  r[14] = entity;
  return r;
}

const HEADER = ['Code', 'Label', ...MONTHS, 'BU'];

describe('findEntityColumn', () => {
  it('returns the source index of the entity-roled column', () => {
    expect(findEntityColumn(multiEntityProposal().columns)).toBe(14);
  });
  it('returns null when no column is roled entity', () => {
    const cols = multiEntityProposal().columns.filter((c) => c.role !== 'entity');
    expect(findEntityColumn(cols)).toBeNull();
  });
});

describe('extractEntityValues', () => {
  it('returns distinct entity values in first-appearance order', () => {
    const wb = makeWorkbook([
      HEADER,
      row('PLF.01.01', 'Sales', 100, 'AZSF'),
      row('PLF.01.01', 'Sales', 200, 'EDEN'),
      row('PLF.01.02', 'Other', 50, 'AZSF'),
    ]);
    expect(extractEntityValues(wb, 'Sheet1', 14, XLSX)).toEqual(['AZSF', 'EDEN']);
  });

  it('surfaces a blank entity cell as its own "" bucket (never dropped)', () => {
    const wb = makeWorkbook([
      HEADER,
      row('PLF.01.01', 'Sales', 100, 'AZSF'),
      row('PLF.01.02', 'Mystery', 70, null),
    ]);
    expect(extractEntityValues(wb, 'Sheet1', 14, XLSX)).toEqual(['AZSF', '']);
  });
});

describe('applyProposalByEntity', () => {
  it('splits by entity and parses each group independently', () => {
    const wb = makeWorkbook([
      HEADER,
      row('PLF.01.01', 'Sales', 100, 'AZSF'),
      row('PLF.01.01', 'Sales', 200, 'EDEN'),
    ]);
    const out = applyProposalByEntity(wb, 'Sheet1', multiEntityProposal(), XLSX);
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.entityColumn).toBe(14);
    expect(out.entityValues).toEqual(['AZSF', 'EDEN']);
    expect(out.perEntity).toHaveLength(2);

    const azsf = out.perEntity.find((p) => p.entityValue === 'AZSF');
    const eden = out.perEntity.find((p) => p.entityValue === 'EDEN');
    expect(azsf && 'result' in azsf).toBe(true);
    expect(eden && 'result' in eden).toBe(true);
    if (!azsf || !('result' in azsf) || !eden || !('result' in eden)) return;

    // Same leaf code under both entities — NOT cross-deduped: each result keeps
    // its own line with its own amount (the corruption Codex flagged).
    const azsfLine = azsf.result.lines.find((l) => l.code === 'PLF.01.01');
    const edenLine = eden.result.lines.find((l) => l.code === 'PLF.01.01');
    expect(azsfLine?.plannedAnnual).toBe(100);
    expect(edenLine?.plannedAnnual).toBe(200);
  });

  it('computes control-totals per entity (independent verdicts)', () => {
    const wb = makeWorkbook([
      HEADER,
      // AZSF: parent 100 reconciles to leaf 100 → green.
      row('PLF.01', 'Revenue', 100, 'AZSF'),
      row('PLF.01.01', 'Sales', 100, 'AZSF'),
      // EDEN: parent 999 vs leaf 200 → red.
      row('PLF.01', 'Revenue', 999, 'EDEN'),
      row('PLF.01.01', 'Sales', 200, 'EDEN'),
    ]);
    const out = applyProposalByEntity(wb, 'Sheet1', multiEntityProposal(), XLSX);
    if ('error' in out) throw new Error(out.error);

    const verdict = (val: string) => {
      const e = out.perEntity.find((p) => p.entityValue === val);
      if (!e || !('result' in e)) throw new Error(`no result for ${val}`);
      return computeControlTotals(
        e.result.parentRollupsDropped,
        e.result.parentRollupsUnallocated,
      ).verdict;
    };
    expect(verdict('AZSF')).toBe('green');
    expect(verdict('EDEN')).toBe('red');
  });

  it('keeps blank-entity data rows in their own "" bucket (not dropped, not merged)', () => {
    const wb = makeWorkbook([
      HEADER,
      row('PLF.01.01', 'Sales', 100, 'AZSF'),
      row('PLF.01.02', 'Mystery', 70, null),
    ]);
    const out = applyProposalByEntity(wb, 'Sheet1', multiEntityProposal(), XLSX);
    if ('error' in out) throw new Error(out.error);
    const blank = out.perEntity.find((p) => p.entityValue === '');
    expect(blank && 'result' in blank).toBe(true);
    if (!blank || !('result' in blank)) return;
    expect(blank.result.lines.find((l) => l.code === 'PLF.01.02')?.plannedAnnual).toBe(70);
  });

  it('honors a userOverride that flips a column to the entity role', () => {
    // AI mapped col 14 as skip; reviewer flips it to entity.
    const proposal = multiEntityProposal();
    proposal.columns = proposal.columns.map((c) =>
      c.sourceIndex === 14 ? { ...c, role: 'skip' as const } : c,
    );
    const wb = makeWorkbook([
      HEADER,
      row('PLF.01.01', 'Sales', 100, 'AZSF'),
      row('PLF.01.01', 'Sales', 200, 'EDEN'),
    ]);
    const out = applyProposalByEntity(wb, 'Sheet1', proposal, XLSX, {
      columns: [{ sourceIndex: 14, role: 'entity', confidence: 1, reasoning: 'manual' }],
    });
    if ('error' in out) throw new Error(out.error);
    expect(out.entityValues).toEqual(['AZSF', 'EDEN']);
  });

  it('returns an error when there is no entity column', () => {
    const proposal = multiEntityProposal();
    proposal.columns = proposal.columns.filter((c) => c.role !== 'entity');
    const wb = makeWorkbook([HEADER, row('PLF.01.01', 'Sales', 100, 'AZSF')]);
    const out = applyProposalByEntity(wb, 'Sheet1', proposal, XLSX);
    expect('error' in out).toBe(true);
  });
});
