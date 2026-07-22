/**
 * RETIRED — fail-closed guard for the former EDEN drought derivation script.
 *
 * The old implementation is unsafe to run because it:
 *   - wrote drought_index on a 0–100 scale while the canonical contract is 0–10;
 *   - selected the latest weather rows without a target-period cutoff;
 *   - inferred a multi-region rainfall policy that the owner has not approved;
 *   - applied database writes by default.
 *
 * Keep this path as an executable guard so an old runbook or shell history cannot
 * silently invoke the retired writer. A replacement must be preview-first,
 * period-safe, canonical 0–10, and consume an explicit owner-approved rainfall
 * policy before any database write.
 */

const RETIRED_REASON = [
  "derive-azseker-drought-index.ts is retired and cannot write data.",
  "Provide the owner-approved EDEN rainfall policy first, then implement a period-safe 0–10 derivation workflow.",
].join(" ")

console.error(`[drought-index] BLOCKED: ${RETIRED_REASON}`)
process.exitCode = 2
