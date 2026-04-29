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
  'snapshot.loading': 'Loading snapshot…',
  'snapshot.error': 'Snapshot error',
  'snapshot.companyNotInMatrix': 'Company not in current matrix:',
  'snapshot.noPlIndicators': 'No P&L margin indicators available for',
  'snapshot.topAlerts': 'Top alerts',
  'snapshot.indicators': 'indicators',
  'snapshot.footerHint': 'Click any HeatMap cell for the full Variance Explainer narrative.',
  'snapshot.scoreLabel': 'Score',
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
  'indicatorDetail.explaining': 'Explaining…',
  'indicatorDetail.extrapolationCaveat': 'linear extrapolation; uncertainty grows with horizon',
  // VarianceExplainer keys — these have hyphenated / phrasal labels that
  // tests assert on via getByText / regex. Without explicit mappings the
  // camelCase fallback turns "reRun" → "RE RUN" which breaks `/Re-run/i`
  // matchers.
  'varianceExplainer.reRun': 'Re-run',
  'varianceExplainer.reRunTitle': 'Force a fresh LLM call (bypasses cache)',
  'varianceExplainer.explainArrow': 'Explain →',
  'varianceExplainer.askingModel': 'Asking the model…',
  'varianceExplainer.runFor': 'Run for',
  'varianceExplainer.tokensIn': 'in',
  'varianceExplainer.tokensOut': 'out',
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
  'compare.dialogAriaLabel': 'Compare {lhs} vs {rhs}',
  'compare.headerTitle': 'Compare:',
  'compare.headerVs': 'vs',
  'heatMap.loading': 'Loading…',
  'heatMap.errorPrefix': 'Error:',
  'heatMap.aiSummaryGenerating': '💬 Generating AI summary…',
  'heatMap.cellClickHint': 'Click → drill-down (Panel 3)',
  'heatMap.noScoreableIndicators': 'No scoreable indicators',
  'heatMap.compositeScoreTitle': 'Composite {score}/100 · {contributing}/{total} indicators',
  'heatMap.filterAriaLabel': 'Filter heatmap rows',
  'heatMap.tableAriaLabel': 'Risk heatmap',
  // CompanyTree / Hotkeys / Scenario / RelatedFunctions Round-9 sweep #2
  'companyTree.filterAriaLabel': 'Filter company tree',
  'companyTree.treeAriaLabel': 'Companies',
  'companyTree.sectorTreeAriaLabel': 'Companies grouped by sector',
  'companyTree.tabsAriaLabel': 'Company watchlist filter',
  'companyTree.starredAriaLabel': 'Starred companies',
  'companyTree.alertedAriaLabel': 'Alerted companies',
  'hotkeys.toolbarAriaLabel': 'Terminal hotkeys',
  'scenario.dialogAriaLabel': 'Scenario runner',
  'scenario.closeAriaLabel': 'Close scenario panel',
  'scenario.listAriaLabel': 'Scenario list',
  'scenario.detailAriaLabel': 'Scenario detail',
  'relatedFunctions.ariaLabel': 'Related functions',
  'relatedFunctions.titleForCompany': 'Open {code} in P&L / Compare / Forecast / Audit',
  'relatedFunctions.titleOrgWide': 'Open holding-wide P&L / Compare / Forecast / Audit',
  'relatedFunctions.forCompany': 'For {code}',
  'relatedFunctions.orgWide': 'Org-wide',
  'relatedFunctions.pnl': 'P&L',
  'relatedFunctions.compare': 'Compare',
  'relatedFunctions.forecast': 'Forecast',
  'relatedFunctions.audit': 'Audit',
  'commandBar.placeholder': 'HOLD GO · AAC CO GO · IND_OPEX_RATIO IND GO (Cmd+K)',
  'commandBar.alertsAriaLabel': 'Open alerts panel',
  'commandBar.alertsLoading': 'Alerts: loading…',
  'commandBar.alertsTitle': '{count} red+amber indicators across the org — click to open alerts panel',
  'layoutMenu.label': 'Layouts',
  'layoutMenu.save': 'Save',
  'layoutMenu.presets': 'Presets',
  'layoutMenu.saved': 'Saved',
  'layoutMenu.namePlaceholder': 'name this layout…',
  'layoutMenu.title': 'Save / load named pane layouts',
  'layoutMenu.loading': 'Loading…',
  'layoutMenu.noSaved': 'No saved layouts.',
  'layoutMenu.deleteTitle': 'Delete',
  'layoutMenu.deleteAriaLabel': 'Delete {name}',
  'layoutMenu.applyPresetTitle': 'Apply {label} preset',
  'layoutMenu.loadTitle': 'Load "{name}" (saved {time})',
  'layoutMenu.closeMenuAriaLabel': 'Close menu',
  'layoutMenu.confirmDeleteTitle': 'Delete layout?',
  'layoutMenu.confirmDeleteBody': 'Delete layout "{name}"? This cannot be undone.',
  'layoutMenu.confirmDeleteConfirm': 'Delete',
  'layoutMenu.confirmDeleteCancel': 'Cancel',
  'layoutMenu.errorInvalidLayout': 'Layout "{name}" has invalid sizes — likely from an older panel structure. Delete + re-save.',
  'layoutMenu.errorInvalidName': 'Name must be 1-40 chars, no leading/trailing whitespace, no control chars.',
  // Preset labels — keep English source-of-truth so getByText("Bloomberg")
  // continues to find the rendered preset row in tests.
  'layoutMenu.presetLabel.default': 'Default 2×2',
  'layoutMenu.presetLabel.bloomberg': 'Bloomberg',
  'layoutMenu.presetLabel.analyst': 'Analyst Drill-down',
  'layoutMenu.presetLabel.morningBrief': 'Morning Brief',
  'layoutMenu.presetLabel.investorMode': 'Investor Mode',
  'layoutMenu.presetLabel.auditMode': 'Audit Mode',
  // AlertsPanel keys
  'alertsPanel.title': 'Alerts ({count})',
  'alertsPanel.subtitle': 'Multi-indicator rule matches across the holding. Press Esc to close.',
  'alertsPanel.dialogAriaLabel': 'Alerts panel',
  'alertsPanel.closeAriaLabel': 'Close alerts panel',
  'alertsPanel.matrixLoading': 'Matrix loading… alerts populate after first refresh.',
  'alertsPanel.noAlerts': '✓ No alerts triggered — all systems green.',
  'alertsPanel.severityCritical': 'Critical',
  'alertsPanel.severityWarning': 'Warning',
  'alertsPanel.severityInfo': 'Info',
  'alertsPanel.severitySectionAriaLabel': '{severity} alerts',
  'alertsPanel.loadingCodes': 'Loading codes…',
  'alertsPanel.jumpToCompany': 'Jump to {code}',
  'alertsPanel.companyCodeNotLoaded': 'Company code not loaded — try reopening',
  'alertsPanel.couldNotLoadCodes': 'Could not load company codes — chips show ids: {error}',
};

/**
 * Apply ICU-ish placeholder substitution: replaces `{key}` with values[key].
 * Real next-intl handles plural / select / number formatting too; the test
 * mock only needs the simplest variable substitution to keep
 * fixture-equivalence between test/runtime strings.
 */
function applyPlaceholders(template: string, values?: Record<string, unknown>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return key in values ? String(values[key]) : `{${key}}`;
  });
}

function fallbackLabel(key: string, values?: Record<string, unknown>): string {
  if (EXPLICIT_LABELS[key]) return applyPlaceholders(EXPLICIT_LABELS[key], values);
  const last = key.split('.').pop() ?? key;
  // camelCase → "Camel Case" (split on uppercase) → uppercase
  const spaced = last.replace(/([A-Z])/g, ' $1').trim();
  return spaced ? spaced.toUpperCase() : key;
}

vi.mock('next-intl', () => ({
  useTranslations: (_namespace?: string) =>
    (key: string, values?: Record<string, unknown>) => fallbackLabel(key, values),
  useLocale: () => 'en',
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useMessages: () => ({}),
  useFormatter: () => ({
    dateTime: (date: Date) => String(date),
    number: (n: number) => String(n),
  }),
}));
