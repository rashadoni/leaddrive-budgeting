/**
 * apply-multi KPI + BS sheet dispatchers — extracted from route.ts (Phase 8
 * D1 2026-05-29) to bring the multi-sheet apply handler under the 1000-LOC
 * line. Each scans every workbook sheet for its family, writes the matching
 * rows in its own transaction (failures non-fatal — budget data committed by
 * the handler is untouched), and returns its per-sheet results + the set of
 * touched companyIds (the handler flips their status pending→active). Bodies
 * are verbatim from the handler; inputs are now explicit args.
 */
import * as XLSXNS from "xlsx"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getLogger } from "@/lib/log"
import {
  classifyWorkbookSheetFamily,
  resolveEntityFromSheetName,
} from "@/lib/onboarding/azseker-workbook-mapping"
import {
  parseWorkbookFarmingKpiSheet,
  parseWorkbookProcessingKpiSheet,
} from "@/lib/onboarding/adapters/azseker-workbook-kpi"
import { parseWorkbookBsSheet } from "@/lib/onboarding/adapters/azseker-workbook-bs"

const kpiLog = getLogger("api:apply-multi:kpi")
const bsLog = getLogger("api:apply-multi:bs")

interface DispatcherArgs {
  workbook: XLSXNS.WorkBook
  XLSX: typeof XLSXNS
  targetYear: number
  orgIdLocal: string
}

export interface KpiPerSheetResult {
    sheetName: string
    family: "KPI_FARMING" | "KPI_PROCESSING"
    factsInserted: number
    entitiesTouched: string[]
    warnings: number
    error?: string
  }

export interface BsPerSheetResult {
    sheetName: string
    companyCode: string | null
    rowsInserted: number
    leavesTouched: number
    warnings: number
    error?: string
  }

export async function runKpiDispatcher({
  workbook,
  XLSX,
  targetYear,
  orgIdLocal,
}: DispatcherArgs): Promise<{ kpiResults: KpiPerSheetResult[]; kpiTouchedCompanyIds: Set<string> }> {
  const kpiResults: KpiPerSheetResult[] = []
  const kpiTouchedCompanyIds = new Set<string>()
  try {
    for (const sheetName of workbook.SheetNames) {
      const family = classifyWorkbookSheetFamily(sheetName)
      if (family !== "KPI_FARMING" && family !== "KPI_PROCESSING") continue

      const parsed =
        family === "KPI_FARMING"
          ? parseWorkbookFarmingKpiSheet(workbook, sheetName, XLSX, { preferYear: targetYear })
          : parseWorkbookProcessingKpiSheet(workbook, sheetName, XLSX, { preferYear: targetYear })
      if (parsed.facts.length === 0) {
        kpiResults.push({
          sheetName,
          family,
          factsInserted: 0,
          entitiesTouched: [],
          warnings: parsed.warnings.length,
        })
        continue
      }

      // Resolve all company codes mentioned in the facts to ids.
      const codes = Array.from(new Set(parsed.facts.map((f) => f.companyCode)))
      const companies = await prisma.company.findMany({
        where: { organizationId: orgIdLocal, code: { in: codes } },
        select: { id: true, code: true, status: true },
      })
      const idByCode = new Map<string, string>()
      for (const c of companies) idByCode.set(c.code, c.id)
      const unresolvedCodes = codes.filter((c) => !idByCode.has(c))
      if (unresolvedCodes.length > 0) {
        kpiLog.warn("entities not in DB — skipping", {
          sheetName,
          unresolvedCount: unresolvedCodes.length,
          unresolvedCodes,
        })
      }
      const resolvedFacts = parsed.facts.filter((f) => idByCode.has(f.companyCode))

      // Idempotent delete-then-insert per (companyId × metric × date).
      // Same-sheet re-applies must produce identical state.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const code of codes) {
          const companyIdResolved = idByCode.get(code)
          if (!companyIdResolved) continue
          kpiTouchedCompanyIds.add(companyIdResolved)
          const metricsForThisCompany = Array.from(
            new Set(resolvedFacts.filter((f) => f.companyCode === code).map((f) => f.metric)),
          )
          if (metricsForThisCompany.length === 0) continue
          // Per-(company × metric × date) idempotency: delete same-sheet
          // facts then re-insert. Only narrow the date window to what
          // this sheet emits to avoid touching unrelated entries.
          const datesForThisCompany = Array.from(
            new Set(
              resolvedFacts
                .filter((f) => f.companyCode === code)
                .map((f) => f.date),
            ),
          ).map((d) => new Date(d))
          await tx.operationalFact.deleteMany({
            where: {
              organizationId: orgIdLocal,
              companyId: companyIdResolved,
              metric: { in: metricsForThisCompany },
              date: { in: datesForThisCompany },
              source: "xlsx_import",
            },
          })
        }
        const rows: Array<{
          organizationId: string
          companyId: string
          metric: string
          date: Date
          value: number
          unit: string
          source: string
        }> = []
        for (const fact of resolvedFacts) {
          const companyIdResolved = idByCode.get(fact.companyCode)
          if (!companyIdResolved) continue
          rows.push({
            organizationId: orgIdLocal,
            companyId: companyIdResolved,
            metric: fact.metric,
            date: new Date(fact.date),
            value: fact.value,
            unit: fact.unit,
            source: "xlsx_import",
          })
        }
        if (rows.length > 0) await tx.operationalFact.createMany({ data: rows })
      })

      const entitiesTouched = Array.from(
        new Set(resolvedFacts.map((f) => f.companyCode)),
      )
      kpiResults.push({
        sheetName,
        family,
        factsInserted: resolvedFacts.length,
        entitiesTouched,
        warnings: parsed.warnings.length,
      })
    }
  } catch (err) {
    // KPI dispatch failure is non-fatal — budget data is already
    // committed. Log + surface in response so the user knows the agro
    // indicators won't have data this round.
    kpiLog.error("dispatcher failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    kpiResults.push({
      sheetName: "<dispatcher>",
      family: "KPI_FARMING",
      factsInserted: 0,
      entitiesTouched: [],
      warnings: 0,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { kpiResults, kpiTouchedCompanyIds }
}

export async function runBsDispatcher({
  workbook,
  XLSX,
  targetYear,
  orgIdLocal,
}: DispatcherArgs): Promise<{ bsResults: BsPerSheetResult[]; bsTouchedCompanyIds: Set<string> }> {
  const bsResults: BsPerSheetResult[] = []
  const bsTouchedCompanyIds = new Set<string>()
  try {
    // Ensure the BalanceSheetLine plan exists. Reuse the same
    // AI-Imported plan id created by the BudgetLine transaction
    // above; if it doesn't exist yet (all-error path that the
    // Workbook rescue happened to miss) create a "BS-Imported" plan.
    const planName = `AI-Imported ${targetYear} Budget`
    let bsPlanId: string | null = null
    for (const sheetName of workbook.SheetNames) {
      const family = classifyWorkbookSheetFamily(sheetName)
      if (family !== "BS") continue

      const entityCode = resolveEntityFromSheetName(sheetName)
      if (!entityCode) {
        bsResults.push({
          sheetName,
          companyCode: null,
          rowsInserted: 0,
          leavesTouched: 0,
          warnings: 1,
          error: `Cannot resolve entity from sheet name "${sheetName}"`,
        })
        continue
      }
      const company = await prisma.company.findFirst({
        where: { organizationId: orgIdLocal, code: entityCode },
        select: { id: true, baseCurrencyCode: true },
      })
      if (!company) {
        bsResults.push({
          sheetName,
          companyCode: entityCode,
          rowsInserted: 0,
          leavesTouched: 0,
          warnings: 1,
          error: `Company ${entityCode} not in DB`,
        })
        continue
      }

      const parsed = parseWorkbookBsSheet(workbook, sheetName, XLSX, { preferYear: targetYear })
      if (parsed.lines.length === 0) {
        bsResults.push({
          sheetName,
          companyCode: entityCode,
          rowsInserted: 0,
          leavesTouched: 0,
          warnings: parsed.warnings.length,
        })
        continue
      }

      if (!bsPlanId) {
        const existing = await prisma.budgetPlan.findFirst({
          where: { organizationId: orgIdLocal, year: targetYear, name: planName, deletedAt: null },
          select: { id: true },
        })
        if (existing) bsPlanId = existing.id
        else {
          const created = await prisma.budgetPlan.create({
            data: {
              organizationId: orgIdLocal,
              name: planName,
              year: targetYear,
              periodType: "yearly",
              status: "active",
            },
            select: { id: true },
          })
          bsPlanId = created.id
        }
      }

      let rowsInserted = 0
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Idempotent: delete same (planId × accountCode × year ×
        // month) rows for this entity then re-insert.
        const codesInSheet = parsed.lines.map((l) => l.code)
        const monthsInSheet = Array.from(
          new Set(
            parsed.lines.flatMap((l) => Object.keys(l.monthlyAmounts)),
          ),
        ).map((k) => Number(k.split("-")[1]))
        // Per-company clean-slate (Codex re-review 2026-06-20): scope by
        // companyId — `accountCode` was dropped from BalanceSheetLine (Phase
        // 2.1), and the previous code-scoped delete also left rows unscoped to
        // a company. Clear THIS company's BS rows for the sheet's months, then
        // re-insert. `codesInSheet` retained only for the warning/leaf count.
        void codesInSheet;
        await tx.balanceSheetLine.deleteMany({
          where: {
            organizationId: orgIdLocal,
            planId: bsPlanId!,
            companyId: company.id,
            year: targetYear,
            month: { in: monthsInSheet },
          },
        })
        // Ensure CoA entries exist for each BS code (prefixed by
        // entity to avoid cross-entity overwrite, same pattern as
        // PLF import).
        const coaCache = new Map<string, string>()
        const rows: Array<{
          organizationId: string
          planId: string
          companyId: string
          accountId: string
          lineType: string
          subType: string | null
          year: number
          month: number
          amount: number
        }> = []
        for (const line of parsed.lines) {
          const codeKey = `${entityCode}-${line.code}`
          let coaId: string | null = coaCache.get(codeKey) ?? null
          if (!coaId) {
            const existingCoa = await tx.chartOfAccount.findUnique({
              where: { organizationId_code: { organizationId: orgIdLocal, code: codeKey } },
              select: { id: true },
            })
            if (existingCoa) coaId = existingCoa.id
            else {
              const created = await tx.chartOfAccount.create({
                data: {
                  organizationId: orgIdLocal,
                  code: codeKey,
                  name: line.label || line.code,
                  nameEn: line.label || line.code,
                  accountType: line.lineType,
                  sortOrder: 0,
                  isActive: true,
                },
                select: { id: true },
              })
              coaId = created.id
            }
            coaCache.set(codeKey, coaId)
          }
          if (!coaId) throw new Error(`Internal: coaId not resolved for BS code ${codeKey}`)
          for (const [periodKey, amount] of Object.entries(line.monthlyAmounts)) {
            const [yStr, mStr] = periodKey.split("-")
            rows.push({
              organizationId: orgIdLocal,
              planId: bsPlanId!,
              companyId: company.id,
              accountId: coaId,
              lineType: line.lineType,
              subType: line.subType,
              year: Number(yStr),
              month: Number(mStr),
              amount,
            })
          }
        }
        if (rows.length > 0) await tx.balanceSheetLine.createMany({ data: rows })
        rowsInserted = rows.length
      })

      bsResults.push({
        sheetName,
        companyCode: entityCode,
        rowsInserted,
        leavesTouched: parsed.lines.length,
        warnings: parsed.warnings.length,
      })
      bsTouchedCompanyIds.add(company.id)
    }
  } catch (err) {
    bsLog.error("dispatcher failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    bsResults.push({
      sheetName: "<dispatcher>",
      companyCode: null,
      rowsInserted: 0,
      leavesTouched: 0,
      warnings: 0,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return { bsResults, bsTouchedCompanyIds }
}
