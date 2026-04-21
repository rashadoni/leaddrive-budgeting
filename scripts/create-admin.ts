import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"

const prisma = new PrismaClient()

function generateStrongPassword(): string {
  // 20 chars, url-safe base64, cryptographically random
  return randomBytes(15).toString("base64url")
}

async function main() {
  const email = process.env.ADMIN_EMAIL
  if (!email) {
    throw new Error("ADMIN_EMAIL env var is required. Example: ADMIN_EMAIL=you@example.com npx tsx scripts/create-admin.ts")
  }

  const providedPassword = process.env.ADMIN_PASSWORD
  const password = providedPassword || generateStrongPassword()
  const generated = !providedPassword

  const passwordHash = await bcrypt.hash(password, 12)

  const orgSlug = process.env.ADMIN_ORG_SLUG || "demo"
  const orgName = process.env.ADMIN_ORG_NAME || "Demo Company"

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { name: orgName, slug: orgSlug },
  })

  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email } },
    update: { passwordHash },
    create: {
      organizationId: org.id,
      email,
      name: "Admin",
      passwordHash,
      role: "admin",
      isActive: true,
    },
  })

  console.log("Organization:", org.id, org.name)
  console.log("User:", user.email)
  if (generated) {
    console.log("\n================================================")
    console.log("GENERATED PASSWORD (shown ONCE, save it now):")
    console.log(password)
    console.log("================================================\n")
  } else {
    console.log("Password: (set from ADMIN_PASSWORD env var)")
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
