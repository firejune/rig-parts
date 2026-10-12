/**
 * Vertex weights by distance to bone SEGMENTS.
 *
 * Each mesh names its candidate segments in the config — a chain (every link,
 * origin to the next link, the last to the chain's tip), a single bone (origin
 * to its tip), or an explicit `[bone, [x0, y0], [x1, y1]]`. That list is the
 * one authored decision about a layer: which bones may pull it. The weights
 * then follow from the geometry and nothing else:
 *
 *     w = 1 / (d + r)^e          d = distance from the vertex to the segment
 *
 * per candidate, with `e` the mesh's declared `exponent` (issue #161) and 2 —
 * {@link DISTANCE_EXPONENT}, the rule as it always was — where none is
 * declared; a bone named by two segments keeps the larger; the top
 * {@link MAX_INFLUENCES} are kept, normalised, any below {@link MIN_WEIGHT}
 * dropped, the rest normalised again, rounded to 5 decimals, and the last
 * weight written as `1 - sum(others)` so every vertex sums to exactly 1 after
 * rounding. Ties in the sort keep the order the bones first appeared among the
 * segments (Python's `sorted` is stable, and so is `Array.prototype.sort`).
 *
 * The cap and the floor's form are the author's per mesh in the lattice and
 * contour modes (issue #284, `meshes.<part>.influences`): a declared
 * `maxInfluences` (a whole number, or `null`: no cap) replaces the 4, and
 * `floor: "continuous"` replaces the drop at 0.03 by the continuous floor
 * ({@link FloorForm}). Absent, both are the constants above, and every byte is
 * the one written before the field existed.
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

/**
 * At most this many bones pull one vertex where a mesh declares no cap: the reference implementation's `[:4]`,
 * carried over as a port constant, and nothing more. The format sets no limit — spine-core 4.3.13 reads a weighted
 * vertex as a bone count followed by that many bindings, with no bound on the count (`SkeletonJson.js`,
 * `SkeletonBinary.js`, and `computeWorldVertices` in `attachments/Attachment.js`) — and rig-c 2.40.0 neither refuses
 * nor warns above four: its one assertion on a mesh's weights, `A20_MESH_WEIGHTS_COHERENT`, checks that they are
 * coherent (every vertex bound, every weight finite and non-negative, each vertex summing to 1), not how many there
 * are. Read and cited in `docs/evidence/weight-cap.md` (issue #284, Stage E). A mesh may declare its own cap
 * (`meshes.<part>.influences.maxInfluences`).
 */
export const MAX_INFLUENCES = 4;

/**
 * A normalised weight under this is dropped before the final normalisation — the reference's `>= 0.03`. Under the
 * continuous floor ({@link FloorForm}) it is subtracted from every kept share instead.
 */
export const MIN_WEIGHT = 0.03;

/**
 * The floor's form (issue #284): `"cut"` — the reference's, and what an absent form means: the capped shares,
 * normalised, any under the floor dropped, the rest normalised again — or `"continuous"`: the capped shares,
 * normalised, the floor subtracted from every one, those at or below zero dropped, the rest normalised again. Under
 * the continuous floor a share reaches zero exactly where the cut would drop it, so a bone fades out of a vertex
 * instead of leaving it in one step; this is Stage A's "continuous floor" (`tools/tear_survey.ts`), the form Stage E
 * swept at every cap (`docs/evidence/weight-cap.md`).
 */
export type FloorForm = 'cut' | 'continuous';

export const FLOOR_FORMS: readonly FloorForm[] = ['cut', 'continuous'];

/**
 * The exponent of the distance rule where a mesh declares none: `1/(d + r)²`,
 * the reference's rule. At this value the weight is computed as
 * `(d + r) * (d + r)`, the reference's operations, and never through
 * `Math.pow`, which the language does not promise to round as one multiply
 * does — so a mesh that declares nothing, or declares 2, writes the bytes it
 * always wrote.
 */
export const DISTANCE_EXPONENT = 2;

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
 * mode run at {@link DEFAULT_LIMITS} (the reference's `[:4]` and `>= 0.03`)
 * unless the mesh declares `influences` (issue #284; {@link meshLimits}); the
 * automatic mode (`src/automesh.ts`, issue #126) passes the author's numbers
 * instead, because rig-c's reduction is handed explicit influence limits on
 * every weighted call and the 0.03 floor is not one the author wrote (P19).
 * The arithmetic is the same either way, so with the defaults every byte the
 * two older modes write is unchanged.
 */
export interface InfluenceLimits {
  maxInfluences: number;
  minWeight: number;
  /** The floor's form; absent is `"cut"`, the arithmetic as it always was. */
  floor?: FloorForm;
}

export const DEFAULT_LIMITS: InfluenceLimits = { maxInfluences: MAX_INFLUENCES, minWeight: MIN_WEIGHT };

/** `meshes.<part>.influences` in the lattice and contour modes (issue #284): either field may be absent. */
export interface MeshInfluences {
  /** A whole number, 1 or more, or `null`, no cap — every bone the mesh's segments name is kept (the config's spelling of a bound declared absent, as `maxOvershoot` and `weightJump`). Absent: {@link MAX_INFLUENCES}. */
  maxInfluences?: number | null;
  /** Absent: `"cut"`. */
  floor?: FloorForm;
}

/**
 * The limits a lattice or contour mesh runs at: {@link DEFAULT_LIMITS} itself when it declares no `influences`, so
 * nothing about such a mesh changes; otherwise its declared cap (`null` is a count no vertex reaches) and floor form,
 * with the floor's value {@link MIN_WEIGHT} either way — the declaration chooses the form of the cut, not where it falls.
 */
export function meshLimits(declared: MeshInfluences | undefined): InfluenceLimits {
  if (declared === undefined) return DEFAULT_LIMITS;
  const cap = declared.maxInfluences;
  return { maxInfluences: cap === undefined ? MAX_INFLUENCES : cap === null ? Number.MAX_SAFE_INTEGER : cap, minWeight: MIN_WEIGHT, floor: declared.floor ?? 'cut' };
}

/**
 * The influences on one vertex at `p` (rig pixels), before rounding, under
 * `w = 1/(d + r)^exponent`. The rig stage passes every mesh's exponent
 * explicitly; the default is for readers of today's rule (the tools, the
 * selftest's older controls).
 */
export function influences(p: Point, segments: readonly Segment[], r: number, limits: InfluenceLimits = DEFAULT_LIMITS, exponent: number = DISTANCE_EXPONENT): Influence[] {
  const agg = new Map<string, number>();
  for (const s of segments) {
    const d = segmentDistance(p, s.a, s.b);
    // 2 is the reference's multiply, bit for bit (DISTANCE_EXPONENT); any other declared exponent is Math.pow.
    const w = 1.0 / (exponent === DISTANCE_EXPONENT ? (d + r) * (d + r) : Math.pow(d + r, exponent));
    const was = agg.get(s.bone);
    agg.set(s.bone, was === undefined ? w : Math.max(was, w));
  }
  return capAndFloor([...agg.entries()], limits);
}

/**
 * The cap and the floor, on raw per-bone values in first-appearance order: sorted (stable), the top
 * `maxInfluences` normalised, then the floor in its form ({@link FloorForm}) — under `"cut"` those under `minWeight`
 * dropped, under `"continuous"` `minWeight` subtracted from each and those at or below zero dropped — and the rest
 * normalised again. The distance rule above and bone heat (`src/heat.ts`, issue #161) both end here, so the two
 * rules share one cap and one floor.
 */
export function capAndFloor(raw: ReadonlyArray<readonly [string, number]>, limits: InfluenceLimits): Influence[] {
  const top = [...raw].sort((x, y) => y[1] - x[1]).slice(0, limits.maxInfluences);
  let s = 0;
  for (const [, v] of top) s += v;
  const kept =
    limits.floor === 'continuous'
      ? top.map(([bone, v]) => ({ bone, weight: v / s - limits.minWeight })).filter((e) => e.weight > 0)
      : top.map(([bone, v]) => ({ bone, weight: v / s })).filter((e) => e.weight >= limits.minWeight);
  let s2 = 0;
  for (const e of kept) s2 += e.weight;
  return kept.map((e) => ({ bone: e.bone, weight: e.weight / s2 }));
}
