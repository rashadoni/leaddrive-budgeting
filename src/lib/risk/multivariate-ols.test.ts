// @vitest-environment node
/**
 * Phase 7.G Turn CV (Phase 7.E #3 v2 E.2c) — multivariate-ols tests.
 */

import { describe, it, expect } from "vitest"
import {
  fitMultivariateOLS,
  forecastMultivariate,
  invertMatrix,
} from "./multivariate-ols"

describe("invertMatrix — pure helper", () => {
  it("inverts a 2×2 symmetric positive-definite matrix", () => {
    const m = [
      [4, 1],
      [1, 3],
    ]
    const inv = invertMatrix(m)
    expect(inv).not.toBeNull()
    // det = 4*3 - 1*1 = 11; inv = (1/11) * [[3,-1],[-1,4]]
    expect(inv![0][0]).toBeCloseTo(3 / 11, 10)
    expect(inv![0][1]).toBeCloseTo(-1 / 11, 10)
    expect(inv![1][0]).toBeCloseTo(-1 / 11, 10)
    expect(inv![1][1]).toBeCloseTo(4 / 11, 10)
  })

  it("inverts a 3×3 matrix", () => {
    const m = [
      [2, 0, 0],
      [0, 3, 0],
      [0, 0, 5],
    ]
    const inv = invertMatrix(m)
    expect(inv).not.toBeNull()
    expect(inv![0][0]).toBeCloseTo(0.5, 10)
    expect(inv![1][1]).toBeCloseTo(1 / 3, 10)
    expect(inv![2][2]).toBeCloseTo(0.2, 10)
  })

  it("returns null for a singular matrix (zero column)", () => {
    expect(
      invertMatrix([
        [1, 0],
        [2, 0],
      ]),
    ).toBeNull()
  })

  it("returns null for a singular matrix (linearly dependent rows)", () => {
    expect(
      invertMatrix([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull()
  })

  it("M · M⁻¹ ≈ I (round-trip identity)", () => {
    const m = [
      [4, 2, 1],
      [2, 5, 3],
      [1, 3, 6],
    ]
    const inv = invertMatrix(m)
    expect(inv).not.toBeNull()
    // M·inv should approximate identity
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0
        for (let k = 0; k < 3; k++) sum += m[i][k] * inv![k][j]
        expect(sum).toBeCloseTo(i === j ? 1 : 0, 8)
      }
    }
  })
})

describe("fitMultivariateOLS — happy path", () => {
  it("recovers known coefficients on synthetic data (y = 2 + 3*x₁)", () => {
    // Pure linear, no noise: y = 2 + 3x for x = 0..9
    const y = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29]
    const x1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const fit = fitMultivariateOLS(y, [{ name: "x1", series: x1 }])
    expect(fit).not.toBeNull()
    expect(fit!.coefficients[0]).toBeCloseTo(2, 8) // intercept
    expect(fit!.coefficients[1]).toBeCloseTo(3, 8) // β₁
    expect(fit!.r2).toBeCloseTo(1, 8)
    expect(fit!.n).toBe(10)
    expect(fit!.k).toBe(1)
  })

  it("recovers two regressors (y = 1 + 2*x₁ + 0.5*x₂)", () => {
    // Linearly INDEPENDENT regressors — x2 is not a linear function of x1.
    const x1 = [0, 1, 2, 3, 4, 5, 6, 7]
    const x2 = [3, 7, 2, 9, 5, 1, 8, 4]
    const y = x1.map((a, i) => 1 + 2 * a + 0.5 * x2[i])
    const fit = fitMultivariateOLS(y, [
      { name: "x1", series: x1 },
      { name: "x2", series: x2 },
    ])
    expect(fit).not.toBeNull()
    expect(fit!.coefficients[0]).toBeCloseTo(1, 6) // intercept
    expect(fit!.coefficients[1]).toBeCloseTo(2, 6) // β_x1
    expect(fit!.coefficients[2]).toBeCloseTo(0.5, 6) // β_x2
    expect(fit!.r2).toBeCloseTo(1, 6)
    expect(fit!.k).toBe(2)
    expect(fit!.regressorNames).toEqual(["x1", "x2"])
  })

  it("matches univariate OLS coefficients on identical input", () => {
    // y has noise but consistent slope; compare against hand-computed slope
    const y = [3, 4.9, 7.2, 8.8, 11.1, 12.9]
    const x = [1, 2, 3, 4, 5, 6]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])
    expect(fit).not.toBeNull()
    // Slope ≈ 2.0; intercept ≈ 1
    expect(fit!.coefficients[1]).toBeCloseTo(2.0, 0)
    expect(fit!.coefficients[0]).toBeCloseTo(1.0, 0)
  })
})

describe("fitMultivariateOLS — null + non-finite handling", () => {
  it("drops rows where y is null", () => {
    const y: (number | null)[] = [1, null, 3, 4, 5, 6]
    const x = [1, 2, 3, 4, 5, 6]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])
    expect(fit).not.toBeNull()
    expect(fit!.n).toBe(5)
  })

  it("drops rows where ANY regressor is null", () => {
    // Linearly independent regressors after null filtering.
    const y = [1, 2, 3, 4, 5, 6, 7, 8]
    const x1: (number | null)[] = [1, null, 3, 4, 5, 6, 7, 8]
    const x2: (number | null)[] = [9, 7, 2, null, 5, 1, 8, 3]
    const fit = fitMultivariateOLS(y, [
      { name: "x1", series: x1 },
      { name: "x2", series: x2 },
    ])
    expect(fit).not.toBeNull()
    expect(fit!.n).toBe(6) // dropped indices 1 + 3
  })

  it("drops non-finite values (NaN, Infinity)", () => {
    const y = [1, 2, 3, 4, 5, 6, 7]
    const x = [1, NaN, 3, Infinity, 5, 6, 7]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])
    expect(fit).not.toBeNull()
    expect(fit!.n).toBe(5)
  })

  it("returns null when fewer than k+2 rows remain after filtering", () => {
    const y = [1, null, null, null]
    const x = [1, 2, 3, 4]
    // Only 1 usable row; need k+2 = 3
    expect(fitMultivariateOLS(y, [{ name: "x", series: x }])).toBeNull()
  })

  it("returns null when regressors length doesn't match y length", () => {
    expect(
      fitMultivariateOLS(
        [1, 2, 3],
        [{ name: "x", series: [1, 2] }],
      ),
    ).toBeNull()
  })

  it("returns null when zero regressors supplied", () => {
    expect(fitMultivariateOLS([1, 2, 3], [])).toBeNull()
  })
})

describe("fitMultivariateOLS — singular / collinear cases", () => {
  it("returns null on perfect multicollinearity (x₁ = 2·x₂)", () => {
    const y = [1, 2, 3, 4, 5, 6]
    const x1 = [1, 2, 3, 4, 5, 6]
    const x2 = [2, 4, 6, 8, 10, 12]
    expect(
      fitMultivariateOLS(y, [
        { name: "x1", series: x1 },
        { name: "x2", series: x2 },
      ]),
    ).toBeNull()
  })

  it("flat y (all identical values) → r²=NaN, no crash", () => {
    const y = [5, 5, 5, 5, 5, 5]
    const x = [1, 2, 3, 4, 5, 6]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])
    expect(fit).not.toBeNull()
    expect(fit!.r2).toBeNaN()
  })

  it("adjustedR² = NaN when ssTot = 0", () => {
    const y = [3, 3, 3, 3]
    const x = [1, 2, 3, 4]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])
    expect(fit).not.toBeNull()
    expect(fit!.adjustedR2).toBeNaN()
  })
})

describe("forecastMultivariate — prediction + CI", () => {
  it("predicts ŷ* on noiseless line (CI ≈ 0)", () => {
    const y = [2, 5, 8, 11, 14]
    const x = [0, 1, 2, 3, 4]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])!
    const fc = forecastMultivariate(fit, [5])!
    expect(fc.predicted).toBeCloseTo(17, 6)
    expect(fc.predictionInterval.marginOfError).toBeCloseTo(0, 5)
  })

  it("noisy fit → non-zero CI margin", () => {
    const y = [2, 4.5, 6.1, 8.3, 9.8, 12.2, 13.7, 15.9]
    const x = [1, 2, 3, 4, 5, 6, 7, 8]
    const fit = fitMultivariateOLS(y, [{ name: "x", series: x }])!
    const fc = forecastMultivariate(fit, [9])!
    expect(fc.predicted).toBeGreaterThan(15)
    expect(fc.predicted).toBeLessThan(20)
    expect(fc.predictionInterval.marginOfError).toBeGreaterThan(0)
    expect(fc.predictionInterval.lower).toBeLessThan(fc.predicted)
    expect(fc.predictionInterval.upper).toBeGreaterThan(fc.predicted)
  })

  it("multi-regressor forecast composes per-coefficient", () => {
    // y = 10 + x₁ + 2·x₂ — linearly INDEPENDENT regressors.
    const x1 = [0, 1, 2, 3, 4, 5]
    const x2 = [3, 8, 1, 6, 2, 7]
    const y = x1.map((a, i) => 10 + a + 2 * x2[i])
    const fit = fitMultivariateOLS(y, [
      { name: "x1", series: x1 },
      { name: "x2", series: x2 },
    ])!
    // Forecast at x₁=10, x₂=-5 → 10 + 10 + 2*(-5) = 10
    const fc = forecastMultivariate(fit, [10, -5])!
    expect(fc.predicted).toBeCloseTo(10, 6)
  })

  it("returns null when forecast input length ≠ k", () => {
    const fit = fitMultivariateOLS([1, 2, 3, 4], [{ name: "x", series: [1, 2, 3, 4] }])!
    expect(forecastMultivariate(fit, [])).toBeNull()
    expect(forecastMultivariate(fit, [1, 2])).toBeNull()
  })

  it("returns null when forecast value is non-finite", () => {
    const fit = fitMultivariateOLS([1, 2, 3, 4], [{ name: "x", series: [1, 2, 3, 4] }])!
    expect(forecastMultivariate(fit, [NaN])).toBeNull()
    expect(forecastMultivariate(fit, [Infinity])).toBeNull()
  })

  it("CI level is exactly 0.95", () => {
    const fit = fitMultivariateOLS([1, 2, 3, 4, 5], [{ name: "x", series: [1, 2, 3, 4, 5] }])!
    const fc = forecastMultivariate(fit, [6])!
    expect(fc.predictionInterval.level).toBe(0.95)
  })
})
