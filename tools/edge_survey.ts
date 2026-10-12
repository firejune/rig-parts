#!/usr/bin/env bun
/**
 * Issue #265 Stage D: where an edge has to be. A part's own weight rule says where its two sides move differently —
 * the line along which the dominant bone changes — and the arms here put the mesh's edges there, against the lattice
 * and a coarse-grid control, at the idle and at the bend set of Stage C.
 *
 *     bun tools/density_survey.ts --run --key <k> --config <cfg> --inputs <dir> [--requirements <r>] --work <W> --draft  # arm 0 (L) and its parts
 *     bun tools/edge_survey.ts --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] > <k>.json
 *     bun tools/edge_survey.ts --page <k>.json… > docs/evidence/density-edges.md
 *
 * **The arms**, on every part the lattice meshes (`grid`); an author's own `contour` mesh (a soft region's) and a
 * part with real pieces (Stage B's dust rule, `tools/contourdraft.ts`) keep their entry:
 *
 * - **(L)** the lattice, the config as tracked — the calibration.
 * - **(O)** the outline plus the lines: Stage B's traced outline (tolerance = margin = T = max(1, round(H / 554)),
 *   dust dropped by `stray`; `contourMesh`, src/contour.ts) and, inside it, the boundaries of the part's
 *   dominant-bone map ({@link dominantLines}): every cell of a {@link LABEL_STEP} px grid over the part labelled by the
 *   bone with the largest weight under the part's own rule (`influences` at its `r`, segments and exponent); the cell
 *   edges between two differently labelled cells, both inside the outline, chained between junctions and simplified
 *   at T (Douglas–Peucker, endpoints kept). Triangulated with every outline and line edge as an edge the triangulation
 *   must contain and no other vertex ({@link cdt}: Bowyer–Watson, then Sloan's edge flips to recover each constraint,
 *   then the outside dropped and Lawson's flips with every constraint locked). `contourMesh` takes no interior
 *   constrained edge — the gap #160's Stage B names — so the triangulation is this tool's, and nothing under `src/`
 *   changes.
 * - **(B)** (O) plus the band rows: the label is the dominant bone and whether the second weight is at least
 *   {@link BAND_SHARE}, so the map's boundaries are the lines and both edges of each falloff band.
 * - **(G)** the control, the owner's "make the grid bigger": the same traced outline with the contour mode's own
 *   interior grid at the figure's spacing (`contour`, `spacing` = round(H / 37), Stage A's middle B), no ribs —
 *   through the real `build`.
 *
 * (O) and (B) are weighted by the rig stage's own distance rule and written into the lattice's `rig.json` in place of
 * the lattice mesh (as Stage A's arm 2 was), then checked by the real `rig-parts check`.
 *
 * **What is read**, per arm: triangles, every `check` bar, figure overdraw, the idle's worst displacement against the
 * lattice (Stage C's line) and, against the dense reference of `tools/bend_survey.ts` (the art sampled and skinned by
 * the part's own rule at each sample), the worst displacement and inverted triangles at the idle (every idle frame)
 * and at the bend set (15° a link, and the film's bends on the trailer).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ContourParams, contourMesh } from '../src/contour.ts';
import { ART_ALPHA, counterClockwiseInSpineWorld } from '../src/mesh.ts';
import { readPng } from '../src/raster/index.ts';
import { PAD, rigJsonText } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { DEFAULT_LIMITS, type InfluenceLimits, influences, type Segment } from '../src/weights.ts';
import { bendPoses, bendReading, bentBones, type Reference, referenceField, readSkeleton, type Skeleton } from './bend_survey.ts';
import { type ChainLine, draftContourMesh, outlineTolerance } from './contourdraft.ts';
import {
  type ArmResult,
  BARS,
  barCell,
  type BoneMatrix,
  delaunay,
  figureHeight,
  fitAffine,
  type Geometry,
  type Json,
  measured,
  type Obj,
  orient,
  overdrawOf,
  type P2,
  type PartBox,
  partBoxes,
  renderGeometry,
  resolveSegments,
  seamCell,
  stage,
  weightsAt,
} from './density_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The label grid's step, px. */
export const LABEL_STEP = 2;

/** A cell is inside a falloff band when its second largest weight is at least this share (arm B). */
export const BAND_SHARE = 0.25;

/** Arm G's divisor: spacing = round(H / 37), Stage A's middle B. */
export const GRID_DIVISOR = 37;

const GRIDU = 256;
const snapU = (v: number): number => Math.round(v * GRIDU) / GRIDU;
const readJ = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const o = (v: Json | undefined): Obj => v as Obj;

// ---------------------------------------------------------------------------
// the lines
// ---------------------------------------------------------------------------

function insidePoly(p: P2, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSeg(p: P2, a: P2, b: P2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

function dp(pts: readonly P2[], tol: number): P2[] {
  if (pts.length <= 2) return [...pts];
  let best = -1;
  let bd = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > bd) [bd, best] = [d, i];
  }
  if (bd <= tol) return [pts[0], pts[pts.length - 1]];
  return [...dp(pts.slice(0, best + 1), tol).slice(0, -1), ...dp(pts.slice(best), tol)];
}

function segCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * The internal boundaries of a part's label map, in part-image px: cells of `step` px whose centre lies inside the
 * outline, each labelled by `label` (a string); every cell edge between two inside cells of different labels; chained
 * between junctions (a corner of any other degree than 2) and ends; each chain simplified at `tol` with its ends kept.
 * A vertex closer than 1 px to the outline is dropped (the chain split there), so no line touches the outline; two
 * simplified chains that cross are both kept at their raw cell edges instead.
 */
export function dominantLines(w: number, h: number, outline: readonly P2[], label: (p: P2) => string, step: number, tol: number): P2[][] {
  const nx = Math.ceil(w / step);
  const ny = Math.ceil(h / step);
  const lab: Array<string | null> = new Array(nx * ny).fill(null);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c: P2 = [(i + 0.5) * step, (j + 0.5) * step];
      if (insidePoly(c, outline)) lab[j * nx + i] = label(c);
    }
  }
  // corners (i, j) for i in 0..nx, j in 0..ny; an edge between corners where the two cells beside it differ
  const key = (i: number, j: number): number => j * (nx + 1) + i;
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  };
  const at = (i: number, j: number): string | null => (i < 0 || j < 0 || i >= nx || j >= ny ? null : lab[j * nx + i]);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = at(i, j);
      if (a === null) continue;
      const r = at(i + 1, j);
      if (r !== null && r !== a) link(key(i + 1, j), key(i + 1, j + 1)); // vertical edge between (i,j) and (i+1,j)
      const d = at(i, j + 1);
      if (d !== null && d !== a) link(key(i, j + 1), key(i + 1, j + 1)); // horizontal edge between (i,j) and (i,j+1)
    }
  }
  const pt = (k: number): P2 => [(k % (nx + 1)) * step, Math.floor(k / (nx + 1)) * step];
  const node = (k: number): boolean => (adj.get(k) ?? []).length !== 2;
  const used = new Set<string>();
  const ek = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  const chains: number[][] = [];
  const walk = (start: number, next: number): number[] => {
    const out = [start, next];
    used.add(ek(start, next));
    let [prev, cur] = [start, next];
    while (!node(cur)) {
      const nb = (adj.get(cur) as number[]).find((x) => x !== prev && !used.has(ek(cur, x)));
      if (nb === undefined) break;
      used.add(ek(cur, nb));
      out.push(nb);
      [prev, cur] = [cur, nb];
      if (cur === start) break;
    }
    return out;
  };
  for (const [k, nbs] of adj) if (node(k)) for (const nb of nbs) if (!used.has(ek(k, nb))) chains.push(walk(k, nb));
  for (const [k, nbs] of adj) for (const nb of nbs) if (!used.has(ek(k, nb))) chains.push(walk(k, nb)); // closed loops
  // away from the outline; split where a point is within 1 px of it
  const far = (p: P2): boolean => {
    if (!insidePoly(p, outline)) return false;
    for (let i = 0; i < outline.length; i++) if (distToSeg(p, outline[i], outline[(i + 1) % outline.length]) < 1) return false;
    return true;
  };
  const raw: P2[][] = [];
  for (const c of chains) {
    let cur: P2[] = [];
    for (const k of c) {
      const p = pt(k);
      if (far(p)) cur.push(p);
      else {
        if (cur.length >= 2) raw.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) raw.push(cur);
  }
  let simp = raw.map((c) => dp(c, tol));
  // two simplified chains that cross (or one crossing the outline): both back to their raw edges
  for (let round = 0; round < 3; round++) {
    const bad = new Set<number>();
    const segs: Array<[number, P2, P2]> = [];
    simp.forEach((c, ci) => {
      for (let i = 0; i + 1 < c.length; i++) segs.push([ci, c[i], c[i + 1]]);
    });
    for (let x = 0; x < segs.length; x++) for (let y = x + 1; y < segs.length; y++) if (segs[x][0] !== segs[y][0] && segCross(segs[x][1], segs[x][2], segs[y][1], segs[y][2])) bad.add(segs[x][0]).add(segs[y][0]);
    for (const [ci, a, b] of segs) for (let i = 0; i < outline.length; i++) if (segCross(a, b, outline[i], outline[(i + 1) % outline.length])) bad.add(ci);
    if (bad.size === 0) break;
    simp = simp.map((c, ci) => (bad.has(ci) ? raw[ci] : c));
  }
  return simp.map((c) => c.map(([x, y]) => [snapU(x), snapU(y)] as P2));
}

// ---------------------------------------------------------------------------
// the constrained triangulation
// ---------------------------------------------------------------------------

function inCircleBig(a: P2, b: P2, c: P2, d: P2): bigint {
  const B = (v: number): bigint => BigInt(Math.round(v * GRIDU));
  const [adx, ady] = [B(a[0]) - B(d[0]), B(a[1]) - B(d[1])];
  const [bdx, bdy] = [B(b[0]) - B(d[0]), B(b[1]) - B(d[1])];
  const [cdx, cdy] = [B(c[0]) - B(d[0]), B(c[1]) - B(d[1])];
  const ad = adx * adx + ady * ady;
  const bd = bdx * bdx + bdy * bdy;
  const cd = cdx * cdx + cdy * cdy;
  return adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
}

/**
 * A constrained Delaunay triangulation of `pts` inside the outline (the first `H` points, in order), containing every
 * edge of `constraints` (the outline's own edges included by the caller). Triangles come back with orient > 0.
 */
export function cdt(pts: readonly P2[], H: number, constraints: ReadonlyArray<readonly [number, number]>): number[] {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [minx, maxx, miny, maxy] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxx - minx, maxy - miny) * 20 + 100;
  const P: P2[] = [...pts, [snapU(minx - span), snapU(miny - span)], [snapU(maxx + span * 2), snapU(miny - span)], [snapU(minx - span), snapU(maxy + span * 2)]];
  type T = { v: [number, number, number]; cx: number; cy: number; r2: number };
  const mk = (a: number, b: number, c: number): T => {
    const [A, Bp, C] = orient(P[a], P[b], P[c]) > 0 ? [a, b, c] : [a, c, b];
    const [ax, ay] = P[A];
    const [bx, by] = P[Bp];
    const [cx, cy] = P[C];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { v: [A, Bp, C], cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris: T[] = [mk(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    const bad: T[] = [];
    const keep: T[] = [];
    for (const t of tris) {
      const d2 = (p[0] - t.cx) ** 2 + (p[1] - t.cy) ** 2;
      if (d2 > t.r2 * (1 + 1e-9) + 1e-9) keep.push(t);
      else if (d2 < t.r2 * (1 - 1e-9) - 1e-9) bad.push(t);
      else if (inCircleBig(P[t.v[0]], P[t.v[1]], P[t.v[2]], p) > 0n) bad.push(t);
      else keep.push(t);
    }
    const count = new Map<string, number>();
    const edges: Array<[number, number]> = [];
    for (const t of bad) {
      for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]] as Array<[number, number]>) {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
        edges.push([a, b]);
      }
    }
    tris = keep;
    for (const [a, b] of edges) if (count.get(a < b ? `${a},${b}` : `${b},${a}`) === 1) tris.push(mk(a, b, i));
  }
  // constraint recovery by flips (Sloan)
  let tri: Array<[number, number, number]> = tris.map((t) => t.v);
  const own = (): Map<string, number> => {
    const m = new Map<string, number>();
    tri.forEach(([a, b, c], k) => {
      m.set(`${a},${b}`, k);
      m.set(`${b},${c}`, k);
      m.set(`${c},${a}`, k);
    });
    return m;
  };
  const crosses = (u: number, v: number, a: number, b: number): boolean => u !== a && u !== b && v !== a && v !== b && segCross(P[u], P[v], P[a], P[b]);
  for (const [a, b] of constraints) {
    let m = own();
    if (m.has(`${a},${b}`) || m.has(`${b},${a}`)) continue;
    const queue: Array<[number, number]> = [];
    const seen = new Set<string>();
    for (const [x, y, z] of tri) {
      for (const [u, v] of [[x, y], [y, z], [z, x]] as Array<[number, number]>) {
        const k = u < v ? `${u},${v}` : `${v},${u}`;
        if (!seen.has(k) && crosses(u, v, a, b)) {
          seen.add(k);
          queue.push([u, v]);
        }
      }
    }
    let guard = 0;
    while (queue.length > 0) {
      if (++guard > 200000) throw new Error(`cdt: the constraint ${a}-${b} could not be recovered`);
      const [u, v] = queue.shift() as [number, number];
      const t1 = m.get(`${u},${v}`);
      const t2 = m.get(`${v},${u}`);
      if (t1 === undefined || t2 === undefined) continue;
      const p = tri[t1].find((x) => x !== u && x !== v) as number;
      const q = tri[t2].find((x) => x !== u && x !== v) as number;
      // convex quad u-q-v-p: p and q on opposite sides of uv (they are), u and v strictly on opposite sides of pq
      if (orient(P[p], P[q], P[u]) * orient(P[p], P[q], P[v]) < 0) {
        tri[t1] = orient(P[p], P[q], P[v]) > 0 ? [p, q, v] : [p, v, q];
        tri[t2] = orient(P[q], P[p], P[u]) > 0 ? [q, p, u] : [q, u, p];
        m = own();
        if (crosses(p, q, a, b)) queue.push([p, q]);
      } else queue.push([u, v]);
    }
  }
  // drop the super triangle's and the outside
  tri = tri.filter((t) => t.every((x) => x < n));
  tri = tri.filter(([a, b, c]) => insidePoly([(P[a][0] + P[b][0] + P[c][0]) / 3, (P[a][1] + P[b][1] + P[c][1]) / 3], P.slice(0, H)));
  const locked = new Set<string>();
  for (const [a, b] of constraints) locked.add(`${a},${b}`);
  return delaunay(tri.flat(), pts as P2[], locked);
}

// ---------------------------------------------------------------------------
// one part's mesh, weighted
// ---------------------------------------------------------------------------

export interface EdgeMesh { vertices: P2[]; triangles: number[]; hull: number; lines: Array<[number, number]>; lineCount: number }

/** Arm O or B's mesh for one part, in part-image px (padded image), or the reason it could not be built. */
export function edgeMesh(part: string, img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, offset: P2, segs: readonly Segment[], r: number, exponent: number | undefined, T: number, stray: number | undefined, band: boolean): EdgeMesh | string {
  const alpha = new Uint8Array(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  const params: ContourParams = { threshold: ART_ALPHA, tolerance: T, margin: T, spacing: 4096, regions: [], ...(stray === undefined ? {} : { stray }) };
  const cm = contourMesh(part, { width: img.width, height: img.height, alpha }, params);
  if (Array.isArray(cm)) return cm.map((p) => `${p.code} ${p.detail}`).join('; ');
  const outline = cm.vertices.slice(0, cm.hull).map((v) => [v[0], v[1]] as P2);
  const label = (p: P2): string => {
    const inf = influences([p[0] + offset[0], p[1] + offset[1]], segs, r, DEFAULT_LIMITS, exponent);
    const top = [...inf].sort((x, y) => y.weight - x.weight);
    return band ? `${top[0].bone}${top.length > 1 && top[1].weight >= BAND_SHARE ? '+' : ''}` : top[0].bone;
  };
  const lines = dominantLines(img.width, img.height, outline, label, LABEL_STEP, T);
  const pts: P2[] = [...outline];
  const index = new Map<string, number>();
  outline.forEach((p, i) => index.set(`${p[0]},${p[1]}`, i));
  const id = (p: P2): number => {
    const k = `${p[0]},${p[1]}`;
    const got = index.get(k);
    if (got !== undefined) return got;
    index.set(k, pts.length);
    pts.push(p);
    return pts.length - 1;
  };
  const cons: Array<[number, number]> = [];
  for (let i = 0; i < outline.length; i++) cons.push([i, (i + 1) % outline.length]);
  const lineEdges: Array<[number, number]> = [];
  for (const c of lines) {
    for (let i = 0; i + 1 < c.length; i++) {
      const [a, b] = [id(c[i]), id(c[i + 1])];
      if (a !== b) lineEdges.push([a, b]);
    }
  }
  const tri = cdt(pts, outline.length, [...cons, ...lineEdges]);
  return { vertices: pts, triangles: counterClockwiseInSpineWorld(tri), hull: outline.length, lines: lineEdges, lineCount: lines.length };
}

// ---------------------------------------------------------------------------
// the arms, built
// ---------------------------------------------------------------------------

const NO_CHAINS = new Map<string, ChainLine>();

/** Stage B's dust rule on one lattice part: the `stray` to draft, or why the part keeps the lattice. */
export function dustOf(config: Obj, part: string, partsDir: string, box: PartBox, T: number): { stray: number | undefined } | { keep: string } {
  const m = o(o(config.meshes)[part]);
  const d = draftContourMesh(part, readPng(join(partsDir, `${part}.png`)), [box.x, box.y], m as never, NO_CHAINS, T);
  if (d.mode === 'grid') return { keep: d.note };
  return { stray: d.mesh.contour.stray };
}

export interface EdgePart { part: string; mode: string; note: string; triangles: number | null; lines: number | null }

/** Arm O or B: the lattice's rig with every lattice part's mesh replaced by {@link edgeMesh}'s, weighted by the rig stage's distance rule. */
export function edgeRig(arm0: string, out: string, config: Obj, parts: readonly PartBox[], geom: Geometry, T: number, band: boolean): EdgePart[] {
  rmSync(out, { recursive: true, force: true });
  cpSync(join(arm0, 'rig'), out, { recursive: true });
  const rigPath = join(out, 'rig.json');
  const rig = o(readJ(rigPath));
  const skin = o(o(rig.skins).default);
  const rows: EdgePart[] = [];
  for (const [part, m0] of Object.entries(o(config.meshes))) {
    const m = o(m0);
    if (!('grid' in m)) continue;
    const box = parts.find((p) => p.name === part) as PartBox;
    const dust = dustOf(config, part, join(arm0, 'parts'), box, T);
    if ('keep' in dust) {
      rows.push({ part, mode: 'grid', note: dust.keep, triangles: null, lines: null });
      continue;
    }
    const att = o(o(skin[part])[part]);
    const [w, h] = [att.width as number, att.height as number];
    const img = readPng(join(arm0, 'rig', 'images', att.image as string));
    const offset: P2 = [box.x - PAD, box.y - PAD];
    const segs: Segment[] = resolveSegments(config, part).map((sg) => ({ bone: sg.bone, a: sg.a, b: sg.b }));
    const r = m.r as number;
    const exponent = typeof m.exponent === 'number' ? m.exponent : undefined;
    const mesh = edgeMesh(part, img, offset, segs, r, exponent, T, dust.stray, band);
    if (typeof mesh === 'string') {
      rows.push({ part, mode: 'grid', note: `kept the lattice: the outline is refused — ${mesh}`, triangles: null, lines: null });
      continue;
    }
    // part px -> setup world off the lattice's own vertices (uv px), then the rule's weights in each bone's setup frame
    const uvs = att.uvs as number[];
    const setup = geom.setup.get(part) as number[];
    const from: P2[] = [];
    const to: P2[] = [];
    for (let i = 0; i < uvs.length; i += 2) {
      from.push([uvs[i] * w, uvs[i + 1] * h]);
      to.push([setup[i], setup[i + 1]]);
    }
    const toWorld = fitAffine(from, to);
    const weights = mesh.vertices.map((v) => weightsAt(v, offset, segs, r, toWorld, geom.setupBones, exponent));
    skin[part] = { [part]: { ...att, uvs: mesh.vertices.flatMap(([x, y]) => [pyRound(x / w, 6), pyRound(y / h, 6)]), triangles: mesh.triangles, hull: mesh.hull, weights: weights as unknown as Json } };
    rows.push({ part, mode: band ? 'outline + lines + band rows' : 'outline + lines', note: `${mesh.lineCount} line(s), ${mesh.lines.length} line edge(s), ${mesh.vertices.length} vertices (${mesh.hull} on the outline)`, triangles: mesh.triangles.length / 3, lines: mesh.lines.length });
  }
  writeFileSync(rigPath, rigJsonText(rig));
  return rows;
}

/** Arm G's config: every lattice part the dust rule takes, as `contour` at T with the interior grid at round(H / 37), no ribs. */
export function gridConfig(config: Obj, arm0: string, parts: readonly PartBox[], T: number, spacing: number): { config: Obj; rows: EdgePart[] } {
  const out = JSON.parse(JSON.stringify(config)) as Obj;
  const meshes = o(out.meshes);
  const rows: EdgePart[] = [];
  for (const [part, m0] of Object.entries(meshes)) {
    const m = o(m0);
    if (!('grid' in m)) continue;
    const box = parts.find((p) => p.name === part) as PartBox;
    const dust = dustOf(config, part, join(arm0, 'parts'), box, T);
    if ('keep' in dust) {
      rows.push({ part, mode: 'grid', note: dust.keep, triangles: null, lines: null });
      continue;
    }
    const next: Obj = { contour: { tolerance: T, margin: T, spacing, ...(dust.stray === undefined ? {} : { stray: dust.stray }) }, r: m.r as Json, segments: m.segments as Json };
    for (const k of ['exponent', 'rule']) if (k in m) next[k] = m[k] as Json;
    meshes[part] = next;
    rows.push({ part, mode: `contour, spacing ${spacing}`, note: dust.stray === undefined ? '' : `stray ${dust.stray}`, triangles: null, lines: null });
  }
  return { config: out, rows };
}

// ---------------------------------------------------------------------------
// the readings
// ---------------------------------------------------------------------------

export interface DenseRow { part: string; idle: { displacement: number; flipped: number }; bend: Record<string, { displacement: number; flipped: number; stretch: number; degrees: Record<string, number> }> }

/** Every lattice part's reading against the dense reference, at the idle's frames and at each bend set, on one built arm. */
export function denseReadings(config: Obj, arm0: string, parts: readonly PartBox[], latG: Geometry, armBuild: string, work: string, name: string, sets: readonly string[], limits: InfluenceLimits = DEFAULT_LIMITS): DenseRow[] | string {
  const g = renderGeometry(armBuild, join(work, `render-${name}`));
  if (typeof g === 'string') return g;
  const sk: Skeleton = readSkeleton(join(armBuild, 'skeleton.json'));
  const lrig = o(o(o(readJ(join(arm0, 'rig', 'rig.json'))).skins).default);
  const rows: DenseRow[] = [];
  for (const [part, m0] of Object.entries(o(config.meshes))) {
    if (!('grid' in o(m0))) continue;
    const m = sk.meshes.get(part);
    const rest = g.setup.get(part);
    if (m === undefined || rest === undefined) continue;
    const box = parts.find((p) => p.name === part) as PartBox;
    const att = o(o(lrig[part])[part]);
    const uvs = att.uvs as number[];
    const lset = latG.setup.get(part) as number[];
    const rigPts: P2[] = [];
    const worldPts: P2[] = [];
    for (let i = 0; i < uvs.length; i += 2) {
      rigPts.push([uvs[i] * (att.width as number) + box.x - PAD, uvs[i + 1] * (att.height as number) + box.y - PAD]);
      worldPts.push([lset[i], lset[i + 1]]);
    }
    const rigToWorld = fitAffine(rigPts, worldPts);
    const png = join(arm0, 'parts', `${part}.png`);
    const idleRef: Reference = referenceField(config, part, png, box, rigToWorld, latG.setupBones, g.frameBones, limits);
    const idle = bendReading(rest, m.triangles, m.weights, idleRef, g.frameBones);
    const bend: DenseRow['bend'] = {};
    for (const set of sets) {
      const { poses: turns, degrees } = bendPoses(config, part, set === 'film');
      if (turns.length === 0) continue;
      const poses = turns.map((t) => bentBones(sk, g.setupBones, t));
      const ref = referenceField(config, part, png, box, rigToWorld, latG.setupBones, poses, limits);
      const rd = bendReading(rest, m.triangles, m.weights, ref, poses);
      bend[set] = { displacement: rd.displacement, flipped: rd.flipped, stretch: rd.stretch, degrees };
    }
    rows.push({ part, idle: { displacement: idle.displacement, flipped: idle.flipped }, bend });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// one example
// ---------------------------------------------------------------------------

export function stageCfg(original: string, config: Obj, dir: string): string {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dirname(original))) {
    const p = join(dirname(original), f);
    if (f.endsWith('.json') && statSync(p).isFile()) copyFileSync(p, join(dir, f));
  }
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return join(dir, 'config.json');
}

export function runEdges(key: string, configPath: string, inputs: string, work: string, film: boolean, requirements: string | null): Obj {
  const config = o(readJ(configPath));
  const arm0 = join(work, 'arm0');
  const parts = partBoxes(join(arm0, 'parts.json'));
  const H = figureHeight(parts).height;
  const T = outlineTolerance(H);
  const spacing = Math.round(H / GRID_DIVISOR);
  const sets = film ? ['fallback', 'film'] : ['fallback'];
  const latG = renderGeometry(join(arm0, 'check', 'build'), join(work, 'render-L'));
  if (typeof latG === 'string') throw new Error(`edge_survey: the lattice of ${key} did not render: ${latG}`);
  const log = (s: string): void => void process.stderr.write(`[${key}] ${s}\n`);
  const arms: Obj[] = [];
  const reqArgs = requirements === null ? [] : ['--requirements', requirements];
  const add = (name: string, dir: string, r: { exit: number; log: string }, rows: EdgePart[], build: string): void => {
    const mres = measured(name, null, dir, r, rows.map((x) => `${x.part} -> ${x.mode}${x.note === '' ? '' : ` (${x.note})`}`), name === 'L' ? null : latG, [], true);
    const dense = existsSync(join(build, 'skeleton.json')) ? denseReadings(config, arm0, parts, latG, build, work, name, sets) : 'no build';
    arms.push({ arm: name, result: mres.result as unknown as Json, rows: rows as unknown as Json, dense: dense as unknown as Json });
  };
  // (L)
  log('L: read');
  add('L', arm0, { exit: Number(readFileSync(`${arm0}.exit`, 'utf8')), log: readFileSync(`${arm0}.log`, 'utf8') }, [], join(arm0, 'check', 'build'));
  // (O), (B)
  for (const [name, band] of [['O', false], ['B', true]] as const) {
    const dir = join(work, `edge-${name}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    log(`${name}: mesh, check`);
    const rows = edgeRig(arm0, join(dir, 'rig'), config, parts, latG, T, band);
    const rc = stage(join(dir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0, ...reqArgs]);
    add(name, dir, { exit: rc.exit, log: rc.log.split('\n').map((l) => `[check] ${l}`).join('\n') }, rows, join(dir, 'check', 'build'));
  }
  // (G)
  {
    const dir = join(work, 'edge-G');
    const { config: cfg, rows } = gridConfig(config, arm0, parts, T, spacing);
    const at = stageCfg(configPath, cfg, join(work, 'cfg-G'));
    log('G: build');
    const args = [join(ROOT, 'cli.ts'), 'build', '--config', at, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', dir, ...reqArgs];
    const r = stage(dir, false, 'bun', args);
    add('G', dir, r, rows, join(dir, 'check', 'build'));
  }
  return { key, T, spacing, label_step: LABEL_STEP, band_share: BAND_SHARE, sets, arms: arms as unknown as Json };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const fx = (v: number, n: number): string => v.toFixed(n);

export function renderEdges(docs: Obj[]): string {
  const L: string[] = [];
  L.push('# Edges where the motion differs (issue #265, Stage D)');
  L.push('');
  L.push(`Generated by \`tools/edge_survey.ts --page\`; every figure is the tool's. The arms are in its header: (L) the lattice; (O) Stage B's traced outline plus the boundaries of the part's dominant-bone map (cells of ${LABEL_STEP} px, simplified at T), triangulated with those lines as constrained edges by this tool (\`contourMesh\` takes no interior constrained edge — #160 Stage B's gap); (B) (O) plus both edges of every falloff band (second weight at least ${BAND_SHARE}); (G) the traced outline with the contour mode's own interior grid at round(H / ${GRID_DIVISOR}). Every arm is read at the idle and at the bend set of \`tools/bend_survey.ts\` (15° a link; the trailer also at the film's bends), against the dense reference (the art sampled and skinned by the part's own rule at each sample). Columns over the lattice's parts: triangles, every \`check\` bar, figure overdraw, the idle's worst displacement against the lattice (Stage C's line), and against the dense reference the worst displacement and inverted triangles at the idle and at each bend set.`);
  L.push('');
  L.push('![the film bends, four arms](density-edges-film.png)');
  for (const doc of docs) {
    const arms = doc.arms as Obj[];
    const sets = doc.sets as string[];
    L.push('');
    L.push(`## ${doc.key as string}`);
    L.push('');
    L.push(`T = ${String(doc.T)}; (G)'s spacing ${String(doc.spacing)}.`);
    L.push('');
    L.push(`| arm | build | Σ triangles | vs lattice | ${BARS.join(' | ')} | seam | overdraw | idle worst vs lattice | idle vs dense: worst / inverted | ${sets.map((s) => `bend ${s}: worst / inverted (worst part)`).join(' | ')} |`);
    L.push(`| --- | --- | ---: | ---: | ${BARS.map(() => '---').join(' | ')} | --- | ---: | --- | --- | ${sets.map(() => '---').join(' | ')} |`);
    const t0 = (o(arms[0].result).meshes as unknown as ArmResult['meshes']).reduce((x, m) => x + m.triangles, 0);
    for (const a of arms) {
      const res = a.result as unknown as ArmResult;
      const T = res.meshes.reduce((x, m) => x + m.triangles, 0);
      const od = overdrawOf(res.meshes);
      const d = [...res.displacement].sort((p, q) => q.max - p.max)[0];
      const dense = typeof a.dense === 'string' ? null : (a.dense as unknown as DenseRow[]);
      const idleW = dense === null ? '—' : `${fx(Math.max(0, ...dense.map((x) => x.idle.displacement)), 2)} / ${dense.reduce((x, r) => x + r.idle.flipped, 0)}`;
      const bendW = sets.map((s) => {
        if (dense === null) return '—';
        const rows = dense.filter((x) => x.bend[s] !== undefined);
        if (rows.length === 0) return '—';
        const worst = rows.reduce((x, r) => (r.bend[s].displacement > x.bend[s].displacement ? r : x));
        return `${fx(worst.bend[s].displacement, 2)} / ${rows.reduce((x, r) => x + r.bend[s].flipped, 0)} (${worst.part})`;
      });
      L.push(`| ${a.arm as string} | ${res.exit === 0 ? 'PASS' : `exit ${res.exit}`} | ${T} | ${fx((100 * T) / t0, 1)} % | ${BARS.map((b) => barCell(res.check, b)).join(' | ')} | ${seamCell(res.check)} | ${od === null ? '—' : fx(od, 3)} | ${d === undefined ? '—' : `${fx(d.max, 3)} (${d.slot})`} | ${idleW} | ${bendW.join(' | ')} |`);
    }
    L.push('');
    L.push(`Per lattice part: triangles, and against the dense reference the worst displacement / inverted triangles at the idle and at each bend set — ${arms.map((a) => a.arm as string).join(' / ')}.`);
    L.push('');
    L.push(`| part | triangles | idle | ${sets.map((s) => `bend ${s}`).join(' | ')} |`);
    L.push(`| --- | --- | --- | ${sets.map(() => '---').join(' | ')} |`);
    const partsAll = [...new Set(arms.flatMap((a) => (typeof a.dense === 'string' ? [] : (a.dense as unknown as DenseRow[]).map((x) => x.part))))];
    for (const part of partsAll) {
      const cell = (f: (r: DenseRow) => string): string => arms.map((a) => {
        const r = typeof a.dense === 'string' ? undefined : (a.dense as unknown as DenseRow[]).find((x) => x.part === part);
        return r === undefined ? '—' : f(r);
      }).join(' / ');
      const tri = arms.map((a) => (a.result as unknown as ArmResult).meshes.find((m) => m.slot === part)?.triangles ?? '—').join(' / ');
      L.push(`| ${part} | ${tri} | ${cell((r) => `${fx(r.idle.displacement, 2)}, ${r.idle.flipped}`)} | ${sets.map((s) => cell((r) => (r.bend[s] === undefined ? '—' : `${fx(r.bend[s].displacement, 2)}, ${r.bend[s].flipped}`))).join(' | ')} |`);
    }
    for (const a of arms) {
      const rows = a.rows as unknown as EdgePart[];
      if (rows.length === 0) continue;
      L.push('');
      L.push(`Arm ${a.arm as string}, per part: ${rows.map((r) => `${r.part} ${r.mode}${r.note === '' ? '' : ` (${r.note})`}`).join('; ')}.`);
      const res = a.result as unknown as ArmResult;
      if (res.exit !== 0) for (const x of [...res.refusals, ...res.checkLines.filter((l) => /FAIL/.test(l))]) L.push(`- \`${x}\``);
    }
  }
  L.push('');
  return L.join('\n');
}

function main(argv: string[]): void {
  const flag = (n: string): string | null => {
    const i = argv.indexOf(n);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  if (argv.includes('--page')) {
    process.stdout.write(renderEdges(argv.slice(argv.indexOf('--page') + 1).map((f) => o(readJ(f)))));
    return;
  }
  const [key, config, inputs, work] = [flag('--key'), flag('--config'), flag('--inputs'), flag('--work')];
  if (!argv.includes('--run') || key === null || config === null || inputs === null || work === null) {
    console.error('usage: edge_survey --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] | --page <doc.json>…');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(runEdges(key, resolve(config), resolve(inputs), resolve(work), argv.includes('--film'), flag('--requirements') === null ? null : resolve(flag('--requirements') as string)))}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
