/**
 * Phase 7.D — pure shape + validation for terminal layout sizes.
 *
 * The terminal uses 3 nested `react-resizable-panels` Groups:
 *   • outer    — vertical split (top row | bottom row)
 *   • top      — horizontal split (Panel 1 | Panel 2)
 *   • bottom   — horizontal split (Panel 3 | Panel 4)
 *
 * Each Group's layout is `{ [panelId]: percentage }` per the v4 API
 * (`Layout` type). We store all three maps as a single JSON blob on
 * `UserLayoutPreference.sizes`. Stored flat so the lib can call
 * `setLayout(blob[group])` directly without reshape on the UI side.
 */

export interface LayoutSizes {
  outer: Record<string, number>
  top: Record<string, number>
  bottom: Record<string, number>
}

/** Stable Panel ids — these must match the `id` props on the Panels in
 *  PanelGrid. Bumping the panel structure (e.g. adding Panel 5) requires
 *  a coordinated change here + in the component + in any saved layouts
 *  (which gracefully fall back to defaults via validateLayoutSizes). */
export const PANEL_IDS = {
  outerTop: "row-top",
  outerBottom: "row-bottom",
  panel1: "p1",
  panel2: "p2",
  panel3: "p3",
  panel4: "p4",
} as const

export const DEFAULT_LAYOUT_SIZES: LayoutSizes = {
  outer: { [PANEL_IDS.outerTop]: 55, [PANEL_IDS.outerBottom]: 45 },
  top: { [PANEL_IDS.panel1]: 35, [PANEL_IDS.panel2]: 65 },
  bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
}

/**
 * Phase B8 — built-in layout presets shown in LayoutMenu's dropdown
 * alongside user-saved layouts. Each preset is a complete LayoutSizes
 * shape (validated through `validateLayoutSizes` on apply).
 *
 * - `default`: 2×2 balanced grid (matches DEFAULT_LAYOUT_SIZES).
 * - `bloomberg`: HeatMap-dominant — minimal CompanyTree, large HeatMap,
 *   thin IndicatorDetail, thin VarianceExplainer. Mirrors Bloomberg's
 *   "data is king, panels are tabs" feel where the matrix gets the
 *   bulk of the screen.
 * - `analyst`: drill-down-heavy — equal CompanyTree+HeatMap top, fat
 *   IndicatorDetail bottom (60%) for formula + variables inspection,
 *   thin VarianceExplainer (40%) for narrative.
 */
/**
 * Sub-27 cont'd Round-9 i18n closure — each preset carries a `labelKey`
 * matching `messages.json:terminal.layoutMenu.presetLabel.<key>`. The
 * static `label` field is kept as the English fallback (also used by
 * client-side de-dup — name-collision filter compares saved-layout names
 * against this string set; pre-fix labels were hardcoded English so the
 * filter is invariant under locale switch). Display label is read via
 * `t(`layoutMenu.presetLabel.${labelKey}`)` in LayoutMenu.
 */
export const BUILT_IN_PRESETS: Record<
  string,
  { label: string; labelKey: string; sizes: LayoutSizes }
> = {
  default: {
    label: "Default 2×2",
    labelKey: "default",
    sizes: DEFAULT_LAYOUT_SIZES,
  },
  bloomberg: {
    label: "Bloomberg",
    labelKey: "bloomberg",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 70, [PANEL_IDS.outerBottom]: 30 },
      top: { [PANEL_IDS.panel1]: 20, [PANEL_IDS.panel2]: 80 },
      bottom: { [PANEL_IDS.panel3]: 45, [PANEL_IDS.panel4]: 55 },
    },
  },
  analyst: {
    label: "Analyst Drill-down",
    labelKey: "analyst",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 40, [PANEL_IDS.outerBottom]: 60 },
      top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
      bottom: { [PANEL_IDS.panel3]: 60, [PANEL_IDS.panel4]: 40 },
    },
  },
  // Sub-27 cont'd Round-5 M5 — task-oriented presets per plan §M5.
  morningBrief: {
    // Morning routine: scan matrix wide; tree thin nav; CompanyOverview
    // snapshot dominates the bottom row for quick "what changed overnight".
    label: "Morning Brief",
    labelKey: "morningBrief",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 65, [PANEL_IDS.outerBottom]: 35 },
      top: { [PANEL_IDS.panel1]: 22, [PANEL_IDS.panel2]: 78 },
      bottom: { [PANEL_IDS.panel3]: 30, [PANEL_IDS.panel4]: 70 },
    },
  },
  investorMode: {
    // Show-the-board: HeatMap maximised (88% top); tree thin nav strip;
    // bottom split CompanyOverview + IndicatorDetail for quick drill if asked.
    label: "Investor Mode",
    labelKey: "investorMode",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 70, [PANEL_IDS.outerBottom]: 30 },
      top: { [PANEL_IDS.panel1]: 12, [PANEL_IDS.panel2]: 88 },
      bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
    },
  },
  auditMode: {
    // Audit/forensics: matrix + IndicatorDetail dominate; tree mid; snapshot small.
    // Designed for "click cell → read formula + resolved variables + aggregates".
    label: "Audit Mode",
    labelKey: "auditMode",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 50, [PANEL_IDS.outerBottom]: 50 },
      top: { [PANEL_IDS.panel1]: 25, [PANEL_IDS.panel2]: 75 },
      bottom: { [PANEL_IDS.panel3]: 75, [PANEL_IDS.panel4]: 25 },
    },
  },
}

const SUM_TOLERANCE = 0.5 // pct points; lib emits floats

function validatePctMap(
  m: unknown,
  expectedKeys: readonly string[],
): Record<string, number> | null {
  if (m == null || typeof m !== "object") return null
  const obj = m as Record<string, unknown>
  // Must have EXACTLY the expected keys — extra keys could be a stale
  // layout from before a structure migration; defaulting is safer than
  // setting an unknown panel.
  const keys = Object.keys(obj)
  if (keys.length !== expectedKeys.length) return null
  let sum = 0
  for (const k of expectedKeys) {
    const v = obj[k]
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
      return null
    }
    sum += v
  }
  if (Math.abs(sum - 100) > SUM_TOLERANCE) return null
  // Rebuild as a fresh object so callers don't get prototype-poisoned
  // keys leaking through `as Record<string, number>`.
  const out: Record<string, number> = {}
  for (const k of expectedKeys) out[k] = obj[k] as number
  return out
}

/**
 * Validate a `sizes` payload from the API or DB. Returns the typed
 * value or null if shape doesn't match. Callers decide whether to
 * 400-reject (API) or fall back to defaults (UI).
 */
export function validateLayoutSizes(input: unknown): LayoutSizes | null {
  if (input == null || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const outer = validatePctMap(obj.outer, [
    PANEL_IDS.outerTop,
    PANEL_IDS.outerBottom,
  ])
  const top = validatePctMap(obj.top, [PANEL_IDS.panel1, PANEL_IDS.panel2])
  const bottom = validatePctMap(obj.bottom, [
    PANEL_IDS.panel3,
    PANEL_IDS.panel4,
  ])
  if (!outer || !top || !bottom) return null
  return { outer, top, bottom }
}

/**
 * Layout names: must be 1-40 chars, no leading/trailing whitespace, no
 * control chars. Helps the API + UI agree on what's renderable in the
 * dropdown.
 */
export function validateLayoutName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 40) return null
  if (/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029]/.test(trimmed)) {
    return null
  }
  return trimmed
}
