/**
 * Phase 8 F3 (2026-05-28) — CARRYOVER stale-row scanner.
 *
 * Reads `docs/CARRYOVER.md` and surfaces 🔄 OPEN rows that are older
 * than a configurable cutoff (default 30 days). Pure module: takes the
 * markdown body as a string + a `now` clock, returns a structured
 * report. The CLI script (`scripts/carryover-sla-scan.mjs`) handles
 * the filesystem read + stdout / exit-code wiring.
 *
 * **CARRYOVER row format** (markdown table):
 *
 *   | 🔄 | YYYY-MM-DD | turns-open | owner | description |
 *
 * The OPEN section is bounded by an `## OPEN` heading and ends at the
 * next `## CLOSED` heading (or EOF). Closed rows (`✅`, `❌`) are
 * ignored even when listed under OPEN (legacy archives).
 *
 * Per `feedback_carryover_enforcement.md` (deprecated Turn LXXXVII but
 * relevant for SLA semantics): `owner=user` rows that have aged past 14
 * turns should be re-pinged. This module generalises that to a date-
 * based SLA so the cron has stable inputs even when turns-open is
 * out-of-date or zero (manual-mode default).
 */

export type CarryoverOwner = "user" | "engineering" | "ops" | string;

export interface CarryoverRow {
  /** Marker emoji from col 1 (🔄 OPEN / ✅ CLOSED / ❌ CANCELLED / 📝 NOTE). */
  marker: string;
  /** Date in YYYY-MM-DD form. Null when the row's date field is malformed. */
  date: string | null;
  /** `turns-open` counter from col 3. Often 0 in manual mode. */
  turnsOpen: number;
  /** owner string from col 4 (lowercased; falls back to «unknown»). */
  owner: CarryoverOwner;
  /** Verbatim row text from col 5 (markdown-formatted). */
  description: string;
  /** Computed age in days vs. `now`. Null when date is malformed. */
  ageDays: number | null;
}

export interface CarryoverScanResult {
  /** All OPEN rows the parser found (marker == 🔄). */
  openRows: CarryoverRow[];
  /** Subset of `openRows` that exceed the staleness cutoff. */
  staleRows: CarryoverRow[];
  /** Subset of `staleRows` where owner == 'user' (highest-leverage
   *  escalation tier — these unblock real client deliveries). */
  userBlockedStale: CarryoverRow[];
  /** Day count used to compute staleness (echoed for the CLI). */
  cutoffDays: number;
}

/**
 * Markdown table parser, narrowly scoped to CARRYOVER row shape. We do
 * NOT depend on a generic markdown parser because:
 *  - CARRYOVER rows often have pipes inside `description` (code spans,
 *    `cron` examples, etc.) — a generic parser would mis-split on them.
 *    The narrow parser splits on the FIRST 4 pipes and lumps the rest
 *    into the description, which matches the actual format-discipline.
 *  - Zero deps, zero install — matters for a cron path that should boot
 *    in <100ms.
 */
function parseRow(line: string): CarryoverRow | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  // Skip the table header / separator rows.
  if (/^\|\s*[:\-]+\s*\|/.test(trimmed)) return null;
  // Split with a cap of 5 so description can contain pipes safely.
  const parts: string[] = [];
  let rest = trimmed.replace(/^\|/, "").replace(/\|\s*$/, "");
  for (let i = 0; i < 4; i++) {
    const idx = rest.indexOf("|");
    if (idx === -1) return null;
    parts.push(rest.slice(0, idx).trim());
    rest = rest.slice(idx + 1);
  }
  parts.push(rest.trim());
  const [marker, dateRaw, turnsRaw, ownerRaw, description] = parts;
  if (!marker || !description) return null;
  // Date validation: lenient — accept YYYY-MM-DD; anything else → null
  // (still surfaces the row but ageDays will be null in the output).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  const turnsOpen = Number.parseInt(turnsRaw, 10);
  return {
    marker,
    date,
    turnsOpen: Number.isFinite(turnsOpen) ? turnsOpen : 0,
    owner: ownerRaw.toLowerCase() || "unknown",
    description,
    ageDays: null, // computed below by scan()
  };
}

/**
 * Extract the OPEN section from the file body. We bound it explicitly
 * because `## CLOSED` rows ALSO use the `| 🔄 |` historical marker for
 * legacy entries — scanning the whole file would double-count.
 */
export function extractOpenSection(body: string): string {
  const openIdx = body.indexOf("## OPEN");
  if (openIdx === -1) return "";
  const afterOpen = body.slice(openIdx);
  // Look for next H2 / H1 after OPEN to bound the section. CLOSED is
  // the canonical follow-on but ANY next section ends it.
  const nextSectionMatch = /\n##? [A-Z]/.exec(afterOpen.slice("## OPEN".length));
  if (!nextSectionMatch) return afterOpen;
  return afterOpen.slice(
    0,
    "## OPEN".length + nextSectionMatch.index,
  );
}

export interface ScanOptions {
  /** Override for testability. Defaults to system clock at call time. */
  now?: Date;
  /** Days a 🔄 row may sit before counting as stale. Default 30. */
  cutoffDays?: number;
}

/**
 * Scan a CARRYOVER.md body and return open + stale subsets.
 *
 * @param body raw markdown content
 * @param opts cutoffDays + injectable clock for tests
 */
export function scanCarryover(
  body: string,
  opts: ScanOptions = {},
): CarryoverScanResult {
  const now = opts.now ?? new Date();
  const cutoffDays = opts.cutoffDays ?? 30;
  const openSection = extractOpenSection(body);
  const lines = openSection.split("\n");
  const openRows: CarryoverRow[] = [];
  for (const line of lines) {
    const row = parseRow(line);
    if (!row) continue;
    // Only 🔄 OPEN markers count. The OPEN section legitimately holds
    // 📝 NOTE rows + the occasional just-closed ✅ awaiting move to the
    // CLOSED section; both are excluded from the staleness scan.
    if (row.marker !== "🔄") continue;
    if (row.date) {
      const ms = now.getTime() - Date.parse(row.date + "T00:00:00Z");
      row.ageDays = Math.floor(ms / (24 * 60 * 60 * 1000));
    }
    openRows.push(row);
  }
  const staleRows = openRows.filter(
    (r) => r.ageDays !== null && r.ageDays >= cutoffDays,
  );
  const userBlockedStale = staleRows.filter((r) => r.owner === "user");
  return { openRows, staleRows, userBlockedStale, cutoffDays };
}

/**
 * Render a CLI-friendly summary (single string with newlines). The
 * cron job writes this to stdout + the project log; the developer reads
 * it in the morning and decides whether to ping owners.
 *
 * The format is intentionally line-oriented (no boxes, no tables) so
 * `grep`-friendly piping works.
 */
export function formatReport(result: CarryoverScanResult): string {
  const lines: string[] = [];
  lines.push(
    `CARRYOVER SLA scan — ${result.openRows.length} OPEN rows, cutoff ${result.cutoffDays}d.`,
  );
  if (result.staleRows.length === 0) {
    lines.push("✓ No rows past the staleness cutoff. Nothing to escalate.");
    return lines.join("\n");
  }
  lines.push(
    `⚠ ${result.staleRows.length} row(s) past cutoff (${result.userBlockedStale.length} owner=user — re-ping).`,
  );
  lines.push("");
  for (const row of result.staleRows) {
    const ageLabel = row.ageDays !== null ? `${row.ageDays}d` : "?d";
    const ownerTag = row.owner === "user" ? "🚨 user" : `   ${row.owner}`;
    // Truncate the description to keep terminal output legible. Full
    // text is in CARRYOVER.md if the developer needs to drill in.
    const desc =
      row.description.length > 140
        ? row.description.slice(0, 140) + "…"
        : row.description;
    lines.push(`  ${ageLabel.padStart(5)}  ${ownerTag}  ${desc}`);
  }
  return lines.join("\n");
}
