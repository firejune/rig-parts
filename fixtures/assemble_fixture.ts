/**
 * The assemble stage's generated fixture: a painting and two See-through runs
 * made of flat rectangles, placed so that every resample is exact and every
 * figure in `parts.json` can be computed by hand. Nothing here is art.
 *
 * ## Why every number below is exact
 *
 * The painting is 128x128, `seethrough.resolution` 64 and `rig_scale` 0.5, so
 * the rig is 64x64 and:
 *
 * - the FULL run maps run pixel (x, y) to rig pixel (x, y): `k = (128 / 64) *
 *   0.5 = 1`, no pad (the painting is square), and cv2's bicubic at an integer
 *   position has the weights (0, 1, 0, 0) — the warp is the identity;
 * - the HEAD run, cropped from source box [32, 0, 96, 64], maps run (x, y) to
 *   rig (x / 2 + 16, y / 2): `k = (64 / 64) * 0.5 = 0.5`, so `warpAffine`
 *   samples run pixel (2X - 32, 2Y) with a zero fraction — every rig pixel is
 *   one run pixel, and a run rectangle [x0, x1) maps to [x0 / 2 + 16, x1 / 2 + 16);
 * - the painting is ONE colour `C` everywhere (flat fixture), and a Lanczos
 *   resample of a constant image is that constant: its 22-bit weights sum to
 *   within a few units of 2^22, far inside the rounding.
 *
 * Every layer is opaque `C` or opaque `Z`. `C` agrees with the painting, so
 * projection takes it; `Z` differs by 210 in a channel, over the drift limit
 * (90), so projection refuses it and the seam override (limit 60) recolours it.
 *
 * ## The expected parts.json, derived
 *
 * Rig-space rectangles are [x0, x1) x [y0, y1). A 5x5 erosion of a rectangle
 * away from the image edge removes 2 pixels on each side.
 *
 * - `hair_back` (head:back hair, run [44, 60) x [20, 64) -> rig [38, 46) x [10, 32)):
 *   core = [40, 44) x [12, 30) = 4 x 18 = 72; the head window is
 *   [16 + 3, 48 - 3) x [0 + 3, 32 - 3) = [19, 45) x [3, 29), so taken = 4 x 17 = 68.
 *   Below the crop line (row 32 - 4 = 28), the full run's back hair
 *   [38, 44) x [22, 44) has one component, seeded because the head part has
 *   alpha 255 on row 26 in columns 38..45: sel = [38, 44) x [28, 44) = 96 px.
 *   The rim: the 3x3 dilation of sel is [37, 45) x [27, 45) = 144 px, of which
 *   the part is already opaque on [38, 45) x [27, 32) (35 px) and on
 *   [38, 44) x [32, 44) (72 px), leaving 37; no later part reaches that box
 *   (bottomwear starts at column 48).
 *   merged = 96 + 37 = 133. The part is the head hair (176) + sel below row 32
 *   (72) + the rim (37) = 285 opaque px, box x 37..45, y 10..44 -> 37,10 9x35.
 * - `topwear` (full, [10, 30) x [20, 50), `C`): 600 px, core 16 x 26 = 416, all taken.
 * - `bottomwear` (full, [48, 62) x [30, 54), `Z`): 336 px, core 10 x 20 = 200,
 *   all refused, none taken; every one of its 336 pixels is top-most, opaque and
 *   210 off a painting whose min channel is 40, so seam_override_px = 336.
 * - `shoes` (full:footwear, [10, 30) x [54, 60) plus a 2x2 speck): 120 px after
 *   the speck (4 px, under the 40-px floor) is removed as a ghost; core 16 x 2 = 32.
 * - `face` (head, run [0, 24) x [16, 40) -> rig [16, 28) x [8, 20)): 144 px,
 *   core [18, 26) x [10, 18) = 64, of which the head window (from column 19)
 *   keeps 7 x 8 = 56 as taken.
 * - ghost_px: full:neck 9 (a lone 3x3 speck), full:footwear 4, every other layer 0.
 *
 * ## The silhouette fixture
 *
 * `framedPainting`: white, with a `C` block over source [16, 96)^2 holding a
 * white hole over [40, 72)^2 — rig block [8, 48)^2, hole [20, 36)^2 — and a
 * thin `C` line over source [104, 108) x [16, 96), two rig pixels wide.
 *
 * - A rig pixel's Lanczos support at a 2x reduction is 6 source pixels either
 *   side of its centre 2X + 1, so rig pixels 23..32 of the hole are exactly
 *   white. A navy full-run `topwear` over rig [24, 32)^2 (64 px) sits on that
 *   white: the reference's near-white rule leaves all 64 alone, the silhouette
 *   rule (the hole is enclosed by the block, so it is figure) recolours all 64
 *   white, and the recomposite's error px (> 40) drop by exactly 64.
 * - The line is under 5 rig pixels wide however the resample spreads it, so
 *   the silhouette's two 3x3 erosions remove it: it is painted (not
 *   near-white) but OUTSIDE the silhouette. A `Z` full-run `bottomwear` over
 *   it is recoloured by the near-white rule wherever the line is painted, and
 *   the silhouette rule must recolour at least those — it widens the
 *   reference's rule, it does not replace it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export type RGB = [number, number, number];

export const C: RGB = [100, 60, 40];
export const Z: RGB = [250, 250, 250];
export const NAVY: RGB = [20, 20, 60];
export const WHITE: RGB = [255, 255, 255];

/** A rectangle [x0, x1) x [y0, y1) of one opaque colour. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  colour: RGB;
}

export interface RunLayerSpec {
  name: string;
  depth: number;
  rects: Rect[];
}

export const SOURCE_SIDE = 128;
export const RESOLUTION = 64;
export const RIG_SCALE = 0.5;
export const HEAD_BOX: [number, number, number, number] = [32, 0, 96, 64];

const rect = (x0: number, y0: number, x1: number, y1: number, colour: RGB): Rect => ({ x0, y0, x1, y1, colour });

export const FULL_LAYERS: RunLayerSpec[] = [
  { name: 'headwear', depth: 0.95, rects: [rect(4, 2, 20, 14, C)] },
  { name: 'back hair', depth: 0.9, rects: [rect(38, 22, 44, 44, C)] },
  { name: 'bottomwear', depth: 0.6, rects: [rect(48, 30, 62, 54, Z)] },
  { name: 'topwear', depth: 0.5, rects: [rect(10, 20, 30, 50, C)] },
  { name: 'footwear', depth: 0.4, rects: [rect(10, 54, 30, 60, C), rect(60, 60, 62, 62, C)] },
  { name: 'neck', depth: 0.3, rects: [rect(2, 2, 5, 5, C)] },
];

export const HEAD_LAYERS: RunLayerSpec[] = [
  { name: 'back hair', depth: 0.9, rects: [rect(44, 20, 60, 64, C)] },
  { name: 'face', depth: 0.5, rects: [rect(0, 16, 24, 40, C)] },
];

export const PLAN: Array<[string, 'full' | 'head', string]> = [
  ['hair_back', 'head', 'back hair'],
  ['topwear', 'full', 'topwear'],
  ['bottomwear', 'full', 'bottomwear'],
  ['shoes', 'full', 'footwear'],
  ['face', 'head', 'face'],
];

export const EXTEND = [{ part: 'hair_back', run: 'full' as const, tag: 'back hair' }];

/** The parts.json the module doc derives. */
export const EXPECTED_PARTS = {
  rig_size: [64, 64] as [number, number],
  scale_rig_per_source: 0.5,
  parts: [
    { name: 'hair_back', from: 'head:back hair', x: 37, y: 10, w: 9, h: 35, opaque_px: 285, projected_core_px: 72, source_px_taken: 68, refused_drift_px: 0, merged_px: 133, seam_override_px: 0 },
    { name: 'topwear', from: 'full:topwear', x: 10, y: 20, w: 20, h: 30, opaque_px: 600, projected_core_px: 416, source_px_taken: 416, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
    { name: 'bottomwear', from: 'full:bottomwear', x: 48, y: 30, w: 14, h: 24, opaque_px: 336, projected_core_px: 200, source_px_taken: 0, refused_drift_px: 200, merged_px: 0, seam_override_px: 336 },
    { name: 'shoes', from: 'full:footwear', x: 10, y: 54, w: 20, h: 6, opaque_px: 120, projected_core_px: 32, source_px_taken: 32, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
    { name: 'face', from: 'head:face', x: 16, y: 8, w: 12, h: 12, opaque_px: 144, projected_core_px: 64, source_px_taken: 56, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 },
  ],
  ghost_px: {
    'full:back hair': 0,
    'full:bottomwear': 0,
    'full:footwear': 4,
    'full:headwear': 0,
    'full:neck': 9,
    'full:topwear': 0,
    'head:back hair': 0,
    'head:face': 0,
  },
};

/** What `--propose-plan` must say for the flat fixture, derived in `selftest.ts` beside the control. */
export const EXPECTED_PROPOSAL = {
  plan: [
    ['hair_back', 'head', 'back hair'],
    ['hairpin', 'full', 'headwear'],
    ['bottomwear', 'full', 'bottomwear'],
    ['topwear', 'full', 'topwear'],
    ['face', 'head', 'face'],
  ],
  extend_below_crop: [{ part: 'hair_back', run: 'full', tag: 'back hair' }],
  notes: ['headwear: head run 0 rig px < 0.8 x full run 192 -> full-run layer, drawn behind the face'],
};

export function paint(w: number, h: number, background: RGB | null, rects: Rect[]): Raster {
  const r = newRaster(w, h);
  if (background !== null) for (let i = 0; i < w * h; i++) r.data.set([...background, 255], i * 4);
  for (const q of rects) for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) r.data.set([...q.colour, 255], (y * w + x) * 4);
  return r;
}

export function flatPainting(side = SOURCE_SIDE, width = side): Raster {
  return paint(width, side, C, []);
}

/** Rectangles are painted in order, so the white hole goes over the block. */
export function framedPainting(): Raster {
  return paint(SOURCE_SIDE, SOURCE_SIDE, WHITE, [rect(16, 16, 96, 96, C), rect(40, 40, 72, 72, WHITE), rect(104, 16, 108, 96, C)]);
}

export const FRAMED_FULL: RunLayerSpec[] = [
  { name: 'topwear', depth: 0.5, rects: [rect(24, 24, 32, 32, NAVY)] },
  { name: 'bottomwear', depth: 0.6, rects: [rect(52, 20, 54, 40, Z)] },
];
export const FRAMED_PLAN: Array<[string, 'full' | 'head', string]> = [
  ['bottomwear', 'full', 'bottomwear'],
  ['topwear', 'full', 'topwear'],
];
export const FRAMED_HEAD: RunLayerSpec[] = [{ name: 'face', depth: 0.5, rects: [rect(0, 0, 8, 8, C)] }];

/** One run in the wrapper form: `layers.json` plus one PNG per layer, each cut to its rectangles' bounding box. */
export function writeRun(dir: string, layers: RunLayerSpec[], canvas = RESOLUTION): void {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const entries = layers.map((l) => {
    const left = Math.min(...l.rects.map((q) => q.x0));
    const top = Math.min(...l.rects.map((q) => q.y0));
    const right = Math.max(...l.rects.map((q) => q.x1));
    const bottom = Math.max(...l.rects.map((q) => q.y1));
    const shifted = l.rects.map((q) => ({ ...q, x0: q.x0 - left, x1: q.x1 - left, y0: q.y0 - top, y1: q.y1 - top }));
    writeFileSync(join(dir, 'parts', `${l.name}.png`), encodePngBytes(paint(right - left, bottom - top, null, shifted)));
    return { name: l.name, filename: `asm_${l.name.replace(' ', '_')}.png`, left, top, right, bottom, depth_median: l.depth };
  });
  writeFileSync(join(dir, 'layers.json'), `${JSON.stringify({ layers: entries, width: canvas, height: canvas }, null, 2)}\n`);
}

/** A config the loader accepts, carrying the stage's fields and one-bone placeholders for the rest. */
export function assembleConfig(overrides: { plan?: unknown; extend?: unknown; headBox?: unknown; resolution?: number; rigScale?: number; seethrough?: boolean } = {}): Record<string, unknown> {
  const plan = (overrides.plan ?? PLAN) as Array<[string, string, string]>;
  const cfg: Record<string, unknown> = {
    key: 'assemble-fixture',
    assemble: { rig_scale: overrides.rigScale ?? RIG_SCALE, plan, extend_below_crop: overrides.extend ?? EXTEND },
    bones: [{ name: 'anchor', parent: 'root', at: [0, 0] }],
    meshes: {},
    regions: Object.fromEntries(plan.map((p) => [p[0], 'anchor'])),
    motion: { duration: 1, tracks: [] },
  };
  if (overrides.seethrough !== false) {
    cfg.seethrough = { resolution: overrides.resolution ?? RESOLUTION, steps: 1, seed: 0, offload: false, head_box: overrides.headBox ?? HEAD_BOX };
  }
  return cfg;
}

/** The whole flat fixture in `dir`: `painting.png`, `full/`, `head/`, `config.json`. */
export function writeAssembleFixture(dir: string, config: Record<string, unknown> = assembleConfig(), painting: Raster = flatPainting()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(painting));
  writeRun(join(dir, 'full'), FULL_LAYERS);
  writeRun(join(dir, 'head'), HEAD_LAYERS);
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}
