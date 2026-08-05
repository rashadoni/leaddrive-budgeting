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

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cellFaceColor, statusShape } from "@/lib/risk/heatmap-matrix";
import type { IndicatorStatus } from "@/lib/risk/formula-engine";

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
  { example: "IND_EBITDA_MARGIN IND GO", i18nDescKey: "cmdIndDesc" },
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
  // 2026-08-05 — the legend lives at the BOTTOM of a scrolling command
  // reference. A reader who arrived here asking "what does this ≠ mean"
  // must not have to scroll past 18 command rows to find out, so the
  // opener may name where it wants to land.
  const [landOnLegend, setLandOnLegend] = useState(false);
  const legendRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setRecent(loadRecent());
      // Absent detail is not a request for anything — the modal opens at the
      // top, exactly as `HELP GO` has always opened it. Only an explicit
      // `focus: 'legend'` moves the landing point.
      const detail = (event as CustomEvent<{ focus?: string }>).detail;
      setLandOnLegend(detail?.focus === "legend");
      setOpen(true);
    };
    window.addEventListener("terminal:open-help", onOpen);
    return () => window.removeEventListener("terminal:open-help", onOpen);
  }, []);

  useEffect(() => {
    if (!open || !landOnLegend) return;
    const node = legendRef.current;
    if (!node) return;
    // happy-dom (and older jsdom) do not implement scrollIntoView; the focus
    // call below is what actually matters for keyboard + screen-reader users,
    // so a missing scroll must not throw and abort it.
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start" });
    }
    node.focus();
  }, [open, landOnLegend]);

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
        className="relative bg-[#0A0E27] border border-input rounded-lg shadow-2xl w-[820px] max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between px-5 py-3 border-b border-border">
          <div>
            <h2 id="help-modal-title" className="text-sm font-mono font-semibold text-cyan-300 uppercase tracking-wider">
              {t("title")}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
            className="text-muted-foreground hover:text-gray-200 transition-colors"
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
            <LegendSection sectionRef={legendRef} />
          </div>

          {/* Recent sidebar */}
          <aside className="w-[180px] shrink-0 border-l border-border p-3 bg-black/20 overflow-y-auto">
            <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              {t("recentTitle")}
            </h3>
            {recent.length === 0 ? (
              <p className="text-[10px] text-muted-foreground leading-snug">{t("recentEmpty")}</p>
            ) : (
              <ul className="space-y-1">
                {recent.map((cmd, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => pasteCommand(cmd)}
                      className="w-full text-left font-mono text-[10px] text-muted-foreground hover:text-cyan-300 hover:bg-cyan-500/10 rounded px-1.5 py-0.5 truncate"
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

/**
 * The face states a matrix tile can be painted, in the order a reader meets
 * them. `state` is fed straight to `cellFaceColor` — the same function
 * `HeatMapCellTd` calls — so this list cannot drift into describing a paint
 * job the grid does not use. That drift is exactly what happened before
 * 2026-08-05: the legend asked `statusColor`, taught #6B7280 for `unknown`
 * (no tile is ever that colour) and had no row for `na` at all.
 */
const FACE_ROWS: ReadonlyArray<{
  state: IndicatorStatus | "missing" | "na";
  labelKey: string;
}> = [
  { state: "green", labelKey: "legendCellGreen" },
  { state: "amber", labelKey: "legendCellAmber" },
  { state: "red", labelKey: "legendCellRed" },
  { state: "unknown", labelKey: "legendCellUnknown" },
  { state: "na", labelKey: "legendCellNa" },
  { state: "missing", labelKey: "legendCellMissing" },
];

/**
 * One tile face, painted by the grid's own rule.
 *
 * The swatch carries a visible border on purpose. Two of the six faces —
 * `unknown` (#0A0E27) and `na` (#111827) — are the terminal's background
 * colours, and `#0A0E27` is this modal's own background, so an unbordered
 * swatch for `unknown` is a rectangle of nothing. The border makes the box
 * findable; the mark inside it, and the sentence beside it, are what actually
 * carry the meaning. Colour alone was never going to work for these two.
 */
function FaceSwatch({
  state,
  mark,
  markStyle,
  markClassName,
}: {
  state: IndicatorStatus | "missing" | "na";
  mark: string;
  markStyle?: React.CSSProperties;
  markClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={`legend-face-${state}`}
      data-face={cellFaceColor(state)}
      className="shrink-0 inline-flex h-[22px] w-[42px] items-center justify-center rounded-[2px] border border-white/25 font-mono leading-none"
      style={{ backgroundColor: cellFaceColor(state) }}
    >
      <span className={markClassName} style={markStyle}>
        {mark}
      </span>
    </span>
  );
}

/** The glyph/letter badges drawn in a tile's corners. */
function MarkerBadge({
  id,
  glyph,
  className,
  style,
}: {
  id: string;
  glyph: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={`legend-marker-${id}`}
      data-glyph={glyph || undefined}
      className={`shrink-0 inline-flex h-[22px] w-[42px] items-center justify-center rounded-[2px] border border-white/15 bg-black/30 font-mono text-[11px] leading-none ${className ?? ""}`}
      style={style}
    >
      {glyph}
    </span>
  );
}

function LegendSection({
  sectionRef,
}: {
  sectionRef: React.RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("terminal.help");
  // The two in-tile labels are read from the HeatMap's OWN namespace rather
  // than copied into `terminal.help`: if `N/A` or `N/D` is ever reworded, the
  // legend follows instead of quietly becoming wrong again. `terminal.help` is
  // a scoped namespace and cannot reach across, hence the second hook.
  const tHeat = useTranslations("terminal.heatMap");
  // What the grid actually prints inside each unmeasured tile.
  const FACE_MARK: Record<string, string> = {
    green: statusShape("green"),
    amber: statusShape("amber"),
    red: statusShape("red"),
    // `hasEvidencedValue` false ⇒ HeatMapCellTd prints an em dash, not the
    // stored number. The legend shows the same dash.
    unknown: "—",
    na: tHeat("notApplicableShort"),
    missing: tHeat("noDataShort"),
  };
  return (
    <section
      data-testid="help-legend"
      ref={sectionRef}
      tabIndex={-1}
      className="scroll-mt-2 rounded outline-none focus:ring-1 focus:ring-cyan-400/40"
    >
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5 border-b border-border pb-1">
        {t("sectionLegend")}
      </h3>

      {/* Composite risk score (CompanyTree badges) */}
      <div className="mt-2">
        <p className="text-[11px] text-muted-foreground mb-1.5">{t("legendCompositeTitle")}</p>
        <ul className="grid grid-cols-3 gap-1.5 text-[10px]">
          <li className="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
            <span aria-hidden="true">●</span>
            <span className="font-mono">R67–100</span>
            <span className="opacity-80">{t("legendCompositeGreen")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/40 text-amber-600 dark:text-amber-400">
            <span aria-hidden="true">▲</span>
            <span className="font-mono">R34–66</span>
            <span className="opacity-80">{t("legendCompositeAmber")}</span>
          </li>
          <li className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400">
            <span aria-hidden="true">■</span>
            <span className="font-mono">R0–33</span>
            <span className="opacity-80">{t("legendCompositeRed")}</span>
          </li>
        </ul>
      </div>

      {/* Direction marker (column header prefix) */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1.5">{t("legendDirectionTitle")}</p>
        <ul className="grid grid-cols-3 gap-1.5 text-[10px] text-muted-foreground">
          <li className="flex items-baseline gap-1.5 px-2 py-1 rounded border border-border">
            <span className="text-muted-foreground" aria-hidden="true">▲</span>
            <span>{t("legendDirHigher")}</span>
          </li>
          <li className="flex items-baseline gap-1.5 px-2 py-1 rounded border border-border">
            <span className="text-muted-foreground" aria-hidden="true">▼</span>
            <span>{t("legendDirLower")}</span>
          </li>
          <li className="flex items-baseline gap-1.5 px-2 py-1 rounded border border-border">
            <span className="text-muted-foreground" aria-hidden="true">◆</span>
            <span>{t("legendDirBand")}</span>
          </li>
        </ul>
      </div>

      {/* Cell face — every swatch below is painted by cellFaceColor(), the
          same call HeatMapCellTd makes. Six states, because six is how many
          the grid draws. */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1.5">{t("legendCellTitle")}</p>
        <ul className="space-y-1 text-[10px] text-muted-foreground">
          {FACE_ROWS.map(({ state, labelKey }) => (
            <li
              key={state}
              data-testid={`legend-face-row-${state}`}
              className="flex items-center gap-2 px-1 py-0.5 rounded"
            >
              <FaceSwatch
                state={state}
                mark={FACE_MARK[state]}
                markClassName={
                  state === "green" || state === "amber" || state === "red"
                    ? undefined
                    : state === "na"
                      ? "text-gray-400 text-[10px] font-medium"
                      : "text-[10px]"
                }
                markStyle={
                  state === "green" || state === "amber" || state === "red"
                    ? {
                        // Same trick the tile uses: white through a difference
                        // blend, legible on the light green/amber faces and on
                        // the dark red one without per-status colour logic.
                        color: "#FFFFFF",
                        mixBlendMode: "difference",
                        opacity: 0.7,
                        fontSize: 9,
                      }
                    : state === "unknown"
                      ? { color: "rgba(255,255,255,0.95)" }
                      : state === "missing"
                        ? { color: "rgba(156,163,175,0.45)" }
                        : undefined
                }
              />
              <span className="leading-snug">{t(labelKey)}</span>
            </li>
          ))}
        </ul>
        {/* The unknown face is #0A0E27 — this modal's own background. Saying
            so is the only way to teach it; a swatch of it is invisible by
            construction. */}
        <p
          data-testid="legend-unknown-note"
          className="mt-1 pl-1 text-[10px] leading-snug text-muted-foreground/80"
        >
          {t("legendCellUnknownNote")}{" "}
          <span className="text-gray-400">
            {t("legendCellUnknownCounter", { glyph: statusShape("unknown") })}
          </span>
        </p>
      </div>

      {/* Corner marks — provenance letters (top-left, from the value's own
          source) and the input-family glyphs (top-right, from the indicator
          definition). None of these had an entry before 2026-08-05. */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1.5">{t("legendMarkersTitle")}</p>
        <ul className="space-y-1 text-[10px] text-muted-foreground">
          <li className="flex items-center gap-2 px-1 py-0.5">
            <MarkerBadge id="disclosed" glyph="d" className="font-bold text-gray-100" />
            <span className="leading-snug">{t("legendMarkerDisclosed")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <MarkerBadge id="estimate" glyph="e" className="italic text-gray-100" />
            <span className="leading-snug">{t("legendMarkerEstimate")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <MarkerBadge id="macro" glyph="m" className="text-gray-100" />
            <span className="leading-snug">{t("legendMarkerMacro")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            {/* No letter is itself a statement — the number came from the
                client's own data. An empty box says that better than prose
                alone. */}
            <MarkerBadge id="computed" glyph="" />
            <span className="leading-snug">{t("legendMarkerComputed")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <MarkerBadge id="external-feed" glyph="~" className="text-sky-400/70" />
            <span className="leading-snug">{t("legendMarkerExternalFeed")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <MarkerBadge id="constant" glyph="=" className="text-gray-500" />
            <span className="leading-snug">{t("legendMarkerConstant")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <MarkerBadge
              id="scenario"
              glyph={`${statusShape("green")}${statusShape("amber")}${statusShape("red")}`}
              className="text-gray-100 text-[9px]"
            />
            <span className="leading-snug">{t("legendMarkerScenario")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <span
              aria-hidden="true"
              data-testid="legend-marker-dimmed"
              className="shrink-0 inline-flex h-[22px] w-[42px] items-center justify-center rounded-[2px] border border-white/15"
              style={{ backgroundColor: cellFaceColor("green"), opacity: 0.45 }}
            />
            <span className="leading-snug">{t("legendMarkerDimmed")}</span>
          </li>
        </ul>
      </div>

      {/* Rings + the ≠ alarm. Every swatch here sits on a coloured face,
          because that is the only place these marks ever appear and the
          contrast question ("can I see the ring on a green tile?") is the
          whole point of drawing them at all. */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1.5">{t("legendRingsTitle")}</p>
        <ul className="space-y-1 text-[10px] text-muted-foreground">
          <li className="flex items-center gap-2 px-1 py-0.5">
            <span
              aria-hidden="true"
              data-testid="legend-ring-mismatch"
              data-glyph="≠"
              className="relative shrink-0 inline-block h-[22px] w-[42px] rounded-[2px]"
              style={{ backgroundColor: cellFaceColor("green") }}
            >
              <span className="absolute inset-0 rounded-[1px] ring-2 ring-inset ring-[#0A0E27]" />
              <span className="absolute inset-[2px] rounded-[1px] ring-[1.5px] ring-inset ring-[#E879F9]" />
              <span className="absolute left-[3px] bottom-[2px] rounded-[2px] bg-[#0A0E27] px-[2px] font-mono text-[9px] font-bold leading-[1.1] text-[#E879F9]">
                ≠
              </span>
            </span>
            <span className="leading-snug">{t("legendRingMismatch")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <span
              aria-hidden="true"
              data-testid="legend-ring-low-confidence"
              className="shrink-0 inline-block h-[22px] w-[42px] rounded-[2px]"
              style={{
                backgroundColor: cellFaceColor("green"),
                boxShadow: "inset 0 0 0 1px rgba(245,158,11,0.55)",
              }}
            />
            <span className="leading-snug">{t("legendRingLowConfidence")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <span
              aria-hidden="true"
              data-testid="legend-ring-drift"
              className="shrink-0 inline-block h-[22px] w-[42px] rounded-[2px]"
              style={{
                backgroundColor: cellFaceColor("green"),
                boxShadow: "inset 0 0 0 1.5px #FFB800",
                opacity: 0.9,
              }}
            />
            <span className="leading-snug">{t("legendRingDrift")}</span>
          </li>
          <li className="flex items-center gap-2 px-1 py-0.5">
            <span
              aria-hidden="true"
              data-testid="legend-ring-stale"
              className="relative shrink-0 inline-block h-[22px] w-[42px] rounded-[2px]"
              style={{ backgroundColor: cellFaceColor("green") }}
            >
              <span
                className="absolute rounded-full"
                style={{
                  top: 2,
                  right: 2,
                  width: 8,
                  height: 8,
                  background: "#FFB800",
                  boxShadow: "0 0 0 1.5px rgba(15, 21, 53, 0.95)",
                }}
              />
            </span>
            <span className="leading-snug">{t("legendRingStale")}</span>
          </li>
        </ul>
      </div>

      {/* Common units */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1.5">{t("legendUnitsTitle")}</p>
        <ul className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-border">
            <span className="font-mono text-cyan-300 w-12">%</span>
            <span>{t("legendUnitPercent")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-border">
            <span className="font-mono text-cyan-300 w-12">AZN ₼</span>
            <span>{t("legendUnitAzn")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-border">
            <span className="font-mono text-cyan-300 w-12">ratio</span>
            <span>{t("legendUnitRatio")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-border">
            <span className="font-mono text-cyan-300 w-12">index</span>
            <span>{t("legendUnitIndex")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-border">
            <span className="font-mono text-cyan-300 w-12">pp</span>
            <span>{t("legendUnitPp")}</span>
          </li>
          <li className="flex items-baseline gap-2 px-2 py-1 rounded border border-border">
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
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5 border-b border-border pb-1">
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
            <span className="text-muted-foreground leading-tight">{t(r.i18nDescKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
