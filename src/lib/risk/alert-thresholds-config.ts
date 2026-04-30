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
 * Per-rule threshold shape (without per-sector overrides). Every key is
 * OPTIONAL — `undefined` falls back to its default. Used as the value
 * type for both org-wide config AND each per-sector override slot under
 * `bySector` (v3 below). Lifting into a named sub-schema lets v3 nest it
 * without inadvertent infinite recursion.
 *
 * Adding a new rule = add a new optional key here + add its default to
 * `DEFAULT_ALERT_THRESHOLDS` + read from config in the rule's `match()`.
 * No DB schema migration ever needed.
 */
const alertThresholdsBaseSchema = z.object({
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

/**
 * Phase 7.E C6 v3 — full config schema with optional per-sector
 * overrides. Stored in `Organization.settings.alertThresholds: Json`
 * (no migration — same field as v2; Zod schema extension is
 * forward-compatible). Per-sector overrides apply ONLY to sector-aware
 * rules (`sectorAmber`, `sectorRedSpread`) — see `resolveForSector`
 * below for the merge contract.
 *
 * v3 example shape:
 * {
 *   sectorAmber: { amberCountMin: 5 },              // org-wide default
 *   bySector: {
 *     hospitality: { sectorAmber: { amberCountMin: 8 } },  // looser
 *     industrial:  { sectorRedSpread: { redCountMin: 4, companyCountMin: 3 } },
 *   },
 * }
 *
 * `bySector` keys mirror canonical industry codes (`hospitality`,
 * `industrial`, `agro_crops`, …); unknown keys are accepted by the schema
 * (no runtime FK to the Industry catalog) but `resolveForSector` only
 * surfaces them when an actual industry match fires. Misspelled keys
 * become silently dead overrides — defended by the seed-load layer in v3
 * follow-up if/when sector-set drift becomes a real issue.
 */
export const alertThresholdsConfigSchema = alertThresholdsBaseSchema.extend({
  bySector: z.record(z.string(), alertThresholdsBaseSchema).optional(),
});

/** Just the per-rule shape, without `bySector`. Exported for callers
 *  that consume the resolved-per-sector view. */
export type AlertThresholdsBase = z.infer<typeof alertThresholdsBaseSchema>;

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
 * and return a fully-resolved org-wide config with defaults filled in
 * for every missing key. Pure function — does NOT validate; pre-validate
 * with `alertThresholdsConfigSchema.parse()` at the API boundary.
 *
 * Ignores `partial.bySector` — v3 per-sector overrides are surfaced via
 * `resolveForSector` when a sector-aware rule fires for a specific
 * industry. The org-wide config is the fallback layer; sector overrides
 * narrow it.
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
 * Phase 7.E C6 v3 — resolve thresholds for a SPECIFIC sector by layering
 * `partial.bySector[industry]` over `partial` (org-wide) over
 * `DEFAULT_ALERT_THRESHOLDS`. Used by sector-aware rules
 * (`RULE_SECTOR_AMBER_CLUSTER`, `RULE_SECTOR_RED_SPREAD`) so a hospitality
 * cluster can use a different amber threshold than an industrial one.
 *
 * Merge precedence (high → low): sector override → org-wide → default.
 * Each rule slice merges INDEPENDENTLY — supplying only `sectorAmber`
 * for hospitality doesn't reset hospitality's `sectorRedSpread` to org-
 * wide; per-rule keys merge per-rule.
 *
 * `industry` is a canonical industry code; unknown / missing keys fall
 * through to org-wide. Empty `bySector` map = same result as
 * `mergeWithDefaults`.
 *
 * v3 deliberately ONLY exposes per-sector slots for sector-aware rules.
 * Per-sector `mostlyRed` / `criticalComposite` / `criticalIndicator`
 * would be meaningless (those rules already iterate per-company; sector
 * is ambiguous) — but the schema accepts them silently for forward
 * compatibility. Today they are merged but unused; future v3.1 might
 * widen rule semantics to consume them.
 */
export function resolveForSector(
  partial: AlertThresholdsConfig | undefined | null,
  industry: string,
): ResolvedAlertThresholds {
  const orgWide = mergeWithDefaults(partial);
  const sectorOverride = partial?.bySector?.[industry];
  if (!sectorOverride) return orgWide;
  return {
    mostlyRed: sectorOverride.mostlyRed ?? orgWide.mostlyRed,
    criticalComposite:
      sectorOverride.criticalComposite ?? orgWide.criticalComposite,
    sectorAmber: sectorOverride.sectorAmber ?? orgWide.sectorAmber,
    sectorRedSpread: sectorOverride.sectorRedSpread ?? orgWide.sectorRedSpread,
    criticalIndicator:
      sectorOverride.criticalIndicator ?? orgWide.criticalIndicator,
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
