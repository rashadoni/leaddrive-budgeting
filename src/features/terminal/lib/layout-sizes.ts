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
export const BUILT_IN_PRESETS: Record<string, { label: string; sizes: LayoutSizes }> = {
  default: {
    label: "Default 2×2",
    sizes: DEFAULT_LAYOUT_SIZES,
  },
  bloomberg: {
    label: "Bloomberg",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 70, [PANEL_IDS.outerBottom]: 30 },
      top: { [PANEL_IDS.panel1]: 20, [PANEL_IDS.panel2]: 80 },
      bottom: { [PANEL_IDS.panel3]: 45, [PANEL_IDS.panel4]: 55 },
    },
  },
  analyst: {
    label: "Analyst Drill-down",
    sizes: {
      outer: { [PANEL_IDS.outerTop]: 40, [PANEL_IDS.outerBottom]: 60 },
      top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
      bottom: { [PANEL_IDS.panel3]: 60, [PANEL_IDS.panel4]: 40 },
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
