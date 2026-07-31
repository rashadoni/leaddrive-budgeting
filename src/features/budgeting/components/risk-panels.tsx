"use client"
/**
 * Per-company risk panels — RiskTagsPanel (editable risk flags) + the
 * RiskRegistryPanel read-only top-risk register and its chip/severity
 * subcomponents. Extracted from CompanySettingsAdmin.tsx (Phase 8 D1
 * 2026-05-29) to bring that mega-file under the 1000-LOC line.
 * CompanySettingsForm renders both panels at the bottom of the settings
 * form; nothing else consumes them.
 */
import { useState, useMemo, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Loader2, Save, ChevronRight, AlertCircle, Check, ShieldAlert,
  BookOpen, ChevronDown, ChevronUp,
  Leaf, Coins, Users, TrendingUp, Activity, Shield, Building2, Cpu,
  type LucideIcon,
} from "lucide-react"
import type { RiskTag } from "@/lib/risk/risk-tags"
import { fetchSettings } from "./company-settings-shared"

const RISK_TAG_META: Record<RiskTag, { label: string; description: string; chipColor: string }> = {
  subsidy_dependency: {
    label: "Зависимость от субсидий",
    description: "Выручка или маржа существенно зависят от государственных субсидий или регулируемых цен.",
    chipColor: "bg-orange-950/70 text-orange-300 border-orange-700/50",
  },
  non_transparent_structure: {
    label: "Непрозрачная структура",
    description: "Структура собственности, связанные стороны или распределение затрат непрозрачны или не проверены аудитом.",
    chipColor: "bg-yellow-950/70 text-yellow-300 border-yellow-700/50",
  },
  data_absence: {
    label: "Отсутствие данных",
    description: "Ключевые финансовые или операционные данные отсутствуют, оценочные или ещё не загружены.",
    chipColor: "bg-slate-700/60 text-slate-400 border-slate-600/50",
  },
}

export function RiskTagsPanel({
  companyId,
  canEdit,
}: {
  companyId: string
  canEdit: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["company-risk-tags", companyId],
    queryFn: () =>
      fetch(`/api/companies/${companyId}/risk-tags`)
        .then((r) => r.json())
        .then((b: { riskTags?: string[] }) => b.riskTags ?? []),
  })

  const [draft, setDraft] = useState<RiskTag[] | null>(null)
  const current = draft ?? (data as RiskTag[] | undefined) ?? []
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/risk-tags`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ riskTags: current }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      return res.json() as Promise<{ riskTags: RiskTag[] }>
    },
    onSuccess: (result) => {
      setSaveError(null)
      setSavedAt(Date.now())
      setDraft(result.riskTags)
      queryClient.setQueryData(["company-risk-tags", companyId], result.riskTags)
    },
    onError: (err: Error) => setSaveError(err.message),
  })

  function toggle(tag: RiskTag) {
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag]
    setDraft(next)
  }

  return (
    <div className="mt-5 pt-4 border-t border-dashed border-muted-foreground/20 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ShieldAlert className="h-3.5 w-3.5" />
        Флаги рисков
      </div>
      {isLoading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Загрузка…
        </div>
      ) : (
        <div className="space-y-2">
          {(Object.entries(RISK_TAG_META) as [RiskTag, (typeof RISK_TAG_META)[RiskTag]][]).map(
            ([tag, meta]) => (
              <label
                key={tag}
                className="flex items-start gap-2.5 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-orange-500"
                  checked={current.includes(tag)}
                  onChange={() => toggle(tag)}
                  disabled={!canEdit || saveMutation.isPending}
                />
                <div className="space-y-0.5">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] font-mono px-1 border rounded leading-[14px] ${meta.chipColor}`}
                    >
                      {tag === "subsidy_dependency"
                        ? "Sub"
                        : tag === "non_transparent_structure"
                          ? "Opq"
                          : "NoD"}
                    </span>
                    <span className="text-sm">{meta.label}</span>
                  </span>
                  <p className="text-[10px] text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
              </label>
            ),
          )}
        </div>
      )}

      {saveError && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}
      {savedAt && !saveError && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <Check className="h-3 w-3" /> Флаги сохранены
        </div>
      )}

      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || isLoading}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin mr-2" />
          ) : (
            <Save className="h-3 w-3 mr-2" />
          )}
          Сохранить флаги
        </Button>
      )}
    </div>
  )
}

interface RiskItem {
  level1: string
  level2: string
  level3: string
  kri: string
  criticality: number
  description: string
  note?: string
}

/**
 * Phase 7.N polish (2026-05-26) — RiskRegistryPanel redesign.
 *
 * Per-category metadata: icon (lucide) + dot color (8px circle).
 * Used in the grouped category headers + per-row category dot. Text
 * itself stays neutral; the colored dot anchors the row visually so
 * the eye reads the row content first, the category second (instead
 * of the previous "every row in a different color text" amateur look).
 *
 * Severity is conveyed via 3-dot shape (●●○ pattern), not just color
 * — color-blind safe + works in monochrome print exports.
 */
interface CategoryMeta {
  icon: LucideIcon
  dot: string       // bg color class for the 8px category dot
  tint: string      // subtle group-row background
  order: number     // canonical sort order in headers
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  "Regulatory & compliance risk":  { icon: Shield,     dot: "bg-rose-500",    tint: "bg-rose-500/[0.03]",    order: 1 },
  "Financial risk":                { icon: Coins,      dot: "bg-sky-500",     tint: "bg-sky-500/[0.03]",     order: 2 },
  "Operational risk":              { icon: Activity,   dot: "bg-amber-500",   tint: "bg-amber-500/[0.03]",   order: 3 },
  "Strategic & reputational risk": { icon: Building2,  dot: "bg-fuchsia-500", tint: "bg-fuchsia-500/[0.03]", order: 4 },
  "Market & commercial risk":      { icon: TrendingUp, dot: "bg-yellow-500",  tint: "bg-yellow-500/[0.03]",  order: 5 },
  "Human capital risk":            { icon: Users,      dot: "bg-violet-500",  tint: "bg-violet-500/[0.03]",  order: 6 },
  "Environmental risk":            { icon: Leaf,       dot: "bg-emerald-500", tint: "bg-emerald-500/[0.03]", order: 7 },
  "Technology & data risk":        { icon: Cpu,        dot: "bg-cyan-500",    tint: "bg-cyan-500/[0.03]",    order: 8 },
}

const FALLBACK_META: CategoryMeta = {
  icon: BookOpen, dot: "bg-muted-foreground/50", tint: "bg-muted/30", order: 99,
}

/** 3-dot severity glyph. criticality ∈ {1,2,3}: ●○○ / ●●○ / ●●●.
 *  Color intensifies with severity but the SHAPE (filled-vs-hollow dots)
 *  carries the same info color-blind users see. */
function SeverityDots({ criticality }: { criticality: number }) {
  const c = Math.max(1, Math.min(3, Math.round(criticality)))
  const fillColor =
    c >= 3 ? "bg-rose-500"
    : c === 2 ? "bg-amber-500"
    : "bg-emerald-500"
  return (
    <span
      className="inline-flex items-center gap-0.5 shrink-0"
      aria-label={`Criticality ${c} of 3`}
      title={`Criticality ${c} of 3`}
    >
      {[1, 2, 3].map((d) => (
        <span
          key={d}
          className={`h-1.5 w-1.5 rounded-full ${d <= c ? fillColor : "border border-muted-foreground/40 bg-transparent"}`}
        />
      ))}
    </span>
  )
}

export function RiskRegistryPanel({ companyId }: { companyId: string }) {
  const t = useTranslations("budgeting")
  const { data, isLoading } = useQuery({
    queryKey: ["company-settings", companyId],
    queryFn: () => fetchSettings(companyId),
  })

  const [expanded, setExpanded] = useState(false)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "critical" | string>("all")
  // Phase 7.N follow-up — configurable critical threshold. Stored in
  // localStorage per-browser so finance ops keeps their preference.
  const [criticalThreshold, setCriticalThreshold] = useState<1 | 2 | 3>(3)

  const registry = Array.isArray((data?.settings as Record<string, unknown> | undefined)?.riskRegistry)
    ? ((data!.settings as Record<string, unknown>).riskRegistry as RiskItem[])
    : null

  // Group + filter. Memoised so toggling open-row doesn't re-sort.
  const grouped = useMemo(() => {
    if (!registry) return { groups: [], categoryCounts: {}, criticalCount: 0 }
    const filtered = registry.filter((r) => {
      if (filter === "all") return true
      if (filter === "critical") return r.criticality >= criticalThreshold
      return r.level1 === filter
    })
    const byCat = new Map<string, RiskItem[]>()
    for (const r of filtered) {
      const cat = r.level1 || "Uncategorized"
      if (!byCat.has(cat)) byCat.set(cat, [])
      byCat.get(cat)!.push(r)
    }
    // Sort each category internally by criticality desc, then label.
    for (const arr of byCat.values()) {
      arr.sort((a, b) => b.criticality - a.criticality || a.level3.localeCompare(b.level3))
    }
    const groups = Array.from(byCat.entries())
      .map(([cat, items]) => ({ cat, items, meta: CATEGORY_META[cat] ?? FALLBACK_META }))
      .sort((a, b) => a.meta.order - b.meta.order)

    const categoryCounts: Record<string, number> = {}
    for (const r of registry) categoryCounts[r.level1] = (categoryCounts[r.level1] ?? 0) + 1
    const criticalCount = registry.filter((r) => r.criticality >= criticalThreshold).length
    return { groups, categoryCounts, criticalCount }
  }, [registry, filter, criticalThreshold])

  if (isLoading) return null

  // 2026-05-27 A1 honesty layer — when the registry is missing entirely
  // (5 of 6 AZSEKER entities at the moment), render an explicit
  // "Pending client verification" badge instead of silently hiding the
  // panel. Without this, an empty registry looks identical to "we have
  // no data to show you" — confusing for stakeholders. The badge
  // anchors the gap, says who owns it (CARRYOVER row B2), and links
  // to the Indicator Backlog where the client can be emailed.
  if (!registry || registry.length === 0) {
    return (
      <div className="mt-5 pt-4 border-t border-dashed border-muted-foreground/20">
        <div
          className="rounded-md border border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2.5"
          data-testid="risk-registry-pending"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <BookOpen className="h-3.5 w-3.5" />
            <span>{t("riskRegistryTitle")}</span>
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 font-mono">
              {t("riskRegistryPendingBadge")}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            {t("riskRegistryPendingBody")}{" "}
            <a
              href={`/budgeting/admin/indicator-backlog?company=${data?.companyCode ?? ""}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {t("riskRegistryOpenBacklog")}
            </a>{" "}
            {t("riskRegistryPendingOwner")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-5 pt-4 border-t border-dashed border-muted-foreground/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {t("riskRegistryTitle")}
        <span className="ml-1 text-xs tabular-nums text-muted-foreground/70">{registry.length}</span>
        {grouped.criticalCount > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium tabular-nums text-rose-500">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            {grouped.criticalCount} critical
          </span>
        )}
        {expanded ? (
          <ChevronUp className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          {/* Filter chips — single row, horizontal scroll on overflow.
              `all` always present + `critical` shortcut + per-category. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterChip
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label="All"
              count={registry.length}
            />
            {grouped.criticalCount > 0 && (
              <CriticalChip
                active={filter === "critical"}
                onActivate={() => setFilter("critical")}
                count={grouped.criticalCount}
                threshold={criticalThreshold}
                onThresholdChange={(t) => {
                  setCriticalThreshold(t)
                  // Re-activate the filter so user sees the new count.
                  if (filter !== "critical") setFilter("critical")
                }}
              />
            )}
            {Object.entries(grouped.categoryCounts)
              .sort((a, b) => (CATEGORY_META[a[0]]?.order ?? 99) - (CATEGORY_META[b[0]]?.order ?? 99))
              .map(([cat, count]) => {
                const meta = CATEGORY_META[cat] ?? FALLBACK_META
                const Icon = meta.icon
                return (
                  <FilterChip
                    key={cat}
                    active={filter === cat}
                    onClick={() => setFilter(cat)}
                    label={cat.replace(/ risk$/, "")}
                    count={count}
                    icon={<Icon className="h-3 w-3" />}
                    dot={meta.dot}
                  />
                )
              })}
          </div>

          {/* Grouped list — category header + rows, no nested cards.
              Wider layouts (xl+) split groups into 2 columns to use the
              wasted right whitespace on the admin/companies page. */}
          {grouped.groups.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">
              No risks match the current filter.
            </p>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {grouped.groups.map(({ cat, items, meta }) => {
                const Icon = meta.icon
                return (
                  // overflow-clip (not -hidden) preserves border-radius
                  // WITHOUT breaking position:sticky inside.
                  <div key={cat} className="overflow-clip rounded-md border border-border/60 self-start">
                    {/* Sticky category header — pins to viewport top while
                        the group rows scroll past beneath it. backdrop-blur
                        keeps text readable when content scrolls under. */}
                    <div
                      className={`sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 border-b border-border/40 backdrop-blur-sm ${meta.tint}`}
                    >
                      <span className={`h-2 w-2 rounded-full ${meta.dot} shrink-0`} aria-hidden />
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
                        {cat}
                      </span>
                      <span className="text-[10px] tabular-nums text-muted-foreground ml-1">
                        {items.length}
                      </span>
                    </div>
                    {/* Rows */}
                    <ul className="divide-y divide-border/40">
                      {items.map((item, idx) => {
                        const rowKey = `${cat}::${idx}::${item.level3}`
                        const isOpen = openRow === rowKey
                        return (
                          <li key={rowKey}>
                            <button
                              type="button"
                              onClick={() => setOpenRow(isOpen ? null : rowKey)}
                              className="group w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                              aria-expanded={isOpen}
                            >
                              <SeverityDots criticality={item.criticality} />
                              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                                <span className="text-[13px] text-foreground truncate">
                                  {item.level3}
                                </span>
                                <span className="text-[11px] text-muted-foreground truncate">
                                  {item.level2}
                                </span>
                              </div>
                              <ChevronRight
                                className={`h-3.5 w-3.5 text-muted-foreground/60 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""} group-hover:text-muted-foreground`}
                                aria-hidden
                              />
                            </button>
                            {/* CSS-only smooth expand via grid-template-rows
                                interpolation — no JS lib, no layout thrash.
                                Closed = 0fr (zero height); open = 1fr (auto
                                height). The inner div MUST have min-h-0 +
                                overflow-hidden so children don't leak when
                                collapsed. */}
                            <div
                              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                              } bg-muted/[0.15]`}
                            >
                              <div className="overflow-hidden min-h-0">
                                <div className="px-3 pb-3 pt-1 grid gap-2 text-[12px] leading-relaxed">
                                  <DetailField label="KRI" value={item.kri} mono />
                                  {item.description && (
                                    <DetailField label="Description" value={item.description} />
                                  )}
                                  {item.note && (
                                    <DetailField label="Note" value={item.note} muted />
                                  )}
                                </div>
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Critical-filter chip with adjacent threshold stepper. Splits the
 *  "Critical" affordance into two: clicking the label activates the
 *  filter; clicking the `≥N` button cycles the threshold (3→2→1→3).
 *  Two adjacent buttons in one pill so the chrome stays compact and
 *  the threshold change is one click, not a separate menu. */
function CriticalChip({
  active, onActivate, count, threshold, onThresholdChange,
}: {
  active: boolean
  onActivate: () => void
  count: number
  threshold: 1 | 2 | 3
  onThresholdChange: (t: 1 | 2 | 3) => void
}) {
  const baseTone = active
    ? "border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-200"
    : "border-rose-500/30 bg-rose-500/[0.06] text-rose-600 dark:text-rose-300"
  const cycleThreshold = () => {
    const next = (threshold === 3 ? 2 : threshold === 2 ? 1 : 3) as 1 | 2 | 3
    onThresholdChange(next)
  }
  return (
    <span className={`inline-flex items-center rounded-full border ${baseTone} overflow-hidden text-[11px] font-medium`}>
      <button
        type="button"
        onClick={onActivate}
        className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 hover:bg-rose-500/10 transition-colors"
      >
        <span>Critical</span>
        <span className="tabular-nums opacity-80">{count}</span>
      </button>
      <button
        type="button"
        onClick={cycleThreshold}
        title={`Threshold: criticality ≥ ${threshold} (click to cycle)`}
        aria-label={`Critical threshold ≥${threshold}, click to change`}
        className="inline-flex items-center gap-0.5 pl-1.5 pr-2 py-1 border-l border-rose-500/30 tabular-nums opacity-90 hover:bg-rose-500/10 transition-colors font-mono text-[10px]"
      >
        ≥{threshold}
      </button>
    </span>
  )
}

/** Compact filter chip — pill button with optional category dot or icon.
 *  Active state uses a tinted background + border, NOT decorative color
 *  on text (per product register guidance: state-rich semantic vocab). */
function FilterChip({
  active, onClick, label, count, icon, dot, tone,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  icon?: ReactNode
  dot?: string
  tone?: "rose"
}) {
  const baseTone = tone === "rose"
    ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-600 dark:text-rose-300"
    : "border-border/60 bg-background hover:bg-muted/40 text-foreground"
  const activeTone = tone === "rose"
    ? "border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-200"
    : "border-foreground/40 bg-muted text-foreground"
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? activeTone : baseTone
      }`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />}
      {icon}
      <span>{label}</span>
      <span className="tabular-nums text-muted-foreground/80">{count}</span>
    </button>
  )
}

function DetailField({
  label, value, mono, muted,
}: {
  label: string
  value: string
  mono?: boolean
  muted?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-0.5">
        {label}
      </div>
      <div
        className={`${mono ? "font-mono text-[12px]" : "text-[12px]"} ${muted ? "text-muted-foreground" : "text-foreground/90"}`}
      >
        {value}
      </div>
    </div>
  )
}
