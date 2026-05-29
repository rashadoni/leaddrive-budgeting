"use client"

/**
 * Phase 7.I — Admin UI for per-company `Company.settings` JSON.
 *
 * Lists all companies in the org with their industry + current settings;
 * clicking a row opens an inline per-industry form (agro_crops /
 * hospitality / food_processing / generic fallback). Save → PATCH to
 * `/api/companies/[id]/settings`, audit row, re-render.
 *
 * Phase 8 D1 (2026-05-29): the per-company form + its field components moved
 * to CompanySettingsForm.tsx, and the risk-flag / risk-register panels to
 * risk-panels.tsx, leaving this file as the org company-picker wrapper.
 */

import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, ChevronRight } from "lucide-react"
import { CompanySettingsForm } from "./CompanySettingsForm"

interface CompanyRow {
  id: string
  code: string
  name: string
  industry: string | null
  level: number
  role: string
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
