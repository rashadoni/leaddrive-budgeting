import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { z } from "zod"
// Phase 5.2 S5 RLS — the auth path (adapter + credentials user lookup + jwt
// refresh) runs BEFORE any org context exists and reads the RLS-covered `users`
// table, so it MUST use the BYPASSRLS `prismaAdmin` client. Under the app role
// with no `app.organization_id` set, `users` would return 0 rows → login
// bricked. `users`/`organizations` reads here are already tightly bounded by
// NextAuth's own flow. (plan risk #1: "Login bricked at final flip".)
import { prismaAdmin as prisma } from "./db/prisma-admin"
import { getLogger } from "./log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("auth")
import bcrypt from "bcryptjs"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null

        try {
          const user = await prisma.user.findFirst({
            where: { email: parsed.data.email, isActive: true },
            include: { organization: true },
          })
          if (!user) return null

          const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
          if (!valid) return null

          await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() },
          }).catch(() => {})

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            organizationId: user.organizationId,
            organizationName: user.organization.name,
          }
        } catch (err) {
          log.error("Login error", {
            err: err instanceof Error ? err.message : String(err),
          })
          return null
        }
      },
    }),
  ],
  // CLI: JWT cache TTL reduced 8h → 1h so org-name / role / sub-group
  // changes surface in ≤1h instead of ≤8h. NextAuth refreshes only on
  // access; sliding-window means mid-session users aren't logged out.
  session: { strategy: "jwt", maxAge: 60 * 60 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      // Re-read role / organization from DB on every refresh, not just at
      // login. Otherwise renaming an org (or changing role) never surfaces
      // until logout — the `if (user)` guard meant subsequent requests
      // returned the cached token verbatim, defeating the 1h maxAge.
      // Refreshes every ~30s via a stamp on the token to avoid hammering
      // the DB on every API hit while still surfacing changes quickly.
      const REFRESH_MS = 30_000
      const stamp = (token as { _refreshedAt?: number })._refreshedAt ?? 0
      const fresh = user != null || Date.now() - stamp > REFRESH_MS
      if (fresh && token.email) {
        const dbUser = await prisma.user.findFirst({
          where: { email: token.email },
          include: { organization: true },
        })
        if (dbUser) {
          token.role = dbUser.role
          token.organizationId = dbUser.organizationId
          token.organizationName = dbUser.organization?.name || ""
          ;(token as { _refreshedAt?: number })._refreshedAt = Date.now()
        }
      }
      return token
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub as string,
          role: token.role as string,
          organizationId: token.organizationId as string,
          organizationName: token.organizationName as string,
        },
      }
    },
  },
})
