/**
 * The contour mesh: a part's alpha outline, traced and simplified by
 * spine-rigc's own functions, with interior vertices placed where they are
 * declared and a triangulation that never crosses the outline (issue #84, step
 * 1). Nothing here is wired to the config, the rig stage or the CLI yet; the
 * lattice (`src/mesh.ts`) is untouched and stays the rig stage's only mesh.
 *
 * ## What it does, in order
 *
 * 1. **Art.** A pixel is art when its alpha is ABOVE `threshold` — the
 *    lattice's reading (`ART_ALPHA` in `src/mesh.ts`, the reference's
 *    `alpha > 8`). spine-rigc's tracer and fit counter read "at or above", so
 *    they are handed `threshold + 1`, which is the same set of pixels.
 * 2. **Islands and holes.** The art's 4-connected islands are counted
 *    (`connectedComponents`, 4-connectivity, rigc's own island rule); a second
 *    island holding any art pixel is refused with every island's pixel count
 *    (`CONTOUR_ONE_ISLAND`). Nothing is discarded and nothing falls back to the
 *    lattice. A hole is filled, as rigc's trace and the lattice both fill it,
 *    and its area is reported (`filledHolePixels`).
 * 3. **The outline is rigc's**: `traceAlphaOutline` (the outer loop on the
 *    pixel-corner lattice, clockwise on screen, a diagonal pinch refused) →
 *    `simplifyClosedPolygon(tolerance)` → `offsetPolygon(margin)` → clamped to
 *    the part window → snapped to the {@link GRID} → `prunePolygon`. That is
 *    `buildContourMesh`'s own sequence (spine-rigc 2.10.1, `src/mesh.ts`) with
 *    its `r6` rounding replaced by the snap, imported and never copied. This
 *    module does not raise a margin by itself: a margin that clips art is
 *    refused (`CONTOUR_COVERAGE`).
 * 4. **Interior vertices are declared**, never inferred: see
 *    {@link interiorCandidates} for the candidates and {@link KEEP_FRACTION}
 *    for the one rule that keeps or drops each.
 * 5. **Triangulation**: rigc's `earClip` of the outline, made constrained
 *    Delaunay by flipping; then each kept point inserted in order — the
 *    triangle that holds it is split in three, or the two that share the edge
 *    it lies on in four — and the Delaunay condition restored by flipping
 *    interior edges only. An outline edge belongs to one triangle and is never
 *    flipped, so no triangle crosses the outline. A last pass over every edge
 *    flips whatever is still not locally Delaunay, and the report counts what
 *    is left (`nonDelaunayEdges`, 0 on every mesh this module returns).
 * 6. **Refusals**, each naming the part, the rule, the value found and the
 *    value required (the settled comment on issue #84, §1): coverage — any art
 *    pixel outside the mesh; overshoot — past `margin + tolerance + 1` px;
 *    budget; topology ({@link contourTopologyProblems}); islands; and the
 *    parameters themselves. Every problem found is returned at once.
 * 7. **The report** ({@link ContourReport}): what the settled comment's §2
 *    lists, measured on the mesh that would be written.
 *
 * ## What margin a tolerance needs — measured, not raised
 *
 * `bun tools/contour_survey.ts` sweeps tolerance x margin over five generated
 * shapes (a disc, a ~70° triangle, a two-horned crescent, a 2 px spike, a
 * diagonal bar). The smallest margin that covers every art pixel, over the
 * five: 0 at tolerance 0.5; at most 0.5 px at 1; at most 0.75 px at 1.5; at
 * most 1.5 px at 2 (the disc 1, the triangle and the crescent 1.5) — up to
 * three quarters of the tolerance, on the sweep's margin steps. The
 * margin is bounded from above too: rigc's `offsetPolygon` moves an acute
 * corner up to 4 x margin (its miter clamp) while the settled overshoot bound
 * is margin + tolerance + 1, so the crescent's horns refuse overshoot from a
 * margin of 1 px at tolerance 1, and at tolerance 3 no margin passes it; the
 * spike and the bar lose their width to Douglas–Peucker at tolerance 3 and no
 * margin brings it back. Coverage is not monotonic in the margin either: the
 * miter clamp cuts an acute tip, so a wedge covered at 0.5 px leaves pixels
 * out at 1 px (selftest `CT09` reports it). Hence the module never adjusts a
 * margin; it refuses, and the author's figures are the ones it ran at.
 *
 * ## Exactness, and what happens at every tie
 *
 * Every coordinate this module produces is snapped to {@link GRID} — integer
 * multiples of 1/256 px — and every predicate that decides topology runs on
 * those integers: orientation in doubles, exact because a part is at most
 * {@link MAX_SIDE} px a side, so a coordinate difference is under 2^24 units,
 * a product under 2^48 and a difference of two products under 2^49 < 2^53;
 * in-circle and point-to-segment distance in `BigInt`, which is exact at any
 * size. On those coordinates spine-rigc's own float predicates (`earClip`,
 * `prunePolygon`, `findSelfIntersection`, with their 1e-9 and 1e-12 slacks)
 * are exact too: a non-zero cross product of two grid differences is at least
 * 2^-16 px², far above either slack. So no topological decision here is made
 * by rounding noise. The ties, each decided by a stated rule:
 *
 * - **in-circle = 0** (four cocircular points — every square of a grid): the
 *   edge is NOT flipped, so a cocircular quad keeps the diagonal it had, which
 *   the fixed insertion order decides.
 * - **a point exactly on an interior edge**: the two triangles sharing it are
 *   split into four. A point on an outline edge cannot occur: every kept point
 *   is at least its keep radius (≥ 1 grid unit) from the outline.
 * - **two candidates at once**: none — candidates are tried one at a time in a
 *   fixed order, and the first triangle in index order that holds a point is
 *   the one split.
 * - **keep radius exactly met**: kept (the rule is `≥`).
 * - **smallest angle / largest edge ratio**: the first triangle in output
 *   order with the extreme value.
 *
 * What is NOT exact, said where it is: the circle region's boundary samples use
 * `Math.cos` / `Math.sin`, which an engine need not round correctly, so a
 * different engine could move a sampled point by one grid unit where the
 * value lies within an ulp of a rounding boundary; rigc's `offsetPolygon` and
 * `simplifyClosedPolygon` use `Math.hypot`, the same kind of function; and the
 * report's angles use `Math.acos` (reported to 6 decimals, decide nothing). All
 * other arithmetic is IEEE `+ − × ÷ √`, which every conforming engine rounds the
 * same way. Two runs on one engine are byte-identical (selftest `CT20`).
 *
 * ## The output's order
 *
 * Vertices: the outline first, in rigc's walk order (the hull Spine needs:
 * `hull` is a count, and the first `hull` vertices are the outline, in order),
 * then the kept interior points in the order they were kept. The outline does
 * not depend on the regions, so adding a region never renumbers a hull vertex
 * (`CT21`). Triangles: each wound as the outline is (clockwise on screen, which
 * is counter-clockwise in Spine's y-up world — the lattice's winding), rotated
 * to start at its smallest index, and sorted, so the list does not depend on
 * the order the flips happened in.
 */
import { type Problem } from './errors.ts';
import { connectedComponents, type Mask } from './raster/index.ts';
import {
  type AlphaMask,
  checkHullOrder,
  earClip,
  findSelfIntersection,
  measureAuthoredMeshFit,
  MeshError,
  offsetPolygon,
  prunePolygon,
  signedArea,
  simplifyClosedPolygon,
  traceAlphaOutline,
  traceOutline,
} from 'spine-rigc/src/mesh.ts';

/** Grid units per pixel: every coordinate this module writes is an integer multiple of 1/GRID px. */
export const GRID = 256;

/**
 * The largest part side, in px, the exactness argument above holds for: a
 * coordinate is at most `MAX_SIDE * GRID` = 2^23 units and the outline may sit
 * up to a margin outside the window before the clamp, so every difference
 * stays under 2^24. A larger part is refused by name, not computed inexactly.
 */
export const MAX_SIDE = 32768;

/**
 * The keep rule's one constant — a de-duplication radius, not a quality
 * threshold. **Definition:** a candidate interior point with spacing `s` is
 * kept when it lies strictly inside the outline AND its distance to every
 * outline edge AND to every point already kept is at least
 * `KEEP_FRACTION × s`, that radius snapped to the {@link GRID}
 * (`round(KEEP_FRACTION × s × GRID)` units, which must be at least 1). Each
 * candidate is held to ITS OWN spacing's radius, so a background point keeps a
 * background distance from a region's fine points, and a region's points keep
 * a fine distance from each other.
 */
export const KEEP_FRACTION = 0.5;

/**
 * The largest keep radius, in grid units, whose square is exact in a double
 * (2^26, so the square is at most 2^52): a spacing of 2^19 = 524288 px.
 * Derived, not chosen — a larger spacing is refused, not computed inexactly.
 */
export const MAX_RADIUS = 2 ** 26;

/** A refinement region: a circle in part-image px. */
export interface ContourCircleRegion {
  name: string;
  shape: 'circle';
  /** Centre, part-image px, y down. */
  cx: number;
  cy: number;
  /** Radius, px. */
  r: number;
  /** Interior spacing inside the region and its band, px. */
  spacing: number;
  /** Width of the transition band around the region that gets the region's spacing too, px; 0 is no band. */
  band: number;
}

/** A refinement region: a simple polygon in part-image px, either winding. */
export interface ContourPolygonRegion {
  name: string;
  shape: 'polygon';
  points: Array<[number, number]>;
  spacing: number;
  band: number;
}

export type ContourRegion = ContourCircleRegion | ContourPolygonRegion;

export interface ContourParams {
  /** A pixel is art when its alpha is above this; a whole number in 0..254. */
  threshold: number;
  /** rigc's Douglas–Peucker tolerance, px, 0 or more (0 keeps every traced corner). */
  tolerance: number;
  /** rigc's outward offset, px, 0 or more. */
  margin: number;
  /** The background interior spacing, px, above 0. */
  spacing: number;
  /** Refuse a mesh with more vertices than this; absent is no budget. */
  budget?: number;
  /** Refinement regions, in the order their points are placed. */
  regions: readonly ContourRegion[];
}

/** A triangle and a figure measured on it, by its index in `triangles`. */
export interface TriangleFigure {
  triangle: number;
  value: number;
}

export interface ContourReport {
  /** Vertices on the outline — Spine's `hull`. */
  boundaryVertices: number;
  /** Kept interior points. */
  interiorVertices: number;
  /** Kept interior points by where they were declared: each region in order, then the background. */
  interiorBySource: Array<{ source: string; vertices: number }>;
  triangles: number;
  /** Corner-lattice vertices rigc's trace produced, before simplification. */
  tracedVertices: number;
  /** Pixels with alpha above the threshold. */
  artPixels: number;
  /** How many of them a triangle covers — rigc's `measureAuthoredMeshFit`: a pixel is covered when its centre is in or on a triangle. */
  coveredArtPixels: number;
  /** `coveredArtPixels / artPixels`, unrounded. */
  coverage: number;
  /** rigc's `measureAuthoredMeshFit` overshoot: the furthest a covered pixel's centre sits from the nearest pixel of the filled silhouette, px. */
  overshoot: number;
  /** `margin + tolerance + 1`, px — the settled bound overshoot is refused past. */
  overshootBound: number;
  /** The area the outline encloses, px² (exact: the grid's shoelace sum). */
  meshArea: number;
  /** `meshArea − coveredArtPixels`, px²: the transparent area the mesh draws over. */
  enclosedTransparentArea: number;
  /** Transparent pixels enclosed by the island and filled into the outline (rigc's `holePixels`). */
  filledHolePixels: number;
  /** The smallest interior angle of any triangle, degrees (6 decimals), and that triangle. */
  smallestAngle: TriangleFigure;
  /** The largest longest-edge / shortest-edge ratio of any triangle (6 decimals), and that triangle. */
  largestEdgeRatio: TriangleFigure;
  /** Interior edges whose opposite vertex lies strictly inside the neighbouring circumcircle after the last pass — 0 when the triangulation is constrained Delaunay. */
  nonDelaunayEdges: number;
}

export interface ContourMesh {
  /** Part-image px, y down, every value a multiple of 1/{@link GRID}; the first `hull` are the outline, in walk order. */
  vertices: Array<[number, number]>;
  /** Three vertex indices per triangle. */
  triangles: number[];
  hull: number;
  report: ContourReport;
}

// ---------------------------------------------------------------------------
// the parameters
// ---------------------------------------------------------------------------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The keep radius of a spacing, in grid units. */
export function keepRadius(spacing: number): number {
  return Math.round(KEEP_FRACTION * spacing * GRID);
}

/** Every problem with the mask and the parameters, before anything is traced. */
function parameterProblems(part: string, mask: AlphaMask, p: ContourParams): Problem[] {
  const out: Problem[] = [];
  const bad = (field: string, detail: string): void => {
    out.push({ code: 'CONTOUR_PARAMETER', object: `contour mesh "${part}", ${field}`, detail });
  };
  const { width: w, height: h } = mask;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) {
    bad('mask', `is ${w}x${h}; whole numbers from 1 to ${MAX_SIDE} px a side are required (the exact predicates are proved up to that size)`);
  } else if (mask.alpha.length !== w * h) {
    bad('mask', `holds ${mask.alpha.length} alpha bytes for a ${w}x${h} part; ${w * h} are required`);
  }
  if (!Number.isInteger(p.threshold) || p.threshold < 0 || p.threshold > 254) bad('threshold', `is ${p.threshold}; a whole number in 0..254 is required (art is alpha above it)`);
  if (!finite(p.tolerance) || p.tolerance < 0) bad('tolerance', `is ${p.tolerance}; a number of px, 0 or more, is required`);
  if (!finite(p.margin) || p.margin < 0) bad('margin', `is ${p.margin}; a number of px, 0 or more, is required`);
  const spacingOk = (field: string, s: number): void => {
    if (!finite(s) || s <= 0) bad(field, `is ${s}; a number of px above 0 is required`);
    else if (keepRadius(s) < 1) bad(field, `is ${s}; its keep radius ${KEEP_FRACTION} x ${s} px snaps to 0 grid units of 1/${GRID} px, and at least 1 is required`);
    else if (keepRadius(s) > MAX_RADIUS) bad(field, `is ${s}; its keep radius is ${keepRadius(s)} grid units, past the ${MAX_RADIUS} (${MAX_RADIUS / GRID} px) whose square is exact in a double`);
  };
  spacingOk('spacing', p.spacing);
  if (p.budget !== undefined && (!Number.isInteger(p.budget) || p.budget < 3)) bad('budget', `is ${p.budget}; a whole number of vertices, 3 or more, is required`);
  const names = new Set<string>();
  p.regions.forEach((r, i) => {
    const at = `regions[${i}]`;
    if (typeof r.name !== 'string' || r.name === '') bad(`${at}.name`, `is ${JSON.stringify(r.name)}; a non-empty name is required`);
    else if (names.has(r.name)) bad(`${at}.name`, `"${r.name}" is declared twice; each region needs its own name`);
    else names.add(r.name);
    spacingOk(`${at}.spacing`, r.spacing);
    if (!finite(r.band) || r.band < 0) bad(`${at}.band`, `is ${r.band}; a number of px, 0 or more, is required`);
    if (r.shape === 'circle') {
      if (!finite(r.cx) || !finite(r.cy)) bad(`${at}`, `centre (${r.cx}, ${r.cy}); finite px are required`);
      if (!finite(r.r) || r.r <= 0) bad(`${at}.r`, `is ${r.r}; a radius of px above 0 is required`);
    } else if (r.shape === 'polygon') {
      if (!Array.isArray(r.points) || r.points.length < 3 || !r.points.every((q) => Array.isArray(q) && q.length === 2 && finite(q[0]) && finite(q[1]))) {
        bad(`${at}.points`, `has ${Array.isArray(r.points) ? r.points.length : 'no'} point(s); 3 or more [x, y] pairs of finite px are required`);
      } else {
        const ring = r.points.map(([x, y]) => [x, y] as [number, number]);
        const crossing = findSelfIntersection(ring);
        if (Math.abs(signedArea(ring)) === 0) bad(`${at}.points`, 'enclose no area; a simple polygon is required');
        else if (crossing !== null) bad(`${at}.points`, `edge ${crossing[0]} meets edge ${crossing[1]}; a simple polygon (no edge touching another) is required`);
        else if (finite(r.band) && r.band > 0 && findSelfIntersection(bandRing(ring, r.band)) !== null) {
          const c = findSelfIntersection(bandRing(ring, r.band)) as [number, number];
          bad(`${at}.band`, `${r.band} px pushed out of the polygon by rigc's offsetPolygon crosses itself (edge ${c[0]} meets edge ${c[1]}); a band the polygon can be offset by without crossing is required`);
        }
      }
    } else {
      bad(`${at}.shape`, `is ${JSON.stringify((r as { shape: unknown }).shape)}; "circle" or "polygon" is required`);
    }
  });
  return out;
}

/** A polygon wound clockwise on screen (positive `signedArea`), rigc's `offsetPolygon`'s requirement. */
function clockwise(ring: Array<[number, number]>): Array<[number, number]> {
  return signedArea(ring) > 0 ? ring : [...ring].reverse();
}

/** The outer edge of a polygon region's band: rigc's `offsetPolygon` by `band`, on the clockwise ring. */
function bandRing(ring: Array<[number, number]>, band: number): Array<[number, number]> {
  return offsetPolygon(clockwise(ring), band);
}

// ---------------------------------------------------------------------------
// exact predicates on grid units
// ---------------------------------------------------------------------------

/** Twice the signed area of a, b, c in grid units: exact in doubles below 2^24 units a difference. */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * The in-circle determinant of d against a, b, c, in `BigInt`. Positive when d
 * is strictly inside the circle through a, b, c and `orient(a, b, c) > 0`;
 * zero when the four are cocircular.
 */
export function inCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): bigint {
  const adx = BigInt(ax - dx);
  const ady = BigInt(ay - dy);
  const bdx = BigInt(bx - dx);
  const bdy = BigInt(by - dy);
  const cdx = BigInt(cx - dx);
  const cdy = BigInt(cy - dy);
  return (
    (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) +
    (bdx * bdx + bdy * bdy) * (cdx * ady - adx * cdy) +
    (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady)
  );
}

/** Is the squared distance from p to the segment a–b at least `r2`? Exact, in grid units. */
function farFromSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, r2: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const vx = px - ax;
  const vy = py - ay;
  const along = vx * dx + vy * dy;
  const len2 = dx * dx + dy * dy;
  if (along <= 0) return vx * vx + vy * vy >= r2;
  if (along >= len2) return (px - bx) * (px - bx) + (py - by) * (py - by) >= r2;
  // Inside the span: distance² = cross² / len2, compared without dividing.
  const cross = BigInt(dx * vy - dy * vx);
  return cross * cross >= BigInt(r2) * BigInt(len2);
}

/** Is p strictly inside the closed ring (even–odd crossing rule, exact on grid units)? A point on an edge is not asked. */
function insideRing(px: number, py: number, xs: readonly number[], ys: readonly number[]): boolean {
  let inside = false;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ay = ys[j];
    const by = ys[i];
    if (ay > py === by > py) continue;
    const o = orient(xs[j], ay, xs[i], by, px, py);
    if (by > ay ? o > 0 : o < 0) inside = !inside;
  }
  return inside;
}

/** The same rule in plain doubles, for a region's own shape (a membership test, not topology). */
function insideFloatRing(px: number, py: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    if (ay > py === by > py) continue;
    const o = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (by > ay ? o > 0 : o < 0) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// interior candidates
// ---------------------------------------------------------------------------

/** One candidate interior point: grid units, the keep radius it is held to, and where it was declared. */
export interface Candidate {
  x: number;
  y: number;
  radius: number;
  source: string;
}

const snap = (v: number): number => Math.round(v * GRID);

/** Points along a closed ring, `ceil(edge length / spacing)` per edge (at least 1), starting at each edge's first vertex. */
function alongRing(ring: ReadonlyArray<readonly [number, number]>, spacing: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < ring.length; k++) {
    const [ax, ay] = ring[k];
    const [bx, by] = ring[(k + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / spacing));
    for (let m = 0; m < n; m++) out.push([ax + ((bx - ax) * m) / n, ay + ((by - ay) * m) / n]);
  }
  return out;
}

/** `max(3, ceil(2πr / spacing))` points round a circle, from angle 0 (+x), increasing (clockwise on screen). */
function alongCircle(cx: number, cy: number, r: number, spacing: number): Array<[number, number]> {
  const n = Math.max(3, Math.ceil((2 * Math.PI * r) / spacing));
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

/** The grid points `(i·s, j·s)` inside a box, row-major. */
function gridIn(x0: number, y0: number, x1: number, y1: number, s: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = Math.ceil(y0 / s); j * s <= y1; j++) for (let i = Math.ceil(x0 / s); i * s <= x1; i++) out.push([i * s, j * s]);
  return out;
}

/**
 * Every candidate interior point, in the order the keep rule tries them:
 *
 * 1. each region, in the order declared: points along its boundary at its
 *    spacing; then points along the outer edge of its band at its spacing
 *    (when the band is above 0); then the points `(i·s, j·s)` of its own
 *    spacing's grid, anchored at the part image's origin, that lie in the
 *    region or its band, row-major. A circle's band edge is the circle of
 *    radius `r + band`; a polygon's is rigc's `offsetPolygon` of it by `band`
 *    (mitred, clamped), and "in the band" means inside that ring;
 * 2. the background: `(i·s, j·s)` for the background spacing over the whole
 *    part image, row-major.
 *
 * Each is snapped to the {@link GRID}; nothing here looks at the art.
 */
export function interiorCandidates(width: number, height: number, params: ContourParams): Candidate[] {
  const out: Candidate[] = [];
  const add = (pts: Array<[number, number]>, spacing: number, source: string): void => {
    const radius = keepRadius(spacing);
    for (const [x, y] of pts) out.push({ x: snap(x), y: snap(y), radius, source });
  };
  for (const r of params.regions) {
    const source = `region "${r.name}"`;
    if (r.shape === 'circle') {
      const outer = r.r + r.band;
      add(alongCircle(r.cx, r.cy, r.r, r.spacing), r.spacing, source);
      if (r.band > 0) add(alongCircle(r.cx, r.cy, outer, r.spacing), r.spacing, source);
      add(
        gridIn(r.cx - outer, r.cy - outer, r.cx + outer, r.cy + outer, r.spacing).filter(([x, y]) => (x - r.cx) * (x - r.cx) + (y - r.cy) * (y - r.cy) <= outer * outer),
        r.spacing,
        source,
      );
    } else {
      const ring = r.points.map(([x, y]) => [x, y] as [number, number]);
      const edge = r.band > 0 ? bandRing(ring, r.band) : ring;
      add(alongRing(ring, r.spacing), r.spacing, source);
      if (r.band > 0) add(alongRing(edge, r.spacing), r.spacing, source);
      const xs = edge.map((q) => q[0]);
      const ys = edge.map((q) => q[1]);
      add(gridIn(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), r.spacing).filter(([x, y]) => insideFloatRing(x, y, edge)), r.spacing, source);
    }
  }
  add(gridIn(0, 0, width, height, params.spacing), params.spacing, 'background');
  return out;
}

/**
 * The keep rule ({@link KEEP_FRACTION}) over the candidates in order, against
 * an outline in grid units. Exact: inside by the crossing rule on integers,
 * distances compared squared, in `BigInt` where a product could pass 2^53.
 */
export function keepPoints(hx: readonly number[], hy: readonly number[], candidates: readonly Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  const n = hx.length;
  for (const c of candidates) {
    const r2 = c.radius * c.radius;
    if (!insideRing(c.x, c.y, hx, hy)) continue;
    let ok = true;
    for (let i = 0; i < n && ok; i++) ok = farFromSegment(c.x, c.y, hx[i], hy[i], hx[(i + 1) % n], hy[(i + 1) % n], r2);
    for (let k = 0; k < kept.length && ok; k++) {
      const dx = c.x - kept[k].x;
      const dy = c.y - kept[k].y;
      ok = dx * dx + dy * dy >= r2;
    }
    if (ok) kept.push(c);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// the triangulation
// ---------------------------------------------------------------------------

/**
 * A triangulation under construction: triangles as vertex triples wound with
 * `orient > 0`, and every directed edge a→b mapped to the triangle that holds
 * it. The neighbour across a→b is the owner of b→a; an outline edge has none,
 * which is what makes it unflippable.
 */
class Triangulation {
  readonly tri: number[] = [];
  private readonly owner = new Map<number, number>();

  constructor(
    readonly X: readonly number[],
    readonly Y: readonly number[],
  ) {}

  private key(a: number, b: number): number {
    return a * this.X.length + b;
  }

  get count(): number {
    return this.tri.length / 3;
  }

  ownerOf(a: number, b: number): number | undefined {
    return this.owner.get(this.key(a, b));
  }

  private link(t: number): void {
    const [a, b, c] = [this.tri[3 * t], this.tri[3 * t + 1], this.tri[3 * t + 2]];
    this.owner.set(this.key(a, b), t);
    this.owner.set(this.key(b, c), t);
    this.owner.set(this.key(c, a), t);
  }

  private unlink(t: number): void {
    const [a, b, c] = [this.tri[3 * t], this.tri[3 * t + 1], this.tri[3 * t + 2]];
    this.owner.delete(this.key(a, b));
    this.owner.delete(this.key(b, c));
    this.owner.delete(this.key(c, a));
  }

  /** Overwrite triangle `t` (or append when `t` is the count). */
  set(t: number, a: number, b: number, c: number): void {
    if (t < this.count) this.unlink(t);
    this.tri[3 * t] = a;
    this.tri[3 * t + 1] = b;
    this.tri[3 * t + 2] = c;
    this.link(t);
  }

  orient(a: number, b: number, c: number): number {
    return orient(this.X[a], this.Y[a], this.X[b], this.Y[b], this.X[c], this.Y[c]);
  }

  /** The vertex of triangle `t` that is not on its directed edge a→b. */
  third(t: number, a: number): number {
    const v = [this.tri[3 * t], this.tri[3 * t + 1], this.tri[3 * t + 2]];
    const k = v.indexOf(a);
    return v[(k + 2) % 3];
  }

  /**
   * Is the edge a→b (of triangle `t`, opposite vertex c) not locally Delaunay —
   * the vertex d across it strictly inside the circumcircle of a, b, c — and
   * flippable (a, d, c and b, c, d both strictly wound)? Exact; a tie (d on the
   * circle) is not a violation.
   */
  illegal(a: number, b: number, c: number, d: number): boolean {
    const { X, Y } = this;
    if (inCircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[d], Y[d]) <= 0n) return false;
    return this.orient(a, d, c) > 0 && this.orient(b, c, d) > 0;
  }

  /** Flip the edge a→b shared by t = (a, b, c) and u = (b, a, d) into c–d: t becomes (a, d, c), u becomes (b, c, d). */
  flip(t: number, u: number, a: number, b: number, c: number, d: number): void {
    this.unlink(t);
    this.unlink(u);
    this.tri[3 * t] = a;
    this.tri[3 * t + 1] = d;
    this.tri[3 * t + 2] = c;
    this.tri[3 * u] = b;
    this.tri[3 * u + 1] = c;
    this.tri[3 * u + 2] = d;
    this.link(t);
    this.link(u);
  }

  /** Restore the Delaunay condition around a new point p, from the edges opposite it, last pushed first. */
  legalize(p: number, edges: Array<[number, number]>): void {
    while (edges.length > 0) {
      const [x, y] = edges.pop() as [number, number];
      const t = this.ownerOf(x, y);
      const u = this.ownerOf(y, x);
      if (t === undefined || u === undefined) continue; // an outline edge: never flipped
      if (this.third(t, x) !== p) continue; // the edge was flipped away since it was pushed
      const d = this.third(u, y);
      if (!this.illegal(x, y, p, d)) continue;
      this.flip(t, u, x, y, p, d);
      edges.push([x, d], [d, y]);
    }
  }

  /** Flip every interior edge that is not locally Delaunay, scanning in triangle order, until a pass flips none. Returns the flips. */
  legalizeAll(): number {
    let flips = 0;
    for (let changed = true; changed; ) {
      changed = false;
      for (let t = 0; t < this.count; t++) {
        for (let k = 0; k < 3; k++) {
          const a = this.tri[3 * t + k];
          const b = this.tri[3 * t + ((k + 1) % 3)];
          const u = this.ownerOf(b, a);
          if (u === undefined || u < t) continue;
          const c = this.third(t, a);
          const d = this.third(u, b);
          if (!this.illegal(a, b, c, d)) continue;
          this.flip(t, u, a, b, c, d);
          flips++;
          changed = true;
          break;
        }
      }
    }
    return flips;
  }

  /** Interior edges that are not locally Delaunay — the count the report carries. */
  violations(): number {
    let n = 0;
    for (let t = 0; t < this.count; t++) {
      for (let k = 0; k < 3; k++) {
        const a = this.tri[3 * t + k];
        const b = this.tri[3 * t + ((k + 1) % 3)];
        const u = this.ownerOf(b, a);
        if (u === undefined || u < t) continue;
        const { X, Y } = this;
        const c = this.third(t, a);
        const d = this.third(u, b);
        if (inCircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[d], Y[d]) > 0n) n++;
      }
    }
    return n;
  }

  /**
   * Insert vertex p: split the first triangle (in index order) that holds it,
   * in three, or — when it lies on an interior edge — that triangle and its
   * neighbour across the edge, in four; then legalize.
   */
  insert(p: number): void {
    for (let t = 0; t < this.count; t++) {
      const a = this.tri[3 * t];
      const b = this.tri[3 * t + 1];
      const c = this.tri[3 * t + 2];
      const o1 = this.orient(a, b, p);
      const o2 = this.orient(b, c, p);
      const o3 = this.orient(c, a, p);
      if (o1 < 0 || o2 < 0 || o3 < 0) continue;
      const zero = o1 === 0 ? [a, b, c] : o2 === 0 ? [b, c, a] : o3 === 0 ? [c, a, b] : null;
      if (zero === null) {
        this.set(t, a, b, p);
        const t2 = this.count;
        this.set(t2, b, c, p);
        this.set(t2 + 1, c, a, p);
        this.legalize(p, [[a, b], [b, c], [c, a]]);
        return;
      }
      const [e0, e1, e2] = zero; // p on e0→e1, e2 opposite
      const u = this.ownerOf(e1, e0);
      if (u === undefined) throw new Error(`contour: vertex ${p} lies on outline edge ${e0}-${e1}, which the keep radius rules out`);
      const d = this.third(u, e1);
      this.set(t, e2, e0, p);
      this.set(u, e1, e2, p);
      const t3 = this.count;
      this.set(t3, d, e1, p);
      this.set(t3 + 1, e0, d, p);
      this.legalize(p, [[e2, e0], [e1, e2], [d, e1], [e0, d]]);
      return;
    }
    throw new Error(`contour: no triangle holds vertex ${p}, which the keep rule placed strictly inside the outline`);
  }
}

/**
 * Interior edges of a mesh in this module's form that are not locally
 * Delaunay: the vertex across the edge strictly inside the circumcircle of the
 * triangle on this side. Exact on {@link GRID} coordinates; 0 for a
 * constrained Delaunay triangulation (the outline's edges, which have no
 * neighbour, are not asked).
 */
export function delaunayViolations(vertices: ReadonlyArray<readonly [number, number]>, triangles: readonly number[]): number {
  const mesh = new Triangulation(
    vertices.map((v) => snap(v[0])),
    vertices.map((v) => snap(v[1])),
  );
  for (let t = 0; t < triangles.length; t += 3) mesh.set(t / 3, triangles[t], triangles[t + 1], triangles[t + 2]);
  return mesh.violations();
}

/** Each triangle rotated to start at its smallest index (winding kept), and the list sorted. */
function canonicalTriangles(tri: readonly number[]): number[] {
  const rows: Array<[number, number, number]> = [];
  for (let t = 0; t < tri.length; t += 3) {
    const v = [tri[t], tri[t + 1], tri[t + 2]];
    const k = v.indexOf(Math.min(...v));
    rows.push([v[k], v[(k + 1) % 3], v[(k + 2) % 3]]);
  }
  rows.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  return rows.flat();
}

// ---------------------------------------------------------------------------
// the checks a returned mesh is held to
// ---------------------------------------------------------------------------

/** Twice the area a closed ring of grid units encloses, exactly: the shoelace sum in `BigInt`. */
function twiceAreaUnits(xs: readonly number[], ys: readonly number[]): bigint {
  let sum = 0n;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    sum += BigInt(xs[i]) * BigInt(ys[j]) - BigInt(xs[j]) * BigInt(ys[i]);
  }
  return sum;
}

/** A twice-area in grid units², as px² for a message or the report (rounded once, at the end). */
const unitsToPx2 = (twice: bigint): number => Number(twice) / 2 / (GRID * GRID);

/**
 * The topology refusals of the settled comment, on any mesh in this module's
 * form (part-image px, y down, the outline first), each naming the part:
 *
 * - `CONTOUR_INDEX` — a triangle index that is not a whole number in range;
 * - `CONTOUR_GRID` — a vertex that is not on the {@link GRID} inside
 *   ±{@link MAX_SIDE} px: every exact predicate below is exact only there;
 * - `CONTOUR_COINCIDENT_VERTICES` — two vertices at the same point;
 * - `CONTOUR_ZERO_AREA_TRIANGLE` — a triangle whose corners are collinear;
 * - `CONTOUR_SELF_INTERSECTION` — the first `hull` vertices, as a ring, meet
 *   themselves (rigc's `findSelfIntersection`, touching included);
 * - `CONTOUR_ONE_LOOP` — rigc's own `traceOutline` and `checkHullOrder`, the
 *   functions its gate runs on an authored mesh: one closed loop, `2V − hull −
 *   2` triangles, the outline first and in order, and a `hull` that agrees;
 * - `CONTOUR_TILING` — a triangle wound against the outline, or triangle areas
 *   that do not sum to the outline's: with every triangle wound one way and
 *   the boundary the outline, the sum is what rules out an overlap. rigc's
 *   `traceOutline` counts edge USES, so a triangle listed four times over (its
 *   edges then used four times, "interior") passes it; the sum does not
 *   (selftest `CT18`).
 *
 * Orientation is computed on grid integers (exact, see the module header);
 * the two area sums in `BigInt`.
 */
export function contourTopologyProblems(part: string, vertices: ReadonlyArray<readonly [number, number]>, triangles: readonly number[], hull: number): Problem[] {
  const out: Problem[] = [];
  const object = `contour mesh "${part}"`;
  const V = vertices.length;
  const badIndex = triangles.findIndex((i) => !Number.isInteger(i) || i < 0 || i >= V);
  if (triangles.length % 3 !== 0 || badIndex >= 0) {
    out.push({
      code: 'CONTOUR_INDEX',
      object,
      detail:
        triangles.length % 3 !== 0
          ? `has ${triangles.length} triangle indices; a multiple of 3 is required`
          : `triangle ${Math.floor(badIndex / 3)} names vertex ${triangles[badIndex]}; whole numbers in 0..${V - 1} are required`,
    });
    return out;
  }
  const X = vertices.map((v) => v[0] * GRID);
  const Y = vertices.map((v) => v[1] * GRID);
  const off = X.findIndex((x, i) => !Number.isInteger(x) || !Number.isInteger(Y[i]) || Math.abs(x) > MAX_SIDE * GRID || Math.abs(Y[i]) > MAX_SIDE * GRID);
  if (off >= 0) {
    out.push({ code: 'CONTOUR_GRID', object, detail: `vertex ${off} is at (${vertices[off][0]}, ${vertices[off][1]}); every coordinate must be a multiple of 1/${GRID} px within ±${MAX_SIDE} px, where the predicates are exact` });
    return out;
  }
  const seen = new Map<string, number>();
  for (let i = 0; i < V; i++) {
    const k = `${X[i]},${Y[i]}`;
    const j = seen.get(k);
    if (j !== undefined) {
      out.push({ code: 'CONTOUR_COINCIDENT_VERTICES', object, detail: `vertices ${j} and ${i} are both at (${vertices[i][0]}, ${vertices[i][1]}); distinct positions are required` });
      break;
    }
    seen.set(k, i);
  }
  let against = -1;
  let sum = 0n;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const s = orient(X[a], Y[a], X[b], Y[b], X[c], Y[c]);
    if (s === 0) {
      out.push({ code: 'CONTOUR_ZERO_AREA_TRIANGLE', object, detail: `triangle ${t / 3} (${a}, ${b}, ${c}) has zero area; every triangle needs a non-zero area` });
      break;
    }
    if (s < 0 && against < 0) against = t / 3;
    sum += BigInt(s);
  }
  const ring = vertices.slice(0, hull).map(([x, y]) => [x, y] as [number, number]);
  const crossing = hull >= 3 ? findSelfIntersection(ring) : null;
  if (crossing !== null) {
    out.push({ code: 'CONTOUR_SELF_INTERSECTION', object, detail: `outline edge ${crossing[0]} meets outline edge ${crossing[1]}; an outline that touches itself nowhere is required` });
  }
  try {
    const outline = traceOutline(V, triangles);
    if (outline.hull !== hull) throw new MeshError(`it declares hull ${hull} and its triangles outline ${outline.hull} vertices`);
    checkHullOrder(outline, V);
  } catch (err) {
    if (!(err instanceof MeshError)) throw err;
    out.push({ code: 'CONTOUR_ONE_LOOP', object, detail: `spine-rigc's traceOutline/checkHullOrder: ${err.message}; one closed loop of the first ${hull} vertices in order, with 2 x ${V} - ${hull} - 2 = ${2 * V - hull - 2} triangles, is required` });
  }
  const outlineTwice = twiceAreaUnits(X.slice(0, hull), Y.slice(0, hull));
  if (against >= 0 || (out.length === 0 && sum !== outlineTwice)) {
    out.push({
      code: 'CONTOUR_TILING',
      object,
      detail:
        against >= 0
          ? `triangle ${against} is wound against the outline; every triangle must be wound as the outline is (clockwise on screen)`
          : `its triangles' areas sum to ${unitsToPx2(sum)} px² and its outline encloses ${unitsToPx2(outlineTwice)} px²; equal is required, or triangles overlap`,
    });
  }
  return out;
}

/** The art a threshold makes: alpha above it, as a 0/1 mask. */
export function artMask(mask: AlphaMask, threshold: number): Mask {
  const data = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < data.length; i++) data[i] = mask.alpha[i] > threshold ? 1 : 0;
  return { width: mask.width, height: mask.height, data };
}

/**
 * Coverage and overshoot, the two fit refusals, measured by spine-rigc's
 * `measureAuthoredMeshFit` (the settled comment names it): a pixel is covered
 * when its centre is in or on a triangle, and overshoot is the furthest a
 * covered pixel's centre sits from the nearest pixel of the filled silhouette
 * (all art plus what it encloses), centre to centre. That is the convention
 * the bound's `+ 1` is for — a pixel whose centre lands inside can sit up to a
 * pixel from the true edge (rigc's `contourOvershootBound`, whose `margin`
 * term is `margin × 4`, the miter clamp; the settled bound here is `margin`).
 * The refusal on coverage is any art pixel uncovered, not rigc's 99.5 %.
 */
export function contourFit(
  part: string,
  mask: AlphaMask,
  threshold: number,
  bound: { margin: number; tolerance: number },
  vertices: ReadonlyArray<readonly [number, number]>,
  triangles: readonly number[],
): { problems: Problem[]; artPixels: number; coveredArt: number; coverage: number; overshoot: number; overshootBound: number } {
  const fit = measureAuthoredMeshFit(
    mask,
    threshold + 1,
    vertices.map(([x, y]) => [x, y] as [number, number]),
    [...triangles],
  );
  const overshootBound = bound.margin + bound.tolerance + 1;
  const problems: Problem[] = [];
  const object = `contour mesh "${part}"`;
  if (fit.coveredArt < fit.artPixels) {
    problems.push({
      code: 'CONTOUR_COVERAGE',
      object,
      detail: `${fit.artPixels - fit.coveredArt} of ${fit.artPixels} art pixel(s) (alpha above ${threshold}) lie outside the mesh at tolerance ${bound.tolerance} px and margin ${bound.margin} px; every art pixel inside is required — art is never clipped, so raise the margin or lower the tolerance`,
    });
  }
  if (fit.overshoot > overshootBound) {
    problems.push({
      code: 'CONTOUR_OVERSHOOT',
      object,
      detail: `the mesh reaches ${fit.overshoot} px past the art; at most margin ${bound.margin} + tolerance ${bound.tolerance} + 1 = ${overshootBound} px is required`,
    });
  }
  return { problems, artPixels: fit.artPixels, coveredArt: fit.coveredArt, coverage: fit.artPixels === 0 ? 0 : fit.coveredArt / fit.artPixels, overshoot: fit.overshoot, overshootBound };
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The smallest angle and the largest edge ratio over the triangles, each with the first triangle that has it. */
export function triangleQuality(vertices: ReadonlyArray<readonly [number, number]>, triangles: readonly number[]): { smallestAngle: TriangleFigure; largestEdgeRatio: TriangleFigure } {
  let minAngle = Infinity;
  let minAt = -1;
  let maxRatio = -Infinity;
  let maxAt = -1;
  for (let t = 0; t < triangles.length; t += 3) {
    const p = [vertices[triangles[t]], vertices[triangles[t + 1]], vertices[triangles[t + 2]]];
    const len2 = [0, 1, 2].map((k) => {
      const a = p[(k + 1) % 3];
      const b = p[(k + 2) % 3];
      return (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    });
    const len = len2.map(Math.sqrt);
    for (let k = 0; k < 3; k++) {
      // The angle at corner k, opposite side k, by the law of cosines.
      const cos = (len2[(k + 1) % 3] + len2[(k + 2) % 3] - len2[k]) / (2 * len[(k + 1) % 3] * len[(k + 2) % 3]);
      const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (deg < minAngle) {
        minAngle = deg;
        minAt = t / 3;
      }
    }
    const ratio = Math.max(...len) / Math.min(...len);
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxAt = t / 3;
    }
  }
  return { smallestAngle: { triangle: minAt, value: r6(minAngle) }, largestEdgeRatio: { triangle: maxAt, value: r6(maxRatio) } };
}

// ---------------------------------------------------------------------------
// the mesh
// ---------------------------------------------------------------------------

/**
 * The contour mesh of one part, or every problem that refuses it. `part` is
 * the name each refusal carries. Pure: same mask and parameters, same bytes.
 */
export function contourMesh(part: string, mask: AlphaMask, params: ContourParams): ContourMesh | Problem[] {
  const object = `contour mesh "${part}"`;
  const early = parameterProblems(part, mask, params);
  if (early.length > 0) return early;
  const { width: w, height: h } = mask;
  const { threshold, tolerance, margin } = params;

  const art = artMask(mask, threshold);
  const comp = connectedComponents(art, 4);
  const islands = comp.count - 1;
  if (islands === 0) {
    return [{ code: 'CONTOUR_PART_HAS_ART', object, detail: `its ${w}x${h} image has no pixel with alpha above ${threshold}; a mesh needs at least one art pixel` }];
  }
  if (islands > 1) {
    const sizes = comp.stats.slice(1).map((s) => `${s.area} px at (${s.left}, ${s.top})`);
    return [
      {
        code: 'CONTOUR_ONE_ISLAND',
        object,
        detail: `its art (alpha above ${threshold}) is ${islands} separate 4-connected islands — ${sizes.join(', ')}; one island is required, because spine-rigc takes one closed outline per mesh. Nothing was discarded; the lattice mode stays available for this part`,
      },
    ];
  }

  let traced: ReturnType<typeof traceAlphaOutline>;
  try {
    traced = traceAlphaOutline(mask, threshold + 1);
  } catch (err) {
    if (!(err instanceof MeshError)) throw err;
    return [{ code: 'CONTOUR_TRACE', object, detail: `spine-rigc's traceAlphaOutline refused it at alpha above ${threshold}: ${err.message}` }];
  }
  const pushed = offsetPolygon(simplifyClosedPolygon(traced.outline, tolerance), margin);
  const snapped = pushed.map(([x, y]) => [snap(Math.min(w, Math.max(0, x))) / GRID, snap(Math.min(h, Math.max(0, y))) / GRID] as [number, number]);
  const outline = prunePolygon(snapped);
  if (outline.length < 3 || signedArea(outline) <= 0 || findSelfIntersection(outline) !== null) {
    const crossing = outline.length < 3 ? null : findSelfIntersection(outline);
    return [
      {
        code: 'CONTOUR_SELF_INTERSECTION',
        object,
        detail:
          crossing !== null
            ? `after tolerance ${tolerance} px and margin ${margin} px its outline's edge ${crossing[0]} meets edge ${crossing[1]}; an outline that touches itself nowhere is required — lower the margin, or the art has a neck narrower than twice it`
            : `after tolerance ${tolerance} px and margin ${margin} px its outline has ${outline.length} vertices enclosing ${outline.length < 3 ? 0 : signedArea(outline)} px² (clockwise on screen is positive); 3 or more enclosing a positive area are required — lower the tolerance`,
      },
    ];
  }

  const hx = outline.map((q) => snap(q[0]));
  const hy = outline.map((q) => snap(q[1]));
  // A candidate outside the part window cannot be inside the outline (clamped to it), and dropping it first keeps
  // every coordinate the predicates see within the window — the exactness bound.
  const kept = keepPoints(hx, hy, interiorCandidates(w, h, params).filter((c) => c.x >= 0 && c.y >= 0 && c.x <= w * GRID && c.y <= h * GRID));
  const X = [...hx, ...kept.map((c) => c.x)];
  const Y = [...hy, ...kept.map((c) => c.y)];
  const H = outline.length;

  const mesh = new Triangulation(X, Y);
  const ears = earClip(outline);
  for (let t = 0; t < ears.length; t += 3) mesh.set(t / 3, ears[t], ears[t + 1], ears[t + 2]);
  mesh.legalizeAll();
  for (let k = 0; k < kept.length; k++) mesh.insert(H + k);
  mesh.legalizeAll();

  const vertices = X.map((x, i) => [x / GRID, Y[i] / GRID] as [number, number]);
  const triangles = canonicalTriangles(mesh.tri);
  const problems = contourTopologyProblems(part, vertices, triangles, H);
  const fit = contourFit(part, mask, threshold, { margin, tolerance }, vertices, triangles);
  problems.push(...fit.problems);
  if (params.budget !== undefined && vertices.length > params.budget) {
    problems.push({
      code: 'CONTOUR_BUDGET',
      object,
      detail: `has ${vertices.length} vertices (${H} on the outline, ${kept.length} inside); the declared budget is ${params.budget} — nothing is thinned to fit, so raise the spacing or the tolerance, or the budget`,
    });
  }
  if (problems.length > 0) return problems;

  const bySource = new Map<string, number>();
  for (const r of params.regions) bySource.set(`region "${r.name}"`, 0);
  bySource.set('background', 0);
  for (const c of kept) bySource.set(c.source, (bySource.get(c.source) as number) + 1);
  const meshArea = unitsToPx2(twiceAreaUnits(hx, hy));
  return {
    vertices,
    triangles,
    hull: H,
    report: {
      boundaryVertices: H,
      interiorVertices: kept.length,
      interiorBySource: [...bySource].map(([source, n]) => ({ source, vertices: n })),
      triangles: triangles.length / 3,
      tracedVertices: traced.outline.length,
      artPixels: fit.artPixels,
      coveredArtPixels: fit.coveredArt,
      coverage: fit.coverage,
      overshoot: fit.overshoot,
      overshootBound: fit.overshootBound,
      meshArea,
      enclosedTransparentArea: meshArea - fit.coveredArt,
      filledHolePixels: traced.holePixels,
      ...triangleQuality(vertices, triangles),
      nonDelaunayEdges: delaunayViolations(vertices, triangles),
    },
  };
}
