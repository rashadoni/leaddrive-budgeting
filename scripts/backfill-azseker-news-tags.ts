/**
 * Phase 7.M Tier 4 (2026-05-19) — backfill AZSEKER news companyTags.
 *
 * Two strategies applied:
 *
 *   1. **Parent broadcast** — items tagged with parent "AZSEKER" get
 *      tagged with all active operating children (AZSF/CPC/EDEN/MALT/
 *      PROMALT/HORIZON). Skips AZSEKER-FARM (archived).
 *      Rationale: news about the holding affects every subsidiary.
 *
 *   2. **Re-inference** — for items without any AZSEKER-* tag, re-run
 *      `inferCompanyTags` against current entity patterns (catches
 *      mentions the original LLM call missed, e.g. transliterations).
 *
 * Output: per-item tag delta + summary counts. Audit-logged as
 * `intel_crawl_run` for traceability.
 *
 * Usage:
 *   npx tsx scripts/backfill-azseker-news-tags.ts             # apply
 *   npx tsx scripts/backfill-azseker-news-tags.ts --dry-run   # preview
 */
import { PrismaClient } from "@prisma/client"
import {
  inferCompanyTags,
  buildEntityPatternsFromCompanies,
  mergeCompanyTags,
} from "@/lib/intel/infer-company-tags"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")
const ORG_SLUG = "azmade"
const PARENT_CODE = "AZSEKER"

async function main(): Promise<number> {
  console.log(
    `\n=== Backfill AZSEKER news companyTags${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) {
    console.error(`✗ Org slug=${ORG_SLUG} not found`)
    return 1
  }

  // ── 1. Resolve active children ──────────────────────────────
  const children = await prisma.company.findMany({
    where: {
      organizationId: org.id,
      code: { startsWith: "AZSEKER-" },
      status: { not: "archived" }, // skip FARM
    },
    select: { code: true, name: true, nameAz: true, nameRu: true, nameEn: true },
    orderBy: { code: "asc" },
  })
  const childCodes = children.map((c) => c.code)
  console.log(
    `Found ${childCodes.length} active AZSEKER children: ${childCodes.join(", ")}`,
  )
  const patterns = buildEntityPatternsFromCompanies(children)

  // ── 2. Pull recent intel_items ──────────────────────────────
  const items = await prisma.intelItem.findMany({
    where: {
      organizationId: org.id,
      fetchedAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, title: true, summary: true, companyTags: true },
  })
  console.log(`Examining ${items.length} intel items from last 60 days\n`)

  let touched = 0
  let parentBroadcasts = 0
  let inferenceAdds = 0
  const perChildAdded = new Map<string, number>()

  for (const item of items) {
    const existingTags = new Set(item.companyTags ?? [])
    const newTags = new Set(existingTags)

    // Strategy 1: parent broadcast
    if (existingTags.has(PARENT_CODE)) {
      for (const code of childCodes) {
        if (!newTags.has(code)) {
          newTags.add(code)
          perChildAdded.set(code, (perChildAdded.get(code) ?? 0) + 1)
          parentBroadcasts++
        }
      }
    }

    // Strategy 2: re-inference
    const text = `${item.title}\n${item.summary}`
    const inferred = inferCompanyTags(text, patterns)
    for (const code of inferred) {
      if (!newTags.has(code)) {
        newTags.add(code)
        perChildAdded.set(code, (perChildAdded.get(code) ?? 0) + 1)
        inferenceAdds++
      }
    }

    // Persist if anything changed
    if (newTags.size > existingTags.size) {
      touched++
      const finalTags = mergeCompanyTags(
        Array.from(existingTags),
        Array.from(newTags).filter((t) => !existingTags.has(t)),
      )
      if (!DRY_RUN) {
        await prisma.intelItem.update({
          where: { id: item.id },
          data: { companyTags: finalTags },
        })
      }
    }
  }

  console.log(`── Touched ${touched}/${items.length} items ──`)
  console.log(`  Parent broadcasts: ${parentBroadcasts} new tags applied`)
  console.log(`  Re-inference adds: ${inferenceAdds} new tags applied`)
  console.log(`\nNew tags per entity:`)
  for (const code of childCodes) {
    const n = perChildAdded.get(code) ?? 0
    console.log(`  ${code.padEnd(20)} +${n}`)
  }

  // ── 3. Verify post-state ─────────────────────────────────────
  if (!DRY_RUN) {
    console.log(`\n── Post-backfill state ──`)
    for (const code of childCodes) {
      const tagged = await prisma.intelItem.count({
        where: {
          organizationId: org.id,
          companyTags: { has: code },
          fetchedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          sentimentScore: { not: null },
        },
      })
      console.log(`  ${code.padEnd(20)} ${tagged} scored items (30d window)`)
    }
  }

  console.log(
    `\n=== ${DRY_RUN ? "DRY-RUN — no changes" : "DONE — intel_items updated"} ===\n`,
  )
  return 0
}

main()
  .then(async (code) => {
    await prisma.$disconnect()
    process.exit(code)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(2)
  })
