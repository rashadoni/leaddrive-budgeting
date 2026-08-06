/**
 * Demo tenant for the "Assumptions" video guide (2026-08-06).
 *
 *   DATABASE_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… npx tsx scripts/seed-assumptions-demo.ts
 *
 * Why this exists
 * ───────────────
 * `scripts/produce-guides.mjs` expects a demo tenant (`RESEED` → demo-fill.mjs),
 * and this project has no demo-fill. The guide for the Fərziyyələr tab needs
 * rows on screen — an empty tab records as an empty tab — and the video-guide
 * regulation is explicit that takes run against a DEMO tenant, never live data.
 *
 * That rule is load-bearing here rather than procedural: a help video ships to
 * every user and may be published, so a take against production would put the
 * holding's real cost structure and its per-company imported-input shares into
 * a shareable MP4. **Every figure below is invented for the recording.** The
 * companies are named after the client's so the layout matches what a viewer
 * sees, but no value here came from their books.
 *
 * Scope is deliberately small: the assumptions tab reads `BudgetAssumption`
 * alone. It needs no budget lines, no indicators and no actuals — the KPI
 * strip, the treemap, the donut and the table all derive from these rows plus
 * the companies an override points at.
 *
 * Idempotent: re-running replaces this org's demo assumptions rather than
 * appending, so a retake never records a table that grew between takes.
 */
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

const ORG_SLUG = process.env.DEMO_ORG_SLUG || "guide-demo"
const PLAN_YEAR = Number(process.env.DEMO_PLAN_YEAR || 2026)

/** Mirrors the client's entity mix so the recorded layout matches reality. */
const COMPANIES = [
  { code: "CPC", name: "Corn Processing Company MMC", industry: "food_processing" },
  { code: "AZSF", name: "Azərşəkər MMC", industry: "food_processing" },
  { code: "EDEN", name: "Eden Agro MMC", industry: "agro_crops" },
  { code: "PROMALT", name: "Promalt MMC", industry: "food_processing" },
]

/**
 * The rows the take shows. `company` null = plan-level default.
 *
 * INVENTED VALUES — see the header. They are chosen only to be plausible on
 * screen and to exercise every visual state the narration mentions:
 *   · a plan default that several companies inherit,
 *   · company overrides that visibly differ from it,
 *   · a stated zero (a genuinely domestic cost base),
 *   · more than one category so the treemap and donut have segments,
 *   · one duplicated plan-level key so the amber ambiguity banner renders.
 */
const ASSUMPTIONS: Array<{
  key: string
  label: string
  value: number
  unit: string | null
  period: string | null
  category: string
  company: string | null
  notes: string | null
  sortOrder?: number
}> = [
  // ── the driver the scenario engine actually reads ────────────────────
  { key: "import_share", label: "Idxal xərclərinin payı", value: 0.3, unit: "%", period: "annual", category: "fx", company: null,
    notes: "Holdinq üzrə defolt — şirkət öz dəyərini bildirməyibsə" },
  { key: "import_share", label: "Idxal xərclərinin payı", value: 0.72, unit: "%", period: "annual", category: "fx", company: "CPC",
    notes: "Xam qarğıdalı idxalı üzrə müqavilələrin orta payı" },
  { key: "import_share", label: "Idxal xərclərinin payı", value: 0.65, unit: "%", period: "annual", category: "fx", company: "AZSF",
    notes: "Xam şəkər idxalı, 2026 satınalma planı" },
  { key: "import_share", label: "Idxal xərclərinin payı", value: 0.18, unit: "%", period: "annual", category: "fx", company: "EDEN",
    notes: "Yalnız dərman və gübrə idxaldır" },
  { key: "import_share", label: "Idxal xərclərinin payı", value: 0, unit: "%", period: "annual", category: "fx", company: "PROMALT",
    notes: "Xammal tam daxili bazardan — sıfır bilərəkdən yazılıb" },

  // ── the second wired driver ─────────────────────────────────────────
  { key: "cost_rigidity", label: "Batmış xərclərin payı", value: 0.35, unit: "%", period: "annual", category: "operations", company: null,
    notes: "Defolt: həcm düşəndə xərclərin bu hissəsi qalır" },
  { key: "cost_rigidity", label: "Batmış xərclərin payı", value: 0.8, unit: "%", period: "annual", category: "operations", company: "EDEN",
    notes: "Toxum, gübrə, suvarma məhsuldan əvvəl xərclənir" },

  // ── stored and readable, but no lever consumes them yet ─────────────
  { key: "fx_usd", label: "USD / AZN plan məzənnəsi", value: 1.7, unit: "AZN", period: "annual", category: "fx", company: null,
    notes: "Plan məzənnəsi — canlı lent susanda ssenari buna bağlanır" },
  { key: "inflation", label: "İnflyasiya", value: 0.06, unit: "%", period: "annual", category: "inflation", company: null,
    notes: "Mərkəzi Bank proqnozunun orta həddi" },
  { key: "tax_rate", label: "Mənfəət vergisi dərəcəsi", value: 0.2, unit: "%", period: "annual", category: "tax", company: null, notes: null },
  { key: "wage_growth", label: "Əmək haqqı artımı", value: 0.09, unit: "%", period: "annual", category: "hr", company: null,
    notes: "HR büdcəsi ilə razılaşdırılıb" },
  { key: "price_growth", label: "Satış qiymətlərinin artımı", value: 0.04, unit: "%", period: "annual", category: "pricing", company: null, notes: null },
  { key: "yield_per_ha", label: "Hektardan məhsuldarlıq", value: 5.4, unit: "ton", period: "annual", category: "operations", company: "EDEN",
    notes: "Son üç ilin ortası" },

  // ── deliberate duplicate: renders the amber ambiguity banner ────────
  // Two plan-level rows for one key is exactly the state `resolveAssumption`
  // breaks deterministically and the tab is supposed to disclose. Scene 10
  // narrates this, so the take needs it on screen.
  { key: "inflation", label: "İnflyasiya (köhnə qiymətləndirmə)", value: 0.08, unit: "%", period: "annual", category: "inflation", company: null,
    notes: "Dublikat — bilərəkdən saxlanılıb, xəbərdarlığı göstərmək üçün", sortOrder: 5 },
]

async function main() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required (use the RECORDER_* credentials).")
  }

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { name: "Guide Demo Holding", slug: ORG_SLUG },
  })

  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email } },
    update: { passwordHash: await bcrypt.hash(password, 12), role: "admin", isActive: true },
    create: {
      organizationId: org.id,
      email,
      name: "Guide Recorder",
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin",
      isActive: true,
    },
  })

  // Holding root + operating companies. Level 2 + an industry is what
  // `filterOperationalCompanies` treats as an operating leaf.
  const holding = await prisma.company.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "HOLDING" } },
    update: {},
    create: {
      organizationId: org.id, code: "HOLDING", name: "Guide Demo Holding",
      level: 1, role: "holding", isActive: true, status: "active",
    },
  })

  const codeToId = new Map<string, string>()
  for (const c of COMPANIES) {
    const row = await prisma.company.upsert({
      where: { organizationId_code: { organizationId: org.id, code: c.code } },
      update: { name: c.name, industry: c.industry },
      create: {
        organizationId: org.id, code: c.code, name: c.name, industry: c.industry,
        parentCompanyId: holding.id, level: 2, role: "operational", isActive: true, status: "active",
      },
    })
    codeToId.set(c.code, row.id)
  }

  const plan =
    (await prisma.budgetPlan.findFirst({
      where: { organizationId: org.id, year: PLAN_YEAR, name: "Guide Demo Budget" },
    })) ??
    (await prisma.budgetPlan.create({
      data: {
        organizationId: org.id, name: "Guide Demo Budget",
        periodType: "annual", year: PLAN_YEAR, status: "draft", kind: "budget",
      },
    }))

  // Replace rather than append — a retake must not record a table that grew.
  await prisma.budgetAssumption.deleteMany({ where: { organizationId: org.id, planId: plan.id } })

  let sortOrder = 0
  for (const a of ASSUMPTIONS) {
    await prisma.budgetAssumption.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        companyId: a.company ? (codeToId.get(a.company) ?? null) : null,
        category: a.category,
        key: a.key,
        label: a.label,
        value: a.value,
        unit: a.unit,
        period: a.period,
        notes: a.notes,
        sortOrder: a.sortOrder ?? sortOrder++,
      },
    })
  }

  const overrides = ASSUMPTIONS.filter((a) => a.company).length
  console.log(`org        : ${org.slug} (${org.id})`)
  console.log(`plan       : ${plan.name} ${plan.year} (${plan.id})`)
  console.log(`companies  : ${COMPANIES.length} operating + 1 holding`)
  console.log(`assumptions: ${ASSUMPTIONS.length} rows — ${ASSUMPTIONS.length - overrides} plan-level, ${overrides} company overrides`)
  console.log(`duplicate  : inflation stated twice at plan level (amber banner is expected)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
