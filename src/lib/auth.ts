import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { z } from "zod"
import { prisma } from "./prisma"
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
          console.error("[Auth] Login error:", err)
          return null
        }
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const dbUser = await prisma.user.findFirst({
          where: { email: token.email! },
          include: { organization: true },
        })
        if (dbUser) {
          token.role = dbUser.role
          token.organizationId = dbUser.organizationId
          token.organizationName = dbUser.organization?.name || ""
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
