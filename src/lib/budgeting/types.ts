export interface BudgetPlan {
  id: string
  organizationId: string
  name: string
  periodType: "monthly" | "quarterly" | "annual"
  year: number
  month?: number | null
  quarter?: number | null
  status: "draft" | "pending_approval" | "approved" | "rejected" | "closed"
  notes?: string | null
  submittedBy?: string | null
  submittedAt?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  rejectedReason?: string | null
  amendmentOf?: string | null
  createdAt: string
  updatedAt: string
}

export interface BudgetLine {
  id: string
  organizationId: string
  planId: string
  category: string
  department?: string | null
  lineType: "expense" | "revenue" | "cogs"
  lineSubtype?: string | null  // service | product | cogs
  plannedAmount: number
  forecastAmount?: number | null
  unitPrice?: number | null
  unitCost?: number | null
  quantity?: number | null
  costModelKey?: string | null
  isAutoActual: boolean
  notes?: string | null
  sortOrder: number
  parentId?: string | null
  children?: BudgetLine[]
}

export interface BudgetActual {
  id: string
  organizationId: string
  planId: string
  category: string
  department?: string | null
  lineType: "expense" | "revenue" | "cogs"
  actualAmount: number
  expenseDate?: string | null
  description?: string | null
  createdAt: string
}

export interface BudgetCategoryRow {
  category: string
  lineType: string
  planned: number
  forecast: number
  actual: number
  variance: number
  variancePct: number
  parentCategory?: string | null
}

export interface BudgetDepartmentRow {
  department: string
  planned: number
  forecast: number
  actual: number
  variance: number
}

export interface BudgetAnalytics {
  plan: BudgetPlan
  totalPlanned: number
  totalForecast: number
  totalActual: number
  totalVariance: number
  forecastVariance: number
  executionPct: number
  expenseExecutionPct: number
  revenueExecutionPct: number
  elapsedPct: number
  autoActualTotal: number
  yearEndProjection: number
  marginYearEndProjection: number
  totalExpensePlanned: number
  totalExpenseForecast: number
  totalExpenseActual: number
  totalRevenuePlanned: number
  totalRevenueForecast: number
  totalRevenueActual: number
  margin: number
  marginActual: number
  totalCOGSPlanned: number
  totalCOGSForecast: number
  totalCOGSActual: number
  grossProfit: number
  grossProfitActual: number
  marginForecast: number
  byCategory: BudgetCategoryRow[]
  byDepartment: BudgetDepartmentRow[]
  costModelTotal: number
  matrix?: {
    costTypes: Array<{ key: string; label: string; isShared: boolean; color: string | null }>
    departments: Array<{ key: string; label: string; hasRevenue: boolean; color: string | null }>
    cells: Array<{
      costTypeKey: string
      costTypeLabel: string
      departmentKey: string | null
      departmentLabel: string | null
      planned: number
      actual: number
      forecast: number
      variance: number
      variancePct: number
      lineType: string
    }>
    rowTotals: Record<string, { planned: number; actual: number; forecast: number; variance: number }>
    colTotals: Record<string, { planned: number; actual: number; forecast: number; variance: number }>
    grandTotal: { planned: number; actual: number; forecast: number; variance: number }
  }
}

export interface CreateBudgetPlanInput {
  name: string
  periodType: "monthly" | "quarterly" | "annual"
  year: number
  month?: number
  quarter?: number
  notes?: string
}

export interface UpdateBudgetPlanInput {
  name?: string
  status?: "draft" | "pending_approval" | "approved" | "rejected" | "closed"
  notes?: string
  rejectedReason?: string
}

export interface CreateBudgetLineInput {
  planId: string
  category: string
  department?: string
  lineType: "expense" | "revenue" | "cogs"
  lineSubtype?: string
  plannedAmount: number
  forecastAmount?: number
  unitPrice?: number
  unitCost?: number
  quantity?: number
  costModelKey?: string
  isAutoActual?: boolean
  notes?: string
  parentId?: string
}

export interface UpdateBudgetLineInput {
  id: string
  planId: string
  category?: string
  department?: string
  lineType?: "expense" | "revenue" | "cogs"
  lineSubtype?: string
  plannedAmount?: number
  forecastAmount?: number
  unitPrice?: number
  unitCost?: number
  quantity?: number
  costModelKey?: string
  isAutoActual?: boolean
  notes?: string
  parentId?: string | null
}

export interface CreateBudgetActualInput {
  planId: string
  category: string
  department?: string
  lineType: "expense" | "revenue" | "cogs"
  actualAmount: number
  expenseDate?: string
  description?: string
}

export interface UpdateBudgetActualInput {
  actualAmount?: number
  category?: string
  department?: string
  lineType?: "expense" | "revenue" | "cogs"
  expenseDate?: string
  description?: string
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Payroll",
  "Back office",
  "IT Infrastructure",
  "Overhead",
  "Risk reserve",
  "Miscellaneous",
  "GRC direct costs",
  "Office rent",
  "Software licenses",
  "Business travel",
  "Marketing",
]

export const DEFAULT_REVENUE_CATEGORIES = [
  "Service revenue",
  "Permanent IT",
  "InfoSec",
  "ERP",
  "HelpDesk",
  "Other services",
]

export interface BudgetSection {
  id: string
  organizationId: string
  planId: string
  name: string
  sectionType: "revenue" | "expense" | "cogs" | "gross_profit" | "ebitda"
  sortOrder: number
  createdAt: string
}

export interface BudgetForecastEntry {
  id: string
  organizationId: string
  planId: string
  month: number
  year: number
  category: string
  lineType: string
  forecastAmount: number
  createdAt: string
  updatedAt: string
}

export const SECTION_TYPES = [
  { value: "revenue", label: "Revenue" },
  { value: "cogs", label: "Cost of Goods Sold (COGS)" },
  { value: "expense", label: "Expenses" },
  { value: "gross_profit", label: "Gross profit (calculated)" },
  { value: "ebitda", label: "EBITDA (calculated)" },
]

export interface BudgetDirectionTemplate {
  id: string
  organizationId: string
  name: string
  description?: string | null
  lineType: "revenue" | "expense" | "cogs"
  lineSubtype?: string | null
  defaultAmount: number
  unitPrice?: number | null
  unitCost?: number | null
  quantity?: number | null
  costModelKey?: string | null
  department?: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateTemplateInput {
  name: string
  description?: string
  lineType: "revenue" | "expense" | "cogs"
  lineSubtype?: string
  defaultAmount?: number
  unitPrice?: number
  unitCost?: number
  quantity?: number
  costModelKey?: string
  department?: string
}

export interface UpdateTemplateInput {
  name?: string
  description?: string
  lineType?: "revenue" | "expense" | "cogs"
  lineSubtype?: string
  defaultAmount?: number
  unitPrice?: number
  unitCost?: number
  quantity?: number
  costModelKey?: string
  department?: string
  isActive?: boolean
}

export const DEPARTMENTS = [
  "IT",
  "InfoSec",
  "ERP",
  "BackOffice",
  "GRC",
  "All",
]

// ─── Report Builder types ─────────────────────────────────────

export interface SavedBudgetReport {
  id: string
  organizationId: string
  createdBy?: string | null
  name: string
  description?: string | null
  entityType: string
  planId?: string | null
  columns: { field: string; label?: string; aggregate?: "count" | "sum" | "avg" | "min" | "max" }[]
  filters: { field: string; op: string; value: any }[]
  groupBy?: string | null
  periodGroupBy?: "month" | "quarter" | "year" | null
  sortBy?: string | null
  sortOrder: string
  chartType: string
  chartConfig?: any
  computedFields?: string[] | null
  isShared: boolean
  createdAt: string
  updatedAt: string
}
