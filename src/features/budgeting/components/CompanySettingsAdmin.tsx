"use client"

/**
 * Phase 7.I — Admin UI for per-company `Company.settings` JSON.
 *
 * Lists all companies in the org with their industry + current settings;
 * clicking a row opens an inline per-industry form (agro_crops /
 * hospitality / food_processing / generic fallback). Save → PATCH to
 * `/api/companies/[id]/settings`, audit row, re-render.
 *
 * Form fields per industry come from the same Zod schema set as the API
 * (`api/companies/[id]/settings/validate.ts`), keeping admin UI and
 * backend validation in lock-step.
 */

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save, ChevronRight, AlertCircle, Check, ShieldAlert, BookOpen, ChevronDown, ChevronUp } from "lucide-react"
import {
  AGRO_REGIONS,
  AGRO_CROP_TYPES,
  FP_MAIN_COMMODITIES,
} from "@/app/api/companies/[id]/settings/validate"
import { type RiskTag } from "@/app/api/companies/[id]/risk-tags/route"

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

interface CompanyRow {
  id: string
  code: string
  name: string
  industry: string | null
  level: number
  role: string
}

interface SettingsBody {
  companyId: string
  companyCode: string
  industry: string | null
  settings: Record<string, unknown>
}

function fetchCompanies(orgId: string): Promise<CompanyRow[]> {
  return fetch("/api/companies", {
    headers: { "x-organization-id": orgId },
  })
    .then((r) => r.json())
    .then((b) => {
      const raw: CompanyRow[] = Array.isArray(b) ? b : (b.rows ?? b.companies ?? [])
      // API returns nested structure (parent + children[]). Flatten all levels
      // so every company (including subsidiaries) appears as a separate row.
      const flat: CompanyRow[] = []
      for (const c of raw) {
        flat.push(c)
        const children = (c as unknown as { children?: CompanyRow[] }).children ?? []
        for (const child of children) {
          flat.push(child)
          const grandchildren = (child as unknown as { children?: CompanyRow[] }).children ?? []
          flat.push(...grandchildren)
        }
      }
      return flat
    })
}

function fetchSettings(companyId: string): Promise<SettingsBody> {
  return fetch(`/api/companies/${companyId}/settings`).then((r) => r.json())
}

export function CompanySettingsAdmin() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId ?? ""
  const userRole = session?.user?.role
  const canEdit = userRole === "admin" || userRole === "manager"
  const queryClient = useQueryClient()

  const { data: companies, isLoading } = useQuery({
    queryKey: ["admin-companies", orgId],
    queryFn: () => fetchCompanies(orgId),
    enabled: !!orgId,
  })

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)

  const operationalCompanies = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => c.role !== "admin" && c.role !== "holding")
        .sort((a, b) => (a.industry ?? "_").localeCompare(b.industry ?? "_") || a.code.localeCompare(b.code)),
    [companies],
  )

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Настройки компаний</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Отраслевые операционные параметры (га, регион, мощность и др.). Влияют на индикаторы и объяснения AI.
          </p>
        </div>
        {!canEdit && (
          <Badge variant="outline">Только чтение (роль viewer/editor)</Badge>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка компаний…
        </div>
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {operationalCompanies.map((c) => {
            const isOpen = selectedCompanyId === c.id
            return (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedCompanyId(isOpen ? null : c.id)}
                  // Phase 3.3 pattern — hover reveals the fully-qualified
                  // "<code> — <name> · <industry>" identifier when the
                  // name truncates in the flex-1 cell.
                  title={`${c.code} — ${c.name}${c.industry ? ` · ${c.industry}` : ""}`}
                  className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 text-left"
                >
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="font-mono text-xs text-muted-foreground w-32 shrink-0">
                    {c.code}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {c.industry ?? "—"}
                  </Badge>
                </button>
                {isOpen && (
                  <div className="bg-muted/20 px-6 py-4">
                    <CompanySettingsForm
                      companyId={c.id}
                      companyCode={c.code}
                      industry={c.industry}
                      canEdit={canEdit}
                      onSaved={() =>
                        queryClient.invalidateQueries({
                          queryKey: ["company-settings", c.id],
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )
          })}
          {!isLoading && operationalCompanies.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No operational companies found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RiskTagsPanel({
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

const LEVEL1_COLORS: Record<string, string> = {
  "Environmental risk":          "text-emerald-400",
  "Financial risk":              "text-blue-400",
  "Human capital risk":          "text-purple-400",
  "Market & commercial risk":    "text-yellow-400",
  "Operational risk":            "text-orange-400",
  "Regulatory & compliance risk":"text-red-400",
  "Strategic & reputational risk":"text-pink-400",
  "Technology & data risk":      "text-cyan-400",
}

function RiskRegistryPanel({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["company-settings", companyId],
    queryFn: () => fetchSettings(companyId),
  })

  const [expanded, setExpanded] = useState(false)
  const [openRow, setOpenRow] = useState<number | null>(null)

  const registry = Array.isArray((data?.settings as Record<string, unknown> | undefined)?.riskRegistry)
    ? ((data!.settings as Record<string, unknown>).riskRegistry as RiskItem[])
    : null

  if (isLoading || !registry || registry.length === 0) return null

  return (
    <div className="mt-5 pt-4 border-t border-dashed border-muted-foreground/20 space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <BookOpen className="h-3.5 w-3.5" />
        Risk registry
        <span className="ml-1 text-xs text-muted-foreground/70">({registry.length})</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1 pt-1">
          {registry.map((item, idx) => {
            const isOpen = openRow === idx
            const color = LEVEL1_COLORS[item.level1] ?? "text-muted-foreground"
            return (
              <div key={idx} className="rounded border border-border/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenRow(isOpen ? null : idx)}
                  className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/30 transition-colors"
                >
                  <span className={`text-[9px] font-mono mt-0.5 shrink-0 ${color}`}>
                    L{item.criticality}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.level3}</p>
                    <p className={`text-[10px] ${color} truncate`}>
                      {item.level1} › {item.level2}
                    </p>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" />
                  )}
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pt-0 space-y-1.5 border-t border-border/40 bg-muted/10">
                    <div className="pt-2">
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">KRI</span>
                      <p className="text-xs mt-0.5">{item.kri}</p>
                    </div>
                    {item.description && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Description</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{item.description}</p>
                      </div>
                    )}
                    {item.note && (
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Note</span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.note}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface CompanySettingsFormProps {
  companyId: string
  companyCode: string
  industry: string | null
  canEdit: boolean
  onSaved?: () => void
}

function CompanySettingsForm({
  companyId,
  industry,
  canEdit,
  onSaved,
}: CompanySettingsFormProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["company-settings", companyId],
    queryFn: () => fetchSettings(companyId),
  })
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Initialize draft from server state once.
  const initial = data?.settings ?? {}
  if (Object.keys(draft).length === 0 && Object.keys(initial).length > 0) {
    setDraft({ ...initial })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          body?.error ?? `HTTP ${res.status}: failed to save settings`,
        )
      }
      return res.json()
    },
    onSuccess: () => {
      setSaveError(null)
      setSavedAt(Date.now())
      onSaved?.()
    },
    onError: (err: Error) => {
      setSaveError(err.message)
    },
  })

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading current settings…
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {industry === "agro_crops" && (
        <AgroSettingsFields draft={draft} setDraft={setDraft} canEdit={canEdit} />
      )}
      {industry === "hospitality" && (
        <HospitalitySettingsFields draft={draft} setDraft={setDraft} canEdit={canEdit} />
      )}
      {industry === "food_processing" && (
        <FoodProcessingSettingsFields draft={draft} setDraft={setDraft} canEdit={canEdit} />
      )}
      {!["agro_crops", "hospitality", "food_processing"].includes(industry ?? "") && (
        <GenericSettingsFields draft={draft} setDraft={setDraft} canEdit={canEdit} />
      )}

      {saveError && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}
      {savedAt && !saveError && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <Check className="h-3 w-3" /> Saved
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-2" />
            ) : (
              <Save className="h-3 w-3 mr-2" />
            )}
            Сохранить настройки
          </Button>
        </div>
      )}

      <RiskTagsPanel companyId={companyId} canEdit={canEdit} />
      <RiskRegistryPanel companyId={companyId} />
    </div>
  )
}

interface FieldProps {
  draft: Record<string, unknown>
  setDraft: (next: Record<string, unknown>) => void
  canEdit: boolean
}

function NumberField({
  draft,
  setDraft,
  canEdit,
  field,
  label,
  hint,
}: FieldProps & { field: string; label: string; hint?: string }) {
  const value = draft[field]
  return (
    <div className="space-y-1">
      <Label htmlFor={field}>{label}</Label>
      <Input
        id={field}
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const next = { ...draft }
          if (e.target.value === "") delete next[field]
          else next[field] = Number(e.target.value)
          setDraft(next)
        }}
        disabled={!canEdit}
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SelectField({
  draft,
  setDraft,
  canEdit,
  field,
  label,
  options,
}: FieldProps & { field: string; label: string; options: readonly string[] }) {
  const value = draft[field] ?? ""
  return (
    <div className="space-y-1">
      <Label htmlFor={field}>{label}</Label>
      <select
        id={field}
        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => {
          const next = { ...draft }
          if (e.target.value === "") delete next[field]
          else next[field] = e.target.value
          setDraft(next)
        }}
        disabled={!canEdit}
      >
        <option value="">— select —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function AgroSettingsFields({ draft, setDraft, canEdit }: FieldProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="hectaresPlanted"
        label="Посевная площадь (га)"
        hint="Общая обрабатываемая площадь в текущем посевном цикле."
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="region"
        label="Регион"
        options={AGRO_REGIONS}
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="cropType"
        label="Тип культуры"
        options={AGRO_CROP_TYPES}
      />
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="yieldTarget"
        label="Целевая урожайность (т/га)"
        hint="Контекст порога для индикатора AGRO_YIELD_PER_HA."
      />
    </div>
  )
}

function HospitalitySettingsFields({ draft, setDraft, canEdit }: FieldProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="totalRooms"
        label="Количество номеров"
        hint="Используется для расчёта HOSP_OCC / RevPAR."
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="seasonalityProfile"
        label="Сезонность"
        options={["summer_peak", "winter_peak", "year_round", "weekday_only"]}
      />
      <div className="space-y-1 col-span-2">
        <Label htmlFor="region">Регион (свободный ввод)</Label>
        <Input
          id="region"
          value={typeof draft.region === "string" ? draft.region : ""}
          onChange={(e) => {
            const next = { ...draft }
            if (e.target.value === "") delete next.region
            else next.region = e.target.value
            setDraft(next)
          }}
          disabled={!canEdit}
        />
      </div>
    </div>
  )
}

function FoodProcessingSettingsFields({ draft, setDraft, canEdit }: FieldProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="processingCapacityTonsYr"
        label="Мощность переработки (тонн/год)"
      />
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="extractionRateTarget"
        label="Целевой коэффициент извлечения (%)"
        hint="Эталонный показатель для FP_EXTRACTION_RATE."
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="mainInputCommodity"
        label="Основное сырьё"
        options={FP_MAIN_COMMODITIES}
      />
    </div>
  )
}

function GenericSettingsFields({ draft, setDraft, canEdit }: FieldProps) {
  // Free-form JSON for industries without a hardened schema. Visible
  // but capped — the API rejects > 32 keys / nested objects.
  const text = JSON.stringify(draft, null, 2)
  return (
    <div className="space-y-1">
      <Label htmlFor="generic-json">Настройки JSON (свободная форма)</Label>
      <textarea
        id="generic-json"
        className="w-full font-mono text-xs rounded border bg-background p-2 min-h-[160px]"
        value={text}
        onChange={(e) => {
          try {
            setDraft(JSON.parse(e.target.value || "{}"))
          } catch {
            // ignore — server will reject invalid JSON
          }
        }}
        disabled={!canEdit}
      />
      <p className="text-[10px] text-muted-foreground">
        Max 32 keys, values must be primitives (string/number/boolean/null).
      </p>
    </div>
  )
}
