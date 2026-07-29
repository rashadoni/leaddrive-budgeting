/**
 * Production-adapter financial-statement handlers (PLF / BS / CF / KPI) —
 * extracted from production-adapter-registry.ts (Phase 8 D1 2026-05-29).
 * Each `make*Handler(prisma, ctxRef, ensureCtx)` returns an AdapterHandler
 * that parses one sheet, builds the cross-file reconciliation sums, and
 * applies rows via the matching batch fn inside the orchestrator's outer tx.
 * The KPI factory also covers the farming/processing/sales modes. The
 * registry assembler wires these into the AdapterRegistry shape.
 */
import type { PrismaClient, Prisma } from "@prisma/client"
import {
  type AdapterHandler,
  type AdapterRunInput,
  type AdapterRunResult,
} from "./adapter-registry"
import { runDynamicPlfAdapter } from "./dynamic-plf-adapter"
import { runDynamicBsAdapter } from "./dynamic-bs-adapter"
import { runDynamicCfAdapter } from "./dynamic-cf-adapter"
import { parsePlfPlSheet, parsePlfCfSheet, parsePlfEbitdaSubtotalAllYears } from "../adapters/azseker-plf"
import {
  isCashFlowBridgeActivity,
  isCashFlowMovementActivity,
} from "../cf-bridge"
import { parseWorkbookBsSheet } from "../adapters/azseker-workbook-bs"
import {
  parseWorkbookFarmingKpiSheet,
  parseWorkbookProcessingKpiSheet,
} from "../adapters/azseker-workbook-kpi"
import {
  parseFarmingSalesSheet,
  parseProductionSalesSheet,
  parseProMaltSalesSheet,
} from "../adapters/azseker-workbook-sales"
import { parseSalesPlanSheet } from "../adapters/azseker-farming-strategy"
import { runImportBatch, type ImportBatchRow } from "../import-batch"
import { runBalanceSheetBatch, type BsImportRow } from "../bs-import-batch"
import { runCashFlowBatch, type CfImportRow } from "../cf-import-batch"
import { runKpiBatch, type KpiImportRow } from "../kpi-import-batch"
import { assertNoCollateralDeletion } from "../collateral-guard"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import {
  createCoACache,
  preWarmCoACache,
  resolveOrCreateAccountId,
} from "../upsert-chart-of-account"
import {
  type OrgContext,
  buildPeriodScope,
  CF_SOURCE_TAG,
  logger,
} from "./prod-adapter-context"

export function makePlfHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      // Multi-file mode: forward-forecast / strategic files often have
      // PLF-shaped sheets without an entity (e.g. cross-entity İcmal,
      // GDX summaries). Skip gracefully — orchestrator records this in
      // perFile warnings without killing the sheet pipeline.
      return {
        summary: `PLF sheet "${input.sheetName}" has no entityCode — skipped (cross-entity forecast / summary)`,
        itemCount: 0,
        warnings: [
          `Sheet "${input.sheetName}" classified PLF but has no entityCode — likely cross-entity / forecast sheet`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
    const parsed = parsePlfPlSheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
      { preferYear: input.year },
    )
    const companyId = ctx.codeToId.get(input.entityCode)
    if (!companyId) {
      // Missing company is recoverable too — log + skip.
      return {
        summary: `PLF sheet "${input.sheetName}": company ${input.entityCode} not in DB — skipped`,
        itemCount: 0,
        warnings: [
          `Company "${input.entityCode}" not found in DB for sheet "${input.sheetName}"`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const rows: ImportBatchRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    // Phase 2.1 session 1 (2026-05-26) — per-(line.code) metadata so the
    // applyToDb pass can auto-upsert the ChartOfAccount row before
    // attaching accountId to each BudgetLine. Account codes are org-
    // wide, not entity-scoped: same `PLF.10.10.1` from AZSF and CPC
    // resolves to the same CoA row.
    const accountSpecs = new Map<
      string,
      { code: string; name: string; accountType: string }
    >()
    // Phase 11.8b (2026-07-29) — the ORDINAL is part of the source-cell key.
    //
    // `sourceCell` was `#<sheet>!<code>@<period>`, i.e. keyed on the ACCOUNT
    // CODE. A workbook that lists the same code on several rows — measured on
    // production: PLF.07.02.04 appears up to three times in the 2025 PLF sheet
    // — produced one identical key for genuinely different rows. That made
    // `sourceDocument` unusable as a natural key and left BudgetLine with no
    // way to state "one row per source cell" in the database.
    let lineOrdinal = -1
    for (const line of parsed.lines) {
      lineOrdinal += 1
      if (!accountSpecs.has(line.code)) {
        accountSpecs.set(line.code, {
          code: line.code,
          name: line.label ?? line.code,
          accountType: line.accountType,
        })
      }
      for (let m = 0; m < 12; m++) {
        const amount = line.perMonth[m]
        if (amount === 0) continue
        const period = `${input.year}-${String(m + 1).padStart(2, "0")}`
        rows.push({
          companyId,
          // Phase 2.1 session 3: recon key middle is the raw line.code
          // (CoA codes are org-wide; entity is the key's first arg).
          category: line.code,
          lineType: line.accountType,
          period,
          monthIndex: m,
          plannedAmount: amount,
          currencyCode: "AZN",
          exchangeRate: null,
          planId: ctx.planId,
          // Placeholder — overwritten in applyToDb via resolveOrCreateAccountId.
          accountId: "",
          sourceCell: `multi-import#${input.sheetName}!${line.code}#${lineOrdinal}@${period}`,
        })
        const key = buildReconKey(input.entityCode, line.code, period)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
      }
    }
    // ── Dynamic fallback: hard-coded parser returned 0 rows on a non-empty sheet ──
    // Triggers when the sheet uses a layout the AZSEKER adapter doesn't recognise
    // (different column positions, different year placement, non-serial date headers).
    // One Claude call detects the structure; result cached 24h in AIMapperProposalCache.
    if (rows.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sheet = input.workbook.Sheets[input.sheetName]
      const hasData = sheet != null && Object.keys(sheet).length > 1 // >1: !ref alone = empty
      if (hasData) {
        logger.info("PLF format unknown — delegating to dynamic detector", {
          sheetName: input.sheetName,
          entityCode: input.entityCode,
        })
        return runDynamicPlfAdapter(input, ctx.planId, companyId, prisma)
      }
    }

    return {
      summary: `${parsed.lines.length} PLF lines for ${input.entityCode}`,
      itemCount: rows.length,
      warnings: parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
      // 2026-07-29 (11.9b follow-up) — an AMBIGUOUS cost-sign convention must
      // reach the orchestrator's gate, not just the warnings list.
      //
      // azseker-plf.ts records ambiguity on `signConvention.blockedReason` and
      // also pushes a `BLOCKED:` warning, but this handler only mapped the
      // warnings to strings and never set `blocked` — the ONLY field the gate
      // reads. So an ambiguous sheet flipped anyway (`flipCogs` defaults to
      // true for anything that is not `positive_costs`) and committed with a
      // warning nobody had to act on. The correct wiring already existed in
      // dynamic-plf-adapter.
      ...(parsed.signConvention?.blockedReason
        ? { blocked: { reason: parsed.signConvention.blockedReason } }
        : {}),
      // Phase 7.M Tier 5 — `expectedSums` is read by orchestrator for
      // cross-file conflict detection (not declared on the public
      // AdapterRunResult shape, but the orchestrator looks for it).
      // Phase 8 D3 — `expectedSums` is an undocumented orchestrator
      // hook on AdapterRunResult; cast the empty branch to a typed
      // empty spread instead of `as any`.
      ...(rows.length > 0
        ? { expectedSums }
        : ({} as Record<string, never>)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Resolve (or create) one CoA row per unique line.code, then
        // stamp the resolved id on every BudgetLine. Cache is pre-warmed
        // from ctx.coaByCode so existing rows hit O(1).
        const coaCache = createCoACache()
        preWarmCoACache(
          coaCache,
          ctx.organizationId,
          Array.from(ctx.coaByCode.entries()).map(([code, id]) => ({
            code,
            id,
          })),
        )
        const accountIdByLineCode = new Map<string, string>()
        for (const spec of accountSpecs.values()) {
          const id = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: ctx.organizationId,
            code: spec.code,
            defaultName: spec.name,
            defaultAccountType: spec.accountType,
          })
          accountIdByLineCode.set(spec.code, id)
        }
        // `input.entityCode` is narrowed to non-null above (line 222
        // early-returns when null). Pin to a local for the closure so
        // TS doesn't lose the narrowing across the awaited upsert.
        const entityCode = input.entityCode ?? ""
        const resolvedRows: ImportBatchRow[] = rows.map((r) => {
          // Phase 2.1 session 3: row.category IS the raw line.code (no
          // entity prefix anymore — see row.push above).
          const accountId = accountIdByLineCode.get(r.category)
          if (!accountId) {
            throw new Error(
              `[PLF] accountId not resolved for lineCode="${r.category}" — upsert pass missed it`,
            )
          }
          return { ...r, accountId }
        })
        const result = await runImportBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB P&L ${input.entityCode} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          companyIds: [companyId],
          periodScope: buildPeriodScope(input.year),
          rows: resolvedRows,
          expectedSums,
          // NO purgeArchivedFirst (2026-06-24): keep the soft-archived prior
          // version as a restore/undo buffer (user wants "сможешь вернуть"). The
          // import soft-archives the replaced rows (deletedAt) instead of hard-
          // deleting, so a bad import is reversible. Pileup is harmless to reads
          // (deletedAt:null filter); prune old archives explicitly when confident.
        })
        // Capture the source's OWN EBITDA subtotal → `pl_ebitda` operational_facts
        // for EVERY year the sheet carries (not just `input.year`). The recompute
        // SUMS these per period for context.ebitda; deriving EBITDA from the lumped
        // `expense` leaves (D&A+interest+tax) collapses it to NET (2026-05-31 audit),
        // so the author's own EBITDA line is the truth. Capturing all years makes the
        // EBITDA history self-sufficient + survives single-year re-imports.
        //
        // Per-year delete is GATED on having parsed data (`monthly.length > 0`): a
        // year we cannot parse is left UNTOUCHED rather than deleted-then-not-
        // reinserted. That delete-without-reinsert was the 2026-06-03 footgun that
        // silently dropped EDEN/CPC/AZSF pl_ebitda while MALT survived.
        const ebitdaByYear = parsePlfEbitdaSubtotalAllYears(
          input.workbook,
          input.sheetName,
          input.XLSX,
        )
        for (const { year, monthly } of ebitdaByYear) {
          if (monthly.length === 0) continue
          // Clean-slate the WHOLE parsed year's pl_ebitda, then re-insert the
          // nonzero months. The delete is scoped to the year + company + metric
          // (the year comes from `ebitdaByYear`, parsed from THIS workbook —
          // derive-from-write at the year grain). organizationId is scoped for
          // cross-org defense-in-depth (companyId already implies the org).
          //
          // Codex review 2026-06-16: an earlier attempt narrowed the delete to
          // only the nonzero `monthly` dates — but `parsePlfEbitdaSubtotalAllYears`
          // OMITS zero/blank months, so a month that was nonzero in a prior
          // import and is zero in the new one would NOT be cleared, leaving a
          // stale fact that overcounts the year sum. Deleting the full year
          // fixes that while the per-year loop keeps it scoped to parsed years.
          const yearStart = new Date(Date.UTC(year, 0, 1))
          const yearEnd = new Date(Date.UTC(year + 1, 0, 1))
          // Footprint count — written SEPARATELY from the delete WHERE so a
          // future broadening of the delete trips the guard (non-circular).
          const ebitdaFootprint = await tx.operationalFact.count({
            where: {
              organizationId: ctx.organizationId,
              companyId,
              metric: "pl_ebitda",
              date: { gte: yearStart, lt: yearEnd },
            },
          })
          const ebitdaDeleted = await tx.operationalFact.deleteMany({
            where: {
              organizationId: ctx.organizationId,
              companyId,
              metric: "pl_ebitda",
              date: { gte: yearStart, lt: yearEnd },
            },
          })
          assertNoCollateralDeletion({
            table: "OperationalFact(pl_ebitda)",
            archivedCount: ebitdaDeleted.count,
            footprintLiveCount: ebitdaFootprint,
            footprint: `company=${companyId} year=${year}`,
          })
          await tx.operationalFact.createMany({
            data: monthly.map((x) => ({
              organizationId: ctx.organizationId,
              companyId,
              metric: "pl_ebitda",
              date: new Date(Date.UTC(year, x.month - 1, 1)),
              value: x.value,
              unit: "AZN",
              source: "import:plf-subtotal",
            })),
          })
        }
        return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// BS (Balance Sheet) handler
// ──────────────────────────────────────────────────────────────────────

export function makeBsHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      return {
        summary: `BS sheet "${input.sheetName}" has no entityCode — skipped`,
        itemCount: 0,
        warnings: [
          `Sheet "${input.sheetName}" classified BS but has no entityCode — likely cross-entity sheet`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
    const parsed = parseWorkbookBsSheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
      { preferYear: input.year },
    )
    const companyId = ctx.codeToId.get(input.entityCode)
    if (!companyId) {
      // Phase 11.11 (2026-07-29) — BS had NO guard here, unlike PLF above.
      // Rows were written with `companyId: null`, which degrades
      // bs-import-batch's company scope to `{}` and archives EVERY company's
      // balances on that plan for that year. `assertNoCollateralDeletion`
      // cannot catch it: `footprintLiveCount` is computed from the same
      // degenerate scope, so the check compares a wipe against itself.
      //
      // This BLOCKS rather than skipping (as PLF does): an unresolvable
      // entity on a balance sheet means the statement is going nowhere, and
      // silently importing zero balance-sheet rows after a reset reads as
      // "the balance sheet is empty" rather than "we could not place it".
      return {
        summary: `BS sheet "${input.sheetName}": company ${input.entityCode} not in DB`,
        itemCount: 0,
        warnings: [
          `Company "${input.entityCode}" not found in DB for BS sheet "${input.sheetName}"`,
        ],
        blocked: {
          reason:
            `balance-sheet sheet "${input.sheetName}" resolves to entity ` +
            `"${input.entityCode}", which does not exist in this organization. ` +
            `Writing it would attach the rows to no company and clean-slate ` +
            `every other company's balances for this plan and year.`,
        },
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    const rows: BsImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    // Phase 2.1 session 1 — per-line metadata so applyToDb can upsert
    // CoA rows once per unique line.code (BS codes share across entities,
    // so use raw code as the CoA key — org-wide).
    const accountSpecs = new Map<
      string,
      { code: string; name: string; accountType: string }
    >()
    // Phase 11.8b (2026-07-29) — the ORDINAL is part of the source-cell key.
    //
    // `sourceCell` was `#<sheet>!<code>@<period>`, i.e. keyed on the ACCOUNT
    // CODE. A workbook that lists the same code on several rows — measured on
    // production: PLF.07.02.04 appears up to three times in the 2025 PLF sheet
    // — produced one identical key for genuinely different rows. That made
    // `sourceDocument` unusable as a natural key and left BudgetLine with no
    // way to state "one row per source cell" in the database.
    let lineOrdinal = -1
    for (const line of parsed.lines) {
      lineOrdinal += 1
      if (!accountSpecs.has(line.code)) {
        accountSpecs.set(line.code, {
          code: line.code,
          name: line.label,
          // BS line types map to ChartOfAccount.accountType verbatim
          // (asset|liability|equity are all valid).
          accountType: line.lineType,
        })
      }
      for (const [period, amount] of Object.entries(line.monthlyAmounts)) {
        if (amount === 0) continue
        if (!period.startsWith(String(input.year))) continue
        const month = Number(period.split("-")[1])
        if (!Number.isFinite(month)) continue
        rows.push({
          planId: ctx.planId,
          companyId: companyId ?? null, // Phase 7.O — company scope for resolver queries
          accountCode: `${input.entityCode}-${line.code}`,
          // Placeholder — overwritten in applyToDb resolution map.
          accountId: "",
          lineType: line.lineType,
          subType: line.subType,
          year: input.year,
          month,
          amount,
          sourceCell: `multi-import#${input.sheetName}!${line.code}#${lineOrdinal}@${period}`,
        })
        const key = buildReconKey(
          ctx.planId,
          `${input.entityCode}-${line.code}`,
          period,
        )
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
      }
    }
    // ── Dynamic fallback: AZSEKER BS parser returned 0 lines on non-empty sheet ──
    if (rows.length === 0) {
      const sheet = input.workbook.Sheets[input.sheetName]
      const hasData = sheet && Object.keys(sheet).length > 1
      if (hasData) {
        logger.info("BS format unknown — delegating to dynamic detector", {
          sheetName: input.sheetName,
          entityCode: input.entityCode,
        })
        return runDynamicBsAdapter(input, ctx.planId, prisma, companyId ?? null)
      }
    }

    return {
      summary: `${parsed.lines.length} BS lines for ${input.entityCode}`,
      itemCount: rows.length,
      warnings: parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
      // Phase 8 D3 — `expectedSums` is an undocumented orchestrator
      // hook on AdapterRunResult; cast the empty branch to a typed
      // empty spread instead of `as any`.
      ...(rows.length > 0
        ? { expectedSums }
        : ({} as Record<string, never>)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Resolve CoA FK for every unique BS line code.
        const coaCache = createCoACache()
        preWarmCoACache(
          coaCache,
          ctx.organizationId,
          Array.from(ctx.coaByCode.entries()).map(([code, id]) => ({
            code,
            id,
          })),
        )
        const accountIdByLineCode = new Map<string, string>()
        for (const spec of accountSpecs.values()) {
          const id = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: ctx.organizationId,
            code: spec.code,
            defaultName: spec.name,
            defaultAccountType: spec.accountType,
          })
          accountIdByLineCode.set(spec.code, id)
        }
        const entityCode = input.entityCode ?? ""
        const resolvedRows: BsImportRow[] = rows.map((r) => {
          // Recover line.code from the entity-prefixed accountCode
          // (BS rows use `${entity}-${code}` for accountCode display).
          const lineCode = r.accountCode.startsWith(`${entityCode}-`)
            ? r.accountCode.slice(entityCode.length + 1)
            : r.accountCode
          const accountId = accountIdByLineCode.get(lineCode)
          if (!accountId) {
            throw new Error(
              `[BS] accountId not resolved for lineCode="${lineCode}"`,
            )
          }
          return { ...r, accountId }
        })
        const result = await runBalanceSheetBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB BS ${input.entityCode} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          planIds: [ctx.planId],
          periodScope: buildPeriodScope(input.year),
          rows: resolvedRows,
          expectedSums,
          // No purge — keep the soft-archived prior version as an undo buffer
          // (see PLF note 2026-06-24).
        })
        return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// CF (Cash Flow) handler
// ──────────────────────────────────────────────────────────────────────

export function makeCfHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      return {
        summary: `CF sheet "${input.sheetName}" has no entityCode — skipped`,
        itemCount: 0,
        warnings: [
          `Sheet "${input.sheetName}" classified CF but has no entityCode — likely cross-entity sheet`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
    const parsed = parsePlfCfSheet(
      input.workbook,
      input.sheetName,
      input.XLSX,
      { preferYear: input.year },
    )
    const rows: CfImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    // Phase 2.1 session 1 — per-entry metadata for CoA upsert in
    // applyToDb. CF codes (CF.XX.XX) are org-wide; CashFlowEntry rows
    // don't carry asset/liability semantics in the same way as BS, so
    // CoA accountType defaults to "expense" for outflows and "revenue"
    // for inflows (admin can reclassify later).
    const accountSpecs = new Map<
      string,
      { code: string; name: string; accountType: string }
    >()
    for (const entry of parsed.entries) {
      if (!accountSpecs.has(entry.code)) {
        accountSpecs.set(entry.code, {
          code: entry.code,
          name: entry.label,
          accountType: entry.entryType === "inflow" ? "revenue" : "expense",
        })
      }
      for (let m = 0; m < 12; m++) {
        // 2026-06-02 fix: perMonth is now SIGNED. Derive the per-MONTH
        // direction from its sign — a positive month in an outflow line
        // (refund/reversal) is booked as an inflow so it nets correctly,
        // and vice-versa. amount stays a positive magnitude (the cash-flow
        // page nets inflows − outflows on magnitudes).
        const signed = entry.perMonth[m]
        if (signed === null) continue
        // Preserve explicit zero bridge evidence (absent !== zero), while
        // retaining the established sparse behavior for ordinary movements.
        if (signed === 0 && !isCashFlowBridgeActivity(entry.activityType)) {
          continue
        }
        const entryType: typeof entry.entryType = signed >= 0 ? "inflow" : "outflow"
        const amount = Math.abs(signed)
        const period = `${input.year}-${String(m + 1).padStart(2, "0")}`
        const sourceId = `${input.entityCode}::${entry.code}`
        rows.push({
          entityCode: input.entityCode,
          cfCode: entry.code,
          category: `${input.entityCode}-${entry.code}`,
          // Placeholder — overwritten in applyToDb resolution map.
          accountId: "",
          activityType: entry.activityType,
          entryType,
          year: input.year,
          month: m + 1,
          amount,
          currencyCode: "AZN",
          description: entry.label,
          source: CF_SOURCE_TAG,
          sourceId,
        })
        const key = buildReconKey(CF_SOURCE_TAG, sourceId, period)
        // Reconciliation is per-cell MAGNITUDE: CF stores abs(amount) and the
        // batch read-back sums abs, so expectedSums must be abs too. (Summing
        // the SIGNED value here would false-flag refund months — a positive
        // value in an outflow line — as a 2× drift → RED. There is exactly one
        // CF row per (entity, cfCode, month), so no netting is lost.)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
      }
    }
    const hasBridgeRows = rows.some((row) =>
      isCashFlowBridgeActivity(row.activityType),
    )
    const hasMovementRows = rows.some((row) =>
      isCashFlowMovementActivity(row.activityType),
    )
    if (hasBridgeRows && !hasMovementRows) {
      return {
        summary: `CF sheet "${input.sheetName}" contains bridge evidence without cash movements — blocked`,
        itemCount: 0,
        warnings: [
          ...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
          `CF.04–CF.07 cannot be applied as a bridge-only batch because the entity/year reset would archive the complete cash flow. Upload one complete CF sheet containing CF.01–CF.03 and bridge rows together.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }
    // ── Dynamic fallback: AZSEKER CF parser returned 0 entries on non-empty sheet ──
    if (rows.length === 0) {
      const sheet = input.workbook.Sheets[input.sheetName]
      const hasData = sheet && Object.keys(sheet).length > 1
      if (hasData) {
        logger.info("CF format unknown — delegating to dynamic detector", {
          sheetName: input.sheetName,
          entityCode: input.entityCode,
        })
        return runDynamicCfAdapter(input, prisma)
      }
    }

    return {
      summary: `${parsed.entries.length} CF entries for ${input.entityCode}`,
      itemCount: rows.length,
      warnings: parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`),
      // Phase 8 D3 — `expectedSums` is an undocumented orchestrator
      // hook on AdapterRunResult; cast the empty branch to a typed
      // empty spread instead of `as any`.
      ...(rows.length > 0
        ? { expectedSums }
        : ({} as Record<string, never>)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        const coaCache = createCoACache()
        preWarmCoACache(
          coaCache,
          ctx.organizationId,
          Array.from(ctx.coaByCode.entries()).map(([code, id]) => ({
            code,
            id,
          })),
        )
        const accountIdByCfCode = new Map<string, string>()
        for (const spec of accountSpecs.values()) {
          const id = await resolveOrCreateAccountId(tx, coaCache, {
            organizationId: ctx.organizationId,
            code: spec.code,
            defaultName: spec.name,
            defaultAccountType: spec.accountType,
          })
          accountIdByCfCode.set(spec.code, id)
        }
        const resolvedRows: CfImportRow[] = rows.map((r) => {
          const accountId = accountIdByCfCode.get(r.cfCode)
          if (!accountId) {
            throw new Error(
              `[CF] accountId not resolved for cfCode="${r.cfCode}"`,
            )
          }
          return { ...r, accountId }
        })
        const result = await runCashFlowBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB CF ${input.entityCode} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          sourceTag: CF_SOURCE_TAG,
          periodScope: buildPeriodScope(input.year),
          rows: resolvedRows,
          expectedSums,
          // No purge — keep the soft-archived prior version as an undo buffer
          // (see PLF note 2026-06-24).
        })
        return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// KPI handler — covers KPI_FARMING / KPI_PROCESSING / SALES
// ──────────────────────────────────────────────────────────────────────

export function makeKpiHandler(
  prisma: PrismaClient,
  ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
  kind: "farming" | "processing" | "sales",
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    // Y5b: resolve via ensureCtx() (per-(org,year,kind) cache) — do NOT
    // short-circuit on the shared ctxRef, which holds only the
    // first-resolved kind and would mis-route later sheets of the other
    // kind (budget rows → actuals plan, or vice-versa).
    const ctx = await ensureCtx()
    const rows: KpiImportRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    const warnings: string[] = []

    if (kind === "farming") {
      const parsed = parseWorkbookFarmingKpiSheet(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input.workbook,
        input.sheetName,
        input.XLSX,
        { preferYear: input.year },
      )
      warnings.push(...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`))
      for (const fact of parsed.facts) {
        const companyId = ctx.codeToId.get(fact.companyCode)
        if (!companyId) continue
        if (!fact.date.startsWith(String(input.year))) continue
        rows.push({
          companyId,
          metric: fact.metric,
          date: fact.date,
          value: fact.value,
          unit: fact.unit || null,
          source: "xlsx_multi_import",
        })
        const key = buildReconKey(companyId, fact.metric, fact.date)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + fact.value)
      }
    } else if (kind === "processing") {
      const parsed = parseWorkbookProcessingKpiSheet(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input.workbook,
        input.sheetName,
        input.XLSX,
        { preferYear: input.year },
      )
      warnings.push(...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`))
      for (const fact of parsed.facts) {
        const companyId = ctx.codeToId.get(fact.companyCode)
        if (!companyId) continue
        if (!fact.date.startsWith(String(input.year))) continue
        rows.push({
          companyId,
          metric: fact.metric,
          date: fact.date,
          value: fact.value,
          unit: fact.unit || null,
          source: "xlsx_multi_import",
        })
        const key = buildReconKey(companyId, fact.metric, fact.date)
        expectedSums.set(key, (expectedSums.get(key) ?? 0) + fact.value)
      }
    } else if (kind === "sales") {
      // Sales sheet routing follows Azik's confirm 2026-05-19:
      //   Farming sales → AZSEKER-EDEN
      //   Production sales → AZSEKER-CPC
      //   ProMalt sales → AZSEKER-PROMALT
      //   "Sales plan" (forward-forecast per-product volumes 2027-2035)
      //                → AZSEKER-CPC, metric=sales_volume_<slug>,
      //                  date=`<year>-12-31` (Phase 7.M Tier 6)
      // We detect which sales parser to invoke based on sheet name.
      const sheetLower = input.sheetName.toLowerCase()
      // Phase 11.33 — an entity the CLASSIFIER resolved wins over the
      // AzerSheker sheet-name routing below. That routing encodes one client's
      // org chart (farming→EDEN, production→CPC), so for any other org every
      // branch missed and the sheet was skipped with a warning. The sheet
      // SHAPE parsers below are still AzerSheker-specific — this only fixes
      // where their output is written, which is the part that was guessable.
      const classifiedId = input.entityCode
        ? ctx.codeToId.get(input.entityCode)
        : undefined
      if (input.entityCode && !classifiedId) {
        warnings.push(
          `SALES sheet "${input.sheetName}": classifier resolved entity ` +
            `"${input.entityCode}", which is not a company in this organization`,
        )
      }
      const edenId = classifiedId ?? ctx.codeToId.get("AZSEKER-EDEN")
      const cpcId = classifiedId ?? ctx.codeToId.get("AZSEKER-CPC")
      const promaltId = classifiedId ?? ctx.codeToId.get("AZSEKER-PROMALT")

      // Phase 7.M Tier 6 — "Sales plan" sheet from Farming strategy.xlsx.
      // Branched FIRST so it doesn't fall through to the generic
      // production-sales parser (which would mis-parse the year-column
      // layout).
      if (sheetLower === "sales plan" || sheetLower.startsWith("sales plan")) {
        if (!cpcId) {
          warnings.push(
            `Sales plan sheet "${input.sheetName}": AZSEKER-CPC not in DB — skipped`,
          )
        } else {
          const salesPlan = parseSalesPlanSheet(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input.workbook,
            input.sheetName,
            input.XLSX,
          )
          warnings.push(...salesPlan.warnings)
          for (const fact of salesPlan.facts) {
            const metric = `sales_volume_${fact.productSlug}${
              fact.location ? `_${fact.location.toLowerCase()}` : ""
            }`
            const date = `${fact.year}-12-31`
            rows.push({
              companyId: cpcId,
              metric,
              date,
              value: fact.volumeTons,
              unit: "tons",
              source: "xlsx_multi_import",
            })
            const key = buildReconKey(cpcId, metric, date)
            expectedSums.set(
              key,
              (expectedSums.get(key) ?? 0) + fact.volumeTons,
            )
          }
        }
        // Skip the rest of the sales routing — Sales plan is its own
        // shape; no other parser should run on the same sheet.
        return {
          summary: `${rows.length} sales-plan product-year facts`,
          itemCount: rows.length,
          warnings,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(rows.length > 0
            ? { expectedSums }
            : ({} as Record<string, never>)),
          applyToDb: async (tx: Prisma.TransactionClient) => {
            if (rows.length === 0) return { rowsInserted: 0 }
            const touchedCompanyIds = Array.from(
              new Set(rows.map((r) => r.companyId)),
            )
            // dateScope spans every year present in the rows so the
            // reset filter doesn't accidentally clobber unrelated
            // sales_volume_* rows from prior imports.
            const years = Array.from(
              new Set(rows.map((r) => r.date.slice(0, 4))),
            )
            const result = await runKpiBatch(tx, {
              organizationId: ctx.organizationId,
              label: `WB Sales plan ${input.sheetName}`,
              actorUserId: "ai-multi-import",
              sourceDocument: `multi-import:${input.sheetName}`,
              companyIds: touchedCompanyIds,
              dateScope: years,
              rows,
              expectedSums,
            })
            return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
          },
        } as AdapterRunResult & {
          expectedSums?: Map<ReconciliationKey, number>
        }
      }
      let parsed:
        | ReturnType<typeof parseFarmingSalesSheet>
        | ReturnType<typeof parseProductionSalesSheet>
        | ReturnType<typeof parseProMaltSalesSheet>
        | null = null
      let salesCompanyId: string | undefined
      if (sheetLower.includes("farming") && edenId) {
        salesCompanyId = edenId
        parsed = parseFarmingSalesSheet(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.workbook,
          input.sheetName,
          input.XLSX,
          { preferYear: input.year, companyId: edenId },
        )
      } else if (sheetLower.includes("production") && cpcId) {
        salesCompanyId = cpcId
        parsed = parseProductionSalesSheet(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.workbook,
          input.sheetName,
          input.XLSX,
          { preferYear: input.year, companyId: cpcId },
        )
      } else if (
        (sheetLower.includes("promalt") || sheetLower.includes("satış promalt")) &&
        promaltId
      ) {
        salesCompanyId = promaltId
        parsed = parseProMaltSalesSheet(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input.workbook,
          input.sheetName,
          input.XLSX,
          { preferYear: input.year, companyId: promaltId },
        )
      } else {
        warnings.push(
          `SALES sheet "${input.sheetName}" — could not infer target company from sheet name; skipped`,
        )
      }
      if (parsed && salesCompanyId) {
        warnings.push(...parsed.warnings.map((w) => `row ${w.row}: ${w.reason}`))
        for (const fact of parsed.facts) {
          rows.push({
            companyId: salesCompanyId,
            metric: fact.metric,
            date: fact.date,
            value: fact.value,
            unit: fact.unit,
            source: "xlsx_multi_import",
          })
        }
        for (const [k, v] of parsed.expectedSums) {
          expectedSums.set(k, (expectedSums.get(k) ?? 0) + v)
        }
      }
    }

    return {
      summary: `${rows.length} ${kind} KPI facts`,
      itemCount: rows.length,
      warnings,
      // Phase 8 D3 — `expectedSums` is an undocumented orchestrator
      // hook on AdapterRunResult; cast the empty branch to a typed
      // empty spread instead of `as any`.
      ...(rows.length > 0
        ? { expectedSums }
        : ({} as Record<string, never>)),
      applyToDb: async (tx: Prisma.TransactionClient) => {
        if (rows.length === 0) return { rowsInserted: 0 }
        // Per-sheet KPI batch — scoped to the touched companies only
        // (so dateScope cleanup doesn't clobber other sheets' facts).
        const touchedCompanyIds = Array.from(new Set(rows.map((r) => r.companyId)))
        const result = await runKpiBatch(tx, {
          organizationId: ctx.organizationId,
          label: `WB ${kind.toUpperCase()} ${input.sheetName} ${input.year}`,
          actorUserId: "ai-multi-import",
          sourceDocument: `multi-import:${input.sheetName}`,
          companyIds: touchedCompanyIds,
          dateScope: [String(input.year)],
          rows,
          expectedSums,
        })
        return {
          rowsInserted: result.metrics.rowsInserted,
          // Phase 11.2 — surface the batch layer's post-write DB re-read.
          reconciliation: result.reconciliation,
        }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}

// ──────────────────────────────────────────────────────────────────────
// LAND_REGISTRY handler — writes Company.settings via tx
// ──────────────────────────────────────────────────────────────────────
