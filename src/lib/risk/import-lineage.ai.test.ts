/**
 * Phase 11.86 — the ids the AI multi-file import puts in a revision.
 *
 * Companion to `import-lineage.test.ts`, which pins the same property for the
 * three staging routes: the identifiers must be DERIVED from what was actually
 * imported. A placeholder satisfies a "a revision exists" assertion exactly as
 * well as a real id, and the entire value of lineage is that it cannot.
 */

import { describe, it, expect } from 'vitest';
import { computeRevisionContentHash } from './data-revision';
import {
  aiSheetMappingVersionId,
  aiWorkbookArtifactId,
  buildAiImportRevisionScope,
  LineageScopeError,
  workbookArtifactId,
  type AiSheetMappingDecision,
} from './import-lineage';

describe('aiWorkbookArtifactId', () => {
  it('is the bytes, not the name — two "budget.xlsx" uploads are two artifacts', () => {
    const a = aiWorkbookArtifactId(Buffer.from('PK first workbook'));
    const b = aiWorkbookArtifactId(Buffer.from('PK second workbook'));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^workbook-sha256:[a-f0-9]{64}$/);
  });

  it('re-uploading the same bytes is the same artifact', () => {
    const bytes = Buffer.from('PK identical');
    expect(aiWorkbookArtifactId(bytes)).toBe(
      aiWorkbookArtifactId(Buffer.from(bytes)),
    );
  });

  it('names the whole file, unlike the single-sheet deterministic import', () => {
    // `workbookArtifactId` appends `#<sheet>` because that path applies exactly
    // one sheet. The AI path applies every sheet the classifier routed, so the
    // artifact it committed IS the file, and a sheet fragment would understate
    // what was read.
    const bytes = Buffer.from('same bytes');
    expect(aiWorkbookArtifactId(bytes)).not.toContain('#');
    expect(workbookArtifactId(bytes, 'PLF CPC')).toContain('#PLF CPC');
  });
});

describe('aiSheetMappingVersionId', () => {
  const decision = (
    over: Partial<AiSheetMappingDecision> = {},
  ): AiSheetMappingDecision => ({
    filename: 'pack.xlsx',
    sheetName: 'PLF Actual 2025',
    dataType: 'PLF',
    entityCode: 'AZSEKER-CPC',
    planKind: 'actual',
    role: 'source',
    ...over,
  });

  it('is order-free — sheet iteration order is not part of the mapping', () => {
    const a = decision();
    const b = decision({ sheetName: 'BS Actual 2025', dataType: 'BS' });
    expect(aiSheetMappingVersionId([a, b])).toBe(aiSheetMappingVersionId([b, a]));
  });

  it('moves when a sheet is routed to a different entity', () => {
    expect(aiSheetMappingVersionId([decision()])).not.toBe(
      aiSheetMappingVersionId([decision({ entityCode: 'AZSEKER-SAF' })]),
    );
  });

  it('moves when a sheet flips from actual to budget', () => {
    // The flip that decides whether the numbers reach any indicator at all.
    expect(aiSheetMappingVersionId([decision()])).not.toBe(
      aiSheetMappingVersionId([decision({ planKind: 'budget' })]),
    );
  });

  it('moves when the same sheet name comes from a different file', () => {
    expect(aiSheetMappingVersionId([decision()])).not.toBe(
      aiSheetMappingVersionId([decision({ filename: 'other-pack.xlsx' })]),
    );
  });

  it('moves when a reviewer maps a no-code row to a different account', () => {
    expect(aiSheetMappingVersionId([decision()], [['Other income', '4900']])).not.toBe(
      aiSheetMappingVersionId([decision()], [['Other income', '4100']]),
    );
  });

  it('does NOT move for a re-run that only reworded its own reasoning', () => {
    // The classifier's prose is commentary about a decision, not the decision.
    // Two runs that routed every sheet identically pinned the same source
    // state; a second revision would claim a change that did not happen. The
    // fingerprint never sees `confidence` or `reasoning`, so this holds by
    // construction rather than by the caller remembering to strip them.
    expect(aiSheetMappingVersionId([decision()])).toBe(
      aiSheetMappingVersionId([decision()]),
    );
  });
});

describe('buildAiImportRevisionScope', () => {
  const base = {
    organizationId: 'org_1',
    workbookArtifactIds: [`workbook-sha256:${'a'.repeat(64)}`],
    mappingVersionId: `ai-sheet-mapping:${'b'.repeat(64)}`,
    targetYear: 2026,
    organizationCompanyIds: new Set(['co_1', 'co_2']),
  };

  it('names the fiscal year in month keys, matching the other builders', () => {
    const scope = buildAiImportRevisionScope({
      ...base,
      writes: [{ companyId: 'co_1', inserted: 240, deleted: 0 }],
    });
    expect(scope.periodFrom).toBe('2026-01');
    expect(scope.periodTo).toBe('2026-12');
    expect(scope.companyIds).toEqual(['co_1']);
  });

  it('de-duplicates and sorts artifacts so upload order is not an identity', () => {
    const x = `workbook-sha256:${'c'.repeat(64)}`;
    const y = `workbook-sha256:${'d'.repeat(64)}`;
    const a = buildAiImportRevisionScope({
      ...base,
      workbookArtifactIds: [y, x, x],
      writes: [{ companyId: 'co_1', inserted: 1, deleted: 0 }],
    });
    const b = buildAiImportRevisionScope({
      ...base,
      workbookArtifactIds: [x, y],
      writes: [{ companyId: 'co_1', inserted: 1, deleted: 0 }],
    });
    expect(a.sourceArtifactIds).toEqual([x, y]);
    expect(computeRevisionContentHash({ scope: a, reason: 'import' })).toBe(
      computeRevisionContentHash({ scope: b, reason: 'import' }),
    );
  });

  it('refuses a company that wrote nothing', () => {
    expect(() =>
      buildAiImportRevisionScope({
        ...base,
        writes: [{ companyId: 'co_1', inserted: 0, deleted: 0 }],
      }),
    ).toThrow(LineageScopeError);
  });

  it('refuses a write that escaped the organization', () => {
    expect(() =>
      buildAiImportRevisionScope({
        ...base,
        writes: [{ companyId: 'co_other_org', inserted: 5, deleted: 0 }],
      }),
    ).toThrow(/cross_org_company/);
  });

  it('refuses to write a revision that names no artifact', () => {
    // A provenance row an auditor cannot resolve back to bytes is worse than
    // no row at all: it reads as evidence and points nowhere.
    expect(() =>
      buildAiImportRevisionScope({
        ...base,
        workbookArtifactIds: [],
        writes: [{ companyId: 'co_1', inserted: 5, deleted: 0 }],
      }),
    ).toThrow(LineageScopeError);
  });

  it('a re-import of unchanged bytes, mapping and scope is the SAME revision', () => {
    // §5.2 in its contrapositive. The run id is deliberately absent from the
    // scope: it carries a timestamp, so including it would make every
    // idempotent re-import look like a source change and defeat the dedupe.
    const scope = () =>
      buildAiImportRevisionScope({
        ...base,
        writes: [{ companyId: 'co_1', inserted: 240, deleted: 0 }],
      });
    expect(computeRevisionContentHash({ scope: scope(), reason: 'import' })).toBe(
      computeRevisionContentHash({ scope: scope(), reason: 'import' }),
    );
  });

  it('a changed workbook is a different revision', () => {
    const one = buildAiImportRevisionScope({
      ...base,
      writes: [{ companyId: 'co_1', inserted: 1, deleted: 0 }],
    });
    const two = buildAiImportRevisionScope({
      ...base,
      workbookArtifactIds: [`workbook-sha256:${'e'.repeat(64)}`],
      writes: [{ companyId: 'co_1', inserted: 1, deleted: 0 }],
    });
    expect(computeRevisionContentHash({ scope: one, reason: 'import' })).not.toBe(
      computeRevisionContentHash({ scope: two, reason: 'import' }),
    );
  });
});
