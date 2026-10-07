/**
 * Generated cases for the automatic mesh mode (`src/automesh.ts`, issue #126
 * item 2), shared by the `auto-mesh` suite of `selftest.ts` and
 * `tools/auto_survey.ts`. The masks are `fixtures/contour.ts`'s flat blocks,
 * whose outlines are derived by hand there; what is added here is the
 * automatic mode's numbers, every one stated below, and no figure measured off
 * a run. Nothing about appearance is claimed from them.
 *
 * ## The synthetic policy, {@link SYNTHETIC_POLICY}
 *
 * The source is the contour mode's own case parameters (tolerance 0, margin
 * 1, the case's spacing) at alpha 1 and above; the bounds are what that
 * source meets by construction — every art pixel covered (`minCoverage` 1,
 * `maxUndercut` 0) and nothing past `margin + tolerance + 1` = 2 px
 * (`maxOvershoot` 2, the contour mode's own bound, `contourFit`) — for the
 * source and the result alike; the result's hull within 1 px of the source's
 * (`maxBoundaryDeviation` 1, the margin); weights capped at 4 with no floor
 * (`minWeight` 0, P19); a budget of 2000 candidates; one art sample (P9: a
 * value admissible for an explicitly chosen geometry investigation).
 */
import type { AlphaMask } from 'spine-rigc/mesh';
import type { AutoRegionSpec, AutoSpec } from '../src/config.ts';
import { blocks, CONCAVE, CONVEX, HOLE, ISLANDS, SPIKE } from './contour.ts';

/** The numbers every synthetic case starts from; see the module header for where each comes from. */
export function syntheticPolicy(spacing: number): AutoSpec {
  return {
    source: { tolerance: 0, margin: 1, spacing },
    sourceBounds: { minCoverage: 1, maxOvershoot: 2, maxUndercut: 0 },
    targets: { artFit: { minCoverage: 1, maxOvershoot: 2, maxUndercut: 0 }, maxBoundaryDeviation: 1 },
    influences: { maxInfluences: 4, minWeight: 0 },
    budget: { maxCandidates: 2000 },
    minArtSamples: 1,
  };
}

export const SYNTHETIC_POLICY = syntheticPolicy(8);

/**
 * The one policy every public example part is switched to (`tools/auto_survey.ts`
 * and the `auto-mesh-examples` suite), stated before any example was reduced
 * and not tuned per part. Each number and where it comes from:
 *
 * - source: issue #106's stated contour set — tolerance 1, margin 1 — and the
 *   part's own tracked spacing (its lattice `grid`, or the contour spacing of a
 *   part already in that mode); no `stray`: full coverage is asked below, so
 *   an island left out could never pass it;
 * - `sourceBounds` = `targets.artFit` = every art pixel covered (`minCoverage`
 *   1, `maxUndercut` 0), nothing past `margin + tolerance + 1` = 3 px (the
 *   contour mode's own bound);
 * - `maxBoundaryDeviation` 1 px — the tolerance the source was simplified at;
 * - `influences`: 4 (the lattice's cap) and no floor, `minWeight` 0 (P19);
 * - `budget.maxCandidates` 5000; `minArtSamples` 1 (P9's geometry investigation);
 * - no region, no protection: `protect.hull` false (P20).
 */
export function examplePolicy(spacing: number): AutoSpec {
  return {
    source: { tolerance: 1, margin: 1, spacing },
    sourceBounds: { minCoverage: 1, maxOvershoot: 3, maxUndercut: 0 },
    targets: { artFit: { minCoverage: 1, maxOvershoot: 3, maxUndercut: 0 }, maxBoundaryDeviation: 1 },
    influences: { maxInfluences: 4, minWeight: 0 },
    budget: { maxCandidates: 5000 },
    minArtSamples: 1,
  };
}

/**
 * A square density region, `side` px, centred in {@link STRIP_MASK}'s block:
 * L0 2 px, a 2 px transition at grade 1, one art sample. Its numbers are on
 * the 1/256 px grid by construction (whole pixels).
 */
export function squareRegion(cx: number, cy: number, side: number, transition: number): AutoRegionSpec {
  const h = side / 2;
  return {
    name: 'soft',
    shape: 'polygon',
    points: [
      [cx - h, cy - h],
      [cx + h, cy - h],
      [cx + h, cy + h],
      [cx - h, cy + h],
    ],
    band: 0,
    bone: 'soft',
    maxEdgeLength: 2,
    transition,
    grade: 1,
    minArtSamples: 1,
  };
}

/** A 56x40 block at (4, 4) in 64x48: room for a region well inside it. */
export const STRIP_MASK: AlphaMask = blocks(64, 48, [[4, 4, 56, 40]]);

export interface AutoCase {
  name: string;
  /** What the case is there to show, for the table. */
  shows: string;
  mask: AlphaMask;
  spec: AutoSpec;
  /** The lattice grid and contour spacing the row is set beside. */
  spacing: number;
}

/** The synthetic matrix of issue #126 item 2, Part 3: shapes, a refused topology, regions, and two planted limits. */
export const AUTO_CASES: readonly AutoCase[] = [
  { name: 'convex', shows: 'a convex block', mask: CONVEX.mask, spec: syntheticPolicy(8), spacing: 8 },
  { name: 'concave', shows: 'a U: two notch corners', mask: CONCAVE.mask, spec: syntheticPolicy(6), spacing: 6 },
  { name: 'narrow', shows: 'a 2 px spike on a block', mask: SPIKE.mask, spec: syntheticPolicy(8), spacing: 8 },
  { name: 'hole', shows: 'a block with a 12 px hole (spanned)', mask: HOLE.mask, spec: syntheticPolicy(8), spacing: 8 },
  { name: 'islands', shows: 'two islands (refused by name)', mask: ISLANDS.mask, spec: syntheticPolicy(8), spacing: 8 },
  { name: 'tiny region, coarse source', shows: 'a 4 px region, source spacing 12', mask: STRIP_MASK, spec: { ...syntheticPolicy(12), regions: [squareRegion(32, 24, 4, 2)] }, spacing: 12 },
  { name: 'tiny region, source at L0', shows: 'the same region, source spacing 2 = L0', mask: STRIP_MASK, spec: { ...syntheticPolicy(2), regions: [squareRegion(32, 24, 4, 2)] }, spacing: 2 },
  { name: 'transition 0', shows: 'the same region with no band, source spacing 2', mask: STRIP_MASK, spec: { ...syntheticPolicy(2), regions: [squareRegion(32, 24, 4, 0)] }, spacing: 2 },
  { name: 'unmeetable (budget 1, region)', shows: 'planted: one insertion cannot meet L0', mask: STRIP_MASK, spec: { ...syntheticPolicy(2), budget: { maxCandidates: 1 }, regions: [squareRegion(32, 24, 4, 2)] }, spacing: 2 },
  { name: 'budget 1', shows: 'planted: one removal attempt', mask: CONVEX.mask, spec: { ...syntheticPolicy(8), budget: { maxCandidates: 1 } }, spacing: 8 },
];
