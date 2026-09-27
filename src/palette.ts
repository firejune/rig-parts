/**
 * The one palette quantiser, shared by the GIF writer (`src/gif.ts`) and the
 * indexed APNG writer (`encodeIndexedApng` in `src/apng.ts`): variance-driven
 * median cut over the histogram of every frame's RGBA pixels together.
 *
 * Pure and deterministic — every sort has a total order (channel value, then
 * the colour's packed key), ties go to the lower box index, and nothing reads a
 * clock or a random source — so the same frames cut the same palette.
 *
 * The cut: the box whose pixels have the largest summed squared error round
 * their mean is split next, on its widest channel, at the pixel-weighted
 * median. Each box's colour is its pixel-weighted mean, rounded. Every colour
 * then maps to its nearest entry by squared RGBA distance, lowest index on a
 * tie.
 *
 * Alpha is a fourth channel like the other three, so a translucent edge gets
 * graded palette alpha when the frames have one. A channel that is constant
 * over a box contributes exactly 0 to its variance — computed as a branch, not
 * as `sum(v^2) - sum(v)^2 / n`, which in float64 is not exactly 0 once `n`
 * passes a few million pixels, and would perturb which box splits next. On
 * frames that are opaque everywhere (every frame spine-rigc renders over its
 * background) alpha is constant, and the cut is the three-channel median cut
 * `src/gif.ts` has always made, byte for byte.
 */
import type { Raster } from './raster/types.ts';

export type Rgba = readonly [number, number, number, number];

export interface Colour {
  /** `((r * 256 + g) * 256 + b) * 256 + a`, a float64-exact integer below 2^32. */
  key: number;
  c: Rgba;
  /** Pixels of this colour, over every frame. */
  n: number;
}

export function keyOf(r: number, g: number, b: number, a: number): number {
  return ((r * 256 + g) * 256 + b) * 256 + a;
}

/** Every distinct RGBA colour of the images, with its pixel count, sorted by key. */
export function histogram(images: readonly Raster[]): Colour[] {
  const counts = new Map<number, number>();
  for (const im of images) {
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const key = keyOf(d[i], d[i + 1], d[i + 2], d[i + 3]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, n]) => ({ key, c: [Math.floor(key / 16777216), Math.floor(key / 65536) % 256, Math.floor(key / 256) % 256, key % 256] as const, n }));
}

interface Box {
  colours: Colour[];
  n: number;
  sse: number;
  axis: 0 | 1 | 2 | 3;
}

function makeBox(colours: Colour[]): Box {
  let n = 0;
  const sum = [0, 0, 0, 0];
  const sq = [0, 0, 0, 0];
  const lo = [255, 255, 255, 255];
  const hi = [0, 0, 0, 0];
  for (const col of colours) {
    n += col.n;
    for (let k = 0; k < 4; k++) {
      const v = col.c[k];
      sum[k] += v * col.n;
      sq[k] += v * v * col.n;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const variance = [0, 1, 2, 3].map((k) => (lo[k] === hi[k] ? 0 : sq[k] - (sum[k] * sum[k]) / n));
  let axis: 0 | 1 | 2 | 3 = variance[0] >= variance[1] && variance[0] >= variance[2] ? 0 : variance[1] >= variance[2] ? 1 : 2;
  if (variance[3] > variance[axis]) axis = 3;
  return { colours, n, sse: colours.length < 2 ? 0 : variance[0] + variance[1] + variance[2] + variance[3], axis };
}

/** Median cut to at most `size` colours. */
export function medianCut(colours: Colour[], size: number): Rgba[] {
  if (colours.length === 0) return [];
  const boxes: Box[] = [makeBox(colours)];
  while (boxes.length < size) {
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].sse > 0 && (pick < 0 || boxes[i].sse > boxes[pick].sse)) pick = i;
    if (pick < 0) break;
    const box = boxes[pick];
    const k = box.axis;
    const sorted = [...box.colours].sort((a, b) => a.c[k] - b.c[k] || a.key - b.key);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].n;
      cut = i + 1;
      if (acc * 2 >= box.n) break;
    }
    // Both halves are non-empty because the box holds at least two colours.
    boxes.splice(pick, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
  }
  return boxes.map((b) => {
    const m = [0, 0, 0, 0];
    for (const col of b.colours) for (let k = 0; k < 4; k++) m[k] += col.c[k] * col.n;
    return [Math.round(m[0] / b.n), Math.round(m[1] / b.n), Math.round(m[2] / b.n), Math.round(m[3] / b.n)] as const;
  });
}

/** The index of the entry nearest `(r, g, b, a)` by squared distance, lowest index on a tie. */
export function nearest(palette: readonly Rgba[], r: number, g: number, b: number, a: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2 + (p[3] - a) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface PaletteError {
  /** Largest per-channel |original - palette| over R, G and B of every pixel measured. */
  max: number;
  /** Mean per-channel |original - palette| over R, G and B, in levels of 255. */
  mean: number;
  /** Largest |original alpha - palette alpha|; 0 on opaque frames. */
  alphaMax: number;
}

/** Per-channel error of index planes against the images they were quantised from. */
export function paletteError(images: readonly Raster[], index: readonly Uint8Array[], palette: readonly Rgba[]): PaletteError {
  let max = 0;
  let alphaMax = 0;
  let sum = 0;
  let count = 0;
  images.forEach((im, f) => {
    for (let p = 0; p < im.width * im.height; p++) {
      const c = palette[index[f][p]];
      for (let k = 0; k < 3; k++) {
        const e = Math.abs(im.data[p * 4 + k] - c[k]);
        if (e > max) max = e;
        sum += e;
        count++;
      }
      const ea = Math.abs(im.data[p * 4 + 3] - c[3]);
      if (ea > alphaMax) alphaMax = ea;
    }
  });
  return { max, mean: count === 0 ? 0 : sum / count, alphaMax };
}

/**
 * Map every pixel of every image to its nearest palette entry (among the
 * first `usable` entries, so a reserved entry past them is never chosen).
 *
 * With `dither`, Floyd–Steinberg error diffusion — 7/16 right, 3/16 below
 * left, 5/16 below, 1/16 below right — in a fixed raster scan, left to right,
 * top to bottom, each frame on its own; the diffused value is clamped to
 * 0..255 before it is matched. Deterministic, because the scan order is.
 */
export function mapToPalette(images: readonly Raster[], palette: readonly Rgba[], dither: boolean): Uint8Array[] {
  const memo = new Map<number, number>();
  const lookup = (r: number, g: number, b: number, a: number): number => {
    const key = keyOf(r, g, b, a);
    let ix = memo.get(key);
    if (ix === undefined) {
      ix = nearest(palette, r, g, b, a);
      memo.set(key, ix);
    }
    return ix;
  };
  return images.map((im) => {
    const { width, height, data } = im;
    const ix = new Uint8Array(width * height);
    if (!dither) {
      for (let p = 0; p < ix.length; p++) ix[p] = lookup(data[p * 4], data[p * 4 + 1], data[p * 4 + 2], data[p * 4 + 3]);
      return ix;
    }
    let cur = new Float64Array(width * 4);
    let next = new Float64Array(width * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const v = [0, 0, 0, 0];
        for (let k = 0; k < 4; k++) v[k] = Math.min(255, Math.max(0, Math.round(data[p * 4 + k] + cur[x * 4 + k])));
        const i = lookup(v[0], v[1], v[2], v[3]);
        ix[p] = i;
        for (let k = 0; k < 4; k++) {
          const e = data[p * 4 + k] + cur[x * 4 + k] - palette[i][k];
          if (x + 1 < width) cur[(x + 1) * 4 + k] += (e * 7) / 16;
          if (x > 0) next[(x - 1) * 4 + k] += (e * 3) / 16;
          next[x * 4 + k] += (e * 5) / 16;
          if (x + 1 < width) next[(x + 1) * 4 + k] += e / 16;
        }
      }
      [cur, next] = [next, cur];
      next.fill(0);
    }
    return ix;
  });
}
