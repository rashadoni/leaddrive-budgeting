"use client";

/**
 * Backward-compatible cache reset seam for the HeatMap SSE path.
 *
 * Inline hover summaries were removed because pointer movement must never
 * trigger a paid provider call. AI explanations remain available through the
 * explicit Explain/Re-run controls in IndicatorDetail/VarianceExplainerPanel.
 * Keeping this no-op export avoids coupling the SSE refresh path to that UI
 * decision and preserves the existing public import used by tests.
 */
export function clearAISummaryCache(): void {
  // Intentionally empty: there is no implicit AI-summary cache anymore.
}
