#!/usr/bin/env bun
/**
 * Issue #265, the curled tips: on one part, what the lattice's staircase outline carries at the strand tips that a
 * traced outline does not. Every other part keeps its lattice; only the named part's mesh changes, so every figure here
 * is that part's.
 *
 *     bun tools/tip_survey.ts --run --key <k> --config <cfg> --inputs <dir> --work <W> --part <p> [--film] [--requirements <r>] --out <k>-<p>.json
 *     bun tools/tip_survey.ts --page <k>-<p>.json   # the measured half of docs/evidence/density-tips.md
 *
 * `--run` builds the lattice (`<W>/arm0`, the config as tracked, through the real `rig-parts build`) unless one is
 * there, then reads these variants of the part:
 *
 * - **L** — the lattice as built (the calibration).
 * - **T1, T2, T4** — the traced outline at tolerance = margin = T (`contourMesh`, src/contour.ts, on the padded part
 *   image the rig stage meshes; dust dropped by Stage B's rule, `tools/contourdraft.ts`), with the contour mode's own
 *   interior grid at the spacing Stage D's (G) used, round(H / 37). T2 is (G)'s mesh of the part.
 * - **T2c** — T2's vertices triangulated again by `tools/edge_survey.ts`'s `cdt` with the outline as constraints: the
 *   control for the merged variant's triangulator (it must read as T2 does).
 * - **T2m** — T2's outline with its shortest edges merged ({@link mergeShortEdges}): an edge shorter than 2T is below
 *   the outline's own resolution (the outline sits up to T outside the art by its margin and moves up to T off its
 *   trace by its tolerance), so its two ends become one vertex at their midpoint, shortest first, until no edge is
 *   shorter than 2T; a merge that would leave an art pixel outside is skipped. T2's interior points are kept, and the
 *   whole is triangulated by `cdt`.
 *
 * Each traced variant is weighted by the rig stage's distance rule (`weightsAt`, tools/density_survey.ts), written
 * into the lattice's `rig.json` in place of the part's lattice mesh (as Stage D's arms O and B were) and checked by the
 * real `rig-parts check`.
 *
 * **What is read**, per variant: triangles; boundary (hull) vertices; outline edge lengths; every `check` bar; and,
 * against Stage C's dense reference (`referenceField`, tools/bend_survey.ts), at the idle and at each bend set (15° a
 * link; the trailer's film bends under `--film`) the worst displacement ({@link bendReading}, the figure Stage D
 * printed) and where it is — the sample in rig px, the bone that dominates it, its distance to the outline and to the
 * nearest vertex, and the triangle that carries it (its longest edge, smallest angle, how many of its corners are on
 * the outline) — and the inverted triangles: how many, how many have all three corners on the outline, and their
 * smallest angles. Each mesh is also read at the other meshes' worst samples, so one site can be compared across them.
 *
 * **The cause, tested** ({@link UNCAPPED}): the part's weight rule keeps the four largest influences and drops any
 * under 0.03 (`DEFAULT_LIMITS`, src/weights.ts). Far from every segment the raw weights flatten, the fourth and fifth
 * are close, and which bone is fourth changes from one pixel to the next. So each variant is read a second time with
 * the same rule uncapped and unfloored — every bone the segments name, none dropped — on its mesh's vertices and on
 * the reference alike, over the same builds' bones (no new mesh, no new build). And the reference's own continuity is
 * read ({@link tearOf}): the largest posed distance between two neighbouring reference samples, against their rest
 * distance, with and without the cap — a tear the reference carries is one no mesh can follow.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ContourParams, contourMesh } from '../src/contour.ts';
import { ART_ALPHA, counterClockwiseInSpineWorld } from '../src/mesh.ts';
import { readPng } from '../src/raster/index.ts';
import { PAD, rigJsonText } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { DEFAULT_LIMITS, influences, type InfluenceLimits, type Segment } from '../src/weights.ts';
import { bendPoses, bendReading, bentBones, MAX_SAMPLES, type Reference, referenceField, readSkeleton } from './bend_survey.ts';
import { draftContourMesh, outlineTolerance } from './contourdraft.ts';
import {
  BARS,
  barCell,
  type BoneMatrix,
  figureHeight,
  fitAffine,
  type Geometry,
  type Json,
  type Obj,
  type P2,
  type PartBox,
  partBoxes,
  renderGeometry,
  resolveSegments,
  skin,
  stage,
  type WeightEntry,
  weightsAt,
} from './density_survey.ts';
import { cdt, GRID_DIVISOR } from './edge_survey.ts';

const ROOT = resolve(import.meta.dir, '..');
const readJ = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const o = (v: Json | undefined): Obj => v as Obj;
const GRIDU = 256;
const snapU = (v: number): number => Math.round(v * GRIDU) / GRIDU;

// ---------------------------------------------------------------------------
// geometry helpers
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

function distToPoly(p: P2, poly: readonly P2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSeg(p, poly[i], poly[(i + 1) % poly.length]));
  return d;
}

/** A triangle's smallest angle, degrees, and longest edge. */
function shape(a: P2, b: P2, c: P2): { minAngle: number; longest: number } {
  const l = [Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(a[0] - c[0], a[1] - c[1]), Math.hypot(a[0] - b[0], a[1] - b[1])];
  const ang = (x: number, y: number, z: number): number => (Math.acos(Math.max(-1, Math.min(1, (y * y + z * z - x * x) / (2 * y * z)))) * 180) / Math.PI;
  return { minAngle: Math.min(ang(l[0], l[1], l[2]), ang(l[1], l[0], l[2]), ang(l[2], l[0], l[1])), longest: Math.max(...l) };
}

/** Art pixels (alpha above ART_ALPHA) whose centre is outside `poly`; within `win` (x0, y0, x1, y1, px) when given. */
function uncovered(mask: { width: number; height: number; alpha: Uint8Array }, poly: readonly P2[], win: [number, number, number, number] | null = null): number {
  let n = 0;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [wx0, wy0, wx1, wy1] = win === null ? [0, 0, mask.width, mask.height] : [Math.max(0, Math.floor(win[0]) - 1), Math.max(0, Math.floor(win[1]) - 1), Math.min(mask.width, Math.ceil(win[2]) + 1), Math.min(mask.height, Math.ceil(win[3]) + 1)];
  for (let y = wy0; y < wy1; y++) {
    for (let x = wx0; x < wx1; x++) {
      if (mask.alpha[y * mask.width + x] <= ART_ALPHA) continue;
      const c: P2 = [x + 0.5, y + 0.5];
      if (c[0] < x0 || c[0] > x1 || c[1] < y0 || c[1] > y1 || !insidePoly(c, poly)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// the merge
// ---------------------------------------------------------------------------

export interface Merge { outline: P2[]; merged: number; skipped: number }

/**
 * Every outline edge shorter than `minEdge`, shortest first, collapsed to its midpoint — unless the collapse leaves an
 * art pixel of `mask` outside the outline (skipped, and not tried again). Ties go to the lower index.
 */
export function mergeShortEdges(outline0: readonly P2[], minEdge: number, mask: { width: number; height: number; alpha: Uint8Array }): Merge {
  let outline = [...outline0];
  const tried = new Set<string>();
  let merged = 0;
  let skipped = 0;
  const key = (a: P2, b: P2): string => `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  for (;;) {
    let best = -1;
    let bl = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const [a, b] = [outline[i], outline[(i + 1) % outline.length]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < minEdge && l < bl && !tried.has(key(a, b))) [bl, best] = [l, i];
    }
    if (best < 0 || outline.length <= 3) break;
    const j = (best + 1) % outline.length;
    const [a, b] = [outline[best], outline[j]];
    const mid: P2 = [snapU((a[0] + b[0]) / 2), snapU((a[1] + b[1]) / 2)];
    const next = outline.map((p, i) => (i === best ? mid : p)).filter((_, i) => i !== j);
    const near = [outline[(best - 1 + outline.length) % outline.length], a, b, outline[(j + 1) % outline.length]];
    const win: [number, number, number, number] = [Math.min(...near.map((p) => p[0])), Math.min(...near.map((p) => p[1])), Math.max(...near.map((p) => p[0])), Math.max(...near.map((p) => p[1]))];
    if (uncovered(mask, next, win) > uncovered(mask, outline, win)) {
      tried.add(key(a, b));
      skipped++;
      continue;
    }
    outline = next;
    merged++;
  }
  return { outline, merged, skipped };
}

// ---------------------------------------------------------------------------
// the counterfactual rule
// ---------------------------------------------------------------------------

/** The part's weight rule with no cap and no floor: every bone its segments name, normalised. */
export const UNCAPPED: InfluenceLimits = { maxInfluences: Number.MAX_SAFE_INTEGER, minWeight: 0 };

/** The rules each variant is read under: the cap and the floor lifted one at a time, then both. */
export const RULES: ReadonlyArray<readonly [string, InfluenceLimits]> = [
  ['no cap (floor 0.03 kept)', { maxInfluences: Number.MAX_SAFE_INTEGER, minWeight: DEFAULT_LIMITS.minWeight }],
  ['no floor (cap 4 kept)', { maxInfluences: DEFAULT_LIMITS.maxInfluences, minWeight: 0 }],
  ['uncapped', UNCAPPED],
];

/** The rule's weights at a rig-px point under `limits`, bound in each bone's setup frame (unrounded). */
function weightsUnder(rp: P2, ctx: PartCtx, rigToWorld: (p: P2) => P2, bones: ReadonlyMap<string, BoneMatrix>, limits: InfluenceLimits): WeightEntry[] {
  const w = rigToWorld(rp);
  return influences(rp, ctx.segs, ctx.r, limits, ctx.exponent).map(({ bone, weight }) => {
    const m = bones.get(bone) as BoneMatrix;
    const det = m.a * m.d - m.b * m.c;
    const [dx, dy] = [w[0] - m.x, w[1] - m.y];
    return { bone, x: (m.d * dx - m.b * dy) / det, y: (-m.c * dx + m.a * dy) / det, weight };
  });
}

/** `referenceField` (tools/bend_survey.ts) under `limits`, with each sample's rig-px position and the kept bones. */
function referenceUnder(ctx: PartCtx, png: string, rigToWorld: (p: P2) => P2, bones: ReadonlyMap<string, BoneMatrix>, poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>, limits: InfluenceLimits): Reference & { rig: P2[]; kept: string[] } {
  const img = readPng(png);
  let art = 0;
  for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] > ART_ALPHA) art++;
  const stride = Math.max(1, Math.ceil(Math.sqrt(art / MAX_SAMPLES)));
  const samples: P2[] = [];
  const rig: P2[] = [];
  const kept: string[] = [];
  const posed: P2[][] = poses.map(() => []);
  for (let y = 0; y < img.height; y += stride) {
    for (let x = 0; x < img.width; x += stride) {
      if (img.data[(y * img.width + x) * 4 + 3] <= ART_ALPHA) continue;
      const rp: P2 = [ctx.box.x + x + 0.5, ctx.box.y + y + 0.5];
      const ws = weightsUnder(rp, ctx, rigToWorld, bones, limits);
      samples.push(rigToWorld(rp));
      rig.push(rp);
      kept.push(ws.map((e) => e.bone).sort().join(','));
      poses.forEach((pose, k) => posed[k].push(skin(ws, pose)));
    }
  }
  return { samples, posed, stride, rig, kept };
}

export interface Tear { gap: number; rest: number; at: P2; keptDiffers: boolean; pairsKeptDiffer: number; pairs: number }

/** The largest posed distance between two 4-neighbouring reference samples, over the poses; and how many neighbouring pairs keep different bones. */
export function tearOf(ref: Reference & { rig: P2[]; kept: string[] }): Tear {
  const index = new Map<string, number>();
  ref.rig.forEach((p, i) => index.set(`${p[0]},${p[1]}`, i));
  let best: Tear = { gap: 0, rest: 0, at: [0, 0], keptDiffers: false, pairsKeptDiffer: 0, pairs: 0 };
  let differ = 0;
  let pairs = 0;
  ref.rig.forEach((p, i) => {
    for (const [dx, dy] of [[ref.stride, 0], [0, ref.stride]] as const) {
      const j = index.get(`${p[0] + dx},${p[1] + dy}`);
      if (j === undefined) continue;
      pairs++;
      if (ref.kept[i] !== ref.kept[j]) differ++;
      for (const ps of ref.posed) {
        const g = Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]);
        if (g > best.gap) best = { gap: g, rest: ref.stride, at: [p[0] + dx / 2, p[1] + dy / 2], keptDiffers: ref.kept[i] !== ref.kept[j], pairsKeptDiffer: 0, pairs: 0 };
      }
    }
  });
  return { ...best, pairsKeptDiffer: differ, pairs };
}

// ---------------------------------------------------------------------------
// the variants
// ---------------------------------------------------------------------------

interface VMesh { vertices: P2[]; triangles: number[]; hull: number; note: string }

interface PartCtx {
  part: string;
  config: Obj;
  arm0: string;
  box: PartBox;
  att: Obj;
  img: ReturnType<typeof readPng>;
  offset: P2;
  segs: Segment[];
  r: number;
  exponent: number | undefined;
  T: number;
  spacing: number;
}

function strayAt(ctx: PartCtx, T: number): number | undefined {
  const m = o(o(ctx.config.meshes)[ctx.part]);
  const d = draftContourMesh(ctx.part, readPng(join(ctx.arm0, 'parts', `${ctx.part}.png`)), [ctx.box.x, ctx.box.y], m as never, new Map(), T);
  if (d.mode === 'grid') throw new Error(`tip_survey: ${ctx.part} keeps the lattice at T ${T}: ${d.note}`);
  return d.mesh.contour.stray;
}

function traced(ctx: PartCtx, T: number): { mesh: VMesh; mask: { width: number; height: number; alpha: Uint8Array } } {
  const alpha = new Uint8Array(ctx.img.width * ctx.img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = ctx.img.data[i * 4 + 3];
  const stray = strayAt(ctx, T);
  const params: ContourParams = { threshold: ART_ALPHA, tolerance: T, margin: T, spacing: ctx.spacing, regions: [], ...(stray === undefined ? {} : { stray }) };
  const cm = contourMesh(ctx.part, { width: ctx.img.width, height: ctx.img.height, alpha }, params);
  if (Array.isArray(cm)) throw new Error(`tip_survey: ${ctx.part} at T ${T} refused: ${cm.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
  return {
    mesh: { vertices: cm.vertices.map((v) => [v[0], v[1]] as P2), triangles: cm.triangles, hull: cm.hull, note: `contourMesh tolerance ${T}, margin ${T}, spacing ${ctx.spacing}${stray === undefined ? '' : `, stray ${stray}`}` },
    mask: { width: cm.mask.width, height: cm.mask.height, alpha: cm.mask.alpha },
  };
}

function retriangulated(outline: readonly P2[], interior: readonly P2[], note: string): VMesh {
  const pts: P2[] = [...outline, ...interior.filter((p) => insidePoly(p, outline))];
  const cons: Array<[number, number]> = outline.map((_, i) => [i, (i + 1) % outline.length]);
  const tri = cdt(pts, outline.length, cons);
  return { vertices: pts, triangles: counterClockwiseInSpineWorld(tri), hull: outline.length, note };
}

/** The lattice's rig with the part's attachment replaced by `mesh`, weighted by the rig stage's distance rule. */
function writeVariant(ctx: PartCtx, latG: Geometry, mesh: VMesh, out: string): void {
  rmSync(out, { recursive: true, force: true });
  cpSync(join(ctx.arm0, 'rig'), out, { recursive: true });
  const rigPath = join(out, 'rig.json');
  const rig = o(readJ(rigPath));
  const skinD = o(o(rig.skins).default);
  const [w, h] = [ctx.att.width as number, ctx.att.height as number];
  const uvs = ctx.att.uvs as number[];
  const setup = latG.setup.get(ctx.part) as number[];
  const from: P2[] = [];
  const to: P2[] = [];
  for (let i = 0; i < uvs.length; i += 2) {
    from.push([uvs[i] * w, uvs[i + 1] * h]);
    to.push([setup[i], setup[i + 1]]);
  }
  const toWorld = fitAffine(from, to);
  const weights = mesh.vertices.map((v) => weightsAt(v, ctx.offset, ctx.segs, ctx.r, toWorld, latG.setupBones, ctx.exponent));
  skinD[ctx.part] = { [ctx.part]: { ...ctx.att, uvs: mesh.vertices.flatMap(([x, y]) => [pyRound(x / w, 6), pyRound(y / h, 6)]), triangles: mesh.triangles, hull: mesh.hull, weights: weights as unknown as Json } };
  writeFileSync(rigPath, rigJsonText(rig));
}

// ---------------------------------------------------------------------------
// the readings
// ---------------------------------------------------------------------------

interface Site { rig: P2; displacement: number; bone: string; toOutline: number; toVertex: number; triangle: { onOutline: number; longest: number; minAngle: number } | null }
interface Flip { centroid: P2; onOutline: number; minAngle: number; longest: number }
interface SetReading { worstIndex: number; displacement: number; flipped: number; stretch: number; samples: number; outside: number; site: Site | null; flips: Flip[]; top: Site[]; perSample: number[] }

interface Built {
  name: string;
  note: string;
  exit: number;
  check: Obj | null;
  triangles: number;
  hull: number;
  vertices: number;
  edges: { min: number; median: number; max: number; under: Record<string, number> };
  thin: number;
  outlineOnly: number;
  readings: Record<string, SetReading>;
  uncapped: Record<string, Record<string, { displacement: number; flipped: number }>>;
  extra: Record<string, unknown>;
}

function setReading(rest: readonly number[], triangles: readonly number[], weights: readonly WeightEntry[][], hull: number, ref: Reference, poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>, worldToRig: (p: P2) => P2, ctx: PartCtx): SetReading {
  const rd = bendReading(rest, triangles, weights, ref, poses);
  const V: P2[] = [];
  for (let i = 0; i < rest.length; i += 2) V.push(worldToRig([rest[i], rest[i + 1]]));
  const outline = V.slice(0, hull);
  // per sample: the largest distance over the poses, -1 outside the mesh (bendReading's own rule, recomputed to name sites)
  const per = new Array<number>(ref.samples.length).fill(-1);
  const carrier = new Array<number>(ref.samples.length).fill(-1);
  const flipsSet = new Map<number, Flip>();
  const area = (v: readonly number[], t: number): number => {
    const [i, j, k] = [triangles[t] * 2, triangles[t + 1] * 2, triangles[t + 2] * 2];
    return (v[j] - v[i]) * (v[k + 1] - v[i + 1]) - (v[j + 1] - v[i + 1]) * (v[k] - v[i]);
  };
  const tris: Array<[P2, P2, P2]> = [];
  for (let t = 0; t < triangles.length; t += 3) tris.push([V[triangles[t]], V[triangles[t + 1]], V[triangles[t + 2]]]);
  // locate in rig px (the same triangles, an affine image of world)
  const samplesRig = ref.samples.map((p) => worldToRig(p));
  const loc = samplesRig.map((p) => {
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
      const w = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
      const z = 1 - u - w;
      if (u >= -1e-9 && w >= -1e-9 && z >= -1e-9) return { t, u, w, z };
    }
    return null;
  });
  poses.forEach((pose, k) => {
    const posed = weights.flatMap((ws) => skin(ws, pose));
    loc.forEach((l, s) => {
      if (l === null) return;
      const [i, j, q] = [triangles[l.t * 3] * 2, triangles[l.t * 3 + 1] * 2, triangles[l.t * 3 + 2] * 2];
      const x = l.u * posed[i] + l.w * posed[j] + l.z * posed[q];
      const y = l.u * posed[i + 1] + l.w * posed[j + 1] + l.z * posed[q + 1];
      const d = Math.hypot(x - ref.posed[k][s][0], y - ref.posed[k][s][1]);
      if (d > per[s]) [per[s], carrier[s]] = [d, l.t];
    });
    for (let t = 0; t < triangles.length; t += 3) {
      if (area(rest, t) * area(posed, t) > 0) continue;
      const tri = tris[t / 3];
      const sh = shape(...tri);
      flipsSet.set(t / 3, { centroid: [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3], onOutline: [triangles[t], triangles[t + 1], triangles[t + 2]].filter((x) => x < hull).length, minAngle: sh.minAngle, longest: sh.longest });
    }
  });
  const siteOf = (s: number): Site => {
    const p = samplesRig[s];
    const inf = influences(p, ctx.segs, ctx.r, DEFAULT_LIMITS, ctx.exponent);
    const bone = [...inf].sort((x, y) => y.weight - x.weight)[0].bone;
    let toVertex = Infinity;
    for (const v of V) toVertex = Math.min(toVertex, Math.hypot(v[0] - p[0], v[1] - p[1]));
    const t = carrier[s];
    const triangle = t < 0 ? null : { onOutline: [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]].filter((x) => x < hull).length, ...shape(...tris[t]) };
    return { rig: [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100], displacement: per[s], bone, toOutline: distToPoly(p, outline), toVertex, triangle };
  };
  let worst = -1;
  per.forEach((d, s) => {
    if (d >= 0 && (worst < 0 || d > per[worst])) worst = s;
  });
  // the five worst samples at least 8 rig px apart
  const order = per.map((d, s) => [d, s] as const).filter(([d]) => d >= 0).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  const top: Site[] = [];
  for (const [, s] of order) {
    if (top.length >= 5) break;
    const p = samplesRig[s];
    if (top.every((q) => Math.hypot(q.rig[0] - p[0], q.rig[1] - p[1]) >= 8)) top.push(siteOf(s));
  }
  if (worst >= 0 && Math.abs(per[worst] - rd.displacement) > 1e-9) throw new Error(`tip_survey: the site reading ${per[worst]} disagrees with bendReading's ${rd.displacement}`);
  return { worstIndex: worst, displacement: rd.displacement, flipped: rd.flipped, stretch: rd.stretch, samples: rd.samples, outside: rd.outside, site: worst < 0 ? null : siteOf(worst), flips: [...flipsSet.values()], top, perSample: per };
}

function edgeStats(vertices: readonly P2[], hull: number, T: number): Built['edges'] {
  const l: number[] = [];
  for (let i = 0; i < hull; i++) {
    const [a, b] = [vertices[i], vertices[(i + 1) % hull]];
    l.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const s = [...l].sort((x, y) => x - y);
  const under: Record<string, number> = {};
  for (const k of [T, 2 * T, 4 * T]) under[`<${k}`] = l.filter((x) => x < k).length;
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1], under };
}

// ---------------------------------------------------------------------------
// one run
// ---------------------------------------------------------------------------

export function runTips(key: string, configPath: string, inputs: string, work: string, part: string, film: boolean, requirements: string | null): Obj {
  const config = o(readJ(configPath));
  const arm0 = join(work, 'arm0');
  const log = (s: string): void => void process.stderr.write(`[${key}/${part}] ${s}\n`);
  const reqArgs = requirements === null ? [] : ['--requirements', requirements];
  if (!existsSync(join(arm0, 'check', 'build', 'skeleton.json'))) {
    log('lattice build');
    const r = stage(arm0, false, 'bun', [join(ROOT, 'cli.ts'), 'build', '--config', configPath, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', arm0, ...reqArgs]);
    if (r.exit !== 0) throw new Error(`tip_survey: the lattice did not build (exit ${r.exit})`);
  }
  const parts = partBoxes(join(arm0, 'parts.json'));
  const H = figureHeight(parts).height;
  const T = outlineTolerance(H);
  const spacing = Math.round(H / GRID_DIVISOR);
  const box = parts.find((p) => p.name === part);
  if (box === undefined) throw new Error(`tip_survey: no part "${part}" in ${arm0}/parts.json`);
  const m = o(o(config.meshes)[part]);
  if (!('grid' in m)) throw new Error(`tip_survey: "${part}" is not a lattice mesh in the config`);
  const att = o(o(o(o(o(readJ(join(arm0, 'rig', 'rig.json'))).skins).default)[part])[part]);
  const ctx: PartCtx = {
    part,
    config,
    arm0,
    box,
    att,
    img: readPng(join(arm0, 'rig', 'images', att.image as string)),
    offset: [box.x - PAD, box.y - PAD],
    segs: resolveSegments(config, part).map((sg) => ({ bone: sg.bone, a: sg.a, b: sg.b })),
    r: m.r as number,
    exponent: typeof m.exponent === 'number' ? m.exponent : undefined,
    T,
    spacing,
  };
  const latG = renderGeometry(join(arm0, 'check', 'build'), join(work, 'render-L'));
  if (typeof latG === 'string') throw new Error(`tip_survey: the lattice did not render: ${latG}`);
  // rig px <-> setup world off the lattice's own vertices
  const uvs = att.uvs as number[];
  const lset = latG.setup.get(part) as number[];
  const rigPts: P2[] = [];
  const worldPts: P2[] = [];
  for (let i = 0; i < uvs.length; i += 2) {
    rigPts.push([uvs[i] * (att.width as number) + box.x - PAD, uvs[i + 1] * (att.height as number) + box.y - PAD]);
    worldPts.push([lset[i], lset[i + 1]]);
  }
  const rigToWorld = fitAffine(rigPts, worldPts);
  const worldToRig = fitAffine(worldPts, rigPts);
  const png = join(arm0, 'parts', `${part}.png`);
  const sets = film ? ['fallback', 'film'] : ['fallback'];

  // the meshes
  const meshes: Array<{ name: string; mesh: VMesh | null; extra: Record<string, unknown> }> = [{ name: 'L', mesh: null, extra: {} }];
  const t2 = traced(ctx, T);
  for (const t of [1, 2, 4]) {
    const tr = t === T ? t2 : traced(ctx, t);
    meshes.push({ name: `T${t}`, mesh: tr.mesh, extra: { uncovered: uncovered(tr.mask, tr.mesh.vertices.slice(0, tr.mesh.hull)) } });
  }
  const outline2 = t2.mesh.vertices.slice(0, t2.mesh.hull);
  const interior2 = t2.mesh.vertices.slice(t2.mesh.hull);
  const c = retriangulated(outline2, interior2, `T${T}'s vertices, triangulated by cdt`);
  const keyOf = (v: readonly P2[], tr: readonly number[]): string[] => {
    const out: string[] = [];
    for (let i = 0; i < tr.length; i += 3) out.push([tr[i], tr[i + 1], tr[i + 2]].map((x) => `${v[x][0]},${v[x][1]}`).sort().join('|'));
    return out.sort();
  };
  const ka = keyOf(t2.mesh.vertices, t2.mesh.triangles);
  const kb = new Set(keyOf(c.vertices, c.triangles));
  meshes.push({ name: `T${T}c`, mesh: c, extra: { trianglesNotInContourMesh: ka.filter((k) => !kb.has(k)).length } });
  const mg = mergeShortEdges(outline2, 2 * T, t2.mask);
  const mm = retriangulated(mg.outline, interior2, `T${T}'s outline with every edge under ${2 * T} px merged to its midpoint (${mg.merged} merged, ${mg.skipped} skipped to keep the art covered), its interior kept, triangulated by cdt`);
  meshes.push({ name: `T${T}m`, mesh: mm, extra: { merged: mg.merged, skipped: mg.skipped, uncovered: uncovered(t2.mask, mg.outline), interiorDropped: interior2.length - (mm.vertices.length - mm.hull) } });

  const built: Built[] = [];
  const pictures: Record<string, unknown> = {};
  for (const v of meshes) {
    let dir: string;
    let exit: number;
    let check: Obj | null = null;
    if (v.mesh === null) {
      dir = arm0;
      exit = Number(readFileSync(`${arm0}.exit`, 'utf8'));
    } else {
      dir = join(work, `tip-${v.name}`);
      mkdirSync(dir, { recursive: true });
      writeVariant(ctx, latG, v.mesh, join(dir, 'rig'));
      log(`${v.name}: check`);
      const rc = stage(join(dir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0, ...reqArgs]);
      exit = rc.exit;
    }
    if (existsSync(join(dir, 'check', 'check.json'))) check = o(readJ(join(dir, 'check', 'check.json')));
    const build = join(dir, 'check', 'build');
    const g = renderGeometry(build, join(work, `render-tip-${v.name}`));
    if (typeof g === 'string') throw new Error(`tip_survey: ${v.name} did not render: ${g}`);
    const sk = readSkeleton(join(build, 'skeleton.json'));
    const sm = sk.meshes.get(part);
    const rest = g.setup.get(part);
    const rm = g.rest.get(part);
    if (sm === undefined || rest === undefined || rm === undefined) throw new Error(`tip_survey: ${v.name} has no mesh "${part}"`);
    const V: P2[] = [];
    for (let i = 0; i < rest.length; i += 2) V.push(worldToRig([rest[i], rest[i + 1]]));
    let thin = 0;
    let outlineOnly = 0;
    for (let t = 0; t < sm.triangles.length; t += 3) {
      if (shape(V[sm.triangles[t]], V[sm.triangles[t + 1]], V[sm.triangles[t + 2]]).minAngle < 10) thin++;
      if (sm.triangles[t] < rm.hull && sm.triangles[t + 1] < rm.hull && sm.triangles[t + 2] < rm.hull) outlineOnly++;
    }
    const readings: Record<string, SetReading> = {};
    const idleRef = referenceField(config, part, png, box, rigToWorld, latG.setupBones, g.frameBones);
    readings.idle = setReading(rest, sm.triangles, sm.weights, rm.hull, idleRef, g.frameBones, worldToRig, ctx);
    const pic: Record<string, unknown> = { uvsRig: V.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), triangles: sm.triangles, hull: rm.hull };
    for (const set of sets) {
      const { poses: turns } = bendPoses(config, part, set === 'film');
      const poses = turns.map((t) => bentBones(sk, g.setupBones, t));
      const ref = referenceField(config, part, png, box, rigToWorld, latG.setupBones, poses);
      readings[set] = setReading(rest, sm.triangles, sm.weights, rm.hull, ref, poses, worldToRig, ctx);
      pic[set] = poses.map((pose) => sm.weights.map((ws) => skin(ws, pose)).map((p) => worldToRig(p)).map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]));
    }
    pictures[v.name] = pic;
    const uncapped: Built['uncapped'] = {};
    for (const [rule, limits] of RULES) {
      const uw = V.map((p) => weightsUnder(p, ctx, rigToWorld, latG.setupBones, limits));
      uncapped[rule] = {};
      for (const set of ['idle', ...sets]) {
        const poses = set === 'idle' ? g.frameBones : bendPoses(config, part, set === 'film').poses.map((t) => bentBones(sk, g.setupBones, t));
        const ref = referenceUnder(ctx, png, rigToWorld, latG.setupBones, poses, limits);
        const rd = bendReading(rest, sm.triangles, uw, ref, poses);
        uncapped[rule][set] = { displacement: rd.displacement, flipped: rd.flipped };
      }
    }
    built.push({ name: v.name, note: v.mesh === null ? `the lattice, grid ${String(m.grid)}` : v.mesh.note, exit, check, triangles: sm.triangles.length / 3, hull: rm.hull, vertices: sm.weights.length, edges: edgeStats(V, rm.hull, T), thin, outlineOnly, readings, uncapped, extra: v.extra });
  }
  // the reference's own continuity, with the rule as the rig stage runs it and uncapped, and a control: the capped
  // reference built here must be referenceField's (the same samples and posed positions)
  const tears: Record<string, Record<string, Tear>> = {};
  {
    const sk0 = readSkeleton(join(arm0, 'check', 'build', 'skeleton.json'));
    for (const set of ['idle', ...sets]) {
      const poses = set === 'idle' ? latG.frameBones : bendPoses(config, part, set === 'film').poses.map((t) => bentBones(sk0, latG.setupBones, t));
      const capped = referenceUnder(ctx, png, rigToWorld, latG.setupBones, poses, DEFAULT_LIMITS);
      const control = referenceField(config, part, png, box, rigToWorld, latG.setupBones, poses);
      let worst = 0;
      control.posed.forEach((ps, k) => ps.forEach((q, i) => (worst = Math.max(worst, Math.hypot(q[0] - capped.posed[k][i][0], q[1] - capped.posed[k][i][1])))));
      if (control.samples.length !== capped.samples.length || worst > 1e-6) throw new Error(`tip_survey: the capped reference disagrees with referenceField by ${worst}`);
      tears[set] = { 'as built (cap 4, floor 0.03)': tearOf(capped), ...Object.fromEntries(RULES.map(([rule, limits]) => [rule, tearOf(referenceUnder(ctx, png, rigToWorld, latG.setupBones, poses, limits))])) };
    }
  }
  // every mesh read at every other mesh's worst samples (the same reference samples: one art, one stride, one affine)
  const cross: Record<string, Record<string, Record<string, number>>> = {};
  for (const set of ['idle', ...sets]) {
    cross[set] = {};
    for (const at of built) {
      const site = at.readings[set].site;
      if (site === null) continue;
      const s = at.readings[set].worstIndex;
      cross[set][at.name] = Object.fromEntries(built.map((b) => [b.name, b.readings[set].perSample[s]]));
    }
  }
  for (const b of built) for (const r of Object.values(b.readings)) r.perSample = [];
  writeFileSync(join(work, `tip-pictures-${part}.json`), JSON.stringify({ box, pad: PAD, image: join(arm0, 'rig', 'images', att.image as string), meshes: pictures }));
  return { key, part, T, spacing, sets, built: built as unknown as Json, cross: cross as unknown as Json, tears: tears as unknown as Json };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const f2 = (v: number): string => v.toFixed(2);
const siteText = (s: Site | null): string => (s === null ? '—' : `${f2(s.displacement)} at (${f2(s.rig[0])}, ${f2(s.rig[1])}), ${s.bone}, ${f2(s.toOutline)} px in from the outline, ${f2(s.toVertex)} px from a vertex; its triangle: ${s.triangle === null ? '—' : `${s.triangle.onOutline} corners on the outline, longest edge ${f2(s.triangle.longest)}, smallest angle ${s.triangle.minAngle.toFixed(1)}°`}`);

export function renderTips(doc: Obj): string {
  const built = doc.built as unknown as Built[];
  const sets = ['idle', ...(doc.sets as string[])];
  const L: string[] = [];
  L.push(`Generated by \`tools/tip_survey.ts --page\`; every figure below is the tool's. Variants are in its header: L the lattice; T1, T2, T4 the traced outline at tolerance = margin = T with the contour mode's interior grid at round(H / ${GRID_DIVISOR}) (T2 is Stage D's (G) on this part); T2c T2's vertices triangulated again by \`cdt\` (the control for the merged variant's triangulator); T2m T2's outline with every edge shorter than 2T merged to its midpoint. Only the named part's mesh changes; every other part keeps its lattice. Readings are against Stage C's dense reference, at the idle and at the bend sets of \`tools/bend_survey.ts\`.`);
  L.push('');
  L.push(`## ${doc.key as string}, ${doc.part as string}`);
  L.push('');
  L.push(`T = ${String(doc.T)}; the interior spacing ${String(doc.spacing)}.`);
  L.push('');
  L.push(`| variant | check | triangles | hull vertices | outline edges min / median / max | edges under T / 2T / 4T | smallest angle under 10° | outline-only triangles | ${sets.map((s) => `${s}: worst / inverted (distinct triangles; with all corners on the outline)`).join(' | ')} | ${sets.slice(1).map((s) => `${s}: stretch`).join(' | ')} |`);
  L.push(`| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ${sets.map(() => '---').join(' | ')} | ${sets.slice(1).map(() => '---:').join(' | ')} |`);
  for (const b of built) {
    const fails = b.check === null ? '—' : BARS.filter((x) => !/^PASS/.test(barCell(b.check, x))).join(', ');
    L.push(`| ${b.name} | ${b.exit === 0 ? 'PASS' : `exit ${b.exit}${fails === '' ? '' : ` (${fails})`}`} | ${b.triangles} | ${b.hull} | ${f2(b.edges.min)} / ${f2(b.edges.median)} / ${f2(b.edges.max)} | ${Object.values(b.edges.under).join(' / ')} | ${b.thin} | ${b.outlineOnly} | ${sets.map((s) => `${f2(b.readings[s].displacement)} / ${b.readings[s].flipped} (${b.readings[s].flips.length}; ${b.readings[s].flips.filter((x) => x.onOutline === 3).length})`).join(' | ')} | ${sets.slice(1).map((s) => b.readings[s].stretch.toFixed(2)).join(' | ')} |`);
  }
  L.push('');
  for (const b of built) {
    L.push(`- **${b.name}** — ${b.note}${Object.keys(b.extra).length === 0 ? '' : ` (${Object.entries(b.extra).map(([k, v]) => `${k} ${String(v)}`).join(', ')})`}.`);
    for (const s of sets) {
      const r = b.readings[s];
      L.push(`  - ${s}: worst ${siteText(r.site)}; ${r.samples} samples in the mesh, ${r.outside} outside.`);
      if (r.flips.length > 0) L.push(`    inverted: ${r.flips.map((x) => `(${f2(x.centroid[0])}, ${f2(x.centroid[1])}) ${x.onOutline}/3 on the outline, ${x.minAngle.toFixed(1)}°, ${f2(x.longest)} px`).join('; ')}.`);
      L.push(`    the five worst, 8 px apart: ${r.top.map((x) => `${f2(x.displacement)} (${f2(x.rig[0])}, ${f2(x.rig[1])}) ${x.bone}`).join('; ')}.`);
    }
  }
  L.push('');
  L.push('The same meshes and builds, read under the weight rule as built and with its cap, its floor or both lifted — on the vertices and on the reference alike (worst / inverted; idle, 15°, film):');
  L.push('');
  const rules = Object.keys(built[0].uncapped);
  L.push(`| variant | as built | ${rules.join(' | ')} |`);
  L.push(`| --- | --- | ${rules.map(() => '---').join(' | ')} |`);
  for (const b of built) L.push(`| ${b.name} | ${sets.map((s) => `${f2(b.readings[s].displacement)} / ${b.readings[s].flipped}`).join('; ')} | ${rules.map((r) => sets.map((s) => `${f2(b.uncapped[r][s].displacement)} / ${b.uncapped[r][s].flipped}`).join('; ')).join(' | ')} |`);
  L.push('');
  L.push('The reference\'s own largest gap between two neighbouring samples (posed distance, rig px; their rest distance is the stride), where it is, whether the two keep different bones, and how many neighbouring pairs keep different bones:');
  L.push('');
  L.push('| set | rule | gap | rest | at | the two keep different bones | pairs keeping different bones |');
  L.push('| --- | --- | ---: | ---: | --- | --- | ---: |');
  for (const s of sets) for (const [rule, t] of Object.entries(o(o(doc.tears)[s]))) {
    const x = t as unknown as Tear;
    L.push(`| ${s} | ${rule} | ${f2(x.gap)} | ${x.rest} | (${f2(x.at[0])}, ${f2(x.at[1])}) | ${x.keptDiffers ? 'yes' : 'no'} | ${x.pairsKeptDiffer} of ${x.pairs} |`);
  }
  L.push('');
  L.push('Each mesh read at each mesh\'s own worst sample (rows: whose worst sample; columns: the mesh read there).');
  for (const s of sets) {
    const cross = o(o(doc.cross)[s]);
    L.push('');
    L.push(`${s}:`);
    L.push('');
    L.push(`| site of | ${built.map((b) => b.name).join(' | ')} |`);
    L.push(`| --- | ${built.map(() => '---:').join(' | ')} |`);
    for (const [at, row] of Object.entries(cross)) L.push(`| ${at} | ${built.map((b) => { const v = o(row as Json)[b.name] as number; return v < 0 ? 'outside' : f2(v); }).join(' | ')} |`);
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
    process.stdout.write(renderTips(o(readJ(argv[argv.indexOf('--page') + 1]))));
    return;
  }
  const [key, config, inputs, work, part] = [flag('--key'), flag('--config'), flag('--inputs'), flag('--work'), flag('--part')];
  if (!argv.includes('--run') || key === null || config === null || inputs === null || work === null || part === null) {
    console.error('usage: tip_survey --run --key <k> --config <cfg> --inputs <dir> --work <W> --part <p> [--film] [--requirements <r>] [--out <doc.json>] | --page <doc.json>');
    process.exit(2);
  }
  const req = flag('--requirements');
  const out = flag('--out');
  const text = `${JSON.stringify(runTips(key, resolve(config), resolve(inputs), resolve(work), part, argv.includes('--film'), req === null ? null : resolve(req)))}\n`;
  // a file, not stdout: a large write to a redirected stdout was cut at 64 KiB on Nova's bun
  if (out === null) process.stdout.write(text);
  else writeFileSync(resolve(out), text);
}

if (import.meta.main) main(process.argv.slice(2));
