/**
 * Animated PNG (APNG) encoder — `acTL` / `fcTL` / `fdAT` over 8-bit RGBA
 * frames, the form GitHub renders in a README.
 *
 * Pure: bytes in, bytes out, no clock, no file system. The only thing it leans
 * on is `node:zlib` for DEFLATE, which is also all spine-rigc's own PNG codec
 * (`spine-rigc/tools/plate.ts`) leans on; the chunk framing and CRC are that
 * codec's `pngChunk`, so there is one PNG chunk writer in the dependency tree,
 * not two.
 *
 * What the encoder does, all of it lossless:
 *
 * - **Frame 0 is the default image.** Its `fcTL` precedes the `IDAT`, so a
 *   decoder that knows nothing of APNG shows frame 0 — which is what the
 *   selftest reads back through spine-rigc's `decodePng`.
 * - **Consecutive identical frames are merged** into one frame whose delay is
 *   their sum; the timing is kept exactly, because an APNG delay is a fraction
 *   (`delay_num / delay_den`) and the fps is its denominator.
 * - **Every later frame is cropped to the box of pixels that changed** from the
 *   frame before (`dispose_op` NONE). When every pixel of that box is opaque in
 *   both frames, unchanged pixels are written fully transparent and the frame
 *   is blended OVER the previous one — transparent zeros compress far better
 *   than repeated colour, and OVER of an opaque pixel is exact replacement.
 *   Where any pixel in the box is translucent the frame is blended SOURCE
 *   instead, since OVER would mix it with what is under it.
 * - **Each scanline takes the PNG filter with the smallest sum of absolute
 *   values** (libpng's heuristic), then zlib level 9.
 *
 * ⚠️ Animated WebP is out of scope: it needs a VP8 (lossy) or VP8L (lossless)
 * bitstream encoder, and none ships here.
 */
import { deflateSync } from 'node:zlib';
import { PNG_SIGNATURE, pngChunk } from 'spine-rigc/tools/plate.ts';
import type { Raster } from './raster/types.ts';

export interface AnimFrame {
  image: Raster;
  /** How many ticks of `1/fps` this frame is shown for. */
  ticks: number;
}

export interface ApngStats {
  /** Frames written into the file, after merging identical neighbours. */
  frames: number;
  /** Frames blended OVER with their unchanged pixels cleared, of `frames - 1` later frames. */
  overFrames: number;
  bytes: number;
}

export class EncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodeError';
  }
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 255, n & 255]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filtered, deflated scanlines of an RGBA window — an IDAT / fdAT payload. */
export function deflateRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    let bestType = 0;
    let bestScore = Infinity;
    for (let type = 0; type < 5; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0;
        const b = up !== null ? up[i] : 0;
        const c = i >= 4 && up !== null ? up[i - 4] : 0;
        const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >>> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 255;
        trial[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best.set(trial);
      }
    }
    raw[y * (stride + 1)] = bestType;
    raw.set(best, y * (stride + 1) + 1);
  }
  return new Uint8Array(deflateSync(raw, { level: 9 }));
}

function sameFrame(a: Raster, b: Raster): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Merge runs of identical neighbours into one frame of their summed ticks. */
export function mergeRuns(frames: readonly AnimFrame[]): AnimFrame[] {
  const out: AnimFrame[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last !== undefined && sameFrame(last.image, f.image)) out[out.length - 1] = { image: last.image, ticks: last.ticks + f.ticks };
    else out.push({ image: f.image, ticks: f.ticks });
  }
  return out;
}

/** The box of pixels that differ between two same-size frames, or null when none does. */
export function changedBox(prev: Raster, cur: Raster): { x: number; y: number; w: number; h: number } | null {
  let x0 = cur.width;
  let y0 = cur.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < cur.height; y++) {
    for (let x = 0; x < cur.width; x++) {
      const i = (y * cur.width + x) * 4;
      if (prev.data[i] !== cur.data[i] || prev.data[i + 1] !== cur.data[i + 1] || prev.data[i + 2] !== cur.data[i + 2] || prev.data[i + 3] !== cur.data[i + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function checkFrames(frames: readonly AnimFrame[], fps: number): void {
  if (frames.length === 0) throw new EncodeError('no frames to encode; at least one is required');
  if (!Number.isInteger(fps) || fps < 1 || fps > 65535) throw new EncodeError(`fps ${fps}; an integer from 1 to 65535 is required`);
  const { width, height } = frames[0].image;
  if (width < 1 || height < 1) throw new EncodeError(`frame 0 is ${width}x${height}; a frame needs pixels`);
  frames.forEach((f, i) => {
    if (f.image.width !== width || f.image.height !== height) {
      throw new EncodeError(`frame ${i} is ${f.image.width}x${f.image.height}; every frame must be frame 0's ${width}x${height}`);
    }
    if (!Number.isInteger(f.ticks) || f.ticks < 1) throw new EncodeError(`frame ${i} is shown for ${f.ticks} tick(s); a positive integer is required`);
  });
}

/**
 * Encode frames as an APNG that loops forever, each frame shown for
 * `ticks / fps` seconds.
 */
export function encodeApng(input: readonly AnimFrame[], fps: number): { bytes: Uint8Array; stats: ApngStats } {
  checkFrames(input, fps);
  const frames = mergeRuns(input);
  const { width, height } = frames[0].image;
  let seq = 0;
  let overFrames = 0;
  const chunks: Uint8Array[] = [PNG_SIGNATURE];
  chunks.push(pngChunk('IHDR', concat([u32(width), u32(height), new Uint8Array([8, 6, 0, 0, 0])])));
  chunks.push(pngChunk('acTL', concat([u32(frames.length), u32(0)])));
  const fctl = (x: number, y: number, w: number, h: number, ticks: number, blend: number): Uint8Array =>
    pngChunk('fcTL', concat([u32(seq++), u32(w), u32(h), u32(x), u32(y), u16(ticks), u16(fps), new Uint8Array([0, blend])]));
  frames.forEach((f, i) => {
    if (i === 0) {
      chunks.push(fctl(0, 0, width, height, f.ticks, 0));
      chunks.push(pngChunk('IDAT', deflateRgba(width, height, new Uint8Array(f.image.data.buffer, f.image.data.byteOffset, f.image.data.byteLength))));
      return;
    }
    const prev = frames[i - 1].image;
    // mergeRuns guarantees a difference; the box is never null here.
    const box = changedBox(prev, f.image) ?? { x: 0, y: 0, w: 1, h: 1 };
    const win = new Uint8Array(box.w * box.h * 4);
    let opaque = true;
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const s = ((box.y + y) * width + box.x + x) * 4;
        if (prev.data[s + 3] !== 255 || f.image.data[s + 3] !== 255) opaque = false;
        win.set(f.image.data.subarray(s, s + 4), (y * box.w + x) * 4);
      }
    }
    if (opaque) {
      overFrames++;
      for (let y = 0; y < box.h; y++) {
        for (let x = 0; x < box.w; x++) {
          const s = ((box.y + y) * width + box.x + x) * 4;
          const same = prev.data[s] === f.image.data[s] && prev.data[s + 1] === f.image.data[s + 1] && prev.data[s + 2] === f.image.data[s + 2];
          if (same) win.fill(0, (y * box.w + x) * 4, (y * box.w + x) * 4 + 4);
        }
      }
    }
    chunks.push(fctl(box.x, box.y, box.w, box.h, f.ticks, opaque ? 1 : 0));
    chunks.push(pngChunk('fdAT', concat([u32(seq++), deflateRgba(box.w, box.h, win)])));
  });
  chunks.push(pngChunk('IEND', new Uint8Array(0)));
  const bytes = concat(chunks);
  return { bytes, stats: { frames: frames.length, overFrames, bytes: bytes.length } };
}

/** The chunk types of a PNG file, in order — what the selftest reads the structure back with. */
export function chunkTypes(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    out.push(String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]));
    at += 12 + len;
  }
  return out;
}
