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
}

interface EntityConfig {
  model: string
  fields: FieldDef[]
  relations?: RelationDef[]
  hasPlanId: boolean
  hasYearMonth: boolean
}

const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  budgetLines: {
    model: "budgetLine",
    hasPlanId: true,
    hasYearMonth: false,
    fields: [
      { name: "category", label: "Category", type: "string" },
      { name: "department", label: "Department", type: "string" },
      { name: "lineType", label: "Line Type", type: "string" },
      { name: "lineSubtype", label: "Subtype", type: "string" },
      { name: "plannedAmount", label: "Planned Amount", type: "number" },
      { name: "forecastAmount", label: "Forecast Amount", type: "number" },
      { name: "unitPrice", label: "Unit Price", type: "number" },
      { name: "unitCost", label: "Unit Cost", type: "number" },
      { name: "quantity", label: "Quantity", type: "number" },
      { name: "costModelKey", label: "Cost Model Key", type: "string" },
      { name: "notes", label: "Notes", type: "string" },
      { name: "sortOrder", label: "Sort Order", type: "number" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "costType", model: "budgetCostType", fields: ["key", "label"] },
      { name: "budgetDept", model: "budgetDepartment", fields: ["key", "label"] },
    ],
  },

  budgetActuals: {
    model: "budgetActual",
    hasPlanId: true,
    hasYearMonth: false,
    fields: [
      { name: "category", label: "Category", type: "string" },
      { name: "department", label: "Department", type: "string" },
      { name: "lineType", label: "Line Type", type: "string" },
      { name: "actualAmount", label: "Actual Amount", type: "number" },
      { name: "expenseDate", label: "Expense Date", type: "string" },
      { name: "description", label: "Description", type: "string" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "costType", model: "budgetCostType", fields: ["key", "label"] },
      { name: "budgetDept", model: "budgetDepartment", fields: ["key", "label"] },
    ],
  },

  salesBudget: {
    model: "salesBudgetLine",
    hasPlanId: true,
    hasYearMonth: true,
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
    fields: [
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "accountCode", label: "Account Code", type: "string" },
      { name: "productionQty", label: "Production Qty", type: "number" },
      { name: "totalCost", label: "Total Cost", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
      { name: "productLine", model: "productLine", fields: ["code", "name", "unit"] },
    ],
  },

  balanceSheet: {
    model: "balanceSheetLine",
    hasPlanId: true,
    hasYearMonth: true,
    fields: [
      { name: "accountCode", label: "Account Code", type: "string" },
      { name: "accountName", label: "Account Name", type: "string" },
      { name: "lineType", label: "Type", type: "string" },
      { name: "subType", label: "Sub Type", type: "string" },
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "notes", label: "Notes", type: "string" },
    ],
    relations: [
      { name: "plan", model: "budgetPlan", fields: ["name", "year"] },
    ],
  },

  cashFlow: {
    model: "cashFlowEntry",
    hasPlanId: false,
    hasYearMonth: true,
    fields: [
      { name: "year", label: "Year", type: "number" },
      { name: "month", label: "Month", type: "number" },
      { name: "entryType", label: "Entry Type", type: "string" },
      { name: "source", label: "Source", type: "string" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "description", label: "Description", type: "string" },
      { name: "activityType", label: "Activity Type", type: "string" },
      { name: "category", label: "Category", type: "string" },
      { name: "isProjected", label: "Projected", type: "boolean" },
      { name: "plannedAmount", label: "Planned Amount", type: "number" },
      { name: "createdAt", label: "Created", type: "date" },
    ],
  },

  forecasts: {
    model: "budgetForecastEntry",
    hasPlanId: true,
    hasYearMonth: true,
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

export interface BudgetReportConfig {
  entityType: string
  planId?: string
  columns: { field: string; label?: string; aggregate?: "count" | "sum" | "avg" | "min" | "max" }[]
  filters: { field: string; op: string; value: any }[]
  groupBy?: string
  periodGroupBy?: "month" | "quarter" | "year"
  sortBy?: string
  sortOrder?: "asc" | "desc"
  computedFields?: string[] // ["variance", "execution_pct", "margin_pct"]
  limit?: number
}

export type ReportResult =
  | { type: "flat"; data: any[]; total: number; aggregates?: Record<string, number> }
  | { type: "grouped"; data: any[]; groupBy: string; total: number }
  | { type: "period"; data: any[]; periodGroupBy: string; total: number }

// ─── Helpers ──────────────────────────────────────────────────

function parseNumOrDate(value: any, field: string, config: EntityConfig) {
  const fieldDef = config.fields.find(f => f.name === field)
  if (fieldDef?.type === "date") return new Date(value)
  if (fieldDef?.type === "number") return Number(value)
  return value
}

function buildWhere(orgId: string, planId: string | undefined, config: EntityConfig, filters: BudgetReportConfig["filters"]) {
  const where: any = { organizationId: orgId }
  if (config.hasPlanId && planId) {
    where.planId = planId
  }

  for (const f of filters) {
    switch (f.op) {
      case "eq": where[f.field] = f.value; break
      case "neq": where[f.field] = { not: f.value }; break
      case "gt": where[f.field] = { gt: parseNumOrDate(f.value, f.field, config) }; break
      case "lt": where[f.field] = { lt: parseNumOrDate(f.value, f.field, config) }; break
      case "gte": where[f.field] = { gte: parseNumOrDate(f.value, f.field, config) }; break
      case "lte": where[f.field] = { lte: parseNumOrDate(f.value, f.field, config) }; break
      case "contains": where[f.field] = { contains: f.value, mode: "insensitive" }; break
      case "in": where[f.field] = { in: Array.isArray(f.value) ? f.value : [f.value] }; break
      case "between":
        if (f.value?.from && f.value?.to) {
          where[f.field] = { gte: parseNumOrDate(f.value.from, f.field, config), lte: parseNumOrDate(f.value.to, f.field, config) }
        }
        break
    }
  }
  return where
}

// ─── Period grouping (month → quarter → year) ─────────────────
// Exported for direct unit testing. The `executeBudgetReport`
// orchestrator is Prisma-bound; these two pure helpers carry the
// non-trivial grouping + computed-field business logic and benefit
// from focused regression coverage. Re-export keeps the existing
// caller (`executeBudgetReport`) unchanged.

export function periodGroupData(rows: any[], periodGroupBy: "month" | "quarter" | "year", numericFields: string[]) {
  const groups = new Map<string, any>()

  for (const row of rows) {
    let key: string
    if (periodGroupBy === "year") {
      key = `${row.year}`
    } else if (periodGroupBy === "quarter") {
      const q = Math.ceil((row.month || 1) / 3)
      key = `${row.year}-Q${q}`
    } else {
      key = `${row.year}-${String(row.month).padStart(2, "0")}`
    }

    if (!groups.has(key)) {
      groups.set(key, { period: key, year: row.year, _count: 0 })
      if (periodGroupBy === "quarter") {
        groups.get(key)!.quarter = Math.ceil((row.month || 1) / 3)
      }
      if (periodGroupBy === "month") {
        groups.get(key)!.month = row.month
      }
      for (const f of numericFields) {
        groups.get(key)![f] = 0
      }
    }

    const g = groups.get(key)!
    g._count++
    for (const f of numericFields) {
      g[f] += (row[f] ?? 0)
    }
  }

  return [...groups.values()].sort((a, b) => a.period.localeCompare(b.period))
}

// ─── Computed fields (post-processing) ────────────────────────

export function applyComputedFields(rows: any[], computedFields: string[]) {
  for (const row of rows) {
    for (const cf of computedFields) {
      switch (cf) {
        case "variance":
          row.variance = (row.plannedAmount ?? 0) - (row.actualAmount ?? 0)
          break
        case "execution_pct":
          row.execution_pct = (row.plannedAmount ?? 0) !== 0
            ? ((row.actualAmount ?? 0) / row.plannedAmount) * 100
            : 0
          break
        case "margin_pct":
          row.margin_pct = (row.amount ?? row.plannedAmount ?? 0) !== 0
            ? (((row.amount ?? row.plannedAmount ?? 0) - (row.totalCost ?? row.actualAmount ?? 0)) / (row.amount ?? row.plannedAmount ?? 1)) * 100
            : 0
          break
      }
    }
  }
  return rows
}

// ─── Main execute function ────────────────────────────────────

export async function executeBudgetReport(orgId: string, config: BudgetReportConfig): Promise<ReportResult> {
  const entityConfig = ENTITY_CONFIGS[config.entityType]
  if (!entityConfig) throw new Error(`Unknown entity type: ${config.entityType}`)

  const where = buildWhere(orgId, config.planId, entityConfig, config.filters)
  const limit = Math.min(config.limit ?? 500, 10000)

  // For budgetLines, the imported P&L contains BOTH parent SAP codes (e.g.
  // "601-01") AND their children (e.g. "601-01-02"). Summing them in any
  // grouping / aggregation double-counts every revenue or expense. Build the
  // set of parent codes up-front and exclude them from every query below.
  if (config.entityType === "budgetLines") {
    const distinctCodes = await (prisma as any).budgetLine.findMany({
      where,
      select: { department: true },
      distinct: ["department"],
    }) as Array<{ department: string | null }>
    const codes = new Set<string>()
    for (const r of distinctCodes) {
      if (r.department) codes.add(r.department)
    }
    const parents: string[] = []
    for (const a of codes) {
      for (const b of codes) {
        if (a !== b && b.startsWith(a + "-")) { parents.push(a); break }
      }
    }
    if (parents.length > 0) {
      where.department = where.department
        ? { ...where.department, notIn: parents }
        : { notIn: parents }
    }
  }

  // ── Period groupBy path ──
  if (config.periodGroupBy && entityConfig.hasYearMonth) {
    const allRows = await (prisma as any)[entityConfig.model].findMany({
      where,
      take: limit,
    })

    const numericFields = entityConfig.fields.filter(f => f.type === "number" && !["year", "month"].includes(f.name)).map(f => f.name)
    let grouped = periodGroupData(allRows, config.periodGroupBy, numericFields)

    if (config.computedFields?.length) {
      grouped = applyComputedFields(grouped, config.computedFields)
    }

    return { type: "period", data: grouped, periodGroupBy: config.periodGroupBy, total: grouped.length }
  }

  // ── Standard groupBy path ──
  if (config.groupBy) {
    const aggregates: any = {}
    for (const col of config.columns) {
      if (col.aggregate && col.aggregate !== "count") {
        const aggKey = `_${col.aggregate}`
        if (!aggregates[aggKey]) aggregates[aggKey] = {}
        aggregates[aggKey][col.field] = true
      }
    }

    // Build numeric aggregates for groupBy
    const numericFields = entityConfig.fields.filter(f => f.type === "number")
    const sumFields: Record<string, boolean> = {}
    for (const nf of numericFields) {
      sumFields[nf.name] = true
    }

    // Prisma 6: groupBy doesn't support orderBy _count or take with non-by fields
    // Fetch all groups, then sort/limit in JS
    const result = await (prisma as any)[entityConfig.model].groupBy({
      by: [config.groupBy],
      where,
      ...(Object.keys(sumFields).length > 0 ? { _sum: sumFields } : {}),
    })

    // Manually count per group since Prisma 6 groupBy _count is unreliable
    // Also fetch total count per group via a separate approach
    const countByGroup = new Map<string, number>()
    const allRows = await (prisma as any)[entityConfig.model].findMany({
      where,
      select: { [config.groupBy]: true },
    })
    for (const row of allRows) {
      const key = String(row[config.groupBy] ?? "")
      countByGroup.set(key, (countByGroup.get(key) ?? 0) + 1)
    }

    // Flatten _sum fields so chart & KPI can read them directly
    const flatResult = result.map((row: any) => {
      const flat: any = { ...row }
      flat.count = countByGroup.get(String(row[config.groupBy ?? ""] ?? "")) ?? 0
      if (row._sum) {
        for (const [k, v] of Object.entries(row._sum)) {
          flat[k] = v ?? 0
        }
      }
      delete flat._sum
      delete flat._count
      return flat
    })

    // Sort by requested field or by count desc, then limit
    if (config.sortBy && config.sortBy !== "_count") {
      const dir = config.sortOrder === "asc" ? 1 : -1
      flatResult.sort((a: any, b: any) => {
        const va = a[config.sortBy!] ?? 0, vb = b[config.sortBy!] ?? 0
        return va < vb ? -dir : va > vb ? dir : 0
      })
    } else {
      flatResult.sort((a: any, b: any) => b.count - a.count)
    }
    const limitedResult = flatResult.slice(0, limit)

    return { type: "grouped", data: limitedResult, groupBy: config.groupBy, total: limitedResult.length }
  }

  // ── Flat query path ──
  const select: any = {}
  const include: any = {}

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

  const result = await (prisma as any)[entityConfig.model].findMany({
    where,
    ...(hasSelect ? { select: { ...select, id: true, ...(hasInclude ? include : {}) } } : {}),
    ...(hasInclude && !hasSelect ? { include } : {}),
    orderBy: config.sortBy
      ? { [config.sortBy]: config.sortOrder ?? "desc" }
      : undefined,
    take: limit,
  })

  let data = result
  if (config.computedFields?.length) {
    data = applyComputedFields(data, config.computedFields)
  }

  // Compute aggregates for numeric columns
  const aggregatesResult: Record<string, number> = {}
  for (const col of config.columns) {
    if (col.aggregate) {
      const fieldDef = entityConfig.fields.find(f => f.name === col.field)
      if (fieldDef?.type === "number") {
        const values = data.map((r: any) => r[col.field] ?? 0)
        switch (col.aggregate) {
          case "sum": aggregatesResult[`${col.field}_sum`] = values.reduce((a: number, b: number) => a + b, 0); break
          case "avg": aggregatesResult[`${col.field}_avg`] = values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0; break
          case "min": aggregatesResult[`${col.field}_min`] = Math.min(...values); break
          case "max": aggregatesResult[`${col.field}_max`] = Math.max(...values); break
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
