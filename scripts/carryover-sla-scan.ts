/**
 * Phase 8 F3 (2026-05-28) — weekly CARRYOVER SLA scan.
 *
 * Reads `docs/CARRYOVER.md`, finds 🔄 OPEN rows past the staleness
 * cutoff (default 30 days), and writes a CLI-friendly summary to
 * stdout. Exits non-zero when stale rows are found so the wrapper
 * cron / LaunchAgent can surface a notification.
 *
 *   npx tsx scripts/carryover-sla-scan.ts              # default 30d
 *   npx tsx scripts/carryover-sla-scan.ts --days 14    # tighter SLA
 *   npx tsx scripts/carryover-sla-scan.ts --json       # JSON output
 *
 * Cron suggestion (cron.d or LaunchAgent):
 *   0 9 * * MON cd /path/to/leaddrive-budgeting && \
 *     npx tsx scripts/carryover-sla-scan.ts >> ~/Library/Logs/carryover-sla.log 2>&1
 *
 * Exit codes:
 *   0  — no stale rows
 *   1  — stale rows present (non-blocking; wrapper decides whether to ping)
 *   2  — script error (CARRYOVER.md not found / parse failed)
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { scanCarryover, formatReport } from "../src/lib/carryover/scan-stale-rows"

const args = process.argv.slice(2)
const isJson = args.includes("--json")
const daysFlagIdx = args.indexOf("--days")
const cutoffDays =
  daysFlagIdx >= 0 && args[daysFlagIdx + 1]
    ? Number.parseInt(args[daysFlagIdx + 1], 10)
    : 30

if (!Number.isFinite(cutoffDays) || cutoffDays < 0) {
  console.error("Invalid --days value:", args[daysFlagIdx + 1])
  process.exit(2)
}

const repoRoot = resolve(__dirname, "..")
const carryoverPath = resolve(repoRoot, "docs/CARRYOVER.md")

let body: string
try {
  body = readFileSync(carryoverPath, "utf-8")
} catch (err) {
  console.error(
    `Could not read ${carryoverPath}:`,
    err instanceof Error ? err.message : String(err),
  )
  process.exit(2)
}

const result = scanCarryover(body, { cutoffDays })

if (isJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(formatReport(result))
}

process.exit(result.staleRows.length > 0 ? 1 : 0)
