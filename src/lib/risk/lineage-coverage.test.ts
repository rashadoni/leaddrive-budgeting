/**
 * Phase 11.86 — the rule that decides which observations an import revision may
 * claim.
 *
 * Every test here is a claim the gate must refuse to make. The module can only
 * ever withhold, so the interesting cases are all "does it withhold when it
 * should", and there is exactly one shape that must return the revision.
 */

import { describe, it, expect } from 'vitest';
import {
  IMPORT_COVERABLE_FAMILIES,
  coverableFamilyForDataType,
  deserializeImportLineage,
  indicatorInputsCovered,
  isImportCoverableFamily,
  lineageRevisionForPair,
  periodWithinRevision,
  planKindCoversFamily,
  serializeImportLineage,
  type ImportCoverableFamily,
  type ImportLineage,
} from './lineage-coverage';

const ALL: ReadonlySet<ImportCoverableFamily> = new Set(IMPORT_COVERABLE_FAMILIES);
const PL_ONLY: ReadonlySet<ImportCoverableFamily> = new Set(['budgetLine']);

function lineage(
  coverage: Record<string, ImportCoverableFamily[]>,
): ImportLineage {
  return {
    revisionId: 'rev_1',
    periodFrom: '2026-01',
    periodTo: '2026-12',
    coverageByCompanyId: new Map(
      Object.entries(coverage).map(([id, fams]) => [id, new Set(fams)]),
    ),
  };
}

describe('indicatorInputsCovered', () => {
  it('covers an indicator whose entire declared input set is workbook data', () => {
    // The 29 production definitions with requiredInputs = {budgetLine}.
    expect(indicatorInputsCovered(['budgetLine'], PL_ONLY)).toBe(true);
    // Sub-keys resolve to the same family: `budgetLine.cogs` is a budgetLine.
    expect(
      indicatorInputsCovered(['budgetLine.cogs', 'balanceSheetLine.inventory'], ALL),
    ).toBe(true);
  });

  it('refuses an indicator with ONE input the import does not write', () => {
    // The real production shapes, one per family the import cannot attest to.
    // Each blends a workbook input with something else — the whole point is
    // that "mostly from the workbook" earns nothing.
    for (const foreign of [
      'commodityPrice:sugar_price_latest', // market feed
      'industryFactor:scope_1', // reference table
      'currencyRate', // FX feed
      'company.settings.hectaresPlanted', // manual setting
      'fact:IND_NET_MARGIN@2025', // cross-period read of another value
      'operationalFact:attendees', // KPI sheet, no clean-slate guarantee
      'rollup:IND_REVENUE_TOTAL', // children's data, children's lineage
    ]) {
      expect(indicatorInputsCovered(['budgetLine', foreign], ALL)).toBe(false);
    }
  });

  it('refuses a constant — a literal has no source state to pin', () => {
    // IND_GOV_CLIMATE_SCORE: formula `38`, requiredInputs []. 204 identical
    // rows on production. A revision on one would be provenance for nothing.
    expect(indicatorInputsCovered([], ALL)).toBe(false);
  });

  it('refuses when the caller did not project requiredInputs', () => {
    // Opposite default from `indicatorProvenance`, same principle: each
    // defaults to the answer that changes nothing. There, keep scoring. Here,
    // withhold the stamp.
    expect(indicatorInputsCovered(undefined, ALL)).toBe(false);
    expect(indicatorInputsCovered(null, ALL)).toBe(false);
  });

  it('refuses a family the run did not write for THIS company', () => {
    // A company that appeared only on the PLF tab has no balance sheet from
    // this import, so its inventory-turnover indicator stays untraced even
    // though a sibling's balance sheet was written in the same run.
    expect(
      indicatorInputsCovered(['balanceSheetLine.inventory'], PL_ONLY),
    ).toBe(false);
  });

  it('refuses malformed entries rather than filtering them into a vacuous pass', () => {
    expect(
      indicatorInputsCovered(['budgetLine', '' as string], ALL),
    ).toBe(false);
    expect(
      indicatorInputsCovered([null as unknown as string], ALL),
    ).toBe(false);
  });

  it('refuses everything when the company proved no families at all', () => {
    expect(indicatorInputsCovered(['budgetLine'], new Set())).toBe(false);
  });
});

describe('periodWithinRevision', () => {
  it('contains the FY period inside a month-keyed range', () => {
    // The trap `import-lineage.ts` flagged: lexically '2026' < '2026-01', so a
    // string compare drops the ONE period the HeatMap actually reads.
    expect('2026' < '2026-01').toBe(true);
    expect(periodWithinRevision('2026-01', '2026-12', '2026')).toBe(true);
  });

  it('contains months and quarters of the covered year', () => {
    expect(periodWithinRevision('2026-01', '2026-12', '2026-01')).toBe(true);
    expect(periodWithinRevision('2026-01', '2026-12', '2026-12')).toBe(true);
    expect(periodWithinRevision('2026-01', '2026-12', '2026-Q3')).toBe(true);
  });

  it('excludes a neighbouring year in both directions', () => {
    expect(periodWithinRevision('2026-01', '2026-12', '2025')).toBe(false);
    expect(periodWithinRevision('2026-01', '2026-12', '2025-12')).toBe(false);
    expect(periodWithinRevision('2026-01', '2026-12', '2027-01')).toBe(false);
  });

  it('excludes an LTM window that reaches back before the range', () => {
    // `2026-LTM-06` spans 2025-07..2026-06 — half of it predates the import.
    expect(periodWithinRevision('2026-01', '2026-12', '2026-LTM-06')).toBe(false);
  });

  it('fails closed on an unparseable key', () => {
    expect(periodWithinRevision('2026-01', '2026-12', 'not-a-period')).toBe(false);
    expect(periodWithinRevision('nonsense', '2026-12', '2026')).toBe(false);
  });
});

describe('planKindCoversFamily', () => {
  it('grants coverage only for the actual plan the resolvers read', () => {
    // `listBudgetLines` / `listBalanceSheetLines` both pin plan.kind="actual".
    // A forward budget plan is invisible to them, so writing one produces no
    // observation and must claim none — otherwise a 2026 budget import would
    // stamp its revision on values computed from the 2026 ACTUALS of an
    // earlier run.
    expect(planKindCoversFamily('actual')).toBe(true);
    expect(planKindCoversFamily('budget')).toBe(false);
    expect(planKindCoversFamily(null)).toBe(false);
    expect(planKindCoversFamily(undefined)).toBe(false);
  });
});

describe('coverableFamilyForDataType', () => {
  it('maps the three statement sheets whose batches clean-slate the year', () => {
    expect(coverableFamilyForDataType('PLF')).toBe('budgetLine');
    expect(coverableFamilyForDataType('BS')).toBe('balanceSheetLine');
    expect(coverableFamilyForDataType('CF')).toBe('cashFlow');
  });

  it('grants nothing for sheets whose adapters make no such guarantee', () => {
    for (const dt of ['KPI', 'SALES', 'LAND', 'CAPEX', 'COURT', 'AUDIT', 'COUNTERPARTY']) {
      expect(coverableFamilyForDataType(dt)).toBeNull();
    }
  });
});

describe('lineageRevisionForPair', () => {
  it('returns the revision for a covered company, indicator and period', () => {
    expect(
      lineageRevisionForPair(lineage({ c1: ['budgetLine'] }), {
        companyId: 'c1',
        requiredInputs: ['budgetLine'],
        period: '2026',
      }),
    ).toBe('rev_1');
  });

  it('returns undefined — not null — so the writer clears rather than stamps', () => {
    // `upsertIndicatorValue` treats `revisionId ?? null` as "clear it". The
    // distinction only matters at the type level, but a caller that started
    // passing `null` here would read identically and be wrong the day the
    // writer learns to distinguish them.
    const out = lineageRevisionForPair(undefined, {
      companyId: 'c1',
      requiredInputs: ['budgetLine'],
      period: '2026',
    });
    expect(out).toBeUndefined();
  });

  it('withholds for a company outside the committed scope', () => {
    expect(
      lineageRevisionForPair(lineage({ c1: ['budgetLine'] }), {
        companyId: 'c_untouched',
        requiredInputs: ['budgetLine'],
        period: '2026',
      }),
    ).toBeUndefined();
  });

  it('withholds for a period the revision does not span', () => {
    expect(
      lineageRevisionForPair(lineage({ c1: ['budgetLine'] }), {
        companyId: 'c1',
        requiredInputs: ['budgetLine'],
        period: '2025',
      }),
    ).toBeUndefined();
  });

  it('withholds for a feed-blended indicator even on a covered company', () => {
    expect(
      lineageRevisionForPair(lineage({ c1: ['budgetLine'] }), {
        companyId: 'c1',
        requiredInputs: ['budgetLine', 'commodityPrice:sugar_price_latest'],
        period: '2026',
      }),
    ).toBeUndefined();
  });
});

describe('serialisation across the queue boundary', () => {
  it('round-trips a lineage claim through JSON', () => {
    const original = lineage({ c1: ['budgetLine', 'balanceSheetLine'], c2: ['budgetLine'] });
    const revived = deserializeImportLineage(
      JSON.parse(JSON.stringify(serializeImportLineage(original))),
    );
    expect(revived.revisionId).toBe('rev_1');
    expect([...revived.coverageByCompanyId.get('c1')!].sort()).toEqual([
      'balanceSheetLine',
      'budgetLine',
    ]);
    expect(
      lineageRevisionForPair(revived, {
        companyId: 'c2',
        requiredInputs: ['budgetLine'],
        period: '2026-04',
      }),
    ).toBe('rev_1');
  });

  it('drops a family name the reading deploy does not know', () => {
    // A worker running older code than the enqueuer must not vouch for
    // coverage whose meaning it has never been told.
    const revived = deserializeImportLineage({
      revisionId: 'rev_1',
      periodFrom: '2026-01',
      periodTo: '2026-12',
      coverageByCompanyId: { c1: ['budgetLine', 'quantumLedger'] },
    });
    expect([...revived.coverageByCompanyId.get('c1')!]).toEqual(['budgetLine']);
    expect(
      lineageRevisionForPair(revived, {
        companyId: 'c1',
        requiredInputs: ['quantumLedger'],
        period: '2026',
      }),
    ).toBeUndefined();
  });

  it('a Map survives nothing but the serializer — the reason the field is typed', () => {
    // Guards the failure the SerializedImportLineage type exists to prevent:
    // passing the live object straight into a JSON job payload silently
    // produces coverage over nobody.
    const naive = JSON.parse(
      JSON.stringify(lineage({ c1: ['budgetLine'] })),
    ) as { coverageByCompanyId: Record<string, unknown> };
    expect(naive.coverageByCompanyId).toEqual({});
  });
});

describe('the family vocabulary', () => {
  it('recognises exactly the three statement families', () => {
    expect([...IMPORT_COVERABLE_FAMILIES]).toEqual([
      'budgetLine',
      'balanceSheetLine',
      'cashFlow',
    ]);
    expect(isImportCoverableFamily('budgetLine')).toBe(true);
    expect(isImportCoverableFamily('commodityPrice')).toBe(false);
    expect(isImportCoverableFamily('operationalFact')).toBe(false);
  });
});
