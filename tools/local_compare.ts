#!/usr/bin/env bun
/**
 * The lattice against the contour mode on one part with a local deformation
 * region — issue #84's settled §3 and §4, measured.
 *
 *     bun tools/local_compare.ts [--rigs <dir>]
 *
 * Prints the two tables of §4 on the generated part of `fixtures/localfield.ts`,
 * the verdict by §4's rule, and what the contour mesh's thin triangles do. With
 * `--rigs <dir>` it also writes and gates (`rigc build`) one rig per compared
 * mesh — the part, its three bones and `soft` keyed through the three poses —
 * for `tools/idle_cost.ts` to time. Not shipped (`tools/` is not in `files`);
 * the definitions it measures by are exported and the selftest holds them
 * (suite `contour-wiring`).
 *
 * ## The definitions
 *
 * - **The field** at a point p for a pose M of the control (an affine map of
 *   image px; the segment bones stay at their setup pose): `p + g(p)·(M p − p)`,
 *   with g the declared falloff (`regionWeight`, `src/localweights.ts`)
 *   evaluated AT the point. With the segment bones still, their shares move
 *   nothing, so the field depends on g alone; the weights' other entries are
 *   counted as cost (bindings), not as motion.
 * - **A mesh's value** at p: the triangle holding p's centre (the first in
 *   index order, edges included) and the barycentric mix of its three
 *   vertices' skinned positions, `v + w(v)·(M v − v)`, where w(v) is the
 *   control's weight AS WRITTEN (5 places, `writtenShares` in `src/rig.ts`).
 *   The lattice is given the same weight function at its vertices — here
 *   only; a lattice config cannot declare a region.
 * - Over the art pixels' centres: **local shape error** — inside the region
 *   (g = 1), |mesh − field|, max and RMS; **transition error** — the band
 *   (0 < g < 1), the same; **deformation outside** — g = 0, the largest
 *   |mesh − p| (the field leaves them still).
 * - **Surround density**: mesh vertices at which g = 0, per 1000 art px at
 *   which g = 0.
 * - **Cost**: vertices, triangles, bindings (weight entries over all
 *   vertices). Frame time is `tools/idle_cost.ts` on the `--rigs` builds, not
 *   computed here.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ContourRegionSpec, type Point } from '../src/config.ts';
import { contourMesh, triangleQuality } from '../src/contour.ts';
import { localInfluences, regionWeight } from '../src/localweights.ts';
import { latticeMesh } from '../src/mesh.ts';
import { encodePngBytes, newRaster } from '../src/raster/index.ts';
import { writtenShares } from '../src/rig.ts';
import type { Influence, Segment } from '../src/weights.ts';
import {
  type Affine,
  FIELD_BACKGROUND,
  FIELD_BONES,
  FIELD_H,
  FIELD_LATTICE_GRID,
  FIELD_MARGIN,
  FIELD_POSES,
  FIELD_R,
  FIELD_SEGMENTS,
  FIELD_TOLERANCE,
  FIELD_W,
  type FieldPose,
  fieldMask,
  fieldRegion,
  REGION_SPACINGS,
} from '../fixtures/localfield.ts';

const ROOT = resolve(import.meta.dir, '..');

export interface ComparedMesh {
  label: string;
  vertices: Array<[number, number]>;
  triangles: number[];
  hull: number;
  /** Per vertex, the weights as the rig stage writes them. */
  weights: Influence[][];
}

export function apply(m: Affine, p: Point): Point {
  return [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];
}

/** The field at p: p + g(p)(M p − p). */
export function fieldAt(p: Point, region: ContourRegionSpec, m: Affine): Point {
  const g = regionWeight(p, region);
  const q = apply(m, p);
  return [p[0] + g * (q[0] - p[0]), p[1] + g * (q[1] - p[1])];
}

/** A vertex skinned with the control's written weight w: v + w(M v − v). */
export function skinned(v: Point, w: number, m: Affine): Point {
  const q = apply(m, v);
  return [v[0] + w * (q[0] - v[0]), v[1] + w * (q[1] - v[1])];
}

/** The control's weight among a vertex's written weights (0 when it is not named). */
export function controlWeight(ws: readonly Influence[], bone: string): number {
  return ws.find((e) => e.bone === bone)?.weight ?? 0;
}

/** Each vertex weighted as the rig stage weights a contour vertex (segments, r, the region). */
export function weighMesh(vertices: ReadonlyArray<readonly [number, number]>, segs: readonly Segment[], r: number, regions: readonly ContourRegionSpec[]): Influence[][] {
  return vertices.map(([x, y]) => {
    const li = localInfluences([x, y], segs, r, regions);
    if ('first' in li) throw new Error(`local_compare: vertex (${x}, ${y}) is reached by two regions`);
    return writtenShares(li);
  });
}

/**
 * The triangle holding p (edges included; the first in index order) and p's
 * barycentric weights in it, or null. A bucket grid of `cell` px over the
 * triangles' boxes keeps it linear; the answer does not depend on it.
 */
export function locator(vertices: ReadonlyArray<readonly [number, number]>, triangles: readonly number[], cell = 8): (p: Point) => { t: number; l: [number, number, number] } | null {
  const buckets = new Map<number, number[]>();
  const key = (i: number, j: number): number => j * 100003 + i;
  for (let t = 0; t < triangles.length / 3; t++) {
    const ps = [vertices[triangles[3 * t]], vertices[triangles[3 * t + 1]], vertices[triangles[3 * t + 2]]];
    const i0 = Math.floor(Math.min(...ps.map((q) => q[0])) / cell);
    const i1 = Math.floor(Math.max(...ps.map((q) => q[0])) / cell);
    const j0 = Math.floor(Math.min(...ps.map((q) => q[1])) / cell);
    const j1 = Math.floor(Math.max(...ps.map((q) => q[1])) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (buckets.get(key(i, j)) ?? buckets.set(key(i, j), []).get(key(i, j)) as number[]).push(t);
  }
  return (p) => {
    for (const t of buckets.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell))) ?? []) {
      const [a, b, c] = [vertices[triangles[3 * t]], vertices[triangles[3 * t + 1]], vertices[triangles[3 * t + 2]]];
      const o = (u: readonly number[], v: readonly number[], w: readonly number[]): number => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
      const area = o(a, b, c);
      const la = o(b, c, p) / area;
      const lb = o(c, a, p) / area;
      const lc = o(a, b, p) / area;
      if (la >= 0 && lb >= 0 && lc >= 0) return { t, l: [la, lb, lc] };
    }
    return null;
  };
}

/** Where a class's error is largest: the pixel, its triangle, that triangle's three vertex indices, and its smallest angle (degrees). */
export interface WorstPixel {
  pixel: Point;
  triangle: number;
  corners: [number, number, number];
  minAngle: number;
  error: number;
}

export interface Errors {
  localMax: number;
  localRms: number;
  transitionMax: number;
  transitionRms: number;
  outsideMax: number;
  /** Art pixels in each class: inside the region, in the band, outside both. */
  pixels: { local: number; transition: number; outside: number };
  /** Where the local error is largest (the first such pixel in row-major order). */
  worstLocal: WorstPixel | null;
  /** Where the transition error is largest (the first such pixel in row-major order). */
  worstTransition: WorstPixel | null;
  /** Pixels no triangle holds (must be 0: the mesh covers the art). */
  uncovered: number;
}

/** One art pixel centre as the comparison reads it: its class by g, the triangle holding it, and its error (|mesh − field|, or |mesh − p| outside). */
export interface PixelError {
  pixel: Point;
  g: number;
  triangle: number;
  error: number;
}

/**
 * Every art pixel centre of `mask`, row-major, read against one mesh under one
 * pose (§3's definitions, module header); `null` for a pixel no triangle
 * holds. {@link errors} and {@link pixelsOver} are folds over it.
 */
export function pixelErrors(mesh: ComparedMesh, mask: { width: number; height: number; alpha: Uint8Array }, threshold: number, region: ContourRegionSpec, pose: Affine): Array<PixelError | null> {
  const find = locator(mesh.vertices, mesh.triangles);
  const moved = mesh.vertices.map((v, i) => skinned(v, controlWeight(mesh.weights[i], region.bone), pose));
  const out: Array<PixelError | null> = [];
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] <= threshold) continue;
      const p: Point = [x + 0.5, y + 0.5];
      const hit = find(p);
      if (hit === null) {
        out.push(null);
        continue;
      }
      const [a, b, c] = [moved[mesh.triangles[3 * hit.t]], moved[mesh.triangles[3 * hit.t + 1]], moved[mesh.triangles[3 * hit.t + 2]]];
      const got: Point = [hit.l[0] * a[0] + hit.l[1] * b[0] + hit.l[2] * c[0], hit.l[0] * a[1] + hit.l[1] * b[1] + hit.l[2] * c[1]];
      const g = regionWeight(p, region);
      const want = g === 0 ? p : fieldAt(p, region, pose);
      out.push({ pixel: p, g, triangle: hit.t, error: Math.hypot(got[0] - want[0], got[1] - want[1]) });
    }
  }
  return out;
}

function worstOf(mesh: ComparedMesh, e: PixelError): WorstPixel {
  const corners: [number, number, number] = [mesh.triangles[3 * e.triangle], mesh.triangles[3 * e.triangle + 1], mesh.triangles[3 * e.triangle + 2]];
  return { pixel: e.pixel, triangle: e.triangle, corners, minAngle: triangleQuality(mesh.vertices, corners).smallestAngle.value, error: e.error };
}

/** §3's three errors, for one mesh under one pose, over every art pixel centre of `mask`. */
export function errors(mesh: ComparedMesh, mask: { width: number; height: number; alpha: Uint8Array }, threshold: number, region: ContourRegionSpec, pose: Affine): Errors {
  let lm = 0;
  let ls = 0;
  let tm = 0;
  let tsum = 0;
  let om = 0;
  const pixels = { local: 0, transition: 0, outside: 0 };
  let worst: PixelError | null = null;
  let worstT: PixelError | null = null;
  let uncovered = 0;
  for (const e of pixelErrors(mesh, mask, threshold, region, pose)) {
    if (e === null) {
      uncovered++;
      continue;
    }
    if (e.g === 0) {
      pixels.outside++;
      om = Math.max(om, e.error);
    } else if (e.g === 1) {
      pixels.local++;
      ls += e.error * e.error;
      if (worst === null || e.error > lm) {
        lm = e.error;
        worst = e;
      }
    } else {
      pixels.transition++;
      tsum += e.error * e.error;
      if (worstT === null || e.error > tm) worstT = e;
      tm = Math.max(tm, e.error);
    }
  }
  return {
    localMax: lm,
    localRms: pixels.local === 0 ? 0 : Math.sqrt(ls / pixels.local),
    transitionMax: tm,
    transitionRms: pixels.transition === 0 ? 0 : Math.sqrt(tsum / pixels.transition),
    outsideMax: om,
    pixels,
    worstLocal: worst === null ? null : worstOf(mesh, worst),
    worstTransition: worstT === null ? null : worstOf(mesh, worstT),
    uncovered,
  };
}

/**
 * The distribution behind a maximum: how many pixels of one class (`local`,
 * g = 1; `transition`, 0 < g < 1) have an error strictly above `bar`, and in
 * which triangles, most pixels first (a tie by triangle index).
 */
export function pixelsOver(read: ReadonlyArray<PixelError | null>, cls: 'local' | 'transition', bar: number): { pixels: number; of: number; triangles: Array<{ triangle: number; pixels: number }> } {
  let of = 0;
  let pixels = 0;
  const by = new Map<number, number>();
  for (const e of read) {
    if (e === null || e.g === 0 || (cls === 'local') !== (e.g === 1)) continue;
    of++;
    if (!(e.error > bar)) continue;
    pixels++;
    by.set(e.triangle, (by.get(e.triangle) ?? 0) + 1);
  }
  return { pixels, of, triangles: [...by].map(([triangle, n]) => ({ triangle, pixels: n })).sort((p, q) => q.pixels - p.pixels || p.triangle - q.triangle) };
}

export interface Cost {
  vertices: number;
  triangles: number;
  bindings: number;
  /** Vertices where g = 0, per 1000 art px where g = 0. */
  surroundDensity: number;
  surroundVertices: number;
  minAngle: number;
}

export function cost(mesh: ComparedMesh, mask: { width: number; height: number; alpha: Uint8Array }, threshold: number, region: ContourRegionSpec): Cost {
  let surroundPx = 0;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.alpha[y * mask.width + x] > threshold && regionWeight([x + 0.5, y + 0.5], region) === 0) surroundPx++;
  const surroundVertices = mesh.vertices.filter((v) => regionWeight(v as Point, region) === 0).length;
  return {
    vertices: mesh.vertices.length,
    triangles: mesh.triangles.length / 3,
    bindings: mesh.weights.reduce((n, w) => n + w.length, 0),
    surroundDensity: (1000 * surroundVertices) / surroundPx,
    surroundVertices,
    minAngle: triangleQuality(mesh.vertices, mesh.triangles).smallestAngle.value,
  };
}

const THRESHOLD = 8;

/** The lattice at `grid` over the fixture, weighted with the region (the tool's only lattice with a region). */
export function fieldLattice(grid: number, region: ContourRegionSpec): ComparedMesh {
  const mask = fieldMask();
  const art = { width: mask.width, height: mask.height, data: new Uint8Array(mask.alpha.length) };
  for (let i = 0; i < art.data.length; i++) art.data[i] = mask.alpha[i] > THRESHOLD ? 1 : 0;
  const lm = latticeMesh('field', art, grid);
  if ('code' in lm) throw new Error(`${lm.code}: ${lm.detail}`);
  const vertices = lm.vertices.map(([x, y]) => [x, y] as [number, number]);
  return { label: `lattice grid ${grid}`, vertices, triangles: lm.triangles, hull: lm.hull, weights: weighMesh(vertices, FIELD_SEGMENTS, FIELD_R, [region]) };
}

/** The contour mesh of the fixture with the region at `spacing`, or the codes that refused it. */
export function fieldContour(spacing: number): ComparedMesh | string {
  const region = fieldRegion(spacing);
  const cm = contourMesh('field', fieldMask(), {
    threshold: THRESHOLD,
    tolerance: FIELD_TOLERANCE,
    margin: FIELD_MARGIN,
    spacing: FIELD_BACKGROUND,
    regions: [{ name: region.name, shape: 'circle', cx: 64, cy: 30, r: 8, spacing, band: 8 }],
  });
  if (Array.isArray(cm)) return cm.map((p) => p.code).join(', ');
  return { label: `contour region spacing ${spacing}`, vertices: cm.vertices, triangles: cm.triangles, hull: cm.hull, weights: weighMesh(cm.vertices, FIELD_SEGMENTS, FIELD_R, [region]) };
}

/** The contour mesh table 1 compares: the finest region spacing whose mesh has no more vertices than `budget`. */
export function contourAtBudget(budget: number): { mesh: ComparedMesh; spacing: number; tried: string[] } | null {
  const tried: string[] = [];
  for (const s of REGION_SPACINGS) {
    const m = fieldContour(s);
    tried.push(typeof m === 'string' ? `${s}: ${m}` : `${s}: ${m.vertices.length} V`);
    if (typeof m !== 'string' && m.vertices.length <= budget) return { mesh: m, spacing: s, tried };
  }
  return null;
}

const f = (v: number, d = 3): string => v.toFixed(d);

function errorRow(label: string, pose: FieldPose, e: Errors): string {
  return `| ${label} | ${pose.name} | ${f(e.localMax)} | ${f(e.localRms)} | ${f(e.transitionMax)} | ${f(e.transitionRms)} | ${f(e.outsideMax)} |`;
}

// ---------------------------------------------------------------------------
// rigs for frame timing
// ---------------------------------------------------------------------------

/** A rig of one mesh on the fixture's bones, `soft` keyed 0 → each pose → 0 over 1 s per pose, written and gated by rigc. */
export function writeFieldRig(dir: string, mesh: ComparedMesh, rigc: string): { status: number; out: string } {
  mkdirSync(join(dir, 'images'), { recursive: true });
  const mask = fieldMask();
  const img = newRaster(FIELD_W, FIELD_H);
  for (let i = 0; i < mask.alpha.length; i++) img.data.set([180, 120, 90, mask.alpha[i]], i * 4);
  // The one image is named for the page rigc packs it on: spine-html's A27 refuses a lone region named otherwise.
  writeFileSync(join(dir, 'images', 'skeleton.png'), encodePngBytes(img));
  const Y = (y: number): number => FIELD_H - y;
  const at = new Map(FIELD_BONES.map((b) => [b.name, b.at]));
  const rig = {
    spec: 'rigc-rig/1',
    name: 'field',
    images: 'images',
    skeleton: { x: -FIELD_W, y: -FIELD_H, width: 3 * FIELD_W, height: 3 * FIELD_H },
    bones: [{ name: 'root', x: 0, y: 0 }, ...FIELD_BONES.map((b) => ({ name: b.name, parent: 'root', x: b.at[0], y: Y(b.at[1]) }))],
    slots: [{ name: 'field', bone: 'left', attachment: 'field' }],
    skins: {
      default: {
        field: {
          field: {
            type: 'mesh',
            image: 'skeleton.png',
            width: FIELD_W,
            height: FIELD_H,
            uvs: mesh.vertices.flatMap(([x, y]) => [x / FIELD_W, y / FIELD_H]),
            triangles: mesh.triangles,
            hull: mesh.hull,
            weights: mesh.vertices.map(([x, y], i) => mesh.weights[i].map((w) => ({ bone: w.bone, x: x - (at.get(w.bone) as Point)[0], y: Y(y) - Y((at.get(w.bone) as Point)[1]), weight: w.weight }))),
          },
        },
      },
    },
    invariants: { idleDrivesMeshes: { why: 'local_compare: the idle poses the region control on purpose' } },
  };
  const props = { rotate: 'rotate', translate: 'translate', scale: 'scale' } as const;
  const rest = { rotate: [0], translate: [0, 0], scale: [1, 1] };
  const tracks = FIELD_POSES.map((p, k) => ({
    bone: 'soft',
    property: props[p.key.property],
    keys: [
      { t: k, v: rest[p.key.property] },
      { t: k + 0.5, v: p.key.value },
      { t: k + 1, v: rest[p.key.property] },
    ],
  }));
  const motion = { spec: 'rigc-motion/1', archetype: 'field', cut: 'field', easings: {}, groups: {}, animations: { idle: { duration: FIELD_POSES.length, loop: true, tracks } } };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 1)}\n`);
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 1)}\n`);
  const r = spawnSync(rigc, ['build', '--rig', join(dir, 'rig.json'), '--motion', join(dir, 'motion.json'), '--out', join(dir, 'build'), '--profile', 'spine-html', '--pack', '--page-edges', 'free', '--pack-shape', 'polygon'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv: string[]): void {
  const rigsAt = argv.indexOf('--rigs');
  const rigs = rigsAt >= 0 ? argv[rigsAt + 1] : null;
  const mask = fieldMask();
  const lattice = fieldLattice(FIELD_LATTICE_GRID, fieldRegion(1));
  const picked = contourAtBudget(lattice.vertices.length);
  console.log(`local_compare: fixtures/localfield.ts — ${FIELD_W}x${FIELD_H}, art ${mask.alpha.filter((a) => a > THRESHOLD).length} px; region circle (64, 30) r 8 band 8 on "soft"; segments left, right; r ${FIELD_R}`);
  console.log(`  the lattice (grid ${FIELD_LATTICE_GRID}): ${lattice.vertices.length} vertices`);
  console.log(`  contour region spacings tried (background ${FIELD_BACKGROUND}, tolerance ${FIELD_TOLERANCE}, margin ${FIELD_MARGIN}): ${picked?.tried.join('; ') ?? 'none fits'}`);
  if (picked === null) {
    console.log('  no contour mesh fits the lattice vertex count: table 1 has no contour row');
    return;
  }
  const contour = picked.mesh;
  const region = fieldRegion(picked.spacing);
  const meshes = [lattice, contour];
  const costs = meshes.map((m) => cost(m, mask, THRESHOLD, region));
  const errs = meshes.map((m) => FIELD_POSES.map((p) => errors(m, mask, THRESHOLD, region, p.map)));

  console.log('\n### Table 1 — at the lattice\'s vertex count (px)\n');
  console.log('| mesh | pose | local max | local RMS | transition max | transition RMS | outside max |');
  console.log('|---|---|---|---|---|---|---|');
  meshes.forEach((m, i) => FIELD_POSES.forEach((p, k) => console.log(errorRow(m.label, p, errs[i][k]))));
  console.log('\n| mesh | vertices | triangles | bindings | surround vertices | surround density /1000 px | smallest angle° | uncovered px |');
  console.log('|---|---|---|---|---|---|---|---|');
  meshes.forEach((m, i) => console.log(`| ${m.label} | ${costs[i].vertices} | ${costs[i].triangles} | ${costs[i].bindings} | ${costs[i].surroundVertices} | ${f(costs[i].surroundDensity)} | ${costs[i].minAngle} | ${errs[i][0].uncovered} |`));
  console.log(`\npixels per class (each mesh, every pose): local ${errs[0][0].pixels.local}, transition ${errs[0][0].pixels.transition}, outside ${errs[0][0].pixels.outside}`);

  // §4's rule.
  const worst = (e: Errors[], k: 'localMax' | 'outsideMax'): number => Math.max(...e.map((x) => x[k]));
  const lLocal = worst(errs[0], 'localMax');
  const cLocal = worst(errs[1], 'localMax');
  const lOut = worst(errs[0], 'outsideMax');
  const cOut = worst(errs[1], 'outsideMax');
  const rule = [
    [`contour vertices ${costs[1].vertices} <= lattice ${costs[0].vertices}`, costs[1].vertices <= costs[0].vertices],
    [`largest local shape error lower: contour ${f(cLocal)} < lattice ${f(lLocal)}`, cLocal < lLocal],
    [`deformation outside not higher: contour ${f(cOut)} <= lattice ${f(lOut)}`, cOut <= lOut],
    ['part, slot and texture counts unchanged: 1, 1, 1 in both (one part, one slot, one image by construction)', true],
    [`surround density not raised: contour ${f(costs[1].surroundDensity)} <= lattice ${f(costs[0].surroundDensity)} vertices per 1000 px`, costs[1].surroundDensity <= costs[0].surroundDensity],
  ] as const;
  console.log('\n### §4 rule\n');
  for (const [what, ok] of rule) console.log(`- ${ok ? 'met' : 'NOT met'}: ${what}`);
  console.log(`\nverdict: ${rule.every((r) => r[1]) ? 'ACCEPTED' : 'NOT ACCEPTED'} by §4's rule`);

  // Table 2.
  console.log(`\n### Table 2 — at matched error: the lattice refined until its largest local shape error (over the poses) reaches the contour's ${f(cLocal)} px\n`);
  console.log('| mesh | largest local max | largest transition max | largest outside max | vertices | triangles | bindings | surround density |');
  console.log('|---|---|---|---|---|---|---|---|');
  console.log(`| ${contour.label} | ${f(cLocal)} | ${f(Math.max(...errs[1].map((e) => e.transitionMax)))} | ${f(cOut)} | ${costs[1].vertices} | ${costs[1].triangles} | ${costs[1].bindings} | ${f(costs[1].surroundDensity)} |`);
  let matched: string | null = null;
  let matchedMesh: ComparedMesh | null = null;
  for (let g = FIELD_LATTICE_GRID; g >= 1; g--) {
    const lm = fieldLattice(g, region);
    const e = FIELD_POSES.map((p) => errors(lm, mask, THRESHOLD, region, p.map));
    const c = cost(lm, mask, THRESHOLD, region);
    const lmax = worst(e, 'localMax');
    console.log(`| ${lm.label} | ${f(lmax)} | ${f(Math.max(...e.map((x) => x.transitionMax)))} | ${f(worst(e, 'outsideMax'))} | ${c.vertices} | ${c.triangles} | ${c.bindings} | ${f(c.surroundDensity)} |`);
    if (lmax <= cLocal) {
      matched = lm.label;
      matchedMesh = lm;
      break;
    }
  }
  console.log(`\nmatched: ${matched ?? `no lattice grid from ${FIELD_LATTICE_GRID} down to 1 reaches it`}`);

  // Thin triangles, without a bar.
  console.log('\n### Thin triangles\n');
  meshes.forEach((m, i) => {
    const w = errs[i].map((e, k) => (e.worstLocal === null ? `${FIELD_POSES[k].name}: no local pixel` : `${FIELD_POSES[k].name}: worst local pixel (${e.worstLocal.pixel.join(', ')}) in triangle ${e.worstLocal.triangle}, smallest angle ${e.worstLocal.minAngle}°`));
    console.log(`- ${m.label}: smallest angle ${costs[i].minAngle}°; ${w.join('; ')}`);
  });

  if (rigs !== null && rigs !== undefined) {
    const rigc = join(ROOT, 'node_modules', '.bin', 'rigc');
    const list: Array<[string, ComparedMesh]> = [['lattice', lattice], ['contour', contour]];
    if (matchedMesh !== null) list.push(['lattice-matched', matchedMesh]);
    for (const [name, m] of list) {
      const r = writeFieldRig(join(rigs, name), m, rigc);
      const sum = r.out.split('\n').filter((l) => l.includes('assertions:')).map((l) => l.trim());
      console.log(`rig ${name}: rigc build exit ${r.status}; ${sum.join(' | ') || r.out.split('\n').slice(-5).join(' | ')}`);
    }
  }
}

if (import.meta.main) main(process.argv.slice(2));
