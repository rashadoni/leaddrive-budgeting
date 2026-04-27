"use client";

/**
 * Phase B6 (Bloomberg uplift plan) — top hotkey toolbar.
 *
 * 8 user-action shortcuts above the CommandBar. v1 ships fixed defaults;
 * drag-reorder + custom-action mapping deferred to v2 (🔄 in CARRYOVER).
 *
 * Each button either:
 *   - Fires a window event consumed elsewhere (terminal:open-audit /
 *     terminal:open-compare-picker / terminal:focus-search)
 *   - Calls a store action (toggle compactMode, set watchlistTab)
 *   - Navigates via location.href (P&L tabs / plans tab)
 *
 * Bloomberg shops on Linux/Windows: lucide icons (no emoji) for parity.
 *
 * Action wiring is intentionally lightweight — the toolbar is a
 * shortcut surface, not a state machine. Each button hits a pre-existing
 * surface or fires an event; if a button has no destination yet, it's
 * disabled with an explanatory title.
 */

import React from "react";
import {
  Bell,
  FilePlus2,
  GitCompare,
  History,
  RefreshCw,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";

interface HotkeyDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  /** Returns true if action ran; false if disabled / no-op. */
  action: () => boolean;
  disabled?: boolean;
}

export function HotkeyToolbar() {
  const setWatchlistTab = useTerminalStore((s) => s.setWatchlistTab);
  const toggleCompactMode = useTerminalStore((s) => s.toggleCompactMode);
  const activePanelId = useTerminalStore((s) => s.activePanelId);

  const fireWindowEvent = (name: string, detail?: unknown) => {
    window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
    return true;
  };

  const hotkeys: HotkeyDef[] = [
    {
      key: "new-plan",
      label: "NEW PLAN",
      icon: FilePlus2,
      title: "Open Plans tab in /budgeting (create / approve plans)",
      action: () => {
        window.location.href = "/budgeting?tab=plans";
        return true;
      },
    },
    {
      key: "compare",
      label: "COMPARE",
      icon: GitCompare,
      title: "Type CMP <CO1> <CO2> GO in the command bar to open Compare panel",
      action: () => {
        // No companies pre-selected → bring user to CMD bar with hint.
        fireWindowEvent("terminal:focus-search", { panelId: 0 });
        return true;
      },
    },
    {
      key: "alerts",
      label: "ALERTS",
      icon: Bell,
      title: "Open Audit Log overlay (AUD GO equivalent)",
      action: () => fireWindowEvent("terminal:open-audit"),
    },
    {
      key: "favorites",
      label: "STARRED",
      icon: Star,
      title: "Filter CompanyTree to starred companies",
      action: () => {
        setWatchlistTab("starred");
        return true;
      },
    },
    {
      key: "recent",
      label: "RECENT",
      icon: History,
      title: "Filter CompanyTree to recently-viewed companies",
      action: () => {
        setWatchlistTab("recent");
        return true;
      },
    },
    {
      key: "recompute",
      label: "RECOMPUTE",
      icon: RefreshCw,
      title: "Trigger indicator-matrix recompute (POST /api/indicators)",
      action: () => {
        // Fire-and-forget; SSE will refresh HeatMap when finished.
        void fetch("/api/indicators", { method: "POST" }).catch(() => {});
        return true;
      },
    },
    {
      key: "search",
      label: "SEARCH",
      icon: Search,
      title: `Focus the search input in active panel ${activePanelId} (same as /)`,
      action: () =>
        fireWindowEvent("terminal:focus-search", { panelId: activePanelId }),
    },
    {
      key: "import",
      label: "IMPORT",
      icon: Upload,
      title: "Upload a budget xlsx via Onboarding wizard",
      action: () => {
        window.location.href = "/budgeting/onboarding";
        return true;
      },
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Terminal hotkeys"
      className="flex items-center gap-1 px-2 py-1 bg-[#050814] border-b border-gray-800 font-mono text-[10px] text-gray-500 overflow-x-auto whitespace-nowrap shrink-0"
    >
      <span className="text-gray-700 shrink-0 mr-1">⌘ HOTKEYS</span>
      {hotkeys.map((h) => {
        const Icon = h.icon;
        return (
          <button
            key={h.key}
            type="button"
            onClick={h.action}
            disabled={h.disabled}
            title={h.title}
            aria-label={h.title}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-800 hover:border-[#00D4AA]/60 hover:text-[#00D4AA] hover:bg-[#00D4AA]/5 disabled:opacity-40 disabled:hover:border-gray-800 disabled:hover:text-gray-500 disabled:hover:bg-transparent transition-colors shrink-0"
          >
            <Icon size={11} />
            <span>{h.label}</span>
          </button>
        );
      })}
      {/* Compact-mode toggle is in PanelGrid; mirror it here for one-stop access */}
      <button
        type="button"
        onClick={() => toggleCompactMode()}
        title="Toggle compact mode (Ctrl+/)"
        aria-label="Toggle compact mode"
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-800 hover:border-[#00D4AA]/60 hover:text-[#00D4AA] hover:bg-[#00D4AA]/5 transition-colors shrink-0 ml-auto"
      >
        ▦ COMPACT
      </button>
    </div>
  );
}
