/**
 * One-shot: save a single org-level API key via the same helper the
 * admin UI uses, then immediately trigger the matching adapter to
 * prove the key works end-to-end. Writes data points to IntelDataPoint.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/save-api-key-and-fetch.ts <source> <key>
 *
 * source ∈ {eia, usda, gtrends}
 */
import { PrismaClient } from "@prisma/client"
import { setApiKeys, listApiKeys, type ApiKeySource } from "../src/lib/intel/api-keys"
import { getCommodityAdapters } from "../src/lib/intel/commodity"

const prisma = new PrismaClient()

async function main() {
  const [, , source, key] = process.argv
  if (!source || !key) {
    console.error("Usage: npx tsx scripts/save-api-key-and-fetch.ts <source> <key>")
    process.exit(2)
  }
  const validSources: ApiKeySource[] = ["eia", "usda", "gtrends"]
  if (!validSources.includes(source as ApiKeySource)) {
    console.error(`Unknown source. Allowed: ${validSources.join(", ")}`)
    process.exit(2)
  }

  const org = await prisma.organization.findFirst({
    select: { id: true, name: true },
  })
  if (!org) throw new Error("No organization in DB")
  console.log(`Org: ${org.name} (${org.id})`)

  // 1. Save the key via the SAME helper /admin/api-keys uses.
  const writeResult = await setApiKeys(prisma as never, org.id, { [source]: key })
  if (writeResult.errors.length > 0) {
    console.error("Save failed:", writeResult.errors)
    process.exit(1)
  }
  console.log(`✓ saved api key for source "${source}" (updated: ${writeResult.updated.join(",")})`)

  // 2. Write an audit-event so the trail mirrors the UI flow.
  await prisma.auditEvent.create({
    data: {
      organizationId: org.id,
      actorUserId: null, // CLI write — no UI session
      action: "api_key_update",
      entityType: "Organization",
      entityId: org.id,
      metadata: {
        updated: writeResult.updated,
        cleared: writeResult.cleared,
        via: "scripts/save-api-key-and-fetch.ts",
      },
    },
  })
  console.log(`✓ audit event written`)

  // 3. Verify via listApiKeys (round-trip).
  const keys = await listApiKeys(prisma as never, org.id)
  console.log(`✓ round-trip verified: keys=${JSON.stringify({
    eia: keys.eia ? "(set)" : null,
    usda: keys.usda ? "(set)" : null,
    gtrends: keys.gtrends ? "(set)" : null,
  })}`)

  // 4. Map source → adapter source code and trigger fetch.
  const sourceCodeMap: Record<ApiKeySource, string> = {
    eia: "eia-energy",
    usda: "usda-nass",
    gtrends: "google-trends-az",
    // Phase 8 C4 — anthropic isn't an external-data adapter (no
    // sourceCode in the catalog); it's the LLM client itself. This
    // script only fetches adapter data, so anthropic→noop sentinel.
    anthropic: "(llm-client; no fetch adapter)",
  }
  const adapterSourceCode = sourceCodeMap[source as ApiKeySource]
  const adapters = getCommodityAdapters({ apiKeys: { [source]: key } as never })
  const adapter = adapters.find((a) => a.source === adapterSourceCode)
  if (!adapter) {
    console.error(`No adapter found for "${adapterSourceCode}"`)
    process.exit(1)
  }
  console.log(`\nTriggering ${adapterSourceCode} adapter...`)
  const result = await adapter.fetch(new Date())
  console.log(
    `Result: fetched=${result.fetched} · ${result.dataPoints.length} points · errors=${result.errors.length}`,
  )
  if (result.errors.length > 0) {
    for (const e of result.errors) console.log(`  err: ${e}`)
  }

  // 5. Persist data points if any.
  let written = 0
  for (const dp of result.dataPoints) {
    try {
      await prisma.intelDataPoint.upsert({
        where: {
          organizationId_sourceCode_metric_datetime: {
            organizationId: org.id,
            sourceCode: dp.sourceCode,
            metric: dp.metric,
            datetime: dp.datetime,
          },
        },
        update: { value: dp.value, unit: dp.unit, raw: (dp.raw ?? {}) as never },
        create: {
          organizationId: org.id,
          sourceCode: dp.sourceCode,
          metric: dp.metric,
          datetime: dp.datetime,
          value: dp.value,
          unit: dp.unit,
          raw: (dp.raw ?? {}) as never,
        },
      })
      written++
    } catch {
      // continue
    }
  }
  console.log(`✓ wrote ${written} data points to IntelDataPoint`)

  // 6. Show first 5 data points for sanity check.
  if (result.dataPoints.length > 0) {
    console.log(`\nSample (first 5):`)
    for (const dp of result.dataPoints.slice(0, 5)) {
      console.log(
        `  ${dp.metric.padEnd(28)} ${String(dp.value).padStart(10)} ${dp.unit ?? ""}  @ ${dp.datetime.toISOString().slice(0, 10)}`,
      )
    }
  }
}

main()
  .catch((e) => {
    console.error("Script error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
