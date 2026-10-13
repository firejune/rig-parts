#!/usr/bin/env bun
/**
 * Issue #284 Stage E: the influence cap itself. The distance rule keeps a vertex's four largest influences
 * (`MAX_INFLUENCES`, src/weights.ts) and drops any under 0.03 (`MIN_WEIGHT`). Stages A–D measured ways of making four
 * influences behave; this tool keeps today's falloff (`w = 1/(d + r)^e` with each mesh's own `r` and `exponent`) and
 * sweeps the cap. Nothing under `src/` changes; every mesh keeps the lattice it ships with.
 *
 *     bun tools/cap_survey.ts --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>]
 *         [--picture <part>,…] [--picture-set fallback|film] --out <k>.json
 *     bun tools/cap_survey.ts --time --key <k> --config <cfg> --inputs <dir> --work <W> [--requirements <r>] --repeat <n> --out <k>.json
 *     bun tools/cap_survey.ts --page <doc.json>… [--times <time.json>…]   # the measured half of docs/evidence/weight-cap.md
 *
 * **A setting** is a cap and a floor. The cap is one of {@link CAPS} ("none" keeps every bone the segments name). The
 * floor is one of {@link FLOORS}:
 *
 * - **as is** — `influences()` itself at `{ maxInfluences: cap, minWeight: 0.03 }`: the `cap` largest normalised, any
 *   under 0.03 dropped, normalised again (cap 4 is the call the rig stage makes today, and the control: it must change
 *   no vertex);
 * - **continuous** — Stage A's continuous floor at that cap: the `cap` largest normalised, 0.03 subtracted from every
 *   weight, clamped at zero, normalised (a weight reaches zero exactly where the floor would cut it; at cap 4 this is
 *   `ruleInfluences('continuous floor')` of tools/tear_survey.ts, which the run checks vertex by vertex).
 *
 * Beside them, **the lifted reference** (Stage A's): every bone, nothing dropped.
 *
 * **What a setting writes** (Stage A's `writtenFor`): a vertex whose influences are today's (the same bones, every
 * weight within 1e-12) keeps its rig.json entry byte for byte; any other is rounded as the lattice rounds (each weight
 * to 5 places, the last `1 − sum(others)`) when the floor is as is — every kept weight is then at least 0.03 — and as
 * the rig stage rounds a region's shares (`roundShares`: 0 dropped, the remainder to the heaviest) when it is
 * continuous or lifted, where a share can round to 0. A bone new to a vertex gets its offset in its setup frame.
 *
 * **What is read** — Stage D's columns, by the same functions: at the idle and at #265's bend sets (every link of every
 * chain the part names turned ±15°; the trailer also ±the film's bends), inverted triangles of the written lattice,
 * tears and the worst sample against the setting's own dense reference; every `check` bar by the real
 * `rig-parts check`; the largest influence count; the idle's posed displacement against today's rig; the census share
 * (it reads only the raw weights, so the cap cannot move it: it is read once). And **the cost**: bindings (one per
 * bone per vertex) per lattice mesh and in the whole rig.json, rig.json's length, and the compiled skeleton's length
 * (`skeleton.json` of the check's own build).
 *
 * `--time` measures the last cost column, the time `rigc render` takes on the idle: per setting the rig is written as
 * above and compiled as `check` compiles it (`rigc build … --profile rig-play --pack`), then the idle is rendered
 * `--repeat` times per setting in interleaved order, both as `check` renders it (`--geometry`) and as frames only. Wall
 * clock per call; this is the one figure here that is not deterministic, and it is run with no other job beside it.
 *
 * `--picture <part>,…` keeps those parts' meshes posed at a bend set under every setting: `--picture-set fallback|film`,
 * by default the film's when `--film` and the ±15° set otherwise.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_PACK_MODE, IDLE_MAX_PX, packedBuildArgs } from '../src/check.ts';
import { edgeLength } from '../src/length.ts';
import { IDLE_FPS } from '../src/motion.ts';
import { rigJsonText } from '../src/rig.ts';
import { DEFAULT_LIMITS, type Influence, influences, MIN_WEIGHT } from '../src/weights.ts';
import { bendPoses, bendReading, bentBones, readSkeleton } from './bend_survey.ts';
import { BARS, barCell, type BoneMatrix, type Json, type Obj, type P2, partBoxes, renderGeometry, skin, stage, type WeightEntry } from './density_survey.ts';
import {
  ALL,
  CLAIM_COUNT,
  CLAIM_SHARE,
  census,
  chainInfo,
  latticeRound,
  local,
  type PartCtx,
  partCtx,
  placesZ,
  referenceUnder,
  roundShares,
  ruleInfluences,
  sameInfluences,
  type Tears,
  tearsOf,
  worldToRigOf,
} from './tear_survey.ts';

const ROOT = resolve(import.meta.dir, '..');
const RIGC = join(ROOT, 'node_modules', '.bin', 'rigc');
const readJ = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const o = (v: Json | undefined): Obj => v as Obj;

/** The caps swept, stated before the run (the page's first section). */
export const CAPS = [4, 5, 6, 8, 'none'] as const;
type Cap = (typeof CAPS)[number];

/** The floors swept: the 0.03 cut as built, and Stage A's continuous floor. */
export const FLOORS = ['as is', 'continuous'] as const;
type Floor = (typeof FLOORS)[number] | 'lifted';

interface Setting { cap: Cap; floor: Floor }
const label = (s: Setting): string => (s.floor === 'lifted' ? 'lifted (reference)' : `cap ${s.cap}, floor ${s.floor}`);
const TODAY: Setting = { cap: 4, floor: 'as is' };
const LIFTED: Setting = { cap: 'none', floor: 'lifted' };
const capN = (c: Cap): number => (c === 'none' ? Number.MAX_SAFE_INTEGER : c);

function normalise(list: readonly Influence[]): Influence[] {
  let s = 0;
  for (const e of list) s += e.weight;
  return list.map((e) => ({ bone: e.bone, weight: e.weight / s }));
}

/** The influences at a rig-px point under a setting, unrounded, largest first, at the mesh's own `r` and exponent. */
export function capInfluences(c: PartCtx, p: P2, s: Setting): Influence[] {
  if (s.floor === 'as is') return influences(p, c.segs, c.r, { maxInfluences: capN(s.cap), minWeight: MIN_WEIGHT }, c.exponent);
  const all = influences(p, c.segs, c.r, ALL, c.exponent);
  if (s.floor === 'lifted') return all;
  const top = normalise(all.slice(0, capN(s.cap)));
  return normalise(top.map((e) => ({ bone: e.bone, weight: e.weight - MIN_WEIGHT })).filter((e) => e.weight > 0));
}

/** What a setting writes for one vertex; `changed` when it differs from the build's entry. */
function writtenFor(c: PartCtx, i: number, s: Setting, bones: ReadonlyMap<string, BoneMatrix>): { entry: WeightEntry[]; changed: boolean } {
  const p = c.rig[i];
  const mine = capInfluences(c, p, s);
  if (sameInfluences(influences(p, c.segs, c.r, DEFAULT_LIMITS, c.exponent), mine)) return { entry: c.original[i], changed: false };
  const w = c.rigToWorld(p);
  const entry = (s.floor === 'as is' ? latticeRound(mine) : roundShares(mine)).map(({ bone, weight }) => {
    const was = c.original[i].find((e) => e.bone === bone);
    if (was !== undefined) return { bone, x: was.x, y: was.y, weight };
    const [x, y] = local(bones, bone, w);
    return { bone, x: placesZ(x), y: placesZ(y), weight };
  });
  const o0 = c.original[i];
  const changed = entry.length !== o0.length || entry.some((e, k) => e.bone !== o0[k].bone || e.weight !== o0[k].weight || e.x !== o0[k].x || e.y !== o0[k].y);
  return { entry: changed ? entry : o0, changed };
}

/** Every setting in the page's order: today first, the lifted reference last. */
export function settings(): Setting[] {
  const out: Setting[] = [TODAY];
  for (const cap of CAPS) for (const floor of FLOORS) if (!(cap === 4 && floor === 'as is')) out.push({ cap, floor });
  out.push(LIFTED);
  return out;
}

/** Bindings in a whole rig: one per bone per vertex of every weighted attachment. */
function rigBindings(rig: Obj): number {
  let n = 0;
  for (const slot of Object.values(o(o(rig.skins).default))) {
    for (const att of Object.values(o(slot))) {
      const w = o(att).weights;
      if (Array.isArray(w)) for (const v of w) n += (v as Json[]).length;
    }
  }
  return n;
}

interface Ctxs { arm0: string; ctxs: PartCtx[]; kept: string[]; rigText: string; latG: Exclude<ReturnType<typeof renderGeometry>, string>; reqArgs: string[] }

function prepare(key: string, configPath: string, inputs: string, work: string, requirements: string | null): Ctxs {
  const config = o(readJ(configPath));
  const arm0 = join(work, 'arm0');
  const reqArgs = requirements === null ? [] : ['--requirements', requirements];
  if (!existsSync(join(arm0, 'check', 'build', 'skeleton.json'))) {
    process.stderr.write(`[${key}] lattice build\n`);
    const r = stage(arm0, false, 'bun', [join(ROOT, 'cli.ts'), 'build', '--config', configPath, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', arm0, ...reqArgs]);
    if (r.exit !== 0) throw new Error(`cap_survey: the lattice did not build (exit ${r.exit})`);
  }
  const boxes = partBoxes(join(arm0, 'parts.json'));
  const latG = renderGeometry(join(arm0, 'check', 'build'), join(work, 'render-L'));
  if (typeof latG === 'string') throw new Error(`cap_survey: the lattice did not render: ${latG}`);
  const rigText = readFileSync(join(arm0, 'rig', 'rig.json'), 'utf8');
  const rig = o(JSON.parse(rigText) as Json);
  const ctxs: PartCtx[] = [];
  const kept: string[] = [];
  for (const name of Object.keys(o(config.meshes))) {
    const box = boxes.find((p) => p.name === name);
    if (box === undefined) continue;
    const c = partCtx(config, arm0, rig, box, latG);
    if (typeof c === 'string') kept.push(`${name}: ${c}`);
    else ctxs.push(c);
  }
  return { arm0, ctxs, kept, rigText, latG, reqArgs };
}

/** rig.json with every lattice mesh's weights replaced by what `s` writes. */
function rigFor(x: Ctxs, written: WeightEntry[][][]): { text: string; rig: Obj } {
  const out = o(JSON.parse(x.rigText) as Json);
  const skinD = o(o(out.skins).default);
  x.ctxs.forEach((c, k) => {
    o(o(skinD[c.part])[c.part]).weights = written[k] as unknown as Json;
  });
  return { text: rigJsonText(out), rig: out };
}

interface SetRead { flipped: number; displacement: number; tears: Tears }
interface PartRow { part: string; vertices: number; changed: number; bindings: number; maxInfluences: number; sets: Record<string, SetRead>; idle: number }
interface Row { setting: string; cap: Cap; floor: Floor; parts: PartRow[]; exit: number | null; check: Record<string, string> | null; checkLog: string[]; idle: { max: number; part: string | null }; rigBytes: number; skeletonBytes: number | null; bindings: number; maxInfluences: number; changed: number; vertices: number }

export function runCap(key: string, configPath: string, inputs: string, work: string, film: boolean, requirements: string | null, pictureParts: readonly string[], pictureSet: string | null = null): Obj {
  const config = o(readJ(configPath));
  const x = prepare(key, configPath, inputs, work, requirements);
  const { arm0, ctxs, latG } = x;
  const log = (s: string): void => void process.stderr.write(`[${key}] ${s}\n`);
  for (const p of pictureParts) if (!ctxs.some((c) => c.part === p)) throw new Error(`cap_survey: --picture "${p}" is not a lattice mesh of ${key}`);
  const sk = readSkeleton(join(arm0, 'check', 'build', 'skeleton.json'));
  const sets = film ? ['fallback', 'film'] : ['fallback'];
  const picSet = pictureSet ?? (film ? 'film' : 'fallback');
  if (!sets.includes(picSet)) throw new Error(`cap_survey: --picture-set "${picSet}" is not one of ${sets.join(', ')}`);
  // control 1: today's weights skinned here are the render's idle frames
  let skinControl = 0;
  for (const c of ctxs) {
    latG.frameBones.forEach((bones, f) => {
      const fr = latG.frames[f].get(c.part) as number[];
      c.original.forEach((ws, i) => {
        const p = skin(ws, bones);
        skinControl = Math.max(skinControl, edgeLength(p[0] - fr[2 * i], p[1] - fr[2 * i + 1]));
      });
    });
  }
  if (skinControl > 1e-3) throw new Error(`cap_survey: control — today's weights skinned here are ${skinControl} from the render's idle frames`);
  // control 2: cap 4 is Stage A's rules exactly — as is is 'as built', continuous is 'continuous floor'
  let stageA = 0;
  for (const c of ctxs) {
    for (const p of c.rig) {
      for (const [s, rule] of [[TODAY, 'as built'], [{ cap: 4, floor: 'continuous' } as Setting, 'continuous floor']] as const) {
        const a = capInfluences(c, p, s);
        const b = ruleInfluences(rule, p, c.segs, c.r, c.exponent);
        if (a.length !== b.length || a.some((e, k) => e.bone !== b[k].bone || e.weight !== b[k].weight)) stageA++;
      }
    }
  }
  if (stageA !== 0) throw new Error(`cap_survey: control — cap 4 differs from Stage A's rule at ${stageA} vertex readings`);
  const ci = chainInfo(config);
  const poseSets = new Map<string, Array<Map<string, BoneMatrix>>>();
  for (const c of ctxs) for (const set of sets) poseSets.set(`${c.part}|${set}`, bendPoses(config, c.part, set === 'film').poses.map((t) => bentBones(sk, latG.setupBones, t)));
  // the census reads the raw weights only, which no setting here changes: once
  const censusRows = ctxs.map((c) => {
    const cs = census(c, join(arm0, 'parts', `${c.part}.png`), ci, []);
    return { part: c.part, samples: cs.samples, many: cs.many };
  });
  const pictures: Record<string, Record<string, unknown>> = Object.fromEntries(pictureParts.map((p) => [p, {}]));

  const rows: Row[] = [];
  for (const s of settings()) {
    const name = label(s);
    log(name);
    const written = ctxs.map((c) => c.rig.map((_, i) => writtenFor(c, i, s, latG.setupBones)));
    const parts: PartRow[] = [];
    let idleMax = 0;
    let idlePart: string | null = null;
    ctxs.forEach((c, k) => {
      const W = written[k].map((w) => w.entry);
      let partIdle = 0;
      latG.frameBones.forEach((bones) => {
        W.forEach((ws, i) => {
          const a = skin(ws, bones);
          const b = skin(c.original[i], bones);
          partIdle = Math.max(partIdle, edgeLength(a[0] - b[0], a[1] - b[1]));
        });
      });
      if (partIdle > idleMax) [idleMax, idlePart] = [partIdle, c.part];
      const png = join(arm0, 'parts', `${c.part}.png`);
      const ruleCtx = { ...c, heat: null };
      const read: Record<string, SetRead> = {};
      for (const set of ['idle', ...sets]) {
        const poses = set === 'idle' ? latG.frameBones : (poseSets.get(`${c.part}|${set}`) as Array<Map<string, BoneMatrix>>);
        if (poses.length === 0) continue;
        const ref = referenceUnder(ruleCtx, png, latG.setupBones, poses, (rp) => capInfluences(c, rp, s));
        const rd = bendReading(c.rest, c.triangles, W, ref, poses);
        read[set] = { flipped: rd.flipped, displacement: rd.displacement, tears: tearsOf(ref) };
      }
      if (pictureParts.includes(c.part)) {
        const toRig = worldToRigOf(c);
        const bend = poseSets.get(`${c.part}|${picSet}`) as Array<Map<string, BoneMatrix>>;
        pictures[c.part][name] = { bend: bend.map((pose) => W.flatMap((ws) => toRig(skin(ws, pose)).map((v) => Math.round(v * 1000) / 1000))) };
        if (!('mesh' in pictures[c.part])) pictures[c.part].mesh = { uvsRig: c.rig, triangles: c.triangles, hull: c.hull, box: c.box };
      }
      parts.push({ part: c.part, vertices: c.rig.length, changed: written[k].filter((w) => w.changed).length, bindings: W.reduce((a, ws) => a + ws.length, 0), maxInfluences: Math.max(...W.map((ws) => ws.length)), sets: read, idle: partIdle });
    });
    let exit: number | null = null;
    let check: Record<string, string> | null = null;
    let checkLog: string[] = [];
    let skeletonBytes: number | null = null;
    const { text, rig } = rigFor(x, written.map((ws) => ws.map((w) => w.entry)));
    const unchanged = parts.every((p) => p.changed === 0);
    if (unchanged) {
      if (text !== x.rigText) throw new Error('cap_survey: control — a setting that changes no vertex rewrote rig.json');
      exit = Number(readFileSync(`${arm0}.exit`, 'utf8'));
      const cj = join(arm0, 'check', 'check.json');
      check = existsSync(cj) ? Object.fromEntries(BARS.map((b) => [b, barCell(o(readJ(cj)), b)])) : null;
      skeletonBytes = statSync(join(arm0, 'check', 'build', 'skeleton.json')).size;
    } else {
      const dir = join(work, `set-${String(s.cap)}-${s.floor.replace(' ', '-')}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      cpSync(join(arm0, 'rig'), join(dir, 'rig'), { recursive: true });
      writeFileSync(join(dir, 'rig', 'rig.json'), text);
      const rc = stage(join(dir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0, ...x.reqArgs]);
      exit = rc.exit;
      const cj = join(dir, 'check', 'check.json');
      check = existsSync(cj) ? Object.fromEntries(BARS.map((b) => [b, barCell(o(readJ(cj)), b)])) : null;
      const skj = join(dir, 'check', 'build', 'skeleton.json');
      skeletonBytes = existsSync(skj) ? statSync(skj).size : null;
      checkLog = rc.log.split('\n').filter((l) => /FAIL|refus/i.test(l)).slice(0, 12).map((l) => l.trim().slice(0, 400));
      rmSync(dir, { recursive: true, force: true });
    }
    rows.push({ setting: name, cap: s.cap, floor: s.floor, parts, exit, check, checkLog, idle: { max: idleMax, part: idlePart }, rigBytes: text.length, skeletonBytes, bindings: rigBindings(rig), maxInfluences: Math.max(...parts.map((p) => p.maxInfluences)), changed: parts.reduce((a, p) => a + p.changed, 0), vertices: parts.reduce((a, p) => a + p.vertices, 0) });
  }
  if (rows[0].changed !== 0) throw new Error(`cap_survey: control — cap 4 with the floor as is changes ${rows[0].changed} vertices; it must change none`);
  if (pictureParts.length > 0) writeFileSync(join(work, `cap-pictures-${key}.json`), JSON.stringify({ set: picSet, parts: pictures }));
  return { key, sets, controls: { skin: skinControl, stageA }, kept: x.kept, census: censusRows, claim: { share: CLAIM_SHARE, count: CLAIM_COUNT }, frames: latG.frameBones.length, rows: rows as unknown as Json };
}

// ---------------------------------------------------------------------------
// the render's time
// ---------------------------------------------------------------------------

const median = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function runTime(key: string, configPath: string, inputs: string, work: string, requirements: string | null, repeat: number): Obj {
  const x = prepare(key, configPath, inputs, work, requirements);
  const builds: Array<{ setting: string; dir: string }> = [];
  for (const s of settings()) {
    const name = label(s);
    const written = x.ctxs.map((c) => c.rig.map((_, i) => writtenFor(c, i, s, x.latG.setupBones).entry));
    const dir = join(work, `time-${String(s.cap)}-${s.floor.replace(' ', '-')}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(join(x.arm0, 'rig'), join(dir, 'rig'), { recursive: true });
    writeFileSync(join(dir, 'rig', 'rig.json'), rigFor(x, written).text);
    const b = spawnSync(RIGC, ['build', '--rig', join(dir, 'rig', 'rig.json'), '--motion', join(dir, 'rig', 'motion.json'), '--out', join(dir, 'build'), ...packedBuildArgs(DEFAULT_PACK_MODE)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (b.status !== 0) throw new Error(`cap_survey: ${name} did not compile (exit ${String(b.status)}): ${`${b.stdout}${b.stderr}`.slice(-600)}`);
    builds.push({ setting: name, dir });
    process.stderr.write(`[${key}] compiled ${name}\n`);
  }
  const forms = { geometry: ['--geometry'], frames: [] as string[] };
  const ms: Record<string, Record<string, number[]>> = Object.fromEntries(builds.map((b) => [b.setting, { geometry: [], frames: [] }]));
  // one untimed render each first, so no setting pays for a cold file cache alone
  for (const b of builds) spawnSync(RIGC, ['render', '--candidate', join(b.dir, 'build'), '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--out', join(b.dir, 'warm')], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  for (let k = 0; k < repeat; k++) {
    for (const b of builds) {
      for (const [form, extra] of Object.entries(forms)) {
        const out = join(b.dir, `r-${form}`);
        rmSync(out, { recursive: true, force: true });
        const t0 = performance.now();
        const r = spawnSync(RIGC, ['render', '--candidate', join(b.dir, 'build'), '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), ...extra, '--out', out], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
        const t = performance.now() - t0;
        if (r.status !== 0) throw new Error(`cap_survey: render of ${b.setting} exit ${String(r.status)}`);
        ms[b.setting][form].push(t);
      }
    }
  }
  const rows = builds.map((b) => ({ setting: b.setting, skeletonBytes: statSync(join(b.dir, 'build', 'skeleton.json')).size, geometry: { median: median(ms[b.setting].geometry), min: Math.min(...ms[b.setting].geometry), all: ms[b.setting].geometry }, frames: { median: median(ms[b.setting].frames), min: Math.min(...ms[b.setting].frames), all: ms[b.setting].frames } }));
  for (const b of builds) rmSync(b.dir, { recursive: true, force: true });
  return { key, repeat, rows: rows as unknown as Json };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const f2 = (v: number): string => v.toFixed(2);
const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)} %`);

/** The line, as HQ stated it before the run, read off one example's rows: per bend set, and the verdict's reasons. */
export function verdict(rows: readonly Row[], sets: readonly string[], r: Row): { pass: boolean; why: string[] } {
  const today = rows[0];
  const ref = rows[rows.length - 1];
  const folds = (row: Row, set: string): number => row.parts.reduce((a, p) => a + (p.sets[set]?.flipped ?? 0), 0);
  const why: string[] = [];
  for (const set of sets) {
    const [mine, t, l] = [folds(r, set), folds(today, set), folds(ref, set)];
    if (mine > l) why.push(`${set} ${mine} > reference ${l}`);
    if (t > 0 && mine >= t) why.push(`${set} ${mine} not < today ${t}`);
  }
  if (r.exit !== 0) why.push(`check exit ${String(r.exit)}`);
  if (r.check !== null) for (const b of BARS) if (r.check[b] !== undefined && /FAIL/.test(r.check[b])) why.push(`${b} FAIL`);
  if (r.idle.max > 1.0) why.push(`idle ${r.idle.max.toFixed(2)} > 1.0 (${r.idle.part ?? '—'})`);
  return { pass: why.length === 0, why };
}

export function renderCap(docs: Obj[], times: Obj[], focus: readonly string[]): string {
  const L: string[] = [];
  L.push(`Generated by \`tools/cap_survey.ts --page\`; every figure below is the tool's. A setting is the cap (how many of the largest influences are kept) and the floor ("as is": shares under 0.03 dropped; "continuous": 0.03 subtracted from every kept share, clamped at zero); the falloff is each mesh's own, unchanged. A tear is a pair of reference samples at most 3 px apart whose posed distance exceeds their rest distance by more than 3 rig px; "inverted" counts a triangle once per pose it folds in; "worst" is the largest distance between a sample carried by the written mesh and the same sample skinned by that setting's rule, unrounded. "fallback" is #265's bend set (every chain link ±15°), "film" the trailer's own bends.`);
  // the line, every example at once
  const keys = docs.map((d) => d.key as string);
  const names = (docs[0].rows as unknown as Row[]).map((r) => r.setting);
  L.push('');
  L.push('## The line, read');
  L.push('');
  L.push(`| setting | ${keys.join(' | ')} | adoptable |`);
  L.push(`| --- | ${keys.map(() => '---').join(' | ')} | --- |`);
  for (const n of names) {
    if (n === 'lifted (reference)') continue;
    const cells = docs.map((d) => {
      const rows = d.rows as unknown as Row[];
      const v = verdict(rows, d.sets as string[], rows.find((r) => r.setting === n) as Row);
      return v.pass ? 'holds' : v.why.join('; ');
    });
    L.push(`| ${n} | ${cells.join(' | ')} | ${cells.every((c) => c === 'holds') ? '**yes**' : 'no'} |`);
  }
  // the cost, every example at once
  L.push('');
  L.push('## The cost');
  L.push('');
  L.push('Bindings are one per bone per vertex, over every weighted attachment of rig.json (the lattice meshes this tool rewrites and the meshes it keeps). The compiled skeleton is the `skeleton.json` of the check\'s own build. The render times are wall clock, the median of the repeats, run with no other job in the shared pool (the run is named in the page\'s prose); "geometry" is the call `check` makes (`--geometry`), "frames" the same render without it.');
  L.push('');
  L.push(`| setting | ${keys.map((k) => `${k}: bindings / rig.json bytes / skeleton.json bytes / render geometry, frames (ms)`).join(' | ')} |`);
  L.push(`| --- | ${keys.map(() => '---').join(' | ')} |`);
  for (const n of names) {
    L.push(`| ${n} | ${docs.map((d) => {
      const r = (d.rows as unknown as Row[]).find((x) => x.setting === n) as Row;
      const t = times.find((x) => x.key === d.key);
      const tr = t === undefined ? undefined : (t.rows as unknown as Array<{ setting: string; geometry: { median: number }; frames: { median: number } }>).find((x) => x.setting === n);
      return `${r.bindings} / ${r.rigBytes} / ${r.skeletonBytes ?? '—'} / ${tr === undefined ? '—' : `${tr.geometry.median.toFixed(0)}, ${tr.frames.median.toFixed(0)}`}`;
    }).join(' | ')} |`);
  }
  for (const t of times) L.push(`- ${t.key as string}: ${String(t.repeat)} timed renders per setting and form, interleaved; the minimum of each is in the run's JSON.`);
  for (const doc of docs) {
    const rows = doc.rows as unknown as Row[];
    const sets = ['idle', ...(doc.sets as string[])];
    L.push('');
    L.push(`## ${doc.key as string}`);
    L.push('');
    const cs = doc.census as unknown as Array<{ part: string; samples: number; many: number }>;
    L.push(`Controls: today's weights skinned here are within ${(o(doc.controls).skin as number).toExponential(1)} rig px of \`rigc render --geometry\`'s idle frames (${String(doc.frames)} frames); cap 4 with the floor as is changes no vertex and writes rig.json byte for byte; cap 4 is Stage A's "as built" and "continuous floor" at every lattice vertex (${String(o(doc.controls).stageA)} differ). Census share (${String(doc.claim && o(doc.claim).count)} or more bones within ${String(doc.claim && o(doc.claim).share)} of the largest raw weight; no setting moves it): ${pct(cs.reduce((a, p) => a + p.many, 0), cs.reduce((a, p) => a + p.samples, 0))} of all lattice samples. Meshes not read (their weights are kept): ${(doc.kept as string[]).length === 0 ? 'none' : (doc.kept as string[]).join('; ')}.`);
    L.push('');
    L.push(`| setting | ${sets.map((s) => `${s}: inverted / tears / worst`).join(' | ')} | largest influence count | vertices changed | check | ${BARS.join(' | ')} | idle vs today (part) |`);
    L.push(`| --- | ${sets.map(() => '---').join(' | ')} | ---: | ---: | --- | ${BARS.map(() => '---').join(' | ')} | --- |`);
    for (const r of rows) {
      const cell = (s: string): string => {
        const ps = r.parts.filter((p) => p.sets[s] !== undefined);
        return `${ps.reduce((a, p) => a + p.sets[s].flipped, 0)} / ${ps.reduce((a, p) => a + p.sets[s].tears.torn, 0)} / ${f2(ps.reduce((a, p) => Math.max(a, p.sets[s].displacement), 0))}`;
      };
      L.push(`| ${r.setting} | ${sets.map(cell).join(' | ')} | ${r.maxInfluences} | ${r.changed} of ${r.vertices} | ${r.exit === 0 ? 'PASS' : `exit ${String(r.exit)}`} | ${BARS.map((b) => (r.check === null ? '—' : r.check[b])).join(' | ')} | ${r.changed === 0 ? '—' : `${r.idle.max.toFixed(3)} (${r.idle.part ?? '—'})`} |`);
    }
    for (const r of rows) if (r.checkLog.length > 0 && r.exit !== 0) L.push(`- ${r.setting}, check: ${r.checkLog.map((x) => `\`${x}\``).join('; ')}`);
    L.push('');
    L.push('Per part: inverted / tears / worst at each bend set, the idle against today (rig px), and the bindings:');
    L.push('');
    const bend = doc.sets as string[];
    L.push(`| part | census | ${rows.map((r) => r.setting).join(' | ')} |`);
    L.push(`| --- | ---: | ${rows.map(() => '---').join(' | ')} |`);
    for (const p of rows[0].parts) {
      if (bend.every((s) => p.sets[s] === undefined) && !focus.includes(p.part)) continue;
      const c = cs.find((q) => q.part === p.part);
      L.push(`| ${p.part} | ${c === undefined ? '—' : pct(c.many, c.samples)} | ${rows.map((r) => {
        const q = r.parts.find((x) => x.part === p.part) as PartRow;
        const b = bend.filter((s) => q.sets[s] !== undefined).map((s) => `${q.sets[s].flipped}/${q.sets[s].tears.torn}/${f2(q.sets[s].displacement)}`).join(' · ');
        return `${b === '' ? '—' : b}; idle ${q.idle.toFixed(2)}; ${q.bindings} b`;
      }).join(' | ')} |`);
    }
    L.push('');
    L.push('Bindings per lattice mesh (one per bone per vertex), every mesh read:');
    L.push('');
    L.push(`| part | vertices | ${rows.map((r) => r.setting).join(' | ')} |`);
    L.push(`| --- | ---: | ${rows.map(() => '---:').join(' | ')} |`);
    for (const p of rows[0].parts) L.push(`| ${p.part} | ${p.vertices} | ${rows.map((r) => (r.parts.find((x) => x.part === p.part) as PartRow).bindings).join(' | ')} |`);
    L.push(`| all lattice meshes | ${rows[0].vertices} | ${rows.map((r) => r.parts.reduce((a, q) => a + q.bindings, 0)).join(' | ')} |`);
    L.push(`| the whole rig.json | — | ${rows.map((r) => r.bindings).join(' | ')} |`);
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
    const focus = (flag('--focus') ?? '').split(',').filter((v) => v !== '');
    const after = (n: string): string[] => {
      const i = argv.indexOf(n);
      if (i < 0) return [];
      const out: string[] = [];
      for (let k = i + 1; k < argv.length && !argv[k].startsWith('--'); k++) out.push(argv[k]);
      return out;
    };
    process.stdout.write(renderCap(after('--page').map((f) => o(readJ(f))), after('--times').map((f) => o(readJ(f))), focus));
    return;
  }
  const [key, config, inputs, work, out] = [flag('--key'), flag('--config'), flag('--inputs'), flag('--work'), flag('--out')];
  const mode = argv.includes('--run') ? 'run' : argv.includes('--time') ? 'time' : null;
  if (mode === null || key === null || config === null || inputs === null || work === null || out === null) {
    console.error('usage: cap_survey --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] [--picture <part>,…] [--picture-set fallback|film] --out <doc.json> | --time … [--requirements <r>] --repeat <n> --out <time.json> | --page <doc.json>… [--times <time.json>…] [--focus <part>,…]');
    process.exit(2);
  }
  const req = flag('--requirements');
  const pic = (flag('--picture') ?? '').split(',').filter((v) => v !== '');
  let doc: Obj;
  if (mode === 'time') {
    const n = Number(flag('--repeat'));
    if (!Number.isInteger(n) || n < 1) {
      console.error(`cap_survey: --repeat "${String(flag('--repeat'))}" is not a whole number of at least 1`);
      process.exit(2);
    }
    doc = runTime(key, resolve(config), resolve(inputs), resolve(work), req === null ? null : resolve(req), n);
  } else doc = runCap(key, resolve(config), resolve(inputs), resolve(work), argv.includes('--film'), req === null ? null : resolve(req), pic, flag('--picture-set'));
  // a file, not stdout: a large write to a redirected stdout was cut at 64 KiB on Nova's bun
  writeFileSync(resolve(out), `${JSON.stringify(doc)}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
