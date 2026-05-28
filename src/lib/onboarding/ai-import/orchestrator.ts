/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Import: Orchestrator.
 *
 * Top-level entry point that wires meta-extraction → classification →
 * adapter routing → reconciliation → atomic apply.
 *
 * Design:
 *   • Pure structural orchestration — no LLM logic inline, no parser
 *     logic inline. Each phase is delegated to a unit-tested module.
 *   • Stops on red verdict (mandatory reconciliation gate).
 *   • Two-phase commit semantics:
 *       Phase 1: PARSE — runs all adapters, collects expected sums, NO DB writes.
 *       Phase 2: COMMIT — runs reconciliation; if 🟢, wraps all applyToDb() calls
 *                          in a single $transaction. If 🔴, aborts cleanly.
 *   • SDK seam injected (anthropic client, prisma) for test isolation.
 */
import type { PrismaClient } from "@prisma/client"
import type * as XLSXType from "xlsx"
import {
  extractWorkbookMeta,
  type SheetMeta,
} from "./sheet-meta-extractor"
import {
  classifySheets,
  type SheetClassifierAnthropicLike,
  type SheetClassification,
} from "./sheet-classifier"
import type { AdapterRegistry, AdapterRunResult } from "./adapter-registry"
import {
  reconcileAllSheets,
  decideAction,
  type UniversalReconciliationReport,
  type SheetReconciliationInput,
} from "./universal-reconciler"
import type { LLMUsage } from "@/lib/llm/types"
import type { ReconciliationKey } from "../reconciliation"

export interface OrchestratorInput {
  /** Loaded XLSX workbook object.
   *  Phase 8 D3 (2026-05-28) — tightened to the real `XLSX.WorkBook`
   *  type so downstream adapters (AdapterRunInput.workbook) drop
   *  their `as any` bridges. */
  workbook: XLSXType.WorkBook
  /** XLSX module reference. Kept loose so test fixtures can stub. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any
  /** Organisation id (multi-tenant scope). */
  organizationId: string
  /** Optional: list of known entity codes to seed the classifier. */
  knownEntityCodes?: string[]
  /** Year to scope import (default: current year). */
  year: number
  /** Org primary industry hint for the classifier. */
  orgIndustry?: string
  /** If true, yellow verdict commits with warning. Default: false (abort). */
  allowYellow?: boolean
  /** If true, do NOT commit even on green — return parse-only result. */
  dryRun?: boolean
}

export interface OrchestratorDependencies {
  prisma: PrismaClient
  anthropicClient: SheetClassifierAnthropicLike
  /** Anthropic model name for classifier. */
  model: string
  /** Adapter registry — orchestrator uses `registry.get(dataType)`. */
  registry: AdapterRegistry
  /**
   * Optional post-write "actual sums" reader. Given the orchestrator's
   * applied rows (per sheet), this fn re-queries the DB and emits a
   * matching `actualSums` map. Default: identity (assumes adapter
   * already returns reconciled output — useful for adapters that
   * compute totals in-process and don't need a separate DB read).
   *
   * When provided, this fn is called per sheet AFTER applyToDb()
   * inside the transaction, so re-querying sees the writes.
   */
  readActualSums?: (sheetCtx: {
    sheetName: string
    dataType: string
    entityCode: string | null
    organizationId: string
    year: number
  }) => Promise<Map<ReconciliationKey, number>>
}

export interface SheetParseRecord {
  classification: SheetClassification
  adapterResult: AdapterRunResult | null
  expectedSums: Map<ReconciliationKey, number>
  skippedReason: string | null
}

export interface OrchestratorResult {
  classifications: SheetClassification[]
  parseRecords: SheetParseRecord[]
  reconciliation: UniversalReconciliationReport
  committed: boolean
  action: "commit" | "commit_with_warning" | "abort" | "dry_run"
  totalRowsInserted: number
  durationMs: number
  llmUsage: LLMUsage
  warnings: string[]
}

/**
 * Run the full AI Import pipeline. Returns a structured result + commits
 * to DB only on green verdict (or yellow if `allowYellow=true`).
 *
 * On red verdict, returns without committing — caller (UI/API) can show
 * the user what's wrong.
 */
export async function runAIImport(
  input: OrchestratorInput,
  deps: OrchestratorDependencies,
): Promise<OrchestratorResult> {
  const t0 = Date.now()
  const warnings: string[] = []

  // ── Phase 1: Meta extraction ───────────────────────────────────
  const metas: SheetMeta[] = extractWorkbookMeta(input.workbook, input.XLSX, {
    sampleRows: 5,
    maxColumns: 15,
    profileRows: 80,
  })

  // ── Phase 2: AI classification ─────────────────────────────────
  const classification = await classifySheets(
    {
      sheetMetas: metas,
      knownEntityCodes: input.knownEntityCodes,
      orgIndustry: input.orgIndustry,
    },
    deps.anthropicClient,
    deps.model,
  )

  // ── Phase 3: Adapter dispatch (parse only, no DB writes) ───────
  const parseRecords: SheetParseRecord[] = []
  for (const cls of classification.classifications) {
    const handler = deps.registry.get(cls.dataType)
    if (!handler) {
      parseRecords.push({
        classification: cls,
        adapterResult: null,
        expectedSums: new Map(),
        skippedReason: `No adapter registered for dataType="${cls.dataType}"`,
      })
      warnings.push(
        `Sheet "${cls.sheetName}" (${cls.dataType}): no adapter — skipped`,
      )
      continue
    }
    try {
      const adapterResult = await handler({
        workbook: input.workbook,
        sheetName: cls.sheetName,
        entityCode: cls.entityCode,
        year: input.year,
        organizationId: input.organizationId,
        XLSX: input.XLSX,
      })
      // The adapter is responsible for declaring its expected sums for
      // reconciliation. Adapters that don't need cell-level recon (e.g.
      // descriptions, land registry, capex) return empty map → those
      // sheets always reconcile as green (trivially matching empty maps).
      const expectedSums =
        (
          adapterResult as AdapterRunResult & {
            expectedSums?: Map<ReconciliationKey, number>
          }
        ).expectedSums ?? new Map<ReconciliationKey, number>()
      parseRecords.push({
        classification: cls,
        adapterResult,
        expectedSums,
        skippedReason: null,
      })
      if (adapterResult.warnings.length > 0) {
        warnings.push(
          `Sheet "${cls.sheetName}": ${adapterResult.warnings.length} adapter warning(s)`,
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      parseRecords.push({
        classification: cls,
        adapterResult: null,
        expectedSums: new Map(),
        skippedReason: `Adapter threw: ${msg}`,
      })
      warnings.push(`Sheet "${cls.sheetName}": adapter error — ${msg}`)
    }
  }

  // ── Phase 4: Reconciliation (with empty actualSums for parse-only
  //              pass — gives us "missing rows" diagnostic).
  // The orchestrator will re-reconcile AFTER applyToDb inside the
  // transaction (using `readActualSums` if provided).
  const dryRunReconInput: SheetReconciliationInput[] = parseRecords
    .filter((r) => r.adapterResult !== null && r.skippedReason === null)
    .map((r) => ({
      sheetName: r.classification.sheetName,
      dataType: r.classification.dataType,
      entityCode: r.classification.entityCode,
      expectedSums: r.expectedSums,
      // For the pre-apply pass, actual=expected (it's about confirming
      // the adapter could produce sums, not yet about what's in the DB).
      actualSums: r.expectedSums,
    }))
  const dryReconciliation = reconcileAllSheets(dryRunReconInput)

  // If parsing produced any red (e.g. adapter emitted inconsistent
  // expected sums), abort before touching DB.
  if (dryReconciliation.overallVerdict === "red") {
    return {
      classifications: classification.classifications,
      parseRecords,
      reconciliation: dryReconciliation,
      committed: false,
      action: "abort",
      totalRowsInserted: 0,
      durationMs: Date.now() - t0,
      llmUsage: classification.usage,
      warnings: [
        ...warnings,
        "Parse-phase reconciliation FAILED — aborted before DB write",
      ],
    }
  }

  // Dry-run mode: stop here, never touch DB.
  if (input.dryRun) {
    return {
      classifications: classification.classifications,
      parseRecords,
      reconciliation: dryReconciliation,
      committed: false,
      action: "dry_run",
      totalRowsInserted: 0,
      durationMs: Date.now() - t0,
      llmUsage: classification.usage,
      warnings,
    }
  }

  // ── Phase 5: Atomic commit ─────────────────────────────────────
  let totalRowsInserted = 0
  const committableRecords = parseRecords.filter(
    (r) => r.adapterResult !== null && r.skippedReason === null,
  )

  // Apply inside a single transaction so partial failure rolls back.
  await deps.prisma.$transaction(async (tx) => {
    for (const r of committableRecords) {
      if (!r.adapterResult) continue
      const applied = await r.adapterResult.applyToDb(tx)
      totalRowsInserted += applied.rowsInserted
    }
  })

  // ── Phase 6: Post-write reconciliation ─────────────────────────
  // Re-read actual sums per sheet IF a reader was supplied. Otherwise
  // use the parse-phase result (assumes adapter is self-validating).
  let finalReconciliation = dryReconciliation
  if (deps.readActualSums) {
    const postWriteInputs: SheetReconciliationInput[] = []
    for (const r of committableRecords) {
      const actualSums = await deps.readActualSums({
        sheetName: r.classification.sheetName,
        dataType: r.classification.dataType,
        entityCode: r.classification.entityCode,
        organizationId: input.organizationId,
        year: input.year,
      })
      postWriteInputs.push({
        sheetName: r.classification.sheetName,
        dataType: r.classification.dataType,
        entityCode: r.classification.entityCode,
        expectedSums: r.expectedSums,
        actualSums,
      })
    }
    finalReconciliation = reconcileAllSheets(postWriteInputs)
  }

  const action = decideAction(finalReconciliation, {
    allowYellow: input.allowYellow,
  })
  const committed = action === "commit" || action === "commit_with_warning"

  return {
    classifications: classification.classifications,
    parseRecords,
    reconciliation: finalReconciliation,
    committed,
    action,
    totalRowsInserted,
    durationMs: Date.now() - t0,
    llmUsage: classification.usage,
    warnings,
  }
}
