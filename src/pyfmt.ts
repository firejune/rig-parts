/**
 * The handful of Python numeric and text semantics the proposer's outputs
 * depend on, written once so no call site open-codes them.
 *
 * The reference proposer is Python, and three of its behaviours are not
 * JavaScript's:
 *
 * - `round(x)` rounds half to EVEN (`round(2.5) == 2`), where `Math.round`
 *   rounds half up. Every bone coordinate goes through it (`rnd`), and a part
 *   box of even width puts its centre on a half pixel, so this decides real
 *   coordinates, not an edge case.
 * - `format(x, '.nf')` rounds the exact binary value correctly and breaks an
 *   exact tie to even; `Number.prototype.toFixed` breaks it upward. The two
 *   agree everywhere except an exact tie, which `pyFixed` detects.
 * - `repr(str)` quotes with `'` unless the string holds a `'` and no `"`. The
 *   LINT line prints a mesh name through it, and its format is kept verbatim.
 *
 * numpy's `mean`, `median` and `percentile` are here too, with numpy's own
 * summation order and interpolation, so a summary line reads the same figure
 * the reference printed.
 */

/** Python's `round(x)` on a float: nearest integer, ties to even. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's `int(x)` on a float: truncation toward zero, with no negative zero. */
export function pyInt(x: number): number {
  const t = Math.trunc(x);
  return t === 0 ? 0 : t;
}

/**
 * Python's `format(x, '.<digits>f')`. `toFixed` is correctly rounded except on
 * an exact decimal tie, which it breaks upward and Python breaks to even. A
 * tie is recognised from `toFixed(digits + 20)`: a double near any value
 * printed here is spaced far wider than 1e-20, so digits past the tie are
 * either all zero (a true tie) or not a tie at all.
 */
export function pyFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return String(x);
  const long = Math.abs(x).toFixed(digits + 20);
  const tail = long.slice(long.length - 20);
  if (tail !== `5${'0'.repeat(19)}`) return x.toFixed(digits);
  // An exact tie: `head` is |x| truncated to `digits` places, and the tie goes to whichever neighbour is even.
  const head = long.slice(0, long.length - 20).replace(/\.$/, '');
  const last = Number(head.replace('.', '').slice(-1));
  const scale = 10 ** digits;
  const magnitude = last % 2 === 0 ? Number(head) : (Math.round(Number(head) * scale) + 1) / scale;
  return `${x < 0 ? '-' : ''}${magnitude.toFixed(digits)}`;
}

/** Python's `repr(s)` for the strings the proposer prints: part and bone names. */
export function pyRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else out += ch;
  }
  return `${quote}${out}${quote}`;
}

/** Python's `str(list_of_str)`: `['a', 'b']`. */
export function pyStrList(items: readonly string[]): string {
  return `[${items.map(pyRepr).join(', ')}]`;
}

/** Python's `str([int, int])`: `[335, 330]`. */
export function pyIntList(items: readonly number[]): string {
  return `[${items.map((n) => String(n)).join(', ')}]`;
}

/**
 * numpy's float64 `sum`: its pairwise summation, which for fewer than 8
 * values is a plain loop and up to 128 values is eight strided accumulators
 * combined as `((r0+r1)+(r2+r3))+((r4+r5)+(r6+r7))`, then the remainder.
 */
export function npSum(a: readonly number[]): number {
  const pairwise = (lo: number, n: number): number => {
    if (n < 8) {
      let s = 0;
      for (let i = 0; i < n; i++) s += a[lo + i];
      return s;
    }
    if (n <= 128) {
      const r = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => a[lo + k]);
      let i = 8;
      for (; i < n - (n % 8); i += 8) for (let k = 0; k < 8; k++) r[k] += a[lo + i + k];
      let s = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
      for (; i < n; i++) s += a[lo + i];
      return s;
    }
    let n2 = Math.floor(n / 2);
    n2 -= n2 % 8;
    return pairwise(lo, n2) + pairwise(lo + n2, n - n2);
  };
  return pairwise(0, a.length);
}

export function npMean(a: readonly number[]): number {
  return npSum(a) / a.length;
}

export function npMedian(a: readonly number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (n % 2 === 1) return s[(n - 1) / 2];
  // numpy takes the mean of the two middle values.
  return npMean([s[n / 2 - 1], s[n / 2]]);
}

/** `np.percentile(a, q)` with the default linear method, numpy's index and lerp arithmetic included. */
export function npPercentile(a: readonly number[], q: number): number {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  const quantile = q / 100;
  const virtual = n * quantile + (1 + quantile * (1 - 1 - 1)) - 1;
  const clampIndex = (i: number): number => Math.min(Math.max(i, 0), n - 1);
  const previous = Math.floor(virtual);
  const gamma = virtual - previous;
  const lo = s[clampIndex(previous)];
  const hi = s[clampIndex(previous + 1)];
  const diff = hi - lo;
  return gamma >= 0.5 ? hi - diff * (1 - gamma) : lo + diff * gamma;
}
