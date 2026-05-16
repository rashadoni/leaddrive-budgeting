/**
 * Phase 2.2 step 1 — AAC-tenant-specific product catalog constants.
 *
 * Background: `import-excel/route.ts` (the legacy full-xlsx P&L import
 * for AAC) hardcoded a 6-product catalog inline (PRODUCT_CODES +
 * PRODUCT_NAMES + PRODUCT_UNITS + SALES_SHEETS). Architectural debt #3
 * from CLAUDE.md called this out: "Import has hardcoded Azerbaijani
 * strings + AAC product codes." Step 1 of the cleanup is module
 * extraction — making the AAC-specific nature explicit in the file
 * name (a generic-looking `import-excel/route.ts` was hiding a
 * tenant-specific contract).
 *
 * Phase 2.2 step 2+ (separate turns): per-tenant parallel modules
 * (`fo-products.ts`, `azmade-products.ts`, ...) + a tenant-resolution
 * helper that picks the right catalog from `org.settings`. The legacy
 * route can then call into the helper instead of importing this module
 * directly. For now (single-tenant AAC import), the direct import is
 * the right shape.
 *
 * Multi-tenant SaaS migration plan (ROADMAP Phase 5): catalogs move
 * from compile-time TypeScript constants to runtime DB rows on the
 * `Organization.settings` JSON or a dedicated `ProductCatalog` model.
 * This file is a stable interface that the migration replaces, not
 * a dead-end string dump.
 */

/** Internal codes used as `productLineId` mnemonic + `chartOfAccount.code`
 *  prefix for cost roll-ups. Stable across imports — adding a 7th product
 *  requires a coordinated update to PRODUCT_NAMES + PRODUCT_UNITS arrays
 *  AND the cost-model resolver paths that key off these codes. */
export const PRODUCT_CODES = [
  "MHB",
  "LIME_BURNT",
  "LIME_SLAKED",
  "ADHESIVE",
  "UBLOCK",
  "LIME_WASTE",
] as const;

/** Display names for the 6 AAC products in Azerbaijani (the source-of-
 *  truth language for this tenant's xlsx exports). Index-aligned with
 *  `PRODUCT_CODES`. UI display in non-AZ locales should fall back to
 *  these strings until per-locale name fields land on `ProductLine`. */
export const PRODUCT_NAMES = [
  "MHB (Qaz beton)",
  "Yandırılmış əhəng",
  "Söndürülmüş əhəng",
  "Yapışqan",
  "U-block",
  "Tullantı əhəng",
] as const;

/** Units of measure (Azerbaijani conventions). Index-aligned with the
 *  CODES + NAMES arrays. `m3` for cubic-metre dry products, `ton` for
 *  bulk lime, `ədəd` for piece-counted block products. */
export const PRODUCT_UNITS = [
  "m3",
  "ton",
  "ton",
  "ədəd",
  "ədəd",
  "ton",
] as const;

/** Sales sheet identifiers in the AAC P&L xlsx — one per product. The
 *  legacy importer iterates these in lock-step with PRODUCT_CODES so
 *  index `i` of CODES matches `SALES_SHEETS[i]`. */
export const SALES_SHEETS = [
  "S-1",
  "S-2",
  "S-3",
  "S-4",
  "S-5",
  "S-6",
] as const;

export type AacProductCode = (typeof PRODUCT_CODES)[number];
