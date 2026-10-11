#!/usr/bin/env bun
/**
 * Issue #265 Stage A: mesh density over the whole figure, measured on three
 * arms, by two commands per example and one for the page:
 *
 *     bun run fetch-examples                                     # once: examples/{demo,scarf}/inputs
 *     bun tools/density_survey.ts --run --key demo --config examples/demo/config.json \
 *       --inputs examples/demo/inputs --work <dir> > demo.json
 *     bun tools/density_survey.ts --run --key trailer --config <trailer>/inputs/config.json \
 *       --inputs <trailer>/inputs --requirements <trailer>/inputs/requirements.json \
 *       --chain-rows neck,handwear_l,legwear --work <dir> > trailer.json
 *     bun tools/density_survey.ts --page demo.json scarf.json trailer.json > docs/evidence/density-survey.md
 *
 * `<trailer>` is a checkout of https://github.com/rig-c/trailer (its `inputs/`
 * are the painting, both See-through layer sets, the config and the
 * requirements; nothing of it enters this tree).
 *
 * **The arms**, every one through the real `rig-parts build` of this checkout
 * (assemble, rig, rig-c's gate, check) or, for arm 2, the real `rig-parts
 * check` over a rig whose three meshes were replaced:
 *
 * - **arm 0** — the config as tracked.
 * - **arm 1** — one spacing for the figure. B = round(H / c), H the figure's
 *   height in rig px (the union of every assembled part's box, arm 0's
 *   `parts.json`), at c ∈ {@link FIGURE_DIVISORS}. Every `grid` mesh takes
 *   `grid: B`; every `contour` mesh takes background `spacing: B` and keeps its
 *   regions as declared. Nothing else in the config moves ({@link armOneConfig}).
 * - **arm 2** — rows across the chain, on the parts `--chain-rows` names, k ∈
 *   {@link ROW_STATIONS}: arm 0's rig with each named mesh replaced by one built
 *   here ({@link rowMesh}) — the lattice's own outline as arm 0 wrote it, and
 *   interior vertices only on rows across each bound segment at its origin and
 *   at k stations along it, the rule of the contour mode's ribs (issue #188,
 *   `docs/AUTHORING.md` "Ribs along a chain"), each row cut at {@link ROW_SPACING_DIVISOR}'s
 *   spacing; triangulated as a constrained Delaunay triangulation of the outline
 *   and the rows; weighted by the rig stage's own distance rule
 *   (`influences`, `src/weights.ts`) at the mesh's own `r` and segments. A
 *   comparison arm, not a feature: nothing under `src/` builds it.
 *
 * **What each arm reports**: per mesh its triangles, its area (the setup pose's
 * triangles, world units = rig px) and its density relative to the figure's
 * (Σ triangles / Σ area over every mesh); every `check` bar as `check.json`
 * holds it; and the largest posed displacement against arm 0 over the idle
 * ({@link displacement}): every arm-0 and arm-n setup vertex and triangle
 * centroid that lies inside both meshes, carried through both meshes' skinning
 * at every idle frame (`rigc render --geometry`, 12 fps), the largest distance.
 *
 * `--reuse` reads back a stage whose output, log and exit a previous run left in
 * `--work` instead of running it again (arm 2's rows are always rebuilt).
 *
 * Output: `--run` prints one JSON document; `--page` prints Markdown. Exit 1 when
 * an input is missing or a control in {@link rowMesh} disagrees with the rig
 * stage; a refused build is a result, recorded with its refusal.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { contourTopologyProblems, GRID } from '../src/contour.ts';
import { ART_ALPHA, counterClockwiseInSpineWorld, latticeMesh } from '../src/mesh.ts';
import { alphaAbove, readPng } from '../src/raster/index.ts';
import { OFFSET_PLACES, PAD, rigJsonText } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { DEFAULT_LIMITS, influences, type Segment } from '../src/weights.ts';

const ROOT = resolve(import.meta.dir, '..');
const RIGC = join(ROOT, 'node_modules', '.bin', 'rigc');

/**
 * The divisors c of arm 1, B = round(H / c). The middle one is the trailer's
 * coarsest grid today read as a divisor of its figure height (1108 px / grid 30
 * = 36.9, rounded to 37); the other two are one step of √2 either side (26, 52),
 * so a step moves the spacing by √2 and a lattice's triangle count by about 2 —
 * the factor the card's first judgment line is stated in. Fixed before the run.
 */
export const FIGURE_DIVISORS = [26, 37, 52] as const;

/** The stations k of arm 2 (the card's k = 1, 2, 3). */
export const ROW_STATIONS = [1, 2, 3] as const;

/**
 * The spacing a row is cut at in arm 2: the figure's middle spacing, H / 37 —
 * the same B arm 1 runs at its middle divisor — so a row's vertices sit as far
 * apart along it as arm 1's lattice corners. Fixed before the run.
 */
export const ROW_SPACING_DIVISOR = 37;

// ---------------------------------------------------------------------------
// small readers
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

function obj(v: Json | undefined, what: string): Obj {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: an object is required`);
  return v;
}
function arr(v: Json | undefined, what: string): Json[] {
  if (!Array.isArray(v)) throw new Error(`${what}: an array is required`);
  return v;
}
function num(v: Json | undefined, what: string): number {
  if (typeof v !== 'number') throw new Error(`${what}: a number is required`);
  return v;
}
function str(v: Json | undefined, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what}: a string is required`);
  return v;
}
function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}
function nums(v: Json | undefined, what: string): number[] {
  return arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
}

// ---------------------------------------------------------------------------
// the figure
// ---------------------------------------------------------------------------

interface PartBox { name: string; x: number; y: number; w: number; h: number }

export function partBoxes(partsJson: string): PartBox[] {
  const p = obj(readJson(partsJson), partsJson);
  return arr(p.parts, 'parts').map((q, i) => {
    const o = obj(q, `parts[${i}]`);
    return { name: str(o.name, 'name'), x: num(o.x, 'x'), y: num(o.y, 'y'), w: num(o.w, 'w'), h: num(o.h, 'h') };
  });
}

/** The figure's height, rig px: the union of every assembled part's box. */
export function figureHeight(parts: readonly PartBox[]): { height: number; top: number; bottom: number } {
  const top = Math.min(...parts.map((p) => p.y));
  const bottom = Math.max(...parts.map((p) => p.y + p.h));
  return { height: bottom - top, top, bottom };
}

/** Arm 1's config: every lattice at grid B, every contour's background spacing B, regions as declared. */
export function armOneConfig(config: Obj, B: number): { config: Obj; moved: string[] } {
  const out = JSON.parse(JSON.stringify(config)) as Obj;
  const meshes = obj(out.meshes, 'meshes');
  const moved: string[] = [];
  for (const [name, m0] of Object.entries(meshes)) {
    const m = obj(m0, `meshes.${name}`);
    if ('grid' in m) {
      moved.push(`${name} grid ${num(m.grid, 'grid')} -> ${B}`);
      m.grid = B;
    } else if ('contour' in m) {
      const c = obj(m.contour, `meshes.${name}.contour`);
      moved.push(`${name} contour spacing ${num(c.spacing, 'spacing')} -> ${B} (regions kept)`);
      c.spacing = B;
    } else moved.push(`${name} not moved (mode ${Object.keys(m).join('/')})`);
  }
  return { config: out, moved };
}

// ---------------------------------------------------------------------------
// running the package
// ---------------------------------------------------------------------------

interface RunResult { exit: number; log: string }

function run(cmd: string, args: string[]): RunResult {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { exit: r.status ?? -1, log: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A stage run into `dir`, its log and exit kept beside it; under `--reuse` a kept one is read back instead of run again. */
function stage(dir: string, reuse: boolean, cmd: string, args: string[]): RunResult {
  const logAt = `${dir}.log`;
  const exitAt = `${dir}.exit`;
  if (reuse && existsSync(logAt) && existsSync(exitAt) && existsSync(dir)) return { exit: Number(readFileSync(exitAt, 'utf8')), log: readFileSync(logAt, 'utf8') };
  rmSync(dir, { recursive: true, force: true });
  const r = run(cmd, args);
  writeFileSync(logAt, r.log);
  writeFileSync(exitAt, String(r.exit));
  return r;
}

/** The config's sibling JSON files (animations, pose, keypoints) copied beside a rewritten config, which reads them by relative path. */
function stageConfig(original: string, config: Obj, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const from = dirname(original);
  for (const f of readdirSync(from)) {
    const p = join(from, f);
    if (f.endsWith('.json') && statSync(p).isFile()) copyFileSync(p, join(dir, f));
  }
  const at = join(dir, 'config.json');
  writeFileSync(at, `${JSON.stringify(config, null, 2)}\n`);
  return at;
}

function buildArgs(config: string, inputs: string, requirements: string | null, out: string): string[] {
  const a = [join(ROOT, 'cli.ts'), 'build', '--config', config, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', out];
  if (requirements !== null) a.push('--requirements', requirements);
  return a;
}

/** The refusal lines of a log: every line naming an upper-case rule code with a colon, as the package writes them. */
function refusals(log: string): string[] {
  return log
    .split('\n')
    .filter((l) => /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+:/.test(l) && !/: (PASS|REPORTED|SKIP)\b/.test(l))
    .map((l) => l.trim().slice(0, 600));
}

// ---------------------------------------------------------------------------
// geometry: rigc render --geometry
// ---------------------------------------------------------------------------

interface BoneMatrix { a: number; b: number; c: number; d: number; x: number; y: number }
interface RestMesh { slot: string; triangles: number[]; hull: number }
interface Geometry {
  rest: Map<string, RestMesh>;
  setupBones: Map<string, BoneMatrix>;
  setup: Map<string, number[]>;
  frames: Array<Map<string, number[]>>;
}

export function readGeometry(path: string): Geometry {
  const g = obj(readJson(path), path);
  const rest = new Map<string, RestMesh>();
  for (const r0 of arr(g.rest, 'rest')) {
    const r = obj(r0, 'rest[]');
    if (str(r.kind, 'kind') !== 'mesh') continue;
    rest.set(str(r.slot, 'slot'), { slot: str(r.slot, 'slot'), triangles: nums(r.triangles, 'triangles'), hull: num(r.hull, 'hull') });
  }
  const verts = (list: Json | undefined): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (const a0 of arr(list, 'attachments')) {
      const a = obj(a0, 'attachment');
      if (rest.has(str(a.slot, 'slot'))) m.set(str(a.slot, 'slot'), nums(a.vertices, 'vertices'));
    }
    return m;
  };
  const setup = obj(g.setup, 'setup');
  const setupBones = new Map<string, BoneMatrix>();
  for (const b0 of arr(setup.bones, 'setup.bones')) {
    const b = obj(b0, 'bone');
    setupBones.set(str(b.name, 'name'), { a: num(b.a, 'a'), b: num(b.b, 'b'), c: num(b.c, 'c'), d: num(b.d, 'd'), x: num(b.worldX, 'worldX'), y: num(b.worldY, 'worldY') });
  }
  return { rest, setupBones, setup: verts(setup.attachments), frames: arr(g.frames, 'frames').map((f) => verts(obj(f, 'frame').attachments)) };
}

export function renderGeometry(candidate: string, out: string): Geometry | string {
  rmSync(out, { recursive: true, force: true });
  const r = run(RIGC, ['render', '--candidate', candidate, '--animation', 'idle', '--fps', '12', '--geometry', '--out', out]);
  if (r.exit !== 0) return `rigc render exit ${r.exit}: ${r.log.slice(-400)}`;
  return readGeometry(join(out, 'idle', 'geometry.json'));
}

function triArea(v: readonly number[], tri: readonly number[]): number {
  let s = 0;
  for (let t = 0; t < tri.length; t += 3) {
    const [i, j, k] = [tri[t] * 2, tri[t + 1] * 2, tri[t + 2] * 2];
    s += Math.abs((v[j] - v[i]) * (v[k + 1] - v[i + 1]) - (v[j + 1] - v[i + 1]) * (v[k] - v[i])) / 2;
  }
  return s;
}

/** Each mesh's triangles and setup-pose area. */
function meshFigures(g: Geometry): Array<{ slot: string; triangles: number; vertices: number; hull: number; area: number }> {
  return [...g.rest.values()].map((m) => {
    const v = g.setup.get(m.slot) as number[];
    return { slot: m.slot, triangles: m.triangles.length / 3, vertices: v.length / 2, hull: m.hull, area: triArea(v, m.triangles) };
  });
}

// ---------------------------------------------------------------------------
// the displacement against arm 0
// ---------------------------------------------------------------------------

interface Located { tri: number; u: number; v: number; w: number }

/** The triangle of a mesh (setup pose) holding a point, with its barycentric weights; null outside. */
function locate(v: readonly number[], tri: readonly number[], px: number, py: number): Located | null {
  const eps = 1e-9;
  for (let t = 0; t < tri.length; t += 3) {
    const [i, j, k] = [tri[t] * 2, tri[t + 1] * 2, tri[t + 2] * 2];
    const det = (v[j + 1] - v[k + 1]) * (v[i] - v[k]) + (v[k] - v[j]) * (v[i + 1] - v[k + 1]);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((v[j + 1] - v[k + 1]) * (px - v[k]) + (v[k] - v[j]) * (py - v[k + 1])) / det;
    const w2 = ((v[k + 1] - v[i + 1]) * (px - v[k]) + (v[i] - v[k]) * (py - v[k + 1])) / det;
    const w3 = 1 - u - w2;
    if (u >= -eps && w2 >= -eps && w3 >= -eps) return { tri: t, u, v: w2, w: w3 };
  }
  return null;
}

function at(v: readonly number[], tri: readonly number[], l: Located): [number, number] {
  const [i, j, k] = [tri[l.tri] * 2, tri[l.tri + 1] * 2, tri[l.tri + 2] * 2];
  return [l.u * v[i] + l.v * v[j] + l.w * v[k], l.u * v[i + 1] + l.v * v[j + 1] + l.w * v[k + 1]];
}

export interface DisplacementRow { slot: string; max: number; frame: number; samples: number; outside: number }

/**
 * The largest posed displacement of one mesh against arm 0's over the idle: the
 * sample points are every setup vertex and triangle centroid of both meshes; a
 * point inside both is carried through each mesh's skinning (its setup
 * triangle's barycentric weights, applied to that triangle's posed vertices) at
 * every idle frame, and the largest distance between the two is the row. A
 * point inside only one mesh is counted as outside, not measured.
 */
export function displacement(base: Geometry, arm: Geometry): DisplacementRow[] {
  const rows: DisplacementRow[] = [];
  for (const [slot, m0] of base.rest) {
    const m1 = arm.rest.get(slot);
    if (m1 === undefined) continue;
    const v0 = base.setup.get(slot) as number[];
    const v1 = arm.setup.get(slot) as number[];
    const pts: Array<[number, number]> = [];
    for (const [v, tri] of [[v0, m0.triangles], [v1, m1.triangles]] as const) {
      for (let i = 0; i < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      for (let t = 0; t < tri.length; t += 3) pts.push([(v[tri[t] * 2] + v[tri[t + 1] * 2] + v[tri[t + 2] * 2]) / 3, (v[tri[t] * 2 + 1] + v[tri[t + 1] * 2 + 1] + v[tri[t + 2] * 2 + 1]) / 3]);
    }
    const pairs: Array<[Located, Located]> = [];
    let outside = 0;
    for (const [x, y] of pts) {
      const a = locate(v0, m0.triangles, x, y);
      const b = locate(v1, m1.triangles, x, y);
      if (a === null || b === null) outside++;
      else pairs.push([a, b]);
    }
    let max = 0;
    let frame = -1;
    const n = Math.min(base.frames.length, arm.frames.length);
    for (let f = 0; f < n; f++) {
      const p0 = base.frames[f].get(slot) as number[];
      const p1 = arm.frames[f].get(slot) as number[];
      for (const [a, b] of pairs) {
        const [x0, y0] = at(p0, m0.triangles, a);
        const [x1, y1] = at(p1, m1.triangles, b);
        const d = Math.hypot(x1 - x0, y1 - y0);
        if (d > max) [max, frame] = [d, f];
      }
    }
    rows.push({ slot, max, frame, samples: pairs.length, outside });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// arm 2: rows across the chain
// ---------------------------------------------------------------------------

type P2 = [number, number];

function orient(a: P2, b: P2, c: P2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function insidePolygon(p: P2, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsMeet(a: P2, b: P2, c: P2, d: P2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  const on = (p: P2, q: P2, r: P2): boolean => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
}

/** The in-circle test of d against the triangle a, b, c with orient(a, b, c) > 0: positive when d is strictly inside. */
function inCircle(a: P2, b: P2, c: P2, d: P2): number {
  const [adx, ady] = [a[0] - d[0], a[1] - d[1]];
  const [bdx, bdy] = [b[0] - d[0], b[1] - d[1]];
  const [cdx, cdy] = [c[0] - d[0], c[1] - d[1]];
  const ad = adx * adx + ady * ady;
  const bd = bdx * bdx + bdy * bdy;
  const cd = cdx * cdx + cdy * cdy;
  return adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
}

/** Ear clipping of one simple polygon (vertex indices), strict ears only; null when no ear is left. */
function earClip(cycle: readonly number[], V: readonly P2[]): number[] | null {
  const poly = [...cycle];
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = V[poly[i]];
    const [x1, y1] = V[poly[(i + 1) % poly.length]];
    area += x0 * y1 - x1 * y0;
  }
  const sign = area > 0 ? 1 : -1;
  const out: number[] = [];
  while (poly.length > 3) {
    let cut = -1;
    for (let i = 0; i < poly.length && cut < 0; i++) {
      const [p, q, r] = [poly[(i + poly.length - 1) % poly.length], poly[i], poly[(i + 1) % poly.length]];
      if (sign * orient(V[p], V[q], V[r]) <= 1e-12) continue;
      let clear = true;
      for (const o of poly) {
        if (o === p || o === q || o === r) continue;
        const s1 = sign * orient(V[p], V[q], V[o]);
        const s2 = sign * orient(V[q], V[r], V[o]);
        const s3 = sign * orient(V[r], V[p], V[o]);
        if (s1 >= -1e-12 && s2 >= -1e-12 && s3 >= -1e-12) {
          clear = false;
          break;
        }
      }
      if (clear) cut = i;
    }
    if (cut < 0) return null;
    const [p, q, r] = [poly[(cut + poly.length - 1) % poly.length], poly[cut], poly[(cut + 1) % poly.length]];
    out.push(p, q, r);
    poly.splice(cut, 1);
  }
  if (Math.abs(orient(V[poly[0]], V[poly[1]], V[poly[2]])) <= 1e-12) return null;
  out.push(poly[0], poly[1], poly[2]);
  return out;
}

/** Lawson's flips to the constrained Delaunay triangulation: an edge in `locked` is never flipped. Triangles come back with orient > 0. */
function delaunay(tri: number[], V: readonly P2[], locked: ReadonlySet<string>): number[] {
  const T: Array<[number, number, number]> = [];
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    T.push(orient(V[a], V[b], V[c]) > 0 ? [a, b, c] : [a, c, b]);
  }
  const key = (a: number, b: number): string => `${a},${b}`;
  const owner = new Map<string, number>();
  const own = (t: number): void => {
    const [a, b, c] = T[t];
    owner.set(key(a, b), t);
    owner.set(key(b, c), t);
    owner.set(key(c, a), t);
  };
  T.forEach((_, t) => own(t));
  for (let pass = 0; pass < 100000; pass++) {
    let flipped = false;
    for (let t = 0; t < T.length && !flipped; t++) {
      for (let e = 0; e < 3 && !flipped; e++) {
        const a = T[t][e];
        const b = T[t][(e + 1) % 3];
        const c = T[t][(e + 2) % 3];
        if (locked.has(key(a, b)) || locked.has(key(b, a))) continue;
        const u = owner.get(key(b, a));
        if (u === undefined) continue;
        const d = T[u].find((x) => x !== a && x !== b) as number;
        if (inCircle(V[a], V[b], V[c], V[d]) <= 1e-9) continue;
        if (orient(V[a], V[d], V[c]) <= 1e-12 || orient(V[d], V[b], V[c]) <= 1e-12) continue;
        for (const [x, y] of [[a, b], [b, c], [c, a]] as const) owner.delete(key(x, y));
        for (const [x, y] of [[b, a]] as const) owner.delete(key(x, y));
        const [ua, ub, uc] = T[u];
        owner.delete(key(ua, ub));
        owner.delete(key(ub, uc));
        owner.delete(key(uc, ua));
        T[t] = [a, d, c];
        T[u] = [d, b, c];
        own(t);
        own(u);
        flipped = true;
      }
    }
    if (!flipped) return T.flat();
  }
  throw new Error('delaunay: no fixed point within the flip bound');
}

/** A point onto the 1/256 px grid every contour coordinate sits on (`GRID`, `src/contour.ts`), so the topology checks are exact. */
function snap(p: P2): P2 {
  return [Math.round(p[0] * GRID) / GRID, Math.round(p[1] * GRID) / GRID];
}

export interface Row { name: string; ends: [P2, P2]; point: P2 }
export interface RowMesh {
  vertices: P2[];
  triangles: number[];
  hull: number;
  rows: Array<{ name: string; vertices: number }>;
  dropped: string[];
}

/**
 * The rows of one mesh, in part-image px: for each bound segment from origin a
 * to end b, a row at a and at a + m/(k+1)·(b − a), m = 1..k, across the
 * segment's direction (at a chain joint, across the bisector of the two links,
 * as the ribs rule); a row whose point is not inside the outline, or whose line
 * meets the outline on one side only, or that meets an earlier row, is dropped
 * and named.
 */
function placeRows(outline: readonly P2[], segs: ReadonlyArray<{ bone: string; a: P2; b: P2; chainJoint: P2 | null }>, k: number): { rows: Row[]; dropped: string[] } {
  const rows: Row[] = [];
  const dropped: string[] = [];
  for (const s of segs) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const dir: P2 = [(s.b[0] - s.a[0]) / len, (s.b[1] - s.a[1]) / len];
    for (let m = 0; m <= k; m++) {
      const name = `${s.bone} station ${m}`;
      const t = m / (k + 1);
      const q: P2 = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
      let d = dir;
      if (m === 0 && s.chainJoint !== null) {
        const pl = Math.hypot(s.a[0] - s.chainJoint[0], s.a[1] - s.chainJoint[1]);
        d = [dir[0] + (s.a[0] - s.chainJoint[0]) / pl, dir[1] + (s.a[1] - s.chainJoint[1]) / pl];
      }
      const dl = Math.hypot(d[0], d[1]);
      const n: P2 = [-d[1] / dl, d[0] / dl];
      if (!insidePolygon(q, outline)) {
        dropped.push(`${name}: its point (${pyRound(q[0], 2)}, ${pyRound(q[1], 2)}) is outside the outline`);
        continue;
      }
      let lo: P2 | null = null;
      let hi: P2 | null = null;
      let loS = -Infinity;
      let hiS = Infinity;
      for (let i = 0; i < outline.length; i++) {
        const [ax, ay] = outline[i];
        const [bx, by] = outline[(i + 1) % outline.length];
        const ex = bx - ax;
        const ey = by - ay;
        const den = n[0] * ey - n[1] * ex;
        if (den === 0) continue;
        const wx = ax - q[0];
        const wy = ay - q[1];
        const sv = (wx * ey - wy * ex) / den;
        const u = (wx * n[1] - wy * n[0]) / den;
        if (u < 0 || u > 1 || sv === 0) continue;
        if (sv > 0 && sv < hiS) [hiS, hi] = [sv, [q[0] + sv * n[0], q[1] + sv * n[1]]];
        if (sv < 0 && sv > loS) [loS, lo] = [sv, [q[0] + sv * n[0], q[1] + sv * n[1]]];
      }
      if (lo === null || hi === null) {
        dropped.push(`${name}: its line meets the outline on one side only`);
        continue;
      }
      const ends: [P2, P2] = [lo, hi];
      const hit = rows.find((r) => segmentsMeet(r.ends[0], r.ends[1], ends[0], ends[1]));
      if (hit !== undefined) {
        dropped.push(`${name}: meets ${hit.name}`);
        continue;
      }
      rows.push({ name, ends, point: q });
    }
  }
  return { rows, dropped };
}

/**
 * Arm 2's mesh for one part: arm 0's lattice outline, the rows' ends put on it,
 * each row's own point and its halves cut at `spacing` as interior vertices,
 * every new vertex on the contour mode's 1/256 px grid (an end moves off its
 * edge by at most 1/512 px, as a rib's does), the polygon split along every row
 * and each piece ear-clipped, then flipped to
 * the constrained Delaunay triangulation with every outline and row edge
 * locked. Vertices are part-image px; triangles are wound as the lattice's
 * (clockwise on screen, then {@link counterClockwiseInSpineWorld}).
 */
export function rowMesh(outline0: readonly P2[], segs: ReadonlyArray<{ bone: string; a: P2; b: P2; chainJoint: P2 | null }>, k: number, spacing: number): RowMesh {
  const { rows, dropped } = placeRows(outline0, segs, k);
  const n = outline0.length;
  // the ends onto the outline, edge by edge, in order along each edge
  const onEdge: Array<Array<{ u: number; p: P2; row: number; side: 0 | 1 }>> = Array.from({ length: n }, () => []);
  rows.forEach((r, ri) => {
    r.ends.forEach((p, side) => {
      let best = -1;
      let bestD = Infinity;
      let bestU = 0;
      for (let i = 0; i < n; i++) {
        const a = outline0[i];
        const b = outline0[(i + 1) % n];
        const ex = b[0] - a[0];
        const ey = b[1] - a[1];
        const l2 = ex * ex + ey * ey;
        const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
        const dd = Math.hypot(a[0] + u * ex - p[0], a[1] + u * ey - p[1]);
        if (dd < bestD) [best, bestD, bestU] = [i, dd, u];
      }
      onEdge[best].push({ u: bestU, p, row: ri, side: side as 0 | 1 });
    });
  });
  const V: P2[] = [];
  const endAt = rows.map(() => [-1, -1]);
  const startOf: number[] = [];
  const toNext: Array<{ row: number; side: 0 | 1; edge: number }> = [];
  for (let i = 0; i < n; i++) {
    startOf.push(V.length);
    V.push([outline0[i][0], outline0[i][1]]);
    for (const e of onEdge[i].sort((p, q) => p.u - q.u || p.row - q.row || p.side - q.side)) {
      if (e.u <= 1e-9) endAt[e.row][e.side] = startOf[i];
      else if (e.u >= 1 - 1e-9) toNext.push({ row: e.row, side: e.side, edge: (i + 1) % n });
      else {
        endAt[e.row][e.side] = V.length;
        V.push(snap(e.p));
      }
    }
  }
  for (const t of toNext) endAt[t.row][t.side] = startOf[t.edge];
  const H = V.length;
  const rowVerts: number[][] = [];
  rows.forEach((r, ri) => {
    const line = [endAt[ri][0]];
    const half = (a: P2, b: P2, last: boolean): void => {
      const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
      for (let j = 1; j < parts; j++) {
        line.push(V.length);
        V.push(snap([a[0] + ((b[0] - a[0]) * j) / parts, a[1] + ((b[1] - a[1]) * j) / parts]));
      }
      if (!last) {
        line.push(V.length);
        V.push(snap(b));
      }
    };
    half(r.ends[0], r.point, false);
    half(r.point, r.ends[1], true);
    line.push(endAt[ri][1]);
    rowVerts.push(line);
  });
  // split the outline polygon along every row
  let polys: number[][] = [Array.from({ length: H }, (_, i) => i)];
  for (const line of rowVerts) {
    const [u, v] = [line[0], line[line.length - 1]];
    const pi = polys.findIndex((p) => p.includes(u) && p.includes(v));
    if (pi < 0) throw new Error(`rowMesh: no piece holds both ends of a row (${u}, ${v})`);
    const p = polys[pi];
    const iu = p.indexOf(u);
    const iv = p.indexOf(v);
    const walk = (from: number, to: number): number[] => {
      const out: number[] = [];
      for (let i = from; ; i = (i + 1) % p.length) {
        out.push(p[i]);
        if (i === to) break;
      }
      return out;
    };
    const inner = line.slice(1, -1);
    const a = [...walk(iu, iv), ...[...inner].reverse()];
    const b = [...walk(iv, iu), ...inner];
    polys = [...polys.slice(0, pi), a, b, ...polys.slice(pi + 1)];
  }
  const tri: number[] = [];
  for (const p of polys) {
    const t = earClip(p, V);
    if (t === null) throw new Error(`rowMesh: a piece of ${p.length} vertices has no ear`);
    tri.push(...t);
  }
  const locked = new Set<string>();
  for (let i = 0; i < H; i++) locked.add(`${i},${(i + 1) % H}`);
  for (const line of rowVerts) for (let j = 0; j + 1 < line.length; j++) locked.add(`${line[j]},${line[j + 1]}`);
  const cdt = delaunay(tri, V, locked);
  return { vertices: V, triangles: counterClockwiseInSpineWorld(cdt), hull: H, rows: rows.map((r, i) => ({ name: r.name, vertices: rowVerts[i].length })), dropped };
}

/** The mesh's bound segments as the rig stage resolves them (`buildRig`'s `meshSegments`), in rig px, each chain link with the joint before it. */
function resolveSegments(config: Obj, part: string): Array<{ bone: string; a: P2; b: P2; chainJoint: P2 | null }> {
  const bones = arr(config.bones, 'bones').map((b, i) => obj(b, `bones[${i}]`));
  const mesh = obj(obj(config.meshes, 'meshes')[part], `meshes.${part}`);
  const out: Array<{ bone: string; a: P2; b: P2; chainJoint: P2 | null }> = [];
  for (const s of arr(mesh.segments, `meshes.${part}.segments`)) {
    if (typeof s === 'string') {
      const chain = bones.find((b) => b.chain === s);
      if (chain !== undefined) {
        const pts = arr(chain.points, 'points').map((p) => nums(p, 'point') as P2);
        pts.push(nums(chain.tip, 'tip') as P2);
        for (let i = 0; i + 1 < pts.length; i++) out.push({ bone: `${s}${i}`, a: pts[i], b: pts[i + 1], chainJoint: i === 0 ? null : pts[i - 1] });
      } else {
        const b = bones.find((x) => x.name === s);
        if (b === undefined || b.tip === undefined) throw new Error(`meshes.${part}: segment "${s}" is neither a chain nor a bone with a tip`);
        out.push({ bone: s, a: nums(b.at, 'at') as P2, b: nums(b.tip, 'tip') as P2, chainJoint: null });
      }
    } else {
      const t = arr(s, 'segment');
      out.push({ bone: str(t[0], 'bone'), a: nums(t[1], 'a') as P2, b: nums(t[2], 'b') as P2, chainJoint: null });
    }
  }
  return out;
}

/** A 2D affine map fitted by least squares: p -> (a·x + b·y + c, d·x + e·y + f). */
function fitAffine(from: readonly P2[], to: readonly P2[]): (p: P2) => P2 {
  const solve3 = (rhs: (i: number) => number): [number, number, number] => {
    let [sxx, sxy, sx, syy, sy, s1, bx, by, b1] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    from.forEach(([x, y], i) => {
      const r = rhs(i);
      sxx += x * x;
      sxy += x * y;
      sx += x;
      syy += y * y;
      sy += y;
      s1 += 1;
      bx += x * r;
      by += y * r;
      b1 += r;
    });
    const M = [
      [sxx, sxy, sx, bx],
      [sxy, syy, sy, by],
      [sx, sy, s1, b1],
    ];
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let j = c; j < 4; j++) M[r][j] -= f * M[c][j];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  };
  const [a, b, c] = solve3((i) => to[i][0]);
  const [d, e, f] = solve3((i) => to[i][1]);
  return ([x, y]) => [a * x + b * y + c, d * x + e * y + f];
}

interface WeightEntry { bone: string; x: number; y: number; weight: number }

/** The rig stage's distance-rule weights at a part-image point, bound in each bone's setup frame. */
function weightsAt(p: P2, offset: P2, segs: readonly Segment[], r: number, toWorld: (q: P2) => P2, bones: ReadonlyMap<string, BoneMatrix>): WeightEntry[] {
  const [wx, wy] = toWorld(p);
  const ent = influences([p[0] + offset[0], p[1] + offset[1]], segs, r).map(({ bone, weight }) => {
    const m = bones.get(bone);
    if (m === undefined) throw new Error(`weightsAt: bone "${bone}" is not in the setup geometry`);
    const det = m.a * m.d - m.b * m.c;
    const dx = wx - m.x;
    const dy = wy - m.y;
    const lx = (m.d * dx - m.b * dy) / det;
    const ly = (-m.c * dx + m.a * dy) / det;
    const z = (v: number): number => (pyRound(v, OFFSET_PLACES) === 0 ? 0 : pyRound(v, OFFSET_PLACES));
    return { bone, x: z(lx), y: z(ly), weight: pyRound(weight, 5) };
  });
  let others = 0;
  for (let i = 0; i < ent.length - 1; i++) others += ent[i].weight;
  ent[ent.length - 1].weight = pyRound(1 - others, 5);
  return ent;
}

interface ArmTwoPart { part: string; vertices: number; triangles: number; hull: number; rows: Array<{ name: string; vertices: number }>; dropped: string[]; weightControl: number }

/**
 * Arm 2's rig: arm 0's rig directory copied, each named mesh's attachment
 * replaced by {@link rowMesh}'s. Two controls run first, on arm 0's own mesh:
 * the lattice recomputed here from the part's image must be the one arm 0 wrote
 * (its UVs, to their 6 places), and the weights recomputed here at arm 0's
 * vertices must be arm 0's (largest difference, reported); either failing is
 * an exit 1, not a row.
 */
export function armTwoRig(arm0: string, out: string, config: Obj, parts: readonly PartBox[], geom: Geometry, names: readonly string[], k: number, spacing: number): ArmTwoPart[] {
  rmSync(out, { recursive: true, force: true });
  cpSync(join(arm0, 'rig'), out, { recursive: true });
  const rigPath = join(out, 'rig.json');
  const rig = obj(readJson(rigPath), rigPath);
  const skin = obj(obj(rig.skins, 'skins').default, 'skins.default');
  const rows: ArmTwoPart[] = [];
  for (const part of names) {
    const att = obj(obj(skin[part], `skin ${part}`)[part], `attachment ${part}`);
    const box = parts.find((p) => p.name === part);
    if (box === undefined) throw new Error(`armTwoRig: no part "${part}" in parts.json`);
    const mesh = obj(obj(config.meshes, 'meshes')[part], `meshes.${part}`);
    const grid = num(mesh.grid, `meshes.${part}.grid (arm 2 takes lattice parts only)`);
    const r = num(mesh.r, `meshes.${part}.r`);
    const img = readPng(join(arm0, 'rig', 'images', str(att.image, 'image')));
    const lm = latticeMesh(part, alphaAbove(img, ART_ALPHA), grid);
    if ('code' in lm) throw new Error(`armTwoRig: ${lm.code} ${lm.detail}`);
    const w = num(att.width, 'width');
    const h = num(att.height, 'height');
    const uvs = nums(att.uvs, 'uvs');
    let uvOff = 0;
    lm.vertices.forEach(([x, y], i) => (uvOff = Math.max(uvOff, Math.abs(pyRound(x / w, 6) - uvs[2 * i]), Math.abs(pyRound(y / h, 6) - uvs[2 * i + 1]))));
    if (uvs.length !== lm.vertices.length * 2 || uvOff !== 0) throw new Error(`armTwoRig: control — the lattice of "${part}" recomputed here is not arm 0's (${uvs.length / 2} vs ${lm.vertices.length} vertices, uv off by ${uvOff})`);
    const offset: P2 = [box.x - PAD, box.y - PAD];
    const setup = geom.setup.get(part) as number[];
    const toWorld = fitAffine(
      lm.vertices.map((v) => [v[0], v[1]] as P2),
      lm.vertices.map((_, i) => [setup[2 * i], setup[2 * i + 1]] as P2),
    );
    const segs = resolveSegments(config, part);
    const wsegs: Segment[] = segs.map((s) => ({ bone: s.bone, a: s.a, b: s.b }));
    // control: arm 0's own weights, recomputed
    const w0 = arr(att.weights, 'weights');
    let weightControl = 0;
    lm.vertices.forEach((v, i) => {
      const mine = weightsAt([v[0], v[1]], offset, wsegs, r, toWorld, geom.setupBones);
      const theirs = arr(w0[i], 'weights[i]').map((e) => obj(e, 'entry'));
      if (mine.length !== theirs.length) throw new Error(`armTwoRig: control — vertex ${i} of "${part}" has ${mine.length} influences here, ${theirs.length} in arm 0`);
      mine.forEach((m, j) => {
        if (m.bone !== str(theirs[j].bone, 'bone')) throw new Error(`armTwoRig: control — vertex ${i} of "${part}" names ${m.bone} here, ${str(theirs[j].bone, 'bone')} in arm 0`);
        weightControl = Math.max(weightControl, Math.abs(m.x - num(theirs[j].x, 'x')), Math.abs(m.y - num(theirs[j].y, 'y')), Math.abs(m.weight - num(theirs[j].weight, 'weight')));
      });
    });
    if (weightControl > 1e-3) throw new Error(`armTwoRig: control — the weights recomputed at arm 0's vertices of "${part}" differ from arm 0's by ${weightControl}`);
    const outline = lm.vertices.slice(0, lm.hull).map((v) => [v[0], v[1]] as P2);
    const local = segs.map((s) => ({ bone: s.bone, a: [s.a[0] - offset[0], s.a[1] - offset[1]] as P2, b: [s.b[0] - offset[0], s.b[1] - offset[1]] as P2, chainJoint: s.chainJoint === null ? null : ([s.chainJoint[0] - offset[0], s.chainJoint[1] - offset[1]] as P2) }));
    const m = rowMesh(outline, local, k, spacing);
    const problems = contourTopologyProblems(part, m.vertices, m.triangles, m.hull);
    if (problems.length > 0) throw new Error(`armTwoRig: the row mesh of "${part}" fails topology: ${problems.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
    skin[part] = {
      [part]: {
        type: 'mesh',
        image: str(att.image, 'image'),
        width: w,
        height: h,
        uvs: m.vertices.flatMap(([x, y]) => [pyRound(x / w, 6), pyRound(y / h, 6)]),
        triangles: m.triangles,
        hull: m.hull,
        weights: m.vertices.map((v) => weightsAt(v, offset, wsegs, r, toWorld, geom.setupBones).map((e) => ({ bone: e.bone, x: e.x, y: e.y, weight: e.weight }))),
      },
    };
    rows.push({ part, vertices: m.vertices.length, triangles: m.triangles.length / 3, hull: m.hull, rows: m.rows, dropped: m.dropped, weightControl });
  }
  writeFileSync(rigPath, rigJsonText(rig));
  return rows;
}

// ---------------------------------------------------------------------------
// one arm, measured
// ---------------------------------------------------------------------------

export interface ArmResult {
  arm: string;
  B: number | null;
  exit: number;
  refusals: string[];
  moved: string[];
  meshes: Array<{ slot: string; triangles: number; vertices: number; hull: number; area: number }>;
  check: Obj | null;
  checkLines: string[];
  displacement: DisplacementRow[];
  armTwo: ArmTwoPart[];
  error: string | null;
}

function checkLines(log: string): string[] {
  return log
    .split('\n')
    .filter((l) => /^\[check\] {3}(loop:|seam:|[A-Z_]+: )|^\[check\] check:|^check:/.test(l))
    .map((l) => l.replace(/^\[check\] +/, '').slice(0, 400));
}

function measured(arm: string, B: number | null, dir: string, r: RunResult, moved: string[], base: Geometry | null, armTwo: ArmTwoPart[]): { result: ArmResult; geometry: Geometry | null } {
  const checkJson = join(dir, 'check', 'check.json');
  const check = existsSync(checkJson) ? obj(readJson(checkJson), checkJson) : null;
  const candidate = join(dir, 'check', 'build');
  let geometry: Geometry | null = null;
  let error: string | null = null;
  if (existsSync(join(candidate, 'skeleton.json'))) {
    const g = renderGeometry(candidate, join(dir, 'render'));
    if (typeof g === 'string') error = g;
    else geometry = g;
  } else error = 'no compiled build to render';
  return {
    result: {
      arm,
      B,
      exit: r.exit,
      refusals: r.exit === 0 ? [] : refusals(r.log).slice(0, 12),
      moved,
      meshes: geometry === null ? [] : meshFigures(geometry),
      check,
      checkLines: checkLines(r.log),
      displacement: geometry === null || base === null ? [] : displacement(base, geometry),
      armTwo,
      error,
    },
    geometry,
  };
}

function runExample(key: string, configPath: string, inputs: string, requirements: string | null, work: string, chainRows: string[], reuse: boolean): Obj {
  for (const p of [configPath, join(inputs, 'painting.png'), join(inputs, 'layers', 'full', 'layers.json'), join(inputs, 'layers', 'head', 'layers.json'), ...(requirements === null ? [] : [requirements])]) {
    if (!existsSync(p)) {
      console.error(`density_survey: ${p} is not there`);
      process.exit(1);
    }
  }
  mkdirSync(work, { recursive: true });
  const config = obj(readJson(configPath), configPath);
  const arms: ArmResult[] = [];
  const log = (s: string): void => void process.stderr.write(`[${key}] ${s}\n`);

  const dir0 = join(work, 'arm0');
  log('arm 0 build');
  const r0 = stage(dir0, reuse, 'bun', buildArgs(configPath, inputs, requirements, dir0));
  const m0 = measured('0', null, dir0, r0, [], null, []);
  arms.push(m0.result);
  if (m0.geometry === null || r0.exit !== 0) {
    log(`arm 0 did not build (exit ${r0.exit}); nothing else runs`);
    return { key, figure: null, arms: arms as unknown as Json };
  }
  const base = m0.geometry;
  const parts = partBoxes(join(dir0, 'parts.json'));
  const fig = figureHeight(parts);

  for (const c of FIGURE_DIVISORS) {
    const B = Math.round(fig.height / c);
    const dir = join(work, `arm1-c${c}`);
    const { config: cfg, moved } = armOneConfig(config, B);
    const at = stageConfig(configPath, cfg, join(work, `cfg-c${c}`));
    log(`arm 1 c ${c} B ${B} build`);
    const r = stage(dir, reuse, 'bun', buildArgs(at, inputs, requirements, dir));
    arms.push(measured(`1 (c ${c})`, B, dir, r, moved, base, []).result);
  }

  if (chainRows.length > 0) {
    const spacing = fig.height / ROW_SPACING_DIVISOR;
    for (const k of ROW_STATIONS) {
      const dir = join(work, `arm2-k${k}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      log(`arm 2 k ${k} rows, check`);
      const two = armTwoRig(dir0, join(dir, 'rig'), config, parts, base, chainRows, k, spacing);
      const args = [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', dir0];
      if (requirements !== null) args.push('--requirements', requirements);
      const r = stage(join(dir, 'check'), false, 'bun', args);
      arms.push(measured(`2 (k ${k})`, null, dir, { exit: r.exit, log: r.log.split('\n').map((l) => `[check] ${l}`).join('\n') }, [`${chainRows.join(', ')}: rows at k ${k}, cut at ${pyRound(spacing, 3)} px`], base, two).result);
    }
  }
  return {
    key,
    figure: { height: fig.height, top: fig.top, bottom: fig.bottom, row_spacing: chainRows.length > 0 ? pyRound(fig.height / ROW_SPACING_DIVISOR, 3) : null },
    config_meshes: Object.fromEntries(Object.entries(obj(config.meshes, 'meshes')).map(([n, m]) => [n, (() => {
      const o = obj(m, n);
      if ('grid' in o) return `grid ${num(o.grid, 'grid')}`;
      if ('contour' in o) return `contour spacing ${num(obj(o.contour, 'contour').spacing, 'spacing')}${arr(obj(o.contour, 'contour').regions ?? [], 'regions').length > 0 ? ' + region' : ''}`;
      return Object.keys(o).join('/');
    })()])) as Json,
    part_sizes: Object.fromEntries(parts.map((p) => [p.name, `${p.w}x${p.h}`])) as Json,
    mesh_bones: Object.fromEntries(Object.keys(obj(config.meshes, 'meshes')).map((n) => [n, new Set(resolveSegments(config, n).map((s) => s.bone)).size])) as Json,
    arms: arms as unknown as Json,
  };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const fx = (v: number, n: number): string => v.toFixed(n);

function armsOf(doc: Obj): ArmResult[] {
  return arr(doc.arms, 'arms') as unknown as ArmResult[];
}

function figureDensity(a: ArmResult): number {
  const t = a.meshes.reduce((s, m) => s + m.triangles, 0);
  const ar = a.meshes.reduce((s, m) => s + m.area, 0);
  return t / ar;
}

const BARS = ['BREATH_VISIBLE', 'BLINK_NO_HOLE', 'CHAIN_LAG', 'TIP_OVER_ROOT', 'STILL_REGIONS_DARK', 'TEXTURE_STRETCH'] as const;

function barCell(check: Obj | null, bar: string): string {
  if (check === null) return '—';
  const v = check[bar];
  if (v === undefined || v === null || typeof v !== 'object' || Array.isArray(v)) return '—';
  const s = typeof v.status === 'string' ? v.status : '?';
  if (bar === 'TEXTURE_STRETCH' && typeof v.severity === 'number') return `${s} ${v.severity}`;
  if (bar === 'TIP_OVER_ROOT' && Array.isArray(v.parts)) {
    const ratios = v.parts.map((p) => (p !== null && typeof p === 'object' && !Array.isArray(p) && typeof p.ratio === 'number' ? p.ratio : NaN)).filter((x) => !Number.isNaN(x));
    return ratios.length > 0 ? `${s} min ${Math.min(...ratios)}` : s;
  }
  return s;
}

function seamCell(check: Obj | null): string {
  if (check === null) return '—';
  const m = check.seam_mean;
  const p = check.seam_px_over_40;
  return typeof m === 'number' ? `${m} / ${String(p)}` : '—';
}

function renderPage(docs: Obj[]): string {
  const L: string[] = [];
  L.push('# Mesh density over the figure (issue #265, Stage A)');
  L.push('');
  L.push('Generated by `tools/density_survey.ts` (its header states the arms, the divisors and the displacement rule, all fixed before the run); this page is its `--page` output over the three examples\' `--run` documents. Every figure is read from the build\'s own files: triangles and areas from `rigc render --geometry`\'s setup pose (world units = rig px), the bars from `check.json`.');
  L.push('');
  L.push(`Arm 1: B = round(H / c), c ∈ {${FIGURE_DIVISORS.join(', ')}}, H the figure's height. Arm 2: rows at k ∈ {${ROW_STATIONS.join(', ')}} stations, cut at H / ${ROW_SPACING_DIVISOR}.`);
  L.push('');
  L.push('The pictures (trailer, setup pose, every mesh drawn over the dimmed art) are drawn by rig-c 2.43.0\'s `rigc inspect`, newer than the 2.40.0 this tree pins, installed beside it for the pictures only; they read the builds `--run` writes under `--work`:');
  L.push('');
  L.push('- `density-arm0.png` — arm 0: `rigc inspect --candidate <work>/arm0/check/build --show art,mesh --dim --max 1400`');
  L.push('- `density-arm1.png` — arm 1 at c 26 (B 43), the one B at which the trailer\'s line is met: the same over `<work>/arm1-c26/check/build`');
  L.push('- `density-arm2.png` — arm 2 at k 2, neck, handwear_l and legwear, each arm 0 (left, A) beside arm 2 (right, B): `rigc inspect --candidate <work>/arm0/check/build --compare <work>/arm2-k2/check/build --show art,mesh --dim --overlay-slot <part> --zoom slot:<part>:10 --max 700`, the three placed side by side');
  L.push('');
  L.push('![arm 0](density-arm0.png) ![arm 1, B 43](density-arm1.png)');
  L.push('');
  L.push('![arm 2, k 2](density-arm2.png)');
  for (const doc of docs) {
    const key = str(doc.key, 'key');
    const fig = doc.figure === null ? null : obj(doc.figure, 'figure');
    const arms = armsOf(doc);
    L.push('');
    L.push(`## ${key}`);
    L.push('');
    if (fig !== null) L.push(`Figure height H = ${num(fig.height, 'height')} rig px (rows ${num(fig.top, 'top')} to ${num(fig.bottom, 'bottom')}).`);
    L.push('');
    L.push('| arm | B | build | Σ triangles | vs arm 0 | parts above 3x the figure | loop | seam mean / px>40 | ' + BARS.join(' | ') + ' | recomposite error px | largest displacement vs arm 0 (rig px) |');
    L.push('| --- | ---: | --- | ---: | ---: | --- | --- | --- | ' + BARS.map(() => '---').join(' | ') + ' | ---: | --- |');
    const t0 = arms[0].meshes.reduce((s, m) => s + m.triangles, 0);
    for (const a of arms) {
      const T = a.meshes.reduce((s, m) => s + m.triangles, 0);
      const fd = a.meshes.length > 0 ? figureDensity(a) : NaN;
      const over = a.meshes.filter((m) => m.triangles / m.area / fd > 3).map((m) => `${m.slot} ${fx(m.triangles / m.area / fd, 1)}x${String(obj(doc.config_meshes, 'config_meshes')[m.slot] ?? '').includes('region') ? ' (declared: soft region)' : ''}`);
      const worst = [...a.displacement].sort((p, q) => q.max - p.max)[0];
      const build = a.exit === 0 ? 'PASS' : `exit ${a.exit}`;
      const rc = a.check !== null && a.check.RECOMPOSITE_HOLES !== undefined ? String(obj(a.check.RECOMPOSITE_HOLES, 'rh').error_px) : '—';
      const loop = a.check !== null ? String(a.check.loop_max_diff) : '—';
      L.push(
        `| ${a.arm} | ${a.B ?? '—'} | ${build} | ${a.meshes.length > 0 ? T : '—'} | ${a.meshes.length > 0 ? `${fx((100 * T) / t0, 1)} %` : '—'} | ${over.length > 0 ? over.join(', ') : 'none'} | ${loop} | ${seamCell(a.check)} | ${BARS.map((b) => barCell(a.check, b)).join(' | ')} | ${rc} | ${worst === undefined ? '—' : `${fx(worst.max, 3)} (${worst.slot}, frame ${worst.frame})`} |`,
      );
    }
    for (const a of arms) {
      if (a.exit !== 0 || a.error !== null) {
        L.push('');
        L.push(`Arm ${a.arm}${a.B === null ? '' : ` (B ${a.B})`}: ${a.exit !== 0 ? `exit ${a.exit}` : ''}${a.error !== null ? ` ${a.error}` : ''}`);
        for (const r of a.refusals) L.push(`- \`${r}\``);
        for (const c of a.checkLines.filter((l) => /FAIL/.test(l))) L.push(`- \`${c}\``);
      }
    }
    // per-part density table, every arm side by side
    const sizes = obj(doc.part_sizes, 'part_sizes');
    const bones = obj(doc.mesh_bones, 'mesh_bones');
    const modes = obj(doc.config_meshes, 'config_meshes');
    L.push('');
    L.push(`Per mesh: triangles, and density relative to the figure's (Σ triangles / Σ area over every mesh). Arm 0's mode is the config's.`);
    L.push('');
    L.push(`| part | box px (parts.json) | bones | arm 0 mode | ${arms.map((a) => `arm ${a.arm} tri`).join(' | ')} | ${arms.map((a) => `arm ${a.arm} density`).join(' | ')} | ${arms.slice(1).map((a) => `arm ${a.arm} displ.`).join(' | ')} |`);
    L.push(`| --- | --- | ---: | --- | ${arms.map(() => '---:').join(' | ')} | ${arms.map(() => '---:').join(' | ')} | ${arms.slice(1).map(() => '---:').join(' | ')} |`);
    const order = [...arms[0].meshes].sort((p, q) => q.triangles / q.area - p.triangles / p.area).map((m) => m.slot);
    for (const slot of order) {
      const cells = arms.map((a) => a.meshes.find((m) => m.slot === slot));
      const dens = arms.map((a, i) => {
        const m = cells[i];
        return m === undefined || a.meshes.length === 0 ? '—' : `${fx(m.triangles / m.area / figureDensity(a), 2)}x`;
      });
      const disp = arms.slice(1).map((a) => {
        const d = a.displacement.find((x) => x.slot === slot);
        return d === undefined ? '—' : fx(d.max, 3);
      });
      L.push(`| ${slot} | ${String(sizes[slot] ?? '?')} | ${String(bones[slot] ?? '?')} | ${String(modes[slot] ?? '?')} | ${cells.map((m) => (m === undefined ? '—' : String(m.triangles))).join(' | ')} | ${dens.join(' | ')} | ${disp.join(' | ')} |`);
    }
    L.push('');
    L.push('Per mesh: `TEXTURE_STRETCH`\'s severity for that mesh over the idle (`check.json` `per_mesh`; the bar is the figure\'s largest, against its ceiling).');
    L.push('');
    L.push(`| part | ${arms.map((a) => `arm ${a.arm}`).join(' | ')} |`);
    L.push(`| --- | ${arms.map(() => '---:').join(' | ')} |`);
    for (const slot of order) {
      const cells = arms.map((a) => {
        const ts = a.check === null ? undefined : a.check.TEXTURE_STRETCH;
        if (ts === undefined || ts === null || typeof ts !== 'object' || Array.isArray(ts) || !Array.isArray(ts.per_mesh)) return '—';
        const row = ts.per_mesh.find((r) => r !== null && typeof r === 'object' && !Array.isArray(r) && r.slot === slot);
        return row !== undefined && row !== null && typeof row === 'object' && !Array.isArray(row) && typeof row.severity === 'number' ? String(row.severity) : '—';
      });
      L.push(`| ${slot} | ${cells.join(' | ')} |`);
    }
    const two = arms.filter((a) => a.armTwo.length > 0);
    if (two.length > 0) {
      L.push('');
      L.push('Arm 2, per part: the mesh built, its rows (vertices on each, ends included) and the rows the rule dropped. The controls (arm 0\'s lattice recomputed, and its weights recomputed to within the largest difference shown) passed before any row was placed.');
      L.push('');
      L.push('| arm | part | vertices | hull | triangles | weight control | rows kept | rows dropped |');
      L.push('| --- | --- | ---: | ---: | ---: | ---: | --- | --- |');
      for (const a of two) {
        for (const p of a.armTwo) {
          L.push(`| ${a.arm} | ${p.part} | ${p.vertices} | ${p.hull} | ${p.triangles} | ${p.weightControl.toExponential(1)} | ${p.rows.map((r) => `${r.name} (${r.vertices})`).join('; ')} | ${p.dropped.length > 0 ? p.dropped.join('; ') : 'none'} |`);
        }
      }
    }
    L.push('');
    L.push('Every arm\'s `check` lines, as the build printed them:');
    for (const a of arms) {
      L.push('');
      L.push(`<details><summary>arm ${a.arm}${a.B === null ? '' : ` (B ${a.B})`}</summary>`);
      L.push('');
      L.push('```');
      for (const l of a.moved) L.push(`moved: ${l}`);
      for (const l of a.checkLines) L.push(l);
      L.push('```');
      L.push('');
      L.push('</details>');
    }
  }
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// the command
// ---------------------------------------------------------------------------

function main(argv: string[]): void {
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  if (argv.includes('--page')) {
    const files = argv.slice(argv.indexOf('--page') + 1);
    process.stdout.write(renderPage(files.map((f) => obj(readJson(f), f))));
    return;
  }
  if (argv.includes('--run')) {
    const key = flag('--key');
    const config = flag('--config');
    const inputs = flag('--inputs');
    const work = flag('--work');
    if (key === null || config === null || inputs === null || work === null) {
      console.error('density_survey --run needs --key, --config, --inputs and --work');
      process.exit(2);
    }
    const chain = flag('--chain-rows');
    const doc = runExample(key, resolve(config), resolve(inputs), flag('--requirements') === null ? null : resolve(flag('--requirements') as string), resolve(work), chain === null ? [] : chain.split(','), argv.includes('--reuse'));
    process.stdout.write(`${JSON.stringify(doc)}\n`);
    return;
  }
  console.error('usage: density_survey --run --key <k> --config <path> --inputs <dir> --work <dir> [--requirements <path>] [--chain-rows a,b,c] | --page <doc.json>…');
  process.exit(2);
}

if (import.meta.main) main(process.argv.slice(2));
