/**
 * One-shot fix-up — tag IND_NEWS_SENTIMENT_30D as macro value source
 * so the pre-demo smoke gate stops flagging it as a misconfigured
 * per-company indicator. Sentiment is broadcast org-wide (one value
 * across all companies) since it's derived from intel items tagged at
 * the org / sector level — matches the `macro` semantic.
 *
 * Updates BOTH:
 *   - IndicatorDefinition.defaultValueSource (future creates pick it up)
 *   - existing IndicatorValue.valueSource rows (already-written cells)
 *
 * Usage:
 *   npx tsx scripts/apply-news-sentiment-macro-tag.ts
 *   npx tsx scripts/apply-news-sentiment-macro-tag.ts --dry-run
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const DRY_RUN = process.argv.includes("--dry-run")

async function main(): Promise<number> {
  console.log(
    `\n=== Tag IND_NEWS_SENTIMENT_30D as macro${DRY_RUN ? " (DRY-RUN)" : ""} ===\n`,
  )

  const def = await prisma.indicatorDefinition.findFirst({
    where: { code: "IND_NEWS_SENTIMENT_30D" },
    select: { id: true, code: true, defaultValueSource: true },
  })
  if (!def) {
    console.error("✗ IND_NEWS_SENTIMENT_30D definition not found")
    return 1
  }
  console.log(`Definition: ${def.code} (currently defaultValueSource=${def.defaultValueSource})`)

  const ivs = await prisma.indicatorValue.findMany({
    where: { indicatorId: def.id },
    select: { id: true, valueSource: true, company: { select: { code: true } } },
  })
  console.log(`Found ${ivs.length} IV row(s):`)
  for (const iv of ivs) {
    console.log(`  ${iv.company.code} valueSource=${iv.valueSource}`)
  }

  if (DRY_RUN) {
    console.log("\n(dry-run — no changes applied)\n")
    return 0
  }

  await prisma.indicatorDefinition.update({
    where: { id: def.id },
    data: { defaultValueSource: "macro" },
  })
  const updated = await prisma.indicatorValue.updateMany({
    where: { indicatorId: def.id },
    data: { valueSource: "macro" },
  })
  console.log(
    `\n✓ Tagged definition as macro + ${updated.count} IV row(s) updated\n`,
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
