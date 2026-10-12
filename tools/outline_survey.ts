#!/usr/bin/env bun
/**
 * Issue #265, (G′): the traced outline with its edges capped at one grid step, around an interior lattice at the
 * figure's spacing — measured on the three examples beside the lattice at the same spacing, today's lattice and
 * Stage D's (G), on the idle and the bend set.
 *
 *     bun tools/density_survey.ts --run --key <k> --config <cfg> --inputs <dir> [--requirements <r>] --draft --work <W>   # today's lattice (L)
 *     bun tools/outline_survey.ts --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] > <k>.json
 *     bun tools/outline_survey.ts --page <k>.json… > docs/evidence/density-outline.md
 *
 * Diagnosis 1 (`docs/evidence/density-scarf-cause.md`): a traced outline is simplified by its shape alone, so a
 * straight stretch of art keeps one long edge, and the art along it takes its motion from two end vertices whose
 * weights are not its own; the lattice samples its boundary every grid step. (G′) caps the outline's edges at the
 * grid step, the cut points weighted by the part's own rule like every other vertex.
 *
 * **The arms**, on every part the lattice meshes (`grid`); a part with real pieces (Stage B's dust rule) and an
 * author's own `contour` mesh keep their entry in every arm:
 *
 * - **(L)** today's lattice, per part.
 * - **(LS)** the lattice at the figure's spacing S = round(H / 37): every `grid` mesh at `grid: S`, through `build`.
 * - **(G)** Stage D's control: the traced outline (T = max(1, round(H / 554)), margin T, dust `stray`) with the
 *   contour mode's interior grid at S, through `build`.
 * - **(G′)** (G)'s outline with every edge longer than S cut into equal pieces of at most S ({@link capOutline}),
 *   around (G)'s own interior points, triangulated as a constrained Delaunay triangulation with every outline edge
 *   kept (`cdt`, tools/edge_survey.ts — `contourMesh` has no edge cap, so the mesh is this tool's and `src/` does not
 *   change), weighted by the rig stage's distance rule and written in place of the lattice mesh in (L)'s `rig.json`,
 *   then checked by the real `rig-parts check`.
 *
 * **What is read** is Stage D's: triangles — as a share of (LS), the same spacing, and of (L), today's — every
 * `check` bar, figure overdraw, the idle's worst displacement against (L), and against the dense reference the
 * worst displacement and inverted triangles at the idle and at the bend set (15° a link; the trailer also at the
 * film's bends), with each arm's worst bend sample as a share of (L)'s — each arm twice: under the weight rule as
 * built, and with the rule's cap and floor lifted ({@link UNCAPPED}, {@link liftRig}) on the vertices and the reference
 * alike (diagnosis 2, PR #283).
 */
import { mkdirSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ContourParams, contourMesh } from '../src/contour.ts';
import { ART_ALPHA, counterClockwiseInSpineWorld } from '../src/mesh.ts';
import { readPng } from '../src/raster/index.ts';
import { PAD, rigJsonText } from '../src/rig.ts';
import { pyRound } from '../src/round.ts';
import { type InfluenceLimits, type Segment } from '../src/weights.ts';
import { outlineTolerance } from './contourdraft.ts';
import { FIGURE_GRID_DIVISOR } from '../src/propose.ts';
import {
  type ArmResult,
  BARS,
  barCell,
  figureHeight,
  fitAffine,
  type Geometry,
  type Json,
  measured,
  type Obj,
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
import { cdt, type DenseRow, denseReadings, dustOf, type EdgePart, gridConfig, stageCfg } from './edge_survey.ts';

const ROOT = resolve(import.meta.dir, '..');

/** S = round(H / SPACING_DIVISOR), Stage A's middle B and Stage D's (G); `src/propose.ts` states it (`FIGURE_GRID_DIVISOR`). */
export const SPACING_DIVISOR = FIGURE_GRID_DIVISOR;

const readJ = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const o = (v: Json | undefined): Obj => v as Obj;
const snapU = (v: number): number => Math.round(v * 256) / 256;

/** A closed outline with every edge longer than `cap` cut into equal pieces of at most `cap`, each point on the 1/256 px grid. */
export function capOutline(ring: readonly P2[], cap: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / cap);
    for (let k = 1; k < n; k++) out.push([snapU(a[0] + ((b[0] - a[0]) * k) / n), snapU(a[1] + ((b[1] - a[1]) * k) / n)]);
  }
  return out;
}

export interface CappedMesh { vertices: P2[]; triangles: number[]; hull: number; outline: number; interior: number }

/** (G′)'s mesh for one part, in part-image px (padded image), or the contour refusal. */
export function cappedMesh(part: string, img: { width: number; height: number; data: Uint8Array | Uint8ClampedArray }, T: number, stray: number | undefined, spacing: number): CappedMesh | string {
  const alpha = new Uint8Array(img.width * img.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
  const params: ContourParams = { threshold: ART_ALPHA, tolerance: T, margin: T, spacing, regions: [], ...(stray === undefined ? {} : { stray }) };
  const cm = contourMesh(part, { width: img.width, height: img.height, alpha }, params);
  if (Array.isArray(cm)) return cm.map((p) => `${p.code} ${p.detail}`).join('; ');
  const ring = capOutline(cm.vertices.slice(0, cm.hull).map((v) => [v[0], v[1]] as P2), spacing);
  const interior = cm.vertices.slice(cm.hull).map((v) => [v[0], v[1]] as P2);
  const pts = [...ring, ...interior];
  const cons: Array<[number, number]> = ring.map((_, i) => [i, (i + 1) % ring.length]);
  const tri = cdt(pts, ring.length, cons);
  return { vertices: pts, triangles: counterClockwiseInSpineWorld(tri), hull: ring.length, outline: cm.hull, interior: interior.length };
}

/** (G′): (L)'s rig with every lattice part's mesh replaced by {@link cappedMesh}'s, weighted by the rig stage's distance rule. */
export function cappedRig(arm0: string, out: string, config: Obj, parts: readonly PartBox[], geom: Geometry, T: number, spacing: number): EdgePart[] {
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
    const mesh = cappedMesh(part, readPng(join(arm0, 'rig', 'images', att.image as string)), T, dust.stray, spacing);
    if (typeof mesh === 'string') {
      rows.push({ part, mode: 'grid', note: `kept the lattice: the outline is refused — ${mesh}`, triangles: null, lines: null });
      continue;
    }
    const offset: P2 = [box.x - PAD, box.y - PAD];
    const segs: Segment[] = resolveSegments(config, part).map((sg) => ({ bone: sg.bone, a: sg.a, b: sg.b }));
    const uvs = att.uvs as number[];
    const setup = geom.setup.get(part) as number[];
    const from: P2[] = [];
    const to: P2[] = [];
    for (let i = 0; i < uvs.length; i += 2) {
      from.push([uvs[i] * w, uvs[i + 1] * h]);
      to.push([setup[i], setup[i + 1]]);
    }
    const toWorld = fitAffine(from, to);
    const exponent = typeof m.exponent === 'number' ? m.exponent : undefined;
    const weights = mesh.vertices.map((v) => weightsAt(v, offset, segs, m.r as number, toWorld, geom.setupBones, exponent));
    skin[part] = { [part]: { ...att, uvs: mesh.vertices.flatMap(([x, y]) => [pyRound(x / w, 6), pyRound(y / h, 6)]), triangles: mesh.triangles, hull: mesh.hull, weights: weights as unknown as Json } };
    rows.push({ part, mode: `outline capped at ${spacing}`, note: `outline ${mesh.outline} -> ${mesh.hull} vertices, ${mesh.interior} interior`, triangles: mesh.triangles.length / 3, lines: null });
  }
  writeFileSync(rigPath, rigJsonText(rig));
  return rows;
}

/**
 * The weight rule with its top-4 cap and 0.03 floor lifted (diagnosis 2, PR #283, `tools/tip_survey.ts`'s
 * `UNCAPPED`): every segment's share kept, none dropped. The rule is #284's to change; this tool only reads under it.
 */
export const UNCAPPED: InfluenceLimits = { maxInfluences: Number.MAX_SAFE_INTEGER, minWeight: 0 };

/**
 * A built arm's rig with every lattice part's mesh (the parts `grid` in the tracked config, whatever mode the arm put
 * them in) reweighted under {@link UNCAPPED}: each vertex at its own position, bound in each bone's setup frame. The
 * mesh, its triangles and every other attachment stay as built.
 */
export function liftRig(armRig: string, out: string, config: Obj, parts: readonly PartBox[], geom: Geometry): void {
  rmSync(out, { recursive: true, force: true });
  cpSync(armRig, out, { recursive: true });
  const rigPath = join(out, 'rig.json');
  const rig = o(readJ(rigPath));
  const skin = o(o(rig.skins).default);
  for (const [part, m0] of Object.entries(o(config.meshes))) {
    const m = o(m0);
    if (!('grid' in m)) continue;
    const att = o(o(skin[part])[part]);
    if (att.type !== 'mesh') continue;
    const box = parts.find((p) => p.name === part) as PartBox;
    const [w, h] = [att.width as number, att.height as number];
    const uvs = att.uvs as number[];
    const V: P2[] = [];
    for (let i = 0; i < uvs.length; i += 2) V.push([snapU(uvs[i] * w), snapU(uvs[i + 1] * h)]);
    const setup = geom.setup.get(part) as number[];
    const toWorld = fitAffine(V, V.map((_, i) => [setup[2 * i], setup[2 * i + 1]] as P2));
    const segs: Segment[] = resolveSegments(config, part).map((sg) => ({ bone: sg.bone, a: sg.a, b: sg.b }));
    const exponent = typeof m.exponent === 'number' ? m.exponent : undefined;
    att.weights = V.map((v) => weightsAt(v, [box.x - PAD, box.y - PAD], segs, m.r as number, toWorld, geom.setupBones, exponent, UNCAPPED)) as unknown as Json;
  }
  writeFileSync(rigPath, rigJsonText(rig));
}

/** The lattice at one spacing for every `grid` mesh. */
function latticeAt(config: Obj, spacing: number): Obj {
  const out = JSON.parse(JSON.stringify(config)) as Obj;
  for (const m of Object.values(o(out.meshes))) if ('grid' in o(m)) o(m).grid = spacing;
  return out;
}

export function runOutline(key: string, configPath: string, inputs: string, work: string, film: boolean, requirements: string | null): Obj {
  const config = o(readJ(configPath));
  const arm0 = join(work, 'arm0');
  const parts = partBoxes(join(arm0, 'parts.json'));
  const H = figureHeight(parts).height;
  const T = outlineTolerance(H);
  const S = Math.round(H / SPACING_DIVISOR);
  const sets = film ? ['fallback', 'film'] : ['fallback'];
  const latG = renderGeometry(join(arm0, 'check', 'build'), join(work, 'render-L'));
  if (typeof latG === 'string') throw new Error(`outline_survey: the lattice of ${key} did not render: ${latG}`);
  const log = (s: string): void => void process.stderr.write(`[${key}] ${s}\n`);
  const reqArgs = requirements === null ? [] : ['--requirements', requirements];
  const arms: Obj[] = [];
  // the lifted rows read the idle against the lifted lattice, rendered once it is built
  let latLifted: Geometry | null = null;
  const add = (name: string, dir: string, r: { exit: number; log: string }, rows: EdgePart[], build: string): void => {
    const mres = measured(name, null, dir, r, rows.map((x) => `${x.part} -> ${x.mode}${x.note === '' ? '' : ` (${x.note})`}`), name === 'L' ? null : latG, [], true);
    const dense = denseReadings(config, arm0, parts, latG, build, work, name.replace(/[^A-Za-z]/g, ''), sets);
    arms.push({ arm: name, rule: 'as built', result: mres.result as unknown as Json, rows: rows as unknown as Json, dense: dense as unknown as Json });
    // the same arm with the cap and the floor lifted on its lattice parts: reweighted, checked, read against the lifted reference
    const geom = renderGeometry(build, join(work, `render-${name.replace(/[^A-Za-z]/g, '')}-asbuilt`));
    if (typeof geom === 'string') return;
    const ldir = join(work, `outline-${name.replace(/[^A-Za-z]/g, '')}-lifted`);
    rmSync(ldir, { recursive: true, force: true });
    mkdirSync(ldir, { recursive: true });
    log(`${name}, lifted: reweight, check`);
    liftRig(join(dir, 'rig'), join(ldir, 'rig'), config, parts, geom);
    const rc = stage(join(ldir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(ldir, 'rig'), '--out', join(ldir, 'check'), '--parts', arm0, ...reqArgs]);
    const lbuild = join(ldir, 'check', 'build');
    if (name === 'L') {
      const lg = renderGeometry(lbuild, join(work, 'render-L-lifted-base'));
      latLifted = typeof lg === 'string' ? null : lg;
    }
    const lres = measured(`${name} lifted`, null, ldir, { exit: rc.exit, log: rc.log.split('\n').map((l) => `[check] ${l}`).join('\n') }, [], name === 'L' ? null : latLifted, [], true);
    const ldense = denseReadings(config, arm0, parts, latG, lbuild, work, `${name.replace(/[^A-Za-z]/g, '')}lifted`, sets, UNCAPPED);
    arms.push({ arm: `${name} lifted`, rule: 'cap and floor lifted', result: lres.result as unknown as Json, rows: [] as unknown as Json, dense: ldense as unknown as Json });
  };
  const build = (name: string, cfg: Obj, rows: EdgePart[]): void => {
    const dir = join(work, `outline-${name}`);
    const at = stageCfg(configPath, cfg, join(work, `cfg-${name}`));
    log(`${name}: build`);
    const r = stage(dir, false, 'bun', [join(ROOT, 'cli.ts'), 'build', '--config', at, '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', dir, ...reqArgs]);
    add(name, dir, r, rows, join(dir, 'check', 'build'));
  };
  log('L: read');
  add('L', arm0, { exit: Number(readFileSync(`${arm0}.exit`, 'utf8')), log: readFileSync(`${arm0}.log`, 'utf8') }, [], join(arm0, 'check', 'build'));
  build('LS', latticeAt(config, S), []);
  {
    const g = gridConfig(config, arm0, parts, T, S);
    build('G', g.config, g.rows);
  }
  {
    const dir = join(work, 'outline-Gcap');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    log("G': mesh, check");
    const rows = cappedRig(arm0, join(dir, 'rig'), config, parts, latG, T, S);
    const rc = stage(join(dir, 'check'), false, 'bun', [join(ROOT, 'cli.ts'), 'check', '--rig', join(dir, 'rig'), '--out', join(dir, 'check'), '--parts', arm0, ...reqArgs]);
    add("G'", dir, { exit: rc.exit, log: rc.log.split('\n').map((l) => `[check] ${l}`).join('\n') }, rows, join(dir, 'check', 'build'));
  }
  return { key, T, spacing: S, sets, arms: arms as unknown as Json };
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const fx = (v: number, n: number): string => v.toFixed(n);

export function renderOutline(docs: Obj[]): string {
  const L: string[] = [];
  L.push("# The capped outline around a coarse grid (issue #265, (G′))");
  L.push('');
  L.push(`Generated by \`tools/outline_survey.ts --page\`; every figure is the tool's. The arms are in its header: (L) today's lattice; (LS) the lattice at the figure's spacing S = round(H / ${SPACING_DIVISOR}); (G) the traced outline with the contour mode's grid at S; (G′) (G)'s outline with every edge cut to at most S, around (G)'s interior. Triangles are given as a share of (LS) — the same spacing — and of (L) — today's per-part lattice — so the share each saving owes to the spacing is read off the table. Against the dense reference of \`tools/bend_survey.ts\`: the worst displacement and inverted triangles at the idle and at each bend set, and the worst bend sample as a share of (L)'s under the same rule. Each arm is read twice: under the weight rule as built, and with its top-4 cap and 0.03 floor lifted on the arm's lattice parts — the vertices reweighted and checked again, and the reference read under the same lifted rule (diagnosis 2, PR #283; the rule itself is #284's). A lifted row's idle is read against the lifted lattice.`);
  for (const doc of docs) {
    const arms = doc.arms as Obj[];
    const sets = doc.sets as string[];
    const tri = (a: Obj): number => (a.result as unknown as ArmResult).meshes.reduce((x, m) => x + m.triangles, 0);
    const byName = new Map(arms.map((a) => [a.arm as string, a]));
    const tL = tri(byName.get('L') as Obj);
    const tLS = tri(byName.get('LS') as Obj);
    const lat = (a: Obj): Obj => (byName.get((a.arm as string).endsWith(' lifted') ? 'L lifted' : 'L') ?? (byName.get('L') as Obj)) as Obj;
    const dense = (a: Obj): DenseRow[] | null => (typeof a.dense === 'string' ? null : (a.dense as unknown as DenseRow[]));
    const worst = (a: Obj, s: string): { d: number; flipped: number; part: string } | null => {
      const rows = (dense(a) ?? []).filter((x) => x.bend[s] !== undefined);
      if (rows.length === 0) return null;
      const w = rows.reduce((x, r) => (r.bend[s].displacement > x.bend[s].displacement ? r : x));
      return { d: w.bend[s].displacement, flipped: rows.reduce((x, r) => x + r.bend[s].flipped, 0), part: w.part };
    };
    L.push('');
    L.push(`## ${doc.key as string}`);
    L.push('');
    L.push(`T = ${String(doc.T)}, S = ${String(doc.spacing)}.`);
    L.push('');
    L.push(`| arm | build | triangles | of (LS) | of (L) | ${BARS.join(' | ')} | seam | overdraw | idle vs (L) | idle vs dense: worst / inverted | ${sets.map((s) => `bend ${s}: worst (of L's) / inverted (worst part)`).join(' | ')} |`);
    L.push(`| --- | --- | ---: | ---: | ---: | ${BARS.map(() => '---').join(' | ')} | --- | ---: | --- | --- | ${sets.map(() => '---').join(' | ')} |`);
    for (const a of arms) {
      const res = a.result as unknown as ArmResult;
      const T = tri(a);
      const od = overdrawOf(res.meshes);
      const d = [...res.displacement].sort((p, q) => q.max - p.max)[0];
      const dn = dense(a);
      const idleW = dn === null ? '—' : `${fx(Math.max(0, ...dn.map((x) => x.idle.displacement)), 2)} / ${dn.reduce((x, r) => x + r.idle.flipped, 0)}`;
      const bends = sets.map((s) => {
        const w = worst(a, s);
        const wl = worst(lat(a), s);
        return w === null ? '—' : `${fx(w.d, 2)} (${wl === null ? '—' : `${fx((100 * w.d) / wl.d, 1)} %`}) / ${w.flipped} (${w.part})`;
      });
      L.push(`| ${a.arm as string} | ${res.exit === 0 ? 'PASS' : `exit ${res.exit}`} | ${T} | ${fx((100 * T) / tLS, 1)} % | ${fx((100 * T) / tL, 1)} % | ${BARS.map((b) => barCell(res.check, b)).join(' | ')} | ${seamCell(res.check)} | ${od === null ? '—' : fx(od, 3)} | ${d === undefined ? '—' : `${fx(d.max, 3)} (${d.slot})`} | ${idleW} | ${bends.join(' | ')} |`);
    }
    L.push('');
    L.push(`Per lattice part — ${arms.map((a) => a.arm as string).join(' / ')}: triangles; against the dense reference, the idle's worst displacement and inverted triangles; at each bend set the worst displacement and inverted triangles.`);
    L.push('');
    L.push(`| part | triangles | idle | ${sets.map((s) => `bend ${s}`).join(' | ')} |`);
    L.push(`| --- | --- | --- | ${sets.map(() => '---').join(' | ')} |`);
    const partsAll = [...new Set(arms.flatMap((a) => (dense(a) ?? []).map((x) => x.part)))];
    for (const part of partsAll) {
      const cell = (f: (r: DenseRow) => string): string => arms.map((a) => {
        const r = (dense(a) ?? []).find((x) => x.part === part);
        return r === undefined ? '—' : f(r);
      }).join(' / ');
      const tris = arms.map((a) => (a.result as unknown as ArmResult).meshes.find((m) => m.slot === part)?.triangles ?? '—').join(' / ');
      L.push(`| ${part} | ${tris} | ${cell((r) => `${fx(r.idle.displacement, 2)}, ${r.idle.flipped}`)} | ${sets.map((s) => cell((r) => (r.bend[s] === undefined ? '—' : `${fx(r.bend[s].displacement, 2)}, ${r.bend[s].flipped}`))).join(' | ')} |`);
    }
    for (const a of arms) {
      const res = a.result as unknown as ArmResult;
      const rows = a.rows as unknown as EdgePart[];
      if (rows.length > 0) {
        L.push('');
        L.push(`Arm ${a.arm as string}, per part: ${rows.map((r) => `${r.part} ${r.mode}${r.note === '' ? '' : ` (${r.note})`}`).join('; ')}.`);
      }
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
    process.stdout.write(renderOutline(argv.slice(argv.indexOf('--page') + 1).map((f) => o(readJ(f)))));
    return;
  }
  const [key, config, inputs, work] = [flag('--key'), flag('--config'), flag('--inputs'), flag('--work')];
  if (!argv.includes('--run') || key === null || config === null || inputs === null || work === null) {
    console.error('usage: outline_survey --run --key <k> --config <cfg> --inputs <dir> --work <W> [--film] [--requirements <r>] | --page <doc.json>…');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(runOutline(key, resolve(config), resolve(inputs), resolve(work), argv.includes('--film'), flag('--requirements') === null ? null : resolve(flag('--requirements') as string)))}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
