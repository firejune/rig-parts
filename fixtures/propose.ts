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

function paint(p: ProposeFixturePart): Raster {
  const r = newRaster(p.w, p.h);
  const rects = p.rects ?? [[p.x, p.y, p.w, p.h]];
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) r.data.set([...p.colour, 255], ((y - p.y) * p.w + x - p.x) * 4);
  }
  return r;
}

function opaque(p: ProposeFixturePart): number {
  return (p.rects ?? [[p.x, p.y, p.w, p.h]]).reduce((n, [, , rw, rh]) => n + rw * rh, 0);
}

function solid(w: number, h: number, colour: [number, number, number]): Raster {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([...colour, 255], i * 4);
  return r;
}

/** `dir/parts.json`, `dir/parts/<name>.png` and `dir/painting.png` (the rig size, mid grey), on `rig` (default `PROPOSE_RIG`). Returns the painting's path. */
export function writeProposeFixture(dir: string, parts: ProposeFixturePart[] = PROPOSE_PARTS, rig: { w: number; h: number } = PROPOSE_RIG): string {
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const recs: PartRecord[] = parts.map((p) => ({
    name: p.name,
    from: p.from,
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
    opaque_px: opaque(p),
    projected_core_px: 0,
    source_px_taken: 0,
    refused_drift_px: 0,
    merged_px: 0,
    seam_override_px: 0,
  }));
  for (const p of parts) writeFileSync(join(dir, 'parts', `${p.name}.png`), encodePngBytes(paint(p)));
  writeParts(join(dir, 'parts.json'), { rig_size: [rig.w, rig.h], scale_rig_per_source: 1, parts: recs, ghost_px: {} });
  const painting = join(dir, 'painting.png');
  writeFileSync(painting, encodePngBytes(solid(rig.w, rig.h, [128, 128, 128])));
  return painting;
}
