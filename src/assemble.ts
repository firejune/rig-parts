/**
 * The assemble stage: two See-through runs over one painting — a FULL-body run
 * and a HEAD-crop run — merged into one set of rig-space parts, each part one
 * RGBA image cropped to its own alpha box, plus the `parts.json` measurement
 * record (`src/parts.ts`) and a flat recomposite to compare with the painting.
 *
 * Rig space is source pixels times `assemble.rig_scale`, y down, origin
 * top-left; the rig canvas is `trunc(w * s) x trunc(h * s)`. The painting is
 * resampled into it once (`sourceInRig`) and every "source" pixel below is a
 * pixel of that resample.
 *
 * Each See-through layer goes through five steps, each its own function with
 * its invariant stated where it is written:
 *
 *   1. `cleanGhosts`      — drop sub-threshold specks from a run-space layer;
 *   2. `layerToRig`       — resample the layer into rig space through its run's geometry;
 *   3. `projectSource`    — where the layer is the top-most opaque layer of its run,
 *                           take the painting's pixel instead of See-through's repaint;
 *   4. `mergeBelowCrop`   — a head-run part below the head crop is continued from a
 *                           full-run layer (whole components, `belowCrop`), and its
 *                           seam closed by `growRim`;
 *   5. `seamOverride`     — where the flat composite of the parts still differs from
 *                           the painting, the top-most part takes the painting's colour.
 *
 * This is a port of a reference implementation, and it is faithful to it by
 * default — measured against its outputs (ORACLE_assemble.md at the root of
 * the change that added this file). The places it deliberately is NOT are
 * named here, so none is found by accident:
 *
 * - **Refusals where the reference guessed or skipped.** A plan or extend
 *   entry naming a tag its run does not hold (the reference raised a KeyError),
 *   a part left with no opaque pixel (the reference printed `EMPTY` and wrote a
 *   `parts.json` without it), a head box outside the painting (the reference
 *   read row `-1` as the last row), a run whose canvas is not the configured
 *   resolution (the reference assumed 1024), and a landscape painting (the
 *   reference refused that too, as a bare exit).
 * - **`seamRule: 'silhouette'`** is available beside the faithful
 *   `'near-white'` rule. The reference's seam override skips every pixel whose
 *   painting colour is near-white (min channel above 235), which protects the
 *   background and also every white garment. The silhouette rule skips a
 *   near-white pixel only OUTSIDE the figure (`figureSilhouette`). Which one
 *   is the default is decided by measurement, recorded beside
 *   `DEFAULT_SEAM_RULE`.
 * - **`projectRule: 'visible'`** is available beside the faithful `'core'`
 *   rule (`ProjectRule`): the reference erodes every layer's top-most opaque
 *   area before projecting, so a part a few pixels wide takes nothing from the
 *   painting; `visible` erodes only along a rim with a later layer in front.
 * - **The visibility counts** (`visible_px`, `occluded_px`,
 *   `visible_not_projected_px`) are this port's, derived from the masks
 *   `projectSource` and `mergeBelowCrop` already build (`visibilityCounts`).
 * - **The recomposite's holes and error map** (`uncoveredHoles`,
 *   `recompositeErrorMap`) are this port's: the reference printed the
 *   uncovered count alone, which says a hole exists but not where.
 *
 * Pure: no clock, no randomness, no file access. The CLI reads and writes.
 */
import type { CharacterConfig, EarlyConfig, Extend, PlanEntry, Run } from './config.ts';
import { type Problem, refuseIfAny } from './errors.ts';
import { figuresPhrase, implausibleRules, type Layer, type LayerFigures, layerFigures, type LayerSet, NEAR_WHITE_MIN, OPAQUE_ALPHA_ABOVE, ruleSummary } from './layers.ts';
import type { PartRecord, PartsFile, RecompositeRecord } from './parts.ts';
import {
  alphaComposite,
  connectedComponents,
  crop,
  dilate,
  erode,
  fillHoles,
  gaussianBlur,
  type Mask,
  morphClose,
  newFloatImage,
  newMask,
  newRaster,
  type Raster,
  resize,
  warpAffine,
} from './raster/index.ts';
import { pyRound } from './round.ts';

const f32 = Math.fround;

// ---------------------------------------------------------------------------
// the reference's constants, each named once
// ---------------------------------------------------------------------------

/** Alpha at or above this is "opaque" for ownership, projection cores and the seam override. `>= 250`, not `== 255`: See-through leaves alpha-254 speckle. */
export const CORE_ALPHA = 250;
/** A ghost component is kept when its area is at least this many pixels … */
export const GHOST_MIN_AREA = 40;
/** … and at least this fraction of the layer's largest component. */
export const GHOST_MIN_FRACTION = 0.01;
/** The side of the square erosion that makes a projection core, and of the closing that fills speckle refusals. */
export const CORE_KERNEL = 5;
/** Projection is refused where See-through's pixel and the painting's differ by more than this, max channel. */
export const DRIFT_LIMIT = 90;
/** The Gaussian sigma that feathers the projection weight. */
export const FEATHER_SIGMA = 1.0;
/** Head-run projection stays this many rig pixels inside the head crop. */
export const HEAD_WINDOW_INSET = 3;
/** The head crop's bottom line in rig pixels is `trunc(y1 * s) - HEAD_BOTTOM_INSET`. */
export const HEAD_BOTTOM_INSET = 4;
/** `belowCrop` probes the head part this many rows above the crop line … */
export const CROP_PROBE_ROWS = 2;
/** … seeds components in this many rows from the crop line down … */
export const CROP_SEED_ROWS = 6;
/** … within this many columns of a column where the head part reaches the line. */
export const CROP_SEED_COLUMNS = 12;
/** Alpha above this counts as "the head part reaches the crop line". */
export const CROP_PROBE_ALPHA = 128;
/** Alpha at or above this in a later plan part keeps `growRim`'s ring off the pixel. */
export const FRONT_ALPHA = 128;
/** A painting pixel whose min channel is above this is "near-white" (the faithful rim and seam guard). Defined beside the layer reader, which applies the same test to a layer's colour (`layerFigures`). */
export { NEAR_WHITE_MIN };
/** The seam override acts where the flat composite differs from the painting by more than this, max channel. */
export const SEAM_LIMIT = 60;
/** `--propose-plan` drops a tag with fewer run-space opaque pixels than this after ghost clean-up. */
export const PROPOSE_MIN_PX = 150;
/** The recomposite's "error pixel": max-channel difference from the painting above this. */
export const ERROR_LIMIT = 40;
/** The recomposite's "within" figure: mean-channel difference at or below this. */
export const WITHIN_LIMIT = 8;
/**
 * An error pixel is "uncovered" when no part has alpha above this there. The
 * definition is the one the reference's own demo report measured with, and it
 * reproduces that report's figure exactly (1,564 on the reference's demo
 * output; with "no part has alpha above 0" the same output reads 105).
 */
export const COVERED_ALPHA = 128;
/** `figureSilhouette`: the border ring whose median colour is the background, in rig pixels. */
export const SILHOUETTE_BORDER = 8;
/** `figureSilhouette`: a pixel is figure where it differs from that median by more than this, max channel. */
export const SILHOUETTE_LIMIT = 40;

export type SeamRule = 'near-white' | 'silhouette';
export const SEAM_RULES: readonly SeamRule[] = ['near-white', 'silhouette'];

/**
 * The seam rule a run uses when none is named. Set by measurement, not taste:
 * the silhouette rule ships as the default only if it lowers the error pixel
 * count on every oracle character without raising mean |d| on any
 * (ORACLE_assemble.md, *faithful vs silhouette*).
 */
export const DEFAULT_SEAM_RULE: SeamRule = 'near-white';

/**
 * Where a layer may take the painting's pixel (`projectSource`). `core` is the
 * reference's rule: the layer's top-most `alpha >= 250` pixels eroded by a 5x5
 * square, so a part a few pixels wide has no core and none of its visible
 * pixels is projected. `visible` keeps the erosion only where it guards
 * something — along a rim where a later layer of the run is in front — and
 * projects every other top-most `alpha >= 250` pixel of the layer.
 */
export type ProjectRule = 'core' | 'visible';
export const PROJECT_RULES: readonly ProjectRule[] = ['core', 'visible'];

/**
 * The projection rule a run uses when none is named: the reference's, so the
 * examples stay comparable with it. `visible` was measured on both public
 * examples against it (the change that added the flag); it is opt-in.
 */
export const DEFAULT_PROJECT_RULE: ProjectRule = 'core';

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export interface Geometry {
  /** The painting's size in source pixels. */
  sourceW: number;
  sourceH: number;
  /** `seethrough.resolution`: both runs' canvas side. */
  resolution: number;
  /** `seethrough.head_box`, source pixels. */
  headBox: [number, number, number, number];
  /** `assemble.rig_scale`: rig pixels per source pixel. */
  rigScale: number;
}

export interface AssembleInput {
  /** The painting. Its alpha is ignored, as the reference's `convert("RGB")` drops it. */
  source: Raster;
  full: LayerSet;
  head: LayerSet;
  resolution: number;
  headBox: [number, number, number, number];
  rigScale: number;
  plan: PlanEntry[];
  extend: Extend[];
  seamRule: SeamRule;
  projectRule: ProjectRule;
}

/** The derived numbers of the two runs' geometry. */
interface Frame {
  W: number;
  H: number;
  S: number;
  /** Full run: the painting was centred on a white `side x side` square, padded this much on the left. */
  fullPad: number;
  fullK: number;
  headBox: [number, number, number, number];
  headK: number;
  /** The crop line in rig pixels. */
  headBottom: number;
}

/**
 * Check the geometry and derive the frame, refusing by name what the
 * reference would have mis-read. Every problem is collected.
 */
export function checkGeometry(g: Geometry, runs?: { full: LayerSet; head: LayerSet }): Frame {
  const problems: Problem[] = [];
  const fail = (code: string, object: string, detail: string): void => {
    problems.push({ code, object, detail });
  };
  const { sourceW: w, sourceH: h, resolution, headBox, rigScale: S } = g;
  const side = Math.max(w, h);
  if (h !== side) {
    fail('ASSEMBLE_SOURCE_PORTRAIT', 'source painting', `is ${w}x${h}, wider than tall; the full run pads the painting to a square horizontally only, so height >= width is required`);
  }
  const W = Math.trunc(w * S);
  const H = Math.trunc(h * S);
  if (W < 1 || H < 1) fail('ASSEMBLE_RIG_SIZE', 'config.assemble.rig_scale', `${S} makes a ${W}x${H} rig from a ${w}x${h} painting; at least 1x1 is required`);
  const [x0, y0, x1, y1] = headBox;
  if (!(x0 >= 0 && y0 >= 0 && x1 <= w && y1 <= h && x1 > x0 && y1 > y0)) {
    fail('ASSEMBLE_HEAD_BOX_INSIDE', 'config.seethrough.head_box', `is [${headBox.join(', ')}]; a non-empty box inside the ${w}x${h} painting is required`);
  }
  const headBottom = Math.trunc(y1 * S) - HEAD_BOTTOM_INSET;
  if (headBottom - CROP_PROBE_ROWS < 0 && y1 > y0) {
    fail(
      'ASSEMBLE_HEAD_BOX_INSIDE',
      'config.seethrough.head_box',
      `bottom ${y1} is rig row ${Math.trunc(y1 * S)}; the crop line (that row - ${HEAD_BOTTOM_INSET}) probes ${CROP_PROBE_ROWS} rows above itself, so a bottom at rig row ${HEAD_BOTTOM_INSET + CROP_PROBE_ROWS} or further down is required`,
    );
  }
  if (runs !== undefined) {
    for (const run of ['full', 'head'] as const) {
      const c = runs[run].canvas;
      if (c.w !== resolution || c.h !== resolution) {
        fail('ASSEMBLE_RUN_CANVAS', `the ${run} run (${runs[run].source})`, `has a ${c.w}x${c.h} canvas; config.seethrough.resolution ${resolution} makes ${resolution}x${resolution} required`);
      }
    }
  }
  refuseIfAny(problems);
  return {
    W,
    H,
    S,
    fullPad: Math.floor((side - w) / 2),
    fullK: side / resolution,
    headBox,
    headK: (x1 - x0) / resolution,
    headBottom,
  };
}

// ---------------------------------------------------------------------------
// step 1 — ghost clean-up
// ---------------------------------------------------------------------------

/**
 * Place a layer's pixels on its run's `resolution x resolution` canvas.
 * `readWrapperLayers`/`readPsdLayers` already refused a box outside it.
 */
export function placeLayer(layer: Layer, resolution: number): Raster {
  const out = newRaster(resolution, resolution);
  const p = layer.pixels;
  for (let y = 0; y < p.height; y++) {
    out.data.set(p.data.subarray(y * p.width * 4, (y + 1) * p.width * 4), ((layer.top + y) * resolution + layer.left) * 4);
  }
  return out;
}

/**
 * Step 1. See-through writes every tag, and an empty tag still carries a few
 * dozen sub-threshold pixels scattered at the canvas edge.
 *
 * ⚖️ Invariant: afterwards the layer's alpha is non-zero only on the 8-connected
 * components of `alpha > 8` whose area is at least `GHOST_MIN_AREA` and at
 * least `GHOST_MIN_FRACTION` of the largest component's; every other pixel —
 * including every pixel of alpha 8 or less — has alpha 0. Colour channels are
 * untouched. `ghostPx` counts the `alpha > 8` pixels removed. A layer with no
 * `alpha > 8` pixel comes back fully transparent with `ghostPx` 0.
 * (`assemble_parts.py` `clean`.)
 */
export function cleanGhosts(canvas: Raster): { canvas: Raster; ghostPx: number } {
  const { width: w, height: h } = canvas;
  const out: Raster = { width: w, height: h, data: new Uint8ClampedArray(canvas.data) };
  const m = newMask(w, h);
  let any = false;
  for (let i = 0; i < w * h; i++) {
    if (canvas.data[i * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
      m.data[i] = 1;
      any = true;
    }
  }
  if (!any) {
    for (let i = 0; i < w * h; i++) out.data[i * 4 + 3] = 0;
    return { canvas: out, ghostPx: 0 };
  }
  const cc = connectedComponents(m, 8);
  let big = 0;
  for (let l = 1; l < cc.count; l++) big = Math.max(big, cc.stats[l].area);
  const keep = new Uint8Array(cc.count);
  for (let l = 1; l < cc.count; l++) keep[l] = cc.stats[l].area >= Math.max(GHOST_MIN_AREA, GHOST_MIN_FRACTION * big) ? 1 : 0;
  let ghostPx = 0;
  for (let i = 0; i < w * h; i++) {
    const l = cc.labels[i];
    if (keep[l] === 0) {
      if (m.data[i] === 1) ghostPx++;
      out.data[i * 4 + 3] = 0;
    }
  }
  return { canvas: out, ghostPx };
}

export interface RunLayer {
  tag: string;
  /** The cleaned run-space canvas. */
  canvas: Raster;
  drawOrder: number;
  ghostPx: number;
  /** `alpha > 8` pixels after clean-up, in run pixels. */
  opaqueRunPx: number;
}

/** Every layer of a run, placed and cleaned, in draw order (back to front). */
export function runLayers(set: LayerSet, resolution: number): RunLayer[] {
  return set.layers.map((layer) => {
    const { canvas, ghostPx } = cleanGhosts(placeLayer(layer, resolution));
    let opaqueRunPx = 0;
    for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > OPAQUE_ALPHA_ABOVE) opaqueRunPx++;
    return { tag: layer.name, canvas, drawOrder: layer.drawOrder, ghostPx, opaqueRunPx };
  });
}

// ---------------------------------------------------------------------------
// step 2 — resample into rig space
// ---------------------------------------------------------------------------

/** The run-to-rig map: `rig = k * run + (tx, ty)`, in float32 as the reference's `np.float32` matrix holds it. */
export function runMap(frame: Frame, run: Run): { k: number; sx: number; tx: number; ty: number } {
  if (run === 'full') {
    const k = frame.fullK * frame.S;
    return { k, sx: f32(k), tx: f32(-frame.fullPad * frame.S), ty: 0 };
  }
  const k = frame.headK * frame.S;
  return { k, sx: f32(k), tx: f32(frame.headBox[0] * frame.S), ty: f32(frame.headBox[1] * frame.S) };
}

/**
 * Step 2. Warp a run-space layer into the `W x H` rig, premultiplied.
 *
 * ⚖️ Invariant: the result is `cv2.warpAffine` of the premultiplied layer
 * through `runMap` — bicubic when the map enlarges (`k >= 1`), and the
 * reference's `INTER_AREA` otherwise, which `warpAffine` answers with its
 * bilinear filter (`src/raster/warp.ts` measured that) — clipped to 0..255,
 * un-premultiplied, and truncated to 8 bits. Premultiplying and
 * un-premultiplying are done in float32, as numpy does them on a float32
 * array. A layer with no non-zero alpha maps to a fully transparent rig layer
 * without being warped: every tap would read 0.
 * (`assemble_parts.py` `to_rig`.)
 */
export function layerToRig(canvas: Raster, frame: Frame, run: Run): Raster {
  const { W, H } = frame;
  const n = canvas.width * canvas.height;
  let any = false;
  for (let i = 0; i < n && !any; i++) if (canvas.data[i * 4 + 3] !== 0) any = true;
  if (!any) return newRaster(W, H);
  const pre = newFloatImage(canvas.width, canvas.height, 4);
  for (let i = 0; i < n; i++) {
    const a = canvas.data[i * 4 + 3];
    const af = f32(a / 255);
    for (let c = 0; c < 3; c++) pre.data[i * 4 + c] = f32(canvas.data[i * 4 + c] * af);
    pre.data[i * 4 + 3] = a;
  }
  const m = runMap(frame, run);
  const wr = warpAffine(pre, { sx: m.sx, sy: m.sx, tx: m.tx, ty: m.ty }, W, H, m.k < 1 ? 'bilinear' : 'bicubic');
  const out = newRaster(W, H);
  const eps = f32(1e-3);
  const clip = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < W * H; i++) {
    const a = f32(clip(wr.data[i * 4 + 3]));
    for (let c = 0; c < 3; c++) {
      const v = f32(clip(wr.data[i * 4 + c]));
      out.data[i * 4 + c] = a > 0 ? Math.trunc(clip(f32(f32(v * 255) / Math.max(a, eps)))) : 0;
    }
    out.data[i * 4 + 3] = Math.trunc(a);
  }
  return out;
}

/**
 * The painting in rig space: `PIL.Image.resize(..., LANCZOS)` of its RGB, as
 * an opaque raster. (`src/raster/resize.ts` `lanczos3` is PIL's, bit-exact;
 * with alpha 255 its premultiply round trip is the identity.)
 */
export function sourceInRig(source: Raster, W: number, H: number): Raster {
  const rgb: Raster = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) };
  for (let i = 3; i < rgb.data.length; i += 4) rgb.data[i] = 255;
  return resize(rgb, W, H, 'lanczos3');
}

// ---------------------------------------------------------------------------
// step 3 — source projection
// ---------------------------------------------------------------------------

export interface ProjectionStats {
  core: number;
  taken: number;
  refused: number;
  /**
   * Where no later layer of the run is opaque (`alpha >= 250`) in front of
   * this one: the run's owner of the pixel is this layer or one behind it. A
   * pixel of this layer with alpha above 8 is VISIBLE exactly where this is
   * set, and OCCLUDED everywhere else.
   */
  clear: Mask;
  /** The pixels counted in `taken`: the accepted set, cut to the core. */
  takenMask: Mask;
}

function maxDiff(a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number): number {
  return Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
}

/**
 * Step 3, over one run's layers in draw order. Modifies each rig layer's
 * colour in place and returns its counts.
 *
 * ⚖️ Invariant: a layer's CORE is where it is the top-most `alpha >= 250`
 * layer of its own run, eroded by a 5x5 square. Inside the core, the pixels
 * that agree with the painting (max channel difference <= `DRIFT_LIMIT`),
 * closed by 5x5 and cut back to the core — and, for the head run, kept
 * `HEAD_WINDOW_INSET` pixels inside the head crop — are the ACCEPTED set. The
 * colour becomes `w * painting + (1 - w) * layer`, truncated, with `w` the
 * accepted set blurred by a Gaussian of sigma 1 and zeroed outside the core;
 * outside the core nothing changes, alpha never changes, and occluded pixels
 * keep See-through's synthesis. `core`, `taken` (accepted) and `refused` (core
 * pixels over the drift limit, before closing) are counted.
 * (`assemble_parts.py` `main`, the per-run loop.)
 *
 * With `rule: 'visible'` (NOT in the reference) the core is the top-most
 * `alpha >= 250` set less every pixel within the 5x5 square of a pixel where a
 * LATER layer of the run is the owner — the erosion kept only along a rim with
 * a neighbour in front, where the painting's pixel may be that neighbour's
 * edge. Every other step is the same. Fringe pixels (alpha below 250) are not
 * projected under either rule: the painting there is this layer blended with
 * what is behind it.
 *
 * Both rules return `clear` (no later layer is the owner) and `takenMask`, the
 * masks the part counts in `parts.json` are derived from; `takenMask` is a
 * subset of the top-most set, and so of `clear`.
 */
export function projectSource(rigLayers: Raster[], srcr: Raster, frame: Frame, run: Run, rule: ProjectRule = DEFAULT_PROJECT_RULE): ProjectionStats[] {
  const { W, H } = frame;
  const owner = new Int32Array(W * H).fill(-1);
  rigLayers.forEach((r, i) => {
    for (let p = 0; p < W * H; p++) if (r.data[p * 4 + 3] >= CORE_ALPHA) owner[p] = i;
  });
  let win: Mask | null = null;
  if (run === 'head') {
    win = newMask(W, H);
    const [bx0, by0, bx1, by1] = frame.headBox;
    const x0 = Math.max(0, Math.trunc(bx0 * frame.S) + HEAD_WINDOW_INSET);
    const y0 = Math.max(0, Math.trunc(by0 * frame.S) + HEAD_WINDOW_INSET);
    const x1 = Math.min(W, Math.trunc(bx1 * frame.S) - HEAD_WINDOW_INSET);
    const y1 = Math.min(H, Math.trunc(by1 * frame.S) - HEAD_WINDOW_INSET);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) win.data[y * W + x] = 1;
  }
  return rigLayers.map((r, i) => {
    const top = newMask(W, H);
    const clear = newMask(W, H);
    const takenMask = newMask(W, H);
    let anyTop = false;
    for (let p = 0; p < W * H; p++) {
      if (owner[p] <= i) clear.data[p] = 1;
      if (owner[p] === i && r.data[p * 4 + 3] >= CORE_ALPHA) {
        top.data[p] = 1;
        anyTop = true;
      }
    }
    if (!anyTop) return { core: 0, taken: 0, refused: 0, clear, takenMask };
    let core: Mask;
    if (rule === 'core') core = erode(top, CORE_KERNEL);
    else {
      const front = newMask(W, H);
      for (let p = 0; p < W * H; p++) if (owner[p] > i) front.data[p] = 1;
      const rim = dilate(front, CORE_KERNEL);
      core = newMask(W, H);
      for (let p = 0; p < W * H; p++) if (top.data[p] === 1 && rim.data[p] === 0) core.data[p] = 1;
    }
    const ok = newMask(W, H);
    let coreN = 0;
    let refused = 0;
    for (let p = 0; p < W * H; p++) {
      if (core.data[p] === 0) continue;
      coreN++;
      if (maxDiff(r.data, p * 4, srcr.data, p * 4) <= DRIFT_LIMIT) ok.data[p] = 1;
      else refused++;
    }
    const closed = morphClose(ok, CORE_KERNEL);
    const okf = newFloatImage(W, H, 1);
    let taken = 0;
    for (let p = 0; p < W * H; p++) {
      const v = closed.data[p] === 1 && core.data[p] === 1 && (win === null || win.data[p] === 1) ? 1 : 0;
      okf.data[p] = v;
      takenMask.data[p] = v;
      taken += v;
    }
    const blurred = gaussianBlur(okf, FEATHER_SIGMA);
    for (let p = 0; p < W * H; p++) {
      if (core.data[p] === 0) continue;
      const w = blurred.data[p];
      const rest = f32(1 - w);
      for (let c = 0; c < 3; c++) {
        const v = f32(f32(w * srcr.data[p * 4 + c]) + f32(rest * r.data[p * 4 + c]));
        r.data[p * 4 + c] = Math.trunc(v < 0 ? 0 : v > 255 ? 255 : v);
      }
    }
    return { core: coreN, taken, refused, clear, takenMask };
  });
}

// ---------------------------------------------------------------------------
// step 4 — merge below the head crop
// ---------------------------------------------------------------------------

/**
 * The pixels of `extra` (a full-run layer in rig space) that continue `part`
 * below the crop line.
 *
 * ⚖️ Invariant: the result is every 8-connected component of `extra`'s
 * `alpha > 8` pixels at or below row `headBottom` that has a pixel in rows
 * `headBottom .. headBottom + 5` within `CROP_SEED_COLUMNS` columns of a column
 * where `part` has alpha above 128 on row `headBottom - 2`. Whole components,
 * so a long lock keeps its own outline to the tip. Empty when `part` does not
 * reach the line or `extra` has nothing below it.
 * (`assemble_parts.py` `below_crop`.)
 */
export function belowCrop(part: Raster, extra: Raster, headBottom: number): Mask {
  const { width: W, height: H } = part;
  const sel = newMask(W, H);
  const below = newMask(W, H);
  let anyBelow = false;
  for (let y = Math.max(0, headBottom); y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (extra.data[(y * W + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
        below.data[y * W + x] = 1;
        anyBelow = true;
      }
    }
  }
  const probe = headBottom - CROP_PROBE_ROWS;
  const near = new Uint8Array(W);
  let anyCol = false;
  for (let x = 0; x < W; x++) {
    if (part.data[(probe * W + x) * 4 + 3] > CROP_PROBE_ALPHA) {
      anyCol = true;
      for (let c = Math.max(0, x - CROP_SEED_COLUMNS); c <= Math.min(W - 1, x + CROP_SEED_COLUMNS); c++) near[c] = 1;
    }
  }
  if (!anyCol || !anyBelow) return sel;
  const cc = connectedComponents(below, 8);
  const chosen = new Uint8Array(cc.count);
  for (let y = Math.max(0, headBottom); y < Math.min(H, headBottom + CROP_SEED_ROWS); y++) {
    for (let x = 0; x < W; x++) {
      const l = cc.labels[y * W + x];
      if (l > 0 && near[x] === 1) chosen[l] = 1;
    }
  }
  for (let p = 0; p < W * H; p++) if (chosen[cc.labels[p]] === 1 && extra.data[p * 4 + 3] > 0) sel.data[p] = 1;
  return sel;
}

/**
 * Close the half-pixel seam round a merged-in piece: the full run's silhouette
 * is a few pixels narrower than the painting, and a renderer's sub-pixel
 * resample shows the layer beneath along that edge.
 *
 * ⚖️ Invariant: the RING is the 3x3 dilation of `sel`'s `alpha >= 250` pixels,
 * restricted to pixels where `part` has alpha below 250, the painting is not
 * near-white (min channel <= 235) and no later plan part covers
 * (`front`, alpha >= 128). Every ring pixel takes the painting's colour at
 * alpha 255, so the flat composite there equals the painting; the count is
 * returned. Nothing changes when `sel` is empty. When `touched` is given,
 * every ring pixel written is set in it.
 * (`assemble_parts.py` `grow_rim`.)
 */
export function growRim(part: Raster, sel: Mask, srcr: Raster, front: Mask | null, touched?: Mask): number {
  const { width: W, height: H } = part;
  const core = newMask(W, H);
  let anySel = false;
  for (let p = 0; p < W * H; p++) {
    if (sel.data[p] === 1) {
      anySel = true;
      if (part.data[p * 4 + 3] >= CORE_ALPHA) core.data[p] = 1;
    }
  }
  if (!anySel) return 0;
  const ring = dilate(core, 3);
  let grown = 0;
  for (let p = 0; p < W * H; p++) {
    if (ring.data[p] === 0 || part.data[p * 4 + 3] >= CORE_ALPHA) continue;
    const s = p * 4;
    if (Math.min(srcr.data[s], srcr.data[s + 1], srcr.data[s + 2]) > NEAR_WHITE_MIN) continue;
    if (front !== null && front.data[p] === 1) continue;
    part.data[s] = srcr.data[s];
    part.data[s + 1] = srcr.data[s + 1];
    part.data[s + 2] = srcr.data[s + 2];
    part.data[s + 3] = 255;
    if (touched !== undefined) touched.data[p] = 1;
    grown++;
  }
  return grown;
}

/**
 * Step 4 for one part. Modifies `part` in place and returns `merged_px`.
 *
 * ⚖️ Invariant: for each `extend_below_crop` entry naming this part, the
 * `belowCrop` pixels are copied from the extend layer (colour and alpha), then
 * `growRim` closes their seam against the later plan parts. `merged_px` is the
 * copied pixels plus the ring of the LAST such entry — the reference assigns
 * rather than adds, and that is kept (a part with one entry, the only case the
 * reference's corpus has, is unaffected).
 *
 * When `trace` is given, every pixel an entry wrote (copied or ring) has
 * `trace.from` set to that entry's index in `extras`, a later entry
 * overwriting an earlier one — the layer whose run says whether the pixel is
 * visible — and `trace.ring` set when the last write was the ring's.
 */
export function mergeBelowCrop(part: Raster, extras: Raster[], front: Mask, srcr: Raster, headBottom: number, trace?: MergeTrace): number {
  let merged = 0;
  extras.forEach((extra, e) => {
    const sel = belowCrop(part, extra, headBottom);
    let copied = 0;
    for (let p = 0; p < sel.data.length; p++) {
      if (sel.data[p] === 0) continue;
      copied++;
      part.data.set(extra.data.subarray(p * 4, p * 4 + 4), p * 4);
      if (trace !== undefined) {
        trace.from[p] = e;
        trace.ring.data[p] = 0;
      }
    }
    const ring = newMask(part.width, part.height);
    merged = copied + growRim(part, sel, srcr, front, ring);
    if (trace !== undefined) {
      for (let p = 0; p < ring.data.length; p++) {
        if (ring.data[p] === 1) {
          trace.from[p] = e;
          trace.ring.data[p] = 1;
        }
      }
    }
  });
  return merged;
}

/** Which extend entry last wrote each pixel (-1: none), and whether that write was the ring's. */
export interface MergeTrace {
  from: Int32Array;
  ring: Mask;
}

export interface VisibilityCounts {
  visible_px: number;
  occluded_px: number;
  visible_not_projected_px: number;
  /** The part's projected pixels, the part layer's and any a merge copied in. */
  projected: number;
}

/**
 * The visibility counts of one part, from the masks its pixels were made
 * with, refusing — as a bug, not a report — when they do not add up.
 *
 * ⚖️ Invariant: `opaque` is the part's `alpha > 8` pixels; `visible` the pixels
 * set in `visible`; `occluded` the opaque pixels NOT set in it; `projected` the
 * pixels set in `projected`. Required: `visible + occluded = opaque` (so every
 * visible pixel is opaque) and every projected pixel is visible;
 * `visible_not_projected = visible - projected`. The assembler builds
 * `visible` as the opaque pixels no later layer of their run is in front of,
 * and `projected` as the accepted set of `projectSource`, so both hold by
 * construction and a refusal here names a mask that escaped its definition.
 */
export function visibilityCounts(object: string, part: Raster, visible: Mask, projected: Mask): VisibilityCounts {
  const n = part.width * part.height;
  let opaque = 0;
  let vis = 0;
  let occ = 0;
  let proj = 0;
  let projHidden = 0;
  for (let p = 0; p < n; p++) {
    const o = part.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE;
    if (o) opaque++;
    if (visible.data[p] === 1) vis++;
    else if (o) occ++;
    if (projected.data[p] === 1) {
      proj++;
      if (visible.data[p] !== 1) projHidden++;
    }
  }
  const problems: Problem[] = [];
  if (vis + occ !== opaque) {
    problems.push({
      code: 'ASSEMBLE_COUNTS_ADD_UP',
      object,
      detail: `visible ${vis} + occluded ${occ} = ${vis + occ}, opaque (alpha above ${OPAQUE_ALPHA_ABOVE}) ${opaque}; equal is required — the visible mask holds ${vis + occ - opaque} pixel(s) that are not opaque (a bug in the assembler, not in the inputs)`,
    });
  }
  if (projHidden > 0) {
    problems.push({
      code: 'ASSEMBLE_COUNTS_ADD_UP',
      object,
      detail: `${projHidden} of ${proj} projected pixel(s) are not visible; projected <= visible, pixel by pixel, is required — a pixel a later layer covers was taken from the painting (a bug in the assembler, not in the inputs)`,
    });
  }
  refuseIfAny(problems);
  return { visible_px: vis, occluded_px: occ, visible_not_projected_px: vis - proj, projected: proj };
}

// ---------------------------------------------------------------------------
// step 5 — seam override
// ---------------------------------------------------------------------------

/**
 * The figure, as a mask over the rig: the pixels whose colour differs from
 * the median colour of the painting's outer `SILHOUETTE_BORDER`-pixel ring by
 * more than `SILHOUETTE_LIMIT` (max channel), opened twice by a 3x3 square
 * (erode twice, dilate twice) to drop edge noise, with every enclosed hole
 * filled — so a white blouse inside the figure's outline is figure, and the
 * white page round it is not. Computed once, from the painting alone.
 *
 * This is NOT in the reference. It is the input of `seamRule: 'silhouette'`.
 */
export function figureSilhouette(srcr: Raster): Mask {
  const { width: W, height: H } = srcr;
  const ring: number[][] = [[], [], []];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (y >= SILHOUETTE_BORDER && y < H - SILHOUETTE_BORDER && x >= SILHOUETTE_BORDER && x < W - SILHOUETTE_BORDER) continue;
      for (let c = 0; c < 3; c++) ring[c].push(srcr.data[(y * W + x) * 4 + c]);
    }
  }
  const median = ring.map((v) => {
    const s = [...v].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  });
  const fig = newMask(W, H);
  for (let p = 0; p < W * H; p++) {
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(srcr.data[p * 4 + c] - median[c])));
    if (d > SILHOUETTE_LIMIT) fig.data[p] = 1;
  }
  const opened = dilate(dilate(erode(erode(fig, 3), 3), 3), 3);
  return fillHoles(opened);
}

export interface PlacedPart {
  record: PartRecord;
  image: Raster;
}

/**
 * Step 5, over every part in plan order. Modifies the part images in place and
 * sets each record's `seam_override_px`.
 *
 * ⚖️ Invariant: over the flat composite of the parts on white (float, as the
 * reference composites), a CANDIDATE is a pixel differing from the painting by
 * more than `SEAM_LIMIT` (max channel) that some part covers (alpha > 0) and
 * that the rule admits — `near-white` (the reference's): the painting's min
 * channel is <= 235; `silhouette`: that, OR the pixel is inside
 * `figureSilhouette` — so a near-white painting pixel is protected only
 * outside the figure, which is the background the reference's guard exists
 * to protect. (Replacing the whiteness test by the silhouette outright was
 * measured and rejected: the opened mask loses figure-edge pixels the
 * whiteness test admits, and error px rose on eight of ten oracle
 * characters — ORACLE_assemble.md.)
 * Each candidate is recoloured to the painting's colour in the TOP-MOST part
 * covering it, and only where that part's alpha is >= 250; alpha never
 * changes. Candidates are chosen once, before any recolouring.
 * (`assemble_parts.py` `main`, "5. seam override".)
 */
export function seamOverride(parts: PlacedPart[], srcr: Raster, rule: SeamRule, silhouette: Mask | null): void {
  const { width: W, height: H } = srcr;
  const top = new Int32Array(W * H).fill(-1);
  const can = new Float64Array(W * H * 3).fill(255);
  parts.forEach(({ record: p, image }, i) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const s = (y * p.w + x) * 4;
        const d = (p.y + y) * W + p.x + x;
        const alpha = image.data[s + 3];
        if (alpha > 0) top[d] = i;
        const a = f32(alpha / 255);
        const one = f32(1 - a);
        for (let c = 0; c < 3; c++) can[d * 3 + c] = can[d * 3 + c] * one + f32(image.data[s + c] * a);
      }
    }
  });
  const cand = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    if (top[p] < 0) continue;
    const s = p * 4;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(can[p * 3 + c] - srcr.data[s + c]));
    if (!(d > SEAM_LIMIT)) continue;
    const painted = Math.min(srcr.data[s], srcr.data[s + 1], srcr.data[s + 2]) <= NEAR_WHITE_MIN;
    const admitted = rule === 'near-white' ? painted : painted || (silhouette !== null && silhouette.data[p] === 1);
    if (admitted) cand[p] = 1;
  }
  parts.forEach(({ record: p, image }, i) => {
    let n = 0;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const d = (p.y + y) * W + p.x + x;
        const s = (y * p.w + x) * 4;
        if (cand[d] === 0 || top[d] !== i || image.data[s + 3] < CORE_ALPHA) continue;
        image.data[s] = srcr.data[d * 4];
        image.data[s + 1] = srcr.data[d * 4 + 1];
        image.data[s + 2] = srcr.data[d * 4 + 2];
        n++;
      }
    }
    p.seam_override_px = n;
  });
}

// ---------------------------------------------------------------------------
// the recomposite
// ---------------------------------------------------------------------------

export interface RecompositeFigures {
  /** Mean over pixels of the mean-channel |recomposite - painting|. */
  meanAbs: number;
  /** Fraction of pixels whose mean-channel difference is <= `WITHIN_LIMIT`. */
  within: number;
  /** Pixels whose max-channel difference is > `ERROR_LIMIT`. */
  errorPx: number;
  /** Of those, the ones no part covers (no part has alpha above `COVERED_ALPHA`). */
  uncoveredErrorPx: number;
  /** The 8-connected components of the uncovered error pixels: how many there are … */
  holeCount: number;
  /** … and the largest `HOLES_LISTED` of them, largest first (`uncoveredHoles`). */
  holes: RecompositeHole[];
}

/** How many uncovered holes the assemble summary and `parts.json` list, largest first. */
export const HOLES_LISTED = 5;

/** A part beside an uncovered hole: how many of its covered pixels touch the hole. */
export interface HoleBorder {
  part: string;
  px: number;
}

/** One 8-connected component of the uncovered error pixels, in rig pixels (y down, origin top-left). */
export interface RecompositeHole {
  px: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Every part bordering the hole, most border pixels first, then plan order; empty when it borders none. */
  borders: HoleBorder[];
}

/** The parts composited in plan order onto opaque white, as `PIL.Image.alpha_composite` does it. */
export function recomposite(parts: PlacedPart[], W: number, H: number): Raster {
  let can = newRaster(W, H);
  can.data.fill(255);
  for (const { record: p, image } of parts) can = alphaComposite(can, image, p.x, p.y);
  return can;
}

/** Per rig pixel: 1 where some part has alpha above `COVERED_ALPHA`. */
function coveredMask(parts: PlacedPart[], W: number, H: number): Uint8Array {
  const covered = new Uint8Array(W * H);
  for (const { record: p, image } of parts) {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (image.data[(y * p.w + x) * 4 + 3] > COVERED_ALPHA) covered[(p.y + y) * W + p.x + x] = 1;
  }
  return covered;
}

/** Per rig pixel: 1 where the recomposite's max-channel difference from the painting is above `ERROR_LIMIT`. */
function errorMask(can: Raster, srcr: Raster): Uint8Array {
  const n = srcr.width * srcr.height;
  const err = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    let m = 0;
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(can.data[p * 4 + c] - srcr.data[p * 4 + c]));
    if (m > ERROR_LIMIT) err[p] = 1;
  }
  return err;
}

/**
 * The uncovered error pixels as holes: every 8-connected component of the
 * pixels whose recomposite differs from the painting by more than
 * `ERROR_LIMIT` (max channel) and that no part covers (alpha above
 * `COVERED_ALPHA`) — the pixels `uncoveredErrorPx` counts, so the components'
 * areas sum to it.
 *
 * ⚖️ Invariant: a hole's box is its pixels' bounding box; its `borders` are
 * the parts with a covered pixel 8-adjacent to one of its pixels, each with
 * the number of such pixels it covers (a pixel two parts cover counts for
 * both), most first and then in plan order. Holes are sorted by area, largest
 * first, then by the box's top row and left column, so the order is a
 * function of the pixels and not of a labelling scan. 8-connectivity is the
 * reference's own for blobs (`cv2.connectedComponentsWithStats(…, 8)` in
 * ghost clean-up): a hole joined only at a corner is one hole.
 *
 * This is not in the reference, whose report stopped at the count. The count
 * cannot say where to look; a box and the parts round it can.
 */
export function uncoveredHoles(can: Raster, srcr: Raster, parts: PlacedPart[]): { count: number; holes: RecompositeHole[] } {
  const { width: W, height: H } = srcr;
  const covered = coveredMask(parts, W, H);
  const err = errorMask(can, srcr);
  const mask = newMask(W, H);
  for (let p = 0; p < W * H; p++) if (err[p] === 1 && covered[p] === 0) mask.data[p] = 1;
  const cc = connectedComponents(mask, 8);
  const all = cc.stats.slice(1).filter((s) => s.area > 0);
  all.sort((a, b) => b.area - a.area || a.top - b.top || a.left - b.left);
  const listed = all.slice(0, HOLES_LISTED);
  const holes = listed.map((s): RecompositeHole => {
    const borders: HoleBorder[] = [];
    parts.forEach(({ record: p, image }) => {
      let n = 0;
      // A part pixel can touch the hole only inside the hole's box grown by one.
      const x0 = Math.max(p.x, s.left - 1);
      const x1 = Math.min(p.x + p.w - 1, s.left + s.width);
      const y0 = Math.max(p.y, s.top - 1);
      const y1 = Math.min(p.y + p.h - 1, s.top + s.height);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (image.data[((y - p.y) * p.w + (x - p.x)) * 4 + 3] <= COVERED_ALPHA) continue;
          let touches = false;
          for (let dy = -1; dy <= 1 && !touches; dy++) {
            for (let dx = -1; dx <= 1 && !touches; dx++) {
              const u = x + dx;
              const v = y + dy;
              if (u >= 0 && u < W && v >= 0 && v < H && cc.labels[v * W + u] === s.label) touches = true;
            }
          }
          if (touches) n++;
        }
      }
      if (n > 0) borders.push({ part: p.name, px: n });
    });
    // Array.prototype.sort is stable, so equal counts keep plan order.
    borders.sort((a, b) => b.px - a.px);
    return { px: s.area, x: s.left, y: s.top, w: s.width, h: s.height, borders };
  });
  return { count: all.length, holes };
}

export function measureRecomposite(can: Raster, srcr: Raster, parts: PlacedPart[]): RecompositeFigures {
  const { width: W, height: H } = srcr;
  const covered = coveredMask(parts, W, H);
  let sum = 0;
  let within = 0;
  let errorPx = 0;
  let uncoveredErrorPx = 0;
  for (let p = 0; p < W * H; p++) {
    let s = 0;
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(can.data[p * 4 + c] - srcr.data[p * 4 + c]);
      s += d;
      m = Math.max(m, d);
    }
    const mean = s / 3;
    sum += mean;
    if (mean <= WITHIN_LIMIT) within++;
    if (m > ERROR_LIMIT) {
      errorPx++;
      if (covered[p] === 0) uncoveredErrorPx++;
    }
  }
  const { count, holes } = uncoveredHoles(can, srcr, parts);
  return { meanAbs: sum / (W * H), within: within / (W * H), errorPx, uncoveredErrorPx, holeCount: count, holes };
}

/** The error map's colour for an uncovered error pixel: no part is there, so the page shows through. */
export const MAP_UNCOVERED: readonly [number, number, number] = [255, 0, 0];
/** … for a covered error pixel: a part is there, in a colour more than `ERROR_LIMIT` off the painting's. */
export const MAP_MISMATCHED: readonly [number, number, number] = [0, 0, 255];

/**
 * The error map, `recomposite_error_rig.png`: the rig canvas, opaque, with
 * every uncovered error pixel `MAP_UNCOVERED` (red), every covered error pixel
 * `MAP_MISMATCHED` (blue), and every other pixel the painting in grey, dimmed
 * to the top quarter of the range — `192 + floor(luma / 4)`, luma the integer
 * BT.601 `(299 R + 587 G + 114 B + 500) / 1000` truncated.
 *
 * Why the painting dimmed rather than transparent: the map is read at contact-
 * sheet size, and a red blob on nothing says a hole exists but not where on
 * the figure it is; on a faint grey figure it sits between the legs it falls
 * between. Why grey and light: no pixel of the dimmed painting can be either
 * flag colour (a grey has equal channels, and at 192..255 it is lighter than
 * both), so the two colours mean exactly the two masks. Integer arithmetic
 * only, so the bytes are deterministic.
 */
export function recompositeErrorMap(can: Raster, srcr: Raster, parts: PlacedPart[]): Raster {
  const { width: W, height: H } = srcr;
  const covered = coveredMask(parts, W, H);
  const err = errorMask(can, srcr);
  const map = newRaster(W, H);
  for (let p = 0; p < W * H; p++) {
    const s = p * 4;
    let rgb: readonly [number, number, number];
    if (err[p] === 1) rgb = covered[p] === 0 ? MAP_UNCOVERED : MAP_MISMATCHED;
    else {
      const luma = Math.floor((299 * srcr.data[s] + 587 * srcr.data[s + 1] + 114 * srcr.data[s + 2] + 500) / 1000);
      const g = 192 + Math.floor(luma / 4);
      rgb = [g, g, g];
    }
    map.data[s] = rgb[0];
    map.data[s + 1] = rgb[1];
    map.data[s + 2] = rgb[2];
    map.data[s + 3] = 255;
  }
  return map;
}

export function figuresLine(f: RecompositeFigures): string {
  return (
    `recomposite vs source: mean |d|=${f.meanAbs.toFixed(2)}, within ${WITHIN_LIMIT}: ${(100 * f.within).toFixed(1)}%, ` +
    `error px > ${ERROR_LIMIT}: ${f.errorPx}, uncovered error px: ${f.uncoveredErrorPx}`
  );
}

/** A hole's box as the part lines and refusals print a box: `x,y wxh`. */
export function holeBox(h: RecompositeHole): string {
  return `${h.x},${h.y} ${h.w}x${h.h}`;
}

/**
 * The hole lines under `figuresLine`: the count, then one line per listed
 * hole — `uncovered hole 1: 2340 px at 412,1088 30x78 (between "legwear_r"
 * 120 px, "legwear_l" 96 px)`, or `(borders no part)`.
 */
export function holeLines(f: RecompositeFigures): string[] {
  const head = `uncovered holes (8-connected): ${f.holeCount}${f.holeCount > f.holes.length ? `, the largest ${f.holes.length} listed` : ''}`;
  return [
    head,
    ...f.holes.map(
      (h, i) =>
        `  uncovered hole ${i + 1}: ${h.px} px at ${holeBox(h)} (${h.borders.length === 0 ? 'borders no part' : `between ${h.borders.map((b) => `"${b.part}" ${b.px} px`).join(', ')}`})`,
    ),
  ];
}

/** The `parts.json` `recomposite` block: the four figures, the limits they were measured at, and the listed holes. */
export function recompositeRecord(f: RecompositeFigures): RecompositeRecord {
  return {
    mean_abs: pyRound(f.meanAbs, 3),
    within_limit: WITHIN_LIMIT,
    within_share: pyRound(f.within, 4),
    error_limit: ERROR_LIMIT,
    error_px: f.errorPx,
    covered_alpha: COVERED_ALPHA,
    uncovered_error_px: f.uncoveredErrorPx,
    hole_count: f.holeCount,
    holes_listed: HOLES_LISTED,
    holes: f.holes.map((h) => ({ px: h.px, x: h.x, y: h.y, w: h.w, h: h.h, borders: h.borders.map((b) => ({ part: b.part, px: b.px })) })),
  };
}

// ---------------------------------------------------------------------------
// the stage
// ---------------------------------------------------------------------------

export interface AssembleResult {
  parts: PartsFile;
  /** In plan order, each cropped to its record's box. */
  images: PlacedPart[];
  recomposite: Raster;
  /** `recompositeErrorMap`: uncovered error pixels red, covered ones blue, the painting dimmed grey. */
  errorMap: Raster;
  figures: RecompositeFigures;
  seamRule: SeamRule;
  projectRule: ProjectRule;
}

function tagsOf(set: LayerSet): Set<string> {
  return new Set(set.layers.map((l) => l.name));
}

/**
 * Refuse, by name, every plan and extend entry whose tag its run does not
 * hold. Collected before any pixel work.
 */
export function checkPlanAgainstRuns(plan: PlanEntry[], extend: Extend[], full: LayerSet, head: LayerSet): void {
  const tags = { full: tagsOf(full), head: tagsOf(head) };
  const problems: Problem[] = [];
  const known = (run: Run): string => [...tags[run]].sort().join(', ');
  plan.forEach(([name, run, tag], i) => {
    if (!tags[run].has(tag)) {
      problems.push({
        code: 'ASSEMBLE_PLAN_TAG_IN_RUN',
        object: `config.assemble.plan[${i}] (part "${name}")`,
        detail: `takes ${run}:${tag}; the ${run} run has no layer "${tag}" — it holds ${known(run)}`,
      });
    }
  });
  extend.forEach((e, i) => {
    if (!tags[e.run].has(e.tag)) {
      problems.push({
        code: 'ASSEMBLE_EXTEND_TAG_IN_RUN',
        object: `config.assemble.extend_below_crop[${i}] (part "${e.part}")`,
        detail: `takes ${e.run}:${e.tag}; the ${e.run} run has no layer "${e.tag}" — it holds ${known(e.run)}`,
      });
    }
  });
  refuseIfAny(problems);
}

/**
 * Run the stage in memory. Everything that can be refused is refused before
 * this returns; nothing here writes a file, so a caller that writes only
 * after this returned writes only after green.
 */
export function assemble(input: AssembleInput): AssembleResult {
  const { source, full, head, plan, extend, seamRule, projectRule } = input;
  const frame = checkGeometry(
    { sourceW: source.width, sourceH: source.height, resolution: input.resolution, headBox: input.headBox, rigScale: input.rigScale },
    { full, head },
  );
  checkPlanAgainstRuns(plan, extend, full, head);
  const { W, H } = frame;
  const srcr = sourceInRig(source, W, H);

  const rig = new Map<string, Raster>();
  const stats = new Map<string, ProjectionStats>();
  const ghost: Record<string, number> = {};
  for (const [run, set] of [['full', full], ['head', head]] as const) {
    const layers = runLayers(set, input.resolution);
    const rigLayers = layers.map((l) => layerToRig(l.canvas, frame, run));
    const st = projectSource(rigLayers, srcr, frame, run, projectRule);
    layers.forEach((l, i) => {
      rig.set(`${run}:${l.tag}`, rigLayers[i]);
      stats.set(`${run}:${l.tag}`, st[i]);
      ghost[`${run}:${l.tag}`] = l.ghostPx;
    });
  }

  const placed: PlacedPart[] = [];
  const empty: Problem[] = [];
  plan.forEach(([name, run, tag], pi) => {
    const key = `${run}:${tag}`;
    const src = rig.get(key) as Raster;
    const r: Raster = { width: W, height: H, data: new Uint8ClampedArray(src.data) };
    const st = stats.get(key) as ProjectionStats;
    const extendKeys = extend.filter((e) => e.part === name).map((e) => `${e.run}:${e.tag}`);
    const extras = extendKeys.map((k) => rig.get(k) as Raster);
    let merged = 0;
    const trace: MergeTrace = { from: new Int32Array(W * H).fill(-1), ring: newMask(W, H) };
    if (extras.length > 0) {
      const front = newMask(W, H);
      for (const [, run2, tag2] of plan.slice(pi + 1)) {
        const f = rig.get(`${run2}:${tag2}`) as Raster;
        for (let p = 0; p < W * H; p++) if (f.data[p * 4 + 3] >= FRONT_ALPHA) front.data[p] = 1;
      }
      merged = mergeBelowCrop(r, extras, front, srcr, frame.headBottom, trace);
    }
    // A pixel the merge wrote is judged in the extend layer's run, every other
    // in the part's own. Projected = the colour came from projectSource's
    // accepted set: the part layer's, or for a copied pixel the extend
    // layer's (its rig layer was projected before it was copied). A ring pixel
    // is growRim's, counted in merged_px, and is not projection.
    const visible = newMask(W, H);
    const projected = newMask(W, H);
    for (let p = 0; p < W * H; p++) {
      const e = trace.from[p];
      const own = e < 0 ? st : (stats.get(extendKeys[e]) as ProjectionStats);
      if (r.data[p * 4 + 3] > OPAQUE_ALPHA_ABOVE && own.clear.data[p] === 1) visible.data[p] = 1;
      if (trace.ring.data[p] === 0 && own.takenMask.data[p] === 1) projected.data[p] = 1;
    }
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    let opaque = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = r.data[(y * W + x) * 4 + 3];
        if (a > OPAQUE_ALPHA_ABOVE) opaque++;
        if (a > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (opaque === 0) {
      empty.push({
        code: 'ASSEMBLE_PART_OPAQUE',
        object: `part "${name}" (${key}, config.assemble.plan[${pi}])`,
        detail: `has 0 pixels with alpha above ${OPAQUE_ALPHA_ABOVE} in the rig (${x1 < 0 ? 'no pixel at all' : 'only fringe below it'}; ${ghost[key]} ghost px removed in the run); a part with at least one opaque pixel is required — drop it from the plan or take the tag from the other run`,
      });
      return;
    }
    const vc = visibilityCounts(`part "${name}" (${key})`, r, visible, projected);
    const record: PartRecord = {
      name,
      from: key,
      x: x0,
      y: y0,
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      opaque_px: opaque,
      visible_px: vc.visible_px,
      occluded_px: vc.occluded_px,
      projected_core_px: st.core,
      source_px_taken: st.taken,
      visible_not_projected_px: vc.visible_not_projected_px,
      refused_drift_px: st.refused,
      merged_px: merged,
      seam_override_px: 0,
    };
    placed.push({ record, image: crop(r, x0, y0, record.w, record.h) });
  });
  refuseIfAny(empty);

  seamOverride(placed, srcr, seamRule, seamRule === 'silhouette' ? figureSilhouette(srcr) : null);
  const can = recomposite(placed, W, H);
  const figures = measureRecomposite(can, srcr, placed);
  return {
    parts: { rig_size: [W, H], scale_rig_per_source: frame.S, parts: placed.map((p) => p.record), ghost_px: ghost, recomposite: recompositeRecord(figures) },
    images: placed,
    recomposite: can,
    errorMap: recompositeErrorMap(can, srcr, placed),
    figures,
    seamRule,
    projectRule,
  };
}

// ---------------------------------------------------------------------------
// --propose-plan
// ---------------------------------------------------------------------------

/**
 * The tags the reference proposes from the HEAD run. Its own set, kept
 * verbatim — it is not `src/tags.ts`'s head group: it adds the hair and the
 * neck, and it holds only the split forms of the eye, brow and ear tags, and
 * neither `eyewear` nor `nose`. So an unsplit `eyebrow`, or `eyewear`, is
 * proposed from the full run.
 */
export const PROPOSE_HEAD_TAGS: readonly string[] = [
  'back hair',
  'front hair',
  'face',
  'ears-r',
  'ears-l',
  'headwear',
  'earwear',
  'mouth',
  'neck',
  'eyewhite-r',
  'eyewhite-l',
  'irides-r',
  'irides-l',
  'eyelash-r',
  'eyelash-l',
  'eyebrow-r',
  'eyebrow-l',
];

/** The part name the reference proposes for a tag; any other tag becomes its own name with spaces and hyphens as underscores. */
export const PROPOSE_ALIAS: Readonly<Record<string, string>> = {
  'back hair': 'hair_back',
  'front hair': 'hair_front',
  footwear: 'shoes',
  'irides-r': 'iris_r',
  'irides-l': 'iris_l',
  'eyelash-r': 'lash_r',
  'eyelash-l': 'lash_l',
  'eyebrow-r': 'brow_r',
  'eyebrow-l': 'brow_l',
  'ears-r': 'ear_r',
  'ears-l': 'ear_l',
  headwear: 'hairpin',
  earwear: 'earring',
};

function aliasOf(tag: string): string {
  return PROPOSE_ALIAS[tag] ?? tag.replaceAll(' ', '_').replaceAll('-', '_');
}

export interface PlanProposal {
  plan: PlanEntry[];
  extend_below_crop: Extend[];
  notes: string[];
}

/** Python's `%.0f`: round half to even on the binary value. */
function fmt0(v: number): string {
  const f = Math.floor(v);
  const d = v - f;
  const r = d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  return String(r);
}

/**
 * A default `assemble.plan` and `extend_below_crop` from the two runs, with
 * notes on every choice that was not the default.
 *
 * ⚖️ Invariant (`assemble_parts.py` `propose_plan`): a tag is proposable when
 * it is not `nose` and holds at least `PROPOSE_MIN_PX` run pixels of alpha
 * above 8 after ghost clean-up. Head tags (`PROPOSE_HEAD_TAGS`) come from the
 * head run, the rest from the full run. Order, back to front: `back hair`;
 * the body layers in the full run's draw order, with `neck` placed just before
 * the first of topwear, bottomwear or neckwear; then the remaining head layers
 * in the head run's draw order. A `headwear`/`earwear` the head run drops or
 * shrinks (its rig-pixel area below 0.8 of the full run's) is taken from the
 * full run instead, drawn right after `back hair` — noted. `front hair` and
 * `back hair` taken from the head run are extended below the crop from the
 * full run when the full run's layer reaches more than 8 rig pixels below the
 * crop line. A lone `handwear` layer is named `sleeves`.
 *
 * ⚖️ This port's, not the reference's: a layer that crosses a plausibility
 * rule (`implausibleRules` in `src/layers.ts` — mostly translucent, a pale
 * background-coloured haze, or out of proportion with the rest of its run's
 * figure) is neither proposed, nor taken as the head-run fallback, nor extended
 * below the crop, and a note names the layer, its three figures and every rule
 * it crossed with the bar. Those notes follow the reference's. [observed] No
 * layer of either public example crosses a rule, so their proposals are the
 * reference's byte for byte.
 */
export function proposePlan(full: LayerSet, head: LayerSet, g: Geometry, minPx = PROPOSE_MIN_PX): PlanProposal {
  const frame = checkGeometry(g, { full, head });
  const runs = { full: runLayers(full, g.resolution), head: runLayers(head, g.resolution) };
  const find = (run: Run, tag: string): RunLayer | undefined => runs[run].find((l) => l.tag === tag);
  const figures: Record<Run, LayerFigures[]> = { full: layerFigures(full), head: layerFigures(head) };
  const dropNotes: string[] = [];
  const noted = new Set<string>();
  /** The plausibility rules `run:tag` crosses; the first time a consulted layer crosses any, a note says so. */
  const implausible = (run: Run, tag: string, what: string): boolean => {
    const f = figures[run].find((x) => x.name === tag);
    const rules = f === undefined ? [] : implausibleRules(f);
    if (f === undefined || rules.length === 0) return false;
    if (!noted.has(`${run}:${tag}`)) {
      noted.add(`${run}:${tag}`);
      dropNotes.push(`${tag}: ${run} run layer ${figuresPhrase(f)} -> ${what} by ${rules.map((r) => `${r} (${ruleSummary(r)})`).join(', ')}`);
    }
    return true;
  };
  const ok = (run: Run, tag: string): boolean => {
    const l = find(run, tag);
    return tag !== 'nose' && l !== undefined && l.opaqueRunPx >= minPx && !implausible(run, tag, 'not proposed');
  };
  const body = runs.full.filter((l) => !PROPOSE_HEAD_TAGS.includes(l.tag) && ok('full', l.tag)).map((l) => l.tag);
  const heads = runs.head.filter((l) => PROPOSE_HEAD_TAGS.includes(l.tag) && ok('head', l.tag)).map((l) => l.tag);
  const hw = body.filter((t) => t.startsWith('handwear'));
  const plan: PlanEntry[] = [];
  const drop = (t: string): void => {
    const i = heads.indexOf(t);
    if (i >= 0) heads.splice(i, 1);
  };
  if (heads.includes('back hair')) {
    plan.push([PROPOSE_ALIAS['back hair'], 'head', 'back hair']);
    drop('back hair');
  }
  let neckDone = !heads.includes('neck');
  for (const t of body) {
    if (!neckDone && (t === 'topwear' || t === 'bottomwear' || t === 'neckwear')) {
      plan.push(['neck', 'head', 'neck']);
      drop('neck');
      neckDone = true;
    }
    plan.push([t.startsWith('handwear') && hw.length === 1 ? 'sleeves' : aliasOf(t), 'full', t]);
  }
  const notes: string[] = [];
  const headArea = (frame.headK * frame.S) ** 2;
  const fullArea = (frame.fullK * frame.S) ** 2;
  for (const t of ['headwear', 'earwear']) {
    const hl = find('head', t);
    const fl = find('full', t);
    const hp = hl !== undefined ? hl.opaqueRunPx * headArea : 0;
    const fp = fl !== undefined ? fl.opaqueRunPx * fullArea : 0;
    if (ok('full', t) && hp < 0.8 * fp) {
      drop(t);
      const at = plan.length > 0 && plan[0][2] === 'back hair' ? 1 : 0;
      plan.splice(at, 0, [PROPOSE_ALIAS[t], 'full', t]);
      notes.push(`${t}: head run ${fmt0(hp)} rig px < 0.8 x full run ${fmt0(fp)} -> full-run layer, drawn behind the face`);
    }
  }
  for (const t of heads) plan.push([aliasOf(t), 'head', t]);
  const extend: Extend[] = [];
  for (const t of ['front hair', 'back hair']) {
    const fl = find('full', t);
    if (fl === undefined || !plan.some((p) => p[1] === 'head' && p[2] === t)) continue;
    if (implausible('full', t, 'not extended below the crop')) continue;
    let last = -1;
    const n = g.resolution;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (fl.canvas.data[(y * n + x) * 4 + 3] > OPAQUE_ALPHA_ABOVE) {
          last = y;
          break;
        }
      }
    }
    if (last >= 0 && (last + 1) * frame.fullK * frame.S > frame.headBottom + 8) extend.push({ part: PROPOSE_ALIAS[t], run: 'full', tag: t });
  }
  return { plan, extend_below_crop: extend, notes: [...notes, ...dropNotes] };
}

// ---------------------------------------------------------------------------
// what the stage reads from a config
// ---------------------------------------------------------------------------

/** The config fields the stage reads, from a config `loadConfig` accepted. `seethrough` is optional there and required here. */
export function stageFields(cfg: CharacterConfig): { resolution: number; headBox: [number, number, number, number]; rigScale: number; plan: PlanEntry[]; extend: Extend[] } {
  const problems: Problem[] = [];
  if (cfg.seethrough === undefined) {
    problems.push({ code: 'ASSEMBLE_FIELD_PRESENT', object: 'config.seethrough', detail: 'is absent; assemble reads seethrough.resolution and seethrough.head_box, which place the two runs on the painting' });
  } else if (cfg.seethrough.head_box === undefined) {
    problems.push({ code: 'ASSEMBLE_FIELD_PRESENT', object: 'config.seethrough.head_box', detail: 'is absent; the head run cannot be placed on the painting without the box it was cropped from' });
  }
  refuseIfAny(problems);
  const st = cfg.seethrough as NonNullable<CharacterConfig['seethrough']>;
  return {
    resolution: st.resolution,
    headBox: st.head_box as [number, number, number, number],
    rigScale: cfg.assemble.rig_scale,
    plan: cfg.assemble.plan,
    extend: cfg.assemble.extend_below_crop ?? [],
  };
}

/**
 * The three numbers `--propose-plan` reads, from a config that does not have a
 * plan yet. The config comes through `parseEarlyConfig` (`src/config.ts`), the
 * one partial entry point, which has already checked the fields with the full
 * loader's rules; what is left here is that this stage needs the head box,
 * which that loader leaves optional.
 */
export function proposeFields(cfg: EarlyConfig): { resolution: number; headBox: [number, number, number, number]; rigScale: number } {
  if (cfg.seethrough.head_box === undefined) {
    refuseIfAny([{ code: 'ASSEMBLE_FIELD_PRESENT', object: 'config.seethrough.head_box', detail: 'is absent; the plan is proposed from both runs, and the head run cannot be placed on the painting without the box it was cropped from — run `propose --head-box` first' }]);
  }
  return { resolution: cfg.seethrough.resolution, headBox: cfg.seethrough.head_box as [number, number, number, number], rigScale: cfg.assemble.rig_scale };
}
