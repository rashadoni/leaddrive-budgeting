"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Trash2, Shield, Users } from "lucide-react"
import { useBudgetDeptOwners, useAssignDeptOwner, useRemoveDeptOwner } from "@/lib/budgeting/hooks"

interface User {
  id: string
  name: string
  email: string
  role: string
}

interface Department {
  id: string
  key: string
  label: string
}

export function BudgetDepartmentAccess() {
  const { data: session } = useSession()
  const orgId = (session?.user as any)?.organizationId

  const { data: owners = [], isLoading } = useBudgetDeptOwners()
  const assignOwner = useAssignDeptOwner()
  const removeOwner = useRemoveDeptOwner()

  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedDept, setSelectedDept] = useState("")
  const [selectedUser, setSelectedUser] = useState("")
  const [canEdit, setCanEdit] = useState(true)
  const [canApprove, setCanApprove] = useState(false)

  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/users", { headers: { "x-organization-id": orgId } })
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d) ? d : d.data || []))
      .catch(() => {})
    fetch("/api/budgeting/config?type=departments", { headers: { "x-organization-id": orgId } })
      .then((r) => r.json())
      .then((d) => setDepartments(Array.isArray(d) ? d : d.data || []))
      .catch(() => {})
  }, [orgId])

  const handleAssign = () => {
    if (!selectedDept || !selectedUser) return
    assignOwner.mutate({ departmentId: selectedDept, userId: selectedUser, canEdit, canApprove })
    setSelectedDept("")
    setSelectedUser("")
    setCanEdit(true)
    setCanApprove(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Department Budget Access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Assign form */}
        <div className="flex flex-wrap items-end gap-3 p-4 bg-muted/30 rounded-lg border">
          <div className="space-y-1.5">
            <Label className="text-xs">Department</Label>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="flex h-9 w-[180px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">User</Label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="flex h-9 w-[200px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select user</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} className="rounded" />
              Edit
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={canApprove} onChange={(e) => setCanApprove(e.target.checked)} className="rounded" />
              Approve
            </label>
          </div>

          <Button onClick={handleAssign} disabled={!selectedDept || !selectedUser || assignOwner.isPending} size="sm">
            {assignOwner.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Assign
          </Button>
        </div>

        {/* Current assignments */}
        {owners.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No department owners assigned yet.</p>
            <p className="text-xs">Admin and Manager roles have full access by default.</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium">Department</th>
                  <th className="text-left px-4 py-2 font-medium">User</th>
                  <th className="text-left px-4 py-2 font-medium">Role</th>
                  <th className="text-center px-4 py-2 font-medium">Edit</th>
                  <th className="text-center px-4 py-2 font-medium">Approve</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {owners.map((owner) => (
                  <tr key={owner.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Badge variant="outline">{owner.budgetDept.label}</Badge>
                    </td>
                    <td className="px-4 py-2">{owner.user.name}</td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className="text-xs">{owner.user.role}</Badge>
                    </td>
                    <td className="px-4 py-2 text-center">
                      {owner.canEdit ? <Badge className="bg-green-100 text-green-800 text-xs">Yes</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {owner.canApprove ? <Badge className="bg-blue-100 text-blue-800 text-xs">Yes</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="icon" onClick={() => removeOwner.mutate(owner.id)} disabled={removeOwner.isPending}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3">
          <strong>Note:</strong> Admin and Manager roles automatically have full access to all departments.
          Department owners only apply to Sales, Support, and Viewer roles.
        </div>
      </CardContent>
    </Card>
  )
}
