#!/usr/bin/env bun
/**
 * Issue #284 Stage D: the flatness itself. The distance rule is `w = 1/(d + r)^e` (src/weights.ts); Stage B's census
 * found that on skirts and fringes a third to a half of all samples hold five or more bones within a tenth of the
 * largest raw weight. This tool keeps the rule's form and its cut (the four largest, the 0.03 floor — `influences()`
 * at `DEFAULT_LIMITS`, unchanged) and sweeps the falloff: the exponent `e`, and the radius `r` as a fraction of the
 * part's size. Nothing under `src/` changes; every mesh keeps the lattice it ships with.
 *
 *     bun tools/falloff_survey.ts --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>]
 *         [--exponents 2,3,…] [--fractions today,0.01,…] [--picture <part>,…] [--control <e>:<f>] --out <k>.json
 *     bun tools/falloff_survey.ts --page <doc.json>…   # the measured half of docs/evidence/weight-falloff.md
 *
 * **A setting** is `(e, r)`: `e` one of {@link EXPONENTS}, `r` either the mesh's own authored `r` ("today") or
 * `f · s`, `s` the part's size — `min(w, h)` of its box in parts.json, the measure `propose` drafts `grid` and `r`
 * from (`gridR`, src/propose.ts: grid = min(w, h)/10 clamped to 5..36, r = 0.42 · grid, at least 3) — and `f` one of
 * {@link FRACTIONS}. `(2, today)` is today's rig and is the control: it must change no vertex.
 *
 * **Per setting, two rules**: **the cut as is** — `influences()` at `DEFAULT_LIMITS` with the setting's `r` and `e`,
 * written as the lattice writes it (each weight to 5 places, the last `1 − sum(others)`: what a config declaring that
 * `r` and `exponent` builds — `--control` checks it against the real build); and **lifted at this falloff** — every
 * bone the segments name, nothing dropped, rounded as `tools/tear_survey.ts` rounds it — read only to tell the cut's
 * folds from the falloff's own.
 *
 * **What is read** — Stage A's columns (`tools/tear_survey.ts`, the same functions): at the idle and at #265's bend
 * sets (every link of every chain the part names turned ±15°, and on the trailer ±the film's bends), inverted
 * triangles of the written lattice and tears of the rule's own dense reference, and the worst sample; the largest
 * influence count; vertices changed and rig.json's length; every `check` bar by the real `rig-parts check`; the idle's
 * posed displacement against today's rig. Beside them, **the census number**: the share of a part's art samples with
 * {@link CLAIM_COUNT} or more bones whose raw weight is at least {@link CLAIM_SHARE} of the sample's largest — under
 * the setting's falloff.
 *
 * `--picture <part>,…` keeps those parts' meshes posed at the bend set (the film's when `--film`) and at eight evenly
 * spaced frames of one idle cycle, under today's rule, the lifted reference and the cut as is at every setting.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { edgeLength } from '../src/length.ts';
import { rigJsonText } from '../src/rig.ts';
import { DEFAULT_LIMITS, type Influence, influences } from '../src/weights.ts';
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
  type Tears,
  tearsOf,
  worldToRigOf,
} from './tear_survey.ts';

const ROOT = resolve(import.meta.dir, '..');
const readJ = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const o = (v: Json | undefined): Obj => v as Obj;

/** The exponents swept, stated before the run (the page's first section gives the bounds' reasons). */
export const EXPONENTS = [2, 3, 4, 6, 8] as const;

/** `r` as a fraction of the part's size, stated before the run; "today" is the mesh's authored `r`. */
export const FRACTIONS = ['today', 0.01, 0.02, 0.08] as const;
type Fraction = (typeof FRACTIONS)[number];

/** Idle frames kept per picture: one cycle, evenly spaced. */
export const PICTURE_FRAMES = 8;

interface Setting { e: number; f: Fraction }
const label = (s: Setting): string => `e ${s.e}, r ${s.f === 'today' ? 'today' : `${s.f}·s`}`;
const rOf = (c: PartCtx, f: Fraction): number => (f === 'today' ? c.r : f * Math.min(c.box.w, c.box.h));

type Cut = 'cut' | 'lifted';

/** The influences at a rig-px point under a setting and a cut, unrounded, largest first. */
function setInfluences(c: PartCtx, p: P2, s: Setting, cut: Cut): Influence[] {
  return influences(p, c.segs, rOf(c, s.f), cut === 'cut' ? DEFAULT_LIMITS : ALL, s.e);
}

/** What a setting writes for one vertex; `changed` when it differs from the build's entry. */
function writtenFor(c: PartCtx, i: number, s: Setting, cut: Cut, bones: ReadonlyMap<string, BoneMatrix>): { entry: WeightEntry[]; changed: boolean } {
  const mine = setInfluences(c, c.rig[i], s, cut);
  const w = c.rigToWorld(c.rig[i]);
  const entry = (cut === 'cut' ? latticeRound(mine) : roundShares(mine)).map(({ bone, weight }) => {
    const was = c.original[i].find((e) => e.bone === bone);
    if (was !== undefined) return { bone, x: was.x, y: was.y, weight };
    const [x, y] = local(bones, bone, w);
    return { bone, x: placesZ(x), y: placesZ(y), weight };
  });
  const o0 = c.original[i];
  const changed = entry.length !== o0.length || entry.some((e, k) => e.bone !== o0[k].bone || e.weight !== o0[k].weight || e.x !== o0[k].x || e.y !== o0[k].y);
  return { entry: changed ? entry : o0, changed };
}

interface SetCensus { flipped: number; displacement: number; tears: Tears }
interface PartRow { part: string; size: number; r: number; samples: number; many: number; changed: number; vertices: number; maxInfluences: number; sets: Record<string, SetCensus>; idle: number }
interface Row { setting: string; e: number; f: Fraction; cut: Cut; parts: PartRow[]; exit: number | null; check: Record<string, string> | null; checkLog: string[]; idle: { max: number; part: string | null }; rigBytes: number; maxInfluences: number; changed: number; vertices: number }

export function runFalloff(key: string, configPath: string, inputs: string, work: string, film: boolean, requirements: string | null, exponents: readonly number[], fractions: readonly Fraction[], pictureParts: readonly string[], control: Setting | null): Obj {
  const config = o(readJ(configPath));
  const arm0 = join(work, 'arm0');
  const log = (s: string): void => void process.stderr.write(`[${key}] ${s}\n`);
  const reqArgs = requirements === null ? [] : ['--requirements', requirements];
  const buildArgs = (cfg: string, out: string): string[] => [join(ROOT, 'cli.ts'), 'build', '--config', cfg, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', out, ...reqArgs];
  if (!existsSync(join(arm0, 'check', 'build', 'skeleton.json'))) {
    log('lattice build');
    const r = stage(arm0, false, 'bun', buildArgs(configPath, arm0));
    if (r.exit !== 0) throw new Error(`falloff_survey: the lattice did not build (exit ${r.exit})`);
  }
  const boxes = partBoxes(join(arm0, 'parts.json'));
  const latG = renderGeometry(join(arm0, 'check', 'build'), join(work, 'render-L'));
  if (typeof latG === 'string') throw new Error(`falloff_survey: the lattice did not render: ${latG}`);
  const sk = readSkeleton(join(arm0, 'check', 'build', 'skeleton.json'));
  const rigText = readFileSync(join(arm0, 'rig', 'rig.json'), 'utf8');
  const rig = o(JSON.parse(rigText) as Json);
  const sets = film ? ['fallback', 'film'] : ['fallback'];
  const ctxs: PartCtx[] = [];
  const kept: string[] = [];
  for (const name of Object.keys(o(config.meshes))) {
    const box = boxes.find((p) => p.name === name);
    if (box === undefined) continue;
    const c = partCtx(config, arm0, rig, box, latG);
    if (typeof c === 'string') kept.push(`${name}: ${c}`);
    else ctxs.push(c);
  }
  for (const p of pictureParts) if (!ctxs.some((c) => c.part === p)) throw new Error(`falloff_survey: --picture "${p}" is not a lattice mesh of ${key}`);
  // control: today's weights skinned here are the render's idle frames
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
  if (skinControl > 1e-3) throw new Error(`falloff_survey: control — today's weights skinned here are ${skinControl} from the render's idle frames`);
  const ci = chainInfo(config);
  const frames = latG.frameBones.length;
  const pick = Array.from({ length: Math.min(PICTURE_FRAMES, frames) }, (_, k) => Math.floor((k * frames) / Math.min(PICTURE_FRAMES, frames)));
  const pictures: Record<string, Record<string, unknown>> = Object.fromEntries(pictureParts.map((p) => [p, {}]));
  const poseSets = new Map<string, Array<Map<string, BoneMatrix>>>();
  for (const c of ctxs) for (const set of sets) poseSets.set(`${c.part}|${set}`, bendPoses(config, c.part, set === 'film').poses.map((t) => bentBones(sk, latG.setupBones, t)));

  const settings: Array<{ s: Setting; cut: Cut }> = [{ s: { e: 2, f: 'today' }, cut: 'cut' }, { s: { e: 2, f: 'today' }, cut: 'lifted' }];
  for (const e of exponents) for (const f of fractions) if (!(e === 2 && f === 'today')) for (const cut of ['cut', 'lifted'] as const) settings.push({ s: { e, f }, cut });

  const rows: Row[] = [];
  for (const { s, cut } of settings) {
    const name = `${label(s)}${cut === 'lifted' ? ', lifted' : ''}`;
    log(name);
    const written = ctxs.map((c) => c.rig.map((_, i) => writtenFor(c, i, s, cut, latG.setupBones)));
    const parts: PartRow[] = [];
    let idleMax = 0;
    let idlePart: string | null = null;
    ctxs.forEach((c, k) => {
      const W = written[k].map((x) => x.entry);
      let partIdle = 0;
      const perFrame: number[] = [];
      latG.frameBones.forEach((bones) => {
        let fm = 0;
        W.forEach((ws, i) => {
          const a = skin(ws, bones);
          const b = skin(c.original[i], bones);
          fm = Math.max(fm, edgeLength(a[0] - b[0], a[1] - b[1]));
        });
        perFrame.push(fm);
        partIdle = Math.max(partIdle, fm);
      });
      if (partIdle > idleMax) [idleMax, idlePart] = [partIdle, c.part];
      const cx = { ...c, r: rOf(c, s.f), exponent: s.e };
      const cs = census(cx, join(arm0, 'parts', `${c.part}.png`), ci, []);
      const png = join(arm0, 'parts', `${c.part}.png`);
      const read: Record<string, SetCensus> = {};
      const ruleCtx = { ...cx, heat: null };
      for (const set of ['idle', ...sets]) {
        const poses = set === 'idle' ? latG.frameBones : (poseSets.get(`${c.part}|${set}`) as Array<Map<string, BoneMatrix>>);
        if (poses.length === 0) continue;
        const ref = referenceUnder(ruleCtx, png, latG.setupBones, poses, cut === 'cut' ? 'as built' : 'lifted');
        const rd = bendReading(c.rest, c.triangles, W, ref, poses);
        read[set] = { flipped: rd.flipped, displacement: rd.displacement, tears: tearsOf(ref) };
      }
      if (pictureParts.includes(c.part) && (cut === 'cut' || s.f === 'today' && s.e === 2)) {
        const toRig = worldToRigOf(c);
        const bend = poseSets.get(`${c.part}|${film ? 'film' : 'fallback'}`) as Array<Map<string, BoneMatrix>>;
        const posedAt = (pose: ReadonlyMap<string, BoneMatrix>): number[] => W.flatMap((ws) => toRig(skin(ws, pose)).map((v) => Math.round(v * 1000) / 1000));
        pictures[c.part][name] = { bend: bend.map(posedAt), idle: pick.map((f) => posedAt(latG.frameBones[f])), idleVsToday: pick.map((f) => perFrame[f]) };
        if (!('mesh' in pictures[c.part])) pictures[c.part].mesh = { uvsRig: c.rig, triangles: c.triangles, hull: c.hull, box: c.box, frames: pick, of: frames };
      }
      parts.push({ part: c.part, size: Math.min(c.box.w, c.box.h), r: rOf(c, s.f), samples: cs.samples, many: cs.many, changed: written[k].filter((x) => x.changed).length, vertices: c.rig.length, maxInfluences: Math.max(...W.map((ws) => ws.length)), sets: read, idle: partIdle });
    });
    let exit: number | null = null;
    let check: Record<string, string> | null = null;
    let checkLog: string[] = [];
    let rigBytes = rigText.length;
    const unchanged = parts.every((p) => p.changed === 0);
    if (unchanged) {
      exit = Number(readFileSync(`${arm0}.exit`, 'utf8'));
      const cj = join(arm0, 'check', 'check.json');
      check = existsSync(cj) ? Object.fromEntries(BARS.map((b) => [b, barCell(o(readJ(cj)), b)])) : null;
    } else {
      const dir = join(work, `set-${s.e}-${String(s.f)}-${cut}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      cpSync(join(arm0, 'rig'), join(dir, 'rig'), { recursive: true });
      const out = o(JSON.parse(rigText) as Json);
      const skinD = o(o(out.skins).default);
      ctxs.forEach((c, k) => {
        o(o(skinD[c.part])[c.part]).weights = written[k].map((x) => x.entry) as unknown as Json;
      });
      const text = rigJsonText(out);
      rigBytes = text.length;
      writeFileSync(join(dir, 'rig', 'rig.json'), text);
      const rc = stage(join(dir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0, ...reqArgs]);
      exit = rc.exit;
      const cj = join(dir, 'check', 'check.json');
      check = existsSync(cj) ? Object.fromEntries(BARS.map((b) => [b, barCell(o(readJ(cj)), b)])) : null;
      checkLog = rc.log.split('\n').filter((l) => /FAIL|refus/i.test(l)).slice(0, 12).map((l) => l.trim().slice(0, 400));
      rmSync(dir, { recursive: true, force: true });
    }
    rows.push({ setting: name, e: s.e, f: s.f, cut, parts, exit, check, checkLog, idle: { max: idleMax, part: idlePart }, rigBytes, maxInfluences: Math.max(...parts.map((p) => p.maxInfluences)), changed: parts.reduce((a, p) => a + p.changed, 0), vertices: parts.reduce((a, p) => a + p.vertices, 0) });
  }
  const today = rows[0];
  if (today.changed !== 0) throw new Error(`falloff_survey: control — the setting (2, today) changes ${today.changed} vertices; it must change none`);

  // control: what this tool writes for one setting is what the real build writes when the config declares it
  let controlRow: Obj | null = null;
  if (control !== null) {
    const cfg = JSON.parse(JSON.stringify(config)) as Obj;
    for (const c of ctxs) {
      const m = o(o(cfg.meshes)[c.part]);
      m.r = rOf(c, control.f) as unknown as Json;
      m.exponent = control.e as unknown as Json;
    }
    const cdir = join(work, 'cfg-control');
    rmSync(cdir, { recursive: true, force: true });
    cpSync(dirname(configPath), cdir, { recursive: true });
    writeFileSync(join(cdir, 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
    const bdir = join(work, 'control-build');
    log(`control build ${label(control)}`);
    const b = stage(bdir, false, 'bun', buildArgs(join(cdir, 'config.json'), bdir));
    let differ = 0;
    let worstW = 0;
    let worstXY = 0;
    if (b.exit === 0) {
      const hr = o(o(o(readJ(join(bdir, 'rig', 'rig.json'))).skins).default);
      for (const c of ctxs) {
        const theirs = (o(o(hr[c.part])[c.part]).weights as Json[]).map((row) => row as Obj[]);
        c.rig.forEach((_, i) => {
          const mine = writtenFor(c, i, control, 'cut', latG.setupBones).entry;
          const t = theirs[i];
          if (t.length !== mine.length || t.some((e, k) => e.bone !== mine[k].bone)) {
            differ++;
            return;
          }
          mine.forEach((e, k) => {
            worstW = Math.max(worstW, Math.abs(e.weight - (t[k].weight as number)));
            worstXY = Math.max(worstXY, Math.abs(e.x - (t[k].x as number)), Math.abs(e.y - (t[k].y as number)));
          });
        });
      }
    }
    controlRow = { setting: label(control), exit: b.exit, differ, worstWeight: worstW, worstOffset: worstXY, log: b.exit === 0 ? '' : b.log.split('\n').filter((l) => /FAIL|refus/i.test(l)).slice(0, 6).join(' | ').slice(0, 600) };
  }
  if (pictureParts.length > 0) writeFileSync(join(work, `falloff-pictures-${key}.json`), JSON.stringify({ set: film ? 'film' : 'fallback', parts: pictures }));
  return { key, sets, controls: { skin: skinControl }, kept, control: controlRow as unknown as Json, claim: { share: CLAIM_SHARE, count: CLAIM_COUNT }, frames, rows: rows as unknown as Json };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const f2 = (v: number): string => v.toFixed(2);
const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)} %`);

/** Several runs of one example (split by exponent) merged into one, today's rows once. */
export function mergeDocs(docs: Obj[]): Obj[] {
  const byKey = new Map<string, Obj>();
  for (const d of docs) {
    const k = d.key as string;
    const was = byKey.get(k);
    if (was === undefined) {
      byKey.set(k, { ...d, rows: [...(d.rows as Json[])] as unknown as Json });
      continue;
    }
    const rows = was.rows as unknown as Row[];
    for (const r of d.rows as unknown as Row[]) if (!rows.some((x) => x.setting === r.setting)) rows.push(r);
    if (was.control === null && d.control !== null) was.control = d.control;
  }
  const order = (r: Row): number => (r.e === 2 && r.f === 'today' ? -1 : EXPONENTS.indexOf(r.e as (typeof EXPONENTS)[number]) * 10 + FRACTIONS.indexOf(r.f)) * 2 + (r.cut === 'lifted' ? 1 : 0);
  for (const d of byKey.values()) (d.rows as unknown as Row[]).sort((a, b) => order(a) - order(b));
  return [...byKey.values()];
}

export function renderFalloff(docs0: Obj[], focus: readonly string[]): string {
  const docs = mergeDocs(docs0);
  const L: string[] = [];
  L.push(`Generated by \`tools/falloff_survey.ts --page\`; every figure below is the tool's. A setting is the exponent e and the radius r of \`w = 1/(d + r)^e\`; "r today" is the mesh's authored r, "r f·s" is f times the part's size s = min(w, h). "Cut" is the rule as built at that falloff (four largest, the 0.03 floor); "lifted" is every bone, nothing dropped, at that falloff. The census share is the share of all lattice samples with ${CLAIM_COUNT} or more bones within ${CLAIM_SHARE} of the largest raw weight. A tear is a pair of reference samples at most 3 px apart whose posed distance exceeds their rest distance by more than 3 rig px; "inverted" counts a triangle once per pose it folds in; "worst" is the largest distance between a sample carried by the written mesh and the same sample skinned by that setting's rule, unrounded.`);
  for (const doc of docs) {
    const rows = doc.rows as unknown as Row[];
    const sets = ['idle', ...(doc.sets as string[])];
    L.push('');
    L.push(`## ${doc.key as string}`);
    L.push('');
    const ct = doc.control as unknown as { setting: string; exit: number; differ: number; worstWeight: number; worstOffset: number; log: string } | null;
    L.push(`Controls: today's weights skinned here are within ${(o(doc.controls).skin as number).toExponential(1)} rig px of \`rigc render --geometry\`'s idle frames (${String(doc.frames)} frames); the setting (e 2, r today) changes no vertex${ct === null ? '' : `; the real build with every lattice mesh declaring ${ct.setting} exits ${ct.exit}${ct.exit === 0 ? `, and against what this tool writes ${ct.differ} vertices keep other bones, the largest weight difference is ${ct.worstWeight.toExponential(1)}, the largest offset difference ${ct.worstOffset.toExponential(1)}` : ` (${ct.log})`}`}. Meshes not read (their weights are kept): ${(doc.kept as string[]).length === 0 ? 'none' : (doc.kept as string[]).join('; ')}.`);
    L.push('');
    L.push(`| setting | census share | ${sets.map((s) => `${s}: inverted / tears / worst`).join(' | ')} | largest influence count | vertices changed | rig.json bytes | check | ${BARS.join(' | ')} | idle vs today (part) |`);
    L.push(`| --- | ---: | ${sets.map(() => '---').join(' | ')} | ---: | ---: | ---: | --- | ${BARS.map(() => '---').join(' | ')} | --- |`);
    for (const r of rows) {
      const cell = (s: string): string => {
        const ps = r.parts.filter((p) => p.sets[s] !== undefined);
        return `${ps.reduce((x, p) => x + p.sets[s].flipped, 0)} / ${ps.reduce((x, p) => x + p.sets[s].tears.torn, 0)} / ${f2(ps.reduce((x, p) => Math.max(x, p.sets[s].displacement), 0))}`;
      };
      const many = r.parts.reduce((x, p) => x + p.many, 0);
      const samples = r.parts.reduce((x, p) => x + p.samples, 0);
      L.push(`| ${r.setting} | ${pct(many, samples)} | ${sets.map(cell).join(' | ')} | ${r.maxInfluences} | ${r.changed} of ${r.vertices} | ${r.rigBytes} | ${r.exit === 0 ? 'PASS' : `exit ${String(r.exit)}`} | ${BARS.map((b) => (r.check === null ? '—' : r.check[b])).join(' | ')} | ${r.changed === 0 ? '—' : `${r.idle.max.toFixed(3)} (${r.idle.part ?? '—'})`} |`);
    }
    for (const r of rows) if (r.checkLog.length > 0 && r.exit !== 0) L.push(`- ${r.setting}, check: ${r.checkLog.map((x) => `\`${x}\``).join('; ')}`);
    L.push('');
    L.push('Per part, the census share under each falloff (the cut does not enter it), the part\'s size s and r today:');
    L.push('');
    const cuts = rows.filter((r) => r.cut === 'cut');
    L.push(`| part | s | r today | ${cuts.map((r) => r.setting).join(' | ')} |`);
    L.push(`| --- | ---: | ---: | ${cuts.map(() => '---:').join(' | ')} |`);
    for (const p of rows[0].parts) L.push(`| ${p.part} | ${p.size} | ${p.r} | ${cuts.map((r) => {
      const q = r.parts.find((x) => x.part === p.part) as PartRow;
      return pct(q.many, q.samples);
    }).join(' | ')} |`);
    L.push('');
    L.push('Per part, inverted / tears / worst at each bend set and the idle against today (rig px), the cut as is:');
    L.push('');
    const bend = doc.sets as string[];
    L.push(`| part | ${cuts.map((r) => r.setting).join(' | ')} |`);
    L.push(`| --- | ${cuts.map(() => '---').join(' | ')} |`);
    for (const p of rows[0].parts) {
      if (bend.every((s) => p.sets[s] === undefined) && !focus.includes(p.part)) continue;
      L.push(`| ${p.part} | ${cuts.map((r) => {
        const q = r.parts.find((x) => x.part === p.part) as PartRow;
        const b = bend.filter((s) => q.sets[s] !== undefined).map((s) => `${q.sets[s].flipped}/${q.sets[s].tears.torn}/${f2(q.sets[s].displacement)}`).join(' · ');
        return `${b === '' ? '—' : b}; idle ${q.idle.toFixed(2)}`;
      }).join(' | ')} |`);
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
    const focus = (flag('--focus') ?? '').split(',').filter((x) => x !== '');
    const files = argv.slice(argv.indexOf('--page') + 1).filter((x) => !x.startsWith('--') && x !== flag('--focus'));
    process.stdout.write(renderFalloff(files.map((f) => o(readJ(f))), focus));
    return;
  }
  const [key, config, inputs, work, out] = [flag('--key'), flag('--config'), flag('--inputs'), flag('--work'), flag('--out')];
  if (!argv.includes('--run') || key === null || config === null || inputs === null || work === null || out === null) {
    console.error('usage: falloff_survey --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] [--exponents 2,3] [--fractions today,0.01] [--picture <part>,…] [--control <e>:<f>] --out <doc.json> | --page <doc.json>… [--focus <part>,…]');
    process.exit(2);
  }
  const num = (x: string, what: string): number => {
    const v = Number(x);
    if (!Number.isFinite(v) || v <= 0) {
      console.error(`falloff_survey: ${what} "${x}" is not a positive number`);
      process.exit(2);
    }
    return v;
  };
  const exps = (flag('--exponents') ?? EXPONENTS.join(',')).split(',').map((x) => num(x, '--exponents names'));
  const fracOf = (x: string): Fraction => {
    const t = x.trim();
    const hit = FRACTIONS.find((f) => String(f) === t);
    if (hit === undefined) {
      console.error(`falloff_survey: "${t}" is not one of the stated fractions ${FRACTIONS.join(', ')}`);
      process.exit(2);
    }
    return hit;
  };
  const fracs = (flag('--fractions') ?? FRACTIONS.join(',')).split(',').map(fracOf);
  const ctl = flag('--control');
  const control = ctl === null ? null : { e: num(ctl.split(':')[0], '--control exponent'), f: fracOf(ctl.split(':')[1] ?? '') };
  const pic = (flag('--picture') ?? '').split(',').filter((x) => x !== '');
  const req = flag('--requirements');
  // a file, not stdout: a large write to a redirected stdout was cut at 64 KiB on Nova's bun
  writeFileSync(resolve(out), `${JSON.stringify(runFalloff(key, resolve(config), resolve(inputs), resolve(work), argv.includes('--film'), req === null ? null : resolve(req), exps, fracs, pic, control))}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
