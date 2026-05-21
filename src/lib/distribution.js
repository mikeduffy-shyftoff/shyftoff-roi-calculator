// Log-normal call-duration model.
//
// Real-world call durations follow a log-normal distribution to a good
// approximation — short floor at near-zero, long right tail for complex
// calls. We use this to model what happens to the residual mean AHT when
// AI removes the easy/short calls from the bottom of the distribution.
//
// The user inputs the MEAN AHT (e.g. 8 min) and the CV (coefficient of
// variation = σ/μ). At CV ≈ 0.6 the distribution matches typical voice
// contact-center data; CV closer to 0.5 = narrow spread, 0.8+ = very
// heterogeneous call mix.

// Standard normal CDF — Abramowitz & Stegun 26.2.17 approximation.
// Accurate to ~1e-7 across the full range.
export function normCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t *
        (-0.3565638 +
          t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Inverse standard normal CDF — Beasley-Springer-Moro.
// Accurate to ~1e-9.
export function normInverseCDF(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

// Log-normal parameters from desired mean and CV.
// If X ~ LogNormal(μ, σ²) then E[X] = exp(μ + σ²/2), Var(X)/E[X]² = exp(σ²) − 1,
// so CV² = exp(σ²) − 1 → σ² = ln(1 + CV²).
export function lognormalParams(mean, cv) {
  if (cv <= 0) return { mu: Math.log(mean), sigma: 0 };
  const sigmaSq = Math.log(1 + cv * cv);
  const sigma = Math.sqrt(sigmaSq);
  const mu = Math.log(mean) - sigmaSq / 2;
  return { mu, sigma };
}

// p-th percentile of the log-normal distribution.
export function lognormalPercentile(mean, cv, p) {
  if (cv <= 0) return mean;
  const { mu, sigma } = lognormalParams(mean, cv);
  return Math.exp(mu + sigma * normInverseCDF(p));
}

// Conditional mean of the UPPER (1 − cutoffPct) portion of the distribution.
// I.e., the mean of what remains after removing the bottom cutoffPct fraction.
// This is exactly what we want for the AI-residual AHT story: AI removes the
// easy/short calls (bottom of the distribution), and the residual human calls
// have a higher mean by this formula.
//
// Derivation: for log-normal X = exp(Y) with Y ~ N(μ, σ²):
//   E[X | X > k] = E[X] × Φ(σ − z) / (1 − Φ(z))
// where z = (ln(k) − μ) / σ. At cutoff p, k = exp(μ + σ × Φ⁻¹(p)), so z = Φ⁻¹(p)
// and the formula simplifies to:
//   E[X | X > k] = E[X] × Φ(σ − Φ⁻¹(p)) / (1 − p)
export function lognormalConditionalMean(mean, cv, cutoffPct) {
  if (cv <= 0 || cutoffPct <= 0) return mean;
  if (cutoffPct >= 0.999) return mean; // degenerate — nothing left
  const { sigma } = lognormalParams(mean, cv);
  const z = normInverseCDF(cutoffPct);
  const ratio = normCDF(sigma - z) / (1 - cutoffPct);
  return mean * ratio;
}
