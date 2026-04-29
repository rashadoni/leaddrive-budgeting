"use client";

/**
 * Phase B6 (Bloomberg uplift plan) — top hotkey toolbar.
 *
 * 8 user-action shortcuts above the CommandBar. v1 ships fixed defaults;
 * drag-reorder + custom-action mapping deferred to v2 (🔄 in CARRYOVER).
 *
 * Each button either:
 *   - Fires a window event consumed elsewhere (terminal:open-audit,
 *     terminal:focus-search)
 *   - Focuses the CommandBar input directly (COMPARE: prefills "CMP ")
 *   - Calls a store action (toggle compactMode, set watchlistTab)
 *   - Navigates via location.href (Plans tab, Onboarding)
 *   - POSTs to /api/indicators for RECOMPUTE (with disabled-while-pending UX)
 *
 * Bloomberg shops on Linux/Windows: lucide icons (no emoji) for parity.
 *
 * Action wiring is intentionally lightweight — the toolbar is a
 * shortcut surface, not a state machine. Each button hits a pre-existing
 * surface or fires an event; if a button has no destination yet, it's
 * disabled with an explanatory title.
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("terminal");
  const setWatchlistTab = useTerminalStore((s) => s.setWatchlistTab);
  const toggleCompactMode = useTerminalStore((s) => s.toggleCompactMode);
  const activePanelId = useTerminalStore((s) => s.activePanelId);
  const [recomputing, setRecomputing] = useState(false);

  const fireWindowEvent = (name: string, detail?: unknown) => {
    window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
    return true;
  };

  const triggerRecompute = () => {
    if (recomputing) return false;
    setRecomputing(true);
    fetch("/api/indicators", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        // Brief delay so the user sees the feedback even on fast servers.
        setTimeout(() => setRecomputing(false), 800);
      });
    return true;
  };

  const hotkeys: HotkeyDef[] = [
    {
      key: "new-plan",
      label: t("hotkeys.newPlan"),
      icon: FilePlus2,
      title: t("hotkeys.newPlanTitle"),
      action: () => {
        window.location.href = "/budgeting?tab=plans";
        return true;
      },
    },
    {
      key: "compare",
      label: t("hotkeys.compare"),
      icon: GitCompare,
      title: t("hotkeys.compareTitle"),
      action: () => {
        // Prefill CMD-bar with "CMP " so the user just types 2 company
        // codes + GO. Uses data-cmd-bar marker that PanelGrid switchPanel
        // also matches; here we both focus AND prefill the value.
        const input = document.querySelector(
          'input[data-cmd-bar]',
        ) as HTMLInputElement | null;
        if (input) {
          input.focus();
          // React-controlled input: set via native setter so React picks it up.
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )?.set;
          if (setter) {
            setter.call(input, 'CMP ');
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        return true;
      },
    },
    {
      key: "alerts",
      label: t("hotkeys.alerts"),
      icon: Bell,
      title: t("hotkeys.alertsTitle"),
      action: () => fireWindowEvent("terminal:open-audit"),
    },
    {
      key: "favorites",
      label: t("hotkeys.starred"),
      icon: Star,
      title: t("hotkeys.starredTitle"),
      action: () => {
        setWatchlistTab("starred");
        return true;
      },
    },
    {
      key: "recent",
      label: t("hotkeys.recent"),
      icon: History,
      title: t("hotkeys.recentTitle"),
      action: () => {
        setWatchlistTab("recent");
        return true;
      },
    },
    {
      key: "recompute",
      label: recomputing ? t("hotkeys.running") : t("hotkeys.recompute"),
      icon: RefreshCw,
      title: recomputing
        ? t("hotkeys.recomputeRunning")
        : t("hotkeys.recomputeTitle"),
      action: triggerRecompute,
      disabled: recomputing,
    },
    {
      key: "search",
      label: t("hotkeys.search"),
      icon: Search,
      title: t("hotkeys.searchTitle"),
      action: () =>
        fireWindowEvent("terminal:focus-search", { panelId: activePanelId }),
    },
    {
      key: "import",
      label: t("hotkeys.import"),
      icon: Upload,
      title: t("hotkeys.importTitle"),
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
      <span className="text-gray-700 shrink-0 mr-1">⌘ {t("hotkeys.label")}</span>
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
