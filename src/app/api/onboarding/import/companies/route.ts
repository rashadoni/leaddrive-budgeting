/**
 * Phase 7.B — Bulk import of Company rows from an .xlsx file.
 *
 * Expected columns (header row, case-insensitive, whitespace tolerated):
 *   code, name, industry, level, parentCompanyCode
 *
 * `organizationId` is NOT a column — it's derived from the caller's session.
 * This removes the class of cross-tenant bug where a row's `organizationId`
 * field could be spoofed to write into another org.
 *
 * Level handling:
 *   level=1 = sub-group (no industry required, no parent)
 *   level=2 = operational entity (requires industry + parentCompanyCode)
 *
 * Two-pass insert: level-1 rows go first so level-2 rows can resolve their
 * `parentCompanyCode` to a concrete `parentCompanyId`. Both passes run inside
 * a single Prisma transaction — if pass 2 fails, pass 1 rolls back too.
 *
 * Duplicates:
 *   `(organizationId, code)` is unique in the DB. Workbook-internal duplicates
 *   are caught by `findWorkbookDuplicates` → 400 with per-row detail; rows
 *   whose code already exists in the DB are caught by an up-front
 *   `findMany({ code: { in: allCodes } })` → 409 with per-row detail. No
 *   silent dedup — the user always sees exactly which rows were rejected and
 *   fixes the workbook before retrying.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  canonicalizeHeaders,
  normalizeRow,
  findWorkbookDuplicates,
  type NormalizedRow,
  type RowError,
} from '@/lib/onboarding/companies-import';

export const maxDuration = 60;

// Max bytes to accept on a single upload. 10 MB fits a workbook of ~50k rows
// comfortably and is below the Next.js default body limit. Larger batches
// should be split — per-tenant onboarding is a one-time op, not a hot path.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Rate limit — one-shot onboarding op, not a firehose. Prevents parsing-based
// CPU DoS from a compromised account uploading huge workbooks in a loop.
const RATE_LIMIT = { name: 'onboarding-companies', max: 4, windowMs: 60_000 };

// Header canonicalization + per-row validation + workbook-level duplicate
// detection live in `@/lib/onboarding/companies-import` so they can be
// unit-tested without xlsx / Prisma / NextRequest.

export async function POST(request: NextRequest) {
  const session = await requireRole(request, 'manager');
  if (isAuthError(session)) return session;
  // defense-in-depth; getSession already filters empty orgId → null → 401
  if (!session.orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    );
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
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'Missing file. Send a multipart/form-data body with a "file" field.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_FILE_SIZE})` },
      { status: 413 },
    );
  }
  // Extension whitelist: only .xlsx / .csv. Reject .xlsm / .xlsb — xlsx.js
  // won't execute macros, but a file re-downloaded from our system should
  // not carry them back to the user's desktop Excel either.
  const filename = (file as Blob & { name?: string }).name ?? '';
  if (filename && !/\.(xlsx|csv)$/i.test(filename)) {
    return NextResponse.json(
      { error: 'Only .xlsx and .csv files are accepted.' },
      { status: 415 },
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    const arrayBuffer = await file.arrayBuffer();
    // Parse hardening:
    //   cellFormula/cellHTML/cellNF: false → drop computed formulas and HTML
    //     cells; we only read literal values, and this prevents xlsx.js from
    //     materialising pathological formula trees in memory (zip-bomb class).
    //   dense: true → single typed-array backing store, safer memory profile
    //     on large sheets.
    workbook = XLSX.read(Buffer.from(arrayBuffer), {
      type: 'buffer',
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      dense: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return NextResponse.json({ error: 'Workbook has no sheets' }, { status: 400 });
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'Sheet is empty' }, { status: 400 });
  }
  // Row-count cap — independent of byte-size cap to stop a tiny .xlsx with
  // a massive row range from blowing up memory after parse.
  if (rawRows.length > 50_000) {
    return NextResponse.json(
      { error: `Too many rows (${rawRows.length}, max 50000). Split into smaller files.` },
      { status: 413 },
    );
  }

  const imported = canonicalizeHeaders(rawRows);
  const rowErrors: RowError[] = [];
  const normalized: NormalizedRow[] = [];
  imported.forEach((row, i) => {
    const r = normalizeRow(row, i);
    if ('reason' in r) rowErrors.push(r);
    else normalized.push(r);
  });

  const dupErrors = findWorkbookDuplicates(normalized);
  if (rowErrors.length > 0 || dupErrors.length > 0) {
    return NextResponse.json(
      { error: 'Validation failed', rowErrors: [...rowErrors, ...dupErrors] },
      { status: 400 },
    );
  }

  // Track each normalized row's original workbook row number once, so
  // subsequent per-row errors don't O(n²) an `indexOf`.
  type NormalizedRowWithRowNum = NormalizedRow & { __row: number };
  const normalizedWithRow: NormalizedRowWithRowNum[] = normalized.map((r, i) => ({
    ...r,
    __row: i + 2,
  }));
  const level1 = normalizedWithRow.filter((r) => r.level === 1);
  const level2 = normalizedWithRow.filter((r) => r.level === 2);

  // Find conflicting DB rows up-front so we can report them 400-with-detail
  // instead of relying on `skipDuplicates` to silently drop them. Scoped to
  // the caller's org via the unique (organizationId, code) index.
  const allCodes = normalized.map((r) => r.code);
  const existing = await prisma.company.findMany({
    where: { organizationId: orgId, code: { in: allCodes } },
    select: { code: true },
  });
  if (existing.length > 0) {
    const existingSet = new Set(
      existing.map((e: { code: string }) => e.code),
    );
    const conflictRows: RowError[] = normalizedWithRow
      .filter((r) => existingSet.has(r.code))
      .map((r) => ({
        row: r.__row,
        reason: `code "${r.code}" already exists in this organization`,
      }));
    return NextResponse.json(
      { error: 'Validation failed', rowErrors: conflictRows },
      { status: 409 },
    );
  }

  // All writes happen inside one transaction — a pass-2 failure rolls back
  // pass-1 inserts too, so retries don't see half-imported state.
  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let level1Count = 0;
      if (level1.length > 0) {
        const res = await tx.company.createMany({
          data: level1.map((r) => ({
            organizationId: orgId,
            code: r.code,
            name: r.name,
            industry: r.industry,
            level: 1,
            parentCompanyId: null,
          })),
        });
        level1Count = res.count;
      }

      let level2Count = 0;
      const unresolvedParents: RowError[] = [];
      if (level2.length > 0) {
        const parentCodes = Array.from(
          new Set(
            level2
              .map((r) => r.parentCompanyCode)
              .filter((c): c is string => !!c),
          ),
        );
        // Lookup scoped to caller's org only — a level-2 row pointing at a
        // parentCompanyCode that exists in a different org will fail here.
        const parents =
          parentCodes.length === 0
            ? []
            : await tx.company.findMany({
                where: {
                  organizationId: orgId,
                  code: { in: parentCodes },
                },
                select: { id: true, code: true },
              });
        const parentLookup = new Map(
          parents.map((p: { id: string; code: string }) => [p.code, p.id]),
        );

        const resolvable: Array<NormalizedRowWithRowNum & { parentCompanyId: string }> = [];
        for (const r of level2) {
          const pid = parentLookup.get(r.parentCompanyCode!);
          if (!pid) {
            unresolvedParents.push({
              row: r.__row,
              reason: `parentCompanyCode "${r.parentCompanyCode}" not found in organization`,
            });
          } else {
            resolvable.push({ ...r, parentCompanyId: pid });
          }
        }

        if (unresolvedParents.length > 0) {
          // Rollback by throwing — transaction cleans up pass-1 inserts.
          const err = new Error('UNRESOLVED_PARENTS');
          (err as Error & { rowErrors?: RowError[] }).rowErrors = unresolvedParents;
          throw err;
        }

        if (resolvable.length > 0) {
          const res = await tx.company.createMany({
            data: resolvable.map((r) => ({
              organizationId: orgId,
              code: r.code,
              name: r.name,
              industry: r.industry,
              level: 2,
              parentCompanyId: r.parentCompanyId,
            })),
          });
          level2Count = res.count;
        }
      }

      const inserted = level1Count + level2Count;
      return { inserted, level1Count, level2Count };
    });

    return NextResponse.json(result);
  } catch (err) {
    const withRows = err as Error & { rowErrors?: RowError[] };
    if (withRows?.message === 'UNRESOLVED_PARENTS' && withRows.rowErrors) {
      return NextResponse.json(
        { error: 'Validation failed', rowErrors: withRows.rowErrors },
        { status: 400 },
      );
    }
    // Prisma unique-constraint violation — racing import or stale pre-check.
    // Shouldn't reach here because of the up-front conflict scan, but handle
    // defensively (e.g. two imports racing each other).
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        {
          error:
            'One or more codes conflict with existing rows (race with another import?). Retry after deduplicating.',
        },
        { status: 409 },
      );
    }
    console.error('Error importing companies:', err);
    const message = err instanceof Error ? err.message : 'Failed to import companies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
