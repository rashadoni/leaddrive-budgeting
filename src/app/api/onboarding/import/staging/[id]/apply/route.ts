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
import { applyProposal, detectProposalYear } from '@/lib/onboarding/ai-mapper/applier';
import { currentBakuYearNumber } from '@/lib/risk/periods';
import type { MappingProposal } from '@/lib/onboarding/ai-mapper/types';

export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
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

  // Apply the saved proposal (+ overrides) to the workbook.
  const proposal = staging.proposal as unknown as MappingProposal;
  const applyResult = applyProposal(
    workbook,
    staging.sourceSheet,
    proposal,
    XLSX,
    userOverrides,
  );
  if ('error' in applyResult) {
    return NextResponse.json({ error: applyResult.error }, { status: 400 });
  }

  // Resolve target BudgetPlan year. Priority:
  //   1. Year embedded in proposal's column roles (`amount:Plan2026`,
  //      `amount:Jan2026`, etc.) — most reliable, matches what the LLM
  //      saw in the source sheet.
  //   2. Current calendar year — fallback when no year hint present.
  // Conflicting years across columns return 400 (workbook split across
  // years isn't supported by this MVP — Turn 2c can add explicit
  // `targetYear` form field).
  const yearHint = detectProposalYear(proposal.columns);
  let targetYear: number;
  if (yearHint === null) {
    targetYear = currentBakuYearNumber();
  } else if (typeof yearHint === 'object' && 'conflict' in yearHint) {
    return NextResponse.json(
      {
        error: `Proposal has columns referencing multiple years (${yearHint.conflict.join(', ')}). MVP requires a single-year workbook; submit separate xlsx per year.`,
      },
      { status: 400 },
    );
  } else {
    targetYear = yearHint;
  }

  // Transactional delete-then-insert. Mirrors `import-azmade-budgets.ts`
  // pattern. Plan lookup-or-create + delete + ChartOfAccount upsert + line
  // insert + staging.status='applied' all atomic — if any insert fails,
  // ALL changes roll back.
  const orgIdLocal = orgId;
  const companyId = staging.companyId;
  let diagnostics: ApplyDiagnostics;
  try {
    diagnostics = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
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

          // Turn 34 monthly-distribution contract: write 12 rows per parsed
          // line (one per month) with `plannedAmount=perMonth[idx]` +
          // `sortOrder=monthIdx`. The CLI importer was rewritten in Turn 34
          // (`scripts/import-azmade-budgets.ts:182-201`) but the Onboarding
          // /apply route was missed — single-row inserts at sortOrder=0
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
              category: line.code,
              department: null,
              lineType,
              plannedAmount: monthlyAmount,
              sortOrder: monthIdx,
              isAutoPlanned: false,
              isAutoActual: false,
            };
            await tx.budgetLine.create({ data });
          }
          // `inserted` counts parsed LINES (not DB rows) so audit metadata
          // stays consistent with CLI's `import-azmade-budgets.ts:295` and
          // `budget/route.ts:277`. Previously this was inside the month-loop,
          // which 12× over-counted vs both reference paths.
          inserted += 1;
        }

        // Mark staging applied. Same transaction = atomic with the
        // BudgetLine writes; if anything aborts, status stays `pending`.
        await tx.importStaging.update({
          where: { id: staging.id },
          data: {
            status: 'applied',
            appliedAt: new Date(),
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
    console.error('[apply] transaction failed:', err);
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
    pairError: (label, err) => console.error(`[apply/recompute] ${label}:`, err),
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

