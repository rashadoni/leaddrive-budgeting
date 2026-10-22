/**
 * Rotate an existing user's login password — safe, org-agnostic.
 *
 * Unlike `scripts/create-admin.ts` (which upserts keyed by
 * `organizationId_email` off a default org slug, and would CREATE a duplicate
 * admin in the wrong org if the slug doesn't match), this script finds the
 * user by email ALONE and updates only that row's `passwordHash` by id — so a
 * rotation can never fork the account or touch org membership.
 *
 * USAGE (bcrypt hashing needs Node, so run inside the app container):
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='<new-strong-pw>' \
 *     npx tsx scripts/rotate-admin-password.ts
 *
 *   # omit ADMIN_PASSWORD to have a strong one generated + printed ONCE:
 *   ADMIN_EMAIL=admin@example.com npx tsx scripts/rotate-admin-password.ts
 *
 * On a DB where RLS is enforced on the default role, run with the BYPASSRLS
 * connection so the `users` read/update isn't hidden by RLS:
 *   DATABASE_URL="$DATABASE_URL_ADMIN" ADMIN_EMAIL=… npx tsx scripts/rotate-admin-password.ts
 *
 * Idempotent-ish: re-running sets the password again (to a new value each run
 * if generated). Never creates a user, never changes org/role/active state.
 *
 * Every rotation also ends the account's existing sessions (see the
 * `authVersion` note on the update below), so the operator running this — and
 * anyone holding a stolen cookie — has to sign in again with the new password.
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"

const prisma = new PrismaClient()

/**
 * Mirrors `PASSWORD_MIN_LENGTH` in `src/lib/auth/password-change.ts`. Copied,
 * not imported: the production image ships `scripts/` without `src/`, so an
 * `@/lib/...` import would make this script crash on the one box it exists for.
 * Only used for a warning — the script still sets whatever the operator asked.
 */
const UI_PASSWORD_MIN_LENGTH = 12

/** 20 chars, url-safe base64, cryptographically random. */
function generateStrongPassword(): string {
  return randomBytes(15).toString("base64url")
}

async function main() {
  const email = process.env.ADMIN_EMAIL
  if (!email) {
    throw new Error(
      "ADMIN_EMAIL env var is required. Example: ADMIN_EMAIL=you@example.com npx tsx scripts/rotate-admin-password.ts",
    )
  }

  // Find by email alone (across every org). Refuse to guess if an email is
  // somehow reused across tenants — the operator must disambiguate.
  const matches = await prisma.user.findMany({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      organizationId: true,
      organization: { select: { slug: true, name: true } },
    },
  })
  if (matches.length === 0) {
    throw new Error(`No user found with email "${email}".`)
  }
  if (matches.length > 1) {
    const where = matches
      .map((u) => `org=${u.organization?.slug ?? u.organizationId}`)
      .join(", ")
    throw new Error(
      `Email "${email}" exists in ${matches.length} orgs (${where}). ` +
        `Ambiguous — rotate by a unique account instead.`,
    )
  }

  const target = matches[0]
  const providedPassword = process.env.ADMIN_PASSWORD
  const password = providedPassword || generateStrongPassword()
  const generated = !providedPassword
  const passwordHash = await bcrypt.hash(password, 12)

  // `authVersion` is the session-revocation contract: `prisma/schema.prisma`
  // says it is "incremented whenever a password is changed or reset", and
  // `src/lib/auth/session-version.ts` rejects any JWT whose version no longer
  // matches. Both UI paths (`/api/account/password`,
  // `/api/users/[id]/password-reset`) increment it; this script did not, so a
  // rotation left every session issued under the OLD password still valid —
  // which defeats the point of rotating a credential that may have leaked.
  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash, authVersion: { increment: 1 } },
  })

  console.log("Rotated password for:")
  console.log("  user :", target.email, `(role=${target.role}, active=${target.isActive})`)
  console.log("  org  :", target.organization?.name, `(${target.organization?.slug})`)
  console.log("  sessions: all existing logins for this account are now invalid")
  if (password.length < UI_PASSWORD_MIN_LENGTH) {
    console.log(
      `  note : ${password.length} chars — the app's own password form requires ` +
        `${UI_PASSWORD_MIN_LENGTH}+, so this one could not be set from the UI.`,
    )
  }
  if (generated) {
    console.log("\n================================================")
    console.log("GENERATED PASSWORD (shown ONCE, save it now):")
    console.log(password)
    console.log("================================================\n")
  } else {
    console.log("  password: (set from ADMIN_PASSWORD env var)")
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
