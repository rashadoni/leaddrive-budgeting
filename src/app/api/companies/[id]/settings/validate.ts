/**
 * Phase 7.I — Zod schemas for per-industry `Company.settings` JSON.
 *
 * Each industry has its own shape (hectares only makes sense for agro,
 * totalRooms only for hospitality). The PATCH endpoint dispatches by
 * `company.industry` and validates the body against the matching schema
 * before persisting. Unknown industry → generic free-form pass-through
 * (capped to 32 keys × 256-char values, defensive against accidental
 * blob upload).
 *
 * Why not one mega-schema with optional fields everywhere: lets
 * `company.settings.hectaresPlanted` mean ONLY "planted hectares" and
 * never accidentally land on a hotel company. Per-industry partitioning
 * makes the LLM context (variance-explainer + board-deck) reliable.
 */

import { z } from "zod"

// Allowed regions for `agro_crops` — must match the weather adapter's
// region table (`WEATHER_REGIONS` in commodity/weather-openmeteo.ts) so
// the resolver can find IntelDataPoint rows. Adding a region = update
// both this enum AND the adapter constant.
//
// Session 9 expansion: added Yevlax / Şəmkir / Füzuli / Ağcabədi /
// Beyləqan after AzerSheker's Farming KPI sheet showed EDEN + FARM
// operate in 8 farming areas (not just the 3-region sugar belt).
export const AGRO_REGIONS = [
  "salyan",
  "imishli",
  "sabirabad",
  "yevlax",
  "shamkir",
  "fuzuli",
  "agjabedi",
  "beylaqan",
  "other",
] as const
export type AgroRegion = (typeof AGRO_REGIONS)[number]

export const AGRO_CROP_TYPES = [
  "sugarcane",
  "sugar_beet",
  "wheat",
  "corn",
  "cotton",
  "rice",
  "other",
] as const
export type AgroCropType = (typeof AGRO_CROP_TYPES)[number]

export const FP_MAIN_COMMODITIES = [
  "sugarcane",
  "sugar_beet",
  "wheat",
  "corn",
  "fruit",
  "vegetable",
  "dairy",
  "meat",
  "other",
] as const
export type FpMainCommodity = (typeof FP_MAIN_COMMODITIES)[number]

export const HospitalitySettingsSchema = z
  .object({
    totalRooms: z.number().int().min(1).max(10_000).optional(),
    seasonalityProfile: z
      .enum(["summer_peak", "winter_peak", "year_round", "weekday_only"])
      .optional(),
    region: z.string().min(1).max(60).optional(),
  })
  // strict() so an agro field posted to a hospitality company fails loudly
  // instead of silently dropping (which would create cross-industry leakage
  // in the LLM prompt downstream).
  .strict()

export const AgroCropsSettingsSchema = z
  .object({
    hectaresPlanted: z.number().min(0).max(200_000).optional(),
    region: z.enum(AGRO_REGIONS).optional(),
    cropType: z.enum(AGRO_CROP_TYPES).optional(),
    /** Yield target for the planted crop (tons/ha). Drives hint text in
     *  the AI explainer ("target 65 t/ha, came in at 58 t/ha — investigate"). */
    yieldTarget: z.number().min(0).max(200).optional(),
  })
  .strict()

export const FoodProcessingSettingsSchema = z
  .object({
    processingCapacityTonsYr: z.number().min(0).max(10_000_000).optional(),
    extractionRateTarget: z.number().min(0).max(100).optional(),
    mainInputCommodity: z.enum(FP_MAIN_COMMODITIES).optional(),
  })
  .strict()

/**
 * Generic fallback for industries without a hardened schema. Allows up
 * to 32 string/number/boolean keys. Defensive against accidental
 * megablob uploads while still allowing future per-industry fields to
 * land without a code change.
 */
const PRIMITIVE = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
export const GenericSettingsSchema = z
  .record(z.string().min(1).max(48), PRIMITIVE)
  .refine((obj) => Object.keys(obj).length <= 32, {
    message: "Settings exceeds 32 keys",
  })

/**
 * Select the right schema for a company's industry. Unknown industry =
 * generic fallback. Pure helper — no DB, no side effects.
 */
export function settingsSchemaForIndustry(
  industry: string | null | undefined,
): z.ZodType<Record<string, unknown>> {
  switch (industry) {
    case "hospitality":
      return HospitalitySettingsSchema
    case "agro_crops":
      return AgroCropsSettingsSchema
    case "food_processing":
      return FoodProcessingSettingsSchema
    default:
      return GenericSettingsSchema
  }
}

export type AgroSettings = z.infer<typeof AgroCropsSettingsSchema>
export type HospitalitySettings = z.infer<typeof HospitalitySettingsSchema>
export type FoodProcessingSettings = z.infer<typeof FoodProcessingSettingsSchema>
