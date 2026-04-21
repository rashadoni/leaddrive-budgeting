import { prisma } from "@/lib/prisma"
import type { Role } from "@/lib/permissions"

/**
 * Get list of department IDs a user can access in the budgeting module.
 * Admin/manager roles get access to ALL departments.
 * Other roles get only departments they own via BudgetDepartmentOwner.
 */
export async function getUserDepartments(
  orgId: string,
  userId: string,
  role: Role,
): Promise<{ departmentIds: string[]; isFullAccess: boolean }> {
  // Admin and manager have full access
  if (role === "admin" || role === "manager") {
    return { departmentIds: [], isFullAccess: true }
  }

  const owners = await prisma.budgetDepartmentOwner.findMany({
    where: { organizationId: orgId, userId },
    select: { departmentId: true },
  })

  return {
    departmentIds: owners.map((o: { departmentId: string }) => o.departmentId),
    isFullAccess: false,
  }
}

/**
 * Check if a user can access a specific budget department.
 */
export async function canAccessDepartment(
  orgId: string,
  userId: string,
  role: Role,
  departmentId: string,
): Promise<boolean> {
  if (role === "admin" || role === "manager") return true

  const owner = await prisma.budgetDepartmentOwner.findUnique({
    where: {
      organizationId_departmentId_userId: {
        organizationId: orgId,
        departmentId,
        userId,
      },
    },
  })

  return !!owner
}

/**
 * Check if a user can edit a specific budget department.
 */
export async function canEditDepartment(
  orgId: string,
  userId: string,
  role: Role,
  departmentId: string,
): Promise<boolean> {
  if (role === "admin" || role === "manager") return true

  const owner = await prisma.budgetDepartmentOwner.findUnique({
    where: {
      organizationId_departmentId_userId: {
        organizationId: orgId,
        departmentId,
        userId,
      },
    },
  })

  return !!owner?.canEdit
}

/**
 * Check if a user can approve budgets for a specific department.
 */
export async function canApproveDepartment(
  orgId: string,
  userId: string,
  role: Role,
  departmentId?: string | null,
): Promise<boolean> {
  if (role === "admin" || role === "manager") return true
  if (!departmentId) return false

  const owner = await prisma.budgetDepartmentOwner.findUnique({
    where: {
      organizationId_departmentId_userId: {
        organizationId: orgId,
        departmentId,
        userId,
      },
    },
  })

  return !!owner?.canApprove
}

/**
 * Build a Prisma WHERE clause to filter by accessible departments.
 * Returns undefined if user has full access (no filter needed).
 */
export async function buildDeptFilter(
  orgId: string,
  userId: string,
  role: Role,
): Promise<{ departmentId: { in: string[] } } | undefined> {
  const { departmentIds, isFullAccess } = await getUserDepartments(orgId, userId, role)

  if (isFullAccess) return undefined

  return { departmentId: { in: departmentIds } }
}
