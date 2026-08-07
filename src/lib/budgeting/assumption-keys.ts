/**
 * The drivers a person can pick from, in words a finance person already uses.
 *
 * The editor first shipped `key` as a free-text box with the placeholder
 * `import_share`. That is unusable by the people the tab is for: a controller
 * has no way of knowing which slugs the product looks up, and a typo produces
 * a row that renders in the table while no formula ever reads it — failing
 * silently, which is the worst shape a mistake can take here.
 *
 * So the key becomes a CHOICE. The list below is the single place that says
 * which keys exist, what each means in plain language, and — the part that
 * decides whether entering it does anything — whether the product actually
 * reads it today.
 *
 * `readBy` is deliberately honest rather than encouraging:
 *   'scenario' — a scenario lever consumes it per company (COMPANY_DRIVERS)
 *   'anchor'   — it supplies a baseline a target scenario anchors against
 *                (FEED_ANCHOR_ASSUMPTIONS), used when the live feed is silent
 *   'none'     — stored, importable and shown on the tab, but NO calculation
 *                reads it yet. Recording it documents a premise; it changes
 *                no number.
 *
 * Keeping 'none' entries in the list is the point. Hiding them would imply the
 * catalogue is the set of things that work, and a controller would go looking
 * for inflation, not find it, and type a free-text key that silently does
 * nothing — exactly the failure this replaces.
 */

export type AssumptionKeyUse = "scenario" | "anchor" | "none"

export interface AssumptionKeyOption {
  key: string
  /** i18n key under `budgeting.assumptionKeyLabel` — never shown raw. */
  labelKey: string
  /** Default category, so picking a key fills the category for you. */
  category: string
  /** Unit hint pre-filled with the key; the user may still change it. */
  unit: string
  /** Whether anything in the product reads this key today. */
  readBy: AssumptionKeyUse
  /** True when the value must be a fraction in [0,1] — drives the inline hint. */
  fraction?: boolean
}

/**
 * Order matters: the keys the product READS come first, because those are the
 * ones a person entering data should reach for. Documentation-only keys follow.
 */
export const ASSUMPTION_KEY_OPTIONS: readonly AssumptionKeyOption[] = [
  // ── read by a scenario lever, per company ───────────────────────────
  { key: "import_share", labelKey: "import_share", category: "fx", unit: "%", readBy: "scenario", fraction: true },
  { key: "cost_rigidity", labelKey: "cost_rigidity", category: "operations", unit: "%", readBy: "scenario", fraction: true },
  // ── read as a baseline when the live feed has no level ──────────────
  { key: "fx_usd", labelKey: "fx_usd", category: "fx", unit: "AZN", readBy: "anchor" },
  { key: "fx_eur", labelKey: "fx_eur", category: "fx", unit: "AZN", readBy: "anchor" },
  // ── stored and shown, but no calculation reads them yet ─────────────
  { key: "inflation", labelKey: "inflation", category: "inflation", unit: "%", readBy: "none", fraction: true },
  { key: "price_growth", labelKey: "price_growth", category: "pricing", unit: "%", readBy: "none", fraction: true },
  { key: "wage_growth", labelKey: "wage_growth", category: "hr", unit: "%", readBy: "none", fraction: true },
  { key: "tax_rate", labelKey: "tax_rate", category: "tax", unit: "%", readBy: "none", fraction: true },
  { key: "vat_rate", labelKey: "vat_rate", category: "tax", unit: "%", readBy: "none", fraction: true },
  { key: "interest_rate", labelKey: "interest_rate", category: "finance", unit: "%", readBy: "none", fraction: true },
  { key: "discount_rate", labelKey: "discount_rate", category: "finance", unit: "%", readBy: "none", fraction: true },
  { key: "fx_try", labelKey: "fx_try", category: "fx", unit: "AZN", readBy: "none" },
  { key: "fx_rub", labelKey: "fx_rub", category: "fx", unit: "AZN", readBy: "none" },
  { key: "yield_per_ha", labelKey: "yield_per_ha", category: "operations", unit: "ton", readBy: "none" },
  { key: "capacity_utilization", labelKey: "capacity_utilization", category: "operations", unit: "%", readBy: "none", fraction: true },
]

/** Sentinel for "my own key" — the escape hatch, not the default. */
export const CUSTOM_ASSUMPTION_KEY = "__custom__"

export function findAssumptionKeyOption(key: string): AssumptionKeyOption | null {
  return ASSUMPTION_KEY_OPTIONS.find((o) => o.key === key) ?? null
}

/** Keys grouped for the picker: read-by-something first, then the rest. */
export function groupedAssumptionKeys(): {
  active: AssumptionKeyOption[]
  documentationOnly: AssumptionKeyOption[]
} {
  return {
    active: ASSUMPTION_KEY_OPTIONS.filter((o) => o.readBy !== "none"),
    documentationOnly: ASSUMPTION_KEY_OPTIONS.filter((o) => o.readBy === "none"),
  }
}
