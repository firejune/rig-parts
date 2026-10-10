/**
 * Bone heat: a mesh's weights as the heat equilibrium over the part's own
 * silhouette (issue #161, the reduced shape). An author opts a mesh in with
 * `meshes.<part>.rule: "heat"`; absent, or `"distance"`, the mesh is weighted
 * by `influences()` (`src/weights.ts`) and nothing here runs.
 *
 * ## The rule, as a definition
 *
 * 1. **The domain** is a set of the part image's pixels, the silhouette the
 *    mesh's mode reads (the rig stage hands it in): the lattice's art — alpha
 *    above 8 — with its holes filled ({@link latticeSilhouette}); for the
 *    contour and the automatic modes, the silhouette the outline was traced
 *    from, which is the kept art with its holes filled and grown by the
 *    declared margin ({@link tracedSilhouette}, the same calls
 *    `contourOutline` makes). Neighbours are 4-connected; a neighbour off the
 *    silhouette is no neighbour, so no heat crosses the boundary.
 * 2. **Sources.** A silhouette pixel whose centre lies within
 *    {@link HEAT_SOURCE_BAND} px of one of a bound bone's segments is that
 *    bone's source; a pixel two bones reach goes to the bone whose segment is
 *    nearer its centre, a tie to the bone listed first among the segments.
 *    The band is above √2 / 2, so every pixel a segment passes through is
 *    reached. Per bone, the field is 1 on its own sources, 0 on every other
 *    bone's, and the discrete Laplace equation (each free pixel the mean of
 *    its neighbours) everywhere else.
 * 3. **The solve** is successive over-relaxation — Gauss–Seidel, sweeping the
 *    free pixels in row-major order, each update over-relaxed by
 *    `omega = 2 / (1 + π / L)`, L the image's longer side (the small-angle
 *    form of the optimum `2 / (1 + sin(π / L))`: `sin`'s last bit is the
 *    engine's, a division is IEEE's) — from 0, until the largest change in
 *    one sweep is under {@link HEAT_TOLERANCE}. A bone that has not got there
 *    in {@link HEAT_MAX_ITERATIONS} sweeps is refused (`RIG_HEAT_CONVERGED`),
 *    never written half-solved. Float64 throughout; distances are
 *    `segmentDistance`'s, not `Math.hypot`.
 * 4. **A vertex** reads every bone's field at the silhouette pixel whose
 *    centre is nearest it (a tie to the first in raster order) — a vertex on a
 *    pixel corner, as every lattice vertex is, touches four — keeps the bones
 *    whose value there is above 0, and takes the cap and the floor the distance
 *    rule takes (`capAndFloor`, the mesh's `InfluenceLimits`).
 *
 * ## What is refused rather than weighted 0
 *
 * - `RIG_HEAT_BONE_SOURCE`: a bound bone that holds no source pixel — a
 *   zero-length control bone off the art, a segment wholly off the
 *   silhouette, or one whose every reached pixel is nearer another bone. A
 *   bone named in `segments` is a bone the author said may pull the layer;
 *   giving it 0 everywhere would be a silent answer to a question the
 *   config asked.
 * - `RIG_HEAT_ISLAND_SOURCE`: a 4-connected island of the silhouette that no
 *   bone has a source in. With no fixed temperature the equation has no
 *   answer there; nothing nearest is borrowed.
 * - `RIG_HEAT_CONVERGED`: above.
 *
 * Two runs on the same input write the same bytes: the claims, the sweep
 * order and the arithmetic are fixed, and nothing reads a clock.
 */
import type { Point } from './config.ts';
import { artMask, growSilhouette } from './contour.ts';
import type { Problem } from './errors.ts';
import { connectedComponents, fillHoles, type Mask } from './raster/index.ts';
import { capAndFloor, type Influence, type InfluenceLimits, type Segment, segmentDistance } from './weights.ts';

/** The solve stops when the largest change in one sweep is under this — Stage A's figure (`tools/weight_rule_survey.ts`). */
export const HEAT_TOLERANCE = 1e-7;

/** The most sweeps one bone's field may take; past it the mesh is refused (`RIG_HEAT_CONVERGED`). Stage A's figure. */
export const HEAT_MAX_ITERATIONS = 20000;

/** A pixel is a bone's source when its centre lies within this of the bone's segment, px: above √2 / 2, so every pixel a segment crosses is reached. Stage A's figure. */
export const HEAT_SOURCE_BAND = 0.75;

/** The sweep, in the words the report row echoes. */
export const HEAT_SWEEP = 'gauss-seidel, row-major, over-relaxed';

export interface HeatLimits {
  tolerance: number;
  maxIterations: number;
}

export const HEAT_LIMITS: HeatLimits = { tolerance: HEAT_TOLERANCE, maxIterations: HEAT_MAX_ITERATIONS };

/** The lattice's silhouette: its art (alpha above 8, the mask `latticeMesh` reads) with holes filled, as the lattice fills them. */
export function latticeSilhouette(art: Mask): Mask {
  return fillHoles(art);
}

/** The contour and automatic modes' silhouette: the traced mask's art at `threshold`, holes filled, grown by `margin` — the silhouette `contourOutline` traces. */
export function tracedSilhouette(mask: { width: number; height: number; alpha: Uint8Array }, threshold: number, margin: number): Mask {
  return growSilhouette(fillHoles(artMask(mask, threshold)), margin).mask;
}

/** One mesh's solved fields. */
export interface HeatField {
  silhouette: Mask;
  /** Bound bones, in first-appearance order among the segments. */
  bones: string[];
  /** One field per bone, row-major over the image; 0 off the silhouette. */
  fields: Float64Array[];
  /** Per bone: source pixels held, and sweeps taken. */
  sources: number[];
  iterations: number[];
  omega: number;
  /** The largest |value − mean of its neighbours| over the free pixels, over every bone, after the solve. */
  residual: number;
  islands: number;
}

/** The row a heat mesh adds to its `mesh_report.json` entry, so the declaration and the solve it ran are read back. */
export interface HeatRow {
  rule: 'heat';
  tolerance: number;
  max_iterations: number;
  source_band: number;
  sweep: string;
  omega: number;
  silhouette_pixels: number;
  islands: number;
  bones: Array<{ bone: string; sources: number; iterations: number }>;
  residual: number;
}

const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * Solve bone heat over `sil` (part-image pixels) for `segs` (rig px; the image is the rig less `(ox, oy)`).
 * `object` names the mesh in every refusal. Every problem found is returned at once.
 */
export function boneHeat(object: string, sil: Mask, segs: readonly Segment[], ox: number, oy: number, limits: HeatLimits = HEAT_LIMITS): HeatField | Problem[] {
  const { width: w, height: h, data } = sil;
  const n = w * h;
  const bones: string[] = [];
  for (const s of segs) if (!bones.includes(s.bone)) bones.push(s.bone);
  const K = bones.length;
  const local = segs.map((s) => ({ k: bones.indexOf(s.bone), a: [s.a[0] - ox, s.a[1] - oy] as Point, b: [s.b[0] - ox, s.b[1] - oy] as Point }));
  const owner = new Int32Array(n).fill(-1);
  const ownD = new Float64Array(n).fill(Infinity);
  const reached = new Array<number>(K).fill(0);
  let silPixels = 0;
  for (let i = 0; i < n; i++) {
    if (data[i] !== 1) continue;
    silPixels++;
    const p: Point = [(i % w) + 0.5, Math.floor(i / w) + 0.5];
    const near = new Float64Array(K).fill(Infinity);
    for (const s of local) {
      const d = segmentDistance(p, s.a, s.b);
      if (d < near[s.k]) near[s.k] = d;
    }
    for (let k = 0; k < K; k++) {
      if (near[k] > HEAT_SOURCE_BAND) continue;
      reached[k]++;
      if (near[k] < ownD[i]) {
        owner[i] = k;
        ownD[i] = near[k];
      }
    }
  }
  const sources = new Array<number>(K).fill(0);
  for (let i = 0; i < n; i++) if (owner[i] >= 0) sources[owner[i]]++;
  const problems: Problem[] = [];
  bones.forEach((bone, k) => {
    if (sources[k] > 0) return;
    const where = local
      .filter((s) => s.k === k)
      .map((s) => `(${fmt(s.a[0] + ox)}, ${fmt(s.a[1] + oy)})->(${fmt(s.b[0] + ox)}, ${fmt(s.b[1] + oy)})`)
      .join(', ');
    const why = reached[k] === 0 ? 'reaches no pixel of the silhouette' : `reaches ${reached[k]} silhouette pixel(s), every one nearer another bound bone's segment`;
    problems.push({
      code: 'RIG_HEAT_BONE_SOURCE',
      object,
      detail: `bone "${bone}" — its segment ${where} (rig px) ${why}, so it holds no source pixel; under rule "heat" every bound bone needs at least one: a silhouette pixel (${silPixels} px) whose centre lies within ${HEAT_SOURCE_BAND} px of the segment and nearer it than any other bound bone's. A bone with no source is not weighted 0 — move its segment onto the art, or take the bone out of segments`,
    });
  });
  const cc = connectedComponents(sil, 4);
  const sourced = new Uint8Array(cc.count);
  for (let i = 0; i < n; i++) if (owner[i] >= 0) sourced[cc.labels[i]] = 1;
  for (let c = 1; c < cc.count; c++) {
    if (sourced[c]) continue;
    const st = cc.stats[c];
    problems.push({
      code: 'RIG_HEAT_ISLAND_SOURCE',
      object,
      detail: `the silhouette's 4-connected island of ${st.area} px at rig (${st.left + ox}, ${st.top + oy}) holds no bound bone's source pixel, so the heat equation has no fixed temperature there and no answer; under rule "heat" every island needs a segment within ${HEAT_SOURCE_BAND} px of one of its pixel centres — nothing is borrowed from the nearest island`,
    });
  }
  if (problems.length > 0) return problems;

  // The free pixels in raster order, each with its 4-neighbours on the silhouette (left, right, up, down: the order the sum is taken in).
  const free: number[] = [];
  const start: number[] = [0];
  const nbr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (data[i] !== 1 || owner[i] >= 0) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    if (x > 0 && data[i - 1] === 1) nbr.push(i - 1);
    if (x < w - 1 && data[i + 1] === 1) nbr.push(i + 1);
    if (y > 0 && data[i - w] === 1) nbr.push(i - w);
    if (y < h - 1 && data[i + w] === 1) nbr.push(i + w);
    free.push(i);
    start.push(nbr.length);
  }
  const F = Int32Array.from(free);
  const S = Int32Array.from(start);
  const N = Int32Array.from(nbr);
  const omega = 2 / (1 + Math.PI / Math.max(w, h));
  const fields: Float64Array[] = [];
  const iterations: number[] = [];
  let residual = 0;
  for (let k = 0; k < K; k++) {
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) if (owner[i] === k) x[i] = 1;
    let it = 0;
    let done = F.length === 0;
    let last = 0;
    while (!done && it < limits.maxIterations) {
      it++;
      let maxD = 0;
      for (let j = 0; j < F.length; j++) {
        const i = F[j];
        const a = S[j];
        const b = S[j + 1];
        let s = 0;
        for (let q = a; q < b; q++) s += x[N[q]];
        const nx = x[i] + omega * (s / (b - a) - x[i]);
        const d = Math.abs(nx - x[i]);
        if (d > maxD) maxD = d;
        x[i] = nx;
      }
      last = maxD;
      if (maxD < limits.tolerance) done = true;
    }
    if (!done) {
      problems.push({
        code: 'RIG_HEAT_CONVERGED',
        object,
        detail: `bone "${bones[k]}"'s field still changed by ${last} in its sweep ${it}; the solve stops at a change under ${limits.tolerance} within ${limits.maxIterations} sweeps (${F.length} free pixel(s), omega ${omega}). Nothing half-solved is written — a smaller part, or the distance rule, is what remains`,
      });
    }
    for (let j = 0; j < F.length; j++) {
      let s = 0;
      for (let q = S[j]; q < S[j + 1]; q++) s += x[N[q]];
      const r = Math.abs(x[F[j]] - s / (S[j + 1] - S[j]));
      if (r > residual) residual = r;
    }
    fields.push(x);
    iterations.push(it);
  }
  if (problems.length > 0) return problems;
  return { silhouette: sil, bones, fields, sources, iterations, omega, residual, islands: cc.count - 1 };
}

/** The silhouette pixel whose centre is nearest `p` (part-image px), a tie to the first in raster order; -1 on an empty silhouette. */
export function nearestSilhouettePixel(sil: Mask, p: Point): number {
  const { width: w, height: h, data } = sil;
  const fx = Math.floor(p[0]);
  const fy = Math.floor(p[1]);
  let best = -1;
  let bd = Infinity;
  // A pixel in the ring at Chebyshev distance k from (fx, fy) lies at least k − 0.5 from p, so once the best is
  // strictly nearer than that, no ring further out can hold a nearer or an equally near pixel.
  const reach = w + h + Math.abs(fx) + Math.abs(fy);
  for (let k = 0; k <= reach; k++) {
    if (best >= 0 && k > 0 && bd < (k - 0.5) * (k - 0.5)) break;
    for (let y = fy - k; y <= fy + k; y++) {
      if (y < 0 || y >= h) continue;
      const edgeRow = y === fy - k || y === fy + k;
      for (let x = fx - k; x <= fx + k; x += edgeRow ? 1 : 2 * k) {
        if (x >= 0 && x < w) {
          const i = y * w + x;
          if (data[i] === 1) {
            const dx = x + 0.5 - p[0];
            const dy = y + 0.5 - p[1];
            const d = dx * dx + dy * dy;
            if (d < bd || (d === bd && i < best)) {
              bd = d;
              best = i;
            }
          }
        }
        if (k === 0) break;
      }
    }
  }
  return best;
}

/** Bone heat's influences on the vertex at `p` (part-image px): the fields at its pixel above 0, capped and floored as the distance rule's are. */
export function heatInfluences(field: HeatField, p: Point, limits: InfluenceLimits): Influence[] {
  const i = nearestSilhouettePixel(field.silhouette, p);
  const raw: Array<[string, number]> = [];
  if (i >= 0) field.bones.forEach((bone, k) => {
    const v = field.fields[k][i];
    if (v > 0) raw.push([bone, v]);
  });
  return capAndFloor(raw, limits);
}

/** The report row of a solved field. */
export function heatRow(field: HeatField, limits: HeatLimits = HEAT_LIMITS): HeatRow {
  let px = 0;
  for (const v of field.silhouette.data) if (v === 1) px++;
  return {
    rule: 'heat',
    tolerance: limits.tolerance,
    max_iterations: limits.maxIterations,
    source_band: HEAT_SOURCE_BAND,
    sweep: HEAT_SWEEP,
    omega: field.omega,
    silhouette_pixels: px,
    islands: field.islands,
    bones: field.bones.map((bone, k) => ({ bone, sources: field.sources[k], iterations: field.iterations[k] })),
    residual: field.residual,
  };
}
