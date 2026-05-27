/**
 * 2026-05-27 — Per-entity indicator readiness backlog.
 *
 * For each operational entity, list every indicator that IS applicable
 * to its industry but currently has `status = "unknown"` (no data
 * resolved). Each backlog item carries:
 *   - indicator code + name + category + unit
 *   - requiredInputs (what data sources the formula needs)
 *   - resolved owner (role + name + email + scope, via owner-map)
 *   - "how to fix" hint with deep-link to /admin/ai-import
 *
 * Used by:
 *   - /budgeting/admin/indicator-backlog page
 *   - Companies Readiness «Missing» column
 *   - AI Auto Import post-success «Closed N items» banner (diff)
 *
 * Pure async helper — takes orgId + optional companyId filter, queries
 * Prisma directly. No HTTP, no React.
 */

import type { PrismaClient } from "@prisma/client";
import {
  resolveOwner,
  readOrgOwnerOverrides,
  type OwnerContact,
} from "@/lib/onboarding/indicator-owner-map";

export interface BacklogItem {
  indicatorCode: string;
  indicatorNameEn: string;
  indicatorNameRu: string | null;
  indicatorNameAz: string | null;
  category: string;
  unit: string;
  direction: string;
  /** Primary requiredInput that drives the owner lookup. */
  requiredInput: string;
  /** All requiredInputs the formula needs. */
  allRequiredInputs: string[];
  owner: OwnerContact;
  /** "operationalFact" / "counterparty" / "budgetLine" / etc. */
  inputCategory: string;
}

export interface PresentItem {
  indicatorCode: string;
  indicatorNameEn: string;
  indicatorNameRu: string | null;
  indicatorNameAz: string | null;
  category: string;
  unit: string;
  /** Current IndicatorValue.status — "green" | "amber" | "red". */
  status: "green" | "amber" | "red";
}

export interface CompanyBacklog {
  companyId: string;
  companyCode: string;
  companyName: string;
  industry: string | null;
  /** Total applicable indicators for this industry. */
  applicableCount: number;
  /** Indicators currently with status=unknown (missing data). */
  missingCount: number;
  /** Indicators with green/amber/red status (have data). */
  presentCount: number;
  /** Readiness % = present / applicable. */
  readinessPct: number;
  /** Per-indicator backlog details (missing items). */
  items: BacklogItem[];
  /** Per-indicator items that have data (status green/amber/red). */
  presentItems: PresentItem[];
}

export interface BacklogSummary {
  totalEntities: number;
  totalApplicable: number;
  totalMissing: number;
  totalPresent: number;
  overallReadinessPct: number;
  /** Per-owner-role count of missing items across all entities. */
  byOwnerRole: Array<{ role: string; missingCount: number }>;
  /** Per-indicator-category count of missing items. */
  byCategory: Array<{ category: string; missingCount: number }>;
}

/** Compute backlog for one or all companies in an organization.
 *  When companyCode is set, returns just that one (used for entity
 *  drill-down). Otherwise returns all level-2 operational entities. */
export async function computeIndicatorBacklog(
  prisma: PrismaClient,
  orgId: string,
  options?: { companyCode?: string; period?: string },
): Promise<{ companies: CompanyBacklog[]; summary: BacklogSummary }> {
  const period = options?.period ?? "2026";

  // Load org settings for owner overrides
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { settings: true },
  });
  const orgOverrides = readOrgOwnerOverrides(org?.settings);

  // Load entities (level 2 operational, filtered by code if specified)
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      level: 2,
      ...(options?.companyCode ? { code: options.companyCode } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      industry: true,
    },
    orderBy: { code: "asc" },
  });

  // Load all active indicators + their requiredInputs + names
  const allIndicators = await prisma.indicatorDefinition.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameRu: true,
      nameAz: true,
      category: true,
      unit: true,
      direction: true,
      industries: true,
      requiredInputs: true,
    },
  });

  // Load IndicatorValues for these entities × this period in one batch
  const companyIds = companies.map((c) => c.id);
  const allIVs =
    companyIds.length === 0
      ? []
      : await prisma.indicatorValue.findMany({
          where: {
            organizationId: orgId,
            period,
            companyId: { in: companyIds },
          },
          select: {
            companyId: true,
            indicatorId: true,
            status: true,
          },
        });
  // Index: (companyId × indicatorId) → status
  const ivByKey = new Map<string, string>();
  for (const iv of allIVs) {
    ivByKey.set(`${iv.companyId}|${iv.indicatorId}`, iv.status);
  }

  // Build per-entity backlogs
  const result: CompanyBacklog[] = [];
  for (const co of companies) {
    if (!co.industry) {
      // No industry set → can't determine applicable indicators
      result.push({
        companyId: co.id,
        companyCode: co.code,
        companyName: co.name,
        industry: null,
        applicableCount: 0,
        missingCount: 0,
        presentCount: 0,
        readinessPct: 0,
        items: [],
        presentItems: [],
      });
      continue;
    }
    // Filter to indicators applicable to this industry
    const applicable = allIndicators.filter((ind) =>
      ind.industries.includes(co.industry as string),
    );
    let presentCount = 0;
    let missingCount = 0;
    const items: BacklogItem[] = [];
    const presentItems: PresentItem[] = [];
    for (const ind of applicable) {
      const status = ivByKey.get(`${co.id}|${ind.id}`);
      if (status && status !== "unknown") {
        presentCount++;
        presentItems.push({
          indicatorCode: ind.code,
          indicatorNameEn: ind.nameEn,
          indicatorNameRu: ind.nameRu,
          indicatorNameAz: ind.nameAz,
          category: ind.category,
          unit: ind.unit,
          status: status as "green" | "amber" | "red",
        });
      } else {
        missingCount++;
        // Pick primary requiredInput (first non-system one)
        const primaryInput =
          ind.requiredInputs.find(
            (i) =>
              !i.startsWith("commodityPrice") &&
              !i.startsWith("currencyRate") &&
              !i.startsWith("weather") &&
              !i.startsWith("industryFactor"),
          ) ??
          ind.requiredInputs[0] ??
          "unknown";
        const owner = resolveOwner(primaryInput, orgOverrides);
        const colonIdx = primaryInput.indexOf(":");
        const inputCategory =
          colonIdx > 0 ? primaryInput.slice(0, colonIdx) : primaryInput;
        items.push({
          indicatorCode: ind.code,
          indicatorNameEn: ind.nameEn,
          indicatorNameRu: ind.nameRu,
          indicatorNameAz: ind.nameAz,
          category: ind.category,
          unit: ind.unit,
          direction: ind.direction,
          requiredInput: primaryInput,
          allRequiredInputs: ind.requiredInputs,
          owner,
          inputCategory,
        });
      }
    }
    result.push({
      companyId: co.id,
      companyCode: co.code,
      companyName: co.name,
      industry: co.industry,
      applicableCount: applicable.length,
      missingCount,
      presentCount,
      readinessPct:
        applicable.length > 0
          ? Math.round((presentCount / applicable.length) * 100)
          : 0,
      items: items.sort((a, b) => a.indicatorCode.localeCompare(b.indicatorCode)),
      presentItems: presentItems.sort(
        (a, b) => a.indicatorCode.localeCompare(b.indicatorCode),
      ),
    });
  }

  // Compute summary aggregates
  const totalApplicable = result.reduce((s, r) => s + r.applicableCount, 0);
  const totalMissing = result.reduce((s, r) => s + r.missingCount, 0);
  const totalPresent = result.reduce((s, r) => s + r.presentCount, 0);

  // Per-owner role counts
  const byRoleMap = new Map<string, number>();
  for (const co of result) {
    for (const item of co.items) {
      byRoleMap.set(item.owner.role, (byRoleMap.get(item.owner.role) ?? 0) + 1);
    }
  }
  const byOwnerRole = [...byRoleMap.entries()]
    .map(([role, missingCount]) => ({ role, missingCount }))
    .sort((a, b) => b.missingCount - a.missingCount);

  // Per-category counts
  const byCategoryMap = new Map<string, number>();
  for (const co of result) {
    for (const item of co.items) {
      byCategoryMap.set(
        item.category,
        (byCategoryMap.get(item.category) ?? 0) + 1,
      );
    }
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, missingCount]) => ({ category, missingCount }))
    .sort((a, b) => b.missingCount - a.missingCount);

  const summary: BacklogSummary = {
    totalEntities: result.length,
    totalApplicable,
    totalMissing,
    totalPresent,
    overallReadinessPct:
      totalApplicable > 0
        ? Math.round((totalPresent / totalApplicable) * 100)
        : 0,
    byOwnerRole,
    byCategory,
  };

  return { companies: result, summary };
}

/** Diff helper: given backlog snapshots before/after an import,
 *  returns the indicators that moved from `unknown` → present.
 *  Used by AI Auto Import post-success banner. */
export function diffBacklogs(
  before: CompanyBacklog[],
  after: CompanyBacklog[],
): Array<{ companyCode: string; indicatorCode: string }> {
  const beforeKeys = new Set<string>();
  for (const co of before) {
    for (const item of co.items) {
      beforeKeys.add(`${co.companyCode}|${item.indicatorCode}`);
    }
  }
  // afterKeys = current backlog (missing). If key was in before but
  // NOT in after, it means the indicator moved from missing → present.
  const afterKeys = new Set<string>();
  for (const co of after) {
    for (const item of co.items) {
      afterKeys.add(`${co.companyCode}|${item.indicatorCode}`);
    }
  }
  const closed: Array<{ companyCode: string; indicatorCode: string }> = [];
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      const [companyCode, indicatorCode] = key.split("|");
      closed.push({ companyCode, indicatorCode });
    }
  }
  return closed.sort(
    (a, b) =>
      a.companyCode.localeCompare(b.companyCode) ||
      a.indicatorCode.localeCompare(b.indicatorCode),
  );
}
