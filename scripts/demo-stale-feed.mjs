#!/usr/bin/env node
/**
 * 2026-05-27 — Demo helper: backdates IntelDataPoint.fetchedAt for one
 * reference source so the user can see the Drift ↔ Risk Terminal
 * integration kick in (health chip + ⏳ marker on dependent HeatMap
 * cells).
 *
 * Usage:
 *   node scripts/demo-stale-feed.mjs weather-openmeteo --days 5  # make stale
 *   node scripts/demo-stale-feed.mjs --restore                    # bump latest point to NOW
 *
 * The default target is `weather-openmeteo` because it backs
 * AGRO_DROUGHT_RISK — visible on AZSEKER-EDEN / AZSEKER-FARM rows.
 */
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

dotenvConfig({ path: path.resolve(process.cwd(), ".env"), override: true });
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local"), override: true });

const prisma = new PrismaClient();

async function main() {
  const argv = process.argv.slice(2);
  const restore = argv.includes("--restore");
  const target =
    argv.find((a) => !a.startsWith("--")) ?? "weather-openmeteo";
  const daysIdx = argv.indexOf("--days");
  const ageDays = daysIdx >= 0 ? Number(argv[daysIdx + 1]) : 5;

  if (!Number.isFinite(ageDays) || ageDays < 0) {
    console.error("✗ --days must be a non-negative number");
    process.exit(1);
  }

  console.log(
    `→ Target source: ${target}\n→ Mode: ${restore ? "RESTORE (set fetchedAt to NOW)" : `STALE (set fetchedAt to ${ageDays} days ago)`}\n`,
  );

  // Find latest IntelDataPoint(s) for this source
  const latest = await prisma.intelDataPoint.findFirst({
    where: { sourceCode: target },
    orderBy: { fetchedAt: "desc" },
  });
  if (!latest) {
    console.error(
      `✗ No IntelDataPoint rows found for source «${target}». Run intel-scheduler-bootstrap first.`,
    );
    process.exit(1);
  }
  console.log(
    `  Latest point: id=${latest.id.slice(0, 8)}… fetchedAt=${latest.fetchedAt.toISOString()}`,
  );

  // The freshness helper reads max(fetchedAt). Initial design tried to
  // limit the update to rows from the same batch, but actual ingestion
  // writes rows with millisecond-distinct timestamps (each metric gets
  // its own fetchedAt assignment), so we must move EVERY row for this
  // source — otherwise the second-newest row still reads as "fresh".
  const targetTs = restore
    ? new Date()
    : new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);

  const result = await prisma.intelDataPoint.updateMany({
    where: { sourceCode: target },
    data: { fetchedAt: targetTs },
  });
  console.log(
    `\n✓ Updated ${result.count} row(s) — fetchedAt → ${targetTs.toISOString()}`,
  );

  if (!restore) {
    console.log(
      `\nFreshness verdict for daily-cadence source:\n  ageHours=${(ageDays * 24).toFixed(1)}h\n  stale > 36h, critical > 72h\n  → ${ageDays * 24 > 72 ? "critical_stale" : ageDays * 24 > 36 ? "stale" : "fresh"}\n`,
    );
    console.log(
      "Reload /budgeting/terminal — the `[health]` chip should flip to amber/rose,\n" +
        "and `⏳` markers should appear on AGRO_DROUGHT_RISK cells for entities\n" +
        "in agro_crops industry (AZSEKER-EDEN, AZSEKER-FARM).\n",
    );
    console.log("To undo: node scripts/demo-stale-feed.mjs --restore\n");
  }
}

main()
  .catch((e) => {
    console.error("✗", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
