/**
 * An artist's own layered file (issue #359), generated: a 128x128 PSD of flat
 * colour blocks, one per tag, the face separated into `face`, `eyewhite-r` and
 * `eyewhite-l`, and the painting the file flattens to. Nothing here is art and
 * nothing here stands for any; every count below is computed by hand from the
 * rectangles.
 *
 * ## Why every number is exact
 *
 * The canvas is the painting's size and `seethrough.resolution` (128), and
 * `rig_scale` is 1: with one run the head box is the run's own frame
 * (`singleRunHeadBox`, `[0, 0, 128, 128]`), so the run maps to the rig at
 * `k = (128 / 128) x 1 = 1` — the identity — and a layer's rig pixels are its
 * canvas pixels. The painting is the layers composited bottom first on white,
 * every layer opaque, so it holds each layer's colour wherever that layer is
 * the top-most.
 *
 * ## The layers, bottom first (x0, y0, x1, y1; right and bottom exclusive)
 *
 * - `back hair` [32, 4, 96, 48]: 64 x 44 = 2,816 px, `HAIR`.
 * - `topwear` [40, 40, 88, 100]: 48 x 60 = 2,880 px, `TOP` — over the back
 *   hair's lower edge, so no two parts abut on an edge at the setup pose.
 * - `face` [40, 12, 88, 44]: 48 x 32 = 1,536 px, `SKIN`.
 * - `eyewhite-r` [44, 22, 60, 32] and `eyewhite-l` [68, 22, 84, 32]: 16 x 10 =
 *   160 px each, `EYE`, near-white (min channel 245 > 235).
 * - `front hair` [36, 8, 92, 16]: 56 x 8 = 448 px, `FRONT`, inside the back
 *   hair's box for the same reason as the topwear.
 *
 * ## The planted mis-layering (the correction loop)
 *
 * `planted: true` moves the right half of the right eye, [52, 22, 60, 32]
 * (8 x 10 = 80 px), out of `eyewhite-r` (whose box becomes [44, 22, 52, 32])
 * and into `back hair`, which is drawn behind the face. The painting is
 * unchanged. Assembled, the 80 px show the face's `SKIN` where the painting
 * is `EYE`: projection refuses them (|EYE − SKIN| is 130 in blue, over the
 * drift limit 90) and the seam override skips them (the painting there is
 * near-white), so each is a recomposite error pixel over 40 — 80 error px,
 * where the clean file has 0. Moving the 80 px back into `eyewhite-r`'s PNG
 * (and its box back to [44, 22, 60, 32] in `layers.json`) is the worked
 * correction in docs/AUTHORING.md.
 *
 * ## The portrait file (issue #366)
 *
 * `portrait: true` is the same figure on a `75 x 128` canvas: every box and
 * rectangle moved left by 26 (`back hair` [6, 4, 70, 48], …, the painting
 * 75 x 128), and the config's `chest` bone at [38, 40]. One run pads the file
 * to the 128 square, centred: left `floor((128 - 75) / 2) = 26`, right 27 (the
 * odd remainder), top and bottom 0 — so the padded run is the square file's
 * run pixel for pixel, and each part is the square file's part 26 px to the
 * left, which is its layer's box in the portrait file.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';
import { writePsdFixture } from './synthetic.ts';

type RGB = [number, number, number];
type Box = [number, number, number, number];

export const ARTIST_SIDE = 128;
export const HAIR: RGB = [60, 40, 90];
export const TOP: RGB = [40, 90, 160];
export const SKIN: RGB = [200, 150, 120];
export const EYE: RGB = [245, 245, 250];
export const FRONT: RGB = [40, 30, 120];
/** The portrait file's width (issue #366), and how far left its figure sits against the square file's. */
export const ARTIST_PORTRAIT_W = 75;
export const ARTIST_PORTRAIT_SHIFT = 26;
/** The planted patch: the right half of the right eye. */
export const ARTIST_PATCH: Box = [52, 22, 60, 32];

export interface ArtistLayer {
  name: string;
  /** The layer's box on the canvas. */
  box: Box;
  /** Rectangles of one colour each, on the canvas, inside the box. */
  rects: Array<[Box, RGB]>;
}

/** The layers, bottom first; with `planted`, the patch moved into `back hair`. With `drop`, those layers left out. With `portrait`, on the 75-wide canvas. */
export function artistLayers(opts: { planted?: boolean; drop?: readonly string[]; portrait?: boolean } = {}): ArtistLayer[] {
  const layers: ArtistLayer[] = [
    { name: 'back hair', box: [32, 4, 96, 48], rects: [[[32, 4, 96, 48], HAIR]] },
    { name: 'topwear', box: [40, 40, 88, 100], rects: [[[40, 40, 88, 100], TOP]] },
    { name: 'face', box: [40, 12, 88, 44], rects: [[[40, 12, 88, 44], SKIN]] },
    { name: 'eyewhite-r', box: [44, 22, 60, 32], rects: [[[44, 22, 60, 32], EYE]] },
    { name: 'eyewhite-l', box: [68, 22, 84, 32], rects: [[[68, 22, 84, 32], EYE]] },
    { name: 'front hair', box: [36, 8, 92, 16], rects: [[[36, 8, 92, 16], FRONT]] },
  ];
  if (opts.planted === true) {
    layers[0].rects.push([ARTIST_PATCH, EYE]);
    layers[3] = { name: 'eyewhite-r', box: [44, 22, 52, 32], rects: [[[44, 22, 52, 32], EYE]] };
  }
  const kept = layers.filter((l) => !(opts.drop ?? []).includes(l.name));
  if (opts.portrait !== true) return kept;
  const d = ARTIST_PORTRAIT_SHIFT;
  const move = (b: Box): Box => [b[0] - d, b[1], b[2] - d, b[3]];
  return kept.map((l) => ({ name: l.name, box: move(l.box), rects: l.rects.map(([b, c]): [Box, RGB] => [move(b), c]) }));
}

/** The file's canvas, `[w, h]`: 128 x 128, or 75 x 128 with `portrait`. */
export function artistCanvas(opts: { portrait?: boolean } = {}): [number, number] {
  return [opts.portrait === true ? ARTIST_PORTRAIT_W : ARTIST_SIDE, ARTIST_SIDE];
}

/** A layer's own pixels, `(x1 - x0) x (y1 - y0)`, transparent outside its rectangles. */
export function artistRaster(l: ArtistLayer): Raster {
  const [bx, by, bx1, by1] = l.box;
  const r = newRaster(bx1 - bx, by1 - by);
  for (const [[x0, y0, x1, y1], c] of l.rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data.set([...c, 255], ((y - by) * r.width + (x - bx)) * 4);
  return r;
}

/** The clean layers composited bottom first on white: the painting the file flattens to. */
export function artistPainting(opts: { portrait?: boolean } = {}): Raster {
  const [w, h] = artistCanvas(opts);
  const p = newRaster(w, h);
  for (let i = 0; i < w * h; i++) p.data.set([255, 255, 255, 255], i * 4);
  for (const l of artistLayers({ portrait: opts.portrait })) for (const [[x0, y0, x1, y1], c] of l.rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) p.data.set([...c, 255], (y * w + x) * 4);
  return p;
}

/** The plan the single run is assembled by: every row from the full run. */
export const ARTIST_PLAN: Array<[string, 'full', string]> = [
  ['hair_back', 'full', 'back hair'],
  ['topwear', 'full', 'topwear'],
  ['face', 'full', 'face'],
  ['eyewhite_r', 'full', 'eyewhite-r'],
  ['eyewhite_l', 'full', 'eyewhite-l'],
  ['hair_front', 'full', 'front hair'],
];

/**
 * The single-run config: no `seethrough.head_box`, the plan, and the smallest
 * rig `check` passes on this figure — the topwear on a `chest` bone that
 * breathes, everything else on a still anchor.
 */
export function artistConfig(opts: { portrait?: boolean } = {}): Record<string, unknown> {
  const dx = opts.portrait === true ? ARTIST_PORTRAIT_SHIFT : 0;
  return {
    key: 'artist-fixture',
    seethrough: { resolution: ARTIST_SIDE, steps: 1, seed: 0, offload: false },
    assemble: { rig_scale: 1, plan: ARTIST_PLAN },
    bones: [
      { name: 'anchor', parent: 'root', at: [0, 0] },
      { name: 'chest', parent: 'root', at: [64 - dx, 40] },
    ],
    meshes: {},
    regions: { ...Object.fromEntries(ARTIST_PLAN.map((p) => [p[0], 'anchor'])), topwear: 'chest' },
    motion: { duration: 1, tracks: [{ bone: 'chest', prop: 'translatey', amp: 1, period: 1, phase: 0 }] },
  };
}

/**
 * The fixture in `dir`: `art.psd`, `painting.png` (always the clean composite) and `config.json`. With `portrait`,
 * the 75 x 128 file, its painting and its config; `painting` writes another file's painting beside it instead.
 */
export function writeArtistFixture(dir: string, opts: { planted?: boolean; drop?: readonly string[]; config?: Record<string, unknown>; portrait?: boolean; painting?: { portrait?: boolean } } = {}): void {
  mkdirSync(dir, { recursive: true });
  const [w, h] = artistCanvas(opts);
  writePsdFixture(
    join(dir, 'art.psd'),
    w,
    h,
    artistLayers(opts).map((l) => ({ name: l.name, left: l.box[0], top: l.box[1], pixels: artistRaster(l) })),
  );
  writeFileSync(join(dir, 'painting.png'), encodePngBytes(artistPainting(opts.painting ?? { portrait: opts.portrait })));
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(opts.config ?? artistConfig({ portrait: opts.portrait }), null, 2)}\n`);
}
