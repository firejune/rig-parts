/**
 * Limbs cut at their joints (issue #349): the geometry `assemble` cuts a
 * declared limb's layer by, and the cap each lower segment carries past its
 * joint. Pure arithmetic on rig pixels (y down, origin top-left, the space of
 * `parts.json` and of `config.bones`); no clock, no randomness.
 *
 * - **Where a bone is.** A single bone sits at its `at` and ends at its `tip`
 *   (no tip: no end); a chain's link `k` sits at `points[k]` and ends at
 *   `points[k + 1]`, the last link at `tip` ({@link bonePlaces}).
 * - **Which limb a pixel belongs to.** Every pixel of a part a limb takes
 *   goes to one limb: the one whose polyline — its segments' bone origins in
 *   order, then the last bone's end when it has one — passes nearest the
 *   pixel's centre, by squared Euclidean distance to the polyline's pieces; a
 *   tie goes to the limb `config.limbs` declares first ({@link nearestLimb}).
 *   Two legs in one `legwear` layer are split this way, with no polygon.
 * - **The joint line.** The joint between segments `k − 1` and `k` is the
 *   origin of segment `k`'s bone. Its line runs through that point,
 *   perpendicular to the limb's axis there: the sum of the unit directions of
 *   the upper bone (its origin to the joint) and the lower bone (the joint to
 *   its end, when it has one; the upper's alone when it has none) — on a
 *   straight limb the plain perpendicular, on a bent one the bisector
 *   ({@link jointLine}). A pixel is past the line when its centre's dot
 *   product with the axis, from the joint, is above 0; a centre on the line
 *   stays on the upper side.
 * - **Which segment a pixel belongs to.** Among the consecutive segments of a
 *   limb that take one part, a pixel starts on the first and moves down one
 *   segment for each joint line it is past, in order, stopping at the first it
 *   is not past ({@link segmentOf}). A segment whose part is not the previous
 *   segment's takes its limb's share of its own part whole: no line is cut
 *   between two layers (the shin's legwear and the foot's footwear).
 * - **The limb's width at a joint.** The pixels of the limb's art (alpha above
 *   8, both segments' parts) whose centre lies within half a pixel of the
 *   joint line, read along the line: the run of them through the joint — the
 *   pixel nearest the joint must lie within 1 px of it, and the run grows while
 *   neighbours along the line are at most 1.5 px apart (a diagonal line's
 *   centres are up to sqrt(2) apart) — from its first to its last, plus one
 *   pixel ({@link limbWidth}). The cap's radius is half of it.
 * - **The cap.** The pixels whose centre lies within the radius of the joint
 *   and on the upper side of its line, inside the box
 *   {@link capBox} prints: the overlap the lower segment carries so a bend
 *   shows no gap. The tool invents none of them: each is the config's cap
 *   image's where that image is not transparent, else the layer's where the
 *   limb has art there, else missing — counted, and named in the limb line.
 * - **`cap_shape: "disc"`** (issue #360, items 10 and 12; opt-in on the
 *   segment below the joint). The radius is the limb's half-width about the
 *   joint, not half its width: the distance from the joint to the nearer end
 *   of the same run along the joint line, each end half a pixel past its
 *   centre ({@link halfWidthAbout}) — so the disc lies on the limb's art
 *   across the line however far off the run's middle the bone sits. The cap
 *   takes, after the image's and the layer's, the upper segment's art at a
 *   pixel the lower's layer has none of: the whole half-disc comes from the
 *   art. The upper piece's corner at the cut is kept where it is: on a joint
 *   off the limb's middle, a corner trimmed to the disc leaves a notch at
 *   rest when nothing takes it, or a stub out of the bent lower piece's
 *   outline when the lower takes it (issue #360, unit B's sheets).
 * - **`edge: "feather"`** (issue #360, item 9; opt-in on the segment below the
 *   joint). The overlap band is the disc about the joint that the lower
 *   piece covers at every turn ({@link coveredRadius}: the cap's disc, less
 *   any pixel the cap is missing and a bilinear sample's reach). Inside it,
 *   on the upper side of the line, the upper piece's alpha is scaled by
 *   {@link featherWeight}: 0 on the line, 1 on the band's arc. The band fades
 *   out across its width over art that stays opaque under it at any angle,
 *   so at rest the two pieces composite to what they did and a bend never
 *   shows through it what lies behind the limb.
 */
import type { BoneEntry, Limb } from './config.ts';

export type Pt = [number, number];

/** A bone's origin and, when it has one, its end, in rig px. */
export interface BonePlace {
  at: Pt;
  end: Pt | null;
}

/** Where every bone `bones` declares sits and ends (module comment). */
export function bonePlaces(bones: readonly BoneEntry[]): Map<string, BonePlace> {
  const out = new Map<string, BonePlace>();
  for (const b of bones) {
    if ('chain' in b) {
      b.points.forEach((p, k) => out.set(`${b.chain}${k}`, { at: [p[0], p[1]], end: k + 1 < b.points.length ? [b.points[k + 1][0], b.points[k + 1][1]] : [b.tip[0], b.tip[1]] }));
    } else out.set(b.name, { at: [b.at[0], b.at[1]], end: b.tip === undefined ? null : [b.tip[0], b.tip[1]] });
  }
  return out;
}

/** A limb's polyline: its segments' bone origins in order, then the last bone's end when it has one. */
export function limbPolyline(limb: Limb, places: ReadonlyMap<string, BonePlace>): Pt[] {
  const pts = limb.segments.map((s) => (places.get(s.bone) as BonePlace).at);
  const last = places.get(limb.segments[limb.segments.length - 1].bone) as BonePlace;
  return last.end === null ? pts : [...pts, last.end];
}

/** The squared distance from `(x, y)` to the polyline `pts` (one point: to that point). */
export function polylineDist2(pts: readonly Pt[], x: number, y: number): number {
  if (pts.length === 1) return (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
    if (d < best) best = d;
  }
  return best;
}

/** The index, among `lines`, of the polyline nearest the pixel `(px, py)`'s centre; the first wins a tie. */
export function nearestLimb(lines: ReadonlyArray<readonly Pt[]>, px: number, py: number): number {
  let best = 0;
  let bestD = Infinity;
  lines.forEach((l, i) => {
    const d = polylineDist2(l, px + 0.5, py + 0.5);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** A joint's line: through `at`, perpendicular to the unit `axis` (pointing from the upper segment to the lower). */
export interface JointLine {
  at: Pt;
  axis: Pt;
}

/** The unit vector along `(x, y)`, or null when it has no length. */
function unit(x: number, y: number): Pt | null {
  const l = Math.sqrt(x * x + y * y);
  return l === 0 ? null : [x / l, y / l];
}

/**
 * The joint line between a bone whose origin is `upper` and one whose origin
 * is `at` and whose end is `end` (null: none) — module comment. Null when no
 * axis exists: the upper bone has no length, or the limb folds straight back
 * on itself.
 */
export function jointLine(upper: Pt, at: Pt, end: Pt | null): JointLine | null {
  const u = unit(at[0] - upper[0], at[1] - upper[1]);
  if (u === null) return null;
  const w = end === null ? null : unit(end[0] - at[0], end[1] - at[1]);
  const a = w === null ? u : unit(u[0] + w[0], u[1] + w[1]);
  return a === null ? null : { at, axis: a };
}

/** Whether the pixel `(px, py)`'s centre lies past the line (on the lower segment's side); on the line is not past. */
export function pastJoint(line: JointLine, px: number, py: number): boolean {
  return (px + 0.5 - line.at[0]) * line.axis[0] + (py + 0.5 - line.at[1]) * line.axis[1] > 0;
}

/**
 * The segment, among `first .. last` (consecutive segments taking one part),
 * a pixel belongs to: `first`, moved down one for each joint line in order it
 * is past, stopping at the first it is not. `lines[k]` is the line above
 * segment `k`.
 */
export function segmentOf(lines: ReadonlyArray<JointLine | null>, first: number, last: number, px: number, py: number): number {
  let k = first;
  while (k < last && pastJoint(lines[k + 1] as JointLine, px, py)) k++;
  return k;
}

/**
 * The limb's run of art along a joint line (module comment): the offsets
 * along the line, from the joint, of the first and the last pixel centre of
 * the run through the joint, `[first, last]` with `first <= last`. Null when
 * no pixel of the run lies within 1 px of the joint.
 */
export function limbRun(line: JointLine, art: (x: number, y: number) => boolean, box: readonly [number, number, number, number]): [number, number] | null {
  const [ax, ay] = line.axis;
  const ts: number[] = [];
  for (let y = box[1]; y <= box[3]; y++) {
    for (let x = box[0]; x <= box[2]; x++) {
      const dx = x + 0.5 - line.at[0];
      const dy = y + 0.5 - line.at[1];
      if (Math.abs(dx * ax + dy * ay) > 0.5 || !art(x, y)) continue;
      ts.push(-dx * ay + dy * ax);
    }
  }
  if (ts.length === 0) return null;
  ts.sort((a, b) => a - b);
  let near = 0;
  ts.forEach((t, i) => {
    if (Math.abs(t) < Math.abs(ts[near])) near = i;
  });
  if (Math.abs(ts[near]) > 1) return null;
  let lo = near;
  let hi = near;
  while (lo > 0 && ts[lo] - ts[lo - 1] <= 1.5) lo--;
  while (hi + 1 < ts.length && ts[hi + 1] - ts[hi] <= 1.5) hi++;
  return [ts[lo], ts[hi]];
}

/** The limb's width at a joint (module comment): its run's first to last pixel centre, plus one pixel. Null with no run. */
export function limbWidth(line: JointLine, art: (x: number, y: number) => boolean, box: readonly [number, number, number, number]): number | null {
  const r = limbRun(line, art, box);
  return r === null ? null : r[1] - r[0] + 1;
}

/**
 * The limb's half-width about the joint (issue #360, `cap_shape: "disc"`): the
 * distance from the joint to the nearer end of its run, each end half a pixel
 * past its centre — `min(last + 0.5, 0.5 - first)`. Half the width when the
 * joint sits in the middle of the run; less when it sits off it. Zero or below
 * when the joint sits on the run's edge.
 */
export function halfWidthAbout(run: readonly [number, number]): number {
  return Math.min(run[1] + 0.5, 0.5 - run[0]);
}

/** Where a pixel's centre lies from a joint: `along` the axis (above 0 past the line), and `across` it (the run's offset). */
export function jointOffsets(line: JointLine, px: number, py: number): { along: number; across: number } {
  const dx = px + 0.5 - line.at[0];
  const dy = py + 0.5 - line.at[1];
  return { along: dx * line.axis[0] + dy * line.axis[1], across: -dx * line.axis[1] + dy * line.axis[0] };
}

/**
 * The radius the feathered edge fades over (issue #360, `edge: "feather"`):
 * the disc about the joint the lower piece covers at every turn. It is the
 * distance from the joint to the nearest pixel centre the lower piece does not
 * hold at alpha 255 (`opaque` false; searched out to `radius` + 2), less
 * sqrt(2), the farthest a bilinear sample reaches to its four texels — so a
 * pixel within it, turned by any angle about the joint, still samples only
 * the lower's opaque art — and at most `radius`. Zero or below: no pixel is
 * covered at every turn, and nothing is feathered.
 */
export function coveredRadius(at: Pt, radius: number, opaque: (x: number, y: number) => boolean): number {
  const [x0, y0, w, h] = capBox(at, radius + 2);
  let near = radius + 2;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (opaque(x, y)) continue;
      const d = Math.sqrt((x + 0.5 - at[0]) ** 2 + (y + 0.5 - at[1]) ** 2);
      if (d < near) near = d;
    }
  }
  return Math.min(radius, near - Math.SQRT2);
}

/**
 * The feathered edge's weight on the upper piece (issue #360, `edge:
 * "feather"`) at a pixel inside the joint's disc on the upper side of its line:
 * its distance above the line over the disc's height there,
 * `-along / sqrt(radius² - across²)` — 0 on the line, 1 on the disc's arc, so
 * the overlap band fades out across its width. 1 where the disc has no height.
 */
export function featherWeight(radius: number, along: number, across: number): number {
  const h2 = radius * radius - across * across;
  if (h2 <= 0) return 1;
  return Math.max(0, Math.min(1, -along / Math.sqrt(h2)));
}

/** The box `[x, y, w, h]` (rig px) of the pixels whose centre lies within `radius` of `at`: the cap image's size and place. */
export function capBox(at: Pt, radius: number): [number, number, number, number] {
  const x0 = Math.ceil(at[0] - radius - 0.5);
  const y0 = Math.ceil(at[1] - radius - 0.5);
  const x1 = Math.floor(at[0] + radius - 0.5);
  const y1 = Math.floor(at[1] + radius - 0.5);
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Whether the pixel `(px, py)`'s centre lies within `radius` of `at`. */
export function inDisc(at: Pt, radius: number, px: number, py: number): boolean {
  return (px + 0.5 - at[0]) ** 2 + (py + 0.5 - at[1]) ** 2 <= radius * radius;
}
