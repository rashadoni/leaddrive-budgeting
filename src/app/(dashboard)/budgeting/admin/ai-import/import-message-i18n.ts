/**
 * Phase 11.7x — localize the English sentences the import pipeline hands the
 * AI Import screens.
 *
 * The orchestrator, the file-type detector, the dynamic CoA adapters and
 * `/api/import/ai-auto-multi` all build their user-facing text as English
 * template literals on the server. Those strings were rendered verbatim, so an
 * Azerbaijani page showed «Xəbərdarlıqlar» as a heading and then twelve lines
 * of English underneath it — the exact complaint that opened this pass
 * («меню на азербайджанском, инфографики на английском»).
 *
 * Rewriting every producer to emit a key + params would touch four server
 * modules and their tests. Instead this module recognises the *shapes* those
 * producers emit and re-renders them from the catalogue, in the reader's
 * language, with the same values in the same places.
 *
 * Contract:
 *  - `localizeImportMessage` NEVER throws and NEVER drops information: a shape
 *    it does not recognise comes back byte-identical, so a new server message
 *    degrades to today's behaviour instead of disappearing.
 *  - Rules are ordered most-specific-first.
 *  - Every capture group is passed straight through as an ICU value, so the
 *    numbers, filenames and sheet names stay verbatim.
 */

/**
 * The subset of the next-intl translator this module needs. Values are kept to
 * `string | number` so a `useTranslations()` result is assignable under
 * `strictFunctionTypes` (next-intl's own values type is wider).
 */
export type ImportTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string

/**
 * next-intl types message keys against the catalogue; this module resolves
 * them at runtime from a pattern table, so the cast lives here — once —
 * instead of at every call site. (MultiFileForm already does the same with
 * `as never` for its dynamic `warnings.group.*` lookup.)
 */
export function asImportTranslator(t: unknown): ImportTranslator {
  return t as ImportTranslator
}

const VERDICT_WORDS = new Set(["green", "yellow", "red", "skipped"])

/**
 * Reconciliation verdict enum → catalogue label. `green` / `yellow` / `red`
 * arrive straight off the wire and used to be printed (often `.toUpperCase()`)
 * next to an already-translated card label.
 */
export function localizeVerdict(t: ImportTranslator, verdict: string): string {
  const key = verdict.trim().toLowerCase()
  return VERDICT_WORDS.has(key) ? t(`verdict.${key}`) : verdict
}

/** Statement name as the CoA adapters spell it → shared dataType label. */
const STATEMENT_TO_DATATYPE: Record<string, string> = {
  "P&L": "PLF",
  "Balance Sheet": "BS",
  "Cash Flow": "CF",
}

function localizeStatement(t: ImportTranslator, statement: string): string {
  const code = STATEMENT_TO_DATATYPE[statement]
  return code ? t(`dataType.${code}`) : statement
}

type Values = Record<string, string>

interface Rule {
  re: RegExp
  key: string
  /** Post-process the raw capture groups before they reach ICU. */
  values?: (groups: Values, t: ImportTranslator) => Record<string, string>
}

const verdictValues = (g: Values, t: ImportTranslator) => ({
  ...g,
  verdict: localizeVerdict(t, g.verdict ?? ""),
})

const statementValues = (g: Values, t: ImportTranslator) => ({
  ...g,
  statement: localizeStatement(t, g.statement ?? ""),
})

/**
 * Fragments that appear *inside* a wrapped sheet warning, joined by " · " by
 * `multi-file-orchestrator.ts`. Tried before the whole-line rules because the
 * detail localizer recurses through the same table.
 */
const DETAIL_RULES: Rule[] = [
  {
    // product-sales-parser.ts — "1516 row(s) outside 2026 skipped".
    re: /^Sales transactions "(?<entity>.+?)": (?<n>\d+) row\(s\) outside (?<year>\d{4}) skipped \(import that year separately\)\.$/,
    key: "msg.detailOffYearRows",
  },
  {
    // product-sales-parser.ts — the tonnes/kilograms auto-correction.
    re: /^column "(?<column>.+?)" claims tonnes but the median implied price is (?<price>[\d.]+) ₼ — the values are kilograms; divided by (?<divisor>\d+) so price\/volume read per tonne$/,
    key: "msg.detailKgUnitFix",
  },
  {
    re: /^Sheet "(?<sheet>.+?)": (?<n>\d+) product label\(s\) outside the approved dictionary — imported under their own code, review the mapping: (?<labels>.+)$/,
    key: "msg.detailDictionary",
  },
  {
    // production-adapter-handlers-sales.ts:50
    re: /^Sales sheet "(?<sheet>.+?)" could not be attributed to a company\..*$/s,
    key: "msg.detailUnattributedSales",
  },
  {
    // production-adapter-handlers-financial.ts — off-year sheet skip. The
    // leading `Sheet "…" ` is optional: the orchestrator sometimes strips it
    // when the wrapper already names the sheet.
    re: /^(?:Sheet "(?<sheet>.+?)" )?carries (?<years>[\d,\s]+?) data, but this run imports (?<year>\d{4}) — skipped without calling the AI detector\..*$/s,
    key: "msg.detailOffYearSheet",
  },
  {
    // operational-facts-import.ts:204
    re: /^row (?<row>\d+): Missing required column\(s\): (?<columns>[^.]+)\.?.*$/s,
    key: "msg.detailMissingColumns",
  },
  {
    // production-adapter-handlers-soft.ts:735 / :830
    re: /^row (?<row>\d+): date (?<date>.+?) outside year (?<year>\d+) — skipped$/,
    key: "msg.detailRowOffYear",
  },
]

/** Whole-line shapes: warnings, skip reasons, CoA reasons, API errors. */
const LINE_RULES: Rule[] = [
  // ── multi-file-orchestrator.ts warnings ───────────────────────────
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) — no adapter; skipped$/,
    key: "msg.noAdapter",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) is a derived\/summary view — skipped \(not written\) so it can't clean-slate the source sheet$/,
    key: "msg.derivedSummarySkipped",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) is consolidated — routed to the holding entity "(?<holding>.+?)"$/,
    key: "msg.consolidatedRouted",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) is consolidated \(holding sentinel\) but no unique holding company was resolved — skipped \(0 rows\)$/,
    key: "msg.consolidatedNoHolding",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" is cash flow targeting the holding "(?<holding>.+?)" — refused \(CF is per-company only\); skipped \(0 rows\)$/,
    key: "msg.cfOnHoldingRefused",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) — entity (?<entity>.+?) read from cells \((?<why>.+)\)$/,
    key: "msg.entityFromCells",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) had no entity in its name — auto-resolved to (?<entity>.+?) via (?<how>.+?) \(confidence (?<confidence>[\d.]+)\)$/,
    key: "msg.entityAutoResolved",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" \((?<type>[A-Z_]+)\) has no entity — most likely the consolidated (?<entity>.+?) statement; left null for one-time review \(not auto-written\)$/,
    key: "msg.entityConsolidatedGuess",
  },
  {
    re: /^(?<file>.+?): sheet "(?<sheet>.+?)" parse error — (?<error>.+)$/s,
    key: "msg.sheetParseError",
  },
  {
    re: /^(?<file>.+?): classify failed — (?<error>.+)$/s,
    key: "msg.classifyFailed",
  },
  {
    re: /^(?<file>.+?): reused approved AI import template "(?<name>.+?)" v(?<version>\d+); sheet-classifier LLM skipped, preview\/reconciliation still ran$/,
    key: "msg.templateReused",
  },
  {
    re: /^(?<file>.+?): saved template did not cover (?<n>\d+) sheet\(s\); falling back to AI classifier$/,
    key: "msg.templateIncomplete",
  },
  {
    re: /^Group "(?<group>.+?)" pre-write verdict (?<verdict>green|yellow|red) — skipped$/,
    key: "msg.groupPreWriteSkipped",
    values: verdictValues,
  },
  {
    re: /^Group "unknown" \((?<n>\d+) file\(s\)\) skipped — manual review required$/,
    key: "msg.groupUnknownSkipped",
  },
  {
    re: /^Recompute failed \(non-fatal\): (?<error>.+)$/s,
    key: "msg.recomputeFailedNonFatal",
  },

  // ── perGroup.skipReason ───────────────────────────────────────────
  {
    re: /^Pre-write reconciliation verdict: (?<verdict>green|yellow|red)$/,
    key: "msg.skipPreWriteVerdict",
    values: verdictValues,
  },
  {
    re: /^No parseable sheets in group "(?<group>.+?)"$/,
    key: "msg.skipNoParseableSheets",
  },
  {
    re: /^File-type unknown for (?<n>\d+) file\(s\); manual review required$/,
    key: "msg.skipFileTypeUnknown",
  },
  {
    re: /^Group commit failed: (?<error>.+)$/s,
    key: "msg.skipGroupCommitFailed",
  },
  { re: /^dryRun=true — no DB writes$/, key: "msg.skipDryRun" },
  {
    re: /^verdict=(?<verdict>green|yellow|red|skipped)$/,
    key: "msg.skipVerdict",
    values: verdictValues,
  },

  // ── dynamic-{plf,bs,cf}-adapter.ts CoA review reasons ─────────────
  {
    re: /^No high-confidence (?<statement>P&L|Balance Sheet|Cash Flow) code match$/,
    key: "msg.coaNoMatch",
    values: statementValues,
  },
  {
    re: /^Approved code "(?<code>.+?)" is not a valid (?<statement>P&L|Balance Sheet|Cash Flow) leaf code$/,
    key: "msg.coaInvalidApproved",
    values: statementValues,
  },

  // ── file-type-detector.ts reasoning ───────────────────────────────
  {
    re: /^(?<plf>\d+) PLF \+ (?<bs>\d+) BS \+ (?<cf>\d+) CF sheets → primary financial workbook$/,
    key: "msg.ftMainFinancial",
  },
  {
    re: /^No content sheets detected in "(?<file>.+?)" \(only separators \/ unknowns\)$/,
    key: "msg.ftNoContent",
  },
  {
    re: /^Filename "(?<file>.+?)" matches forward-forecast keyword; (?<n>\d+) forecast-shape sheets without BS\+CF trio → multi-year projection$/,
    key: "msg.ftForecastFilename",
  },
  {
    re: /^(?<n>\d+) COMPANIES sheet\(s\), no PLF\/BS\/CF → entity-tree setup file$/,
    key: "msg.ftCompanies",
  },
  {
    re: /^(?<n>\d+) land registry sheet\(s\), no PLF\/BS\/CF → land titles file$/,
    key: "msg.ftLand",
  },
  {
    re: /^(?<n>\d+) CAPEX sheet\(s\), no PLF\/BS\/CF → standalone CAPEX file$/,
    key: "msg.ftCapex",
  },
  {
    re: /^(?<n>\d+) description sheet\(s\), no PLF\/BS\/CF → strategic narrative file$/,
    key: "msg.ftDescriptions",
  },
  {
    re: /^(?<n>\d+) KPI sheet\(s\), no PLF\/BS\/CF → standalone KPI file$/,
    key: "msg.ftKpi",
  },
  {
    re: /^(?<n>\d+) ops-facts sheet\(s\), no PLF\/BS\/CF → standalone operational-facts file$/,
    key: "msg.ftOpsFacts",
  },
  {
    re: /^(?<n>\d+) product-sales sheet\(s\), no PLF\/BS\/CF → standalone product-sales file$/,
    key: "msg.ftProductSales",
  },
  {
    re: /^(?<n>\d+) compliance\/register sheet\(s\), no PLF\/BS\/CF → standalone compliance file$/,
    key: "msg.ftCompliance",
  },
  {
    re: /^(?<n>\d+) assumptions sheet\(s\), no PLF\/BS\/CF → standalone budget-drivers file$/,
    key: "msg.ftAssumptions",
  },
  {
    re: /^(?<n>\d+) budget-actuals sheet\(s\), no PLF\/BS\/CF → standalone actuals file$/,
    key: "msg.ftBudgetActuals",
  },
  {
    re: /^(?<n>\d+) sales-forecast sheet\(s\), no PLF\/BS\/CF → department×month forecast file$/,
    key: "msg.ftSalesForecast",
  },
  {
    re: /^(?<sales>\d+) sales \+ (?<summary>\d+) summary sheets, no PLF\/BS\/CF → forward forecast file$/,
    key: "msg.ftForwardForecast",
  },
  {
    re: /^Sheet shape mix doesn't match any known file type for "(?<file>.+?)" \(counts: (?<counts>.*)\)$/s,
    key: "msg.ftUnknownShape",
  },

  // ── /api/import/ai-auto-multi/route.ts errors ─────────────────────
  {
    re: /^Multi-file import failed\. Check the server logs for details\.$/,
    key: "msg.errImportFailed",
  },
  { re: /^Cross-file conflicts detected$/, key: "msg.errCrossFileConflicts" },
  {
    re: /^Total file size (?<size>[\d.]+) MB exceeds (?<cap>[\d.]+) MB cap$/,
    key: "msg.errTotalSize",
  },
  {
    re: /^Max (?<max>\d+) files per upload \(got (?<got>\d+)\)$/,
    key: "msg.errMaxFiles",
  },
  {
    re: /^Provide at least one file via 'files' field$/,
    key: "msg.errNoFile",
  },
  { re: /^No organization in session$/, key: "msg.errNoOrg" },
  {
    re: /^Another import is already running for this organization and (?<year>\d+)\..*$/s,
    key: "msg.errImportInProgress",
  },
  {
    re: /^LLM budget exceeded \((?<reason>.+?)\)\. Resets at (?<resetAt>.+)$/,
    key: "msg.errLlmBudget",
  },
  { re: /^Invalid import year selection$/, key: "msg.errInvalidYear" },
  {
    re: /^Body must be multipart\/form-data: (?<error>.+)$/s,
    key: "msg.errNotMultipart",
  },
  {
    re: /^Invalid xlsx in '(?<file>.+?)': (?<error>.+)$/s,
    key: "msg.errInvalidXlsx",
  },
]

function applyRules(
  rules: Rule[],
  t: ImportTranslator,
  raw: string,
): string | null {
  for (const rule of rules) {
    const m = rule.re.exec(raw)
    if (!m) continue
    const groups = (m.groups ?? {}) as Values
    const values = rule.values ? rule.values(groups, t) : groups
    return t(rule.key, values)
  }
  return null
}

/** " (+3 more)" tail the orchestrator appends after the joined details. */
const MORE_TAIL = / \(\+(\d+) more\)$/

function localizeDetail(t: ImportTranslator, raw: string): string {
  const trimmed = raw.trim()
  const tail = MORE_TAIL.exec(trimmed)
  const base = tail ? trimmed.slice(0, tail.index) : trimmed
  const localized =
    applyRules(DETAIL_RULES, t, base) ?? applyRules(LINE_RULES, t, base) ?? base
  return tail ? `${localized} ${t("msg.andMoreTail", { n: tail[1] })}` : localized
}

/**
 * `${filename}: sheet "${sheetName}" — ${details.join(" · ")}` — by far the
 * most common warning shape. The wrapper is rebuilt from the catalogue and
 * each " · "-joined detail is localized on its own.
 */
const SHEET_WRAPPER = /^(?<file>[^\n]+?): sheet "(?<sheet>.+?)" — (?<detail>.+)$/s

/**
 * Turn one server-authored English string into the reader's language.
 * Unrecognised input is returned unchanged — never blanked, never truncated.
 */
export function localizeImportMessage(
  t: ImportTranslator,
  raw: string | null | undefined,
): string {
  if (!raw) return ""
  const trimmed = raw.trim()
  if (!trimmed) return raw

  const direct = applyRules(LINE_RULES, t, trimmed)
  if (direct !== null) return direct

  const wrapped = SHEET_WRAPPER.exec(trimmed)
  if (wrapped?.groups) {
    const { file, sheet, detail } = wrapped.groups as Values
    const parts = detail
      .split(" · ")
      .map((part) => localizeDetail(t, part))
      .join(" · ")
    return t("msg.sheetWarning", { file, sheet, detail: parts })
  }

  return applyRules(DETAIL_RULES, t, trimmed) ?? raw
}
