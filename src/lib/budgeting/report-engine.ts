import { prisma } from "@/lib/prisma"

// ─── Field & Entity definitions ───────────────────────────────

export interface FieldDef {
  name: string
  label: string
  type: "string" | "number" | "date" | "boolean"
}

interface RelationDef {
  name: string
  model: string
  fields: string[]
  /**
   * Non-string relation fields. Used ONLY to coerce filter values before
   * they reach Prisma — `plan.year` is an Int column, so a filter value of
   * `"2026"` has to travel as a number or Prisma rejects the query.
   *
   * Deliberately NOT surfaced through `getEntityFields`: the report table
   * renders every `type: "number"` column through `fmtManat`, so typing
   * `plan.year` as a number on the client would print a year as currency.
   */
  fieldTypes?: Record<string, FieldDef["type"]>
  /**
   * The scalar foreign key this relation hangs off, when the FK is itself
   * exposed as a groupable column. Prisma's `groupBy` takes scalars, so
   * "P&L by company" groups on `companyId` and comes back keyed by cuid —
   * unreadable. Naming the FK lets the engine resolve each group to a label
   * after the aggregate. See `labelField`.
   */
  fk?: string
  /** Which of `fields` reads as the human label for a resolved group. */
  labelField?: string
}

/**
 * How to synthesize a period for an entity that has no `year`/`month` columns
 * of its own.
 *
 * `BudgetLine` is the case this exists for: it carries `monthIndex` (0-11)
 * and takes its year from the plan, so a monthly P&L was not buildable at
 * all — `hasYearMonth: false` hid the period control outright.
 *
 * `monthIndex` is nullable by design (legacy, annual and rollup-derived rows
 * carry null), so a roll-up cannot simply drop those rows: the monthly view
 * would then under-report against the same report ungrouped. They go to an
 * explicit `unknown` bucket instead, which keeps the total cross-footing and
 * puts the gap on screen.
 */
interface DerivedPeriod {
  /** 0-indexed or 1-indexed month column on the base model. */
  monthField: string
  /** 0 when the column is 0=Jan (BudgetLine.monthIndex), 1 when 1=Jan. */
  monthBase: 0 | 1
  /** Relation carrying the year, e.g. `plan` → `plan.year`. */
  yearRelation: string
  yearField: string
}

/**
 * Which column on this entity carries which financial meaning.
 *
 * 2026-08-05 — introduced because `applyComputedFields` used to read a
 * hardcoded `actualAmount` off every row. That column lives on `BudgetActual`
 * alone, and no entity mapped to it, so variance silently equalled the plan
 * and execution silently equalled 0 on every report the product has ever
 * produced. Naming the measures per entity means a computed field can now say
 * "I have no operand for this" instead of inventing one.
 *
 * A measure that is absent here is absent, full stop: the computed field
 * evaluates to `null` and the UI prints a dash.
 */
export interface MeasureMap {
  /** The budgeted / planned figure. */
  planned?: string
  /** The realized figure. On `budgetLines` this is materialized by the
   *  plan↔actual join in `executeBudgetReport`, not stored on the row. */
  actual?: string
  /** Revenue, for margin. */
  revenue?: string
  /** Cost of that revenue, for margin. */
  cost?: string
}

export interface EntityConfig {
  model: string
  fields: FieldDef[]
  relations?: RelationDef[]
  hasPlanId: boolean
  hasYearMonth: boolean
  measures?: MeasureMap
  /**
   * Set when the entity's realized figures come from the matching-year
   * ACTUALS plan rather than from a column on the row itself. Drives the
   * plan↔actual join. The join key is the entity's `department` column —
   * the SAP account code — because that is the pairing the rest of the
   * product already uses (it is the same key the parent-code de-duplication
   * keys on, and the same pairing `budgetActuals` performs by swapping plans).
   */
  actualsFromMatchingPlan?: boolean
  /** Set when the entity has no year/month of its own — see `DerivedPeriod`. */
  derivedPeriod?: DerivedPeriod
  /** How to derive a row's direction — see `SignConvention`. */
  sign?: SignConvention
}

/**
 * How to read a row's direction, so amounts stored unsigned can be netted.
 *
 * Two separate problems, one mechanism:
 *
 *  - `CashFlowEntry.amount` is stored `Math.abs` with the direction in
 *    `entryType` (`dynamic-cf-adapter.ts:10`), so summing it reports gross
 *    turnover where the reader expects net cash. The rest of the product
 *    already nets it exactly this way — `statement-controls-adapter.ts:339`
 *    does `entryType === "inflow" ? amount : -amount`.
 *  - `BudgetLine.plannedAmount` is stored positive for both revenue and cost,
 *    with the direction in `lineType`, so an unfiltered P&L total adds
 *    1 000 000 of revenue to 500 000 of cost.
 *
 * This is NOT a new business rule — it mirrors the convention the product
 * already applies on every other surface. What it does not do is silently
 * change `plannedAmount`: the raw column stays exactly as stored, and the
 * signed figure arrives as its own `netAmount` column.
 */
interface SignConvention {
  /** Column whose value says which direction the row points. */
  field: string
  /** Values that count positive; everything else counts negative. */
  positive: string[]
  /** Amount column the sign applies to. */
  amountField: string
}

/**
 * +1 when a higher actual is favourable (revenue), −1 otherwise.
 *
 * Deliberately identical to `favorableSign` in `variance-helpers.ts`,
 * including its defensive default: an unknown type is treated as a cost,
 * because misclassifying a cost as revenue paints an overrun green — the
 * more dangerous error of the two.
 */
export function favourableDirection(lineType: unknown): 1 | -1 {
  return lineType === "revenue" ? 1 : -1
}

const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  budgetLines: {
    model: "budgetLine",
    hasPlanId: true,
    // BudgetLine has no year/month columns — the period is synthesized from
    // `monthIndex` plus the plan's year. See `derivedPeriod`.
    hasYearMonth: true,
    measures: { planned: "plannedAmount", actual: "actualAmount" },
    actualsFromMatchingPlan: true,
    sign: { field: "lineType", positive: ["revenue"], amountField: "plannedAmount" },
    derivedPeriod: { monthField: "monthIndex", monthBase: 0, yearRelation: "plan", yearField: "year" },
    fields: [
      { name: "department", label: "Department", type: "string" },
      { name: "lineType", label: "Line Type", type: "string" },
      { name: "lineSubtype", label: "Subtype", type: "string" },
      { name: "plannedAmount", label: "Planned Amount", type: "number" },
      { name: "forecastAmount", label: "Forecast Amount", type: "number" },
      { name: "unitPrice", label: "Unit Price", type: "number" },
      { name: "unitCost", label: "Unit Cost", type: "number" },
      { name: "quantity", label: "Quantity", type: "number" },
      { name: "costModelKey", label: "Cost Model Key", type: "string" },
      { name: "companyId", label: "Company", type: "string" },
      { name: "monthIndex", label: "Month (0-11)", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
      { name: "sortOrder", label: "Sort Order", type: "number" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"], fieldTypes: { year: "number" } },
      { name: "costType", model: "budgetCostType", fields: ["key", "label"] },
      { name: "budgetDept", model: "budgetDepartment", fields: ["key", "label"] },
      { name: "company", model: "company", fields: ["code", "name"], fk: "companyId", labelField: "name" },
      // Phase 2.1 dropped the scalar `category` column → the account dimension
      // now lives on the `accountId` FK. Expose it via the relation so reports
      // keep an account code/name column.
      { name: "account", model: "chartOfAccount", fields: ["code", "name"] },
    ],
  },

  // "Fakt məlumatlar" (realized figures). The legacy BudgetActual table is
  // empty in this deployment — actuals arrive via import as the matching-year
  // ACTUALS plan's BudgetLines (Y-series), not as manual BudgetActual records.
  // So this source reads the budgetLine model; the plan is resolved to the
  // Actuals plan in executeBudgetReport (a budget plan → its matching-year
  // actuals via Y4; an actuals plan → itself). For an actuals plan a line's
  // `plannedAmount` IS the realized figure, surfaced here as "Actual Amount".
  budgetActuals: {
    model: "budgetLine",
    hasPlanId: true,
    hasYearMonth: true,
    derivedPeriod: { monthField: "monthIndex", monthBase: 0, yearRelation: "plan", yearField: "year" },
    // Fact-only source: there is no plan to compare against on the row, so
    // variance / execution have no second operand and evaluate to null.
    measures: { actual: "plannedAmount" },
    sign: { field: "lineType", positive: ["revenue"], amountField: "plannedAmount" },
    fields: [
      { name: "lineType", label: "Line Type", type: "string" },
      { name: "department", label: "Department", type: "string" },
      { name: "plannedAmount", label: "Actual Amount", type: "number" },
      { name: "forecastAmount", label: "Forecast Amount", type: "number" },
      { name: "companyId", label: "Company", type: "string" },
      { name: "monthIndex", label: "Month (0-11)", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"], fieldTypes: { year: "number" } },
      { name: "costType", model: "budgetCostType", fields: ["key", "label"] },
      { name: "budgetDept", model: "budgetDepartment", fields: ["key", "label"] },
      { name: "company", model: "company", fields: ["code", "name"], fk: "companyId", labelField: "name" },
      { name: "account", model: "chartOfAccount", fields: ["code", "name"] },
    ],
  },

  /**
   * The accounting ledger of realized figures — the `BudgetActual` table, with
   * its own `actualAmount` column.
   *
   * Added 2026-08-05. `budgetActuals` above reads the ACTUALS PLAN's budget
   * lines and was documented as the only workable source because "the legacy
   * BudgetActual table is empty in this deployment". That note was written in
   * May; five paths write the table today, the AI Auto Import among them
   * (`runActualsBatch`, with per-sheet `source` provenance since 2026-07-29).
   * Both sources are now reachable so the two can be reconciled against each
   * other instead of one being assumed dead.
   */
  actualsLedger: {
    model: "budgetActual",
    hasPlanId: true,
    hasYearMonth: false,
    measures: { actual: "actualAmount" },
    sign: { field: "lineType", positive: ["revenue"], amountField: "actualAmount" },
    fields: [
      { name: "category", label: "Category", type: "string" },
      { name: "department", label: "Department", type: "string" },
      { name: "lineType", label: "Line Type", type: "string" },
      { name: "actualAmount", label: "Actual Amount", type: "number" },
      { name: "monthIndex", label: "Month Index (0-11)", type: "number" },
      { name: "companyId", label: "Company", type: "string" },
      { name: "expenseDate", label: "Expense Date", type: "string" },
      { name: "description", label: "Description", type: "string" },
      { name: "currencyCode", label: "Currency", type: "string" },
      { name: "originalAmount", label: "Original Amount", type: "number" },
      // Provenance: null means the row was NOT written by an import.
      { name: "source", label: "Source Document", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"], fieldTypes: { year: "number" } },
      { name: "costType", model: "budgetCostType", fields: ["key", "label"] },
      { name: "budgetDept", model: "budgetDepartment", fields: ["key", "label"] },
      { name: "company", model: "company", fields: ["code", "name"], fk: "companyId", labelField: "name" },
    ],
  },

  salesBudget: {
    model: "salesBudgetLine",
    hasPlanId: true,
    hasYearMonth: true,
    // Revenue with no cost on the same row — margin needs both, so it stays
    // unavailable here rather than reporting 100 %.
    measures: { revenue: "amount" },
    fields: [
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "quantity", label: "Quantity", type: "number" },
      { name: "unitPrice", label: "Unit Price", type: "number" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "productLine", model: "productLine", fields: ["code", "name", "unit"] },
    ],
  },

  cogsBudget: {
    model: "cOGSBudgetLine",
    hasPlanId: true,
    hasYearMonth: true,
    measures: { cost: "totalCost" },
    fields: [
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "productionQty", label: "Production Qty", type: "number" },
      { name: "totalCost", label: "Total Cost", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "productLine", model: "productLine", fields: ["code", "name", "unit"] },
      { name: "account", model: "chartOfAccount", fields: ["code", "name"] },
    ],
  },

  balanceSheet: {
    model: "balanceSheetLine",
    hasPlanId: true,
    hasYearMonth: true,
    fields: [
      { name: "lineType", label: "Type", type: "string" },
      { name: "subType", label: "Sub Type", type: "string" },
      { name: "companyId", label: "Company", type: "string" },
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
    ],
    relations: [
      { name: "company", model: "company", fields: ["code", "name"], fk: "companyId", labelField: "name" },
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "account", model: "chartOfAccount", fields: ["code", "name"] },
    ],
  },

  cashFlow: {
    model: "cashFlowEntry",
    hasPlanId: false,
    hasYearMonth: true,
    sign: { field: "entryType", positive: ["inflow"], amountField: "amount" },
    fields: [
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "entryType", label: "Entry Type", type: "string" },
      { name: "source", label: "Source", type: "string" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "description", label: "Description", type: "string" },
      { name: "activityType", label: "Activity Type", type: "string" },
      { name: "companyId", label: "Company", type: "string" },
      { name: "isProjected", label: "Projected", type: "boolean" },
      { name: "plannedAmount", label: "Planned Amount", type: "number" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "company", model: "company", fields: ["code", "name"], fk: "companyId", labelField: "name" },
      { name: "account", model: "chartOfAccount", fields: ["code", "name"] },
    ],
  },

  forecasts: {
    model: "budgetForecastEntry",
    hasPlanId: true,
    hasYearMonth: true,
    measures: { planned: "forecastAmount" },
    fields: [
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "category", label: "Category", type: "string" },
      { name: "lineType", label: "Line Type", type: "string" },
      { name: "forecastAmount", label: "Forecast Amount", type: "number" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "costType", model: "budgetCostType", fields: ["key", "label"] },
      { name: "budgetDept", model: "budgetDepartment", fields: ["key", "label"] },
    ],
  },

  assumptions: {
    model: "budgetAssumption",
    hasPlanId: true,
    hasYearMonth: false,
    fields: [
      { name: "category", label: "Category", type: "string" },
      { name: "key", label: "Key", type: "string" },
      { name: "label", label: "Label", type: "string" },
      { name: "value", label: "Value", type: "number" },
      { name: "unit", label: "Unit", type: "string" },
      { name: "period", label: "Period", type: "string" },
      { name: "notes", label: "Notes", type: "string" },
      { name: "sortOrder", label: "Sort Order", type: "number" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
    ],
  },
}

// ─── Report Config type ───────────────────────────────────────

/** Phase 8 D3 (2026-05-28) — dynamic-shape row from a generic Prisma
 *  model dispatch. Each report engine query goes through
 *  `prisma[entityConfig.model]` — neither the column set nor the
 *  relation includes are known at compile time, so the safest type
 *  is «string-keyed dictionary of unknown». Callers narrow per-field
 *  as they consume rows. */
export type ReportRow = Record<string, unknown>

export interface BudgetReportConfig {
  entityType: string
  planId?: string
  columns: { field: string; label?: string; aggregate?: "count" | "sum" | "avg" | "min" | "max" }[]
  filters: { field: string; op: string; value: unknown }[]
  groupBy?: string
  periodGroupBy?: "month" | "quarter" | "year"
  sortBy?: string
  sortOrder?: "asc" | "desc"
  computedFields?: string[] // ["variance", "execution_pct", "margin_pct"]
  limit?: number
}

/** Computed fields the engine knows how to produce. */
export const COMPUTED_FIELDS = ["variance", "execution_pct", "margin_pct", "net_amount"] as const
export type ComputedField = (typeof COMPUTED_FIELDS)[number]

interface ReportResultMeta {
  /**
   * Computed fields the caller asked for that this entity has no operands
   * for. Their column is present and every value is `null`; this says why,
   * so the UI can print a dash with a reason instead of a zero.
   */
  computedFieldsUnavailable?: ComputedField[]
  /**
   * True when `limit` cut the result short. Set so a total can never be
   * presented as complete when it was computed over a truncated page.
   */
  truncated?: boolean
  /**
   * Rows that landed in the `unknown` period bucket because they carry no
   * month (or no year). Reported so a monthly view can say how much of itself
   * is unattributed instead of quietly showing a smaller total.
   */
  rowsWithoutPeriod?: number
  /**
   * When `groupBy` is a foreign key, the field on each row carrying the
   * resolved human label (e.g. `companyId` → `companyLabel`). The client uses
   * it for the axis and the table, so a chart of "P&L by company" is not
   * labelled with cuids.
   */
  groupLabelField?: string
}

export type ReportResult =
  | ({ type: "flat"; data: ReportRow[]; total: number; aggregates?: Record<string, number> } & ReportResultMeta)
  | ({ type: "grouped"; data: ReportRow[]; groupBy: string; total: number } & ReportResultMeta)
  | ({ type: "period"; data: ReportRow[]; periodGroupBy: string; total: number } & ReportResultMeta)

// ─── Configuration validation ─────────────────────────────────

/**
 * A report configuration the engine refuses to run — an unknown field name,
 * a relation path where Prisma only accepts a scalar, an unknown entity.
 *
 * Distinct from a runtime failure on purpose: the routes map this to 400
 * (the caller sent something invalid) instead of 500 (we broke).
 *
 * 2026-08-05 — this type is the tenant boundary. `buildWhere` used to write
 * `where[f.field] = f.value` for any field name a caller sent, including
 * `organizationId`, which overwrote the org scope seeded one line above. The
 * report engine runs on the plain prisma client rather than `withOrgScope`,
 * so no RLS policy sat behind that WHERE clause. Every field name now has to
 * appear in the entity's own declared field list, and `organizationId` is not
 * in any of them.
 */
export class ReportConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReportConfigError"
  }
}

interface FieldRef {
  /** Relation name when the reference is a `rel.field` traversal. */
  relation?: string
  /** Column name on the base model, or on the relation's model. */
  column: string
  type: FieldDef["type"]
}

/**
 * Resolve a user-supplied field name against the entity's declared fields.
 * Throws `ReportConfigError` for anything not declared — this is the
 * allow-list, not a convenience lookup.
 */
export function resolveFieldRef(
  entityType: string,
  config: EntityConfig,
  field: string,
  usage: "filter" | "sort" | "group" | "column",
): FieldRef {
  if (typeof field !== "string" || field.length === 0) {
    throw new ReportConfigError(`Empty ${usage} field name for "${entityType}"`)
  }

  if (field.includes(".")) {
    const [relName, ...rest] = field.split(".")
    const relation = config.relations?.find((r) => r.name === relName)
    if (!relation || rest.length !== 1 || !relation.fields.includes(rest[0])) {
      throw new ReportConfigError(
        `Unknown ${usage} field "${field}" for data source "${entityType}"`,
      )
    }
    // Prisma's groupBy takes scalars on the base model only.
    if (usage === "group") {
      throw new ReportConfigError(
        `Cannot group by "${field}" — grouping needs a column on "${entityType}" itself, not a related record`,
      )
    }
    return {
      relation: relName,
      column: rest[0],
      type: relation.fieldTypes?.[rest[0]] ?? "string",
    }
  }

  const fieldDef = config.fields.find((f) => f.name === field)
  if (!fieldDef) {
    throw new ReportConfigError(
      `Unknown ${usage} field "${field}" for data source "${entityType}"`,
    )
  }
  return { column: field, type: fieldDef.type }
}

/** Validate every field reference in a config before a single query runs. */
export function validateReportConfig(entityType: string, config: BudgetReportConfig): void {
  const entityConfig = ENTITY_CONFIGS[entityType]
  if (!entityConfig) throw new ReportConfigError(`Unknown data source: ${entityType}`)

  for (const col of config.columns ?? []) {
    resolveFieldRef(entityType, entityConfig, col.field, "column")
  }
  for (const f of config.filters ?? []) {
    resolveFieldRef(entityType, entityConfig, f.field, "filter")
  }
  if (config.groupBy) {
    resolveFieldRef(entityType, entityConfig, config.groupBy, "group")
  }
  if (config.sortBy) {
    resolveFieldRef(entityType, entityConfig, config.sortBy, "sort")
  }
  for (const cf of config.computedFields ?? []) {
    if (!(COMPUTED_FIELDS as readonly string[]).includes(cf)) {
      throw new ReportConfigError(`Unknown computed field: ${cf}`)
    }
  }
}

/** Computed fields this entity has the operands to produce. */
export function getEntityComputedFields(entityType: string): ComputedField[] {
  const config = ENTITY_CONFIGS[entityType]
  if (!config) return []
  const m = config.measures ?? {}
  const hasPlanVsFact = Boolean(m.planned && m.actual)
  const out: ComputedField[] = []
  if (hasPlanVsFact) out.push("variance", "execution_pct")
  if (m.revenue && m.cost) out.push("margin_pct")
  if (config.sign) out.push("net_amount")
  return out
}

// ─── Helpers ──────────────────────────────────────────────────

export function parseNumOrDate(value: unknown, field: string, config: EntityConfig) {
  const fieldDef = config.fields.find(f => f.name === field)
  if (fieldDef?.type === "date") return new Date(value as string | number | Date)
  if (fieldDef?.type === "number") return Number(value)
  return value
}

/** Coerce a filter value to the column's type before it reaches Prisma. */
function coerceValue(value: unknown, type: FieldDef["type"]) {
  if (type === "date") return new Date(value as string | number | Date)
  if (type === "number") return Number(value)
  return value
}

/**
 * Translate one filter into a Prisma condition. Returns `undefined` when the
 * filter carries nothing to apply (an incomplete `between`), which the caller
 * skips — matching the previous silent-drop contract.
 */
function buildCondition(op: string, value: unknown, ref: FieldRef): unknown {
  const cast = (v: unknown) => coerceValue(v, ref.type)
  switch (op) {
    case "eq": return cast(value)
    case "neq": return { not: cast(value) }
    case "gt": return { gt: cast(value) }
    case "lt": return { lt: cast(value) }
    case "gte": return { gte: cast(value) }
    case "lte": return { lte: cast(value) }
    case "contains":
      // Prisma's `contains` + `mode` are String-only; on a number or date
      // column the query throws. Reject as a config error (400) rather than
      // letting it surface as a 500.
      if (ref.type !== "string") {
        throw new ReportConfigError(
          `"contains" needs a text column — "${ref.relation ? `${ref.relation}.` : ""}${ref.column}" is a ${ref.type}`,
        )
      }
      return { contains: value, mode: "insensitive" }
    case "in": return { in: (Array.isArray(value) ? value : [value]).map(cast) }
    case "between": {
      const between = value as { from?: unknown; to?: unknown } | null
      if (between?.from == null || between?.to == null) return undefined
      return { gte: cast(between.from), lte: cast(between.to) }
    }
    default:
      throw new ReportConfigError(`Unknown filter operator: ${op}`)
  }
}

/**
 * Assemble the Prisma `where` for one report.
 *
 * Every filter field is resolved against the entity's declared fields first
 * (`resolveFieldRef`), so a caller cannot name a column the entity does not
 * expose. That check is what keeps `organizationId` — seeded on the first
 * line and previously overwritable by a filter of the same name — out of
 * reach. See `ReportConfigError`.
 *
 * Relation traversals (`plan.year`, `account.code`) are translated into
 * Prisma's nested to-one filter (`{ plan: { year: 2026 } }`) instead of being
 * written as a literal `"plan.year"` key, which Prisma rejects.
 */
export function buildWhere(orgId: string, planId: string | undefined, config: EntityConfig, filters: BudgetReportConfig["filters"]) {
  const where: Record<string, unknown> = { organizationId: orgId }
  if (config.hasPlanId && planId) {
    where.planId = planId
  }

  for (const f of filters ?? []) {
    const ref = resolveFieldRef(config.model, config, f.field, "filter")
    const cond = buildCondition(f.op, f.value, ref)
    if (cond === undefined) continue

    if (ref.relation) {
      const nested = (where[ref.relation] as Record<string, unknown> | undefined) ?? {}
      nested[ref.column] = cond
      where[ref.relation] = nested
    } else {
      where[ref.column] = cond
    }
  }
  return where
}

/** Prisma `orderBy` for a scalar or a one-level relation traversal. */
function buildOrderBy(
  entityType: string,
  config: EntityConfig,
  sortBy: string | undefined,
  sortOrder: "asc" | "desc" | undefined,
): Record<string, unknown> | undefined {
  if (!sortBy) return undefined
  const ref = resolveFieldRef(entityType, config, sortBy, "sort")
  const dir = sortOrder ?? "desc"
  return ref.relation ? { [ref.relation]: { [ref.column]: dir } } : { [ref.column]: dir }
}

// ─── Period grouping (month → quarter → year) ─────────────────
// Exported for direct unit testing. The `executeBudgetReport`
// orchestrator is Prisma-bound; these two pure helpers carry the
// non-trivial grouping + computed-field business logic and benefit
// from focused regression coverage. Re-export keeps the existing
// caller (`executeBudgetReport`) unchanged.

/** Tiny helper to narrow an unknown ReportRow field to a number with
 *  a default. The report engine consumes Prisma findMany rows whose
 *  per-field types aren't reachable at this generic dispatch layer;
 *  narrowing at the read site keeps the rest typed. */
function asNum(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

interface PeriodGroup extends ReportRow {
  period: string
  _count: number
  quarter?: number
  month?: unknown
}

/** The bucket for rows whose period cannot be resolved — see `DerivedPeriod`. */
export const UNKNOWN_PERIOD = "unknown"

/**
 * Numeric columns that must never be summed across a group or a period.
 *
 * 2026-08-05 — the groupBy path used to sum EVERY numeric field of the
 * entity, so a grouped report added up unit prices and sort orders, and the
 * chart then plotted "Sort Order" as a money series beside "Planned Amount".
 * A rate and an ordinal do not add.
 */
const NON_ADDITIVE = new Set([
  "unitPrice", "unitCost", "sortOrder", "monthIndex", "value", "exchangeRate", "vatRate",
])

export function periodGroupData(rows: ReportRow[], periodGroupBy: "month" | "quarter" | "year", numericFields: string[]) {
  const groups = new Map<string, PeriodGroup>()

  for (const row of rows) {
    const month = asNum(row.month, 1)
    let key: string
    // A row with no resolvable year (or, below month/quarter granularity, no
    // month) goes to an explicit bucket rather than being dropped or folded
    // into a "NaN"/"undefined" key. Dropping it would make the periodised
    // total disagree with the same report ungrouped, which is the failure
    // mode a reader cannot see.
    const hasYear = row.year !== null && row.year !== undefined && row.year !== ""
    const hasMonth = row.month !== null && row.month !== undefined
    if (!hasYear || (periodGroupBy !== "year" && !hasMonth)) {
      key = UNKNOWN_PERIOD
    } else if (periodGroupBy === "year") {
      key = `${row.year}`
    } else if (periodGroupBy === "quarter") {
      const q = Math.ceil(month / 3)
      key = `${row.year}-Q${q}`
    } else {
      key = `${row.year}-${String(row.month).padStart(2, "0")}`
    }

    if (!groups.has(key)) {
      const unknown = key === UNKNOWN_PERIOD
      groups.set(key, { period: key, year: unknown ? null : row.year, _count: 0 })
      if (periodGroupBy === "quarter" && !unknown) {
        groups.get(key)!.quarter = Math.ceil(month / 3)
      }
      if (periodGroupBy === "month" && !unknown) {
        groups.get(key)!.month = row.month
      }
      for (const f of numericFields) {
        groups.get(key)![f] = 0
      }
    }

    const g = groups.get(key)!
    g._count++
    for (const f of numericFields) {
      g[f] = asNum(g[f]) + asNum(row[f])
    }
  }

  // Chronological, with the unresolved bucket last — it belongs at the end of
  // the table, not sorted into the middle of the year by string order.
  return [...groups.values()].sort((a, b) => {
    if (a.period === UNKNOWN_PERIOD) return 1
    if (b.period === UNKNOWN_PERIOD) return -1
    return a.period.localeCompare(b.period)
  })
}

// ─── Computed fields (post-processing) ────────────────────────

/**
 * Attach variance / execution % / margin % to each row.
 *
 * `measures` names which column carries which meaning for the entity being
 * reported (see `MeasureMap`). When a computed field's operands are not both
 * present on the row, the value is `null` — never 0, never the single operand
 * it does have.
 *
 * That distinction is the whole point of this rewrite. Until 2026-08-05 the
 * function read a hardcoded `row.actualAmount`, a column no report entity
 * mapped to, so `variance` returned the plan unchanged and `execution_pct`
 * returned 0 for every report the product had ever produced. A dash the
 * reader can question beats a number they cannot.
 *
 * Called without `measures` it keeps the original field names and fallbacks,
 * so direct callers (and the pre-existing unit tests that document that
 * contract) are unaffected.
 */
export function applyComputedFields(
  rows: ReportRow[],
  computedFields: string[],
  measures?: MeasureMap,
  sign?: SignConvention,
): ReportRow[] {
  const legacy = measures === undefined
  const m: MeasureMap = measures ?? {
    planned: "plannedAmount",
    actual: "actualAmount",
    revenue: "amount",
    cost: "totalCost",
  }

  /** Read a measure, or `undefined` when the entity has no such column. */
  const read = (row: ReportRow, key: keyof MeasureMap): number | undefined => {
    const field = m[key]
    if (!field) return undefined
    const v = row[field]
    return typeof v === "number" && Number.isFinite(v) ? v : undefined
  }

  for (const row of rows) {
    const planned = read(row, "planned")
    const actual = read(row, "actual")
    // Legacy fallbacks: revenue defaulted to the planned figure and cost to
    // the actual one. Preserved only on the no-measures path.
    const revenue = legacy ? (read(row, "revenue") ?? planned ?? 0) : read(row, "revenue")
    const cost = legacy ? (read(row, "cost") ?? actual ?? 0) : read(row, "cost")

    for (const cf of computedFields) {
      switch (cf) {
        case "variance":
          row.variance =
            planned === undefined || actual === undefined
              ? legacy ? (planned ?? 0) - (actual ?? 0) : null
              : planned - actual
          // Direction, alongside the magnitude. `variance` itself keeps the
          // plan-minus-actual meaning its own label states, but that sign
          // says nothing about whether the news is good: +50 000 is a
          // revenue shortfall and a cost saving depending on the row. This
          // carries the answer, computed exactly as `variance-helpers.ts`
          // does it — (actual − plan) × favourable direction — so the
          // export's red/green stops painting an under-collection green.
          // Not a user-selectable column; it rides along for the renderer.
          if (sign && planned !== undefined && actual !== undefined) {
            row.variance_favourable =
              (actual - planned) * favourableDirection(row[sign.field])
          }
          break
        case "net_amount": {
          // The stored amount is unsigned, with the direction in another
          // column. Nets it without touching the raw column.
          if (!sign) {
            row.net_amount = null
            break
          }
          const raw = row[sign.amountField]
          row.net_amount =
            typeof raw === "number" && Number.isFinite(raw)
              ? raw * (sign.positive.includes(String(row[sign.field])) ? 1 : -1)
              : null
          break
        }
        case "execution_pct":
          if (planned === undefined || actual === undefined) {
            row.execution_pct = legacy ? 0 : null
          } else if (planned === 0) {
            // Executing against a zero budget has no percentage. The legacy
            // contract reported 0 %, which reads as "nothing spent" even when
            // something was.
            row.execution_pct = legacy ? 0 : null
          } else {
            row.execution_pct = (actual / planned) * 100
          }
          break
        case "margin_pct":
          if (revenue === undefined || cost === undefined) {
            row.margin_pct = legacy ? 0 : null
          } else if (revenue === 0) {
            row.margin_pct = legacy ? 0 : null
          } else {
            row.margin_pct = ((revenue - cost) / revenue) * 100
          }
          break
      }
    }
  }
  return rows
}

// ─── Main execute function ────────────────────────────────────

/** Phase 8 D3 — narrow shape for dispatching `prisma[entityConfig.model]`.
 *  Each model's findMany / groupBy accepts the same loose query
 *  object; we don't model the per-model variants here because they
 *  share method signatures sufficient for the report engine's use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaModelDispatch = Record<string, any>

/**
 * Resolve the plan holding realized figures for a requested plan.
 * A budget plan → the matching-year actuals plan; an actuals plan → itself.
 * `null` when the year has no actuals plan at all.
 */
async function resolveActualsPlanId(orgId: string, planId: string): Promise<string | null> {
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { kind: true, year: true },
  })
  if (!plan) return null
  if (plan.kind !== "budget") return planId
  const actualsPlan = await prisma.budgetPlan.findFirst({
    where: { organizationId: orgId, year: plan.year, kind: "actual", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  return actualsPlan?.id ?? null
}

/**
 * Codes that are a PARENT of another code in the same set ("601" when
 * "601-01" is also present). The imported P&L carries both levels, so any sum
 * that keeps the parent counts its branch twice.
 */
function findParentCodes(codes: Iterable<string>): string[] {
  const all = [...codes]
  const parents: string[] = []
  for (const a of all) {
    if (all.some((b) => b !== a && b.startsWith(a + "-"))) parents.push(a)
  }
  return parents
}

export async function executeBudgetReport(orgId: string, config: BudgetReportConfig): Promise<ReportResult> {
  // Allow-list every field name in the request before a query is built.
  // Throws `ReportConfigError`, which the routes render as 400.
  validateReportConfig(config.entityType, config)
  const entityConfig = ENTITY_CONFIGS[config.entityType]
  // Phase 8 D3 — single cast at the boundary instead of 4 scattered
  // `modelDispatch[entityConfig.model]` casts.
  const modelDispatch = prisma as unknown as PrismaModelDispatch

  // "Fakt məlumatlar" reads the realized figures from the ACTUALS plan's
  // BudgetLines. Resolve the requested plan to the actuals plan: a budget plan
  // → its matching-year actuals (Y4); an actuals plan → itself. (No-op for the
  // other entities.)
  let resolvedPlanId = config.planId
  let actualsPlanIdsInScope: string[] | null = null
  if (config.entityType === "budgetActuals") {
    if (config.planId) {
      resolvedPlanId = (await resolveActualsPlanId(orgId, config.planId)) ?? config.planId
    } else {
      // No plan selected ("All plans"). The resolution above is what makes
      // this source mean "realized figures" at all, and skipping it returned
      // BUDGET lines under the "Actual Amount" label — the default state of
      // the screen, reading as fact. Restrict to actuals-kind plans instead.
      // What the default SHOULD be is still open (Phase 15.5); this only
      // stops the source from contradicting its own name.
      const actualPlans = (await prisma.budgetPlan.findMany({
        where: { organizationId: orgId, kind: "actual", deletedAt: null },
        select: { id: true },
      })) as Array<{ id: string }>
      actualsPlanIdsInScope = actualPlans.map((p) => p.id)
    }
  }

  const where = buildWhere(orgId, resolvedPlanId, entityConfig, config.filters)
  if (actualsPlanIdsInScope) {
    where.planId = { in: actualsPlanIdsInScope }
  }
  // Soft-delete tables (2026-05-31): exclude archived rows or re-imported
  // data double-counts in custom reports. Measured on live data: budgetLine
  // ×6.27, balanceSheetLine ×1.92, cashFlowEntry ×1.98. Applied here (after
  // buildWhere) so it flows into the distinct-codes scan AND the main query
  // uniformly. The other report entity models have no soft-delete column.
  const SOFT_DELETE_MODELS = new Set(["budgetLine", "balanceSheetLine", "cashFlowEntry"])
  if (SOFT_DELETE_MODELS.has(entityConfig.model)) {
    where.deletedAt = null
  }
  const limit = Math.min(config.limit ?? 500, 10000)

  // The imported P&L contains BOTH parent SAP codes (e.g. "601-01") AND their
  // children (e.g. "601-01-02"). Summing them in any grouping / aggregation
  // double-counts every revenue or expense. Build the set of parent codes
  // up-front and exclude them from every query below.
  //
  // 2026-08-05, two fixes:
  //  1. This used to run for `budgetLines` only, while `budgetActuals` reads
  //     the SAME budgetLine table — so actual revenue came back at exactly 2×
  //     and every plan-vs-fact comparison was against a doubled fact.
  //  2. The code universe is scanned WITHOUT the user's filters. Deriving it
  //     from the filtered rows meant any filter that removed a child stopped
  //     its parent from looking like a parent, and the parent rejoined the
  //     total next to other branches' children — mixed hierarchy levels in
  //     one figure, which is the exact defect this block exists to prevent.
  const DEDUPES_ACCOUNT_CODES = new Set(["budgetLines", "budgetActuals"])
  if (DEDUPES_ACCOUNT_CODES.has(config.entityType)) {
    const scopeWhere: Record<string, unknown> = { organizationId: orgId, deletedAt: null }
    if (resolvedPlanId) scopeWhere.planId = resolvedPlanId
    else if (actualsPlanIdsInScope) scopeWhere.planId = { in: actualsPlanIdsInScope }

    const distinctCodes = await modelDispatch.budgetLine.findMany({
      where: scopeWhere,
      select: { department: true },
      distinct: ["department"],
    }) as Array<{ department: string | null }>

    const codes = new Set<string>()
    for (const r of distinctCodes) {
      if (r.department) codes.add(r.department)
    }
    const parents = findParentCodes(codes)

    if (parents.length > 0) {
      const existing = where.department
      if (existing !== undefined && existing !== null && typeof existing === "object" && !Array.isArray(existing)) {
        where.department = { ...(existing as Record<string, unknown>), notIn: parents }
      } else if (existing !== undefined) {
        // A scalar `eq` filter. Spreading a string here used to produce
        // `{0:"6",1:"0",…}`; `equals` keeps both conditions intact.
        where.department = { equals: existing, notIn: parents }
      } else {
        where.department = { notIn: parents }
      }
    }
  }

  // Which requested computed fields this entity cannot produce. Reported on
  // the response so the UI prints a dash with a reason instead of a zero.
  const requestedComputed = (config.computedFields ?? []) as ComputedField[]
  const producible = new Set(getEntityComputedFields(config.entityType))
  const computedFieldsUnavailable = requestedComputed.filter((cf) => !producible.has(cf))
  const unavailableMeta =
    computedFieldsUnavailable.length > 0 ? { computedFieldsUnavailable } : {}

  /**
   * Realized figures for the selected plan, summed per account code, ready to
   * pair with a budget row. Empty map when the entity does not pair against a
   * matching plan, when no plan is selected (nothing to pair), or when the
   * year has no actuals plan — in which case variance stays null rather than
   * silently reading as "nothing was realized".
   */
  async function loadActualsByCode(): Promise<Map<string, number> | null> {
    if (!entityConfig.actualsFromMatchingPlan || !config.planId) return null
    if (!requestedComputed.some((cf) => cf === "variance" || cf === "execution_pct")) return null

    const actualsPlanId = await resolveActualsPlanId(orgId, config.planId)
    if (!actualsPlanId || actualsPlanId === config.planId) return null

    const rows = (await modelDispatch.budgetLine.findMany({
      where: { organizationId: orgId, planId: actualsPlanId, deletedAt: null },
      select: { department: true, plannedAmount: true },
    })) as Array<{ department: string | null; plannedAmount: number | null }>

    // Same hierarchy de-duplication as the plan side, or the fact would be
    // double-counted against a de-duplicated plan.
    const codes = new Set<string>()
    for (const r of rows) if (r.department) codes.add(r.department)
    const parents = new Set(findParentCodes(codes))

    const byCode = new Map<string, number>()
    for (const r of rows) {
      if (!r.department || parents.has(r.department)) continue
      byCode.set(r.department, (byCode.get(r.department) ?? 0) + (r.plannedAmount ?? 0))
    }
    return byCode
  }

  /**
   * When the grouped-by column is a foreign key with a declared relation,
   * fetch the related rows and stamp a readable label on each group.
   *
   * Returns the field name the label was written to, or null when the group
   * key is already human-readable. A group whose key is null (unscoped rows —
   * holding-level cash flow, intragroup eliminations, legacy budget lines with
   * no company) gets a null label rather than an invented one.
   */
  async function resolveGroupLabels(rows: ReportRow[], groupBy: string): Promise<string | null> {
    const rel = entityConfig.relations?.find((r) => r.fk === groupBy && r.labelField)
    if (!rel) return null

    const ids = [...new Set(rows.map((r) => r[groupBy]).filter((v): v is string => typeof v === "string"))]
    if (ids.length === 0) return null

    const related = (await modelDispatch[rel.model].findMany({
      where: { id: { in: ids }, organizationId: orgId },
      select: Object.fromEntries([["id", true], ...rel.fields.map((f) => [f, true])]),
    })) as ReportRow[]

    const byId = new Map(related.map((r) => [r.id as string, r]))
    const labelField = `${rel.name}Label`
    for (const row of rows) {
      const target = typeof row[groupBy] === "string" ? byId.get(row[groupBy] as string) : undefined
      row[labelField] = target?.[rel.labelField!] ?? null
      row[rel.name] = target ?? null
    }
    return labelField
  }

  /** Attach the realized figure to each row under the entity's actual measure. */
  function attachActuals(rows: ReportRow[], byCode: Map<string, number> | null, key = "department") {
    if (!byCode) return rows
    const actualField = entityConfig.measures?.actual
    if (!actualField) return rows
    for (const row of rows) {
      const code = row[key]
      if (typeof code !== "string") continue
      // A code present in the plan and absent from the fact means nothing was
      // realized against it — 0, not "unknown". The whole map being absent is
      // what means "unknown", and that path returns null above.
      row[actualField] = byCode.get(code) ?? 0
    }
    return rows
  }

  // ── Period groupBy path ──
  if (config.periodGroupBy && entityConfig.hasYearMonth) {
    const derived = entityConfig.derivedPeriod
    const allRows = (await modelDispatch[entityConfig.model].findMany({
      where,
      // An entity with no year column takes its year from a relation, so that
      // relation has to come back with the rows.
      ...(derived
        ? { include: { [derived.yearRelation]: { select: { [derived.yearField]: true } } } }
        : {}),
      take: limit,
    })) as ReportRow[]

    // Synthesize `year` / `month` for entities that carry neither — BudgetLine
    // has `monthIndex` (0-11) and gets its year from the plan. Rows with a
    // null month keep it null and land in the `unknown` bucket, so the
    // periodised total still cross-foots against the ungrouped one.
    let rowsWithoutPeriod = 0
    if (derived) {
      for (const row of allRows) {
        const rel = row[derived.yearRelation] as Record<string, unknown> | null | undefined
        const year = rel?.[derived.yearField]
        const rawMonth = row[derived.monthField]
        const hasMonth = typeof rawMonth === "number" && Number.isFinite(rawMonth)
        row.year = typeof year === "number" ? year : null
        row.month = hasMonth ? rawMonth + (1 - derived.monthBase) : null
        if (row.year === null || !hasMonth) rowsWithoutPeriod++
      }
    }

    // Rates and ordinals do not add across a period any more than they add
    // across a group — same exclusion as the groupBy path.
    const numericFields = entityConfig.fields
      .filter(f => f.type === "number" && !["year", "month"].includes(f.name) && !NON_ADDITIVE.has(f.name))
      .map(f => f.name)

    // The signed figure has to be derived per row and summed, not derived
    // from the bucket: a month holding 5 000 in and 3 000 out nets to 2 000,
    // and there is no row-level `entryType` left once they are added together.
    const wantsNet = Boolean(entityConfig.sign) && (config.computedFields ?? []).includes("net_amount")
    if (wantsNet) {
      applyComputedFields(allRows, ["net_amount"], entityConfig.measures ?? {}, entityConfig.sign)
      numericFields.push("net_amount")
    }

    let grouped: ReportRow[] = periodGroupData(allRows, config.periodGroupBy, numericFields)

    if (config.computedFields?.length) {
      // `net_amount` is already summed into each bucket above; re-deriving it
      // here would read the bucket's own (absent) direction column and null it.
      const rest = config.computedFields.filter(cf => cf !== "net_amount")
      if (rest.length) {
        grouped = applyComputedFields(grouped, rest, entityConfig.measures ?? {}, entityConfig.sign)
      }
    }

    return {
      type: "period",
      data: grouped,
      periodGroupBy: config.periodGroupBy,
      total: grouped.length,
      ...(allRows.length >= limit ? { truncated: true } : {}),
      ...(rowsWithoutPeriod > 0 ? { rowsWithoutPeriod } : {}),
      ...unavailableMeta,
    }
  }

  // ── Standard groupBy path ──
  if (config.groupBy) {
    const aggregates: Record<string, Record<string, boolean>> = {}
    for (const col of config.columns) {
      if (col.aggregate && col.aggregate !== "count") {
        const aggKey = `_${col.aggregate}`
        if (!aggregates[aggKey]) aggregates[aggKey] = {}
        aggregates[aggKey][col.field] = true
      }
    }

    const sumFields: Record<string, boolean> = {}
    for (const nf of entityConfig.fields) {
      if (nf.type !== "number") continue
      if (NON_ADDITIVE.has(nf.name)) continue
      if (["year", "month"].includes(nf.name)) continue
      sumFields[nf.name] = true
    }

    // Netting a group needs the direction column inside the aggregate: the
    // sign lives per row, and it is gone once rows are added together. So
    // when `net_amount` is asked for, group by (key, direction) and fold the
    // sub-buckets afterwards. Requested only then — the default path keeps
    // its single-field groupBy.
    const netSign = entityConfig.sign
    const wantsNet = Boolean(netSign) && (config.computedFields ?? []).includes("net_amount")
    const by = wantsNet && netSign && netSign.field !== config.groupBy
      ? [config.groupBy, netSign.field]
      : [config.groupBy]

    // Prisma 6: groupBy doesn't support orderBy _count or take with non-by fields
    // Fetch all groups, then sort/limit in JS.
    // `_count: true` replaces the separate unbounded findMany that used to run
    // purely to count rows in JS — on live budget_lines that pulled 44 000 rows
    // into Node on every debounced preview.
    const result = await modelDispatch[entityConfig.model].groupBy({
      by,
      where,
      _count: true,
      ...(Object.keys(sumFields).length > 0 ? { _sum: sumFields } : {}),
    })

    // Flatten _sum fields so chart & KPI can read them directly
    type GroupByRow = ReportRow & { _sum?: Record<string, number | null>; _count?: number | Record<string, number> }
    let flatResult: ReportRow[] = (result as GroupByRow[]).map((row) => {
      const flat: ReportRow = { ...row }
      flat.count = typeof row._count === "number" ? row._count : (row._count?._all ?? 0)
      if (row._sum) {
        for (const [k, v] of Object.entries(row._sum)) {
          flat[k] = v ?? 0
        }
      }
      delete flat._sum
      delete flat._count
      return flat
    })

    // Fold the (key, direction) sub-buckets back into one row per key,
    // netting the signed amount as they merge. Every other sum stays gross —
    // `plannedAmount` is still what the column says it is.
    if (by.length === 2 && netSign) {
      const folded = new Map<string, ReportRow>()
      for (const row of flatResult) {
        const key = String(row[config.groupBy] ?? "")
        const direction = netSign.positive.includes(String(row[netSign.field])) ? 1 : -1
        const amount = typeof row[netSign.amountField] === "number" ? (row[netSign.amountField] as number) : 0

        const existing = folded.get(key)
        if (!existing) {
          const seed: ReportRow = { ...row }
          delete seed[netSign.field] // not a property of the merged group
          seed.net_amount = amount * direction
          folded.set(key, seed)
          continue
        }
        existing.count = ((existing.count as number) ?? 0) + ((row.count as number) ?? 0)
        for (const f of Object.keys(sumFields)) {
          existing[f] = ((existing[f] as number) ?? 0) + ((row[f] as number) ?? 0)
        }
        existing.net_amount = ((existing.net_amount as number) ?? 0) + amount * direction
      }
      flatResult = [...folded.values()]
    }

    // Sort by requested field or by count desc, then limit
    if (config.sortBy && config.sortBy !== "_count") {
      const dir = config.sortOrder === "asc" ? 1 : -1
      flatResult.sort((a: ReportRow, b: ReportRow) => {
        const va = (a[config.sortBy!] as number | undefined) ?? 0,
          vb = (b[config.sortBy!] as number | undefined) ?? 0
        return va < vb ? -dir : va > vb ? dir : 0
      })
    } else {
      flatResult.sort(
        (a: ReportRow, b: ReportRow) =>
          ((b.count as number | undefined) ?? 0) -
          ((a.count as number | undefined) ?? 0),
      )
    }
    const limitedResult = flatResult.slice(0, limit)

    // Computed fields used to be dropped entirely on this path — the table
    // still rendered their headers, filled with dashes. Grouping by the
    // account code lets the realized side be paired group-for-group.
    if (config.computedFields?.length) {
      const byCode = config.groupBy === "department" ? await loadActualsByCode() : null
      attachActuals(limitedResult, byCode, config.groupBy)
      // `net_amount` was netted during the fold above, where the direction
      // column still existed; re-deriving it here would read a merged row
      // that no longer has one.
      const rest = config.computedFields.filter(cf => !(by.length === 2 && cf === "net_amount"))
      if (rest.length) {
        applyComputedFields(limitedResult, rest, entityConfig.measures ?? {}, entityConfig.sign)
      }
    }

    // Grouping by a foreign key returns cuids as the group key. Resolve them
    // to names so "P&L by company" is readable on the axis and in the table.
    const groupLabelField = await resolveGroupLabels(limitedResult, config.groupBy)

    return {
      type: "grouped",
      data: limitedResult,
      groupBy: config.groupBy,
      total: limitedResult.length,
      ...(flatResult.length > limit ? { truncated: true } : {}),
      ...(groupLabelField ? { groupLabelField } : {}),
      ...unavailableMeta,
    }
  }

  // ── Flat query path ──
  const select: Record<string, boolean> = {}
  const include: Record<string, { select: Record<string, boolean> }> = {}

  for (const col of config.columns) {
    if (col.field.includes(".")) {
      const [rel, field] = col.field.split(".")
      if (!include[rel]) include[rel] = { select: {} }
      include[rel].select[field] = true
    } else {
      select[col.field] = true
    }
  }

  const hasSelect = Object.keys(select).length > 0
  const hasInclude = Object.keys(include).length > 0

  // Columns a computed field needs but the user did not select. They are
  // fetched anyway and stripped from the rows afterwards, so the report shows
  // exactly what was asked for while the derivation still has its operands.
  //
  // Getting this wrong is quiet rather than loud: without `lineType`,
  // `favourableDirection` falls to its defensive "treat as cost" default and
  // a revenue shortfall comes back labelled favourable.
  const joinKey = "department"
  const internalFields = new Set<string>()
  const wantsPlanVsFact = requestedComputed.some((cf) => cf === "variance" || cf === "execution_pct")
  if (hasSelect && entityConfig.actualsFromMatchingPlan && wantsPlanVsFact && !select[joinKey]) {
    internalFields.add(joinKey)
  }
  if (
    hasSelect &&
    entityConfig.sign &&
    (requestedComputed.includes("net_amount") || wantsPlanVsFact) &&
    !select[entityConfig.sign.field]
  ) {
    internalFields.add(entityConfig.sign.field)
  }
  if (hasSelect && entityConfig.sign && requestedComputed.includes("net_amount") && !select[entityConfig.sign.amountField]) {
    internalFields.add(entityConfig.sign.amountField)
  }

  const result = await modelDispatch[entityConfig.model].findMany({
    where,
    ...(hasSelect
      ? {
          select: {
            ...select,
            id: true,
            ...Object.fromEntries([...internalFields].map((f) => [f, true])),
            ...(hasInclude ? include : {}),
          },
        }
      : {}),
    ...(hasInclude && !hasSelect ? { include } : {}),
    orderBy: buildOrderBy(config.entityType, entityConfig, config.sortBy, config.sortOrder),
    take: limit,
  })

  let data: ReportRow[] = result as ReportRow[]
  if (config.computedFields?.length) {
    attachActuals(data, await loadActualsByCode(), joinKey)
    data = applyComputedFields(data, config.computedFields, entityConfig.measures ?? {}, entityConfig.sign)
    for (const field of internalFields) {
      for (const row of data) delete row[field]
    }
  }

  // Compute aggregates for numeric columns
  const aggregatesResult: Record<string, number> = {}
  for (const col of config.columns) {
    if (col.aggregate) {
      const fieldDef = entityConfig.fields.find(f => f.name === col.field)
      if (fieldDef?.type === "number") {
        const values = data.map((r: ReportRow) => (r[col.field] as number | undefined) ?? 0)
        switch (col.aggregate) {
          case "sum": aggregatesResult[`${col.field}_sum`] = values.reduce((a: number, b: number) => a + b, 0); break
          case "avg": aggregatesResult[`${col.field}_avg`] = values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0; break
          // An empty result has no minimum. `Math.min()` returns Infinity,
          // which JSON.stringify turns into null on the way to the client —
          // a missing aggregate reading as an absent one.
          case "min": aggregatesResult[`${col.field}_min`] = values.length ? Math.min(...values) : 0; break
          case "max": aggregatesResult[`${col.field}_max`] = values.length ? Math.max(...values) : 0; break
          case "count": aggregatesResult[`${col.field}_count`] = values.length; break
        }
      }
    }
  }

  return {
    type: "flat",
    data,
    total: data.length,
    ...(Object.keys(aggregatesResult).length > 0 ? { aggregates: aggregatesResult } : {}),
    // `take` filled the page exactly — the aggregates above were reduced over
    // a truncated set and must not be presented as a complete total.
    ...(data.length >= limit ? { truncated: true } : {}),
    ...unavailableMeta,
  }
}

// ─── Public helpers ───────────────────────────────────────────

export function getEntityConfigs() {
  return ENTITY_CONFIGS
}

export function getEntityFields(entityType: string): FieldDef[] {
  const config = ENTITY_CONFIGS[entityType]
  if (!config) return []

  const fields = [...config.fields]
  if (config.relations) {
    for (const rel of config.relations) {
      for (const f of rel.fields) {
        fields.push({ name: `${rel.name}.${f}`, label: `${rel.name} → ${f}`, type: "string" })
      }
    }
  }
  return fields
}
