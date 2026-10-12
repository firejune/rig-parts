#!/usr/bin/env bun
/**
 * Issue #324, Stage A: can a WARN tell a large body that is not the figure,
 * returned by See-through inside a garment layer, from a garment that is
 * legitimately large? Three readings over every garment layer of every run,
 * and the same readings over synthetic plants.
 *
 *     bun tools/offfigure_survey.ts [<key>=<layers dir> ...]
 *
 * With no argument the four public examples' fetched runs are read
 * (`examples/<key>/inputs/layers/{full,head}`, `bun run fetch-examples`); a
 * `<key>=<dir>` adds a figure whose `<dir>` holds `full/` and `head/` wrapper
 * runs (the trailer: `trailer=<rig-c/trailer>/inputs/layers`). The page is
 * printed to stdout; nothing is written.
 *
 * - **Body layers** are the card's: `face`, `neck`, `handwear-r`,
 *   `handwear-l`, `legwear`. **Garment layers** are `topwear`, `bottomwear`,
 *   `neckwear`, `headwear`, `footwear`. Opaque is alpha above
 *   `OPAQUE_ALPHA_ABOVE`, over the layer as read (no ghost clean-up), as
 *   `layerFigures` reads it. A garment is judged at the plausibility rules'
 *   own bar, `PLAUSIBLE_JUDGED_AREA_RATIO` of the rest of its figure.
 * - **R1 outside_hull**: the share of the garment's opaque px strictly
 *   outside the convex hull of every body opaque px of the run (pixel
 *   coordinates as integer points; exact integer cross products).
 * - **R2 detached**: the largest 8-connected component of the garment's
 *   opaque mask holding no px on or 8-adjacent to a body opaque px, as a
 *   share of the garment's opaque px.
 * - **R3 outside_piece**: the largest 8-connected component of R1's px, as a
 *   share of the garment's opaque px.
 * - **Plants**: on each figure's full run, a filled 2:1 rectangle (alpha 255,
 *   grey 128) of area f x topwear's opaque px, f in {0.25, 0.5, 1}, ORed into
 *   topwear — `left`/`right` with its inner edge on the body union's box edge,
 *   vertically centred on topwear's centroid; `seat` centred on topwear's
 *   centroid x with its top on topwear's bottom row. Clipped to the canvas; a
 *   plant keeping under 90 % of its intended area is "no room" and not read.
 *   Built from the card's shape alone, never from a consumer's file. The box
 *   and centroid are read off the cleaned layers (below); the same rectangle
 *   is ORed into both forms.
 * - **Two forms** of every reading. `raw` reads the layers as they are read;
 *   it is the card's statement, and See-through's specks of alpha above 8 at
 *   the canvas edge make its body hull the canvas (docs/evidence/off-figure-body.md).
 *   `cleaned` reads every layer through the plan's `cleanGhosts`, and keeps of
 *   a body layer only its 8-connected components of `PROPOSE_MIN_PX` px or
 *   more. No constant here is new except the plants' and the line's.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Layer, type LayerSet, layerFigures, OPAQUE_ALPHA_ABOVE, PLAUSIBLE_JUDGED_AREA_RATIO, readLayers } from '../src/layers.ts';
import { cleanGhosts, placeLayer, PROPOSE_MIN_PX } from '../src/assemble.ts';
import { connectedComponents, type Mask, type Raster } from '../src/raster/index.ts';

const ROOT = resolve(import.meta.dir, '..');

export const BODY_LAYERS = ['face', 'neck', 'handwear-r', 'handwear-l', 'legwear'] as const;
export const GARMENT_LAYERS = ['topwear', 'bottomwear', 'neckwear', 'headwear', 'footwear'] as const;
export const PLANT_SIZES = [0.25, 0.5, 1] as const;
export const PLANT_PLACES = ['left', 'right', 'seat'] as const;
/** A plant clipped below this share of its intended area is not read. */
export const PLANT_ROOM_MIN = 0.9;
/** The line (stated before measuring): plant minimum above this multiple of the real maximum ... */
export const SEPARATE_RATIO = 2;
/** ... and above it by at least this share. */
export const SEPARATE_GAP = 0.1;

export interface Readings {
  opaquePx: number;
  outsideHull: number;
  detached: number;
  outsidePiece: number;
}

type Point = [number, number];

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone chain over integer points; counter-clockwise in a y-down frame's arithmetic sense, collinear points dropped. */
export function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Inside or on the hull (exact). A hull of fewer than three points holds only its own points and the segment between two. */
export function inHull(hull: Point[], q: Point): boolean {
  if (hull.length === 0) return false;
  if (hull.length === 1) return hull[0][0] === q[0] && hull[0][1] === q[1];
  if (hull.length === 2) {
    const [a, b] = hull;
    return cross(a, b, q) === 0 && Math.min(a[0], b[0]) <= q[0] && q[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= q[1] && q[1] <= Math.max(a[1], b[1]);
  }
  for (let i = 0; i < hull.length; i++) if (cross(hull[i], hull[(i + 1) % hull.length], q) < 0) return false;
  return true;
}

/** A layer's opaque px on the canvas, as a 0/1 mask. */
export function canvasMask(l: Layer, w: number, h: number): Mask {
  const data = new Uint8Array(w * h);
  const p = l.pixels;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.data[(y * p.width + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) data[(l.top + y) * w + l.left + x] = 1;
    }
  }
  return { width: w, height: h, data };
}

function largestWhere(mask: Mask, keep: (label: number) => boolean): number {
  const c = connectedComponents(mask, 8);
  let best = 0;
  for (let k = 1; k < c.count; k++) if (keep(k) && c.stats[k].area > best) best = c.stats[k].area;
  return best;
}

/** The three readings of one garment mask against one body mask. */
export function readGarment(garment: Mask, body: Mask): Readings {
  const { width: w, height: h } = garment;
  const pts: Point[] = [];
  // Only body px on the boundary of the body mask can be hull vertices; the rest are inside it.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!body.data[y * w + x]) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !body.data[y * w + x - 1] || !body.data[y * w + x + 1] || !body.data[(y - 1) * w + x] || !body.data[(y + 1) * w + x];
      if (edge) pts.push([x, y]);
    }
  }
  const hull = convexHull(pts);
  // A body px or a px 8-adjacent to one.
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!body.data[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
        }
      }
    }
  }
  let opaquePx = 0;
  const outside = new Uint8Array(w * h);
  let outsideCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!garment.data[y * w + x]) continue;
      opaquePx++;
      if (!inHull(hull, [x, y])) {
        outside[y * w + x] = 1;
        outsideCount++;
      }
    }
  }
  if (opaquePx === 0) return { opaquePx, outsideHull: 0, detached: 0, outsidePiece: 0 };
  const comps = connectedComponents(garment, 8);
  const touches = new Uint8Array(comps.count);
  for (let i = 0; i < w * h; i++) if (garment.data[i] && near[i]) touches[comps.labels[i]] = 1;
  const detached = largestWhere(garment, (k) => !touches[k]);
  const piece = largestWhere({ width: w, height: h, data: outside }, () => true);
  return { opaquePx, outsideHull: outsideCount / opaquePx, detached: detached / opaquePx, outsidePiece: piece / opaquePx };
}

/** A layer as the plan reads it: placed on its canvas, through `cleanGhosts`, opaque px as a mask. */
export function cleanedMask(l: Layer, w: number, h: number): Mask {
  if (w !== h) throw new Error(`canvas ${w}x${h}: cleanGhosts runs on a square run canvas`);
  const r: Raster = cleanGhosts(placeLayer(l, w)).canvas;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (r.data[i * 4 + 3] > OPAQUE_ALPHA_ABOVE) data[i] = 1;
  return { width: w, height: h, data };
}

/**
 * The body union. `raw`: every body layer's opaque px as read. `cleaned`:
 * each body layer through `cleanGhosts`, then only its 8-connected components
 * of at least `PROPOSE_MIN_PX` px — the plan's own per-tag floor, applied per
 * component so that a speck `cleanGhosts` keeps is not body.
 */
export function bodyMask(set: LayerSet, form: 'raw' | 'cleaned'): Mask {
  const { w, h } = set.canvas;
  const data = new Uint8Array(w * h);
  for (const l of set.layers) {
    if (!(BODY_LAYERS as readonly string[]).includes(l.name)) continue;
    const m = form === 'raw' ? canvasMask(l, w, h) : cleanedMask(l, w, h);
    if (form === 'raw') {
      for (let i = 0; i < w * h; i++) if (m.data[i]) data[i] = 1;
      continue;
    }
    // cleanGhosts keeps a 40..149 px speck (an empty tag's marker at the canvas corner is one); the plan's floor drops it.
    const c = connectedComponents(m, 8);
    for (let i = 0; i < w * h; i++) if (m.data[i] && c.stats[c.labels[i]].area >= PROPOSE_MIN_PX) data[i] = 1;
  }
  return { width: w, height: h, data };
}

export type Place = (typeof PLANT_PLACES)[number];

export interface Rect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/**
 * The plant rectangle for one placement: area `size` x the garment's px, 2:1
 * wide; `left`/`right` with its inner edge on the body union's box edge,
 * vertically centred on the garment's centroid; `seat` centred on the
 * centroid's x with its top on the garment's bottom row. Unclipped.
 */
export function plantRect(garment: Mask, body: Mask, place: Place, size: number): Rect {
  const { width: w, height: h } = garment;
  let gx = 0;
  let gy = 0;
  let n = 0;
  let gBottom = -1;
  let bl = w;
  let br = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (garment.data[y * w + x]) {
        gx += x;
        gy += y;
        n++;
        gBottom = y;
      }
      if (body.data[y * w + x]) {
        bl = Math.min(bl, x);
        br = Math.max(br, x);
      }
    }
  }
  const intended = Math.round(size * n);
  const rh = Math.max(1, Math.round(Math.sqrt(intended / 2)));
  const rw = Math.max(1, Math.round(intended / rh));
  const cx = Math.round(gx / n);
  const cy = Math.round(gy / n);
  if (place === 'left') return { x0: bl - rw, y0: cy - Math.floor(rh / 2), w: rw, h: rh };
  if (place === 'right') return { x0: br + 1, y0: cy - Math.floor(rh / 2), w: rw, h: rh };
  return { x0: cx - Math.floor(rw / 2), y0: gBottom + 1, w: rw, h: rh };
}

/** A copy of `mask` with the rectangle's on-canvas px set; `planted` counts them. */
export function withRect(mask: Mask, r: Rect): { mask: Mask; planted: number } {
  const { width: w, height: h } = mask;
  const data = Uint8Array.from(mask.data);
  let planted = 0;
  for (let y = Math.max(0, r.y0); y < Math.min(h, r.y0 + r.h); y++) {
    for (let x = Math.max(0, r.x0); x < Math.min(w, r.x0 + r.w); x++) {
      planted++;
      data[y * w + x] = 1;
    }
  }
  return { mask: { width: w, height: h, data }, planted };
}

export interface Pair {
  raw: Readings;
  cleaned: Readings;
}

export interface GarmentRow {
  figure: string;
  run: string;
  layer: string;
  judged: boolean;
  areaRatio: number | null;
  readings: Pair;
}

export interface PlantRow {
  figure: string;
  place: Place;
  size: number;
  intended: number;
  planted: number;
  readings: Pair | null;
}

function figuresIn(args: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (args.length === 0) {
    const dir = join(ROOT, 'examples');
    for (const key of readdirSync(dir).sort()) {
      const at = join(dir, key, 'inputs', 'layers');
      if (existsSync(join(at, 'full', 'layers.json'))) out.push([key, at]);
    }
    return out;
  }
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq <= 0) throw new Error(`argument "${a}": <key>=<layers dir> is required`);
    out.push([a.slice(0, eq), resolve(a.slice(eq + 1))]);
  }
  return out;
}

function share(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function survey(figures: Array<[string, string]>): { rows: GarmentRow[]; plants: PlantRow[] } {
  const rows: GarmentRow[] = [];
  const plants: PlantRow[] = [];
  for (const [figure, dir] of figures) {
    for (const run of ['full', 'head']) {
      const set = readLayers(join(dir, run));
      const { w, h } = set.canvas;
      const bodyRaw = bodyMask(set, 'raw');
      const bodyClean = bodyMask(set, 'cleaned');
      const figs = layerFigures(set);
      for (const name of GARMENT_LAYERS) {
        const i = set.layers.findIndex((l) => l.name === name);
        if (i < 0) continue;
        const l = set.layers[i];
        const f = figs[i];
        const judged = f.opaquePx > 0 && (f.areaRatio === null || f.areaRatio >= PLAUSIBLE_JUDGED_AREA_RATIO);
        const gRaw = canvasMask(l, w, h);
        const gClean = cleanedMask(l, w, h);
        rows.push({ figure, run, layer: name, judged, areaRatio: f.areaRatio, readings: { raw: readGarment(gRaw, bodyRaw), cleaned: readGarment(gClean, bodyClean) } });
        if (run !== 'full' || name !== 'topwear') continue;
        for (const size of PLANT_SIZES) {
          for (const place of PLANT_PLACES) {
            const rect = plantRect(gClean, bodyClean, place, size);
            const pr = withRect(gRaw, rect);
            const pc = withRect(gClean, rect);
            const intended = rect.w * rect.h;
            const ok = pc.planted >= PLANT_ROOM_MIN * intended;
            plants.push({ figure, place, size, intended, planted: pc.planted, readings: ok ? { raw: readGarment(pr.mask, bodyRaw), cleaned: readGarment(pc.mask, bodyClean) } : null });
          }
        }
      }
    }
  }
  return { rows, plants };
}

const READINGS: Array<[string, (x: Readings) => number]> = [
  ['R1 outside_hull', (x) => x.outsideHull],
  ['R2 detached', (x) => x.detached],
  ['R3 outside_piece', (x) => x.outsidePiece],
];

export function render(rows: GarmentRow[], plants: PlantRow[]): string {
  const out: string[] = [];
  const three = (r: Readings): string => `${share(r.outsideHull)} | ${share(r.detached)} | ${share(r.outsidePiece)}`;
  out.push('### Real garment layers', '');
  out.push('Raw: the layers as read. Cleaned: every layer through `cleanGhosts`; of a body layer, only its components of `PROPOSE_MIN_PX` px or more.', '');
  out.push('| figure | run | layer | opaque px | x rest of figure | judged | raw R1 | raw R2 | raw R3 | cleaned R1 | cleaned R2 | cleaned R3 |');
  out.push('| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) {
    out.push(`| ${r.figure} | ${r.run} | ${r.layer} | ${r.readings.raw.opaquePx} | ${r.areaRatio === null ? '-' : r.areaRatio.toFixed(3)} | ${r.judged ? 'yes' : 'no'} | ${three(r.readings.raw)} | ${three(r.readings.cleaned)} |`);
  }
  out.push('', '### Planted topwear (full runs)', '');
  out.push('| figure | f | place | intended px | planted px | raw R1 | raw R2 | raw R3 | cleaned R1 | cleaned R2 | cleaned R3 |');
  out.push('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const p of plants) {
    const r = p.readings;
    out.push(`| ${p.figure} | ${p.size} | ${p.place} | ${p.intended} | ${p.planted} | ${r ? `${three(r.raw)} | ${three(r.cleaned)}` : 'no room | | | | |'} |`);
  }
  out.push('', '### The line', '');
  out.push(`A reading separates a placement at size f when the plants' minimum is above ${SEPARATE_RATIO}x the judged real garments' maximum (every run) and above it by at least ${share(SEPARATE_GAP)}.`, '');
  out.push('| form | reading | real judged max (where) | f | place | plants read | plants over the line | plant min (where) | separates |');
  out.push('| --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |');
  const judged = rows.filter((r) => r.judged);
  for (const form of ['raw', 'cleaned'] as const) {
    for (const [label, get] of READINGS) {
      let max = -1;
      let where = '';
      for (const r of judged) {
        const v = get(r.readings[form]);
        if (v > max) {
          max = v;
          where = `${r.figure} ${r.run} ${r.layer}`;
        }
      }
      for (const size of PLANT_SIZES) {
        for (const place of PLANT_PLACES) {
          const all = plants.filter((p) => p.size === size && p.place === place);
          let min = Infinity;
          let at = '';
          let read = 0;
          let over = 0;
          for (const p of all) {
            if (p.readings === null) continue;
            read++;
            const v = get(p.readings[form]);
            if (v > SEPARATE_RATIO * max && v - max >= SEPARATE_GAP) over++;
            if (v < min) {
              min = v;
              at = p.figure;
            }
          }
          const sep = read > 0 && min > SEPARATE_RATIO * max && min - max >= SEPARATE_GAP;
          out.push(`| ${form} | ${label} | ${share(max)} (${where}) | ${size} | ${place} | ${read} of ${all.length} | ${over} | ${read > 0 ? `${share(min)} (${at})` : '-'} | ${sep ? 'yes' : 'no'} |`);
        }
      }
    }
  }
  return out.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const figures = [...figuresIn([]), ...(args.length > 0 ? figuresIn(args) : [])];
  const { rows, plants } = survey(figures);
  console.log(render(rows, plants));
}

if (import.meta.main) main();
