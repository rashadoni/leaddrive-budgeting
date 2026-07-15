/**
 * SALES_PRODUCTS adapter (2026-07-15) — routes a product-sales sheet
 * (volume + price + revenue per product × month) into `SalesBudgetLine`,
 * which is what the budgeting Sales tab reads. Until this shipped, nothing
 * wrote that table and the page's Qty/Price columns were always 0.
 *
 * Entity attribution is NOT decided here: the handler consumes
 * `input.entityCode` (classifier / org alias map / guided fix) and skips with
 * an actionable warning when it's absent. A sales parser guessing its own
 * target company is exactly the org-specific hardcode the legacy SALES
 * handler carries (`sheetName.includes("farming") → AZSEKER-EDEN`) — this one
 * works for any org.
 *
 * Plan kind (budget vs actual) likewise arrives via `targetPlanKind`, resolved
 * deterministically from the sheet name / section by `resolveSheetRouting`
 * ("… Budget 2026" → budget, "Satış … Fakt" → actual).
 */
import type { Prisma, PrismaClient } from "@prisma/client"
import type { AdapterHandler, AdapterRunInput, AdapterRunResult } from "./adapter-registry"
import type { OrgContext } from "./prod-adapter-context"
import { parseProductSalesSheet, parseSalesCustomers } from "./product-sales-parser"
import { runSalesProductBatch } from "../sales-product-import-batch"
import type { ReconciliationKey } from "../reconciliation"

/** Reconciliation key: entity + plan-kind + product + measure + period.
 *  Plan kind is part of the key so a budget sheet and an actuals sheet for the
 *  same product-month are NOT seen as a cross-file conflict. */
function buildKey(
  entityCode: string,
  planKind: string,
  productCode: string,
  measure: "quantity" | "amount",
  year: number,
  month: number,
): ReconciliationKey {
  return `${entityCode}::sales:${planKind}:${productCode}:${measure}::${year}-${String(month).padStart(2, "0")}` as ReconciliationKey
}

export function makeProductSalesHandler(
  _prisma: PrismaClient,
  _ctxRef: { value: OrgContext | null },
  ensureCtx: () => Promise<OrgContext>,
): AdapterHandler {
  return async (input: AdapterRunInput): Promise<AdapterRunResult> => {
    if (!input.entityCode) {
      return {
        summary: `Sales sheet "${input.sheetName}" has no entity — skipped`,
        itemCount: 0,
        warnings: [
          `Sales sheet "${input.sheetName}" could not be attributed to a company. Add an entity alias for this org (Settings → entity aliases) or pin the sheet's company in the import review, then re-run.`,
        ],
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }

    const parsed = parseProductSalesSheet(input.workbook, input.sheetName, input.XLSX, {
      entityCode: input.entityCode,
      year: input.year,
    })
    if (parsed.shape === null || parsed.rows.length === 0) {
      return {
        summary: `Sales sheet "${input.sheetName}": nothing to import for ${input.year}`,
        itemCount: 0,
        warnings: parsed.warnings,
        applyToDb: async () => ({ rowsInserted: 0 }),
      }
    }

    const planKind = input.targetPlanKind ?? "actual"
    const expectedSums = new Map<ReconciliationKey, number>()
    for (const r of parsed.rows) {
      expectedSums.set(
        buildKey(input.entityCode, planKind, r.identity.code, "quantity", r.year, r.month),
        r.quantity,
      )
      expectedSums.set(
        buildKey(input.entityCode, planKind, r.identity.code, "amount", r.year, r.month),
        r.amount,
      )
    }

    const products = new Set(parsed.rows.map((r) => r.identity.code)).size
    const revenue = parsed.rows.reduce((s, r) => s + r.amount, 0)

    // Customer concentration — derived from the SAME transactional rows.
    // The client's "Müştəri İcmalı" tab is a pre-computed summary the
    // counterparty-register parser can't read, but every fakt row names its
    // customer, so CUSTOMER_HHI / TOP_CUSTOMER_SHARE / TOP3_CUSTOMER_SHARE
    // are derivable from the source of record. Budget grids have no customer
    // dimension, so this only ever fires on the transactional shape.
    const customers =
      parsed.shape === "transactions"
        ? parseSalesCustomers(input.workbook, input.sheetName, input.XLSX, {
            year: input.year,
          })
        : { rows: [], warnings: [] }
    const warnings = [...parsed.warnings, ...customers.warnings]
    if (customers.rows.length > 0) {
      warnings.push(
        `Sheet "${input.sheetName}": ${customers.rows.length} customers derived for ${input.entityCode} — top customer ${customers.rows[0].sharePct.toFixed(1)}% of ${input.year} turnover`,
      )
    }

    return {
      summary: `${parsed.rows.length} product-month sales rows (${products} products, ${(revenue / 1e6).toFixed(2)}M net) for ${input.entityCode} [${planKind}]${customers.rows.length > 0 ? ` + ${customers.rows.length} customers` : ""}`,
      itemCount: parsed.rows.length,
      warnings,
      expectedSums,
      applyToDb: async (tx: Prisma.TransactionClient) => {
        const ctx = await ensureCtx()
        const result = await runSalesProductBatch(tx, {
          organizationId: ctx.organizationId,
          planId: ctx.planId,
          year: input.year,
          rows: parsed.rows,
          unit: "ton",
        })

        // Counterparty snapshot — ACTUALS only: concentration is a realized
        // fact, and writing a budget's customer split would overwrite it.
        const companyId = ctx.codeToId.get(input.entityCode!)
        if (customers.rows.length > 0 && planKind === "actual" && companyId) {
          const period = String(input.year)
          // Replace THIS company+role+period only. Hard delete (not archive):
          // @@unique(companyId, role, name, period) would collide with a
          // re-inserted same-named row. Mirrors the register handler.
          await tx.counterparty.deleteMany({
            where: {
              organizationId: ctx.organizationId,
              companyId,
              role: "customer",
              period,
            },
          })
          await tx.counterparty.createMany({
            data: customers.rows.map((c) => ({
              organizationId: ctx.organizationId,
              companyId,
              role: "customer",
              name: c.name,
              sharePct: c.sharePct,
              annualAmount: c.amount,
              period,
            })),
          })
        }
        return { rowsInserted: result.metrics.rowsInserted }
      },
    } as AdapterRunResult & { expectedSums?: Map<ReconciliationKey, number> }
  }
}
