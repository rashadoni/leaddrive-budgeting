// Augment NextAuth's Session / User / JWT types with BudgetPro-specific fields
// added by the `session` and `jwt` callbacks in src/lib/auth.ts.
//
// Without this, every call site has to cast `(session.user as any).organizationId`
// which defeats TypeScript. Keep this file alongside other ambient types.

import type { DefaultJWT } from "next-auth/jwt"

// The app attaches these to `session.user` in the `session` callback of
// src/lib/auth.ts. `next-auth` v5 re-uses `Session` from `@auth/core/types`,
// so `next-auth/react`'s `useSession` picks up the augmentation.
interface BudgetProSessionUser {
  id: string
  role: string
  organizationId: string
  organizationName: string
  name?: string | null
  email?: string | null
  image?: string | null
}

declare module "next-auth" {
  interface Session {
    user: BudgetProSessionUser
  }
}

declare module "@auth/core/types" {
  interface Session {
    user: BudgetProSessionUser
  }
  // The Session.user property is typed as `User` in @auth/core/types — augment
  // User as well so access paths like `session.user.organizationId` type-check
  // without `as any` casts.
  interface User {
    id?: string
    role?: string
    organizationId?: string
    organizationName?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    role?: string
    organizationId?: string
    organizationName?: string
    authVersion?: number
    invalidated?: boolean
  }
}
