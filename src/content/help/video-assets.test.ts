import { describe, expect, it } from 'vitest';
import {
  getHelpVideoForPath,
  matchesHelpVideoRoute,
} from './video-assets';

describe('query-aware help-video route matching', () => {
  it('keeps existing path-only entries compatible with unrelated query state', () => {
    expect(
      getHelpVideoForPath('/budgeting/admin/statement-controls', 'period=2026'),
    ).toMatchObject({ slug: 'statement-controls' });
  });

  it('matches a budgeting guide only when its required tab is active', () => {
    const route = '/budgeting?tab=cash-flow';

    expect(matchesHelpVideoRoute('/budgeting', route, 'tab=cash-flow')).toBe(true);
    expect(matchesHelpVideoRoute('/budgeting?tab=cash-flow', route)).toBe(true);
    expect(matchesHelpVideoRoute('/budgeting', route, 'tab=workspace')).toBe(false);
    expect(matchesHelpVideoRoute('/budgeting', route, '')).toBe(false);
  });

  it('allows unrelated query parameters without weakening required values', () => {
    const route = '/budgeting?tab=balance-sheet';

    expect(
      matchesHelpVideoRoute(
        '/budgeting',
        route,
        'company=company-1&tab=balance-sheet&period=2026',
      ),
    ).toBe(true);
    expect(
      matchesHelpVideoRoute(
        '/budgeting',
        route,
        'company=company-1&tab=cash-flow&period=2026',
      ),
    ).toBe(false);
  });

  it('preserves exact-base and explicit wildcard subpath semantics', () => {
    expect(matchesHelpVideoRoute('/base/detail', '/base')).toBe(true);
    expect(matchesHelpVideoRoute('/base/detail', '/base/*')).toBe(true);
    expect(matchesHelpVideoRoute('/base', '/base/*')).toBe(false);
    expect(matchesHelpVideoRoute('/baseball', '/base')).toBe(false);
  });
});
