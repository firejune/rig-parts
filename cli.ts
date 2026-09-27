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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.ts';
import { PartsError, type Problem, problemLine } from './src/errors.ts';
import { type LayerSet, readLayers } from './src/layers.ts';
import { readParts } from './src/parts.ts';
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
  ['propose', 'propose bones, meshes, regions and an idle from the parts, for the config'],
  ['check', 'build through spine-rigc, then the seam, loop and landmark checks'],
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
  const later = LATER.find(([name]) => name === command);
  if (later !== undefined) {
    console.log(`  FAIL  NOT_IMPLEMENTED: \`spine-parts ${command}\` (${later[1]}) is not implemented in this version, ${version()}`);
    return EXIT_USAGE;
  }
  return usage(`unknown command "${command}"`);
}

process.exit(main(process.argv.slice(2)));
