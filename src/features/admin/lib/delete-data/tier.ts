/**
 * The confirmation ladder.
 *
 * Today every scope — one company, one year, or the whole group — asks for the
 * same three letters, "ALL". A token typed identically for the smallest and
 * the largest action is muscle memory, not a gate.
 *
 * Nothing here is weaker than that. EVERY tier still requires a typed token, a
 * reason, and a non-stale preview. What changes is WHICH token, so the habit
 * built on a one-company delete does not transfer to a whole-group one.
 *
 * 11.77 — this file does NOT decide the token. It asks
 * `expectedConfirmCode()`, in `@/lib/server/delete-request`, the same function
 * the commit route validates with, about the same `companyTarget()` the
 * payload builder will put in the body. It used to decide independently, and
 * the two answers disagreed for every single-company scope: the gate asked for
 * "ALL", the route demanded the company code, and "Remove one company" 400'd
 * every time. What a tier chooses now is the reason length, the chips and the
 * arm delay — never the string.
 */
import {
  companyTarget,
  expectedConfirmCode,
  WIDEST_CONFIRM_TOKEN,
} from "@/lib/server/delete-request"

export type TaskId = "clearYears" | "removeCompany" | "restore" | "deleteAll"

export interface GateSpec {
  tier: 1 | 2 | 3
  /** The literal string the operator has to type. */
  token: string
  /** Minimum characters in the audit reason. */
  minReason: number
  /** Offer one-click reason suggestions? Not at the widest scope. */
  reasonChips: boolean
  /** Milliseconds the submit button stays disabled after the preview lands. */
  armMs: number
}

export interface ScopeShape {
  task: TaskId
  /**
   * EVERY company code the action covers — the same array the payload builder
   * is given. Not a count and not a hand-picked "the single one", because
   * both of those were a second guess at the shape of the request.
   */
  companyCodes: readonly string[]
  /** True when no year is scoped (i.e. every year). */
  allYears: boolean
  /** True when the preview reports anything in the "gone for good" group. */
  hasPermanent: boolean
}

export const WIDEST_TOKEN = WIDEST_CONFIRM_TOKEN

/**
 * The token the operator must type, and how hard the rest of the gate is.
 *
 * The token is NOT chosen here — it is read off the request this scope will
 * produce, so it always equals what the route will demand.
 */
export function gateFor(scope: ScopeShape): GateSpec {
  const token = expectedConfirmCode(companyTarget(scope.companyCodes))
  // A token that is not the blanket one IS the company's own code: typing it
  // is a statement about WHICH company, which "ALL" never was.
  const namesOneCompany = token !== WIDEST_TOKEN

  // Tier 3 — Task D. A longer reason, no chips and a five-second arm, because
  // there is no narrower thing this could have been mistaken for.
  if (scope.task === "deleteAll") {
    return { tier: 3, token, minReason: 10, reasonChips: false, armMs: 5000 }
  }
  // Tier 1 — one company, one or more named years, nothing unrecoverable.
  if (namesOneCompany && !scope.allYears && !scope.hasPermanent) {
    return { tier: 1, token, minReason: 8, reasonChips: true, armMs: 0 }
  }
  // Tier 2 — several companies, or every year, or something unrecoverable.
  // The token can no longer carry the escalation on its own (for one company
  // it is that company's code at both tiers), so the escalation is where it
  // can be felt: a longer reason, and no one-click chip to write it for you.
  return { tier: 2, token, minReason: 10, reasonChips: false, armMs: 0 }
}

/**
 * The structural defence this codebase lacks today: the widest scope has
 * exactly one door.
 *
 * In the old panel the whole holding was one backspace away — clear the year
 * box on a holding scope and "2026" became every year, with no change of
 * wording, colour or confirmation. Here, reconstructing the widest scope
 * inside a narrow task is refused and the operator is pointed at the task that
 * exists for it.
 *
 * 11.77 — the door had a second one next to it. The check fired only on the
 * "All years" chip, so ticking every year chip by hand produced the same scope
 * and walked straight past. That is not a narrower operation: every-company
 * plus every-year still trips `isWholeHolding` server-side, which fires BOTH
 * org-level sweeps — the orphan BudgetLines and the group sales forecast
 * (route.ts). The only thing the chip path spares is the year-less records
 * tail, and Task A never deletes that tail anyway (`categoriesFor` excludes
 * `records` and never sends `includeUnscoped`). So the two paths destroy the
 * identical set of rows, and only one of them was labelled as what it is.
 * Closed: however the operator expresses "every company, every year", it
 * routes to "Delete everything".
 *
 * Two deliberate limits:
 *   • `availableYears` is the census index, LOCKS INCLUDED. A locked year can
 *     never be ticked, so while a lock exists the stop simply does not fire —
 *     which is right, because Task D would be refused too (423) and stopping
 *     here would strand the operator with no door at all.
 *   • The "what" axis is ignored, exactly as it was for the all-years chip.
 *     Every-company × every-year × "statements only" stops as well. Narrowing
 *     the stop by bundle would be a weaker gate than the one shipped today.
 */
export function isHardStop(args: {
  task: TaskId
  selectedCompanies: number
  totalCompanies: number
  allYears: boolean
  /** Years the operator ticked. Ignored when `allYears` is set. */
  selectedYears?: readonly number[]
  /** Every year the scope's census found data for. */
  availableYears?: readonly number[]
}): boolean {
  if (args.task !== "clearYears") return false
  if (args.totalCompanies <= 0) return false
  if (args.selectedCompanies < args.totalCompanies) return false
  if (args.allYears) return true
  // Every year that HAS data, named one by one, is every year.
  const available = args.availableYears ?? []
  if (available.length === 0) return false
  const picked = new Set(args.selectedYears ?? [])
  return available.every((y) => picked.has(y))
}

/** Is the operator allowed to press the red button yet? */
export function canSubmit(args: {
  gate: GateSpec
  typedToken: string
  reason: string
  previewRows: number
  previewStale: boolean
  armedAt: number | null
  now: number
  permanentAcks: Record<string, boolean>
  permanentKeys: string[]
  running: boolean
  hardStop: boolean
}): boolean {
  if (args.running || args.hardStop) return false
  // Today's check is `preview.rowsAffected >= 0`, which is true of every
  // number a count can return — the red button was live on an empty preview.
  if (args.previewRows <= 0) return false
  if (args.previewStale) return false
  if (args.typedToken !== args.gate.token) return false
  if (args.reason.trim().length < args.gate.minReason) return false
  if (args.permanentKeys.some((k) => !args.permanentAcks[k])) return false
  if (args.gate.armMs > 0) {
    if (args.armedAt == null) return false
    if (args.now - args.armedAt < args.gate.armMs) return false
  }
  return true
}
