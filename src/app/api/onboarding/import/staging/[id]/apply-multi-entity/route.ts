/**
 * Phase C slice C2.3 — `/staging/[id]/apply-multi-entity` endpoint.
 *
 * Multi-COMPANY-in-one-sheet apply. The single `/apply` route writes to ONE
 * `staging.companyId`; this route splits a sheet by its `entity`-roled column
 * and routes each entity's rows to a DIFFERENT company, inside ONE transaction
 * — the generic equivalent of the bespoke kopeck-verified reporting-pack
 * BU-split. Kept as a SEPARATE route (mirrors the `apply-multi` precedent) so
 * the corruption-tested single path is byte-for-byte unchanged.
 *
 * Corruption invariants (Codex-reviewed 2026-06-20 — this is project problem #1):
 *   - per-entity clean-slate WHERE = exactly `(org, plan, companyId)`, never
 *     broader; the delete fires at most ONCE per distinct company (shared
 *     `applyParsedLinesToCompany` primitive).
 *   - `entityMap` MUST be injective — two values → one company is a wipe path
 *     (`budget_lines` has no unique constraint; the 2nd group's clean-slate
 *     deletes the 1st group's just-inserted rows). 409 on non-injective.
 *   - all-or-none: any entity parse error, OR any writeable entity not mapped,
 *     OR any mapped company out-of-org → 409 with ZERO writes.
 *   - entity-set equality: the re-uploaded file's distinct entity values must
 *     equal the reviewed set persisted in `proposal.__multiEntity` (the
 *     structure-hash guards columns, NOT the BU distribution).
 *   - one `$transaction` wraps all per-entity delete+insert → partial failure
 *     rolls back ALL entities.
 *
 * Auth: `manager` + org-scoped (same as `/apply`).
 */
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
// rls-scan-ignore: staged multi-entity apply (maxDuration 120). Commits several
// entities' sheets through the production import handlers then
// runRecomputeForCompanies — nested transactions + recompute can't fit one 5s
// interactive withOrgScope tx. orgId-scoped in code; runs on BYPASSRLS `prismaAdmin`.
import { prismaAdmin as prisma } from '@/lib/db/prisma-admin';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { getLogger } from '@/lib/log';
import {
  applyProposalByEntity,
  findEntityColumn,
} from '@/lib/onboarding/ai-mapper/entity-split';
import { applyParsedLinesToCompany } from '@/lib/onboarding/ai-mapper/apply-lines';
import { SKIP_ENTITY } from '@/lib/onboarding/ai-mapper/entity-resolve';
import { computeControlTotals } from '@/lib/onboarding/ai-mapper/control-totals';
import { validateImport } from '@/lib/onboarding/ai-mapper/validate-import';
import { detectProposalYear, mergeProposal } from '@/lib/onboarding/ai-mapper/applier';
import { ensureDataRevision } from '@/lib/risk/data-revision-writer';
import {
  buildMultiEntityImportRevisionScope,
  committedCompanyIds,
  LineageScopeError,
} from '@/lib/risk/import-lineage';
import { extractMapperInput } from '@/lib/onboarding/ai-mapper/extract';
import { computeStructureHash } from '@/lib/onboarding/ai-mapper/structure-hash';
import { currentBakuYearNumber } from '@/lib/risk/periods';
import type { MappingProposal } from '@/lib/onboarding/ai-mapper/types';
import type { ParseResult } from '@/lib/onboarding/adapters/azmade-sopl';
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"

const log = getLogger('api:apply-multi-entity');
const recomputeLog = getLogger('api:apply-multi-entity:recompute');

export const maxDuration = 120;

const MAX_FILE_SIZE = MAX_IMPORT_UPLOAD_BYTES // shared cap — see src/lib/import/upload-limits.ts
const RATE_LIMIT = { name: 'onboarding-apply-multi-entity', max: 5, windowMs: 60_000 };

/** Reserved proposal key persisted by /analyze for a multi-entity sheet. */
interface MultiEntityMeta {
  entityColumnIndex: number;
  entityValues: string[];
}

// Codex P1 #5 — JSON-encode the sorted set so values are not run together
// (a plain `join(' ')` made ['A B','C'] and ['A','B C'] compare equal, a
// crafted-payload bypass of the reviewed-entity-set gate).
const sortedKey = (vals: string[]): string => JSON.stringify([...vals].sort());

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, 'manager');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }
  const orgId = session.orgId;

  const rateLimitError = enforceRateLimit(`${orgId}:${getClientIp(request)}`, RATE_LIMIT);
  if (rateLimitError) return rateLimitError;

  const { id: stagingId } = await params;
  if (typeof stagingId !== 'string' || stagingId.trim() === '') {
    return NextResponse.json({ error: 'Invalid staging id' }, { status: 400 });
  }

  const staging = await prisma.importStaging.findFirst({
    where: { id: stagingId, organizationId: orgId },
    select: {
      id: true,
      companyId: true,
      status: true,
      sourceSheet: true,
      sourceFile: true,
      proposal: true,
      userOverrides: true,
      expiresAt: true,
      appliedAt: true,
    },
  });
  if (!staging) {
    return NextResponse.json({ error: 'Staging not found' }, { status: 404 });
  }

  // Status gating (mirrors /apply).
  if (staging.status === 'pending' && staging.expiresAt < new Date()) {
    await prisma.importStaging.updateMany({
      where: { id: staging.id, status: 'pending' },
      data: { status: 'expired' },
    });
    return NextResponse.json(
      { error: 'Staging proposal has expired', status: 'expired' },
      { status: 410 },
    );
  }
  if (staging.status === 'applied') {
    return NextResponse.json(
      { error: 'Staging already applied', status: 'applied', appliedAt: staging.appliedAt?.toISOString() ?? null },
      { status: 409 },
    );
  }
  if (staging.status === 'discarded' || staging.status === 'expired') {
    return NextResponse.json(
      { error: `Staging is ${staging.status}; cannot apply`, status: staging.status },
      { status: 410 },
    );
  }

  // Must be a multi-entity staging: a single MappingProposal with an `entity`
  // column AND the persisted `__multiEntity` reviewed set. A single-company
  // staging belongs on /apply.
  const proposal = staging.proposal as unknown as MappingProposal;
  const meta = (staging.proposal as { __multiEntity?: MultiEntityMeta }).__multiEntity;
  if (
    !Array.isArray(proposal.columns) ||
    findEntityColumn(proposal.columns) === null ||
    !meta ||
    !Array.isArray(meta.entityValues)
  ) {
    return NextResponse.json(
      {
        error:
          'Staging is not a multi-entity proposal (no entity column / __multiEntity). Use /api/onboarding/import/staging/[id]/apply.',
      },
      { status: 422 },
    );
  }

  // Parse multipart body.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data body' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing file. Re-upload the same xlsx that was analyzed.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` }, { status: 413 });
  }
  const filename = (file as Blob & { name?: string }).name ?? '';
  if (!filename || !/\.xlsx$/i.test(filename)) {
    return NextResponse.json({ error: 'Only .xlsx files are accepted by the AI Data Mapper.' }, { status: 415 });
  }

  // userOverrides (optional, single Partial<MappingProposal> — same as /apply).
  let userOverrides: Partial<MappingProposal> | undefined;
  const overridesRaw = form.get('userOverrides');
  if (typeof overridesRaw === 'string' && overridesRaw.trim() !== '') {
    try {
      userOverrides = JSON.parse(overridesRaw);
    } catch (err) {
      return NextResponse.json({ error: `Invalid userOverrides JSON: ${err instanceof Error ? err.message : err}` }, { status: 400 });
    }
  }

  // entityMap: { entityValue: companyId }. Optional on dry-run, required on commit.
  let entityMap: Record<string, string> = {};
  const entityMapRaw = form.get('entityMap');
  if (typeof entityMapRaw === 'string' && entityMapRaw.trim() !== '') {
    try {
      const parsed = JSON.parse(entityMapRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entityMap = parsed as Record<string, string>;
      } else {
        return NextResponse.json({ error: 'entityMap must be a JSON object { entityValue: companyId }' }, { status: 400 });
      }
    } catch (err) {
      return NextResponse.json({ error: `Invalid entityMap JSON: ${err instanceof Error ? err.message : err}` }, { status: 400 });
    }
  }

  const dryRunRaw = form.get('dryRun');
  const dryRun = typeof dryRunRaw === 'string' && /^(true|1|yes)$/i.test(dryRunRaw.trim());

  let workbook: XLSX.WorkBook;
  try {
    const arrayBuffer = await file.arrayBuffer();
    workbook = XLSX.read(Buffer.from(arrayBuffer), {
      type: 'buffer',
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      dense: true,
    });
  } catch (err) {
    return NextResponse.json({ error: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 });
  }

  // Structure-hash guard (columns). Skipped for pre-guard stagings.
  const storedHash = (staging.proposal as { __structureHash?: string }).__structureHash;
  if (storedHash) {
    // Re-extract with the SAME company context the analyze used. Bug fix
    // (2026-06-21): `computeStructureHash` includes the company industry, but
    // this guard re-extracted WITHOUT it → industry=null → the hash never
    // matched for a company that has an industry, so every legit re-upload was
    // rejected as "file changed". Pass the anchor company's industry so the
    // hash reproduces what analyze stored.
    const anchorCompany = await prisma.company.findUnique({
      where: { id: staging.companyId },
      select: { name: true, industry: true },
    });
    const mi = extractMapperInput(workbook, staging.sourceSheet, XLSX, {
      companyName: anchorCompany?.name ?? undefined,
      industry: anchorCompany?.industry ?? undefined,
    });
    if (!('error' in mi) && computeStructureHash(mi) !== storedHash) {
      return NextResponse.json(
        { error: 'Файл изменился после анализа (структура колонок не совпадает). Загрузите тот же файл или повторите анализ.' },
        { status: 409 },
      );
    }
  }

  // Resolve target year (same precedence as /apply).
  const yearHint = detectProposalYear(proposal.columns);
  const formYearRaw = form.get('targetYear');
  const formYear =
    typeof formYearRaw === 'string' && /^\d{4}$/.test(formYearRaw.trim())
      ? Number(formYearRaw.trim())
      : undefined;
  let targetYear: number;
  if (formYear !== undefined) targetYear = formYear;
  else if (yearHint === null) targetYear = currentBakuYearNumber();
  else if (typeof yearHint === 'object' && 'conflict' in yearHint) targetYear = Math.max(...yearHint.conflict);
  else targetYear = yearHint;

  // Phase C C3.2 — optional target currency for a multi-currency sheet.
  const tcRaw = form.get('targetCurrency');
  const preferCurrency = typeof tcRaw === 'string' && tcRaw.trim() !== '' ? tcRaw.trim() : undefined;

  // ── Plan target (Option C, 2026-06-21) — the client EXPLICITLY chooses where
  // the import lands, instead of a hardcoded "AI-Imported <year> Budget" plan
  // created with a silent kind="actual" (which double-counted against the
  // canonical actual plan, since the terminal aggregates ALL kind="actual"
  // plans for a year). Either:
  //   • targetPlanId  → UPDATE an existing plan (must be same org + year), or
  //   • newPlanName + planKind → CREATE a new plan with an EXPLICIT kind.
  const rawTargetPlanId = form.get('targetPlanId');
  const targetPlanId =
    typeof rawTargetPlanId === 'string' && rawTargetPlanId.trim() ? rawTargetPlanId.trim() : null;
  const rawNewName = form.get('newPlanName');
  const newPlanName =
    typeof rawNewName === 'string' && rawNewName.trim() ? rawNewName.trim().slice(0, 120) : null;
  const planKind = form.get('planKind') === 'budget' ? 'budget' : 'actual';

  let existingTargetPlan: { id: string } | null = null;
  if (targetPlanId) {
    existingTargetPlan = await prisma.budgetPlan.findFirst({
      where: { id: targetPlanId, organizationId: orgId, year: targetYear, deletedAt: null },
      select: { id: true },
    });
    if (!existingTargetPlan) {
      return NextResponse.json(
        { error: `Выбранный план не найден, не за ${targetYear} год, или не в вашей организации.` },
        { status: 400 },
      );
    }
  }

  // Double-count guard: creating a NEW actual plan while an actual plan already
  // exists for this year would inflate the terminal (which sums all actuals).
  // Advisory in dry-run; hard-blocked on commit unless acknowledged.
  const creatingNewActual = !existingTargetPlan && planKind === 'actual';
  const existingActualCount = creatingNewActual
    ? await prisma.budgetPlan.count({
        where: { organizationId: orgId, year: targetYear, kind: 'actual', deletedAt: null },
      })
    : 0;
  const wouldDoubleActual = creatingNewActual && existingActualCount > 0;

  // Split by entity + parse per entity.
  const split = applyProposalByEntity(workbook, staging.sourceSheet, proposal, XLSX, userOverrides, {
    preferYear: targetYear,
    preferCurrency,
  });
  if ('error' in split) {
    return NextResponse.json({ error: split.error }, { status: 400 });
  }

  // Entity COLUMN-INDEX guard (Codex P1 #6) — `applyProposalByEntity` re-merges
  // userOverrides and splits on the MERGED entity column. A direct POST could
  // move the `entity` role to a different column whose distinct values happen
  // to match the reviewed set, routing rows by the wrong column. Pin the split
  // column to the one the reviewer approved.
  if (typeof meta.entityColumnIndex === 'number' && split.entityColumn !== meta.entityColumnIndex) {
    return NextResponse.json(
      {
        error: 'Колонка-сущность отличается от согласованной при анализе. Повторите анализ.',
        reviewed: meta.entityColumnIndex,
        current: split.entityColumn,
      },
      { status: 409 },
    );
  }

  // Entity-set equality (Codex P0-3) — the re-uploaded file's BU distribution
  // must match the reviewed set. Applies to BOTH dry-run and commit.
  if (sortedKey(split.entityValues) !== sortedKey(meta.entityValues)) {
    return NextResponse.json(
      {
        error:
          'Набор компаний (BU) в файле изменился после анализа. Повторите анализ — иначе данные ушли бы не в те компании.',
        reviewed: meta.entityValues,
        current: split.entityValues,
      },
      { status: 409 },
    );
  }

  // Classify per-entity outcomes.
  const parseErrors = split.perEntity.filter((p): p is { entityValue: string; error: string } => 'error' in p);
  const writeable = split.perEntity.filter(
    (p): p is { entityValue: string; result: ParseResult } => 'result' in p && p.result.lines.length > 0,
  );

  // A BU the reviewer marked `__SKIP__` (an elimination / consolidation / rollup
  // block, e.g. EJE/AJE/CONSOLIDATED) is NOT imported: excluded from the write
  // and from the all-mapped / injective / validation gates. `toWrite` is the
  // set we actually commit.
  const isSkip = (v: string) => entityMap[v] === SKIP_ENTITY;
  const skippedValues = writeable.filter((p) => isSkip(p.entityValue)).map((p) => p.entityValue);
  const toWrite = writeable.filter((p) => !isSkip(p.entityValue));

  // Per-entity control verdict + FULL validation engine (Codex #5, 2026-06-20:
  // the multi-entity path must run validateImport per entity, not just
  // control-totals — so coverage / sign-convention / etc. hard-block here too,
  // mirroring the single /apply route). Skipped entities aren't written → not
  // validated for blocking.
  const perEntityChecks = toWrite.map((p) => {
    const control = computeControlTotals(p.result.parentRollupsDropped, p.result.parentRollupsUnallocated);
    return { entityValue: p.entityValue, control, validation: validateImport(p.result, control) };
  });
  const aggVerdict: 'green' | 'yellow' | 'red' = perEntityChecks.some((c) => c.control.verdict === 'red')
    ? 'red'
    : perEntityChecks.some((c) => c.control.verdict === 'yellow')
      ? 'yellow'
      : 'green';
  // Entities the validation engine hard-blocks (RED control OR zero-revenue
  // coverage OR wrong/ambiguous cost-sign convention).
  const blockedEntities = perEntityChecks.filter((c) => c.validation.verdict === 'blocked');

  // Validate the entity map (companies in-org + injective + all-mapped) over the
  // to-be-written entities only.
  const mappedCompanyIds = [...new Set(toWrite.map((p) => entityMap[p.entityValue]).filter((v): v is string => !!v))];
  const inOrgCompanies = mappedCompanyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: mappedCompanyIds }, organizationId: orgId },
        select: { id: true, baseCurrencyCode: true },
      })
    : [];
  const inOrgIds = new Set(inOrgCompanies.map((c) => c.id));
  const baseCurrencyByCompany = new Map(inOrgCompanies.map((c) => [c.id, c.baseCurrencyCode ?? 'AZN']));

  const unmapped = toWrite.filter((p) => !entityMap[p.entityValue]).map((p) => p.entityValue);
  const crossOrg = mappedCompanyIds.filter((id) => !inOrgIds.has(id));
  // Injective: each to-be-written entity → a DISTINCT company (skips excluded).
  const assigned = toWrite.map((p) => entityMap[p.entityValue]).filter((v): v is string => !!v);
  const dupCompanyIds = assigned.filter((id, i) => assigned.indexOf(id) !== i);

  // ── Dry-run preview — advisory, never blocks ────────────────────────────
  if (dryRun) {
    // wouldDelete is counted ONLY when updating an existing plan; a fresh plan
    // deletes nothing.
    const previewPlan = existingTargetPlan;
    const perEntityPreview = await Promise.all(
      split.perEntity.map(async (p) => {
        const companyId = entityMap[p.entityValue];
        const wouldDelete =
          previewPlan && companyId && inOrgIds.has(companyId)
            ? await prisma.budgetLine.count({ where: { planId: previewPlan.id, companyId } })
            : 0;
        return {
          entityValue: p.entityValue,
          companyId: companyId ?? null,
          skipped: isSkip(p.entityValue),
          lineCount: 'result' in p ? p.result.lines.length : 0,
          error: 'error' in p ? p.error : undefined,
          wouldDelete,
        };
      }),
    );
    return NextResponse.json({
      stagingId: staging.id,
      status: 'preview',
      dryRun: true,
      year: targetYear,
      entityCount: split.entityValues.length,
      writeableCount: toWrite.length,
      skipped: skippedValues,
      // Plan target echo + the double-count warning (Option C).
      planTarget: existingTargetPlan
        ? { mode: 'update', planId: existingTargetPlan.id }
        : { mode: 'create', name: newPlanName ?? `Imported ${targetYear}`, kind: planKind },
      wouldDoubleActual,
      perEntity: perEntityPreview,
      controlVerdict: aggVerdict,
      // Advisory mapping issues — the UI gates on these; the commit enforces.
      mappingIssues: {
        unmapped,
        crossOrg,
        duplicateCompanyIds: [...new Set(dupCompanyIds)],
        parseErrors: parseErrors.map((p) => ({ entityValue: p.entityValue, error: p.error })),
        validationBlocked: blockedEntities.map((b) => ({
          entityValue: b.entityValue,
          findings: b.validation.findings.filter((f) => f.severity === 'blocker'),
        })),
      },
    });
  }

  // ── Commit gates (all-or-none, enforced) ────────────────────────────────
  if (parseErrors.length > 0) {
    return NextResponse.json(
      {
        error: `Импорт заблокирован: ${parseErrors.length} компани(й) не разобрались. Режим «всё-или-ничего».`,
        parseErrors: parseErrors.map((p) => ({ entityValue: p.entityValue, error: p.error })),
      },
      { status: 409 },
    );
  }
  if (toWrite.length === 0) {
    return NextResponse.json(
      { error: 'Нет компаний для импорта (0 строк с данными или все BU помечены «пропустить»).' },
      { status: 400 },
    );
  }
  if (unmapped.length > 0) {
    return NextResponse.json(
      { error: `Не назначены компании для: ${unmapped.join(', ')}. Сопоставьте каждую BU с компанией.`, unmapped },
      { status: 409 },
    );
  }
  if (dupCompanyIds.length > 0) {
    return NextResponse.json(
      {
        error: 'Несколько BU указывают на одну компанию — это перетёрло бы данные. Каждая BU должна вести в отдельную компанию.',
        duplicateCompanyIds: [...new Set(dupCompanyIds)],
      },
      { status: 409 },
    );
  }
  if (crossOrg.length > 0) {
    return NextResponse.json(
      { error: 'Назначены компании вне вашей организации.', crossOrg },
      { status: 409 },
    );
  }
  // Validation hard-block (covers RED control-total, zero-revenue coverage, AND
  // wrong/ambiguous cost-sign convention) on ANY entity → 409, zero writes.
  if (blockedEntities.length > 0) {
    return NextResponse.json(
      {
        error: `Импорт заблокирован валидацией для: ${blockedEntities.map((b) => b.entityValue || '(пусто)').join(', ')}. Данные не пройдут контроль.`,
        controlVerdict: aggVerdict,
        blockedEntities: blockedEntities.map((b) => ({
          entityValue: b.entityValue,
          findings: b.validation.findings.filter((f) => f.severity === 'blocker'),
        })),
      },
      { status: 409 },
    );
  }
  // Critical anomalies / low confidence (shared proposal — same as /apply).
  const isAck = (v: FormDataEntryValue | null): boolean => typeof v === 'string' && /^(true|1|yes)$/i.test(v.trim());
  const anomalies = Array.isArray(proposal.anomalies) ? proposal.anomalies : [];
  const columns = Array.isArray(proposal.columns) ? proposal.columns : [];
  const overall = typeof proposal.overallConfidence === 'number' ? proposal.overallConfidence : 1;
  const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical');
  if (criticalAnomalies.length > 0 && !isAck(form.get('acknowledgeAnomalies'))) {
    return NextResponse.json(
      { error: `Критических аномалий: ${criticalAnomalies.length}. Требуется подтверждение (acknowledgeAnomalies).`, requiresAcknowledgement: 'acknowledgeAnomalies' },
      { status: 409 },
    );
  }
  const lowConfidenceColumns = columns.filter((c) => typeof c.confidence === 'number' && c.confidence < 0.6);
  if ((lowConfidenceColumns.length > 0 || overall < 0.7) && !isAck(form.get('acknowledgeLowConfidence'))) {
    return NextResponse.json(
      { error: `Низкая уверенность маппинга. Требуется подтверждение (acknowledgeLowConfidence).`, requiresAcknowledgement: 'acknowledgeLowConfidence' },
      { status: 409 },
    );
  }
  // Double-count guard (Option C): creating a 2nd actual plan for a year that
  // already has one inflates the terminal → require explicit acknowledgement.
  if (wouldDoubleActual && !isAck(form.get('acknowledgeSecondActualPlan'))) {
    return NextResponse.json(
      {
        error: `За ${targetYear} год уже есть actual-план. Новый actual-план даст двойной счёт в терминале — обновите существующий план или подтвердите (acknowledgeSecondActualPlan).`,
        requiresAcknowledgement: 'acknowledgeSecondActualPlan',
        existingActualCount,
      },
      { status: 409 },
    );
  }

  // ── Transaction: shared plan, per-entity clean-slate + insert ───────────
  // committedMap records the FULL reviewer decision (written companies + the
  // explicit skips) as the audit snapshot of the destructive footprint.
  const committedMap: Record<string, string> = {};
  for (const p of toWrite) committedMap[p.entityValue] = entityMap[p.entityValue];
  for (const v of skippedValues) committedMap[v] = SKIP_ENTITY;

  interface EntityWriteReport {
    entityValue: string;
    companyId: string;
    inserted: number;
    deleted: number;
  }
  // The mapping actually applied. `applyProposalByEntity` re-merges the same
  // overrides internally before it splits, so this is the mapping that produced
  // the rows — not a restatement of the staged proposal.
  const effectiveMapping = mergeProposal(proposal, userOverrides);
  let txReports: EntityWriteReport[] = [];
  // Phase 10 / Stage B5 — the revision this apply commits. Assigned inside the
  // transaction below, so it exists only if the import does.
  let revisionId = '';
  try {
    const txResult = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Concurrency claim (Codex P0 #2) — race-safe status flip inside the tx
        // before any per-entity delete; the 2nd POST blocks then sees count 0.
        const claim = await tx.importStaging.updateMany({
          where: { id: staging.id, status: 'pending' },
          data: { status: 'applied', appliedAt: new Date() },
        });
        if (claim.count !== 1) throw new Error('STAGING_RACE');

        // Plan target (Option C): UPDATE the chosen existing plan, or CREATE a
        // new one with an EXPLICIT name + kind (no more silent kind="actual").
        let plan: { id: string };
        if (targetPlanId) {
          // Re-resolve INSIDE the tx (Codex TOCTOU 2026-06-21): the pre-tx
          // validation could go stale if the plan is soft-deleted in between.
          const rechecked = await tx.budgetPlan.findFirst({
            where: { id: targetPlanId, organizationId: orgId, year: targetYear, deletedAt: null },
            select: { id: true },
          });
          if (!rechecked) throw new Error('TARGET_PLAN_GONE');
          plan = rechecked;
        } else {
          plan = await tx.budgetPlan.create({
            data: {
              organizationId: orgId,
              name: newPlanName ?? `Imported ${targetYear}`,
              year: targetYear,
              periodType: 'yearly',
              status: 'active',
              kind: planKind,
            },
            select: { id: true },
          });
        }

        const reports: EntityWriteReport[] = [];
        for (const p of toWrite) {
          const companyId = entityMap[p.entityValue];
          const { inserted, deleted } = await applyParsedLinesToCompany(tx, {
            organizationId: orgId,
            planId: plan.id,
            companyId,
            lines: p.result.lines,
            // Phase C C3.2 — tag the sheet's resolved currency when present,
            // else the company base.
            baseCurrencyCode:
              p.result.resolvedCurrency ?? baseCurrencyByCompany.get(companyId) ?? 'AZN',
          });
          reports.push({ entityValue: p.entityValue, companyId, inserted, deleted });
        }

        // Persist the committed entity map (audit snapshot of the exact
        // destructive footprint — Codex P0-2). status/appliedAt were set by the
        // claim above.
        await tx.importStaging.update({
          where: { id: staging.id },
          data: {
            userOverrides: {
              ...((staging.userOverrides as object) ?? {}),
              ...(userOverrides ?? {}),
              __entityMap: committedMap,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        // Phase 10 / Stage B5 — pin the source state this apply committed,
        // inside the transaction that committed it.
        //
        // One shared revision is correct here, and only because every condition
        // that would forbid it is absent: all per-entity writes are in THIS
        // transaction; they are one source event (one sheet of one workbook,
        // split by its entity column); they share one mapping and one fiscal
        // year. `apply-multi` satisfies none of that and is deliberately not
        // wired — see IMPLEMENTATION-STATUS.md §19.
        //
        // The scope is derived from `reports`, i.e. from what
        // `applyParsedLinesToCompany` actually wrote — never from `entityMap`,
        // the request, or the plan. Those say what was *meant* to happen; a
        // revision attests to what *did*. It throws on an empty or foreign
        // scope, and throwing here rolls the whole import back, which is the
        // approved fail-closed policy: no financial commit without provenance.
        const revision = await ensureDataRevision(tx, {
          scope: buildMultiEntityImportRevisionScope({
            organizationId: orgId,
            stagingId: staging.id,
            effectiveMapping,
            targetYear,
            writes: reports,
            organizationCompanyIds: inOrgIds,
          }),
          reason: 'import',
          createdById: session.userId,
        });

        return { reports, revisionId: revision.id };
      },
      { timeout: 120_000 },
    );
    txReports = txResult.reports;
    revisionId = txResult.revisionId;
  } catch (err) {
    // Lineage failure — the import has already rolled back with it. Report a
    // stable reason code; never echo source data or foreign identifiers.
    if (err instanceof LineageScopeError) {
      log.error('lineage scope rejected — import rolled back', {
        route: '/api/onboarding/import/staging/[id]/apply-multi-entity',
        organizationId: orgId,
        stagingId: staging.id,
        reasonCode: err.reasonCode,
      });
      return NextResponse.json(
        {
          error:
            'Импорт отменён: не удалось зафиксировать происхождение данных. Данные не изменены.',
          reasonCode: err.reasonCode,
        },
        { status: 422 },
      );
    }
    if (err instanceof Error && err.message === 'STAGING_RACE') {
      return NextResponse.json(
        { error: 'Эта загрузка уже применяется/применена (параллельный запрос).', status: 'applied' },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message === 'TARGET_PLAN_GONE') {
      return NextResponse.json(
        { error: 'Выбранный план был удалён во время импорта. Обновите список планов и повторите.' },
        { status: 409 },
      );
    }
    log.error('transaction failed', {
      stagingId: staging.id,
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    try {
      await prisma.importStaging.update({
        where: { id: staging.id },
        data: { errorMessage: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      /* swallow secondary */
    }
    return NextResponse.json({ error: `Apply failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  // Auto-flip pending companies to active on first data.
  const affectedCompanyIds = [...new Set(txReports.map((r) => r.companyId))];
  if (affectedCompanyIds.length > 0) {
    try {
      await prisma.company.updateMany({
        where: { id: { in: affectedCompanyIds }, status: 'pending' },
        data: { status: 'active' },
      });
    } catch (err) {
      log.warn('Company.status flip failed', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // Recompute fan-out for every affected company.
  const { runRecomputeForCompanies } = await import('@/lib/risk/recompute-trigger');
  const recomputeResult = await runRecomputeForCompanies(
    prisma,
    orgId,
    affectedCompanyIds.map((companyId) => ({ companyId, year: targetYear })),
    {
      pairError: (label, err) => recomputeLog.error(label, { err: err instanceof Error ? err.message : String(err) }),
    },
    {
      // Phase 10 / Stage B5 — trace the observations back to the revision the
      // transaction committed. `tracedCompanyIds` is the revision's own
      // `companyIds`, so a company that was recomputed but NOT written (its
      // entity produced no insert and no delete) stays untraced rather than
      // citing a revision that does not name it. Parent rollups are never
      // traced — they merge several revisions, which one id cannot express.
      revisionId,
      tracedCompanyIds: new Set(committedCompanyIds(txReports)),
    },
  );
  const indicatorsStale = recomputeResult.failed > 0;

  const totalInserted = txReports.reduce((s, r) => s + r.inserted, 0);
  const totalDeleted = txReports.reduce((s, r) => s + r.deleted, 0);
  // Aggregate parse diagnostics across the written entities (the audit base
  // shape requires them; the per-company footprint is in metadata.entities).
  const aggWarnings = toWrite.reduce((s, p) => s + p.result.warnings.length, 0);
  const aggDropped = toWrite.reduce((s, p) => s + p.result.parentRollupsDropped.length, 0);
  const aggUnalloc = toWrite.reduce((s, p) => s + p.result.parentRollupsUnallocated.length, 0);

  const { logAuditEvent, buildAuditContext } = await import('@/lib/audit/log');
  const auditResult = await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: 'import_staging_apply',
      entityType: 'ImportStaging',
      entityId: staging.id,
      metadata: {
        // Anchor companyId (base shape requires it); per-company footprint
        // lives in `entities[]`.
        companyId: staging.companyId,
        year: targetYear,
        inserted: totalInserted,
        deleted: totalDeleted,
        warnings: aggWarnings,
        parentRollupsDropped: aggDropped,
        parentRollupsUnallocated: aggUnalloc,
        recompute: { ok: recomputeResult.ok, unknown: recomputeResult.unknown, failed: recomputeResult.failed, targets: recomputeResult.targets },
        multiEntity: true,
        entityCount: txReports.length,
        entities: txReports.map((r) => ({ entityValue: r.entityValue, companyId: r.companyId, inserted: r.inserted, deleted: r.deleted })),
      },
    },
    context: buildAuditContext({
      route: '/api/onboarding/import/staging/[id]/apply-multi-entity',
      userAgent: request.headers.get('user-agent') ?? undefined,
    }),
  });
  const auditStale = !auditResult.ok;

  return NextResponse.json(
    {
      stagingId: staging.id,
      status: 'applied',
      year: targetYear,
      inserted: totalInserted,
      deleted: totalDeleted,
      entityCount: txReports.length,
      perEntity: txReports,
      skipped: skippedValues,
      recompute: recomputeResult,
      indicatorsStale,
      auditStale,
    },
    { status: 200 },
  );
}
