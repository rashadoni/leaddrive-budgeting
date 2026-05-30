"use client";
/**
 * HeatMap data model — extracted from HeatMap.tsx (Phase 8 D1 2026-05-29) to
 * bring the terminal HeatMap under the 1000-LOC mega-file line. Holds ALL the
 * non-rendering data layer: the period/filter state, the shared useMatrix /
 * useCompanies / useDriftHealth fetches, the alert-threshold + status-summary
 * effects (which also publish alert counts back to the terminal store), and
 * the cellMap / composite / filtered-companies / summary / indicator memos.
 * Because NO JSX moved, the rendered output (and the visual-baseline snapshot)
 * is byte-identical — this is a pure data/presentation split.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useTerminalStore } from '../store/terminalStore';
import { getLogger } from '@/lib/log';
import { clearAISummaryCache } from './heat-map/ai-summary';
import {
  buildCellMap,
  summarizeMatrix,
  type HeatMapCell,
} from '@/lib/risk/heatmap-matrix';
import { useDriftHealth } from '../hooks/use-drift-health';
import { useEventStream } from '@/lib/events/use-event-stream';
import {
  computeCompositeByCompany,
  deriveParentComposites,
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

const log = getLogger('terminal:heatmap');
const PANEL_ID = 2;

export function useHeatMapModel(period: string | undefined) {
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
  // → composite ≈ 0, but true signal is 80% green). Sub-groups have no own
  // scoreable cells, so their composite is instead DERIVED below as a
  // revenue-weighted roll-up of their children (deriveParentComposites) —
  // matching CompanyTree (Panel 1) so the SAME number shows in both panels
  // (2026-05-30: replaced the prior "—" blank, which clashed with the tree).
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
    const leafById = computeCompositeByCompany(data.cells, undefined, riskTagsByCompanyId);
    return deriveParentComposites(data.companies, leafById);
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

  return {
    t, locale, selectedPeriod, setSelectedPeriod, driftHealth, setCompany,
    activeCompanyCode, setActiveIv, setPendingMissingCell, setPendingRollupCell,
    setActivePanel, search, setSearch, clearSearch, setAlertsCount,
    setAlertedCompanyCodes, setAlertMatches, compactMode, scenarioDelta,
    activeScenarioLabel, clearScenarioDelta, lockedPeriods, setLockedPeriods,
    hideNotMaterial, setHideNotMaterial, hideUnknown, setHideUnknown, data,
    loading, error, refetchMatrix, companyTree, searchInputRef, mounted,
    setMounted, dbSummary, setDbSummary, activePeriod, alertThresholds,
    setAlertThresholds, refetchTimerRef, cellMap, compositeByCompany,
    filteredCompanies, summary, activeCompanyIndustries, activeCompanyIndustry,
    rawIndicators, indicators, indicatorsWithAnyData, displayIndicators,
    hiddenUnknownCount,
  };
}
