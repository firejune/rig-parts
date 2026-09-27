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
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { PartsError, problemLine } from './src/errors.ts';
import { type LayerSet, readLayers } from './src/layers.ts';
import { readPng, writePng } from './src/raster/png.ts';
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
  ['rig', 'write rig.json + motion.json (weighted meshes over the layers, chains, one idle)'],
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
  const later = LATER.find(([name]) => name === command);
  if (later !== undefined) {
    console.log(`  FAIL  NOT_IMPLEMENTED: \`spine-parts ${command}\` (${later[1]}) is not implemented in this version, ${version()}`);
    return EXIT_USAGE;
  }
  return usage(`unknown command "${command}"`);
}

process.exit(main(process.argv.slice(2)));
