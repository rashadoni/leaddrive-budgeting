/**
 * 2026-08-18 — whether a P&L query may include the group's intragroup
 * eliminations, decided BEFORE the query runs.
 *
 * The balance sheet answers this after the fact: `resolveBalanceSheetScope`
 * inspects the rows a query returned and names the basis. The P&L cannot
 * reuse that shape, because its company filter lives in the WHERE — an
 * elimination row carries `companyId: null`, and any `companyId: { in }`
 * silently drops it. So the decision has to be made up front, and it has to
 * be the same rule the balance sheet enforces on read:
 *
 *   GROUP ELIMINATIONS APPLY ONLY TO THE WHOLE GROUP.
 *
 * The client's `EJE` block nets intercompany result across ALL of its
 * entities at once. Applied to a subset it would subtract trades with
 * companies that are not even on screen, so a subset stays an honest,
 * labelled sum instead.
 *
 * A restricted user is treated as a subset WITHOUT checking whether their
 * scope happens to cover every company. That check would cost a company
 * query on every P&L request to change the answer for a case that barely
 * exists — a restriction listing all companies — and it errs toward calling
 * a real consolidation a sum, never the reverse. Over-warning is the safe
 * direction here, as it is in `resolveBalanceSheetScope`, and the basis is
 * returned so the surface can say which one it is showing.
 *
 * Pure. The caller passes what it already holds; nothing here queries.
 */

export interface PnlEliminationScopeInput {
  /** The resolved company filter of the request: org-wide, or narrowed. */
  filterKind: "all" | "single"
  /** True when RBAC narrows this user to a subset of the org's companies. */
  restricted: boolean
}

export interface PnlEliminationScope {
  /** Admit `isElimination: true` rows into the query when true. */
  includeEliminations: boolean
  /**
   * What the resulting aggregate IS, in the balance sheet's vocabulary, so
   * the response can state it rather than leave the reader to assume.
   */
  basis: "consolidated_computed" | "sum_of_entities" | "single_entity"
}

export function resolvePnlEliminationScope(
  input: PnlEliminationScopeInput,
): PnlEliminationScope {
  if (input.filterKind === "single") {
    // One company's own result has no group eliminations in it, restricted or
    // not — this is the definition of the number, not a permission question.
    return { includeEliminations: false, basis: "single_entity" }
  }
  if (input.restricted) {
    return { includeEliminations: false, basis: "sum_of_entities" }
  }
  return { includeEliminations: true, basis: "consolidated_computed" }
}
