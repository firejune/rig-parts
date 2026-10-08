#!/usr/bin/env bun
/**
 * The rig stage against the reference implementation's own outputs — a
 * test-side tool, never shipped (it is outside `files`), and it reads a corpus
 * that never enters this tree.
 *
 *     bun scripts/rig_oracle.ts <characters-dir> [--public <name>]... [--skip <name>]... [--keep <dir>]
 *
 * For every `<characters-dir>/<name>/` holding `config.json`,
 * `rig/parts.json`, `rig/parts/` and the reference's `rig/rig.json`,
 * `rig/motion.json` and `rig/mesh_report.json`, it builds the rig with
 * `src/rig.ts`, compares its flat form (`flattenRig`: the reference wrote
 * every bone unturned, and since issue #73 the rig stage turns each chain link
 * along its chain, so the built rig's offsets are carried back out of the
 * turned frames first) field by field with the reference's, and runs
 * rig-c's gate on the port's output as built, turned:
 * `build --profile spine-html --pack`,
 * `build --profile spine`, and `validate` of each build under its profile.
 *
 * ⛔ A character is printed by name only when `--public` names it; every other
 * one is printed as `C1`, `C2`, … in directory order, so the report can be
 * quoted without a private name in it.
 *
 * The configs in that corpus predate `src/config.ts`: `oldConfig` below drops
 * the fields the loader refuses and the rig stage never reads (`generation`,
 * `seethrough`, `status`) before loading. That is the one adaptation, it lives
 * here and not in `src/`, and anything else the loader refused would be
 * reported, not stripped.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { PartsError } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { encodePngBytes, readPng } from '../src/raster/png.ts';
import type { Raster } from '../src/raster/types.ts';
import { buildRig, flattenRig, rigJsonText } from '../src/rig.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The corpus-era keys the rig stage never reads and the loader refuses. */
const OLD_KEYS = ['generation', 'seethrough', 'status'];

export function oldConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!OLD_KEYS.includes(k)) out[k] = v;
  return out;
}

type Json = unknown;
type Obj = Record<string, Json>;

function num(v: Json): number {
  return typeof v === 'number' ? v : Number.NaN;
}

class Diff {
  readonly notes: string[] = [];
  maxBone = 0;
  maxUv = 0;
  maxWeight = 0;
  maxBind = 0;
  maxRegion = 0;
  maxKeyT = 0;
  maxKeyV = 0;
  maxCurve = 0;
  weightVerts = 0;
  weightBoneSetDiff = 0;
  keys = 0;
  note(s: string): void {
    if (this.notes.length < 40) this.notes.push(s);
  }
}

function compareRig(py: Obj, ts: Obj, d: Diff): void {
  const pb = py.bones as Obj[];
  const tb = ts.bones as Obj[];
  if (pb.length !== tb.length) d.note(`bones: python ${pb.length}, port ${tb.length}`);
  const n = Math.min(pb.length, tb.length);
  for (let i = 0; i < n; i++) {
    if (pb[i].name !== tb[i].name || (pb[i].parent ?? null) !== (tb[i].parent ?? null)) {
      d.note(`bone[${i}]: python ${String(pb[i].name)}<-${String(pb[i].parent)}, port ${String(tb[i].name)}<-${String(tb[i].parent)}`);
    }
    d.maxBone = Math.max(d.maxBone, Math.abs(num(pb[i].x) - num(tb[i].x)), Math.abs(num(pb[i].y) - num(tb[i].y)));
  }
  if (JSON.stringify(py.skeleton) !== JSON.stringify(ts.skeleton)) {
    const a = py.skeleton as Obj;
    const b = ts.skeleton as Obj;
    if (['x', 'y', 'width', 'height'].some((k) => num(a[k]) !== num(b[k]))) d.note(`skeleton: python ${JSON.stringify(a)}, port ${JSON.stringify(b)}`);
  }
  if (JSON.stringify(py.slots) !== JSON.stringify(ts.slots)) d.note('slots differ');
  const ps = (py.skins as Obj).default as Obj;
  const tsk = (ts.skins as Obj).default as Obj;
  if (Object.keys(ps).join() !== Object.keys(tsk).join()) d.note('skin slot keys differ');
  for (const slot of Object.keys(ps)) {
    const a = (ps[slot] as Obj)[slot] as Obj;
    const b = (tsk[slot] as Obj | undefined)?.[slot] as Obj | undefined;
    if (b === undefined) continue;
    if (a.type !== 'mesh') {
      if (a.image !== b.image) d.note(`region ${slot}: image ${String(a.image)} vs ${String(b.image)}`);
      d.maxRegion = Math.max(d.maxRegion, Math.abs(num(a.x) - num(b.x)), Math.abs(num(a.y) - num(b.y)));
      continue;
    }
    for (const k of ['width', 'height', 'hull']) if (a[k] !== b[k]) d.note(`mesh ${slot}: ${k} python ${String(a[k])}, port ${String(b[k])}`);
    const at = a.triangles as number[];
    const bt = b.triangles as number[];
    if (at.join() !== bt.join()) d.note(`mesh ${slot}: triangles differ (${at.length / 3} vs ${bt.length / 3})`);
    const au = a.uvs as number[];
    const bu = b.uvs as number[];
    if (au.length !== bu.length) d.note(`mesh ${slot}: ${au.length / 2} vs ${bu.length / 2} vertices`);
    for (let i = 0; i < Math.min(au.length, bu.length); i++) d.maxUv = Math.max(d.maxUv, Math.abs(au[i] - bu[i]));
    const aw = a.weights as Obj[][];
    const bw = b.weights as Obj[][];
    for (let v = 0; v < Math.min(aw.length, bw.length); v++) {
      d.weightVerts++;
      const names = (e: Obj[]): string => e.map((x) => String(x.bone)).join(',');
      if (names(aw[v]) !== names(bw[v])) {
        d.weightBoneSetDiff++;
        d.note(`mesh ${slot} vertex ${v}: bones python [${names(aw[v])}], port [${names(bw[v])}]`);
        continue;
      }
      for (let k = 0; k < aw[v].length; k++) {
        d.maxWeight = Math.max(d.maxWeight, Math.abs(num(aw[v][k].weight) - num(bw[v][k].weight)));
        d.maxBind = Math.max(d.maxBind, Math.abs(num(aw[v][k].x) - num(bw[v][k].x)), Math.abs(num(aw[v][k].y) - num(bw[v][k].y)));
      }
    }
  }
}

function compareMotion(py: Obj, ts: Obj, d: Diff): void {
  for (const k of ['spec', 'archetype', 'cut', 'easings', 'groups']) if (JSON.stringify(py[k]) !== JSON.stringify(ts[k])) d.note(`motion.${k}: python ${JSON.stringify(py[k])}, port ${JSON.stringify(ts[k])}`);
  const pa = (py.animations as Obj).idle as Obj;
  const ta = (ts.animations as Obj).idle as Obj;
  for (const k of ['duration', 'loop', 'note']) if (pa[k] !== ta[k]) d.note(`idle.${k} differs`);
  const pt = pa.tracks as Obj[];
  const tt = ta.tracks as Obj[];
  if (pt.length !== tt.length) d.note(`tracks: python ${pt.length}, port ${tt.length}`);
  for (let i = 0; i < Math.min(pt.length, tt.length); i++) {
    const a = pt[i];
    const b = tt[i];
    if (a.bone !== b.bone || a.group !== b.group || a.property !== b.property) d.note(`track ${i}: python ${String(a.bone ?? a.group)}.${String(a.property)}, port ${String(b.bone ?? b.group)}.${String(b.property)}`);
    const ak = a.keys as Obj[];
    const bk = b.keys as Obj[];
    if (ak.length !== bk.length) d.note(`track ${i}: ${ak.length} vs ${bk.length} keys`);
    for (let k = 0; k < Math.min(ak.length, bk.length); k++) {
      d.keys++;
      d.maxKeyT = Math.max(d.maxKeyT, Math.abs(num(ak[k].t) - num(bk[k].t)));
      d.maxKeyV = Math.max(d.maxKeyV, Math.abs(num((ak[k].v as number[])[0]) - num((bk[k].v as number[])[0])));
      if (ak[k].ease !== bk[k].ease) d.note(`track ${i} key ${k}: ease ${String(ak[k].ease)} vs ${String(bk[k].ease)}`);
      const ac = ak[k].curve as number[] | undefined;
      const bc = bk[k].curve as number[] | undefined;
      if ((ac === undefined) !== (bc === undefined)) d.note(`track ${i} key ${k}: curve present on one side only`);
      else if (ac !== undefined && bc !== undefined) for (let c = 0; c < 4; c++) d.maxCurve = Math.max(d.maxCurve, Math.abs(ac[c] - bc[c]));
    }
  }
}

function compareReport(py: Obj[], ts: Obj[], d: Diff): void {
  if (py.length !== ts.length) d.note(`mesh_report: ${py.length} vs ${ts.length} meshes`);
  for (let i = 0; i < Math.min(py.length, ts.length); i++) {
    for (const k of ['part', 'vertices', 'triangles', 'hull', 'max_influences', 'mean_influences', 'art_coverage', 'grid']) {
      if (num(py[i][k]) !== num(ts[i][k]) && py[i][k] !== ts[i][k]) d.note(`mesh_report ${String(py[i].part)}.${k}: python ${String(py[i][k])}, port ${String(ts[i][k])}`);
    }
    if (JSON.stringify(py[i].bones) !== JSON.stringify(ts[i].bones)) d.note(`mesh_report ${String(py[i].part)}.bones differ`);
  }
}

function rigc(args: string[]): { status: number; lines: string[] } {
  const r = spawnSync(join(ROOT, 'node_modules', '.bin', 'rigc'), args, { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
  return { status: r.status ?? 1, lines: out.filter((l) => /^ {2}FAIL {2}/.test(l) || /assertions: \d+ measured/.test(l) || /compile error/.test(l)).map((l) => l.trim()) };
}

function main(): number {
  const argv = process.argv.slice(2);
  const dir = argv[0];
  if (dir === undefined || !existsSync(dir)) {
    console.log('usage: bun scripts/rig_oracle.ts <characters-dir> [--public <name>]... [--skip <name>]... [--keep <dir>]');
    return 2;
  }
  const pub = new Set<string>();
  const skip = new Set<string>();
  let keep: string | null = null;
  for (let i = 1; i < argv.length; i += 2) {
    if (argv[i] === '--public') pub.add(argv[i + 1]);
    else if (argv[i] === '--skip') skip.add(argv[i + 1]);
    else if (argv[i] === '--keep') keep = argv[i + 1];
  }
  let alias = 0;
  let red = 0;
  for (const name of readdirSync(dir).sort()) {
    const c = join(dir, name);
    if (!statSync(c).isDirectory() || skip.has(name) || name.startsWith('_')) continue;
    const need = ['config.json', 'rig/parts.json', 'rig/rig.json', 'rig/motion.json', 'rig/mesh_report.json', 'rig/parts'];
    if (!need.every((f) => existsSync(join(c, f)))) continue;
    const label = pub.has(name) ? name : `C${++alias}`;
    console.log(`\n== ${label}`);
    const d = new Diff();
    const out = keep !== null ? join(keep, label) : mkdtempSync(join(tmpdir(), 'rig-oracle-'));
    try {
      const cfg = parseConfig(oldConfig(JSON.parse(readFileSync(join(c, 'config.json'), 'utf8')) as Record<string, unknown>));
      const parts = readParts(join(c, 'rig/parts.json'));
      const images = new Map<string, Raster>();
      for (const p of parts.parts) {
        const f = join(c, 'rig/parts', `${p.name}.png`);
        if (existsSync(f)) images.set(p.name, readPng(f));
      }
      const r = buildRig(cfg, parts, images);
      const again = buildRig(cfg, parts, images);
      const texts = [rigJsonText(r.rig), rigJsonText(r.motion), rigJsonText(r.meshReport)];
      const texts2 = [rigJsonText(again.rig), rigJsonText(again.motion), rigJsonText(again.meshReport)];
      const deterministic = texts.every((t, i) => t === texts2[i]);
      mkdirSync(join(out, 'images'), { recursive: true });
      for (const [f, img] of r.images) writeFileSync(join(out, 'images', f), encodePngBytes(img));
      writeFileSync(join(out, 'rig.json'), texts[0]);
      writeFileSync(join(out, 'motion.json'), texts[1]);
      writeFileSync(join(out, 'mesh_report.json'), texts[2]);
      // Every padded image against the reference's images/.
      let imgSame = 0;
      for (const [f, img] of r.images) {
        const ref = join(c, 'rig/images', f);
        if (!existsSync(ref)) continue;
        const pyImg = readPng(ref);
        if (pyImg.width === img.width && pyImg.height === img.height && pyImg.data.every((v, k) => v === img.data[k])) imgSame++;
      }
      compareRig(JSON.parse(readFileSync(join(c, 'rig/rig.json'), 'utf8')) as Obj, flattenRig(r.rig) as unknown as Obj, d);
      compareMotion(JSON.parse(readFileSync(join(c, 'rig/motion.json'), 'utf8')) as Obj, r.motion as unknown as Obj, d);
      compareReport(JSON.parse(readFileSync(join(c, 'rig/mesh_report.json'), 'utf8')) as Obj[], r.meshReport as unknown as Obj[], d);
      const meshes = r.meshReport.length;
      const vtx = r.meshReport.reduce((s, m) => s + m.vertices, 0);
      const tri = r.meshReport.reduce((s, m) => s + m.triangles, 0);
      console.log(
        `  port: bones ${r.rig.bones.length} (${r.controls.length} control), slots ${r.rig.slots.length}, meshes ${meshes} (${vtx} vertices, ${tri} triangles), ` +
          `regions ${r.rig.slots.length - meshes}, tracks ${r.motion.animations.idle.tracks.length}, keys ${d.keys}; images identical to the reference ${imgSame}/${r.images.length}; deterministic ${deterministic}; one-loop passes per mesh ${Object.values(r.loopPasses).join(',')}`,
      );
      console.log(
        `  max |diff|: bone xy ${d.maxBone}, region xy ${d.maxRegion}, uv ${d.maxUv}, bind xy ${d.maxBind}, weight ${d.maxWeight} over ${d.weightVerts} vertices ` +
          `(${d.weightBoneSetDiff} with a different bone list), key t ${d.maxKeyT}, key v ${d.maxKeyV}, curve ${d.maxCurve}`,
      );
      console.log(`  structural differences: ${d.notes.length === 0 ? 'none' : ''}`);
      for (const n of d.notes) console.log(`    ${n}`);
      const html = join(out, 'build-html');
      const spine = join(out, 'build-spine');
      const gates: Array<[string, { status: number; lines: string[] }]> = [
        ['build spine-html --pack', rigc(['build', '--rig', join(out, 'rig.json'), '--motion', join(out, 'motion.json'), '--out', html, '--profile', 'spine-html', '--pack'])],
        ['build spine', rigc(['build', '--rig', join(out, 'rig.json'), '--motion', join(out, 'motion.json'), '--out', spine, '--profile', 'spine'])],
      ];
      gates.push(['validate spine-html', rigc(['validate', html, '--profile', 'spine-html'])]);
      gates.push(['validate spine', rigc(['validate', spine, '--profile', 'spine'])]);
      for (const [g, res] of gates) {
        console.log(`  rigc ${g}: exit ${res.status}`);
        for (const l of res.lines) console.log(`    ${l}`);
        if (res.status !== 0) red++;
      }
      if (!deterministic) red++;
    } catch (err) {
      red++;
      if (err instanceof PartsError) for (const p of err.problems) console.log(`  REFUSED ${p.code}: ${p.object} — ${p.detail}`);
      else console.log(`  CRASHED ${(err as Error).stack ?? String(err)}`);
    } finally {
      if (keep === null) rmSync(out, { recursive: true, force: true });
    }
  }
  console.log(`\nrig oracle: ${red === 0 ? 'green' : `${red} red gate(s)`}`);
  return red === 0 ? 0 : 1;
}

process.exit(main());
