/**
 * On-demand news crawl — fetches fresh real news for the org's active
 * companies/industries via the intel crawler (Anthropic web_search; no external
 * news-API key) and persists to intel_items. The prod scheduler
 * (intel-scheduler-bootstrap.ts) runs this on a 24h cadence; this is the manual
 * trigger for an immediate refresh.
 *
 * Run: (sandbox off) set -a; source .env; set +a; npx tsx scripts/run-news-crawl.ts
 */
import { prisma } from '@/lib/prisma'
import { runIntelCrawl } from '@/lib/intel/crawler'

async function main() {
  const org = await prisma.organization.findFirstOrThrow()
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, isActive: true },
    select: { code: true, industry: true },
  })
  const codes = companies.map((c) => c.code)
  const industries = [...new Set(companies.map((c) => c.industry).filter((x): x is string => !!x))]
  console.log(`Crawling news for ${codes.length} companies · industries: ${industries.join(', ')}`)

  const r = await runIntelCrawl({ organizationId: org.id, industries, companyCodes: codes, language: 'en' })
  console.log(`fetched=${r.itemsFetched} created=${r.itemsCreated} skipped=${r.itemsSkipped}`)
  if (r.errors.length) console.log('errors:', r.errors)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
