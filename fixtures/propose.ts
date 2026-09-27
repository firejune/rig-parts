/**
 * The propose stage's generated fixture: an assembled-parts directory
 * (`parts.json` + `parts/*.png`) and a painting, into a temp directory.
 *
 * ⭐ Every part is a solid rectangle, so every bone the proposer puts on it is
 * computable by hand from the numbers below — the expected values in the
 * selftest are derived there, next to the control, from these boxes. Nothing
 * here is art and nothing here stands for any.
 *
 * The rig is 200x300. The parts and what the rules make of them:
 *
 * - `face` (head:face) 80,40 40x50 — no eyewhite, so the eye axis is the face's
 *   centre x = 100 and the eye line its middle, y = 65; the chin is y = 90; no
 *   neck part, so the neck sits 0.12 face heights below the chin.
 * - `skirt` (full:bottomwear) 60,150 80x100 — the hip at its top plus 0.14 face
 *   heights, three skirt chains at 0.3 / 0.5 / 0.7 of its width.
 * - `sleeve_a` (full:handwear-r) 20,100 20x60 and `sleeve_b` (full:handwear-l)
 *   160,100 20x60 — two blobs, one each side of the axis, 1200 opaque px each
 *   (the rule wants more than 500), so one sleeve chain per blob.
 *
 * The part names are deliberately not their roles: the proposer must read the
 * tag in `from`, never the name.
 *
 * {@link STRAND_PARTS} is a second set for the hanging-strand rule, on its own
 * 100x90 canvas ({@link STRAND_RIG}): a face 30,40 40x50 with two eyes and two
 * brows, and a `crown` (head:headwear) at 0,0, 100x56, drawn as three
 * rectangles (rig px, which at 0,0 are also its own pixels) — a body 0,0 100x16 and two tassels 5,16 5x40
 * and 90,16 5x40. Its rows are 100 px wide for 16 rows and 10 px (two tassels)
 * for 40, under 35 % of 100, so rows 16..55 are its pendant rows (40 of 56, not
 * over 0.8, so the crown has a body); each tassel is 40/5 = 8 times as tall as
 * wide and 40/56 of the part, so both are strands, at column centroids x 7 and
 * 92, rows 16..55. {@link BARE_CROWN_PARTS} is the same crown with no tassels
 * (100x16): its only pendant row is its last, 100 px wide, so it has no strand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PartRecord, writeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export const PROPOSE_RIG = { w: 200, h: 300 };

export interface ProposeFixturePart {
  name: string;
  from: string;
  x: number;
  y: number;
  w: number;
  h: number;
  colour: [number, number, number];
  /** Rig-space rectangles `[x, y, w, h]` inside the box that are opaque; absent -> the whole box. */
  rects?: Array<[number, number, number, number]>;
}

export const PROPOSE_PARTS: ProposeFixturePart[] = [
  { name: 'skirt', from: 'full:bottomwear', x: 60, y: 150, w: 80, h: 100, colour: [70, 110, 200] },
  { name: 'sleeve_a', from: 'full:handwear-r', x: 20, y: 100, w: 20, h: 60, colour: [240, 240, 240] },
  { name: 'sleeve_b', from: 'full:handwear-l', x: 160, y: 100, w: 20, h: 60, colour: [240, 240, 240] },
  { name: 'face', from: 'head:face', x: 80, y: 40, w: 40, h: 50, colour: [240, 210, 190] },
];

/**
 * The long-robe fixture (issues #22 and #23), on a 200x400 rig: the same face
 * as above (axis 100, chin 90, neck y 96, face height 50) over a robe tagged
 * `bottomwear` that starts at the collar, y 95 — shoulders 60..139 (80 px) for
 * y 95..169, a belt 75..125 (51 px) for y 170..189, a skirt 50..149 for y
 * 190..359 — shoes 80,360 40x30, and clasped hands 88,160 24x24 at the axis.
 *
 * The figure spans y 40..389, so 0.25 of it is y 127.25, and the robe's top
 * + 0.14 face heights, y 102, is above it: the hip comes from the waist.
 */
export const LONG_ROBE_RIG = { w: 200, h: 400 };

export const LONG_ROBE_PARTS: ProposeFixturePart[] = [
  {
    name: 'robe',
    from: 'full:bottomwear',
    x: 50,
    y: 95,
    w: 100,
    h: 265,
    colour: [70, 110, 200],
    rects: [
      [60, 95, 80, 75],
      [75, 170, 51, 20],
      [50, 190, 100, 170],
    ],
  },
  { name: 'shoes', from: 'full:footwear', x: 80, y: 360, w: 40, h: 30, colour: [60, 40, 30] },
  { name: 'hands', from: 'full:handwear-r', x: 88, y: 160, w: 24, h: 24, colour: [240, 210, 190] },
  { name: 'face', from: 'head:face', x: 80, y: 40, w: 40, h: 50, colour: [240, 210, 190] },
];

/** The strand fixtures' canvas: the figure spans it, so `check`'s setup render sits near scale 1 (see fixtures/checkrig.ts). */
export const STRAND_RIG = { w: 100, h: 90 };

/**
 * A face with two eyes and two brows, so the proposed blink names a member in
 * each group: a proposal with no eyewhite and no eyebrow writes a blink whose
 * groups are empty, which rigc refuses (`group "eyes" declares no members`),
 * and the strand controls need a proposal that builds.
 */
const STRAND_HEAD: ProposeFixturePart[] = [
  { name: 'face', from: 'head:face', x: 30, y: 40, w: 40, h: 50, colour: [240, 210, 190] },
  { name: 'eye_a', from: 'head:eyewhite-r', x: 36, y: 60, w: 10, h: 4, colour: [250, 250, 250] },
  { name: 'eye_b', from: 'head:eyewhite-l', x: 54, y: 60, w: 10, h: 4, colour: [250, 250, 250] },
  { name: 'brow_a', from: 'head:eyebrow-r', x: 36, y: 54, w: 10, h: 2, colour: [60, 40, 30] },
  { name: 'brow_b', from: 'head:eyebrow-l', x: 54, y: 54, w: 10, h: 2, colour: [60, 40, 30] },
];

export const STRAND_PARTS: ProposeFixturePart[] = [
  ...STRAND_HEAD,
  {
    name: 'crown',
    from: 'head:headwear',
    x: 0,
    y: 0,
    w: 100,
    h: 56,
    colour: [220, 180, 60],
    rects: [
      [0, 0, 100, 16],
      [5, 16, 5, 40],
      [90, 16, 5, 40],
    ],
  },
];

export const BARE_CROWN_PARTS: ProposeFixturePart[] = [...STRAND_HEAD, { name: 'crown', from: 'head:headwear', x: 0, y: 0, w: 100, h: 16, colour: [220, 180, 60] }];

/**
 * Every other branch of the strand rule at once, on the 200x300 canvas with the
 * first set's face (proposed, never built). Positions in this list are in each
 * part's own pixels; `rects` holds the same rectangles in rig px, the
 * convention of {@link ProposeFixturePart.rects}:
 *
 * - `crown` (head:headwear) 40,0 120x80: a body 0,0 120x20, a straight tassel
 *   10,20 5x60 (column centroid 12, rig x 52) and a Z-shaped one — 100,20 2x18,
 *   then 100,38 19x2, then 117,40 2x40 — 19 wide and 60 tall (60 >= 3 x 19),
 *   centroid (36 x 100.5 + 38 x 109 + 80 x 117.5) / 154 = 111.4, rig x 151.
 *   Its second link sits 0.45 x 60 = 27 rows down, at y 47, where the column
 *   centroid of rows 35..58 is 9210 / 82 = 112.3 while the only art within 3
 *   rows is x 117..118: more than 3 px (the 7x7 dilation) off it, so that chain
 *   is dropped and the straight one is kept.
 * - `veil` (full:headwear, the smaller layer, so a region on the head) 10,100
 *   20x60: a body 20x20 and a tassel 8,20 5x40 (rig x 20, rows 120..159) —
 *   noted, with no chain, because a region cannot swing.
 * - `drops` (full:earwear, all pendant) 60,120 40x40: two strands 0,0 5x40 and
 *   35,0 5x40 (rig x 62 and 97) — one chain each, hung from the head.
 */
export const MIXED_STRAND_PARTS: ProposeFixturePart[] = [
  { name: 'face', from: 'head:face', x: 80, y: 40, w: 40, h: 50, colour: [240, 210, 190] },
  {
    name: 'crown',
    from: 'head:headwear',
    x: 40,
    y: 0,
    w: 120,
    h: 80,
    colour: [220, 180, 60],
    rects: [
      [40, 0, 120, 20],
      [50, 20, 5, 60],
      [140, 20, 2, 18],
      [140, 38, 19, 2],
      [157, 40, 2, 40],
    ],
  },
  {
    name: 'veil',
    from: 'full:headwear',
    x: 10,
    y: 100,
    w: 20,
    h: 60,
    colour: [200, 200, 230],
    rects: [
      [10, 100, 20, 20],
      [18, 120, 5, 40],
    ],
  },
  {
    name: 'drops',
    from: 'full:earwear',
    x: 60,
    y: 120,
    w: 40,
    h: 40,
    colour: [90, 200, 160],
    rects: [
      [60, 120, 5, 40],
      [95, 120, 5, 40],
    ],
  },
];

function solid(w: number, h: number, colour: [number, number, number]): Raster {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([...colour, 255], i * 4);
  return r;
}

/**
 * The eyes of issue #26's propose control, inside `face` (80,40 40x50), in rig
 * px like every `rects` here:
 *
 * - `white_a` (head:eyewhite-r) 86,60 10x6 and `white_b` (head:eyewhite-l)
 *   104,60 10x6.
 * - `lash_a` (head:eyelash-r) 84,52 14x10: a crease 86,52 10x2, rows 54-55
 *   clear, the lash line 84,56 14x6. It reaches 60 - 52 = **8 px** above
 *   `white_a`, 8/10 = **80 %** of its height, and is 10/6 = **1.67x** its
 *   pair's; the lowest clear row above the lid is **55**. With `creaseGap`
 *   false a 2x2 block at 90,54 joins crease and lash line, so no row is clear.
 * - `lash_b` (head:eyelash-l) 102,58 14x6: reaches 2 px above `white_b`,
 *   2/6 = **33 %**, under the 35 % bar, and 0.6x its pair: not noted.
 */
export function eyeParts(creaseGap = true): ProposeFixturePart[] {
  const rects: Array<[number, number, number, number]> = [
    [86, 52, 10, 2],
    [84, 56, 14, 6],
  ];
  if (!creaseGap) rects.push([90, 54, 2, 2]);
  return [
    { name: 'white_a', from: 'head:eyewhite-r', x: 86, y: 60, w: 10, h: 6, colour: [250, 250, 250] },
    { name: 'white_b', from: 'head:eyewhite-l', x: 104, y: 60, w: 10, h: 6, colour: [250, 250, 250] },
    { name: 'lash_a', from: 'head:eyelash-r', x: 84, y: 52, w: 14, h: 10, colour: [40, 20, 20], rects },
    { name: 'lash_b', from: 'head:eyelash-l', x: 102, y: 58, w: 14, h: 6, colour: [40, 20, 20] },
  ];
}

/**
 * Soft edges: alpha ramps to `(d + 0.5) / SOFT_RAMP` of 255 at `d` pixels in
 * from a rectangle's edge, so the outermost pixel is 255/6 = 42 — above the
 * alpha-8 line every mask reads, so no mask, box or count changes. A rendered
 * rig is resampled, and a hard edge would make `check`'s seam a measure of the
 * resampler rather than of the stack (see fixtures/checkrig.ts).
 */
const SOFT_RAMP = 3;

/** The part's pixels: its rig-space rectangles (the whole box when it has none) in its colour, the rest transparent; `soft` ramps their edges. */
function paint(p: ProposeFixturePart, soft: boolean): Raster {
  const r = newRaster(p.w, p.h);
  const rects = p.rects ?? [[p.x, p.y, p.w, p.h]];
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const d = Math.min(x - rx, rx + rw - 1 - x, y - ry, ry + rh - 1 - y);
        const a = soft ? Math.round(255 * Math.min(1, (d + 0.5) / SOFT_RAMP)) : 255;
        const i = ((y - p.y) * p.w + x - p.x) * 4;
        if (a > r.data[i + 3]) r.data.set([...p.colour, a], i);
      }
    }
  }
  return r;
}

function opaque(p: ProposeFixturePart): number {
  return (p.rects ?? [[p.x, p.y, p.w, p.h]]).reduce((n, [, , rw, rh]) => n + rw * rh, 0);
}

/**
 * `dir/parts.json`, `dir/parts/<name>.png` and `dir/painting.png` (the rig size, mid grey), on `rig` (default `PROPOSE_RIG`). Returns the painting's path.
 * `soft` ramps every part's edge alpha (see `SOFT_RAMP`).
 */
export function writeProposeFixture(dir: string, parts: ProposeFixturePart[] = PROPOSE_PARTS, rig: { w: number; h: number } = PROPOSE_RIG, soft = false): string {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  // A `painting:` patch is 100 % source, and the reader holds its record to that.
  const recs: PartRecord[] = parts.map((p) => {
    const op = opaque(p);
    const taken = p.from.startsWith('painting:') ? op : 0;
    return {
      name: p.name,
      from: p.from,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      opaque_px: op,
      projected_core_px: taken,
      source_px_taken: taken,
      refused_drift_px: 0,
      merged_px: 0,
      seam_override_px: 0,
    };
  });
  for (const p of parts) writeFileSync(join(dir, 'parts', `${p.name}.png`), encodePngBytes(paint(p, soft)));
  writeParts(join(dir, 'parts.json'), { rig_size: [rig.w, rig.h], scale_rig_per_source: 1, parts: recs, ghost_px: {} });
  const painting = join(dir, 'painting.png');
  writeFileSync(painting, encodePngBytes(solid(rig.w, rig.h, [128, 128, 128])));
  return painting;
}
