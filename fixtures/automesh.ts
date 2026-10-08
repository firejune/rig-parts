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
import { type AlphaMask, CONTOUR_MIN_COVERAGE } from 'spine-rigc/mesh';
import type { AutoRegionSpec, AutoSpec } from '../src/config.ts';
import { MAX_SIDE } from '../src/contour.ts';
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

// ---------------------------------------------------------------------------
// The evaluation matrix (issue #126, items 4-5): a second, named policy and the
// region rule, written down before any example part was measured under them.
// `tools/auto_matrix.ts` reads them; the `auto-mesh` suite holds them (AM30-AM39).
// ---------------------------------------------------------------------------

/**
 * The speck rule: a 4-connected art island at alpha 1 and above, other than
 * the largest, is a speck when it holds this many pixels or fewer. It is the
 * `stray` figure of issue #106's stated contour set (tolerance 1, margin 1,
 * stray 4) — the set `examplePolicy` already takes its tolerance and margin
 * from, and the figure the public examples' one tracked contour mesh (scarf
 * `bottomwear`) declares. Not read off a part: an island above it is a piece,
 * and a piece refuses the part by name (`CONTOUR_ONE_ISLAND`, every island's
 * pixel count named), so two real pieces are never dropped as specks.
 */
export const SPECK_RULE_PX = 4;

/**
 * The permissive policy's coverage floor: spine-rigc's own
 * `CONTOUR_MIN_COVERAGE` (`spine-rigc/mesh`, 0.995) — the share of the art
 * rigc's contour generator requires of a mesh it builds, and the share its
 * largest island must hold before strays beside it are accepted. Imported,
 * not copied, so a change in rigc shows here.
 */
export const PERMISSIVE_MIN_COVERAGE = CONTOUR_MIN_COVERAGE;

/**
 * The permissive policy's undercut bound: `ceil(MAX_SIDE x sqrt 2)` = 46341 px,
 * the diagonal of the largest part `src/contour.ts` accepts, so no part can
 * reach it — undercut is reported and not gated. Why: an uncovered pixel's
 * undercut is its distance to the covered set, at least 1 px, so "incomplete
 * coverage allowed" (the owner's words) and `maxUndercut` 0 cannot hold
 * together; and a speck left out sits wherever the painting put it, so no
 * distance follows from the speck rule. rigc's own stray rule
 * (`CONTOUR_MIN_COVERAGE` over islands) has no distance term either. What the
 * loss costs is carried by the coverage floor and by the loss figure every
 * matrix row reports against the original image at alpha 1 and above.
 */
export const PERMISSIVE_MAX_UNDERCUT = Math.ceil(MAX_SIDE * Math.SQRT2);

/**
 * The permissive policy: {@link examplePolicy} with exactly three numbers
 * changed, each stated above before any part was measured — `source.stray`
 * {@link SPECK_RULE_PX}, `minCoverage` {@link PERMISSIVE_MIN_COVERAGE} and
 * `maxUndercut` {@link PERMISSIVE_MAX_UNDERCUT}, in `sourceBounds` and
 * `targets.artFit` alike. Everything else is the strict policy's: tolerance 1,
 * margin 1, the part's own spacing, overshoot 3, boundary deviation 1,
 * influences {4, 0}, budget 5000, one art sample, no region, no protection.
 * The final measurement is against the original image at alpha 1 and above:
 * the mask spine-rigc reads keeps every speck the source left out, so a speck
 * is uncovered art in every row, never erased from the evaluation.
 */
export function permissivePolicy(spacing: number): AutoSpec {
  const strict = examplePolicy(spacing);
  const fit = { minCoverage: PERMISSIVE_MIN_COVERAGE, maxOvershoot: strict.targets.artFit.maxOvershoot, maxUndercut: PERMISSIVE_MAX_UNDERCUT };
  return {
    ...strict,
    source: { ...strict.source, stray: SPECK_RULE_PX },
    sourceBounds: { ...fit },
    targets: { ...strict.targets, artFit: { ...fit } },
  };
}

/** The synthetic policy with the permissive policy's three changes, for the synthetic rows of the matrix. */
export function permissiveSyntheticPolicy(spacing: number): AutoSpec {
  const s = syntheticPolicy(spacing);
  const fit = { minCoverage: PERMISSIVE_MIN_COVERAGE, maxOvershoot: s.targets.artFit.maxOvershoot, maxUndercut: PERMISSIVE_MAX_UNDERCUT };
  return { ...s, source: { ...s.source, stray: SPECK_RULE_PX }, sourceBounds: { ...fit }, targets: { ...s.targets, artFit: { ...fit } } };
}

/** The name of the region's control bone the matrix adds (tools/real_compare.ts's `test_region`, issue #107). */
export const MATRIX_REGION_BONE = 'test_region';

/**
 * The declared region of the matrix's region condition, on a part whose
 * circle `tools/real_compare.ts`'s `testRegion` rule places (issue #107: the
 * art pixel nearest the midpoint of the last link of the first chain the
 * mesh names — on a skirt, its hem — radius `floor(min(w, h) / 10)`, band =
 * radius). The density numbers, each by rule from the part's own tracked
 * `grid` and that radius:
 *
 * - `maxEdgeLength` (L0) = `grid / 2`: twice the density, by edge length, of
 *   the spacing the part's source is built at;
 * - `transition` = the radius = the band: density relaxes over the same width
 *   the region's weight falls off over;
 * - `grade` = `(grid - L0) / transition`: the bound `L0 + grade d` reaches
 *   the background spacing `grid` exactly at the band's outer edge;
 * - `minArtSamples` 1 (P9's geometry investigation, as the policies).
 */
export function matrixRegion(t: { cx: number; cy: number; r: number; band: number }, grid: number): Extract<AutoRegionSpec, { shape: 'circle' }> {
  const L0 = grid / 2;
  return { name: 'hem', shape: 'circle', cx: t.cx, cy: t.cy, r: t.r, band: t.band, bone: MATRIX_REGION_BONE, maxEdgeLength: L0, transition: t.r, grade: (grid - L0) / t.r, minArtSamples: 1 };
}

/**
 * Speck fixtures for the permissive policy (AM30, AM31): {@link STRIP_MASK}'s
 * 56x40 block (2240 px) with islands at alpha 1 cut off from it — a column of
 * `n` pixels at x 62, ending on the last row (47) — three pixels clear of the block's right
 * edge (x 59), so the margin-1 outline (x <= 61) cannot reach it.
 */
export function speckMask(n: number): AlphaMask {
  return blocks(64, 48, [
    [4, 4, 56, 40],
    [62, 48 - n, 1, n, 1],
  ]);
}

/** Two real pieces, 20x20 (400 px) and 16x16 (256 px), each far above the speck rule (AM31). */
export const TWO_PIECES_MASK: AlphaMask = blocks(64, 48, [
  [2, 2, 20, 20],
  [40, 24, 16, 16],
]);

/**
 * A small block with a 4 px square region at its centre, source spacing 2 =
 * L0, so every source vertex near the region lies within `L0 + (1 + grade)
 * transition` of it and the refinement converges on any spine-rigc from 2.19.0
 * on — AM34's declared region producing interior vertices. 16x12 block at (4, 4) in 24x20.
 */
export const SMALL_STRIP_MASK: AlphaMask = blocks(24, 20, [[4, 4, 16, 12]]);
