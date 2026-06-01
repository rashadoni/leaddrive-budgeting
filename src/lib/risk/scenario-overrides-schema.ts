/**
 * Shared Zod schema for a Scenario's `overrides` payload — used by both the
 * create (POST /api/scenarios) and update (PATCH /api/scenarios/[id]) routes so
 * server-side validation stays in lockstep.
 *
 * A scenario's overrides are EITHER:
 *   - legacy multiplier form  → { adjustments: [{ codes, multiply|delta, note }] }
 *   - Phase-2 driver form      → { shock: ScenarioShock }
 *
 * Before 2026-06-01 the routes only accepted `adjustments`, so editing any
 * crisis/shock scenario (BRENT_TO_140, PRICE_DROP_40, DROUGHT_2026, …) through
 * the UI failed server validation with "Validation error" even though the
 * client + the simulate engine both accept `shock`. This schema closes that
 * gap and mirrors `ScenarioShock` / `isValidTarget` in `scenario-shock.ts`.
 */
import { z } from "zod";

export const AdjustmentSchema = z.object({
  codes: z.array(z.string().min(1)).min(1),
  multiply: z.number().positive().optional(),
  delta: z.number().optional(),
  note: z.string().max(256).optional(),
});

const ShockTargetSchema = z.object({
  metric: z.string().min(1),
  value: z.number().finite(),
  drives: z.enum(["fxShock", "priceShock", "inputCostShock"]),
});

const ShockSchema = z
  .object({
    revenueShock: z.number().optional(),
    priceShock: z.number().optional(),
    inputCostShock: z.number().optional(),
    fxShock: z.number().optional(),
    yieldShock: z.number().optional(),
    costRigidity: z.number().optional(),
    assumedImportShare: z.number().optional(),
    target: ShockTargetSchema.optional(),
  })
  .refine(
    (s) =>
      s.target != null ||
      [s.revenueShock, s.priceShock, s.inputCostShock, s.fxShock, s.yieldShock].some(
        (v) => typeof v === "number",
      ),
    { message: "shock must define a target or at least one lever" },
  );

const AdjustmentsOverrides = z.object({ adjustments: z.array(AdjustmentSchema).min(1) });
const ShockOverrides = z.object({ shock: ShockSchema });

/** Accepts the legacy `adjustments[]` form OR the Phase-2 `shock{}` form. */
export const ScenarioOverridesSchema = z.union([AdjustmentsOverrides, ShockOverrides]);
