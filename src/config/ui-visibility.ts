/**
 * Temporary presentation trims — requested 2026-08-11, to be reverted on the
 * owner's word.
 *
 * These flags hide existing, working surfaces. Nothing is deleted: every route,
 * component and calculation stays in place and reachable by URL, so flipping a
 * flag back to `true` restores the previous behaviour exactly, with no data
 * migration and no rebuild of anything.
 *
 * They live in one file on purpose. Scattering `false` literals through the
 * components would make "put it back the way it was" an archaeology exercise
 * three months from now; here the whole change is four lines and its reason is
 * written next to it.
 *
 * If a flag is still `false` long after the reason for it has passed, that is
 * the signal to either restore it or remove the surface properly — a hidden
 * feature that nobody remembers hiding is worse than either.
 */

/**
 * Group headings inside the Budgeting sub-navigation ("FINANCE", "PLANNING",
 * "FORECASTS", …). With this off the sub-items render as one flat list; the
 * grouping still governs their ORDER, so the list reads the same top to bottom.
 */
export const SHOW_NAV_GROUP_HEADINGS = false

/**
 * The Risk Terminal entry in the main navigation. The route itself
 * (`/budgeting/terminal`) is untouched and still works for anyone who has the
 * link, and its help video stays registered — this hides the menu item only.
 */
export const SHOW_RISK_TERMINAL_NAV = false

/**
 * The two infographic cards at the top of the P&L tab: the waterfall chart and
 * the expense donut. The KPI tiles and the P&L table itself are unaffected, so
 * every number remains on the page — what goes away is the decorative half of
 * the screen, which is also the half that pushes the table below the fold.
 */
export const SHOW_PL_CHARTS = false
