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
  // Phase 7.G Turn VII — confidence-value localization (lowercase
  // phrases like the surrounding "confidence" label). Keep them
  // explicit-labels entries so existing tests asserting "high
  // confidence" / "medium confidence" continue to match.
  'indicatorDetail.confidenceHigh': 'high',
  'indicatorDetail.confidenceMedium': 'medium',
  'indicatorDetail.confidenceLow': 'low',
  'indicatorDetail.forecastNoChange': 'no change expected',
  'indicatorDetail.forecastCITitle': '95% prediction interval',
  'indicatorDetail.reRun': 'Re-run',
  'indicatorDetail.explainButton': 'Explain →',
  'indicatorDetail.explaining': 'Explaining…',
  'indicatorDetail.extrapolationCaveat': 'linear extrapolation; uncertainty grows with horizon',
  // Sub-40 — per-IV recompute affordance state machine.
  'indicatorDetail.recompute': 'Recompute',
  'indicatorDetail.recomputing': 'Recomputing…',
  'indicatorDetail.recomputeDone': 'Updated',
  'indicatorDetail.recomputeFailed': 'Failed',
  'indicatorDetail.recomputeTitle': 'Recompute this indicator value with up-to-date sparkline',
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
  'heatMap.tooltipUnit': 'unit:',
  'heatMap.tooltipDirHigher': 'higher = better',
  'heatMap.tooltipDirLower': 'lower = better',
  'heatMap.tooltipDirBand': 'in band',
  'heatMap.tooltipCompositeScore': 'Composite score:',
  'heatMap.tooltipNoData': '— no data',
  'heatMap.tooltipIndicators': 'indicators',
  'heatMap.tooltipSparkline12mo': '12mo',
  'heatMap.sparklineTrendAriaLabel': '{indCode} 12-month trend for {coCode}',
  'heatMap.sparklineTrendAriaLabelSelf': '{indCode} 12-month trend',
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
  // M8-lite mobile viewport banner (Tier-3 sub-30 Stage 3f)
  'mobileBanner.text': 'Risk Terminal is optimized for ≥1024px viewports. Some panels may not display fully on this screen — switch to a wider monitor for the full experience.',
  'mobileBanner.ariaLabel': 'Mobile viewport advisory',
  'mobileBanner.dismissAriaLabel': 'Dismiss mobile viewport advisory',
  // CommentsLayer keys (Tier-3 sub-30)
  'comments.title': 'Comments ({count} threads)',
  'comments.subtitle': 'Per-cell @mention threads. Tag a teammate (@cfo, @aac-finance) to discuss a specific data point. Press Esc to close.',
  'comments.dialogAriaLabel': 'Comments overlay',
  'comments.closeAriaLabel': 'Close comments',
  'comments.noActiveCell': 'No active cell — click a HeatMap cell first to attach a comment thread.',
  'comments.threadFor': 'Thread for {key}',
  'comments.empty': 'No comments yet — start the discussion below.',
  'comments.draftPlaceholder': 'Type a comment, @mention with @name…',
  'comments.draftAriaLabel': 'Comment draft',
  'comments.send': 'Send',
  'comments.sendAriaLabel': 'Post comment',
  // SubCoFinanceChat keys (Tier-3 sub-30)
  'subcoChat.title': 'Sub-Co Finance Chat',
  'subcoChat.subtitle': "Direct channels to each sub-co's finance manager. Press Esc to close.",
  'subcoChat.dialogAriaLabel': 'Sub-co finance chat',
  'subcoChat.closeAriaLabel': 'Close chat',
  'subcoChat.channelListAriaLabel': 'Channel list',
  'subcoChat.threadAriaLabel': 'Thread messages',
  'subcoChat.channels': 'Channels',
  'subcoChat.loading': 'Loading channels…',
  'subcoChat.noChannels': 'No companies yet — import via /budgeting/onboarding to enable channels.',
  'subcoChat.pickChannel': 'Pick a channel from the left to start a conversation.',
  'subcoChat.emptyThread': 'No messages yet — say hello.',
  'subcoChat.from': 'You',
  'subcoChat.draftPlaceholder': 'Message {channel}…',
  'subcoChat.draftAriaLabel': 'Chat draft',
  'subcoChat.send': 'Send',
  'subcoChat.sendAriaLabel': 'Send message',
  // AISubscriptions keys (Tier-3 sub-30)
  'subscriptions.title': 'AI Subscriptions ({active} active · {paused} paused)',
  'subscriptions.subtitle': 'Notify-me-when-X conditions on the live matrix. Press Esc to close.',
  'subscriptions.dialogAriaLabel': 'AI subscriptions manager',
  'subscriptions.closeAriaLabel': 'Close subscriptions',
  'subscriptions.createTitle': 'Create subscription',
  'subscriptions.createSubmit': 'Create',
  'subscriptions.labelPlaceholder': 'What should this be called? e.g. "AAC composite drop"',
  'subscriptions.labelAriaLabel': 'Subscription label',
  'subscriptions.scopeAriaLabel': 'Subscription scope',
  'subscriptions.scopeAny': 'Any company',
  'subscriptions.scopeCompany': 'Specific company',
  'subscriptions.scopeIndicator': 'Specific indicator',
  'subscriptions.scopeValueAriaLabel': 'Scope value',
  'subscriptions.scopeValueCompanyPlaceholder': 'Company code (e.g. AAC-MAIN)',
  'subscriptions.scopeValueIndicatorPlaceholder': 'Indicator code (e.g. IND_NET_MARGIN)',
  'subscriptions.scopeValueDisabledPlaceholder': '(scope: any)',
  'subscriptions.comparatorAriaLabel': 'Comparator',
  'subscriptions.thresholdAriaLabel': 'Threshold (0-100)',
  'subscriptions.listTitle': 'Subscriptions',
  'subscriptions.listAriaLabel': 'Subscription list',
  'subscriptions.empty': 'No subscriptions yet — create one above.',
  'subscriptions.pauseTitle': 'Pause this subscription',
  'subscriptions.resumeTitle': 'Resume this subscription',
  'subscriptions.deleteTitle': 'Delete subscription',
  'subscriptions.pauseAriaLabel': 'Pause {label}',
  'subscriptions.resumeAriaLabel': 'Resume {label}',
  'subscriptions.deleteAriaLabel': 'Delete {label}',
  'subscriptions.lastFiredLabel': 'fired',
  'subscriptions.lastFiredTitle': 'Last time this subscription matched a HeatMap cell',
  // ActionCenterPanel keys (Tier-3 sub-28)
  'actionCenter.title': 'Action Center ({count})',
  'actionCenter.subtitle': 'Pending review queue across the holding. Click any row to jump to the offending cell. Press Esc to close.',
  'actionCenter.dialogAriaLabel': 'Action Center',
  'actionCenter.closeAriaLabel': 'Close action center',
  'actionCenter.matrixLoading': 'Matrix loading… work items populate after first refresh.',
  'actionCenter.noWorkItems': '✓ No pending items — all systems green.',
  'actionCenter.severityRed': 'Red — needs review ({count})',
  'actionCenter.severityAmber': 'Amber — watch closely ({count})',
  'actionCenter.severitySectionAriaLabel': '{severity} work items',
  'actionCenter.itemAriaLabel': 'Review {company} {indicator}',
  'actionCenter.itemReviewHint': 'Click → jump to {company} · {indicator}',
  'actionCenter.currentValue': 'Value',
  'actionCenter.alertsSectionTitle': 'Active rule alerts ({count})',
  'actionCenter.alertsSectionAriaLabel': 'Rule-engine alerts grouped above cell items',
  'actionCenter.alertChipAriaLabel': 'Jump to {code}',
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
  // Phase 7.G D.4 — IntelFeedPanel test fixtures. Mirror messages/en.json
  // under `terminal.intelFeedPanel.*` so component-test render assertions
  // can match locale-formatted strings without per-file mock overrides.
  'intelFeedPanel.title': 'Intel feed',
  'intelFeedPanel.subtitle': "AI-curated news on your portfolio's industries + companies.",
  'intelFeedPanel.dialogAriaLabel': 'Intel feed',
  'intelFeedPanel.closeAriaLabel': 'Close intel feed',
  'intelFeedPanel.refreshAriaLabel': 'Refresh intel feed',
  'intelFeedPanel.refreshLabel': 'Refresh',
  'intelFeedPanel.refreshingLabel': 'Refreshing…',
  'intelFeedPanel.loading': 'Loading intel…',
  'intelFeedPanel.emptyAdmin': 'No recent intel. Click Refresh to crawl now.',
  'intelFeedPanel.emptyViewer': 'No recent intel. Ask an admin to refresh.',
  'intelFeedPanel.pinAriaLabel': 'Pin item',
  'intelFeedPanel.unpinAriaLabel': 'Unpin item',
  'intelFeedPanel.dismissAriaLabel': 'Dismiss item',
  'intelFeedPanel.relevanceAriaLabel': 'Relevance {tone} {score}',
  // Phase 7.G Turn XLVIII (v2 Turn 2) — Hero section fixtures.
  'boardDeck.hero.ariaLabel': 'Board deck hero',
  'boardDeck.hero.eyebrowSuffix': 'Review',
  'boardDeck.hero.fallbackHeadline': '{org} · {period} period review',
  'boardDeck.hero.scoreLabel': 'Holding composite score / 100',
  'boardDeck.hero.contributingCount': '{contributing} of {total} sub-cos scored',
  'boardDeck.hero.cta': 'Read full report',
  'boardDeck.hero.aiAttribution': 'AI-generated · {model} · prompt {version}',
  // Phase 7.G Turn XLIX (v2 Turn 3) — supporting-metrics row.
  'boardDeck.metrics.sectionAriaLabel': 'Supporting metrics',
  'boardDeck.metrics.redCellsLabel': 'Red cells',
  'boardDeck.metrics.redCellsContext': 'of {total} total cells',
  'boardDeck.metrics.redSubCosLabel': 'Sub-cos in red band',
  'boardDeck.metrics.redSubCosContext': 'of {total} operational',
  'boardDeck.metrics.indicatorCoverageLabel': 'Indicators tracked',
  'boardDeck.metrics.indicatorCoverageContext': 'across {sectors} sectors',
  'boardDeck.metrics.trendAriaLabel': '12-month composite trend',
  'boardDeck.metrics.trendTitle': 'Composite trend (12 months)',
  'boardDeck.metrics.trendEmpty':
    'No monthly data yet for this org. The trend chart populates once 2+ monthly snapshots are recomputed.',
  // Phase 7.G Turn LI (v2 Turn 4) — narrative / top-alerts / footer.
  'boardDeck.narrative.ariaLabel': 'Executive narrative',
  'boardDeck.narrative.eyebrow': 'Executive narrative',
  'boardDeck.narrative.attribution':
    'Generated by {model} · prompt {version} · snapshot {generatedAt}',
  'boardDeck.narrative.languagePickerAriaLabel': 'Narrative language',
  'boardDeck.topAlerts.ariaLabel': 'Top alerts',
  'boardDeck.topAlerts.eyebrow': 'Top alerts for the board',
  'boardDeck.topAlerts.showingOf': 'Showing {showing} of {total}',
  'boardDeck.topAlerts.affectedCount': '{count} affected sub-cos',
  'boardDeck.topAlerts.allClear': '✓ No alerts triggered — all systems green.',
  'boardDeck.topAlerts.viewAll': 'View all alerts in Risk Terminal',
  'boardDeck.footer.ariaLabel': 'Page actions',
  'boardDeck.footer.eyebrow': 'Share + drill-down',
  'boardDeck.footer.subtitle':
    'Export the deck, print it, or open the live Risk Terminal for operational drill-down.',
  'boardDeck.footer.terminalCta': 'Open Risk Terminal',
  // Sub-35 — alert message i18n. Mirrors `messages/en.json`
  // `terminal.alerts.messages.*` so component-test render assertions
  // can match the locale-formatted string. Drift between this map and
  // the JSON is caught by `alert-rules-i18n.test.ts`.
  'alerts.messages.company-mostly-red': '{code} has {redCount} red indicators — needs review',
  'alerts.messages.company-critical-composite': '{code} composite score {score}/100 ({contributing}/{total} indicators)',
  'alerts.messages.sector-amber-cluster': '{industry} sector: {amberCount} amber cells across {companyCount} companies',
  'alerts.messages.sector-red-spread': '{industry} sector: {redCount} red cells across {companyCount} companies — possible contagion',
  'alerts.messages.critical-indicator-org-wide': '{code} red for {companyCount} companies — consolidated pressure on critical metric',
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

// Phase 7.G Turn XLVIII (Board Deck v2 Turn 2 follow-up) — server-side
// next-intl mock. Mirrors the client-side mock above so async server
// components (`await getTranslations(scope)`) resolve labels through
// the SAME EXPLICIT_LABELS map used by client tests. Architect Turn-
// XLVIII Quality fix: HeroSection.test.tsx originally inlined a
// duplicate of these keys, creating a drift surface. Centralizing the
// server mock here kills the drift class entirely.
vi.mock('next-intl/server', () => ({
  getTranslations: async (_namespace?: string) =>
    (key: string, values?: Record<string, unknown>) => fallbackLabel(key, values),
  getLocale: async () => 'en',
  getMessages: async () => ({}),
  getFormatter: async () => ({
    dateTime: (date: Date) => String(date),
    number: (n: number) => String(n),
  }),
}));

// Tier-3 sub-30 Stage 3 — next-auth/react mock so components reading
// `useSession()` (e.g. CommentsLayer for comment authorship) don't
// crash without a SessionProvider in the test tree. Tests that need
// a specific session shape can override per-file via vi.mock().
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: { name: 'Test User', email: 'test@example.com' },
      expires: '2099-01-01',
    },
    status: 'authenticated',
    update: async () => null,
  }),
  signIn: async () => undefined,
  signOut: async () => undefined,
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
