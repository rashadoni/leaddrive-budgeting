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
  Download,
  FilePlus2,
  GitCompare,
  HelpCircle,
  History,
  RefreshCw,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { useMatrix } from "../hooks/use-matrix";

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
  // Phase 7.E phase 2 hardening (sub-40) — the route handler requires
  // `period` in the POST body. Pre-fix this button sent no body and 400'd
  // silently behind a swallowed `.catch()`. Read the currently-rendered
  // period from the matrix hook (no extra fetch — the cache is shared
  // with HeatMap's mount). Falls back to undefined while matrix is still
  // loading; the button is disabled in that window so the user never
  // triggers a 400.
  const { matrix } = useMatrix();
  const currentPeriod = matrix?.period;

  const fireWindowEvent = (name: string, detail?: unknown) => {
    window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
    return true;
  };

  const triggerRecompute = () => {
    if (recomputing || !currentPeriod) return false;
    setRecomputing(true);
    // Phase 6.1 — POST may return 202 + jobId (async path) or 200 + sync
    // results (small fan-out). Either way we clear the spinner when the
    // initial request resolves. For async path, poll the job until it
    // finishes; per-poll updates the running label so the user sees
    // "running 23/180".
    fetch("/api/indicators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: currentPeriod }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (body?.async && body?.jobId) {
          // Poll until succeeded/failed or 5min timeout.
          const startedAt = Date.now();
          const pollOnce = async (): Promise<void> => {
            if (Date.now() - startedAt > 5 * 60_000) return;
            try {
              const r = await fetch(`/api/recompute/jobs/${body.jobId}`, { cache: "no-store" });
              if (!r.ok) return;
              const j = await r.json();
              if (j.status === "running" || j.status === "pending") {
                setTimeout(pollOnce, 1500);
              }
            } catch {
              // Network blip — give up silently; user can re-fire.
            }
          };
          pollOnce();
        }
      })
      .catch(() => {})
      .finally(() => {
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
        : !currentPeriod
          ? t("hotkeys.recomputeNoPeriod")
          : t("hotkeys.recomputeTitle"),
      action: triggerRecompute,
      disabled: recomputing || !currentPeriod,
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
    {
      // CLI Bloomberg-sweep — discoverable HELP button. Same destination as
      // typing `HELP GO` in the command bar.
      key: "help",
      label: t("hotkeys.help"),
      icon: HelpCircle,
      title: t("hotkeys.helpTitle"),
      action: () => fireWindowEvent("terminal:open-help"),
    },
    {
      // CLI Tier 3 — Risk Matrix PDF export. Fires event consumed by
      // <ExportPdfTrigger /> mounted in PanelGrid which lazy-loads
      // @react-pdf/renderer + builds the multi-page document.
      key: "export-pdf",
      label: t("hotkeys.exportPdf"),
      icon: Download,
      title: t("hotkeys.exportPdfTitle"),
      action: () => fireWindowEvent("terminal:export-pdf"),
    },
    {
      // Tier 3 closer — xlsx export. Sister button to PDF; builds a
      // 3-sheet workbook (Summary / Matrix values / Matrix status /
      // Today's Brief). Lazy-loads `xlsx` in <ExportXlsxTrigger />.
      key: "export-xlsx",
      label: t("hotkeys.exportXlsx"),
      icon: Download,
      title: t("hotkeys.exportXlsxTitle"),
      action: () => fireWindowEvent("terminal:export-xlsx"),
    },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("hotkeys.toolbarAriaLabel")}
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
        title={t("hotkeys.compactTitle")}
        aria-label={t("hotkeys.compactAriaLabel")}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-800 hover:border-[#00D4AA]/60 hover:text-[#00D4AA] hover:bg-[#00D4AA]/5 transition-colors shrink-0 ml-auto"
      >
        ▦ {t("hotkeys.compact")}
      </button>
    </div>
  );
}
