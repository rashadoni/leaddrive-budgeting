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
  buildBudgetImportRevisionScope,
  buildImportRevisionScope,
  buildMultiEntityImportRevisionScope,
  committedCompanyIds,
  LineageScopeError,
  effectiveMappingVersionId,
  importStagingArtifactId,
  parserMappingVersionId,
  workbookArtifactId,
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

describe('workbookArtifactId — the byte-exact half', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('fingerprints the bytes, namespaced and sheet-qualified', () => {
    expect(workbookArtifactId(bytes('hello'), 'SOPL')).toMatch(
      /^workbook-sha256:[0-9a-f]{64}#SOPL$/,
    );
  });

  it('is identical for identical bytes — a true re-upload reuses one revision', () => {
    expect(workbookArtifactId(bytes('same'), 'SOPL')).toBe(
      workbookArtifactId(bytes('same'), 'SOPL'),
    );
  });

  it('moves on a single changed byte — this is what the staging path cannot see', () => {
    expect(workbookArtifactId(bytes('v1'), 'SOPL')).not.toBe(
      workbookArtifactId(bytes('v2'), 'SOPL'),
    );
  });

  it('separates two sheets of the same workbook — an import applies one', () => {
    expect(workbookArtifactId(bytes('wb'), 'SOPL')).not.toBe(
      workbookArtifactId(bytes('wb'), 'BS'),
    );
  });
});

describe('parserMappingVersionId', () => {
  it('names the parser variant in force', () => {
    expect(parserMappingVersionId('sopl')).toBe('parser:sopl');
  });

  it('carries the entity column for a rollup — it selects which rows land', () => {
    expect(parserMappingVersionId('rollup', 'Mərkəz')).toBe('parser:rollup#Mərkəz');
  });

  it('distinguishes two rollup columns of the same parser', () => {
    expect(parserMappingVersionId('rollup', 'A')).not.toBe(
      parserMappingVersionId('rollup', 'B'),
    );
  });

  it('treats a blank header as absent rather than encoding whitespace', () => {
    expect(parserMappingVersionId('sopl', '   ')).toBe('parser:sopl');
  });
});

describe('buildBudgetImportRevisionScope', () => {
  const base = {
    organizationId: 'org_1',
    companyId: 'co_1',
    workbookBytes: new TextEncoder().encode('workbook-v1'),
    sheetName: 'SOPL',
    parser: 'sopl',
    targetYear: 2026,
  };

  it('carries real ids derived from the bytes and the parser — no placeholders', () => {
    const scope = buildBudgetImportRevisionScope(base);
    expect(scope.companyIds).toEqual(['co_1']);
    expect(scope.sourceArtifactIds).toEqual([
      workbookArtifactId(base.workbookBytes, 'SOPL'),
    ]);
    expect(scope.mappingVersionIds).toEqual(['parser:sopl']);
    expect(scope.periodFrom).toBe('2026-01');
    expect(scope.periodTo).toBe('2026-12');
    for (const id of [...scope.sourceArtifactIds, ...scope.mappingVersionIds]) {
      expect(id).not.toMatch(/unknown|placeholder|todo|tbd/i);
    }
  });

  it('re-importing byte-identical input reuses one revision identity', () => {
    // This path allows re-upload (delete-then-insert converges), so this is a
    // real idempotency guarantee here, not a theoretical one.
    const a = computeRevisionContentHash({
      scope: buildBudgetImportRevisionScope(base),
      reason: 'import',
    });
    const b = computeRevisionContentHash({
      scope: buildBudgetImportRevisionScope({
        ...base,
        workbookBytes: new TextEncoder().encode('workbook-v1'),
      }),
      reason: 'import',
    });
    expect(a).toBe(b);
  });

  it('a corrected workbook is a new revision — §5.2', () => {
    const a = computeRevisionContentHash({
      scope: buildBudgetImportRevisionScope(base),
      reason: 'import',
    });
    const b = computeRevisionContentHash({
      scope: buildBudgetImportRevisionScope({
        ...base,
        workbookBytes: new TextEncoder().encode('workbook-v2-one-cell-fixed'),
      }),
      reason: 'import',
    });
    expect(a).not.toBe(b);
  });

  it('the same bytes read by a different parser is a different source state', () => {
    const a = computeRevisionContentHash({
      scope: buildBudgetImportRevisionScope(base),
      reason: 'import',
    });
    const b = computeRevisionContentHash({
      scope: buildBudgetImportRevisionScope({
        ...base,
        parser: 'rollup',
        rollupColumnHeader: 'Mərkəz',
      }),
      reason: 'import',
    });
    expect(a).not.toBe(b);
  });
});

describe('committedCompanyIds — fact of writing, not intent to write', () => {
  it('includes a company that had rows inserted', () => {
    expect(committedCompanyIds([{ companyId: 'b', inserted: 3, deleted: 0 }])).toEqual(['b']);
  });

  it('includes a company that only had rows DELETED — a clean-slate is a write', () => {
    // Its financial data changed and its indicators move; a revision explaining
    // the result must name it.
    expect(committedCompanyIds([{ companyId: 'b', inserted: 0, deleted: 7 }])).toEqual(['b']);
  });

  it('EXCLUDES a company that wrote nothing — mapped and planned is not written', () => {
    expect(
      committedCompanyIds([
        { companyId: 'wrote', inserted: 1, deleted: 0 },
        { companyId: 'inert', inserted: 0, deleted: 0 },
      ]),
    ).toEqual(['wrote']);
  });

  it('de-duplicates and sorts deterministically', () => {
    expect(
      committedCompanyIds([
        { companyId: 'c', inserted: 1, deleted: 0 },
        { companyId: 'a', inserted: 1, deleted: 0 },
        { companyId: 'c', inserted: 2, deleted: 0 },
        { companyId: 'b', inserted: 0, deleted: 1 },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('is empty when nothing was written', () => {
    expect(committedCompanyIds([{ companyId: 'x', inserted: 0, deleted: 0 }])).toEqual([]);
  });
});

describe('buildMultiEntityImportRevisionScope', () => {
  const base = {
    organizationId: 'org_1',
    stagingId: 'stg_1',
    effectiveMapping: mapping(),
    targetYear: 2026,
    organizationCompanyIds: new Set(['co_1', 'co_2', 'co_3']),
  };

  it('names exactly the companies that were written', () => {
    const scope = buildMultiEntityImportRevisionScope({
      ...base,
      writes: [
        { companyId: 'co_2', inserted: 5, deleted: 0 },
        { companyId: 'co_1', inserted: 3, deleted: 1 },
      ],
    });
    expect(scope.companyIds).toEqual(['co_1', 'co_2']);
  });

  it('one written company yields a one-company revision', () => {
    const scope = buildMultiEntityImportRevisionScope({
      ...base,
      writes: [{ companyId: 'co_1', inserted: 5, deleted: 0 }],
    });
    expect(scope.companyIds).toEqual(['co_1']);
  });

  it('a company present in the request but never written is NOT in the revision', () => {
    // The entity map said three; the transaction wrote two. The revision
    // attests to the two.
    const scope = buildMultiEntityImportRevisionScope({
      ...base,
      writes: [
        { companyId: 'co_1', inserted: 5, deleted: 0 },
        { companyId: 'co_2', inserted: 2, deleted: 0 },
        { companyId: 'co_3', inserted: 0, deleted: 0 },
      ],
    });
    expect(scope.companyIds).toEqual(['co_1', 'co_2']);
    expect(scope.companyIds).not.toContain('co_3');
  });

  it('normalises duplicate write reports for one company', () => {
    const scope = buildMultiEntityImportRevisionScope({
      ...base,
      writes: [
        { companyId: 'co_1', inserted: 5, deleted: 0 },
        { companyId: 'co_1', inserted: 4, deleted: 0 },
      ],
    });
    expect(scope.companyIds).toEqual(['co_1']);
  });

  it('rejects an empty committed scope — a revision naming nobody attests to nothing', () => {
    expect(() =>
      buildMultiEntityImportRevisionScope({
        ...base,
        writes: [{ companyId: 'co_1', inserted: 0, deleted: 0 }],
      }),
    ).toThrow(LineageScopeError);
    try {
      buildMultiEntityImportRevisionScope({ ...base, writes: [] });
    } catch (err) {
      expect((err as LineageScopeError).reasonCode).toBe('empty_committed_scope');
    }
  });

  it('rejects a company outside the caller organization', () => {
    try {
      buildMultiEntityImportRevisionScope({
        ...base,
        writes: [
          { companyId: 'co_1', inserted: 1, deleted: 0 },
          { companyId: 'co_foreign', inserted: 1, deleted: 0 },
        ],
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LineageScopeError);
      expect((err as LineageScopeError).reasonCode).toBe('cross_org_company');
    }
  });

  it('leaks nothing in the error — a code, never an identifier', () => {
    try {
      buildMultiEntityImportRevisionScope({
        ...base,
        writes: [{ companyId: 'co_foreign', inserted: 1, deleted: 0 }],
      });
    } catch (err) {
      expect((err as Error).message).not.toContain('co_foreign');
      expect((err as Error).message).toBe('lineage scope rejected: cross_org_company');
    }
  });

  it('carries the shared artifact, mapping and period range', () => {
    const scope = buildMultiEntityImportRevisionScope({
      ...base,
      writes: [{ companyId: 'co_1', inserted: 1, deleted: 0 }],
    });
    expect(scope.sourceArtifactIds).toEqual(['import-staging:stg_1']);
    expect(scope.mappingVersionIds).toEqual([effectiveMappingVersionId(mapping())]);
    expect(scope.periodFrom).toBe('2026-01');
    expect(scope.periodTo).toBe('2026-12');
  });

  it('write ORDER does not change the revision identity — companyIds is a set', () => {
    const a = computeRevisionContentHash({
      scope: buildMultiEntityImportRevisionScope({
        ...base,
        writes: [
          { companyId: 'co_1', inserted: 1, deleted: 0 },
          { companyId: 'co_2', inserted: 1, deleted: 0 },
        ],
      }),
      reason: 'import',
    });
    const b = computeRevisionContentHash({
      scope: buildMultiEntityImportRevisionScope({
        ...base,
        writes: [
          { companyId: 'co_2', inserted: 1, deleted: 0 },
          { companyId: 'co_1', inserted: 1, deleted: 0 },
        ],
      }),
      reason: 'import',
    });
    expect(a).toBe(b);
  });

  it('a different set of written companies is a different revision', () => {
    const a = computeRevisionContentHash({
      scope: buildMultiEntityImportRevisionScope({
        ...base,
        writes: [{ companyId: 'co_1', inserted: 1, deleted: 0 }],
      }),
      reason: 'import',
    });
    const b = computeRevisionContentHash({
      scope: buildMultiEntityImportRevisionScope({
        ...base,
        writes: [
          { companyId: 'co_1', inserted: 1, deleted: 0 },
          { companyId: 'co_2', inserted: 1, deleted: 0 },
        ],
      }),
      reason: 'import',
    });
    expect(a).not.toBe(b);
  });
});
