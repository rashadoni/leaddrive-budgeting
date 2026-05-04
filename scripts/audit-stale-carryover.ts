/**
 * Audit script: scans `docs/CARRYOVER.md` for OPEN rows whose `turns-open`
 * counter exceeds a threshold (default 8) — surfaces stale items that
 * have drifted past the architect-implied re-evaluation horizon.
 *
 * Filed at CARRYOVER:358 (Turn-38-sub8 architect Round-1 💡): "sub-group
 * rollup 🔄 sat OPEN for 12+ turns despite shipping in Turn 33.5".
 * Architect already gates CARRYOVER freshness per turn but doesn't
 * surface staleness explicitly; this fills that gap.
 *
 * Read-only: never mutates `docs/CARRYOVER.md`. Bumping or closing rows
 * is a developer judgment call, not mechanical.
 *
 * Usage:
 *   npx tsx scripts/audit-stale-carryover.ts                    # threshold 8
 *   npx tsx scripts/audit-stale-carryover.ts --threshold 30     # only critical
 *   npx tsx scripts/audit-stale-carryover.ts --owner developer  # filter owner
 *   npx tsx scripts/audit-stale-carryover.ts --owner user --threshold 14
 */

import * as fs from "fs";
import * as path from "path";

const DEFAULT_THRESHOLD = 8;
const CARRYOVER_PATH = path.resolve(__dirname, "..", "docs", "CARRYOVER.md");

interface OpenRow {
  status: string;
  opened: string;
  turnsOpen: number;
  owner: string;
  blocker: string;
  item: string;
}

const args = process.argv.slice(2);
const threshIdx = args.indexOf("--threshold");
const threshold =
  threshIdx !== -1 && args[threshIdx + 1]
    ? Number(args[threshIdx + 1])
    : DEFAULT_THRESHOLD;
const ownerIdx = args.indexOf("--owner");
const ownerFilter =
  ownerIdx !== -1 && args[ownerIdx + 1] ? args[ownerIdx + 1] : null;

if (Number.isNaN(threshold)) {
  console.error(`error: --threshold ${args[threshIdx + 1]} is not a number`);
  process.exit(1);
}
if (ownerFilter && !["developer", "user"].includes(ownerFilter)) {
  console.error(
    `error: --owner must be 'developer' or 'user' (got: ${ownerFilter})`,
  );
  process.exit(1);
}

if (!fs.existsSync(CARRYOVER_PATH)) {
  console.error(`error: CARRYOVER not found at ${CARRYOVER_PATH}`);
  process.exit(1);
}
const text = fs.readFileSync(CARRYOVER_PATH, "utf8");

// Anchor section bounds to start-of-line. Naive `indexOf("## CLOSED")`
// false-matches inline references inside a row (e.g. row 395 mentions
// the literal string "## CLOSED" in its blocker content as documentation),
// truncating the OPEN slice mid-row.
const OPEN_RE = /^## OPEN\s*$/m;
const CLOSED_RE = /^## CLOSED/m;
const openMatch = OPEN_RE.exec(text);
const closedMatch = CLOSED_RE.exec(text);
if (!openMatch || !closedMatch || closedMatch.index < openMatch.index) {
  console.error(
    "error: failed to find ## OPEN / ## CLOSED headings in docs/CARRYOVER.md",
  );
  process.exit(1);
}
const openSection = text.slice(openMatch.index, closedMatch.index);
const closedSection = text.slice(closedMatch.index);

// Phase 7.G Turn FF — duplicate-detection cross-section warn.
// Closes Turn-DD architect ⚠️ filed after 7 un-migrated duplicates were
// surfaced this autonomy block (Y/Z/AA/DD/EE×3). Parses CLOSED-section
// ✅ row item-texts so the OPEN-section sweep below can flag any OPEN
// item whose text is a substring of a CLOSED item — likely an
// un-migrated duplicate from a prior closure turn.
const CLOSED_ROW_RE = /^\|\s+✅\s+\|/;
const closedItems: { item: string; line: number }[] = [];
{
  // Compute CLOSED-section's starting line number in the source file so
  // warnings can cite a precise location. Count newlines up to the
  // CLOSED match index.
  const closedStartLine = text.slice(0, closedMatch.index).split("\n").length;
  for (const [offset, line] of closedSection.split("\n").entries()) {
    if (!CLOSED_ROW_RE.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    // CLOSED schema is `| ✅ | closed-date | resolution | item |` (4 cols)
    // OR legacy `| ✅ | closed-date | resolution-with-author | ... | item |`
    // (5+ cols). Item is always the last cell — slice(1, -1)[length-1].
    if (cells.length < 4) continue;
    const item = cells[cells.length - 1];
    if (item.length === 0) continue;
    closedItems.push({ item, line: closedStartLine + offset });
  }
}
const DUPLICATE_MIN_LEN = 20; // generic-substring false-positive guard

// Match lines whose first cell holds a 🔄 or ⚠️ status emoji. Skips the
// "Last processed:" prose paragraphs (they don't begin with `|`), the
// table header row (`| status | ...`), and the markdown separator
// (`|---|...`).
const ROW_RE = /^\|\s+(🔄|⚠️)\s+\|/;
const rows: OpenRow[] = [];
for (const line of openSection.split("\n")) {
  if (!ROW_RE.test(line)) continue;
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length < 6) {
    console.error(
      `warn: malformed row (got ${cells.length} cells), skipping: ${line.slice(0, 80)}…`,
    );
    continue;
  }
  // Defensive: blocker col may legitimately contain `|` (none today, but
  // possible in future rows). First 4 cols + last col are fixed; merge
  // the middle back into blocker.
  const status = cells[0];
  const opened = cells[1];
  const turnsOpenRaw = cells[2];
  const owner = cells[3];
  const item = cells[cells.length - 1];
  const blocker = cells.slice(4, -1).join(" | ");
  const turnsOpen = Number.parseInt(turnsOpenRaw, 10);
  if (Number.isNaN(turnsOpen)) {
    console.error(
      `warn: non-numeric turns-open '${turnsOpenRaw}', skipping: ${line.slice(0, 80)}…`,
    );
    continue;
  }
  rows.push({ status, opened, turnsOpen, owner, blocker, item });
}

// Duplicate detection: scan ALL OPEN rows (regardless of threshold/owner
// filters — a duplicate is interesting even if its bumped count is low).
// For each OPEN row, check if its item-text is a substring of any
// CLOSED ✅ row's item-text. The min-length guard avoids generic-token
// false positives ("fix" appearing in many unrelated CLOSED items).
//
// Turn-HH NOTE: tried adding per-sub-item atom matching with word-
// overlap heuristic to catch L388-style cases (OPEN spec spans 2+
// CLOSED rows). Word-overlap with 50% threshold flagged 4 false
// positives on production CARRYOVER (e.g. "Sub-segment split for BEV /
// RETAIL indicators" matched non-related closures via common-word noise
// like "split"/"indicators"/"phase"). Reverted to v1 substring-only.
// V3 closure deferred: marker-extraction matcher anchored on explicit
// `Bug #N` / `Turn N` / `Phase X` regex patterns rather than free-form
// word overlap — see CARRYOVER 🔄 row updated this turn.
interface DuplicateMatch {
  open: OpenRow;
  closedItem: string;
  closedLine: number;
}
const duplicates: DuplicateMatch[] = [];
for (const r of rows) {
  if (r.item.length < DUPLICATE_MIN_LEN) continue;
  // Lowercase both sides — catches case-variation drift (e.g. "G/A/R chip
  // letters" duplicating CLOSED "G/A/R Chip Letters") without false-
  // positive risk per architect Turn-FF Round-1 💡 #1.
  const rLower = r.item.toLowerCase();
  for (const c of closedItems) {
    if (c.item.toLowerCase().includes(rLower)) {
      duplicates.push({ open: r, closedItem: c.item, closedLine: c.line });
      break;
    }
  }
}

const filtered = rows.filter(
  (r) => r.turnsOpen >= threshold && (!ownerFilter || r.owner === ownerFilter),
);

const byTurnsDesc = (a: OpenRow, b: OpenRow) => b.turnsOpen - a.turnsOpen;
const critical = filtered.filter((r) => r.turnsOpen >= 30).sort(byTurnsDesc);
const stale = filtered
  .filter((r) => r.turnsOpen >= 15 && r.turnsOpen < 30)
  .sort(byTurnsDesc);
const approaching = filtered
  .filter((r) => r.turnsOpen < 15)
  .sort(byTurnsDesc);

function fmtRow(r: OpenRow): string {
  const itemTrunc = r.item.length > 80 ? r.item.slice(0, 77) + "..." : r.item;
  const turns = String(r.turnsOpen).padStart(2, " ");
  const ownerPad = r.owner.padEnd(9, " ");
  return `  [${turns}] ${r.status} owner=${ownerPad} opened=${r.opened} — ${itemTrunc}`;
}

const filterDesc = ownerFilter
  ? `threshold=${threshold}, owner=${ownerFilter}`
  : `threshold=${threshold}`;
console.log(`Stale CARRYOVER OPEN rows (${filterDesc}):\n`);

if (critical.length > 0) {
  console.log(`CRITICAL (≥30 turns):`);
  for (const r of critical) console.log(fmtRow(r));
  console.log();
}
if (stale.length > 0) {
  console.log(`STALE (15-29 turns):`);
  for (const r of stale) console.log(fmtRow(r));
  console.log();
}
if (approaching.length > 0) {
  console.log(`APPROACHING (8-14 turns):`);
  for (const r of approaching) console.log(fmtRow(r));
  console.log();
}
if (filtered.length === 0) {
  console.log("(no rows match)\n");
}

if (duplicates.length > 0) {
  console.log(
    `DUPLICATE DETECTED — OPEN rows with item-text matching a CLOSED ✅ row (${duplicates.length} found):`,
  );
  for (const d of duplicates) {
    const itemTrunc =
      d.open.item.length > 70 ? d.open.item.slice(0, 67) + "..." : d.open.item;
    console.log(`  - "${itemTrunc}"`);
    console.log(
      `    OPEN turns-open=${d.open.turnsOpen} owner=${d.open.owner} opened=${d.open.opened}`,
    );
    console.log(
      `    CLOSED ✅ row at line ${d.closedLine} contains the same item-text — likely un-migrated duplicate from a prior closure turn`,
    );
  }
  console.log();
}

console.log(
  `Total stale: ${filtered.length} / ${rows.length} (critical=${critical.length}, stale=${stale.length}, approaching=${approaching.length})${duplicates.length > 0 ? ` · duplicates=${duplicates.length}` : ""}`,
);
