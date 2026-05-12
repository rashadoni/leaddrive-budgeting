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
  AlertTriangle,
  Bell,
  BellRing,
  Download,
  FilePlus2,
  FlaskConical,
  GitCompare,
  HelpCircle,
  History,
  Layers,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Rss,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { useMatrix } from "../hooks/use-matrix";

interface HotkeyDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
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
  // Phase 6.1 — async recompute progress. null when no async job is in
  // flight; { processed, total } populated by polling the job state.
  const [recomputeProgress, setRecomputeProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
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

  const prefillCmdBar = (prefix: string): boolean => {
    const input = document.querySelector(
      'input[data-cmd-bar]',
    ) as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    if (setter) {
      setter.call(input, prefix);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
          setRecomputeProgress({ processed: 0, total: body.total ?? 0 });
          const startedAt = Date.now();
          const pollOnce = async (): Promise<void> => {
            if (Date.now() - startedAt > 5 * 60_000) {
              setRecomputeProgress(null);
              setRecomputing(false);
              return;
            }
            try {
              const r = await fetch(`/api/recompute/jobs/${body.jobId}`, { cache: "no-store" });
              if (!r.ok) {
                setRecomputeProgress(null);
                setRecomputing(false);
                return;
              }
              const j = await r.json();
              setRecomputeProgress({ processed: j.processed, total: j.total });
              if (j.status === "running" || j.status === "pending") {
                setTimeout(pollOnce, 1500);
              } else {
                // Brief delay so user sees the 100% bar before it disappears.
                setTimeout(() => {
                  setRecomputeProgress(null);
                  setRecomputing(false);
                }, 800);
              }
            } catch {
              setRecomputeProgress(null);
              setRecomputing(false);
            }
          };
          pollOnce();
          return; // Async path manages its own clear above.
        }
        // Sync path — clear immediately.
        setTimeout(() => setRecomputing(false), 800);
      })
      .catch(() => {
        setRecomputeProgress(null);
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
      action: () => prefillCmdBar('CMP '),
    },
    {
      key: "alerts",
      label: t("hotkeys.alerts"),
      icon: Bell,
      title: t("hotkeys.alertsTitle"),
      action: () => fireWindowEvent("terminal:open-audit"),
    },
    {
      key: "breach",
      label: t("hotkeys.breach"),
      icon: AlertTriangle,
      title: t("hotkeys.breachTitle"),
      action: () => fireWindowEvent("terminal:open-breach"),
    },
    {
      key: "intel",
      label: t("hotkeys.intel"),
      icon: Rss,
      title: t("hotkeys.intelTitle"),
      action: () => fireWindowEvent("terminal:open-intel"),
    },
    {
      key: "actions",
      label: t("hotkeys.actions"),
      icon: ListTodo,
      title: t("hotkeys.actionsTitle"),
      action: () => fireWindowEvent("terminal:open-action-center"),
    },
    {
      key: "subs",
      label: t("hotkeys.subs"),
      icon: BellRing,
      title: t("hotkeys.subsTitle"),
      action: () => fireWindowEvent("terminal:open-subscriptions"),
    },
    {
      key: "comments",
      label: t("hotkeys.comments"),
      icon: MessageSquare,
      title: t("hotkeys.commentsTitle"),
      action: () => fireWindowEvent("terminal:open-comments"),
    },
    {
      key: "chat",
      label: t("hotkeys.chat"),
      icon: MessagesSquare,
      title: t("hotkeys.chatTitle"),
      action: () => fireWindowEvent("terminal:open-subco-chat"),
    },
    {
      key: "scenario",
      label: t("hotkeys.scenario"),
      icon: FlaskConical,
      title: t("hotkeys.scenarioTitle"),
      action: () => prefillCmdBar('SCN '),
    },
    {
      key: "whatif",
      label: t("hotkeys.whatif"),
      icon: FlaskConical,
      title: t("hotkeys.whatifTitle"),
      action: () => fireWindowEvent("terminal:open-whatif"),
    },
    {
      key: "peer",
      label: t("hotkeys.peer"),
      icon: Layers,
      title: t("hotkeys.peerTitle"),
      action: () => prefillCmdBar('PEER '),
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
      label: recomputeProgress
        ? `${recomputeProgress.processed}/${recomputeProgress.total}`
        : recomputing
          ? t("hotkeys.running")
          : t("hotkeys.recompute"),
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
        // Phase 6.1 — progress overlay on Recompute button when async job
        // is in flight. Cyan fill grows left → right behind the icon+label.
        const showProgress =
          h.key === "recompute" && recomputeProgress && recomputeProgress.total > 0;
        const pct = showProgress
          ? Math.min(100, Math.max(0, Math.round((recomputeProgress!.processed / recomputeProgress!.total) * 100)))
          : 0;
        return (
          <button
            key={h.key}
            type="button"
            onClick={h.action}
            disabled={h.disabled}
            title={h.title}
            aria-label={h.title}
            className="relative flex items-center gap-1 px-2 py-0.5 rounded border border-gray-800 hover:border-[#00D4AA]/60 hover:text-[#00D4AA] hover:bg-[#00D4AA]/5 disabled:opacity-40 disabled:hover:border-gray-800 disabled:hover:text-gray-500 disabled:hover:bg-transparent transition-colors shrink-0 overflow-hidden"
          >
            {showProgress && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-[#00D4AA]/30 transition-all duration-300 pointer-events-none"
                style={{ width: `${pct}%` }}
              />
            )}
            <Icon size={11} className="relative" />
            <span className="relative">{h.label}</span>
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
