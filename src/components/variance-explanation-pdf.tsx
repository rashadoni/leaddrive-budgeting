/**
 * Phase 7.G Turn LXXXX (Phase 7.E #2 v2 E.1e) — Variance Explanation PDF.
 *
 * React-PDF document for exporting a single VarianceExplainer output as a
 * shareable 1-page report. CFO uses this to forward the AI's "why is this
 * red + 3 actions" to a colleague / sub-group GM without copy-paste.
 *
 * Rendered on-demand via `pdf(<VarianceExplanationPdfDoc .../>).toBlob()`
 * inside `VarianceExplainerPanel.tsx` (E.1d follow-up). Mirror of
 * `ai-chat-pdf.tsx` styling so brand consistency holds across all AI
 * exports.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import { tagRecommendation, RECOMMENDATION_TAG_LABEL, type RecommendationTag } from "@/lib/risk/recommendation-tags"

export type VarianceExplanationPdfProps = {
  /** Indicator code + display name (e.g. "REV_GROWTH" / "Revenue Growth"). */
  indicatorCode: string
  indicatorName: string
  /** Company name (display only). */
  companyName: string
  /** Period as in DB ("2026" / "2026-Q3" / "2026-04"). */
  period: string
  /** Computed value + status. */
  value: number
  unit: string
  status: "amber" | "red" | "unknown"
  /** Output language hint for label localization. */
  language: "en" | "ru" | "az"
  /** AI narrative — 1-2 sentences. */
  narrative: string
  /** Up to 3 actionable recommendations (CFO-readable verbs). */
  recommendations: string[]
  /** Top-3 input-field names the LLM judged most load-bearing. */
  topDrivers: string[]
  /** LLM self-rated confidence (0..1). */
  confidence: number
  /** Model id for attestation footer. */
  modelName: string
  /** Hand-bumped prompt version. */
  promptVersion: string
  /** ISO timestamp generated. */
  generatedAt?: string
}

const STATUS_COLOR: Record<VarianceExplanationPdfProps["status"], string> = {
  red: "#DC2626",
  amber: "#D97706",
  unknown: "#6B7280",
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: 40,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.5,
  },
  header: {
    borderBottom: "1pt solid #E5E7EB",
    paddingBottom: 14,
    marginBottom: 22,
  },
  brand: {
    fontSize: 9,
    color: "#7C3AED",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 10,
    color: "#6B7280",
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 22,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#F9FAFB",
    borderRadius: 4,
  },
  metricValue: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    marginRight: 10,
  },
  metricLabel: {
    fontSize: 11,
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statusPill: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    color: "white",
    marginLeft: "auto",
  },
  sectionHeading: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: 18,
    marginBottom: 8,
  },
  narrative: {
    fontSize: 11,
    lineHeight: 1.55,
    color: "#1F2937",
    marginBottom: 6,
  },
  recommendationItem: {
    flexDirection: "row",
    marginBottom: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#FAFAFA",
    borderLeft: "3pt solid #7C3AED",
  },
  recommendationNumber: {
    fontFamily: "Helvetica-Bold",
    color: "#7C3AED",
    width: 18,
    fontSize: 10,
  },
  recommendationText: {
    flex: 1,
    fontSize: 10,
  },
  recommendationTag: {
    fontSize: 8,
    color: "#6B7280",
    fontFamily: "Helvetica-Oblique",
    marginLeft: 6,
    paddingTop: 1,
  },
  driverRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  driverChip: {
    fontSize: 9,
    paddingVertical: 3,
    paddingHorizontal: 7,
    backgroundColor: "#EEF2FF",
    color: "#4338CA",
    borderRadius: 10,
    marginRight: 6,
    marginBottom: 4,
  },
  footer: {
    marginTop: 28,
    paddingTop: 12,
    borderTop: "0.5pt solid #E5E7EB",
    fontSize: 7,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 1.4,
  },
})

const formatValue = (v: number, unit: string): string => {
  if (Number.isNaN(v)) return "—"
  const abs = Math.abs(v)
  const fmt = abs >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(2)
  return `${fmt} ${unit}`.trim()
}

const tagLabel = (tag: RecommendationTag, lang: "en" | "ru" | "az"): string =>
  RECOMMENDATION_TAG_LABEL[tag][lang]

export function VarianceExplanationPdfDoc(props: VarianceExplanationPdfProps) {
  const sectionTitles = {
    en: { ai: "AI ANALYSIS", drivers: "TOP DRIVERS", recs: "RECOMMENDED ACTIONS" },
    ru: { ai: "AI АНАЛИЗ", drivers: "КЛЮЧЕВЫЕ ДРАЙВЕРЫ", recs: "РЕКОМЕНДОВАННЫЕ ДЕЙСТВИЯ" },
    az: { ai: "AI TƏHLİL", drivers: "ƏSAS DRAYVERLƏR", recs: "TÖVSİYƏ OLUNAN HƏRƏKƏTLƏR" },
  }
  const titles = sectionTitles[props.language]

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>BudgetPro · Variance Explainer</Text>
          <Text style={styles.title}>{props.indicatorName}</Text>
          <Text style={styles.subtitle}>
            {props.companyName} · {props.period} · {props.indicatorCode}
          </Text>
        </View>

        {/* Metric strip */}
        <View style={styles.metricRow}>
          <Text style={styles.metricValue}>{formatValue(props.value, props.unit)}</Text>
          <Text style={styles.metricLabel}>{props.indicatorName}</Text>
          <Text
            style={{
              ...styles.statusPill,
              backgroundColor: STATUS_COLOR[props.status],
            }}
          >
            {props.status.toUpperCase()}
          </Text>
        </View>

        {/* AI Narrative */}
        <Text style={styles.sectionHeading}>{titles.ai}</Text>
        <Text style={styles.narrative}>{props.narrative}</Text>

        {/* Top Drivers */}
        {props.topDrivers.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>{titles.drivers}</Text>
            <View style={styles.driverRow}>
              {props.topDrivers.map((d, i) => (
                <Text key={i} style={styles.driverChip}>
                  {d}
                </Text>
              ))}
            </View>
          </>
        )}

        {/* Recommendations */}
        {props.recommendations.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>{titles.recs}</Text>
            {props.recommendations.map((r, i) => {
              const tag = tagRecommendation(r)
              return (
                <View key={i} style={styles.recommendationItem}>
                  <Text style={styles.recommendationNumber}>{i + 1}.</Text>
                  <Text style={styles.recommendationText}>{r}</Text>
                  <Text style={styles.recommendationTag}>· {tagLabel(tag, props.language)}</Text>
                </View>
              )
            })}
          </>
        )}

        {/* Footer with attestation */}
        <Text style={styles.footer}>
          Generated by AI Variance Explainer · model: {props.modelName} · prompt: {props.promptVersion} · confidence: {(props.confidence * 100).toFixed(0)}%{"\n"}
          {props.generatedAt
            ? `Generated at ${props.generatedAt}`
            : `Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")}Z`}
          {"\n"}
          AI output is advisory only. Recommendations require human review before action.
        </Text>
      </Page>
    </Document>
  )
}
