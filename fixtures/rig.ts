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

/** The fixture on disk as the `rig` command reads it: `config.json`, and `parts.json` + `parts/` under `parts`. */
export function writeRigFixture(dir: string, config: Record<string, unknown> = rigConfig(), images: Map<string, Raster> = rigImages(), parts: PartsFile = rigParts()): { config: string; parts: string } {
  const partsDir = join(dir, 'parts-in');
  mkdirSync(join(partsDir, 'parts'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(partsDir, 'parts.json'), `${JSON.stringify(parts, null, 2)}\n`);
  for (const [name, img] of images) writeFileSync(join(partsDir, 'parts', `${name}.png`), encodePngBytes(img));
  return { config: join(dir, 'config.json'), parts: partsDir };
}
