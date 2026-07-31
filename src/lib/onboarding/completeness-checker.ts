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

// Stage 3 RLS — accept a TransactionClient so callers can run the checker inside a
// withOrgScope tx (a full PrismaClient is also assignable to this type). The checker
// only uses model delegates, never $transaction, so the narrower type is sufficient.
import type { Prisma } from "@prisma/client";

export type SectionStatus = "missing" | "partial" | "complete" | "n_a";

export interface SectionResult {
  /** Section code from docs/ONBOARDING_DATA_REQUIREMENTS.md (e.g. "§2"). */
  code: string;
  /**
   * Human-readable label, English. Kept as the wire/log/CLI form and as the
   * UI fallback; the dashboard renders `onboardingDashboard.sectionLabel.<labelKey>`
   * when that key exists so an AZ/RU operator doesn't read an English list.
   */
  label: string;
  /** i18n key suffix under `onboardingDashboard.sectionLabel.*`. */
  labelKey: string;
  /** ICU params for `labelKey` (only the generic industry fallback uses one). */
  labelParams?: Record<string, string>;
  status: SectionStatus;
  /** Count of rows / records found (renders as "12 lines" / "0 rows"). */
  rowCount: number;
  /** Free-text hint, English: how to satisfy this section. UI fallback. */
  hint: string;
  /** i18n key suffix under `onboardingDashboard.hint.*`. */
  hintKey: string;
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
  labelKey: "",
  status: "complete",
  hint: "",
  hintKey: "",
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
  prisma: Prisma.TransactionClient,
  companyId: string,
  period: string = "2026",
): Promise<CompletenessReport> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, code: true, industry: true, level: true, settings: true, organizationId: true },
  });
  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }
  const orgId = company.organizationId;
  const yearFromPeriod = Number(period.split("-")[0]);
  // Holding parents (level 0 = top org, level 1 = sub-group like AZMADE
  // or AZSEKER) are rollup-only — they don't carry their own P&L /
  // BalanceSheet / Cash Flow data. Their indicators come from
  // consolidating children. Sections that count company-scoped rows
  // (§2/§3/§4/§5/§6/§7) report `n_a` for parents instead of
  // `missing` — otherwise every holding sits at 20% PENDING forever.
  const isRollupOnly = company.level !== null && company.level < 2;

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
      deletedAt: null, // count LIVE lines only (2026-05-31 soft-delete audit)
    },
  });
  const cogsLineCount = await prisma.budgetLine.count({
    where: {
      organizationId: orgId,
      companyId,
      lineType: "cogs",
      plan: { is: { year: yearFromPeriod } },
      deletedAt: null,
    },
  });
  const expenseLineCount = await prisma.budgetLine.count({
    where: {
      organizationId: orgId,
      companyId,
      lineType: "expense",
      plan: { is: { year: yearFromPeriod } },
      deletedAt: null,
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
        deletedAt: null,
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
    ? await prisma.balanceSheetLine.count({ where: { organizationId: orgId, deletedAt: null, ...inPlans } })
    : 0;

  // ── §6 Cash Flow (org-scoped — CashFlowEntry has no plan/company FK) ─
  const cashFlowCount = await prisma.cashFlowEntry.count({
    where: { organizationId: orgId, year: yearFromPeriod, deletedAt: null },
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
      labelKey: "coa",
      status: coaCount >= 20 ? "complete" : coaCount > 0 ? "partial" : "missing",
      rowCount: coaCount,
      ...(coaCount === 0
        ? { hint: "Import CoA template via /budgeting/onboarding", hintKey: "coaMissing" }
        : coaCount < 20
          ? {
              hint: "CoA loaded but sparse — expected at least 20 accounts for a mid-sized P&L",
              hintKey: "coaSparse",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: true,
    },
    {
      code: "§2",
      label: "P&L plan (BudgetLines)",
      labelKey: "pnl",
      status: isRollupOnly
        ? "n_a"
        : revenueLineCount > 0 && cogsLineCount > 0
          ? "complete"
          : revenueLineCount > 0
            ? "partial"
            : "missing",
      rowCount: revenueLineCount + cogsLineCount + expenseLineCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — P&L is consolidated from children",
            hintKey: "pnlRollup",
          }
        : revenueLineCount === 0
          ? {
              hint: "Import P&L budget xlsx — REVENUE/COGS/OPEX lines per month",
              hintKey: "pnlMissing",
            }
          : cogsLineCount === 0
            ? {
                hint: "Revenue loaded but no COGS classification — splits gross margin from 0",
                hintKey: "pnlNoCogs",
              }
            : { hint: "OK", hintKey: "ok" }),
      blocking: !isRollupOnly,
    },
    {
      code: "§3",
      label: "Sales budget (product × month)",
      labelKey: "salesBudget",
      status: isRollupOnly ? "n_a" : salesBudgetCount > 0 ? "complete" : "missing",
      rowCount: salesBudgetCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — sales budgets live on operational children",
            hintKey: "salesRollup",
          }
        : salesBudgetCount === 0
          ? {
              hint: "Import SalesBudget xlsx via /budgeting/import (product/qty/price/month)",
              hintKey: "salesMissing",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: false,
    },
    {
      code: "§4",
      label: "COGS detail (per-product cost)",
      labelKey: "cogsDetail",
      status: isRollupOnly ? "n_a" : cogsBudgetCount > 0 ? "complete" : "missing",
      rowCount: cogsBudgetCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — COGS detail lives on operational children",
            hintKey: "cogsRollup",
          }
        : cogsBudgetCount === 0
          ? {
              hint: "Import COGS budget xlsx (cost element × product × month)",
              hintKey: "cogsMissing",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: false,
    },
    {
      code: "§5",
      label: "Balance Sheet",
      labelKey: "balanceSheet",
      status: isRollupOnly ? "n_a" : balanceSheetCount > 0 ? "complete" : "missing",
      rowCount: balanceSheetCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — Balance Sheet is consolidated from children",
            hintKey: "bsRollup",
          }
        : balanceSheetCount === 0
          ? {
              hint: "Import Balance Sheet xlsx — assets/liabilities/equity, monthly",
              hintKey: "bsMissing",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: false,
    },
    {
      code: "§6",
      label: "Cash Flow",
      labelKey: "cashFlow",
      status: isRollupOnly ? "n_a" : cashFlowCount > 0 ? "complete" : "missing",
      rowCount: cashFlowCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — Cash Flow is consolidated from children",
            hintKey: "cfRollup",
          }
        : cashFlowCount === 0
          ? {
              hint: "Import Cash Flow statement (operating/investing/financing)",
              hintKey: "cfMissing",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: false,
    },
    {
      code: "§7",
      label: "Actuals (variance vs plan)",
      labelKey: "actuals",
      status: isRollupOnly ? "n_a" : actualsCount > 0 ? "complete" : "missing",
      rowCount: actualsCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — actuals are tracked on operational children",
            hintKey: "actualsRollup",
          }
        : actualsCount === 0
          ? {
              hint: "Import GL extract of real bookings to unlock variance analysis",
              hintKey: "actualsMissing",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: false,
    },
    {
      code: "§8",
      label: "Assumptions (FX/inflation/tax)",
      labelKey: "assumptions",
      status: isRollupOnly ? "n_a" : assumptionsCount > 0 ? "complete" : "missing",
      rowCount: assumptionsCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — assumptions are plan-scoped (held on children's plans)",
            hintKey: "assumptionsRollup",
          }
        : assumptionsCount === 0
          ? {
              hint: "Set assumptions via /budgeting?tab=assumptions",
              hintKey: "assumptionsMissing",
            }
          : { hint: "OK", hintKey: "ok" }),
      blocking: false,
    },
    {
      code: "§R.0",
      label: "ESG disclosures (Carbon Scope 1/2/3)",
      labelKey: "esg",
      status: isRollupOnly
        ? "n_a"
        : esgCount >= 3
          ? "complete"
          : esgCount > 0
            ? "partial"
            : "missing",
      rowCount: esgCount,
      ...(isRollupOnly
        ? {
            hint: "Rollup-only parent — ESG disclosures are per operational entity",
            hintKey: "esgRollup",
          }
        : esgCount === 0
          ? {
              hint: "No ESG data — Scope 1/2 currently modelled from revenue (no disclosed value)",
              hintKey: "esgMissing",
            }
          : esgCount < 3
            ? {
                hint: "Partial ESG disclosure — Scope 1/2 covered but Scope 3 still modelled",
                hintKey: "esgPartial",
              }
            : {
                hint: "Disclosed Scope 1+2+3 + ESG composite",
                hintKey: "esgComplete",
              }),
      blocking: false,
    },
    isRollupOnly
      ? {
          code: "§R.parent",
          label: "Industry baseline (parent rollup)",
          labelKey: "parentRollup",
          status: "n_a",
          rowCount: 0,
          hint: "Rollup-only parent — sector KPI baselines live on operational children",
          hintKey: "parentRollup",
          blocking: false,
        }
      : industrySpecific,
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
      labelKey: "industryClassification",
      status: "missing",
      rowCount: 0,
      hint: "Set company.industry — gates every sector KPI",
      hintKey: "industryMissing",
      blocking: true,
    };
  }

  // Industries with required settings keys.
  const requirements: Record<
    string,
    {
      code: string;
      label: string;
      labelKey: string;
      keys: string[];
      hint: string;
      hintKey: string;
    }
  > = {
    agro_crops: {
      code: "§R.1",
      label: "Agro KPI baseline (hectares + region + crop)",
      labelKey: "agroBaseline",
      keys: ["hectaresPlanted", "region", "cropType"],
      hint:
        "Set in /budgeting/admin/companies/[code]/settings — hectares + region + cropType",
      hintKey: "agroBaseline",
    },
    food_processing: {
      code: "§R.2",
      label: "Food processing KPI baseline (capacity + extraction rate)",
      labelKey: "foodProcessingBaseline",
      keys: ["processingCapacityTonsYr", "extractionRateTarget", "mainInputCommodity"],
      hint: "Set processing capacity + extraction rate target + main input commodity",
      hintKey: "foodProcessingBaseline",
    },
    hospitality: {
      code: "§R.5",
      label: "Hospitality baseline (rooms + seasonality)",
      labelKey: "hospitalityBaseline",
      keys: ["totalRooms", "region"],
      hint: "Set totalRooms + region",
      hintKey: "hospitalityBaseline",
    },
    services: {
      code: "§R.3",
      label: "Services baseline (revenue concentration target)",
      labelKey: "servicesBaseline",
      keys: ["topCustomerHhiTarget"],
      hint: "Set HHI target for customer concentration (or default to industry mean)",
      hintKey: "servicesBaseline",
    },
    industrial: {
      code: "§R.4",
      label: "Industrial KPI baseline (capacity + BOM)",
      labelKey: "industrialBaseline",
      keys: ["productionCapacity", "topInputCommodities"],
      hint: "Set production capacity (units/month) + top-3 raw-material exposures",
      hintKey: "industrialBaseline",
    },
    real_estate: {
      code: "§R.6",
      label: "Real estate baseline (sqm + lease terms)",
      labelKey: "realEstateBaseline",
      keys: ["totalSquareMeters", "averageLeaseMonths"],
      hint: "Set total sqm + average lease tenor",
      hintKey: "realEstateBaseline",
    },
    pharma: {
      code: "§R.7",
      label: "Pharma baseline (inventory days + R&D)",
      labelKey: "pharmaBaseline",
      keys: ["inventoryDaysCover", "rndIntensityTarget"],
      hint: "Set inventory days + R&D intensity target",
      hintKey: "pharmaBaseline",
    },
    entertainment: {
      code: "§R.8",
      label: "Entertainment baseline (capacity + seasonality)",
      labelKey: "entertainmentBaseline",
      keys: ["seatingCapacity"],
      hint: "Set seating capacity + peak-season months",
      hintKey: "entertainmentBaseline",
    },
    education: {
      code: "§R.9",
      label: "Education baseline (enrollment capacity + tuition)",
      labelKey: "educationBaseline",
      keys: ["enrollmentCapacity", "averageTuition"],
      hint: "Set enrollment capacity + average annual tuition",
      hintKey: "educationBaseline",
    },
    poultry: {
      code: "§R.10",
      label: "Poultry baseline (FCR + mortality target)",
      labelKey: "poultryBaseline",
      keys: ["fcrTarget", "mortalityTarget"],
      hint: "Set Feed Conversion Ratio + mortality % target",
      hintKey: "poultryBaseline",
    },
  };

  const req = requirements[industry];
  if (!req) {
    return {
      code: `§R.${industry}`,
      label: `Industry baseline (${industry})`,
      labelKey: "genericBaseline",
      labelParams: { industry },
      status: "n_a",
      rowCount: 0,
      hint: "No sector-specific KPI baseline defined for this industry yet",
      hintKey: "noBaseline",
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
    labelKey: req.labelKey,
    status,
    rowCount: present,
    hint: status === "complete" ? "All required settings set" : req.hint,
    hintKey: status === "complete" ? "allSet" : req.hintKey,
    blocking: false,
  };
}
