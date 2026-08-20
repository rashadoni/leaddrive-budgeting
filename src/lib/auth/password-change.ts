import { z } from "zod"
import type { NextRequest } from "next/server"

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 64
export const BCRYPT_MAX_PASSWORD_BYTES = 72

const utf8Length = (value: string) => Buffer.byteLength(value, "utf8")

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .max(PASSWORD_MAX_LENGTH)
      .refine((value) => utf8Length(value) <= BCRYPT_MAX_PASSWORD_BYTES, {
        message: "password_too_many_bytes",
      }),
  })
  .strict()

function configuredOrigin(request: NextRequest): string | null {
  const configured = process.env.NEXTAUTH_URL || process.env.AUTH_URL
  try {
    return new URL(configured || request.nextUrl.origin).origin
  } catch {
    return null
  }
}

/** Password mutations are browser-only and must originate from this app. */
export function hasTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin")
  const expected = configuredOrigin(request)
  if (!origin || !expected) return false
  try {
    return new URL(origin).origin === expected
  } catch {
    return false
  }
}

/** Never accept current/new credentials over plaintext transport in prod. */
export function hasSecurePasswordTransport(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim()
    .toLowerCase()
  return forwardedProto === "https" || request.nextUrl.protocol === "https:"
}
