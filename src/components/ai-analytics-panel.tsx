"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Sparkles, Loader2, Send, Search, X, Eraser, Database, AlertTriangle, FileDown } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type ToolChip = {
  id: string
  name: string
  query?: string
  status: "running" | "done" | "error"
  error?: string
}

// Map the sanitized AI error codes (from /lib/ai/ai-error) to neutral,
// user-facing copy — never expose the raw provider message / billing text.
// Unknown values (e.g. "Conversation limit reached") pass through unchanged.
const AI_ERROR_KEYS: Record<string, string> = {
  ai_unavailable: "aiErrorUnavailable",
  ai_credits: "aiErrorUnavailable",
  ai_rate_limit: "aiErrorBusy",
}
function displayAiError(e: string, t: (key: string) => string): string {
  const key = AI_ERROR_KEYS[e]
  return key ? t(key) : e
}

type Message = {
  role: "user" | "assistant"
  content: string
  /** Appended tool-use chips the assistant emitted during this turn. */
  toolChips?: ToolChip[]
  /** Set when the server told us the response hit the max_tokens ceiling. */
  truncated?: boolean
}

type Language = "en" | "ru" | "az"

const LANGUAGES: { code: Language; label: string; fullName: string }[] = [
  { code: "en", label: "EN", fullName: "English" },
  { code: "ru", label: "RU", fullName: "Русский" },
  { code: "az", label: "AZ", fullName: "Azərbaycan" },
]

type Translator = (key: string, values?: Record<string, string | number>) => string

function chipLabel(chip: ToolChip, t: Translator): string {
  if (chip.name === "web_search") {
    return chip.query ? t("aiChipSearchingQuery", { query: chip.query }) : t("aiChipSearchingWeb")
  }
  if (chip.name === "get_monthly_breakdown") return t("aiChipMonthlyBreakdown")
  if (chip.name === "get_account_drill") return t("aiChipAccountDrill")
  return chip.name
}

interface Props {
  open: boolean
  onClose: () => void
  section: string
  sectionLabel: string
  planId: string | null
  planName: string | null
  /**
   * Phase 7.G — selected company filter from the parent page. When
   * non-null, BudgetLine-backed sections scope to this company; the
   * LLM also sees the chosen company in `<section_data>.scope` so it
   * can qualify its narrative. `null` = "all consolidated".
   */
  companyId?: string | null
  /** Display string ("SPARK · SPARK Tech LLC") for the header chip. */
  companyName?: string | null
}

const MAX_TURNS = 20

export function AIAnalyticsPanel({
  open,
  onClose,
  section,
  sectionLabel,
  planId,
  planName,
  companyId,
  companyName,
}: Props) {
  const t = useTranslations("budgeting")
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>("en")
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Reset chat when the user switches to a different section, plan,
  // OR company filter. The company switch is the load-bearing one
  // here — without it, a SPARK→AZMADE flip would leave the old
  // SPARK-scoped conversation in place but next turn would land on
  // AZMADE data, confusing the LLM mid-thread.
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [section, planId, companyId])

  // Autoscroll
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const runTurn = useCallback(
    async (history: Message[]) => {
      if (!planId) return
      setStreaming(true)
      setError(null)
      // Append an empty assistant bubble we'll stream into
      setMessages(h => [...h, { role: "assistant", content: "", toolChips: [] }])

      try {
        const res = await fetch("/api/budgeting/ai-analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section,
            planId,
            companyId: companyId ?? null,
            language,
            messages: history.map(m => ({ role: m.role, content: m.content })),
          }),
        })
        if (!res.ok || !res.body) {
          const errMsg = res.headers.get("content-type")?.includes("json")
            ? (await res.json()).error || `HTTP ${res.status}`
            : `HTTP ${res.status}`
          setError(errMsg)
          setMessages(h => h.slice(0, -1))
          setStreaming(false)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const payload = line.slice(6).trim()
            if (!payload) continue
            // SSE event discriminated union — matches what
            // /api/budgeting/ai-analytics POST emits. Each branch
            // below narrows on `type` and the type-guarded shape.
            type SseEvent =
              | { type: "text"; text: string }
              | { type: "tool_use"; id?: string; name: string; input?: { query?: string } }
              | { type: "tool_result"; id: string; ok: boolean; error?: string }
              | { type: "truncated"; reason?: string }
              | { type: "error"; error: string }
              | { type: "done" }
            let parsed: SseEvent
            try { parsed = JSON.parse(payload) as SseEvent } catch { continue }
            if (parsed.type === "text" && typeof parsed.text === "string") {
              setMessages(h => {
                const copy = [...h]
                const last = copy[copy.length - 1]
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: last.content + parsed.text }
                }
                return copy
              })
            } else if (parsed.type === "tool_use") {
              setMessages(h => {
                const copy = [...h]
                const last = copy[copy.length - 1]
                if (last?.role === "assistant") {
                  const chips: ToolChip[] = [
                    ...(last.toolChips ?? []),
                    {
                      id: parsed.id ?? `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                      name: parsed.name,
                      query: parsed.input?.query,
                      status: "running",
                    },
                  ]
                  copy[copy.length - 1] = { ...last, toolChips: chips }
                }
                return copy
              })
            } else if (parsed.type === "tool_result") {
              setMessages(h => {
                const copy = [...h]
                const last = copy[copy.length - 1]
                if (last?.role === "assistant" && last.toolChips) {
                  const nextStatus: ToolChip["status"] = parsed.ok ? "done" : "error"
                  const chips: ToolChip[] = last.toolChips.map((c) =>
                    c.id === parsed.id
                      ? { ...c, status: nextStatus, error: parsed.error }
                      : c,
                  )
                  copy[copy.length - 1] = { ...last, toolChips: chips }
                }
                return copy
              })
            } else if (parsed.type === "truncated") {
              setMessages(h => {
                const copy = [...h]
                const last = copy[copy.length - 1]
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = { ...last, truncated: true }
                }
                return copy
              })
            } else if (parsed.type === "error") {
              setError(parsed.error)
            }
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Stream failed")
      } finally {
        setStreaming(false)
      }
    },
    [planId, section, language],
  )

  const handleStart = useCallback(() => {
    if (!planId || streaming) return
    void runTurn([])
  }, [planId, streaming, runTurn])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || streaming) return
    if (messages.filter(m => m.role === "user").length >= MAX_TURNS) {
      setError(`Conversation limit reached (${MAX_TURNS} turns). Start a new chat.`)
      return
    }
    const next = [...messages, { role: "user" as const, content: text }]
    setMessages(next)
    setInput("")
    void runTurn(next)
  }, [input, messages, streaming, runTurn])

  const handleClear = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  const [exporting, setExporting] = useState(false)
  const handleExportPdf = useCallback(async () => {
    if (!messages.length || exporting) return
    setExporting(true)
    try {
      // Dynamic import — @react-pdf/renderer is ~300KB gzipped, don't ship
      // it on every page just for a rarely-used export button.
      const [{ pdf }, { ChatPdfDoc }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./ai-chat-pdf"),
      ])
      const doc = (
        <ChatPdfDoc
          sectionLabel={sectionLabel}
          planName={planName}
          messages={messages.map((m) => ({ role: m.role, content: m.content }))}
          labels={{
            title: t("aiFabLabel"),
            analyst: t("aiPdfAnalyst"),
            footer: planName
              ? t("aiPdfFooterWithPlan", { plan: planName })
              : t("aiPdfFooterNoPlan"),
          }}
          locale={locale}
        />
      )
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
      a.download = `budget-ai-analysis-${section}-${ts}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("aiPdfExportFailed"))
    } finally {
      setExporting(false)
    }
  }, [messages, section, sectionLabel, planName, exporting])

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[560px] sm:max-w-[560px] flex flex-col p-0 gap-0">
        <SheetHeader className="px-4 py-3 border-b flex-row items-start justify-between gap-2 space-y-0">
          <div className="flex-1 min-w-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-500" />
              {t("aiFabLabel")}
            </SheetTitle>
            <SheetDescription className="text-xs mt-0.5 truncate">
              {sectionLabel}{planName ? ` · ${planName}` : ""}
              {companyName ? (
                <>
                  {" · "}
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300"
                    data-testid="ai-analytics-company-chip"
                    title={t("aiScopeCompanyTitle")}
                  >
                    {companyName}
                  </span>
                </>
              ) : (
                <>
                  {" · "}
                  <span
                    className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    data-testid="ai-analytics-all-companies-chip"
                    title={t("aiScopeAllCompaniesTitle")}
                  >
                    {t("companyFilterAllCompanies")}
                  </span>
                </>
              )}
            </SheetDescription>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div
              role="radiogroup"
              aria-label={t("aiLanguageGroupAria")}
              className="flex items-center gap-0.5 bg-muted/60 rounded-md p-0.5 mr-1"
            >
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={language === l.code}
                  title={l.fullName}
                  onClick={() => setLanguage(l.code)}
                  disabled={streaming}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide transition-colors ${
                    language === l.code
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  } disabled:opacity-50`}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {messages.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={handleExportPdf}
                  disabled={streaming || exporting}
                  title={t("aiExportPdfTitle")}
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <FileDown className="h-3.5 w-3.5 mr-1" />
                  )}
                  PDF
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleClear} disabled={streaming || exporting}>
                  <Eraser className="h-3.5 w-3.5 mr-1" />{tCommon("clearAll")}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streaming && !error && (
            <div className="flex flex-col items-center justify-center text-center py-10 gap-3">
              {planId ? (
                <>
                  <div className="text-xs text-muted-foreground max-w-[320px]">
                    {t.rich("aiIntroLanguage", {
                      language: LANGUAGES.find((l) => l.code === language)?.fullName ?? "",
                      strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                    })}
                  </div>
                  <Button size="sm" onClick={handleStart} disabled={!planId}>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    {t("aiStartAnalysis")}
                  </Button>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">{t("aiSelectPlan")}</div>
              )}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div className={m.role === "user"
                ? "max-w-[85%] rounded-xl bg-primary text-primary-foreground px-3 py-2 text-sm"
                : "max-w-[100%] text-sm"}
              >
                {m.role === "user" ? (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <>
                    {m.toolChips && m.toolChips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {m.toolChips.map((c) => {
                          const isWeb = c.name === "web_search"
                          const Icon = c.status === "error" ? AlertTriangle : isWeb ? Search : Database
                          const tone = c.status === "error"
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : isWeb
                              ? "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800"
                              : "bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800"
                          return (
                            <span
                              key={c.id}
                              title={c.error ?? undefined}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${tone} ${c.status === "running" ? "animate-pulse" : ""}`}
                            >
                              {c.status === "running" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Icon className="h-3 w-3" />
                              )}
                              {chipLabel(c, t as unknown as Translator)}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ul:my-2 prose-headings:mt-4 prose-headings:mb-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (streaming && i === messages.length - 1 ? "…" : "")}</ReactMarkdown>
                    </div>
                    {m.truncated && (
                      <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        {t("aiResponseTruncated")}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t("aiThinking")}</span>
            </div>
          )}
          {error && (
            <div className="text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-2">
              {displayAiError(error, t as unknown as (key: string) => string)}
            </div>
          )}
        </div>

        <div className="border-t p-3 space-y-2">
          <Textarea
            className="min-h-[72px] text-sm resize-none"
            placeholder={t("aiFollowUpPlaceholder")}
            value={input}
            disabled={streaming || !planId}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim() || !planId}>
              {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              {tCommon("send")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
