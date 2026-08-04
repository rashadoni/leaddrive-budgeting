/**
 * Phase 7.G CLI Tier 3 — Risk Matrix PDF export.
 *
 * Multi-page board pack for the CFO to forward / print / archive.
 * Pages:
 *   1. Cover — org name, period, generation timestamp, holding-level
 *      composite snapshot (totals: green/amber/red/unknown counts)
 *   2. Today's Brief — top-3 worst red, top-3 movers, top-3 alerts
 *   3. Risk Matrix table — companies × indicators with status glyphs
 *      (color-blind safe ●/▲/■/◇ + cell color), values inline
 *   4. Per-company breakdown — for each operational company:
 *      composite score, applicable indicators with values
 *   5. Legend & methodology footer
 *
 * Uses @react-pdf/renderer (already in deps; see variance-explanation-pdf.tsx
 * for the canonical pattern).
 */

import { hasEvidencedValue } from "@/lib/risk/heatmap-matrix";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// CLI Tier 3 follow-up — Helvetica (default) lacks Cyrillic + Azerbaijani
// extended Latin glyphs. Register Roboto (TTF served from /public/fonts/)
// which covers Latin + Cyrillic + Latin Extended (ə, ğ, ş diacritics).
// Without this, RU/AZ headers render as garbage like "5@8>4" instead
// of "Период". Idempotent: react-pdf no-ops repeat registrations.
if (typeof window !== "undefined") {
  Font.register({
    family: "Roboto",
    fonts: [
      { src: `${window.location.origin}/fonts/Roboto-Regular.ttf` },
      { src: `${window.location.origin}/fonts/Roboto-Bold.ttf`, fontWeight: 700 },
    ],
  });
}

export interface MatrixCell {
  companyId: string;
  indicatorId: string;
  value: number;
  status: "green" | "amber" | "red" | "unknown";
  sparkline?: (number | null)[];
}
export interface MatrixCompany {
  id: string;
  code: string;
  name: string;
  industry?: string | null;
}
export interface MatrixIndicator {
  id: string;
  code: string;
  nameEn: string;
  nameRu?: string | null;
  unit: string;
  direction: "higher_better" | "lower_better" | "band";
  industries?: string[];
}
export interface CompositeRow {
  code: string;
  name: string;
  score: number | null;
  contributingCount: number;
  totalCount: number;
}

/**
 * 11.81 — the two coverage-floor strings. This document renders outside the
 * next-intl provider (react-pdf runs in a worker-ish context and the file
 * carries its own per-language dictionary from before the catalogues existed),
 * so the caller — which DOES have `useTranslations` — resolves them and passes
 * them in. That keeps the new copy in `messages/{en,az,ru}.json` with every
 * other string rather than adding a fourth hand-maintained translation table.
 */
export interface CompositeCoverageTexts {
  notScoredLabel: string;
  minCellsNote: string;
}

export interface RiskMatrixPdfProps {
  orgName: string;
  period: string;
  generatedAt: string;
  language: "en" | "ru" | "az";
  companies: MatrixCompany[];
  indicators: MatrixIndicator[];
  cells: MatrixCell[];
  composites: CompositeRow[];
  coverageTexts?: CompositeCoverageTexts;
  brief: {
    worst: Array<{ companyCode: string; indicatorCode: string; value: number; unit: string }>;
    movers: Array<{ companyCode: string; indicatorCode: string; deltaPct: number }>;
    alerts: Array<{ ruleId: string; message: string }>;
  };
}

const STATUS_HEX = {
  green: "#00A36C",
  amber: "#D97706",
  red: "#DC2626",
  unknown: "#9CA3AF",
} as const;

// CLI Tier 3 follow-up — Roboto core (Latin+Cyrillic) lacks U+25CF/B2/A0/C7
// geometric shapes. In PDF context the color carries the status signal
// reliably (color-blind safety in PDF is less critical than on-screen
// where the M7 sweep guard fires). Use text-only status markers that
// every font ships with.
const STATUS_GLYPH = {
  green: "OK",
  amber: "!",
  red: "X",
  unknown: "?",
} as const;
// Direction markers in headers — same constraint. Use Roboto-safe arrows
// (↑↓) which are in Latin Extended Additional + Cyrillic supplement.
const DIRECTION_GLYPH = {
  higher_better: "↑",
  lower_better: "↓",
  band: "≈",
} as const;

/** Cell status → I18N dict key. Keeps the Per-Company Breakdown status
 *  column speaking the same language as the legend page. */
const STATUS_LABEL_KEY = {
  green: "healthy",
  amber: "watch",
  red: "critical",
  unknown: "nodata",
} as const;

const I18N: Record<RiskMatrixPdfProps["language"], Record<string, string>> = {
  en: {
    coverTitle: "Risk Matrix Report",
    period: "Period",
    generated: "Generated",
    healthy: "Healthy",
    watch: "Watch",
    critical: "Critical",
    nodata: "No data",
    todayBrief: "Today's Brief",
    worstHeader: "Top 3 worst",
    moversHeader: "Top 3 movers (12-mo trend)",
    alertsHeader: "Active alerts",
    matrixHeader: "Risk Matrix",
    perCompany: "Per-Company Breakdown",
    composite: "Composite",
    indicator: "Indicator",
    value: "Value",
    status: "Status",
    legendTitle: "Legend & Methodology",
    legendComposite: "Composite Risk Score (0–100)",
    legendDirection: "Indicator direction",
    higherBetter: "Higher = better",
    lowerBetter: "Lower = better",
    bandTarget: "Target band",
    legendStatus: "Status thresholds",
    legendUnits: "Common units",
    unitPct: "Percentage (margins, ratios)",
    unitAzn: "Azerbaijani Manat",
    unitRatio: "Ratio (e.g. operating leverage)",
    unitIndex: "Index (HHI 0–10000)",
    footnote:
      "Computed values are derived from BudgetLine + CashFlowEntry + BalanceSheetLine source data via the FormulaEngine.",
    page: "Page",
  },
  ru: {
    coverTitle: "Отчёт Risk Matrix",
    period: "Период",
    generated: "Сгенерировано",
    healthy: "Здорово",
    watch: "Контроль",
    critical: "Критично",
    nodata: "Нет данных",
    todayBrief: "Сводка дня",
    worstHeader: "Топ-3 худших",
    moversHeader: "Топ-3 движений (12-мес тренд)",
    alertsHeader: "Активные алёрты",
    matrixHeader: "Матрица рисков",
    perCompany: "Детализация по компаниям",
    composite: "Композит",
    indicator: "Индикатор",
    value: "Значение",
    status: "Статус",
    legendTitle: "Легенда и методология",
    legendComposite: "Composite Risk Score (0–100)",
    legendDirection: "Направление индикатора",
    higherBetter: "Выше = лучше",
    lowerBetter: "Ниже = лучше",
    bandTarget: "Целевой коридор",
    legendStatus: "Пороги статусов",
    legendUnits: "Единицы измерения",
    unitPct: "Процент (маржа, коэффициенты)",
    unitAzn: "Азербайджанский манат",
    unitRatio: "Коэффициент (напр. операционный рычаг)",
    unitIndex: "Индекс (HHI 0–10000)",
    footnote:
      "Вычисленные значения получены из BudgetLine + CashFlowEntry + BalanceSheetLine через FormulaEngine.",
    page: "Страница",
  },
  az: {
    coverTitle: "Risk Matrix Hesabatı",
    period: "Dövr",
    generated: "Yaradıldı",
    healthy: "Sağlam",
    watch: "Diqqət",
    critical: "Kritik",
    nodata: "Məlumat yox",
    todayBrief: "Bu günkü icmal",
    worstHeader: "Top 3 ən pis",
    moversHeader: "Top 3 dəyişən (12-ay trend)",
    alertsHeader: "Aktiv xəbərdarlıqlar",
    matrixHeader: "Risk matrisi",
    perCompany: "Şirkətlər üzrə detal",
    composite: "Kompozit",
    indicator: "İndikator",
    value: "Dəyər",
    status: "Status",
    legendTitle: "Leqenda və metodologiya",
    legendComposite: "Composite Risk Score (0–100)",
    legendDirection: "İndikator istiqaməti",
    higherBetter: "Yuxarı = yaxşı",
    lowerBetter: "Aşağı = yaxşı",
    bandTarget: "Hədəf zolaq",
    legendStatus: "Status hədləri",
    legendUnits: "Vahidlər",
    unitPct: "Faiz (marja, nisbətlər)",
    unitAzn: "Azərbaycan manatı",
    unitRatio: "Nisbət (məs. əməliyyat leverajı)",
    unitIndex: "İndeks (HHI 0–10000)",
    footnote:
      "Hesablanan dəyərlər BudgetLine + CashFlowEntry + BalanceSheetLine mənbələrindən FormulaEngine vasitəsilə alınır.",
    page: "Səhifə",
  },
};

const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9, padding: 28, color: "#1f2937" },
  coverHeader: { fontSize: 18, fontWeight: "bold", color: "#0A0E27", marginBottom: 6 },
  coverSubtitle: { fontSize: 11, color: "#4B5563", marginBottom: 4 },
  coverGrid: { marginTop: 22, padding: 12, border: "1pt solid #E5E7EB", borderRadius: 6 },
  coverGridRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  coverGridLabel: { color: "#6B7280", fontSize: 10 },
  coverGridValue: { fontWeight: "bold", fontSize: 10 },
  countersRow: { flexDirection: "row", marginTop: 18, gap: 8 },
  counter: { flex: 1, padding: 8, borderRadius: 4, alignItems: "center" },
  counterValue: { fontSize: 22, fontWeight: "bold" },
  counterLabel: { fontSize: 8, marginTop: 2 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", color: "#0A0E27", marginTop: 14, marginBottom: 6 },
  briefRow: { flexDirection: "row", marginBottom: 3, fontSize: 9 },
  briefLeft: { width: 80, fontFamily: "Roboto", color: "#3B82F6" },
  briefMid: { flex: 1, color: "#374151" },
  briefRight: { width: 80, textAlign: "right", fontFamily: "Roboto" },
  matrixTable: { marginTop: 8 },
  matrixHeaderRow: { flexDirection: "row", borderBottom: "1pt solid #6B7280", paddingBottom: 2 },
  matrixHeaderCell: { fontSize: 7, fontFamily: "Roboto", color: "#6B7280", textAlign: "center", paddingHorizontal: 2 },
  matrixCoCol: { width: 90 },
  matrixIndCol: { flex: 1, paddingHorizontal: 2, minWidth: 56 },
  matrixRow: { flexDirection: "row", borderBottom: "0.5pt solid #E5E7EB", paddingVertical: 2 },
  matrixCoCell: { width: 90, fontSize: 8, fontFamily: "Roboto", color: "#1f2937", paddingRight: 4 },
  matrixCell: { flex: 1, fontSize: 7, fontFamily: "Roboto", textAlign: "center", paddingHorizontal: 2, minWidth: 56 },
  perCoBlock: { marginTop: 10, padding: 6, border: "0.5pt solid #E5E7EB", borderRadius: 3 },
  perCoTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 4 },
  perCoMeta: { fontSize: 8, color: "#6B7280", marginBottom: 4 },
  perCoTableRow: { flexDirection: "row", paddingVertical: 1.5 },
  perCoTableCellLabel: { width: 200, fontSize: 8, fontFamily: "Roboto" },
  perCoTableCellValue: { width: 90, fontSize: 8, fontFamily: "Roboto", textAlign: "right" },
  perCoTableCellStatus: { width: 60, fontSize: 8, textAlign: "center" },
  legendBlock: { marginTop: 8, padding: 6 },
  legendItem: { flexDirection: "row", marginBottom: 2, fontSize: 9 },
  legendBadge: { width: 60, fontFamily: "Roboto" },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 28,
    right: 28,
    fontSize: 7,
    color: "#9CA3AF",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function bandFromScore(score: number | null): "green" | "amber" | "red" | "unknown" {
  if (score === null) return "unknown";
  if (score >= 67) return "green";
  if (score >= 34) return "amber";
  return "red";
}

function formatVal(v: number, unit: string): string {
  if (!Number.isFinite(v)) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  if (unit === "ratio") return v.toFixed(2);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(abs >= 10 ? 0 : 1);
}

export function RiskMatrixPdfDoc(props: RiskMatrixPdfProps) {
  const t = I18N[props.language];
  const counters = props.cells.reduce(
    (acc, c) => {
      acc[c.status]++;
      return acc;
    },
    { green: 0, amber: 0, red: 0, unknown: 0 } as Record<string, number>,
  );

  // Pre-build cell lookup for matrix rendering
  const cellByPair = new Map(
    props.cells.map((c) => [`${c.companyId}_${c.indicatorId}`, c]),
  );
  // For matrix grid we cap indicator count per page (~9) so each column has
  // ~70-90pt for the code label + value (landscape A4 = ~770pt usable width
  // minus 90pt company column).
  const INDS_PER_PAGE = 9;
  const indicatorPages: MatrixIndicator[][] = [];
  for (let i = 0; i < props.indicators.length; i += INDS_PER_PAGE) {
    indicatorPages.push(props.indicators.slice(i, i + INDS_PER_PAGE));
  }

  return (
    <Document title={`${t.coverTitle} ${props.orgName} ${props.period}`}>
      {/* PAGE 1 — COVER + COUNTERS */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverHeader}>{t.coverTitle}</Text>
        <Text style={styles.coverSubtitle}>{props.orgName}</Text>

        <View style={styles.coverGrid}>
          <View style={styles.coverGridRow}>
            <Text style={styles.coverGridLabel}>{t.period}</Text>
            <Text style={styles.coverGridValue}>{props.period}</Text>
          </View>
          <View style={styles.coverGridRow}>
            <Text style={styles.coverGridLabel}>{t.generated}</Text>
            <Text style={styles.coverGridValue}>{props.generatedAt}</Text>
          </View>
        </View>

        <View style={styles.countersRow}>
          <View style={[styles.counter, { backgroundColor: STATUS_HEX.green + "22", borderColor: STATUS_HEX.green, borderWidth: 1 }]}>
            <Text style={[styles.counterValue, { color: STATUS_HEX.green }]}>{counters.green}</Text>
            <Text style={[styles.counterLabel, { color: STATUS_HEX.green }]}>{t.healthy}</Text>
          </View>
          <View style={[styles.counter, { backgroundColor: STATUS_HEX.amber + "22", borderColor: STATUS_HEX.amber, borderWidth: 1 }]}>
            <Text style={[styles.counterValue, { color: STATUS_HEX.amber }]}>{counters.amber}</Text>
            <Text style={[styles.counterLabel, { color: STATUS_HEX.amber }]}>{t.watch}</Text>
          </View>
          <View style={[styles.counter, { backgroundColor: STATUS_HEX.red + "22", borderColor: STATUS_HEX.red, borderWidth: 1 }]}>
            <Text style={[styles.counterValue, { color: STATUS_HEX.red }]}>{counters.red}</Text>
            <Text style={[styles.counterLabel, { color: STATUS_HEX.red }]}>{t.critical}</Text>
          </View>
          <View style={[styles.counter, { backgroundColor: STATUS_HEX.unknown + "22", borderColor: STATUS_HEX.unknown, borderWidth: 1 }]}>
            <Text style={[styles.counterValue, { color: STATUS_HEX.unknown }]}>{counters.unknown}</Text>
            <Text style={[styles.counterLabel, { color: STATUS_HEX.unknown }]}>{t.nodata}</Text>
          </View>
        </View>

        {/* Today's Brief inline on cover */}
        <Text style={styles.sectionTitle}>{t.todayBrief}</Text>

        <Text style={[styles.sectionTitle, { fontSize: 10, color: STATUS_HEX.red }]}>{t.worstHeader}</Text>
        {props.brief.worst.length === 0 ? (
          <Text style={{ color: "#9CA3AF", fontSize: 9 }}>—</Text>
        ) : (
          props.brief.worst.map((w, i) => (
            <View key={i} style={styles.briefRow}>
              <Text style={styles.briefLeft}>{w.companyCode}</Text>
              <Text style={styles.briefMid}>{w.indicatorCode}</Text>
              <Text style={[styles.briefRight, { color: STATUS_HEX.red }]}>{formatVal(w.value, w.unit)}</Text>
            </View>
          ))
        )}

        <Text style={[styles.sectionTitle, { fontSize: 10, color: STATUS_HEX.amber }]}>{t.moversHeader}</Text>
        {props.brief.movers.length === 0 ? (
          <Text style={{ color: "#9CA3AF", fontSize: 9 }}>—</Text>
        ) : (
          props.brief.movers.map((m, i) => (
            <View key={i} style={styles.briefRow}>
              <Text style={styles.briefLeft}>{m.companyCode}</Text>
              <Text style={styles.briefMid}>{m.indicatorCode}</Text>
              <Text style={[styles.briefRight, { color: m.deltaPct > 0 ? STATUS_HEX.green : STATUS_HEX.red }]}>
                {m.deltaPct > 0 ? "+" : ""}{m.deltaPct.toFixed(1)}%
              </Text>
            </View>
          ))
        )}

        <Text style={[styles.sectionTitle, { fontSize: 10, color: STATUS_HEX.amber }]}>{t.alertsHeader}</Text>
        {props.brief.alerts.length === 0 ? (
          <Text style={{ color: "#9CA3AF", fontSize: 9 }}>—</Text>
        ) : (
          props.brief.alerts.map((a, i) => (
            <View key={i} style={styles.briefRow}>
              <Text style={styles.briefLeft}>{a.ruleId}</Text>
              <Text style={styles.briefMid}>{a.message.slice(0, 100)}</Text>
            </View>
          ))
        )}

        <View style={styles.footer} fixed>
          <Text>{props.orgName} · {props.period}</Text>
          <Text render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* PAGE 2+ — RISK MATRIX (paginated by indicator chunks) */}
      {indicatorPages.map((indChunk, pageIdx) => (
        <Page size="A4" orientation="landscape" style={styles.page} key={`mtx-${pageIdx}`}>
          <Text style={styles.coverHeader}>{t.matrixHeader}</Text>
          <Text style={styles.coverSubtitle}>{props.period} · {pageIdx + 1}/{indicatorPages.length}</Text>

          <View style={styles.matrixTable}>
            <View style={styles.matrixHeaderRow}>
              <Text style={[styles.matrixHeaderCell, styles.matrixCoCol, { textAlign: "left" }]}>CO</Text>
              {indChunk.map((ind) => (
                <Text key={ind.id} style={[styles.matrixHeaderCell, styles.matrixIndCol]}>
                  {DIRECTION_GLYPH[ind.direction]} {ind.code}
                </Text>
              ))}
            </View>
            {props.companies.map((co) => (
              <View key={co.id} style={styles.matrixRow}>
                <Text style={styles.matrixCoCell}>{co.code}</Text>
                {indChunk.map((ind) => {
                  const cell = cellByPair.get(`${co.id}_${ind.id}`);
                  if (!cell) {
                    const isApplicable =
                      !ind.industries ||
                      ind.industries.length === 0 ||
                      (co.industry && ind.industries.includes(co.industry));
                    return (
                      <Text key={ind.id} style={[styles.matrixCell, { color: isApplicable ? "#9CA3AF" : "#E5E7EB" }]}>
                        {isApplicable ? STATUS_GLYPH.unknown : "·"}
                      </Text>
                    );
                  }
                  return (
                    <Text
                      key={ind.id}
                      style={[
                        styles.matrixCell,
                        { color: STATUS_HEX[cell.status], fontWeight: "bold" },
                      ]}
                    >
                      {/* 2026-08-04 audit — an unscored cell stores a value,
                          almost always 0. This PDF goes to a board and outlives
                          the session, and it was printing "0.0" where the live
                          HeatMap prints "—". For a concentration or leverage
                          indicator 0.0 is the best possible reading. */}
                      {hasEvidencedValue(cell.status, cell.value)
                        ? formatVal(cell.value, ind.unit)
                        : "—"}
                    </Text>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.footer} fixed>
            <Text>{props.orgName} · {props.period}</Text>
            <Text render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber} / ${totalPages}`} />
          </View>
        </Page>
      ))}

      {/* PAGE LAST — PER-COMPANY BREAKDOWN */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverHeader}>{t.perCompany}</Text>
        {props.composites.map((comp) => {
          const co = props.companies.find((c) => c.code === comp.code);
          if (!co) return null;
          const coCells = props.cells
            .filter((cell) => cell.companyId === co.id)
            .map((cell) => {
              const ind = props.indicators.find((i) => i.id === cell.indicatorId);
              return ind ? { ind, cell } : null;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          const band = bandFromScore(comp.score);
          return (
            <View key={comp.code} style={styles.perCoBlock} wrap={false}>
              <Text style={styles.perCoTitle}>
                {co.code} · {co.name}{" "}
                <Text style={{ color: STATUS_HEX[band], fontSize: 10 }}>
                  R{comp.score ?? "—"}
                </Text>
              </Text>
              {/* 11.81 — already the best-behaved consumer: R— in grey with
                  the coverage line intact. It gains the sentence that says
                  what the dash means. */}
              <Text style={styles.perCoMeta}>
                {co.industry ?? ""} · {comp.contributingCount}/{comp.totalCount} {t.indicator.toLowerCase()}
                {comp.score === null && props.coverageTexts
                  ? ` · ${props.coverageTexts.notScoredLabel}`
                  : ""}
              </Text>
              {coCells.length === 0 ? (
                <Text style={{ color: "#9CA3AF", fontSize: 9 }}>—</Text>
              ) : (
                coCells.slice(0, 12).map(({ ind, cell }) => (
                  <View key={ind.id} style={styles.perCoTableRow}>
                    <Text style={styles.perCoTableCellLabel}>
                      {DIRECTION_GLYPH[ind.direction]} {ind.code}
                    </Text>
                    <Text style={styles.perCoTableCellValue}>
                      {hasEvidencedValue(cell.status, cell.value)
                        ? formatVal(cell.value, ind.unit)
                        : "—"}
                    </Text>
                    {/* Was `cell.status.toUpperCase()` — printed GREEN /
                        AMBER / RED in every language while the legend page
                        of the same PDF said Sağlam / Diqqət / Kritik. */}
                    <Text style={[styles.perCoTableCellStatus, { color: STATUS_HEX[cell.status] }]}>
                      {t[STATUS_LABEL_KEY[cell.status]]}
                    </Text>
                  </View>
                ))
              )}
            </View>
          );
        })}

        {/* 11.81 — the methodology sentence, once per document. */}
        {props.coverageTexts && (
          <Text style={{ color: "#6B7280", fontSize: 8, marginTop: 8 }}>
            {props.coverageTexts.minCellsNote}
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>{props.orgName} · {props.period}</Text>
          <Text render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* PAGE LAST+1 — LEGEND */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.coverHeader}>{t.legendTitle}</Text>

        <Text style={styles.sectionTitle}>{t.legendComposite}</Text>
        <View style={styles.legendItem}>
          <Text style={[styles.legendBadge, { color: STATUS_HEX.green }]}>R67–100</Text>
          <Text>{t.healthy}</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={[styles.legendBadge, { color: STATUS_HEX.amber }]}>R34–66</Text>
          <Text>{t.watch}</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={[styles.legendBadge, { color: STATUS_HEX.red }]}>R0–33</Text>
          <Text>{t.critical}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t.legendDirection}</Text>
        <View style={styles.legendItem}>
          <Text style={styles.legendBadge}>{DIRECTION_GLYPH.higher_better}</Text>
          <Text>{t.higherBetter}</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendBadge}>{DIRECTION_GLYPH.lower_better}</Text>
          <Text>{t.lowerBetter}</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendBadge}>{DIRECTION_GLYPH.band}</Text>
          <Text>{t.bandTarget}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t.legendUnits}</Text>
        <View style={styles.legendItem}><Text style={styles.legendBadge}>%</Text><Text>{t.unitPct}</Text></View>
        <View style={styles.legendItem}><Text style={styles.legendBadge}>AZN ₼</Text><Text>{t.unitAzn}</Text></View>
        <View style={styles.legendItem}><Text style={styles.legendBadge}>ratio</Text><Text>{t.unitRatio}</Text></View>
        <View style={styles.legendItem}><Text style={styles.legendBadge}>index</Text><Text>{t.unitIndex}</Text></View>

        <Text style={[styles.sectionTitle, { fontSize: 9, color: "#6B7280" }]}>{t.footnote}</Text>

        <View style={styles.footer} fixed>
          <Text>{props.orgName} · {props.period}</Text>
          <Text render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
