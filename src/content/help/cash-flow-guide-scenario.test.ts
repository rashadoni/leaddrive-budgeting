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
      'FC_OPTIMISTIC',
      'FC_PESSIMISTIC',
      'FC_BASE',
      'FC_REVENUE',
      'FC_REVENUE',
      'FC_COGS',
      'FC_COGS',
      'FC_EXPENSE',
      'FC_EXPENSE',
      'RUN_BTN',
    ]);
  });
});
