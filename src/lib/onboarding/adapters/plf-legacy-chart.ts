/**
 * Two charts of accounts, one `chart_of_accounts` table.
 *
 * ---------------------------------------------------------------------------
 * The defect this closes (2026-08-01) — Defect 5
 * ---------------------------------------------------------------------------
 *
 * `ChartOfAccount` is `@@unique([organizationId, code])`. One name per code,
 * no year. `actual-budget-v1.xlsx` ships TWO charts under one code space:
 * `PLF Actual 2025` was renumbered into `PLF Budget 2026` / `PLF Actual 2026`,
 * and 155 codes changed meaning in the process. Production already holds the
 * 2026 chart, and `resolveOrCreateAccountId` deliberately never renames an
 * existing row ("an admin-set classification beats whatever a raw xlsx header
 * happened to say"). So importing 2025 as-is is not a merge — it is a silent
 * relabelling of 2025's money by 2026's names. Measured by parsing the real
 * file with the real adapter: 37 accounts, 48,735,978 AZN of activity.
 *
 *   PLF.01.01.06   16,428,573  "Revenue from Sale of Processed Corn Products"
 *                              would post under "Revenue from Sale of Almond"
 *   PLF.02.01.06  −13,231,466  "Processed Corn Products" → "Almond Costs"
 *   PLF.07.02.04    7,354,842  "Subsidies - Farming"     → "Subsidies - Product"
 *   PLF.05.15.01   −1,541,516  "Depreciation - Buildings" → "Bank Commission Fees"
 *
 * The same translation also moves 2025's D&A (`PLF.05.15.*`, 8,578,368 AZN,
 * filed inside opex) to the 2026 chart's `PLF.09.03.*` below the EBITDA line.
 * That is not a side effect to tolerate — it is the sheet's own position:
 * derived EBITDA for 2025 was −5,344,501 against the client's own `PLF.08` of
 * 3,233,868, and after the mapping it equals it to the qəpik.
 *
 * Nothing in the pipeline could notice: both charts are internally consistent,
 * every code resolves, every sheet cross-foots, and the reconciliation pass
 * compares what was PARSED against what was WRITTEN — never against what the
 * name MEANS.
 *
 * ---------------------------------------------------------------------------
 * The decision, and the rule that implements it
 * ---------------------------------------------------------------------------
 *
 * The owner chose to map 2025 into 2026 terms using the CLIENT'S OWN WORDING:
 * the row label is the thing the client actually maintains, the code is the
 * thing they renumbered. So the rule is
 *
 *   match on the normalised LABEL among codes the leaf rule accepts on BOTH
 *   sides, and where two candidates exist keep the 2025 code's own SECTION
 *
 * and nothing else. The section tie-break is not a heuristic tacked on to
 * reduce ambiguity — it is the client's functional split (a `PLF.04` "Sales &
 * Marketing" twin and a `PLF.05` "Head Office" twin carry the same label by
 * design, e.g. "Staff Salaries, State Social Fund Fees"), and it must survive
 * the renumbering or the split collapses. On this workbook it leaves ZERO
 * ambiguous cases.
 *
 * `deriveLegacyChartMap` below IS that rule, and `plf-2025-chart-map.generated.ts`
 * is what it printed. `scripts/derive-plf-2025-chart-map.ts` re-runs it against
 * the workbook; `plf-2025-chart-rederive.test.ts` asserts the re-run reproduces
 * the checked-in table byte for byte. The table is data, not a transcript: no
 * one hand-copied 61 lines, and no one has to trust that they copied correctly.
 *
 * ---------------------------------------------------------------------------
 * The unit is (code, LABEL), not code
 * ---------------------------------------------------------------------------
 *
 * 33 codes on `PLF Actual 2025` carry more than one label, and they are not
 * all cosmetic. `PLF.07.02.04` carries THREE accounts the 2026 chart keeps
 * apart:
 *
 *   PLF.07.02.04  "Subsidies - Farming"      1,761,728 + 616,075   → PLF.07.02.02
 *   PLF.07.02.04  "Subsidies - Investment"     804,415 + 131,002   → PLF.07.02.03
 *   PLF.07.02.04  "Subsidies - Product"      2,918,999 + 1,122,623 → PLF.07.02.04
 *
 * A code-keyed map takes the first label it sees and mislabels the other
 * 4,977,039. So an entry is a (code, label) pair, and the label is matched
 * exactly (after normalisation) at lookup time. That has a second effect worth
 * stating plainly: a 2025 sheet whose codes are PLF-shaped but whose WORDING
 * this table does not recognise gets no translation at all, and a warning
 * instead. This map describes one client's chart; it must not fire on another's.
 *
 * ---------------------------------------------------------------------------
 * Three outcomes, and why the third one sometimes needs a new code
 * ---------------------------------------------------------------------------
 *
 *   identical    the 2026 chart has this code with this label. Import as-is.
 *   renumbered   the label lives at a DIFFERENT 2026 code. Post there — that
 *                is the account the client means, already named correctly.
 *   own_account  no 2026 leaf carries this label. Keep the 2025 account with
 *                the 2025 name.
 *
 * "Keep the 2025 account" cannot always mean "keep the 2025 code", because a
 * code can only name one thing. An own-account row is MINTED under a
 * year-qualified code (`legacyQualifiedCode`) exactly when some other meaning
 * already claims its code — either the current chart's own label there, or
 * another legacy row landing there. Both happen:
 *
 *   PLF.01.01.06  the 2026 chart calls it "Revenue from Sale of Almond"
 *   PLF.04.01.99  2025's OWN `PLF.04.02.99` renumbers onto it, because
 *                 renumbering is simultaneous rather than chained
 *
 * The reverse hazard is a NEW account that duplicates an existing one under a
 * different code. It is checked explicitly rather than hoped away: every
 * own-account entry records `duplicateOfCurrentCodes`, the 2026 codes carrying
 * the same label ANYWHERE in the chart — including non-leaves, which is what
 * the matching rule cannot see. On this workbook one such entry carries money
 * (`PLF.05.18.R` "Commission Fees - G&A", −9,993, whose 2026 twin `PLF.05.15`
 * is a parent row and therefore never a match candidate). It is surfaced as a
 * parse warning at import time, not silently minted.
 */

/** One row of a chart of accounts, as read off a PLF sheet. */
export interface LegacyChartRow {
  code: string
  label: string
  /**
   * Decided by `buildLeafPredicate` over the WHOLE sheet — leafness is not a
   * property of a code in isolation. Passed in so this module stays free of
   * xlsx and of the leaf rule's own history.
   */
  isLeaf: boolean
}

export type LegacyMappingKind = "identical" | "renumbered" | "own_account"

/**
 * A row the LABEL rule cannot get right, corrected by hand with its reason.
 *
 * The rule matches on the client's own wording, which is right nearly always
 * and wrong when the client RENAMES one half of a pair. Both cases below are
 * that, found on 2026-08-19 by reconciling the workbook against the database.
 *
 * Keyed on (code, label) like everything else here, so a correction cannot
 * catch a row it was not meant for. An override matching nothing is an error,
 * not a no-op: a rule nobody notices has stopped applying is how the first
 * mistake survived.
 */
export interface LegacyChartOverride {
  code: string
  label: string
  storedCode: string
  reason: string
}

export const LEGACY_CHART_OVERRIDES: readonly LegacyChartOverride[] = [
  {
    code: "PLF.02.01.99",
    label: "Other Costs",
    storedCode: "PLF.02.01.99",
    reason:
      "Farming's other-products cost. The 2026 chart renamed it to \"Other Products' Costs\", so the label rule sent it to the only remaining \"Other Costs\" — PLF.02.03.99, which is the OTHER-SOURCES cost account. Its revenue PLF.01.01.99 stayed put, which is why 1,921,539 of other products showed no cost at all. The 2025 elimination block pairs it with PLF.01.01.99 by adjacency, exactly as it pairs corn with corn costs.",
  },
  {
    code: "PLF.01.01.99",
    label: "Revenue from Other Sources",
    storedCode: "PLF.01.01.99",
    reason:
      "An elimination row the workbook mislabelled. It sits at PLF.01.01.99 and is paired with PLF.02.01.99 in the elimination block, like every other pair there; the three company blocks call the same code \"Revenue from Sale of Other Products\". Read by its label it landed in other sources, taking 705,200 of elimination away from the branch it belongs to and turning that branch's revenue negative — which is what printed +277.3% on a line that lost money.",
  },
]

export interface LegacyChartEntry {
  /** Code as written on the legacy sheet. */
  code: string
  /** Label as written on the legacy sheet, verbatim. */
  label: string
  kind: LegacyMappingKind
  /** The account this row posts to. Equals `code` unless it had to move. */
  storedCode: string
  /** `renumbered` only — whether a tie had to be broken, and how. */
  via?: "unique" | "section-kept" | "override"
  /** `override` only — why a person overruled the rule for this row. */
  overrideReason?: string
  /**
   * `own_account` only — what already claimed `code`, forcing the mint. Kept
   * as prose because it is the answer to "why is there a `.FY2025` account in
   * my chart", asked six months from now by someone without the workbook.
   */
  mintedBecause?: string
  /**
   * `own_account` only — current-chart codes carrying the SAME label. A
   * populated list means minting this account duplicates an account that
   * already exists under another code. Never omitted silently: the importer
   * warns on it.
   */
  duplicateOfCurrentCodes?: string[]
}

export interface LegacyChartAmbiguity {
  code: string
  label: string
  candidates: string[]
}

export interface LegacyChartMap {
  /**
   * Hand corrections that matched no row. Empty on the chart they were written
   * for; non-empty means the workbook moved under them, or another client's
   * chart is being derived.
   */
  unmatchedOverrides?: LegacyChartOverride[]
  entries: LegacyChartEntry[]
  /**
   * Legacy leaves whose label matched several current leaves in several
   * sections. The rule REFUSES to guess; a non-empty list is a mapping the
   * client has to settle, not something to average over.
   */
  ambiguous: LegacyChartAmbiguity[]
}

/**
 * Label normalisation: case-folded, every run of non-alphanumerics collapsed
 * to one space, trimmed.
 *
 * Deliberately blunt. The two charts differ in punctuation and spacing far
 * more than in wording, and anything cleverer — stemming, token overlap, edit
 * distance — starts pairing "Staff Salaries, Net" with "Staff Salaries,
 * Gross", which are a DIFFERENT MEASURE and are exactly the rows the owner
 * ruled must keep their own account.
 */
export function normaliseChartLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** Lookup key for a (code, label) pair. */
export function legacyEntryKey(code: string, label: string): string {
  return `${code.trim()} ${normaliseChartLabel(label)}`
}

/**
 * `PLF.04.02.99` → `PLF.04`. The statement section, which is the unit of the
 * client's functional split and therefore the tie-break.
 */
export function chartSectionOf(code: string): string | null {
  const m = code.trim().toUpperCase().match(/^((?:PLF|CF)\.\d{2})/)
  return m ? m[1] : null
}

/**
 * Suffix marking an account that belongs to a superseded chart of accounts.
 *
 * Shape matters: it stays dot-delimited and keeps the code's section prefix,
 * because every downstream classifier reads the code by PREFIX — `plfNature`
 * (`/^PLF\.(\d{2})/`), `plfOtherOperatingSide` (`startsWith("PLF.07.01")`),
 * `isWorkbookCode` (`/^(PLF|BS|CF)\.\d/`). A qualified code therefore
 * classifies into exactly the same P&L section as the code it qualifies, which
 * is the point: the account is separate, its meaning is not.
 *
 * `ordinal` disambiguates the case where two legacy meanings under one code
 * both have to be minted.
 */
export function legacyQualifiedCode(
  code: string,
  chartYear: number,
  ordinal = 1,
): string {
  const base = `${code}.FY${chartYear}`
  return ordinal <= 1 ? base : `${base}.${ordinal}`
}

/**
 * Derive the legacy → current mapping. This IS the rule; everything shipped as
 * data is its output.
 *
 * Only legacy LEAVES are mapped — a subtotal row is never imported, so it has
 * no account to collide with. Only current LEAVES are match candidates, for
 * the same reason plus a sharper one: posting a legacy leaf onto a current
 * PARENT would double-count it against that parent's own children.
 *
 * Order matters and is the SHEET's order: when two legacy meanings contend for
 * one code, the first one down the sheet keeps it. That makes the table a
 * function of the workbook alone.
 */
export function deriveLegacyChartMap(
  legacy: readonly LegacyChartRow[],
  current: readonly LegacyChartRow[],
  chartYear: number,
): LegacyChartMap {
  /** code → the CURRENT chart's labels for it, verbatim, in first-seen order. */
  const currentLabelsByCode = new Map<string, string[]>()
  /** normalised label → current LEAF codes (the match candidates). */
  const currentLeavesByLabel = new Map<string, string[]>()
  /** normalised label → ALL current codes (the duplicate check). */
  const currentAnyByLabel = new Map<string, string[]>()

  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k)
    if (!list) m.set(k, [v])
    else if (!list.includes(v)) list.push(v)
  }

  for (const row of current) {
    if (!row.label) continue
    const key = normaliseChartLabel(row.label)
    if (!key) continue
    push(currentLabelsByCode, row.code, row.label)
    push(currentAnyByLabel, key, row.code)
    if (row.isLeaf) push(currentLeavesByLabel, key, row.code)
  }

  const entries: LegacyChartEntry[] = []
  const ambiguous: LegacyChartAmbiguity[] = []
  const seen = new Set<string>()

  interface Pending {
    row: LegacyChartRow
    key: string
    duplicates: string[]
  }
  const pending: Pending[] = []

  // ── Pass 1: label match. Identical and renumbered are settled here; an
  // own-account row is held back because whether it keeps its code depends on
  // what else lands there.
  for (const row of legacy) {
    if (!row.isLeaf || !row.label) continue
    const entryKey = legacyEntryKey(row.code, row.label)
    if (seen.has(entryKey)) continue
    seen.add(entryKey)

    const key = normaliseChartLabel(row.label)
    const hits = currentLeavesByLabel.get(key) ?? []

    if (hits.includes(row.code)) {
      entries.push({
        code: row.code,
        label: row.label,
        kind: "identical",
        storedCode: row.code,
      })
      continue
    }
    if (hits.length === 1) {
      entries.push({
        code: row.code,
        label: row.label,
        kind: "renumbered",
        storedCode: hits[0],
        via: "unique",
      })
      continue
    }
    if (hits.length > 1) {
      // Keep the 2025 code's own section: the client's Sales & Marketing /
      // Head Office split is the reason the label appears twice at all.
      const section = chartSectionOf(row.code)
      const kept = hits.filter((h) => chartSectionOf(h) === section)
      if (kept.length === 1) {
        entries.push({
          code: row.code,
          label: row.label,
          kind: "renumbered",
          storedCode: kept[0],
          via: "section-kept",
        })
      } else {
        ambiguous.push({ code: row.code, label: row.label, candidates: [...hits] })
      }
      continue
    }

    pending.push({
      row,
      key,
      duplicates: (currentAnyByLabel.get(key) ?? []).filter((c) => c !== row.code),
    })
  }

  // ── Pass 2: place the own-account rows.
  //
  // A code is CLAIMED by a meaning when the current chart names it, or when a
  // settled entry above posts to it. An own-account row keeps its code only if
  // its own meaning is the one claiming it; otherwise it is minted, because
  // one code cannot carry two names.
  const claimed = new Map<string, { key: string; label: string }>()
  for (const [code, labels] of currentLabelsByCode) {
    // A current code with several labels is already ambiguous in the current
    // chart; the first is enough to mark the code as spoken for.
    claimed.set(code, { key: normaliseChartLabel(labels[0]), label: labels[0] })
  }
  for (const e of entries) {
    if (!claimed.has(e.storedCode)) {
      claimed.set(e.storedCode, {
        key: normaliseChartLabel(e.label),
        label: e.label,
      })
    }
  }

  for (const p of pending) {
    const holder = claimed.get(p.row.code)
    const entry: LegacyChartEntry = {
      code: p.row.code,
      label: p.row.label,
      kind: "own_account",
      storedCode: p.row.code,
    }
    if (holder !== undefined && holder.key !== p.key) {
      let ordinal = 1
      let minted = legacyQualifiedCode(p.row.code, chartYear, ordinal)
      while (claimed.has(minted)) {
        ordinal += 1
        minted = legacyQualifiedCode(p.row.code, chartYear, ordinal)
      }
      entry.storedCode = minted
      entry.mintedBecause = currentLabelsByCode.has(p.row.code)
        ? `the current chart names ${p.row.code} "${holder.label}"`
        : `another ${chartYear} row already posts to ${p.row.code} as "${holder.label}"`
    }
    if (p.duplicates.length > 0) entry.duplicateOfCurrentCodes = p.duplicates
    claimed.set(entry.storedCode, { key: p.key, label: p.row.label })
    entries.push(entry)
  }

  // Hand corrections last, so they overrule whatever the rule concluded.
  const unmatchedOverrides: LegacyChartOverride[] = []
  for (const o of LEGACY_CHART_OVERRIDES) {
    const key = legacyEntryKey(o.code, o.label)
    const target = entries.find((e) => legacyEntryKey(e.code, e.label) === key)
    if (!target) {
      // Reported, not thrown. This module describes ONE client's chart and
      // must not fire on another's — a chart without these rows is a different
      // chart, not a fault. The derive script, which runs against the real
      // workbook, is where an unmatched correction has to fail: a rule that
      // silently stopped applying is how the mapping it fixes came back.
      unmatchedOverrides.push(o)
      continue
    }
    target.storedCode = o.storedCode
    target.via = "override"
    target.overrideReason = o.reason
  }

  return { entries, ambiguous, unmatchedOverrides }
}

/** Where a legacy row's money ends up, and under what name. */
export interface LegacyAccountTarget {
  code: string
  name: string
  kind: LegacyMappingKind
  /** True when `code` differs from the code written on the sheet. */
  rewritten: boolean
  /** Populated for an own-account row that duplicates a current account. */
  duplicateOfCurrentCodes?: string[]
}

/**
 * Resolve one legacy row to the account it must be stored under.
 *
 * `null` means "this table has no opinion" — the caller keeps the code the
 * sheet wrote AND must say so out loud. Two ways to get there, and both are
 * deliberate:
 *
 *   - the code is not in the table, and
 *   - the code IS in the table but never with THIS label.
 *
 * The second is what keeps `PLF.07.02.04 "Subsidies - Investment"` from
 * inheriting `PLF.07.02.04 "Subsidies - Farming"`'s mapping, and what keeps
 * this AZSEKER-specific table from firing on another client's 2025 workbook
 * that happens to use `PLF.*` codes.
 */
export function resolveLegacyAccount(
  entries: ReadonlyMap<string, LegacyChartEntry>,
  code: string,
  label: string,
): LegacyAccountTarget | null {
  const entry = entries.get(legacyEntryKey(code, label))
  if (!entry) return null
  return {
    code: entry.storedCode,
    name: entry.label,
    kind: entry.kind,
    rewritten: entry.storedCode !== entry.code,
    ...(entry.duplicateOfCurrentCodes
      ? { duplicateOfCurrentCodes: entry.duplicateOfCurrentCodes }
      : {}),
  }
}

/**
 * Invariants a legacy chart map must satisfy before it can be trusted to
 * rewrite codes. Returns the violations; an empty array is the pass.
 *
 * These are not restatements of the rule — they are the failure modes the rule
 * does not prevent by construction, and every one of them was reachable on
 * this workbook:
 *
 *   collision   two legacy meanings land on the SAME stored code. Reachable
 *               because renumbering is simultaneous, not chained:
 *               `PLF.04.02.99` renumbers ONTO `PLF.04.01.99` while 2025's own
 *               `PLF.04.01.99` ("Other Advertisements") is an own-account row.
 *   mislabel    a legacy row lands on a current code whose current NAME says
 *               something else. This is the whole defect; assert it directly.
 *   duplicate   an own-account row reproduces a current account's label under
 *               a new code.
 */
export interface LegacyChartViolation {
  /**
   * `collision`  two DIFFERENT labels post to one stored code.
   * `merge`      two different 2025 CODES carrying the SAME label post to one
   *              stored code, so two source accounts become one.
   * `mislabel`   a row lands where the current chart names something else.
   * `duplicate`  an own-account row whose label already exists elsewhere.
   */
  kind: "collision" | "merge" | "mislabel" | "duplicate"
  code: string
  detail: string
}

export function checkLegacyChartMap(
  map: LegacyChartMap,
  current: readonly LegacyChartRow[],
): LegacyChartViolation[] {
  /** code → the labels the current chart uses, verbatim, keyed by normalised. */
  const currentLabelsByCode = new Map<string, Map<string, string>>()
  for (const row of current) {
    if (!row.label) continue
    const labels = currentLabelsByCode.get(row.code)
    if (labels) labels.set(normaliseChartLabel(row.label), row.label)
    else
      currentLabelsByCode.set(
        row.code,
        new Map([[normaliseChartLabel(row.label), row.label]]),
      )
  }

  const violations: LegacyChartViolation[] = []
  const landed = new Map<
    string,
    { from: string; name: string; key: string; via?: string }
  >()

  for (const entry of map.entries) {
    const name = normaliseChartLabel(entry.label)
    /**
     * The identity of a SOURCE account, which this module states plainly is
     * (code, label) and not either alone. The check below used to compare
     * labels only, so two different 2025 codes sharing one label landed on one
     * stored code in silence — the exact shape of the miss found on 2026-08-19:
     *
     *   PLF.02.01.99 "Other Costs"  (farming)    ─┐
     *                                             ├─→ PLF.02.03.99
     *   PLF.02.02.99 "Other Costs"  (processing) ─┘
     *
     * Two accounts of the client's became one, the farm/plant split on that
     * line stopped existing, and — because the paired revenue `PLF.01.01.99`
     * stayed where it was — the product-margin screen showed 1,921,539 of
     * revenue with no cost against it. Nothing failed; the money simply moved
     * branch. A merge is reported whether or not the labels agree, because
     * agreeing labels are what makes it invisible.
     */
    const key = legacyEntryKey(entry.code, entry.label)

    const prior = landed.get(entry.storedCode)
    // A hand correction carries its own reason and was made deliberately; it
    // is reported by the derive script, not raised as an accident here.
    if (prior && prior.key !== key && entry.via !== "override" && prior.via !== "override") {
      if (normaliseChartLabel(prior.name) !== name) {
        violations.push({
          kind: "collision",
          code: entry.storedCode,
          detail: `${prior.from} ("${prior.name}") and ${entry.code} ("${entry.label}") both post to ${entry.storedCode}`,
        })
      } else {
        violations.push({
          kind: "merge",
          code: entry.storedCode,
          detail: `${prior.from} and ${entry.code} both carry "${entry.label}" and both post to ${entry.storedCode}: two 2025 accounts become one`,
        })
      }
    } else if (!prior) {
      landed.set(entry.storedCode, {
        from: entry.code,
        name: entry.label,
        key,
        via: entry.via,
      })
    }

    const currentNames = currentLabelsByCode.get(entry.storedCode)
    // A hand correction lands on a code the current chart names differently
    // ON PURPOSE — that renaming is precisely why the label rule failed and
    // the correction exists. Reporting it as a mislabel would file the fix as
    // the fault it repairs.
    if (currentNames && !currentNames.has(name) && entry.via !== "override") {
      violations.push({
        kind: "mislabel",
        code: entry.storedCode,
        detail: `${entry.code} ("${entry.label}") posts to ${entry.storedCode}, which the current chart names "${[...currentNames.values()].join('" / "')}"`,
      })
    }

    if (entry.duplicateOfCurrentCodes) {
      violations.push({
        kind: "duplicate",
        code: entry.storedCode,
        detail: `${entry.storedCode} ("${entry.label}") duplicates ${entry.duplicateOfCurrentCodes.join(", ")}`,
      })
    }
  }
  return violations
}
