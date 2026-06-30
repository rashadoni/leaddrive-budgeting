/**
 * AI Data Mapper v2 — heuristic anomaly pre-pass (Phase 7.G Turn LXXXXIV).
 *
 * Per Phase 7.B v2 plan (`~/.claude/plans/phase-7b-ai-mapper-v2.md` Day 2):
 * v1 trusts the LLM to catch all anomalies; in practice it misses ~20% per
 * `scripts/test-ai-mapper.ts` POC runs. This module runs deterministic rules
 * AFTER the LLM call and merges results, dedupe by `(row, category)` with
 * LLM-flagged winning on description.
 *
 * Why post-LLM (not pre-LLM): heuristic rules need the LLM's role inferences
 * (`accountTypeOverrides[code].accountType`) for sign_inversion + category_mismatch.
 *
 * Safe-by-design: pure functions, no I/O, no schema deps. Returns NEW
 * `Anomaly[]` array; caller responsible for merging.
 */

import type { MapperInput, MappingProposal, Anomaly } from "./types"
import { accountTypeFromCode } from "../adapters/azmade-sopl"

/**
 * Run all 8 heuristic rules + return found anomalies. Caller merges with
 * LLM-flagged anomalies via `mergeAnomalies()`.
 */
export function detectHeuristicAnomalies(
  input: MapperInput,
  proposal: Omit<MappingProposal, "anomalies"> & { anomalies?: Anomaly[] },
): Anomaly[] {
  const found: Anomaly[] = []
  found.push(...ruleSignInversion(input, proposal))
  found.push(...ruleMagnitudeOutlier(input, proposal))
  found.push(...ruleCategoryMismatch(proposal))
  found.push(...ruleDuplicateRow(input, proposal))
  found.push(...ruleCurrencyMix(input))
  found.push(...ruleImplausibleRatio(input, proposal))
  found.push(...ruleOtherInvalidCode(proposal))
  // Note: missing_breakdown (rule 5) is plan-spec'd but requires parent-leaf
  // graph traversal that's value-dependent; deferred to v2.1 — needs
  // applier-shape data we don't have at proposal-time.
  return found
}

/**
 * Merge LLM + heuristic anomalies. Dedupe by `(row, category)` — when both
 * sources flag the same row+category, prefer LLM description (richer).
 */
export function mergeAnomalies(llm: Anomaly[], heuristic: Anomaly[]): Anomaly[] {
  const key = (a: Anomaly) => `${a.row ?? "sheet"}:${a.category}`
  const seen = new Map<string, Anomaly>()
  for (const a of llm) seen.set(key(a), a)
  for (const a of heuristic) {
    const k = key(a)
    if (!seen.has(k)) seen.set(k, a)
  }
  return Array.from(seen.values())
}

// ─── Rules ────────────────────────────────────────────────────────────────

/** Helper: extract numeric values for a code across `amount:*` columns. */
function valuesForRow(
  input: MapperInput,
  rowIdx: number,
  proposal: Pick<MappingProposal, "columns">,
): number[] {
  const amountColIndices = proposal.columns
    .filter((c) => c.role.startsWith("amount:"))
    .map((c) => c.sourceIndex)
  const row = input.sampleRows[rowIdx]
  if (!row) return []
  const values: number[] = []
  for (const idx of amountColIndices) {
    const v = row[idx]
    if (typeof v === "number" && Number.isFinite(v)) values.push(v)
  }
  return values
}

/** Helper: find code-column index from proposal. */
function codeColumnIndex(proposal: Pick<MappingProposal, "columns">): number | null {
  const codeCol = proposal.columns.find((c) => c.role === "code")
  return codeCol?.sourceIndex ?? null
}

/** Helper: get code value from a row. */
function codeAt(input: MapperInput, rowIdx: number, codeColIdx: number): string | null {
  const row = input.sampleRows[rowIdx]
  if (!row) return null
  const v = row[codeColIdx]
  if (typeof v === "string") return v.trim()
  if (typeof v === "number") return String(v)
  return null
}

/**
 * Rule 1: sign_inversion — code-prefix says revenue (6xx) but >50% of
 * monthly values are negative. Severity: critical.
 */
function ruleSignInversion(
  input: MapperInput,
  proposal: Pick<MappingProposal, "columns" | "accountTypeOverrides">,
): Anomaly[] {
  const codeIdx = codeColumnIndex(proposal)
  if (codeIdx === null) return []
  const found: Anomaly[] = []
  for (let r = 0; r < input.sampleRows.length; r++) {
    const code = codeAt(input, r, codeIdx)
    if (!code) continue
    const values = valuesForRow(input, r, proposal)
    if (values.length < 3) continue // need enough signal
    const accountType =
      proposal.accountTypeOverrides?.find((o) => o.code === code)?.accountType ??
      accountTypeFromCode(code)
    if (accountType !== "revenue") continue
    const negCount = values.filter((v) => v < 0).length
    if (negCount > values.length / 2) {
      found.push({
        row: r + 1,
        severity: "critical",
        category: "sign_inversion",
        description: `Code ${code} inferred as revenue but ${negCount}/${values.length} monthly values are negative — likely sign inversion or mis-categorization.`,
      })
    }
  }
  return found
}

/**
 * Rule 2: magnitude_outlier — single value ≥99% of column non-zero total.
 * Excludes columns with <5 non-zero rows. Severity: warning.
 */
function ruleMagnitudeOutlier(
  input: MapperInput,
  proposal: Pick<MappingProposal, "columns">,
): Anomaly[] {
  const found: Anomaly[] = []
  const amountCols = proposal.columns.filter((c) => c.role.startsWith("amount:"))
  for (const col of amountCols) {
    const colValues: { row: number; value: number }[] = []
    for (let r = 0; r < input.sampleRows.length; r++) {
      const v = input.sampleRows[r]?.[col.sourceIndex]
      if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
        colValues.push({ row: r + 1, value: Math.abs(v) })
      }
    }
    if (colValues.length < 5) continue
    const total = colValues.reduce((s, x) => s + x.value, 0)
    if (total === 0) continue
    const max = colValues.reduce((m, x) => (x.value > m.value ? x : m))
    if (max.value >= total * 0.99) {
      found.push({
        row: max.row,
        severity: "warning",
        category: "magnitude_outlier",
        description: `Column "${col.role}" row ${max.row}: single value is ≥99% of column total — likely a sub-total or aggregate masquerading as a leaf.`,
      })
    }
  }
  return found
}

/**
 * Rule 3: category_mismatch — `accountTypeFromCode(code)` disagrees with
 * proposal's `accountTypeOverrides[code]`. Severity: critical.
 */
function ruleCategoryMismatch(
  proposal: Pick<MappingProposal, "accountTypeOverrides">,
): Anomaly[] {
  const found: Anomaly[] = []
  for (const o of proposal.accountTypeOverrides ?? []) {
    const derived = accountTypeFromCode(o.code)
    if (derived && derived !== o.accountType) {
      found.push({
        row: null,
        severity: "critical",
        category: "category_mismatch",
        description: `Code ${o.code}: LLM proposed accountType="${o.accountType}" but code prefix derives to "${derived}".`,
      })
    }
  }
  return found
}

/**
 * Rule 4: duplicate_row — same code appearing twice with different annual
 * (sum-of-monthly) amounts. dedupeParentRollups handles parent-vs-leaf;
 * this catches true duplicates. Severity: warning.
 */
function ruleDuplicateRow(
  input: MapperInput,
  proposal: Pick<MappingProposal, "columns">,
): Anomaly[] {
  const codeIdx = codeColumnIndex(proposal)
  if (codeIdx === null) return []
  const found: Anomaly[] = []
  const codeAnnual = new Map<string, { row: number; annual: number }[]>()
  for (let r = 0; r < input.sampleRows.length; r++) {
    const code = codeAt(input, r, codeIdx)
    if (!code) continue
    const annual = valuesForRow(input, r, proposal).reduce((s, v) => s + v, 0)
    const list = codeAnnual.get(code) ?? []
    list.push({ row: r + 1, annual })
    codeAnnual.set(code, list)
  }
  for (const [code, entries] of codeAnnual) {
    if (entries.length < 2) continue
    const annuals = entries.map((e) => e.annual)
    const allSame = annuals.every((a) => Math.abs(a - annuals[0]) < 0.01)
    if (allSame) continue
    found.push({
      row: entries[0].row,
      severity: "warning",
      category: "duplicate_row",
      description: `Code ${code} appears ${entries.length}× with different annual totals (rows ${entries.map((e) => e.row).join(", ")}). Likely true duplicate, not parent-leaf.`,
    })
  }
  return found
}

/**
 * Rule 6: currency_mix — column samples include >1 distinct currency symbol.
 * Sheet-level (row=null). Severity: critical.
 */
function ruleCurrencyMix(input: MapperInput): Anomaly[] {
  const symbols = new Set<string>()
  const symbolRegex = /[$₼₽€]/g
  for (const col of input.columns) {
    for (const sample of col.samples) {
      if (typeof sample === "string") {
        const matches = sample.match(symbolRegex)
        if (matches) for (const m of matches) symbols.add(m)
      }
    }
  }
  if (symbols.size > 1) {
    return [
      {
        row: null,
        severity: "critical",
        category: "currency_mix",
        description: `Multiple currency symbols detected in column samples: ${Array.from(symbols).join(", ")}. Confirm exchange rates before import.`,
      },
    ]
  }
  return []
}

/**
 * Rule 7: implausible_ratio — gross margin = (revenue + cogs) / revenue.
 * If <-200% or >100% → flag. Severity: critical.
 */
function ruleImplausibleRatio(
  input: MapperInput,
  proposal: Pick<MappingProposal, "columns" | "accountTypeOverrides">,
): Anomaly[] {
  const codeIdx = codeColumnIndex(proposal)
  if (codeIdx === null) return []
  let revenueSum = 0
  let cogsSum = 0
  for (let r = 0; r < input.sampleRows.length; r++) {
    const code = codeAt(input, r, codeIdx)
    if (!code) continue
    const accountType =
      proposal.accountTypeOverrides?.find((o) => o.code === code)?.accountType ??
      accountTypeFromCode(code)
    const annual = valuesForRow(input, r, proposal).reduce((s, v) => s + v, 0)
    if (accountType === "revenue") revenueSum += annual
    if (accountType === "cogs") cogsSum += annual
  }
  if (revenueSum <= 0) return [] // no revenue → can't compute meaningful ratio
  // COGS often negative in sign-flipped charts; use absolute value for ratio.
  // GM = (revenue - |cogs|) / revenue
  const gmPct = ((revenueSum - Math.abs(cogsSum)) / revenueSum) * 100
  if (gmPct < -200 || gmPct > 100) {
    return [
      {
        row: null,
        severity: "critical",
        category: "implausible_ratio",
        description: `Gross margin = ${gmPct.toFixed(1)}% (revenue=${revenueSum.toFixed(0)}, cogs=${cogsSum.toFixed(0)}). Outside plausible [-200%, 100%] range — review category mapping.`,
      },
    ]
  }
  return []
}

/**
 * Rule 8: other — code present but doesn't match a recognized account-code
 * hierarchy. Severity: info.
 *
 * SAP-style numeric codes are valid (`601-01`). AzerSheker/reporting-pack
 * dotted hierarchies are also valid (`PLF.01`, `BS.01.02`, `CF.03.01.R`) and
 * are resolved by section/parent overrides in applier.ts, so they must not be
 * surfaced as "not SAP" noise.
 */
function ruleOtherInvalidCode(
  proposal: Pick<MappingProposal, "accountTypeOverrides">,
): Anomaly[] {
  const sapCodePattern = /^\d{3,}(-\d+)*$/
  const dottedHierarchyPattern = /^[A-Z][A-Z0-9]*\.\d{1,3}(?:\.[A-Z0-9]{1,4})*$/i
  const found: Anomaly[] = []
  for (const o of proposal.accountTypeOverrides ?? []) {
    const code = o.code.trim()
    if (!sapCodePattern.test(code) && !dottedHierarchyPattern.test(code)) {
      found.push({
        row: null,
        severity: "info",
        category: "other",
        description: `Code "${o.code}" does not match a recognized account-code pattern. Verify the row or map it to skip before apply.`,
      })
    }
  }
  return found
}
