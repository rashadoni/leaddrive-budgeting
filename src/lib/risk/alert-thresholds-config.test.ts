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
