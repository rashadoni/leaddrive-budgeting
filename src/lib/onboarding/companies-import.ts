/**
 * Phase 7.B — pure helpers for the Companies bulk-import route.
 *
 * Extracted from `src/app/api/onboarding/import/companies/route.ts` so
 * header canonicalization, row validation, and workbook-level duplicate
 * detection can be unit-tested without xlsx / Prisma / NextRequest.
 *
 * Expected columns in the workbook (case + whitespace insensitive):
 *   code, name, industry, level, parentCompanyCode
 * `organizationId` is NOT accepted — the route derives it from `session.orgId`.
 */

export interface ImportRow {
  parentCompanyCode?: unknown;
  code?: unknown;
  name?: unknown;
  industry?: unknown;
  level?: unknown;
}

export interface NormalizedRow {
  parentCompanyCode: string | null;
  code: string;
  name: string;
  industry: string | null;
  level: 1 | 2;
}

export interface RowError {
  row: number;
  reason: string;
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function toOptStr(v: unknown): string | null {
  const s = toStr(v);
  return s.length ? s : null;
}

/**
 * Normalize an industry string to the canonical `snake_case_lowercase` shape
 * used as the `Industry.code` primary key. Users typing `"Hospitality"` or
 * `"Real Estate"` in Excel should still resolve to the seeded row instead of
 * hitting a FK violation on write.
 */
function normalizeIndustry(v: unknown): string | null {
  const s = toOptStr(v);
  return s === null ? null : s.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Map arbitrary header casing / whitespace to the canonical camelCase keys.
 *
 * SECURITY NOTE — this is a deliberate allow-list, not just a convenience. Any
 * column whose normalized name is not in `keyMap` is silently dropped. That is
 * the only defence against a malicious workbook smuggling `organizationId`,
 * `parentCompanyId`, or any other server-owned field into the import payload.
 * **Never add `organizationId` to `keyMap`** — the orgId is derived from the
 * caller's session in the route handler, not from user data. The companion
 * unit test (`companies-import.test.ts` → "strips an attacker-supplied
 * organizationId column and validates normally") locks this contract in.
 */
export function canonicalizeHeaders(
  rows: Record<string, unknown>[],
): ImportRow[] {
  const keyMap: Record<string, keyof ImportRow> = {
    parentcompanycode: 'parentCompanyCode',
    code: 'code',
    name: 'name',
    industry: 'industry',
    level: 'level',
  };
  return rows.map((raw) => {
    const out: ImportRow = {};
    for (const [k, v] of Object.entries(raw)) {
      const norm = k.toLowerCase().replace(/\s+/g, '');
      const canonical = keyMap[norm];
      if (canonical) out[canonical] = v;
    }
    return out;
  });
}

/**
 * Validate + coerce one row. Row numbers in `RowError.row` are 1-based and
 * account for the header row, so the first data row is `row=2` — matches
 * what Excel shows in the left gutter.
 */
export function normalizeRow(
  row: ImportRow,
  index: number,
): NormalizedRow | RowError {
  const rowNum = index + 2;

  const code = toStr(row.code);
  const name = toStr(row.name);
  if (!code) return { row: rowNum, reason: 'code is required' };
  if (!name) return { row: rowNum, reason: 'name is required' };
  if (code.length > 64) return { row: rowNum, reason: 'code max length is 64' };
  if (name.length > 255) {
    return { row: rowNum, reason: 'name max length is 255' };
  }

  const rawLevel = toStr(row.level);
  const parsed = rawLevel ? Number(rawLevel) : 2;
  if (parsed !== 1 && parsed !== 2) {
    return { row: rowNum, reason: `level must be 1 or 2 (got "${rawLevel}")` };
  }
  const level = parsed as 1 | 2;

  const parentCompanyCode = toOptStr(row.parentCompanyCode);
  const industry = normalizeIndustry(row.industry);

  if (level === 1 && parentCompanyCode) {
    return { row: rowNum, reason: 'level=1 must not have a parentCompanyCode' };
  }
  if (level === 2 && !parentCompanyCode) {
    return { row: rowNum, reason: 'level=2 requires parentCompanyCode' };
  }
  if (level === 2 && !industry) {
    return { row: rowNum, reason: 'level=2 requires industry' };
  }

  return { code, name, industry, level, parentCompanyCode };
}

/**
 * Flag rows whose `code` appears more than once in the same workbook. Surfaces
 * the user error before the DB's unique index would (the DB would silently
 * drop under `skipDuplicates`, which is worse UX than an explicit 400).
 */
export function findWorkbookDuplicates(rows: NormalizedRow[]): RowError[] {
  const firstSeen = new Map<string, number>();
  const errors: RowError[] = [];
  rows.forEach((r, i) => {
    const rowNum = i + 2;
    const previous = firstSeen.get(r.code);
    if (previous !== undefined) {
      errors.push({
        row: rowNum,
        reason: `duplicate code "${r.code}" (first seen at row ${previous})`,
      });
    } else {
      firstSeen.set(r.code, rowNum);
    }
  });
  return errors;
}
