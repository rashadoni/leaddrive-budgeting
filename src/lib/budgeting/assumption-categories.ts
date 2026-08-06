/**
 * Assumption category display metadata — label, colour, icon.
 *
 * Phase 7.Q (2026-08-06) moved this out of `budget-assumptions.tsx`. The
 * editor dialog needs the same catalogue to populate its category picker, and
 * importing it from the tab component created a module cycle
 * (tab → editor → tab). The map is data, not a component, so a `lib` module is
 * where it belonged in the first place. `budget-assumptions.tsx` re-exports
 * every symbol, so existing importers are unaffected.
 *
 * ── original note, kept verbatim ─────────────────────────────────────────
 *
 * Sub-44 cont'd — collapsed 3 parallel `Record<string, string>` maps
 * (CATEGORY_LABELS / CATEGORY_COLORS / CATEGORY_ICONS) into a single
 * `Record<string, CategoryMeta>` to close sub-38 architect ⚠️.
 *
 * Why: the 3-map pattern was prone to drift — sub-35 (industry-code
 * leak) was the first miss; sub-38 (gray-fallback regression) was the
 * second; pattern would have recurred on every data-shape extension.
 * Single-entry shape forces every new category to bring all 3 fields
 * at compile time.
 *
 * Use `getCategoryMeta(cat)` for safe lookup (returns `DEFAULT_CATEGORY_META`
 * with the cat-as-label for unknown codes — keeps the fallback contract
 * the original maps had via `|| cat` / `|| "#9ca3af"` / `|| "📋"`).
 */
export interface CategoryMeta {
  label: string
  color: string
  icon: string
}

export const DEFAULT_CATEGORY_META: CategoryMeta = {
  label: "Other", // Caller supplies the cat string when label fallback matters.
  color: "#9ca3af",
  icon: "📋",
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  // Legacy product-line categories carried over from earlier tenant data
  // shapes. Keys are still in use as BudgetCategory.key in DB; renaming
  // would need a migration. Labels stay descriptive of the category kind.
  returns_transport: { label: "Returns & Transport", color: "#3b82f6", icon: "🚛" },
  mhb_transport: { label: "MHB/Lime Transport", color: "#2563eb", icon: "🏗️" },
  pallet_export: { label: "Pallets / Export", color: "#14b8a6", icon: "📦" },
  waste: { label: "Waste & Scrap", color: "#ef4444", icon: "♻️" },
  food: { label: "Food Costs", color: "#f59e0b", icon: "🍽️" },
  prepaid: { label: "Prepaid Expenses", color: "#84cc16", icon: "💳" },
  utilities: { label: "Utilities", color: "#8b5cf6", icon: "⚡" },
  mining: { label: "Mining", color: "#6b7280", icon: "⛏️" },
  repair: { label: "Repair & Maintenance", color: "#f97316", icon: "🔧" },
  mhb_recipe: { label: "Recipe (BOM)", color: "#a855f7", icon: "🧪" },
  labor_base: { label: "Labor (Base)", color: "#10b981", icon: "👷" },
  labor_summary: { label: "Labor (Summary)", color: "#059669", icon: "👥" },
  marketing: { label: "Marketing", color: "#ec4899", icon: "📢" },
  depreciation: { label: "Depreciation", color: "#06b6d4", icon: "📉" },
  other: { label: "Other", color: "#9ca3af", icon: "📋" },
  // Generic holding-wide FP&A categories. Without these the treemap +
  // donut + ranking bars all fall back to the gray default because the
  // data shape changed but the color map did not.
  operations: { label: "Operations", color: "#3b82f6", icon: "⚙️" }, // blue — primary ops backbone
  commercial: { label: "Commercial", color: "#f97316", icon: "🛒" }, // orange — sales / commerce
  finance: { label: "Finance", color: "#10b981", icon: "💰" },        // emerald — money / fin
  fx: { label: "FX / Currency", color: "#a855f7", icon: "💱" },       // purple — currency / FX
  hr: { label: "HR / People", color: "#14b8a6", icon: "👥" },         // teal — people
  pricing: { label: "Pricing", color: "#f59e0b", icon: "🏷️" },         // amber — pricing
  risk: { label: "Risk", color: "#ef4444", icon: "⚠️" },               // red — risk
  tax: { label: "Tax", color: "#6366f1", icon: "🏛️" },                 // indigo — formal / regulatory
  inflation: { label: "Inflation", color: "#ec4899", icon: "📈" },    // pink — macro / monetary
}

/**
 * Safe lookup for a category's display metadata. Returns the
 * registered entry when present; falls back to a synthesized entry
 * with the raw cat code as the label and the default gray + 📋 icon
 * (matches the legacy `CATEGORY_LABELS[cat] || cat` / `... || "#9ca3af"`
 * / `... || "📋"` semantics from the pre-consolidation maps).
 *
 * Pure / no React; testable without rendering the parent component.
 */
export function getCategoryMeta(cat: string): CategoryMeta {
  const entry = CATEGORY_META[cat]
  if (entry) return entry
  return { ...DEFAULT_CATEGORY_META, label: cat }
}
