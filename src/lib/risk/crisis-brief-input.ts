/**
 * Phase 16.10 (2026-08-06) — validate and bound what a client can put into the
 * crisis-brief LLM prompt.
 *
 * `POST /api/scenarios/[id]/narrative` read its body with a bare
 * `as NarrativeBody` cast and handed the fields straight to
 * `buildCrisisBriefPrompt`. Two problems, both structural rather than
 * theoretical:
 *
 * 1. **Nothing was bounded.** Every string became prompt tokens at whatever
 *    length the caller chose, and `worstHit` was an unbounded array. The bill
 *    and the latency were the caller's to set.
 *
 * 2. **`assumptionNote` was free prose spliced in under an instruction.** The
 *    prompt says `Modeling assumption (state this in the narrative): <text>`,
 *    so a caller could write instructions rather than a caveat and the model
 *    would follow them — into a narrative shown to a board.
 *
 * ── The fix for (2) is not a filter ──────────────────────────────────────
 * Sanitising prose is a losing game. The note is not the client's to write in
 * the first place: `GET ?mode=drivers` already produced it, and 16.7 made the
 * evidence behind it STRUCTURED (`driverReports`). So the endpoint now accepts
 * the structured reports — typed numbers and short company codes — and
 * regenerates the sentence with `buildDriverNote` on the server. The client
 * cannot supply prose to the prompt at all, rather than supplying prose that is
 * scrubbed.
 *
 * What remains client-supplied is `worstHit`: company codes, names and
 * indicator codes that the server cannot re-derive without re-simulating (the
 * whole reason this endpoint is separate is the latency split). Those are
 * bounded in count and length, and stripped of the newlines and control
 * characters that let injected text open what looks like a new instruction
 * block.
 *
 * Pure module — no LLM, no DB. The route composes; this decides.
 */
import { z } from 'zod'
import type { CrisisBriefWorstHit, BriefLanguage } from './scenario-narrative'
import { buildDriverNote, type ImportShareReport } from './scenario-shock'

/** Caps. Generous for real data, hostile to a payload built to be expensive. */
export const BRIEF_LIMITS = {
  worstHitCompanies: 10,
  deltasPerCompany: 5,
  companyCode: 64,
  companyName: 200,
  indicatorCode: 64,
  /** Company codes inside a driver report — same shape as a worstHit code. */
  driverReports: 4,
  driverCompanies: 200,
} as const

/**
 * Flatten a string to a single line of printable characters.
 *
 * Newlines are the load-bearing part. The prompt is a newline-delimited
 * document with labelled sections, so a value containing `\n` can close its
 * own line and open text that reads to the model as a new instruction. Control
 * characters go for the same reason. What is left is truncated, then trimmed.
 *
 * This does NOT try to detect malicious wording — that is unwinnable and is why
 * the free-prose field was removed instead of filtered.
 */
export function sanitizePromptText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return ''
  return raw
    // C0 controls, DEL and C1 controls — newline included, deliberately.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    // Unicode line/paragraph separators do the same job as \n in a prompt.
    .replace(/[\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/**
 * A score the prompt prints, or null.
 *
 * Takes `unknown` rather than `z.union([z.number(), z.null()])` deliberately.
 * A union REJECTS a wrong-typed field, and because these are fields of one
 * object schema, a single rejection fails the whole `safeParse` — which would
 * discard every other field with it and quietly turn a real brief into an empty
 * one. Coercing per field is what makes the per-field degradation this module
 * documents actually true.
 */
const finiteOrNull = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))

/** A count the prompt prints. Non-finite or negative collapses to 0. */
const counter = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0))

const deltaSchema = z
  .object({
    code: z.unknown(),
    baselineValue: z.unknown(),
    scenarioValue: z.unknown(),
  })
  .transform((d) => ({
    code: sanitizePromptText(d.code, BRIEF_LIMITS.indicatorCode),
    baselineValue: typeof d.baselineValue === 'number' && Number.isFinite(d.baselineValue) ? d.baselineValue : 0,
    scenarioValue: typeof d.scenarioValue === 'number' && Number.isFinite(d.scenarioValue) ? d.scenarioValue : 0,
  }))

const worstHitSchema = z
  .object({
    companyCode: z.unknown(),
    companyName: z.unknown(),
    baselineScore: finiteOrNull,
    scenarioScore: finiteOrNull,
    topDeltas: z.array(z.unknown()).optional(),
  })
  .transform((w) => ({
    companyCode: sanitizePromptText(w.companyCode, BRIEF_LIMITS.companyCode),
    companyName: sanitizePromptText(w.companyName, BRIEF_LIMITS.companyName),
    baselineScore: w.baselineScore,
    scenarioScore: w.scenarioScore,
    topDeltas: (w.topDeltas ?? [])
      .slice(0, BRIEF_LIMITS.deltasPerCompany)
      .map((d) => deltaSchema.safeParse(d))
      .flatMap((r) => (r.success ? [r.data] : [])),
  }))

/**
 * One driver report as the client may send it back. Only the fields
 * `buildDriverNote` reads, all bounded — this is the structured replacement for
 * the free-prose `assumptionNote`.
 */
const driverReportSchema = z
  .object({
    driverKey: z.unknown().optional(),
    measured: z.array(z.unknown()).optional(),
    fromAssumption: z.array(z.unknown()).optional(),
    fromCatalogDefault: z.array(z.unknown()).optional(),
    unresolved: z.array(z.unknown()).optional(),
    rejected: z.array(z.unknown()).optional(),
    catalogDefault: finiteOrNull,
  })
  .transform((r): ImportShareReport => {
    const codes = (arr: unknown[] | undefined) =>
      (arr ?? [])
        .slice(0, BRIEF_LIMITS.driverCompanies)
        .map((c) => sanitizePromptText(c, BRIEF_LIMITS.companyCode))
        .filter(Boolean)
    return {
      // Constrained to a slug: the key selects a display label and must not be
      // able to carry text of its own into the sentence.
      driverKey: sanitizePromptText(r.driverKey, 40).replace(/[^a-z0-9_]/gi, ''),
      measured: codes(r.measured),
      fromAssumption: (r.fromAssumption ?? [])
        .slice(0, BRIEF_LIMITS.driverCompanies)
        .flatMap((f) => {
          if (!f || typeof f !== 'object') return []
          const o = f as { companyCode?: unknown; share?: unknown }
          const companyCode = sanitizePromptText(o.companyCode, BRIEF_LIMITS.companyCode)
          if (!companyCode) return []
          const share = typeof o.share === 'number' && Number.isFinite(o.share) ? o.share : 0
          return [{ companyCode, share }]
        }),
      fromCatalogDefault: codes(r.fromCatalogDefault),
      unresolved: codes(r.unresolved),
      rejected: (r.rejected ?? [])
        .slice(0, BRIEF_LIMITS.driverCompanies)
        .flatMap((f) => {
          if (!f || typeof f !== 'object') return []
          const o = f as { companyCode?: unknown; value?: unknown; reason?: unknown }
          const companyCode = sanitizePromptText(o.companyCode, BRIEF_LIMITS.companyCode)
          if (!companyCode) return []
          return [{
            companyCode,
            value: typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : 0,
            // The reason is server-authored text echoed back; re-sanitised
            // anyway, because it arrives over the wire from the client.
            reason: sanitizePromptText(o.reason, 200),
          }]
        }),
      catalogDefault: r.catalogDefault,
    }
  })

const LANGUAGES = ['en', 'ru', 'az'] as const

export const narrativeBodySchema = z.object({
  // Coerced, not enum-validated, for the same reason as `finiteOrNull`: an
  // unknown language must not take the rest of the body down with it.
  language: z
    .unknown()
    .optional()
    .transform((v) => ((LANGUAGES as readonly unknown[]).includes(v) ? (v as BriefLanguage) : 'ru')),
  holdingBaselineScore: finiteOrNull,
  holdingScenarioScore: finiteOrNull,
  worstHit: z.unknown().optional().transform((v) => (Array.isArray(v) ? v : [])),
  changed: counter,
  worsened: counter,
  improved: counter,
  driverReports: z.unknown().optional().transform((v) => (Array.isArray(v) ? v : [])),
})

export interface ParsedNarrativeBody {
  language: BriefLanguage
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  worstHit: CrisisBriefWorstHit[]
  changed: number
  worsened: number
  improved: number
  /** Regenerated on the server from `driverReports` — never taken as prose. */
  assumptionNote: string | null
}

/**
 * Parse a narrative request body into exactly what the prompt builder needs.
 *
 * Total by construction: a malformed field degrades to its empty/zero form
 * rather than rejecting the request. That is deliberate — this endpoint
 * decorates a simulation that already succeeded, and answering 400 because one
 * `topDeltas` entry was the wrong shape would lose a board narrative over a
 * cosmetic input. Anything actually dangerous is removed rather than refused.
 */
export function parseNarrativeBody(body: unknown): ParsedNarrativeBody {
  const parsed = narrativeBodySchema.safeParse(body)
  const b = parsed.success ? parsed.data : null

  const worstHit = (b?.worstHit ?? [])
    .slice(0, BRIEF_LIMITS.worstHitCompanies)
    .map((w) => worstHitSchema.safeParse(w))
    .flatMap((r) => (r.success ? [r.data] : []))
    .filter((w) => w.companyCode || w.companyName)

  const driverReports = (b?.driverReports ?? [])
    .slice(0, BRIEF_LIMITS.driverReports)
    .map((r) => driverReportSchema.safeParse(r))
    .flatMap((r) => (r.success ? [r.data] : []))

  return {
    language: b?.language ?? 'ru',
    holdingBaselineScore: b?.holdingBaselineScore ?? null,
    holdingScenarioScore: b?.holdingScenarioScore ?? null,
    worstHit,
    changed: b?.changed ?? 0,
    worsened: b?.worsened ?? 0,
    improved: b?.improved ?? 0,
    // Server-generated from structured input. The client has no way to put a
    // sentence of its own into the prompt here.
    assumptionNote: buildDriverNote(driverReports),
  }
}
