"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Loader2, Building2, Layers } from "lucide-react"
import { DataBoundary } from "@/components/ui/data-boundary"

interface CostType {
  id: string
  key: string
  label: string
  costModelPattern: string | null
  isShared: boolean
  allocationMethod: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
}

interface Department {
  id: string
  key: string
  label: string
  serviceKey: string | null
  hasRevenue: boolean
  color: string | null
  sortOrder: number
  isActive: boolean
}

function ColorDot({ color }: { color: string | null }) {
  if (!color) return null
  return <span className="w-3 h-3 rounded-full inline-block border border-black/10" style={{ backgroundColor: color }} />
}

export function BudgetConfigTab() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const t = useTranslations("budgeting")

  const [costTypes, setCostTypes] = useState<CostType[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [ctDialog, setCtDialog] = useState(false)
  const [deptDialog, setDeptDialog] = useState(false)
  const [editCt, setEditCt] = useState<CostType | null>(null)
  const [editDept, setEditDept] = useState<Department | null>(null)

  // Form state
  const [ctForm, setCtForm] = useState({ key: "", label: "", costModelPattern: "", isShared: false, allocationMethod: "", color: "#3B82F6" })
  const [deptForm, setDeptForm] = useState({ key: "", label: "", serviceKey: "", hasRevenue: true, color: "#3B82F6" })
  const [saving, setSaving] = useState(false)

  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId), "Content-Type": "application/json" } : { "Content-Type": "application/json" }

  const fetchData = async () => {
    try {
      const [ctRes, deptRes] = await Promise.all([
        fetch("/api/budgeting/cost-types?includeInactive=true", { headers }),
        fetch("/api/budgeting/departments?includeInactive=true", { headers }),
      ])
      if (ctRes.ok) setCostTypes((await ctRes.json()).data || [])
      if (deptRes.ok) setDepartments((await deptRes.json()).data || [])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [session])

  // Cost Type CRUD
  const openCtDialog = (ct?: CostType) => {
    if (ct) {
      setEditCt(ct)
      setCtForm({ key: ct.key, label: ct.label, costModelPattern: ct.costModelPattern || "", isShared: ct.isShared, allocationMethod: ct.allocationMethod || "", color: ct.color || "#3B82F6" })
    } else {
      setEditCt(null)
      setCtForm({ key: "", label: "", costModelPattern: "", isShared: false, allocationMethod: "", color: "#3B82F6" })
    }
    setCtDialog(true)
  }

  const saveCt = async () => {
    setSaving(true)
    try {
      if (editCt) {
        await fetch("/api/budgeting/cost-types", {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: editCt.id, label: ctForm.label, costModelPattern: ctForm.costModelPattern || null, isShared: ctForm.isShared, allocationMethod: ctForm.allocationMethod || null, color: ctForm.color }),
        })
      } else {
        await fetch("/api/budgeting/cost-types", {
          method: "POST",
          headers,
          body: JSON.stringify(ctForm),
        })
      }
      setCtDialog(false)
      fetchData()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const deleteCt = async (id: string) => {
    await fetch(`/api/budgeting/cost-types?id=${id}`, { method: "DELETE", headers })
    fetchData()
  }

  // Department CRUD
  const openDeptDialog = (dept?: Department) => {
    if (dept) {
      setEditDept(dept)
      setDeptForm({ key: dept.key, label: dept.label, serviceKey: dept.serviceKey || "", hasRevenue: dept.hasRevenue, color: dept.color || "#3B82F6" })
    } else {
      setEditDept(null)
      setDeptForm({ key: "", label: "", serviceKey: "", hasRevenue: true, color: "#3B82F6" })
    }
    setDeptDialog(true)
  }

  const saveDept = async () => {
    setSaving(true)
    try {
      if (editDept) {
        await fetch("/api/budgeting/departments", {
          method: "PUT",
          headers,
          body: JSON.stringify({ id: editDept.id, label: deptForm.label, serviceKey: deptForm.serviceKey || null, hasRevenue: deptForm.hasRevenue, color: deptForm.color }),
        })
      } else {
        await fetch("/api/budgeting/departments", {
          method: "POST",
          headers,
          body: JSON.stringify(deptForm),
        })
      }
      setDeptDialog(false)
      fetchData()
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  const deleteDept = async (id: string) => {
    await fetch(`/api/budgeting/departments?id=${id}`, { method: "DELETE", headers })
    fetchData()
  }

  return (
    <div className="space-y-6">
      <DataBoundary loading={loading}>
      {/* Cost Types */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5" /> {t("configCostTypes")}
            </CardTitle>
            <Button size="sm" onClick={() => openCtDialog()}>
              <Plus className="h-4 w-4 mr-1" /> {t("configAdd")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t("configKey")}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t("configName")}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t("configCostModelPattern")}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t("configShared")}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t("configAllocation")}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t("configStatus")}</th>
                  <th className="px-3 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {costTypes.map(ct => (
                  <tr key={ct.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <ColorDot color={ct.color} />
                        {ct.key}
                      </div>
                    </td>
                    <td className="px-3 py-2">{ct.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{ct.costModelPattern || "—"}</td>
                    <td className="px-3 py-2 text-center">{ct.isShared ? <Badge variant="secondary" className="text-[10px]">{t("configShared")}</Badge> : "—"}</td>
                    <td className="px-3 py-2 text-center text-xs">{ct.allocationMethod || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      {ct.isActive ? <Badge className="bg-green-100 text-green-700 text-[10px]">{t("configActive")}</Badge> : <Badge variant="secondary" className="text-[10px]">{t("configDisabled")}</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openCtDialog(ct)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => deleteCt(ct.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {costTypes.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t("configNoCostTypes")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Departments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-5 w-5" /> {t("configDepartments")}
            </CardTitle>
            <Button size="sm" onClick={() => openDeptDialog()}>
              <Plus className="h-4 w-4 mr-1" /> {t("configAdd")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t("configKey")}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t("configName")}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">{t("configServiceKey")}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t("configRevenue")}</th>
                  <th className="px-3 py-2 text-center text-xs font-medium">{t("configStatus")}</th>
                  <th className="px-3 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {departments.map(d => (
                  <tr key={d.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <ColorDot color={d.color} />
                        {d.key}
                      </div>
                    </td>
                    <td className="px-3 py-2">{d.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.serviceKey || "—"}</td>
                    <td className="px-3 py-2 text-center">{d.hasRevenue ? <Badge className="bg-green-100 text-green-700 text-[10px]">{t("configYes")}</Badge> : <Badge variant="secondary" className="text-[10px]">{t("configNo")}</Badge>}</td>
                    <td className="px-3 py-2 text-center">
                      {d.isActive ? <Badge className="bg-green-100 text-green-700 text-[10px]">{t("configActive")}</Badge> : <Badge variant="secondary" className="text-[10px]">{t("configDisabled")}</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openDeptDialog(d)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => deleteDept(d.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {departments.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{t("configNoDepartments")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cost Type Dialog */}
      <Dialog open={ctDialog} onOpenChange={setCtDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editCt ? t("configEditCostType") : t("configNewCostType")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">{t("configKeyLabel")}</label>
              <Input value={ctForm.key} onChange={e => setCtForm({ ...ctForm, key: e.target.value })} disabled={!!editCt} placeholder="labor" />
            </div>
            <div>
              <label className="text-xs font-medium">{t("configNameLabel")}</label>
              <Input value={ctForm.label} onChange={e => setCtForm({ ...ctForm, label: e.target.value })} placeholder={t("configCostTypePlaceholder")} />
            </div>
            <div>
              <label className="text-xs font-medium">{t("configPatternLabel")}</label>
              <Input value={ctForm.costModelPattern} onChange={e => setCtForm({ ...ctForm, costModelPattern: e.target.value })} placeholder="serviceDetails.{dept}.directLabor" />
              <p className="text-[10px] text-muted-foreground mt-1">{t("configPatternHint", { dept: "{dept}" })}</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={ctForm.isShared} onChange={e => setCtForm({ ...ctForm, isShared: e.target.checked })} />
                {t("configSharedLabel")}
              </label>
            </div>
            {ctForm.isShared && (
              <div>
                <label className="text-xs font-medium">{t("configAllocationMethod")}</label>
                <select value={ctForm.allocationMethod} onChange={e => setCtForm({ ...ctForm, allocationMethod: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">{t("configAllocNone")}</option>
                  <option value="proportional">{t("configAllocProportional")}</option>
                  <option value="fixed">{t("configAllocFixed")}</option>
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-medium">{t("configColor")}</label>
              <div className="flex items-center gap-2">
                <input type="color" value={ctForm.color} onChange={e => setCtForm({ ...ctForm, color: e.target.value })} className="h-8 w-10 rounded border cursor-pointer" />
                <span className="text-xs font-mono text-muted-foreground">{ctForm.color}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCtDialog(false)}>{t("configCancel")}</Button>
            <Button onClick={saveCt} disabled={saving || !ctForm.key || !ctForm.label}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editCt ? t("configSave") : t("configCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Department Dialog */}
      <Dialog open={deptDialog} onOpenChange={setDeptDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editDept ? t("configEditDepartment") : t("configNewDepartment")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">{t("configKeyLabel")}</label>
              <Input value={deptForm.key} onChange={e => setDeptForm({ ...deptForm, key: e.target.value })} disabled={!!editDept} placeholder="it" />
            </div>
            <div>
              <label className="text-xs font-medium">{t("configNameLabel")}</label>
              <Input value={deptForm.label} onChange={e => setDeptForm({ ...deptForm, label: e.target.value })} placeholder={t("configDepartmentPlaceholder")} />
            </div>
            <div>
              <label className="text-xs font-medium">{t("configServiceKeyLabel")}</label>
              <Input value={deptForm.serviceKey} onChange={e => setDeptForm({ ...deptForm, serviceKey: e.target.value })} placeholder="permanent_it" />
              <p className="text-[10px] text-muted-foreground mt-1">{t("configServiceKeyHint")}</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={deptForm.hasRevenue} onChange={e => setDeptForm({ ...deptForm, hasRevenue: e.target.checked })} />
                {t("configGeneratesRevenue")}
              </label>
            </div>
            <div>
              <label className="text-xs font-medium">{t("configColor")}</label>
              <div className="flex items-center gap-2">
                <input type="color" value={deptForm.color} onChange={e => setDeptForm({ ...deptForm, color: e.target.value })} className="h-8 w-10 rounded border cursor-pointer" />
                <span className="text-xs font-mono text-muted-foreground">{deptForm.color}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptDialog(false)}>{t("configCancel")}</Button>
            <Button onClick={saveDept} disabled={saving || !deptForm.key || !deptForm.label}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editDept ? t("configSave") : t("configCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </DataBoundary>
    </div>
  )
}
