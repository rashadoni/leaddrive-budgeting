/**
 * Phase 7.B AI Data Mapper — `/staging/[id]/apply` endpoint (Turn 2b).
 *
 * Multipart upload: file (re-uploaded xlsx) + optional userOverrides JSON.
 * Reads the saved `ImportStaging` proposal, runs `applyProposal()` to
 * derive `ParsedBudgetLine[]` from the workbook, then performs a
 * transactional delete-then-insert of `BudgetLine` rows scoped to
 * `(organizationId, planId, companyId)`. Marks staging as `applied` on
 * success, fires auto-recompute for affected indicators.
 *
 * Why we re-accept the xlsx upload at apply time:
 *   - /analyze didn't store the raw bytes (would be huge in DB; using a
 *     temp file dir would add infra without obvious benefit).
 *   - The SAVED `proposal.columns` describes WHICH columns to read; the
 *     raw xlsx provides the actual values. Same workbook re-uploaded =
 *     identical apply result (as long as the user didn't edit between
 *     analyze and apply).
 *
 * Auth: `manager` role + org-scope match. Staging row's organizationId
 * must equal session.orgId.
 *
 * Status transitions enforced:
 *   pending  → applied (happy path)
 *   pending  → expired (auto-flip if past expiresAt at apply time)
 *   applied  → 409 (already applied; idempotent NO-OP)
 *   discarded/expired → 410 (terminal; cannot apply)
 */

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// single-sheet apply route. 2 console.error → logger.error calls
// (transaction-failed + recompute pair-error callback).
const log = getLogger('api:apply');
const recomputeLog = getLogger('api:apply:recompute');
import { applyProposal, detectProposalYear, mergeProposal } from '@/lib/onboarding/ai-mapper/applier';
import { findEntityColumn } from '@/lib/onboarding/ai-mapper/entity-split';
import { computeControlTotals } from '@/lib/onboarding/ai-mapper/control-totals';
import { validateImport } from '@/lib/onboarding/ai-mapper/validate-import';
import { saveApprovedTemplate } from '@/lib/onboarding/ai-mapper/template-store';
import { extractMapperInput } from '@/lib/onboarding/ai-mapper/extract';
import { computeStructureHash } from '@/lib/onboarding/ai-mapper/structure-hash';
import { currentBakuYearNumber } from '@/lib/risk/periods';
import type { MappingProposal } from '@/lib/onboarding/ai-mapper/types';
import { MAX_IMPORT_UPLOAD_BYTES } from "@/lib/import/upload-limits"

export const maxDuration = 60;

const MAX_FILE_SIZE = MAX_IMPORT_UPLOAD_BYTES // shared cap — see src/lib/import/upload-limits.ts
const RATE_LIMIT = { name: 'onboarding-apply', max: 10, windowMs: 60_000 };

type ApplyDiagnostics = {
  inserted: number;
  deleted: number;
  warnings: number;
  parentRollupsDropped: number;
  parentRollupsUnallocated: number;
};

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

  const rateLimitError = enforceRateLimit(
    `${orgId}:${getClientIp(request)}`,
    RATE_LIMIT,
  );
  if (rateLimitError) return rateLimitError;

  const { id: stagingId } = await params;
  if (typeof stagingId !== 'string' || stagingId.trim() === '') {
    return NextResponse.json({ error: 'Invalid staging id' }, { status: 400 });
  }

  // Fetch + validate staging row before consuming the upload. 404 (not
  // 403) when staging belongs to another org, to avoid id-existence leak.
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

  // Status gating. Lazy-flip past-expiresAt pending rows to expired (race-
  // safe with `where: status='pending'`).
  if (staging.status === 'pending' && staging.expiresAt < new Date()) {
    await prisma.importStaging.updateMany({
      where: { id: staging.id, status: 'pending' },
      data: { status: 'expired' },
    });
    // Phase 7.F (Turn 11) — log the lazy-expire transition. Logged
    // best-effort but currently BLOCKS via `await` (Pattern A2 per
    // `src/lib/audit/log.ts` Calling-pattern contract; converting to
    // Pattern B `void logExpire(...).catch(console.error)` deferred
    // to a scoped future fix per Turn-Z architect Round-2 💡).
    const { logAuditEvent: logExpire, buildAuditContext: ctxFn } = await import(
      '@/lib/audit/log'
    );
    await logExpire(prisma, {
      organizationId: orgId,
      actorUserId: session.userId,
      event: {
        action: 'import_staging_expired',
        entityType: 'ImportStaging',
        entityId: staging.id,
        metadata: {
          companyId: staging.companyId,
          expiresAt: staging.expiresAt.toISOString(),
          triggeredBy: 'lazy_apply',
        },
      },
      context: ctxFn({
        route: '/api/onboarding/import/staging/[id]/apply',
      }),
    });
    return NextResponse.json(
      { error: 'Staging proposal has expired', status: 'expired' },
      { status: 410 },
    );
  }
  if (staging.status === 'applied') {
    return NextResponse.json(
      {
        error: 'Staging already applied',
        status: 'applied',
        appliedAt: staging.appliedAt?.toISOString() ?? null,
      },
      { status: 409 },
    );
  }
  if (staging.status === 'discarded' || staging.status === 'expired') {
    return NextResponse.json(
      { error: `Staging is ${staging.status}; cannot apply`, status: staging.status },
      { status: 410 },
    );
  }

  // Parse multipart body. We require a fresh file upload — see jsdoc on
  // why /analyze doesn't store xlsx bytes.
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
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` },
      { status: 413 },
    );
  }
  const filename = (file as Blob & { name?: string }).name ?? '';
  if (!filename || !/\.xlsx$/i.test(filename)) {
    return NextResponse.json(
      { error: 'Only .xlsx files are accepted by the AI Data Mapper.' },
      { status: 415 },
    );
  }

  // Optional userOverrides JSON (string field in the form).
  let userOverrides: Partial<MappingProposal> | undefined;
  const overridesRaw = form.get('userOverrides');
  if (typeof overridesRaw === 'string' && overridesRaw.trim() !== '') {
    try {
      userOverrides = JSON.parse(overridesRaw);
    } catch (err) {
      return NextResponse.json(
        {
          error: `Invalid userOverrides JSON: ${err instanceof Error ? err.message : err}`,
        },
        { status: 400 },
      );
    }
  }

  // Optional dry-run flag — when truthy, run applyProposal() to compute
  // the diagnostics that the real apply WOULD produce, but skip the
  // prisma transaction (no BudgetLine inserts, no staging.status flip,
  // no audit emission, no recompute). Lets the wizard preview the apply
  // result before the user commits. Closes Phase 7.G L425.
  // Accepted truthy values: "true", "1", "yes" (case-insensitive). Any
  // other value (including empty / missing) is treated as false — the
  // existing real-apply path is the default.
  const dryRunRaw = form.get('dryRun');
  const dryRun =
    typeof dryRunRaw === 'string' &&
    /^(true|1|yes)$/i.test(dryRunRaw.trim());

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
    return NextResponse.json(
      {
        error: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  // Structure-hash guard (Phase 2 #5): reject when the re-uploaded file's
  // sheet structure differs from what was analysed — the saved proposal maps
  // by column INDEX, so an edited file would silently mis-map. Skipped for
  // pre-guard stagings (no stored hash) for back-compat.
  const storedHash = (staging.proposal as { __structureHash?: string }).__structureHash;
  if (storedHash) {
    // Re-extract with the SAME company industry analyze used — computeStructureHash
    // includes it, so omitting it made the guard always reject legit re-uploads
    // for companies that have an industry (bug fix 2026-06-21).
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
        {
          error:
            'Файл изменился после анализа (структура колонок не совпадает). Загрузите тот же файл или повторите анализ.',
        },
        { status: 409 },
      );
    }
  }

  const proposal = staging.proposal as unknown as MappingProposal;

  // ── Reject a MULTI-ENTITY staging on this single-company path (Codex P0 #1,
  // 2026-06-20 + re-review). A staging with an `entity` column / persisted
  // `__multiEntity` routes rows to SEVERAL companies; committing it here would
  // parse all BUs together and write them into the single `staging.companyId`,
  // bypassing the entity-map / injective / cross-org / per-entity gates. Check
  // the proposal AND the userOverrides columns so a direct caller can't sneak an
  // `entity` role in via userOverrides. Force it to /apply-multi-entity.
  const overrideColumns = (userOverrides as { columns?: typeof proposal.columns } | undefined)?.columns;
  const hasMultiEntity =
    !!(staging.proposal as { __multiEntity?: unknown }).__multiEntity ||
    (Array.isArray(proposal.columns) && findEntityColumn(proposal.columns) !== null) ||
    (Array.isArray(overrideColumns) && findEntityColumn(overrideColumns) !== null);
  if (hasMultiEntity) {
    return NextResponse.json(
      {
        error:
          'Это многокомпанийный лист (entity-колонка). Используйте /api/onboarding/import/staging/[id]/apply-multi-entity.',
      },
      { status: 422 },
    );
  }

  // Resolve the target BudgetPlan year FIRST — the applier needs it to pick
  // the right year's columns on a MULTI-YEAR sheet (Phase C 2026-06-20).
  // Priority:
  //   1. explicit `targetYear` form field (lets the user pick for a multi-year
  //      file or when the year isn't in the headers)
  //   2. single year embedded in the column roles (`amount:Jan2026`)
  //   3. multi-year roles with no explicit pick → the LATEST year
  //      (multi-year sheets are now supported, not rejected)
  //   4. current calendar year — fallback when no year hint at all
  const yearHint = detectProposalYear(proposal.columns);
  const formYearRaw = form.get('targetYear');
  const formYear =
    typeof formYearRaw === 'string' && /^\d{4}$/.test(formYearRaw.trim())
      ? Number(formYearRaw.trim())
      : undefined;
  let targetYear: number;
  if (formYear !== undefined) {
    targetYear = formYear;
  } else if (yearHint === null) {
    targetYear = currentBakuYearNumber();
  } else if (typeof yearHint === 'object' && 'conflict' in yearHint) {
    targetYear = Math.max(...yearHint.conflict);
  } else {
    targetYear = yearHint;
  }

  // Phase C C3.2 — optional target currency (reviewer picks when the sheet
  // carries the same period in >1 currency). Defaults to undefined → the
  // applier only needs it when currencies actually collide.
  const tcRaw = form.get('targetCurrency');
  const preferCurrency =
    typeof tcRaw === 'string' && tcRaw.trim() !== '' ? tcRaw.trim() : undefined;

  // Apply the saved proposal (+ overrides), selecting the target year's
  // columns on a multi-year sheet (and the target currency on a multi-currency
  // sheet).
  const applyResult = applyProposal(
    workbook,
    staging.sourceSheet,
    proposal,
    XLSX,
    userOverrides,
    { preferYear: targetYear, preferCurrency },
  );
  if ('error' in applyResult) {
    return NextResponse.json({ error: applyResult.error }, { status: 400 });
  }

  // Dry-run early-return — before opening the prisma transaction.
  // Computes the same diagnostics shape the real apply would emit, plus
  // a `wouldBeDeleted` count derived from the existing plan (if any),
  // BUT does not mutate state. Caller can preview the apply before
  // committing.
  if (dryRun) {
    const planName = `AI-Imported ${targetYear} Budget`;
    const existingPlan = await prisma.budgetPlan.findFirst({
      where: {
        organizationId: orgId,
        year: targetYear,
        name: planName,
        deletedAt: null,
      },
      select: { id: true },
    });
    const wouldBeDeleted = existingPlan
      ? await prisma.budgetLine.count({
          where: {
            planId: existingPlan.id,
            companyId: staging.companyId,
          },
        })
      : 0;
    // `inserted` counts parsed LINES (matching the real-apply contract;
    // each line fans out to 12 BudgetLine rows at sortOrder 0..11).
    const wouldBeInserted = applyResult.lines.length;
    // Phase 2 — control-total verdict from the file's own parent/leaf
    // redundancy (green/yellow/red). A large parent-vs-leaf delta is the
    // mis-mapped-column signature; the wizard gates commit on it.
    const control = computeControlTotals(
      applyResult.parentRollupsDropped,
      applyResult.parentRollupsUnallocated,
    );
    // Phase A validation engine — graded verdict from multiple file-internal
    // signals (control-total + Total-column tie-out + coverage + margin/sign).
    const validation = validateImport(applyResult, control);
    return NextResponse.json(
      {
        stagingId: staging.id,
        status: 'preview',
        dryRun: true,
        year: targetYear,
        inserted: wouldBeInserted,
        deleted: wouldBeDeleted,
        warnings: applyResult.warnings.length,
        parentRollupsDropped: applyResult.parentRollupsDropped.length,
        parentRollupsUnallocated:
          applyResult.parentRollupsUnallocated.length,
        controlVerdict: control.verdict,
        controlNoData: control.noControl,
        controlTotals: control.controlTotals.slice(0, 10),
        validationVerdict: validation.verdict,
        validationFindings: validation.findings,
        rowTotalMismatches: (applyResult.rowTotalMismatches ?? []).length,
      },
      { status: 200 },
    );
  }

  // ── Server-side review gates (Codex P1 #1, 2026-06-20) ───────────────
  // The wizard enforces control-total / anomaly / low-confidence gates, but
  // a direct POST to /apply (no dryRun) previously bypassed them — a manager
  // could commit a red-verdict or critical-anomaly import via the API. Re-run
  // the gates here so the server is the real boundary. RED control-total is a
  // HARD block (per product decision 2026-06-20); critical anomalies and
  // low-confidence mappings require explicit acknowledgement form fields
  // (the wizard sends them once the human has reviewed).
  const isAck = (v: FormDataEntryValue | null): boolean =>
    typeof v === 'string' && /^(true|1|yes)$/i.test(v.trim());
  const commitControl = computeControlTotals(
    applyResult.parentRollupsDropped,
    applyResult.parentRollupsUnallocated,
  );
  // Phase A validation engine — graded verdict from multiple file-internal
  // signals. A "blocked" verdict (RED control-total OR no-revenue coverage
  // failure) is a HARD 409: these are mis-maps that must never commit.
  const commitValidation = validateImport(applyResult, commitControl);
  if (commitValidation.verdict === 'blocked') {
    const blocker = commitValidation.findings.find((f) => f.severity === 'blocker');
    return NextResponse.json(
      {
        error:
          blocker?.message ??
          'Импорт заблокирован валидацией: данные не прошли контроль.',
        controlVerdict: commitControl.verdict,
        controlTotals: commitControl.controlTotals.slice(0, 10),
        validationFindings: commitValidation.findings,
      },
      { status: 409 },
    );
  }
  // Defensive: a real proposal always carries anomalies[]/columns[]/
  // overallConfidence, but older/edge staging rows may omit them — treat
  // missing as "no gate" rather than throwing.
  const anomalies = Array.isArray(proposal.anomalies) ? proposal.anomalies : [];
  const columns = Array.isArray(proposal.columns) ? proposal.columns : [];
  const overall =
    typeof proposal.overallConfidence === 'number'
      ? proposal.overallConfidence
      : 1;
  const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical');
  if (criticalAnomalies.length > 0 && !isAck(form.get('acknowledgeAnomalies'))) {
    return NextResponse.json(
      {
        error: `Критических аномалий: ${criticalAnomalies.length}. Требуется явное подтверждение (acknowledgeAnomalies) перед коммитом.`,
        criticalAnomalies: criticalAnomalies.slice(0, 10),
        requiresAcknowledgement: 'acknowledgeAnomalies',
      },
      { status: 409 },
    );
  }
  const lowConfidenceColumns = columns.filter(
    (c) => typeof c.confidence === 'number' && c.confidence < 0.6,
  );
  const lowOverall = overall < 0.7;
  if (
    (lowConfidenceColumns.length > 0 || lowOverall) &&
    !isAck(form.get('acknowledgeLowConfidence'))
  ) {
    return NextResponse.json(
      {
        error: `Низкая уверенность маппинга (колонок <0.6: ${lowConfidenceColumns.length}${lowOverall ? `; общая ${overall.toFixed(2)}<0.7` : ''}). Требуется подтверждение (acknowledgeLowConfidence) перед коммитом.`,
        lowConfidenceColumns: lowConfidenceColumns.map((c) => ({
          sourceIndex: c.sourceIndex,
          role: c.role,
          confidence: c.confidence,
        })),
        overallConfidence: overall,
        requiresAcknowledgement: 'acknowledgeLowConfidence',
      },
      { status: 409 },
    );
  }

  // Transactional delete-then-insert pattern. Plan lookup-or-create +
  // delete + ChartOfAccount upsert + line insert + staging.status='applied'
  // all atomic — if any insert fails, ALL changes roll back.
  const orgIdLocal = orgId;
  const companyId = staging.companyId;

  // Phase 7.G Turn XXXIX (L1 closure): tag every inserted BudgetLine with
  // the company's baseCurrencyCode so FX_IMPORTED_INPUT can detect
  // imported (non-base-currency) lines correctly. Pre-Turn-XXXIX behavior
  // landed BudgetLine.currencyCode as NULL, making the indicator
  // structurally return 0% for any company onboarded via this path.
  const companyForCurrency = await prisma.company.findUnique({
    where: { id: companyId },
    select: { baseCurrencyCode: true },
  });
  // Phase C C3.2 — tag with the sheet's resolved currency when it specified
  // one (e.g. an imported USD sheet → currencyCode "USD", which lets
  // FX_IMPORTED_INPUT flag it as non-base); else the company base currency.
  const baseCurrencyCode =
    applyResult.resolvedCurrency ?? companyForCurrency?.baseCurrencyCode ?? 'AZN';
  let diagnostics: ApplyDiagnostics;
  try {
    diagnostics = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Concurrency claim (Codex P0 #2, 2026-06-20): the pre-tx status check
        // is not race-safe — two concurrent POSTs both see `pending`, both
        // delete-then-insert → duplicate rows (budget_lines has no unique
        // constraint). Claim the row INSIDE the tx with a conditional
        // updateMany; the 2nd POST blocks on the row lock, then sees count 0 →
        // throws → its deletes roll back. count must be exactly 1.
        const claim = await tx.importStaging.updateMany({
          where: { id: staging.id, status: 'pending' },
          data: { status: 'applied', appliedAt: new Date() },
        });
        if (claim.count !== 1) throw new Error('STAGING_RACE');

        // Plan lookup-or-create. Per-org plan, year-scoped.
        const planName = `AI-Imported ${targetYear} Budget`;
        let plan = await tx.budgetPlan.findFirst({
          where: { organizationId: orgIdLocal, year: targetYear, name: planName, deletedAt: null },
          select: { id: true },
        });
        if (!plan) {
          plan = await tx.budgetPlan.create({
            data: {
              organizationId: orgIdLocal,
              name: planName,
              year: targetYear,
              periodType: 'yearly',
              status: 'active',
            },
            select: { id: true },
          });
        }

        // Delete prior lines scoped to this (org, plan, company) triple.
        const del = await tx.budgetLine.deleteMany({
          where: {
            organizationId: orgIdLocal,
            planId: plan.id,
            companyId,
          },
        });

        // ChartOfAccount upsert per unique code in parsed lines.
        const coaCache = new Map<string, string>();
        let inserted = 0;
        for (const line of applyResult.lines) {
          let coaId = coaCache.get(line.code);
          if (!coaId) {
            const existing = await tx.chartOfAccount.findUnique({
              where: { organizationId_code: { organizationId: orgIdLocal, code: line.code } },
              select: { id: true },
            });
            if (existing) {
              coaId = existing.id;
            } else {
              const created = await tx.chartOfAccount.create({
                data: {
                  organizationId: orgIdLocal,
                  code: line.code,
                  name: line.label || line.code,
                  nameEn: line.label || line.code,
                  accountType: line.accountType,
                  sortOrder: 0,
                  isActive: true,
                },
                select: { id: true },
              });
              coaId = created.id;
            }
            coaCache.set(line.code, coaId);
          }

          const lineType: 'revenue' | 'cogs' | 'expense' =
            line.accountType === 'revenue' || line.accountType === 'cogs'
              ? line.accountType
              : 'expense';

          // coaId is guaranteed defined at this point — either looked up
          // or created above. Assert for the type-checker.
          if (!coaId) {
            throw new Error(`Internal: coaId not resolved for code ${line.code}`);
          }

          // Monthly-distribution contract: write 12 rows per parsed
          // line (one per month) with `plannedAmount=perMonth[idx]` +
          // `sortOrder=monthIdx`. Earlier single-row inserts at sortOrder=0
          // collapsed all 12 months into Jan, so post-/apply P&L charts
          // showed a January spike + zero across Feb-Dec. `perMonth` length
          // is guaranteed 12 by the parser/applier contract; rollup-sourced
          // lines get an even annual/12 split (parser doesn't have monthly
          // granularity for those — same fallback as the CLI path).
          // Turn 29 (Bug #1b) idiom: xlsx-sourced lines have explicit
          // plannedAmount values; they are NOT auto-planned.
          for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
            const monthlyAmount = line.perMonth[monthIdx] ?? 0;
            const data: Prisma.BudgetLineUncheckedCreateInput = {
              organizationId: orgIdLocal,
              planId: plan.id,
              companyId,
              accountId: coaId,
              // Cost-center tag from the ".R" Head Office / Region split
              // (dedupeParentRollups). null for single-cost-center sheets.
              department: line.department ?? null,
              lineType,
              plannedAmount: monthlyAmount,
              sortOrder: monthIdx,
              // Phase 7.G Turn XL (A.1): explicit 0-indexed month (Jan=0..Dec=11).
              // Resolvers prefer this over `sortOrder % 100` when present.
              monthIndex: monthIdx,
              isAutoPlanned: false,
              isAutoActual: false,
              // Phase 7.G Turn XXXIX (L1 closure): tag with the company's
              // base currency. FX-imported lines (different currency than
              // base) are not yet auto-detected by the AI mapper —
              // future-work to extract `amount:<currency-suffix>` semantics
              // from the proposal columns.
              currencyCode: baseCurrencyCode,
            };
            await tx.budgetLine.create({ data });
          }
          // `inserted` counts parsed LINES (not DB rows) so audit metadata
          // stays consistent with `budget/route.ts:277`. Previously this
          // was inside the month-loop, which 12× over-counted.
          inserted += 1;
        }

        // Persist the reviewer overrides. status/appliedAt were already set by
        // the concurrency claim at the top of this tx.
        await tx.importStaging.update({
          where: { id: staging.id },
          data: {
            userOverrides:
              (userOverrides as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          },
        });

        return {
          inserted,
          deleted: del.count,
          warnings: applyResult.warnings.length,
          parentRollupsDropped: applyResult.parentRollupsDropped.length,
          parentRollupsUnallocated: applyResult.parentRollupsUnallocated.length,
        };
      },
      // 60s timeout — covers ~500 rows comfortably; matches the import-
      // azmade-budgets.ts CLI pattern.
      { timeout: 60_000 },
    );
  } catch (err) {
    // Lost the concurrency claim (another POST applied this staging first) —
    // 409, and DON'T overwrite the winner's errorMessage.
    if (err instanceof Error && err.message === 'STAGING_RACE') {
      return NextResponse.json(
        { error: 'Эта загрузка уже применяется/применена (параллельный запрос).', status: 'applied' },
        { status: 409 },
      );
    }
    log.error('transaction failed', {
      stagingId: staging.id,
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Persist failure reason to staging so the UI can show it (out-of-
    // band of the transaction — best-effort, ignore secondary failures).
    try {
      await prisma.importStaging.update({
        where: { id: staging.id },
        data: { errorMessage: err instanceof Error ? err.message : String(err) },
      });
    } catch {
      // swallow — primary error is what matters
    }
    return NextResponse.json(
      {
        error: `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  // Auto-recompute affected indicator values. Runs OUTSIDE the apply
  // transaction (long-running; would extend tx beyond 60s on big sheets).
  // Failures here mean BudgetLine is committed but IndicatorValue rows
  // haven't been refreshed — stale state. Surface as an explicit
  // top-level flag so the UI can show a "matrix may be stale, retry"
  // banner instead of silently presenting old numbers as current.
  // Phase 7.E hardening (Turn 10): orchestration delegated to the shared
  // `runRecomputeForCompanies`; this route used to inline the same body.
  const { runRecomputeForCompanies } = await import('@/lib/risk/recompute-trigger');
  const recomputeResult = await runRecomputeForCompanies(prisma, orgIdLocal, [
    { companyId, year: targetYear },
  ], {
    pairError: (label, err) => recomputeLog.error(label, {
      err: err instanceof Error ? err.message : String(err),
    }),
  });
  const indicatorsStale = recomputeResult.failed > 0;

  // Phase 7.F (Turn 11) — audit the apply. Logging failure surfaces as
  // `auditStale` rather than aborting the already-committed transaction.
  const { logAuditEvent, buildAuditContext } = await import('@/lib/audit/log');
  const auditResult = await logAuditEvent(prisma, {
    organizationId: orgIdLocal,
    actorUserId: session.userId,
    event: {
      action: 'import_staging_apply',
      entityType: 'ImportStaging',
      entityId: staging.id,
      metadata: {
        companyId,
        year: targetYear,
        inserted: diagnostics.inserted,
        deleted: diagnostics.deleted,
        warnings: diagnostics.warnings,
        parentRollupsDropped: diagnostics.parentRollupsDropped,
        parentRollupsUnallocated: diagnostics.parentRollupsUnallocated,
        recompute: {
          ok: recomputeResult.ok,
          unknown: recomputeResult.unknown,
          failed: recomputeResult.failed,
          targets: recomputeResult.targets,
        },
      },
    },
    context: buildAuditContext({
      route: '/api/onboarding/import/staging/[id]/apply',
      userAgent: request.headers.get('user-agent') ?? undefined,
    }),
  });
  const auditStale = !auditResult.ok;

  // Phase B — "learn each format once". Persist the human-approved mapping
  // keyed by the file's structure-hash, so the next file of the same shape can
  // be pre-filled (commit still goes through Phase-A validation). Best-effort:
  // a template-save failure must NOT fail an import that already committed.
  if (storedHash) {
    const approved = mergeProposal(proposal, userOverrides);
    void saveApprovedTemplate(prisma, orgId, {
      structureHash: storedHash,
      sheetName: staging.sourceSheet,
      sourceFile: staging.sourceFile,
      approvedBy: session.userId,
      mapping: {
        columns: approved.columns,
        accountTypeOverrides: approved.accountTypeOverrides,
      },
    }).catch((err) =>
      log.error('approved-template save failed (import already committed)', {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return NextResponse.json(
    {
      stagingId: staging.id,
      status: 'applied',
      year: targetYear,
      ...diagnostics,
      recompute: recomputeResult,
      // True when at least one indicator failed to recompute. UI should
      // surface this so the matrix isn't silently shown as up-to-date.
      indicatorsStale,
      auditStale,
    },
    { status: 200 },
  );
}

