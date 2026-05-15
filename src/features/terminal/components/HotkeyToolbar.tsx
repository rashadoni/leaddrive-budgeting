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
  Cloud,
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
  Pencil,
  RefreshCw,
  Rss,
  Search,
  Sprout,
  Star,
  Upload,
} from "lucide-react";
import { useTerminalStore } from "../store/terminalStore";
import { useMatrix } from "../hooks/use-matrix";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Phase 7.I — open a terminal pop-out widget by kind. Mirrors the
 *  CommandBar verbs (AGRO / WX / PRICE / KPI) so the toolbar buttons and
 *  command-line shortcut both land on the same window. The active
 *  company is forwarded via `?company=<code>` so the popped window
 *  doesn't land on a blank "Select a company" state — each browser
 *  window has its own React state, no cross-window sync without URL
 *  hydration. */
function openPopOut(kind: string, company: string | null): boolean {
  if (typeof window === "undefined") return false;
  const qs = company ? `?company=${encodeURIComponent(company)}` : "";
  window.open(`/terminal-panel/${kind}${qs}`, `terminal-panel-${kind}`);
  return true;
}

/**
 * Phase 7.I — visual grouping. Buttons share a `group` tag; in render
 * order, when the group changes vs the previous visible button, a
 * subtle vertical separator is inserted. Group labels surface as a
 * tooltip on the separator for discoverability without taking up
 * horizontal space. Order within each group preserves muscle-memory
 * adjacency for related verbs.
 */
type HotkeyGroup =
  | "critical" // alerts / breach / actions — surfaces that drive triage
  | "analysis" // compare / scenario / whatif / peer — drill-down workflows
  | "social"   // intel / comments / chat / subs — collaboration surfaces
  | "workspace" // new-plan / import / search / favorites / recent — view + entry
  | "sector"   // agro / commodity / kpi-entry — industry-specific (gated)
  | "ops";     // recompute / help / export — system actions

const GROUP_LABELS: Record<HotkeyGroup, string> = {
  critical: "Alerts & triage",
  analysis: "Analysis",
  social: "Intel & social",
  workspace: "Workspace",
  sector: "Sector",
  ops: "Tools",
};

interface HotkeyDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  /** Visual grouping cluster — drives separator placement. */
  group: HotkeyGroup;
  /**
   * Phase 7.I — Variant C palette restructure.
   *   pinned   — high-frequency action; always visible in the toolbar.
   *   overflow — accessible only via CommandBar verb + `⌘K All commands`
   *              palette trigger. Keeps the toolbar uncluttered without
   *              losing access — CommandBar already supports fuzzy verb
   *              search (`fuzzyScore` in CommandBar.tsx) so users get
   *              one keystroke + autocomplete to every hidden command.
   *
   * Bloomberg-style discipline: top toolbar reserved for triage +
   * system ops (alerts, breach, actions, recompute, help). Workflow +
   * social + analysis surfaces accessed by name (CommandBar verbs)
   * because muscle memory + autocomplete is faster than scanning a
   * 20-button strip.
   */
  priority: "pinned" | "overflow";
  /** Returns true if action ran; false if disabled / no-op. */
  action: () => boolean;
  disabled?: boolean;
}

export function HotkeyToolbar() {
  const t = useTranslations("terminal");
  const setWatchlistTab = useTerminalStore((s) => s.setWatchlistTab);
  const toggleCompactMode = useTerminalStore((s) => s.toggleCompactMode);
  const activePanelId = useTerminalStore((s) => s.activePanelId);
  // Phase 7.I — forward active company to pop-out widgets via URL param.
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const [recomputing, setRecomputing] = useState(false);
  // Phase 7.I — controlled state for the ⌘K palette popover so item
  // click-handlers can close it after firing their action. Uncontrolled
  // Radix popovers can't be programmatically closed from inside their
  // own content without a `PopoverClose` wrapper (not exported), so we
  // lift state instead.
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  // Phase 7.I overflow fix — read industry of the active company so we can
  // gate sector-specific toolbar buttons. AGRO/PRICE/KPI render only for
  // agro_crops + food_processing companies; other industries keep the
  // generic toolbar uncluttered. Reuses useMatrix() — no extra fetch.
  const activeCompanyIndustry = (() => {
    const co = matrix?.companies.find((c) => c.code === activeCompanyCode);
    return co?.industry ?? null;
  })();
  const isAgroLike =
    activeCompanyIndustry === "agro_crops" ||
    activeCompanyIndustry === "food_processing";

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
    // ─── Critical: surfaces that drive triage ─────────────────────────
    {
      key: "alerts",
      label: t("hotkeys.alerts"),
      icon: Bell,
      title: t("hotkeys.alertsTitle"),
      group: "critical",
      priority: "pinned",
      action: () => fireWindowEvent("terminal:open-audit"),
    },
    {
      key: "breach",
      label: t("hotkeys.breach"),
      icon: AlertTriangle,
      title: t("hotkeys.breachTitle"),
      group: "critical",
      priority: "pinned",
      action: () => fireWindowEvent("terminal:open-breach"),
    },
    {
      key: "actions",
      label: t("hotkeys.actions"),
      icon: ListTodo,
      title: t("hotkeys.actionsTitle"),
      group: "critical",
      priority: "pinned",
      action: () => fireWindowEvent("terminal:open-action-center"),
    },
    // ─── Analysis: comparison + what-if surfaces (overflow → CommandBar) ──
    {
      key: "compare",
      label: t("hotkeys.compare"),
      icon: GitCompare,
      title: t("hotkeys.compareTitle") + " · ⌘K: CMP A,B GO",
      group: "analysis",
      priority: "overflow",
      action: () => prefillCmdBar('CMP '),
    },
    {
      key: "scenario",
      label: t("hotkeys.scenario"),
      icon: FlaskConical,
      title: t("hotkeys.scenarioTitle") + " · ⌘K: SCN <code> GO",
      group: "analysis",
      priority: "overflow",
      action: () => prefillCmdBar('SCN '),
    },
    {
      key: "whatif",
      label: t("hotkeys.whatif"),
      icon: FlaskConical,
      title: t("hotkeys.whatifTitle"),
      group: "analysis",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:open-whatif"),
    },
    {
      key: "peer",
      label: t("hotkeys.peer"),
      icon: Layers,
      title: t("hotkeys.peerTitle") + " · ⌘K: PEER A,B,C GO",
      group: "analysis",
      priority: "overflow",
      action: () => prefillCmdBar('PEER '),
    },
    // ─── Intel & social: collaboration surfaces (overflow → CommandBar) ──
    {
      key: "intel",
      label: t("hotkeys.intel"),
      icon: Rss,
      title: t("hotkeys.intelTitle") + " · ⌘K: INT GO",
      group: "social",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:open-intel"),
    },
    {
      key: "subs",
      label: t("hotkeys.subs"),
      icon: BellRing,
      title: t("hotkeys.subsTitle") + " · ⌘K: SUB GO",
      group: "social",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:open-subscriptions"),
    },
    {
      key: "comments",
      label: t("hotkeys.comments"),
      icon: MessageSquare,
      title: t("hotkeys.commentsTitle") + " · ⌘K: CMT GO",
      group: "social",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:open-comments"),
    },
    {
      key: "chat",
      label: t("hotkeys.chat"),
      icon: MessagesSquare,
      title: t("hotkeys.chatTitle") + " · ⌘K: CHT GO",
      group: "social",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:open-subco-chat"),
    },
    // ─── Workspace: data entry + navigation (overflow → CommandBar) ──
    {
      key: "new-plan",
      label: t("hotkeys.newPlan"),
      icon: FilePlus2,
      title: t("hotkeys.newPlanTitle"),
      group: "workspace",
      priority: "overflow",
      action: () => {
        window.location.href = "/budgeting?tab=plans";
        return true;
      },
    },
    {
      key: "import",
      label: t("hotkeys.import"),
      icon: Upload,
      title: t("hotkeys.importTitle"),
      group: "workspace",
      priority: "overflow",
      action: () => {
        window.location.href = "/budgeting/onboarding";
        return true;
      },
    },
    {
      key: "search",
      label: t("hotkeys.search"),
      icon: Search,
      title: t("hotkeys.searchTitle"),
      group: "workspace",
      priority: "overflow",
      action: () =>
        fireWindowEvent("terminal:focus-search", { panelId: activePanelId }),
    },
    {
      key: "favorites",
      label: t("hotkeys.starred"),
      icon: Star,
      title: t("hotkeys.starredTitle"),
      group: "workspace",
      priority: "overflow",
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
      group: "workspace",
      priority: "overflow",
      action: () => {
        setWatchlistTab("recent");
        return true;
      },
    },
    // ─── Sector: agro/sugar widgets (pinned ONLY when active company is
    //     agro_crops or food_processing). High-frequency for cane-cycle
    //     entities — these earn pinned status when they apply.
    ...(isAgroLike
      ? ([
          {
            key: "agro",
            label: "AGRO",
            icon: Sprout,
            title:
              "Open agro dashboard (yield, sugar content, water/fertilizer intensity) · ⌘K: AGRO GO",
            group: "sector",
            priority: "pinned",
            action: () => openPopOut("agro-dashboard", activeCompanyCode),
          },
          {
            key: "commodity",
            label: "PRICE",
            icon: Cloud,
            title:
              "Open sugar price + weather pop-out (ICE #11 trend + AZ rainfall) · ⌘K: PRICE GO",
            group: "sector",
            priority: "pinned",
            action: () => openPopOut("commodity-ticker", activeCompanyCode),
          },
          {
            key: "kpi-entry",
            label: "KPI",
            icon: Pencil,
            title:
              "Log an agronomy KPI (yield, sugar content, etc.) for the active company · ⌘K: KPI GO",
            group: "sector",
            priority: "pinned",
            action: () => openPopOut("agronomy-entry", activeCompanyCode),
          },
        ] as HotkeyDef[])
      : []),
    // ─── Ops: system actions ──────────────────────────────────────────
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
      group: "ops",
      priority: "pinned",
      action: triggerRecompute,
      disabled: recomputing || !currentPeriod,
    },
    {
      // CLI Bloomberg-sweep — discoverable HELP button. Same destination as
      // typing `HELP GO` in the command bar.
      key: "help",
      label: t("hotkeys.help"),
      icon: HelpCircle,
      title: t("hotkeys.helpTitle") + " · ⌘K: HELP GO",
      group: "ops",
      priority: "pinned",
      action: () => fireWindowEvent("terminal:open-help"),
    },
    {
      key: "export-pdf",
      label: t("hotkeys.exportPdf"),
      icon: Download,
      title: t("hotkeys.exportPdfTitle"),
      group: "ops",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:export-pdf"),
    },
    {
      key: "export-xlsx",
      label: t("hotkeys.exportXlsx"),
      icon: Download,
      title: t("hotkeys.exportXlsxTitle"),
      group: "ops",
      priority: "overflow",
      action: () => fireWindowEvent("terminal:export-xlsx"),
    },
  ];

  // Phase 7.I — Variant C: only render pinned buttons in the toolbar.
  // Overflow buttons (compare/scenario/intel/etc.) accessible via the
  // CommandBar's `⌘K Commands` button below + via direct verbs.
  const visibleHotkeys = hotkeys.filter((h) => h.priority === "pinned");
  const overflowCount = hotkeys.length - visibleHotkeys.length;

  /** Focus the CommandBar input + scroll it into view. Used by both the
   *  `⌘K Commands` button and the existing Cmd+K keyboard shortcut. */
  const focusCommandBar = (): boolean => {
    const input = document.querySelector(
      'input[data-cmd-bar]',
    ) as HTMLInputElement | null;
    if (!input) return false;
    input.focus();
    input.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  };

  return (
    <div
      role="toolbar"
      aria-label={t("hotkeys.toolbarAriaLabel")}
      className="flex items-center gap-1 px-2 py-1 bg-[#050814] border-b border-gray-800 font-mono text-[10px] text-gray-500 overflow-x-auto whitespace-nowrap shrink-0"
    >
      <span className="text-gray-700 shrink-0 mr-1">⌘ {t("hotkeys.label")}</span>
      {visibleHotkeys.map((h, i) => {
        const Icon = h.icon;
        // Phase 6.1 — progress overlay on Recompute button when async job
        // is in flight. Cyan fill grows left → right behind the icon+label.
        const showProgress =
          h.key === "recompute" && recomputeProgress && recomputeProgress.total > 0;
        const pct = showProgress
          ? Math.min(100, Math.max(0, Math.round((recomputeProgress!.processed / recomputeProgress!.total) * 100)))
          : 0;
        // Phase 7.I — Variant C grouping. When the current button's group
        // differs from the previous visible button's group, prepend a
        // subtle vertical separator. The separator carries the group
        // label as a tooltip so users can discover the cluster name
        // without consuming horizontal space with always-visible labels.
        const prev = i > 0 ? visibleHotkeys[i - 1] : null;
        const groupChanged = prev !== null && prev.group !== h.group;
        return (
          <React.Fragment key={h.key}>
            {groupChanged && (
              <span
                aria-hidden="true"
                title={GROUP_LABELS[h.group]}
                // Visible vertical divider: 1px border, ~14px tall, gap on both
                // sides so the cluster boundary is clearly readable against the
                // dark toolbar background. Hover surfaces the group label as
                // a tooltip without consuming horizontal space.
                className="shrink-0 mx-2 self-stretch border-l border-gray-700 cursor-help"
                style={{ minHeight: "16px" }}
              />
            )}
            <button
              type="button"
              onClick={h.action}
              disabled={h.disabled}
              title={h.title}
              aria-label={h.title}
              data-group={h.group}
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
          </React.Fragment>
        );
      })}
      {/* Phase 7.I Variant C — `⌘K palette` popover. Lists every overflow
          command with icon + label + group header, click-to-execute.
          Replaces the earlier "focus the CommandBar" behavior — clicking
          the trigger now actually reveals what's hidden so discovery
          doesn't require knowing verbs in advance. Cmd+K keyboard
          shortcut still focuses the CommandBar input (existing
          handler in CommandBar.tsx); both paths are valid entry. */}
      <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t("hotkeys.paletteTitle", { count: overflowCount })}
            aria-label={t("hotkeys.paletteAriaLabel")}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#00D4AA]/40 text-[#00D4AA] hover:bg-[#00D4AA]/10 hover:border-[#00D4AA] transition-colors shrink-0 ml-2 font-semibold"
          >
            <span className="opacity-70">⌘K</span>
            <span>{t("hotkeys.paletteLabel", { count: overflowCount })}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-80 max-h-[70vh] overflow-y-auto p-0 bg-[#0A0E27] border-gray-800 text-gray-300 font-mono text-[11px]"
        >
          <div className="px-3 py-2 border-b border-gray-800 text-[10px] uppercase tracking-wider text-gray-500 flex items-center justify-between">
            <span>Command palette</span>
            <span className="text-gray-600">
              {overflowCount} command{overflowCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="px-3 py-1 border-b border-gray-800 text-[9px] text-gray-600 leading-relaxed">
            Type in the command bar below (⌘K) for fuzzy search — these
            shortcuts are the click-equivalents.
          </div>
          {/* Group overflow items by their group label for visual rhythm. */}
          {(["analysis", "social", "workspace", "ops"] as HotkeyGroup[]).flatMap((g) => {
            const groupItems = hotkeys.filter((h) => h.priority === "overflow" && h.group === g);
            if (groupItems.length === 0) return [];
            return [
              <div
                key={`${g}-header`}
                className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-wider text-gray-600"
              >
                {GROUP_LABELS[g]}
              </div>,
              ...groupItems.map((h) => {
                const Icon = h.icon;
                return (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => {
                      h.action();
                      // Close the palette after firing — controlled state
                      // lets us toggle from inside content without
                      // PopoverClose (not exported from ui/popover).
                      setPaletteOpen(false);
                    }}
                    disabled={h.disabled}
                    title={h.title}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#00D4AA]/5 hover:text-[#00D4AA] disabled:opacity-40 transition-colors text-left"
                  >
                    <Icon size={12} className="shrink-0 opacity-70" />
                    <span className="flex-1 truncate">{h.label}</span>
                  </button>
                );
              }),
            ];
          })}
          <div className="px-3 py-2 border-t border-gray-800 text-[9px] text-gray-600 leading-relaxed">
            Tip: press <span className="text-gray-400">⌘K</span> anywhere to focus the command bar instead.
          </div>
        </PopoverContent>
      </Popover>
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
