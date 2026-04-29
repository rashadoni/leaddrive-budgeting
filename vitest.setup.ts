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
