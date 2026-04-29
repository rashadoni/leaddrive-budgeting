/**
 * Phase 7.E C6 v2 — externalised alert-rule thresholds.
 *
 * v1 of the alert engine (`alert-rules.ts`) hardcoded every threshold
 * inside each `RULE_*.match()` function: `>= 3 red`, `>= 5 amber`,
 * `< 40 composite`, the picklist indicator was a literal `'IND_NET_MARGIN'`.
 * That made every customer ride AAC-tuned defaults forever — architect
 * Round-1 sub-9 ⚠️ flagged the silent drift from the C6 plan, which had
 * promised tunable thresholds.
 *
 * This module is the source of truth for the *shape* of those thresholds
 * (Zod schema), the defaults that match v1 behavior 1:1, and the merge
 * helper that callers use to fill in missing keys. Storage lives in
 * `Organization.settings.alertThresholds: Json` — no schema migration
 * needed, the field already exists. Validation runs at the API boundary
 * (`PATCH /api/organizations/settings`) and again on read inside the
 * evaluator (defense-in-depth: a hand-crafted DB row stays type-safe).
 *
 * Defaults exactly match the v1 hardcoded constants so an org that never
 * configures anything sees zero behavior change. New rules added in
 * future versions follow the same pattern: optional key, default const,
 * merged on read.
 */

import { z } from 'zod';

/**
 * Per-rule threshold shape. Every key is OPTIONAL — `undefined` falls
 * back to its default. Adding a new rule = add a new optional key here
 * + add its default to `DEFAULT_ALERT_THRESHOLDS` + read from config in
 * the rule's `match()`. No schema migration ever needed.
 */
export const alertThresholdsConfigSchema = z.object({
  mostlyRed: z
    .object({
      redCountMin: z.number().int().min(1).max(80),
    })
    .optional(),
  criticalComposite: z
    .object({
      scoreMax: z.number().int().min(1).max(100),
    })
    .optional(),
  sectorAmber: z
    .object({
      amberCountMin: z.number().int().min(1).max(200),
    })
    .optional(),
  sectorRedSpread: z
    .object({
      redCountMin: z.number().int().min(1).max(200),
      companyCountMin: z.number().int().min(2).max(60),
    })
    .optional(),
  criticalIndicator: z
    .object({
      /** Indicator code from the active IndicatorDefinition pool. */
      indicatorCode: z.string().min(1).max(64),
      redCountMin: z.number().int().min(1).max(60),
    })
    .optional(),
});

export type AlertThresholdsConfig = z.infer<typeof alertThresholdsConfigSchema>;

/**
 * Fully-resolved config (every key defined). What the evaluator actually
 * reads — produced by `mergeWithDefaults` from a partial `AlertThresholdsConfig`.
 */
export interface ResolvedAlertThresholds {
  mostlyRed: { redCountMin: number };
  criticalComposite: { scoreMax: number };
  sectorAmber: { amberCountMin: number };
  sectorRedSpread: { redCountMin: number; companyCountMin: number };
  criticalIndicator: { indicatorCode: string; redCountMin: number };
}

/**
 * Defaults that reproduce v1 behavior exactly. Each value matches the
 * corresponding hardcoded constant from the original `alert-rules.ts`
 * (lines 187, 220, 259, 298, 320, 328 of pre-v2). An org with empty
 * settings sees identical alert output to v1.
 */
export const DEFAULT_ALERT_THRESHOLDS: ResolvedAlertThresholds = {
  mostlyRed: { redCountMin: 3 },
  criticalComposite: { scoreMax: 40 },
  sectorAmber: { amberCountMin: 5 },
  sectorRedSpread: { redCountMin: 3, companyCountMin: 2 },
  criticalIndicator: { indicatorCode: 'IND_NET_MARGIN', redCountMin: 3 },
};

/**
 * Take a partial / undefined config (from `Organization.settings.alertThresholds`)
 * and return a fully-resolved config with defaults filled in for every
 * missing key. Pure function — does NOT validate; pre-validate with
 * `alertThresholdsConfigSchema.parse()` at the API boundary.
 */
export function mergeWithDefaults(
  partial: AlertThresholdsConfig | undefined | null,
): ResolvedAlertThresholds {
  return {
    mostlyRed: partial?.mostlyRed ?? DEFAULT_ALERT_THRESHOLDS.mostlyRed,
    criticalComposite:
      partial?.criticalComposite ?? DEFAULT_ALERT_THRESHOLDS.criticalComposite,
    sectorAmber: partial?.sectorAmber ?? DEFAULT_ALERT_THRESHOLDS.sectorAmber,
    sectorRedSpread:
      partial?.sectorRedSpread ?? DEFAULT_ALERT_THRESHOLDS.sectorRedSpread,
    criticalIndicator:
      partial?.criticalIndicator ?? DEFAULT_ALERT_THRESHOLDS.criticalIndicator,
  };
}

/**
 * Read `alertThresholds` from an `Organization.settings` JSON blob and
 * return a fully-resolved config. Tolerant — anything that fails Zod
 * parse is treated as "not configured" → defaults. This is the safe
 * read path used by the evaluator on every matrix fetch; it must never
 * throw, since a malformed settings row would otherwise nuke the whole
 * alerts pipeline. Validation is the API's job; the evaluator just
 * reads sanely.
 */
export function readAlertThresholdsFromOrgSettings(
  orgSettings: unknown,
): ResolvedAlertThresholds {
  if (!orgSettings || typeof orgSettings !== 'object') {
    return mergeWithDefaults(undefined);
  }
  const raw = (orgSettings as Record<string, unknown>).alertThresholds;
  if (raw === undefined || raw === null) {
    return mergeWithDefaults(undefined);
  }
  const parsed = alertThresholdsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return mergeWithDefaults(undefined);
  }
  return mergeWithDefaults(parsed.data);
}
