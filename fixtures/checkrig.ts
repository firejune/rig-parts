/**
 * A rig directory the `check` controls generate on every run: the smallest
 * thing `spine-parts check` accepts, authored by hand here and built with the
 * installed rig-c, so the whole check — build, the gate, the idle
 * render, the loop, the seam — runs in the selftest without a corpus.
 *
 * What it is: a 48x80 canvas, one bone (`root`), two region parts, one `idle`
 * track that moves the root 2 units right and back over one second. Each part
 * is an ellipse whose alpha ramps from 255 to 0 over the outer third of its
 * radius, with a vertical green gradient — soft edges, because a rendered rig is
 * resampled and a hard edge would make the seam figure a measure of the
 * resampler rather than of the stack. The back part spans the canvas's full
 * height so the setup-pose render sits near scale 1, the regime a real rig's
 * render is in (a full-height character).
 *
 * The part PNGs are written twice, as the rig stage writes them: once into
 * `images/` (what rig.json points rigc at) and once into `parts/` (what the
 * seam composites). A mutant that edits one copy and not the other is how the
 * seam gate is made to fire.
 *
 * ⭐ No claim about appearance comes from this fixture. The seam figure it
 * produces says only that the gate's mechanism lines the composite up with the
 * render (a 3 px shift is caught; the aligned stack is not) — the bar's
 * calibration was made on real rigs and is quoted in ORACLE_check.md, not here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropToSpineY } from '../src/coords.ts';
import { OPAQUE_ALPHA_ABOVE } from '../src/layers.ts';
import { type PartsFile, type RecompositeRecord, serializeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export const CHECK_RIG = { w: 48, h: 80 };

export interface CheckPart {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: [number, number, number];
}

/** Back to front. */
export const CHECK_PARTS: readonly CheckPart[] = [
  { name: 'back', x: 4, y: 0, w: 30, h: 80, rgb: [200, 60, 40] },
  { name: 'front', x: 18, y: 20, w: 26, h: 40, rgb: [40, 90, 200] },
];

/** How much of the radius the alpha ramp occupies, as a divisor: 3 = the outer third. */
const RAMP = 3;

export function checkPartRaster(p: CheckPart, opaque = false): Raster {
  const r = newRaster(p.w, p.h);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const u = (2 * x + 1 - p.w) / p.w;
      const v = (2 * y + 1 - p.h) / p.h;
      const a = opaque ? 1 : Math.max(0, Math.min(1, (1 - Math.sqrt(u * u + v * v)) * RAMP));
      if (a > 0) r.data.set([p.rgb[0], Math.round(p.rgb[1] + (60 * y) / p.h), p.rgb[2], Math.round(255 * a)], (y * p.w + x) * 4);
    }
  }
  return r;
}

/** `src` moved `dx` pixels right inside its own box, the vacated columns transparent. */
export function shiftRight(src: Raster, dx: number): Raster {
  const out = newRaster(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = dx; x < src.width; x++) out.data.set(src.data.subarray((y * src.width + x - dx) * 4, (y * src.width + x - dx) * 4 + 4), (y * src.width + x) * 4);
  }
  return out;
}

export interface CheckRigOptions {
  /** The idle's last `translatex` key; 0 closes the loop. */
  lastKey?: number;
  /** Write `images/front.png` fully opaque, which rig-c's A19 refuses under spine-html. */
  opaqueFront?: boolean;
  /** The two parts' `from`, back then front — the See-through tags the judgement lines choose regions by. Default both `full:topwear`. */
  from?: readonly [string, string];
  /** The idle's peak `translatex` on the root; 0 makes an idle that moves nothing. */
  peak?: number;
  /**
   * Hang the front part on a bone `eye` at its centre and give the idle a
   * blink: group `eyes` = [`eye`], `scaley` 1 -> `squash` -> 1. The front part
   * reaches past the back one on the right, so the shut eye shows the
   * background there — the hole `BLINK_NO_HOLE` exists to name.
   */
  blinkSquash?: number;
  /** A `recomposite` block for parts.json, as assemble would write one; absent by default, as in a reference-written parts.json. */
  recomposite?: RecompositeRecord;
  /**
   * Draw the back part as a four-vertex mesh (issue #31) rather than a region:
   * vertices top-left, top-right, bottom-right, bottom-left, triangles
   * `0 1 2` and `2 3 0`. The slot hangs from, and the top two vertices are
   * weighted to, a bone `yoke` at the root's origin (rigc's A15 counts a mesh
   * slot's own bone as one that drives it, and the idle keys `root`); the
   * bottom two are weighted to
   * a bone `hem` at the part's bottom centre, whose parent `hem_ctl` the idle
   * moves down by this many units at t = 0.5 s and back — the control-bone
   * indirection the rig stage uses, so the idle keys no bone a mesh is weighted
   * to. At the peak the two vertical edges are (h + stretch) / h times their
   * rest length and no edge is shorter than at rest, so `TEXTURE_STRETCH`
   * reads (80 + stretch) / 80 at idle frame 6 (t = 0.5 s at 12 fps), on
   * triangle 0 (vertices 0 1 2, edge 1-2) — the first of the two triangles
   * that tie.
   */
  stretchMesh?: number;
  /**
   * Hang both parts on a bone `head` (at {@link HEAD_AT}, under `root`
   * through `head_ctl`) and roll it: the idle keys `head_ctl` `rotate` 0,
   * `roll`, 0, `-roll`, 0 at quarter steps (degrees) — the control-bone shape
   * the rig stage writes, which rig-c's A15 asks for over a mesh. With `slide`, the back part is instead a four-vertex mesh
   * weighted wholly to a bone `slide` under `head` (through `slide_ctl`, which
   * the idle keys `translatex` 0, `slide`, 0) while its slot still rides
   * `head` — a face that slides `slide` rig pixels relative to the head the
   * slot says carries it. With `bang` (issue #123), the front part is a
   * four-vertex mesh weighted wholly to a bone `bang` under `head` (through
   * `bang_ctl`, which the idle keys `translatex` 0, `-bang`, 0) while its slot
   * rides `head` — a fringe that swings `bang` rig pixels left, over the back
   * part. Not with `blinkSquash`.
   */
  head?: { roll: number; slide?: number; bang?: number };
}

/** Where the fixture's `head` bone stands, in rig pixels (y down): the bottom centre of the back part, a neck. */
export const HEAD_AT = { x: 19, y: 78 };

export const IDLE_PEAK = 2;

export function writeCheckRig(dir: string, opts: CheckRigOptions = {}): void {
  const { w: W, h: H } = CHECK_RIG;
  mkdirSync(join(dir, 'images'), { recursive: true });
  mkdirSync(join(dir, 'parts'), { recursive: true });
  for (const p of CHECK_PARTS) {
    writeFileSync(join(dir, 'images', `${p.name}.png`), encodePngBytes(checkPartRaster(p, opts.opaqueFront === true && p.name === 'front')));
    writeFileSync(join(dir, 'parts', `${p.name}.png`), encodePngBytes(checkPartRaster(p)));
  }
  const stage = { x: -W / 2, y: 0, width: W, height: H };
  const blink = opts.blinkSquash !== undefined;
  const front = CHECK_PARTS[1];
  const eyeAt = { x: stage.x + front.x + front.w / 2, y: stage.y + cropToSpineY(front.y + front.h / 2, H) };
  const peak = opts.peak ?? IDLE_PEAK;
  const mesh = opts.stretchMesh !== undefined;
  const back = CHECK_PARTS[0];
  const hemAt = { x: stage.x + back.x + back.w / 2, y: stage.y + cropToSpineY(back.y + back.h, H) };
  const corners = [
    [back.x, back.y],
    [back.x + back.w, back.y],
    [back.x + back.w, back.y + back.h],
    [back.x, back.y + back.h],
  ].map(([u, v]) => ({ x: stage.x + u, y: stage.y + cropToSpineY(v, H) }));
  const backMesh = {
    type: 'mesh',
    image: `${back.name}.png`,
    width: back.w,
    height: back.h,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 2, 3, 0],
    hull: 4,
    weights: corners.map((c, i) => (i < 2 ? [{ bone: 'yoke', x: c.x, y: c.y, weight: 1 }] : [{ bone: 'hem', x: c.x - hemAt.x, y: c.y - hemAt.y, weight: 1 }])),
  };
  const hemTracks = mesh ? [{ bone: 'hem_ctl', property: 'translatey', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [-(opts.stretchMesh as number)] }, { t: 1, v: [0] }] }] : [];
  const head = opts.head;
  const headAt = { x: stage.x + HEAD_AT.x, y: stage.y + cropToSpineY(HEAD_AT.y, H) };
  const slide = head?.slide !== undefined;
  const bang = head?.bang !== undefined;
  const headBones =
    head === undefined
      ? []
      : [
          { name: 'head_ctl', parent: 'root', x: headAt.x, y: headAt.y },
          { name: 'head', parent: 'head_ctl', x: 0, y: 0 },
          ...(slide ? [{ name: 'slide_ctl', parent: 'head', x: 0, y: 0 }, { name: 'slide', parent: 'slide_ctl', x: 0, y: 0 }] : []),
          ...(bang ? [{ name: 'bang_ctl', parent: 'head', x: 0, y: 0 }, { name: 'bang', parent: 'bang_ctl', x: 0, y: 0 }] : []),
        ];
  const headTracks =
    head === undefined
      ? []
      : [
          { bone: 'head_ctl', property: 'rotate', keys: [0, head.roll, 0, -head.roll, 0].map((v, i) => ({ t: i / 4, v: [v] })) },
          ...(slide ? [{ bone: 'slide_ctl', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [head.slide] }, { t: 1, v: [0] }] }] : []),
          ...(bang ? [{ bone: 'bang_ctl', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [-(head.bang as number)] }, { t: 1, v: [0] }] }] : []),
        ];
  const attachment = (p: CheckPart, i: number): Record<string, unknown> => {
    const at = { x: stage.x + p.x + p.w / 2, y: stage.y + cropToSpineY(p.y + p.h / 2, H) };
    if (mesh && i === 0) return backMesh;
    if (head !== undefined) {
      if ((i === 0 && slide) || (i === 1 && bang)) {
        const corners = [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
        return {
          type: 'mesh',
          image: `${p.name}.png`,
          width: p.w,
          height: p.h,
          uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          triangles: [0, 1, 2, 0, 2, 3],
          hull: 4,
          weights: corners.map(([x, y]) => [{ bone: i === 0 ? 'slide' : 'bang', x: stage.x + x - headAt.x, y: stage.y + cropToSpineY(y, H) - headAt.y, weight: 1 }]),
        };
      }
      return { image: `${p.name}.png`, x: at.x - headAt.x, y: at.y - headAt.y };
    }
    return { image: `${p.name}.png`, ...(blink && i === 1 ? { x: at.x - eyeAt.x, y: at.y - eyeAt.y } : at) };
  };
  const blinkTracks =
    opts.blinkSquash === undefined
      ? []
      : [{ group: 'eyes', property: 'scaley', keys: [{ t: 0, v: [1] }, { t: 0.4, v: [1] }, { t: 0.5, v: [opts.blinkSquash] }, { t: 0.6, v: [opts.blinkSquash] }, { t: 0.7, v: [1] }, { t: 1, v: [1] }] }];
  const rig = {
    spec: 'rigc-rig/1',
    name: 'check_probe',
    images: 'images',
    skeleton: stage,
    bones: [
      { name: 'root', x: 0, y: 0 },
      ...(blink ? [{ name: 'eye', parent: 'root', x: eyeAt.x, y: eyeAt.y }] : []),
      ...(mesh ? [{ name: 'yoke', parent: 'root', x: 0, y: 0 }, { name: 'hem_ctl', parent: 'root', x: hemAt.x, y: hemAt.y }, { name: 'hem', parent: 'hem_ctl', x: 0, y: 0 }] : []),
      ...headBones,
    ],
    slots: CHECK_PARTS.map((p, i) => ({ name: p.name, bone: head !== undefined ? 'head' : blink && i === 1 ? 'eye' : mesh && i === 0 ? 'yoke' : 'root', attachment: p.name })),
    skins: { default: Object.fromEntries(CHECK_PARTS.map((p, i) => [p.name, { [p.name]: attachment(p, i) }])) },
  };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const motion = {
    spec: 'rigc-motion/1',
    archetype: 'check_probe',
    cut: 'check_probe',
    easings: {},
    groups: blink ? { eyes: ['eye'] } : {},
    animations: {
      idle: {
        duration: 1,
        loop: true,
        tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [peak] }, { t: 1, v: [opts.lastKey ?? 0] }] }, ...blinkTracks, ...hemTracks, ...headTracks],
      },
    },
  };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
  const parts: PartsFile = {
    rig_size: [W, H],
    scale_rig_per_source: 1,
    parts: CHECK_PARTS.map((p, i) => ({
      name: p.name,
      from: opts.from?.[i] ?? 'full:topwear',
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      opaque_px: Array.from(checkPartRaster(p).data.filter((_, i) => i % 4 === 3)).filter((a) => a > OPAQUE_ALPHA_ABOVE).length,
      projected_core_px: 0,
      source_px_taken: 0,
      refused_drift_px: 0,
      merged_px: 0,
      seam_override_px: 0,
    })),
    ghost_px: {},
    ...(opts.recomposite === undefined ? {} : { recomposite: opts.recomposite }),
  };
  writeFileSync(join(dir, 'parts.json'), serializeParts(parts));
}

// ---------------------------------------------------------------------------
// issue #77: a merged rig — two copies under one root, a plate at slot 0, no parts.json
// ---------------------------------------------------------------------------

/**
 * The shape issue #77 measures: two spine-parts characters merged into one
 * rig spec outside the package — bone and slot names prefixed, both
 * hierarchies under one root, a region slot at index 0 for a background plate
 * — and no `parts.json`, because no assemble made the merged canvas.
 *
 * Each copy is {@link CHECK_PARTS}'s two boxes and colours as FLAT blocks: the
 * colour opaque everywhere but a transparent margin {@link MERGED_INSET} wide
 * (so neither is an opaque overlay, which rigc's A19 refuses), the second copy
 * {@link MERGED_COPY_DX} rig pixels right of the first. The plate is one opaque
 * colour over the whole stage — rigc's A19 lets an attachment the stage's size
 * be opaque. Flat colours make the painting, and every figure the controls
 * expect of it, a matter of rectangles: {@link mergedStack} is the flat stack
 * by hand, and {@link mergedCores} its rectangles.
 */
export const MERGED_STAGE = { w: 2 * CHECK_RIG.w, h: CHECK_RIG.h };
export const MERGED_COPY_DX = CHECK_RIG.w;
export const MERGED_INSET = 2;
export const MERGED_PREFIXES = ['a_', 'b_'] as const;
export const MERGED_PLATE_RGB: readonly [number, number, number] = [240, 240, 240];

export interface MergedRigOptions {
  /** Write an `idle` (the fixture's root sway, closed); false writes `animations: {}`. */
  idle: boolean;
  /** Put the opaque plate at slot 0. */
  plate: boolean;
  /** Move one slot's attachment this many rig pixels right (negative: left) in rig.json only — the painting is not moved. */
  move?: { slot: string; dx: number };
}

/** One flat rectangle of the stack, in stage pixels (y down): where the colour is opaque. */
export interface FlatCore {
  slot: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rgb: readonly [number, number, number];
}

/** A part as a flat block: its colour at alpha 255 inside, alpha 0 in the margin. */
export function flatPartRaster(p: CheckPart): Raster {
  const r = newRaster(p.w, p.h);
  for (let y = MERGED_INSET; y < p.h - MERGED_INSET; y++) for (let x = MERGED_INSET; x < p.w - MERGED_INSET; x++) r.data.set([...p.rgb, 255], (y * p.w + x) * 4);
  return r;
}

/** The opaque rectangles in draw order (the plate first when there is one), the moved slot moved. */
export function mergedCores(opts: Pick<MergedRigOptions, 'plate' | 'move'>): FlatCore[] {
  const cores: FlatCore[] = opts.plate ? [{ slot: 'plate', x: 0, y: 0, w: MERGED_STAGE.w, h: MERGED_STAGE.h, rgb: MERGED_PLATE_RGB }] : [];
  MERGED_PREFIXES.forEach((prefix, k) => {
    for (const p of CHECK_PARTS) {
      const slot = `${prefix}${p.name}`;
      const dx = opts.move?.slot === slot ? opts.move.dx : 0;
      cores.push({ slot, x: k * MERGED_COPY_DX + p.x + MERGED_INSET + dx, y: p.y + MERGED_INSET, w: p.w - 2 * MERGED_INSET, h: p.h - 2 * MERGED_INSET, rgb: p.rgb });
    }
  });
  return cores;
}

/** The flat stack over white at the stage's size, by rectangles: each core paints its colour, later over earlier. */
export function mergedStack(opts: Pick<MergedRigOptions, 'plate' | 'move'>): Raster {
  const r = newRaster(MERGED_STAGE.w, MERGED_STAGE.h);
  r.data.fill(255);
  for (const c of mergedCores(opts)) {
    for (let y = Math.max(0, c.y); y < Math.min(MERGED_STAGE.h, c.y + c.h); y++) for (let x = Math.max(0, c.x); x < Math.min(MERGED_STAGE.w, c.x + c.w); x++) r.data.set([...c.rgb, 255], (y * MERGED_STAGE.w + x) * 4);
  }
  return r;
}

/** Write the merged rig directory: rig.json, motion.json and images/ — and no parts.json. */
export function writeMergedCheckRig(dir: string, opts: MergedRigOptions): void {
  const { w: W, h: H } = MERGED_STAGE;
  mkdirSync(join(dir, 'images'), { recursive: true });
  for (const p of CHECK_PARTS) writeFileSync(join(dir, 'images', `${p.name}.png`), encodePngBytes(flatPartRaster(p)));
  const stage = { x: -W / 2, y: 0, width: W, height: H };
  const bones: Array<Record<string, unknown>> = [{ name: 'root', x: 0, y: 0 }];
  const slots: Array<Record<string, unknown>> = [];
  const skin: Record<string, Record<string, unknown>> = {};
  if (opts.plate) {
    const plate = newRaster(W, H);
    for (let i = 0; i < W * H; i++) plate.data.set([...MERGED_PLATE_RGB, 255], i * 4);
    writeFileSync(join(dir, 'images', 'plate.png'), encodePngBytes(plate));
    slots.push({ name: 'plate', bone: 'root', attachment: 'plate' });
    skin.plate = { plate: { image: 'plate.png', x: stage.x + W / 2, y: stage.y + cropToSpineY(H / 2, H) } };
  }
  MERGED_PREFIXES.forEach((prefix, k) => {
    const bone = `${prefix}root`;
    const bx = k * MERGED_COPY_DX;
    bones.push({ name: bone, parent: 'root', x: bx, y: 0 });
    for (const p of CHECK_PARTS) {
      const slot = `${prefix}${p.name}`;
      const dx = opts.move?.slot === slot ? opts.move.dx : 0;
      slots.push({ name: slot, bone, attachment: slot });
      skin[slot] = { [slot]: { image: `${p.name}.png`, x: stage.x + p.x + p.w / 2 + dx, y: stage.y + cropToSpineY(p.y + p.h / 2, H) } };
    }
  });
  const rig = { spec: 'rigc-rig/1', name: 'merged_probe', images: 'images', skeleton: stage, bones, slots, skins: { default: skin } };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const idle = { duration: 1, loop: true, tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [IDLE_PEAK] }, { t: 1, v: [0] }] }] };
  const motion = { spec: 'rigc-motion/1', archetype: 'merged_probe', cut: 'merged_probe', easings: {}, groups: {}, animations: opts.idle ? { idle } : {} };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
}
