/**
 * Import validation engine — Phase A (2026-06-20).
 *
 * Codex-confirmed architecture: format-independence comes from AI
 * interpretation; CORRECTNESS comes from deterministic, file-internal
 * controls. Numerical subtotal tie-out is only ONE class of proof — a mapping
 * can tie out arithmetically yet be semantically wrong (revenue mapped as
 * "other income"). So this aggregates MULTIPLE independent signals into a
 * graded verdict the review gate consumes:
 *
 *   - control-total (parent-vs-leaf reconcile, from computeControlTotals)
 *   - per-row Total-column tie-out (ParseResult.rowTotalMismatches)
 *   - coverage     (a P&L with no revenue is almost certainly a mis-map)
 *   - plausibility (gross-margin sanity)
 *   - sign         (revenue net-positive, cogs/expense net-positive post-flip)
 *
 * Pure + deterministic — no DB, no LLM. The verdict is graded per Codex:
 *   certified | warn | blocked | uncertifiable.
 */
import type { ParseResult } from "../adapters/azmade-sopl"
import type { ControlTotalReport } from "./control-totals"
import type { SignClassification } from "./sign-infer"

export type ValidationVerdict = "certified" | "warn" | "blocked" | "uncertifiable"

export interface ValidationFinding {
  severity: "blocker" | "warning" | "info"
  category:
    | "coverage"
    | "margin"
    | "sign"
    | "total_mismatch"
    | "semantic"
    | "control_total"
    | "no_control"
  message: string
}

export interface ValidationReport {
  verdict: ValidationVerdict
  findings: ValidationFinding[]
  /** Aggregates the validation drew on (for UI/debug). */
  totals: { revenue: number; cogs: number; expense: number; grossMarginPct: number | null }
}

const TOL = 0.005

export function validateImport(
  result: ParseResult,
  control: ControlTotalReport,
): ValidationReport {
  const findings: ValidationFinding[] = []

  // ── Aggregate P&L sums (cogs/expense already sign-flipped to positive) ──
  let revenue = 0
  let cogs = 0
  let expense = 0
  for (const l of result.lines) {
    if (l.accountType === "revenue") revenue += l.plannedAnnual
    else if (l.accountType === "cogs") cogs += l.plannedAnnual
    else if (l.accountType === "expense") expense += l.plannedAnnual
  }
  const grossMarginPct =
    Math.abs(revenue) > TOL ? (revenue - cogs) / revenue : null

  // ── Coverage — a P&L with zero revenue is almost always a mis-map ──
  if (Math.abs(revenue) <= TOL) {
    findings.push({
      severity: "blocker",
      category: "coverage",
      message: "No revenue parsed — the revenue column/section was not recognised.",
    })
  }
  if (Math.abs(cogs) <= TOL && Math.abs(expense) <= TOL) {
    findings.push({
      severity: "warning",
      category: "coverage",
      message: "No COGS and no expenses parsed — costs may be unmapped.",
    })
  }

  // ── Sign sanity (post-flip cogs/expense should be ≥ 0; revenue ≥ 0) ──
  if (revenue < -TOL) {
    findings.push({
      severity: "warning",
      category: "sign",
      message: `Revenue net is negative (${revenue.toFixed(0)}) — likely a sign/mapping error.`,
    })
  }
  if (cogs < -TOL || expense < -TOL) {
    findings.push({
      severity: "info",
      category: "sign",
      message: "COGS/expense net is negative after sign normalisation — unusual source convention.",
    })
  }

  // ── Cost-sign CONVENTION (Phase C C3.1) — the applier flips cogs/expense
  // assuming costs are stored NEGATIVE. If the inferred convention says the
  // file stores them POSITIVE, or is AMBIGUOUS, that flip would corrupt the
  // data — hard block (blocker), never flip-and-warn (Codex 2026-06-20:
  // warnings are ack-overridable → still commits a corrupted file). Clear
  // `negative_costs` / `no_evidence` → no finding → today's behaviour. ──
  const badSign = (c: SignClassification | undefined): boolean =>
    !!c && (c.convention === "positive_costs" || c.convention === "ambiguous")
  const sc = result.signConventions
  if (badSign(sc?.cogs) || badSign(sc?.expense)) {
    const which = [
      badSign(sc?.cogs) ? `COGS=${sc!.cogs!.convention}` : null,
      badSign(sc?.expense) ? `expense=${sc!.expense!.convention}` : null,
    ]
      .filter(Boolean)
      .join(", ")
    findings.push({
      severity: "blocker",
      category: "sign",
      message: `Cost-sign convention is not the expected "stored negative" (${which}) — the importer's sign flip would corrupt these values. Confirm the source sign / fix the mapping before committing.`,
    })
  }

  // ── Plausibility — only flag egregious gross margins ──
  if (grossMarginPct !== null && (grossMarginPct < -1 || grossMarginPct > 0.99)) {
    findings.push({
      severity: "warning",
      category: "margin",
      message: `Implausible gross margin ${(grossMarginPct * 100).toFixed(0)}% — check COGS/revenue mapping.`,
    })
  }

  // ── Semantic: resolved type vs visual section ("ties-out-but-wrong") ──
  const sectionConflicts = result.sectionTypeConflicts ?? []
  if (sectionConflicts.length > 0) {
    findings.push({
      severity: "warning",
      category: "semantic",
      message: `${sectionConflicts.length} row(s) classified against their visual P&L section (e.g. ${sectionConflicts[0].resolvedType} under a ${sectionConflicts[0].sectionType} section) — verify the account type.`,
    })
  }

  // ── Per-row Total-column tie-out ──
  const totalMismatches = result.rowTotalMismatches ?? []
  if (totalMismatches.length > 0) {
    findings.push({
      severity: "warning",
      category: "total_mismatch",
      message: `${totalMismatches.length} row(s) where Σ months ≠ the file's stated Total — months may be mis-mapped.`,
    })
  }

  // ── Control-total verdict (parent vs leaf) ──
  if (control.verdict === "red") {
    findings.push({
      severity: "blocker",
      category: "control_total",
      message: "Control-total RED — parent rows do not reconcile to their leaf children (likely a mis-mapped column).",
    })
  } else if (control.verdict === "yellow") {
    findings.push({
      severity: "warning",
      category: "control_total",
      message: "Control-total YELLOW — minor (≤1%) parent-vs-leaf rounding drift.",
    })
  }
  if (control.noControl) {
    findings.push({
      severity: "info",
      category: "no_control",
      message: "No parent/subtotal rows to auto-reconcile against — manual review recommended.",
    })
  }

  // ── Graded verdict ──
  const hasBlocker = findings.some((f) => f.severity === "blocker")
  const hasWarning = findings.some((f) => f.severity === "warning")
  let verdict: ValidationVerdict
  if (hasBlocker) {
    verdict = "blocked"
  } else if (control.noControl && totalMismatches.length === 0 && !hasWarning) {
    // Nothing reconciled (no internal control) and no other signal → can't
    // certify automatically; needs human eyes. Never fake "certified".
    verdict = "uncertifiable"
  } else if (hasWarning) {
    verdict = "warn"
  } else {
    verdict = "certified"
  }

  return {
    verdict,
    findings,
    totals: { revenue, cogs, expense, grossMarginPct },
  }
}
