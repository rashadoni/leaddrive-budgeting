/**
 * Financial-truth-infra Phase C.1 — onboarding completeness checker.
 *
 * Auto-derives a per-company completion score from the actual DB state.
 * For each section in docs/ONBOARDING_DATA_REQUIREMENTS.md, runs a tiny
 * Prisma query (count or exists) and returns one of:
 *   - 'missing'  : zero rows / fields exist
 *   - 'partial'  : some rows / fields present but checklist not fully met
 *   - 'complete' : satisfies the section's "loaded" definition
 *   - 'n/a'      : section doesn't apply (e.g. agro KPIs for industrial co)
 *
 * Pure function — no UI, no side effects. Both the API route and a
 * nightly drift watchdog (Phase D) consume the same checker. Persisting
 * results to a DB column is deferred until users say "I checked off §3
 * manually, don't auto-recheck it" — for now we ALWAYS re-derive from
 * live data, so the checker is always honest about current state even
 * after a re-import.
 */

import type { PrismaClient } from "@prisma/client";

export type SectionStatus = "missing" | "partial" | "complete" | "n_a";

export interface SectionResult {
  /** Section code from docs/ONBOARDING_DATA_REQUIREMENTS.md (e.g. "§2"). */
  code: string;
  /** Human-readable label. */
  label: string;
  status: SectionStatus;
  /** Count of rows / records found (renders as "12 lines" / "0 rows"). */
  rowCount: number;
  /** Free-text hint: how to satisfy this section. */
  hint: string;
  /** True when this section gates other sections (P&L → ratio indicators). */
  blocking: boolean;
}

export interface CompletenessReport {
  companyId: string;
  companyCode: string;
  companyIndustry: string | null;
  /** Period the checker was run against (e.g. "2026" or "2026-04"). */
  period: string;
  /** Overall % complete (excludes n_a sections from the denominator). */
  percentComplete: number;
  /** Aggregate verdict matching the trust-badge taxonomy. */
  overall: "verified" | "partial" | "pending";
  sections: SectionResult[];
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
}

const COMPLETE: Omit<SectionResult, "rowCount"> & { rowCount?: never } = {
  code: "",
  label: "",
  status: "complete",
  hint: "",
  blocking: false,
};

/**
 * Run the full completeness check for one company at one period.
 * Period format mirrors IndicatorValue.period — "YYYY" / "YYYY-MM".
 *
 * Industry-specific sections are returned as `n_a` when they don't
 * apply (e.g. AGRO_YIELD for an industrial sub-co). They DON'T drag
 * the percentage down.
 */
export async function checkOnboardingCompleteness(
  prisma: PrismaClient,
  companyId: string,
  period: string = "2026",
): Promise<CompletenessReport> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, code: true, industry: true, settings: true, organizationId: true },
  });
  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }
  const orgId = company.organizationId;
  const yearFromPeriod = Number(period.split("-")[0]);

  // ── §1 Chart of Accounts ────────────────────────────────────────────
  const coaCount = await prisma.chartOfAccount.count({
    where: { organizationId: orgId, isActive: true },
  });

  // ── §2 P&L (BudgetLine revenue rows) ────────────────────────────────
  const revenueLineCount = await prisma.budgetLine.count({
    where: {
      organizationId: orgId,
      companyId,
      lineType: "revenue",
      plan: { is: { year: yearFromPeriod } },
    },
  });
  const cogsLineCount = await prisma.budgetLine.count({
    where: {
      organizationId: orgId,
      companyId,
      lineType: "cogs",
      plan: { is: { year: yearFromPeriod } },
    },
  });
  const expenseLineCount = await prisma.budgetLine.count({
    where: {
      organizationId: orgId,
      companyId,
      lineType: "expense",
      plan: { is: { year: yearFromPeriod } },
    },
  });

  // Step 1: find every plan that owns at least one BudgetLine for this
  // company. SalesBudgetLine / COGSBudgetLine / BalanceSheetLine /
  // BudgetAssumption are scoped to BudgetPlan, not Company — to derive
  // "is sales budget loaded for THIS company?" we look at plans that
  // already carry this company's P&L rows, and count plan-level rows in
  // those plans. Coarse but actionable: in practice every plan in this
  // org belongs to one logical holding (AZMADE plan ≠ Azərşəkər plan).
  const planIdsForCompany = (
    await prisma.budgetLine.findMany({
      where: {
        organizationId: orgId,
        companyId,
        plan: { is: { year: yearFromPeriod } },
      },
      select: { planId: true },
      distinct: ["planId"],
    })
  ).map((r) => r.planId);

  const inPlans = planIdsForCompany.length > 0 ? { planId: { in: planIdsForCompany } } : null;

  // ── §3 Sales budget (plan-scoped) ───────────────────────────────────
  const salesBudgetCount = inPlans
    ? await prisma.salesBudgetLine.count({ where: { organizationId: orgId, ...inPlans } })
    : 0;

  // ── §4 COGS budget (plan-scoped) ────────────────────────────────────
  const cogsBudgetCount = inPlans
    ? await prisma.cOGSBudgetLine.count({ where: { organizationId: orgId, ...inPlans } })
    : 0;

  // ── §5 Balance Sheet (plan-scoped) ──────────────────────────────────
  const balanceSheetCount = inPlans
    ? await prisma.balanceSheetLine.count({ where: { organizationId: orgId, ...inPlans } })
    : 0;

  // ── §6 Cash Flow (org-scoped — CashFlowEntry has no plan/company FK) ─
  const cashFlowCount = await prisma.cashFlowEntry.count({
    where: { organizationId: orgId, year: yearFromPeriod },
  });

  // ── §7 Actuals (company-scoped — has explicit companyId per Turn 35) ─
  const actualsCount = await prisma.budgetActual.count({
    where: { organizationId: orgId, companyId, plan: { is: { year: yearFromPeriod } } },
  });

  // ── §8 Assumptions (plan-scoped) ────────────────────────────────────
  const assumptionsCount = inPlans
    ? await prisma.budgetAssumption.count({ where: { organizationId: orgId, ...inPlans } })
    : 0;

  // ── §R.0 ESG disclosures ────────────────────────────────────────────
  const esgIndicatorCodes = [
    "IND_CARBON_SCOPE_1",
    "IND_CARBON_SCOPE_2",
    "IND_CARBON_SCOPE_3",
    "IND_ESG_COMPOSITE",
  ];
  const esgCount = await prisma.indicatorValue.count({
    where: {
      organizationId: orgId,
      companyId,
      period,
      indicator: { code: { in: esgIndicatorCodes } },
    },
  });

  // ── §R.industry-specific ────────────────────────────────────────────
  // The settings JSON carries the industry-specific baseline (hectares /
  // totalRooms / processingCapacity etc.); presence is enough to mark
  // the section "complete" since it unlocks the per-industry indicators.
  const settings = (company.settings ?? {}) as Record<string, unknown>;
  const industrySpecific = industrySpecificSection(company.industry, settings);

  // ── Compose section results ─────────────────────────────────────────
  const sections: SectionResult[] = [
    {
      code: "§1",
      label: "Chart of Accounts",
      status: coaCount >= 20 ? "complete" : coaCount > 0 ? "partial" : "missing",
      rowCount: coaCount,
      hint:
        coaCount === 0
          ? "Import CoA template via /budgeting/onboarding"
          : coaCount < 20
            ? "CoA loaded but sparse — expected at least 20 accounts for a mid-sized P&L"
            : "OK",
      blocking: true,
    },
    {
      code: "§2",
      label: "P&L plan (BudgetLines)",
      status:
        revenueLineCount > 0 && cogsLineCount > 0
          ? "complete"
          : revenueLineCount > 0
            ? "partial"
            : "missing",
      rowCount: revenueLineCount + cogsLineCount + expenseLineCount,
      hint:
        revenueLineCount === 0
          ? "Import P&L budget xlsx — REVENUE/COGS/OPEX lines per month"
          : cogsLineCount === 0
            ? "Revenue loaded but no COGS classification — splits gross margin from 0"
            : "OK",
      blocking: true,
    },
    {
      code: "§3",
      label: "Sales budget (product × month)",
      status: salesBudgetCount > 0 ? "complete" : "missing",
      rowCount: salesBudgetCount,
      hint:
        salesBudgetCount === 0
          ? "Import SalesBudget xlsx via /budgeting/import (product/qty/price/month)"
          : "OK",
      blocking: false,
    },
    {
      code: "§4",
      label: "COGS detail (per-product cost)",
      status: cogsBudgetCount > 0 ? "complete" : "missing",
      rowCount: cogsBudgetCount,
      hint:
        cogsBudgetCount === 0
          ? "Import COGS budget xlsx (cost element × product × month)"
          : "OK",
      blocking: false,
    },
    {
      code: "§5",
      label: "Balance Sheet",
      status: balanceSheetCount > 0 ? "complete" : "missing",
      rowCount: balanceSheetCount,
      hint:
        balanceSheetCount === 0
          ? "Import Balance Sheet xlsx — assets/liabilities/equity, monthly"
          : "OK",
      blocking: false,
    },
    {
      code: "§6",
      label: "Cash Flow",
      status: cashFlowCount > 0 ? "complete" : "missing",
      rowCount: cashFlowCount,
      hint:
        cashFlowCount === 0
          ? "Import Cash Flow statement (operating/investing/financing)"
          : "OK",
      blocking: false,
    },
    {
      code: "§7",
      label: "Actuals (variance vs plan)",
      status: actualsCount > 0 ? "complete" : "missing",
      rowCount: actualsCount,
      hint:
        actualsCount === 0
          ? "Import GL extract of real bookings to unlock variance analysis"
          : "OK",
      blocking: false,
    },
    {
      code: "§8",
      label: "Assumptions (FX/inflation/tax)",
      status: assumptionsCount > 0 ? "complete" : "missing",
      rowCount: assumptionsCount,
      hint:
        assumptionsCount === 0
          ? "Set assumptions via /budgeting?tab=assumptions"
          : "OK",
      blocking: false,
    },
    {
      code: "§R.0",
      label: "ESG disclosures (Carbon Scope 1/2/3)",
      status: esgCount >= 3 ? "complete" : esgCount > 0 ? "partial" : "missing",
      rowCount: esgCount,
      hint:
        esgCount === 0
          ? "No ESG data — Scope 1/2 currently modelled from revenue (no disclosed value)"
          : esgCount < 3
            ? "Partial ESG disclosure — Scope 1/2 covered but Scope 3 still modelled"
            : "Disclosed Scope 1+2+3 + ESG composite",
      blocking: false,
    },
    industrySpecific,
  ];

  // ── Aggregate ───────────────────────────────────────────────────────
  const applicable = sections.filter((s) => s.status !== "n_a");
  const complete = applicable.filter((s) => s.status === "complete").length;
  const percentComplete =
    applicable.length === 0 ? 0 : Math.round((complete / applicable.length) * 100);
  const blockingMissing = sections.some((s) => s.blocking && s.status === "missing");
  const overall: CompletenessReport["overall"] = blockingMissing
    ? "pending"
    : percentComplete >= 80
      ? "verified"
      : "partial";

  return {
    companyId,
    companyCode: company.code,
    companyIndustry: company.industry,
    period,
    percentComplete,
    overall,
    sections,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Industry-specific section. Returns "n_a" when no industry baseline is
 * defined for this sector — those companies just don't have a sector
 * KPI panel in the terminal and the section is irrelevant.
 */
function industrySpecificSection(
  industry: string | null,
  settings: Record<string, unknown>,
): SectionResult {
  if (!industry) {
    return {
      code: "§0.6",
      label: "Industry classification",
      status: "missing",
      rowCount: 0,
      hint: "Set company.industry — gates every sector KPI",
      blocking: true,
    };
  }

  // Industries with required settings keys.
  const requirements: Record<
    string,
    { code: string; label: string; keys: string[]; hint: string }
  > = {
    agro_crops: {
      code: "§R.1",
      label: "Agro KPI baseline (hectares + region + crop)",
      keys: ["hectaresPlanted", "region", "cropType"],
      hint:
        "Set in /budgeting/admin/companies/<code>/settings — hectares + region + cropType",
    },
    food_processing: {
      code: "§R.2",
      label: "Food processing KPI baseline (capacity + extraction rate)",
      keys: ["processingCapacityTonsYr", "extractionRateTarget", "mainInputCommodity"],
      hint: "Set processing capacity + extraction rate target + main input commodity",
    },
    hospitality: {
      code: "§R.5",
      label: "Hospitality baseline (rooms + seasonality)",
      keys: ["totalRooms", "region"],
      hint: "Set totalRooms + region",
    },
    services: {
      code: "§R.3",
      label: "Services baseline (revenue concentration target)",
      keys: ["topCustomerHhiTarget"],
      hint: "Set HHI target for customer concentration (or default to industry mean)",
    },
    industrial: {
      code: "§R.4",
      label: "Industrial KPI baseline (capacity + BOM)",
      keys: ["productionCapacity", "topInputCommodities"],
      hint: "Set production capacity (units/month) + top-3 raw-material exposures",
    },
    real_estate: {
      code: "§R.6",
      label: "Real estate baseline (sqm + lease terms)",
      keys: ["totalSquareMeters", "averageLeaseMonths"],
      hint: "Set total sqm + average lease tenor",
    },
    pharma: {
      code: "§R.7",
      label: "Pharma baseline (inventory days + R&D)",
      keys: ["inventoryDaysCover", "rndIntensityTarget"],
      hint: "Set inventory days + R&D intensity target",
    },
    entertainment: {
      code: "§R.8",
      label: "Entertainment baseline (capacity + seasonality)",
      keys: ["seatingCapacity"],
      hint: "Set seating capacity + peak-season months",
    },
    education: {
      code: "§R.9",
      label: "Education baseline (enrollment capacity + tuition)",
      keys: ["enrollmentCapacity", "averageTuition"],
      hint: "Set enrollment capacity + average annual tuition",
    },
    poultry: {
      code: "§R.10",
      label: "Poultry baseline (FCR + mortality target)",
      keys: ["fcrTarget", "mortalityTarget"],
      hint: "Set Feed Conversion Ratio + mortality % target",
    },
  };

  const req = requirements[industry];
  if (!req) {
    return {
      code: `§R.${industry}`,
      label: `Industry baseline (${industry})`,
      status: "n_a",
      rowCount: 0,
      hint: "No sector-specific KPI baseline defined for this industry yet",
      blocking: false,
    };
  }

  const present = req.keys.filter(
    (k) => settings[k] !== undefined && settings[k] !== null && settings[k] !== "",
  ).length;
  const status: SectionStatus =
    present === req.keys.length
      ? "complete"
      : present > 0
        ? "partial"
        : "missing";
  return {
    code: req.code,
    label: req.label,
    status,
    rowCount: present,
    hint: status === "complete" ? "All required settings set" : req.hint,
    blocking: false,
  };
}
