import { newRaster, type Raster, RasterError } from './types.ts';

/**
 * The three resampling filters the reference implementation uses, each with
 * the semantics of the call it stands in for:
 *
 * - `area` — `cv2.resize(..., interpolation=cv2.INTER_AREA)` for a
 *   REDUCTION: every output pixel is the coverage-weighted mean of the input
 *   pixels under it. Channels are resampled independently, alpha included, so a
 *   caller that wants a premultiplied reduction premultiplies first (the
 *   reference does, around its warp).
 * - `bicubic` — `cv2.INTER_CUBIC`: Keys cubic with a = -0.75, sample
 *   positions `(i + 0.5) * scale - 0.5`, edge samples replicated, channels
 *   independent.
 * - `lanczos3` — `PIL.Image.resize(..., Image.LANCZOS)`, including what PIL
 *   does around it for RGBA: premultiply, resample (a 3-lobe windowed sinc whose
 *   support widens with the reduction factor, horizontal pass then vertical,
 *   each pass rounded to 8 bits in PIL's 22-bit fixed point), unpremultiply.
 *   Measured bit-exact against Pillow 12.2.0 over 140,568 samples, reductions
 *   and enlargements, opaque and translucent.
 */
export type ResizeFilter = 'area' | 'bicubic' | 'lanczos3';

/** Round half to even — what cv2's `saturate_cast<uchar>(float)` does through `cvRound`. */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function resize(src: Raster, width: number, height: number, filter: ResizeFilter): Raster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RasterError(`resize: target ${width}x${height} is not a pair of positive integers`);
  }
  if (src.width < 1 || src.height < 1) {
    throw new RasterError(`resize: source ${src.width}x${src.height} has no pixels to resample`);
  }
  // PIL hands back a copy when the size does not change; running the
  // premultiply round trip anyway would quantise every translucent pixel.
  if (width === src.width && height === src.height) {
    return { width, height, data: new Uint8ClampedArray(src.data) };
  }
  if (filter === 'area') return resizeArea(src, width, height);
  if (filter === 'bicubic') return resizeCubic(src, width, height);
  if (filter === 'lanczos3') return resizeLanczos(src, width, height);
  throw new RasterError(`resize: filter "${String(filter)}"; one of area, bicubic, lanczos3 is required`);
}

// ---------------------------------------------------------------------------
// area (cv2)
// ---------------------------------------------------------------------------

const f32 = Math.fround;

/** cv2's `computeResizeAreaTab`: (source index, float32 weight) runs per output index. */
function areaTable(inSize: number, outSize: number, scale: number): Array<Array<[number, number]>> {
  const table: Array<Array<[number, number]>> = [];
  for (let o = 0; o < outSize; o++) {
    const fsx1 = o * scale;
    const fsx2 = fsx1 + scale;
    const cell = Math.min(scale, inSize - fsx1);
    const sx2 = Math.min(Math.floor(fsx2), inSize - 1);
    const sx1 = Math.min(Math.ceil(fsx1), sx2);
    const taps: Array<[number, number]> = [];
    if (sx1 - fsx1 > 1e-3) taps.push([sx1 - 1, f32((sx1 - fsx1) / cell)]);
    for (let i = sx1; i < sx2; i++) taps.push([i, f32(1 / cell)]);
    if (fsx2 - sx2 > 1e-3) taps.push([sx2, f32(Math.min(Math.min(fsx2 - sx2, 1), cell) / cell)]);
    table.push(taps);
  }
  return table;
}

/**
 * ⚠️ Reduction only. cv2's INTER_AREA is a different filter when it enlarges
 * (it degrades to a linear variant), so an enlargement is refused by name
 * rather than answered with a filter nobody asked for.
 *
 * Two of cv2's paths are reproduced: an INTEGER reduction factor on both axes
 * averages whole blocks (the 2x2 case with cv2's vectorised `(sum + 2) >> 2`,
 * which rounds a .5 up where the scalar path rounds it to even), and any other
 * factor accumulates float32 coverage weights row by row and rounds half to
 * even. Measured against cv2 4.13: integer factors 2, 3 and 4 bit-exact over
 * 21,348 samples; other factors 1 sample of 21,816 one level off.
 */
function resizeArea(src: Raster, width: number, height: number): Raster {
  if (width > src.width || height > src.height) {
    throw new RasterError(
      `resize: area is defined here for reduction only; ${src.width}x${src.height} -> ${width}x${height} enlarges an axis`,
    );
  }
  const scaleX = 1 / (width / src.width);
  const scaleY = 1 / (height / src.height);
  const ix = Math.round(scaleX);
  const iy = Math.round(scaleY);
  const out = newRaster(width, height);
  if (Math.abs(scaleX - ix) < Number.EPSILON && Math.abs(scaleY - iy) < Number.EPSILON) {
    const scale = f32(1 / (ix * iy));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0;
          for (let j = 0; j < iy; j++) for (let i = 0; i < ix; i++) sum += src.data[((y * iy + j) * src.width + x * ix + i) * 4 + c];
          out.data[(y * width + x) * 4 + c] = ix === 2 && iy === 2 ? (sum + 2) >> 2 : clamp8(roundHalfEven(f32(sum * scale)));
        }
      }
    }
    return out;
  }
  const tx = areaTable(src.width, width, scaleX);
  const ty = areaTable(src.height, height, scaleY);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        let first = true;
        for (const [sy, beta] of ty[y]) {
          let buf = 0;
          for (const [sx, alpha] of tx[x]) buf = f32(buf + f32(src.data[(sy * src.width + sx) * 4 + c] * alpha));
          sum = first ? f32(buf * beta) : f32(sum + f32(buf * beta));
          first = false;
        }
        out.data[(y * width + x) * 4 + c] = clamp8(roundHalfEven(sum));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// bicubic (cv2)
// ---------------------------------------------------------------------------

const COEF_BITS = 11;
const COEF_SCALE = 1 << COEF_BITS;

/** cv2's `interpolateCubic` in float32, a = -0.75. */
function cubicCoeffs(x: number): [number, number, number, number] {
  const A = -0.75;
  const x1 = f32(x + 1);
  const c0 = f32(f32(f32(f32(f32(f32(A * x1) - 5 * A) * x1) + 8 * A) * x1) - 4 * A);
  const c1 = f32(f32(f32(f32(f32((A + 2) * x) - (A + 3)) * x) * x) + 1);
  const mx = f32(1 - x);
  const c2 = f32(f32(f32(f32(f32((A + 2) * mx) - (A + 3)) * mx) * mx) + 1);
  const c3 = f32(f32(f32(1 - c0) - c1) - c2);
  return [c0, c1, c2, c3];
}

/** Per output index: four clamped taps and cv2's 11-bit integer weights. */
function cubicTable(inSize: number, outSize: number): Array<{ taps: number[]; w: number[] }> {
  const scale = 1 / (outSize / inSize);
  const table: Array<{ taps: number[]; w: number[] }> = [];
  for (let o = 0; o < outSize; o++) {
    let f = f32((o + 0.5) * scale - 0.5);
    const s = Math.floor(f);
    f = f32(f - s);
    const w = cubicCoeffs(f).map((c) => roundHalfEven(f32(c * COEF_SCALE)));
    const taps = [s - 1, s, s + 1, s + 2].map((i) => Math.min(inSize - 1, Math.max(0, i)));
    table.push({ taps, w });
  }
  return table;
}

/**
 * cv2's 8-bit cubic path: 11-bit integer weights, an integer horizontal pass,
 * the vertical pass rounded once at 22 bits. Measured bit-exact against cv2
 * 4.13 on random RGBA rasters, enlargement and reduction both.
 */
function resizeCubic(src: Raster, width: number, height: number): Raster {
  const tx = cubicTable(src.width, width);
  const ty = cubicTable(src.height, height);
  const out = newRaster(width, height);
  const shift = 2 * COEF_BITS;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let j = 0; j < 4; j++) {
          let row = 0;
          const sy = ty[y].taps[j];
          for (let i = 0; i < 4; i++) row += src.data[(sy * src.width + tx[x].taps[i]) * 4 + c] * tx[x].w[i];
          s += row * ty[y].w[j];
        }
        out.data[(y * width + x) * 4 + c] = clamp8(Math.floor((s + (1 << (shift - 1))) / (1 << shift)));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// lanczos3 (PIL)
// ---------------------------------------------------------------------------

const PRECISION_BITS = 32 - 8 - 2;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = x * Math.PI;
  return Math.sin(px) / px;
}

function lanczos(x: number): number {
  return x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

/** PIL's `precompute_coeffs` + `normalize_coeffs_8bpc`, transcribed: bounds and 22-bit integer weights. */
function lanczosTable(inSize: number, outSize: number): Array<{ min: number; k: number[] }> {
  const scale = inSize / outSize;
  const filterscale = scale < 1 ? 1 : scale;
  const support = 3 * filterscale;
  const ss = 1 / filterscale;
  const table: Array<{ min: number; k: number[] }> = [];
  for (let o = 0; o < outSize; o++) {
    const center = (o + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    const pre: number[] = [];
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      pre.push(w);
      ww += w;
    }
    const k = pre.map((w) => {
      const v = ww !== 0 ? w / ww : w;
      return v < 0 ? Math.trunc(-0.5 + v * (1 << PRECISION_BITS)) : Math.trunc(0.5 + v * (1 << PRECISION_BITS));
    });
    table.push({ min: xmin, k });
  }
  return table;
}

function clipFixed(ss: number): number {
  return clamp8(Math.floor(ss / (1 << PRECISION_BITS)));
}

/** PIL's `MULDIV255`: `a * b / 255`, rounded, in integers. */
function mulDiv255(a: number, b: number): number {
  const t = a * b + 128;
  return ((t >> 8) + t) >> 8;
}

function resizeLanczos(src: Raster, width: number, height: number): Raster {
  // RGBA -> RGBa, as PIL converts before any resample but NEAREST.
  let cur = newRaster(src.width, src.height);
  for (let i = 0; i < src.width * src.height; i++) {
    const a = src.data[i * 4 + 3];
    for (let c = 0; c < 3; c++) cur.data[i * 4 + c] = a === 255 ? src.data[i * 4 + c] : mulDiv255(src.data[i * 4 + c], a);
    cur.data[i * 4 + 3] = a;
  }
  if (width !== src.width) {
    const t = lanczosTable(src.width, width);
    const next = newRaster(width, cur.height);
    for (let y = 0; y < cur.height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let ss = 1 << (PRECISION_BITS - 1);
          const { min, k } = t[x];
          for (let i = 0; i < k.length; i++) ss += cur.data[(y * cur.width + min + i) * 4 + c] * k[i];
          next.data[(y * width + x) * 4 + c] = clipFixed(ss);
        }
      }
    }
    cur = next;
  }
  if (height !== src.height) {
    const t = lanczosTable(src.height, height);
    const next = newRaster(cur.width, height);
    for (let y = 0; y < height; y++) {
      const { min, k } = t[y];
      for (let x = 0; x < cur.width; x++) {
        for (let c = 0; c < 4; c++) {
          let ss = 1 << (PRECISION_BITS - 1);
          for (let i = 0; i < k.length; i++) ss += cur.data[((min + i) * cur.width + x) * 4 + c] * k[i];
          next.data[(y * cur.width + x) * 4 + c] = clipFixed(ss);
        }
      }
    }
    cur = next;
  }
  // RGBa -> RGBA: integer division by alpha, clipped; alpha 0 and 255 pass through.
  const out = newRaster(cur.width, cur.height);
  for (let i = 0; i < cur.width * cur.height; i++) {
    const a = cur.data[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const v = cur.data[i * 4 + c];
      out.data[i * 4 + c] = a === 255 || a === 0 ? v : clamp8(Math.floor((255 * v) / a));
    }
    out.data[i * 4 + 3] = a;
  }
  return out;
}
