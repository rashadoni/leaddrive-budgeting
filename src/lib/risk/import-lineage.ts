/**
 * Phase 10 / Stage B5 — how an import names the source state it applied.
 *
 * `ensureDataRevision` takes a `RevisionScope` and asks one question of it:
 * "is this the same source state?" (`data-revision.ts` → `computeRevisionContentHash`).
 * These helpers are what let a real import answer that honestly, with ids that
 * exist rather than ids that were invented for the occasion.
 *
 * **What is and is not an identity here.** 03-DATA-KPI-TRUST-SPEC §9 names a
 * `SourceArtifact` model. It does not exist in this schema, and this module does
 * not pretend otherwise — it maps the spec's slots onto the identifiers the
 * import path actually holds:
 *
 * - **Source artifact** → the `ImportStaging` row. It is 1:1 with one uploaded
 *   file + sheet, and its cuid is stable and org-scoped. Deliberately NOT the
 *   filename: two different workbooks are routinely called `budget.xlsx`, and a
 *   filename-keyed revision would hash two unrelated source states to the same
 *   value and hand the second import the first one's lineage. A re-analysed
 *   upload gets a new staging row, hence a new revision — which is §5.2's "a
 *   source change creates a new revision".
 * - **Mapping version** → a hash of the mapping *actually applied* (proposal
 *   merged with reviewer overrides). Not the approved-template version: that
 *   record is written post-commit and best-effort (`apply/route.ts`, after the
 *   transaction), so reading it at apply time would name a version that this
 *   import did not necessarily use.
 *
 * The limit this leaves, stated plainly: a staging id proves *which import
 * event* produced a value, not the byte-exact workbook behind it. Raw upload
 * bytes are not retained on that path (`schema.prisma` — `xlsxTempPath` is a
 * temp path the caller cleans up), so `DataRevision.contentHash` must not be
 * described as a file-content hash for staged imports.
 *
 * The deterministic per-company import (`onboarding/import/budget`) is not
 * subject to that limit: it holds the uploaded bytes while it works, so
 * `workbookArtifactId` fingerprints what was actually read. Its mapping id is
 * weaker instead — a named parser rather than a versioned one. The two paths
 * are honest about different halves, and each says which half.
 */

import { createHash } from 'node:crypto';
import type { MappingProposal } from '@/lib/onboarding/ai-mapper/types';
import type { RevisionScope } from './data-revision';

/** Namespaces so an id in the DB says what kind of thing it points at. */
const SOURCE_ARTIFACT_PREFIX = 'import-staging';
const WORKBOOK_ARTIFACT_PREFIX = 'workbook-sha256';
const MAPPING_VERSION_PREFIX = 'effective-mapping';
const PARSER_MAPPING_PREFIX = 'parser';

/**
 * The id of the artifact an `ImportStaging` row stands for.
 *
 * Prefixed rather than bare so a reader of `DataRevision.sourceArtifactIds` can
 * tell a staging row from a future feed/batch id without a lookup table.
 */
export function importStagingArtifactId(stagingId: string): string {
  return `${SOURCE_ARTIFACT_PREFIX}:${stagingId}`;
}

/**
 * Fingerprint the mapping this import actually applied.
 *
 * Hashes the *semantic* mapping decisions only — the ones that change which
 * numbers land:
 * - which source column plays which role (`sourceIndex` → `role`);
 * - which currency a column is denominated in (`currencyCode`), which decides
 *   which amount column wins on a multi-currency sheet and tags the resulting
 *   `BudgetLine.currencyCode` (`ai-mapper/applier.ts` → `resolveColumns`);
 * - which account code is forced to which type (`code` → `accountType`).
 *
 * It deliberately excludes the mapper's `confidence` and `reasoning` prose.
 * Those are commentary about a decision, not the decision: a re-run of the LLM
 * that reworded its own explanation while mapping every column identically has
 * not changed the mapping, and must not spawn a second revision claiming it
 * did. The inverse matters more — flipping one column's role, or one account's
 * type, *is* a mapping change and does produce a new id.
 *
 * Sorted by key before hashing so proposal authoring order is not smuggled into
 * the identity, matching `computeRevisionContentHash`'s convention.
 */
export function effectiveMappingVersionId(mapping: MappingProposal): string {
  const columns = [...(mapping.columns ?? [])]
    .map(
      (c) =>
        [
          c.sourceIndex,
          c.role,
          // Normalised the way `resolveColumns` normalises it, so a mapping
          // that behaves identically hashes identically.
          c.currencyCode ? c.currencyCode.trim().toUpperCase() : null,
        ] as const,
    )
    .sort((a, b) => a[0] - b[0]);
  const accountTypes = [...(mapping.accountTypeOverrides ?? [])]
    .map((a) => [a.code, a.accountType] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonical = JSON.stringify([
    ['columns', columns],
    ['accountTypeOverrides', accountTypes],
  ]);
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `${MAPPING_VERSION_PREFIX}:${digest}`;
}

/**
 * The id of a workbook that was uploaded and applied directly, by its bytes.
 *
 * This is the byte-exact artifact identity that `importStagingArtifactId` can
 * only approximate — the deterministic-parser import receives the file itself,
 * so it can fingerprint what it actually read instead of naming the row that
 * described it. Two uploads of the same bytes for the same sheet are the same
 * artifact and, all else equal, reuse one revision; a single changed cell
 * produces a different digest and therefore a new revision, which is §5.2
 * exactly.
 *
 * The sheet is part of the id because one workbook holds many, and an import
 * applies one: the artifact is "this sheet of these bytes", not the file.
 */
export function workbookArtifactId(
  workbookBytes: Uint8Array,
  sheetName: string,
): string {
  const digest = createHash('sha256').update(workbookBytes).digest('hex');
  return `${WORKBOOK_ARTIFACT_PREFIX}:${digest}#${sheetName}`;
}

/**
 * The mapping id for a deterministic (non-AI) parser import.
 *
 * These imports carry no proposal — the mapping *is* the named parser variant,
 * plus the column it was pointed at for a rollup sheet. Naming it is what an
 * honest `mappingVersionIds` can say here, and it is more than `[]` says.
 *
 * **The limit, stated rather than glossed:** this names *which* parser was in
 * force, not *which version of its code*. Editing `parseSoplSheet` does not move
 * this id, so two revisions with the same mapping id could have been produced by
 * different parser behaviour across a deploy. Closing that needs a real
 * adapter/parser version — recorded in IMPLEMENTATION-STATUS.md §17.
 */
export function parserMappingVersionId(
  parser: string,
  rollupColumnHeader?: string | null,
): string {
  const base = `${PARSER_MAPPING_PREFIX}:${parser}`;
  const header = rollupColumnHeader?.trim();
  return header ? `${base}#${header}` : base;
}

export interface BuildImportRevisionScopeInput {
  organizationId: string;
  /** The company the staged sheet writes to. */
  companyId: string;
  /** `ImportStaging.id` — the artifact this apply is committing. */
  stagingId: string;
  /** Proposal merged with reviewer overrides: the mapping actually applied. */
  effectiveMapping: MappingProposal;
  /** Fiscal year the apply writes. The import lands all 12 months of it. */
  targetYear: number;
}

/**
 * Build the scope pinning what this import committed.
 *
 * The period range is the full fiscal year in month keys. The apply path writes
 * twelve monthly BudgetLine rows per parsed line (Jan..Dec of `targetYear`), so
 * `YYYY-01`..`YYYY-12` is the range the revision genuinely speaks for — not a
 * narrower window it did not touch, and not a wider one it cannot vouch for.
 *
 * **Known gap — two period vocabularies meet here.** The observations that
 * carry this revision are written at the FY key `YYYY` (`recompute-trigger.ts`
 * → `period = String(year)`), while the range above is in MONTH keys. Both are
 * valid keys in the same grammar (`period-context.ts` → `parsePeriodKey`), but
 * they do not compare as strings: `'2026' < '2026-01'`, so a naive range query
 * asking "does this revision cover this observation?" answers no. Nothing
 * queries that way today. Anything that starts must compare through
 * `parsePeriodKey` (the FY period's months are exactly this range), not with
 * `<=`/`>=` on the raw keys. Recorded in IMPLEMENTATION-STATUS.md §17.
 */
export function buildImportRevisionScope(
  input: BuildImportRevisionScopeInput,
): RevisionScope {
  const { organizationId, companyId, stagingId, effectiveMapping, targetYear } =
    input;
  const year = String(targetYear);
  return {
    organizationId,
    companyIds: [companyId],
    sourceArtifactIds: [importStagingArtifactId(stagingId)],
    mappingVersionIds: [effectiveMappingVersionId(effectiveMapping)],
    periodFrom: `${year}-01`,
    periodTo: `${year}-12`,
  };
}

export interface BuildBudgetImportRevisionScopeInput {
  organizationId: string;
  /** The company the sheet writes to. */
  companyId: string;
  /** Raw bytes of the uploaded workbook — fingerprinted, not stored. */
  workbookBytes: Uint8Array;
  /** The sheet inside the workbook this import applied. */
  sheetName: string;
  /** Deterministic parser variant in force (`sopl` | `rollup`). */
  parser: string;
  /** The entity column, when `parser === 'rollup'`. */
  rollupColumnHeader?: string | null;
  /** Fiscal year the import writes. */
  targetYear: number;
}

/**
 * Build the scope for the deterministic per-company budget import.
 *
 * Same contract as `buildImportRevisionScope`, from the identifiers that path
 * actually holds: byte fingerprint instead of a staging row, named parser
 * instead of an AI proposal.
 */
export function buildBudgetImportRevisionScope(
  input: BuildBudgetImportRevisionScopeInput,
): RevisionScope {
  const {
    organizationId,
    companyId,
    workbookBytes,
    sheetName,
    parser,
    rollupColumnHeader,
    targetYear,
  } = input;
  const year = String(targetYear);
  return {
    organizationId,
    companyIds: [companyId],
    sourceArtifactIds: [workbookArtifactId(workbookBytes, sheetName)],
    mappingVersionIds: [parserMappingVersionId(parser, rollupColumnHeader)],
    periodFrom: `${year}-01`,
    periodTo: `${year}-12`,
  };
}
