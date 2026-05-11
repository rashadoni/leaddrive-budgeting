/**
 * Phase 7.D — Bloomberg-style command-bar parser.
 *
 * Grammar: `<TARGET?> <FUNCTION> GO`
 *   TARGET   — company code (HILTN, ATL-DBZ) or sub-group code (TABIA),
 *              indicator code (IND_GROSS_MARGIN), industry name (HOSPITALITY).
 *              Optional; some functions are scope-less (HOLD, BRF).
 *   FUNCTION — one of the 9 reserved verbs:
 *              HOLD  — holding-level overview (heatmap)
 *              GRP   — sub-group view (e.g. AZMADE, TABIA)
 *              CO    — single-company drill-down (= focus the row)
 *              IND   — single-indicator detail (across all companies)
 *              SEC   — sector view (filters companies by industry)
 *              CMP   — compare two companies side-by-side
 *              ALT   — alerts panel
 *              SCN   — scenario stress-test runner
 *              BRF   — AI morning brief
 *   GO       — required terminator. Without GO the command is incomplete
 *              (matches Bloomberg's `<GO>` key convention; users hit
 *              Enter/Return mapped to GO).
 *
 * The parser is PURE — no DB, no router. It returns a tagged-union
 * `ParsedCommand` that the CommandBar component dispatches into the
 * terminal store. Unknown functions / missing GO produce typed errors
 * the UI renders inline.
 *
 * Why this lives separate from CommandBar.tsx: the parser is the only
 * piece worth unit-testing exhaustively; the React component is mostly
 * input handling. Splitting makes both easier to verify.
 */

export type FunctionCode =
  | "HOLD"
  | "GRP"
  | "CO"
  | "IND"
  | "SEC"
  | "CMP"
  | "ALT"
  | "SCN"
  | "BRF"
  | "AUD"
  | "ACT"
  | "CMT" // Tier-3 sub-30 — CommentsLayer @mention threads on cells
  | "CHT" // Tier-3 sub-30 — SubCoFinanceChat holding-CFO ↔ sub-co threads
  | "SUB" // Tier-3 sub-30 — AISubscriptions user-defined alert subscriptions
  | "INT" // Phase 7.G D.4 — IntelFeedPanel AI Web Crawler results feed
  | "BREACH" // Phase 7.G Turn CI (E.2d UI) — predictive breach forecasts panel
  | "HELP" // CLI Bloomberg-sweep — opens command-reference modal
  | "PEER" // CLI Tier 2 — multi-company side-by-side comparison (2-5 companies)

export const FUNCTION_CODES: readonly FunctionCode[] = [
  "HOLD",
  "GRP",
  "CO",
  "IND",
  "SEC",
  "CMP",
  "ALT",
  "SCN",
  "BRF",
  "AUD",
  "ACT",
  "CMT",
  "CHT",
  "SUB",
  "INT",
  "BREACH",
  "HELP",
  "PEER",
]

/**
 * Whether each function REQUIRES a target token before the verb.
 *  - required: parsing fails without one (CO requires a company; IND requires
 *    an indicator code; CMP requires two; SEC requires a sector; etc.)
 *  - optional: target narrows scope but isn't mandatory (GRP optional → if
 *    omitted, lists all sub-groups).
 *  - forbidden: target makes no sense (HOLD always holding-level; BRF generates
 *    against the entire holding; ALT is global).
 */
export const TARGET_REQUIREMENT: Record<FunctionCode, "required" | "optional" | "forbidden"> = {
  HOLD: "forbidden",
  GRP: "optional",
  CO: "required",
  IND: "required",
  SEC: "required",
  CMP: "required", // requires TWO targets via comma syntax — see below
  ALT: "forbidden",
  SCN: "required",
  BRF: "forbidden",
  AUD: "forbidden", // Phase 7.F audit log overlay — global, no scope
  ACT: "forbidden", // Tier-3 sub-28 ActionCenter — global queue, no scope
  CMT: "forbidden", // Tier-3 sub-30 CommentsLayer — global thread index
  CHT: "forbidden", // Tier-3 sub-30 SubCoFinanceChat — global subco thread index
  SUB: "forbidden", // Tier-3 sub-30 AISubscriptions — global subscription manager
  INT: "forbidden", // Phase 7.G D.4 IntelFeedPanel — org-scoped global feed
  BREACH: "forbidden", // Phase 7.G Turn CI (E.2d UI) — predictive breach panel, org-scoped global
  HELP: "forbidden", // CLI Bloomberg-sweep — global modal, no scope
  PEER: "required", // CLI Tier 2 — comma-separated 2-5 company codes
}

export type ParsedCommand =
  | { kind: "hold" }
  | { kind: "grp"; subgroupCode: string | null }
  | { kind: "co"; companyCode: string }
  | { kind: "ind"; indicatorCode: string }
  | { kind: "sec"; sector: string }
  | { kind: "cmp"; left: string; right: string }
  | { kind: "alt" }
  | { kind: "scn"; scenarioCode: string }
  | { kind: "brf" }
  | { kind: "aud" }
  | { kind: "act" }
  | { kind: "cmt" }
  | { kind: "cht" }
  | { kind: "sub" }
  | { kind: "int" }
  | { kind: "breach" }
  | { kind: "help" }
  | { kind: "peer"; codes: string[] }

export type ParseError = {
  /** Machine code: keep stable for tests + UI categorisation. */
  code:
    | "empty"
    | "missing_go"
    | "unknown_function"
    | "missing_target"
    | "unexpected_target"
    | "cmp_requires_two_targets"
    | "too_many_tokens"
  /** Human-readable hint shown in the command bar inline. */
  reason: string
}

export type ParseResult =
  | { ok: true; command: ParsedCommand }
  | { ok: false; error: ParseError }

const isFunctionCode = (s: string): s is FunctionCode =>
  (FUNCTION_CODES as readonly string[]).includes(s)

/** Tokenize on whitespace, drop empty strings, uppercase everything. */
function tokenize(input: string): string[] {
  return input
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

export function parseCommand(rawInput: string): ParseResult {
  const tokens = tokenize(rawInput)
  if (tokens.length === 0) {
    return { ok: false, error: { code: "empty", reason: "Type a command" } }
  }

  // GO terminator must be present and last. Without GO the user is still
  // typing — we don't dispatch partial commands.
  if (tokens[tokens.length - 1] !== "GO") {
    return {
      ok: false,
      error: {
        code: "missing_go",
        reason: "Commands end with `GO` (Bloomberg convention).",
      },
    }
  }

  const body = tokens.slice(0, -1)
  if (body.length === 0) {
    // Just `GO` — empty body.
    return {
      ok: false,
      error: {
        code: "missing_go",
        reason: "Type a function before GO. Try `HOLD GO` or `HEAT CO GO`.",
      },
    }
  }

  // Function code is the LAST token of the body. Targets sit before it.
  const fn = body[body.length - 1]
  if (!isFunctionCode(fn)) {
    return {
      ok: false,
      error: {
        code: "unknown_function",
        reason: `Unknown function "${fn}". Available: ${FUNCTION_CODES.join(", ")}.`,
      },
    }
  }

  const targetsRaw = body.slice(0, -1)
  // CMP supports both comma-separated single-token form (`AAC,LLS CMP GO`)
  // AND two-token form (`AAC LLS CMP GO`). Normalise to a flat list.
  const targets: string[] = targetsRaw.flatMap((t) => t.split(",").filter(Boolean))

  const requirement = TARGET_REQUIREMENT[fn]
  if (requirement === "forbidden" && targets.length > 0) {
    return {
      ok: false,
      error: {
        code: "unexpected_target",
        reason: `${fn} doesn't take a target. Type \`${fn} GO\`.`,
      },
    }
  }
  if (requirement === "required" && targets.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_target",
        reason: `${fn} needs a target before the verb. Example: \`AAC ${fn} GO\`.`,
      },
    }
  }
  if (fn === "CMP" && targets.length !== 2) {
    return {
      ok: false,
      error: {
        code: "cmp_requires_two_targets",
        reason: `CMP compares exactly two targets. Got ${targets.length}: \`${targets.join(", ")}\`.`,
      },
    }
  }
  // PEER accepts 2-5 comma-separated company codes.
  if (fn === "PEER" && (targets.length < 2 || targets.length > 5)) {
    return {
      ok: false,
      error: {
        code: "cmp_requires_two_targets",
        reason: `PEER compares 2-5 companies. Got ${targets.length}: \`${targets.join(", ")}\`. Example: \`AAC,ATL,SPARK PEER GO\`.`,
      },
    }
  }
  // For non-CMP / non-PEER required/optional functions, accept exactly one target.
  if (fn !== "CMP" && fn !== "PEER" && targets.length > 1) {
    return {
      ok: false,
      error: {
        code: "too_many_tokens",
        reason: `${fn} takes at most one target. Got: \`${targets.join(", ")}\`.`,
      },
    }
  }

  switch (fn) {
    case "HOLD":
      return { ok: true, command: { kind: "hold" } }
    case "GRP":
      return {
        ok: true,
        command: { kind: "grp", subgroupCode: targets[0] ?? null },
      }
    case "CO":
      return { ok: true, command: { kind: "co", companyCode: targets[0] } }
    case "IND":
      return {
        ok: true,
        command: { kind: "ind", indicatorCode: targets[0] },
      }
    case "SEC":
      return { ok: true, command: { kind: "sec", sector: targets[0] } }
    case "CMP":
      return {
        ok: true,
        command: { kind: "cmp", left: targets[0], right: targets[1] },
      }
    case "ALT":
      return { ok: true, command: { kind: "alt" } }
    case "SCN":
      return { ok: true, command: { kind: "scn", scenarioCode: targets[0] } }
    case "BRF":
      return { ok: true, command: { kind: "brf" } }
    case "AUD":
      return { ok: true, command: { kind: "aud" } }
    case "ACT":
      return { ok: true, command: { kind: "act" } }
    case "CMT":
      return { ok: true, command: { kind: "cmt" } }
    case "CHT":
      return { ok: true, command: { kind: "cht" } }
    case "SUB":
      return { ok: true, command: { kind: "sub" } }
    case "INT":
      return { ok: true, command: { kind: "int" } }
    case "BREACH":
      return { ok: true, command: { kind: "breach" } }
    case "HELP":
      return { ok: true, command: { kind: "help" } }
    case "PEER":
      return { ok: true, command: { kind: "peer", codes: targets } }
  }
}

/**
 * Map a parsed command to the panel that should activate. Used by
 * CommandBar to swap focus after dispatch — Bloomberg muscle memory says
 * a function jump should land you in the right pane.
 *
 * Layout convention:
 *   Panel 1 (top-left) — CompanyTree (sub-groups + operational nav)
 *   Panel 2 (top-right) — HeatMap (matrix overview)
 *   Panel 3 (bottom-left) — Indicator drill-down (formula, resolved vars)
 *   Panel 4 (bottom-right) — Variance Explainer (AI narrative + recs)
 *
 * Returns `null` for commands that are NOT panel switches — currently
 * just `aud` (audit log overlay). The CommandBar's dispatch checks for
 * null and skips `setActivePanel`, leaving the user's current pane
 * untouched while the modal is on top.
 */
export function panelForCommand(cmd: ParsedCommand): 1 | 2 | 3 | 4 | null {
  switch (cmd.kind) {
    case "hold":
    case "grp":
    case "sec":
    case "cmp":
      return 2 // matrix view
    case "co":
      return 1 // company tree focus
    case "ind":
      return 3 // indicator detail
    case "scn":
    case "alt":
    case "brf":
      return 4 // narrative / scenario panel
    case "aud":
    case "act":
    case "cmt":
    case "cht":
    case "sub":
    case "int":
    case "breach":
    case "help":
    case "peer":
      return null // overlay modal — does not steal focus from any panel
  }
}
