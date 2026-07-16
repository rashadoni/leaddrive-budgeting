/**
 * Recompute pipeline — Prisma data-source adapter.
 *
 * Phase 8 D1 (2026-05-29) — extracted from `recompute.ts` (the core engine
 * file) to shrink it. `createPrismaDataSource` wraps a real `PrismaClient`
 * (or a `Prisma.TransactionClient` for RLS-scoped callers) into the narrow
 * `RecomputeDataSource` interface the resolvers consume. Every read includes
 * `organizationId` in `where:` for cross-tenant safety. Re-exported from
 * `recompute.ts`, so existing `import { createPrismaDataSource } from
 * '@/lib/risk/recompute'` call sites (route handlers, recompute-trigger,
 * tests) are unaffected.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { RecomputeDataSource, ValueSource } from './recompute-types';

// --- Prisma adapter ----------------------------------------------------------

/**
 * Wraps a real PrismaClient into `RecomputeDataSource`. Every read includes
 * `organizationId` in `where:` for cross-tenant safety. Writes also carry
 * `organizationId` straight into the Prisma row.
 *
 * Phase 8 D5(a) (2026-05-28) — accepts either `PrismaClient` (legacy
 * call sites + tests) OR `Prisma.TransactionClient` so callers wrapped
 * in `withOrgScope` can thread the tx through and pick up RLS
 * `app.organization_id` session vars at the DB layer.
 */
export function createPrismaDataSource(
  prisma: PrismaClient | Prisma.TransactionClient,
): RecomputeDataSource {
  return {
    async listBookings({ organizationId, companyId, start, end }) {
      return prisma.booking.findMany({
        where: {
          organizationId,
          companyId,
          arrivalDate: { gte: start, lt: end },
        },
        select: {
          revenue: true,
          nights: true,
          roomsBooked: true,
          sourceCountry: true,
          currencyCode: true,
          exchangeRate: true,
          isCancelled: true,
        },
      });
    },

    async listOperationalFacts({
      organizationId,
      companyId,
      metric,
      start,
      end,
    }) {
      return prisma.operationalFact.findMany({
        where: {
          organizationId,
          companyId,
          metric,
          date: { gte: start, lt: end },
        },
        // Deterministic order so the "snapshot" aggregation's latest-by-date
        // pick is stable across recomputes. OperationalFact has no @@unique on
        // (companyId, metric, date), and not every writer deletes-before-insert,
        // so two facts can share an exact as-of date with different values (a
        // value corrected at the same date). With no orderBy, Postgres row order
        // was unspecified → the snapshot tie-winner flipped between runs. date
        // asc + createdAt asc means the snapshot reducer (>=) lands on the most
        // recently written fact at the latest date (i.e. the correction).
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        // `unit` lets currency-sensitive resolvers (captured pl_ebitda) verify
        // the fact is denominated in the company's base currency before use.
        select: { value: true, date: true, unit: true },
      });
    },

    async getCompanySettings({ organizationId, companyId }) {
      const c = await prisma.company.findFirst({
        where: { id: companyId, organizationId },
        select: { settings: true },
      });
      if (!c || !c.settings) return null;
      return c.settings as Record<string, unknown>;
    },

    // Phase 7.I — IntelDataPoint reads for the weather + commodityPrice
    // resolvers. The table is added by the drift-resolution v2-models
    // migration; until that migration applies in dev, prisma.intelDataPoint
    // is in the client but the table doesn't exist. We catch the table-
    // missing error and return [] so the resolver downgrades cleanly to
    // "data not available" rather than throwing inside recompute.
    async listIntelDataPoints({ organizationId, sourceCode, metric, start, end, limit = 50 }) {
      const where: {
        organizationId: string;
        sourceCode: string;
        metric?: string;
        datetime?: { gte?: Date; lt?: Date };
      } = { organizationId, sourceCode };
      if (metric) where.metric = metric;
      if (start || end) {
        where.datetime = {};
        if (start) where.datetime.gte = start;
        if (end) where.datetime.lt = end;
      }
      try {
        const rows = await prisma.intelDataPoint.findMany({
          where,
          orderBy: { datetime: 'asc' },
          take: limit,
          select: { metric: true, datetime: true, value: true, unit: true },
        });
        return rows;
      } catch (err) {
        // Drift-migration not applied yet — table missing. Treat as no
        // data rather than fail loudly: recompute should still complete
        // for the financial / operational indicators that don't depend
        // on IntelDataPoint, and the external-feed indicators will
        // legitimately read `unknown` until the migration lands.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('relation "intel_data_points"') ||
          msg.includes('does not exist') ||
          msg.includes('P2021')
        ) {
          return [];
        }
        throw err;
      }
    },

    async listCounterparties({ organizationId, companyId, role, period }) {
      try {
        const rows = await prisma.counterparty.findMany({
          // Phase 7.M Step 4 — exclude soft-deleted (archived) counter-
          // parties from the recompute pipeline. Indicators like
          // customer-concentration HHI must reflect the active
          // counterparty register only; archived rows would silently
          // dilute the share-of-revenue math.
          where: { organizationId, companyId, role, period, deletedAt: null },
          select: { sharePct: true, singleSource: true, name: true },
        });
        return rows;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('relation "counterparties"') ||
          msg.includes('does not exist') ||
          msg.includes('P2021')
        ) {
          return [];
        }
        throw err;
      }
    },

    // Phase 7.O (2026-05-24) — balance-sheet line lookup for per-entity
    // BS aggregations (inventory, equity, current-ratio).
    //
    // Period semantics:
    //   year    → December snapshot (balance sheets are point-in-time;
    //             using the fiscal year-end is the standard approach for
    //             annual indicator computation like inventory turns).
    //   month   → that month's snapshot.
    //   quarter → last month of the quarter (e.g. Q1 → month 3).
    //
    // Only rows with companyId set (Phase 7.O imports) are returned.
    // Legacy rows with companyId=null are excluded — they cannot be
    // company-scoped and would cross-contaminate multi-entity plans.
    async listBalanceSheetLines({ organizationId, companyId, period }) {
      // Determine the target month for point-in-time BS snapshot
      let targetMonth: number;
      if (period.kind === 'year') {
        targetMonth = 12; // year-end balance
      } else if (period.kind === 'quarter') {
        // Last month of the quarter: Q1→3, Q2→6, Q3→9, Q4→12
        targetMonth = period.start.getUTCMonth() + 3;
      } else {
        // month period: 0-indexed UTC month → 1-indexed DB month
        targetMonth = period.start.getUTCMonth() + 1;
      }
      try {
        const rows = await prisma.balanceSheetLine.findMany({
          where: {
            organizationId,
            companyId,
            year: period.year,
            month: targetMonth,
            // Decouple plan: terminal reads ACTUAL plans only (no-op until a
            // budget plan exists; all existing plans default kind="actual").
            plan: { kind: "actual" },
            deletedAt: null,
          },
          select: {
            // Phase 2.1 session 3: accountCode + accountName dropped
            // from BalanceSheetLine; read via the account FK relation.
            account: { select: { code: true, name: true } },
            lineType: true,
            subType: true,
            year: true,
            month: true,
            amount: true,
          },
        });
        // Re-shape to keep downstream consumers (bsIsInventoryLine etc.)
        // backward-compatible — they expect flat `accountCode`/`accountName`
        // strings, not the nested `account` object.
        return rows.map((r: {
          account: { code: string; name: string };
          lineType: string;
          subType: string | null;
          year: number;
          month: number;
          amount: number;
        }) => ({
          accountCode: r.account.code,
          accountName: r.account.name,
          lineType: r.lineType,
          subType: r.subType,
          year: r.year,
          month: r.month,
          amount: r.amount,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Graceful degradation if table or column doesn't exist yet
        // (pre-migration environment).
        if (
          msg.includes('column "companyId"') ||
          msg.includes('relation "balance_sheet_lines"') ||
          msg.includes('does not exist') ||
          msg.includes('P2021')
        ) {
          return [];
        }
        throw err;
      }
    },

    async listCurrencyRates({ organizationId, asOf }) {
      // One row per configured currency. For the base currency we emit
      // { rate: 1, rateDate: asOf }. For non-base currencies we look up the
      // latest rate in CurrencyRateHistory on or before `asOf`, falling back
      // to Currency.exchangeRate if no history row exists.
      //
      // Two queries total regardless of currency count — avoids N+1 that
      // bit us in the earlier loop-per-code implementation.
      const currencies = await prisma.currency.findMany({
        where: { organizationId, isActive: true },
        select: {
          code: true,
          isBase: true,
          exchangeRate: true,
        },
      });
      if (currencies.length === 0) return [];

      const nonBaseCodes = currencies
        .filter((c: { isBase: boolean }) => !c.isBase)
        .map((c: { code: string }) => c.code);

      // Fetch all history rows for all non-base codes in one query, then
      // group in memory and take the latest per code.
      const history =
        nonBaseCodes.length === 0
          ? []
          : await prisma.currencyRateHistory.findMany({
              where: {
                organizationId,
                currencyCode: { in: nonBaseCodes },
                rateDate: { lte: asOf },
              },
              orderBy: { rateDate: 'desc' },
              select: { currencyCode: true, rate: true, rateDate: true },
            });
      const latestByCode = new Map<
        string,
        { rate: number; rateDate: Date }
      >();
      for (const h of history) {
        if (!latestByCode.has(h.currencyCode)) {
          // findMany is already sorted desc, so first hit per code wins.
          latestByCode.set(h.currencyCode, {
            rate: h.rate,
            rateDate: h.rateDate,
          });
        }
      }

      return currencies.map(
        (c: { code: string; isBase: boolean; exchangeRate: number }) => {
          if (c.isBase) {
            return {
              currencyCode: c.code,
              rate: 1,
              rateDate: asOf,
              isBase: true,
            };
          }
          const hit = latestByCode.get(c.code);
          return {
            currencyCode: c.code,
            rate: hit ? hit.rate : c.exchangeRate,
            rateDate: hit ? hit.rateDate : asOf,
            isBase: false,
          };
        },
      );
    },

    async listBudgetLines({ organizationId, companyId, period }) {
      // Year scope: without `plan.year` a 2026-04 recompute would aggregate
      // every year of plans the company has ever had, making P&L
      // denominators year-agnostic and skewing ratios.
      //
      // Month scope (Turn-42-sub3 fix): post-Turn-34 each parsed line is
      // 12 BudgetLine rows with `sortOrder` = month index 0..11 +
      // `plannedAmount` = perMonth slice. When period.kind is monthly /
      // quarterly, narrow by sortOrder so sparkline trailing-month
      // evaluations actually see different data per anchor — the whole
      // point of a sparkline is varying-by-period, defeated by an
      // unfiltered annual sum.
      // Prefer `monthIndex` (the schema-intended month source — see prisma
      // `@@index([planId, companyId, monthIndex])`), falling back to the
      // legacy `sortOrder` only for rows where monthIndex was never
      // populated. The importer was fixed 2026-05-30 to write
      // `sortOrder = monthIndex`, but monthIndex is the canonical column, so
      // bucket on it directly and stop depending on the two staying synced.
      let monthRange: { gte: number; lte: number } | undefined;
      if (period.kind === 'month') {
        const m = period.start.getUTCMonth();
        monthRange = { gte: m, lte: m };
      } else if (period.kind === 'quarter') {
        const startMonth = period.start.getUTCMonth();
        monthRange = { gte: startMonth, lte: startMonth + 2 };
      }
      // year — no month filter; aggregate across all 12 months.

      const rows = await prisma.budgetLine.findMany({
        where: {
          organizationId,
          companyId,
          // Decouple plan: the terminal's P&L reads ACTUAL plans only, so a
          // separate forward-budget plan (kind="budget") never double-counts
          // into realized indicators. All pre-existing plans default to
          // kind="actual", so this is a no-op until a budget plan is created.
          plan: { year: period.year, kind: "actual" },
          // Coalesce-in-filter: a row matches the period month if its
          // monthIndex is in range, OR (monthIndex null) its legacy
          // sortOrder is in range. Mirrors the `monthIndex ?? sortOrder`
          // preference already used in the analytics / pnl readers.
          ...(monthRange
            ? {
                OR: [
                  { monthIndex: monthRange },
                  { monthIndex: null, sortOrder: monthRange },
                ],
              }
            : {}),
          // Phase 7.M Step 4 — exclude soft-deleted (archived) budget
          // lines. Without this, archiving a single period's rows
          // would still leave them flowing into revenue / cogs / opex
          // aggregates → no observable effect on HeatMap. The whole
          // point of the admin archive UI is reversible removal.
          deletedAt: null,
        },
        select: {
          plannedAmount: true,
          currencyCode: true,
          exchangeRate: true,
          // Phase 7.E perMonth chain — `sortOrder` doubles as month
          // index 0..11 for the 12-row-per-line monthly persistence
          // strategy. Surfaced as `monthIndex` in the Row shape with
          // null for out-of-range / non-monthly rows so resolvers can
          // group by month deterministically.
          sortOrder: true,
          monthIndex: true,
          // CLI follow-up — fallback channel when accountId is null.
          // The ATL detailed import (`scripts/import-atl-detailed.cjs`)
          // populates `lineType` directly instead of linking to CoA. The
          // resolver below reads `accountType ?? lineType` so granular
          // imports work without the upstream CoA-link step.
          lineType: true,
          account: {
            select: {
              accountType: true,
              code: true,
              category: true,
              name: true,
              nameEn: true,
            },
          },
        },
      });
      return rows.map(
        (
          r: {
            plannedAmount: number;
            currencyCode: string | null;
            exchangeRate: number | null;
            sortOrder: number;
            monthIndex: number | null;
            lineType: string;
            account: {
              accountType: string;
              code: string;
              category: string | null;
              name: string;
              nameEn: string | null;
            } | null;
          },
        ) => ({
          plannedAmount: r.plannedAmount,
          currencyCode: r.currencyCode,
          exchangeRate: r.exchangeRate,
          accountType: r.account?.accountType ?? r.lineType ?? null,
          accountCode: r.account?.code ?? null,
          accountCategory: r.account?.category ?? null,
          // Prefer English name for downstream lowercase-name heuristics
          // (deterministic across locale-mixed CoAs); fall back to the
          // primary name when nameEn was never populated.
          accountName: r.account?.nameEn ?? r.account?.name ?? null,
          // Prefer the canonical `monthIndex`; fall back to the legacy
          // `sortOrder`-as-month only when monthIndex is null. Anything
          // outside [0,11] is non-monthly (rollup-sourced single-row
          // legacy or hand-edited) — surface as null so resolvers
          // bypass it instead of bucketing into "month 99".
          monthIndex:
            r.monthIndex ??
            (r.sortOrder >= 0 && r.sortOrder <= 11 ? r.sortOrder : null),
        }),
      );
    },

    /**
     * Phase 7.E phase 3 — read peer IV by (org, co, code, period). Returns
     * null on missing row OR status='unknown' (the latter would otherwise
     * silently feed a placeholder 0 into a parent formula).
     */
    async getIndicatorValue({
      organizationId,
      companyId,
      indicatorCode,
      period,
    }) {
      const row = await prisma.indicatorValue.findFirst({
        where: {
          organizationId,
          companyId,
          period,
          indicator: { code: indicatorCode },
        },
        select: { value: true, status: true },
      });
      if (!row) return null;
      if (row.status === 'unknown') return null;
      return row.value;
    },

    /**
     * Phase 7.G Turn XLI (Phase C) — batched read for fact() resolver.
     * Single Prisma `findMany` with OR clause; missing rows OR
     * status='unknown' rows map to `null` keyed by `${code}@${period}`.
     * Empty pairs returns empty object without hitting Prisma.
     */
    async getIndicatorValues({ organizationId, companyId, pairs }) {
      if (pairs.length === 0) return {};
      const rows = await prisma.indicatorValue.findMany({
        where: {
          organizationId,
          companyId,
          OR: pairs.map((p) => ({
            indicator: { code: p.indicatorCode },
            period: p.period,
          })),
        },
        select: {
          value: true,
          status: true,
          period: true,
          indicator: { select: { code: true } },
        },
      });
      const result: Record<string, number | null> = {};
      // Initialise every requested pair to null so callers can rely on
      // key presence (not the same as `undefined`).
      for (const p of pairs) {
        result[`${p.indicatorCode}@${p.period}`] = null;
      }
      for (const row of rows) {
        const key = `${row.indicator.code}@${row.period}`;
        if (row.status === 'unknown') {
          result[key] = null;
        } else {
          result[key] = row.value;
        }
      }
      return result;
    },

    /**
     * Phase 7.E phase 3 — direct-children lookup for `rollup()`. Active
     * children only; org-scoped.
     */
    async listChildCompanyIds({ organizationId, parentId }) {
      const rows = await prisma.company.findMany({
        where: {
          organizationId,
          parentCompanyId: parentId,
          isActive: true,
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async getNewsSentimentRolling30d({ organizationId, companyId }) {
      // Resolve the company's code — IntelItem.companyTags[] uses the
      // human-readable code (e.g. "AAC"), not the cuid id.
      const co = await prisma.company.findFirst({
        where: { id: companyId, organizationId },
        select: { code: true },
      });
      if (!co?.code) return null;

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // PostgreSQL array-contains via `has` (Prisma operator); partial
      // index `intel_items_sentiment_lookup_idx` (WHERE sentimentScore IS
      // NOT NULL) speeds the date-bound scan.
      const rows = await prisma.intelItem.findMany({
        where: {
          organizationId,
          companyTags: { has: co.code },
          fetchedAt: { gte: cutoff },
          sentimentScore: { not: null },
        },
        select: { sentimentScore: true },
      });
      if (rows.length === 0) return null;
      const sum = rows.reduce(
        (acc, r) => acc + (r.sentimentScore ?? 0),
        0,
      );
      return sum / rows.length;
    },

    async getIndicatorDisclosure({
      organizationId,
      companyId,
      indicatorCode,
      period,
    }) {
      const row = await prisma.indicatorDisclosure.findFirst({
        where: { organizationId, companyId, indicatorCode, period },
        select: { value: true, unit: true },
      });
      return row ?? null;
    },

    async upsertIndicatorValue({
      organizationId,
      companyId,
      indicatorId,
      period,
      value,
      status,
      inputs,
      sparkline,
      valueSource,
      confidence,
      revisionId,
    }) {
      // Phase 10 / Stage B5 — lineage guard. A revisionId is only meaningful
      // if it names a revision of THIS organization: a pointer into another
      // tenant would render as evidence while being a leak, which is strictly
      // worse than the honest `null` that legacy rows carry.
      //
      // Verified here rather than at the caller because this adapter is the
      // single place an IndicatorValue is written — a check upstream could be
      // bypassed by the next caller, and the FK alone only proves the revision
      // exists somewhere, not that it belongs to this org. Runs inside the
      // caller's transaction (this closure's `prisma` IS the tx client when one
      // was passed), so the revision cannot vanish between check and write, and
      // a rollback discards both.
      //
      // Cost is zero on every existing path: no caller passes revisionId yet,
      // and `undefined` skips the query entirely.
      if (revisionId != null) {
        const revision = await prisma.dataRevision.findFirst({
          where: { id: revisionId, organizationId },
          select: { id: true },
        });
        if (!revision) {
          // One message for both "missing" and "belongs to another org": the
          // caller must not be able to probe another tenant's revision ids by
          // distinguishing the two.
          throw new Error(
            `upsertIndicatorValue: revision ${revisionId} not found in organization ${organizationId}`,
          );
        }
      }
      // Phase 7.E phase 2 — sparkline write semantics:
      //   - CREATE: caller-supplied array OR `[]` (the original first-write
      //     default). `[]` keeps the schema invariant `sparkline != null` so
      //     the UI doesn't have to handle null specially.
      //   - UPDATE: include the column ONLY if the caller supplied a value.
      //     Bulk recomputes that pass `withSparkline: false` (period-only
      //     fan-out, xlsx-import follow-up) MUST NOT clobber sparklines
      //     populated earlier by the offline `compute-sparklines.ts` worker
      //     OR by an interactive `withSparkline: true` recompute.
      // Phase 7.H F4.v2.1 — `valueSource` is written on both CREATE and
      // UPDATE so a seed flip (e.g. v2.2 swapping a generic placeholder
      // for industry-specific) refreshes the badge on the next recompute.
      await prisma.indicatorValue.upsert({
        where: {
          companyId_indicatorId_period: { companyId, indicatorId, period },
        },
        create: {
          organizationId,
          companyId,
          indicatorId,
          period,
          value,
          status,
          sparkline: (sparkline ?? []) as Prisma.InputJsonValue,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          // Our `ValueSource` string union mirrors the generated Prisma enum
          // `IndicatorValueSource` 1:1 (declared in prisma/schema.prisma).
          // TypeScript accepts the literal union directly without a cast
          // because Prisma generates the enum as a union of the same string
          // literals.
          valueSource,
          // Phase 7.H F4.v2.2.1 — model-confidence tier written on
          // CREATE; null when caller omits.
          confidence: confidence ?? null,
          // Stage B5 — lineage. Omitted → null, i.e. untraced, exactly like
          // every legacy row.
          revisionId: revisionId ?? null,
        },
        update: {
          value,
          status,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          computedAt: new Date(),
          // Our `ValueSource` string union mirrors the generated Prisma enum
          // `IndicatorValueSource` 1:1 (declared in prisma/schema.prisma).
          // TypeScript accepts the literal union directly without a cast
          // because Prisma generates the enum as a union of the same string
          // literals.
          valueSource,
          // Confidence on UPDATE: caller's null clears the tier (mirrors
          // disclosed-override → no tier). Recompute always passes a
          // value or null; undefined → null via the `??` coercion.
          confidence: confidence ?? null,
          ...(sparkline !== undefined && {
            sparkline: sparkline as Prisma.InputJsonValue,
          }),
          // Stage B5 — lineage is written on EVERY update, and deliberately
          // does NOT follow the sparkline rule above.
          //
          // The two look alike and are opposites. A sparkline is independent
          // data owned by another writer (the offline worker), so a recompute
          // that has none must leave it alone. A `revisionId` is a property of
          // the `value` three lines up: it is the claim "this revision
          // produced this number". The moment an untraced recompute replaces
          // `value`, that claim stops being true — so carrying the old
          // revision forward would not be preserving lineage, it would be
          // fabricating it, and a wrong pointer reads as evidence where `null`
          // reads as the absence of it.
          //
          // Hence: traced write → stamps its revision; untraced write → clears
          // to null and the row is honestly untraced again, exactly as A5's
          // gate will then report it. Presence therefore means "this revision
          // produced this number", never "some revision once did".
          revisionId: revisionId ?? null,
        },
      });
    },
  };
}
