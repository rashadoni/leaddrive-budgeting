import React, { Suspense } from 'react';
import { CommandBar } from '@/features/terminal/components/CommandBar';
import { SignalsStrip } from '@/features/terminal/components/SignalsStrip';
import { ExpertWorkspace } from '@/features/terminal/components/PanelGrid';
import { TerminalOverlayHost } from '@/features/terminal/components/TerminalOverlayHost';
import { HotkeyToolbar } from '@/features/terminal/components/HotkeyToolbar';
import { TerminalDeepLinkHandler } from '@/features/terminal/components/TerminalDeepLinkHandler';
import { TerminalLockedPeriodBanner } from '@/features/terminal/components/TerminalLockedPeriodBanner';
import { ExpertViewportGate } from '@/features/terminal/components/ExpertViewportGate';

// Import Google Font for Terminal UI
import { JetBrains_Mono } from 'next/font/google';

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ['latin'],
  display: 'swap',
});

export default function TerminalPage() {
  return (
    <div
      data-testid="terminal-guide-root"
      className={`flex flex-col h-full w-full bg-[#050814] overflow-hidden ${jetbrainsMono.className}`}
    >
      {/* Route-owned listeners and overlays stay mounted independently of the
          active terminal workspace and its mobile viewport guard. */}
      <TerminalOverlayHost />

      <ExpertViewportGate>
      {/* Phase 7.G Turn LXXXXIX (Phase 7.E #2 v2 E.1d) — deep-link handler.
          Reads `?companyId=X&indicator=Y&period=Z&from=alert` query params,
          resolves to IndicatorValue.id via /api/indicators/values/resolve,
          dispatches setActiveIndicatorValue + setActivePanel(4) to auto-open
          VarianceExplainerPanel. Renders banner when arrived from alert.
          Suspense boundary required because useSearchParams is async. */}
      <Suspense fallback={null}>
        <TerminalDeepLinkHandler />
      </Suspense>

      {/* Truth-infra E.4 — terminal-wide locked-period banner.
          Renders null when the matrix's active period isn't locked. */}
      <TerminalLockedPeriodBanner />

      {/* Phase B6 — top hotkey toolbar (8 quick-actions). Sits above
          CommandBar; user-configurability is v2 (🔄). */}
      <HotkeyToolbar />

      {/* 1. Command Bar */}
      <CommandBar />

      {/* Phase 3 — live price/weather signal strip (suggests crisis scenarios).
          Renders nothing when there are no signals. */}
      <SignalsStrip />

      {/* 2. Legacy multi-pane workspace, preserved as Expert mode. */}
      <ExpertWorkspace />
      </ExpertViewportGate>
    </div>
  );
}
