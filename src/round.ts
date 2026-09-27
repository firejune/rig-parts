/**
 * Rounding the way the reference implementation rounds.
 *
 * The rig stage writes every coordinate, weight, uv and key value rounded to a
 * fixed number of decimals, and the reference did that with Python's
 * `round(x, n)` and NumPy's `np.round` — both of which round the EXACT binary
 * value of `x` to the nearest n-decimal number and break an exact tie to the
 * even digit. JavaScript has no such call: `Math.round` breaks ties upward,
 * and `Number.prototype.toFixed` rounds the exact value correctly but breaks an
 * exact tie away from zero. So this file is `toFixed` plus the one case where
 * the two disagree.
 *
 * ⭐ The case is not hypothetical. A uv is `x / w` rounded to 6 decimals, and
 * for `x = 1, w = 128` that is exactly 0.0078125 — a tie at the sixth decimal,
 * which Python writes as 0.007812 and a naive port as 0.007813. Ties happen
 * exactly when `x` is a dyadic rational whose lowest set bit is 2^-(n+1): then
 * `x * 2 * 10^n` is an odd integer (`5^n` and the odd mantissa stay odd), and
 * for no other double.
 */

/** The exponent of the lowest set bit of a finite non-zero double: `x = m * 2^e` with `m` an odd integer. */
function lowestBitExponent(x: number): number {
  let y = Math.abs(x);
  let e = 0;
  // Doubling and halving a double are exact while it stays normal, and a
  // finite double becomes an integer after at most 1074 doublings.
  while (!Number.isInteger(y)) {
    y *= 2;
    e--;
  }
  while (y % 2 === 0) {
    y /= 2;
    e++;
  }
  return e;
}

/** `round(x, n)` as Python 3 computes it for a float: correctly rounded, exact ties to even. */
export function pyRound(x: number, n: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  if (Math.abs(x) >= 1e21) return x;
  const fixed = x.toFixed(n);
  if (lowestBitExponent(x) !== -(n + 1)) return Number(fixed);
  // An exact tie: toFixed went away from zero. Keep it when that digit is even,
  // otherwise step one unit back toward zero.
  const negative = fixed.startsWith('-');
  const digits = fixed.replace('-', '').replace('.', '');
  const last = Number(digits[digits.length - 1]);
  if (last % 2 === 0) return Number(fixed);
  const down = (BigInt(digits) - 1n).toString().padStart(n + 1, '0');
  const text = n === 0 ? down : `${down.slice(0, down.length - n)}.${down.slice(down.length - n)}`;
  return Number(`${negative ? '-' : ''}${text}`);
}

/** `np.rint` / `round(np.float64)`: to the nearest integer, exact halves to even. */
export function rint(x: number): number {
  const f = Math.floor(x);
  const frac = x - f;
  if (frac < 0.5) return f;
  if (frac > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
