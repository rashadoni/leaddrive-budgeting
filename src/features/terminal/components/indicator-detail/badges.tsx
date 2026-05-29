"use client";

/**
 * Panel-3 provenance / materiality / trust badges — extracted from
 * IndicatorDetail.tsx (Phase 8 D1 2026-05-29). Each reads only props + the
 * shared IndicatorValueDetail type + next-intl; IndicatorDetail imports them
 * back.
 */

import { useTranslations } from "next-intl";
import type { IndicatorValueDetail } from "./types";

/**
 * Phase 7.H F4.v2.1 — provenance badge rendered next to the headline
 * value in Panel 3. Five variants with distinct tones:
 *   - `disclosed`        : teal contour ("РАСКРЫТО")
 *   - `modeled_industry` : amber ("ОТРАСЛЕВАЯ ОЦЕНКА")
 *   - `modeled_generic`  : gray-striped ("ОБЩАЯ ОЦЕНКА")
 *   - `macro`            : blue ("МАКРО-ПОКАЗАТЕЛЬ")
 *   - `computed` / null  : no badge (real derived value — adding one
 *                          would be visual noise on every cell)
 *
 * Tailwind utility classes only — no module.css. The Risk Terminal
 * palette uses these hex values across the app, so we hard-code them
 * inline to avoid spreading new design-tokens for a single badge.
 *
 * Sized to match the existing status badge (`text-[10px]`, same
 * padding) so the two stack cleanly without disturbing the panel
 * layout. Visual gate isn't expected to fire — the badge slot is
 * additive in an existing flex column.
 *
 * Phase 7.H F4.v2.2.1 — `confidence` tier appended to the tooltip
 * (e.g. "Confidence: B"). For `modeled_industry` cells this is the
 * worst tier across the scopes the formula used (A best → D worst).
 * `disclosed` cells have no tier (the value IS the truth).
 */
export function ProvenanceBadge({
  source,
  confidence,
  t,
}: {
  source: IndicatorValueDetail["valueSource"];
  confidence: IndicatorValueDetail["confidence"];
  t: ReturnType<typeof useTranslations>;
}) {
  // `computed` is the financial / operational default — no badge.
  // Treat absence (legacy rows) the same: assume real until proven
  // otherwise. Phase 7.A through 7.G IVs predate the v2.1 stamp and
  // are all `computed` semantically.
  if (!source || source === "computed") return null;
  const labelKey = `indicatorDetail.provenance.${source}` as const;
  const titleKey = `indicatorDetail.provenance.${source}Title` as const;
  let label: string;
  let title: string;
  try {
    label = t(labelKey);
    title = t(titleKey);
  } catch {
    // Defensive fallback when a new variant lands without a matching
    // i18n key — render the raw enum value rather than throw.
    label = source.toUpperCase();
    title = source;
  }
  // Phase 7.H F4.v2.2.1 — append "Confidence: X" to the title tooltip
  // when the IV carries a tier (industry-modeled cells). Disclosed cells
  // skip the tier — the value is the truth, not a model output. Plain
  // string concat keeps the tooltip readable in all 3 locales.
  if (confidence) {
    let confidenceLabel: string;
    try {
      confidenceLabel = t("indicatorDetail.provenance.confidenceLabel", {
        tier: confidence,
      });
    } catch {
      confidenceLabel = `Confidence: ${confidence}`;
    }
    title = `${title} ${confidenceLabel}`;
  }
  const palette: Record<NonNullable<IndicatorValueDetail["valueSource"]>, string> = {
    disclosed:
      "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5",
    modeled_industry:
      "border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/5",
    modeled_generic:
      "border-gray-500/60 text-muted-foreground bg-gray-500/10",
    macro:
      "border-[#5B9DFF]/60 text-[#5B9DFF] bg-[#5B9DFF]/5",
    // `computed` never renders (guarded above) but keep the entry
    // so the map is exhaustive for future maintainers.
    computed: "",
  };
  // 2026-05-27 — emoji prefix per source so finance users see the
  // provenance category at-a-glance without needing to learn the
  // colour code. Map matches CLAUDE.md's user-facing schema:
  //   📥 disclosed (от клиента) — high trust
  //   🔮 modeled (отраслевая/общая оценка) — lower trust
  //   🌐 macro (макро-контекст) — single value across cos
  //   ⚙ computed (расчёт) — derived from real data (default, no badge)
  const icons: Record<NonNullable<IndicatorValueDetail["valueSource"]>, string> = {
    disclosed: "📥",
    modeled_industry: "🔮",
    modeled_generic: "🌫",
    macro: "🌐",
    computed: "⚙",
  };
  return (
    <span
      data-testid="provenance-badge"
      data-source={source}
      data-confidence={confidence ?? undefined}
      title={title}
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono inline-flex items-center gap-1 ${palette[source]}`}
    >
      <span aria-hidden="true" className="not-italic">
        {icons[source]}
      </span>
      <span>{label}</span>
      {confidence && (
        <span
          aria-hidden="true"
          data-testid="provenance-confidence-tier"
          className="ml-0.5 opacity-70 font-bold"
        >
          {confidence}
        </span>
      )}
    </span>
  );
}

/**
 * Phase 7.H F4.v2.4 — SASB materiality badge. Two non-default variants:
 *   - `low_materiality` : amber-soft contour, "НИЗКАЯ МАТЕРИАЛЬНОСТЬ"
 *   - `not_material`    : neutral gray, "НЕ МАТЕРИАЛЬНО"
 *   - `material` / null : no badge (default state)
 *
 * Calibration note (per-pair) surfaces in the tooltip — e.g.
 * "Campus operations dominated by purchased electricity (Scope 2),
 *  not direct combustion."
 */
export function MaterialityBadge({
  rating,
  note,
  t,
}: {
  rating: "material" | "low_materiality" | "not_material" | null;
  note: string | null;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!rating || rating === "material") return null;
  const labelKey =
    rating === "not_material"
      ? "indicatorDetail.materiality.notMaterial"
      : "indicatorDetail.materiality.lowMateriality";
  let label: string;
  try {
    label = t(labelKey);
  } catch {
    label = rating.toUpperCase();
  }
  let titleSuffix = "";
  try {
    titleSuffix = t("indicatorDetail.materiality.tooltipSuffix");
  } catch {
    titleSuffix = "Materiality (SASB).";
  }
  const tone =
    rating === "not_material"
      ? "border-gray-600/60 text-muted-foreground bg-gray-700/15"
      : "border-amber-500/40 text-amber-600 dark:text-amber-400/80 bg-amber-500/5";
  return (
    <span
      data-testid="materiality-badge"
      data-rating={rating}
      title={`${titleSuffix}${note ? ` ${note}` : ""}`}
      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-mono ${tone}`}
    >
      {label}
    </span>
  );
}

/**
 * Financial-truth-infra Phase B.2 — Trust/Audit strip rendered between
 * the panel header and the hint paragraph. Shows where the value came
 * from (sourceDocument) + when it was last audited (lastReconciledAt
 * + reconciledBy) + sanity-band verdict.
 *
 * Renders even on pre-Phase-A IVs (all fields null) so the user gets a
 * clear "not yet reconciled" signal instead of the strip being silently
 * hidden — that absence-as-info was the original failure mode.
 */
export function TrustAuditStrip(props: {
  sourceDocument?: string | null;
  lastReconciledAt?: string | null;
  reconciledBy?: string | null;
  sanityBand?: 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band' | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const { sourceDocument, lastReconciledAt, reconciledBy, sanityBand } = props;
  // Soft-fail i18n lookups so the strip works even before keys are added.
  const lookup = (key: string, fallback: string): string => {
    try {
      return props.t(key as never);
    } catch {
      return fallback;
    }
  };
  const sourceLabel = lookup('indicatorDetail.trust.source', 'Источник / Source');
  const lastAuditedLabel = lookup('indicatorDetail.trust.lastAudited', 'Сверено / Audited');
  const notReconciledLabel = lookup('indicatorDetail.trust.notReconciled', 'Ещё не сверено · Not yet reconciled');
  const sourceNotRecorded = lookup('indicatorDetail.trust.sourceNotRecorded', 'Источник не зафиксирован · Source not recorded');

  const sanityLabel: Record<NonNullable<typeof sanityBand>, string> = {
    normal: 'normal',
    low_extreme: 'low extreme',
    high_extreme: 'high extreme',
    missing_input: 'missing input',
    no_band: 'no band',
  };
  const sanityTone: Record<NonNullable<typeof sanityBand>, string> = {
    normal: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400/80 bg-emerald-500/5',
    low_extreme: 'border-red-500/40 text-red-600 dark:text-red-400/90 bg-red-500/5',
    high_extreme: 'border-red-500/40 text-red-600 dark:text-red-400/90 bg-red-500/5',
    missing_input: 'border-gray-600/60 text-muted-foreground bg-gray-700/15',
    no_band: 'border-input/60 text-muted-foreground bg-muted/50/15',
  };

  const auditDate = lastReconciledAt
    ? new Date(lastReconciledAt).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
      })
    : null;

  return (
    <div
      data-testid="trust-audit-strip"
      className="flex items-start gap-3 rounded border border-border/60 bg-[#0A0E27]/40 px-2 py-1.5 text-[10px] text-muted-foreground leading-snug flex-wrap"
    >
      <div className="flex items-start gap-1 min-w-0 flex-1">
        <span className="text-muted-foreground uppercase tracking-wider shrink-0">
          {sourceLabel}:
        </span>
        <span
          className={sourceDocument ? 'text-muted-foreground font-mono truncate' : 'italic text-muted-foreground'}
          title={sourceDocument ?? sourceNotRecorded}
        >
          {sourceDocument ?? sourceNotRecorded}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-muted-foreground uppercase tracking-wider">
          {lastAuditedLabel}:
        </span>
        {auditDate ? (
          <span className="text-muted-foreground">
            {auditDate}
            {reconciledBy ? <span className="text-muted-foreground"> · {reconciledBy}</span> : null}
          </span>
        ) : (
          <span className="italic text-muted-foreground">{notReconciledLabel}</span>
        )}
      </div>
      {sanityBand && sanityBand !== 'no_band' && (
        <span
          data-testid="sanity-band-badge"
          data-sanity-band={sanityBand}
          className={`uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${sanityTone[sanityBand]}`}
        >
          {sanityLabel[sanityBand]}
        </span>
      )}
    </div>
  );
}
