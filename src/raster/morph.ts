import { assertBinary, type Mask, newMask, RasterError } from './types.ts';

function assertKernel(op: string, kw: number, kh: number): void {
  if (!Number.isInteger(kw) || !Number.isInteger(kh) || kw < 1 || kh < 1) {
    throw new RasterError(`${op}: kernel ${kw}x${kh} is not a pair of positive integers`);
  }
}

/**
 * One separable pass of a rectangular max (dilate) or min (erode) filter.
 *
 * The window for output `x` is `[x - anchor, x - anchor + k)`, anchor
 * `floor(k / 2)` — cv2's default anchor `(-1, -1)` for a rectangular kernel,
 * which is not centred for an even `k`. Pixels outside the image are simply
 * not in the window, which is cv2's default border for morphology
 * (`morphologyDefaultBorderValue`): the image edge never dilates anything in
 * and never erodes anything away.
 *
 * `dilate`, `erode`, `morphClose`, `morphGradient` and `fillHoles` were each
 * measured bit-exact against cv2 4.13 / SciPy 1.17 on 30 random masks (24,478
 * pixels, kernels 1 to 7 wide and 1 to 5 tall, even sizes included).
 */
function pass(src: Uint8Array, w: number, h: number, k: number, horizontal: boolean, max: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  const anchor = Math.floor(k / 2);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  for (let line = 0; line < lines; line++) {
    for (let p = 0; p < len; p++) {
      const lo = Math.max(0, p - anchor);
      const hi = Math.min(len - 1, p - anchor + k - 1);
      let v = max ? 0 : 1;
      for (let q = lo; q <= hi; q++) {
        const s = horizontal ? src[line * w + q] : src[q * w + line];
        if (max ? s === 1 : s === 0) {
          v = max ? 1 : 0;
          break;
        }
      }
      out[horizontal ? line * w + p : p * w + line] = v;
    }
  }
  return out;
}

/** `cv2.dilate(mask, np.ones((kh, kw)))` on a binary mask. */
export function dilate(m: Mask, kw: number, kh: number = kw): Mask {
  assertKernel('dilate', kw, kh);
  assertBinary('dilate', m);
  const a = pass(m.data, m.width, m.height, kw, true, true);
  return { width: m.width, height: m.height, data: pass(a, m.width, m.height, kh, false, true) };
}

/** `cv2.erode(mask, np.ones((kh, kw)))` on a binary mask. */
export function erode(m: Mask, kw: number, kh: number = kw): Mask {
  assertKernel('erode', kw, kh);
  assertBinary('erode', m);
  const a = pass(m.data, m.width, m.height, kw, true, false);
  return { width: m.width, height: m.height, data: pass(a, m.width, m.height, kh, false, false) };
}

/** `cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((kh, kw)))`: dilate, then erode, same kernel. */
export function morphClose(m: Mask, kw: number, kh: number = kw): Mask {
  return erode(dilate(m, kw, kh), kw, kh);
}

/** `cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((kh, kw)))`: dilate minus erode. */
export function morphGradient(m: Mask, kw: number, kh: number = kw): Mask {
  const d = dilate(m, kw, kh);
  const e = erode(m, kw, kh);
  const out = newMask(m.width, m.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = d.data[i] === 1 && e.data[i] === 0 ? 1 : 0;
  return out;
}

/**
 * `scipy.ndimage.binary_fill_holes(mask)` with its default structure: every
 * background pixel that cannot reach the image border through 4-connected
 * background is foreground in the result.
 *
 * The 4-connectivity is scipy's default cross, and it matters: a background
 * pocket that touches the outside only through a diagonal gap is a hole here.
 */
export function fillHoles(m: Mask): Mask {
  assertBinary('fillHoles', m);
  const { width: w, height: h } = m;
  if (w === 0 || h === 0) return newMask(w, h);
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number): void => {
    if (m.data[i] === 0 && outside[i] === 0) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  const out = newMask(w, h);
  for (let i = 0; i < w * h; i++) out.data[i] = outside[i] === 1 ? 0 : 1;
  return out;
}
