import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HELP_VIDEO_ENTRIES,
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

  /**
   * 2026-08-04 — the Data Control overview walks eight admin screens, two of
   * which have their own dedicated deep-dive videos.
   *
   * Entries resolve longest-route-first, and "/budgeting/admin/companies-
   * readiness" (36 chars) is longer than "/budgeting/admin/statement-controls"
   * (35). So if the overview ever listed those two routes, it would sort ahead
   * and quietly replace a twelve-minute walkthrough with a passing mention —
   * with nothing failing to show it. Pin the ownership instead.
   */
  it('leaves screens with a dedicated guide to that guide', () => {
    expect(getHelpVideoForPath('/budgeting/admin/statement-controls')).toMatchObject({
      slug: 'statement-controls',
    });
    expect(getHelpVideoForPath('/budgeting/admin/indicator-backlog')).toMatchObject({
      slug: 'indicator-backlog',
    });
    expect(getHelpVideoForPath('/budgeting/admin/ai-import')).toMatchObject({
      slug: 'ai-import',
    });

    // The six screens the overview really is the only guide for.
    for (const path of [
      '/budgeting/admin/companies-readiness',
      '/budgeting/admin/indicator-health',
      '/budgeting/admin/ifrs-conformance',
      '/budgeting/admin/compliance',
      '/budgeting/admin/drift',
      '/budgeting/admin/intel-health',
    ]) {
      expect(getHelpVideoForPath(path), path).toMatchObject({ slug: 'data-control' });
    }
  });

  /**
   * 2026-08-04 — registering a slug is what makes the in-app card appear, and
   * the card links straight at `/api/help-videos/{slug}.{locale}.VOICE.mp4`.
   * A slug registered before its media is recorded therefore ships a play
   * button that 404s, in one language only, which is exactly the kind of thing
   * nobody notices until a customer opens the guide in Russian.
   *
   * So: every registered entry must have a video AND a poster on disk, in all
   * three languages. This replaces the per-section "not published yet"
   * placeholders, which could only ever guard the sections someone remembered
   * to write one for.
   */
  it('has recorded media on disk for every registered slug, in all three languages', () => {
    // Size floors, not just existence. A mux that fails leaves a ZERO-BYTE mp4
    // behind — comparison.en did exactly that — and an existence check calls
    // that recorded. The floors are deliberately far below any real take
    // (the smallest genuine video here is ~4MB, the smallest poster ~90KB);
    // they are here to catch empty and truncated files, not to police size.
    const FLOORS: Record<string, number> = { 'VOICE.mp4': 500_000, 'poster.jpg': 10_000 };
    const bad: string[] = [];
    for (const entry of HELP_VIDEO_ENTRIES) {
      for (const locale of ['az', 'en', 'ru'] as const) {
        for (const [suffix, floor] of Object.entries(FLOORS)) {
          const file = `video/player/${entry.slug}.${locale}.${suffix}`;
          const path = resolve(process.cwd(), file);
          if (!existsSync(path)) {
            bad.push(`${file} — missing`);
            continue;
          }
          const size = statSync(path).size;
          if (size < floor) bad.push(`${file} — ${size} bytes, below the ${floor} floor`);
        }
      }
    }
    expect(bad, `registered but not properly recorded:\n${bad.join('\n')}`).toEqual([]);
  });

  it('gives every budgeting tab its own guide and never another tab\'s', () => {
    const tabs = ['workspace', 'balance-sheet', 'comparison', 'forecast', 'plans'];
    for (const tab of tabs) {
      expect(getHelpVideoForPath('/budgeting', `tab=${tab}`), tab).toMatchObject({ slug: tab });
    }

    // cash-flow is deliberately absent — see the note in video-assets.ts. It
    // must resolve to NOTHING rather than borrow a neighbouring tab's guide,
    // which is the failure mode a bare "is it registered" check would miss.
    expect(getHelpVideoForPath('/budgeting', 'tab=cash-flow')).toBeNull();
    // No tab at all: the budgeting shell has no guide of its own, and must not
    // borrow one of the tabs'.
    expect(getHelpVideoForPath('/budgeting', '')).toBeNull();
  });
});
