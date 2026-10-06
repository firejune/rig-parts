/**
 * Generated alpha masks for the contour mesh (`src/contour.ts`, issue #84):
 * flat blocks whose art, outline and interior points are computed by hand in
 * the comments, so a control's expected figure comes from here and not from a
 * run. Nothing about appearance is claimed from them.
 *
 * Every mask is part-image px, y down; art is alpha above 8 (`ART_ALPHA`)
 * unless a case says otherwise. The shared parameters are {@link BASE}:
 * tolerance 1 px, margin 1 px, background spacing 8 px — so the keep radius is
 * 4 px, and a block's outline is its own rectangle pushed out 1 px (a right
 * angle's mitre moves the corner by (±1, ±1)).
 */
import type { AlphaMask } from 'spine-rigc/src/mesh.ts';
import type { ContourParams } from '../src/contour.ts';

/** Rectangles `[x, y, w, h]` of one alpha over a `w`x`h` transparent image; a later block overwrites an earlier one. */
export function blocks(w: number, h: number, rects: ReadonlyArray<readonly [number, number, number, number, number?]>): AlphaMask {
  const alpha = new Uint8Array(w * h);
  for (const [x0, y0, bw, bh, a] of rects) for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) alpha[y * w + x] = a ?? 255;
  return { width: w, height: h, alpha };
}

/** The parameters every case below starts from. */
export const BASE: ContourParams = { threshold: 8, tolerance: 1, margin: 1, spacing: 8, regions: [] };

export interface ContourCase {
  name: string;
  mask: AlphaMask;
  params: ContourParams;
}

/**
 * CONVEX: a 24x16 block at (4, 4) in 32x24. Art 384 px. Outline (3,3) (29,3)
 * (29,21) (3,21), area 26 x 18 = 468 px², so 84 px² of it is transparent.
 * Interior: the spacing-8 grid points at least 4 px inside — x 8, 16, 24 (5,
 * 13, 21 px from x = 3; 21, 13, 5 from x = 29) and y 8, 16 (5 and 13 from
 * y = 3; 13 and 5 from y = 21): 6 points, so V = 10 and T = 2·10 − 4 − 2 =
 * 14. Overshoot: pixel (3, 3)'s centre is in the mesh and √2 from art pixel
 * (4, 4)'s, the furthest any covered pixel sits.
 */
export const CONVEX: ContourCase = { name: 'convex', mask: blocks(32, 24, [[4, 4, 24, 16]]), params: { ...BASE } };

/**
 * CONCAVE: a U — arms 8x24 at (4, 4) and (28, 4), a base 32x8 at (4, 20), in
 * 40x32; background spacing 6 (keep radius 3). Art 192 + 192 + 256 − 64 − 64
 * = 512 px. Outline (3,3) (13,3) (13,19) (27,19) (27,3) (37,3) (37,29) (3,29):
 * 8 vertices, area 34·26 − 14·16 = 660 px². Interior: x = 6 sits exactly 3 px
 * from x = 3, the keep radius, and is kept (the rule is ≥); x = 12 is 1 px from
 * x = 13 and is not. So (6, y) and (30, y) for y 6, 12, 18, 24, and (12, 24),
 * (18, 24), (24, 24) on the base: 11 points, V = 19, T = 2·19 − 8 − 2 = 28.
 * The notch is 14 px wide, wider than any triangle the points alone would
 * make, so a triangulation that ignored the outline would bridge it.
 */
export const CONCAVE: ContourCase = { name: 'concave', mask: blocks(40, 32, [[4, 4, 8, 24], [28, 4, 8, 24], [4, 20, 32, 8]]), params: { ...BASE, spacing: 6 } };

/**
 * SPIKE: a 30x16 base at (4, 20) and a spike 2 px wide, 18 tall, at (16, 2),
 * in 48x40. Art 480 + 36 = 516 px. Outline (15,1) (19,1) (19,19) (35,19)
 * (35,37) (3,37) (3,19) (15,19): area 32·18 + 4·18 = 648 px². The spike is
 * 4 px wide after the margin, under twice the keep radius, so it holds no
 * interior point; the base holds x 8, 16, 24 at y 24 and 32: 6 points, V = 14,
 * T = 18.
 */
export const SPIKE: ContourCase = { name: 'spike', mask: blocks(48, 40, [[4, 20, 30, 16], [16, 2, 2, 18]]), params: { ...BASE } };

/**
 * FEATHERED: a 16x16 core at alpha 255 inside a 2 px ring at alpha 100
 * (20x20 at (6, 6)) inside a 2 px ring at alpha 6 (24x24 at (4, 4)), in 32x32.
 * Above 8, the art is the 20x20 square, 400 px, outlined (5,5) (27,5) (27,27)
 * (5,27); above 100 it is the core, 256 px, outlined (7,7) (25,7) (25,25)
 * (7,25). The alpha-6 ring is never art.
 */
export const FEATHERED: ContourCase = { name: 'feathered', mask: blocks(32, 32, [[4, 4, 24, 24, 6], [6, 6, 20, 20, 100], [8, 8, 16, 16, 255]]), params: { ...BASE } };

/** The feathered case's core alone, above alpha 100. */
export const FEATHERED_CORE: ContourCase = { name: 'feathered-core', mask: FEATHERED.mask, params: { ...BASE, threshold: 100 } };

/**
 * HOLE: a 32x32 block at (4, 4) with a 12x12 hole at (14, 14), in 40x40. Art
 * 1024 − 144 = 880 px; the hole's 144 px are filled. Outline (3,3) (37,3)
 * (37,37) (3,37), area 34² = 1156 px², 276 px² of it transparent (the hole's
 * 144 and the margin's 132).
 */
export const HOLE: ContourCase = { name: 'hole', mask: blocks(40, 40, [[4, 4, 32, 32], [14, 14, 12, 12, 0]]), params: { ...BASE } };

/** ISLANDS: 10x10 at (2, 2) and 6x6 at (20, 2) in 40x20 — 100 px and 36 px, refused. */
export const ISLANDS: ContourCase = { name: 'islands', mask: blocks(40, 20, [[2, 2, 10, 10], [20, 2, 6, 6]]), params: { ...BASE } };

/** EMPTY: 10x10 with no pixel above alpha 8 (one at exactly 8, which is not art). */
export const EMPTY: ContourCase = { name: 'empty', mask: blocks(10, 10, [[4, 4, 1, 1, 8]]), params: { ...BASE } };

/**
 * PINCH: one 4-connected island whose outline touches itself at pixel corner
 * (4, 4): pixels (4, 3) and (3, 4) are art, (3, 3) and (4, 4) are not, and the
 * two arms join through the top row. rigc's tracer refuses it.
 *
 *     ......
 *     .####.
 *     .#..#.
 *     .#..#.   (the 2x2 pocket at (2, 2) is enclosed)
 *     .###..
 *     ......
 */
export const PINCH: ContourCase = {
  name: 'pinch',
  mask: blocks(6, 6, [[1, 1, 4, 1], [1, 2, 1, 2], [4, 2, 1, 2], [1, 4, 3, 1]]),
  params: { ...BASE },
};

/**
 * REGION: a 56x40 block at (4, 4) in 64x48, background spacing 12 (keep
 * radius 6), and one circle region at (40, 24), radius 8, spacing 3, band 4.
 * Outline (3,3) (61,3) (61,45) (3,45), the same with or without the region.
 * Background grid points inside the outline and 6 px from it: x 12, 24, 36, 48
 * and y 12, 24, 36 — 12 of them. The region's points reach 12 px from its
 * centre, so a background point further than 12 + 6 = 18 px from (40, 24)
 * cannot be within the keep radius of one: those are (12,12) (24,12) (12,24)
 * (12,36) (24,36), 30.5, 20, 28, 30.5 and 20 px out. Every other background
 * point lies within 16 px of the centre, inside the band's reach.
 */
export const REGION: ContourCase = {
  name: 'region',
  mask: blocks(64, 48, [[4, 4, 56, 40]]),
  params: { ...BASE, spacing: 12, regions: [{ name: 'soft', shape: 'circle', cx: 40, cy: 24, r: 8, spacing: 3, band: 4 }] },
};

/** The background points of {@link REGION} the region cannot reach, by hand. */
export const REGION_FAR_BACKGROUND: ReadonlyArray<readonly [number, number]> = [
  [12, 12],
  [24, 12],
  [12, 24],
  [12, 36],
  [24, 36],
];

/** FULL: a 10x8 image all art — its outline is the window, clamped, with no interior point at spacing 8. */
export const FULL: ContourCase = { name: 'full', mask: blocks(10, 8, [[0, 0, 10, 8]]), params: { ...BASE } };

/**
 * The cases that build, in order. The gate proof (selftest `CT27`) carries all
 * but FULL, whose PNG has no transparent texel — which spine-rigc's spine-html
 * profile refuses for the image (A19), whatever attachment draws it.
 */
export const BUILDING: readonly ContourCase[] = [CONVEX, CONCAVE, SPIKE, FEATHERED, HOLE, REGION, FULL];
