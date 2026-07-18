"use client";

import { useSyncExternalStore } from 'react';
import { ActionCenterPanel } from './ActionCenterPanel';
import { AISubscriptions } from './AISubscriptions';
import { AlertsPanel } from './AlertsPanel';
import { AuditModal } from './AuditModal';
import { BreachForecastPanel } from './BreachForecastPanel';
import { CommentsLayer } from './CommentsLayer';
import { ComparePanel } from './ComparePanel';
import { ExportPdfTrigger } from './ExportPdfButton';
import { ExportXlsxTrigger } from './ExportXlsxButton';
import { HelpModal } from './HelpModal';
import { IntelFeedPanel } from './IntelFeedPanel';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { PeerPanel } from './PeerPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { SubCoFinanceChat } from './SubCoFinanceChat';
import { WhatIfPreviewPanel } from './WhatIfPreviewPanel';

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

/**
 * Route-level host for terminal overlays and event-driven export listeners.
 *
 * These components used to be children of PanelGrid. Keeping them mounted at
 * the route boundary preserves every existing `terminal:*` CustomEvent while
 * allowing the Expert workspace to be isolated (and, later, unmounted) without
 * silently disabling global terminal actions.
 */
export function TerminalOverlayHost() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );

  // PanelGrid previously mounted these listeners only after its hydration gate.
  // Preserve that SSR and first-paint sequence while moving ownership upward.
  if (!hydrated) return null;

  return (
    <>
      <AuditModal />
      <HelpModal />
      <ComparePanel />
      <PeerPanel />
      <ExportPdfTrigger />
      <ExportXlsxTrigger />
      <AlertsPanel />
      <ScenarioPanel />
      <ActionCenterPanel />
      <CommentsLayer />
      <SubCoFinanceChat />
      <AISubscriptions />
      <IntelFeedPanel />
      <BreachForecastPanel />
      <WhatIfPreviewPanel />
      <KeyboardShortcutsModal />
    </>
  );
}
