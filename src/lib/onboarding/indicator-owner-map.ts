/**
 * 2026-05-27 — Default owner mapping for indicator-readiness backlog.
 *
 * Maps each `IndicatorDefinition.requiredInputs` entry to the ROLE
 * responsible for providing that data. The actual person/email is
 * configurable per-organization via
 * `Organization.settings.dataOwners: Record<inputType, OwnerContact>`.
 *
 * When an org hasn't configured a specific input's owner, we fall
 * back to this default role label — useful for new tenants who haven't
 * filled their data-owner contact list yet.
 *
 * Roles are FO Holding canonical org chart (provided by user 2026-05-27);
 * other tenants (azmade, tabia, future) override via their own
 * Organization.settings.dataOwners JSON without code changes.
 *
 * Pure data module — no DB, no React, importable from server or client.
 */

export interface OwnerContact {
  /** Role label shown in UI when no contact configured. English fallback. */
  role: string;
  /**
   * i18n key suffix under `adminIndicatorBacklog.ownerRole.*` for `role`.
   * Present only on the built-in defaults below — an org that supplies its
   * own `dataOwners` JSON writes free text, which the UI renders verbatim.
   */
  roleKey?: string;
  /** Optional human name (e.g. "Nəcəf M") */
  name?: string;
  /** Optional email for mailto: link */
  email?: string;
  /** Optional 1-line explanation of WHAT this person provides. English fallback. */
  scope?: string;
  /** i18n key suffix under `adminIndicatorBacklog.ownerScope.*` for `scope`. */
  scopeKey?: string;
}

export type RequiredInputCategory =
  | "budgetLine"
  | "balanceSheetLine"
  | "cashFlow"
  | "operationalFact"
  | "counterparty"
  | "commodityPrice"
  | "currencyRate"
  | "weather"
  | "newsSentiment"
  | "industryFactor"
  | "companySettings"
  | "fact"
  | "rollup"
  | "booking";

/** Default owner per requiredInput prefix. Lookups try most-specific
 *  match first (full string), then fall back to category prefix. */
const DEFAULT_OWNER_MAP: Record<string, OwnerContact> = {
  // ─── Audit + Legal (compliance, court, regulatory) ──────────────────
  "operationalFact:AUDIT_CLOSED_PCT": {
    role: "Internal Audit / Hüquq Şöbəsi",
    roleKey: "internalAuditLegal",
    scope: "PBC findings closure status (Major / Minor / Observation / OFI)",
    scopeKey: "auditClosedPct",
  },
  "operationalFact:AUDIT_MAJOR_OPEN": {
    role: "Internal Audit / Hüquq Şöbəsi",
    roleKey: "internalAuditLegal",
    scope: "Outstanding Major audit findings count",
    scopeKey: "auditMajorOpen",
  },
  "operationalFact:LEGAL_CASES_ACTIVE": {
    role: "Hüquq Şöbəsi (Legal)",
    roleKey: "legal",
    scope: "Open court cases register with case type + status",
    scopeKey: "legalCasesActive",
  },

  // ─── Financial statements (P&L / BS / CF) ──────────────────────────
  budgetLine: {
    role: "CFO / Finance Manager",
    roleKey: "cfo",
    scope: "Monthly P&L lines by Chart of Accounts (Revenue / COGS / OpEx)",
    scopeKey: "budgetLine",
  },
  balanceSheetLine: {
    role: "CFO / Finance Manager",
    roleKey: "cfo",
    scope: "Monthly Balance Sheet lines (Assets / Liabilities / Equity)",
    scopeKey: "balanceSheetLine",
  },
  cashFlow: {
    role: "Treasury / CFO",
    roleKey: "treasury",
    scope: "Monthly cash flow entries (operating / investing / financing)",
    scopeKey: "cashFlow",
  },

  // ─── Counterparty (customers + suppliers) ──────────────────────────
  "counterparty:customer": {
    role: "Sales Director / Commercial Manager",
    roleKey: "sales",
    scope:
      "Top customers with annual AZN amount + revenue share + payment terms",
    scopeKey: "counterpartyCustomer",
  },
  "counterparty:supplier": {
    role: "Procurement / Təchizat Şöbəsi",
    roleKey: "procurement",
    scope:
      "Top suppliers with annual AZN volume + COGS share + single-source flag",
    scopeKey: "counterpartySupplier",
  },

  // ─── External feeds (market-driven, system-provided) ──────────────
  commodityPrice: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "External commodity price feed (ICE Sugar No. 11, FAO, EIA)",
    scopeKey: "commodityPrice",
  },
  currencyRate: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "CBAR FX forward curve (auto-populated)",
    scopeKey: "currencyRate",
  },
  weather: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "OpenMeteo regional forecast (auto-populated)",
    scopeKey: "weather",
  },
  newsSentiment: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "News pipeline (sugar industry sentiment, auto-populated)",
    scopeKey: "newsSentiment",
  },
  industryFactor: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "Industry benchmark coefficients (auto-populated)",
    scopeKey: "industryFactor",
  },

  // ─── Operational KPIs ──────────────────────────────────────────────
  "operationalFact:harvest_tons": {
    role: "Farm Manager / Operations",
    roleKey: "farmManager",
    scope: "Per-region harvest tonnage (monthly or seasonal)",
    scopeKey: "harvestTons",
  },
  "operationalFact:yield_per_ha": {
    role: "Farm Manager / Operations",
    roleKey: "farmManager",
    scope: "Yield per hectare per crop (direct entry)",
    scopeKey: "yieldPerHa",
  },
  "operationalFact:drought_index": {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "Computed from weather feed",
    scopeKey: "droughtIndex",
  },
  "operationalFact:sugar_content_pct": {
    role: "Quality Control / Production",
    roleKey: "qualityControl",
    scope: "Brix / Pol % from refinery quality logs",
    scopeKey: "sugarContentPct",
  },

  // ─── Company settings (qualitative tags + descriptions) ────────────
  companySettings: {
    role: "Risk Officer (Nəcəf M)",
    roleKey: "riskOfficer",
    scope:
      "Strategic narrative, competitive advantage, risk registry, NPS, qualitative riskTags",
    scopeKey: "companySettings",
  },

  // ─── Rollup + fact (derived; depends on children) ─────────────────
  rollup: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "Auto-computed when child entities have data",
    scopeKey: "rollup",
  },
  fact: {
    role: "BudgetPro System",
    roleKey: "system",
    scope: "Cross-period lookup (needs prior period data)",
    scopeKey: "fact",
  },
  booking: {
    role: "Finance / ERP",
    roleKey: "financeErp",
    scope: "Specific bookings extracted from ERP",
    scopeKey: "booking",
  },
};

/** Generic fallback when even the category prefix doesn't match. */
const UNKNOWN_OWNER: OwnerContact = {
  role: "Data Owner (unknown)",
  roleKey: "unknown",
  scope: "Contact your administrator to configure this owner",
  scopeKey: "unknown",
};

/**
 * Resolve owner for a requiredInput string like
 * `"operationalFact:AUDIT_CLOSED_PCT"` or `"counterparty:customer"`.
 *
 * Priority:
 *   1. Org-specific override (orgOverrides[input])
 *   2. Full-string match in DEFAULT_OWNER_MAP
 *   3. Category-prefix match (e.g. "operationalFact:" → category default)
 *   4. UNKNOWN_OWNER fallback
 */
export function resolveOwner(
  requiredInput: string,
  orgOverrides?: Record<string, OwnerContact>,
): OwnerContact {
  // (1) Org-specific
  if (orgOverrides && orgOverrides[requiredInput]) {
    return orgOverrides[requiredInput];
  }
  // (2) Full string
  if (DEFAULT_OWNER_MAP[requiredInput]) {
    return DEFAULT_OWNER_MAP[requiredInput];
  }
  // (3) Category prefix (e.g. "operationalFact:" or "counterparty:")
  const colonIdx = requiredInput.indexOf(":");
  const category =
    colonIdx > 0 ? requiredInput.slice(0, colonIdx) : requiredInput;
  if (orgOverrides && orgOverrides[category]) return orgOverrides[category];
  if (DEFAULT_OWNER_MAP[category]) return DEFAULT_OWNER_MAP[category];
  // (4) Fallback
  return UNKNOWN_OWNER;
}

/** Group a list of (input → owner) into per-owner buckets so we can
 *  build «one email per owner with N items» bulk messages. */
export function groupByOwner<T>(
  items: Array<T & { requiredInput: string }>,
  orgOverrides?: Record<string, OwnerContact>,
): Map<string, { owner: OwnerContact; items: T[] }> {
  const grouped = new Map<string, { owner: OwnerContact; items: T[] }>();
  for (const item of items) {
    const owner = resolveOwner(item.requiredInput, orgOverrides);
    const key = owner.email ?? owner.role;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.items.push(item);
    } else {
      grouped.set(key, { owner, items: [item] });
    }
  }
  return grouped;
}

/** Read Organization.settings.dataOwners with type-safe extraction. */
export function readOrgOwnerOverrides(
  orgSettings: unknown,
): Record<string, OwnerContact> | undefined {
  if (!orgSettings || typeof orgSettings !== "object") return undefined;
  const dataOwners = (orgSettings as { dataOwners?: unknown }).dataOwners;
  if (!dataOwners || typeof dataOwners !== "object") return undefined;
  // Defensive validation: keep only entries matching OwnerContact shape
  const valid: Record<string, OwnerContact> = {};
  for (const [k, v] of Object.entries(dataOwners as Record<string, unknown>)) {
    if (v && typeof v === "object" && typeof (v as OwnerContact).role === "string") {
      valid[k] = v as OwnerContact;
    }
  }
  return Object.keys(valid).length > 0 ? valid : undefined;
}
