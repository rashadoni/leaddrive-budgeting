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

export type FreshnessSource = { sourceCode: string; cadence: "daily" | "monthly" };

export const DEFAULT_SOURCES: ReadonlyArray<FreshnessSource> = [
  // Phase 7.E #1 commodity / FX adapters.
  { sourceCode: "tcmb-fx-rates", cadence: "daily" },
  { sourceCode: "worldbank-cpi", cadence: "monthly" },
  { sourceCode: "commodities-rss-brent", cadence: "daily" },
  // Phase 7.I sector-aware sources.
  { sourceCode: "weather-openmeteo", cadence: "daily" },
  { sourceCode: "worldbank-sugar", cadence: "monthly" },
];

/**
 * L3 closure 2026-05-16 — resolve the source list to monitor.
 *
 * Reads `Organization.settings.intelFreshnessSources` (a JSON array of
 * `{sourceCode, cadence}` objects). When the array is present + valid,
 * it replaces DEFAULT_SOURCES so adding a new adapter no longer requires
 * a code change: paste the new source into the org settings (or the
 * source-registry admin page when L4 lands a freshness editor) and the
 * dashboard picks it up on the next request.
 *
 * Validation is strict: the entire override is dropped if any entry is
 * malformed. Invalid configs print a single console.warn so the admin
 * sees it in the server log without dropping the page render.
 */
function isValidSourceShape(v: unknown): v is FreshnessSource {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.sourceCode === "string" &&
    obj.sourceCode.length > 0 &&
    (obj.cadence === "daily" || obj.cadence === "monthly")
  );
}

export async function resolveFreshnessSources(
  prisma: PrismaClient,
  orgId: string,
): Promise<ReadonlyArray<FreshnessSource>> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const settings = (org?.settings ?? null) as Record<string, unknown> | null;
  const override = settings?.intelFreshnessSources;
  if (!Array.isArray(override) || override.length === 0) return DEFAULT_SOURCES;
  const allValid = override.every(isValidSourceShape);
  if (!allValid) {
    console.warn(
      `[freshness] organization.settings.intelFreshnessSources has invalid entry(s) — ignoring override, falling back to DEFAULT_SOURCES`,
    );
    return DEFAULT_SOURCES;
  }
  return override as FreshnessSource[];
}

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
  sources: ReadonlyArray<FreshnessSource> = DEFAULT_SOURCES,
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
