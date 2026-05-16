/**
 * Phase 2.2 step 2 — manufacturing-tenant cost-type catalog.
 *
 * Extracted from `import-excel/route.ts` inline `COST_TYPE_DEFS` array
 * (Phase 2.2 step 1 followed the same pattern for product catalog at
 * `aac-products.ts`). Unlike the product catalog, this list is more
 * tenant-general — the 13 categories (staff / utilities / services /
 * etc.) apply across most manufacturing tenants, not just AAC.
 *
 * Bilingual labels are AZ-primary with English in parentheses
 * ("İşçi heyəti xərcləri (Staff costs)") because the source xlsx
 * exports use Azerbaijani as the canonical column header — keeping
 * the English helps non-AZ-speaking developers (and future AI mapper
 * passes) recognise the category.
 *
 * Phase 2.2 step 2+ direction (separate turn): per-locale label
 * structure on a `BudgetCostType { nameAz, nameEn, nameRu }` field
 * (similar to `Industry` / `ChartOfAccount` pattern), with this
 * compile-time list as the seed source. The current single-string
 * `label` is a working compromise until the schema migration lands.
 *
 * Phase 5 multi-tenant SaaS migration: catalog moves from compile-
 * time TypeScript to runtime DB rows on `BudgetCostType` (already in
 * the schema as a per-org table) — the seeding can read from this
 * file once, then orgs customise via UI. This file is a stable
 * interface; it is not the source of truth at Phase 5+.
 */

/** Single cost-type entry. `key` is the stable internal identifier
 *  used by the mapper + cost-model resolver paths; `label` is the
 *  AZ-primary display string; `sortOrder` drives canonical row
 *  ordering on the P&L grid. */
export interface CostTypeDef {
  readonly key: string;
  readonly label: string;
  readonly sortOrder: number;
}

/** 13 manufacturing cost-type categories from the AAC P&L structure.
 *  Order is significant — `sortOrder` indices come from the source
 *  xlsx column-order convention. Reordering requires coordinated
 *  updates to the seed scripts that key off `sortOrder` for canonical
 *  P&L row layout.
 *
 *  Architect Turn-LV Проблема fix: NO explicit `readonly CostTypeDef[]`
 *  annotation here — that would widen the inferred type and make
 *  `CostTypeKey` (derived below via `(typeof COST_TYPE_DEFS)[number]
 *  ["key"]`) resolve to plain `string` instead of the literal union.
 *  The `as const` assertion below is what propagates the literal-key
 *  narrowing to consumers. */
export const COST_TYPE_DEFS = [
  { key: "staff", label: "İşçi heyəti xərcləri (Staff costs)", sortOrder: 1 },
  { key: "utilities", label: "Kommunal xərclər (Utilities)", sortOrder: 2 },
  { key: "services", label: "Alınmış xidmətlər (Services)", sortOrder: 3 },
  { key: "communication", label: "Rabitə xərcləri (Communication)", sortOrder: 4 },
  { key: "maintenance", label: "Təmir-istismar xərcləri (Maintenance)", sortOrder: 5 },
  { key: "materials", label: "Mal-materiallar (Materials)", sortOrder: 6 },
  { key: "transport", label: "Nəqliyyat xərcləri (Transport)", sortOrder: 7 },
  { key: "other_expense", label: "Digər xərclər (Other expenses)", sortOrder: 8 },
  { key: "marketing", label: "Marketinq xərcləri (Marketing)", sortOrder: 9 },
  { key: "finance", label: "Maliyyə xərcləri (Finance costs)", sortOrder: 10 },
  { key: "non_operating", label: "Qeyri-əməliyyat xərcləri (Non-operating)", sortOrder: 11 },
  { key: "tax", label: "Vergilər (Taxes)", sortOrder: 12 },
  { key: "depreciation", label: "Amortizasiya (Depreciation)", sortOrder: 13 },
] as const;

/** Convenience: snake_case stable keys exported as a typed union for
 *  callers that want narrow type narrowing on the cost-type key. */
export type CostTypeKey = (typeof COST_TYPE_DEFS)[number]["key"];
