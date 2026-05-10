/**
 * Phase 7.G Turn CV (Phase 7.E #3 v2 E.2c) — multi-variate OLS regression.
 *
 * Pure module: fits y = β₀ + β₁·x₁ + ... + βₖ·xₖ via the normal equations
 * `β = (XᵀX)⁻¹ Xᵀy`. Designed to extend the univariate `forecast.ts` family
 * with macro-driver overlays — e.g. forecast `REV_GROWTH` from its sparkline
 * PLUS `AZN_USD` FX and `AZ_CPI_YOY` series.
 *
 * **Why a separate module:** keeps the existing `forecast.ts` (univariate
 * fast path used by every IV forecast) untouched. This module is opt-in;
 * the caller (E.2c wire — separate turn) decides which indicators benefit
 * from macro overlay via `INDICATOR_MACRO_DRIVERS` mapping.
 *
 * **Numerical strategy (small problems):** Gauss-Jordan elimination with
 * partial pivoting on the augmented `[XᵀX | I]` matrix. With ≤4 regressors
 * (typical: sparkline + 1-3 macro series) the matrix is at most 5×5 — well
 * within the regime where direct inversion is stable + readable. For larger
 * problems QR or SVD would be preferred, but we don't need them here.
 *
 * **Failure modes:**
 *   - <(k+2) usable rows after null filtering → returns null (under-determined)
 *   - Singular `XᵀX` (perfect multicollinearity) → returns null with reason
 *   - Any non-finite value in regressors AT THE FORECAST POINT → forecast
 *     returns null (caller falls back to univariate)
 */

export interface RegressorSeries {
  /** Stable name for forensics (audit metadata, error messages). */
  name: string
  /** Same length as the dependent variable. Nulls + non-finite values
   *  drop the row from the fit. */
  series: ReadonlyArray<number | null>
}

export interface MultivariateFit {
  /** β₀, β₁, ..., βₖ — intercept first, then per-regressor slopes (in the
   *  same order as `regressors`). */
  coefficients: number[]
  /** Names of the regressors aligned to coefficients[1..k]. */
  regressorNames: string[]
  /** Number of usable observations after null filtering. */
  n: number
  /** Number of regressors (k) — does NOT include intercept. */
  k: number
  /** Residual sum of squares. */
  ssRes: number
  /** Total sum of squares Σ(yᵢ - ȳ)². */
  ssTot: number
  /** Coefficient of determination, 0..1. NaN when ssTot=0 (flat y). */
  r2: number
  /** Adjusted R² — penalizes additional regressors. NaN when df ≤ 0. */
  adjustedR2: number
  /** Residual standard error √(SSE / (n - k - 1)). */
  residualStdError: number
  /** Inverse of XᵀX (preserved for prediction-interval computation). */
  xtxInverse: number[][]
  /** Mean of y (used by some downstream stats). */
  meanY: number
}

export interface MultivariateForecastResult {
  /** Predicted ŷ* at the supplied future regressor values. */
  predicted: number
  /** 95% prediction interval. */
  predictionInterval: {
    lower: number
    upper: number
    marginOfError: number
    standardError: number
    degreesOfFreedom: number
    level: 0.95
  }
}

/** Critical t-values for α=0.025 (95% two-sided PI), df=1..30 — clamped to
 *  1.96 above. Mirrors the table in forecast.ts so identical confidence
 *  semantics across univariate + multivariate fits. */
const T_CRIT_95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
  6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
  11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
  16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
  26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
}

function tCritical95(df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY
  if (df <= 30) return T_CRIT_95[df]
  return 1.96
}

/** Multiply two matrices A (m×n) × B (n×p) → (m×p). */
function matMul(a: number[][], b: number[][]): number[][] {
  const m = a.length
  const n = a[0].length
  const p = b[0].length
  const out: number[][] = []
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(p).fill(0)
    for (let j = 0; j < p; j++) {
      let s = 0
      for (let kk = 0; kk < n; kk++) {
        s += a[i][kk] * b[kk][j]
      }
      row[j] = s
    }
    out.push(row)
  }
  return out
}

/** Transpose a matrix. */
function transpose(m: number[][]): number[][] {
  const rows = m.length
  const cols = m[0].length
  const out: number[][] = []
  for (let j = 0; j < cols; j++) {
    const row = new Array<number>(rows).fill(0)
    for (let i = 0; i < rows; i++) row[i] = m[i][j]
    out.push(row)
  }
  return out
}

/** Multiply a (m×n) matrix by a column vector (n) → m-vector. */
function matVecMul(a: number[][], v: number[]): number[] {
  const m = a.length
  const n = a[0].length
  const out = new Array<number>(m).fill(0)
  for (let i = 0; i < m; i++) {
    let s = 0
    for (let j = 0; j < n; j++) s += a[i][j] * v[j]
    out[i] = s
  }
  return out
}

/**
 * Invert a square symmetric matrix via Gauss-Jordan with partial pivoting.
 * Returns null when the matrix is singular (e.g. perfect multicollinearity
 * among regressors).
 */
export function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length
  if (n === 0 || m[0].length !== n) return null

  // Build augmented [m | I]
  const aug: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(2 * n).fill(0)
    for (let j = 0; j < n; j++) row[j] = m[i][j]
    row[n + i] = 1
    aug.push(row)
  }

  // Forward elimination with partial pivoting
  for (let i = 0; i < n; i++) {
    // Find pivot row (largest absolute value in column i, rows ≥ i)
    let pivotRow = i
    let pivotAbs = Math.abs(aug[i][i])
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(aug[r][i])
      if (v > pivotAbs) {
        pivotAbs = v
        pivotRow = r
      }
    }
    if (pivotAbs < 1e-12) return null // singular
    if (pivotRow !== i) {
      const tmp = aug[i]
      aug[i] = aug[pivotRow]
      aug[pivotRow] = tmp
    }
    // Normalize row i
    const pivot = aug[i][i]
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot
    // Eliminate column i from all other rows
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const factor = aug[r][i]
      if (factor === 0) continue
      for (let j = 0; j < 2 * n; j++) {
        aug[r][j] -= factor * aug[i][j]
      }
    }
  }

  // Extract inverse from right half
  const inv: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0)
    for (let j = 0; j < n; j++) row[j] = aug[i][n + j]
    inv.push(row)
  }
  return inv
}

/**
 * Fit a multivariate OLS regression. Returns null if:
 *  - <(k+2) usable observations after null filtering (under-determined)
 *  - XᵀX is singular (perfect multicollinearity)
 *
 * `regressors` length = k. Each regressor's `series` MUST have the same
 * length as `y`. Rows where ANY series has a null/non-finite value are
 * dropped uniformly across all series.
 */
export function fitMultivariateOLS(
  y: ReadonlyArray<number | null>,
  regressors: ReadonlyArray<RegressorSeries>,
): MultivariateFit | null {
  const k = regressors.length
  if (k === 0) return null

  // Validate equal lengths
  for (const r of regressors) {
    if (r.series.length !== y.length) return null
  }

  // Filter rows where y AND every regressor are finite numbers
  const yClean: number[] = []
  const xCleanRows: number[][] = [] // each row = [1, x₁, x₂, ..., xₖ]
  for (let i = 0; i < y.length; i++) {
    const yv = y[i]
    if (yv === null || !Number.isFinite(yv)) continue
    const row: number[] = [1]
    let allFinite = true
    for (const r of regressors) {
      const xv = r.series[i]
      if (xv === null || !Number.isFinite(xv)) {
        allFinite = false
        break
      }
      row.push(xv)
    }
    if (!allFinite) continue
    yClean.push(yv)
    xCleanRows.push(row)
  }

  const n = yClean.length
  // Need at least k+2 observations (k+1 parameters + 1 df for residual stats)
  if (n < k + 2) return null

  const X = xCleanRows
  const Xt = transpose(X)
  const XtX = matMul(Xt, X) // (k+1) × (k+1)
  const XtY = matVecMul(Xt, yClean)

  const XtXInv = invertMatrix(XtX)
  if (!XtXInv) return null

  // β = (XᵀX)⁻¹ Xᵀy
  const beta = matVecMul(XtXInv, XtY)

  // Compute predictions, residuals, SSE, SSTot
  const yHat = matVecMul(X, beta)
  let ssRes = 0
  let meanY = 0
  for (const v of yClean) meanY += v
  meanY /= n
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const e = yClean[i] - yHat[i]
    ssRes += e * e
    const d = yClean[i] - meanY
    ssTot += d * d
  }
  const r2 = ssTot === 0 ? Number.NaN : 1 - ssRes / ssTot
  const df = n - (k + 1)
  const adjustedR2 = df <= 0 || ssTot === 0 ? Number.NaN : 1 - (1 - r2) * ((n - 1) / df)
  const residualStdError = df > 0 ? Math.sqrt(ssRes / df) : 0

  return {
    coefficients: beta,
    regressorNames: regressors.map((r) => r.name),
    n,
    k,
    ssRes,
    ssTot,
    r2,
    adjustedR2,
    residualStdError,
    xtxInverse: XtXInv,
    meanY,
  }
}

/**
 * Forecast at supplied future regressor values. `futureRegressorValues`
 * length must equal `fit.k`. Returns null if any value is non-finite.
 *
 * Prediction interval formula:
 *   ŷ* ± t_{df, 0.025} · σ · √(1 + x*ᵀ (XᵀX)⁻¹ x*)
 *
 * The leading "1" makes this a PREDICTION interval (uncertainty about a
 * single future observation), NOT a confidence interval (uncertainty about
 * the regression line itself). Mirrors `forecast.ts` semantic.
 */
export function forecastMultivariate(
  fit: MultivariateFit,
  futureRegressorValues: ReadonlyArray<number>,
): MultivariateForecastResult | null {
  if (futureRegressorValues.length !== fit.k) return null
  for (const v of futureRegressorValues) {
    if (!Number.isFinite(v)) return null
  }
  const xStar = [1, ...futureRegressorValues]
  // ŷ* = β · xStar
  let predicted = 0
  for (let i = 0; i < xStar.length; i++) predicted += fit.coefficients[i] * xStar[i]

  // Variance of prediction = σ² · (1 + xStarᵀ · (XᵀX)⁻¹ · xStar)
  // Compute xStarᵀ · (XᵀX)⁻¹ · xStar
  let leverage = 0
  for (let i = 0; i < xStar.length; i++) {
    let row = 0
    for (let j = 0; j < xStar.length; j++) {
      row += fit.xtxInverse[i][j] * xStar[j]
    }
    leverage += xStar[i] * row
  }
  const df = fit.n - (fit.k + 1)
  const variance = fit.residualStdError * fit.residualStdError * (1 + leverage)
  const standardError = Math.sqrt(Math.max(0, variance))
  const tCrit = tCritical95(df)
  const margin = tCrit * standardError

  return {
    predicted,
    predictionInterval: {
      lower: predicted - margin,
      upper: predicted + margin,
      marginOfError: margin,
      standardError,
      degreesOfFreedom: df,
      level: 0.95,
    },
  }
}
