/**
 * Phase 11.86 — which observations an import revision is allowed to claim.
 *
 * Stage B5 built the machinery to stamp `IndicatorValue.revisionId` and then
 * refused to use it, for a reason that was correct at the time and is written
 * out in `recompute-trigger.ts`: the batch trigger fans out across indicators
 * whose formulas mix workbook rows, market feeds, manual facts and rollups, and
 * "the import that just ran" cannot attest to a value it only partly produced.
 * The refusal was absolute — `revisionId = null` on every batch write — so
 * production carried 6,460 observations and 0 lineage.
 *
 * The blocker named a missing "per-indicator dependency manifest". That
 * manifest exists: `IndicatorDefinition.requiredInputs` is the declared input
 * set, it is what `buildContext` dispatches on, and it is already the basis of
 * `indicatorProvenance`'s external-feed taxonomy. This module turns it into the
 * narrowest honest rule:
 *
 *   An import revision may be stamped on (company × indicator × period) only
 *   when EVERY declared input of that indicator belongs to a family this run
 *   committed, clean-slate, for that company — and the period falls inside the
 *   revision's range.
 *
 * Three properties make that a claim rather than a hope:
 *
 * 1. **Clean-slate is what makes "every" provable.** An import batch archives
 *    exactly the scope it is about to write (`import-batch.ts` — planId ×
 *    company × year) before inserting. So after a committed PLF apply, every
 *    live `BudgetLine` the recompute reads for that company and year came from
 *    this run. Not "most of them", not "the ones we touched". That is why a
 *    single-family indicator can be fully attested and why an indicator with
 *    one foreign input cannot be attested at all.
 *
 * 2. **The families are the ones the readers actually read.** `listBudgetLines`
 *    and `listBalanceSheetLines` both filter `plan.kind = "actual"`, so a run
 *    that wrote only a forward BUDGET plan has changed nothing those resolvers
 *    see and earns no coverage — see `planKindCoversFamily`.
 *
 * 3. **Absence withholds.** Unknown `requiredInputs`, an unparseable period, a
 *    company outside the run: all return "not covered". This module can only
 *    ever refuse to stamp; there is no input that makes it stamp something the
 *    caller did not prove.
 *
 * Deliberately NOT covered, though the import writes them:
 *
 * - `operationalFact` (KPI sheets), `counterparty`, `booking`, and anything on
 *   `company.settings` — their adapters do not clean-slate a year the way the
 *   statement batches do, so "every row the resolver reads came from this run"
 *   is not established for them. They can be added when that is proven per
 *   adapter, one family at a time.
 * - `commodityPrice`, `industryFactor`, `currencyRate`, `weather`, `news` —
 *   these are not the client's data at all. See `external-source-lineage.ts`:
 *   external evidence is `shadowOnly: true, decisionEligible: false` by
 *   construction, and an import revision naming a sugar price it never fetched
 *   would be a fabricated provenance. An indicator blending a feed with a
 *   workbook input therefore stays untraced — matching `indicatorProvenance`'s
 *   rule that one non-external input makes the whole indicator client-data, run
 *   in the opposite direction: one non-workbook input makes the whole indicator
 *   unattestable.
 * - `rollup:` and `fact:` — cross-company and cross-period reads whose sources
 *   have their own, different lineage.
 */

import { inputFamily } from './indicator-provenance';
import { parsePeriodKey } from './period-context';

/**
 * Input families an AI import can attest to completely, because the batch that
 * writes them clean-slates the (plan × company × year) scope first.
 *
 * `cashFlow` is listed for completeness — the CF batch has the same
 * archive-then-insert shape — although no seeded definition declares it today.
 */
export const IMPORT_COVERABLE_FAMILIES = [
  'budgetLine',
  'balanceSheetLine',
  'cashFlow',
] as const;

export type ImportCoverableFamily = (typeof IMPORT_COVERABLE_FAMILIES)[number];

export function isImportCoverableFamily(
  family: string,
): family is ImportCoverableFamily {
  return (IMPORT_COVERABLE_FAMILIES as readonly string[]).includes(family);
}

/**
 * The family a committed sheet's `dataType` grants coverage over.
 *
 * `null` means "this sheet writes something an import revision cannot yet
 * attest to" — KPI, SALES, registers, settings blobs. Silence, not an error:
 * such a sheet still commits, it simply buys no lineage.
 */
export function coverableFamilyForDataType(
  dataType: string,
): ImportCoverableFamily | null {
  switch (dataType) {
    case 'PLF':
      return 'budgetLine';
    case 'BS':
      return 'balanceSheetLine';
    case 'CF':
      return 'cashFlow';
    default:
      return null;
  }
}

/**
 * Does a sheet written under this plan kind move what the indicator resolvers
 * read?
 *
 * `listBudgetLines` and `listBalanceSheetLines` both pin `plan.kind = "actual"`
 * (`recompute-data-source.ts`). A `budget` plan is a forward projection that no
 * indicator currently reads, so committing one changes no observation and must
 * not be recorded as having produced any. Getting this wrong would be the worst
 * kind of error available here: a 2026 budget import stamping its revision on
 * values computed entirely from the 2026 actuals of a previous run.
 */
export function planKindCoversFamily(planKind: string | null | undefined): boolean {
  return planKind === 'actual';
}

/**
 * The lineage claim a caller hands to the recompute: one revision, the period
 * range it pins, and exactly which families it proved per company.
 *
 * Per-company rather than per-run because a real multi-file import does not
 * write the same sheets for every entity — one company may get PLF + BS while
 * its sibling only appears on the PLF tab. A run-wide family set would stamp
 * the sibling's balance-sheet-reading indicators off a balance sheet the run
 * never wrote for it.
 */
export interface ImportLineage {
  revisionId: string;
  /** Period key, inclusive. Matches `DataRevision.periodFrom`. */
  periodFrom: string;
  /** Period key, inclusive. Matches `DataRevision.periodTo`. */
  periodTo: string;
  coverageByCompanyId: ReadonlyMap<string, ReadonlySet<ImportCoverableFamily>>;
}

/**
 * JSON-safe mirror of `ImportLineage`, for payloads that cross a process
 * boundary (BullMQ stores job data as JSON, and a `Map` serialises to `{}`).
 */
export interface SerializedImportLineage {
  revisionId: string;
  periodFrom: string;
  periodTo: string;
  coverageByCompanyId: Record<string, string[]>;
}

export function serializeImportLineage(
  lineage: ImportLineage,
): SerializedImportLineage {
  const coverageByCompanyId: Record<string, string[]> = {};
  for (const [companyId, families] of lineage.coverageByCompanyId) {
    coverageByCompanyId[companyId] = [...families].sort();
  }
  return {
    revisionId: lineage.revisionId,
    periodFrom: lineage.periodFrom,
    periodTo: lineage.periodTo,
    coverageByCompanyId,
  };
}

/**
 * Rebuild an `ImportLineage` from a queue payload.
 *
 * Unknown family strings are DROPPED rather than trusted: a payload is written
 * by one deploy and read by another, and a worker that has not learned a family
 * name must not treat it as coverage it can vouch for. A company whose families
 * all drop out ends up with an empty set, which covers nothing.
 */
export function deserializeImportLineage(
  raw: SerializedImportLineage,
): ImportLineage {
  const coverageByCompanyId = new Map<string, ReadonlySet<ImportCoverableFamily>>();
  for (const [companyId, families] of Object.entries(
    raw.coverageByCompanyId ?? {},
  )) {
    coverageByCompanyId.set(
      companyId,
      new Set((families ?? []).filter(isImportCoverableFamily)),
    );
  }
  return {
    revisionId: raw.revisionId,
    periodFrom: raw.periodFrom,
    periodTo: raw.periodTo,
    coverageByCompanyId,
  };
}

/**
 * Is every declared input of this indicator inside the covered family set?
 *
 * - `undefined` → **false**. The caller did not project `requiredInputs`, so
 *   nothing was proved. Note this is the opposite default from
 *   `indicatorProvenance`, and for the same underlying principle: each defaults
 *   to the answer that changes nothing. There, changing nothing means keeping
 *   the indicator in the score; here it means withholding the stamp.
 * - `[]` → **false**. A constant (`IND_GOV_CLIMATE_SCORE`, formula `38`) has no
 *   source state, so no revision produced it. Stamping one would attach
 *   provenance to a literal.
 * - malformed entries (null, empty string) → **false**, fail-closed, rather
 *   than being filtered away into a vacuous "all covered".
 */
export function indicatorInputsCovered(
  requiredInputs: readonly string[] | null | undefined,
  covered: ReadonlySet<ImportCoverableFamily>,
): boolean {
  if (!Array.isArray(requiredInputs) || requiredInputs.length === 0) {
    return false;
  }
  if (covered.size === 0) return false;
  return requiredInputs.every(
    (input) =>
      typeof input === 'string' &&
      input.length > 0 &&
      isImportCoverableFamily(inputFamily(input)) &&
      covered.has(inputFamily(input) as ImportCoverableFamily),
  );
}

/**
 * Does `period` fall entirely inside `[periodFrom, periodTo]`?
 *
 * Compared through `parsePeriodKey`, never as strings — the two vocabularies
 * genuinely meet here and string order is wrong in the one case that matters:
 * `'2026' < '2026-01'` lexically, while the FY period 2026 spans exactly
 * 2026-01..2026-12 and is therefore contained. `import-lineage.ts` flagged this
 * trap when it wrote the month-keyed range; this is where it is disarmed.
 *
 * Any unparseable key fails closed.
 */
export function periodWithinRevision(
  periodFrom: string,
  periodTo: string,
  period: string,
): boolean {
  try {
    const from = parsePeriodKey(periodFrom);
    const to = parsePeriodKey(periodTo);
    const target = parsePeriodKey(period);
    return (
      target.start.getTime() >= from.start.getTime() &&
      target.end.getTime() <= to.end.getTime()
    );
  } catch {
    return false;
  }
}

export interface LineagePairQuery {
  companyId: string;
  requiredInputs: readonly string[] | null | undefined;
  period: string;
}

/**
 * The revision id to stamp on one (company × indicator × period), or
 * `undefined` when this run cannot honestly claim it.
 *
 * `undefined` — not `null` — because that is what `recomputeIndicator` treats as
 * "no lineage argument supplied", and what makes the canonical writer clear any
 * stale pointer instead of stamping one.
 */
export function lineageRevisionForPair(
  lineage: ImportLineage | undefined,
  query: LineagePairQuery,
): string | undefined {
  if (!lineage) return undefined;
  const covered = lineage.coverageByCompanyId.get(query.companyId);
  if (!covered) return undefined;
  if (!indicatorInputsCovered(query.requiredInputs, covered)) return undefined;
  if (!periodWithinRevision(lineage.periodFrom, lineage.periodTo, query.period)) {
    return undefined;
  }
  return lineage.revisionId;
}
