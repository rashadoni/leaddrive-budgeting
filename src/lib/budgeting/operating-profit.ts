/**
 * Pure helper extracted from `/budgeting/page.tsx` WorkspaceTab Operating
 * Profit row math (Turn 38 audit close).
 *
 * Operating Profit = Revenue − COGS − OpEx
 *
 * Pre-Turn-38 the inline expression dropped COGS, computing Rev − OpEx.
 * For AZMADE this overstated the visible bottom-row by ~140M ₼ (COGS
 * total) — the Workspace tab is the default landing surface, so this was
 * a customer-facing math error.
 *
 * The helper exists primarily for unit-test surface; the math is trivial
 * but the extraction prevents the inline-arithmetic regression from
 * recurring silently the next time someone refactors the totals row.
 */
export function computeOperatingProfit(
  revenue: number,
  cogs: number,
  opex: number,
): number {
  return revenue - cogs - opex;
}
