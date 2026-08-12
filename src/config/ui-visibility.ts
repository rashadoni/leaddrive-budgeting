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

/**
 * The two admin blocks at the foot of the nav — "Data control" (statement
 * controls, IFRS conformance, compliance hub, indicator health, drift, intel
 * health, companies readiness, indicator backlog) and "Data & operations"
 * (manual entry, report package, data deletion, approvals, task queue) —
 * together with the collapsible "Admin tools" row beneath them.
 *
 * These are admin-gated already, so this hides them from the people who could
 * still reach them. Every `/budgeting/admin/*` route keeps its own admin guard
 * and continues to serve; this is a menu change, not an access change.
 */
export const SHOW_ADMIN_NAV_GROUPS = false

/**
 * Secondary top-level destinations: Trade Tower, Board Deck, Onboarding and
 * Alerts. Their routes are untouched and still reachable by URL.
 */
export const SHOW_SECONDARY_NAV = false

/**
 * The "Configuration" item at the foot of the Budgeting sub-navigation. It is
 * the only member of its group, so hiding it removes the group entirely.
 */
export const SHOW_BUDGET_CONFIG_NAV = false

/**
 * The AI Import button in the Budgeting page header. The sidebar's own
 * "Data import" entry and the `/budgeting/admin/ai-import` route are
 * unaffected — this hides the shortcut, not the importer.
 *
 * The plan and company selectors beside it are deliberately NOT covered by
 * this flag: without them there is no way to choose which plan or company the
 * page is showing, so hiding them would not trim the screen, it would break it.
 */
export const SHOW_AI_IMPORT_BUTTON = false

