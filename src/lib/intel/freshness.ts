/**
 * Financial-truth-infra Phase D.2 — reference-data freshness checker.
 *
 * For each external feed (weather, commodity, FX), query the most-recent
 * IntelDataPoint fetchedAt and decide if the source is fresh / stale /
 * critical-stale. Indicators driven by stale sources are flagged in the
 * UI so users don't trust numbers based on outdated context.
 *
 * Thresholds (hours):
 *   - daily feeds (weather, FX): fresh < 36h, stale 36-72h, critical > 72h
 *   - monthly feeds (commodity Pink Sheet, CPI): fresh < 45d, stale 45-60d, critical > 60d
 *
 * Pure function — no UI, no side effects. Both the admin drift dashboard
 * and the per-indicator panel consume the same checker.
 */

import type { PrismaClient } from "@prisma/client";

export type FreshnessStatus = "fresh" | "stale" | "critical_stale" | "missing";

export interface SourceFreshness {
  sourceCode: string;
  /** Cadence used to pick thresholds. */
  cadence: "daily" | "monthly";
  /** Hours since the last fetch (null when no rows). */
  ageHours: number | null;
  /** Threshold values applied to derive the verdict. */
  thresholds: { staleHours: number; criticalHours: number };
  status: FreshnessStatus;
  /** Most recent fetchedAt as ISO string, or null. */
  lastFetchedAt: string | null;
  /** Count of distinct metrics this source has emitted. */
  metricCount: number;
}

const DEFAULT_SOURCES: Array<{ sourceCode: string; cadence: "daily" | "monthly" }> = [
  // Phase 7.E #1 commodity / FX adapters.
  { sourceCode: "tcmb-fx-rates", cadence: "daily" },
  { sourceCode: "worldbank-cpi", cadence: "monthly" },
  { sourceCode: "commodities-rss-brent", cadence: "daily" },
  // Phase 7.I sector-aware sources.
  { sourceCode: "weather-openmeteo", cadence: "daily" },
  { sourceCode: "worldbank-sugar", cadence: "monthly" },
];

const THRESHOLDS = {
  daily: { staleHours: 36, criticalHours: 72 },
  monthly: { staleHours: 45 * 24, criticalHours: 60 * 24 },
};

function classify(ageHours: number | null, cadence: "daily" | "monthly"): FreshnessStatus {
  if (ageHours === null) return "missing";
  const { staleHours, criticalHours } = THRESHOLDS[cadence];
  if (ageHours > criticalHours) return "critical_stale";
  if (ageHours > staleHours) return "stale";
  return "fresh";
}

export async function checkReferenceFreshness(
  prisma: PrismaClient,
  orgId: string,
  sources: Array<{ sourceCode: string; cadence: "daily" | "monthly" }> = DEFAULT_SOURCES,
): Promise<SourceFreshness[]> {
  const now = Date.now();
  const out: SourceFreshness[] = [];
  for (const { sourceCode, cadence } of sources) {
    const latest = await prisma.intelDataPoint.findFirst({
      where: { organizationId: orgId, sourceCode },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    });
    const metricCount = await prisma.intelDataPoint.groupBy({
      by: ["metric"],
      where: { organizationId: orgId, sourceCode },
      _count: { _all: true },
    }).then((rows) => rows.length).catch(() => 0);
    const ageHours = latest ? (now - latest.fetchedAt.getTime()) / (1000 * 60 * 60) : null;
    const status = classify(ageHours, cadence);
    out.push({
      sourceCode,
      cadence,
      ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
      thresholds: THRESHOLDS[cadence],
      status,
      lastFetchedAt: latest?.fetchedAt.toISOString() ?? null,
      metricCount,
    });
  }
  return out;
}
