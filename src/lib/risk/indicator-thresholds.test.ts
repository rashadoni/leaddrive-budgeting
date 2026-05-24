/**
 * Boundary-value coverage for every indicator's threshold bands.
 *
 * Why this exists: the green/amber/red bands in `indicator-seeds.ts` are
 * the load-bearing values that drive the matrix colors users see. A stray
 * `>` instead of `>=` flips a "just-on-target" company from green to
 * amber, and there's no production telemetry that catches the off-by-one.
 *
 * **Source-of-truth**: imports `ALL_INDICATOR_SEEDS` directly. No more
 * dual-of-truth hand-typed catalog (the round-1 review caught
 * HOSP_SOURCE_HHI / HOSP_FX_EXPOSURE drift in the prior approach). Any
 * seed change → boundary suite re-derives automatically.
 *
 * Per-indicator overrides live in `BAND_EXTRAS` for indicators with
 * non-symmetric red bands (band-direction with one-sided red): the
 * generator can't infer the correct expectation outside the green range
 * without those declarations.
 */

import { describe, it, expect } from "vitest"
import {
  classifyValue,
  validateThresholds,
  type Direction,
  type IndicatorStatus,
  type ThresholdBand,
  type Thresholds,
} from "./formula-engine"
import { ALL_INDICATOR_SEEDS, type IndicatorSeed } from "./indicator-seeds"

// Epsilon = 0.001 is below the smallest threshold value used in the
// catalog (1.6 for POULTRY_FCR) yet large enough to escape FP noise.
const EPS = 0.001

interface BoundaryCase {
  value: number
  expected: IndicatorStatus
  note: string
}

/**
 * Hand-written extras for band-direction indicators that have
 * asymmetric / one-sided red bands. Generator can't infer these without
 * a declared expectation table.
 */
const BAND_EXTRAS: Record<string, BoundaryCase[]> = {
  EDU_STUDENT_TEACHER_RATIO: [
    // amber band [6, 25]; classifier walks green → amber → red.
    // Above 25 → red. Below 6 → unknown (intentional seed limitation).
    { value: 6, expected: "amber", note: "amber low edge" },
    { value: 25, expected: "amber", note: "amber high edge (still in band)" },
    { value: 26, expected: "red", note: "above amber → red branch" },
    {
      value: 5.999,
      expected: "unknown",
      note: "below amber band, no red catch (seed-documented)",
    },
  ],
  POULTRY_FEED_COST_SHARE: [
    { value: 50, expected: "amber", note: "amber low edge" },
    { value: 78, expected: "amber", note: "amber high edge" },
    {
      value: 49,
      expected: "unknown",
      note: "below amber band, no red catch (seed-documented)",
    },
    { value: 79, expected: "red", note: "above amber → red branch" },
  ],
}

function isInclusive(op: ThresholdBand["op"]): boolean {
  return op === ">=" || op === "<="
}

/**
 * Walk the indicator's thresholds + direction and emit boundary cases at
 * `threshold` and `threshold ± EPS`. For inclusive ops (`>=` / `<=`) the
 * threshold value lands on the inclusive side; for strict ops (`>` / `<`)
 * it lands on the exclusive side.
 */
function generateBoundaryCases(seed: IndicatorSeed): BoundaryCase[] {
  const t = seed.thresholds as Thresholds
  const cases: BoundaryCase[] = []

  if (seed.direction === "higher_better") {
    if (t.green.op === ">=" || t.green.op === ">") {
      const G = t.green.value
      const inclusive = isInclusive(t.green.op)
      cases.push({ value: G + EPS, expected: "green", note: `just above green ${G}` })
      cases.push({
        value: G,
        expected: inclusive ? "green" : "amber",
        note: `at green threshold ${G} (op=${t.green.op})`,
      })
      cases.push({
        value: G - EPS,
        expected: "amber",
        note: `just below green ${G}`,
      })
    }
    if (t.amber.op === ">=" || t.amber.op === ">") {
      const A = t.amber.value
      const inclusive = isInclusive(t.amber.op)
      cases.push({
        value: A,
        expected: inclusive ? "amber" : "red",
        note: `at amber threshold ${A} (op=${t.amber.op})`,
      })
      cases.push({ value: A - EPS, expected: "red", note: `just below amber ${A}` })
    }
  } else if (seed.direction === "lower_better") {
    if (t.green.op === "<=" || t.green.op === "<") {
      const G = t.green.value
      const inclusive = isInclusive(t.green.op)
      cases.push({ value: G - EPS, expected: "green", note: `just below green ${G}` })
      cases.push({
        value: G,
        expected: inclusive ? "green" : "amber",
        note: `at green threshold ${G} (op=${t.green.op})`,
      })
      cases.push({ value: G + EPS, expected: "amber", note: `just above green ${G}` })
    }
    if (t.amber.op === "<=" || t.amber.op === "<") {
      const A = t.amber.value
      const inclusive = isInclusive(t.amber.op)
      cases.push({
        value: A,
        expected: inclusive ? "amber" : "red",
        note: `at amber threshold ${A} (op=${t.amber.op})`,
      })
      cases.push({ value: A + EPS, expected: "red", note: `just above amber ${A}` })
    }
  } else {
    // band — green is `between`. Test the green band's interior + edges;
    // out-of-band cases come from BAND_EXTRAS.
    if (t.green.op === "between") {
      const [lo, hi] = t.green.value
      cases.push({ value: lo, expected: "green", note: `at green low ${lo}` })
      cases.push({ value: hi, expected: "green", note: `at green high ${hi}` })
      cases.push({ value: (lo + hi) / 2, expected: "green", note: `mid green` })
    }
  }
  return cases
}

// --- Tests -------------------------------------------------------------------

describe("indicator thresholds — seed validity", () => {
  for (const seed of ALL_INDICATOR_SEEDS) {
    it(`${seed.code}: thresholds pass validateThresholds(${seed.direction})`, () => {
      const result = validateThresholds(
        seed.thresholds as Thresholds,
        seed.direction as Direction,
      )
      expect(result, `validation failed for ${seed.code}`).toMatchObject({
        ok: true,
      })
    })
  }
})

describe("indicator thresholds — boundary classification (auto-generated)", () => {
  for (const seed of ALL_INDICATOR_SEEDS) {
    const cases = generateBoundaryCases(seed)
    if (cases.length === 0) continue
    describe(seed.code, () => {
      for (const tc of cases) {
        it(`value=${tc.value} → ${tc.expected} (${tc.note})`, () => {
          expect(
            classifyValue(tc.value, seed.thresholds as Thresholds),
          ).toBe(tc.expected)
        })
      }
    })
  }
})

describe("indicator thresholds — band-direction extras (hand-declared)", () => {
  for (const seed of ALL_INDICATOR_SEEDS) {
    const extras = BAND_EXTRAS[seed.code]
    if (!extras) continue
    describe(seed.code, () => {
      for (const tc of extras) {
        it(`value=${tc.value} → ${tc.expected} (${tc.note})`, () => {
          expect(
            classifyValue(tc.value, seed.thresholds as Thresholds),
          ).toBe(tc.expected)
        })
      }
    })
  }
})

describe("indicator thresholds — catalog completeness", () => {
  it("107 active indicator seeds (102 base + Phase 7.N legal: LEGAL_CASES_ACTIVE, LEGAL_CASES_TOTAL + Phase 7.O audit: AUDIT_CLOSED_PCT, AUDIT_MAJOR_OPEN + Phase 7.O EBITDA: IND_EBITDA_MARGIN)", () => {
    expect(ALL_INDICATOR_SEEDS).toHaveLength(107)
  })

  it("every indicator has a unique code", () => {
    const codes = new Set(ALL_INDICATOR_SEEDS.map((c) => c.code))
    expect(codes.size).toBe(ALL_INDICATOR_SEEDS.length)
  })

  it("every BAND_EXTRAS key resolves to an active indicator", () => {
    const codes = new Set(ALL_INDICATOR_SEEDS.map((c) => c.code))
    for (const code of Object.keys(BAND_EXTRAS)) {
      expect(codes, `BAND_EXTRAS["${code}"] has no matching seed`).toContain(
        code,
      )
    }
  })

  // ─── Phase 7.I cane-seller trio (2026-05-16) ────────────────────────
  // The 3 cane-grower-specific indicators each encode a non-obvious threshold
  // tied to AzerSheker's business model (cut-to-mill, buyer concentration,
  // harvest progress). Lock the threshold values and direction so a future
  // edit can't quietly widen/tighten the band without a test signal.
  describe("Phase 7.I cane-seller seeds", () => {
    const byCode = Object.fromEntries(
      ALL_INDICATOR_SEEDS.map((s) => [s.code, s]),
    )

    it("AGRO_CUT_TO_MILL is lower-is-better, green ≤24h / amber ≤48h", () => {
      const seed = byCode["AGRO_CUT_TO_MILL"]
      expect(seed).toBeTruthy()
      expect(seed.direction).toBe("lower_better")
      expect(seed.thresholds.green).toEqual({ op: "<=", value: 24 })
      expect(seed.thresholds.amber).toEqual({ op: "<=", value: 48 })
      expect(seed.industries).toEqual(["agro_crops"])
    })

    it("AGRO_BUYER_CONCENTRATION is lower-is-better, green ≤40% / amber ≤70%", () => {
      const seed = byCode["AGRO_BUYER_CONCENTRATION"]
      expect(seed).toBeTruthy()
      expect(seed.direction).toBe("lower_better")
      expect(seed.thresholds.green).toEqual({ op: "<=", value: 40 })
      expect(seed.thresholds.amber).toEqual({ op: "<=", value: 70 })
      expect(seed.unit).toBe("%")
    })

    it("AGRO_HARVEST_PROGRESS is higher-is-better, green ≥95% / amber ≥70%", () => {
      const seed = byCode["AGRO_HARVEST_PROGRESS"]
      expect(seed).toBeTruthy()
      expect(seed.direction).toBe("higher_better")
      expect(seed.thresholds.green).toEqual({ op: ">=", value: 95 })
      expect(seed.thresholds.amber).toEqual({ op: ">=", value: 70 })
      expect(seed.unit).toBe("%")
    })

    it("all three cane-seller seeds source from disclosed operationalFact inputs", () => {
      for (const code of [
        "AGRO_CUT_TO_MILL",
        "AGRO_BUYER_CONCENTRATION",
        "AGRO_HARVEST_PROGRESS",
      ]) {
        const seed = byCode[code]
        expect(seed.defaultValueSource).toBe("disclosed")
        expect(seed.requiredInputs?.[0]).toMatch(/^operationalFact:/)
      }
    })
  })
})
