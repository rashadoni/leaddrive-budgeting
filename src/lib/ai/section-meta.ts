/**
 * Client-safe metadata for the AI analytics sections.
 *
 * The collectors live in `section-context.ts` and depend on Prisma. Keeping
 * labels and the section union here lets client components render the UI
 * without importing that server-only data layer.
 */
export const SECTION_LABELS = {
  "pnl-report": "P&L Report",
  pl: "P&L (Plan)",
  "balance-sheet": "Balance Sheet",
  cogs: "COGS",
  "cash-flow": "Cash Flow",
  assumptions: "Assumptions",
  workspace: "Workspace Overview",
  forecast: "Forecast",
} as const

export type Section = keyof typeof SECTION_LABELS
