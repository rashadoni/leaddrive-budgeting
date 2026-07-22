import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

type GuideScene = {
  voice: Record<'az' | 'en' | 'ru', string>;
  do: (...args: unknown[]) => Promise<void>;
};

type GuideScenario = {
  route: string;
  scenes: GuideScene[];
};

let workspace: GuideScenario;

beforeAll(async () => {
  const url = pathToFileURL(
    resolve(process.cwd(), 'video/scenarios/overrides.mjs'),
  ).href;
  const module = (await import(url)) as {
    default: Record<string, GuideScenario>;
  };
  workspace = module.default.workspace;
});

describe('Workspace help-video scenario', () => {
  it('has a substantial trilingual narration on the real workspace route', () => {
    expect(workspace.route).toBe('/budgeting?tab=workspace');
    expect(workspace.scenes).toHaveLength(9);

    for (const language of ['az', 'en', 'ru'] as const) {
      const sceneWords = workspace.scenes.map(
        (scene) => scene.voice[language].trim().split(/\s+/).length,
      );
      expect(Math.min(...sceneWords)).toBeGreaterThanOrEqual(35);
      expect(sceneWords.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(
        350,
      );
    }
  });

  it('clicks only local read-only view toggles', () => {
    const actions = workspace.scenes.map((scene) => scene.do.toString()).join('\n');
    const clickedTargets = Array.from(actions.matchAll(/h\.click\(([^)]+)\)/g)).map(
      (match) => match[1],
    );

    expect(clickedTargets).toEqual([
      'WS_MATERIAL',
      'WS_MATRIX_BUTTON',
      'WS_LIST_BUTTON',
    ]);
    expect(actions).not.toContain('h.fill(');
    expect(actions).not.toContain('matrix-seed');
    expect(actions).not.toContain('.catch(() => {})');
  });

  it('pins every scenario anchor in the rendered Workspace component', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/features/budgeting/components/WorkspaceTab.tsx',
      ),
      'utf8',
    );
    for (const anchor of [
      'workspace-execution-context',
      'workspace-kpis',
      'workspace-kpi-revenue',
      'workspace-kpi-cogs',
      'workspace-kpi-expenses',
      'workspace-kpi-operating-profit',
      'workspace-waterfall',
      'workspace-execution-gauge',
      'workspace-category-bars',
      'workspace-controls',
      'workspace-material-filter',
      'workspace-view-matrix',
      'workspace-matrix',
      'workspace-view-list',
      'workspace-table',
    ]) {
      expect(source).toContain(`data-testid="${anchor}"`);
    }
  });
});
