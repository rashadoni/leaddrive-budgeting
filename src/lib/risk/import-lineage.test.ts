/**
 * Phase 10 / Stage B5 — the ids a real import puts in a revision.
 *
 * These tests exist to pin one property above all: the identifiers are
 * *derived from what was actually imported*. A placeholder would pass a
 * "revision exists" assertion just as well as a real id, and the whole point of
 * lineage is that it cannot.
 */

import { describe, it, expect } from 'vitest';
import type { MappingProposal } from '@/lib/onboarding/ai-mapper/types';
import {
  buildImportRevisionScope,
  effectiveMappingVersionId,
  importStagingArtifactId,
} from './import-lineage';
import { computeRevisionContentHash } from './data-revision';

function mapping(overrides: Partial<MappingProposal> = {}): MappingProposal {
  return {
    columns: [
      { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: 'looks like codes' },
      { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: 'prose' },
      { sourceIndex: 2, role: 'amount:Jan', confidence: 0.8, reasoning: 'numeric' },
    ],
    accountTypeOverrides: [
      { code: '601-04', accountType: 'revenue', confidence: 0.9, reasoning: 'sales' },
    ],
    anomalies: [],
    overallConfidence: 0.87,
    ...overrides,
  } as MappingProposal;
}

describe('importStagingArtifactId', () => {
  it('names the staging row, not the filename', () => {
    // The filename is the trap: two unrelated workbooks are both `budget.xlsx`.
    // The id must carry the staging row's identity so they cannot collide.
    expect(importStagingArtifactId('stg_abc123')).toBe('import-staging:stg_abc123');
  });

  it('gives two uploads of the same filename two different artifact ids', () => {
    expect(importStagingArtifactId('stg_1')).not.toBe(importStagingArtifactId('stg_2'));
  });
});

describe('effectiveMappingVersionId', () => {
  it('is stable for the same mapping decisions', () => {
    expect(effectiveMappingVersionId(mapping())).toBe(
      effectiveMappingVersionId(mapping()),
    );
  });

  it('ignores the mapper\'s commentary — reworded reasoning is the same mapping', () => {
    // An LLM re-run that explains itself differently while mapping every column
    // identically has not changed the mapping. If this ever fails, every
    // re-analysis spawns a phantom revision claiming the source moved.
    const reworded = mapping({
      columns: [
        { sourceIndex: 0, role: 'code', confidence: 0.55, reasoning: 'totally different prose' },
        { sourceIndex: 1, role: 'label', confidence: 0.11, reasoning: 'reworded' },
        { sourceIndex: 2, role: 'amount:Jan', confidence: 0.99, reasoning: 'changed' },
      ],
    } as Partial<MappingProposal>);
    expect(effectiveMappingVersionId(reworded)).toBe(effectiveMappingVersionId(mapping()));
  });

  it('ignores column authoring order', () => {
    const reordered = mapping({
      columns: [
        { sourceIndex: 2, role: 'amount:Jan', confidence: 0.8, reasoning: 'numeric' },
        { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: 'looks like codes' },
        { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: 'prose' },
      ],
    } as Partial<MappingProposal>);
    expect(effectiveMappingVersionId(reordered)).toBe(effectiveMappingVersionId(mapping()));
  });

  it('moves when a column role changes — that IS a mapping change', () => {
    const roleFlipped = mapping({
      columns: [
        { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: 'looks like codes' },
        { sourceIndex: 1, role: 'skip', confidence: 0.9, reasoning: 'prose' },
        { sourceIndex: 2, role: 'amount:Jan', confidence: 0.8, reasoning: 'numeric' },
      ],
    } as Partial<MappingProposal>);
    expect(effectiveMappingVersionId(roleFlipped)).not.toBe(
      effectiveMappingVersionId(mapping()),
    );
  });

  it('moves when an account type is overridden differently', () => {
    const retyped = mapping({
      accountTypeOverrides: [
        { code: '601-04', accountType: 'expense', confidence: 0.9, reasoning: 'sales' },
      ],
    } as Partial<MappingProposal>);
    expect(effectiveMappingVersionId(retyped)).not.toBe(
      effectiveMappingVersionId(mapping()),
    );
  });

  it('moves when a column\'s currency changes — that decides which money lands', () => {
    // `currencyCode` picks which amount column wins on a multi-currency sheet
    // and tags BudgetLine.currencyCode (ai-mapper/applier → resolveColumns).
    // It changes the numbers written, so it is a mapping decision, not a note.
    const usd = mapping({
      columns: [
        { sourceIndex: 0, role: 'code', confidence: 0.9, reasoning: 'looks like codes' },
        { sourceIndex: 1, role: 'label', confidence: 0.9, reasoning: 'prose' },
        { sourceIndex: 2, role: 'amount:Jan', confidence: 0.8, reasoning: 'numeric', currencyCode: 'USD' },
      ],
    } as Partial<MappingProposal>);
    expect(effectiveMappingVersionId(usd)).not.toBe(effectiveMappingVersionId(mapping()));
  });

  it('normalises currency the way the applier does — usd and USD are one mapping', () => {
    const lower = mapping({
      columns: [
        { sourceIndex: 2, role: 'amount:Jan', confidence: 0.8, reasoning: 'n', currencyCode: ' usd ' },
      ],
    } as Partial<MappingProposal>);
    const upper = mapping({
      columns: [
        { sourceIndex: 2, role: 'amount:Jan', confidence: 0.8, reasoning: 'n', currencyCode: 'USD' },
      ],
    } as Partial<MappingProposal>);
    expect(effectiveMappingVersionId(lower)).toBe(effectiveMappingVersionId(upper));
  });

  it('is a namespaced sha256, not a bare digest', () => {
    expect(effectiveMappingVersionId(mapping())).toMatch(
      /^effective-mapping:[0-9a-f]{64}$/,
    );
  });
});

describe('buildImportRevisionScope', () => {
  const base = {
    organizationId: 'org_1',
    companyId: 'co_1',
    stagingId: 'stg_1',
    effectiveMapping: mapping(),
    targetYear: 2026,
  };

  it('carries real ids derived from the import — no placeholders', () => {
    const scope = buildImportRevisionScope(base);
    expect(scope.organizationId).toBe('org_1');
    expect(scope.companyIds).toEqual(['co_1']);
    expect(scope.sourceArtifactIds).toEqual(['import-staging:stg_1']);
    expect(scope.mappingVersionIds).toEqual([effectiveMappingVersionId(mapping())]);
    // Nothing here may be a constant the writer made up.
    for (const id of [...scope.sourceArtifactIds, ...scope.mappingVersionIds]) {
      expect(id).not.toMatch(/unknown|placeholder|todo|tbd|n\/a/i);
    }
  });

  it('spans the fiscal year the apply actually writes', () => {
    const scope = buildImportRevisionScope(base);
    expect(scope.periodFrom).toBe('2026-01');
    expect(scope.periodTo).toBe('2026-12');
  });

  it('gives two different staging rows two different revision identities', () => {
    // Re-uploading a changed workbook under the same name must not be handed
    // the first import's lineage.
    const a = computeRevisionContentHash({ scope: buildImportRevisionScope(base), reason: 'import' });
    const b = computeRevisionContentHash({
      scope: buildImportRevisionScope({ ...base, stagingId: 'stg_2' }),
      reason: 'import',
    });
    expect(a).not.toBe(b);
  });

  // Determinism of the identity itself. Note the apply route makes a literal
  // re-apply unreachable (the staging claim 409s the second POST), so this
  // pins the hash contract, not a route-level reuse path.
  it('is deterministic for the same staging row', () => {
    const a = computeRevisionContentHash({ scope: buildImportRevisionScope(base), reason: 'import' });
    const b = computeRevisionContentHash({ scope: buildImportRevisionScope(base), reason: 'import' });
    expect(a).toBe(b);
  });

  it('separates organizations even when everything else matches', () => {
    const a = computeRevisionContentHash({ scope: buildImportRevisionScope(base), reason: 'import' });
    const b = computeRevisionContentHash({
      scope: buildImportRevisionScope({ ...base, organizationId: 'org_2' }),
      reason: 'import',
    });
    expect(a).not.toBe(b);
  });

  it('moves the revision identity when the mapping changed but the file did not', () => {
    // §5.2: a mapping change is a source-state change. Same workbook, remapped.
    const remapped = mapping({
      accountTypeOverrides: [
        { code: '601-04', accountType: 'cogs', confidence: 0.9, reasoning: 'reclassified' },
      ],
    } as Partial<MappingProposal>);
    const a = computeRevisionContentHash({ scope: buildImportRevisionScope(base), reason: 'import' });
    const b = computeRevisionContentHash({
      scope: buildImportRevisionScope({ ...base, effectiveMapping: remapped }),
      reason: 'import',
    });
    expect(a).not.toBe(b);
  });
});
