/**
 * Phase 7.B AI Data Mapper — `/analyze` endpoint.
 *
 * Multipart upload: file + companyId + sheetName (optional, defaults to
 * first sheet) + industryHint (optional). Runs the AI mapper, persists
 * proposal to `ImportStaging` (status='pending'), returns
 * `{ stagingId, proposal }`.
 *
 * Auth: `manager` role + org-scoped to the caller's `session.orgId`.
 * The companyId in the body is verified to belong to that org — prevents
 * cross-tenant analyse-then-apply.
 *
 * Does NOT write to BudgetLine. Only the apply endpoint does that.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { extractMapperInput } from '@/lib/onboarding/ai-mapper/extract';
import { runMapper } from '@/lib/onboarding/ai-mapper/mapper';
import { hasAnthropicKey } from '@/lib/ai/client';

// Anthropic call can be slow on first hit + ~10s of analysis on a 100-row
// sheet. Lift function timeout to 60s.
export const maxDuration = 60;

// 10 MB caps a workbook with thousands of rows. Larger uploads should
// chunk client-side.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// One-shot onboarding op + LLM cost — rate-limit aggressively to deter
// abuse from a compromised account.
const RATE_LIMIT = { name: 'onboarding-analyze', max: 6, windowMs: 60_000 };

// Default staging TTL — 24h. Long enough for the user to come back the
// next day; short enough that abandoned proposals don't accumulate.
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  // Block early if the API key isn't configured — clearer error than the
  // generic Anthropic SDK failure.
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: 'AI Data Mapper unavailable: ANTHROPIC_API_KEY not configured on this deployment.' },
      { status: 503 },
    );
  }

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data body' }, { status: 400 });
  }

  const file = form.get('file');
  const companyIdRaw = form.get('companyId');
  const sheetNameRaw = form.get('sheetName');
  const industryHintRaw = form.get('industryHint');

  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing file. Send a multipart/form-data body with a "file" field.' },
      { status: 400 },
    );
  }
  if (typeof companyIdRaw !== 'string' || companyIdRaw.trim() === '') {
    return NextResponse.json(
      { error: 'Missing companyId. Send as a form field.' },
      { status: 400 },
    );
  }
  const companyId = companyIdRaw.trim();
  const sheetNameOverride =
    typeof sheetNameRaw === 'string' && sheetNameRaw.trim() !== ''
      ? sheetNameRaw.trim()
      : undefined;
  const industryHint =
    typeof industryHintRaw === 'string' && industryHintRaw.trim() !== ''
      ? industryHintRaw.trim()
      : undefined;

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` },
      { status: 413 },
    );
  }
  // Filename gate is mandatory — `multipart/form-data` clients without a
  // filename header (e.g. `curl -F "file=@-"`) would otherwise bypass the
  // .xlsx extension check and be parsed by xlsx.js. We require a non-empty
  // .xlsx-suffixed filename for audit trail in ImportStaging.sourceFile too.
  const filename = (file as Blob & { name?: string }).name ?? '';
  if (!filename) {
    return NextResponse.json(
      { error: 'Upload requires a filename. Send the file with a `filename=...` part.' },
      { status: 400 },
    );
  }
  if (!/\.xlsx$/i.test(filename)) {
    return NextResponse.json(
      { error: 'Only .xlsx files are accepted by the AI Data Mapper.' },
      { status: 415 },
    );
  }

  // Verify companyId belongs to caller's org BEFORE consuming an LLM call.
  // Cross-tenant analyse attempts hit a 404 before tokens are spent.
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { id: true, name: true, industry: true },
  });
  if (!company) {
    return NextResponse.json(
      { error: 'Company not found in your organization' },
      { status: 404 },
    );
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

  if (workbook.SheetNames.length === 0) {
    return NextResponse.json({ error: 'Workbook has no sheets' }, { status: 400 });
  }
  // Force explicit sheet selection on multi-sheet workbooks. Silently picking
  // sheet 0 is wrong for AZMADE-style books where the first sheet is often a
  // cover page / instructions / version log — the user must pick the actual
  // P&L/SOPL sheet. Single-sheet workbooks use the only sheet automatically.
  let sheetName: string;
  if (sheetNameOverride) {
    if (!workbook.SheetNames.includes(sheetNameOverride)) {
      return NextResponse.json(
        {
          error: `Sheet "${sheetNameOverride}" not found.`,
          availableSheets: workbook.SheetNames,
        },
        { status: 400 },
      );
    }
    sheetName = sheetNameOverride;
  } else if (workbook.SheetNames.length === 1) {
    sheetName = workbook.SheetNames[0];
  } else {
    return NextResponse.json(
      {
        error: `Workbook has ${workbook.SheetNames.length} sheets — sheetName must be specified.`,
        availableSheets: workbook.SheetNames,
      },
      { status: 400 },
    );
  }

  const inputResult = extractMapperInput(workbook, sheetName, XLSX, {
    sourceFile: filename,
    companyName: company.name,
    industry: industryHint ?? company.industry ?? undefined,
  });
  if ('error' in inputResult) {
    return NextResponse.json({ error: inputResult.error }, { status: 400 });
  }

  let proposal;
  try {
    proposal = await runMapper(inputResult);
  } catch (err) {
    // LLM failure is operational, not user-fixable. Return 502 to signal
    // upstream issue rather than 400 / 500.
    console.error('[onboarding/analyze] AI Mapper failed:', err);
    return NextResponse.json(
      {
        error: `AI Data Mapper failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  // Persist the proposal to staging. xlsxTempPath is null in this MVP —
  // /apply re-accepts the xlsx upload (the wizard wires file caching
  // client-side; server-side temp file caching can be added later if a
  // streamed upload turns out to be inconvenient for the UX).
  //
  // `usage` (token counts) is a runtime cost metric, not part of the
  // mapping snapshot the user reviews. Strip from BOTH the persisted
  // snapshot AND the response so what the wizard renders matches what
  // /apply replays — single source of truth for "the proposal".
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { usage, ...proposalForUser } = proposal;
  const expiresAt = new Date(Date.now() + STAGING_TTL_MS);
  const staging = await prisma.importStaging.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      status: 'pending',
      sourceFile: filename,
      sourceSheet: sheetName,
      proposal: proposalForUser as unknown as Record<string, unknown>,
      createdBy: session.userId,
      expiresAt,
    },
    select: { id: true },
  });

  // Surface the source column headers alongside the proposal so the
  // wizard UI can show the real header text (the persisted proposal only
  // carries sourceIndex + role + confidence). This is a presentation
  // helper, NOT part of the saved snapshot — staging.proposal is what
  // /apply replays. Headers are derived from the same xlsx the apply
  // re-uploads, so consistency is preserved.
  const sourceColumns = inputResult.columns.map((c) => ({
    sourceIndex: c.index,
    headerText: c.headerText,
  }));

  // Phase 7.B v2 Day 5 — return the full MapperInput that produced this
  // proposal so the ImportWizard can later promote the cached entry to
  // a permanent template via POST /api/onboarding/ai-mapper/templates
  // (which needs the same structureHash inputs to find the cache row).
  // Adds ~5-20KB to the response on a typical xlsx — acceptable cost
  // for client-side cache-aware template promotion without a separate
  // re-extract round-trip.
  return NextResponse.json(
    {
      stagingId: staging.id,
      expiresAt: expiresAt.toISOString(),
      proposal: proposalForUser,
      sourceColumns,
      mapperInput: inputResult,
    },
    { status: 201 },
  );
}
