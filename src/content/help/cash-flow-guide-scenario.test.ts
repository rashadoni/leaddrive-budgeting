import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import enMessages from '../../../messages/en.json';
import ruMessages from '../../../messages/ru.json';
import azMessages from '../../../messages/az.json';

type GuideScene = {
  voice: Record<'az' | 'en' | 'ru', string>;
  do: (...args: unknown[]) => Promise<void>;
};

type GuideScenario = {
  route: string;
  scenes: GuideScene[];
};

let cashFlow: GuideScenario;

beforeAll(async () => {
  const url = pathToFileURL(
    resolve(process.cwd(), 'video/scenarios/overrides.mjs'),
  ).href;
  const module = (await import(url)) as {
    default: Record<string, GuideScenario>;
  };
  cashFlow = module.default['cash-flow'];
});

describe('Cash Flow help-video scenario', () => {
  it('keeps the Cash Flow and CFS message keys in EN/RU/AZ parity', () => {
    const relevantKeys = (messages: typeof enMessages) =>
      Object.keys(messages.budgeting)
        .filter((key) => key.startsWith('cashFlow') || key.startsWith('odds'))
        .sort();

    expect(relevantKeys(ruMessages)).toEqual(relevantKeys(enMessages));
    expect(relevantKeys(azMessages)).toEqual(relevantKeys(enMessages));
  });

  it('has a substantial trilingual narration on the real Cash Flow tab', () => {
    expect(cashFlow.route).toBe('/budgeting?tab=cash-flow');
    expect(cashFlow.scenes).toHaveLength(8);

    for (const language of ['az', 'en', 'ru'] as const) {
      const sceneWords = cashFlow.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      );
      expect(Math.min(...sceneWords)).toBeGreaterThanOrEqual(35);
      expect(sceneWords.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(
        350,
      );
    }
  });

  it('clicks only the reviewed local Entries and Overview tabs', () => {
    const actions = cashFlow.scenes.map((scene) => scene.do.toString()).join('\n');
    const clickedTargets = Array.from(
      actions.matchAll(/h\.safeClick\(([^)]+)\)/g),
    ).map((match) => match[1]);

    expect(clickedTargets).toEqual([
      'CF_ENTRIES_BUTTON',
      'CF_OVERVIEW_BUTTON',
    ]);
    expect(actions).not.toContain('h.click(');
    expect(actions).not.toContain('h.fill(');
    expect(actions).not.toContain('safeClick(CF_GENERATE');
    expect(actions).not.toMatch(/alert|delete|remove|ai-import|ai-analytics/i);
    expect(actions).not.toContain('.catch(() => {})');
  });

  it('pins every required anchor in the rendered Cash Flow components', () => {
    const sources = [
      'src/features/budgeting/components/CashFlowTab.tsx',
      'src/components/budget-cash-flow-chart.tsx',
      'src/components/budget-cash-flow-table.tsx',
      'src/components/budget-cash-flow-alerts.tsx',
      'src/components/budget-cash-flow-entries.tsx',
      'src/components/budget-odds-report.tsx',
      'src/components/budget-plan-fact-dashboard.tsx',
    ].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n');

    for (const anchor of [
      'cash-flow-guide-root',
      'cash-flow-guide-header',
      'cash-flow-subview-tabs',
      'cash-flow-subview-overview',
      'cash-flow-subview-entries',
      'cash-flow-subview-odds',
      'cash-flow-subview-plan-fact',
      'cash-flow-generate-from-budget',
      'cash-flow-overview',
      'cash-flow-empty-state',
      'cash-flow-chart',
      'cash-flow-chart-totals',
      'cash-flow-monthly-table',
      'cash-flow-alerts',
      'cash-flow-entries-view',
      'cash-flow-entries-empty',
      'cash-flow-odds-view',
      'cash-flow-odds-empty',
      'cash-flow-plan-fact-view',
      'cash-flow-plan-fact-empty',
      'cash-flow-plan-fact-incomplete',
    ]) {
      expect(sources).toContain(anchor);
    }
  });

  it('keeps ordinary hand-authored clicks inert in READONLY mode', () => {
    const producer = readFileSync(
      resolve(process.cwd(), 'scripts/produce-guides.mjs'),
      'utf8',
    );
    const clickHelper = producer.slice(
      producer.indexOf('async click(sel)'),
      producer.indexOf('async safeClick(sel)'),
    );
    expect(clickHelper).toContain('if (READONLY)');
    expect(clickHelper).toContain('return;');

    const fillHelper = producer.slice(
      producer.indexOf('async fill(sel, text)'),
      producer.indexOf('\n  };', producer.indexOf('async fill(sel, text)')),
    );
    expect(fillHelper).toContain('if (READONLY)');
    expect(fillHelper).toContain('return;');
  });

  it('fails closed around every explicitly reviewed READONLY interaction', () => {
    const producer = readFileSync(
      resolve(process.cwd(), 'scripts/produce-guides.mjs'),
      'utf8',
    );
    const safeClickHelper = producer.slice(
      producer.indexOf('async safeClick(sel)'),
      producer.indexOf('async fill(sel, text)'),
    );
    expect(safeClickHelper).toContain('typeof sel !== "string"');
    expect(safeClickHelper).toContain('count !== 1');
    expect(safeClickHelper).toContain('loc.isVisible()');
    expect(safeClickHelper).not.toContain('page.mouse.click');

    const recorder = producer.slice(
      producer.indexOf('async function recordSection'),
      producer.indexOf('async function performAction'),
    );
    expect(recorder).toContain('["POST", "PUT", "PATCH", "DELETE"]');
    expect(recorder).toContain('route.abort("blockedbyclient")');
    expect(recorder.match(/assertReadonlyNoMutations\(\);/g)).toHaveLength(3);
    expect(producer).toContain('step.preclick && !READONLY');
  });

  it('pins every explicit READONLY-safe click across all hand-authored scenarios', async () => {
    const url = pathToFileURL(
      resolve(process.cwd(), 'video/scenarios/overrides.mjs'),
    ).href;
    const module = (await import(url)) as {
      default: Record<string, GuideScenario>;
    };
    const actions = Object.values(module.default)
      .flatMap((scenario) => scenario.scenes)
      .map((scene) => scene.do.toString())
      .join('\n');
    const safeTargets = Array.from(
      actions.matchAll(/h\.safeClick\(([^)]+)\)/g),
    ).map((match) => match[1]);

    expect(safeTargets).toEqual([
      'WS_MATERIAL',
      'WS_MATRIX_BUTTON',
      'WS_LIST_BUTTON',
      'BS_ASSETS_TOGGLE',
      'BS_ASSETS_TOGGLE',
      'BS_LIABILITIES_TOGGLE',
      'BS_LIABILITIES_TOGGLE',
      'BS_EQUITY_TOGGLE',
      'BS_EQUITY_TOGGLE',
      'CF_ENTRIES_BUTTON',
      'CF_OVERVIEW_BUTTON',
      'CMP_PRIMARY',
      'CMP_SECONDARY',
      'FC_OPTIMISTIC',
      'FC_PESSIMISTIC',
      'FC_BASE',
      'FC_REVENUE',
      'FC_REVENUE',
      'FC_COGS',
      'FC_COGS',
      'FC_EXPENSE',
      'FC_EXPENSE',
      'TERM_COMPANY',
      'TERM_CELL',
      // ai-import: tab switches only. Both flip local React state in
      // AIImportTabs and issue no request — the writes in that scenario go
      // through mutatingClick below, never through this list.
      // Navigation to the deletion screen — a GET, not a write.
      'AI_RESET_CTA',
      // Мастер удаления пошаговый: задача → компания → год. Все три меняют
      // только клиентское состояние; сама очистка идёт через mutatingClick.
      'DD_TASK_CLEAR_YEAR',
      'DD_COMPANY_OPTION',
      'DD_YEAR_CHIP',
      'AI_TAB_SINGLE',
      'AI_TAB_MULTI',
      'RUN_BTN',
      // indicator-backlog: an owner chip and the hide-complete toggle, each
      // clicked on and then off again. Both only re-filter an already rendered
      // list — the page issues one GET and has no control that writes.
      'IB_OWNER_UNKNOWN',
      'IB_HIDE_COMPLETE',
      'IB_HIDE_COMPLETE',
      'IB_OWNER_UNKNOWN',
    ]);
  });

  it('pins every MUTATING click and keeps it off prod', async () => {
    // A guide to the importer that never imports teaches nothing, so the
    // ai-import scenario really does press Analyze and Apply. Those are writes
    // and must never appear in the READONLY-safe list above, or that tripwire
    // stops meaning anything. They get their own pinned list, and the helper
    // refuses to run unless the target is a throwaway stand.
    const url = pathToFileURL(
      resolve(process.cwd(), 'video/scenarios/overrides.mjs'),
    ).href;
    const module = (await import(url)) as {
      default: Record<string, GuideScenario>;
    };
    const actions = Object.values(module.default)
      .flatMap((scenario) => scenario.scenes)
      .map((scene) => scene.do.toString())
      .join('\n');
    const mutatingTargets = Array.from(
      actions.matchAll(/h\.mutatingClick\(([^)]+)\)/g),
    ).map((match) => match[1]);

    // 2026-08-04 — the import guide now SHOWS a clearing before it loads, so
    // two more writes join the list. Both go through the guarded delete flow:
    // DD_CHECK computes the blast radius and deletes nothing, DD_CONFIRM_SUBMIT
    // is the deletion itself and can only follow it.
    expect(mutatingTargets).toEqual([
      // The deletion's dry check computes the blast radius and deletes nothing.
      // The confirmation itself is deliberately NOT in this list — see the note
      // in ai-import-guide-scenario.test.ts.
      'DD_CHECK',
      'AI_ANALYZE',
      'AI_APPLY',
    ]);

    const producer = readFileSync(
      resolve(process.cwd(), 'scripts/produce-guides.mjs'),
      'utf8',
    );
    const helper = producer.slice(producer.indexOf('async mutatingClick(sel)'));
    // Fails closed: refuses before touching the page when READONLY is on.
    expect(helper).toContain('if (READONLY) {');
    expect(helper.indexOf('if (READONLY) {')).toBeLessThan(helper.indexOf('page.locator(sel)'));
    // Same single-visible-target discipline as safeClick.
    expect(helper).toContain('typeof sel !== "string"');
    expect(helper).toContain('count !== 1');
    expect(helper).toContain('loc.isVisible()');
  });
});
