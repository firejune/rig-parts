/**
 * The mesh-draft fixture (issue #265): one tall flat strip on a three-link
 * chain, and a small block drawn as a region, so a rig builds, gates and
 * checks green and the figure is tall enough for the figure's rules to give a
 * spacing.
 *
 * ⭐ Nothing here is art. `strip` is an opaque 16x400 block, `mark` a 4x4 one.
 * No claim about appearance comes from them.
 *
 * ## The figure, by hand
 *
 * `mark` sits at (2, 2), 4x4; `strip` at (12, 10), 16x400. The union of the
 * boxes runs from row 2 to row 410, so **H = 408**: the tolerance and margin
 * T = max(1, round(408 / 554)) = max(1, 0) = **1**, and the spacing and the
 * longest outline edge S = round(408 / 37) = round(11.03) = **11**.
 *
 * ## The bones and the bend set
 *
 * `body` at (20, 10) under root; the chain `tail` under it through (20, 12),
 * (20, 145) and (20, 278) (the links a third of 400 apart, rounded), its tip at
 * (20, 408): **tail0, tail1, tail2**. The strip's segments name `tail`, so its
 * bend set turns all three links. `mark` is a region on `body`. The idle swings
 * the chain with amplitudes 1, 2 and 3 degrees, so `CHAIN_LAG` reads it and
 * `TEXTURE_STRETCH` reads the strip; no part is a topwear, eyewhite, handwear,
 * bottomwear, face or footwear, so the other judgement lines say SKIP.
 *
 * ## The three lattices
 *
 * The strip's lattice is the fixture's one free number. At grid 10 the gate
 * drafts the candidate (it holds every motion line and has fewer triangles).
 * At grid 12 the lattice has fewer triangles than the candidate, so reading 5
 * keeps it. At grid 8 the lattice is fine enough that the candidate's worst
 * sample at the bend set reads above the lattice's by more than a tenth.
 * Which one a control uses is said where it is used; no control reads a
 * figure off the readings but its verdict.
 */
import type { PartsFile } from '../src/parts.ts';
import type { Raster } from '../src/raster/types.ts';
import { block, writeRigFixture } from './rig.ts';

/** The figure's height and the two rules' values, by hand (module header). */
export const DRAFT_FIGURE = { top: 2, bottom: 410, height: 408, tolerance: 1, spacing: 11 } as const;

/** The lattice the gate drafts over, the one reading 5 keeps, and the one the bend keeps (module header). */
export const DRAFT_COARSE_GRID = 10;
export const DRAFT_COSTLY_GRID = 12;
export const DRAFT_FINE_GRID = 8;

/** The chain's links, root first. */
export const DRAFT_LINKS = ['tail0', 'tail1', 'tail2'] as const;

export function draftParts(): PartsFile {
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
  return { rig_size: [40, 420], scale_rig_per_source: 0.5, parts: [rec('strip', 'full:legwear', 12, 10, 16, 400), rec('mark', 'full:neckwear', 2, 2, 4, 4)], ghost_px: {} };
}

export function draftImages(): Map<string, Raster> {
  return new Map([
    ['strip', block(16, 400)],
    ['mark', block(4, 4)],
  ]);
}

/** The config, its strip on a lattice of `grid`. */
export function draftConfig(grid: number): Record<string, unknown> {
  return {
    key: 'draft',
    assemble: { rig_scale: 0.5, plan: [['strip', 'full', 'legwear'], ['mark', 'full', 'neckwear']] },
    bones: [
      { name: 'body', parent: 'root', at: [20, 10] },
      { chain: 'tail', parent: 'body', points: [[20, 12], [20, 145], [20, 278]], tip: [20, 408] },
    ],
    meshes: { strip: { grid, r: 8, segments: ['tail'] } },
    regions: { mark: 'body' },
    motion: { duration: 4, tracks: [{ chain: 'tail', amps: [1, 2, 3], period: 4, phase: 0, lag: 0.1 }] },
  };
}

/** The fixture on disk: `<dir>/config.json` and `<dir>/parts-in/` (parts.json and parts/). */
export function writeDraftFixture(dir: string, grid: number): { config: string; parts: string } {
  return writeRigFixture(dir, draftConfig(grid), draftImages(), draftParts());
}

/**
 * The mark's contour entry (issue #307): the same fixture with `mark` meshed in the outline mode instead of drawn as
 * a region, so the config holds one entry that is not a lattice. `mesh-draft` drafts lattice entries only; this one
 * it must name as not compared, and the strip's lattice row must not move. The numbers are the outline mode's
 * smallest on a 4x4 block (tolerance and margin 1, spacing 2) and the segment runs along the block's left edge on
 * `body`; nothing reads a figure off the mark's mesh.
 */
export const DRAFT_CONTOUR_MARK = { contour: { tolerance: 1, margin: 1, spacing: 2 }, r: 8, segments: [['body', [2, 2], [2, 6]]] } as const;

/** The fixture with `mark` as {@link DRAFT_CONTOUR_MARK} rather than a region, its strip on a lattice of `grid`. */
export function writeDraftFixtureWithContour(dir: string, grid: number): { config: string; parts: string } {
  const c = draftConfig(grid);
  c.meshes = { ...(c.meshes as Record<string, unknown>), mark: DRAFT_CONTOUR_MARK };
  c.regions = {};
  return writeRigFixture(dir, c, draftImages(), draftParts());
}
