/**
 * A rig directory the `check` controls generate on every run: the smallest
 * thing `spine-parts check` accepts, authored by hand here and built with the
 * installed spine-rigc, so the whole check — build, both gates, the idle
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
  /** Write `images/front.png` fully opaque, which spine-rigc's A19 refuses under spine-html. */
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
}

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
  const blinkTracks =
    opts.blinkSquash === undefined
      ? []
      : [{ group: 'eyes', property: 'scaley', keys: [{ t: 0, v: [1] }, { t: 0.4, v: [1] }, { t: 0.5, v: [opts.blinkSquash] }, { t: 0.6, v: [opts.blinkSquash] }, { t: 0.7, v: [1] }, { t: 1, v: [1] }] }];
  const rig = {
    spec: 'rigc-rig/1',
    name: 'check_probe',
    images: 'images',
    skeleton: stage,
    bones: blink ? [{ name: 'root', x: 0, y: 0 }, { name: 'eye', parent: 'root', x: eyeAt.x, y: eyeAt.y }] : [{ name: 'root', x: 0, y: 0 }],
    slots: CHECK_PARTS.map((p, i) => ({ name: p.name, bone: blink && i === 1 ? 'eye' : 'root', attachment: p.name })),
    skins: {
      default: Object.fromEntries(
        CHECK_PARTS.map((p, i) => {
          const at = { x: stage.x + p.x + p.w / 2, y: stage.y + cropToSpineY(p.y + p.h / 2, H) };
          return [p.name, { [p.name]: { image: `${p.name}.png`, ...(blink && i === 1 ? { x: at.x - eyeAt.x, y: at.y - eyeAt.y } : at) } }];
        }),
      ),
    },
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
        tracks: [{ bone: 'root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [peak] }, { t: 1, v: [opts.lastKey ?? 0] }] }, ...blinkTracks],
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
