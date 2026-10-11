/**
 * The head's frame, read off the head run's parts (issue #250): the eye line
 * (the bar), and the line from the eye midpoint down through the nose and the
 * mouth (the stem) — the T construction of head-pose estimation from facial
 * landmarks.
 *
 * - **Roll** is the bar's angle. It has one derivation in this package,
 *   {@link eyeLineDegrees}: the line through the eye bones' origins as the
 *   config writes them, image-left to image-right, in Spine degrees through
 *   the one y flip. `propose` reads it on the origins it writes for `eye_r`
 *   and `eye_l`; the rig stage turns the five face bones to it and declares
 *   the `invariants.axes` entry rigc's A51 draws through those same two
 *   origins (`src/rig.ts`, {@link eyeLineDegrees} there too). A roll read
 *   anywhere else could disagree with the one the face bones stand on.
 * - **Turn** (yaw), three ways: the stem's skew off the bar's perpendicular
 *   (via the nose and via the mouth, each as a sideways and a downward
 *   fraction of the inter-eye distance), the two eyewhites' widths along the
 *   bar, and the face part's two halves along the bar about the eye
 *   midpoint. Never acted on, and not written by `propose`: on a face painted
 *   three-quarter the three readings did not agree in order
 *   (`FRONTAL_REFERENCE` in `src/propose.ts`), so they stay readings here.
 * - **Pitch** proportions: where the nose sits along eye midpoint -> mouth,
 *   and the stem's length (the mouth's downward fraction) against the bar.
 *
 * A drawn face does not carry a human face's ratios, so no figure here is
 * compared with a human model: the frontal reference is read off drawn
 * frontal faces (`FRONTAL_REFERENCE` in `src/propose.ts`, with its source).
 * Nothing is guessed: a feature with no part is named as missing, and its
 * figures are not written.
 *
 * Image coordinates throughout (crop px, y down), but for the roll, which is
 * Spine's (counter-clockwise, y up). Pure.
 */
import type { Point } from './config.ts';
import { cropToSpineY } from './coords.ts';
import type { Mask } from './raster/types.ts';

/**
 * The eye line's angle in Spine degrees (counter-clockwise, y up) through two
 * points in crop px on a canvas `H` px tall, read from the image-left point to
 * the image-right one, so it lies inside (−90°, 90°) and which point is which
 * eye does not enter it. The caller refuses two points in one column.
 */
export function eyeLineDegrees(a: Point, b: Point, H: number): number {
  const [l, r] = a[0] < b[0] ? [a, b] : [b, a];
  const dx = r[0] - l[0];
  const dy = cropToSpineY(r[1], H) - cropToSpineY(l[1], H);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** One stem reading: a feature's point off the eye midpoint, along the bar and down it, as fractions of the inter-eye distance. */
export interface StemReading {
  /** The feature's tag (`nose` or `mouth`). */
  feature: string;
  /** The part it was read off. */
  part: string;
  /** The point read: the centroid of the part's biggest 8-connected blob, as the mouth bone is placed. */
  at: [number, number];
  /** Along the bar, positive toward image right. */
  side: number;
  /** Down the face (the bar's perpendicular, toward the chin), positive down. */
  down: number;
  /** The stem's skew off the bar's perpendicular, degrees, positive toward image right: `atan2(side, down)`. */
  skew: number;
}

/** Two extents along the bar: a pair of widths, or the face's two halves about the eye midpoint. */
export interface BarPair {
  /** The parts read. */
  parts: string[];
  /** The image-left one, px along the bar. */
  left: number;
  /** The image-right one, px along the bar. */
  right: number;
  /** `left / right`: above 1 when the image-right side is the narrower. */
  ratio: number;
}

/** The head's frame (issue #250). */
export interface HeadFrame {
  /** The eye bones' origins the bar runs through, image-left first. */
  eyes: [Point, Point];
  /** The eye midpoint, crop px. */
  mid: [number, number];
  /** The inter-eye distance, px: the bar's length and the unit of every stem fraction. */
  bar: number;
  /** The bar's angle in Spine degrees ({@link eyeLineDegrees}). */
  roll: number;
  /** The stem via the nose, or why it is not read. */
  nose: StemReading | { missing: string };
  /** The stem via the mouth, or why it is not read. */
  mouth: StemReading | { missing: string };
  /** The two eyewhites' widths along the bar, or why they are not read. */
  eyeWidths: BarPair | { missing: string };
  /** The face part's two halves along the bar about the eye midpoint, or why they are not read. */
  faceHalves: BarPair | { missing: string };
  /** Where the nose sits along eye midpoint -> mouth: the nose's `down` over the mouth's; null without both. */
  noseAlongStem: number | null;
}

/** A feature handed to {@link headFrame}: its part's name and its point, or why there is none. */
export type FrameFeature = { part: string; at: [number, number] } | { missing: string };

/** A part's mask handed to {@link headFrame}: its name and its full-canvas mask, or why there is none. */
export type FrameMask = { part: string; mask: Mask } | { missing: string };

/** The extent of a mask's pixel centres projected on the unit direction `u` from `o`: [min, max], or null for an empty mask. */
function extentAlong(m: Mask, o: readonly [number, number], u: readonly [number, number]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x] === 0) continue;
      const s = (x + 0.5 - o[0]) * u[0] + (y + 0.5 - o[1]) * u[1];
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
  }
  return lo === Infinity ? null : [lo, hi];
}

/**
 * The head's frame on a canvas `H` px tall. `eyes` are the two eye bones'
 * origins (any order; read image-left first) and must not share a column —
 * the caller holds that. `eyewhites` are the two eyewhite masks with the eye
 * each belongs to's origin, so each is paired with its side by its origin.
 * A pixel's centre is `(x + 0.5, y + 0.5)`, as a box's centre is
 * `x + w / 2`; a stem point is taken as given.
 */
export function headFrame(
  eyes: [Point, Point],
  H: number,
  feats: { nose: FrameFeature; mouth: FrameFeature },
  eyewhites: Array<{ part: string; mask: Mask; eye: Point }>,
  face: FrameMask,
): HeadFrame {
  const [l, r] = eyes[0][0] < eyes[1][0] ? [eyes[0], eyes[1]] : [eyes[1], eyes[0]];
  const dx = r[0] - l[0];
  const dy = r[1] - l[1];
  const bar = Math.hypot(dx, dy);
  const u: [number, number] = [dx / bar, dy / bar];
  // The bar's perpendicular toward the chin: u turned a quarter clockwise as drawn (y down).
  const n: [number, number] = [-u[1], u[0]];
  const mid: [number, number] = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
  const stem = (feature: string, f: FrameFeature): StemReading | { missing: string } => {
    if ('missing' in f) return { missing: f.missing };
    const v = [f.at[0] - mid[0], f.at[1] - mid[1]];
    const side = (v[0] * u[0] + v[1] * u[1]) / bar;
    const down = (v[0] * n[0] + v[1] * n[1]) / bar;
    return { feature, part: f.part, at: f.at, side, down, skew: (Math.atan2(side, down) * 180) / Math.PI };
  };
  const nose = stem('nose', feats.nose);
  const mouth = stem('mouth', feats.mouth);
  let eyeWidths: BarPair | { missing: string };
  if (eyewhites.length < 2) eyeWidths = { missing: 'there are not two eyewhite parts' };
  else {
    const [wl, wr] = [l, r].map((e) => eyewhites.find((w) => w.eye[0] === e[0] && w.eye[1] === e[1]));
    const el = wl === undefined ? null : extentAlong(wl.mask, mid, u);
    const er = wr === undefined ? null : extentAlong(wr.mask, mid, u);
    if (wl === undefined || wr === undefined || el === null || er === null) eyeWidths = { missing: 'an eyewhite part has no opaque pixel' };
    else {
      const left = el[1] - el[0];
      const right = er[1] - er[0];
      eyeWidths = right > 0 ? { parts: [wl.part, wr.part], left, right, ratio: left / right } : { missing: `${wr.part} is one pixel column wide along the bar` };
    }
  }
  let faceHalves: BarPair | { missing: string };
  if ('missing' in face) faceHalves = { missing: face.missing };
  else {
    const e = extentAlong(face.mask, mid, u);
    if (e === null) faceHalves = { missing: `${face.part} has no opaque pixel` };
    else if (e[0] >= 0 || e[1] <= 0) faceHalves = { missing: `${face.part} lies on one side of the eye midpoint along the bar` };
    else faceHalves = { parts: [face.part], left: -e[0], right: e[1], ratio: -e[0] / e[1] };
  }
  const noseAlongStem = 'missing' in nose || 'missing' in mouth || mouth.down === 0 ? null : nose.down / mouth.down;
  return { eyes: [l, r], mid, bar, roll: eyeLineDegrees(l, r, H), nose, mouth, eyeWidths, faceHalves, noseAlongStem };
}
