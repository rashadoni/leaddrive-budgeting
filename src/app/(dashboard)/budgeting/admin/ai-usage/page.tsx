/**
 * Phase 7.B v2 Day 6 — admin dashboard for LLM token usage.
 *
 * Reads `/api/admin/ai-usage` and surfaces:
 *   - Today's tokens (in + out + calls)
 *   - Month-to-date aggregate
 *   - Daily / monthly budget caps + remaining
 *   - 30-day total-tokens-per-day sparkline
 *   - Over-budget warning chip when applicable
 *
 * Admin-gated by the route group middleware + the underlying API.
 */

import { AIUsageAdmin } from "@/features/admin/components/AIUsageAdmin"

export const metadata = {
  title: "AI Usage · BudgetPro",
}

export default function AIUsageAdminPage() {
  return <AIUsageAdmin />
}
