/**
 * Two chains on one lattice, swung into each other (issue #314): the shape a
 * consumer's seated figure stopped `check` on — the back hair one mass, the
 * proposer's two back-hair chains running down it close together, their
 * amplitudes mirrored. Flat blocks; no claim about appearance comes from it.
 *
 * ## The figure, by hand
 *
 * A 100x320 rig. `hair` (full:back hair) is an opaque 80x300 block at (10, 10);
 * `face` (head:face), a 12x6 block at (44, 2), is a region on `head` — there so
 * the packed page holds two regions (rig-c's A27 refuses a page whose only
 * region is not named for the page's file). Bones: `head` at (50, 10) under
 * `root`; the chains `hairback_r` through (31, 14), (31, 104), (31, 194) with
 * its tip at (31, 284), and `hairback_l` the same at x 70 — so the two tips are
 * 70 - 31 = **39 px** apart, every link 90 px long, straight down. The lattice
 * (`grid` 16, `r` 8) names the two chains and nothing else.
 *
 * ## The idle
 *
 * 4 s. Each chain is keyed `amps` [0.6, 1.4, 2.4], `period` 4, `phase` 0.2,
 * `lag` 0.08 — the proposer's back-hair draft — `hairback_l`'s amplitudes
 * times `sign`: -1 is the proposer's mirror (opposed, link for link), +1 one
 * sign for both.
 *
 * The figures the controls compare — the squeeze's worst edge, `check`'s — are
 * not written here: they are read off the rig stage's own lattice and weights
 * and held to each other and to check's bar, never to a number typed in.
 */
import type { PartsFile } from '../src/parts.ts';
import type { Raster } from '../src/raster/types.ts';
import { block } from './rig.ts';

export const SQUEEZE_RIG: [number, number] = [100, 320];
export const SQUEEZE_TIPS: { r: [number, number]; l: [number, number] } = { r: [31, 284], l: [70, 284] };
export const SQUEEZE_AMPS = [0.6, 1.4, 2.4] as const;

export function squeezeConfig(sign: 1 | -1): Record<string, unknown> {
  const chain = (name: string, x: number): Record<string, unknown> => ({ chain: name, parent: 'head', points: [[x, 14], [x, 104], [x, 194]], tip: [x, 284] });
  return {
    key: 'squeeze',
    assemble: {
      rig_scale: 0.5,
      plan: [
        ['hair', 'full', 'back hair'],
        ['face', 'head', 'face'],
      ],
    },
    bones: [{ name: 'head', parent: 'root', at: [50, 10] }, chain('hairback_r', SQUEEZE_TIPS.r[0]), chain('hairback_l', SQUEEZE_TIPS.l[0])],
    meshes: { hair: { grid: 16, r: 8, segments: ['hairback_r', 'hairback_l'] } },
    regions: { face: 'head' },
    motion: {
      duration: 4,
      tracks: [
        { chain: 'hairback_r', amps: [...SQUEEZE_AMPS], period: 4, phase: 0.2, lag: 0.08 },
        { chain: 'hairback_l', amps: SQUEEZE_AMPS.map((a) => sign * a), period: 4, phase: 0.2, lag: 0.08 },
      ],
    },
  };
}

export function squeezeParts(): PartsFile {
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
  return { rig_size: [...SQUEEZE_RIG], scale_rig_per_source: 0.5, parts: [rec('hair', 'full:back hair', 10, 10, 80, 300), rec('face', 'head:face', 44, 2, 12, 6)], ghost_px: {} };
}

export function squeezeImages(): Map<string, Raster> {
  return new Map([
    ['hair', block(80, 300)],
    ['face', block(12, 6)],
  ]);
}
