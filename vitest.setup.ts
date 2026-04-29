/**
 * Vitest global setup — mock `next-intl` hooks so component tests don't
 * need NextIntlClientProvider wrapping. Translation lookups return the
 * key itself, locale defaults to 'en'. Sub-27 cont'd: introduced when
 * terminal panels gained `useTranslations()` calls in multi-lingual MVP.
 *
 * Tests that depend on specific translated strings should mock per-file
 * (override the setup-level mock) — but most tests assert structure,
 * data binding, and event behavior, not exact label text.
 */

import { vi } from 'vitest';

// Provides a deterministic test fallback: takes the LAST dot-segment of the
// key, splits camelCase to spaced words, uppercases it. Most label strings
// in the messages files (`HOTKEYS`, `NEW PLAN`, `ALERTS`, `ALL`, etc) follow
// this convention, so existing string-match tests work without per-file
// mock overrides. For keys where the test wants a specific phrase, the
// dictionary below provides explicit mappings.
const EXPLICIT_LABELS: Record<string, string> = {
  'companyTree.tabAll': 'ALL',
  'companyTree.tabRecent': 'RECENT',
  'companyTree.tabSector': 'SECTOR',
  'companyTree.loadingAlerts': 'Loading alerts…',
  'companyTree.loading': 'Loading…',
  'companyTree.noCompanies': 'No companies. Import via /budgeting/onboarding.',
  'companyTree.noMatchPrefix': 'No match for',
  'companyTree.filterPlaceholder': 'filter companies…',
  'heatMap.filterRowsPlaceholder': 'filter rows…',
  'panels.heatMapShort': 'HEATMAP',
  'panels.companyTreeShort': 'TREE',
  'snapshot.title': 'Snapshot',
  'snapshot.trend12mo': '12mo trend',
  'hotkeys.running': 'RUNNING…',
  'hotkeys.compactTitle': 'Toggle compact mode (Ctrl+/)',
  'hotkeys.compactAriaLabel': 'Toggle compact mode',
  // IndicatorDetail keys with non-pattern labels (lowercase phrases / hyphens)
  'indicatorDetail.forecastConfidence': 'confidence',
  'indicatorDetail.forecastPts': 'pts',
  'indicatorDetail.forecastNoChange': 'no change expected',
  'indicatorDetail.forecastCITitle': '95% prediction interval',
  'indicatorDetail.reRun': 'Re-run',
  'indicatorDetail.explainButton': 'Explain →',
  // Wave 3 i18n — visible labels tests check literally
  'auditModal.title': 'Audit Log',
  'auditModal.close': 'Close',
  'auditModal.closeAriaLabel': 'Close audit log',
  'auditTicker.events': 'EVENTS',
  'auditTicker.loading': 'loading…',
  'auditTicker.noEvents': 'no events yet',
  'auditTicker.title': 'Click for full audit log',
  'auditTicker.ariaLabel': 'Recent audit events — click to open full audit log',
  'scenario.title': 'Scenario Runner',
  'scenario.apply': 'Apply',
  'scenario.applying': 'Applying…',
  'scenario.applyFailed': 'Apply failed',
  'scenario.period': 'Period',
  'scenario.overrides': 'Overrides',
  'scenario.available': 'Available',
  'scenario.loading': 'Loading…',
  'scenario.noScenarios': 'No scenarios seeded for this org.',
  'scenario.selectFromList': 'Select a scenario from the list to inspect overrides.',
  'scenario.noSelected': 'No scenario selected.',
  'compare.close': 'Close',
  'compare.error': 'Error',
  'compare.indicatorColumn': 'Indicator',
  'compare.loadingMatrix': 'Loading matrix…',
  'compare.closeAriaLabel': 'Close compare panel',
  'commandBar.placeholder': 'HOLD GO · AAC CO GO · IND_OPEX_RATIO IND GO (Cmd+K)',
  'commandBar.alertsAriaLabel': 'Open alerts panel',
  'layoutMenu.label': 'Layouts',
  'layoutMenu.save': 'Save',
  'layoutMenu.presets': 'Presets',
  'layoutMenu.saved': 'Saved',
  'layoutMenu.namePlaceholder': 'name this layout…',
  'layoutMenu.title': 'Save / load named pane layouts',
  'layoutMenu.loading': 'Loading…',
  'layoutMenu.noSaved': 'No saved layouts.',
};

function fallbackLabel(key: string): string {
  if (EXPLICIT_LABELS[key]) return EXPLICIT_LABELS[key];
  const last = key.split('.').pop() ?? key;
  // camelCase → "Camel Case" (split on uppercase) → uppercase
  const spaced = last.replace(/([A-Z])/g, ' $1').trim();
  return spaced ? spaced.toUpperCase() : key;
}

vi.mock('next-intl', () => ({
  useTranslations: (_namespace?: string) => (key: string) => fallbackLabel(key),
  useLocale: () => 'en',
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useMessages: () => ({}),
  useFormatter: () => ({
    dateTime: (date: Date) => String(date),
    number: (n: number) => String(n),
  }),
}));
