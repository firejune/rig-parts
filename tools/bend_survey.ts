#!/usr/bin/env bun
/**
 * Issue #265 Stage C on the bend set: every mesh a part can be drafted to, posed beside the idle at a bend of its
 * chains, against a reference denser than any of them — and Stage C's insertion held to the idle and the bend at once.
 *
 *     bun tools/density_survey.ts --run --key <k> --config <cfg> --inputs <dir> --insert --work <W>   # arm 0, Stage B, Stage C at the idle
 *     bun tools/auto_policy_survey.ts --run --example <k> --arm base --evidence <E> [--trailer <dir>] # auto base, kept under <E>/<k>-base
 *     bun tools/bend_survey.ts --run --key <k> --config <cfg> --work <W> --evidence <E> [--film] [--requirements <r>] > <k>.json
 *     bun tools/bend_survey.ts --page <k>.json… > docs/evidence/density-bend.md
 *
 * **The bend set** ({@link bendPoses}): for each part, every link of every chain its segments name turned by +θ
 * about its own joint, each link on top of its parent's (the chain curls), and the same at −θ — two poses. The
 * drafted θ is {@link FALLBACK_DEGREES}: the amplitude a part's own physics constraint can reach is not derivable
 * from the constraint (it bounds nothing; the swing is what the motion driving it makes), so the fallback is used and
 * said. `--film` (the trailer) also runs the bends HQ measured on the trailer film ({@link FILM_DEGREES}); a chain
 * that list does not name takes the fallback there too. A part with no chain has no bend and no row.
 *
 * **The reference** ({@link referenceField}) is denser than the lattice: the part's art sampled at every
 * `stride`-th pixel centre (stride = the least whole number keeping a part at or under {@link MAX_SAMPLES}), each
 * sample skinned by the part's own weight rule evaluated at that point — `influences` at its `r`, segments and
 * exponent, bound in each bone's setup frame — the limit a mesh approaches as it is refined.
 *
 * **What is read per mesh and pose** ({@link bendReading}): the largest distance between a sample carried by the
 * mesh (its setup triangle's barycentrics on the posed vertices) and the reference's own pose of it; the triangles
 * whose signed area flips or vanishes; and the stretch, the largest of r and 1/r over every triangle edge, r its
 * posed length over its setup length (`check`'s TEXTURE_STRETCH reads edge ratios too, over the idle; this is the
 * same quantity at the bend). Every mesh is read off its build's own `skeleton.json` and `rigc render --geometry`.
 *
 * **Stage C on idle ∪ bend** ({@link stageCBend}): Stage C's insertion (`insertRig`, tools/density_survey.ts) with a
 * second criterion — after the idle bound (1.0 rig px against the lattice) holds, a part whose bend reading is worse
 * than the lattice's own at that θ (displacement above it, or more flipped triangles) takes its next vertex at its
 * worst bend sample at least {@link BEND_SITE_PX} px from every vertex; an insertion that worsens the idle above its
 * bound or adds a flipped triangle is undone — then the real `rig-parts check`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ART_ALPHA } from '../src/mesh.ts';
import { readPng } from '../src/raster/index.ts';
import { DEFAULT_LIMITS, type InfluenceLimits, influences, type Segment } from '../src/weights.ts';
import {
  type ArmResult,
  BARS,
  barCell,
  type BoneMatrix,
  type ExtraCriterion,
  fitAffine,
  type Geometry,
  INSERT_CAP,
  insertRig,
  type Json,
  type Obj,
  type InsertPart,
  measured,
  overdrawOf,
  type P2,
  type PartBox,
  partBoxes,
  readGeometry,
  renderGeometry,
  resolveSegments,
  seamCell,
  skin,
  stage,
  type WeightEntry,
} from './density_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The drafted bend when nothing better is derivable, degrees per link (HQ's stated fallback). */
export const FALLBACK_DEGREES = 15;

/** The trailer film's measured bends, degrees per link, by chain (HQ's table on #265; the waving sleeve is sleeve_r). */
export const FILM_DEGREES: Readonly<Record<string, number>> = { skirt_r: 24, skirt_c: 24, skirt_l: 24, leg: 12, tail_r: 10, tail_l: 10, bang_r: 9, bang_c: 9, bang_l: 9, sleeve_r: 32 };

/** A bend insertion site keeps at least this far (rig px) from every vertex of the candidate. */
export const BEND_SITE_PX = 4;

/** The most reference samples per part. */
export const MAX_SAMPLES = 20000;

const obj = (v: Json | undefined): Obj => v as Obj;
const read = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;

// ---------------------------------------------------------------------------
// a build's meshes, off its skeleton.json
// ---------------------------------------------------------------------------

export interface SkelMesh { triangles: number[]; weights: WeightEntry[][] }
export interface Skeleton { bones: Array<{ name: string; parent: string | null }>; meshes: Map<string, SkelMesh> }

/** The bones (parents first, as Spine writes them) and every weighted mesh of a compiled skeleton. */
export function readSkeleton(path: string): Skeleton {
  const s = obj(read(path));
  const bones = (s.bones as Obj[]).map((b) => ({ name: b.name as string, parent: (b.parent as string | undefined) ?? null }));
  const meshes = new Map<string, SkelMesh>();
  for (const skin0 of s.skins as Obj[]) {
    for (const [slot, atts] of Object.entries(obj(skin0.attachments))) {
      for (const a0 of Object.values(obj(atts))) {
        const a = obj(a0);
        if (a.type !== 'mesh') continue;
        const uvs = a.uvs as number[];
        const v = a.vertices as number[];
        if (v.length === uvs.length) continue; // unweighted: not a mesh this package writes
        const weights: WeightEntry[][] = [];
        let i = 0;
        while (i < v.length) {
          const n = v[i++];
          const row: WeightEntry[] = [];
          for (let k = 0; k < n; k++) {
            row.push({ bone: bones[v[i]].name, x: v[i + 1], y: v[i + 2], weight: v[i + 3] });
            i += 4;
          }
          weights.push(row);
        }
        meshes.set(slot, { triangles: a.triangles as number[], weights });
      }
    }
  }
  return { bones, meshes };
}

// ---------------------------------------------------------------------------
// the bend
// ---------------------------------------------------------------------------

type Affine = [number, number, number, number, number, number]; // a b c d tx ty: (x, y) -> (a x + b y + tx, c x + d y + ty)
const I: Affine = [1, 0, 0, 1, 0, 0];
const compose = (p: Affine, q: Affine): Affine => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3], p[0] * q[4] + p[1] * q[5] + p[4], p[2] * q[4] + p[3] * q[5] + p[5]];
const rotAbout = (deg: number, o: P2): Affine => {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [c, -s, s, c, o[0] - c * o[0] + s * o[1], o[1] - s * o[0] - c * o[1]];
};

/** Every bone's world transform with `turn` (degrees, by bone) applied about each turned bone's setup joint, a child carried by its parent's turn. */
export function bentBones(sk: Skeleton, setup: ReadonlyMap<string, BoneMatrix>, turn: ReadonlyMap<string, number>): Map<string, BoneMatrix> {
  const D = new Map<string, Affine>();
  const out = new Map<string, BoneMatrix>();
  for (const b of sk.bones) {
    const parent = b.parent === null ? I : (D.get(b.parent) as Affine);
    const m = setup.get(b.name) as BoneMatrix;
    const t = turn.get(b.name) ?? 0;
    const d = t === 0 ? parent : compose(parent, rotAbout(t, [m.x, m.y]));
    D.set(b.name, d);
    out.set(b.name, { a: d[0] * m.a + d[1] * m.c, b: d[0] * m.b + d[1] * m.d, c: d[2] * m.a + d[3] * m.c, d: d[2] * m.b + d[3] * m.d, x: d[0] * m.x + d[1] * m.y + d[4], y: d[2] * m.x + d[3] * m.y + d[5] });
  }
  return out;
}

/** The chains a part's segments name. */
function chainsOf(config: Obj, part: string): Array<{ chain: string; links: string[] }> {
  const segs = resolveSegments(config, part);
  const chains = new Map<string, string[]>();
  for (const sg of segs) {
    const m = /^(.*?)(\d+)$/.exec(sg.bone);
    const chain = (config.bones as Obj[]).find((b) => m !== null && b.chain === m[1]);
    if (m === null || chain === undefined) continue;
    const list = chains.get(m[1]) ?? [];
    list.push(sg.bone);
    chains.set(m[1], list);
  }
  return [...chains].map(([chain, links]) => ({ chain, links }));
}

/** The two bend poses of a part — every link of every chain at +θ, then at −θ — and the θ each chain took. */
export function bendPoses(config: Obj, part: string, film: boolean): { poses: Array<Map<string, number>>; degrees: Record<string, number> } {
  const degrees: Record<string, number> = {};
  const plus = new Map<string, number>();
  const minus = new Map<string, number>();
  for (const c of chainsOf(config, part)) {
    const th = film ? (FILM_DEGREES[c.chain] ?? FALLBACK_DEGREES) : FALLBACK_DEGREES;
    degrees[c.chain] = th;
    for (const l of c.links) {
      plus.set(l, th);
      minus.set(l, -th);
    }
  }
  return { poses: plus.size === 0 ? [] : [plus, minus], degrees };
}

// ---------------------------------------------------------------------------
// the reference and the reading
// ---------------------------------------------------------------------------

export interface Reference { samples: P2[]; posed: P2[][]; stride: number }

/**
 * The reference for one part: its art's pixel centres (alpha above 8) at `stride` in setup world, each skinned by the
 * part's own rule at that point under every pose. `rigToWorld` carries rig px to setup world (fitted off a mesh of the
 * part: rig px = image px + the padded box origin).
 */
export function referenceField(config: Obj, part: string, image: string, box: PartBox, rigToWorld: (p: P2) => P2, setup: ReadonlyMap<string, BoneMatrix>, poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>, limits: InfluenceLimits = DEFAULT_LIMITS): Reference {
  const img = readPng(image);
  let art = 0;
  for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] > ART_ALPHA) art++;
  const stride = Math.max(1, Math.ceil(Math.sqrt(art / MAX_SAMPLES)));
  const mesh = obj(obj(config.meshes)[part]);
  const r = mesh.r as number;
  const exponent = typeof mesh.exponent === 'number' ? mesh.exponent : undefined;
  const segs: Segment[] = resolveSegments(config, part).map((sg) => ({ bone: sg.bone, a: sg.a, b: sg.b }));
  const samples: P2[] = [];
  const posed: P2[][] = poses.map(() => []);
  for (let y = 0; y < img.height; y += stride) {
    for (let x = 0; x < img.width; x += stride) {
      if (img.data[(y * img.width + x) * 4 + 3] <= ART_ALPHA) continue;
      const rp: P2 = [box.x + x + 0.5, box.y + y + 0.5];
      const w = rigToWorld(rp);
      const ws = influences(rp, segs, r, limits, exponent).map(({ bone, weight }) => {
        const m = setup.get(bone) as BoneMatrix;
        const det = m.a * m.d - m.b * m.c;
        const [dx, dy] = [w[0] - m.x, w[1] - m.y];
        return { bone, x: (m.d * dx - m.b * dy) / det, y: (-m.c * dx + m.a * dy) / det, weight };
      });
      samples.push(w);
      poses.forEach((pose, k) => posed[k].push(skin(ws, pose)));
    }
  }
  return { samples, posed, stride };
}

/** A triangle grid over the setup positions, for locating samples. */
class TriGrid {
  private readonly cells = new Map<string, number[]>();
  private readonly size: number;
  constructor(private readonly v: readonly number[], private readonly tri: readonly number[], size = 16) {
    this.size = size;
    for (let t = 0; t < tri.length; t += 3) {
      const xs = [v[tri[t] * 2], v[tri[t + 1] * 2], v[tri[t + 2] * 2]];
      const ys = [v[tri[t] * 2 + 1], v[tri[t + 1] * 2 + 1], v[tri[t + 2] * 2 + 1]];
      for (let gx = Math.floor(Math.min(...xs) / size); gx <= Math.floor(Math.max(...xs) / size); gx++) {
        for (let gy = Math.floor(Math.min(...ys) / size); gy <= Math.floor(Math.max(...ys) / size); gy++) {
          const k = `${gx},${gy}`;
          const l = this.cells.get(k) ?? [];
          l.push(t);
          this.cells.set(k, l);
        }
      }
    }
  }
  locate(px: number, py: number): { t: number; u: number; w: number; z: number } | null {
    const v = this.v;
    const tri = this.tri;
    for (const t of this.cells.get(`${Math.floor(px / this.size)},${Math.floor(py / this.size)}`) ?? []) {
      const [i, j, k] = [tri[t] * 2, tri[t + 1] * 2, tri[t + 2] * 2];
      const det = (v[j + 1] - v[k + 1]) * (v[i] - v[k]) + (v[k] - v[j]) * (v[i + 1] - v[k + 1]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((v[j + 1] - v[k + 1]) * (px - v[k]) + (v[k] - v[j]) * (py - v[k + 1])) / det;
      const w = ((v[k + 1] - v[i + 1]) * (px - v[k]) + (v[i] - v[k]) * (py - v[k + 1])) / det;
      const z = 1 - u - w;
      if (u >= -1e-9 && w >= -1e-9 && z >= -1e-9) return { t, u, w, z };
    }
    return null;
  }
}

export interface BendReading { displacement: number; site: P2 | null; flipped: number; stretch: number; samples: number; outside: number }

/**
 * One mesh at the bend: `rest` its setup vertices (world, flat), `weights` per vertex, `poses` the bent bones.
 * `near`, when given, keeps a sample from being named the site when it is already a vertex.
 */
export function bendReading(rest: readonly number[], triangles: readonly number[], weights: readonly WeightEntry[][], ref: Reference, poses: ReadonlyArray<ReadonlyMap<string, BoneMatrix>>, near: ((p: P2) => boolean) | null = null): BendReading {
  const grid = new TriGrid(rest, triangles);
  const located = ref.samples.map((p) => grid.locate(p[0], p[1]));
  let displacement = 0;
  let site: P2 | null = null;
  let siteD = -1;
  let flipped = 0;
  let stretch = 1;
  const area = (v: readonly number[], t: number): number => {
    const [i, j, k] = [triangles[t] * 2, triangles[t + 1] * 2, triangles[t + 2] * 2];
    return (v[j] - v[i]) * (v[k + 1] - v[i + 1]) - (v[j + 1] - v[i + 1]) * (v[k] - v[i]);
  };
  poses.forEach((pose, k) => {
    const posed = weights.flatMap((ws) => skin(ws, pose));
    located.forEach((l, s) => {
      if (l === null) return;
      const [i, j, q] = [triangles[l.t] * 2, triangles[l.t + 1] * 2, triangles[l.t + 2] * 2];
      const x = l.u * posed[i] + l.w * posed[j] + l.z * posed[q];
      const y = l.u * posed[i + 1] + l.w * posed[j + 1] + l.z * posed[q + 1];
      const d = Math.hypot(x - ref.posed[k][s][0], y - ref.posed[k][s][1]);
      if (d > displacement) displacement = d;
      if (d > siteD && (near === null || !near(ref.samples[s]))) [siteD, site] = [d, ref.samples[s]];
    });
    for (let t = 0; t < triangles.length; t += 3) {
      const a0 = area(rest, t);
      const a1 = area(posed, t);
      if (a0 * a1 <= 0) flipped++;
      for (const [p, q] of [[t, t + 1], [t + 1, t + 2], [t + 2, t]] as const) {
        const [i, j] = [triangles[p] * 2, triangles[q] * 2];
        const l0 = Math.hypot(rest[j] - rest[i], rest[j + 1] - rest[i + 1]);
        const l1 = Math.hypot(posed[j] - posed[i], posed[j + 1] - posed[i + 1]);
        if (l0 > 0 && l1 > 0) stretch = Math.max(stretch, l1 / l0, l0 / l1);
      }
    }
  });
  return { displacement, site, flipped, stretch, samples: located.filter((l) => l !== null).length, outside: located.filter((l) => l === null).length };
}

// ---------------------------------------------------------------------------
// one example
// ---------------------------------------------------------------------------

interface MeshSource { name: string; dir: string; skeleton: string }

/** A build's geometry and skeleton, rendered once. */
function load(src: MeshSource, work: string): { g: Geometry; sk: Skeleton } | string {
  const g = renderGeometry(src.dir, join(work, `render-${src.name}`));
  if (typeof g === 'string') return g;
  return { g, sk: readSkeleton(src.skeleton) };
}

export function runBend(key: string, configPath: string, work: string, evidence: string, film: boolean, requirements: string | null): Obj {
  const config = obj(read(configPath));
  const arm0 = join(work, 'arm0');
  const parts = partBoxes(join(arm0, 'parts.json'));
  const sources: MeshSource[] = [
    { name: 'lattice', dir: join(arm0, 'check', 'build'), skeleton: join(arm0, 'check', 'build', 'skeleton.json') },
    { name: 'auto base', dir: join(evidence, `${key}-base`), skeleton: join(evidence, `${key}-base`, 'skeleton.json') },
    { name: 'Stage B', dir: join(work, 'draft', 'check', 'build'), skeleton: join(work, 'draft', 'check', 'build', 'skeleton.json') },
    { name: 'Stage C idle', dir: join(work, 'insert-1', 'check', 'build'), skeleton: join(work, 'insert-1', 'check', 'build', 'skeleton.json') },
  ];
  const loaded = new Map<string, { g: Geometry; sk: Skeleton }>();
  const errors: string[] = [];
  for (const s of sources) {
    if (!existsSync(s.skeleton)) {
      errors.push(`${s.name}: no build at ${s.dir}`);
      continue;
    }
    const l = load(s, work);
    if (typeof l === 'string') errors.push(`${s.name}: ${l}`);
    else loaded.set(s.name, l);
  }
  const lat = loaded.get('lattice');
  if (lat === undefined) throw new Error(`bend_survey: the lattice of ${key} did not load: ${errors.join('; ')}`);
  const sets = film ? ['fallback', 'film'] : ['fallback'];
  const meshParts = [...lat.sk.meshes.keys()];
  const draftCfgPath = join(work, 'draft-config.json');
  const draftCfg = existsSync(draftCfgPath) ? obj(read(draftCfgPath)) : config;
  const out: Obj[] = [];
  for (const set of sets) {
    const isFilm = set === 'film';
    const rows: Obj[] = [];
    const refs = new Map<string, { ref: Reference; poses: Array<Map<string, BoneMatrix>>; degrees: Record<string, number> }>();
    for (const part of meshParts) {
      const { poses: turns, degrees } = bendPoses(config, part, isFilm);
      if (turns.length === 0) continue;
      const box = parts.find((p) => p.name === part) as PartBox;
      const poses = turns.map((t) => bentBones(lat.sk, lat.g.setupBones, t));
      // rig px -> setup world off the lattice's own vertices (uv px + the padded box origin)
      const restL = lat.g.setup.get(part) as number[];
      const att = obj(obj(obj(obj(read(join(arm0, 'rig', 'rig.json'))).skins).default)[part])[part] as Obj;
      const uvs = att.uvs as number[];
      const rigPts: P2[] = [];
      const worldPts: P2[] = [];
      for (let i = 0; i < uvs.length; i += 2) {
        rigPts.push([uvs[i] * (att.width as number) + box.x - 4, uvs[i + 1] * (att.height as number) + box.y - 4]);
        worldPts.push([restL[i], restL[i + 1]]);
      }
      const ref = referenceField(config, part, join(arm0, 'parts', `${part}.png`), box, fitAffine(rigPts, worldPts), lat.g.setupBones, poses);
      refs.set(part, { ref, poses, degrees });
      const cells: Obj = {};
      for (const [name, l] of loaded) {
        const m = l.sk.meshes.get(part);
        const rest = l.g.setup.get(part);
        if (m === undefined || rest === undefined) continue;
        const posesHere = turns.map((t) => bentBones(l.sk, l.g.setupBones, t));
        const r = bendReading(rest, m.triangles, m.weights, ref, posesHere);
        cells[name] = { displacement: r.displacement, flipped: r.flipped, stretch: r.stretch, triangles: m.triangles.length / 3, samples: r.samples, outside: r.outside };
      }
      rows.push({ part, degrees: degrees as Json, stride: ref.stride, samples: ref.samples.length, cells });
    }
    // Stage C on idle ∪ bend: the lattice's own reading is the bound
    let stageC: Obj | null = null;
    const draftDir = join(work, 'draft');
    if (existsSync(join(draftDir, 'check', 'build', 'skeleton.json'))) {
      const draftG = readGeometry(join(work, 'render-Stage B', 'idle', 'geometry.json'));
      const base = readGeometry(join(work, 'render-lattice', 'idle', 'geometry.json'));
      // the parts Stage B turned from the lattice to contour (an author's own contour mesh is not one)
      const drafted = new Set(Object.entries(obj(draftCfg.meshes)).filter(([n, m]) => 'contour' in obj(m) && 'grid' in obj(obj(config.meshes)[n])).map(([n]) => n));
      const latBound = new Map<string, { displacement: number; flipped: number }>();
      for (const r of rows) {
        const c = obj(obj(r.cells).lattice);
        latBound.set(r.part as string, { displacement: c.displacement as number, flipped: c.flipped as number });
      }
      const dir = join(work, `insert-bend-${set}`);
      mkdirSync(dir, { recursive: true });
      const extraFor = (part: string): ExtraCriterion | null => {
        const rf = refs.get(part);
        const bound = latBound.get(part);
        if (rf === undefined || bound === undefined) return null;
        const sk = loaded.get('Stage B')?.sk ?? lat.sk;
        return (worldV, W, tri, near) => {
          const posesHere = [...rf.poses.keys()].map((k) => bentBones(sk, draftG.setupBones, bendPoses(config, part, isFilm).poses[k]));
          const rest = worldV.flat();
          // a bend site keeps BEND_SITE_PX from every vertex: a point closer makes a sliver, which the bend flips
          const far = (p: P2): boolean => near(p) || worldV.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < BEND_SITE_PX);
          const r = bendReading(rest, [...tri], W, rf.ref, posesHere, far);
          return { violated: r.displacement > bound.displacement || r.flipped > bound.flipped, site: r.site, value: r.displacement, flipped: r.flipped };
        };
      };
      const ins: InsertPart[] = insertRig(draftDir, join(dir, 'rig'), draftCfg, parts, draftG, base, 1.0, drafted, extraFor);
      const args = [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0];
      if (requirements !== null) args.push('--requirements', requirements);
      const rc = stage(join(dir, 'check'), false, 'bun', args);
      const mi = measured(`Stage C idle ∪ bend (${set})`, null, dir, { exit: rc.exit, log: rc.log.split('\n').map((l) => `[check] ${l}`).join('\n') }, [], base, [], true);
      // its bend reading, on its own build
      const built = existsSync(join(dir, 'check', 'build', 'skeleton.json')) ? load({ name: `Stage C bend ${set}`, dir: join(dir, 'check', 'build'), skeleton: join(dir, 'check', 'build', 'skeleton.json') }, work) : 'no build';
      if (typeof built !== 'string') {
        for (const r of rows) {
          const part = r.part as string;
          const m = built.sk.meshes.get(part);
          const rest = built.g.setup.get(part);
          const rf = refs.get(part);
          if (m === undefined || rest === undefined || rf === undefined) continue;
          const turns = bendPoses(config, part, isFilm).poses;
          const rd = bendReading(rest, m.triangles, m.weights, rf.ref, turns.map((t) => bentBones(built.sk, built.g.setupBones, t)));
          obj(r.cells)['Stage C idle ∪ bend'] = { displacement: rd.displacement, flipped: rd.flipped, stretch: rd.stretch, triangles: m.triangles.length / 3, samples: rd.samples, outside: rd.outside };
        }
      }
      stageC = { arm: mi.result as unknown as Json, insert: ins as unknown as Json, error: typeof built === 'string' ? built : null };
    }
    out.push({ set, rows: rows as Json, stageC });
  }
  return { key, cap: INSERT_CAP, fallback: FALLBACK_DEGREES, film: film ? (FILM_DEGREES as unknown as Json) : null, errors, sets: out as Json };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const fx = (v: number, n: number): string => v.toFixed(n);
const MESHES = ['lattice', 'auto base', 'Stage B', 'Stage C idle', 'Stage C idle ∪ bend'] as const;

export function renderBend(docs: Obj[]): string {
  const L: string[] = [];
  L.push('# The meshes at the bend set (issue #265, Stage C)');
  L.push('');
  L.push(`Generated by \`tools/bend_survey.ts --page\`; every figure is the tool's. The bend set: every link of every chain a part names turned by +θ about its joint (each on top of its parent's), and the same at −θ. θ is ${FALLBACK_DEGREES}° per link (the fallback: a physics constraint's reachable amplitude is not derivable from the constraint itself), and on the trailer also the film's measured bends (skirt 24°, legs 12°, long hair 10°, fringe 9°, the waving sleeve 32°; any other chain ${FALLBACK_DEGREES}°). The reference is denser than the lattice: the part's art at every stride-th pixel centre (at most ${MAX_SAMPLES} per part), each skinned by the part's own weight rule at that point. Per mesh and part: the largest displacement from the reference over both poses (rig px), the triangles whose signed area flips or vanishes, and the stretch (the largest r or 1/r over every triangle edge, r = posed over setup length). Stage C idle ∪ bend: Stage C's insertion with the bend held to the lattice's own reading per part (displacement no larger, no more flipped triangles than the lattice) once the idle's 1.0 px holds, each bend site at least ${BEND_SITE_PX} px from every vertex, and an insertion that worsens the idle above its bound, adds a flipped triangle or (a bend site) enlarges the bend reading undone and its site skipped; cap ${INSERT_CAP} insertions per part (and 4 × that many attempts).`);
  for (const doc of docs) {
    L.push('');
    L.push(`## ${doc.key as string}`);
    for (const set of doc.sets as Obj[]) {
      const rows = set.rows as Obj[];
      L.push('');
      L.push(`### bend set: ${set.set as string}`);
      L.push('');
      L.push(`| part | θ per chain | ${MESHES.map((m) => `${m}: tri, displacement, flipped, stretch`).join(' | ')} |`);
      L.push(`| --- | --- | ${MESHES.map(() => '---').join(' | ')} |`);
      for (const r of rows) {
        const cells = obj(r.cells);
        L.push(`| ${r.part as string} | ${Object.entries(obj(r.degrees)).map(([c, d]) => `${c} ${String(d)}°`).join(', ')} | ${MESHES.map((m) => {
          const c = cells[m] === undefined ? null : obj(cells[m]);
          return c === null ? '—' : `${String(c.triangles)}, ${fx(c.displacement as number, 2)}, ${String(c.flipped)}, ${fx(c.stretch as number, 3)}`;
        }).join(' | ')} |`);
      }
      const tot = (m: string, f: (c: Obj) => number): number => rows.reduce((x, r) => x + (obj(r.cells)[m] === undefined ? 0 : f(obj(obj(r.cells)[m]))), 0);
      const worst = (m: string): number => rows.reduce((x, r) => Math.max(x, obj(r.cells)[m] === undefined ? 0 : (obj(obj(r.cells)[m]).displacement as number)), 0);
      L.push(`| **chained parts** | | ${MESHES.map((m) => `${tot(m, (c) => c.triangles as number)}, worst ${fx(worst(m), 2)}, ${tot(m, (c) => c.flipped as number)} flipped`).join(' | ')} |`);
      const sc = set.stageC === null ? null : obj(set.stageC);
      if (sc !== null) {
        const a = sc.arm as unknown as ArmResult;
        const T = a.meshes.reduce((x, m) => x + m.triangles, 0);
        const od = overdrawOf(a.meshes);
        const d = [...a.displacement].sort((p, q) => q.max - p.max)[0];
        const ins = sc.insert as unknown as InsertPart[];
        L.push('');
        L.push(`Stage C idle ∪ bend (${set.set as string}), the whole figure: ${a.exit === 0 ? 'PASS' : `exit ${a.exit}`}; Σ triangles ${T}; overdraw ${od === null ? '—' : fx(od, 3)}; idle displacement vs the lattice ${d === undefined ? '—' : `${fx(d.max, 3)} (${d.slot})`}; inserted ${ins.reduce((x, r) => x + r.inserted, 0)} (${ins.filter((r) => r.inserted > 0).map((r) => `${r.part} ${r.inserted}`).join(', ') || 'none'}); at the insertion cap: ${ins.filter((r) => r.stopped === 'cap').map((r) => r.part).join(', ') || 'none'}; stopped with every further site undone: ${ins.filter((r) => r.stopped === 'attempts' || r.stopped === 'no site').map((r) => `${r.part} (${r.inserted} kept, ${r.rejected ?? 0} undone)`).join(', ') || 'none'}; time ${ins.reduce((x, r) => x + r.ms, 0)} ms.`);
        L.push('');
        L.push(`| ${BARS.join(' | ')} | seam |`);
        L.push(`| ${BARS.map(() => '---').join(' | ')} | --- |`);
        L.push(`| ${BARS.map((b) => barCell(a.check, b)).join(' | ')} | ${seamCell(a.check)} |`);
        for (const r of ins.filter((x) => x.inserted > 0)) L.push(`- ${r.part}: ${r.insertions.map((i) => `(${i.at[0]}, ${i.at[1]}) ${i.where}`).join('; ')}`);
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
    process.stdout.write(renderBend(argv.slice(argv.indexOf('--page') + 1).map((f) => obj(read(f)))));
    return;
  }
  const [key, config, work, evidence] = [flag('--key'), flag('--config'), flag('--work'), flag('--evidence')];
  if (!argv.includes('--run') || key === null || config === null || work === null || evidence === null) {
    console.error('usage: bend_survey --run --key <k> --config <cfg> --work <W> --evidence <E> [--film] [--requirements <r>] | --page <doc.json>…');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(runBend(key, resolve(config), resolve(work), resolve(evidence), argv.includes('--film'), flag('--requirements') === null ? null : resolve(flag('--requirements') as string)))}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
