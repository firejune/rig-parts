/**
 * Animated GIF encoder — GIF89a, one global palette chosen by median cut,
 * LZW, a NETSCAPE2.0 block that loops forever.
 *
 * Pure: bytes in, bytes out, no dependency, no clock, no randomness, and
 * deterministic — every sort has a total order, so the same frames write the
 * same bytes.
 *
 * What the encoder does:
 *
 * - **One palette for every frame**, 255 colours cut from the histogram of all
 *   frames together, plus one transparent index. A per-frame palette would make
 *   a still background shimmer between frames and would forbid the next step.
 *   The cut is variance-driven median cut: the box whose pixels have the
 *   largest summed squared error round their mean is split next, on its widest
 *   channel, at the pixel-weighted median. Each box's colour is its weighted
 *   mean. Every colour then maps to its nearest palette entry (squared RGB
 *   distance, lowest index on a tie). **No dithering**: it would add noise the
 *   frame differencing below has to pay for, and the palette error is reported
 *   instead of hidden.
 * - **Consecutive frames whose quantised pixels are identical are merged**,
 *   and every later frame is cropped to the box of indices that changed, with
 *   the unchanged ones written as the transparent index over the previous frame
 *   (disposal 1, "do not dispose").
 * - **Delays are in centiseconds and the fps is not**: 12 fps is 8.33 cs. So
 *   each frame's delay is the difference of its rounded start and end times,
 *   `round(100 * end / fps) - round(100 * start / fps)` — 8, 9, 8, 8, 9, 8, …
 *   at 12 fps, which keeps the loop's total length exact rather than drifting
 *   by 4 % as a flat 8 cs would.
 *
 * GIF holds no partial alpha. Frames with a translucent pixel are refused by
 * name rather than thresholded: spine-rigc renders over an opaque background,
 * so a translucent frame is not one this encoder was built for.
 *
 * ⚠️ Animated WebP is out of scope: it needs a VP8 or VP8L bitstream encoder,
 * and none ships here.
 */
import { type AnimFrame, checkFrames, EncodeError } from './apng.ts';
import type { Raster } from './raster/types.ts';

export const PALETTE_COLOURS = 255;
export const TRANSPARENT_INDEX = 255;

export interface PaletteError {
  /** Largest per-channel |original - palette| over every pixel measured. */
  max: number;
  /** Mean per-channel |original - palette|, in levels of 255. */
  mean: number;
}

export interface GifStats {
  frames: number;
  colours: number;
  /** Distinct RGB colours across every input frame. */
  distinct: number;
  frame0: PaletteError;
  all: PaletteError;
  bytes: number;
}

interface Colour {
  key: number;
  r: number;
  g: number;
  b: number;
  n: number;
}

function histogram(frames: readonly AnimFrame[]): Colour[] {
  const counts = new Map<number, number>();
  frames.forEach((f, fi) => {
    const d = f.image.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) {
        const p = i / 4;
        throw new EncodeError(`frame ${fi} pixel ${p % f.image.width},${Math.floor(p / f.image.width)} has alpha ${d[i + 3]}; GIF holds no partial alpha, so every pixel must be opaque (255)`);
      }
      const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([key, n]) => ({ key, r: key >>> 16, g: (key >>> 8) & 255, b: key & 255, n }));
}

interface Box {
  colours: Colour[];
  n: number;
  sse: number;
  axis: 0 | 1 | 2;
}

const CH = ['r', 'g', 'b'] as const;

function makeBox(colours: Colour[]): Box {
  let n = 0;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  for (const c of colours) {
    n += c.n;
    for (let k = 0; k < 3; k++) {
      const v = c[CH[k]];
      sum[k] += v * c.n;
      sq[k] += v * v * c.n;
    }
  }
  const variance = [0, 1, 2].map((k) => sq[k] - (sum[k] * sum[k]) / n);
  const axis = (variance[0] >= variance[1] && variance[0] >= variance[2] ? 0 : variance[1] >= variance[2] ? 1 : 2) as 0 | 1 | 2;
  return { colours, n, sse: colours.length < 2 ? 0 : variance[0] + variance[1] + variance[2], axis };
}

/** Median cut to at most `size` colours. Deterministic: ties go to the lower box index and the lower colour key. */
export function medianCut(colours: Colour[], size: number): Array<[number, number, number]> {
  const boxes: Box[] = [makeBox(colours)];
  while (boxes.length < size) {
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].sse > 0 && (pick < 0 || boxes[i].sse > boxes[pick].sse)) pick = i;
    if (pick < 0) break;
    const box = boxes[pick];
    const ch = CH[box.axis];
    const sorted = [...box.colours].sort((a, b) => a[ch] - b[ch] || a.key - b.key);
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
    const m = [0, 0, 0];
    for (const c of b.colours) for (let k = 0; k < 3; k++) m[k] += c[CH[k]] * c.n;
    return [Math.round(m[0] / b.n), Math.round(m[1] / b.n), Math.round(m[2] / b.n)];
  });
}

function nearest(palette: ReadonlyArray<readonly [number, number, number]>, r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** LZW-compress palette indices the way GIF wants it, with `minCode` bits for the root alphabet. */
export function lzw(indices: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let size = minCode + 1;
  const emit = (code: number): void => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  let table = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (bits > 0) out.push(acc & 255);
    return new Uint8Array(out);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minCode + 1;
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(acc & 255);
  return new Uint8Array(out);
}

function subBlocks(data: Uint8Array): number[] {
  const out: number[] = [];
  for (let at = 0; at < data.length; at += 255) {
    const n = Math.min(255, data.length - at);
    out.push(n);
    for (let i = 0; i < n; i++) out.push(data[at + i]);
  }
  out.push(0);
  return out;
}

function le16(n: number): number[] {
  return [n & 255, (n >>> 8) & 255];
}

function errorOf(images: readonly Raster[], index: readonly Uint8Array[], palette: ReadonlyArray<readonly [number, number, number]>): PaletteError {
  let max = 0;
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
    }
  });
  return { max, mean: count === 0 ? 0 : sum / count };
}

/** Encode frames as a looping GIF, each frame shown for `ticks / fps` seconds. */
export function encodeGif(input: readonly AnimFrame[], fps: number): { bytes: Uint8Array; stats: GifStats } {
  checkFrames(input, fps);
  const colours = histogram(input);
  const palette = medianCut(colours, PALETTE_COLOURS);
  const map = new Map<number, number>();
  for (const c of colours) map.set(c.key, nearest(palette, c.r, c.g, c.b));
  const { width, height } = input[0].image;
  const indexed = input.map((f) => {
    const d = f.image.data;
    const ix = new Uint8Array(width * height);
    for (let p = 0; p < ix.length; p++) ix[p] = map.get((d[p * 4] << 16) | (d[p * 4 + 1] << 8) | d[p * 4 + 2]) ?? 0;
    return ix;
  });
  const frame0 = errorOf([input[0].image], [indexed[0]], palette);
  const all = errorOf(
    input.map((f) => f.image),
    indexed,
    palette,
  );

  // Merge neighbours that quantise to the same indices.
  const runs: Array<{ ix: Uint8Array; ticks: number }> = [];
  indexed.forEach((ix, i) => {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.ix.every((v, p) => v === ix[p])) last.ticks += input[i].ticks;
    else runs.push({ ix, ticks: input[i].ticks });
  });

  const out: number[] = [];
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  out.push(...le16(width), ...le16(height), 0xf7, 0, 0);
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? [0, 0, 0];
    out.push(c[0], c[1], c[2]);
  }
  out.push(0x21, 0xff, 0x0b);
  for (const ch of 'NETSCAPE2.0') out.push(ch.charCodeAt(0));
  out.push(0x03, 0x01, 0, 0, 0);

  let tick = 0;
  runs.forEach((run, i) => {
    const start = Math.round((100 * tick) / fps);
    tick += run.ticks;
    const delay = Math.round((100 * tick) / fps) - start;
    let x0 = 0;
    let y0 = 0;
    let w = width;
    let h = height;
    let body = run.ix;
    let transparent = false;
    if (i > 0) {
      const prev = runs[i - 1].ix;
      let bx0 = width;
      let by0 = height;
      let bx1 = -1;
      let by1 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (prev[y * width + x] !== run.ix[y * width + x]) {
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
            if (y < by0) by0 = y;
            if (y > by1) by1 = y;
          }
        }
      }
      x0 = bx0;
      y0 = by0;
      w = bx1 - bx0 + 1;
      h = by1 - by0 + 1;
      body = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y0 + y) * width + x0 + x;
          body[y * w + x] = prev[p] === run.ix[p] ? TRANSPARENT_INDEX : run.ix[p];
        }
      }
      transparent = true;
    }
    out.push(0x21, 0xf9, 0x04, (1 << 2) | (transparent ? 1 : 0), ...le16(delay), TRANSPARENT_INDEX, 0);
    out.push(0x2c, ...le16(x0), ...le16(y0), ...le16(w), ...le16(h), 0);
    out.push(8);
    for (const v of subBlocks(lzw(body, 8))) out.push(v);
  });
  out.push(0x3b);
  const bytes = new Uint8Array(out);
  return { bytes, stats: { frames: runs.length, colours: palette.length, distinct: colours.length, frame0, all, bytes: bytes.length } };
}
