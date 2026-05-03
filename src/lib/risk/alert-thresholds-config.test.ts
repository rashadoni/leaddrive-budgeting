/**
 * Phase 7.E C6 v2 — alert-thresholds-config unit tests.
 *
 * Locks the Zod schema, defaults, merge semantics, and the read-from-
 * org-settings tolerance contract (must never throw on malformed input).
 */

import { describe, it, expect } from 'vitest';
import {
  alertThresholdsConfigSchema,
  DEFAULT_ALERT_THRESHOLDS,
  mergeWithDefaults,
  readAlertThresholdsFromOrgSettings,
  resolveForSector,
} from './alert-thresholds-config';

describe('DEFAULT_ALERT_THRESHOLDS', () => {
  it('matches the v1 hardcoded constants byte-for-byte', () => {
    // Sub-9 contract: an org with empty settings sees identical behavior
    // to v1. If anyone changes a default here without intent, this test
    // fails and forces them to think about whether they meant to.
    expect(DEFAULT_ALERT_THRESHOLDS).toEqual({
      mostlyRed: { redCountMin: 3 },
      criticalComposite: { scoreMax: 40 },
      sectorAmber: { amberCountMin: 5 },
      sectorRedSpread: { redCountMin: 3, companyCountMin: 2 },
      criticalIndicator: { indicatorCode: 'IND_NET_MARGIN', redCountMin: 3 },
    });
  });
});

describe('alertThresholdsConfigSchema (Zod)', () => {
  it('accepts an empty object (everything optional)', () => {
    const parsed = alertThresholdsConfigSchema.parse({});
    expect(parsed).toEqual({});
  });

  it('accepts a fully populated config', () => {
    const config = {
      mostlyRed: { redCountMin: 4 },
      criticalComposite: { scoreMax: 50 },
      sectorAmber: { amberCountMin: 7 },
      sectorRedSpread: { redCountMin: 4, companyCountMin: 3 },
      criticalIndicator: { indicatorCode: 'IND_GROSS_MARGIN', redCountMin: 4 },
    };
    expect(alertThresholdsConfigSchema.parse(config)).toEqual(config);
  });

  it('rejects fractional thresholds', () => {
    expect(() =>
      alertThresholdsConfigSchema.parse({ mostlyRed: { redCountMin: 3.5 } }),
    ).toThrow();
  });

  it('rejects redCountMin below 1', () => {
    expect(() =>
      alertThresholdsConfigSchema.parse({ mostlyRed: { redCountMin: 0 } }),
    ).toThrow();
  });

  it('rejects companyCountMin below 2 (sector spread requires 2+ cos by definition)', () => {
    expect(() =>
      alertThresholdsConfigSchema.parse({
        sectorRedSpread: { redCountMin: 3, companyCountMin: 1 },
      }),
    ).toThrow();
  });

  it('rejects scoreMax above 100 (composite range is 0-100)', () => {
    expect(() =>
      alertThresholdsConfigSchema.parse({
        criticalComposite: { scoreMax: 150 },
      }),
    ).toThrow();
  });

  it('rejects empty indicatorCode', () => {
    expect(() =>
      alertThresholdsConfigSchema.parse({
        criticalIndicator: { indicatorCode: '', redCountMin: 3 },
      }),
    ).toThrow();
  });
});

describe('mergeWithDefaults', () => {
  it('returns full defaults for undefined input', () => {
    expect(mergeWithDefaults(undefined)).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('returns full defaults for null input', () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('returns full defaults for empty object', () => {
    expect(mergeWithDefaults({})).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('overrides only the keys present, keeps defaults for others', () => {
    const merged = mergeWithDefaults({ mostlyRed: { redCountMin: 7 } });
    expect(merged.mostlyRed).toEqual({ redCountMin: 7 });
    expect(merged.criticalComposite).toEqual(DEFAULT_ALERT_THRESHOLDS.criticalComposite);
    expect(merged.sectorAmber).toEqual(DEFAULT_ALERT_THRESHOLDS.sectorAmber);
    expect(merged.sectorRedSpread).toEqual(DEFAULT_ALERT_THRESHOLDS.sectorRedSpread);
    expect(merged.criticalIndicator).toEqual(DEFAULT_ALERT_THRESHOLDS.criticalIndicator);
  });

  it('full override yields full custom values (no leakage from defaults)', () => {
    const full = {
      mostlyRed: { redCountMin: 4 },
      criticalComposite: { scoreMax: 55 },
      sectorAmber: { amberCountMin: 6 },
      sectorRedSpread: { redCountMin: 4, companyCountMin: 3 },
      criticalIndicator: { indicatorCode: 'IND_GROSS_MARGIN', redCountMin: 4 },
    };
    expect(mergeWithDefaults(full)).toEqual(full);
  });
});

describe('readAlertThresholdsFromOrgSettings', () => {
  it('returns defaults for null settings', () => {
    expect(readAlertThresholdsFromOrgSettings(null)).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('returns defaults for undefined settings', () => {
    expect(readAlertThresholdsFromOrgSettings(undefined)).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('returns defaults when settings has no alertThresholds key', () => {
    expect(readAlertThresholdsFromOrgSettings({ otherKey: 'x' })).toEqual(
      DEFAULT_ALERT_THRESHOLDS,
    );
  });

  it('returns defaults when settings.alertThresholds is null', () => {
    expect(
      readAlertThresholdsFromOrgSettings({ alertThresholds: null }),
    ).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('reads valid alertThresholds and merges with defaults', () => {
    const settings = {
      alertThresholds: { mostlyRed: { redCountMin: 5 } },
    };
    const result = readAlertThresholdsFromOrgSettings(settings);
    expect(result.mostlyRed.redCountMin).toBe(5);
    expect(result.criticalComposite).toEqual(DEFAULT_ALERT_THRESHOLDS.criticalComposite);
  });

  it('falls back to defaults on malformed alertThresholds (never throws)', () => {
    // Malformed: redCountMin negative. Schema rejects → defensive read
    // returns full defaults rather than throwing.
    const settings = {
      alertThresholds: { mostlyRed: { redCountMin: -1 } },
    };
    expect(() => readAlertThresholdsFromOrgSettings(settings)).not.toThrow();
    expect(readAlertThresholdsFromOrgSettings(settings)).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('falls back to defaults when alertThresholds is a non-object', () => {
    expect(
      readAlertThresholdsFromOrgSettings({ alertThresholds: 'not-an-object' }),
    ).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });

  it('handles a non-object settings value (string / number)', () => {
    expect(readAlertThresholdsFromOrgSettings('garbage')).toEqual(
      DEFAULT_ALERT_THRESHOLDS,
    );
    expect(readAlertThresholdsFromOrgSettings(42)).toEqual(DEFAULT_ALERT_THRESHOLDS);
  });
});

// --- Phase 7.E C6 v3 — per-sector overrides ---------------------------------

describe('alertThresholdsConfigSchema — bySector (C6 v3)', () => {
  it('accepts bySector with per-industry override slots', () => {
    const r = alertThresholdsConfigSchema.safeParse({
      sectorAmber: { amberCountMin: 5 },
      bySector: {
        hospitality: { sectorAmber: { amberCountMin: 8 } },
        industrial: {
          sectorRedSpread: { redCountMin: 4, companyCountMin: 3 },
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects bySector with malformed override (e.g. non-int amberCountMin)', () => {
    const r = alertThresholdsConfigSchema.safeParse({
      bySector: {
        hospitality: { sectorAmber: { amberCountMin: 1.5 } }, // not int
      },
    });
    expect(r.success).toBe(false);
  });

  it('omits bySector → backward-compat with v2 shape', () => {
    const r = alertThresholdsConfigSchema.safeParse({
      sectorAmber: { amberCountMin: 5 },
    });
    expect(r.success).toBe(true);
  });

  it('accepts unknown industry key in bySector (no FK to Industry catalog)', () => {
    // The schema doesn't enforce known industry codes — runtime drift
    // would silently dead-code the override. Architect noted "defended
    // by seed-load layer in v3 follow-up if needed". For now, schema is
    // permissive: a typo just means the override never fires.
    const r = alertThresholdsConfigSchema.safeParse({
      bySector: { typo_sector: { sectorAmber: { amberCountMin: 9 } } },
    });
    expect(r.success).toBe(true);
  });

  it('rejects org-wide-only rule slots inside bySector (sub-43 architect closure)', () => {
    // Sub-43 architect Round-1 closure — earlier iteration accepted the
    // full base schema inside bySector "for forward compat with v3.1".
    // Architect flagged: forward-compat at the cost of silent
    // misconfiguration. Strict schema today; widen when v3.1 makes an
    // org-wide rule sector-aware.
    const r1 = alertThresholdsConfigSchema.safeParse({
      bySector: { hospitality: { mostlyRed: { redCountMin: 5 } } },
    });
    expect(r1.success).toBe(false);

    const r2 = alertThresholdsConfigSchema.safeParse({
      bySector: { hospitality: { criticalComposite: { scoreMax: 50 } } },
    });
    expect(r2.success).toBe(false);

    const r3 = alertThresholdsConfigSchema.safeParse({
      bySector: {
        hospitality: {
          criticalIndicator: { indicatorCode: 'IND_X', redCountMin: 3 },
        },
      },
    });
    expect(r3.success).toBe(false);

    // Sector-aware rules ARE accepted inside bySector.
    const r4 = alertThresholdsConfigSchema.safeParse({
      bySector: {
        hospitality: { sectorAmber: { amberCountMin: 8 } },
        industrial: { sectorRedSpread: { redCountMin: 4, companyCountMin: 3 } },
      },
    });
    expect(r4.success).toBe(true);
  });
});

describe('resolveForSector', () => {
  it('industry with override returns sector-tuned thresholds', () => {
    const r = resolveForSector(
      {
        sectorAmber: { amberCountMin: 5 },
        bySector: {
          hospitality: { sectorAmber: { amberCountMin: 8 } },
        },
      },
      'hospitality',
    );
    expect(r.sectorAmber.amberCountMin).toBe(8);
  });

  it('industry WITHOUT override falls back to org-wide', () => {
    const r = resolveForSector(
      {
        sectorAmber: { amberCountMin: 5 },
        bySector: {
          hospitality: { sectorAmber: { amberCountMin: 8 } },
        },
      },
      'industrial',
    );
    expect(r.sectorAmber.amberCountMin).toBe(5);
  });

  it('industry with no bySector at all → org-wide (back-compat)', () => {
    const r = resolveForSector(
      { sectorAmber: { amberCountMin: 5 } },
      'hospitality',
    );
    expect(r.sectorAmber.amberCountMin).toBe(5);
  });

  it('null partial → defaults for any industry', () => {
    expect(resolveForSector(null, 'hospitality')).toEqual(DEFAULT_ALERT_THRESHOLDS);
    expect(resolveForSector(undefined, 'industrial')).toEqual(
      DEFAULT_ALERT_THRESHOLDS,
    );
  });

  it('partial sector override merges per-rule (sectorAmber overridden, sectorRedSpread inherits org-wide)', () => {
    // Critical contract: supplying only sectorAmber for hospitality
    // doesn't reset hospitality's sectorRedSpread to defaults — it
    // inherits the org-wide value. Per-rule keys merge per-rule.
    const r = resolveForSector(
      {
        sectorAmber: { amberCountMin: 5 },
        sectorRedSpread: { redCountMin: 7, companyCountMin: 4 },
        bySector: {
          hospitality: { sectorAmber: { amberCountMin: 8 } },
          // hospitality intentionally has NO sectorRedSpread override
        },
      },
      'hospitality',
    );
    expect(r.sectorAmber.amberCountMin).toBe(8); // sector override
    expect(r.sectorRedSpread.redCountMin).toBe(7); // org-wide inherited
    expect(r.sectorRedSpread.companyCountMin).toBe(4); // org-wide inherited
  });

  it('sector override overrides multiple rule slices independently', () => {
    const r = resolveForSector(
      {
        bySector: {
          industrial: {
            sectorAmber: { amberCountMin: 12 },
            sectorRedSpread: { redCountMin: 6, companyCountMin: 3 },
          },
        },
      },
      'industrial',
    );
    expect(r.sectorAmber.amberCountMin).toBe(12);
    expect(r.sectorRedSpread.redCountMin).toBe(6);
    expect(r.sectorRedSpread.companyCountMin).toBe(3);
    // Non-sector slices fall through to defaults.
    expect(r.mostlyRed).toEqual(DEFAULT_ALERT_THRESHOLDS.mostlyRed);
    expect(r.criticalComposite).toEqual(DEFAULT_ALERT_THRESHOLDS.criticalComposite);
  });

  it('readAlertThresholdsFromOrgSettings preserves bySector through the safe-read path', () => {
    // The tolerant reader at API/evaluator boundary must not strip
    // bySector overrides during its safeParse pass.
    const settings = {
      alertThresholds: {
        sectorAmber: { amberCountMin: 5 },
        bySector: { hospitality: { sectorAmber: { amberCountMin: 9 } } },
      },
    };
    const orgWide = readAlertThresholdsFromOrgSettings(settings);
    // mergeWithDefaults ignores bySector — orgWide is the org-wide layer.
    expect(orgWide.sectorAmber.amberCountMin).toBe(5);
    // But the original settings JSON must still carry bySector for
    // resolveForSector to consume. Re-parse from raw settings:
    const raw = (settings as Record<string, unknown>).alertThresholds;
    const sectorR = resolveForSector(
      raw as Parameters<typeof resolveForSector>[0],
      'hospitality',
    );
    expect(sectorR.sectorAmber.amberCountMin).toBe(9);
  });
});
