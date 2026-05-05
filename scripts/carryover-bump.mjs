#!/usr/bin/env node
/**
 * Phase 7.G Turn XXII — reusable counter-bump for `docs/CARRYOVER.md`.
 *
 * Replaces the per-turn `bump_carryover_turnN.py` write-then-run pattern
 * with `npm run carryover:bump -- --turn XXII`. Plain ESM — no TS runtime
 * dependency (project's `tsx` is not always on PATH).
 *
 * The `--turn` argument is informational only (logged to stdout for
 * commit narrative); the bump pass increments turns-open on every
 * retained `🔄`/`⚠️` row in OPEN by exactly +1.
 *
 * The architect-gate.sh hook recognizes Bash invocations whose command
 * matches `bump_carryover_` OR `carryover:bump` (Turn XXII regex
 * extension) as legitimate CARRYOVER-touching activity for check #5.
 *
 * Per `feedback_session_speedup.md` item #7 — eliminates the per-turn
 * script-write step (~30-60s/turn).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, "..", "docs", "CARRYOVER.md");

const args = process.argv.slice(2);
let turn = "?";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--turn" && args[i + 1]) {
    turn = args[i + 1];
    i++;
  }
}

const text = readFileSync(PATH, "utf8");

const openMatch = text.match(/^## OPEN/m);
const closedMatch = text.match(/^## CLOSED/m);
if (!openMatch || !closedMatch || openMatch.index === undefined || closedMatch.index === undefined) {
  console.error("[carryover-bump] FAIL: cannot locate ## OPEN / ## CLOSED anchors");
  process.exit(1);
}
const openStart = openMatch.index + openMatch[0].length;
const openEnd = closedMatch.index;

const openBlock = text.slice(openStart, openEnd);

let bumped = 0;
const ROW_RE = /^(\|\s+(?:🔄|⚠️)\s+\|\s+\d{4}-\d{2}-\d{2}\s+\|\s+)(\d+)(\s+\|)/gm;
const newOpen = openBlock.replace(ROW_RE, (_match, p1, p2, p3) => {
  bumped++;
  return `${p1}${parseInt(p2, 10) + 1}${p3}`;
});

writeFileSync(PATH, text.slice(0, openStart) + newOpen + text.slice(openEnd));

console.log(`[carryover-bump] Turn ${turn} — bumped ${bumped} retained OPEN rows (+1 each)`);
