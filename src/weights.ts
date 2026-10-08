/**
 * Vertex weights by distance to bone SEGMENTS.
 *
 * Each mesh names its candidate segments in the config — a chain (every link,
 * origin to the next link, the last to the chain's tip), a single bone (origin
 * to its tip), or an explicit `[bone, [x0, y0], [x1, y1]]`. That list is the
 * one authored decision about a layer: which bones may pull it. The weights
 * then follow from the geometry and nothing else:
 *
 *     w = 1 / (d + r)^2          d = distance from the vertex to the segment
 *
 * per candidate; a bone named by two segments keeps the larger; the top
 * {@link MAX_INFLUENCES} are kept, normalised, any below {@link MIN_WEIGHT}
 * dropped, the rest normalised again, rounded to 5 decimals, and the last
 * weight written as `1 - sum(others)` so every vertex sums to exactly 1 after
 * rounding. Ties in the sort keep the order the bones first appeared among the
 * segments (Python's `sorted` is stable, and so is `Array.prototype.sort`).
 *
 * Distances are the reference's arithmetic, operation for operation — the
 * projection `t = clip(((p - a) . ab) / |ab|^2, 0, 1)` and `sqrt(dx^2 + dy^2)`,
 * not `Math.hypot`, whose last bit differs — because a weight rounded at the
 * fifth decimal is where a one-ulp difference becomes a visible one.
 *
 * ⛔ **No invented segment.** The reference gave a single bone with no tip and
 * no chain child the segment `(x, y) -> (x, y + 1)`: one pixel, straight down,
 * a direction nothing in the config says. Here that is `RIG_SEGMENT_DEFINED`,
 * naming the bone and the two fields that would define it. A chain link whose
 * next point is its own origin is refused the same way (`RIG_CHAIN_POINTS`).
 */
import type { Point } from './config.ts';

/** At most this many bones pull one vertex — Spine's usual budget and the reference's `[:4]`. */
export const MAX_INFLUENCES = 4;

/** A normalised weight under this is dropped before the final normalisation — the reference's `>= 0.03`. */
export const MIN_WEIGHT = 0.03;

export interface Segment {
  bone: string;
  a: Point;
  b: Point;
}

/** Distance from `p` to the segment `a -> b`; a zero-length segment is its point. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 0) {
    t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const dx = p[0] - (a[0] + t * abx);
  const dy = p[1] - (a[1] + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

export interface Influence {
  bone: string;
  /** Unrounded, normalised over the kept influences. */
  weight: number;
}

/**
 * The cap and the floor `influences()` applies. The lattice and the contour
 * mode always run at {@link DEFAULT_LIMITS} (the reference's `[:4]` and
 * `>= 0.03`); the automatic mode (`src/automesh.ts`, issue #126) passes the
 * author's numbers instead, because rig-c's reduction is handed explicit
 * influence limits on every weighted call and the 0.03 floor is not one the
 * author wrote (P19). The arithmetic is the same either way, so with the
 * defaults every byte the two older modes write is unchanged.
 */
export interface InfluenceLimits {
  maxInfluences: number;
  minWeight: number;
}

export const DEFAULT_LIMITS: InfluenceLimits = { maxInfluences: MAX_INFLUENCES, minWeight: MIN_WEIGHT };

/** The influences on one vertex at `p` (rig pixels), before rounding. */
export function influences(p: Point, segments: readonly Segment[], r: number, limits: InfluenceLimits = DEFAULT_LIMITS): Influence[] {
  const agg = new Map<string, number>();
  for (const s of segments) {
    const d = segmentDistance(p, s.a, s.b);
    const w = 1.0 / ((d + r) * (d + r));
    const was = agg.get(s.bone);
    agg.set(s.bone, was === undefined ? w : Math.max(was, w));
  }
  const top = [...agg.entries()].sort((x, y) => y[1] - x[1]).slice(0, limits.maxInfluences);
  let s = 0;
  for (const [, v] of top) s += v;
  const kept = top.map(([bone, v]) => ({ bone, weight: v / s })).filter((e) => e.weight >= limits.minWeight);
  let s2 = 0;
  for (const e of kept) s2 += e.weight;
  return kept.map((e) => ({ bone: e.bone, weight: e.weight / s2 }));
}
