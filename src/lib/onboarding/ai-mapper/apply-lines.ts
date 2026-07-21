/**
 * Phase C slice C2.3 — shared per-company BudgetLine write primitive.
 *
 * The single `/apply` route and the multi-entity `/apply-multi-entity` route
 * both need the SAME one-company delete-then-insert: clean-slate scoped to
 * `(org, plan, company)`, CoA upsert per code (cached), then a 12-row monthly
 * fan-out per parsed line. Extracted here (Codex P1-7 2026-06-20) so the new
 * route does NOT hand-copy a 4th near-duplicate body and let it drift.
 *
 * Corruption invariant: the delete WHERE is EXACTLY `(organizationId, planId,
 * companyId)` — never broader. The caller wraps N calls (one per entity) in a
 * single `$transaction` so a partial failure rolls back ALL entities; this
 * primitive does NOT open its own transaction.
 *
 * Behaviour is byte-for-byte the single route's tx body (12 rows per line at
 * sortOrder=monthIndex, isAutoPlanned=false, currencyCode=baseCurrency).
 */
import type { Prisma } from '@prisma/client';
import type { ParsedBudgetLine } from '../adapters/azmade-sopl';
import {
  assertParsedLinesCurrencyEvidence,
  normalizeParsedLineCurrencyEvidence,
} from './currency-evidence';

export interface ApplyLinesInput {
  organizationId: string;
  planId: string;
  companyId: string;
  lines: ParsedBudgetLine[];
  /** Tag every inserted line so FX_IMPORTED_INPUT can detect imported lines. */
  baseCurrencyCode: string;
  /** Sheet-level currency tag; a foreign tag still needs row-level evidence. */
  defaultCurrencyCode?: string | null;
}

export interface ApplyLinesResult {
  /** Parsed LINES written (not DB rows — each line fans out to 12 rows). */
  inserted: number;
  /** BudgetLine rows deleted by the clean-slate. */
  deleted: number;
}

export async function applyParsedLinesToCompany(
  tx: Prisma.TransactionClient,
  input: ApplyLinesInput,
): Promise<ApplyLinesResult> {
  const {
    organizationId,
    planId,
    companyId,
    lines,
    baseCurrencyCode,
    defaultCurrencyCode,
  } = input;

  // Evidence must be complete before the clean-slate delete. The caller's
  // transaction remains a second line of defence, but this keeps the primitive
  // safe when used directly as well.
  assertParsedLinesCurrencyEvidence(lines, baseCurrencyCode, defaultCurrencyCode);

  // Clean-slate scoped to this (org, plan, company) triple — never broader.
  const del = await tx.budgetLine.deleteMany({
    where: { organizationId, planId, companyId },
  });

  const coaCache = new Map<string, string>();
  let inserted = 0;
  for (const line of lines) {
    let coaId = coaCache.get(line.code);
    if (!coaId) {
      const existing = await tx.chartOfAccount.findUnique({
        where: { organizationId_code: { organizationId, code: line.code } },
        select: { id: true },
      });
      if (existing) {
        coaId = existing.id;
      } else {
        const created = await tx.chartOfAccount.create({
          data: {
            organizationId,
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
    if (!coaId) {
      throw new Error(`Internal: coaId not resolved for code ${line.code}`);
    }

    const lineType: 'revenue' | 'cogs' | 'expense' =
      line.accountType === 'revenue' || line.accountType === 'cogs'
        ? line.accountType
        : 'expense';

    for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
      const monthlyAmount = line.perMonth[monthIdx] ?? 0;
      const currency = normalizeParsedLineCurrencyEvidence({
        plannedAmount: monthlyAmount,
        monthIndex: monthIdx,
        baseCurrencyCode,
        evidence: line.currencyEvidence,
        defaultCurrencyCode,
      });
      const data: Prisma.BudgetLineUncheckedCreateInput = {
        organizationId,
        planId,
        companyId,
        accountId: coaId,
        department: null,
        lineType,
        plannedAmount: currency.plannedAmount,
        originalAmount: currency.originalAmount,
        exchangeRate: currency.exchangeRate,
        sortOrder: monthIdx,
        monthIndex: monthIdx,
        isAutoPlanned: false,
        isAutoActual: false,
        currencyCode: currency.currencyCode,
      };
      await tx.budgetLine.create({ data });
    }
    inserted += 1;
  }

  return { inserted, deleted: del.count };
}
