"use client";

/**
 * Phase 7.G CLI (Bloomberg-sweep) — `HELP GO` command-reference modal.
 *
 * Listens for `terminal:open-help` (dispatched by CommandBar). Renders all
 * supported commands grouped by category, with example syntax + 1-line
 * description. Recent-commands sidebar reads from sessionStorage key
 * `terminal.recentCommands` (top 5).
 *
 * Keyboard:
 *   Esc        — close
 *   Click cmd  — paste into command input via `terminal:paste-command` event
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

const RECENT_KEY = "terminal.recentCommands";
const RECENT_LIMIT = 5;

interface CommandRow {
  example: string;
  i18nDescKey: string;
}

const NAVIGATION: CommandRow[] = [
  { example: "HOLD GO", i18nDescKey: "cmdHoldDesc" },
  { example: "AAC CO GO", i18nDescKey: "cmdCoDesc" },
  { example: "AZSEKER GRP GO", i18nDescKey: "cmdGrpDesc" },
  { example: "industrial SEC GO", i18nDescKey: "cmdSecDesc" },
];

const ANALYSIS: CommandRow[] = [
  { example: "IND_GROSS_MARGIN IND GO", i18nDescKey: "cmdIndDesc" },
  { example: "AAC,ATL CMP GO", i18nDescKey: "cmdCmpDesc" },
  { example: "CHT GO", i18nDescKey: "cmdChtDesc" },
  { example: "USD_SPIKE_25 SCN GO", i18nDescKey: "cmdScnDesc" },
];

const ALERTS: CommandRow[] = [
  { example: "ALT GO", i18nDescKey: "cmdAltDesc" },
  { example: "BREACH GO", i18nDescKey: "cmdBreachDesc" },
  { example: "BRF GO", i18nDescKey: "cmdBrfDesc" },
  { example: "SUB GO", i18nDescKey: "cmdSubDesc" },
];

const OTHER: CommandRow[] = [
  { example: "AUD GO", i18nDescKey: "cmdAudDesc" },
  { example: "ACT GO", i18nDescKey: "cmdActDesc" },
  { example: "CMT GO", i18nDescKey: "cmdCmtDesc" },
  { example: "INT GO", i18nDescKey: "cmdIntDesc" },
  { example: "HELP GO", i18nDescKey: "cmdHelpDesc" },
];

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function HelpModal() {
  const t = useTranslations("terminal.help");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    const onOpen = () => {
      setRecent(loadRecent());
      setOpen(true);
    };
    window.addEventListener("terminal:open-help", onOpen);
    return () => window.removeEventListener("terminal:open-help", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pasteCommand = useCallback((example: string) => {
    window.dispatchEvent(
      new CustomEvent("terminal:paste-command", { detail: { command: example } }),
    );
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      data-testid="help-modal"
    >
      <div
        className="relative bg-[#0A0E27] border border-gray-700 rounded-lg shadow-2xl w-[820px] max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between px-5 py-3 border-b border-gray-800">
          <div>
            <h2 id="help-modal-title" className="text-sm font-mono font-semibold text-cyan-300 uppercase tracking-wider">
              {t("title")}
            </h2>
            <p className="text-[10px] text-gray-500 mt-0.5">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
            className="text-gray-500 hover:text-gray-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Commands */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <Section title={t("sectionNavigation")} rows={NAVIGATION} t={t} onPick={pasteCommand} />
            <Section title={t("sectionAnalysis")} rows={ANALYSIS} t={t} onPick={pasteCommand} />
            <Section title={t("sectionAlerts")} rows={ALERTS} t={t} onPick={pasteCommand} />
            <Section title={t("sectionOther")} rows={OTHER} t={t} onPick={pasteCommand} />
            <LegendSection t={t} />
          </div>

          {/* Recent sidebar */}
          <aside className="w-[180px] shrink-0 border-l border-gray-800 p-3 bg-black/20 overflow-y-auto">
            <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">
              {t("recentTitle")}
            </h3>
            {recent.length === 0 ? (
              <p className="text-[10px] text-gray-600 leading-snug">{t("recentEmpty")}</p>
            ) : (
              <ul className="space-y-1">
                {recent.map((cmd, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => pasteCommand(cmd)}
                      className="w-full text-left font-mono text-[10px] text-gray-300 hover:text-cyan-300 hover:bg-cyan-500/10 rounded px-1.5 py-0.5 truncate"
                      title={cmd}
                    >
                      {cmd}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function LegendSection({ t }: { t: (k: string) => string }) {
  return (
    <section data-testid="help-legend">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1.5 border-b border-gray-800 pb-1">
        {t("sectionLegend")}
      </h3>

      {/* Composite risk score (CompanyTree badges) */}
      <div className="mt-2">
        <p className="text-[11px] text-gray-300 mb-1.5">{t("legendCompositeTitle")}</p>
        <ul className="grid grid-cols-3 gap-1.5 text-[10px]">
          <li className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#00D4AA]/10 border border-[#00D4AA]/40 text-[#00D4AA]">
            <span aria-hidden="true">●</span>
            <span className="font-mono">R67–100</span>
            <span className="opacity-80">{t("legendCompositeGreen")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#FFB020]/10 border border-[#FFB020]/40 text-[#FFB020]">
            <span aria-hidden="true">▲</span>
            <span className="font-mono">R34–66</span>
            <span className="opacity-80">{t("legendCompositeAmber")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#FF4757]/10 border border-[#FF4757]/40 text-[#FF4757]">
            <span aria-hidden="true">■</span>
            <span className="font-mono">R0–33</span>
            <span className="opacity-80">{t("legendCompositeRed")}</span>
          </li>
        </ul>
      </div>

      {/* Direction marker (column header prefix) */}
      <div className="mt-3">
        <p className="text-[11px] text-gray-300 mb-1.5">{t("legendDirectionTitle")}</p>
        <ul className="grid grid-cols-3 gap-1.5 text-[10px] text-gray-300">
          <li className="flex items-baseline gap-1.5 px-2 py-1 rounded border border-gray-800">
            <span className="text-gray-500" aria-hidden="true">▲</span>
            <span>{t("legendDirHigher")}</span>
          </li>
          <li className="flex items-baseline gap-1.5 px-2 py-1 rounded border border-gray-800">
            <span className="text-gray-500" aria-hidden="true">▼</span>
            <span>{t("legendDirLower")}</span>
          </li>
          <li className="flex items-baseline gap-1.5 px-2 py-1 rounded border border-gray-800">
            <span className="text-gray-500" aria-hidden="true">◆</span>
            <span>{t("legendDirBand")}</span>
          </li>
        </ul>
      </div>

      {/* Cell status (HeatMap colors) */}
      <div className="mt-3">
        <p className="text-[11px] text-gray-300 mb-1.5">{t("legendCellTitle")}</p>
        <ul className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-300">
          <li className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ backgroundColor: "#00D4AA22" }}>
            <span style={{ color: "#00D4AA" }} aria-hidden="true">●</span>
            <span>{t("legendCellGreen")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ backgroundColor: "#FFA50222" }}>
            <span style={{ color: "#FFA502" }} aria-hidden="true">▲</span>
            <span>{t("legendCellAmber")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ backgroundColor: "#FF475722" }}>
            <span style={{ color: "#FF4757" }} aria-hidden="true">■</span>
            <span>{t("legendCellRed")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded" style={{ backgroundColor: "#6B728022" }}>
            <span style={{ color: "#6B7280" }} aria-hidden="true">◇</span>
            <span>{t("legendCellUnknown")}</span>
          </li>
        </ul>
      </div>

      {/* Common units */}
      <div className="mt-3">
        <p className="text-[11px] text-gray-300 mb-1.5">{t("legendUnitsTitle")}</p>
        <ul className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-300">
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-gray-800">
            <span className="font-mono text-cyan-300 w-12">%</span>
            <span>{t("legendUnitPercent")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-gray-800">
            <span className="font-mono text-cyan-300 w-12">AZN ₼</span>
            <span>{t("legendUnitAzn")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-gray-800">
            <span className="font-mono text-cyan-300 w-12">ratio</span>
            <span>{t("legendUnitRatio")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-gray-800">
            <span className="font-mono text-cyan-300 w-12">index</span>
            <span>{t("legendUnitIndex")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-gray-800">
            <span className="font-mono text-cyan-300 w-12">pp</span>
            <span>{t("legendUnitPp")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-gray-800">
            <span className="font-mono text-cyan-300 w-12">ton/ha</span>
            <span>{t("legendUnitTonHa")}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

function Section({
  title,
  rows,
  t,
  onPick,
}: {
  title: string;
  rows: CommandRow[];
  t: (k: string) => string;
  onPick: (example: string) => void;
}) {
  return (
    <section>
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1.5 border-b border-gray-800 pb-1">
        {title}
      </h3>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li
            key={r.example}
            className="grid grid-cols-[140px_1fr] items-baseline gap-3 text-[11px] hover:bg-cyan-500/5 rounded px-1.5 py-0.5 cursor-pointer"
            onClick={() => onPick(r.example)}
          >
            <code className="font-mono text-cyan-300 text-[10px]">{r.example}</code>
            <span className="text-gray-300 leading-tight">{t(r.i18nDescKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
