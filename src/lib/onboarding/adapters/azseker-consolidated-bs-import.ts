/**
 * Importer for the AzerSheker consolidated `BS` tab → the holding entity's
 * own BalanceSheetLines (2026-06-23). Pure parsing + the money guard live in
 * ./azseker-consolidated-bs; this module is the DB side.
 *
 * It reuses `runBalanceSheetBatch` (the verified-clean BS write path) with
 * `companyId = holding`, so a re-import soft-archives ONLY the holding's prior
 * consolidated lines (companyId-scoped reset) and never the children's
 * standalone lines — the opposite of the CashFlowEntry double-layer bug (that
 * table has no companyId). Each consolidated leaf gets a dedicated
 * `CONS.BS.*` ChartOfAccount (verbatim official label) so it never fuzzy-maps
 * onto the inconsistent per-entity chart of accounts.
 */
import type { PrismaClient } from "@prisma/client"
import {
  runBalanceSheetBatch,
  type BsImportRow,
  type BsImportPlan,
  type BsImportResult,
} from "../bs-import-batch"
import { buildReconKey, type ReconciliationKey } from "../reconciliation"
import {
  parseConsolidatedBs,
  consolidatedAccountCode,
  type BsSection,
} from "./azseker-consolidated-bs"

const SECTION_TO_LINETYPE: Record<BsSection, string> = {
  asset: "asset",
  equity: "equity",
  liability: "liability",
}

export interface ConsolidatedBsImportInput {
  /** The `BS` worksheet as array-of-arrays (raw values). */
  worksheetRows: ReadonlyArray<ReadonlyArray<unknown>>
  organizationId: string
  /** Code of the level-1 holding company (e.g. "AZSEKER"). */
  holdingCompanyCode: string
  actorUserId: string
  sourceDocument?: string
}

export interface ConsolidatedBsImportResult {
  holdingCompanyId: string
  months: string[]
  /** Per-year actuals plan the holding lines were written to. */
  planIdByYear: Record<number, string>
  warnings: string[]
  batches: BsImportResult[]
}

const pad2 = (n: number) => String(n).padStart(2, "0")

export async function importConsolidatedHoldingBs(
  prisma: PrismaClient,
  input: ConsolidatedBsImportInput,
): Promise<ConsolidatedBsImportResult> {
  const {
    worksheetRows,
    organizationId,
    holdingCompanyCode,
    actorUserId,
    sourceDocument = "Reporting 2026.xlsx#BS",
  } = input

  // 1. Parse + money guard (throws if Σ leaves ≠ official subtotal cells).
  const parsed = parseConsolidatedBs(worksheetRows)
  const warnings: string[] = []
  // Phase 11.18 — the parser's scale-plausibility notes must reach the import
  // report, not die inside the parser. A wrong thousands→manat factor moves
  // the whole balance sheet by three orders of magnitude while every internal
  // cross-foot still ties, so this is the ONLY signal that it happened.
  for (const w of parsed.scaleWarnings) warnings.push(`SCALE: ${w}`)

  // 2. Resolve the holding company.
  const holding = await prisma.company.findFirst({
    where: { organizationId, code: holdingCompanyCode },
    select: { id: true, level: true },
  })
  if (!holding) throw new Error(`holding company "${holdingCompanyCode}" not found`)
  if (holding.level !== 1) {
    warnings.push(`holding "${holdingCompanyCode}" is level ${holding.level}, expected 1`)
  }

  // 3. Upsert a dedicated CONS.BS.* account per leaf label (verbatim, no fuzzy map).
  const accountIdByLabel = new Map<string, string>()
  const codeToLabel = new Map<string, string>()
  for (const leaf of parsed.leaves) {
    if (accountIdByLabel.has(leaf.label)) continue
    const code = consolidatedAccountCode(leaf.label)
    // Two distinct official labels must never collapse to one account code —
    // that would merge their balances under a single display name.
    const prior = codeToLabel.get(code)
    if (prior != null && prior !== leaf.label) {
      throw new Error(
        `consolidated BS: account-code collision "${code}" between "${prior}" and "${leaf.label}"`,
      )
    }
    codeToLabel.set(code, leaf.label)
    // Race-safe upsert on the (organizationId, code) unique — concurrent
    // imports won't trip a unique-constraint error (findFirst+create would).
    const account = await prisma.chartOfAccount.upsert({
      where: { organizationId_code: { organizationId, code } },
      create: { organizationId, code, name: leaf.label, accountType: leaf.section },
      update: { name: leaf.label, accountType: leaf.section },
      select: { id: true },
    })
    accountIdByLabel.set(leaf.label, account.id)
  }

  // 4. Resolve the actuals plan per published year (skip "superseded").
  const years = [...new Set(parsed.months.map((m) => Number(m.slice(0, 4))))]
  const planIdByYear: Record<number, string> = {}
  for (const year of years) {
    const plan = await prisma.budgetPlan.findFirst({
      where: {
        organizationId,
        kind: "actual",
        year,
        deletedAt: null,
        NOT: { name: { contains: "superseded" } },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    if (plan) planIdByYear[year] = plan.id
    else warnings.push(`no actuals plan for ${year} — its consolidated months skipped`)
  }

  // 5. Build rows, grouped by plan.
  const rowsByPlan = new Map<string, BsImportRow[]>()
  for (const leaf of parsed.leaves) {
    const accountId = accountIdByLabel.get(leaf.label)!
    const accountCode = consolidatedAccountCode(leaf.label)
    for (const [ym, amount] of leaf.byMonth) {
      const year = Number(ym.slice(0, 4))
      const month = Number(ym.slice(5, 7))
      const planId = planIdByYear[year]
      if (!planId) continue
      const row: BsImportRow = {
        planId,
        companyId: holding.id,
        accountCode,
        accountId,
        lineType: SECTION_TO_LINETYPE[leaf.section],
        subType: leaf.subType,
        year,
        month,
        amount,
        sourceCell: `${sourceDocument}!${leaf.label}`,
      }
      const arr = rowsByPlan.get(planId)
      if (arr) arr.push(row)
      else rowsByPlan.set(planId, [row])
    }
  }

  // 6. Run the batch per plan (clean-slates the holding's prior consolidated BS).
  const batches: BsImportResult[] = []
  for (const [planId, rows] of rowsByPlan) {
    const periodScope = [...new Set(rows.map((r) => `${r.year}-${pad2(r.month)}`))]
    const expectedSums = new Map<ReconciliationKey, number>()
    for (const r of rows) {
      const key = buildReconKey(r.planId, r.accountCode, `${r.year}-${pad2(r.month)}`)
      expectedSums.set(key, (expectedSums.get(key) ?? 0) + r.amount)
    }
    const plan: BsImportPlan = {
      organizationId,
      label: `Consolidated holding BS → ${holdingCompanyCode}`,
      actorUserId,
      sourceDocument,
      planIds: [planId],
      periodScope,
      rows,
      expectedSums,
      purgeArchivedFirst: false,
    }
    batches.push(await runBalanceSheetBatch(prisma, plan))
  }

  return {
    holdingCompanyId: holding.id,
    months: parsed.months,
    planIdByYear,
    warnings,
    batches,
  }
}
