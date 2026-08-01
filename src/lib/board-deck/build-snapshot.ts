/**
 * Phase 7.E C3 v2 — shared snapshot assembly for board-deck surfaces.
 *
 * Single source of truth for what the board-deck shows: org metadata,
 * operational sub-cos, indicators, raw HeatMap cells, composite scores,
 * status counts, and alert matches. Both the server-rendered page
 * (`/budgeting/board-deck`) and the PPTX export route
 * (`/api/budgeting/board-deck/export-pptx`) consume this helper so the
 * two surfaces stay byte-for-byte identical for the same `(orgId,
 * period)` input. Without the shared helper the route would need to
 * duplicate ~150 lines of Prisma + composite + alert assembly — drift
 * between page and PPTX would silently accumulate.
 *
 * Returns `null` when the org row is missing (caller decides whether to
 * 404 or redirect). Otherwise returns the full snapshot. Period is NOT
 * validated here — callers must run `parsePeriod()` before invoking.
 */

import { prisma } from '@/lib/prisma';
import { filterOperationalCompanies, isRollupIndicator } from '@/lib/risk/targets';
import {
  computeCompositeByCompany,
  type CompositeScore,
} from '@/lib/risk/composite-score';
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
  type AlertMatch,
  type AlertSeverity,
} from '@/lib/risk/alert-rules';
import { readAlertThresholdsFromOrgSettings } from '@/lib/risk/alert-thresholds-config';
import {
  isAggregateRollup,
  type HeatMapCell,
} from '@/lib/risk/heatmap-matrix';
import { RISK_TAGS } from '@/lib/risk/risk-tags';
import { nonScoringIndicatorIds } from '@/lib/risk/indicator-provenance';

const CANONICAL_RISK_TAGS = new Set<string>(RISK_TAGS);

export interface BoardSnapshotOrg {
  name: string;
  slug: string;
  settings: unknown;
}

export interface BoardSnapshotCompany {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  level: number;
  isActive: boolean;
  role: string | null;
  sortOrder: number | null;
}

export interface BoardSnapshotIndicator {
  id: string;
  code: string;
  nameEn: string;
  direction: string | null;
  unit: string | null;
  sortOrder: number | null;
  weight: number | null;
}

export interface BoardSnapshotStatusCounts {
  green: number;
  amber: number;
  red: number;
  unknown: number;
}

export interface BoardSnapshotTotals {
  operational: number;
  indicators: number;
  cells: number;
  green: number;
  amber: number;
  red: number;
}

export interface BoardSnapshot {
  org: BoardSnapshotOrg;
  period: string;
  generatedAt: string;
  operational: BoardSnapshotCompany[];
  indicators: BoardSnapshotIndicator[];
  cells: HeatMapCell[];
  compositeByCompany: Map<string, CompositeScore>;
  countsByCompany: Map<string, BoardSnapshotStatusCounts>;
  matches: AlertMatch[];
  matchesBySeverity: Record<AlertSeverity, AlertMatch[]>;
  idToCode: Map<string, string>;
  cellByKey: Map<string, HeatMapCell>;
  totals: BoardSnapshotTotals;
  /**
   * Phase 7.N wiring (2026-05-26) — per-company qualitative risk
   * flags from `Company.settings.riskTags`. Keyed by company id;
   * companies without any tags are absent from the map. Consumed by
   * the Board Deck "Qualitative Risk Flags" section + downstream
   * exports.
   */
  riskTagsByCompany: Map<string, readonly string[]>;
  /**
   * 11.71 — indicator ids excluded from composite arithmetic (constants, plus
   * the informational `governance` legal/compliance four). Already stamped onto
   * `cells` as `scoring: false`; exposed here for the ONE consumer that builds
   * its own cells from a separate query — `buildTrendSeries`, which reads raw
   * `IndicatorValue` rows by id and never sees a definition. Derived once here
   * so the deck page and the PPTX route cannot resolve it differently and put a
   * trend line under a hero score computed on a different rule.
   */
  nonScoringIndicatorIds: ReadonlySet<string>;
}

export async function buildBoardSnapshot(args: {
  orgId: string;
  period: string;
  /** Null/undefined = full org; array = caller's RBAC-visible companies. */
  companyIds?: readonly string[] | null;
}): Promise<BoardSnapshot | null> {
  const { orgId, period, companyIds } = args;

  const [org, companiesRaw, indicatorsRaw] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true, settings: true },
    }),
    prisma.company.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        ...(companyIds != null ? { id: { in: [...companyIds] } } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
        sortOrder: true,
        // Phase 7.N wiring (2026-05-26) — settings holds qualitative
        // `riskTags` that drive composite-score penalty + a new
        // Board Deck "Qualitative Risk Flags" section.
        settings: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId: orgId }],
      },
      select: {
        id: true,
        code: true,
        nameEn: true,
        direction: true,
        unit: true,
        // Phase 8 fix: needed so the Board Deck composite is WEIGHTED,
        // identical to the Risk Terminal (see cells.map below).
        weight: true,
        // Phase 8 fix: category + requiredInputs drive the same
        // internal-category filter the matrix endpoint applies, so the deck
        // composites over the SAME indicator set as the terminal.
        category: true,
        requiredInputs: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  if (!org) return null;

  // Phase 8 fix: mirror the matrix endpoint's render filter — drop
  // internal-category indicators UNLESS rollup-bearing. Without it the deck
  // composited over a superset (e.g. IND_REVENUE_TOTAL, an internal revenue
  // *level*), so its scores ran ~2 pts above the terminal for the same
  // company. Now both surfaces use the identical cell set.
  const indicators = indicatorsRaw.filter(
    (i) => i.category !== 'internal' || isRollupIndicator(i),
  );

  type CompanyRawShape = (typeof companiesRaw)[number];
  type IndicatorShape = (typeof indicators)[number];
  const operational =
    filterOperationalCompanies<CompanyRawShape>(companiesRaw);
  const operationalIds = operational.map((c) => c.id);
  const indicatorIds = indicators.map((i: IndicatorShape) => i.id);

  const values =
    operationalIds.length === 0 || indicatorIds.length === 0
      ? []
      : await prisma.indicatorValue.findMany({
          where: {
            organizationId: orgId,
            period,
            companyId: { in: operationalIds },
            indicatorId: { in: indicatorIds },
          },
          select: {
            companyId: true,
            indicatorId: true,
            value: true,
            status: true,
          },
        });

  type ValueShape = {
    companyId: string;
    indicatorId: string;
    value: number | null;
    status: string;
  };
  // Phase 8 fix: carry each indicator's weight onto its cells so the Board
  // Deck composite is WEIGHTED — identical to the Risk Terminal. Without it,
  // computeCompositeScore defaulted every weight to 1.0 (unweighted), so the
  // deck reported different composite scores than the terminal for the same
  // company (e.g. HORIZON 25 unweighted vs 21 weighted).
  const weightById = new Map<string, number>(
    indicators.map((i: IndicatorShape) => [i.id, i.weight ?? 1.0]),
  );
  // 11.71 — same scoring gate the matrix endpoint stamps, applied here because
  // the deck builds its own cells from its own query. `indicators` carries
  // `category` + `requiredInputs` (selected above), so the rule is available
  // without a query change. Without this the deck's hero score, the PPTX cover,
  // the LLM narration and the fact-checker would all keep averaging court cases
  // into a financial number while the terminal no longer does — one company,
  // two scores, which is the failure mode this whole mechanism exists to avoid.
  const nonScoringIds = nonScoringIndicatorIds(indicators);
  const cells: HeatMapCell[] = values.map((v: ValueShape) => ({
    companyId: v.companyId,
    indicatorId: v.indicatorId,
    value: v.value as number,
    status: v.status as HeatMapCell['status'],
    weight: weightById.get(v.indicatorId) ?? 1.0,
    ...(nonScoringIds.has(v.indicatorId) ? { scoring: false } : {}),
  }));

  // Phase 7.N wiring — extract per-company riskTags from settings JSON
  // so the composite-score helper can apply per-tag penalty and the
  // snapshot can expose them to UI / PPTX consumers.
  const riskTagsByCompanyId = new Map<string, readonly string[]>();
  for (const co of operational) {
    const raw = (co as { settings?: { riskTags?: unknown } | null }).settings
      ?.riskTags;
    if (Array.isArray(raw)) {
      // Legacy or misspelled values carry no configured score penalty and
      // have no localized disclosure. Exclude them at the shared snapshot
      // boundary so page, narrative and PPTX cannot disagree.
      const tags = raw.filter(
        (t): t is string =>
          typeof t === 'string' && CANONICAL_RISK_TAGS.has(t),
      );
      if (tags.length > 0) riskTagsByCompanyId.set(co.id, tags);
    }
  }

  const compositeByCompany = computeCompositeByCompany(
    cells,
    operationalIds,
    riskTagsByCompanyId,
  );

  const countsByCompany = new Map<string, BoardSnapshotStatusCounts>();
  for (const co of operational) {
    countsByCompany.set(co.id, { green: 0, amber: 0, red: 0, unknown: 0 });
  }
  for (const c of cells) {
    if (isAggregateRollup(c)) continue;
    const counts = countsByCompany.get(c.companyId);
    if (counts) counts[c.status] += 1;
  }

  const alertThresholds = readAlertThresholdsFromOrgSettings(org.settings);
  const matches = evaluateAlertRules(
    DEFAULT_ALERT_RULES,
    {
      companies: operational.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        industry: c.industry,
      })),
      indicators: indicators.map((i: IndicatorShape) => ({
        id: i.id,
        code: i.code,
      })),
      cells,
    },
    alertThresholds,
  );
  const matchesBySeverity: Record<AlertSeverity, AlertMatch[]> = {
    critical: [],
    warning: [],
    info: [],
  };
  for (const m of matches) matchesBySeverity[m.severity].push(m);

  const cellByKey = new Map<string, HeatMapCell>();
  for (const c of cells) cellByKey.set(`${c.companyId}|${c.indicatorId}`, c);

  const idToCode = new Map(operational.map((c) => [c.id, c.code]));

  const totals: BoardSnapshotTotals = {
    operational: operational.length,
    indicators: indicators.length,
    cells: operational.length * indicators.length,
    green: 0,
    amber: 0,
    red: 0,
  };
  for (const counts of countsByCompany.values()) {
    totals.green += counts.green;
    totals.amber += counts.amber;
    totals.red += counts.red;
  }

  return {
    org: {
      name: org.name,
      slug: org.slug,
      settings: org.settings,
    },
    period,
    generatedAt: new Date().toISOString(),
    operational: operational as BoardSnapshotCompany[],
    indicators: indicators as BoardSnapshotIndicator[],
    cells,
    compositeByCompany,
    countsByCompany,
    matches,
    matchesBySeverity,
    idToCode,
    cellByKey,
    totals,
    riskTagsByCompany: riskTagsByCompanyId,
    nonScoringIndicatorIds: nonScoringIds,
  };
}
