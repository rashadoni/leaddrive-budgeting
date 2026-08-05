/**
 * In-memory Prisma double for the Report Builder pipeline.
 *
 * Why this exists: `executeBudgetReport` is the only place in the
 * budgeting module that dispatches Prisma generically
 * (`prisma[entityConfig.model].findMany(...)`), so every existing test
 * either stubs the engine wholesale (route handler tests) or tests the
 * three pure helpers in isolation (`report-engine.test.ts`). Neither
 * covers the part that decides what number a CFO sees: the where-clause
 * assembly, the parent-code exclusion, the soft-delete filter, the
 * limit, and the order those interact in.
 *
 * This double closes that gap without a database. It is deliberately
 * STRICT rather than permissive — it validates argument keys against a
 * per-model column list and throws the same shape of error real Prisma
 * throws for an unknown argument. A lenient mock would silently accept
 * `where["plan.year"]` and hide the 500 the production engine returns.
 *
 * Supported subset (everything `executeBudgetReport` actually calls):
 *   findMany  — where / select / include / orderBy / take / distinct
 *   groupBy   — by / where / _sum
 *   findFirst — where / select / orderBy
 *   count     — where
 *
 * Filter operators mirror `buildWhere` output: scalar equality, null,
 * { not }, { gt|gte|lt|lte }, { contains, mode }, { in }, { notIn },
 * and a { contains, notIn } combination.
 */

export type Row = Record<string, unknown>

/** Column lists per model — the strictness that makes bad args fail. */
const COLUMNS: Record<string, string[]> = {
  budgetLine: [
    "id", "organizationId", "planId", "department", "lineType", "lineSubtype",
    "plannedAmount", "forecastAmount", "unitPrice", "unitCost", "quantity",
    "costModelKey", "notes", "sortOrder", "accountId", "costTypeId",
    "departmentId", "companyId", "monthIndex", "deletedAt", "deletedBy",
  ],
  salesBudgetLine: [
    "id", "organizationId", "planId", "productLineId", "year", "month",
    "quantity", "unitPrice", "amount", "notes",
  ],
  cOGSBudgetLine: [
    "id", "organizationId", "planId", "productLineId", "accountId", "year",
    "month", "productionQty", "totalCost", "notes",
  ],
  balanceSheetLine: [
    "id", "organizationId", "planId", "companyId", "isElimination", "accountId",
    "lineType", "subType", "year", "month", "amount", "notes", "deletedAt",
  ],
  cashFlowEntry: [
    "id", "organizationId", "year", "month", "entryType", "source", "amount",
    "description", "activityType", "isProjected", "plannedAmount", "accountId",
    "companyId", "createdAt", "deletedAt",
  ],
  budgetActual: [
    "id", "organizationId", "planId", "category", "department", "lineType",
    "actualAmount", "expenseDate", "description", "currencyCode",
    "exchangeRate", "originalAmount", "monthIndex", "costTypeId",
    "departmentId", "companyId", "source", "createdAt",
  ],
  budgetForecastEntry: [
    "id", "organizationId", "planId", "year", "month", "category", "lineType",
    "forecastAmount", "costTypeId", "departmentId", "createdAt",
  ],
  budgetAssumption: [
    "id", "organizationId", "planId", "category", "key", "label", "value",
    "unit", "period", "notes", "sortOrder",
  ],
  budgetPlan: [
    "id", "organizationId", "name", "year", "kind", "status", "deletedAt",
    "createdAt",
  ],
  chartOfAccount: ["id", "organizationId", "code", "name"],
  budgetCostType: ["id", "organizationId", "key", "label"],
  budgetDepartment: ["id", "organizationId", "key", "label"],
  productLine: ["id", "organizationId", "code", "name", "unit"],
}

/** relation name → { model, fk } on the owning model. */
const RELATIONS: Record<string, Record<string, { model: string; fk: string }>> = {
  budgetLine: {
    plan: { model: "budgetPlan", fk: "planId" },
    account: { model: "chartOfAccount", fk: "accountId" },
    costType: { model: "budgetCostType", fk: "costTypeId" },
    budgetDept: { model: "budgetDepartment", fk: "departmentId" },
  },
  salesBudgetLine: {
    plan: { model: "budgetPlan", fk: "planId" },
    productLine: { model: "productLine", fk: "productLineId" },
  },
  cOGSBudgetLine: {
    plan: { model: "budgetPlan", fk: "planId" },
    productLine: { model: "productLine", fk: "productLineId" },
    account: { model: "chartOfAccount", fk: "accountId" },
  },
  balanceSheetLine: {
    plan: { model: "budgetPlan", fk: "planId" },
    account: { model: "chartOfAccount", fk: "accountId" },
  },
  cashFlowEntry: {
    account: { model: "chartOfAccount", fk: "accountId" },
  },
  budgetActual: {
    plan: { model: "budgetPlan", fk: "planId" },
    costType: { model: "budgetCostType", fk: "costTypeId" },
    budgetDept: { model: "budgetDepartment", fk: "departmentId" },
  },
  budgetForecastEntry: {
    plan: { model: "budgetPlan", fk: "planId" },
    costType: { model: "budgetCostType", fk: "costTypeId" },
    budgetDept: { model: "budgetDepartment", fk: "departmentId" },
  },
  budgetAssumption: {
    plan: { model: "budgetPlan", fk: "planId" },
  },
}

/** Mirrors Prisma's unknown-argument failure so a bad field 500s here too. */
export class FakePrismaValidationError extends Error {
  constructor(model: string, arg: string, where: string) {
    super(
      `Unknown argument \`${arg}\` in ${where} for model \`${model}\`. ` +
        `Available options are listed in green.`,
    )
    this.name = "PrismaClientValidationError"
  }
}

function assertColumn(model: string, key: string, where: string) {
  const cols = COLUMNS[model]
  if (!cols) throw new Error(`FakePrisma: unknown model \`${model}\``)
  if (!cols.includes(key)) throw new FakePrismaValidationError(model, key, where)
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined
  if (cond === undefined) return true
  if (typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>
    for (const [op, operand] of Object.entries(c)) {
      switch (op) {
        case "mode":
          break // handled alongside `contains`
        case "equals":
          if (operand === null) {
            if (value !== null && value !== undefined) return false
          } else if (value !== operand) return false
          break
        case "not":
          if (operand === null) {
            if (value === null || value === undefined) return false
          } else if (value === operand) return false
          break
        case "gt":
          if (!(compare(value, operand) > 0)) return false
          break
        case "gte":
          if (!(compare(value, operand) >= 0)) return false
          break
        case "lt":
          if (!(compare(value, operand) < 0)) return false
          break
        case "lte":
          if (!(compare(value, operand) <= 0)) return false
          break
        case "contains": {
          const insensitive = c.mode === "insensitive"
          const hay = String(value ?? "")
          const needle = String(operand)
          if (
            !(insensitive
              ? hay.toLowerCase().includes(needle.toLowerCase())
              : hay.includes(needle))
          ) {
            return false
          }
          break
        }
        case "in":
          if (!(operand as unknown[]).includes(value)) return false
          break
        case "notIn":
          if ((operand as unknown[]).includes(value)) return false
          break
        default:
          throw new Error(`FakePrisma: unsupported operator \`${op}\``)
      }
    }
    return true
  }
  return value === cond
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date || b instanceof Date) {
    return new Date(a as string).getTime() - new Date(b as string).getTime()
  }
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

export interface FakePrismaStore {
  [model: string]: Row[]
}

export function createFakePrisma(store: FakePrismaStore) {
  /** Query counters — used to assert that N-row scans happen (or don't). */
  const stats = { findMany: 0, groupBy: 0, findFirst: 0, rowsScanned: 0 }

  function rowsOf(model: string): Row[] {
    return store[model] ?? []
  }

  /** Follow a to-one relation from a row, or null when unset / dangling. */
  function relatedRow(model: string, row: Row, relName: string): Row | null {
    const rel = RELATIONS[model]?.[relName]
    if (!rel) return null
    const fk = row[rel.fk]
    if (fk == null) return null
    return rowsOf(rel.model).find((r) => r.id === fk) ?? null
  }

  function applyWhere(model: string, where: Record<string, unknown> | undefined) {
    let rows = rowsOf(model)
    if (!where) return rows

    const rels = RELATIONS[model] ?? {}
    for (const key of Object.keys(where)) {
      // Prisma accepts a to-one relation name carrying a nested field filter
      // (`{ plan: { year: 2026 } }`). Anything else must be a real column.
      if (!rels[key]) assertColumn(model, key, "where")
    }

    rows = rows.filter((r) =>
      Object.entries(where).every(([k, cond]) => {
        if (!rels[k]) return matchesCondition(r[k], cond)
        const target = relatedRow(model, r, k)
        if (target == null) return false
        const nested = cond as Record<string, unknown>
        for (const key of Object.keys(nested)) {
          assertColumn(rels[k].model, key, `where.${k}`)
        }
        return Object.entries(nested).every(([nk, nc]) => matchesCondition(target[nk], nc))
      }),
    )
    return rows
  }

  function project(
    model: string,
    row: Row,
    select?: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Row {
    const rels = RELATIONS[model] ?? {}
    let out: Row

    if (select) {
      out = {}
      for (const [k, v] of Object.entries(select)) {
        if (!v) continue
        if (rels[k]) {
          out[k] = resolveRelation(model, row, k, v as { select?: Record<string, unknown> })
        } else {
          assertColumn(model, k, "select")
          out[k] = row[k]
        }
      }
    } else {
      out = { ...row }
    }

    if (include) {
      for (const [k, v] of Object.entries(include)) {
        if (!rels[k]) throw new FakePrismaValidationError(model, k, "include")
        out[k] = resolveRelation(model, row, k, v as { select?: Record<string, unknown> })
      }
    }
    return out
  }

  function resolveRelation(
    model: string,
    row: Row,
    relName: string,
    spec: { select?: Record<string, unknown> } | true,
  ): Row | null {
    const rel = RELATIONS[model]?.[relName]
    if (!rel) throw new FakePrismaValidationError(model, relName, "include")
    const fkValue = row[rel.fk]
    if (fkValue == null) return null
    const target = rowsOf(rel.model).find((r) => r.id === fkValue)
    if (!target) return null
    const sel = typeof spec === "object" ? spec.select : undefined
    if (!sel) return { ...target }
    const out: Row = {}
    for (const [k, v] of Object.entries(sel)) {
      if (!v) continue
      assertColumn(rel.model, k, "select")
      out[k] = target[k]
    }
    return out
  }

  function makeModel(model: string) {
    return {
      async findMany(args: {
        where?: Record<string, unknown>
        select?: Record<string, unknown>
        include?: Record<string, unknown>
        orderBy?: Record<string, "asc" | "desc">
        take?: number
        distinct?: string[]
      } = {}) {
        stats.findMany++
        let rows = applyWhere(model, args.where)
        stats.rowsScanned += rows.length

        if (args.orderBy) {
          const rels = RELATIONS[model] ?? {}
          const [[field, spec]] = Object.entries(args.orderBy)
          if (rels[field]) {
            // `{ plan: { year: "desc" } }` — sort by a related record's column.
            const nested = spec as unknown as Record<string, "asc" | "desc">
            const [[relField, relDir]] = Object.entries(nested)
            assertColumn(rels[field].model, relField, "orderBy")
            rows = [...rows].sort((a, b) => {
              const av = relatedRow(model, a, field)?.[relField]
              const bv = relatedRow(model, b, field)?.[relField]
              return compare(av, bv) * (relDir === "asc" ? 1 : -1)
            })
          } else {
            assertColumn(model, field, "orderBy")
            const dir = spec as unknown as "asc" | "desc"
            rows = [...rows].sort(
              (a, b) => compare(a[field], b[field]) * (dir === "asc" ? 1 : -1),
            )
          }
        }

        if (args.distinct) {
          const seen = new Set<string>()
          rows = rows.filter((r) => {
            const key = args.distinct!.map((d) => String(r[d])).join(" ")
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        }

        if (typeof args.take === "number") rows = rows.slice(0, args.take)

        return rows.map((r) => project(model, r, args.select, args.include))
      },

      async groupBy(args: {
        by: string[]
        where?: Record<string, unknown>
        _sum?: Record<string, boolean>
        _count?: boolean | Record<string, boolean>
      }) {
        stats.groupBy++
        for (const key of args.by) assertColumn(model, key, "by")
        if (args._sum) {
          for (const key of Object.keys(args._sum)) assertColumn(model, key, "_sum")
        }
        const rows = applyWhere(model, args.where)
        const groups = new Map<string, Row>()
        for (const r of rows) {
          const key = args.by.map((b) => String(r[b])).join(" ")
          if (!groups.has(key)) {
            const seed: Row = {}
            for (const b of args.by) seed[b] = r[b]
            if (args._sum) {
              const sums: Record<string, number | null> = {}
              for (const f of Object.keys(args._sum)) sums[f] = null
              seed._sum = sums
            }
            // Prisma returns a bare number for `_count: true`, and an object
            // keyed by field (plus `_all`) for the object form.
            if (args._count) seed._count = args._count === true ? 0 : { _all: 0 }
            groups.set(key, seed)
          }
          const g = groups.get(key)!
          if (args._count) {
            if (typeof g._count === "number") g._count = g._count + 1
            else (g._count as Record<string, number>)._all++
          }
          if (args._sum) {
            const sums = g._sum as Record<string, number | null>
            for (const f of Object.keys(args._sum)) {
              const v = r[f]
              if (typeof v === "number") sums[f] = (sums[f] ?? 0) + v
            }
          }
        }
        return [...groups.values()]
      },

      async findFirst(args: {
        where?: Record<string, unknown>
        select?: Record<string, unknown>
        orderBy?: Record<string, "asc" | "desc">
      } = {}) {
        stats.findFirst++
        let rows = applyWhere(model, args.where)
        if (args.orderBy) {
          const [[field, dir]] = Object.entries(args.orderBy)
          rows = [...rows].sort(
            (a, b) => compare(a[field], b[field]) * (dir === "asc" ? 1 : -1),
          )
        }
        const row = rows[0]
        return row ? project(model, row, args.select) : null
      },

      async count(args: { where?: Record<string, unknown> } = {}) {
        return applyWhere(model, args.where).length
      },
    }
  }

  const client: Record<string, unknown> = { __stats: stats }
  for (const model of Object.keys(COLUMNS)) {
    client[model] = makeModel(model)
  }
  return client as Record<string, ReturnType<typeof makeModel>> & {
    __stats: typeof stats
  }
}
