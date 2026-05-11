/**
 * Phase 7.G CXXXIX — create AZMADE demo user(s).
 *
 * Idempotent: if user with same email already exists in azmade org, the
 * password is RESET to the provided value (so you don't need to remember
 * what was set last time).
 *
 * Usage:
 *   node scripts/create-azmade-user.cjs
 *
 * Default users created:
 *   admin@azmade.com / Demo2026!  (role=admin)
 *   cfo@azmade.com   / Demo2026!  (role=manager)
 *   viewer@azmade.com / Demo2026! (role=viewer)
 *
 * Override by env vars:
 *   USER_EMAIL=foo@x.com USER_PASSWORD=Pass123! USER_ROLE=admin USER_NAME=Foo \
 *     node scripts/create-azmade-user.cjs
 */
const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

async function upsertUser(orgId, email, password, role, name) {
  const passwordHash = await bcrypt.hash(password, 10)
  const existing = await prisma.user.findFirst({
    where: { organizationId: orgId, email },
    select: { id: true },
  })
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role, name, isActive: true },
    })
    console.log(`  ↻ Updated: ${email} (role=${role}, password reset)`)
  } else {
    await prisma.user.create({
      data: { organizationId: orgId, email, name, passwordHash, role, isActive: true },
    })
    console.log(`  ✓ Created: ${email} (role=${role})`)
  }
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true, name: true } })
  if (!org) throw new Error('AZMADE org not found — run `npx tsx scripts/seed-azmade-holding.ts` first')
  console.log(`\n=== Creating demo users for ${org.name} (${org.id}) ===\n`)

  // CLI override mode: single user from env vars
  if (process.env.USER_EMAIL && process.env.USER_PASSWORD) {
    await upsertUser(
      org.id,
      process.env.USER_EMAIL,
      process.env.USER_PASSWORD,
      process.env.USER_ROLE || "admin",
      process.env.USER_NAME || process.env.USER_EMAIL,
    )
  } else {
    // Default: create the 3 standard demo users
    await upsertUser(org.id, "admin@azmade.com", "Demo2026!", "admin", "AZMADE Admin")
    await upsertUser(org.id, "cfo@azmade.com", "Demo2026!", "manager", "AZMADE CFO")
    await upsertUser(org.id, "viewer@azmade.com", "Demo2026!", "viewer", "AZMADE Viewer")
  }

  console.log(`\n=== DONE ===`)
  console.log(`Login at: http://localhost:3000/login`)
  console.log(`Default password: Demo2026!`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
