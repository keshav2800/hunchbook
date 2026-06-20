/*
 * Binary option pricing from the on-chain SVI vol surface.
 * Ported from backtest/backtest.py Section 5.1 (UP = N(d2)), adapted to
 * total variance: the indexer's SVI params describe total implied variance
 * w(k) at log-moneyness k = ln(K/F), so no separate vol/ttm inputs needed.
 * Pure functions, no I/O.
 */

export interface SviParams {
  a: number;
  b: number;
  rho: number; // signed, decoded
  m: number; // signed, decoded
  sigma: number;
}

/** u64 fields on the indexer are scaled by 1e9. */
export const PRICE_SCALE = 1e9;

export function decodeScaled(value: number, negative = false): number {
  return (negative ? -1 : 1) * (value / PRICE_SCALE);
}

/** Raw indexer latest_svi event → decoded params. */
export function decodeSvi(raw: {
  a: number;
  b: number;
  rho: number;
  rho_negative: boolean;
  m: number;
  m_negative: boolean;
  sigma: number;
}): SviParams {
  return {
    a: decodeScaled(raw.a),
    b: decodeScaled(raw.b),
    rho: decodeScaled(raw.rho, raw.rho_negative),
    m: decodeScaled(raw.m, raw.m_negative),
    sigma: decodeScaled(raw.sigma),
  };
}

/** SVI total implied variance: w(k) = a + b(ρ(k−m) + √((k−m)² + σ²)). */
export function sviTotalVariance(k: number, p: SviParams): number {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sigma * p.sigma));
}

/** Standard normal CDF via Abramowitz–Stegun 7.1.26 erf approximation. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** P(settlement > strike) for a cash-or-nothing UP binary. */
export function binaryUpProbability(forward: number, strike: number, svi: SviParams): number {
  if (forward <= 0 || strike <= 0) return 0.5;
  const k = Math.log(strike / forward);
  const w = Math.max(sviTotalVariance(k, svi), 1e-12);
  const d2 = (Math.log(forward / strike) - w / 2) / Math.sqrt(w);
  return normalCdf(d2);
}

/** P(lower < settlement ≤ upper). */
export function rangeProbability(
  forward: number,
  lower: number,
  upper: number,
  svi: SviParams,
): number {
  if (upper <= lower) return 0;
  return Math.max(
    binaryUpProbability(forward, lower, svi) - binaryUpProbability(forward, upper, svi),
    0,
  );
}

const FEE = 0.01; // router fee, FEE_BPS = 100

/** Probability → payout multiplier net of the 1% router fee. */
export function probabilityToOdds(p: number): number {
  if (p <= 0.001) return 0;
  return (1 / p) * (1 - FEE);
}

export function strikeForWinProbability(
  forward: number,
  direction: 'UP' | 'DOWN',
  targetWinProb: number,
  svi: SviParams,
  tickSize: number,
  minStrike: number,
): number {
  // P(win | UP) = P(settle > K); P(win | DOWN) = 1 − P(settle > K).
  const pUpTarget = direction === 'UP' ? targetWinProb : 1 - targetWinProb;
  let lo = forward * 0.5; // prob ≈ 1 (deep in the money)
  let hi = forward * 1.5; // prob ≈ 0 (far out of the money)
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    // prob too high → strike too low → search the upper half.
    if (binaryUpProbability(forward, mid, svi) > pUpTarget) lo = mid;
    else hi = mid;
  }
  const tick = tickSize || 1;
  const snapped = Math.round((lo + hi) / 2 / tick) * tick;
  return Math.max(snapped, minStrike);
}
