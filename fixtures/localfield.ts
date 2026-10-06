/**
 * The local-deformation fixture of issue #84's settled §4: one generated part —
 * a single connected shape with a soft region and a stable surround — bound to
 * two bones besides the region's control, and the poses of that control the
 * comparison is taken under. Every figure is stated here, before any mesh is
 * measured; nothing is chosen from a run.
 *
 * Frame: part-image px, y down, and the rig's frame is the same (the part sits
 * at the origin), so a region number is written once.
 *
 * - **Art**: an 80x48 block at (8, 8) in a 96x64 image, alpha 255 — 3840 px.
 * - **Segment bones**: `left`, origin (16, 32), segment to (48, 32); `right`,
 *   origin (48, 32), segment to (80, 32); `r` 8 (the weights' `w = 1/(d + r)²`).
 * - **The soft region**: a circle centred (64, 30), radius 8, band 8, its
 *   control bone `soft` with its origin at the centre. The support (region ∪
 *   band, radius 16) spans x 48..80, y 14..46 — inside the art on every side,
 *   so the surround is the art outside radius 16.
 * - **The lattice**: grid 8 — the reference mesh table 1 is held at.
 * - **The contour mode**: tolerance 1, margin 1 (issue #106: the block grows
 *   by the rows and columns beside it, not its corners, and Douglas–Peucker at
 *   tolerance 1 keeps four of the trace's twelve corners, (8, 7) (88, 7)
 *   (89, 56) (8, 57) — the cut corners lie 0.98 and 0.99 px and the left
 *   column's step exactly 1 px off the chords kept), background spacing 16 — twice the lattice's
 *   cell, so the surround is NOT denser than the lattice's — and the region
 *   refined at the smallest whole spacing from {@link REGION_SPACINGS} whose
 *   mesh has no more vertices than the lattice (the "at the lattice's vertex
 *   count" condition of table 1; the rule picks by vertex count, never by
 *   error).
 * - **The poses** of `soft` (the segment bones stay at their setup pose):
 *   a rotation of 20° about its origin, a translation of (4, −3) px, and a
 *   uniform scale of 1.25 about its origin (a local expansion). In the rig's y-up
 *   world a positive rotation is counter-clockwise; on the y-down image it is
 *   clockwise. The comparison applies each pose as an affine map of image px.
 */
import type { ContourRegionSpec, Point } from '../src/config.ts';
import type { Segment } from '../src/weights.ts';

export const FIELD_W = 96;
export const FIELD_H = 64;
/** `[x, y, w, h]` of the art block. */
export const FIELD_ART: readonly [number, number, number, number] = [8, 8, 80, 48];

export function fieldMask(): { width: number; height: number; alpha: Uint8Array } {
  const alpha = new Uint8Array(FIELD_W * FIELD_H);
  const [x0, y0, w, h] = FIELD_ART;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) alpha[y * FIELD_W + x] = 255;
  return { width: FIELD_W, height: FIELD_H, alpha };
}

export const FIELD_BONES: ReadonlyArray<{ name: string; at: Point }> = [
  { name: 'left', at: [16, 32] },
  { name: 'right', at: [48, 32] },
  { name: 'soft', at: [64, 30] },
];

export const FIELD_SEGMENTS: readonly Segment[] = [
  { bone: 'left', a: [16, 32], b: [48, 32] },
  { bone: 'right', a: [48, 32], b: [80, 32] },
];

export const FIELD_R = 8;

/** The region, with the spacing it is refined at left to {@link REGION_SPACINGS}. */
export function fieldRegion(spacing: number): ContourRegionSpec {
  return { name: 'soft', shape: 'circle', cx: 64, cy: 30, r: 8, spacing, band: 8, bone: 'soft' };
}

export const FIELD_LATTICE_GRID = 8;
export const FIELD_TOLERANCE = 1;
export const FIELD_MARGIN = 1;
export const FIELD_BACKGROUND = 2 * FIELD_LATTICE_GRID;
/** The region spacings tried, finest first; the first whose mesh fits the lattice's vertex count is the one compared. */
export const REGION_SPACINGS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

/** A pose of the control as an affine map of image px: `[a, b, c, d, tx, ty]`, p' = (a x + b y + tx, c x + d y + ty). */
export type Affine = [number, number, number, number, number, number];

export interface FieldPose {
  name: string;
  /** The rigc key that makes it, on `soft` (Spine units: degrees counter-clockwise, y up). */
  key: { property: 'rotate' | 'translate' | 'scale'; value: number[] };
  map: Affine;
}

function about(c: Point, a: number, b: number, cc: number, d: number): Affine {
  return [a, b, cc, d, c[0] - a * c[0] - b * c[1], c[1] - cc * c[0] - d * c[1]];
}

const DEG = 20;
const th = (DEG * Math.PI) / 180;
const SOFT: Point = [64, 30];

/**
 * The three declared poses. The rotation's image-px map: counter-clockwise in
 * y up is clockwise in y down, so x' = c + R(−θ)… written out: (x, y) ↦
 * (cos θ·dx + sin θ·dy, −sin θ·dx + cos θ·dy) + c with d = p − c.
 */
export const FIELD_POSES: readonly FieldPose[] = [
  { name: 'rotate 20°', key: { property: 'rotate', value: [DEG] }, map: about(SOFT, Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th)) },
  { name: 'translate (4, -3) px', key: { property: 'translate', value: [4, 3] }, map: [1, 0, 0, 1, 4, -3] },
  { name: 'scale 1.25', key: { property: 'scale', value: [1.25, 1.25] }, map: about(SOFT, 1.25, 0, 0, 1.25) },
];
