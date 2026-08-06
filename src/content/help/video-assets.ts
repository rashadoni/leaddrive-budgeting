/**
 * src/content/help/video-assets.ts
 * =====================================================================
 * Route → help-video slug map plus the helpers the in-flow launcher uses to
 * resolve the right video for the current page + locale. Ported from the
 * leaddrive-v2 CRM and made self-contained for BudgetPro (no external help
 * registry — the locale/slug types are declared here).
 *
 * To add a section: append an entry to HELP_VIDEO_ENTRIES_RAW with its slug and
 * the route(s) it covers, then record video/player/{slug}.{lang}.VOICE.mp4 (+
 * poster) via scripts/produce-guides.mjs.
 * =====================================================================
 */

export type HelpVideoLocale = "az" | "en" | "ru"

export interface HelpVideoEntry {
  slug: string
  /**
   * Route patterns may include required query parameters. For example,
   * `/budgeting?tab=cash-flow` matches that tab plus unrelated query noise,
   * but never `/budgeting?tab=workspace`.
   */
  routes: readonly string[]
  helpSlugs?: readonly string[]
}

const HELP_VIDEO_BASE_PATH = process.env.NEXT_PUBLIC_HELP_VIDEO_BASE_URL ?? "/api/help-videos"
const HELP_VIDEO_ASSET_VERSION = "20260804-ten-sections"
const HELP_VIDEO_BLOCKED_LOCAL_TTS_SLUGS = new Set<string>()

const HELP_VIDEO_ENTRIES_RAW = [
  { slug: "statement-controls", routes: ["/budgeting/admin/statement-controls"] },
  { slug: "ai-import", routes: ["/budgeting/admin/ai-import"] },
  { slug: "indicator-backlog", routes: ["/budgeting/admin/indicator-backlog"] },

  // Budgeting tabs. Each pins its own `tab` value, so a viewer on Cash Flow is
  // never offered the Balance Sheet walkthrough.
  { slug: "workspace", routes: ["/budgeting?tab=workspace"] },
  { slug: "balance-sheet", routes: ["/budgeting?tab=balance-sheet"] },
  // NOT cash-flow. Its scenario exists and its narration is written in all
  // three languages, but the take cannot be recorded yet: with a fully
  // projected year in the database the Entries sub-view does not open at all
  // (three minutes and the tab is still unclickable — the view renders every
  // one of 43,440 rows). Registering the slug without media would put a play
  // button on the page that 404s. Add the entry back with the recording.
  { slug: "comparison", routes: ["/budgeting?tab=comparison"] },
  { slug: "forecast", routes: ["/budgeting?tab=forecast"] },
  { slug: "plans", routes: ["/budgeting?tab=plans"] },

  // Standalone screens.
  { slug: "risk-terminal", routes: ["/budgeting/terminal"] },
  { slug: "alerts", routes: ["/budgeting/alerts/history"] },
  { slug: "board-deck", routes: ["/budgeting/board-deck"] },

  // The Data Control group overview walks eight admin screens in one take, but
  // it deliberately claims only SIX of them. Statement Controls and Indicator
  // Backlog have their own dedicated deep-dives above, and the resolver sorts
  // by longest route: "/budgeting/admin/companies-readiness" (36 chars) beats
  // "/budgeting/admin/statement-controls" (35), so listing those two here would
  // silently replace the detailed guide with a passing mention of it.
  {
    slug: "data-control",
    routes: [
      "/budgeting/admin/companies-readiness",
      "/budgeting/admin/indicator-health",
      "/budgeting/admin/ifrs-conformance",
      "/budgeting/admin/compliance",
      "/budgeting/admin/drift",
      "/budgeting/admin/intel-health",
    ],
  },
] as const satisfies readonly HelpVideoEntry[]

export const HELP_VIDEO_ENTRIES: readonly HelpVideoEntry[] = HELP_VIDEO_ENTRIES_RAW

// Longest-route-first so a more specific route wins over a broad prefix.
const HELP_VIDEO_ENTRIES_BY_ROUTE = HELP_VIDEO_ENTRIES.filter(isHelpVideoAvailable).sort((a, b) => {
  const longestA = Math.max(0, ...a.routes.map((route) => route.length))
  const longestB = Math.max(0, ...b.routes.map((route) => route.length))
  return longestB - longestA
})

const HELP_VIDEO_TITLE_OVERRIDES: Record<string, string> = {
  "statement-controls": "Statement Controls",
  // Without an override this renders "Ai Import"; the page itself is titled
  // Data İmportu / Data Import / Импорт данных.
  "ai-import": "Data Import",
  // Without an override this renders "Indicator Backlog" — which is the English
  // page title anyway, but pin it so the card never drifts from the page.
  "indicator-backlog": "Indicator Backlog",
  // The slug is the route segment; the screen is titled Alert evaluation
  // snapshot and lives under /alerts/history. "Alerts" alone would suggest a
  // live feed the page does not claim to be.
  alerts: "Alert History",
  // Six admin screens under one card — "Data Control" is the group's name, not
  // any single page's.
  "data-control": "Data Control",
}

function versionHelpVideoAsset(src: string) {
  return `${src}?v=${HELP_VIDEO_ASSET_VERSION}`
}

export function normalizeHelpVideoLocale(raw: string): HelpVideoLocale {
  return raw === "az" || raw === "en" || raw === "ru" ? raw : "en"
}

type HelpVideoSearchParams = Pick<URLSearchParams, "toString"> | string | null

function splitLocation(pathname: string, searchParams: HelpVideoSearchParams) {
  const queryIndex = pathname.indexOf("?")
  const rawPath = queryIndex >= 0 ? pathname.slice(0, queryIndex) : pathname
  const inlineQuery = queryIndex >= 0 ? pathname.slice(queryIndex + 1) : ""
  const explicitQuery = typeof searchParams === "string"
    ? searchParams
    : searchParams?.toString() ?? ""

  return {
    cleanPath: rawPath.replace(/\/$/, "") || "/",
    searchParams: new URLSearchParams(explicitQuery || inlineQuery),
  }
}

export function matchesHelpVideoRoute(
  pathname: string,
  routePattern: string,
  searchParams: HelpVideoSearchParams = null,
) {
  const location = splitLocation(pathname, searchParams)
  const pattern = splitLocation(routePattern, null)
  const pathMatches = pattern.cleanPath.endsWith("/*")
    ? location.cleanPath.startsWith(`${pattern.cleanPath.slice(0, -2)}/`)
    : location.cleanPath === pattern.cleanPath ||
      location.cleanPath.startsWith(`${pattern.cleanPath}/`)

  if (!pathMatches) return false

  for (const [key, value] of pattern.searchParams) {
    if (location.searchParams.get(key) !== value) return false
  }
  return true
}

export function getHelpVideoForPath(
  pathname: string | null,
  searchParams: HelpVideoSearchParams = null,
): HelpVideoEntry | null {
  if (!pathname) return null
  if (isHelpVideoPathBlocked(pathname, searchParams)) return null

  return (
    HELP_VIDEO_ENTRIES_BY_ROUTE.find((entry) =>
      entry.routes.some((route) => matchesHelpVideoRoute(pathname, route, searchParams))
    ) ?? null
  )
}

export function getHelpVideoForSlug(slug: string): HelpVideoEntry | null {
  const entry =
    HELP_VIDEO_ENTRIES.find(
      (entry) => entry.slug === slug || entry.helpSlugs?.includes(slug)
    ) ?? null

  return entry && isHelpVideoAvailable(entry) ? entry : null
}

export function getHelpVideoAsset(entry: HelpVideoEntry, locale: HelpVideoLocale) {
  if (!isHelpVideoAvailable(entry)) {
    throw new Error(`Help video ${entry.slug} is blocked until approved voiceover is available`)
  }

  const encodedName = encodeURIComponent(`${entry.slug}.${locale}`)

  return {
    videoSrc: versionHelpVideoAsset(`${HELP_VIDEO_BASE_PATH}/${encodedName}.VOICE.mp4`),
    posterSrc: versionHelpVideoAsset(`${HELP_VIDEO_BASE_PATH}/${encodedName}.poster.jpg`),
  }
}

export function isHelpVideoBlockedByVoiceover(slug: string) {
  return HELP_VIDEO_BLOCKED_LOCAL_TTS_SLUGS.has(slug)
}

function isHelpVideoAvailable(entry: HelpVideoEntry) {
  return !isHelpVideoBlockedByVoiceover(entry.slug)
}

function isHelpVideoPathBlocked(pathname: string, searchParams: HelpVideoSearchParams) {
  return HELP_VIDEO_ENTRIES.some(
    (entry) =>
      isHelpVideoBlockedByVoiceover(entry.slug) &&
      entry.routes.some((route) => matchesHelpVideoRoute(pathname, route, searchParams))
  )
}

export function formatHelpVideoTitle(slug: string) {
  const override = HELP_VIDEO_TITLE_OVERRIDES[slug]
  if (override) return override

  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
