/*
 * One-off sanity check for the SVI pricing module, mirroring
 * backtest/backtest.py Section 5.1's printed checks.
 * Run: pnpm dlx tsx web/scripts/svi-sanity.ts  (from repo root)
 */
import {
  binaryUpProbability,
  normalCdf,
  probabilityToOdds,
  type SviParams,
} from '../src/lib/svi';

// Flat surface: a = total variance, b = 0 → constant vol regardless of k.
// vol 50% annualized over 30 min: w = 0.5^2 * (30 / (365*24*60)) ≈ 1.4269e-5
const flat: SviParams = { a: 0.25 * (30 / (365 * 24 * 60)), b: 0, rho: 0, m: 0, sigma: 0 };

const checks: [string, number, number, number][] = [
  // [label, actual, expected, tolerance]
  ['normalCdf(0) = 0.5', normalCdf(0), 0.5, 1e-6],
  ['normalCdf(1.96) ≈ 0.975', normalCdf(1.96), 0.975, 1e-3],
  ['ATM 30-min binary ≈ 0.5', binaryUpProbability(70_000, 70_000, flat), 0.5, 0.01],
  ['OTM +1% 30-min ≈ 0 (deep OTM at this vol)', binaryUpProbability(70_000, 70_700, flat), 0.0, 0.01],
  ['ITM −1% 30-min ≈ 1', binaryUpProbability(70_000, 69_300, flat), 1.0, 0.01],
  ['odds at p=0.5 ≈ 1.98 (2x minus 1% fee)', probabilityToOdds(0.5), 1.98, 1e-9],
];

let failed = 0;
for (const [label, actual, expected, tol] of checks) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (got ${actual.toFixed(6)})`);
}
process.exit(failed ? 1 : 0);
