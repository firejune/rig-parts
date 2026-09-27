import { type FloatImage, newFloatImage, RasterError } from './types.ts';

/**
 * The kernel size cv2 derives when it is asked for `ksize = (0, 0)`:
 * `round(sigma * 4 * 2 + 1) | 1` for a floating-point image. (For an 8-bit
 * image cv2 uses 3 sigma instead of 4; every call this port makes blurs a
 * float image, so that is the only rule implemented, and it is named.)
 */
export function gaussianKernelSize(sigma: number): number {
  return Math.round(sigma * 4 * 2 + 1) | 1;
}

/** `cv2.getGaussianKernel(ksize, sigma)`: `exp(-(i - (ksize-1)/2)^2 / (2 sigma^2))`, normalised to sum 1. */
export function gaussianKernel(ksize: number, sigma: number): Float64Array {
  if (!Number.isInteger(ksize) || ksize < 1 || ksize % 2 === 0) {
    throw new RasterError(`gaussianKernel: ksize ${ksize}; a positive odd integer is required`);
  }
  if (!(sigma > 0) || !Number.isFinite(sigma)) {
    throw new RasterError(`gaussianKernel: sigma ${sigma}; a positive finite number is required`);
  }
  const k = new Float64Array(ksize);
  const c = (ksize - 1) / 2;
  let sum = 0;
  for (let i = 0; i < ksize; i++) {
    const x = i - c;
    k[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += k[i];
  }
  for (let i = 0; i < ksize; i++) k[i] /= sum;
  return k;
}

/** cv2's `BORDER_REFLECT_101` (its default): `-1 -> 1`, `n -> n - 2`, no edge sample repeated. */
function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  let p = i;
  while (p < 0 || p >= n) {
    if (p < 0) p = -p;
    if (p >= n) p = 2 * (n - 1) - p;
  }
  return p;
}

/**
 * `cv2.GaussianBlur(img, (0, 0), sigma)` on a float image, every channel
 * independently: the separable kernel above, horizontal pass then vertical,
 * border `REFLECT_101`.
 *
 * Computed in float64 and stored as float32; cv2 accumulates a float32 image
 * in float32, so the two differ in the last bits of a sample. Measured against
 * cv2 4.13 over 18,257 samples (1 and 4 channels, sigma 0.5 to 3): largest
 * difference 3.1e-5.
 */
export function gaussianBlur(src: FloatImage, sigma: number): FloatImage {
  const ksize = gaussianKernelSize(sigma);
  const k = gaussianKernel(ksize, sigma);
  const r = (ksize - 1) / 2;
  const { width: w, height: h, channels: ch } = src;
  const tmp = new Float64Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let i = 0; i < ksize; i++) s += k[i] * src.data[(y * w + reflect101(x + i - r, w)) * ch + c];
        tmp[(y * w + x) * ch + c] = s;
      }
    }
  }
  const out = newFloatImage(w, h, ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let i = 0; i < ksize; i++) s += k[i] * tmp[(reflect101(y + i - r, h) * w + x) * ch + c];
        out.data[(y * w + x) * ch + c] = s;
      }
    }
  }
  return out;
}
