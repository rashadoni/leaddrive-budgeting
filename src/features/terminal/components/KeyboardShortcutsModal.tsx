"use client";

/**
 * Phase Round-8 M6 — keyboard shortcuts cheatsheet modal.
 *
 * Discoverability play vs Bloomberg's "memorize 200 verbs or die"
 * culture: pressing `?` from anywhere in the terminal opens a tabular
 * cheatsheet listing F-keys, search, command-bar verbs, and modal
 * triggers. Locale-aware via `useTranslations`. Dismisses on Escape /
 * backdrop / `?` again.
 *
 * Wired in PanelGrid alongside other modals.
 */

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Keyboard } from "lucide-react";

interface ShortcutGroup {
  titleKey: string;
  rows: Array<{ keys: string[]; descKey: string }>;
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: "shortcuts.groupPanels",
    rows: [
      { keys: ["F1"], descKey: "shortcuts.f1" },
      { keys: ["F2"], descKey: "shortcuts.f2" },
      { keys: ["F3"], descKey: "shortcuts.f3" },
      { keys: ["F4"], descKey: "shortcuts.f4" },
    ],
  },
  {
    titleKey: "shortcuts.groupGlobal",
    rows: [
      { keys: ["?"], descKey: "shortcuts.help" },
      { keys: ["/"], descKey: "shortcuts.search" },
      { keys: ["⌘", "K"], descKey: "shortcuts.commandFocus" },
      { keys: ["Esc"], descKey: "shortcuts.escape" },
      { keys: ["Ctrl", "/"], descKey: "shortcuts.compact" },
    ],
  },
  {
    titleKey: "shortcuts.groupCommands",
    rows: [
      { keys: ["HOLD", "GO"], descKey: "shortcuts.cmdHold" },
      { keys: ["<co>", "CO", "GO"], descKey: "shortcuts.cmdCo" },
      { keys: ["<code>", "IND", "GO"], descKey: "shortcuts.cmdInd" },
      { keys: ["<L>", "<R>", "CMP", "GO"], descKey: "shortcuts.cmdCmp" },
      { keys: ["<scn>", "SCN", "GO"], descKey: "shortcuts.cmdScn" },
      { keys: ["BRF", "GO"], descKey: "shortcuts.cmdBrf" },
      { keys: ["AUD", "GO"], descKey: "shortcuts.cmdAud" },
      { keys: ["ACT", "GO"], descKey: "shortcuts.cmdAct" },
    ],
  },
];

export function KeyboardShortcutsModal() {
  const t = useTranslations("terminal");
  const [open, setOpen] = useState(false);
  // Round-9 architect closure (M6 micro-perf): keep keydown listener
  // attached ONCE for the component lifetime instead of re-attaching on
  // every modal toggle. Read latest `open` via ref so functional setter
  // doesn't have to read stale state. Net behavior unchanged; saves an
  // add/remove pair on every `?`/Esc keypress.
  const openRef = React.useRef(open);
  React.useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `?` opens. Ignore when typing in input/textarea/contentEditable.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const target = e.target;
        const isTyping =
          target instanceof HTMLElement &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (isTyping) return;
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && openRef.current) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Also expose a `terminal:open-shortcuts` window event so a future
  // help-icon button can dispatch without re-implementing the toggle.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("terminal:open-shortcuts", onOpen);
    return () => window.removeEventListener("terminal:open-shortcuts", onOpen);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("shortcuts.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg border border-gray-700 bg-background shadow-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[#00D4AA]" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t("shortcuts.title")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("shortcuts.subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("shortcuts.closeAriaLabel")}
            autoFocus
            className="rounded border border-gray-700 px-2 py-1 text-sm hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <div className="px-6 py-4 space-y-4 font-mono text-xs">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.titleKey}>
              <h3 className="text-[10px] uppercase tracking-wider text-[#FFB020] mb-2">
                {t(group.titleKey)}
              </h3>
              <ul className="space-y-1">
                {group.rows.map((row, i) => (
                  <li
                    key={i}
                    className="flex items-baseline gap-3 py-0.5 border-b border-gray-800/30 last:border-b-0"
                  >
                    <span className="flex items-center gap-1 shrink-0 min-w-[180px]">
                      {row.keys.map((k, j) => (
                        <React.Fragment key={j}>
                          <kbd className="font-sans inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded border border-gray-700 bg-gray-800/40 text-[10px] font-semibold text-gray-300">
                            {k}
                          </kbd>
                          {j < row.keys.length - 1 && (
                            <span className="text-gray-600">+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </span>
                    <span className="text-gray-300 leading-snug">
                      {t(row.descKey)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="sticky bottom-0 px-6 py-2 border-t border-gray-800 bg-background/95 backdrop-blur text-[10px] text-gray-600">
          {t("shortcuts.footer")}
        </footer>
      </div>
    </div>
  );
}
