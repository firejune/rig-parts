#!/usr/bin/env bun
/**
 * spine-parts — one painting and its See-through layers in, Spine-ready parts
 * and rig specs out, verified through spine-rigc.
 *
 * Every command prints named, numeric findings and nothing else an agent has
 * to interpret: a refusal is a `FAIL` line naming the rule, the object, the
 * value found and the value required. Exit codes are part of that interface:
 *
 *   0  the command did what it says
 *   1  it refused its input — every refusal is printed as a FAIL line
 *   2  a usage error, or a command this version does not implement
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnimFrame, EncodeError, encodeApng } from './src/apng.ts';
import { findRigc, readFrameSet, type RigcRunner, runCheck, SEAM_MEAN_BAR, SEAM_PX_BAR, SEAM_PX_LEVEL, SEAM_PX_LEVEL_HIGH, SPINEBOY_YARDSTICK } from './src/check.ts';
import { type CharacterConfig, loadConfig } from './src/config.ts';
import { PartsError, type Problem, problemLine } from './src/errors.ts';
import { encodeGif } from './src/gif.ts';
import { proposeHeadBox } from './src/headbox.ts';
import { type LayerSet, readLayers } from './src/layers.ts';
import { readParts } from './src/parts.ts';
import { checkProposal, compare, compareLines, drawLandmarks, lint, lintLine, type PartSet, propose, readPartSet, serializeProposal } from './src/propose.ts';
import type { Raster } from './src/raster/types.ts';
import { encodePngBytes, readPng, writePng } from './src/raster/png.ts';
import { buildRig, rigJsonText, type RigOutput } from './src/rig.ts';
import { buildSheet, defaultCaption, type Tile, tilesFrom } from './src/sheet.ts';

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;

function version(): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? '(no version field)';
}

/**
 * The commands a later version will carry, registered now so the surface and
 * the help are honest about what exists. Each one exits 2 with the same
 * sentence, and the selftest holds every name here to that.
 */
const LATER: ReadonlyArray<[string, string]> = [
  ['assemble', 'merge the See-through runs into rig-space parts/*.png + parts.json'],
  ['build', 'assemble, rig and check in one pass'],
  ['comfy', 'drive ComfyUI for the painting and the See-through runs (optional)'],
];

const HELP = `spine-parts ${version()} — Spine-ready parts from one painting and its See-through layers

usage:
  spine-parts layers <dir | layers.json | file.psd>
      Read a See-through decomposition — the ComfyUI wrapper form (a directory
      holding layers.json and one PNG per layer) or an upstream .psd — and print
      every layer: draw order, name, tag group, box, size, opaque pixels, depth.
      Refuses, by name, a missing file, an unknown tag, a PNG whose size is not
      its box, and anything else outside the input contract.

  spine-parts sheet --source <painting.png> --layers <path> [--layers <path> ...]
                    --out <sheet.png> [--cell <px>] [--cols <n>]
      A contact sheet: the painting, then every layer or part, each on a
      checkerboard and labelled with its name, size and opaque pixel count.
      --layers takes anything \`layers\` reads, or a parts.json (its PNGs are read
      from parts/ beside it). --cell defaults to 220, --cols to 8; both are
      printed. The same information is printed as text.

  spine-parts propose --parts <dir> --source <painting.png> --out <dir> [--compare <config.json>]
      Propose bones, meshes, regions and an idle from the assembled parts (<dir>
      holds parts.json and parts/). Roles come from each part's See-through tag,
      never its name. Writes <out>/proposal.json (config-shaped: bones, meshes,
      regions, motion with its blink, and notes) and the overlay to correct
      against, <out>/render/landmarks.png and landmarks_head.png. Prints every
      note and a LINT line for each chain link that lies off its mesh's art.
      --compare prints each shared bone's distance, proposal to config, in px.

  spine-parts propose --parts <dir> --source <painting.png> --out <dir> --from-config <config.json>
      Draw the config's CURRENT bones instead (<out>/render/landmarks_config.png
      and _head) and LINT them. Exits 1 when any LINT line is printed.

  spine-parts propose --head-box --full <dir | layers.json | file.psd> --canvas <W>x<H>
      Propose seethrough.head_box (source px, square) from the full run's
      layers for a painting of WxH px, held inside the painting; a shift is
      printed when one was needed.

  spine-parts rig --config <config.json> --parts <dir> --out <dir>
      Author the rig: unrotated bones at the config's landmarks (a chain makes
      <chain>0..n), a square lattice mesh over every part in config.meshes
      weighted by distance to its candidate bone segments, a region for every
      part in config.regions, and one idle of sines and a blink. --parts is the
      directory holding parts.json and parts/<name>.png. The result is built
      through spine-rigc (profile spine-html, packed, then validated under
      profile spine) in a scratch directory first, and --out receives
      images/*.png, rig.json, motion.json and mesh_report.json only when both
      are green. Prints one line per mesh and the rigc gate lines.
  spine-parts check --rig <dir> --out <dir>
      Build, gate, render and measure a rig through spine-rigc's CLI (the rigc at
      node_modules/.bin/rigc, or on PATH). --rig holds rig.json, motion.json
      (with an "idle"), parts.json and parts/; it is only read. Into --out:
      build/ (rigc build --profile spine-html --pack: the packed atlas is the
      artifact), gate_spine-html.txt and gate_spine.txt (the gate lines
      verbatim), idle_frames/ (rigc render --animation idle --fps 12 --max 640),
      contact.png, motion_heat.png and check.json. PASS needs both gates
      "0 failed", the seam (setup pose vs the flat composite of parts/) at mean
      |d| <= ${SEAM_MEAN_BAR.toFixed(1)} with <= ${SEAM_PX_BAR} px over ${SEAM_PX_LEVEL}, and the loop (idle frame 0 vs the
      frame at t = duration) at max |d| 0. Prints the pack line beside the
      spineboy yardstick (${SPINEBOY_YARDSTICK}), a reference and not a bar.
      Exit 0 on PASS, 1 on FAIL — every FAIL line names the bar, the value and the
      value required.

  spine-parts loop --frames <dir> --out <file.png | file.gif>
      Encode a frame set rigc render wrote (its --out directory, or the set
      directory inside it) as a looping animation: .png writes an APNG
      (acTL/fcTL/fdAT, lossless), .gif a GIF89a (one 255-colour median-cut
      palette, no dithering, LZW, delays rounded so the loop's length is exact).
      The fps is read from frames.json. When the last frame equals frame 0 it is
      dropped, and the output says so: the loop wraps onto frame 0 itself.
      Animated WebP is not written — it needs a VP8/VP8L encoder, out of scope.

  spine-parts --version
  spine-parts --help

not implemented in this version (each exits 2):
${LATER.map(([name, what]) => `  ${name.padEnd(9)} ${what}`).join('\n')}

exit codes: 0 done, 1 input refused (FAIL lines name every reason), 2 usage or not implemented
`;

function printRefusal(err: unknown): number {
  if (err instanceof PartsError) {
    for (const p of err.problems) console.log(`  FAIL  ${problemLine(p)}`);
    console.log(`refused: ${err.problems.length} problem(s)`);
    return EXIT_REFUSED;
  }
  throw err;
}

function usage(message: string): number {
  console.log(`  FAIL  USAGE: ${message}`);
  console.log('spine-parts --help lists the commands');
  return EXIT_USAGE;
}

function fixed(v: number | null): string {
  return v === null ? '-' : v.toFixed(4);
}

function printLayerTable(set: LayerSet): void {
  console.log(`spine-parts layers: ${set.form === 'wrapper' ? 'ComfyUI wrapper form' : 'PSD'}, ${set.source}`);
  console.log(`  canvas ${set.canvas.w}x${set.canvas.h}, ${set.layers.length} layer(s), back to front`);
  const rows = set.layers.map((l) => [
    String(l.drawOrder),
    l.name,
    l.tag.group,
    `${l.left},${l.top}`,
    `${l.right},${l.bottom}`,
    `${l.pixels.width}x${l.pixels.height}`,
    String(l.opaquePx),
    fixed(l.depth),
  ]);
  const head = ['order', 'name', 'group', 'left,top', 'right,bottom', 'size', 'opaque_px', 'depth'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string => `  ${cells.map((c, i) => c.padEnd(widths[i])).join('  ')}`.trimEnd();
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  const painted = set.layers.filter((l) => l.opaquePx > 0).length;
  console.log(`  ${set.layers.length} layer(s): ${painted} with opaque pixels, ${set.layers.length - painted} with none`);
}

function cmdLayers(args: string[]): number {
  if (args.length !== 1) return usage(`layers takes one path; got ${args.length}`);
  try {
    printLayerTable(readLayers(args[0]));
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function cmdSheet(args: string[]): number {
  const layers: string[] = [];
  let source: string | null = null;
  let out: string | null = null;
  let cell = 220;
  let cols = 8;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--source', '--layers', '--out', '--cell', '--cols'].includes(flag)) return usage(`sheet does not take "${flag}"`);
    if (value === undefined) return usage(`${flag} needs a value`);
    i++;
    if (flag === '--source') source = value;
    else if (flag === '--layers') layers.push(value);
    else if (flag === '--out') out = value;
    else {
      const n = Number(value);
      if (!Number.isInteger(n) || n < (flag === '--cell' ? 40 : 1)) {
        return usage(`${flag} ${value} is not an integer of at least ${flag === '--cell' ? 40 : 1}`);
      }
      if (flag === '--cell') cell = n;
      else cols = n;
    }
  }
  if (source === null) return usage('sheet needs --source <painting.png>');
  if (layers.length === 0) return usage('sheet needs at least one --layers <path>');
  if (out === null) return usage('sheet needs --out <sheet.png>');
  if (extname(out).toLowerCase() !== '.png') return usage(`--out ${out} is not a .png; the sheet is written as PNG only`);
  try {
    if (!existsSync(source)) {
      throw new PartsError([{ code: 'SHEET_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is the first tile' }]);
    }
    const src = readPng(source);
    const tiles: Tile[] = [{ name: 'source', image: src, caption: basename(source) }];
    for (const path of layers) tiles.push(...tilesFrom(path));
    const sheet = buildSheet(tiles, cols, cell);
    writePng(out, sheet);
    console.log(`spine-parts sheet: ${out}`);
    console.log(`  ${tiles.length} tile(s) in ${cols} column(s) of ${cell} px, sheet ${sheet.width}x${sheet.height}`);
    tiles.forEach((t, i) => console.log(`  tile ${String(i).padStart(3)}  ${t.name}  ${t.caption ?? defaultCaption(t.image)}`));
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

/** spine-rigc's own CLI, resolved the way this package resolves every other rigc path. */
function rigcCli(): string {
  return fileURLToPath(import.meta.resolve('spine-rigc/cli.ts'));
}

interface GateRun {
  label: string;
  status: number;
  /** rigc's FAIL lines and its assertion summary, as it printed them. */
  lines: string[];
}

function runRigc(label: string, args: string[]): GateRun {
  const r = spawnSync(process.execPath, [rigcCli(), ...args], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
  const lines = out.filter((l) => /^ {2}FAIL {2}/.test(l) || /assertions: \d+ measured/.test(l) || /^rigc compile error/.test(l));
  return { label, status: r.status ?? 1, lines };
}

/**
 * spine-rigc's round trip over the rig in a scratch directory: `build` under
 * the spine-html profile with `--pack`, then `validate` of that build under
 * the spine profile. The files are staged exactly as `--out` will receive
 * them, so what passed is what is written.
 */
function gateThroughRigc(out: RigOutput, texts: Array<[string, string]>): GateRun[] {
  const stage = mkdtempSync(join(tmpdir(), 'spine-parts-rig-'));
  try {
    mkdirSync(join(stage, 'images'));
    for (const [file, img] of out.images) writeFileSync(join(stage, 'images', file), encodePngBytes(img));
    for (const [file, text] of texts) writeFileSync(join(stage, file), text);
    const build = join(stage, 'build');
    const html = runRigc('build --profile spine-html --pack', [
      'build', '--rig', join(stage, 'rig.json'), '--motion', join(stage, 'motion.json'), '--out', build, '--profile', 'spine-html', '--pack',
    ]);
    if (html.status !== 0) return [html];
    return [html, runRigc('validate --profile spine', ['validate', build, '--profile', 'spine'])];
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function cmdRig(args: string[]): number {
  let config: string | null = null;
  let partsDir: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--config', '--parts', '--out'].includes(flag)) return usage(`rig does not take "${flag}"`);
    if (value === undefined) return usage(`${flag} needs a value`);
    i++;
    if (flag === '--config') config = value;
    else if (flag === '--parts') partsDir = value;
    else out = value;
  }
  if (config === null) return usage('rig needs --config <config.json>');
  if (partsDir === null) return usage('rig needs --parts <dir> (the directory holding parts.json and parts/)');
  if (out === null) return usage('rig needs --out <dir>');
  try {
    const cfg = loadConfig(config);
    const partsPath = join(partsDir, 'parts.json');
    const parts = readParts(partsPath);
    const images = new Map<string, Raster>();
    for (const p of parts.parts) {
      const png = join(partsDir, 'parts', `${p.name}.png`);
      if (existsSync(png)) images.set(p.name, readPng(png));
    }
    const rig = buildRig(cfg, parts, images);
    const texts: Array<[string, string]> = [
      ['rig.json', rigJsonText(rig.rig)],
      ['motion.json', rigJsonText(rig.motion)],
      ['mesh_report.json', rigJsonText(rig.meshReport)],
    ];
    console.log(`spine-parts rig: ${cfg.key}, rig ${parts.rig_size[0]}x${parts.rig_size[1]}, ${parts.parts.length} part(s)`);
    let vertices = 0;
    for (const m of rig.meshReport) {
      vertices += m.vertices;
      console.log(
        `  mesh ${m.part.padEnd(12)} v=${String(m.vertices).padStart(4)} t=${String(m.triangles).padStart(4)} hull=${String(m.hull).padStart(3)} ` +
          `grid=${m.grid} bones=${m.bones.length} infl max ${m.max_influences} mean ${m.mean_influences.toFixed(2)} cover ${m.art_coverage.toFixed(5)} loop passes ${rig.loopPasses[m.part]}`,
      );
    }
    const regions = rig.rig.slots.length - rig.meshReport.length;
    const tracks = rig.motion.animations.idle.tracks;
    const keys = tracks.reduce((n, t) => n + t.keys.length, 0);
    console.log(
      `  bones ${rig.rig.bones.length} (${rig.controls.length} control) slots ${rig.rig.slots.length} meshes ${rig.meshReport.length} regions ${regions} vertices ${vertices}; idle ${rig.motion.animations.idle.duration} s, ${tracks.length} track(s), ${keys} key(s)`,
    );
    const gate = gateThroughRigc(rig, texts);
    for (const g of gate) {
      console.log(`  rigc ${g.label}: exit ${g.status}`);
      for (const l of g.lines) console.log(`    ${l.trim()}`);
    }
    const red = gate.filter((g) => g.status !== 0);
    if (red.length > 0) {
      const problems: Problem[] = red.map((g) => ({
        code: 'RIG_RIGC_GREEN',
        object: `rigc ${g.label}`,
        detail: `exited ${g.status}${g.lines.length > 0 ? `: ${g.lines.map((l) => l.trim()).join(' | ')}` : ''}; exit 0 is required before anything is written, and nothing was`,
      }));
      throw new PartsError(problems);
    }
    mkdirSync(join(out, 'images'), { recursive: true });
    for (const [file, img] of rig.images) writePng(join(out, 'images', file), img);
    for (const [file, text] of texts) writeFileSync(join(out, file), text);
    console.log(`spine-parts rig: wrote ${join(out, 'rig.json')}, motion.json, mesh_report.json and ${rig.images.length} image(s) under ${join(out, 'images')}`);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

/** The rigc process: `src/check.ts` is pure and takes the spawn from here. */
function rigcRunner(bin: string): RigcRunner {
  return (args) => {
    const r = spawnSync(bin, [...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.error !== undefined) return { status: 127, out: `could not start ${bin}: ${r.error.message}` };
    return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
}

function flags(args: string[], known: readonly string[], command: string): Map<string, string> | string {
  const got = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!known.includes(flag)) return `${command} does not take "${flag}"; it takes ${known.join(', ')}`;
    if (args[i + 1] === undefined) return `${flag} needs a value`;
    if (got.has(flag)) return `${flag} is given twice`;
    got.set(flag, args[i + 1]);
  }
  for (const k of known) if (!got.has(k)) return `${command} needs ${k} <value>`;
  return got;
}

function cmdCheck(args: string[]): number {
  const f = flags(args, ['--rig', '--out'], 'check');
  if (typeof f === 'string') return usage(f);
  const rig = f.get('--rig') as string;
  const out = f.get('--out') as string;
  try {
    const bin = findRigc(import.meta.dir, process.env.PATH ?? '');
    const run = rigcRunner(bin);
    const v = run(['--version']);
    console.log(`spine-parts check: ${rig} -> ${out}`);
    console.log(`  rigc ${v.out.trim().split('\n')[0]} at ${bin}`);
    const r = runCheck(rig, out, run);
    console.log('  gate spine-html (rigc build --profile spine-html --pack), verbatim:');
    for (const l of r.gateHtml) console.log(l);
    console.log('  gate spine (rigc validate build --profile spine), verbatim:');
    for (const l of r.gateSpine) console.log(l);
    if (r.pack.length === 0) console.log('  pack: no pack line in the build output');
    for (const p of r.pack) {
      const op = r.packOpaque.find((o) => o.page === p.page);
      console.log(`  ${p.line}; page opaque ${op === undefined ? 'not measured (page not on disk)' : `${(op.share * 100).toFixed(1)}%`} (alpha > 0) — spineboy yardstick ${SPINEBOY_YARDSTICK}, a reference and not a bar`);
    }
    const fig = r.figures;
    console.log(`  loop: idle ${r.idle.frames} frame(s) at ${r.idle.fps} fps, f0000 vs f${String(r.idle.lastIndex).padStart(4, '0')} (t = ${r.idle.duration}s): max |d| ${fig.loop_max_diff} (0 required)`);
    console.log(
      `  seam: setup pose at ${r.seamViewport.pixelWidth}x${r.seamViewport.pixelHeight}, scale ${r.seamViewport.scale.toFixed(4)}: mean |d| ${fig.seam_mean} (<= ${SEAM_MEAN_BAR.toFixed(1)}), ` +
        `${fig.seam_px_over_40} px over ${SEAM_PX_LEVEL} (<= ${SEAM_PX_BAR}), ${fig.seam_px_over_80} px over ${SEAM_PX_LEVEL_HIGH} (reported)`,
    );
    console.log(`  gates: spine-html ${fig.gate_spine_html_green ? 'green' : 'RED'}, spine ${fig.gate_spine_green ? 'green' : 'RED'}`);
    console.log(`  wrote ${r.written.map((w) => join(out, w)).join(', ')}, ${join(out, 'build')}/, ${join(out, 'idle_frames')}/`);
    for (const p of r.problems) console.log(`  FAIL  ${problemLine(p)}`);
    console.log(fig.PASS ? 'check: PASS' : `check: FAIL — ${r.problems.length} bar(s) not met`);
    return fig.PASS ? EXIT_OK : EXIT_REFUSED;
  } catch (err) {
    return printRefusal(err);
  }
}

function parseCanvas(v: string): { w: number; h: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(v);
  return m === null ? null : { w: Number(m[1]), h: Number(m[2]) };
}

function printLint(P: PartSet, spec: { bones: CharacterConfig['bones']; meshes: CharacterConfig['meshes'] }): number {
  const res = lint(P, spec);
  for (const f of res.findings) console.log(lintLine(f));
  for (const m of res.unknownMeshes) console.log(`note: mesh ${JSON.stringify(m)} names no part in parts.json, so it was not linted`);
  console.log(`${res.findings.length} LINT line(s) over ${Object.keys(spec.meshes).length - res.unknownMeshes.length} mesh(es)`);
  return res.findings.length;
}

function cmdPropose(args: string[]): number {
  const flags = new Map<string, string>();
  let headBox = false;
  const valued = ['--parts', '--source', '--out', '--from-config', '--compare', '--full', '--canvas'];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--head-box') {
      headBox = true;
      continue;
    }
    if (!valued.includes(flag)) return usage(`propose does not take "${flag}"; it takes --head-box and ${valued.join(', ')}`);
    const value = args[i + 1];
    if (value === undefined) return usage(`${flag} needs a value`);
    if (flags.has(flag)) return usage(`${flag} is given twice`);
    flags.set(flag, value);
    i++;
  }
  try {
    if (headBox) {
      const stray = [...flags.keys()].filter((f) => f !== '--full' && f !== '--canvas');
      if (stray.length > 0) return usage(`--head-box takes --full and --canvas only; got ${stray.join(', ')}`);
      const full = flags.get('--full');
      const canvasArg = flags.get('--canvas');
      if (full === undefined) return usage('--head-box needs --full <dir | layers.json | file.psd>, the full run\'s layers');
      if (canvasArg === undefined) return usage('--head-box needs --canvas <W>x<H>, the painting\'s size in px');
      const canvas = parseCanvas(canvasArg);
      if (canvas === null) return usage(`--canvas ${canvasArg} is not <W>x<H> in integer px`);
      const r = proposeHeadBox(readLayers(full), canvas);
      console.log(`spine-parts propose --head-box: ${full}`);
      console.log(`  painting ${canvas.w}x${canvas.h}; head layers ${r.layers.map(([n, c]) => `${n} ${c} px`).join(', ')}`);
      if (r.shift[0] !== 0 || r.shift[1] !== 0) {
        console.log(`  clamped: the proposed box [${r.unclamped.join(', ')}] leaves the ${canvas.w}x${canvas.h} painting; shifted by ${r.shift[0]},${r.shift[1]} px at the same size`);
      } else console.log('  inside the painting, no shift');
      console.log(`  head_box [${r.head_box.join(', ')}], ${r.head_box[2] - r.head_box[0]}x${r.head_box[3] - r.head_box[1]}`);
      console.log(JSON.stringify({ head_box: r.head_box }));
      return EXIT_OK;
    }
    for (const f of ['--full', '--canvas']) if (flags.has(f)) return usage(`${f} belongs to --head-box`);
    const partsArg = flags.get('--parts');
    const source = flags.get('--source');
    const out = flags.get('--out');
    if (partsArg === undefined) return usage('propose needs --parts <dir>, the directory holding parts.json and parts/');
    if (source === undefined) return usage('propose needs --source <painting.png>, drawn under the overlay');
    if (out === undefined) return usage('propose needs --out <dir>');
    if (flags.has('--from-config') && flags.has('--compare')) return usage('--from-config and --compare are two modes; give one');
    const partsDir = existsSync(partsArg) && statSync(partsArg).isFile() ? dirname(partsArg) : partsArg;
    if (!existsSync(source)) {
      throw new PartsError([{ code: 'PROPOSE_SOURCE_PRESENT', object: source, detail: 'no such file; the painting is drawn under the overlay' }]);
    }
    const P = readPartSet(partsDir);
    const painting = readPng(source);
    const render = join(out, 'render');
    const fromConfig = flags.get('--from-config');
    if (fromConfig !== undefined) {
      const cfg = loadConfig(fromConfig);
      const img = drawLandmarks(P, painting, cfg.bones, 'config bones');
      mkdirSync(render, { recursive: true });
      writePng(join(render, 'landmarks_config.png'), img.full);
      if (img.head !== null) writePng(join(render, 'landmarks_config_head.png'), img.head);
      console.log(`wrote ${join(render, 'landmarks_config.png')}${img.head !== null ? ' (+_head)' : ' (no bone named "head", so no head crop)'}`);
      return printLint(P, cfg) > 0 ? EXIT_REFUSED : EXIT_OK;
    }
    const cmpPath = flags.get('--compare');
    const cfg = cmpPath === undefined ? null : loadConfig(cmpPath);
    const prop = propose(P);
    // Emit only after green: a proposal the config loader would refuse is not written.
    checkProposal(P, prop);
    const img = drawLandmarks(P, painting, prop.bones, 'PROPOSAL - CORRECT ME');
    mkdirSync(render, { recursive: true });
    writeFileSync(join(out, 'proposal.json'), serializeProposal(prop));
    writePng(join(render, 'landmarks.png'), img.full);
    if (img.head !== null) writePng(join(render, 'landmarks_head.png'), img.head);
    console.log(`wrote proposal.json (${prop.bones.length} bone entries, ${Object.keys(prop.meshes).length} meshes) and render/landmarks.png (+_head) under ${out}`);
    for (const n of prop.notes) console.log(`note: ${n}`);
    printLint(P, prop);
    if (cfg !== null) for (const l of compareLines(compare(prop.bones, cfg.bones))) console.log(l);
    return EXIT_OK;
  } catch (err) {
    return printRefusal(err);
  }
}

function sameRgba(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cmdLoop(args: string[]): number {
  const f = flags(args, ['--frames', '--out'], 'loop');
  if (typeof f === 'string') return usage(f);
  const out = f.get('--out') as string;
  const ext = extname(out).toLowerCase();
  if (ext === '.webp') return usage(`--out ${out}: animated WebP needs a VP8/VP8L encoder, which is out of scope; write .png (APNG) or .gif`);
  if (ext !== '.png' && ext !== '.gif') return usage(`--out ${out} is neither .png (APNG) nor .gif`);
  try {
    const set = readFrameSet(f.get('--frames') as string);
    const images = set.frames.map((fr) => fr.image);
    console.log(`spine-parts loop: ${set.dir} -> ${out}`);
    console.log(`  ${images.length} frame(s) ${images[0]?.width ?? 0}x${images[0]?.height ?? 0} at ${set.fps} fps (from frames.json), animation ${set.animation ?? '(none)'}`);
    let used = images;
    const lastName = set.frames[set.frames.length - 1]?.name ?? '';
    if (images.length > 1 && sameRgba(images[0].data, images[images.length - 1].data)) {
      used = images.slice(0, -1);
      console.log(`  ${lastName} equals f0000.png byte for byte, so it is dropped: the loop wraps onto frame 0, and showing it twice would hold that pose for two ticks`);
    } else if (images.length > 1) {
      console.log(`  ${lastName} differs from f0000.png, so every frame is kept and the loop will jump at the wrap`);
    }
    const frames: AnimFrame[] = used.map((image) => ({ image, ticks: 1 }));
    console.log(`  ${frames.length} frame(s) encoded, ${(frames.length / set.fps).toFixed(3)}s per loop, looping forever`);
    if (ext === '.png') {
      const { bytes, stats } = encodeApng(frames, set.fps);
      writeFileSync(out, bytes);
      console.log(`  APNG: ${stats.frames} frame(s) after merging identical neighbours, ${stats.overFrames} of ${Math.max(0, stats.frames - 1)} later frame(s) blended OVER with unchanged pixels cleared, lossless`);
      console.log(`  wrote ${out}: ${stats.bytes} bytes`);
    } else {
      const { bytes, stats } = encodeGif(frames, set.fps);
      writeFileSync(out, bytes);
      console.log(`  GIF: ${stats.frames} frame(s) after merging, ${stats.colours} palette colour(s) cut from ${stats.distinct} distinct, no dithering`);
      console.log(`  palette error (per channel, of 255): frame 0 max ${stats.frame0.max}, mean ${stats.frame0.mean.toFixed(3)}; all frames max ${stats.all.max}, mean ${stats.all.mean.toFixed(3)}`);
      console.log(`  wrote ${out}: ${stats.bytes} bytes`);
    }
    return EXIT_OK;
  } catch (err) {
    if (err instanceof EncodeError) {
      console.log(`  FAIL  LOOP_ENCODE: ${out} — ${err.message}`);
      console.log('refused: 1 problem(s)');
      return EXIT_REFUSED;
    }
    return printRefusal(err);
  }
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return command === undefined ? EXIT_USAGE : EXIT_OK;
  }
  if (command === '--version' || command === '-v') {
    console.log(version());
    return EXIT_OK;
  }
  if (command === 'layers') return cmdLayers(rest);
  if (command === 'sheet') return cmdSheet(rest);
  if (command === 'rig') return cmdRig(rest);
  if (command === 'propose') return cmdPropose(rest);
  if (command === 'check') return cmdCheck(rest);
  if (command === 'loop') return cmdLoop(rest);
  const later = LATER.find(([name]) => name === command);
  if (later !== undefined) {
    console.log(`  FAIL  NOT_IMPLEMENTED: \`spine-parts ${command}\` (${later[1]}) is not implemented in this version, ${version()}`);
    return EXIT_USAGE;
  }
  return usage(`unknown command "${command}"`);
}

process.exit(main(process.argv.slice(2)));
