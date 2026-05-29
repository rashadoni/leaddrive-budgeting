"use client";

/**
 * CompanyTree Panel-1 presentational subcomponents — extracted from
 * CompanyTree.tsx (Phase 8 D1 2026-05-29) to bring the main file under the
 * 1000-LOC mega-file line. The watchlist tab bar, readiness/composite chips,
 * "All companies" row, trust badge, risk-tag chips, pending pill, and star
 * toggle. All take props + read only next-intl / lucide / the status &
 * trust-status helpers; CompanyTree imports them back. Rendering unchanged
 * (verified by the visual-baseline gate).
 */

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Bell, Star } from "lucide-react";
import { statusShape } from "@/lib/risk/heatmap-matrix";
import { TRUST_COLOR, TRUST_LABEL, type TrustStatus } from "@/lib/risk/trust-status";
import { formatFreshness } from "../../lib/relative-time";

/**
 * Phase B4 — watchlist tab strip. 5 tabs: ALL / STARRED / ALERTED /
 * RECENT / SECTOR. Counter badges show populated counts where
 * available; ALERTED is null until HeatMap publishes (first matrix
 * fetch hasn't landed yet). Phase B4 v2 added SECTOR — regroups the
 * full tree by industry instead of narrowing it (architect Round-1
 * sub-4 plan deviation closure).
 */
type WatchlistTabKey = 'all' | 'starred' | 'alerted' | 'recent' | 'sector';

export function WatchlistTabs(props: {
  active: WatchlistTabKey;
  onSelect: (tab: WatchlistTabKey) => void;
  starredCount: number;
  recentCount: number;
  alertedCount: number | null;
  sectorCount: number;
}) {
  // Phase 7.G Turn N — consolidated tab labels onto same hook used for aria-labels (was prop-drilled).
  const tt = useTranslations('terminal');
  // Architect Round-1 closure (sub-4 💡): emojis swapped to lucide
  // icons for cross-platform parity (Linux/Windows often miss color
  // emoji fonts, rendering ★🔔 as monochrome boxes).
  const tabs: Array<{
    key: WatchlistTabKey;
    label: string;
    icon?: React.ReactNode;
    badge: number | null;
  }> = [
    { key: 'all', label: tt('companyTree.tabAll'), badge: null },
    {
      key: 'starred',
      label: '',
      icon: <Star size={11} />,
      badge: props.starredCount || null,
    },
    {
      key: 'alerted',
      label: '',
      icon: <Bell size={11} />,
      badge: props.alertedCount,
    },
    { key: 'recent', label: tt('companyTree.tabRecent'), badge: props.recentCount || null },
    { key: 'sector', label: tt('companyTree.tabSector'), badge: props.sectorCount || null },
  ];
  return (
    <div
      role="tablist"
      aria-label={tt('companyTree.tabsAriaLabel')}
      className="flex items-center gap-1 px-1 pt-1 text-[10px] font-mono shrink-0"
    >
      {tabs.map((t) => {
        const isActive = props.active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={
              t.key === 'starred'
                ? tt('companyTree.starredAriaLabel')
                : t.key === 'alerted'
                  ? tt('companyTree.alertedAriaLabel')
                  : undefined
            }
            onClick={() => props.onSelect(t.key)}
            className={`px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
              isActive
                ? 'border-[#00D4AA]/60 bg-[#00D4AA]/10 text-[#00D4AA]'
                : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
            }`}
          >
            {t.icon}
            {t.label && <span>{t.label}</span>}
            {t.badge !== null && t.badge > 0 && (
              <span className="text-[9px] tabular-nums opacity-75">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Star toggle button — sits at the start of each company row, BOTH at
 * sub-group (level=1 container) AND operational (level=2 leaf) rows.
 *
 * Sub-group starring is intentional unit-pin semantic (architect
 * Round-1 jsdoc closure): starring AAC pins the sub-group itself for
 * the STARRED tab filter. It does NOT auto-pin children. If a customer
 * wants to track all of AAC, they can star both the AAC sub-group AND
 * AAC-MAIN (or any specific operational under it). The STARRED filter
 * passes a row through if its OWN code is in the starred set; sub-
 * group children appear when their parent passes (header) OR when
 * their own code is starred.
 *
 * Click stops propagation so the row's click-to-select doesn't fire.
 * Filled star = starred; outlined = not.
 */
/**
 * Sub-27 cont'd Round-5 — tiny composite-score chip for tree rows.
 * Mirrors the HeatMap row-header CompositeBadge but smaller (suited to
 * tree-row density). Suppresses zero-state visual when no score (rollup
 * rows + sub-groups without scoreable cells render the badge dimmed).
 */
/**
 * Phase 7.M Step 5 (2026-05-19) — per-company readiness chip.
 *
 * Renders a 2-character percent + a 1-character tier glyph (●/◐/○)
 * coloured by tier. Tooltip carries the score + tier label. The chip
 * sits between TrustBadge and CompositeMini in the row so a finance
 * reviewer scanning the tree sees three independent signals at once:
 *
 *   trust  ·  data readiness  ·  composite risk
 *   (do I  ·  (is there enough · (given the data
 *    trust ·   data to compute  ·  we have, how
 *    the   ·   anything trust-  ·  risky is this
 *    cell  ·   worthy here?)    ·  entity?)
 *    audit)
 *
 * Empty/thin entities render full opacity so they're not invisible —
 * the colour conveys the warning, not the visibility.
 */
export function ReadinessChip({
  data,
}: {
  data: { score: number; tier: 'complete' | 'good' | 'partial' | 'thin' | 'empty' } | null;
}) {
  if (!data) return null;
  const palette = {
    complete: { color: '#00D4AA', glyph: '●' },
    good: { color: '#7ED957', glyph: '●' },
    partial: { color: '#FFB020', glyph: '◐' },
    thin: { color: '#FF8C42', glyph: '◐' },
    empty: { color: '#FF4757', glyph: '○' },
  } as const;
  const tierLabel = {
    complete: 'Complete — all data areas present',
    good: 'Good — most areas covered, minor gaps',
    partial: 'Partial — multiple areas have gaps',
    thin: 'Thin — sparse data, AI may hallucinate',
    empty: 'Empty — no real data, demo unsafe',
  } as const;
  const { color, glyph } = palette[data.tier];
  return (
    <span
      className="font-mono tabular-nums text-[9px] px-1 py-0 rounded shrink-0 font-bold"
      style={{
        color,
        backgroundColor: `${color}1A`,
        border: `1px solid ${color}33`,
      }}
      title={`Data readiness ${data.score}% — ${tierLabel[data.tier]}`}
      aria-label={`Data readiness ${data.score} percent, tier ${data.tier}`}
    >
      <span aria-hidden="true" className="mr-0.5 opacity-80">
        {glyph}
      </span>
      {data.score}%
    </span>
  );
}

export function CompositeMini({ score }: { score: number | null }) {
  if (score === null) {
    return null;
  }
  const tone =
    score >= 67 ? '#00D4AA' : score >= 34 ? '#FFB020' : '#FF4757';
  // Tier-3 sub-29 M7 — color-blind safe redundant signal. Round-15
  // architect 💡 closure — DRY: route band → statusShape() so glyph
  // mapping stays single-source-of-truth in heatmap-matrix.ts.
  const band = score >= 67 ? 'green' : score >= 34 ? 'amber' : 'red';
  const shape = statusShape(band);
  return (
    <span
      className="font-mono tabular-nums text-[9px] px-1 py-0 rounded shrink-0 font-bold"
      style={{
        color: tone,
        backgroundColor: `${tone}1A`,
        border: `1px solid ${tone}33`,
      }}
      title={`Composite Risk ${score}/100`}
      aria-label={`Composite risk score ${score} of 100`}
    >
      <span aria-hidden="true" className="mr-0.5 opacity-70">
        {shape}
      </span>
      {/* CLI Bloomberg-sweep: "R" prefix disambiguates badge as RISK score
          (0–100), not a count or revenue thousand. Bloomberg convention:
          always tag scale + unit. */}
      <span className="opacity-60 mr-px">R</span>{score}
    </span>
  );
}

/**
 * Phase 7.I — synthetic "ALL" row that resets HeatMap to show every
 * company. Highlighted when activeCompanyCode is null (default).
 *
 * Rendered above the actual root list so it's the first row a user sees,
 * matching the user's mental model: "ALL is the default; pick a company
 * to drill in." Clicking any actual company row sets activeCompanyCode,
 * which un-highlights this row and filters HeatMap to that single company.
 */
export function AllRow({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const t = useTranslations('terminal');
  return (
    <li role="treeitem" aria-selected={active}>
      <div
        data-testid="company-tree-all-row"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        title={t('companyTree.allRowDescription')}
        aria-label={t('companyTree.allRowAriaLabel')}
        className={`flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 border-b border-gray-800/60 mb-1 ${
          active ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : 'text-gray-400'
        }`}
      >
        <span className="w-3 text-center text-gray-600" aria-hidden="true">
          ◉
        </span>
        <span className="w-3 text-center" aria-hidden="true">
          {' '}
        </span>
        <span className="uppercase tracking-wider w-20 truncate font-semibold">
          {t('companyTree.allRowLabel')}
        </span>
        <span className="flex-1 truncate text-[10px] text-gray-600">
          {t('companyTree.allRowDescription')}
        </span>
      </div>
    </li>
  );
}

/**
 * Financial-truth-infra Phase B.1 — tiny circle badge encoding per-company
 * trust status: verified / partial / suspicious / pending. Tooltip carries
 * the full label for hover-discoverability. Position: between StarToggle
 * and the company code, both at root + child levels.
 */
export function TrustBadge({ status }: { status: TrustStatus }) {
  return (
    <span
      role="img"
      aria-label={`Trust status: ${status}`}
      title={TRUST_LABEL[status]}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: 6,
        height: 6,
        backgroundColor: TRUST_COLOR[status],
        // Subtle ring so the dot reads on busy backgrounds.
        boxShadow: `0 0 0 1px ${TRUST_COLOR[status]}30`,
      }}
    />
  );
}

/**
 * Phase 7.N — qualitative risk tag chips. Rendered after company name on
 * each tree row. Tags are stored in Company.settings.riskTags and surfaced
 * by the use-companies hook. Three canonical tags today:
 *   subsidy_dependency, non_transparent_structure, data_absence
 */
const RISK_TAG_CONFIG: Record<
  string,
  { label: string; color: string; title: string }
> = {
  subsidy_dependency: {
    label: "Sub",
    color: "bg-orange-950/70 text-orange-300 border-orange-700/50",
    title: "Subsidy dependency",
  },
  non_transparent_structure: {
    label: "Opq",
    color: "bg-yellow-950/70 text-yellow-300 border-yellow-700/50",
    title: "Non-transparent structure",
  },
  data_absence: {
    label: "NoD",
    color: "bg-slate-700/60 text-slate-400 border-slate-600/50",
    title: "Data absence",
  },
}

export function RiskTagChips({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null
  return (
    <>
      {tags.map((tag) => {
        const cfg = RISK_TAG_CONFIG[tag]
        if (!cfg) return null
        return (
          <span
            key={tag}
            title={cfg.title}
            className={`shrink-0 text-[8px] font-mono px-1 py-0 border rounded leading-[13px] ${cfg.color}`}
          >
            {cfg.label}
          </span>
        )
      })}
    </>
  )
}

/**
 * Truth-infra C.3 — tiny "pending" pill rendered next to TrustBadge when
 * a company is in onboarding-pending state. Only appears when the admin
 * has toggled "Show pending" — otherwise pending companies are excluded
 * by the matrix endpoint altogether.
 */
export function PendingPill({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  return (
    <span
      data-testid="company-tree-pending-pill"
      className="text-[8px] uppercase tracking-wider px-1 py-px rounded bg-amber-950/60 border border-amber-800/50 text-amber-300 shrink-0"
      aria-label={ariaLabel}
    >
      {label}
    </span>
  );
}

export function StarToggle(props: {
  code: string;
  starred: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        props.onToggle(props.code);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          props.onToggle(props.code);
        }
      }}
      aria-pressed={props.starred}
      aria-label={props.starred ? `Unstar ${props.code}` : `Star ${props.code}`}
      title={props.starred ? 'Starred' : 'Star this company'}
      className={`w-3 text-center text-[11px] focus:outline-none transition-colors ${
        props.starred
          ? 'text-[#FFB020] hover:text-[#FFA502]'
          : 'text-gray-700 hover:text-gray-400'
      }`}
    >
      <Star
        size={11}
        fill={props.starred ? 'currentColor' : 'none'}
        strokeWidth={props.starred ? 0 : 1.5}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * Phase 8 A4 — per-company data-freshness chip. `iso` is the MAX(computedAt)
 * across the entity's matrix cells (or its descendants', for sub-groups).
 * Fixed-width (`w-9`, right-aligned) so the compact label ("2h" / "15m" /
 * "3d" / "now") never shifts the sibling chips as it ticks; `data-volatile`
 * so the visual-baseline gate masks the rotating text. Dot is emerald when
 * fresh, amber when >24h stale (trust-badge convention). Renders nothing when
 * the entity has no computed cells, keeping the row clean.
 */
export function RowFreshness({ iso }: { iso: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const parts = formatFreshness(iso, now);
  if (!iso || !parts) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 shrink-0 w-9 justify-end text-[9px] tabular-nums text-gray-500"
      title={`Last recompute: ${new Date(iso).toLocaleString()} (${parts.label})`}
      data-testid="row-freshness"
      data-volatile="true"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1 w-1 rounded-full ${parts.isStale ? 'bg-amber-500' : 'bg-emerald-500'}`}
      />
      <span>{parts.short}</span>
    </span>
  );
}
