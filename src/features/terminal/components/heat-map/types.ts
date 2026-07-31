/**
 * HeatMap matrix row/col/response types — extracted from HeatMap.tsx (Phase 8
 * D1 2026-05-29) so both the main component and the per-cell renderer
 * (HeatMapCellTd) can share them without an import cycle. Pure types.
 */

import type { HeatMapCell } from "@/lib/risk/heatmap-matrix";

export type CompanyRow = {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  /** Set true on sub-group rollup rows (Turn 33.5); leaf ops cos omit. */
  isSubgroup?: boolean;
  /** CLI follow-up — surfaces hierarchy so CompanyTree can derive parent
   *  composite from children's averages. Null for root-level entities. */
  parentCompanyId?: string | null;
};
export type IndicatorCol = {
  id: string;
  code: string;
  nameEn: string;
  nameAz?: string | null;
  nameRu?: string | null;
  direction: string;
  unit: string;
  /** CLI Tier 2 — used to compute "N/A" cells (indicator not applicable to
   *  this company's industry) distinct from "unknown" (applicable but no
   *  data). Empty array = sector-agnostic, applies to every operational co. */
  industries?: string[];
  /**
   * 11.66 — the formula's input families, e.g. `budgetLine.cogs`,
   * `commodityPrice:sugar_no11`, `weather:salyan_rainfall_14d`. Already
   * selected by the matrix route and already on the wire; the type simply
   * never said so. Drives `indicatorProvenance` — which tiles light up from
   * a market feed rather than the client's own reported data, and which are
   * constants that must not enter a risk score.
   *
   * Optional because ABSENT is not EMPTY: a caller that omits it means
   * "unknown", and the classifier must not read that as "no inputs" and
   * silently drop the indicator out of every composite.
   */
  requiredInputs?: string[] | null;
};
export type MatrixResponse = {
  period: string;
  companies: CompanyRow[];
  indicators: IndicatorCol[];
  cells: HeatMapCell[];
};
