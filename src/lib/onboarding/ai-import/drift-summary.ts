/**
 * 2026-08-03 — "reconciliation is red" told a finance operator to go and guess.
 *
 * The owner's words: the problem has to be stated concretely enough that the
 * finance person is not guessing. The counts added earlier the same day
 * ("0 sheets re-read, 0 skipped, no group formed") are an improvement only for
 * whoever wrote the reconciliation engine. A controller does not think in
 * sheets verified or groups formed. They think in: WHICH company, WHICH
 * statement, WHICH account, WHICH month, and HOW MANY MANAT apart.
 *
 * Every one of those was already computed. `SheetReconciliationResult` carries
 * `sheetName`, `entityCode` and up to five `topDrift` lines with `expected`,
 * `actual` and `driftPct` — and the safety receipt reduced the whole thing to
 * `perSheet.length` before it left the server. The number a person needs was
 * measured, then discarded one layer below the screen.
 *
 * This turns those lines into the sentence a controller can act on, and does
 * it in a pure module so the wording is testable without a browser.
 */

/** One drift line as the reconciler records it. `key` is `entity::account::period`. */
export interface DriftLineInput {
  key: string
  expected: number
  actual: number
  driftPct: number
}

/** A sheet's reconciliation outcome, reduced to what a message needs. */
export interface DriftSheetInput {
  sheetName: string
  entityCode: string | null
  topDrift: ReadonlyArray<DriftLineInput>
}

export interface NamedDrift {
  /** Company code, or null when the sheet carried none. */
  entityCode: string | null
  sheetName: string
  /** Chart-of-accounts code, parsed out of the composite key. */
  account: string
  /** `YYYY-MM` or `YYYY`, parsed out of the composite key. */
  period: string
  /** What the workbook says. */
  expected: number
  /** What the database holds after the write. */
  actual: number
  /** `actual − expected`. Positive = the database holds more. */
  drift: number
  driftPct: number
}

/**
 * Split `entity::account::period` without losing an account code that itself
 * contains the separator's characters.
 *
 * Deliberately positional — first segment and LAST segment — so a key whose
 * middle happens to contain "::" keeps its account intact rather than being
 * silently truncated to the part before it. Returns nulls rather than guessing
 * when the key has fewer than three segments: a made-up account code on a
 * reconciliation message would send someone to the wrong line of the workbook.
 */
function parseKey(key: string): { account: string; period: string } | null {
  const parts = key.split("::")
  if (parts.length < 3) return null
  return {
    account: parts.slice(1, -1).join("::"),
    period: parts[parts.length - 1],
  }
}

/**
 * The worst drift lines across every sheet, biggest gap first.
 *
 * Ranked by ABSOLUTE manat, not by percentage. A 90% drift on a 12 ₼ line is
 * arithmetically dramatic and operationally irrelevant; 12,014 ₼ missing from
 * a nine-figure statement is the one a controller has to chase. The percentage
 * still travels with each line, because it is what tells them whether the gap
 * is a rounding artefact or a lost block.
 */
export function worstDrifts(
  sheets: ReadonlyArray<DriftSheetInput>,
  limit = 3,
): NamedDrift[] {
  const out: NamedDrift[] = []
  for (const sheet of sheets) {
    for (const line of sheet.topDrift ?? []) {
      const parsed = parseKey(line.key)
      if (!parsed) continue
      if (!Number.isFinite(line.expected) || !Number.isFinite(line.actual)) continue
      out.push({
        entityCode: sheet.entityCode,
        sheetName: sheet.sheetName,
        account: parsed.account,
        period: parsed.period,
        expected: line.expected,
        actual: line.actual,
        drift: line.actual - line.expected,
        driftPct: line.driftPct,
      })
    }
  }
  return out
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
    .slice(0, Math.max(0, limit))
}

/** Format a manat amount the way the rest of the product does. */
function azn(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * One drift line as a controller reads it.
 *
 * Both sides are shown, never just the gap: "12,014.63 short" does not say
 * whether the workbook or the database is the odd one out, and that is the
 * first thing the person checking has to decide.
 */
export function describeDrift(d: NamedDrift): string {
  const where = [d.entityCode, d.sheetName, d.account, d.period]
    .filter((p): p is string => !!p)
    .join(" · ")
  const sign = d.drift > 0 ? "+" : ""
  return `${where} — file ${azn(d.expected)} ₼, database ${azn(d.actual)} ₼ (${sign}${azn(d.drift)} ₼, ${(d.driftPct * 100).toFixed(1)}%)`
}
