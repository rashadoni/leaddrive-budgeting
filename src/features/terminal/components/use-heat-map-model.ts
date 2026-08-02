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
import { markNonScoringCells } from '@/lib/risk/indicator-provenance';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useTerminalStore } from '../store/terminalStore';
import { getLogger } from '@/lib/log';
import { clearAISummaryCache } from './heat-map/ai-summary';
import {
  buildCellMap,
  summarizeMatrix,
  isAggregateRollup,
  hasStatementMismatch,
  type HeatMapCell,
} from '@/lib/risk/heatmap-matrix';
import { summarizeSurfaceGrade } from '@/lib/risk/decision-grade';
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
import { filterIndicatorsByQuery } from '../lib/indicator-search';
import {
  collectScopeCompanyIds,
  collectScopeIndustries,
  createApplicabilityDecisionResolver,
  partitionIndicatorsByScope,
} from '../lib/indicator-applicability';

const log = getLogger('terminal:heatmap');
const PANEL_ID = 2;

// A cell only counts as REAL data when it carries a green/amber/red
// classification. `unknown` cells (Phase A.3: "no data ingested yet" — the
// grid renders them as "—") and absent cells both read as «нет данных», so
// neither is data. The "Hide inapplicable" toggle uses this to also collapse
// columns that are empty across every currently-visible company.
const DATA_BEARING_STATUSES = new Set<HeatMapCell['status']>([
  'green',
  'amber',
  'red',
]);

export function useHeatMapModel(period: string | undefined) {
  const t = useTranslations('terminal');
  const locale = useLocale();
  // CLI Bloomberg-sweep: period chips. Period now lives in the SHARED terminal
  // store (2026-06-03 terminal-audit P2) — previously this was HeatMap-local
  // state explicitly to avoid rippling to other panels, but that left the side
  // panels (Today's Brief, Action Center, CompanyTree) stuck on annual numbers
  // while the heatmap showed the picked quarter/month. Now every `useMatrix()`
  // panel follows it. Seed from the `period` prop on mount / prop change; a user
  // chip click (setSelectedPeriod) overrides it thereafter.
  const selectedPeriod = useTerminalStore((s) => s.selectedPeriod);
  const setSelectedPeriod = useTerminalStore((s) => s.setSelectedPeriod);
  useEffect(() => {
    // Only seed the store when a period prop is actually supplied. In
    // production the HeatMap renders as `<HeatMap />` (no prop), so this is a
    // no-op and the store keeps its default (undefined = annual) until a chip
    // click; guarding on `!== undefined` also means a remount never clobbers a
    // user's chip selection back to annual.
    if (period !== undefined) setSelectedPeriod(period);
  }, [period, setSelectedPeriod]);
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
  // Client-feedback #5 (2026-06-01) — intuitive indicator (column) search,
  // separate from the company (row) `search` above. Local state: it's
  // Panel-2-only and doesn't need the cross-panel store bridge that the
  // `/`-row-filter uses.
  const [indicatorQuery, setIndicatorQuery] = useState('');
  const indicatorSearchInputRef = useRef<HTMLInputElement>(null);
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
  // Activity-aware progressive disclosure. The default is intentionally
  // session-local: every fresh terminal visit starts with the relevant KPI
  // set, while the user can reveal the complete catalogue on demand.
  const [showAllIndicators, setShowAllIndicators] = useState(false);

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

  // Phase 10 A5 — surface-level Legacy/Provisional posture.
  //
  // `requireLineage: true` + `requireReconciliation: true` are deliberate, and
  // the pair is what makes this stable.
  //
  // The reasoning here used to be "no IndicatorValue carries
  // `lastReconciledAt`, so requiring lineage is stable" — which stopped being
  // true twice over. Commit `a8c5b7fa` re-pointed the lineage rule at
  // `revisionId`, so this option no longer had anything to do with
  // reconciliation; then Stage B5 gave imports a writer, so `revisionId` is no
  // longer absent. Requiring lineage ALONE would therefore have certified
  // every freshly imported cell as decision-grade — never reconciled, never
  // coverage-checked, never methodology-approved — which is the exact claim
  // this badge exists to refuse.
  //
  // Reconciliation is the stable leg: 0 of 1,269 rows carry
  // `lastReconciledAt` (measured 2026-07-16 — only audit-company.cjs writes
  // it and it has never run over this data). So the verdict does not depend on
  // the clock, on which cells are loaded, or on whether an import ran, and the
  // badge states one true thing: nothing on this surface is reconciled,
  // therefore nothing on it is certified for a decision.
  //
  // Deliberately NOT applied per cell: with 498/498 coloured cells untraced,
  // per-cell demotion would grey the whole matrix — a cutover, not the
  // "smallest protective presentation" of handoff §11, and it would break
  // "keep the current Expert Matrix available" (§4). Cell colours are
  // untouched here; the claim about them is what changed.
  const provisionalSummary = useMemo(
    () =>
      summarizeSurfaceGrade(data?.cells ?? [], Date.now(), {
        requireLineage: true,
        requireReconciliation: true,
      }),
    [data],
  );

  /**
   * Phase 11.91 — how many cells on this matrix disagree with the client's own
   * statement.
   *
   * Counted over the SAME cells the grid draws, so the badge and the fuchsia
   * rings can never tell different stories. Unlike `provisionalSummary`, this
   * is per-cell as well as summarised: "provisional" is a property of the
   * evidence and applies to almost everything, while a mismatch is a specific
   * number being specifically wrong, and there are few enough of them to point
   * at individually.
   */
  const statementMismatchCount = useMemo(
    () => (data?.cells ?? []).filter(hasStatementMismatch).length,
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
    // 11.66 — a CONSTANT indicator must not enter a risk score.
    // `IND_GOV_CLIMATE_SCORE` has no inputs and a formula of literally `38`, so
    // it fed an immovable amber cell into every company's composite.
    // 11.71 — nor may the informational `governance` legal/compliance
    // indicators, by product directive: court cases and audit findings are real
    // and stay fully visible in this very grid, they simply are not terms in a
    // FINANCIAL score.
    //
    // Marking rather than filtering (11.71): the flag rides on the cell into
    // `computeCompositeScore`, which is the only place the rule is enforced. It
    // now covers Panel 3's badge, the AI subscriptions, both export buttons and
    // the alert engine — all of which computed a composite from the same
    // `data.cells` and none of which called the 11.66 filter, so this screen was
    // already showing two different numbers for one company. The matrix API
    // stamps the same flag server-side; re-stamping here is idempotent and
    // keeps the terminal correct against a payload from an older deploy.
    const scoringCells = markNonScoringCells(data.cells, data.indicators);
    const leafById = computeCompositeByCompany(scoringCells, undefined, riskTagsByCompanyId);
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
      // Exclude aggregate rollup cells (sub-group / holding parents carry a
      // worst-of-children status) — counting them double-counts the headline
      // G/A/R distribution against the leaf children they summarize.
      data.cells.filter(
        (c) =>
          !isAggregateRollup(c) &&
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
      // Skip aggregate rollup cells — a sub-group / holding parent carries a
      // worst-of-children status, so counting it inflates the [alerts N] badge
      // and marks the parent row as "alerted". Count leaf cells only.
      if (isAggregateRollup(c)) continue;
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
  // …) the row's own `industry` is null — derive the relevant set from its
  // descendants. With no active company, use the union of industries in the
  // currently visible holding scope. This closes the old full-holding gap
  // where activity filtering only worked after selecting one company.
  const visibleCompanyIds = useMemo(
    () => new Set(filteredCompanies.map((company) => company.id)),
    [filteredCompanies],
  );
  const activeCompanyId = useMemo(
    () =>
      activeCompanyCode && data
        ? data.companies.find((company) => company.code === activeCompanyCode)
            ?.id ?? null
        : null,
    [data, activeCompanyCode],
  );
  const scopeCompanyIds = useMemo(
    () =>
      new Set(
        data
          ? collectScopeCompanyIds(
              data.companies,
              visibleCompanyIds,
              activeCompanyId,
            )
          : [],
      ),
    [data, visibleCompanyIds, activeCompanyId],
  );
  const scopeCompanies = useMemo(
    () =>
      data?.companies.filter((company) => scopeCompanyIds.has(company.id)) ?? [],
    [data, scopeCompanyIds],
  );
  const applicabilityDecisionForPair = useMemo(
    () =>
      createApplicabilityDecisionResolver({
        companies: data?.companies ?? [],
        applicabilityOverrides: data?.applicabilityOverrides,
      }),
    [data?.companies, data?.applicabilityOverrides],
  );
  const isApplicablePair = useMemo(
    () =>
      (companyId: string, indicator: { id: string; industries?: string[] }) =>
        applicabilityDecisionForPair(companyId, indicator).applicable,
    [applicabilityDecisionForPair],
  );
  const activeCompanyIndustries = useMemo<readonly string[]>(() => {
    if (!data) return [];
    return collectScopeIndustries(
      data.companies,
      visibleCompanyIds,
      activeCompanyId,
    );
  }, [data, visibleCompanyIds, activeCompanyId]);
  // Back-compat single-industry alias used by materiality lookups. When
  // the active company resolves to exactly ONE industry (leaf op-co OR a
  // sub-group whose descendants share one industry, e.g. AAC = pure
  // industrial), the SASB materiality matrix lookup is unambiguous.
  // Mixed sub-groups skip materiality scoring (defaults to "material"
  // for every indicator — see enriched branch below).
  const activeCompanyIndustry =
    activeCompanyIndustries.length === 1 ? activeCompanyIndustries[0] : null;

  const rawIndicators = data?.indicators ?? [];
  const applicability = useMemo(
    () =>
      partitionIndicatorsByScope({
        indicators: rawIndicators,
        scopeCompanies,
        applicabilityOverrides: data?.applicabilityOverrides,
        // "Hide inapplicable" must actually hide sector KPIs that no visible
        // company can use. Without strict mode, a single partially-onboarded
        // company (industry == null) fails open onto every indicator, so the
        // toggle reported "· 0" and hid nothing across the full holding view.
        // Cell rendering keeps the fail-open contract (separate resolver
        // below), so this only tightens column inclusion.
        treatUnknownIndustryAsApplicable: false,
      }),
    [rawIndicators, scopeCompanies, data?.applicabilityOverrides],
  );

  // "Hide inapplicable" (ON by default) now also hides EMPTY indicators —
  // columns that have no real value on ANY currently-visible company. An
  // indicator that reads «нет данных» ("—") for every filtered company is
  // noise, so it drops out of the default view and only reappears under
  // "Show all". Keyed by indicatorId; scoped to `visibleCompanyIds` so the
  // set re-narrows with the row search / single-company drill-down.
  const hasDataById = useMemo(() => {
    const ids = new Set<string>();
    if (!data) return ids;
    for (const cell of data.cells) {
      if (!visibleCompanyIds.has(cell.companyId)) continue;
      if (DATA_BEARING_STATUSES.has(cell.status)) ids.add(cell.indicatorId);
    }
    return ids;
  }, [data, visibleCompanyIds]);

  const indicatorResolution = useMemo(() => {
    const rankMateriality = (rating: 'material' | 'low_materiality' | 'not_material'): number => {
      if (rating === 'material') return 0;
      if (rating === 'low_materiality') return 1;
      return 2; // not_material
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
     *                after explicit "Show all" disclosure)
     */
    const rankIndustrySpecificity = (ind: { industries?: string[] }): number => {
      const tags = ind.industries ?? [];
      if (tags.length === 0) return 1;
      return tags.some((t) => activeCompanyIndustries.includes(t)) ? 0 : 2;
    };
    const relevantIds = new Set(
      applicability.relevant.map((indicator) => indicator.id),
    );
    const enriched = rawIndicators.map((ind) => ({
      ind,
      rating:
        activeCompanyIndustry && isMaterialityScoped(ind.code)
          ? getMateriality(activeCompanyIndustry, ind.code)
          : ('material' as const),
    }));
    // Stable two-level sort: (materiality rating ASC) then (industry-
    // specificity ASC). Equal-rated equal-specificity rows fall back to
    // insertion order, which matches the seed `sortOrder` field.
    enriched.sort((a, b) => {
      const r = rankMateriality(a.rating) - rankMateriality(b.rating);
      if (r !== 0) return r;
      return rankIndustrySpecificity(a.ind) - rankIndustrySpecificity(b.ind);
    });
    // Applicability and materiality answer different questions. A
    // `not_material` KPI still belongs to the company's activity profile; the
    // cell renderer already dims it to 12% and removes the status colour so an
    // analyst can verify the deliberate de-emphasis. Hiding the whole column
    // here made it indistinguishable from an unrelated KPI and contradicted
    // the materiality contract in `esg-materiality.ts`.
    //
    // Two gates to survive the default view: the indicator must be applicable
    // to the current scope AND carry at least one real value among the visible
    // companies (`hasDataById`). A column that is «нет данных» everywhere adds
    // no signal, so — like a sector-inapplicable column — it collapses until
    // the user reveals the full catalogue via "Show all".
    const defaultVisible = enriched.filter(
      ({ ind }) => relevantIds.has(ind.id) && hasDataById.has(ind.id),
    );
    return (showAllIndicators ? enriched : defaultVisible).map(({ ind }) => ind);
  }, [
    activeCompanyIndustries,
    activeCompanyIndustry,
    applicability.relevant,
    hasDataById,
    rawIndicators,
    showAllIndicators,
  ]);
  const indicators = indicatorResolution;

  const displayIndicators = useMemo(() => {
    // An active indicator query narrows the current applicability view while
    // preserving the original column order.
    if (indicatorQuery.trim()) {
      return filterIndicatorsByQuery(indicatorQuery, indicators);
    }
    return indicators;
  }, [indicators, indicatorQuery]);

  // Disclosure count is based on what the current indicator search could
  // reveal, not on the full unsearched catalogue.
  const matchingRawIndicators = useMemo(
    () => filterIndicatorsByQuery(indicatorQuery, rawIndicators),
    [rawIndicators, indicatorQuery],
  );
  const hiddenIndicatorCount = showAllIndicators
    ? 0
    : Math.max(0, matchingRawIndicators.length - displayIndicators.length);

  return {
    t, locale, selectedPeriod, setSelectedPeriod, driftHealth, setCompany,
    activeCompanyCode, setActiveIv, setPendingMissingCell, setPendingRollupCell,
    setActivePanel, search, setSearch, clearSearch, setAlertsCount,
    setAlertedCompanyCodes, setAlertMatches, compactMode, scenarioDelta,
    activeScenarioLabel, clearScenarioDelta, lockedPeriods, setLockedPeriods,
    showAllIndicators, setShowAllIndicators, data,
    loading, error, refetchMatrix, companyTree, searchInputRef, mounted,
    setMounted, dbSummary, setDbSummary, activePeriod, alertThresholds,
    setAlertThresholds, refetchTimerRef, cellMap, compositeByCompany,
    provisionalSummary,
    statementMismatchCount,
    filteredCompanies, summary, activeCompanyIndustries, activeCompanyIndustry,
    rawIndicators, indicators, displayIndicators,
    isApplicablePair, applicabilityDecisionForPair,
    hiddenIndicatorCount, indicatorQuery, setIndicatorQuery,
    indicatorSearchInputRef,
  };
}
