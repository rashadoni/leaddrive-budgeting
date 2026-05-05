"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTerminalStore } from "../store/terminalStore";
import { useEventStream } from "@/lib/events/use-event-stream";
import { summarizeAuditEvent } from "@/lib/audit/compact-summary";
import type { AuditAction } from "@prisma/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Bloomberg-style bottom event ticker — 1-line strip surfacing the most
 * recent ~5 audit events. Click anywhere on the strip fires
 * `terminal:open-audit` (the same event CommandBar's `AUD GO` dispatch
 * fires) to open the full AuditModal.
 *
 * Reads `/api/audit/events?limit=5` on mount AND on every `audit:changed`
 * SSE event (Phase B1 infra — wired via `useEventStream` below). Shows
 * `—` while loading and "no events" if the org has no audit history yet.
 * Phase 7.G Turn Q closure: comment was stale claiming "fetched once on
 * mount; live updates land in Phase B1" — B1 shipped before this comment
 * was last updated. Refetch path is live since the `useEventStream`
 * call at the bottom of the component.
 *
 * Manager+ role gating happens server-side; viewers get a 403, which
 * surfaces as the "no events" state (intentionally silent — non-managers
 * shouldn't see "permission denied" pollution in the always-visible
 * status bar).
 */

interface AuditEvent {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const TICKER_LIMIT = 5;

export function AuditTicker() {
  const t = useTranslations("terminal");
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const compactMode = useTerminalStore((s) => s.compactMode);

  const refetch = useCallback(() => {
    fetch(`/api/audit/events?limit=${TICKER_LIMIT}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data) => {
        setEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch(() => {
        setEvents((prev) => prev ?? []);
      });
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Phase B1 — refetch when SSE stream signals a new audit event.
  useEventStream({
    onAuditChanged: refetch,
  });

  const handleClick = () => {
    window.dispatchEvent(new Event("terminal:open-audit"));
  };

  return (
    <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>
    <div
      onClick={handleClick}
      role="button"
      // Phase 7.G Turn Q — Turn-40-sub3 architect 💡 closure (tab-order
      // semantics): `tabIndex={0}` puts the strip into the keyboard tab
      // order between primary surfaces (CommandBar / LayoutMenu / panel
      // search inputs / AuditModal Close). Accepted UX trade-off:
      // - keeps the always-visible audit strip keyboard-reachable for
      //   power users who want Enter-to-open-modal without mouse;
      // - the strip is short-content + clearly labelled (aria-label +
      //   Radix tooltip via TooltipProvider) — not a "noisy" tab stop;
      // - alternative considered (move to end-of-DOM with tabIndex={-1}
      //   + global Enter shortcut) would split the discoverability —
      //   keyboard users would tab past the visible status surface.
      // Default = stay tabbable. Revisit if user feedback complains.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`flex items-center gap-3 bg-[#050814] border-t border-gray-800 px-4 font-mono text-gray-400 cursor-pointer hover:text-gray-200 transition-colors overflow-x-auto whitespace-nowrap shrink-0 ${
        compactMode ? 'py-0.5 text-[9px]' : 'py-1.5 text-[10px]'
      }`}
      aria-label={t("auditTicker.ariaLabel")}
    >
      <span className="text-gray-600 shrink-0">{t("auditTicker.events")}</span>
      {events === null && <span className="text-gray-700">{t("auditTicker.loading")}</span>}
      {events !== null && events.length === 0 && (
        <span className="text-gray-700">{t("auditTicker.noEvents")}</span>
      )}
      {events !== null && events.length > 0 && (
        <div className="flex items-center gap-3 min-w-0">
          {events.map((e, i) => (
            <span key={e.id} className="flex items-center gap-1.5 shrink-0">
              {i > 0 && <span className="text-gray-700">·</span>}
              <span className="text-gray-500">{formatTime(e.createdAt)}</span>
              <span className="text-[#00D4AA]">{e.action}</span>
              <span className="text-gray-300">
                {summarizeAuditEvent({
                  action: e.action,
                  entityType: e.entityType,
                  metadata: e.metadata,
                }).compact}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
      >
        {t("auditTicker.title")}
      </TooltipContent>
    </Tooltip>
    </TooltipProvider>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

