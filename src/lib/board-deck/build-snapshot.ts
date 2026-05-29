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
import { filterOperationalCompanies } from '@/lib/risk/targets';
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
}

export async function buildBoardSnapshot(args: {
  orgId: string;
  period: string;
}): Promise<BoardSnapshot | null> {
  const { orgId, period } = args;

  const [org, companiesRaw, indicators] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true, settings: true },
    }),
    prisma.company.findMany({
      where: { organizationId: orgId, isActive: true },
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
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  if (!org) return null;

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
  const cells: HeatMapCell[] = values.map((v: ValueShape) => ({
    companyId: v.companyId,
    indicatorId: v.indicatorId,
    value: v.value as number,
    status: v.status as HeatMapCell['status'],
  }));

  // Phase 7.N wiring — extract per-company riskTags from settings JSON
  // so the composite-score helper can apply per-tag penalty and the
  // snapshot can expose them to UI / PPTX consumers.
  const riskTagsByCompanyId = new Map<string, readonly string[]>();
  for (const co of operational) {
    const raw = (co as { settings?: { riskTags?: unknown } | null }).settings
      ?.riskTags;
    if (Array.isArray(raw)) {
      const tags = raw.filter((t): t is string => typeof t === 'string');
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
  };
}
