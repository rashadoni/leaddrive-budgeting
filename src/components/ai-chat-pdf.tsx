/**
 * React-PDF document for exporting an AI Analytics chat transcript.
 *
 * Rendered on-demand by the AIAnalyticsPanel via `pdf(<ChatPdfDoc .../>).toBlob()`.
 * Markdown is stripped to plain text — a PDF report doesn't need to be a
 * fully faithful Markdown renderer, and react-pdf has no mdast bridge.
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"

export type PdfChatMessage = { role: "user" | "assistant"; content: string }

interface Props {
  sectionLabel: string
  planName: string | null
  messages: PdfChatMessage[]
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: 40,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.4,
  },
  header: {
    borderBottom: "1pt solid #E5E7EB",
    paddingBottom: 10,
    marginBottom: 18,
  },
  brand: {
    fontSize: 9,
    color: "#7C3AED",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  subtitle: {
    fontSize: 10,
    color: "#6B7280",
    marginTop: 4,
  },
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
    marginBottom: 2,
  },
  assistantRow: {
    flexDirection: "column",
    marginTop: 14,
    marginBottom: 2,
  },
  userBubble: {
    maxWidth: "78%",
    backgroundColor: "#F3F0FF",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    color: "#4C1D95",
  },
  assistantBubble: {
    color: "#111827",
  },
  roleLabel: {
    fontSize: 8,
    color: "#9CA3AF",
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  paragraph: {
    marginBottom: 4,
  },
  heading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginTop: 6,
    marginBottom: 4,
    color: "#111827",
  },
  bullet: {
    marginBottom: 2,
    paddingLeft: 8,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#9CA3AF",
    borderTop: "1pt solid #E5E7EB",
    paddingTop: 8,
    textAlign: "center",
  },
  pageNumber: {
    position: "absolute",
    bottom: 24,
    right: 48,
    fontSize: 8,
    color: "#9CA3AF",
  },
})

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
}

/** Classify each line so we can render headings + bullets with distinct styles. */
type Segment = { kind: "heading" | "bullet" | "para" | "spacer"; text: string }

function parseLines(content: string): Segment[] {
  const out: Segment[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line.trim() === "") {
      out.push({ kind: "spacer", text: "" })
      continue
    }
    const headingMatch = line.match(/^#+\s+(.*)$/)
    if (headingMatch) {
      out.push({ kind: "heading", text: stripInlineMarkdown(headingMatch[1]) })
      continue
    }
    const bulletMatch = line.match(/^\s*[-*•]\s+(.*)$/)
    if (bulletMatch) {
      out.push({ kind: "bullet", text: "• " + stripInlineMarkdown(bulletMatch[1]) })
      continue
    }
    const numberedMatch = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (numberedMatch) {
      out.push({ kind: "bullet", text: `${numberedMatch[1]}. ${stripInlineMarkdown(numberedMatch[2])}` })
      continue
    }
    out.push({ kind: "para", text: stripInlineMarkdown(line) })
  }
  return out
}

function renderSegments(segments: Segment[]) {
  return segments.map((seg, i) => {
    if (seg.kind === "spacer") return <View key={i} style={{ height: 4 }} />
    if (seg.kind === "heading") return <Text key={i} style={styles.heading}>{seg.text}</Text>
    if (seg.kind === "bullet") return <Text key={i} style={styles.bullet}>{seg.text}</Text>
    return <Text key={i} style={styles.paragraph}>{seg.text}</Text>
  })
}

export function ChatPdfDoc({ sectionLabel, planName, messages }: Props) {
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const footerText = `Generated from data in ${planName ? `"${planName}"` : "the selected budget plan"}. Not audited. For internal review only.`

  return (
    <Document
      title="BudgetPro AI Analysis"
      author="BudgetPro"
      subject={`AI Analysis — ${sectionLabel}`}
    >
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <Text style={styles.brand}>BudgetPro</Text>
          <Text style={styles.title}>AI Analysis</Text>
          <Text style={styles.subtitle}>
            {sectionLabel}
            {planName ? ` · ${planName}` : ""} · {date}
          </Text>
        </View>

        {messages.map((m, i) => {
          const isUser = m.role === "user"
          const segments = parseLines(m.content)
          return isUser ? (
            <View key={i} style={styles.userRow} wrap={false}>
              <View style={styles.userBubble}>
                {segments.map((seg, j) => (
                  <Text key={j} style={styles.paragraph}>{seg.text || " "}</Text>
                ))}
              </View>
            </View>
          ) : (
            <View key={i} style={styles.assistantRow}>
              <Text style={styles.roleLabel}>Analyst</Text>
              <View style={styles.assistantBubble}>{renderSegments(segments)}</View>
            </View>
          )
        })}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
        <Text style={styles.footer} fixed>
          {footerText}
        </Text>
      </Page>
    </Document>
  )
}
