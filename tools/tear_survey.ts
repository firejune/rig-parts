#!/usr/bin/env bun
/**
 * Issue #284 Stage A: the weight rule's two cuts, measured. The rule keeps a vertex's four largest influences and drops
 * any under 0.03 (`DEFAULT_LIMITS`, src/weights.ts); where the ranking changes hands the field tears. This tool takes
 * the shipped lattice meshes of an example and reads them under the rule as built and under each candidate that keeps
 * the influence count bounded and makes a cut continuous — nothing under `src/` changes.
 *
 *     bun tools/tear_survey.ts --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] [--picture <part>] [--probe <part>] --out <k>.json
 *     bun tools/tear_survey.ts --page <k>.json…   # the measured half of docs/evidence/weight-tears.md
 *
 * **The rules** ({@link ruleInfluences}), each from the same raw weights `influences()` computes:
 *
 * - **as built** — `influences()` at `DEFAULT_LIMITS`: the four largest, normalised; any under 0.03 dropped;
 *   normalised again.
 * - **continuous cap** — the fifth-largest raw weight subtracted from the four kept, clamped at zero, normalised (the
 *   fourth reaches zero exactly where it would change hands); then the floor as built.
 * - **continuous floor** — the cap as built; then 0.03 subtracted from every kept weight, clamped at zero, normalised
 *   (a weight reaches zero exactly where the floor would cut it).
 * - **both** — the continuous cap, then the continuous floor.
 * - **lifted** — for reference only: every bone the segments name, normalised, nothing dropped.
 *
 * **What a rule writes** ({@link writtenFor}): a vertex whose influences under the candidate are the as-built ones
 * (the same bones, every weight within 1e-12) keeps its rig.json entry byte for byte; any other is rounded as the rig
 * stage rounds a region's shares (`roundShares`, src/rig.ts: each weight to 5 places, an entry rounding to 0 dropped,
 * the remainder to the heaviest — the lattice's own "remainder to the last entry" is safe only above a floor, which a
 * continuous cut takes away), each bone's offset kept from rig.json when the bone was there and computed in its setup
 * frame (`weightsAt`'s construction) when it was not.
 *
 * **What is read**, per example and rule, on every lattice mesh (`grid`; a `contour` or `auto` mesh keeps its weights
 * and is named):
 *
 * - the census, at the idle (every frame of the build's own idle) and at #265's bend set (`tools/bend_survey.ts`: every
 *   link of every chain the part names turned ±15°; the trailer also at the film's bends): inverted triangles of the
 *   written mesh (`bendReading`'s count, a triangle counted once per pose it folds in, as #265's tables count it) and
 *   **tears** — pairs of reference samples (art pixel centres on the dense reference's grid, `referenceField`'s
 *   stride, at most {@link TEAR_PAIR_PX} px apart, 4-neighbours) skinned by the rule itself whose posed distance exceeds
 *   their rest distance by more than {@link TEAR_PX} rig px under any pose of the set; with the worst sample against
 *   that rule's own dense reference;
 * - the largest influence count written; the bytes that move (vertices whose entry changed, rig.json's length);
 * - every `check` bar, by the real `rig-parts check` over the lattice's rig with the weights replaced;
 * - the idle's posed displacement against today's rig: every written vertex skinned at every idle frame, against the
 *   same vertex as built (a control first: today's weights skinned here must give `rigc render --geometry`'s frames).
 *
 * `--picture <part>` keeps that part's mesh posed at the film's (or the fallback's) bend under every rule, for the
 * picture. `--probe <part>` reads the part's alternative meshes under the rule as built and lifted ({@link probe}).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type ContourParams, contourMesh } from '../src/contour.ts';
import { ART_ALPHA, counterClockwiseInSpineWorld, latticeMesh } from '../src/mesh.ts';
import { alphaAbove, readPng } from '../src/raster/index.ts';
import { OFFSET_PLACES, PAD, rigJsonText } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { boneHeat, type HeatField, heatInfluences, latticeSilhouette } from '../src/heat.ts';
import { DEFAULT_LIMITS, type Influence, influences, MAX_INFLUENCES, MIN_WEIGHT, type Segment } from '../src/weights.ts';
import { bendPoses, bendReading, bentBones, MAX_SAMPLES, type Reference, readSkeleton, type Skeleton } from './bend_survey.ts';
import { type ChainLine, draftContourMesh, outlineTolerance } from './contourdraft.ts';
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
} from './density_survey.ts';
import { cdt, GRID_DIVISOR } from './edge_survey.ts';

const ROOT = resolve(import.meta.dir, '..');
const readJ = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const o = (v: Json | undefined): Obj => v as Obj;
const GRIDU = 256;
const snapU = (v: number): number => Math.round(v * GRIDU) / GRIDU;

/** Two reference samples at most this far apart (px, at rest) are a pair the census reads. */
export const TEAR_PAIR_PX = 3;

/** A pair whose posed distance exceeds its rest distance by more than this (rig px) is a tear. Fixed before the run. */
export const TEAR_PX = 3;

export const ALL_RULES = ['as built', 'continuous cap', 'continuous floor', 'both', 'lifted', 'family', 'family + continuous floor', 'heat', 'heat + continuous floor'] as const;
export type RuleName = (typeof ALL_RULES)[number];

/** Stage A's rules, the default; Stage B runs `--rules` with the family rule. */
export const RULE_NAMES: readonly RuleName[] = ['as built', 'continuous cap', 'continuous floor', 'both', 'lifted'];

const ALL = { maxInfluences: Number.MAX_SAFE_INTEGER, minWeight: 0 };

function normalise(list: readonly Influence[]): Influence[] {
  let s = 0;
  for (const e of list) s += e.weight;
  return list.map((e) => ({ bone: e.bone, weight: e.weight / s }));
}

/**
 * Stage B's proposal, the **family** of a point: when its largest bone is a link of chain C, only C's links, the bone
 * C hangs from and the part's declared segments that are no chain's link may claim it; when its largest bone is a
 * declared segment, every bone may (unchanged). Read off `config.bones` (`chain`, `parent`) and the mesh's `segments`.
 */
export function family(all: readonly Influence[], ci: ChainInfo): Influence[] {
  const c = ci.chainOf.get(all[0].bone);
  if (c === undefined) return [...all];
  const parent = ci.parentOf.get(c);
  return all.filter((e) => {
    const ce = ci.chainOf.get(e.bone);
    return ce === c || ce === undefined || e.bone === parent;
  });
}

/** A part's bone heat as the rig stage solves it (`boneHeat` over `latticeSilhouette`, src/heat.ts), and the image's origin in rig px. */
export interface HeatArg { field: HeatField; ox: number; oy: number }

const isHeat = (rule: RuleName): boolean => rule === 'heat' || rule === 'heat + continuous floor';

/** The influences at a rig-px point under `rule`, unrounded, largest first. `ci` is required by the family rules, `heat` by the heat rules. */
export function ruleInfluences(rule: RuleName, rp: P2, segs: readonly Segment[], r: number, exponent: number | undefined, ci: ChainInfo | null = null, heat: HeatArg | null = null): Influence[] {
  if (rule === 'as built') return influences(rp, segs, r, DEFAULT_LIMITS, exponent);
  if (isHeat(rule)) {
    if (heat === null) throw new Error('tear_survey: the heat rules need the part\'s solved field');
    const p: P2 = [rp[0] - heat.ox, rp[1] - heat.oy];
    if (rule === 'heat') return heatInfluences(heat.field, p, DEFAULT_LIMITS);
    const top = normalise(heatInfluences(heat.field, p, ALL).slice(0, MAX_INFLUENCES));
    return normalise(top.map((e) => ({ bone: e.bone, weight: e.weight - MIN_WEIGHT })).filter((e) => e.weight > 0));
  }
  let all = influences(rp, segs, r, ALL, exponent); // every bone, normalised: proportional to the raw weights, largest first
  if (rule === 'lifted') return all;
  if (rule === 'family' || rule === 'family + continuous floor') {
    if (ci === null) throw new Error('tear_survey: the family rule needs the config\'s chains');
    all = normalise(family(all, ci));
    const top = normalise(all.slice(0, MAX_INFLUENCES));
    if (rule === 'family') return normalise(top.filter((e) => e.weight >= MIN_WEIGHT));
    return normalise(top.map((e) => ({ bone: e.bone, weight: e.weight - MIN_WEIGHT })).filter((e) => e.weight > 0));
  }
  let top: Influence[];
  if (rule === 'continuous cap' || rule === 'both') {
    const fifth = all.length > MAX_INFLUENCES ? all[MAX_INFLUENCES].weight : 0;
    top = all.slice(0, MAX_INFLUENCES).map((e) => ({ bone: e.bone, weight: e.weight - fifth })).filter((e) => e.weight > 0);
  } else top = all.slice(0, MAX_INFLUENCES);
  top = normalise(top);
  if (rule === 'continuous floor' || rule === 'both') return normalise(top.map((e) => ({ bone: e.bone, weight: e.weight - MIN_WEIGHT })).filter((e) => e.weight > 0));
  return normalise(top.filter((e) => e.weight >= MIN_WEIGHT));
}

/** `roundShares` (src/rig.ts), the region rounding: 5 places, zeros dropped, the remainder to the heaviest. */
function roundShares(list: readonly Influence[]): Influence[] {
  const kept = list.map((e) => ({ bone: e.bone, weight: pyRound(e.weight, 5) })).filter((e) => e.weight > 0);
  let heavy = 0;
  for (let k = 1; k < kept.length; k++) if (kept[k].weight > kept[heavy].weight) heavy = k;
  let others = 0;
  for (let k = 0; k < kept.length; k++) if (k !== heavy) others += kept[k].weight;
  kept[heavy].weight = pyRound(1 - others, 5);
  return kept;
}

/** The lattice's rounding (src/rig.ts): each weight to 5 places, the last entry `1 − sum(others)` — what `rule: "heat"` writes. */
function latticeRound(list: readonly Influence[]): Influence[] {
  const out = list.map((e) => ({ bone: e.bone, weight: pyRound(e.weight, 5) }));
  let others = 0;
  for (let k = 0; k < out.length - 1; k++) others += out[k].weight;
  out[out.length - 1].weight = pyRound(1 - others, 5);
  return out;
}

/** A bone's offset to a world point, in the bone's setup frame (`weightsAt`'s construction, unrounded). */
function local(bones: ReadonlyMap<string, BoneMatrix>, bone: string, w: P2): [number, number] {
  const m = bones.get(bone);
  if (m === undefined) throw new Error(`tear_survey: bone "${bone}" is not in the setup geometry`);
  const det = m.a * m.d - m.b * m.c;
  const [dx, dy] = [w[0] - m.x, w[1] - m.y];
  return [(m.d * dx - m.b * dy) / det, (-m.c * dx + m.a * dy) / det];
}

const placesZ = (v: number): number => (pyRound(v, OFFSET_PLACES) === 0 ? 0 : pyRound(v, OFFSET_PLACES));

function sameInfluences(a: readonly Influence[], b: readonly Influence[]): boolean {
  return a.length === b.length && a.every((e, i) => e.bone === b[i].bone && Math.abs(e.weight - b[i].weight) <= 1e-12);
}

// ---------------------------------------------------------------------------
// one part's context
// ---------------------------------------------------------------------------

interface PartCtx {
  part: string;
  box: PartBox;
  att: Obj;
  segs: Segment[];
  r: number;
  exponent: number | undefined;
  grid: number;
  /** Lattice vertices, rig px. */
  rig: P2[];
  triangles: number[];
  hull: number;
  rigToWorld: (p: P2) => P2;
  rest: number[];
  original: WeightEntry[][];
  ci: ChainInfo;
  /** Solved on demand for the heat rules; a refusal is kept by its codes. */
  heat: HeatArg | null;
  heatRefused: string | null;
  heatMs: number | null;
  heatIterations: number[] | null;
}

function partCtx(config: Obj, arm0: string, rig: Obj, box: PartBox, latG: Geometry): PartCtx | string {
  const part = box.name;
  const m = o(o(config.meshes)[part]);
  if (!('grid' in m)) return `${'contour' in m ? 'contour' : 'auto' in m ? 'auto' : 'region'} mesh: keeps its weights`;
  const att = o(o(o(o(rig.skins).default)[part])[part]);
  const img = readPng(join(arm0, 'rig', 'images', att.image as string));
  const lm = latticeMesh(part, alphaAbove(img, ART_ALPHA), m.grid as number);
  if ('code' in lm) throw new Error(`tear_survey: ${lm.code} ${lm.detail}`);
  const [w, h] = [att.width as number, att.height as number];
  const uvs = att.uvs as number[];
  lm.vertices.forEach(([x, y], i) => {
    if (pyRound(x / w, 6) !== uvs[2 * i] || pyRound(y / h, 6) !== uvs[2 * i + 1]) throw new Error(`tear_survey: control — the lattice of "${part}" recomputed here is not the build's (vertex ${i})`);
  });
  const offset: P2 = [box.x - PAD, box.y - PAD];
  const rigPts = lm.vertices.map(([x, y]) => [x + offset[0], y + offset[1]] as P2);
  const rest = latG.setup.get(part) as number[];
  const rigToWorld = fitAffine(rigPts, rigPts.map((_, i) => [rest[2 * i], rest[2 * i + 1]] as P2));
  const original = (att.weights as Json[]).map((row) => (row as Obj[]).map((e) => ({ bone: e.bone as string, x: e.x as number, y: e.y as number, weight: e.weight as number })));
  return {
    part,
    box,
    att,
    segs: resolveSegments(config, part).map((s) => ({ bone: s.bone, a: s.a, b: s.b })),
    r: m.r as number,
    exponent: typeof m.exponent === 'number' ? m.exponent : undefined,
    grid: m.grid as number,
    rig: rigPts,
    triangles: lm.triangles,
    hull: lm.hull,
    rigToWorld,
    rest,
    original,
    ci: chainInfo(config),
    heat: null,
    heatRefused: null,
    heatMs: null,
    heatIterations: null,
  };
}

/** What a rule writes for one vertex, and whether it differs from the build's entry. */
function writtenFor(ctx: PartCtx, i: number, rule: RuleName, bones: ReadonlyMap<string, BoneMatrix>): { entry: WeightEntry[]; changed: boolean } {
  const p = ctx.rig[i];
  if (isHeat(rule) && ctx.heat === null) return { entry: ctx.original[i], changed: false }; // refused by heat: today's weights, named
  const built = influences(p, ctx.segs, ctx.r, DEFAULT_LIMITS, ctx.exponent);
  const mine = ruleInfluences(rule, p, ctx.segs, ctx.r, ctx.exponent, ctx.ci, ctx.heat);
  if (sameInfluences(built, mine)) return { entry: ctx.original[i], changed: false };
  const w = ctx.rigToWorld(p);
  const entry = (rule === 'heat' ? latticeRound(mine) : roundShares(mine)).map(({ bone, weight }) => {
    const was = ctx.original[i].find((e) => e.bone === bone);
    if (was !== undefined) return { bone, x: was.x, y: was.y, weight };
    const [x, y] = local(bones, bone, w);
    return { bone, x: placesZ(x), y: placesZ(y), weight };
  });
  const changed = entry.length !== ctx.original[i].length || entry.some((e, k) => e.bone !== ctx.original[i][k].bone || e.weight !== ctx.original[i][k].weight || e.x !== ctx.original[i][k].x || e.y !== ctx.original[i][k].y);
  return { entry, changed };
}

// ---------------------------------------------------------------------------
// the reference under a rule, and its tears
// ---------------------------------------------------------------------------

type RuleRef = Reference & { rig: P2[]; kept: string[] };

/** `referenceField` (tools/bend_survey.ts) under `rule`: the same samples, each skinned by the rule unrounded. */
function referenceUnder(ctx: { box: PartBox; segs: readonly Segment[]; r: number; exponent: number | undefined; rigToWorld: (p: P2) => P2; ci: ChainInfo; heat: HeatArg | null }, png: string, bones: ReadonlyMap<string, BoneMatrix>, poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>, rule: RuleName): RuleRef {
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
      const w = ctx.rigToWorld(rp);
      const ws = ruleInfluences(rule, rp, ctx.segs, ctx.r, ctx.exponent, ctx.ci, ctx.heat).map(({ bone, weight }) => {
        const [lx, ly] = local(bones, bone, w);
        return { bone, x: lx, y: ly, weight };
      });
      samples.push(w);
      rig.push(rp);
      kept.push(ws.map((e) => e.bone).sort().join(','));
      poses.forEach((pose, k) => posed[k].push(skin(ws, pose)));
    }
  }
  return { samples, posed, stride, rig, kept };
}

export interface Tears { pairs: number; torn: number; worst: number; at: P2 | null; keptDiffers: number; stride: number }

/** The census's tears: 4-neighbour pairs on the reference's grid, posed gap minus rest gap above {@link TEAR_PX}. */
export function tearsOf(ref: RuleRef): Tears {
  const index = new Map<string, number>();
  ref.rig.forEach((p, i) => index.set(`${p[0]},${p[1]}`, i));
  let pairs = 0;
  let torn = 0;
  let worst = 0;
  let at: P2 | null = null;
  let keptDiffers = 0;
  if (ref.stride > TEAR_PAIR_PX) return { pairs: 0, torn: 0, worst: 0, at: null, keptDiffers: 0, stride: ref.stride };
  ref.rig.forEach((p, i) => {
    for (const [dx, dy] of [[ref.stride, 0], [0, ref.stride]] as const) {
      const j = index.get(`${p[0] + dx},${p[1] + dy}`);
      if (j === undefined) continue;
      pairs++;
      let g = 0;
      for (const ps of ref.posed) g = Math.max(g, Math.hypot(ps[i][0] - ps[j][0], ps[i][1] - ps[j][1]) - ref.stride);
      if (g > TEAR_PX) {
        torn++;
        if (ref.kept[i] !== ref.kept[j]) keptDiffers++;
      }
      if (g > worst) [worst, at] = [g, [p[0] + dx / 2, p[1] + dy / 2]];
    }
  });
  return { pairs, torn, worst, at, keptDiffers, stride: ref.stride };
}

// ---------------------------------------------------------------------------
// the probe: one part's alternative meshes, under the rule as built and lifted
// ---------------------------------------------------------------------------

interface ProbeMesh { name: string; note: string; rig: P2[]; triangles: number[]; hull: number }

/** The chains `config.bones` declares, as `tools/contourdraft.ts` reads them: link origins then the tip, rig px. */
function chainLines(config: Obj): Map<string, ChainLine> {
  const out = new Map<string, ChainLine>();
  for (const b of config.bones as Obj[]) if (typeof b.chain === 'string') out.set(b.chain, { name: b.chain, points: [...(b.points as Json[]).map((q) => q as unknown as [number, number]), b.tip as unknown as [number, number]] });
  return out;
}

/** Every outline edge longer than `cap` cut into equal pieces at most `cap` long (PR #286's (G′) construction). */
function capOutline(outline: readonly P2[], cap: number): P2[] {
  const out: P2[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    out.push(a);
    const k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cap);
    for (let j = 1; j < k; j++) out.push([snapU(a[0] + ((b[0] - a[0]) * j) / k), snapU(a[1] + ((b[1] - a[1]) * j) / k)]);
  });
  return out;
}

function insidePoly(p: P2, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function probeMeshes(config: Obj, arm0: string, ctx: PartCtx, T: number, S: number): ProbeMesh[] {
  const img = readPng(join(arm0, 'rig', 'images', ctx.att.image as string));
  const offset: P2 = [ctx.box.x - PAD, ctx.box.y - PAD];
  const toRig = (v: readonly number[]): P2 => [v[0] + offset[0], v[1] + offset[1]];
  const out: ProbeMesh[] = [{ name: `L (grid ${ctx.grid})`, note: 'the lattice as built', rig: ctx.rig, triangles: ctx.triangles, hull: ctx.hull }];
  for (const g of [S]) {
    const lm = latticeMesh(ctx.part, alphaAbove(img, ART_ALPHA), g);
    if ('code' in lm) throw new Error(`tear_survey: ${lm.code}`);
    out.push({ name: `LS (grid ${g})`, note: `the lattice at the figure's spacing`, rig: lm.vertices.map(toRig), triangles: lm.triangles, hull: lm.hull });
  }
  const alpha = new Uint8Array(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  const d = draftContourMesh(ctx.part, readPng(join(arm0, 'parts', `${ctx.part}.png`)), [ctx.box.x, ctx.box.y], o(o(config.meshes)[ctx.part]) as never, new Map(), T);
  if (d.mode === 'grid') throw new Error(`tear_survey: ${ctx.part} keeps the lattice at T ${T}: ${d.note}`);
  const stray = d.mesh.contour.stray;
  const traced = (spacing: number): { outline: P2[]; interior: P2[] } => {
    const params: ContourParams = { threshold: ART_ALPHA, tolerance: T, margin: T, spacing, regions: [], ...(stray === undefined ? {} : { stray }) };
    const cm = contourMesh(ctx.part, { width: img.width, height: img.height, alpha }, params);
    if (Array.isArray(cm)) throw new Error(`tear_survey: ${ctx.part} at T ${T} refused: ${cm.map((p) => p.code).join(', ')}`);
    return { outline: cm.vertices.slice(0, cm.hull).map((v) => [v[0], v[1]] as P2), interior: cm.vertices.slice(cm.hull).map((v) => [v[0], v[1]] as P2) };
  };
  const build = (name: string, note: string, outline: readonly P2[], interior: readonly P2[], lines: ReadonlyArray<readonly [P2, P2]> = []): ProbeMesh => {
    const pts: P2[] = [...outline, ...interior.filter((p) => insidePoly(p, outline))];
    const at = new Map(pts.map((p, i) => [`${p[0]},${p[1]}`, i]));
    const idx = (p: P2): number => {
      const i = at.get(`${p[0]},${p[1]}`);
      if (i === undefined) throw new Error(`tear_survey: a rib point (${p[0]}, ${p[1]}) is not a vertex`);
      return i;
    };
    const cons: Array<[number, number]> = [...outline.map((_, i) => [i, (i + 1) % outline.length] as [number, number]), ...lines.map(([a, b]) => [idx(a), idx(b)] as [number, number])];
    const tri = counterClockwiseInSpineWorld(cdt(pts, outline.length, cons));
    return { name, note, rig: pts.map(toRig), triangles: tri, hull: outline.length };
  };
  const g = traced(S);
  out.push(build(`G (T ${T}, interior ${S})`, "Stage D's (G): the traced outline, the contour mode's interior grid", g.outline, g.interior));
  out.push(build(`G' (edges <= ${S})`, "PR #286's (G′): (G)'s outline with every edge cut to at most S", capOutline(g.outline, S), g.interior));
  const half = Math.round(S / 2);
  out.push(build(`G' edges <= ${half}`, `(G′) with the outline's edges cut to at most S/2, the interior at S`, capOutline(g.outline, half), g.interior));
  const gi = traced(half);
  out.push(build(`G' interior ${half}`, `(G′) with the edges cut to at most S, the interior grid at S/2`, capOutline(gi.outline, S), gi.interior));
  out.push(build(`G' both ${half}`, `edges and interior at S/2`, capOutline(gi.outline, half), gi.interior));
  // (G′) + Stage B's draft ribs: the stations the draft settles on (lowered where the art refuses a rib), placed by the contour mode at S
  const chains = chainLines(config);
  const dr = draftContourMesh(ctx.part, readPng(join(arm0, 'parts', `${ctx.part}.png`)), [ctx.box.x, ctx.box.y], o(o(config.meshes)[ctx.part]) as never, chains, T);
  if (dr.mode === 'contour' && dr.mesh.ribs !== undefined) {
    const ribs = Object.entries(dr.mesh.ribs).map(([chain, r]) => ({ chain, points: (chains.get(chain) as ChainLine).points.map(([x, y]) => [x - offset[0], y - offset[1]] as [number, number]), stations: r.stations }));
    const params: ContourParams = { threshold: ART_ALPHA, tolerance: T, margin: T, spacing: S, regions: [], ...(stray === undefined ? {} : { stray }), ribs };
    const cm = contourMesh(ctx.part, { width: img.width, height: img.height, alpha }, params);
    if (Array.isArray(cm)) throw new Error(`tear_survey: ${ctx.part} with ribs refused: ${cm.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
    const V = cm.vertices.map((v) => [v[0], v[1]] as P2);
    const lines: Array<[P2, P2]> = [];
    for (const rb of cm.ribs ?? []) for (let i = 0; i + 1 < rb.vertices.length; i++) lines.push([V[rb.vertices[i]], V[rb.vertices[i + 1]]]);
    out.push(build(`G' + ribs`, `(G′) with Stage B's draft ribs, ${(cm.ribs ?? []).length} rows, each an edge the triangulation keeps; the draft: ${dr.note}`, capOutline(V.slice(0, cm.hull), S), V.slice(cm.hull), lines));
  } else throw new Error(`tear_survey: no ribs drafted on ${ctx.part}: ${dr.note}`);
  return out;
}

interface ProbeRow { mesh: string; note: string; triangles: number; hull: number; idleVsLattice: Record<string, number>; readings: Record<string, Record<string, { displacement: number; flipped: number; site: P2 | null; lattice: number | null; where: string }>> }

/** The probe: each mesh weighted by the rule (unrounded) and read against that rule's dense reference. */
export function probe(config: Obj, arm0: string, ctx: PartCtx, latG: Geometry, sk: Skeleton, T: number, S: number, sets: readonly string[]): ProbeRow[] {
  const meshes = probeMeshes(config, arm0, ctx, T, S);
  const png = join(arm0, 'parts', `${ctx.part}.png`);
  const rows: ProbeRow[] = meshes.map((m) => ({ mesh: m.name, note: m.note, triangles: m.triangles.length / 3, hull: m.hull, idleVsLattice: {}, readings: {} }));
  for (const rule of ['as built', 'lifted'] as const) {
    for (const set of ['idle', ...sets]) {
      const poses = set === 'idle' ? latG.frameBones : bendPoses(config, ctx.part, set === 'film').poses.map((t) => bentBones(sk, latG.setupBones, t));
      if (poses.length === 0) continue;
      const ref = referenceUnder(ctx, png, latG.setupBones, poses, rule);
      let latticePer: number[] | null = null;
      const carried: Array<{ rest: number[]; triangles: number[]; weights: WeightEntry[][] }> = [];
      meshes.forEach((m, k) => {
        const rest = m.rig.flatMap((p) => ctx.rigToWorld(p));
        const weights = m.rig.map((p) => {
          const w = ctx.rigToWorld(p);
          return ruleInfluences(rule, p, ctx.segs, ctx.r, ctx.exponent, ctx.ci, ctx.heat).map(({ bone, weight }) => {
            const [x, y] = local(latG.setupBones, bone, w);
            return { bone, x, y, weight };
          });
        });
        const per = perSample(rest, m.triangles, weights, ref, poses);
        if (k === 0) latticePer = per;
        carried.push({ rest, triangles: m.triangles, weights });
        if (set === 'idle') rows[k].idleVsLattice[rule] = k === 0 ? 0 : idleAgainst(carried[0], carried[k], poses);
        const rd = bendReading(rest, m.triangles, weights, ref, poses);
        let worst = -1;
        per.forEach((d, s) => {
          if (d >= 0 && (worst < 0 || d > per[worst])) worst = s;
        });
        const where = worst < 0 ? '' : siteText(ref.rig[worst], m, ctx, rule);
        rows[k].readings[rule] = { ...rows[k].readings[rule], [set]: { displacement: rd.displacement, flipped: rd.flipped, site: worst < 0 ? null : ref.rig[worst], lattice: worst < 0 || latticePer === null ? null : latticePer[worst], where } };
      });
    }
  }
  return rows;
}

/** Where a world point lies in a mesh: its triangle and barycentrics, or null. */
function locateIn(m: { rest: readonly number[]; triangles: readonly number[] }, p: P2): { t: number; u: number; w: number; z: number } | null {
  const v = m.rest;
  for (let t = 0; t < m.triangles.length; t += 3) {
    const [i, j, k] = [m.triangles[t] * 2, m.triangles[t + 1] * 2, m.triangles[t + 2] * 2];
    const det = (v[j + 1] - v[k + 1]) * (v[i] - v[k]) + (v[k] - v[j]) * (v[i + 1] - v[k + 1]);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((v[j + 1] - v[k + 1]) * (p[0] - v[k]) + (v[k] - v[j]) * (p[1] - v[k + 1])) / det;
    const w = ((v[k + 1] - v[i + 1]) * (p[0] - v[k]) + (v[i] - v[k]) * (p[1] - v[k + 1])) / det;
    if (u >= -1e-9 && w >= -1e-9 && 1 - u - w >= -1e-9) return { t, u, w, z: 1 - u - w };
  }
  return null;
}

/**
 * The idle's posed displacement of one mesh against another (`displacement`'s construction, tools/density_survey.ts):
 * every vertex and triangle centroid of either mesh that lies inside both, carried through both at every frame.
 */
function idleAgainst(a: { rest: number[]; triangles: number[]; weights: WeightEntry[][] }, b: { rest: number[]; triangles: number[]; weights: WeightEntry[][] }, frames: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>): number {
  const pts: P2[] = [];
  for (const m of [a, b]) {
    for (let i = 0; i < m.rest.length; i += 2) pts.push([m.rest[i], m.rest[i + 1]]);
    for (let t = 0; t < m.triangles.length; t += 3) {
      const [i, j, k] = [m.triangles[t] * 2, m.triangles[t + 1] * 2, m.triangles[t + 2] * 2];
      pts.push([(m.rest[i] + m.rest[j] + m.rest[k]) / 3, (m.rest[i + 1] + m.rest[j + 1] + m.rest[k + 1]) / 3]);
    }
  }
  const la = pts.map((p) => locateIn(a, p));
  const lb = pts.map((p) => locateIn(b, p));
  let worst = 0;
  for (const pose of frames) {
    const pa = a.weights.flatMap((ws) => skin(ws, pose));
    const pb = b.weights.flatMap((ws) => skin(ws, pose));
    const at = (posed: readonly number[], m: { triangles: readonly number[] }, l: { t: number; u: number; w: number; z: number }): P2 => {
      const [i, j, k] = [m.triangles[l.t] * 2, m.triangles[l.t + 1] * 2, m.triangles[l.t + 2] * 2];
      return [l.u * posed[i] + l.w * posed[j] + l.z * posed[k], l.u * posed[i + 1] + l.w * posed[j + 1] + l.z * posed[k + 1]];
    };
    pts.forEach((_, s) => {
      const x = la[s];
      const y = lb[s];
      if (x === null || y === null) return;
      const p = at(pa, a, x);
      const q = at(pb, b, y);
      worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
    });
  }
  return worst;
}

function distToSeg(p: P2, a: P2, b: P2): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/** Where a sample sits in a mesh: its distance to the outline and to the nearest vertex, and its top bone's weight at it and at its triangle's corners. */
function siteText(p: P2, m: ProbeMesh, ctx: PartCtx, rule: RuleName): string {
  const outline = m.rig.slice(0, m.hull);
  let toOutline = Infinity;
  for (let i = 0; i < outline.length; i++) toOutline = Math.min(toOutline, distToSeg(p, outline[i], outline[(i + 1) % outline.length]));
  let toVertex = Infinity;
  for (const v of m.rig) toVertex = Math.min(toVertex, Math.hypot(v[0] - p[0], v[1] - p[1]));
  const top = ruleInfluences(rule, p, ctx.segs, ctx.r, ctx.exponent, ctx.ci, ctx.heat)[0];
  const wOf = (q: P2): number => ruleInfluences(rule, q, ctx.segs, ctx.r, ctx.exponent, ctx.ci, ctx.heat).find((e) => e.bone === top.bone)?.weight ?? 0;
  let corners = '—';
  for (let t = 0; t < m.triangles.length; t += 3) {
    const [a, b, c] = [m.rig[m.triangles[t]], m.rig[m.triangles[t + 1]], m.rig[m.triangles[t + 2]]];
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(det) < 1e-12) continue;
    const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
    const w = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
    if (u < -1e-9 || w < -1e-9 || 1 - u - w < -1e-9) continue;
    corners = [m.triangles[t], m.triangles[t + 1], m.triangles[t + 2]].map((i) => `${i < m.hull ? 'outline' : 'interior'} ${wOf(m.rig[i]).toFixed(2)}`).join(', ');
    break;
  }
  return `${toOutline.toFixed(1)} px in from the outline, ${toVertex.toFixed(1)} px from a vertex; ${top.bone} ${top.weight.toFixed(2)} there, at its triangle's corners ${corners}`;
}

/** Each reference sample's largest distance from where the mesh carries it, over the poses; -1 outside the mesh. */
function perSample(rest: readonly number[], triangles: readonly number[], weights: readonly WeightEntry[][], ref: Reference, poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>): number[] {
  const tri: Array<[number, number, number]> = [];
  for (let t = 0; t < triangles.length; t += 3) tri.push([triangles[t], triangles[t + 1], triangles[t + 2]]);
  const loc = ref.samples.map((p) => {
    for (let t = 0; t < tri.length; t++) {
      const [i, j, k] = tri[t].map((x) => x * 2);
      const det = (rest[j + 1] - rest[k + 1]) * (rest[i] - rest[k]) + (rest[k] - rest[j]) * (rest[i + 1] - rest[k + 1]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((rest[j + 1] - rest[k + 1]) * (p[0] - rest[k]) + (rest[k] - rest[j]) * (p[1] - rest[k + 1])) / det;
      const w = ((rest[k + 1] - rest[i + 1]) * (p[0] - rest[k]) + (rest[i] - rest[k]) * (p[1] - rest[k + 1])) / det;
      if (u >= -1e-9 && w >= -1e-9 && 1 - u - w >= -1e-9) return { t, u, w, z: 1 - u - w };
    }
    return null;
  });
  const per = new Array<number>(ref.samples.length).fill(-1);
  poses.forEach((pose, k) => {
    const posed = weights.flatMap((ws) => skin(ws, pose));
    loc.forEach((l, s) => {
      if (l === null) return;
      const [i, j, q] = tri[l.t].map((x) => x * 2);
      const x = l.u * posed[i] + l.w * posed[j] + l.z * posed[q];
      const y = l.u * posed[i + 1] + l.w * posed[j + 1] + l.z * posed[q + 1];
      per[s] = Math.max(per[s], Math.hypot(x - ref.posed[k][s][0], y - ref.posed[k][s][1]));
    });
  });
  return per;
}

// ---------------------------------------------------------------------------
// Stage B: who claims a point
// ---------------------------------------------------------------------------

/** A bone claims a sample when its raw weight is at least this share of the sample's largest. Fixed before the run. */
export const CLAIM_SHARE = 0.1;

/** A sample with this many claimants or more is the census's case. */
export const CLAIM_COUNT = 5;

export interface ChainInfo { chainOf: Map<string, string>; parentOf: Map<string, string> }

/** Every chain link's chain, and the bone each chain hangs from, read off `config.bones`. */
export function chainInfo(config: Obj): ChainInfo {
  const chainOf = new Map<string, string>();
  const parentOf = new Map<string, string>();
  const chains = new Map<string, Obj>();
  for (const b0 of config.bones as Obj[]) if (typeof b0.chain === 'string') chains.set(b0.chain, b0);
  for (const [name, b] of chains) {
    parentOf.set(name, b.parent as string);
    const n = (b.points as Json[]).length;
    for (let i = 0; i < n; i++) chainOf.set(`${name}${i}`, name);
  }
  return { chainOf, parentOf };
}

/** A claimant's relation to the sample's largest bone. */
export function relation(bone: string, top: string, ci: ChainInfo): string {
  if (bone === top) return 'itself';
  const cb = ci.chainOf.get(bone);
  const ct = ci.chainOf.get(top);
  if (ct !== undefined) {
    if (cb === ct) return 'its own chain';
    if (cb === undefined) return bone === ci.parentOf.get(ct) ? 'the bone its chain hangs from' : 'a body segment';
    return ci.parentOf.get(cb) === ci.parentOf.get(ct) ? 'a sibling chain' : 'a chain hanging elsewhere';
  }
  if (cb === undefined) return 'a body segment';
  return ci.parentOf.get(cb) === top ? 'a chain hanging from it' : 'a chain hanging elsewhere';
}

export interface CensusPart { part: string; samples: number; many: number; byRelation: Record<string, number>; sets: Array<[string, number]>; nearest: { min: number; median: number } | null; stride: number }

/** The census of one part: every sample's claimants under the lifted rule. `codes` gets one code per sample (0: fewer than five; 1: five or more, another chain among them; 2: five or more, own chain, its parent and body segments only). */
export function census(ctx: { part: string; box: PartBox; segs: readonly Segment[]; r: number; exponent: number | undefined }, png: string, ci: ChainInfo, codes: Array<[number, number, number]>): CensusPart {
  const img = readPng(png);
  let art = 0;
  for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] > ART_ALPHA) art++;
  const stride = Math.max(1, Math.ceil(Math.sqrt(art / MAX_SAMPLES)));
  let samples = 0;
  let many = 0;
  const byRelation: Record<string, number> = {};
  const sets = new Map<string, number>();
  const near: number[] = [];
  for (let y = 0; y < img.height; y += stride) {
    for (let x = 0; x < img.width; x += stride) {
      if (img.data[(y * img.width + x) * 4 + 3] <= ART_ALPHA) continue;
      samples++;
      const rp: P2 = [ctx.box.x + x + 0.5, ctx.box.y + y + 0.5];
      const all = influences(rp, ctx.segs, ctx.r, ALL, ctx.exponent);
      const claim = all.filter((e) => e.weight >= CLAIM_SHARE * all[0].weight);
      if (claim.length < CLAIM_COUNT) {
        codes.push([rp[0], rp[1], 0]);
        continue;
      }
      many++;
      const rel = new Set(claim.map((e) => relation(e.bone, all[0].bone, ci)));
      for (const k of rel) byRelation[k] = (byRelation[k] ?? 0) + 1;
      const key = claim.map((e) => e.bone).join(', ');
      sets.set(key, (sets.get(key) ?? 0) + 1);
      let d = Infinity;
      for (const sg of ctx.segs) d = Math.min(d, distToSeg(rp, sg.a as P2, sg.b as P2));
      near.push(d);
      codes.push([rp[0], rp[1], rel.has('a sibling chain') || rel.has('a chain hanging elsewhere') ? 1 : 2]);
    }
  }
  near.sort((a, b) => a - b);
  return { part: ctx.part, samples, many, byRelation, sets: [...sets].sort((a, b) => b[1] - a[1]).slice(0, 3), nearest: near.length === 0 ? null : { min: near[0], median: near[Math.floor(near.length / 2)] }, stride };
}

/** Where a mesh folds: each inverted (triangle, pose), its centroid in rig px and its corners' largest bones. */
export function flipsOf(rest: readonly number[], rig: readonly P2[], triangles: readonly number[], weights: readonly WeightEntry[][], poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>): Array<{ pose: number; at: P2; corners: string[] }> {
  const out: Array<{ pose: number; at: P2; corners: string[] }> = [];
  const area = (v: readonly number[], t: number): number => {
    const [i, j, k] = [triangles[t] * 2, triangles[t + 1] * 2, triangles[t + 2] * 2];
    return (v[j] - v[i]) * (v[k + 1] - v[i + 1]) - (v[j + 1] - v[i + 1]) * (v[k] - v[i]);
  };
  poses.forEach((pose, k) => {
    const posed = weights.flatMap((ws) => skin(ws, pose));
    for (let t = 0; t < triangles.length; t += 3) {
      if (area(rest, t) * area(posed, t) > 0) continue;
      const c = [triangles[t], triangles[t + 1], triangles[t + 2]];
      out.push({ pose: k, at: [(rig[c[0]][0] + rig[c[1]][0] + rig[c[2]][0]) / 3, (rig[c[0]][1] + rig[c[1]][1] + rig[c[2]][1]) / 3], corners: c.map((i) => [...weights[i]].sort((a, b) => b.weight - a.weight).slice(0, 2).map((e) => `${e.bone} ${e.weight.toFixed(2)}`).join(' + ')) });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// one example
// ---------------------------------------------------------------------------

interface SetCensus { flipped: number; displacement: number; tears: Tears }
interface PartRow { part: string; changed: number; vertices: number; maxInfluences: number; sets: Record<string, SetCensus>; idle: number; boneSet: 'same' | string }
interface RuleRow { rule: RuleName; parts: PartRow[]; exit: number | null; check: Obj | null; checkLog: string[]; idleVsToday: { max: number; part: string | null }; rigBytes: number; maxInfluences: number; changed: number; vertices: number; valuesChanged: number }

export function runTears(key: string, configPath: string, inputs: string, work: string, film: boolean, requirements: string | null, picture: string | null, probePart: string | null, ruleList: readonly RuleName[] = RULE_NAMES): Obj {
  const config = o(readJ(configPath));
  const arm0 = join(work, 'arm0');
  const log = (s: string): void => void process.stderr.write(`[${key}] ${s}\n`);
  const reqArgs = requirements === null ? [] : ['--requirements', requirements];
  let latticeMs: number | null = null;
  if (!existsSync(join(arm0, 'check', 'build', 'skeleton.json'))) {
    log('lattice build');
    const t0 = performance.now();
    const r = stage(arm0, false, 'bun', [join(ROOT, 'cli.ts'), 'build', '--config', configPath, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', arm0, ...reqArgs]);
    latticeMs = Math.round(performance.now() - t0);
    if (r.exit !== 0) throw new Error(`tear_survey: the lattice did not build (exit ${r.exit})`);
  }
  const parts = partBoxes(join(arm0, 'parts.json'));
  const H = figureHeight(parts).height;
  const latG = renderGeometry(join(arm0, 'check', 'build'), join(work, 'render-L'));
  if (typeof latG === 'string') throw new Error(`tear_survey: the lattice did not render: ${latG}`);
  const sk = readSkeleton(join(arm0, 'check', 'build', 'skeleton.json'));
  const rigText = readFileSync(join(arm0, 'rig', 'rig.json'), 'utf8');
  const rig = o(JSON.parse(rigText) as Json);
  const sets = film ? ['fallback', 'film'] : ['fallback'];
  const ctxs: PartCtx[] = [];
  const kept: string[] = [];
  for (const name of Object.keys(o(config.meshes))) {
    const box = parts.find((p) => p.name === name);
    if (box === undefined) continue;
    const c = partCtx(config, arm0, rig, box, latG);
    if (typeof c === 'string') kept.push(`${name}: ${c}`);
    else ctxs.push(c);
  }
  // control: today's weights skinned here are the render's idle frames
  let skinControl = 0;
  for (const c of ctxs) {
    latG.frameBones.forEach((bones, f) => {
      const fr = latG.frames[f].get(c.part) as number[];
      c.original.forEach((ws, i) => {
        const p = skin(ws, bones);
        skinControl = Math.max(skinControl, Math.hypot(p[0] - fr[2 * i], p[1] - fr[2 * i + 1]));
      });
    });
  }
  if (skinControl > 1e-3) throw new Error(`tear_survey: control — today's weights skinned here are ${skinControl} from the render's idle frames`);
  // control: the as-built rule recomputed here is the build's, vertex by vertex
  let ruleControl = 0;
  for (const c of ctxs) {
    c.rig.forEach((p, i) => {
      const mine = roundShares(ruleInfluences('as built', p, c.segs, c.r, c.exponent));
      const theirs = c.original[i];
      if (mine.length !== theirs.length || mine.some((e, k) => e.bone !== theirs[k].bone)) throw new Error(`tear_survey: control — "${c.part}" vertex ${i} keeps other bones than the build`);
      mine.forEach((e, k) => (ruleControl = Math.max(ruleControl, Math.abs(e.weight - theirs[k].weight))));
    });
  }

  // Stage C: bone heat as the rig stage solves it, timed per part; a refusal is the part's finding, kept by name
  let heatBuild: Obj | null = null;
  if (ruleList.some(isHeat)) {
    for (const c of ctxs) {
      const img = readPng(join(arm0, 'rig', 'images', c.att.image as string));
      const [ox, oy] = [c.box.x - PAD, c.box.y - PAD];
      const t0 = performance.now();
      const f = boneHeat(`config.meshes.${c.part}`, latticeSilhouette(alphaAbove(img, ART_ALPHA)), c.segs, ox, oy);
      c.heatMs = Math.round(performance.now() - t0);
      if (Array.isArray(f)) c.heatRefused = f.map((x) => `${x.code}: ${x.detail}`).join('; ');
      else {
        c.heat = { field: f, ox, oy };
        c.heatIterations = f.iterations;
      }
    }
    // the shipped path: the real build with every lattice mesh at rule "heat"
    const cfg = JSON.parse(JSON.stringify(config)) as Obj;
    for (const m of Object.values(o(cfg.meshes))) if ('grid' in o(m)) o(m).rule = 'heat';
    const cdir = join(work, 'cfg-heat');
    mkdirSync(cdir, { recursive: true });
    for (const f of readdirSync(dirname(configPath))) {
      const q = join(dirname(configPath), f);
      if (f.endsWith('.json') && statSync(q).isFile()) copyFileSync(q, join(cdir, f));
    }
    writeFileSync(join(cdir, 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    const hdir = join(work, 'heat-build');
    log('heat: the real build');
    const t0 = performance.now();
    const hb = stage(hdir, false, 'bun', [join(ROOT, 'cli.ts'), 'build', '--config', join(cdir, 'config.json'), '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', hdir, ...reqArgs]);
    const ms = Math.round(performance.now() - t0);
    const refusals = hb.log.split('\n').filter((l) => /RIG_HEAT_[A-Z_]+/.test(l)).map((l) => l.trim().slice(0, 400));
    // control: the heat weights written here are the build's, entry for entry
    let control: string | null = null;
    if (hb.exit === 0) {
      const hr = o(o(o(readJ(join(hdir, 'rig', 'rig.json'))).skins).default);
      let worstW = 0;
      let worstXY = 0;
      let bonesDiffer = 0;
      for (const c of ctxs) {
        if (c.heat === null) continue;
        const theirs = (o(o(hr[c.part])[c.part]).weights as Json[]).map((row) => row as Obj[]);
        c.rig.forEach((_, i) => {
          const mine = writtenFor(c, i, 'heat', latG.setupBones).entry;
          const t = theirs[i];
          if (t.length !== mine.length || t.some((e, k) => e.bone !== mine[k].bone)) {
            bonesDiffer++;
            return;
          }
          mine.forEach((e, k) => {
            worstW = Math.max(worstW, Math.abs(e.weight - (t[k].weight as number)));
            worstXY = Math.max(worstXY, Math.abs(e.x - (t[k].x as number)), Math.abs(e.y - (t[k].y as number)));
          });
        });
      }
      control = `vertices whose bones differ ${bonesDiffer}; largest weight difference ${worstW}; largest offset difference ${worstXY.toExponential(1)}`;
    }
    heatBuild = { exit: hb.exit, ms, latticeMs, refusals: refusals as unknown as Json, control, check: existsSync(join(hdir, 'check', 'check.json')) ? (Object.fromEntries(BARS.map((b) => [b, barCell(o(readJ(join(hdir, 'check', 'check.json'))), b)])) as unknown as Json) : null };
  }
  const ci = chainInfo(config);
  const codes: Array<[number, number, number]> = [];
  const censusRows = ctxs.map((c) => census(c, join(arm0, 'parts', `${c.part}.png`), ci, codes));
  writeFileSync(join(work, `census-${key}.json`), JSON.stringify({ key, codes }));
  const flips: Record<string, unknown> = {};

  const rows: RuleRow[] = [];
  const pictures: Record<string, unknown> = {};
  for (const rule of ruleList) {
    log(`${rule}: census`);
    const written = ctxs.map((c) => c.rig.map((_, i) => writtenFor(c, i, rule, latG.setupBones)));
    const partRows: PartRow[] = [];
    let idleMax = 0;
    let idlePart: string | null = null;
    let valuesChanged = 0;
    ctxs.forEach((c, k) => {
      const W = written[k].map((x) => x.entry);
      written[k].forEach((x, i) => {
        if (!x.changed) return;
        const before = new Map(c.original[i].map((e) => [e.bone, e.weight]));
        const after = new Map(x.entry.map((e) => [e.bone, e.weight]));
        for (const b of new Set([...before.keys(), ...after.keys()])) if (before.get(b) !== after.get(b)) valuesChanged++;
      });
      // the idle against today's rig, vertex by vertex
      let partIdle = 0;
      latG.frameBones.forEach((bones) => {
        W.forEach((ws, i) => {
          const a = skin(ws, bones);
          const b = skin(c.original[i], bones);
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          partIdle = Math.max(partIdle, d);
          if (d > idleMax) [idleMax, idlePart] = [d, c.part];
        });
      });
      const setOf = (rows: readonly WeightEntry[][]): string[] => [...new Set(rows.flatMap((ws) => ws.map((e) => e.bone)))].sort();
      const [was, now] = [setOf(c.original), setOf(W)];
      const boneSet = was.join(',') === now.join(',') ? 'same' : `${[...was.filter((b) => !now.includes(b)).map((b) => `-${b}`), ...now.filter((b) => !was.includes(b)).map((b) => `+${b}`)].join(' ')}`;
      const png = join(arm0, 'parts', `${c.part}.png`);
      const census: Record<string, SetCensus> = {};
      for (const set of ['idle', ...sets]) {
        const poses = set === 'idle' ? latG.frameBones : bendPoses(config, c.part, set === 'film').poses.map((t) => bentBones(sk, latG.setupBones, t));
        if (poses.length === 0) continue;
        const ref = referenceUnder(c, png, latG.setupBones, poses, isHeat(rule) && c.heat === null ? 'as built' : rule);
        const rd = bendReading(c.rest, c.triangles, W, ref, poses);
        census[set] = { flipped: rd.flipped, displacement: rd.displacement, tears: tearsOf(ref) };
        if ((rule === 'as built' || rule === 'lifted' || isHeat(rule)) && set !== 'idle' && rd.flipped > 0) flips[`${rule}|${set}|${c.part}`] = flipsOf(c.rest, c.rig, c.triangles, W, poses);
        if (picture === c.part && set === (film ? 'film' : 'fallback')) {
          pictures[rule] = { uvsRig: c.rig, triangles: c.triangles, hull: c.hull, posed: poses.map((pose) => W.map((ws) => skin(ws, pose)).map((p) => worldToRigOf(c)(p))) };
        }
      }
      partRows.push({ part: c.part, changed: written[k].filter((x) => x.changed).length, vertices: c.rig.length, maxInfluences: Math.max(...W.map((ws) => ws.length)), sets: census, idle: partIdle, boneSet });
    });
    // the rig with the weights replaced, and the real check
    let exit: number | null = null;
    let check: Obj | null = null;
    let checkLog: string[] = [];
    let rigBytes = rigText.length;
    if (rule === 'as built') {
      exit = Number(readFileSync(`${arm0}.exit`, 'utf8'));
      check = existsSync(join(arm0, 'check', 'check.json')) ? o(readJ(join(arm0, 'check', 'check.json'))) : null;
    } else {
      const dir = join(work, `rule-${rule.replace(/ /g, '-')}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      cpSync(join(arm0, 'rig'), join(dir, 'rig'), { recursive: true });
      const out = o(JSON.parse(rigText) as Json);
      const skinD = o(o(out.skins).default);
      ctxs.forEach((c, k) => {
        const att = o(o(skinD[c.part])[c.part]);
        att.weights = written[k].map((x) => x.entry) as unknown as Json;
      });
      const text = rigJsonText(out);
      rigBytes = text.length;
      writeFileSync(join(dir, 'rig', 'rig.json'), text);
      log(`${rule}: check`);
      const rc = stage(join(dir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0, ...reqArgs]);
      exit = rc.exit;
      check = existsSync(join(dir, 'check', 'check.json')) ? o(readJ(join(dir, 'check', 'check.json'))) : null;
      checkLog = rc.log.split('\n').filter((l) => /FAIL|refus/i.test(l)).slice(0, 12).map((l) => l.trim().slice(0, 400));
    }
    rows.push({
      rule,
      parts: partRows,
      exit,
      check,
      checkLog,
      idleVsToday: { max: idleMax, part: idlePart },
      rigBytes,
      maxInfluences: Math.max(...partRows.map((p) => p.maxInfluences)),
      changed: partRows.reduce((s, p) => s + p.changed, 0),
      vertices: partRows.reduce((s, p) => s + p.vertices, 0),
      valuesChanged,
    });
  }
  let probeRows: ProbeRow[] | null = null;
  const T = outlineTolerance(H);
  const S = Math.round(H / GRID_DIVISOR);
  if (probePart !== null) {
    const c = ctxs.find((x) => x.part === probePart);
    if (c === undefined) throw new Error(`tear_survey: --probe "${probePart}" is not a lattice mesh of ${key}`);
    log(`probe ${probePart}`);
    probeRows = probe(config, arm0, c, latG, sk, T, S, sets);
  }
  if (picture !== null) writeFileSync(join(work, `tear-pictures-${picture}.json`), JSON.stringify({ box: ctxs.find((c) => c.part === picture)?.box, pad: PAD, set: film ? 'film' : 'fallback', rules: pictures }));
  return {
    key,
    sets,
    tear_px: TEAR_PX,
    tear_pair_px: TEAR_PAIR_PX,
    T,
    S,
    controls: { skin: skinControl, rule: ruleControl },
    kept,
    rules: rows.map((r) => ({ ...r, check: r.check === null ? null : (Object.fromEntries(BARS.map((b) => [b, barCell(r.check, b)])) as unknown as Json) })) as unknown as Json,
    probe: probeRows as unknown as Json,
    census: censusRows as unknown as Json,
    flips: flips as unknown as Json,
    claim: { share: CLAIM_SHARE, count: CLAIM_COUNT },
    heat: heatBuild === null ? null : ({ build: heatBuild, parts: ctxs.map((c) => ({ part: c.part, ms: c.heatMs, iterations: c.heatIterations, refused: c.heatRefused, vertices: c.rig.length })) } as unknown as Json),
  };
}

function worldToRigOf(c: PartCtx): (p: P2) => P2 {
  const world: P2[] = c.rig.map((p) => c.rigToWorld(p));
  return fitAffine(world, c.rig);
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const f2 = (v: number): string => v.toFixed(2);
const pt = (p: P2 | null): string => (p === null ? '—' : `(${f2(p[0])}, ${f2(p[1])})`);

export function renderTears(docs: Obj[]): string {
  const L: string[] = [];
  L.push(`Generated by \`tools/tear_survey.ts --page\`; every figure below is the tool's. A tear is a pair of reference samples at most ${TEAR_PAIR_PX} px apart at rest (4-neighbours on the dense reference's grid) whose posed distance exceeds their rest distance by more than ${TEAR_PX} rig px under some pose of the set, both skinned by the rule itself. "Inverted" counts a triangle once per pose it folds in (#265's convention). "Worst" is the largest distance between a sample carried by the written mesh and the same sample skinned by that rule, unrounded.`);
  for (const doc of docs) {
    const rules = doc.rules as unknown as Array<RuleRow & { check: Record<string, string> | null }>;
    const sets = ['idle', ...(doc.sets as string[])];
    L.push('');
    L.push(`## ${doc.key as string}`);
    L.push('');
    const c = o(doc.controls);
    L.push(`Controls: today's weights skinned here are within ${(c.skin as number).toExponential(1)} rig px of \`rigc render --geometry\`'s idle frames; the as-built rule recomputed here is within ${(c.rule as number).toExponential(1)} of every written weight. Meshes not in the census (their weights are kept): ${(doc.kept as string[]).length === 0 ? 'none' : (doc.kept as string[]).join('; ')}.`);
    L.push('');
    L.push(`| rule | ${sets.map((s) => `${s}: inverted / tears / worst`).join(' | ')} | largest influence count | vertices changed | weight values changed | rig.json bytes | check | ${BARS.join(' | ')} | idle vs today (part) |`);
    L.push(`| --- | ${sets.map(() => '---').join(' | ')} | ---: | ---: | ---: | ---: | --- | ${BARS.map(() => '---').join(' | ')} | --- |`);
    for (const r of rules) {
      const cell = (s: string): string => {
        const ps = r.parts.filter((p) => p.sets[s] !== undefined);
        const inv = ps.reduce((x, p) => x + p.sets[s].flipped, 0);
        const torn = ps.reduce((x, p) => x + p.sets[s].tears.torn, 0);
        const worst = ps.reduce((x, p) => Math.max(x, p.sets[s].displacement), 0);
        return `${inv} / ${torn} / ${f2(worst)}`;
      };
      L.push(`| ${r.rule} | ${sets.map(cell).join(' | ')} | ${r.maxInfluences} | ${r.changed} of ${r.vertices} | ${r.valuesChanged} | ${r.rigBytes} | ${r.exit === 0 ? 'PASS' : `exit ${String(r.exit)}`} | ${BARS.map((b) => (r.check === null ? '—' : r.check[b])).join(' | ')} | ${r.rule === 'as built' ? '—' : `${r.idleVsToday.max.toFixed(3)} (${r.idleVsToday.part ?? '—'})`} |`);
    }
    for (const r of rules) if (r.checkLog.length > 0) L.push(`- ${r.rule}, check: ${r.checkLog.map((x) => `\`${x}\``).join('; ')}`);
    if (rules.some((r) => r.parts.some((p) => typeof p.idle === 'number'))) {
      L.push('');
      L.push('Per part, the idle against today\'s rig (rig px) and whether the rule leaves the part\'s bone set as it is today (the bones it drops or adds when not):');
      L.push('');
      L.push(`| part | ${rules.filter((r) => r.rule !== 'as built').map((r) => r.rule).join(' | ')} |`);
      L.push(`| --- | ${rules.filter((r) => r.rule !== 'as built').map(() => '---').join(' | ')} |`);
      for (const p of rules[0].parts) L.push(`| ${p.part} | ${rules.filter((r) => r.rule !== 'as built').map((r) => {
        const q = r.parts.find((x) => x.part === p.part) as PartRow;
        return `${q.idle.toFixed(3)}${q.boneSet === 'same' ? '' : ` (bone set: ${q.boneSet})`}`;
      }).join(' | ')} |`);
    }
    const ht = doc.heat as unknown as { build: { exit: number; ms: number; latticeMs: number | null; refusals: string[]; control: string | null; check: Record<string, string> | null }; parts: Array<{ part: string; ms: number | null; iterations: number[] | null; refused: string | null; vertices: number }> } | null | undefined;
    if (ht !== undefined && ht !== null) {
      L.push('');
      L.push(`Bone heat as it ships: the real \`rig-parts build\` with every lattice mesh at \`rule: "heat"\` — exit ${ht.build.exit} in ${(ht.build.ms / 1000).toFixed(1)} s (the lattice build as tracked: ${ht.build.latticeMs === null ? '—' : `${(ht.build.latticeMs / 1000).toFixed(1)} s`})${ht.build.refusals.length === 0 ? '' : `, refused: ${ht.build.refusals.map((x) => `\`${x}\``).join('; ')}`}${ht.build.control === null ? '' : `; the heat weights written by this tool against that build's: ${ht.build.control}`}${ht.build.check === null ? '' : `; its bars: ${BARS.map((b) => `${b} ${(ht.build.check as Record<string, string>)[b]}`).join(', ')}`}. A part heat refuses keeps today's weights under both heat rules, and is named here. The solve, per part (this tool's own call of \`boneHeat\`, timed on the run's machine):`);
      L.push('');
      L.push('| part | vertices | heat | solve ms | sweeps per bone |');
      L.push('| --- | ---: | --- | ---: | --- |');
      for (const x of ht.parts) L.push(`| ${x.part} | ${x.vertices} | ${x.refused === null ? 'solved' : `refused — ${x.refused}`} | ${x.ms ?? '—'} | ${x.iterations === null ? '—' : x.iterations.join(', ')} |`);
    }
    const cs = doc.census as unknown as CensusPart[] | undefined;
    if (cs !== undefined) {
      const claim = o(doc.claim);
      L.push('');
      L.push(`The census: per lattice part, its art samples (the dense reference's grid), how many have ${String(claim.count)} or more claimants — bones whose raw weight is at least ${String(claim.share)} of the sample's largest — and, of those, how many count each relation to the sample's largest bone among their claimants; the nearest segment's distance (least, median); and the three commonest claimant lists.`);
      L.push('');
      L.push(`| part | samples | ${String(claim.count)}+ claimants | relations (samples having one) | nearest segment: least / median px | commonest lists |`);
      L.push('| --- | ---: | ---: | --- | --- | --- |');
      for (const c of cs) {
        if (c.many === 0) {
          L.push(`| ${c.part} | ${c.samples} | 0 | — | — | — |`);
          continue;
        }
        const rel = Object.entries(c.byRelation).filter(([k]) => k !== 'itself').sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('; ');
        L.push(`| ${c.part} | ${c.samples} | ${c.many} (${((100 * c.many) / c.samples).toFixed(1)} %) | ${rel} | ${c.nearest === null ? '—' : `${c.nearest.min.toFixed(1)} / ${c.nearest.median.toFixed(1)}`} | ${c.sets.map(([k, n]) => `${n}× ${k}`).join('; ')} |`);
      }
    }
    L.push('');
    L.push('Per part — inverted / tears (of them, pairs that keep different bones) / worst, under each rule:');
    L.push('');
    L.push(`| part | set | ${rules.map((r) => r.rule).join(' | ')} |`);
    L.push(`| --- | --- | ${rules.map(() => '---').join(' | ')} |`);
    for (const p of rules[0].parts) {
      for (const s of sets) {
        if (p.sets[s] === undefined) continue;
        L.push(`| ${p.part} | ${s} | ${rules.map((r) => {
          const x = (r.parts.find((q) => q.part === p.part) as PartRow).sets[s];
          return `${x.flipped} / ${x.tears.torn} (${x.tears.keptDiffers}) / ${f2(x.displacement)}`;
        }).join(' | ')} |`);
      }
    }
    L.push('');
    L.push('Largest tear per part and rule at the bend sets (posed gap beyond the rest distance, rig px, where):');
    L.push('');
    for (const p of rules[0].parts) {
      const items = rules.flatMap((r) => (doc.sets as string[]).flatMap((s) => {
        const x = (r.parts.find((q) => q.part === p.part) as PartRow).sets[s];
        return x === undefined ? [] : [`${r.rule} ${s} ${f2(x.tears.worst)} at ${pt(x.tears.at)}`];
      }));
      if (items.length > 0) L.push(`- ${p.part} (stride ${(rules[0].parts.find((q) => q.part === p.part) as PartRow).sets.idle?.tears.stride ?? '—'}): ${items.join('; ')}.`);
    }
    const pr = doc.probe as unknown as ProbeRow[] | null;
    if (pr !== null) {
      L.push('');
      L.push(`### The probe — alternative meshes of one part, weighted unrounded by the rule (T ${String(doc.T)}, S ${String(doc.S)})`);
      L.push('');
      const keys = Object.keys(pr[0].readings);
      const psets = Object.keys(pr[0].readings[keys[0]]);
      const idle = pr.every((r) => r.idleVsLattice !== undefined);
      L.push(`| mesh | triangles | hull | ${idle ? `${keys.map((k) => `${k}: idle vs the lattice`).join(' | ')} | ` : ''}${keys.flatMap((k) => psets.map((s) => `${k}, ${s}: worst / inverted (where; the lattice there)`)).join(' | ')} |`);
      L.push(`| --- | ---: | ---: | ${idle ? `${keys.map(() => '---:').join(' | ')} | ` : ''}${keys.flatMap(() => psets.map(() => '---')).join(' | ')} |`);
      for (const r of pr) L.push(`| ${r.mesh} | ${r.triangles} | ${r.hull} | ${idle ? `${keys.map((k) => (r.idleVsLattice[k] ?? 0).toFixed(3)).join(' | ')} | ` : ''}${keys.flatMap((k) => psets.map((s) => {
        const x = r.readings[k][s];
        return `${f2(x.displacement)} / ${x.flipped} (${pt(x.site)}; ${x.lattice === null ? '—' : x.lattice < 0 ? 'outside' : f2(x.lattice)})`;
      })).join(' | ')} |`);
      L.push('');
      for (const r of pr) {
        L.push(`- **${r.mesh}** — ${r.note}.`);
        for (const k of keys) for (const s of psets) L.push(`  - ${k}, ${s}: the worst sample ${r.readings[k][s].where}.`);
      }
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
    process.stdout.write(renderTears(argv.slice(argv.indexOf('--page') + 1).map((f) => o(readJ(f)))));
    return;
  }
  const [key, config, inputs, work, out] = [flag('--key'), flag('--config'), flag('--inputs'), flag('--work'), flag('--out')];
  if (!argv.includes('--run') || key === null || config === null || inputs === null || work === null || out === null) {
    console.error('usage: tear_survey --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] [--picture <part>] [--probe <part>] [--rules <a,b,…>] --out <doc.json> | --page <doc.json>…');
    process.exit(2);
  }
  const req = flag('--requirements');
  const rl = flag('--rules');
  const ruleList = rl === null ? RULE_NAMES : rl.split(',').map((x) => {
    const r = ALL_RULES.find((n) => n === x.trim());
    if (r === undefined) {
      console.error(`tear_survey: --rules names "${x}"; one of ${ALL_RULES.join(', ')} is required`);
      process.exit(2);
    }
    return r;
  });
  // a file, not stdout: a large write to a redirected stdout was cut at 64 KiB on Nova's bun
  writeFileSync(resolve(out), `${JSON.stringify(runTears(key, resolve(config), resolve(inputs), resolve(work), argv.includes('--film'), req === null ? null : resolve(req), flag('--picture'), flag('--probe'), ruleList))}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
