/**
 * ScenarioPanel i18n parity guard.
 *
 * ScenarioPanel was fully i18n'd (terminal.scenarioPanel.* chrome + the
 * terminal.scenarioDesc.<code> per-scenario detail copy). The real drift risk
 * going forward is asymmetry: add a scenario/string to en.json and forget ru/az
 * (next-intl would silently fall back to the key/English). This locks:
 *   1. identical leaf-key sets across en/ru/az for both namespaces,
 *   2. no empty values in any locale,
 *   3. the per-scenario descriptions are genuinely translated (ru/az ≠ en) while
 *      domain tokens (indicator codes, FAO/Brent, numeric anchors) are preserved.
 */
import { describe, it, expect } from 'vitest';
import enJson from '../../../../messages/en.json';
import ruJson from '../../../../messages/ru.json';
import azJson from '../../../../messages/az.json';

type Dict = Record<string, unknown>;
const en = enJson as Dict;
const ru = ruJson as Dict;
const az = azJson as Dict;

function sub(j: Dict, path: readonly string[]): Dict {
  let cur: unknown = j;
  for (const k of path) cur = (cur as Dict | undefined)?.[k];
  return (cur ?? {}) as Dict;
}

/** Flatten nested object → sorted dotted leaf-key paths. */
function leafKeys(o: Dict, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...leafKeys(v as Dict, p));
    else out.push(p);
  }
  return out.sort();
}

function leafValue(d: Dict, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((a, k) => (a as Dict | undefined)?.[k], d);
}

describe('Terminal i18n parity (scenario panel/form + sweep namespaces)', () => {
  for (const ns of [
    'scenarioPanel',
    'scenarioDesc',
    'scenarioForm',
    'signalsStrip',
    'strategicContext',
    'impactForecasts',
  ] as const) {
    const enKeys = leafKeys(sub(en, ['terminal', ns]));
    const ruKeys = leafKeys(sub(ru, ['terminal', ns]));
    const azKeys = leafKeys(sub(az, ['terminal', ns]));

    it(`${ns}: en defines keys`, () => {
      expect(enKeys.length).toBeGreaterThan(0);
    });
    it(`${ns}: ru key set matches en`, () => {
      expect(ruKeys).toEqual(enKeys);
    });
    it(`${ns}: az key set matches en`, () => {
      expect(azKeys).toEqual(enKeys);
    });
    it(`${ns}: no empty values in any locale`, () => {
      for (const [label, j] of [['en', en], ['ru', ru], ['az', az]] as const) {
        const d = sub(j, ['terminal', ns]);
        for (const key of leafKeys(d)) {
          const v = leafValue(d, key);
          expect(
            typeof v === 'string' && v.trim().length > 0,
            `${label}.terminal.${ns}.${key} must be a non-empty string`,
          ).toBe(true);
        }
      }
    });
  }

  it('scenarioDesc is genuinely translated while domain tokens are preserved', () => {
    const code = 'SUGAR_PRICE_TO_70';
    const descEn = sub(en, ['terminal', 'scenarioDesc'])[code] as string;
    const descRu = sub(ru, ['terminal', 'scenarioDesc'])[code] as string;
    const descAz = sub(az, ['terminal', 'scenarioDesc'])[code] as string;

    // Actually translated, not an English copy.
    expect(descRu).not.toBe(descEn);
    expect(descAz).not.toBe(descEn);
    expect(/[А-Яа-я]/.test(descRu)).toBe(true); // RU Cyrillic present

    // Domain tokens / numeric anchors kept untranslated in every locale.
    for (const d of [descEn, descRu, descAz]) {
      expect(d).toContain('FAO');
      expect(d).toContain('70');
    }
  });

  it('costRigidity / indicator codes survive translation (DROUGHT_2026)', () => {
    const descRu = sub(ru, ['terminal', 'scenarioDesc']).DROUGHT_2026 as string;
    expect(descRu).toContain('costRigidity 0.8');
    expect(/[А-Яа-я]/.test(descRu)).toBe(true);
  });
});
