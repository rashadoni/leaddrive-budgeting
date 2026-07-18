// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { TerminalOverlayHost } from './TerminalOverlayHost';

const ROOT = process.cwd();
const HOST_PATH =
  ROOT + '/src/features/terminal/components/TerminalOverlayHost.tsx';
const EXPERT_PATH =
  ROOT + '/src/features/terminal/components/PanelGrid.tsx';
const ROUTE_PATH =
  ROOT + '/src/app/(dashboard)/budgeting/terminal/page.tsx';

const GLOBAL_MOUNTS = [
  'AuditModal',
  'HelpModal',
  'ComparePanel',
  'PeerPanel',
  'ExportPdfTrigger',
  'ExportXlsxTrigger',
  'AlertsPanel',
  'ScenarioPanel',
  'ActionCenterPanel',
  'CommentsLayer',
  'SubCoFinanceChat',
  'AISubscriptions',
  'IntelFeedPanel',
  'BreachForecastPanel',
  'WhatIfPreviewPanel',
  'KeyboardShortcutsModal',
] as const;

describe('TerminalOverlayHost', () => {
  it('keeps overlays out of SSR to preserve the legacy hydration sequence', () => {
    expect(renderToString(<TerminalOverlayHost />)).toBe('');
  });

  it('owns every event-driven overlay and export listener exactly once', () => {
    const host = readFileSync(HOST_PATH, 'utf8');
    const expert = readFileSync(EXPERT_PATH, 'utf8');

    for (const component of GLOBAL_MOUNTS) {
      expect(host.match(new RegExp(`<${component}\\s*/>`, 'g'))).toHaveLength(1);
      expect(expert).not.toContain(`<${component} />`);
    }
  });

  it('is mounted by the route before the isolated Expert workspace', () => {
    const route = readFileSync(ROUTE_PATH, 'utf8');
    const hostIndex = route.indexOf('<TerminalOverlayHost />');
    const expertIndex = route.indexOf('<ExpertWorkspace />');

    expect(hostIndex).toBeGreaterThan(-1);
    expect(expertIndex).toBeGreaterThan(hostIndex);
  });
});
