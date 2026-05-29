"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useTerminalStore } from '../store/terminalStore';
import { getLogger } from '@/lib/log';
// Phase 8 D1 (2026-05-29) — inline AI-commentary cache/hook extracted to a sibling.
import {
  useAISummary,
  fetchAISummary,
  clearAISummaryCache,
} from './heat-map/ai-summary';
// Re-export for the existing import path (main HeatMap fn + tests use it).
export { clearAISummaryCache };

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger('terminal:heatmap');
import {
  buildCellMap,
  cellKey,
  statusColor,
  statusShape,
  summarizeMatrix,
  type HeatMapCell,
} from '@/lib/risk/heatmap-matrix';
import { resolveIndicatorLabel } from '../lib/resolve-indicator-label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEventStream } from '@/lib/events/use-event-stream';
import { useDriftHealth, inputToSourceCode } from '../hooks/use-drift-health';
import { Lock } from 'lucide-react';
import { Sparkline, type SparklineStatus } from './Sparkline';
import { PeriodChips } from './PeriodChips';
import { TimeMachineSlider } from './TimeMachineSlider';
import {
  computeCompositeByCompany,
  type CompositeScore,
} from '@/lib/risk/composite-score';
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
} from '@/lib/risk/alert-rules';
import {
  DEFAULT_ALERT_THRESHOLDS,
  type ResolvedAlertThresholds,
  readAlertThresholdsFromOrgSettings,
} from '@/lib/risk/alert-thresholds-config';
import { useMatrix } from '../hooks/use-matrix';
import { useCompanies, buildRiskTagsByCompanyId } from '../hooks/use-companies';
import { getMateriality, isMaterialityScoped } from '@/lib/risk/esg-materiality';

// Phase 8 D1 (2026-05-29) — matrix types + the 535-LOC per-cell <td> renderer
// extracted to siblings; the main component imports them back.
import type { CompanyRow, IndicatorCol, MatrixResponse } from './heat-map/types';
import { HeatMapCellTd } from './heat-map/HeatMapCellTd';

type Props = {
  period?: string;
};

const PANEL_ID = 2;

export function HeatMap({ period }: Props) {
  const t = useTranslations('terminal');
  const locale = useLocale();
  // CLI Bloomberg-sweep: period chips. Local state so panel switches don't
  // ripple across other consumers of useMatrix(); seeded from `period` prop
  // (URL query or default year). Caller can still override via prop change.
  const [selectedPeriod, setSelectedPeriod] = useState<string | undefined>(period);
  useEffect(() => { setSelectedPeriod(period); }, [period]);
  // User-driven HeatMap row/cell clicks → selectCompany (tracks LRU recent).
  // 2026-05-27 — Drift bridge: per-cell stale + drifted markers
  // (defined here so the row-render loop can read it without an extra
  // prop-drill into HeatMapCellTd).
  const driftHealth = useDriftHealth();
  const setCompany = useTerminalStore((s) => s.selectCompany);
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const setActiveIv = useTerminalStore((s) => s.setActiveIndicatorValue);
  const setPendingMissingCell = useTerminalStore(
    (s) => s.setPendingMissingCell,
  );
  const setPendingRollupCell = useTerminalStore(
    (s) => s.setPendingRollupCell,
  );
  const setActivePanel = useTerminalStore((s) => s.setActivePanel);
  const search = useTerminalStore((s) => s.searchByPanel[PANEL_ID] ?? '');
  const setSearch = useTerminalStore((s) => s.setSearchForPanel);
  const clearSearch = useTerminalStore((s) => s.clearSearchForPanel);
  const setAlertsCount = useTerminalStore((s) => s.setAlertsCount);
  const setAlertedCompanyCodes = useTerminalStore((s) => s.setAlertedCompanyCodes);
  const setAlertMatches = useTerminalStore((s) => s.setAlertMatches);
  const compactMode = useTerminalStore((s) => s.compactMode);
  // Phase 7.N — scenario overlay
  const scenarioDelta = useTerminalStore((s) => s.scenarioDelta);
  const activeScenarioLabel = useTerminalStore((s) => s.activeScenarioLabel);
  const clearScenarioDelta = useTerminalStore((s) => s.clearScenarioDelta);
  // Financial-truth-infra Phase E.4 — pull org-level lockedPeriods so the
  // HeatMap header surfaces a 🔒 badge when the current period is signed
  // off. Hand-rolled fetch (no useQuery) so existing test harnesses don't
  // need a QueryClientProvider wrapper. Refresh on period change.
  const [lockedPeriods, setLockedPeriods] = useState<
    Array<{ period: string; lockedAt: string; lockedBy: string; reason?: string }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/budgeting/period-locks')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { locks?: typeof lockedPeriods } | null) => {
        if (!cancelled && Array.isArray(body?.locks)) setLockedPeriods(body!.locks);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  // Phase 7.I — sector-aware column ordering: when active company has an
  // industry the materiality matrix knows about, sort indicator columns so
  // material ones land left and hide `not_material` by default. User can
  // flip the toggle to show all indicators; the choice persists via
  // localStorage so reload doesn't snap back.
  const [hideNotMaterial, setHideNotMaterial] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem('terminal-hide-not-material-v1');
      if (stored === '0') return false;
      if (stored === '1') return true;
    } catch {
      // localStorage can throw in private mode — non-fatal.
    }
    return true; // default ON (hide indicators not associated with industry)
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        'terminal-hide-not-material-v1',
        hideNotMaterial ? '1' : '0',
      );
    } catch {
      // non-fatal.
    }
  }, [hideNotMaterial]);

  // 2026-05-27 — «Hide unknown» toggle: when ON, hide indicator columns
  // where every visible company has status=unknown (no data resolved).
  // Reduces visual noise from ~55% gray cells when showing real workflows.
  // Default OFF so the matrix still surfaces gaps by default — toggle is
  // a deliberate "demo mode" the user opts into. Persisted to localStorage.
  const [hideUnknown, setHideUnknown] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('terminal-hide-unknown-v1') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        'terminal-hide-unknown-v1',
        hideUnknown ? '1' : '0',
      );
    } catch {
      // non-fatal.
    }
  }, [hideUnknown]);

  // Sub-20: shared `useMatrix()` hook. Module-level cache means
  // HeatMap + ComparePanel + CompanySnapshot all subscribe to ONE
  // in-flight matrix fetch when they mount concurrently. SSE-driven
  // refetch goes through `refresh()` so the cache is invalidated and
  // every subscribing panel re-renders with fresh data.
  const { matrix: data, loading, error, refresh: refetchMatrix } =
    useMatrix(selectedPeriod);
  // Phase 7.N — qualitative riskTags from the SAME module-cached
  // `/api/companies` source CompanyTree (Panel 1) reads, so the
  // HeatMap row-header composite applies the identical per-tag penalty.
  // The matrix endpoint's `companies` payload does NOT carry riskTags,
  // hence the separate (already in-flight, deduped) hook rather than a
  // matrix-API change. Until this resolves, `companyTree` is null →
  // no penalty (matches pre-7.N behaviour, no flash of wrong score).
  const { companies: companyTree } = useCompanies();
  const searchInputRef = useRef<HTMLInputElement>(null);
  // SSR/CSR hydration guard — see CompanyTree for rationale.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // CXLVI — honest status counts from DB (bypasses matrix-API admin/rollup
  // filter so badge `0G/5A/9R` reflects what's actually in IndicatorValue
  // rows). Falls back to matrix-derived `summary` if endpoint is missing.
  // Dependency on `data?.period` not `period` prop: prop may be empty
  // initially while matrix-derived period is the canonical "active" one.
  const [dbSummary, setDbSummary] = useState<{ green: number; amber: number; red: number; unknown: number; total: number } | null>(null);
  const activePeriod = data?.period ?? selectedPeriod ?? period;
  useEffect(() => {
    if (!activePeriod) return;
    let cancelled = false;
    fetch(`/api/indicators/status-summary?period=${encodeURIComponent(activePeriod)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        if (typeof j.total === 'number') setDbSummary(j);
      })
      .catch(() => { /* silent — fall back to matrix-derived summary */ });
    return () => { cancelled = true; };
  }, [activePeriod]);

  // Phase 7.E C6 v2 — pull org-tuned alert thresholds. Falls back to
  // DEFAULT_ALERT_THRESHOLDS while the fetch is in-flight or if it fails;
  // either way the engine sees a fully-resolved config so alert output is
  // never blocked by a settings hiccup. Architect Round-1 sub-25 closure:
  // log a one-time console.warn on unexpected response shape so a future
  // API contract change ("returns bare settings, not {settings: ...}")
  // surfaces visibly rather than silently degrading to defaults.
  const [alertThresholds, setAlertThresholds] = useState<ResolvedAlertThresholds>(
    DEFAULT_ALERT_THRESHOLDS,
  );
  useEffect(() => {
    let cancelled = false;
    fetch('/api/organizations/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        if (typeof body !== 'object' || !('settings' in body)) {
          log.warn('/api/organizations/settings returned unexpected shape; falling back to default alert thresholds', {
            body,
          });
          return;
        }
        setAlertThresholds(
          readAlertThresholdsFromOrgSettings(
            (body as { settings?: unknown }).settings,
          ),
        );
      })
      .catch(() => {
        // Non-blocking — defaults remain in effect.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase B1 — refetch when SSE stream signals an indicator change.
  // Architect Round-1 sub-1 closure: debounce 150ms so a bulk-import
  // storm (10s of indicator updates fired back-to-back) coalesces to a
  // single refetch instead of N. At Phase F (60×80 = 4800-cell payload)
  // this matters; even at v1 scale (13×17) it prevents UI thrash on
  // RECOMPUTE-all flows. v2 follow-up: server-side `partial:cell`
  // event type that updates only the affected cell, no full refetch.
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEventStream({
    onIndicatorChanged: () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        // Round-7 architect closure: clear M3 narrative cache too, so a
        // period switch / data-refresh doesn't leave stale AI summaries
        // attached to ivIds whose underlying values have moved.
        clearAISummaryCache();
        refetchMatrix();
      }, 150);
    },
  });
  // Cleanup pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, []);

  // `/`-search bridge: when CommandBar dispatches focus to the active panel
  // and panel 2 is active, focus our search box. Custom event keeps the
  // store free of DOM refs.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panelId: number }>).detail;
      if (detail?.panelId === PANEL_ID) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('terminal:focus-search', handler as EventListener);
    return () =>
      window.removeEventListener('terminal:focus-search', handler as EventListener);
  }, []);

  const cellMap = useMemo(
    () => (data ? buildCellMap(data.cells) : new Map<string, HeatMapCell>()),
    [data],
  );

  // Phase C5 — composite risk score per company. Pre-computed once per
  // matrix fetch so each row header renders in O(1) (rather than re-
  // filtering cells N times). Keyed by companyId.
  //
  // Sub-group rollup cells (Turn-33.5 synthetic worst-of-children) are
  // EXCLUDED to prevent double-aggregation: the rollup already encodes
  // children's worst status, and averaging worst-of-children would
  // dramatically underestimate sub-group health (4g+1r → all-red rollup
  // → composite ≈ 0, but true signal is 80% green). Sub-groups end up
  // with no scoreable cells → composite null → "—" badge — honest
  // "this is a navigation rollup, not a measurable entity" UX.
  const compositeByCompany = useMemo(() => {
    if (!data) return new Map<string, CompositeScore>();
    // Phase 7.N — apply per-company qualitative riskTag penalties so the
    // Panel-2 row-header composite matches the Panel-1 CompanyTree badge
    // (subsidy_dependency -5, non_transparent_structure -8,
    // data_absence -12; clamped to ≥0). `companyTree` is the shared
    // `/api/companies` tree; map keys are Company.id === cell.companyId.
    // null while companies load → undefined → no penalty (pre-7.N parity).
    const riskTagsByCompanyId = companyTree
      ? buildRiskTagsByCompanyId(companyTree)
      : undefined;
    // Sparse-map mode (no companyIds arg) — rows without scoreable cells
    // are absent from the result; HeatMap's fallback for missing entries
    // shows "—" via `compositeByCompany.get(co.id) ?? null` consumer.
    return computeCompositeByCompany(data.cells, undefined, riskTagsByCompanyId);
  }, [data, companyTree]);

  const filteredCompanies = useMemo(() => {
    if (!data) return [];
    // Phase 7.I — Panel 2 unload. When CompanyTree has a specific company
    // selected (activeCompanyCode !== null), HeatMap renders ONLY that
    // company's row — drops the visual noise of the full 60-row matrix
    // down to a single focused row. The "ALL" synthetic row at the top
    // of CompanyTree clears activeCompanyCode, restoring the full view.
    // Search filter still applies *within* the selected scope (single row,
    // so search trivially passes or fails) — kept for code symmetry.
    if (activeCompanyCode) {
      return data.companies.filter((c) => c.code === activeCompanyCode);
    }
    const q = search.trim().toUpperCase();
    if (q === '') return data.companies;
    return data.companies.filter(
      (c) =>
        c.code.toUpperCase().includes(q) ||
        c.name.toUpperCase().includes(q) ||
        (c.industry ?? '').toUpperCase().includes(q),
    );
  }, [data, search, activeCompanyCode]);

  const summary = useMemo(() => {
    if (!data) return null;
    return summarizeMatrix(
      filteredCompanies.map((c) => c.id),
      data.indicators.map((i) => i.id),
      data.cells.filter((c) =>
        filteredCompanies.some((co) => co.id === c.companyId),
      ),
    );
  }, [data, filteredCompanies]);

  // Publish org-wide alert count (red+amber across the FULL matrix, not
  // the search-filtered view) so the CommandBar `[alerts 🔔 N]` strip
  // reflects total org alerts independent of Panel-2 search input.
  // Phase B4 — also publish the SET of alerted company codes (not just
  // the count) so CompanyTree's 'alerted' watchlist tab can filter rows.
  useEffect(() => {
    if (!data) {
      setAlertsCount(null);
      setAlertedCompanyCodes(null);
      setAlertMatches(null);
      return;
    }
    let count = 0;
    const alertedCompanyIds = new Set<string>();
    for (const c of data.cells) {
      if (c.status === 'amber' || c.status === 'red') {
        count++;
        alertedCompanyIds.add(c.companyId);
      }
    }
    setAlertsCount(count);
    // Map company-id → company-code (CompanyTree filter is code-based).
    const alertedCodes = new Set<string>();
    for (const co of data.companies) {
      if (alertedCompanyIds.has(co.id)) alertedCodes.add(co.code);
    }
    setAlertedCompanyCodes(alertedCodes);
    // Phase C6 v2 — run rule engine against full matrix; publish flat
    // sorted match list for AlertsPanel modal. `companies`/`indicators`
    // shapes match AlertCompany/AlertIndicator structurally. Threshold
    // config flows from `/api/organizations/settings` (sub-9 closure).
    const matches = evaluateAlertRules(
      DEFAULT_ALERT_RULES,
      {
        companies: data.companies,
        indicators: data.indicators,
        cells: data.cells,
      },
      alertThresholds,
    );
    setAlertMatches(matches);
  }, [
    data,
    alertThresholds,
    setAlertsCount,
    setAlertedCompanyCodes,
    setAlertMatches,
  ]);

  // Phase 7.I — sector-aware column resolution. MUST be declared above any
  // conditional early-return so the hook order stays stable across renders
  // (React's Rules of Hooks). Empty/loading branches re-use the same memos
  // — they just return empty arrays.
  //
  // For LEAF entities (level=2 ops cos like AZSEKER-EDEN) the company row
  // carries `industry` directly. For SUB-GROUPS / holdings (AAC, AZSEKER,
  // …) the row's own `industry` is null — derive the relevant set by
  // walking descendants and unioning their industries. The matrix payload
  // surfaces `parentCompanyId` on each row, so the walk is one pass.
  const activeCompanyIndustries = useMemo<readonly string[]>(() => {
    if (!data || !activeCompanyCode) return [];
    const co = data.companies.find((c) => c.code === activeCompanyCode);
    if (!co) return [];
    if (co.industry) return [co.industry];
    // Sub-group with no own industry — union of descendant industries.
    type WithParent = (typeof data.companies)[number] & { parentCompanyId?: string | null };
    const collected = new Set<string>();
    const walk = (parentId: string): void => {
      for (const c of data.companies as ReadonlyArray<WithParent>) {
        if (c.parentCompanyId === parentId) {
          if (c.industry) collected.add(c.industry);
          walk(c.id);
        }
      }
    };
    walk(co.id);
    return Array.from(collected);
  }, [data, activeCompanyCode]);
  // Back-compat single-industry alias used by materiality lookups. When
  // the active company resolves to exactly ONE industry (leaf op-co OR a
  // sub-group whose descendants share one industry, e.g. AAC = pure
  // industrial), the SASB materiality matrix lookup is unambiguous.
  // Mixed sub-groups skip materiality scoring (defaults to "material"
  // for every indicator — see enriched branch below).
  const activeCompanyIndustry =
    activeCompanyIndustries.length === 1 ? activeCompanyIndustries[0] : null;

  const rawIndicators = data?.indicators ?? [];
  const indicators = useMemo(() => {
    if (activeCompanyIndustries.length === 0) return rawIndicators;
    const rankMateriality = (rating: 'material' | 'low_materiality' | 'not_material'): number => {
      if (rating === 'material') return 0;
      if (rating === 'low_materiality') return 1;
      return 2; // not_material
    };
    /**
     * Phase 7.I sub-fix — an indicator is "associated" with the active
     * company when EITHER:
     *   - its `industries` field is empty/missing (universal indicator
     *     like financial ratios that apply to every sector), OR
     *   - its `industries` array intersects with the active company's
     *     resolved industry set (one entry for a leaf op-co; multiple
     *     for a mixed sub-group like AZSEKER → agro_crops + food_processing).
     * If `industries` is non-empty AND doesn't intersect, the indicator
     * is explicitly NOT relevant to this entity (e.g. HOSP_OCC for an
     * industrial holding) and gets hidden when "Material only" is on.
     * Drops the column count from ~65 down to ~10–15 for a focused view,
     * eliminating horizontal scroll.
     */
    const isAssociatedWithIndustry = (ind: { industries?: string[] }): boolean => {
      const tags = ind.industries ?? [];
      if (tags.length === 0) return true; // universal indicator
      return tags.some((t) => activeCompanyIndustries.includes(t));
    };
    /**
     * Phase 7.I — secondary sort key: industry-specificity.
     *
     * Within the same materiality rating, push industry-tagged indicators
     * that match the active company's industry BEFORE universal indicators.
     * For an AZSEKER (agro_crops) entity this lifts the 7 AGRO_* seeds
     * (yield, sugar content, weather rainfall, sugar price trend, cut-to-mill,
     * buyer concentration, harvest progress) to the left of the universal
     * financial ratios (IND_DSO, IND_GROSS_MARGIN, IND_NET_MARGIN, etc.) so
     * the operator's eye lands on the sector-defining signals first.
     *
     *   priority 0 — industry-tagged AND intersects active company industry
     *   priority 1 — universal indicator (empty `industries`)
     *   priority 2 — industry-tagged but non-intersecting (only visible
     *                when "Material only" toggle is off; lands at the
     *                right edge as low-relevance noise)
     */
    const rankIndustrySpecificity = (ind: { industries?: string[] }): number => {
      const tags = ind.industries ?? [];
      if (tags.length === 0) return 1;
      return tags.some((t) => activeCompanyIndustries.includes(t)) ? 0 : 2;
    };
    const enriched = rawIndicators.map((ind) => ({
      ind,
      rating:
        activeCompanyIndustry && isMaterialityScoped(ind.code)
          ? getMateriality(activeCompanyIndustry, ind.code)
          : ('material' as const),
    }));
    const visible = hideNotMaterial
      ? enriched.filter(
          (e) => e.rating !== 'not_material' && isAssociatedWithIndustry(e.ind),
        )
      : enriched;
    // Stable two-level sort: (materiality rating ASC) then (industry-
    // specificity ASC). Equal-rated equal-specificity rows fall back to
    // insertion order, which matches the seed `sortOrder` field.
    visible.sort((a, b) => {
      const r = rankMateriality(a.rating) - rankMateriality(b.rating);
      if (r !== 0) return r;
      return rankIndustrySpecificity(a.ind) - rankIndustrySpecificity(b.ind);
    });
    return visible.map((e) => e.ind);
  }, [activeCompanyIndustries, activeCompanyIndustry, hideNotMaterial, rawIndicators]);

  // 2026-05-27 — «Hide unknown» derived view. Compute the set of indicator
  // IDs that have AT LEAST ONE non-unknown cell among the currently
  // visible companies; when toggle is ON, drop columns missing from that
  // set. O(cells + visibleCompanies) per matrix change — bounded by the
  // matrix size (60 × 50 = 3k cells worst case).
  const indicatorsWithAnyData = useMemo(() => {
    if (!data || !hideUnknown) return null;
    const visibleCompanyIds = new Set(filteredCompanies.map((c) => c.id));
    const set = new Set<string>();
    for (const cell of data.cells) {
      if (!visibleCompanyIds.has(cell.companyId)) continue;
      if (cell.status && cell.status !== 'unknown') {
        set.add(cell.indicatorId);
      }
    }
    return set;
  }, [data, filteredCompanies, hideUnknown]);

  const displayIndicators = useMemo(() => {
    if (!hideUnknown || !indicatorsWithAnyData) return indicators;
    return indicators.filter((ind) => indicatorsWithAnyData.has(ind.id));
  }, [indicators, hideUnknown, indicatorsWithAnyData]);

  const hiddenUnknownCount = hideUnknown
    ? indicators.length - displayIndicators.length
    : 0;

  if (!mounted) {
    return (
      <span className="text-gray-700 font-mono text-[10px]">{t('heatMap.loading')}</span>
    );
  }

  if (error) {
    return (
      <span className="text-[#FF4757] font-mono text-xs">{t('heatMap.errorPrefix')} {error}</span>
    );
  }

  // Even when data is empty / loading, render the search input so the
  // `/`-search shortcut always lands on a visible target. The body
  // toggles between "no rows yet" and the matrix table.
  const isEmpty =
    !loading &&
    (!data || data.companies.length === 0 || data.indicators.length === 0);
  const renderedPeriod = data?.period ?? selectedPeriod ?? period ?? '';
  // Show the toggle only when there's a sector-aware industry — for org-wide
  // view it would be ambiguous which industry to dim against.
  const showMaterialityToggle = activeCompanyIndustry != null;
  // Phase E.4 — flag whether the currently-rendered period is signed off.
  // Match against the renderedPeriod string (exact match — locking "2026"
  // doesn't tag "2026-Q1" per period-lock.ts semantics).
  const activeLock = lockedPeriods.find((l) => l.period === renderedPeriod);

  // Phase 7.M Step 5 (2026-05-19) — readiness for the active company.
  // When a user drills into a single entity (CompanyTree click → only
  // that row renders), we surface a banner above the grid if readiness
  // is partial/thin/empty. The intent is to tell the finance reviewer
  // "the cells you're about to read are based on incomplete data —
  // don't anchor on these numbers as authoritative". Hides when:
  //   - readiness data unavailable
  //   - tier is good/complete (no warning needed)
  //   - no active company drill-down (full-holding view doesn't carry
  //     a single readiness signal)
  const activeReadiness = data && activeCompanyCode
    ? data.companies.find((c) => c.code === activeCompanyCode)?.readiness ?? null
    : null;
  const showReadinessBanner =
    activeReadiness !== null &&
    activeReadiness !== undefined &&
    (activeReadiness.tier === 'partial' ||
      activeReadiness.tier === 'thin' ||
      activeReadiness.tier === 'empty');

  return (
    <div className="font-mono text-[10px] text-gray-300 w-full h-full flex flex-col">
      <div className="flex items-center justify-between mb-2 text-[10px] text-gray-500 shrink-0 gap-2">
        <span className="shrink-0 flex items-center gap-1" title={t('hints.heatMap')}>
          {t('panels.heatMapShort')} · <span className="text-gray-300">{renderedPeriod}</span>
          {activeLock && (
            <span
              data-testid="period-lock-badge"
              title={`Period locked${activeLock.reason ? `: ${activeLock.reason}` : ''} (signed ${new Date(activeLock.lockedAt).toLocaleDateString()})`}
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-500 text-[9px] uppercase tracking-wider font-semibold"
            >
              <Lock size={9} aria-hidden="true" /> LOCKED
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 flex-1 max-w-[220px]">
          <span className="text-gray-600">/</span>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(PANEL_ID, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                clearSearch(PANEL_ID);
                searchInputRef.current?.blur();
                e.stopPropagation();
              }
            }}
            placeholder={t('heatMap.filterRowsPlaceholder')}
            className="bg-[#0A0E27] border border-gray-800 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 focus:border-[#00D4AA] focus:outline-none w-full"
            spellCheck={false}
            aria-label={t('heatMap.filterAriaLabel')}
          />
        </div>
        {showMaterialityToggle && (
          <button
            type="button"
            onClick={() => setHideNotMaterial((v) => !v)}
            className={`shrink-0 px-1.5 py-0.5 border rounded text-[9px] uppercase tracking-wider transition-colors ${
              hideNotMaterial
                ? 'border-[#00D4AA] text-[#00D4AA]'
                : 'border-gray-700 text-gray-500 hover:border-gray-500'
            }`}
            title={
              hideNotMaterial
                ? `Showing material indicators only for ${activeCompanyIndustry}. Click to show all.`
                : `Click to hide indicators flagged not-material for ${activeCompanyIndustry}.`
            }
          >
            {hideNotMaterial ? 'Material only' : 'All'}
          </button>
        )}
        {/* 2026-05-27 — «Hide unknown» toggle. Hides indicator columns
            where every visible company has status=unknown. Default OFF
            so gaps stay surfaced; user opts into "demo mode". */}
        <button
          type="button"
          onClick={() => setHideUnknown((v) => !v)}
          className={`shrink-0 px-1.5 py-0.5 border rounded text-[9px] uppercase tracking-wider transition-colors ${
            hideUnknown
              ? 'border-[#00D4AA] text-[#00D4AA]'
              : 'border-gray-700 text-gray-500 hover:border-gray-500'
          }`}
          title={
            hideUnknown
              ? `Hiding ${hiddenUnknownCount} indicator${hiddenUnknownCount === 1 ? '' : 's'} where every visible entity has no data. Click to show all.`
              : 'Click to hide indicator columns where every visible entity has no data (cleaner view for demos).'
          }
          data-testid="hide-unknown-toggle"
        >
          {hideUnknown
            ? `Hide unknown · ${hiddenUnknownCount} hidden`
            : 'Hide unknown'}
        </button>
        {(dbSummary || summary) && (
          <span className="tabular-nums shrink-0" title={dbSummary ? 'Counts from DB (all entities incl. admin)' : 'Counts from matrix view (admin filtered)'}>
            <span style={{ color: statusColor('green') }}>
              {statusShape('green')} {(dbSummary ?? summary)!.green}G
            </span>
            {' / '}
            <span style={{ color: statusColor('amber') }}>
              {statusShape('amber')} {(dbSummary ?? summary)!.amber}A
            </span>
            {' / '}
            <span style={{ color: statusColor('red') }}>
              {statusShape('red')} {(dbSummary ?? summary)!.red}R
            </span>
            {' / '}
            <span className="text-gray-500">
              {statusShape('unknown')} {(dbSummary ?? summary)!.unknown}?
            </span>
            {!dbSummary && summary && (
              <>
                {' / '}
                <span className="text-gray-600">{summary.missing}·</span>
              </>
            )}
          </span>
        )}
        {/* 2026-05-27 A4 — data-freshness badge. Reads matrix.lastComputedAt
            from server (max(IndicatorValue.computedAt) across rendered cells)
            and turns it into «Updated 2h ago» via FreshnessLabel below.
            Re-renders every 30s without re-fetching the matrix. */}
        {data?.lastComputedAt && (
          <FreshnessLabel iso={data.lastComputedAt} />
        )}
        {/* Phase 7.N — scenario mode badge */}
        {activeScenarioLabel && (
          <span className="inline-flex items-center gap-1 shrink-0 px-2 py-0.5 rounded border border-[#FFB800]/50 bg-[#FFB800]/10 text-[#FFB800] text-[9px] uppercase tracking-wider font-semibold">
            <span>⚡ СЦЕНАРИЙ: {activeScenarioLabel}</span>
            <button
              type="button"
              onClick={() => clearScenarioDelta()}
              className="ml-1 opacity-70 hover:opacity-100"
              title="Вернуться к базовым данным"
            >
              ×
            </button>
          </span>
        )}
      </div>

      {/* CLI Bloomberg-sweep: period chip row — annual / quarters / months.
          Active chip wired to setSelectedPeriod, which drives useMatrix(). */}
      <div className="mb-1 shrink-0">
        <PeriodChips
          current={renderedPeriod}
          onChange={(p) => setSelectedPeriod(p)}
          compact={compactMode}
        />
      </div>
      {/* Tier 3 time-machine — scrub through months with play/pause.
          Same setSelectedPeriod → useMatrix() refetch path as the chips. */}
      <div className="mb-2 shrink-0">
        <TimeMachineSlider
          current={renderedPeriod}
          onChange={(p) => setSelectedPeriod(p)}
        />
      </div>
      {showReadinessBanner && activeReadiness && (
        <div
          data-testid="heatmap-readiness-banner"
          data-readiness-tier={activeReadiness.tier}
          className={`mb-2 shrink-0 px-2 py-1.5 rounded border text-[11px] leading-relaxed ${
            activeReadiness.tier === 'empty'
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : activeReadiness.tier === 'thin'
                ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
          role="status"
          aria-live="polite"
        >
          <span className="font-semibold">Data readiness {activeReadiness.score}%.</span>{' '}
          {activeReadiness.tier === 'empty'
            ? 'No real data for this entity — cells below are placeholder or model-derived. Do not anchor analysis on these numbers.'
            : activeReadiness.tier === 'thin'
              ? 'Sparse data — AI Variance Explainer may hallucinate. Treat amber/red cells as directional, not authoritative.'
              : 'Multiple data areas have gaps — review the readiness chip on this entity for what is missing.'}
          {' '}
          <span className="text-[10px] opacity-80">
            Missing: {activeReadiness.areas
              .filter((a) => a.missing)
              .slice(0, 3)
              .map((a) => a.label.toLowerCase())
              .join(', ') || '—'}
          </span>
        </div>
      )}
      {loading && (
        <span className="text-gray-700 text-[11px] py-2">{t('heatMap.loadingHeatmap')}</span>
      )}
      {isEmpty && (
        <span className="text-gray-700 text-[11px] py-2">
          {t('heatMap.noCompaniesYet')}
        </span>
      )}

      <div className={`flex-1 overflow-auto ${isEmpty || loading ? 'hidden' : ''}`}>
        <TooltipProvider delayDuration={300}>
        <table className="border-collapse" aria-label={t('heatMap.tableAriaLabel')}>
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-20 bg-[#0A0E27] text-left px-1.5 py-1 border-b border-gray-800/60 text-gray-500 uppercase tracking-wider"
                style={{ minWidth: 90 }}
              >
                {t('heatMap.companyColumn')}
              </th>
              {displayIndicators.map((ind) => (
                <th
                  key={ind.id}
                  // data-indicator-code lets tests + ARIA tools read the
                  // canonical column code without parsing the ticker text
                  // (which carries a leading direction marker glyph).
                  data-indicator-code={ind.code}
                  className="sticky top-0 z-10 bg-[#0A0E27] px-1 py-1 border-b border-gray-800/60 text-gray-500 uppercase tracking-wider text-[9px]"
                  style={{
                    minWidth: compactMode ? 40 : 54,
                    maxWidth: compactMode ? 40 : 54,
                  }}
                >
                  {/* CLI Bloomberg-sweep: primary label is `ind.code` (mono,
                      Bloomberg-ticker style) + direction marker (▲ higher_better
                      / ▼ lower_better / ◆ band). Localized full name moves to
                      hover-tooltip + secondary muted line under code. Codes scan
                      ~3× faster than truncated locale text. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="cursor-help leading-tight">
                        <div className="truncate font-mono text-gray-200 text-[10px] tracking-tight">
                          <span className="text-gray-500 mr-0.5" aria-hidden="true">
                            {ind.direction === 'higher_better' ? '▲' : ind.direction === 'lower_better' ? '▼' : '◆'}
                          </span>
                          {ind.code}
                        </div>
                        <div className="truncate font-sans text-gray-500 text-[8px] mt-px normal-case">
                          {resolveIndicatorLabel(ind, locale)}
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="bg-popover text-popover-foreground border border-border shadow-lg max-w-[280px] text-xs"
                    >
                      <div className="font-sans font-semibold">
                        {resolveIndicatorLabel(ind, locale)}
                      </div>
                      <div className="font-mono text-muted-foreground text-[10px] mt-0.5">
                        {ind.code}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                        {t('heatMap.tooltipUnit')} {ind.unit} ·{' '}
                        {ind.direction === 'higher_better'
                          ? t('heatMap.tooltipDirHigher')
                          : ind.direction === 'lower_better'
                            ? t('heatMap.tooltipDirLower')
                            : t('heatMap.tooltipDirBand')}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.length === 0 ? (
              <tr>
                <td
                  colSpan={displayIndicators.length + 1}
                  className="text-gray-600 px-2 py-3 text-center"
                >
                  {t('heatMap.noCompaniesMatch')} "{search}"
                </td>
              </tr>
            ) : (
              filteredCompanies.map((co) => {
                const rowActive = co.code === activeCompanyCode;
                return (
                  <tr key={co.id}>
                    <th
                      scope="row"
                      className={`sticky left-0 bg-[#0A0E27] text-left px-1.5 py-0.5 border-b border-gray-800/40 ${
                        rowActive ? 'text-[#00D4AA]' : 'text-gray-400'
                      }`}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setCompany(co.code)}
                            className="cursor-pointer hover:bg-gray-800/40 px-1 py-0.5 rounded text-left w-full flex items-center justify-between gap-1.5"
                          >
                            <span className="truncate">{co.code}</span>
                            <CompositeBadge
                              score={compositeByCompany.get(co.id) ?? null}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="bg-popover text-popover-foreground border border-border shadow-lg text-xs"
                        >
                          <div className="font-mono font-semibold">
                            {co.code}
                          </div>
                          <div className="text-muted-foreground">
                            {co.name}{co.industry ? ` · ${co.industry}` : ''}
                          </div>
                          {(() => {
                            const cs = compositeByCompany.get(co.id);
                            if (!cs) return null;
                            // Round-16 closure — shape glyph next to the
                            // band-colored composite score in row-header
                            // tooltip. Maps band→IndicatorStatus for the
                            // statusShape() helper.
                            const tooltipBandStatus =
                              cs.band === 'green' ||
                              cs.band === 'amber' ||
                              cs.band === 'red'
                                ? cs.band
                                : 'unknown';
                            return (
                              <div className="text-[11px] mt-1">
                                <span className="text-muted-foreground">
                                  {t('heatMap.tooltipCompositeScore')}{' '}
                                </span>
                                <span
                                  className={
                                    cs.band === 'green'
                                      ? 'text-[#00D4AA]'
                                      : cs.band === 'amber'
                                      ? 'text-[#FFA502]'
                                      : cs.band === 'red'
                                      ? 'text-[#FF4757]'
                                      : 'text-muted-foreground'
                                  }
                                >
                                  {cs.score !== null && (
                                    <span aria-hidden="true" className="mr-0.5 opacity-70">
                                      {statusShape(tooltipBandStatus)}
                                    </span>
                                  )}
                                  {cs.score === null
                                    ? t('heatMap.tooltipNoData')
                                    : `${cs.score} / 100`}
                                </span>
                                <span className="text-muted-foreground">
                                  {' · '}
                                  {cs.contributingCount}/{cs.totalCount}{' '}
                                  {t('heatMap.tooltipIndicators')}
                                </span>
                              </div>
                            );
                          })()}
                        </TooltipContent>
                      </Tooltip>
                    </th>
                    {displayIndicators.map((ind) => {
                      const c = cellMap.get(cellKey(co.id, ind.id));
                      const scenarioStatus = scenarioDelta?.get(`${co.id}:${ind.code}`) ?? undefined;
                      // 2026-05-27 — drift bridge: derive per-cell flags
                      // from the global drift-health snapshot.
                      let staleInputSourceCode: string | undefined;
                      let staleInputStatus: 'stale' | 'critical_stale' | undefined;
                      for (const input of ind.requiredInputs ?? []) {
                        const code = inputToSourceCode(input);
                        if (!code) continue;
                        const f = driftHealth.byCode.get(code);
                        if (f && (f.status === 'stale' || f.status === 'critical_stale')) {
                          staleInputSourceCode = code;
                          staleInputStatus = f.status;
                          if (f.status === 'critical_stale') break; // worst wins
                        }
                      }
                      const driftedRecently = driftHealth.driftedCells.has(`${co.code}::${ind.code}`);
                      return (
                        <HeatMapCellTd
                          key={ind.id}
                          co={co}
                          ind={ind}
                          cell={c}
                          compactMode={compactMode}
                          scenarioStatus={scenarioStatus}
                          staleInputSourceCode={staleInputSourceCode}
                          staleInputStatus={staleInputStatus}
                          driftedRecently={driftedRecently}
                          onCellClick={() => {
                            // Cell click ALWAYS selects company. Two
                            // panel-3 paths split on whether the cell
                            // has a computed IndicatorValue:
                            //
                            //  • cell with `indicatorValueId` →
                            //      setActiveIv (Panel 3 fetches detail)
                            //  • missing cell (no IV row yet) →
                            //      setPendingMissingCell (Panel 3 shows
                            //      "no data — onboard or recompute" hint
                            //      with the company + indicator codes)
                            //
                            // Phase 7.D regression-architect closure:
                            // user reported clicks "не работают" on
                            // missing cells (silent no-Panel-3). New
                            // contract guarantees Panel 3 ALWAYS opens
                            // on cell click — the cell either drives a
                            // drill-down or a self-explanatory hint.
                            setCompany(co.code);
                            setActivePanel(3);
                            if (c?.indicatorValueId) {
                              setActiveIv(c.indicatorValueId);
                            } else if (c?.kind === 'synthetic-rollup') {
                              // Phase 7.G Turn VI — sub-group rollup cell:
                              // value is averaged + status is worst-of-children
                              // (computed by /api/indicators/matrix). No
                              // persisted IV exists. Pre-Turn-VI this routed
                              // to setPendingMissingCell → "no computed
                              // value yet" copy, which contradicted the
                              // clearly-lit cell. Now the panel renders a
                              // dedicated rollup view with the aggregate
                              // + child count.
                              //
                              // Direct `c.kind === 'synthetic-rollup'` check
                              // here (NOT `isAggregateRollup(c)`) is intentional:
                              // we want ONLY synthetic, not real-rollup. Real-
                              // rollup cells (kind='real-rollup') have a
                              // persisted `indicatorValueId` and the canonical
                              // formula-output-IV path is the right drill-down
                              // — they short-circuit upstream at the
                              // `c?.indicatorValueId` gate above. So
                              // `isAggregateRollup` would semantically over-
                              // match here. Architect Turn-VI Round-1 ⚠️
                              // closure — `heatmap-matrix.ts:60` "never check
                              // kind directly" rule has an exception when
                              // upstream short-circuits eliminate the other
                              // variant.
                              setPendingRollupCell({
                                companyId: co.id,
                                companyCode: co.code,
                                indicatorId: ind.id,
                                indicatorCode: ind.code,
                                indicatorName: resolveIndicatorLabel(ind, locale),
                                indicatorUnit: ind.unit ?? null,
                                value: c.value,
                                status: c.status,
                                contributingChildCount:
                                  c.contributingChildCount ?? 0,
                              });
                            } else {
                              setPendingMissingCell({
                                companyId: co.id,
                                companyCode: co.code,
                                indicatorId: ind.id,
                                indicatorCode: ind.code,
                                // Phase 7.G post-Turn-I (HeatMap audit
                                // 🔄 closure inline) — was `ind.nameEn`;
                                // audit confirmed single consumer at
                                // IndicatorDetail.tsx:192 is pure UI
                                // render (NOT LLM-input), so locale-
                                // aware resolution is correct. Field
                                // also renamed `indicatorNameEn → indicatorName`
                                // since it's no longer EN-canonical.
                                indicatorName: resolveIndicatorLabel(ind, locale),
                              });
                            }
                          }}
                        />
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </TooltipProvider>
      </div>
    </div>
  );
}

/**
 * Phase C5 — small badge showing composite risk score (0-100) next to
 * the company code in HeatMap row headers. Color-coded by band; null
 * score renders a neutral "—" (no data, NOT a 0/red signal).
 *
 * Sub-27 cont'd Round-9 — locale-aware tooltips via i18n placeholders.
 */
function CompositeBadge({ score }: { score: CompositeScore | null }) {
  const t = useTranslations('terminal');
  if (!score || score.score === null) {
    return (
      <span
        className="text-[9px] tabular-nums text-gray-500 shrink-0"
        title={t('heatMap.noScoreableIndicators')}
      >
        —
      </span>
    );
  }
  const colorClass =
    score.band === 'green'
      ? 'text-[#00D4AA]'
      : score.band === 'amber'
      ? 'text-[#FFA502]'
      : score.band === 'red'
      ? 'text-[#FF4757]'
      : 'text-gray-500';
  // Tier-3 sub-29 M7 — shape glyph alongside score for color-blind parity.
  const bandStatus =
    score.band === 'green' || score.band === 'amber' || score.band === 'red'
      ? score.band
      : 'unknown';
  return (
    <span
      className={`text-[9px] tabular-nums font-semibold shrink-0 ${colorClass}`}
      title={t('heatMap.compositeScoreTitle', {
        score: score.score,
        contributing: score.contributingCount,
        total: score.totalCount,
      })}
    >
      <span aria-hidden="true" className="mr-0.5 opacity-70">
        {statusShape(bandStatus)}
      </span>
      {score.score}
    </span>
  );
}

/** Translate a formula-engine error to user-friendly text per locale.
 *  Special-cases _VS_<YEAR> indicators (where missing baseline data
 *  is the typical NaN cause) with an actionable hint. Raw code+reason
 *  remain in the title attribute for technical debugging. */
function FreshnessLabel({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const deltaSec = Math.max(0, Math.round((now - ts) / 1000));
  let label: string;
  if (deltaSec < 60) label = 'just now';
  else if (deltaSec < 3600) label = `${Math.round(deltaSec / 60)}m ago`;
  else if (deltaSec < 86400) label = `${Math.round(deltaSec / 3600)}h ago`;
  else label = `${Math.round(deltaSec / 86400)}d ago`;
  // Stale-after-24h flips the dot from teal (live) to amber (stale).
  // Matches the trust-badge convention: real-time green / known-old amber.
  const isStale = deltaSec > 86400;
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 text-gray-500 text-[9px] tabular-nums"
      title={`Last recompute: ${new Date(iso).toLocaleString()}`}
      data-testid="heatmap-freshness"
      // 2026-05-27 — opt out of visual diff (label text rotates every
      // 30s, would cause spurious baseline drift on long test runs).
      data-volatile="true"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1 w-1 rounded-full ${isStale ? 'bg-amber-500' : 'bg-emerald-500'}`}
      />
      <span>updated {label}</span>
    </span>
  );
}
