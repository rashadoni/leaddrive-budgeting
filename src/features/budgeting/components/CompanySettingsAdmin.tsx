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
import { Loader2, Save, ChevronRight, AlertCircle, Check } from "lucide-react"
import {
  AGRO_REGIONS,
  AGRO_CROP_TYPES,
  FP_MAIN_COMMODITIES,
} from "@/app/api/companies/[id]/settings/validate"

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
    .then((b) => (Array.isArray(b) ? b : (b.rows ?? b.companies ?? [])))
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
          <h1 className="text-2xl font-bold">Company Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-industry operational descriptors (hectares, region, capacity, etc.). Drives sector-aware indicators and AI explanations.
          </p>
        </div>
        {!canEdit && (
          <Badge variant="outline">Read-only (viewer/editor role)</Badge>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading companies…
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
            Save settings
          </Button>
        </div>
      )}
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
        label="Hectares planted"
        hint="Total cultivated area for the active crop cycle."
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="region"
        label="Region"
        options={AGRO_REGIONS}
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="cropType"
        label="Crop type"
        options={AGRO_CROP_TYPES}
      />
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="yieldTarget"
        label="Yield target (t/ha)"
        hint="Drives AGRO_YIELD_PER_HA threshold context."
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
        label="Total rooms"
        hint="Used by HOSP_OCC / RevPAR computations."
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="seasonalityProfile"
        label="Seasonality"
        options={["summer_peak", "winter_peak", "year_round", "weekday_only"]}
      />
      <div className="space-y-1 col-span-2">
        <Label htmlFor="region">Region (free text)</Label>
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
        label="Capacity (tons/yr)"
      />
      <NumberField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="extractionRateTarget"
        label="Extraction rate target (%)"
        hint="Target benchmark for FP_EXTRACTION_RATE."
      />
      <SelectField
        draft={draft}
        setDraft={setDraft}
        canEdit={canEdit}
        field="mainInputCommodity"
        label="Main input commodity"
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
      <Label htmlFor="generic-json">Settings JSON (free-form)</Label>
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
