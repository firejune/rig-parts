/**
 * The rig stage's fixture: two flat parts, a small config, and the counts a
 * control compares against — every one of them derivable by hand from this
 * file, and derived below where it is stated.
 *
 * ⭐ Nothing here is art. `cloth` is an opaque 16x8 block, `eye` a 4x2 one.
 * No claim about appearance comes from them.
 *
 * ## The canvas and the bones
 *
 * A 40x40 rig, so `root` stands at (20, 40) in rig pixels (y down). Bones:
 * `body` at (20, 30); the chain `hem` through (14, 14) and (22, 14) with its
 * tip at (30, 14), so `hem0` and `hem1`; `eye` at (17, 28).
 *
 * ## The mesh, by hand
 *
 * `cloth` sits at (10, 10), 16x8. Padded by 4 it is a 24x16 image whose
 * top-left is rig (6, 6). A grid of 8 gives 3x2 cells with edges x = 0, 8,
 * 16, 24 and y = 0, 8, 16; the art covers padded x 4..19 and y 4..11, which
 * reaches into all six cells. So: 4x3 = **12 vertices**, 6 cells x 2 =
 * **12 triangles**, the outline of a 3x2 block of cells = 2 (3 + 2) = **10
 * hull vertices**, and 12 - 10 = 2 interior ones.
 *
 * The vertex at padded (8, 8) — uv (8/24, 8/16) = (0.333333, 0.5) — sits at
 * rig (14, 14), exactly on `hem0`'s origin (d = 0) and 8 px from `hem1`'s
 * segment (22,14)->(30,14), whose nearest point is its origin. With r = 8:
 * w0 = 1/(0+8)^2 = 1/64 and w1 = 1/(8+8)^2 = 1/256, so normalised
 * **hem0 0.8, hem1 0.2**. Its bind offsets, in Spine's axes (x from the
 * centre, y up): the vertex is (14 - 20, 40 - 14) = (-6, 26); `hem0` is
 * (-6, 26), so **(0, 0)**; `hem1` is (2, 26), so **(-8, 0)**.
 *
 * ## The region
 *
 * `eye` sits at (16, 26), 4x2: its centre is (18, 27), and the bone `eye` is
 * at (17, 28), so the offset is (18 - 17, (40 - 27) - (40 - 28)) = **(1, 1)**.
 *
 * ## The idle
 *
 * A 4 s idle with one chain track on `hem` (period 4, so 8 keys + the closing
 * one = **9 keys** per link) and a blink at t = 1 on `eye`. Both `hem` links
 * are keyed and weighted to by `cloth`, so each gets a control:
 * **root, body, hem0_ctl, hem0, hem1_ctl, hem1, eye** — 7 bones, in that
 * order (depth first, each control directly above its bone).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartsFile } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster, type Raster } from '../src/raster/types.ts';

export const RIG_CANVAS: [number, number] = [40, 40];

export const RIG_EXPECT = {
  vertices: 12,
  triangles: 12,
  hull: 10,
  bones: ['root', 'body', 'hem0_ctl', 'hem0', 'hem1_ctl', 'hem1', 'eye'],
  weighed: { uv: [0.333333, 0.5], weights: [{ bone: 'hem0', x: 0, y: 0, weight: 0.8 }, { bone: 'hem1', x: -8, y: 0, weight: 0.2 }] },
  region: { x: 1, y: 1 },
  keysPerLink: 9,
} as const;

/** An opaque block, or — with `gapFrom`/`gapTo` — the block with those columns cleared. */
export function block(w: number, h: number, gap?: [number, number]): Raster {
  const r = newRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gap !== undefined && x >= gap[0] && x < gap[1]) continue;
      r.data.set([200, 120, 80, 255], (y * w + x) * 4);
    }
  }
  return r;
}

export function rigParts(): PartsFile {
  const rec = (name: string, from: string, x: number, y: number, w: number, h: number): PartsFile['parts'][number] => ({
    name,
    from,
    x,
    y,
    w,
    h,
    opaque_px: w * h,
    projected_core_px: 0,
    source_px_taken: 0,
    refused_drift_px: 0,
    merged_px: 0,
    seam_override_px: 0,
  });
  return { rig_size: [...RIG_CANVAS], scale_rig_per_source: 0.5, parts: [rec('cloth', 'full:topwear', 10, 10, 16, 8), rec('eye', 'head:face', 16, 26, 4, 2)], ghost_px: {} };
}

export function rigImages(): Map<string, Raster> {
  return new Map([
    ['cloth', block(16, 8)],
    ['eye', block(4, 2)],
  ]);
}

/**
 * `cloth` as two islands: columns 4..11 of the unpadded part cleared, which
 * clears padded x 8..15 — the whole middle column of cells — leaving the left
 * and right columns of cells kept and nothing between them.
 */
export function islandImages(): Map<string, Raster> {
  return new Map([
    ['cloth', block(16, 8, [4, 12])],
    ['eye', block(4, 2)],
  ]);
}

export function rigConfig(): Record<string, unknown> {
  return {
    key: 'fixture',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['cloth', 'full', 'topwear'],
        ['eye', 'head', 'face'],
      ],
    },
    bones: [
      { name: 'body', parent: 'root', at: [20, 30] },
      { chain: 'hem', parent: 'body', points: [[14, 14], [22, 14]], tip: [30, 14] },
      { name: 'eye', parent: 'body', at: [17, 28] },
    ],
    meshes: { cloth: { grid: 8, r: 8, segments: ['hem'] } },
    regions: { eye: 'eye' },
    motion: {
      duration: 4,
      tracks: [{ chain: 'hem', amps: [1, 2], period: 4, phase: 0, lag: 0.1 }],
      blink: { t: 1, eyes: ['eye'], brows: ['eye'], squash: 0.12, brow_drop: 1 },
    },
  };
}

/**
 * The turned-chain fixture (issue #73): the same two parts and canvas, with
 * the chain bent so its links point along known directions. `body` at
 * (20, 30); the chain `hem` through (14, 14) and (22, 20) with its tip at
 * (22, 26); a named bone `bead` under `hem1` at (22, 24); the region `eye`
 * rides `hem1`. No blink, so nothing keys a frame the chain turns.
 *
 * ## The turns, by hand
 *
 * In Spine's axes (x from the canvas centre 20, y up from 40):
 * `body` (0, 10), `hem0` (-6, 26), `hem1` (2, 20), the tip (2, 14),
 * `bead` (2, 16). `hem0` -> `hem1` is (8, -6): a 3-4-5 triangle,
 * **length 10**, direction atan2(-6, 8) = -atan(3/4) =
 * **-36.869898 degrees** (6 places). `hem1` -> tip is (0, -6):
 * **length 6, -90 degrees**. Both links are keyed and weighted to, so
 * each has a control carrying the turn: `hem0_ctl` local -36.869898 under the
 * unturned `body`, `hem1_ctl` local -90 - (-36.869898) = **-53.130102**,
 * each link local 0. `bead` is turned back upright: local **90**.
 *
 * Offsets in the turned frames (a vector v in a frame turned by t reads
 * R(-t) v): `hem1_ctl` in `hem0`'s frame: R(36.869898)(8, -6) =
 * (8 * 0.8 + 6 * 0.6, 8 * 0.6 - 6 * 0.8) = **(10, 0)**, the link's length
 * along its own axis. `bead` in `hem1`'s (-90): R(90)(0, -4) = **(4, 0)**.
 *
 * ## The weight and the region, by hand
 *
 * The cloth vertex at padded (8, 8) sits at rig (14, 14), `hem0`'s origin
 * (d = 0); its distance to `hem1`'s segment (22,20)->(22,26) is to the
 * segment's origin, sqrt(8^2 + 6^2) = 10. With r = 8: w0 = 1/64, w1 =
 * 1/324, normalised 324/388 = 0.835052 and 64/388, written **0.83505** and
 * **1 - 0.83505 = 0.16495**. Bind offsets: under `hem0`, **(0, 0)**; under
 * `hem1`, the world vector (-6, 26) - (2, 20) = (-8, 6) read in a frame
 * turned -90: R(90)(-8, 6) = **(-6, -8)**.
 *
 * `eye`'s centre (18, 27) is (-2, 13); from `hem1` that is (-4, -7), in its
 * frame R(90)(-4, -7) = **(7, -4)**, and the image is turned back by
 * **90** so it is drawn upright.
 *
 * The flat form, every bone unturned, is the plain world differences:
 * `hem0_ctl` (-6, 16), `hem1_ctl` (8, -6), `bead` (0, -4), the weights
 * (0, 0) and (-8, 6), `eye` (-4, -7).
 */
export const TURNED_EXPECT = {
  bones: ['root', 'body', 'hem0_ctl', 'hem0', 'hem1_ctl', 'hem1', 'bead'],
  oriented: {
    hem0_ctl: { length: 10, rotation: -36.869898, x: -6, y: 16 },
    hem0: { length: 10, rotation: 0, x: 0, y: 0 },
    hem1_ctl: { length: 6, rotation: -53.130102, x: 10, y: 0 },
    hem1: { length: 6, rotation: 0, x: 0, y: 0 },
    bead: { rotation: 90, x: 4, y: 0 },
  },
  flat: { body: [0, 10], hem0_ctl: [-6, 16], hem0: [0, 0], hem1_ctl: [8, -6], hem1: [0, 0], bead: [0, -4] },
  weighed: {
    uv: [0.333333, 0.5],
    oriented: [{ bone: 'hem0', x: 0, y: 0, weight: 0.83505 }, { bone: 'hem1', x: -6, y: -8, weight: 0.16495 }],
    flat: [{ bone: 'hem0', x: 0, y: 0, weight: 0.83505 }, { bone: 'hem1', x: -8, y: 6, weight: 0.16495 }],
  },
  region: { oriented: { image: 'eye.png', x: 7, y: -4, rotation: 90 }, flat: { image: 'eye.png', x: -4, y: -7 } },
  /** The landmarks in Spine's axes, by bone (a control stands at its bone's). */
  world: { root: [0, 0], body: [0, 10], hem0: [-6, 26], hem1: [2, 20], bead: [2, 16] },
} as const;

export function turnedConfig(): Record<string, unknown> {
  return {
    key: 'turned',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['cloth', 'full', 'topwear'],
        ['eye', 'head', 'face'],
      ],
    },
    bones: [
      { name: 'body', parent: 'root', at: [20, 30] },
      { chain: 'hem', parent: 'body', points: [[14, 14], [22, 20]], tip: [22, 26] },
      { name: 'bead', parent: 'hem1', at: [22, 24] },
    ],
    meshes: { cloth: { grid: 8, r: 8, segments: ['hem'] } },
    regions: { eye: 'hem1' },
    motion: {
      duration: 4,
      tracks: [{ chain: 'hem', amps: [1, 2], period: 4, phase: 0, lag: 0.1 }],
    },
  };
}

/** The fixture on disk as the `rig` command reads it: `config.json`, and `parts.json` + `parts/` under `parts`. */
export function writeRigFixture(dir: string, config: Record<string, unknown> = rigConfig(), images: Map<string, Raster> = rigImages(), parts: PartsFile = rigParts()): { config: string; parts: string } {
  const partsDir = join(dir, 'parts-in');
  mkdirSync(join(partsDir, 'parts'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(partsDir, 'parts.json'), `${JSON.stringify(parts, null, 2)}\n`);
  for (const [name, img] of images) writeFileSync(join(partsDir, 'parts', `${name}.png`), encodePngBytes(img));
  return { config: join(dir, 'config.json'), parts: partsDir };
}

/**
 * The blink-still fixture (issue #26): an eye whose eyelash layer also carries
 * a crease above the lid, on a 48x64 rig. Bones: `head` at (24, 40) under
 * `root`, `eye` at the eyewhite's centre (22, 27) and `brow` at (22, 14), both
 * under `head`. The idle rolls `head` (a 2-degree sine over 4 s) and blinks at
 * t = 1 s — so the rest frames are not all axis-aligned, which is where a cut
 * through art would show.
 *
 * - `face` (head:face) 8,8 32x40, opaque — the layer under the eye, so a shut
 *   eye shows face, never the page.
 * - `eyewhite` (head:eyewhite-r) 16,24 12x6, opaque.
 * - `lash` (head:eyelash-r) 14,17 16x9: rows 17-18 are the crease (x 16..27),
 *   rows 19-20 carry no art, rows 21-25 the lash line across the full width.
 *   It reaches 24 - 17 = **7 px** above the eyewhite, 7 / 9 = **78 %** of its
 *   height. Rows 19 and 20 are clear, so the lowest clear row above the lid is
 *   **20**: `motion.blink.still.lash = {row: 20, bone: "head"}` cuts off rows
 *   17-19 (the crease, 12 x 2 = **24 px**) as `lash_still`.
 */
export const LASH_RIG: [number, number] = [48, 64];
export const LASH_CREASE = { x0: 16, x1: 28, y0: 17, y1: 19, px: 24 } as const;
export const LASH_ROW = 20;

function lashRaster(): Raster {
  const r = newRaster(16, 9);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 16; x++) {
      const crease = y < 2 && x >= 2 && x < 14;
      const line = y >= 4;
      if (crease) r.data.set([90, 40, 40, 255], (y * 16 + x) * 4);
      else if (line) r.data.set([30, 20, 20, 255], (y * 16 + x) * 4);
    }
  }
  return r;
}

function lashRec(name: string, from: string, x: number, y: number, w: number, h: number, opaque: number): PartsFile['parts'][number] {
  return { name, from, x, y, w, h, opaque_px: opaque, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
}

export function lashParts(): PartsFile {
  return {
    rig_size: [...LASH_RIG],
    scale_rig_per_source: 0.5,
    parts: [lashRec('face', 'head:face', 8, 8, 32, 40, 1280), lashRec('eyewhite', 'head:eyewhite-r', 16, 24, 12, 6, 72), lashRec('lash', 'head:eyelash-r', 14, 17, 16, 9, 24 + 80)],
    ghost_px: {},
  };
}

export function lashImages(): Map<string, Raster> {
  const white = newRaster(12, 6);
  for (let i = 0; i < 72; i++) white.data.set([250, 250, 250, 255], i * 4);
  return new Map([
    ['face', block(32, 40)],
    ['eyewhite', white],
    ['lash', lashRaster()],
  ]);
}

/** The fixture's config; `still` false leaves `motion.blink.still` out — the same rig with the whole lash blinking. */
export function lashConfig(still = true): Record<string, unknown> {
  const blink: Record<string, unknown> = { t: 1, eyes: ['eye'], brows: ['brow'], squash: 0.12, brow_drop: 1 };
  if (still) blink.still = { lash: { row: LASH_ROW, bone: 'head' } };
  return {
    key: 'lash_fixture',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['face', 'head', 'face'],
        ['eyewhite', 'head', 'eyewhite-r'],
        ['lash', 'head', 'eyelash-r'],
      ],
    },
    bones: [
      { name: 'head', parent: 'root', at: [24, 40] },
      { name: 'eye', parent: 'head', at: [22, 27] },
      { name: 'brow', parent: 'head', at: [22, 14] },
    ],
    meshes: {},
    regions: { face: 'head', eyewhite: 'eye', lash: 'eye' },
    motion: { duration: 4, tracks: [{ bone: 'head', prop: 'rotate', amp: 2, period: 4, phase: 0 }], blink },
  };
}
