// Shared chart theme for budgeting infographics

export const BUDGET_COLORS = {
  // Plan/Budget
  planIndigo: "#6366f1",
  planViolet: "#8b5cf6",
  // Forecast
  forecastAmber: "#f59e0b",
  forecastOrange: "#f97316",
  // Actual
  actualGreen: "#10b981",
  actualEmerald: "#22c55e",
  // Expenses
  expensePlan: "#818cf8",
  expenseActual: "#f97316",
  // Revenue
  revenuePlan: "#8b5cf6",
  revenueActual: "#10b981",
  // Status
  positive: "#10b981",
  negative: "#ef4444",
  warning: "#f59e0b",
  neutral: "#6b7280",
  // Comparison
  comparison: ["#6366f1", "#22c55e", "#f59e0b", "#ef4444"],
  // Pie
  pie: ["#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#22c55e", "#f59e0b", "#f97316"],
} as const

export const ANIMATION = {
  duration: 800,
  easing: "ease-out" as const,
}

export const GRID_STYLE = {
  strokeDasharray: "3 3",
  className: "stroke-muted-foreground/20",
  horizontal: true,
  vertical: false,
}

export const AXIS_TICK = {
  fontSize: 11,
  fill: "#94a3b8", // slate-400, works in both modes
}

export function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M"
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + "k"
  return String(Math.round(v))
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString() + " ₼"
}

export function calcVariance(plan: number, actual: number) {
  const amount = actual - plan
  const pct = plan !== 0 ? (amount / plan) * 100 : 0
  const direction: "over" | "under" | "on" =
    Math.abs(pct) < 1 ? "on" : pct > 0 ? "over" : "under"
  return { amount, pct, direction }
}

/** SVG gradient defs for horizontal bars (left → right) */
export function HBarGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor={color} stopOpacity={0.7} />
      <stop offset="100%" stopColor={color} stopOpacity={1} />
    </linearGradient>
  )
}

/** SVG gradient defs for vertical bars (top → bottom) */
export function VBarGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={1} />
      <stop offset="100%" stopColor={color} stopOpacity={0.7} />
    </linearGradient>
  )
}
