"use client"
/**
 * Per-company settings form (industry-specific fields + save) — extracted from
 * CompanySettingsAdmin.tsx (Phase 8 D1 2026-05-29) to bring it under the
 * 1000-LOC mega-file line. Self-contained: props in, PATCH out; its
 * NumberField / SelectField + the agro/hospitality/food-processing/generic
 * field sets are internal. CompanySettingsAdmin imports CompanySettingsForm
 * back.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save, AlertCircle, Check } from "lucide-react"
import {
  AGRO_REGIONS,
  AGRO_CROP_TYPES,
  FP_MAIN_COMMODITIES,
} from "@/app/api/companies/[id]/settings/validate"
import { fetchSettings } from "./company-settings-shared"
import { RiskTagsPanel, RiskRegistryPanel } from "./risk-panels"

interface CompanySettingsFormProps {
  companyId: string
  companyCode: string
  industry: string | null
  canEdit: boolean
  onSaved?: () => void
}

export function CompanySettingsForm({
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
  const t = useTranslations("budgeting")
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
        <option value="">{t("companySettingsSelectPlaceholder")}</option>
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
  const t = useTranslations("budgeting")
  // Free-form JSON for industries without a hardened schema. Visible
  // but capped — the API rejects > 32 keys / nested objects.
  const text = JSON.stringify(draft, null, 2)
  return (
    <div className="space-y-1">
      <Label htmlFor="generic-json">{t("companySettingsGenericJsonLabel")}</Label>
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
