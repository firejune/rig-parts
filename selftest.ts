#!/usr/bin/env bun
/**
 * spine-parts selftest — proof that every gate here can go RED.
 *
 * A gate nobody has seen fail is not a gate. So every raster op has a positive
 * control on a raster small enough to compute by hand AND a negative one that
 * a plausible wrong implementation would pass; every reader has a positive
 * control on an input this file writes and refusals planted one at a time;
 * and the tree itself is held to the rules CLAUDE.md states.
 *
 *   bun selftest.ts                   the public suites: everything below
 *   bun selftest.ts --corpus <dir>    plus an extra suite that reads real
 *   SPINE_PARTS_CORPUS=<dir> bun selftest.ts   See-through output under <dir>
 *
 * The same extra suite also reads the public examples' fetched inputs,
 * `examples/<key>/inputs` (`bun run fetch-examples`), whenever any are on
 * disk, and compares what the readers see there against each example's
 * tracked `expected/parts.json` and `config.json`. With neither a corpus nor
 * fetched inputs it is a SKIP and a HOLE.
 *
 * ## Self-contained
 *
 * No arguments, no art, no network, no private repository: every input is
 * generated into a temp directory by `fixtures/synthetic.ts`. A fresh clone
 * runs this, and CI does.
 *
 * ## How the run counts itself
 *
 * Every suite is wrapped by `RunTally.of`, which counts the case lines it
 * PRINTS — `  PASS  NAME` and `  FAIL  NAME` at a two-space indent — rather
 * than trusting a number anybody wrote. The floor is one per suite: a suite
 * that says it ran and prints no case line, a suite that opens more or fewer
 * than one section, a case line printed outside every suite, a gutter word the
 * tally does not know, a returned failure count that disagrees with the FAIL
 * lines printed — each is a fault, and a run with a fault exits 2 rather than
 * printing green. A suite that has nothing to read (the corpus, when none is
 * named) says so: it opens its section and prints a SKIP and a HOLE line, and
 * it counts as not run, never as passed.
 *
 * The summary at the end states only figures asked of the tally. `TY09` reads
 * the summary's own source and refuses a digit written into its text and a
 * constant that only the summary reads.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import ts from 'typescript';
import {
  assembleConfig,
  C,
  EXPECTED_PARTS,
  EXPECTED_PROPOSAL,
  FRAMED_FULL,
  FRAMED_HEAD,
  FRAMED_PLAN,
  flatPainting,
  framedPainting,
  HEAD_BOX,
  PLAN,
  RESOLUTION,
  RIG_SCALE,
  SOURCE_SIDE,
  writeAssembleFixture,
  writeRun,
} from './fixtures/assemble_fixture.ts';
import { type AnimFrame, chunkTypes, encodeApng } from './src/apng.ts';
import { CHECK_PARTS, checkPartRaster, IDLE_PEAK, shiftRight, writeCheckRig } from './fixtures/checkrig.ts';
import { PROPOSE_PARTS, PROPOSE_RIG, type ProposeFixturePart, writeProposeFixture } from './fixtures/propose.ts';
import { CANVAS, flatName, layerRaster, minimalConfig, WRAPPER_LAYERS, writePsdFixture, writeWrapperFixture } from './fixtures/synthetic.ts';
import { assemble, type AssembleInput, belowCrop, checkGeometry, cleanGhosts, DEFAULT_SEAM_RULE, figuresLine, growRim, layerToRig, proposeFields, proposePlan, stageFields } from './src/assemble.ts';
import { findRigc, gateGreen, parsePackLines, readCheckInputs, readFrameSet, SPINEBOY_YARDSTICK } from './src/check.ts';
import { type BoneEntry, type CharacterConfig, loadConfig, parseConfig } from './src/config.ts';
import { cropToSpineY } from './src/coords.ts';
import { PartsError } from './src/errors.ts';
import { encodeGif } from './src/gif.ts';
import { proposeHeadBox } from './src/headbox.ts';
import { type LayerSet, readLayers, readPsdLayers, readWrapperLayers } from './src/layers.ts';
import { type PartsFile, readParts, serializeParts, writeParts } from './src/parts.ts';
import {
  alphaComposite,
  connectedComponents,
  crop,
  decodePngBytes,
  dilate,
  encodePngBytes,
  erode,
  fillHoles,
  fillPoly,
  type FloatImage,
  gaussianBlur,
  gaussianKernel,
  gaussianKernelSize,
  type Mask,
  morphClose,
  morphGradient,
  newMask,
  newRaster,
  pad,
  type Raster,
  readPng,
  resize,
  warpAffine,
} from './src/raster/index.ts';
import { checkProposal, compare, compareLines, lint, lintLine, type Proposal, propose, readPartSet, serializeProposal } from './src/propose.ts';
import { buildSheet, tileImage, tilesFrom } from './src/sheet.ts';
import { islandImages, RIG_EXPECT, rigConfig, rigImages, rigParts, writeRigFixture } from './fixtures/rig.ts';
import { buildRig, type MeshAttachment, type RegionAttachment, rigJsonText } from './src/rig.ts';
import { pyRound } from './src/round.ts';
import { readTag, type TagReading } from './src/tags.ts';

const ROOT = import.meta.dir;

// ---------------------------------------------------------------------------
// the run's tally of itself
// ---------------------------------------------------------------------------

/**
 * The gutter words a case line reports under. `PASS` and `FAIL` are a case
 * that looked at something; `SKIP` and `INFO` are a suite saying it did not
 * run, which is a HOLE and never a pass, so they are seen and not counted.
 * Anything else at a two-space indent is refused by `tallyFaults`: a scanner
 * that stops recognising case lines goes quiet, not red, unless it refuses
 * what it does not know.
 */
const VERDICT_GUTTER: readonly string[] = ['PASS', 'FAIL'];
const QUIET_GUTTER: readonly string[] = ['SKIP', 'INFO'];
const FAIL_GUTTER = 'FAIL';

function gutterWord(line: string): string | null {
  const match = /^ {2}([A-Z]+)(?: |$)/.exec(line);
  return match === null ? null : match[1];
}

function caseName(line: string): string | null {
  const match = /^ {2}[A-Z]+ {2}(\S+)/.exec(line);
  return match === null ? null : match[1].replace(/:$/, '');
}

function isSectionHeader(line: string): boolean {
  return /^── .+ ──$/.test(line);
}

interface SuiteBlock {
  key: string;
  ran: boolean;
  controls: number;
  quiet: number;
  headers: number;
  fails: number;
  /** The failure count the suite handed back; a suite that did not run hands back none and failed nothing. */
  returned: number;
  names: readonly string[];
}

class RunTally {
  readonly blocks: SuiteBlock[] = [];
  readonly gutter = new Map<string, number>();
  private readonly named: string[] = [];
  private controlLines = 0;
  private failLines = 0;
  private quietLines = 0;
  private headerLines = 0;

  /** Count what one `console.log` printed, line by line. */
  observe(printed: string): void {
    for (const line of printed.split('\n')) {
      if (isSectionHeader(line)) {
        this.headerLines++;
        continue;
      }
      const word = gutterWord(line);
      if (word === null) continue;
      this.gutter.set(word, (this.gutter.get(word) ?? 0) + 1);
      if (VERDICT_GUTTER.includes(word)) {
        this.controlLines++;
        const name = caseName(line);
        if (name !== null) this.named.push(name);
        if (word === FAIL_GUTTER) this.failLines++;
      } else if (QUIET_GUTTER.includes(word)) this.quietLines++;
    }
  }

  /** Run one suite. It hands back its failure count, or `null` to say it had nothing to measure. */
  of(key: string, suite: () => number | null): number | null {
    const controls = this.controlLines;
    const quiet = this.quietLines;
    const headers = this.headerLines;
    const fails = this.failLines;
    const named = this.named.length;
    // A suite that throws is a named FAIL, not a stack trace that ends the run:
    // the crash is printed as a case line so the floor and the verdict see it.
    let value: number | null;
    try {
      value = suite();
    } catch (err) {
      console.log(`  FAIL  SUITE_CRASHED[${key}]: ${(err as Error).stack ?? String(err)}`);
      value = (this.failLines - fails);
    }
    this.blocks.push({
      key,
      ran: value !== null,
      controls: this.controlLines - controls,
      quiet: this.quietLines - quiet,
      headers: this.headerLines - headers,
      fails: this.failLines - fails,
      returned: value ?? 0,
      names: this.named.slice(named),
    });
    return value;
  }

  get total(): number {
    return this.controlLines;
  }

  get failures(): number {
    return this.blocks.reduce((sum, b) => sum + b.returned, 0);
  }

  /** What the summary may say about one suite. Throws rather than print a number nobody produced. */
  countOf(key: string): number {
    const block = this.blocks.find((b) => b.key === key);
    if (block === undefined) throw new Error(`selftest summary: no suite ran under the key "${key}"`);
    if (block.controls === 0) throw new Error(`selftest summary: the suite "${key}" printed no case line`);
    return block.controls;
  }
}

/** Everything that makes a run unable to account for itself. Empty means the counts can be trusted. */
function tallyFaults(blocks: readonly SuiteBlock[], gutter: ReadonlyMap<string, number>, controls: number): string[] {
  const faults: string[] = [];
  if (blocks.length === 0) faults.push('not one suite was tallied, so this run counted nothing about itself');
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.key)) faults.push(`two suites were tallied under the key "${b.key}"`);
    seen.add(b.key);
    if (b.ran) {
      // ⭐ The floor, one suite at a time — never on the sum, because a total
      // that still clears its floor is how a suite that went to zero hides.
      if (b.controls === 0) faults.push(`the suite "${b.key}" reported that it ran and then printed no PASS or FAIL line at all`);
      if (b.headers !== 1) faults.push(`the suite "${b.key}" opened ${b.headers} section header(s); a suite opens exactly one`);
    } else {
      if (b.controls > 0) faults.push(`the suite "${b.key}" reported that it did not run and then printed ${b.controls} case line(s)`);
      if (b.headers === 0) faults.push(`the suite "${b.key}" did not run and opened no section at all, so nothing this run printed says it was skipped`);
      if (b.headers === 1 && b.quiet === 0) faults.push(`the suite "${b.key}" opened a section, did not run, and printed no line saying so`);
      if (b.headers > 1) faults.push(`the suite "${b.key}" did not run and opened ${b.headers} section headers`);
    }
    // 🔒 Two-sided: above the lines is a run claiming failures it never named;
    // below them is worse, because it is green.
    if (b.returned !== b.fails) faults.push(`the suite "${b.key}" printed ${b.fails} FAIL line(s) and handed back ${b.returned} failure(s)`);
  }
  for (const [word, count] of gutter) {
    if (!VERDICT_GUTTER.includes(word) && !QUIET_GUTTER.includes(word)) {
      faults.push(`${count} line(s) reported under the gutter word "${word}", which this tally does not know`);
    }
  }
  if (controls === 0) faults.push('not one PASS or FAIL line was recognised in this whole run, so the scan matched nothing');
  const summed = blocks.reduce((sum, b) => sum + b.controls, 0);
  if (summed !== controls) faults.push(`${controls - summed} case line(s) were printed outside every tallied suite`);
  return faults;
}

// ---------------------------------------------------------------------------
// printing a case
// ---------------------------------------------------------------------------

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

function reportCase(name: string, ok: boolean, detail: string, why: string): number {
  if (ok) {
    console.log(`  PASS  ${name}`);
    console.log(`          ${detail}`);
    console.log(`          origin: ${why}`);
    return 0;
  }
  console.log(`  FAIL  ${name}: ${detail}`);
  return 1;
}

/** One suite's `say`, counting its own failures, so no call site keeps a `bad +=` of its own. */
function counter(): { say: (name: string, ok: boolean, detail: string, why: string) => void; bad: () => number } {
  let bad = 0;
  return {
    say: (name, ok, detail, why) => {
      bad += reportCase(name, ok, detail, why);
    },
    bad: () => bad,
  };
}

/** The refusals a call threw, or null when it threw none. Anything but a PartsError is rethrown: a crash is not a refusal. */
function refusals(run: () => unknown): PartsError | null {
  try {
    run();
    return null;
  } catch (err) {
    if (err instanceof PartsError) return err;
    throw err;
  }
}

function threw(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

function codes(err: PartsError | null): string {
  return err === null ? 'nothing' : err.problems.map((p) => `${p.code} ${p.object}`).join('; ');
}

function maskOf(rows: string[]): Mask {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (data[y * w + x] = ch === '#' ? 1 : 0)));
  return { width: w, height: h, data };
}

function rowsOf(m: Mask): string[] {
  const out: string[] = [];
  for (let y = 0; y < m.height; y++) {
    let s = '';
    for (let x = 0; x < m.width; x++) s += m.data[y * m.width + x] ? '#' : '.';
    out.push(s);
  }
  return out;
}

function sameRows(m: Mask, rows: string[]): boolean {
  return rowsOf(m).join('/') === rows.join('/');
}

function rgba(w: number, h: number, pixels: number[][]): Raster {
  const r = newRaster(w, h);
  pixels.forEach((p, i) => r.data.set(p, i * 4));
  return r;
}

function px(r: Raster, x: number, y: number): number[] {
  return Array.from(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));
}

function temp(label: string): string {
  return mkdtempSync(join(tmpdir(), `spine-parts-selftest-${label}-`));
}

// ---------------------------------------------------------------------------
// raster suites
// ---------------------------------------------------------------------------

function runComponentsSuite(): number {
  section('raster: connectedComponents');
  const { say, bad } = counter();

  const two = maskOf(['##....', '##....', '......', '...###', '...###']);
  const cc = connectedComponents(two, 8);
  const areas = cc.stats.slice(1).map((s) => s.area);
  say(
    'CC01_TWO_PLANTED_BLOBS_ARE_TWO_COMPONENTS',
    cc.count - 1 === 2 && areas.join(',') === '4,6',
    `${cc.count - 1} component(s) with areas ${areas.join(', ')} on a 6x5 mask holding a 2x2 and a 3x2 block`,
    'the ghost clean-up and the blob finders select by component, so a labeller that merged or split blobs moves every part',
  );

  const diagonal = maskOf(['#.', '.#']);
  const d8 = connectedComponents(diagonal, 8).count - 1;
  const d4 = connectedComponents(diagonal, 4).count - 1;
  say(
    'CC02_A_DIAGONAL_PAIR_IS_ONE_UNDER_8_AND_TWO_UNDER_4',
    d8 === 1 && d4 === 2,
    `the diagonal pair is ${d8} component(s) at connectivity 8 and ${d4} at connectivity 4`,
    'cv2.connectedComponentsWithStats(m, 8) is the reference call and ndimage.label the 4-connected one; a labeller that ignored the argument passes one of these and fails the other',
  );

  const ell = maskOf(['#...', '#...', '###.']);
  const s = connectedComponents(ell, 8).stats[1];
  say(
    'CC03_THE_STATISTICS_OF_AN_L_ARE_THE_HAND_COMPUTED_ONES',
    s.left === 0 && s.top === 0 && s.width === 3 && s.height === 3 && s.area === 5 && s.cx === 0.6 && s.cy === 1.4,
    `left ${s.left} top ${s.top} ${s.width}x${s.height} area ${s.area} centroid ${s.cx},${s.cy}; required 0 0 3x3 5 and (0+0+0+1+2)/5, (0+1+2+2+2)/5`,
    'area, box and centroid are what the proposer reads a blob by',
  );

  // Component A's first pixel is (0,1), in 2x2 block (0,0); B's is (3,0), in
  // block (1,0) but on an EARLIER row. cv2's 8-connected labeller numbers by
  // block (A first), its 4-connected one by pixel (B first).
  const order = maskOf(['...#', '#...']);
  const o8 = connectedComponents(order, 8).labels;
  const o4 = connectedComponents(order, 4).labels;
  say(
    'CC04_8_CONNECTED_NUMBERING_IS_BY_BLOCK_AND_4_CONNECTED_BY_PIXEL',
    o8[4] === 1 && o8[3] === 2 && o4[3] === 1 && o4[4] === 2,
    `at 8 the pixel (0,1) is label ${o8[4]} and (3,0) is ${o8[3]}; at 4 they are ${o4[4]} and ${o4[3]}`,
    'measured against cv2 4.13 on 40 random masks, where a pixel-order numbering disagreed with cv2 on 31; the 4-connected half is the negative control that shows the two orders differ on this mask',
  );

  const refusedConn = threw(() => connectedComponents(two, 6 as 4));
  const nonBinary: Mask = { width: 2, height: 1, data: Uint8Array.from([0, 2]) };
  const refusedBinary = threw(() => connectedComponents(nonBinary, 8));
  say(
    'CC05_A_BAD_CONNECTIVITY_AND_A_NON_BINARY_MASK_ARE_REFUSED_BY_NAME',
    refusedConn !== null && refusedConn.includes('connectivity 6') && refusedBinary !== null && refusedBinary.includes('holds 2'),
    `connectivity 6: ${refusedConn ?? 'accepted'}; a pixel of 2: ${refusedBinary ?? 'accepted'}`,
    'a threshold is a decision the caller makes visibly; a mask op that quietly treated 2 as 1 would hide one',
  );
  return bad();
}

function runMorphSuite(): number {
  section('raster: morphology');
  const { say, bad } = counter();

  const dot = maskOf(['.....', '.....', '..#..', '.....', '.....']);
  const corner = maskOf(['#....', '.....', '.....']);
  const d = dilate(dot, 3);
  const dc = dilate(corner, 3);
  say(
    'MO01_DILATE_3X3_GROWS_A_DOT_TO_NINE_AND_A_CORNER_DOT_TO_FOUR',
    sameRows(d, ['.....', '.###.', '.###.', '.###.', '.....']) && sameRows(dc, ['##...', '##...', '.....']),
    `dot -> ${rowsOf(d).join('/')}; corner dot -> ${rowsOf(dc).join('/')}`,
    "the corner case is cv2's border: outside the image is not in the window, so it neither adds pixels nor wraps",
  );

  const full = maskOf(['###', '###', '###']);
  const holed = maskOf(['###', '#.#', '###']);
  const ef = erode(full, 3);
  const eh = erode(holed, 3);
  say(
    'MO02_ERODE_KEEPS_A_FULL_IMAGE_AND_ONE_HOLE_CLEARS_ITS_WINDOW',
    sameRows(ef, ['###', '###', '###']) && sameRows(eh, ['...', '...', '...']),
    `a full 3x3 eroded by 3x3 -> ${rowsOf(ef).join('/')}; the same with its centre cleared -> ${rowsOf(eh).join('/')}`,
    'the first half is the border rule again, on erosion: an eroder that treated outside as empty would clear the whole image',
  );

  const one = maskOf(['.....', '..#..']);
  const even = dilate(one, 2, 1);
  say(
    'MO03_AN_EVEN_KERNEL_IS_ANCHORED_AT_HALF_ITS_WIDTH',
    sameRows(even, ['.....', '..##.']),
    `a dot at x=2 dilated by a 2x1 kernel -> ${rowsOf(even).join('/')}; cv2 anchors at floor(k/2), so the window is [x-1, x] and x=2 and x=3 light`,
    'the reference uses odd kernels, but a centred-looking assumption on an even one shifts a mask by a pixel with nothing going red',
  );

  const gap = maskOf(['.........', '.........', '..##.##..', '.........', '.........']);
  const closed = morphClose(gap, 3);
  const block = maskOf(['.....', '.###.', '.###.', '.###.', '.....']);
  const grad = morphGradient(block, 3);
  say(
    'MO04_CLOSE_BRIDGES_A_ONE_PIXEL_GAP_AND_GRADIENT_IS_THE_RING',
    sameRows(closed, ['.........', '.........', '..#####..', '.........', '.........']) && sameRows(grad, ['#####', '#####', '##.##', '#####', '#####']),
    `close -> ${rowsOf(closed).join('/')}; gradient of a 3x3 block -> ${rowsOf(grad).join('/')}`,
    'MORPH_CLOSE fills the isolated refusals inside an accepted area in the reference assembler, and MORPH_GRADIENT draws the outlines the proposer checks',
  );

  const ring = maskOf(['#####', '#...#', '#...#', '#...#', '#####']);
  const diag = maskOf(['####.', '#..#.', '#..#.', '###..', '.....']);
  const open = maskOf(['#####', '#...#', '#....', '#...#', '#####']);
  const fr = fillHoles(ring);
  const fd = fillHoles(diag);
  const fo = fillHoles(open);
  say(
    'MO05_FILL_HOLES_FILLS_A_RING_AND_A_DIAGONAL_POCKET_BUT_NOT_A_SIDE_GAP',
    sameRows(fr, ['#####', '#####', '#####', '#####', '#####']) && sameRows(fd, ['####.', '####.', '####.', '###..', '.....']) && sameRows(fo, rowsOf(open)),
    `ring -> ${rowsOf(fr).join('/')}; a pocket open only diagonally -> ${rowsOf(fd).join('/')}; a ring open on a side -> ${rowsOf(fo).join('/')}`,
    'scipy.ndimage.binary_fill_holes floods the background through 4-connected neighbours, so a diagonal leak is still a hole; the side gap is the negative control',
  );
  return bad();
}

function runBlurSuite(): number {
  section('raster: gaussianBlur');
  const { say, bad } = counter();
  const size = gaussianKernelSize(1);
  const k = gaussianKernel(size, 1);
  const sum = k.reduce((a, b) => a + b, 0);
  const expectCentre = 1 / Array.from({ length: size }, (_, i) => Math.exp(-((i - (size - 1) / 2) ** 2) / 2)).reduce((a, b) => a + b, 0);
  say(
    'BL01_SIGMA_ONE_IS_A_NINE_TAP_KERNEL_SUMMING_TO_ONE',
    size === 9 && Math.abs(sum - 1) < 1e-12 && Math.abs(k[(size - 1) / 2] - expectCentre) < 1e-15,
    `ksize ${size}, sum ${sum}, centre ${k[(size - 1) / 2]} against 1/sum(exp(-i^2/2)) = ${expectCentre}`,
    'cv2 derives ksize = round(8 sigma + 1) | 1 for a float image asked for (0, 0), which is how the reference feathers its projection mask',
  );

  const row: FloatImage = { width: 21, height: 1, channels: 1, data: new Float32Array(21) };
  row.data[10] = 1;
  const b = gaussianBlur(row, 1);
  const inner = k.every((w, i) => Math.abs(b.data[6 + i] - w) < 1e-7);
  const edge: FloatImage = { width: 21, height: 1, channels: 1, data: new Float32Array(21) };
  edge.data[0] = 1;
  const e = gaussianBlur(edge, 1);
  const c = (size - 1) / 2;
  say(
    'BL02_AN_IMPULSE_BLURS_TO_THE_KERNEL_AND_THE_EDGE_REFLECTS_WITHOUT_REPEATING',
    inner && Math.abs(e.data[0] - k[c]) < 1e-7 && Math.abs(e.data[1] - k[c - 1]) < 1e-7,
    `an impulse mid-row returns the kernel tap for tap; an impulse at x=0 returns ${e.data[0]} at x=0 (the centre tap ${k[c]}) and ${e.data[1]} at x=1 (${k[c - 1]})`,
    `BORDER_REFLECT_101 does not repeat the edge sample; plain REFLECT would read x=0 twice and put centre + neighbour (${k[c] + k[c - 1]}) at x=0, which is the mutant this separates`,
  );

  const zero = threw(() => gaussianBlur(row, 0));
  say(
    'BL03_A_NON_POSITIVE_SIGMA_IS_REFUSED',
    zero !== null && zero.includes('sigma 0'),
    `sigma 0: ${zero ?? 'accepted'}`,
    'cv2 derives sigma from ksize when sigma is 0; the port has no such call site, so it refuses rather than guess',
  );
  return bad();
}

/** Lanczos-3 weights for one output sample, straight from the definition in float64 — the hand computation. */
function lanczosByHand(inSize: number, outSize: number, o: number): Array<[number, number]> {
  const scale = inSize / outSize;
  const fs = Math.max(scale, 1);
  const centre = (o + 0.5) * scale;
  const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const taps: Array<[number, number]> = [];
  for (let i = 0; i < inSize; i++) {
    const x = (i + 0.5 - centre) / fs;
    if (x >= -3 && x < 3) taps.push([i, sinc(x) * sinc(x / 3)]);
  }
  const total = taps.reduce((a, [, w]) => a + w, 0);
  return taps.map(([i, w]) => [i, w / total]);
}

function runResizeSuite(): number {
  section('raster: resize');
  const { say, bad } = counter();

  const checker = rgba(2, 2, [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [0, 0, 0, 255],
  ]);
  const one = resize(checker, 1, 1, 'area');
  const faint = resize(
    rgba(2, 2, [
      [0, 0, 0, 255],
      [1, 1, 1, 255],
      [1, 1, 1, 255],
      [0, 0, 0, 255],
    ]),
    1,
    1,
    'area',
  );
  say(
    'RS01_AREA_ON_A_2X2_CHECKER_IS_THE_MEAN_ROUNDED_THE_WAY_CV2_ROUNDS_IT',
    px(one, 0, 0).join(',') === '128,128,128,255' && px(faint, 0, 0)[0] === 1,
    `1x1 of a 0/255 checker -> ${px(one, 0, 0).join(',')} (mean 127.5); of a 0/1 checker -> ${px(faint, 0, 0)[0]} (mean 0.5). cv2's 2x2 path computes (sum + 2) >> 2, which rounds both halves UP — round-half-to-even would print 128 and 0`,
    'the exact mean of a checker is the one value every area filter must reproduce, and the .5 is where rounding rules part; the 0/1 checker is the case where they disagree, measured against cv2 4.13',
  );

  const three = rgba(3, 1, [
    [0, 0, 0, 255],
    [90, 90, 90, 255],
    [180, 180, 180, 255],
  ]);
  const two = resize(three, 2, 1, 'area');
  say(
    'RS02_AREA_AT_A_FRACTIONAL_FACTOR_WEIGHTS_BY_COVERAGE',
    px(two, 0, 0)[0] === 30 && px(two, 1, 0)[0] === 150,
    `[0, 90, 180] -> 2 px = [${px(two, 0, 0)[0]}, ${px(two, 1, 0)[0]}]; by hand (0*1 + 90*0.5)/1.5 = 30 and (90*0.5 + 180*1)/1.5 = 150`,
    'a reduction by 1.5 splits the middle pixel between both outputs; a box filter that snapped to whole pixels would print 45 and 180',
  );

  const up = threw(() => resize(three, 6, 1, 'area'));
  say(
    'RS03_AREA_REFUSES_AN_ENLARGEMENT_BY_NAME',
    up !== null && up.includes('reduction only'),
    `3x1 -> 6x1 with area: ${up ?? 'accepted'}`,
    'cv2 answers an enlarging INTER_AREA with a different filter; the port refuses rather than hand back one nobody asked for',
  );

  const flat = newRaster(3, 3);
  for (let i = 0; i < 9; i++) flat.data.set([77, 77, 77, 255], i * 4);
  const big = resize(flat, 7, 5, 'bicubic');
  const flatCount = Array.from({ length: 35 }, (_, i) => px(big, i % 7, Math.floor(i / 7)).join(',')).filter((v) => v === '77,77,77,255').length;
  say(
    'RS04_BICUBIC_KEEPS_A_FLAT_IMAGE_FLAT',
    flatCount === 35,
    `a flat 77 grey, 3x3 -> 7x5 with bicubic: ${flatCount} of 35 pixels are 77,77,77,255`,
    'cv2 quantises its cubic weights to 11 bits; weights that did not sum to 2048 would drift a flat image, which is the defect this catches',
  );

  const row = rgba(6, 1, [0, 40, 255, 255, 90, 0].map((v) => [v, v, v, 255]));
  let worst = 0;
  let samples = 0;
  for (const outSize of [3, 10]) {
    const r = resize(row, outSize, 1, 'lanczos3');
    for (let o = 0; o < outSize; o++) {
      const expect = lanczosByHand(6, outSize, o).reduce((a, [i, w]) => a + w * row.data[i * 4], 0);
      const clamped = Math.min(255, Math.max(0, Math.round(expect)));
      worst = Math.max(worst, Math.abs(r.data[o * 4] - clamped));
      samples++;
    }
  }
  say(
    'RS05_LANCZOS_AGREES_WITH_THE_DEFINITION_COMPUTED_BY_HAND',
    worst <= 1,
    `${samples} samples of a 6x1 row resized to 3 and to 10: largest difference from the rounded float64 definition ${worst} level(s); the tolerance is 1, for PIL's 22-bit fixed-point weights`,
    'the port reproduces PIL bit for bit (measured over 140,568 samples against Pillow 12.2.0); this is the check that needs no Pillow to run',
  );

  const bleed = rgba(2, 1, [
    [255, 0, 0, 0],
    [0, 0, 255, 255],
  ]);
  const m = px(resize(bleed, 1, 1, 'lanczos3'), 0, 0);
  say(
    'RS06_LANCZOS_PREMULTIPLIES_SO_A_TRANSPARENT_PIXELS_COLOUR_DOES_NOT_BLEED',
    m[0] === 0 && m[2] === 255 && m[3] === 128,
    `[transparent red, opaque blue] -> 1 px = ${m.join(',')}; premultiplied, the red carries no weight and the result is blue at half alpha`,
    'PIL premultiplies RGBA before resampling; a straight-alpha resample would print about 128,0,128 — a purple fringe on every part edge',
  );

  const same = px(resize(rgba(1, 1, [[200, 100, 50, 77]]), 1, 1, 'lanczos3'), 0, 0);
  say(
    'RS07_A_SAME_SIZE_LANCZOS_IS_A_COPY',
    same.join(',') === '200,100,50,77',
    `a translucent pixel resized to its own size -> ${same.join(',')}`,
    'PIL hands back a copy at the same size; running the premultiply round trip anyway quantises every translucent pixel (measured: 5,224 samples of one 45x53 raster moved)',
  );
  return bad();
}

function runWarpSuite(): number {
  section('raster: warpAffine');
  const { say, bad } = counter();
  const src: FloatImage = { width: 6, height: 1, channels: 1, data: Float32Array.from([0, 10, 20, 30, 40, 50]) };
  const half = Array.from(warpAffine(src, { sx: 1, sy: 1, tx: 0.5, ty: 0 }, 8, 1, 'bilinear').data).join(',');
  say(
    'WA01_A_HALF_PIXEL_SHIFT_AVERAGES_NEIGHBOURS_AND_READS_ZERO_OUTSIDE',
    half === '0,5,15,25,35,45,25,0',
    `[0..50 step 10] moved right by half a pixel -> ${half}; x=0 mixes the border 0 with 0, x=6 mixes 50 with the border`,
    'cv2 samples dst x at src (x - tx) / sx with no half-pixel offset, and a tap outside the image reads the border value and still carries weight',
  );

  const doubled = Array.from(warpAffine(src, { sx: 2, sy: 1, tx: 0, ty: 0 }, 8, 1, 'bilinear').data).join(',');
  say(
    'WA02_SCALE_TWO_SAMPLES_EVERY_HALF_PIXEL',
    doubled === '0,5,10,15,20,25,30,35',
    `scale 2 -> ${doubled}`,
    'the rig-space warp of every layer is a scale and a translation, so this is the op the assembler stands on',
  );

  const tiny = Array.from(warpAffine(src, { sx: 1, sy: 1, tx: 0.01, ty: 0 }, 6, 1, 'bilinear').data).join(',');
  say(
    'WA03_POSITIONS_ARE_ROUNDED_TO_ONE_32ND_OF_A_PIXEL_LIKE_CV2',
    tiny === '0,10,20,30,40,50',
    `a shift of a hundredth of a pixel -> ${tiny}; it rounds to 0 of cv2's 32 sub-pixel steps, so cv2 returns the input where exact bilinear would print 9.9 at x=1`,
    "the 1/32 quantisation is cv2's, and reproducing it is what makes the port agree with cv2 to 3.1e-5 rather than to a tenth of a level",
  );

  // The same map on both axes: step 15.4/1024 px per output pixel, offset
  // 0.4/1024 px. Along x cv2 rounds the two to fixed point SEPARATELY (0 + 15
  // = 15 units, +16 = 31, under one 1/32 step), along y it rounds their SUM
  // once (round(15.8) = 16, +16 = 32, exactly one step). So on a ramp of 32
  // per pixel output 1 reads 0 along x and 1 along y.
  const step = 15.4 / 1024;
  const scale = 1 / step;
  const shift = -(0.4 / 1024) * scale;
  const rampX: FloatImage = { width: 3, height: 1, channels: 1, data: Float32Array.from([0, 32, 64]) };
  const rampY: FloatImage = { width: 1, height: 3, channels: 1, data: Float32Array.from([0, 32, 64]) };
  const alongX = warpAffine(rampX, { sx: scale, sy: 1, tx: shift, ty: 0 }, 2, 1, 'bilinear').data[1];
  const alongY = warpAffine(rampY, { sx: 1, sy: scale, tx: 0, ty: shift }, 1, 2, 'bilinear').data[1];
  say(
    'WA05_X_ROUNDS_OFFSET_AND_STEP_APART_AND_Y_ROUNDS_THEIR_SUM_LIKE_CV2',
    alongX === 0 && alongY === 1,
    `the same map read along x -> ${alongX}, along y -> ${alongY}; cv2's arithmetic gives 0 and 1`,
    'measured while porting: using one rule for both axes moved samples by up to 6.3 levels over 84,508 samples against cv2 4.13; this is the smallest input that tells the two rules apart',
  );

  const singular = threw(() => warpAffine(src, { sx: 0, sy: 1, tx: 0, ty: 0 }, 2, 1, 'bilinear'));
  say(
    'WA04_A_SINGULAR_SCALE_IS_REFUSED',
    singular !== null && singular.includes('singular'),
    `scale 0: ${singular ?? 'accepted'}`,
    'a zero scale has no inverse; cv2 would hand back the border everywhere',
  );
  return bad();
}

function runPolySuite(): number {
  section('raster: fillPoly');
  const { say, bad } = counter();
  const m: Mask = { width: 6, height: 6, data: new Uint8Array(36) };
  fillPoly(m, [
    [0, 0],
    [4, 0],
    [0, 4],
  ]);
  say(
    'PL01_A_RIGHT_TRIANGLE_FILLS_THE_HAND_COMPUTED_PIXELS',
    sameRows(m, ['#####.', '####..', '###...', '##....', '#.....', '......']),
    `(0,0) (4,0) (0,4) -> ${rowsOf(m).join('/')}; rows 0 to 3 span x from 0 to 4-y, row 4 is the vertex alone`,
    'the reference rasterises every mesh triangle to measure art coverage; the edge pixels are part of what cv2 sets',
  );

  const clipped: Mask = { width: 4, height: 4, data: new Uint8Array(16) };
  fillPoly(clipped, [
    [-2, -2],
    [5, -2],
    [5, 5],
    [-2, 5],
  ]);
  const frac = threw(() =>
    fillPoly({ width: 2, height: 2, data: new Uint8Array(4) }, [
      [0.5, 0],
      [1, 1],
      [0, 1],
    ]),
  );
  say(
    'PL02_A_POLYGON_COVERING_THE_IMAGE_FILLS_IT_AND_A_FRACTIONAL_VERTEX_IS_REFUSED',
    clipped.data.every((v) => v === 1) && frac !== null && frac.includes('not integral'),
    `a square around a 4x4 mask -> ${rowsOf(clipped).join('/')}; a vertex at 0.5: ${frac ?? 'accepted'}`,
    'clipped edges start from their clipped endpoints in cv2, and the reference rounds its vertices at the call site — rounding here would hide it',
  );

  // Left edge from (3,0) to (0,4): x = 3 - 3y/4, so at row 3 it is 0.75. cv2
  // rounds a span's LEFT end up (to 1) and its right end down, and the edge's
  // own 8-connected line lights (1,3) — so (0,3) stays empty. A fill that
  // floored the left end as well would light it.
  const slant: Mask = { width: 8, height: 5, data: new Uint8Array(40) };
  fillPoly(slant, [
    [3, 0],
    [7, 4],
    [0, 4],
  ]);
  const expectSlant = ['...#....', '..###...', '.#####..', '.######.', '########'];
  say(
    'PL03_A_SPANS_LEFT_END_IS_ROUNDED_UP_AS_CV2_ROUNDS_IT',
    sameRows(slant, expectSlant),
    `(3,0) (7,4) (0,4) -> ${rowsOf(slant).join('/')}; required ${expectSlant.join('/')} (row 3: the edge is at x = 0.75, the span starts at 1)`,
    'the rows were also measured against cv2.fillPoly on this triangle; the left-end rounding is the one detail that decides whether a mesh edge pixel counts as covered',
  );
  return bad();
}

function runCompositeSuite(): number {
  section('raster: alphaComposite, crop, pad');
  const { say, bad } = counter();
  const blue = rgba(1, 1, [[0, 0, 255, 255]]);
  const over = px(alphaComposite(blue, rgba(1, 1, [[255, 0, 0, 128]])), 0, 0);
  say(
    'AC01_HALF_RED_OVER_BLUE_IS_PILS_INTEGER_ANSWER',
    over.join(',') === '128,0,127,255',
    `alpha 128 red over opaque blue -> ${over.join(',')}; by hand in PIL's arithmetic coef1 = 128*255*255*128/65025 = 16384, red = ((255*16384 + 16384) through the /255 shift) >> 7 = 128, blue 127`,
    "Image.alpha_composite is what the reference recomposes and seam-checks with, so the port's composite has to be PIL's to the level",
  );

  const kept = px(alphaComposite(blue, rgba(1, 1, [[9, 9, 9, 0]])), 0, 0);
  const small = rgba(2, 2, [
    [1, 1, 1, 255],
    [2, 2, 2, 255],
    [3, 3, 3, 255],
    [4, 4, 4, 255],
  ]);
  const offside = alphaComposite(newRaster(2, 2), small, 1, 1);
  say(
    'AC02_A_TRANSPARENT_SOURCE_LEAVES_THE_DESTINATION_AND_AN_OFFSET_IS_CLIPPED',
    kept.join(',') === '0,0,255,255' && px(offside, 1, 1).join(',') === '1,1,1,255' && px(offside, 0, 0)[3] === 0,
    `transparent over blue -> ${kept.join(',')}; a 2x2 placed at (1,1) on a 2x2 puts its first pixel at (1,1) and nothing at (0,0)`,
    'a composite that wrote the transparent source colour would tint every seam',
  );

  const out = threw(() => crop(small, 1, 1, 2, 2));
  const padded = pad(crop(small, 1, 0, 1, 2), 1, 0, 0, 1, [7, 7, 7, 7]);
  say(
    'AC03_CROP_REFUSES_A_WINDOW_OUTSIDE_AND_PAD_PLACES_THE_SOURCE',
    out !== null && out.includes('outside') && padded.width === 2 && padded.height === 3 && px(padded, 1, 0).join(',') === '2,2,2,255' && px(padded, 0, 0).join(',') === '7,7,7,7',
    `crop 1,1 2x2 of a 2x2: ${out ?? 'accepted'}; the right column padded left 1 and bottom 1 is ${padded.width}x${padded.height} with the source at (1,0)`,
    'PIL pads an out-of-range crop with zeros; the port refuses, because a part box outside its layer is a measurement error, not an edge',
  );
  return bad();
}

function runPngSuite(): number {
  section('png: the spine-rigc codec');
  const { say, bad } = counter();
  const r = rgba(3, 2, [
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 255, 0],
    [1, 2, 3, 4],
    [250, 251, 252, 253],
    [0, 0, 0, 0],
  ]);
  const bytes = encodePngBytes(r);
  const again = encodePngBytes(r);
  const back = decodePngBytes(bytes, 'in-memory');
  say(
    'PN01_ENCODE_THEN_DECODE_IS_THE_SAME_PIXELS_AND_THE_SAME_BYTES_TWICE',
    back.width === 3 && back.height === 2 && Buffer.from(back.data).equals(Buffer.from(r.data)) && Buffer.from(bytes).equals(Buffer.from(again)),
    `a 3x2 RGBA raster with translucent and fully transparent pixels round-trips exactly, and two encodes are the same ${bytes.length} bytes`,
    'straight alpha must survive the codec untouched, and an output written twice must be the same file (determinism is a contract)',
  );

  const notPng = threw(() => decodePngBytes(new TextEncoder().encode('GIF89a not a png at all'), 'fake.png'));
  say(
    'PN02_A_FILE_THAT_IS_NOT_A_PNG_IS_REFUSED_NAMING_IT',
    notPng !== null && notPng.includes('fake.png'),
    `GIF bytes labelled fake.png: ${notPng ?? 'accepted'}`,
    "spine-rigc's assertPng names what a file is when it is not a PNG; without it the refusal is an inflate error about a file that was never one",
  );
  return bad();
}

// ---------------------------------------------------------------------------
// input and output contracts
// ---------------------------------------------------------------------------

function runWrapperSuite(): number {
  section('layers: the ComfyUI wrapper form');
  const { say, bad } = counter();
  const dirs: string[] = [];
  const fresh = (label: string): string => {
    const d = temp(label);
    dirs.push(d);
    return d;
  };
  try {
    const dir = fresh('wrapper');
    writeWrapperFixture(dir);
    const set = readWrapperLayers(dir);
    const order = set.layers.map((l) => l.name).join(' < ');
    const opaque = set.layers.map((l) => `${l.name}=${l.opaquePx}`).join(', ');
    const counts = WRAPPER_LAYERS.every((f) => set.layers.find((l) => l.name === f.name)?.opaquePx === f.painted);
    const boxes = WRAPPER_LAYERS.every((f) => {
      const l = set.layers.find((x) => x.name === f.name);
      return l !== undefined && l.left === f.left && l.top === f.top && l.right === f.left + f.width && l.bottom === f.top + f.height;
    });
    say(
      'LW01_A_WRAPPER_DIRECTORY_READS_IN_DRAW_ORDER_WITH_ITS_OWN_COUNTS',
      set.canvas.w === CANVAS.w && set.canvas.h === CANVAS.h && order === 'neckwear < back hair < face < eyebrow-l < eyebrow-r' && counts && boxes,
      `canvas ${set.canvas.w}x${set.canvas.h}; ${order}; opaque ${opaque}`,
      'draw order is descending depth_median with ties kept in manifest order (the brows tie, and eyebrow-l is listed first); both PNG layouts — flat and parts/<name>.png — are read',
    );

    const missing = fresh('wrapper-missing');
    writeWrapperFixture(missing);
    rmSync(join(missing, flatName('eyebrow-r')));
    const e1 = refusals(() => readWrapperLayers(missing));
    const p1 = e1?.problems[0];
    say(
      'LW02_A_MISSING_PNG_IS_REFUSED_NAMING_THE_LAYER_AND_BOTH_PLACES_LOOKED',
      e1 !== null && e1.problems.length === 1 && p1?.code === 'LAYERS_PNG_PRESENT' && p1.object === 'layer "eyebrow-r"' && p1.detail.includes(join('parts', 'eyebrow-r.png')),
      `one PNG deleted -> ${codes(e1)}: ${p1?.detail ?? ''}`,
      'the reference sheet skipped a missing PNG in silence; here a missing layer is a named refusal before any stage reads it',
    );

    const unknown = fresh('wrapper-tag');
    writeWrapperFixture(unknown, [
      { ...WRAPPER_LAYERS[0], name: 'hair' },
      { ...WRAPPER_LAYERS[1], name: 'topwear-l' },
      { ...WRAPPER_LAYERS[3], name: 'eyebrow-r' },
    ]);
    const e2 = refusals(() => readWrapperLayers(unknown));
    const tagged = e2?.problems.filter((p) => p.code === 'LAYERS_TAG_KNOWN').map((p) => p.object) ?? [];
    say(
      'LW03_AN_UNKNOWN_TAG_AND_A_SIDE_ON_AN_UNSPLIT_TAG_ARE_REFUSED_BY_NAME',
      tagged.join(',') === 'layer "hair",layer "topwear-l"' && e2?.problems.length === 2,
      `"hair" (the older v2 vocabulary's single hair tag), "topwear-l" and "eyebrow-r" -> ${codes(e2)}`,
      'v3 splits hair into front and back, and upstream splits only six tags into sides; mapping either would be a guess, while eyebrow-r is the negative control that a real split tag passes',
    );

    const wrong = fresh('wrapper-faults');
    writeWrapperFixture(wrong);
    const manifestPath = join(wrong, 'layers.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { layers: Array<Record<string, unknown>> };
    manifest.layers[0].right = (manifest.layers[0].right as number) + 1;
    manifest.layers[1].surprise = true;
    delete manifest.layers[2].depth_median;
    manifest.layers[3].name = 'eyebrow-l';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const e3 = refusals(() => readWrapperLayers(wrong));
    const got = new Set(e3?.problems.map((p) => p.code) ?? []);
    say(
      'LW04_FOUR_PLANTED_FAULTS_ARE_FOUR_NAMED_REFUSALS_IN_ONE_RUN',
      e3 !== null && e3.problems.length === 4 && ['LAYERS_PNG_MATCHES_BBOX', 'LAYERS_KEY_KNOWN', 'LAYERS_FIELD_PRESENT', 'LAYERS_NAME_UNIQUE'].every((c) => got.has(c)),
      `a box one pixel wider than its PNG, an unknown key, a missing depth_median and a duplicate name -> ${e3?.problems.length ?? 0} refusal(s): ${codes(e3)}`,
      'a reader that stopped at the first problem would make an agent fix one thing per run; one run names all four',
    );

    const both = fresh('wrapper-both');
    writeWrapperFixture(both);
    writeFileSync(join(both, 'parts', 'eyebrow-l.png'), encodePngBytes(layerRaster({ ...WRAPPER_LAYERS[1], painted: 1 })));
    const e4 = refusals(() => readWrapperLayers(both));
    say(
      'LW05_TWO_DIFFERENT_PNGS_FOR_ONE_LAYER_ARE_REFUSED_NOT_PICKED',
      e4 !== null && e4.problems.length === 1 && e4.problems[0].code === 'LAYERS_PNG_UNAMBIGUOUS',
      `eyebrow-l present flat AND under parts/ with different bytes -> ${codes(e4)}`,
      'two layouts are supported; when both answer differently, choosing one would be a guess',
    );
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
  return bad();
}

function runPsdSuite(): number {
  section('layers: the upstream PSD form');
  const { say, bad } = counter();
  const dir = temp('psd');
  try {
    const hair = layerRaster({ ...WRAPPER_LAYERS[2] });
    const face = layerRaster({ ...WRAPPER_LAYERS[0] });
    const brow = layerRaster({ ...WRAPPER_LAYERS[1] });
    const good = join(dir, 'good.psd');
    writePsdFixture(good, CANVAS.w, CANVAS.h, [
      { name: 'back hair', left: 10, top: 0, pixels: hair },
      {
        name: 'head parts',
        left: 0,
        top: 0,
        pixels: face,
        children: [
          { name: 'face', left: 20, top: 8, pixels: face },
          { name: 'eyebrow-l', left: 34, top: 12, pixels: brow },
        ],
      },
    ]);
    const set = readPsdLayers(good);
    const names = set.layers.map((l) => `${l.drawOrder}:${l.name}`).join(' ');
    const facePixels = set.layers.find((l) => l.name === 'face')?.pixels;
    const intact = facePixels !== undefined && Buffer.from(facePixels.data).equals(Buffer.from(face.data));
    say(
      'PS01_A_PSD_READS_IN_STACKING_ORDER_WITH_GROUPS_FLATTENED_AND_PIXELS_INTACT',
      names === '0:back hair 1:face 2:eyebrow-l' && set.layers.every((l) => l.depth === null) && intact,
      `${names}; depth ${set.layers.map((l) => String(l.depth)).join(',')}; face pixels ${intact ? 'identical' : 'CHANGED'}`,
      'the stacking order IS the draw order for a PSD, bottom first, and a PSD carries no depth, so the reader says null rather than inventing one',
    );

    const hidden = join(dir, 'faults.psd');
    writePsdFixture(hidden, CANVAS.w, CANVAS.h, [
      { name: 'back hair', left: 10, top: 0, pixels: hair, hidden: true },
      { name: 'face', left: 20, top: 8, pixels: face, blendMode: 'multiply' },
      { name: 'hair', left: 20, top: 8, pixels: face },
    ]);
    const e = refusals(() => readPsdLayers(hidden));
    const got = e?.problems.map((p) => `${p.code} ${p.object}`) ?? [];
    say(
      'PS02_A_HIDDEN_LAYER_A_BLEND_MODE_AND_AN_UNKNOWN_TAG_ARE_EACH_REFUSED_BY_NAME',
      e !== null && got.includes('PSD_LAYER_PLAIN PSD layer "back hair"') && got.includes('PSD_LAYER_PLAIN PSD layer "face"') && got.includes('LAYERS_TAG_KNOWN PSD layer "hair"'),
      got.join('; '),
      'each of these changes what the composite looks like, and the reader cannot see which the author meant, so it refuses instead of interpreting',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

function runConfigSuite(): number {
  section('config: the character config loader');
  const { say, bad } = counter();
  const good = refusals(() => parseConfig(minimalConfig()));
  say(
    'CF01_A_MINIMAL_CONFIG_WITH_ANNOTATIONS_LOADS_GREEN',
    good === null,
    `the fixture config — bones with a chain, two meshes, two regions, a single and a chain track, a blink, and a rig_note — ${good === null ? 'loads' : `is refused: ${codes(good)}`}`,
    'the positive control: every negative below is only worth something if a correct config passes. Its parent chain root, hip, chest, head is what refused green configs while the bone-registering call was being stripped at run time (TY08)',
  );

  const e1 = refusals(() => parseConfig({ ...minimalConfig(), colour_grade: 'warm' }));
  say(
    'CF02_AN_UNKNOWN_KEY_IS_REFUSED_BY_NAME',
    e1 !== null && e1.problems.length === 1 && e1.problems[0].code === 'CONFIG_KEY_KNOWN' && e1.problems[0].object === 'config.colour_grade',
    `a top-level "colour_grade" -> ${codes(e1)}`,
    'a key the loader does not know is a value nothing will read, and its author believes something will',
  );

  const privateEra = {
    ...minimalConfig(),
    generation: {
      character_file: 'elsewhere/character.json',
      art_job: 'job',
      costume: 'plain robe',
      negative_extra: '',
      style: 'white background',
      negative_pose: 'back view',
      latent: [832, 1216],
      seed: 1,
      pose: 'standing',
    },
  };
  const e2 = refusals(() => parseConfig(privateEra));
  const retired = e2?.problems.find((p) => p.object === 'config.generation.character_file');
  const needsInline = e2?.problems.some((p) => p.object === 'config.generation.checkpoint' && p.code === 'CONFIG_FIELD_PRESENT') === true;
  say(
    'CF03_A_PRIVATE_ERA_KEY_IS_REFUSED_WITH_THE_FIELD_THAT_REPLACES_IT',
    retired?.code === 'CONFIG_KEY_RETIRED' && retired.detail.includes('generation.checkpoint') && needsInline,
    `generation.character_file -> ${retired?.code ?? 'not refused'}: ${retired?.detail ?? ''}`,
    'a config written against the private reference points at files that do not exist here; the refusal says what to write instead, and the inline fields it names are then required',
  );

  const forward = minimalConfig();
  const bones = forward.bones as Array<Record<string, unknown>>;
  forward.bones = [bones[1], bones[0], ...bones.slice(2)];
  const e3 = refusals(() => parseConfig(forward));
  say(
    'CF04_A_PARENT_DECLARED_BELOW_ITS_CHILD_IS_REFUSED_BY_NAME',
    e3 !== null && e3.problems.length === 1 && e3.problems[0].code === 'CONFIG_NAME_RESOLVES' && e3.problems[0].object === 'config.bones[0].parent',
    `chest declared before hip -> ${codes(e3)}: ${e3?.problems[0]?.detail ?? ''}`,
    'Spine resolves a parent by name against the bones already read, so a forward reference is a rig that fails to load — here the config fails to load instead, by name',
  );

  const broken = minimalConfig();
  const motion = broken.motion as { tracks: Array<Record<string, unknown>> };
  motion.tracks[1].amps = [1, 2, 3];
  motion.tracks[0].period = 3;
  delete (broken.regions as Record<string, unknown>).face;
  const e4 = refusals(() => parseConfig(broken));
  const got = new Set(e4?.problems.map((p) => p.code) ?? []);
  say(
    'CF05_THREE_SILENT_REFERENCE_DEFECTS_ARE_THREE_NAMED_REFUSALS',
    e4 !== null && e4.problems.length === 3 && ['CONFIG_AMPS_MATCH_CHAIN', 'CONFIG_PERIOD_DIVIDES_DURATION', 'CONFIG_PART_ATTACHED'].every((c) => got.has(c)),
    `three amplitudes for a two-link chain, a 3 s period in a 4 s idle, a part with neither mesh nor region -> ${codes(e4)}`,
    'the reference zipped amplitudes with links (a third amplitude vanished), sampled a sine that did not loop, and stopped at the first unattached part; each is now a refusal naming the field',
  );

  const box = { ...minimalConfig(), seethrough: { resolution: 1024, steps: 30, seed: 42, offload: true, head_box: [10, 10, 60, 61] } };
  const e5 = refusals(() => parseConfig(box));
  say(
    'CF06_A_HEAD_BOX_ONE_PIXEL_OFF_SQUARE_IS_REFUSED',
    e5 !== null && e5.problems.length === 1 && e5.problems[0].code === 'CONFIG_HEAD_BOX_SQUARE',
    `head_box [10, 10, 60, 61] -> ${codes(e5)}: ${e5?.problems[0]?.detail ?? ''}`,
    'the reference maps the head run back with ONE scale taken from the box width, so a box a pixel taller than wide is a vertical error nothing reports; its own head-box proposer rounds each corner separately and produces exactly this',
  );
  return bad();
}

function runPartsSuite(): number {
  section('parts: the parts.json contract');
  const { say, bad } = counter();
  const dir = temp('parts');
  try {
    const file: PartsFile = {
      rig_size: [32, 24],
      scale_rig_per_source: 0.5,
      parts: [
        { name: 'face', from: 'head:face', x: 10, y: 4, w: 12, h: 10, opaque_px: 100, projected_core_px: 80, source_px_taken: 75, refused_drift_px: 5, merged_px: 0, seam_override_px: 3 },
      ],
      ghost_px: { 'head:face': 2, 'full:topwear': 0 },
    };
    const path = join(dir, 'parts.json');
    writeParts(path, file);
    const first = readFileSync(path, 'utf8');
    const back = readParts(path);
    writeParts(path, back);
    const second = readFileSync(path, 'utf8');
    say(
      'PT01_PARTS_JSON_ROUND_TRIPS_TO_THE_SAME_BYTES',
      first === second && serializeParts(back) === first,
      `write, read, write gives ${first === second ? 'identical' : 'DIFFERENT'} files of ${first.length} bytes; ghost_px keys are written sorted`,
      'the record is the measurement; if it cannot be read back byte for byte it cannot be compared between runs',
    );

    const planted = JSON.parse(first) as { parts: Array<Record<string, unknown>> } & Record<string, unknown>;
    delete planted.parts[0].seam_override_px;
    planted.parts[0].from = 'head:hair';
    planted.parts[0].x = 30;
    planted.extra = 1;
    writeFileSync(path, JSON.stringify(planted));
    const e = refusals(() => readParts(path));
    const got = new Set(e?.problems.map((p) => p.code) ?? []);
    say(
      'PT02_FOUR_PLANTED_FAULTS_ARE_FOUR_NAMED_REFUSALS',
      e !== null && e.problems.length === 4 && ['PARTS_FIELD_PRESENT', 'PARTS_FROM_KNOWN', 'PARTS_BOX_INSIDE_RIG', 'PARTS_KEY_KNOWN'].every((c) => got.has(c)),
      `a missing count, a v2 tag in "from", a box past the rig edge and an unknown key -> ${codes(e)}`,
      'downstream stages classify a part by `from` and place it by its box; either wrong is a rig built on the wrong layer',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

function runSheetSuite(): number {
  section('sheet: the contact sheet');
  const { say, bad } = counter();
  const red = rgba(1, 1, [[255, 0, 0, 255]]);
  // cell 40: scale = min(36/1, 10/1) = 10, so a 10x10 image at ((40-10)/2, 2 + (40-30-10)/2) = (15, 2).
  const t = tileImage({ name: 'a', image: red, caption: 'b' }, 40);
  say(
    'SH01_A_ONE_PIXEL_LAYER_IS_ENLARGED_AND_PLACED_WHERE_THE_LAYOUT_SAYS',
    px(t, 15, 2).join(',') === '255,0,0,255' && px(t, 24, 11).join(',') === '255,0,0,255' && px(t, 14, 2).join(',') === '230,230,230,255' && px(t, 11, 2).join(',') === '200,200,200,255' && px(t, 25, 11)[0] !== 255,
    `in a 40 px cell the 1x1 red layer covers (15,2) to (24,11): ${px(t, 15, 2).join(',')} at (15,2); the checker beside it is ${px(t, 14, 2).join(',')} at (14,2), square (1,0) of 12 px, and ${px(t, 11, 2).join(',')} at (11,2), square (0,0)`,
    'the reference tile scales by min((cell-4)/w, (cell-30)/h), enlarging small layers; the image region of real layer tiles was measured identical to the reference tile() over 167,200 samples each',
  );

  const sheet = buildSheet(
    [
      { name: 'a', image: red },
      { name: 'b', image: red },
      { name: 'c', image: red },
    ],
    2,
    40,
  );
  say(
    'SH02_THREE_TILES_IN_TWO_COLUMNS_MAKE_A_TWO_BY_TWO_SHEET_WITH_A_WHITE_CELL',
    sheet.width === 80 && sheet.height === 80 && px(sheet, 60, 60).join(',') === '255,255,255,255',
    `${sheet.width}x${sheet.height}, the fourth cell ${px(sheet, 60, 60).join(',')}`,
    'the grid is ceil(tiles / cols) rows on a white sheet',
  );

  const dir = temp('sheet');
  try {
    const file: PartsFile = {
      rig_size: [8, 8],
      scale_rig_per_source: 1,
      parts: [{ name: 'face', from: 'head:face', x: 0, y: 0, w: 1, h: 1, opaque_px: 1, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 }],
      ghost_px: {},
    };
    writeParts(join(dir, 'parts.json'), file);
    const e = refusals(() => tilesFrom(join(dir, 'parts.json')));
    say(
      'SH03_A_PART_WHOSE_PNG_IS_MISSING_IS_REFUSED_NOT_SKIPPED',
      e !== null && e.problems.length === 1 && e.problems[0].code === 'SHEET_PNG_PRESENT' && e.problems[0].object === 'part "face"',
      `parts.json naming a part with no parts/face.png -> ${codes(e)}`,
      'the reference sheet stepped past a missing PNG, which is a sheet that looks complete and is not',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

function runCli(args: string[]): { status: number; out: string } {
  const r = spawnSync('bun', [join(ROOT, 'cli.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function runCliSuite(): number {
  section('cli: the command surface');
  const { say, bad } = counter();
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const v = runCli(['--version']);
  say(
    'CL01_VERSION_PRINTS_THE_PACKAGE_VERSION',
    v.status === 0 && v.out.trim() === pkg.version,
    `--version -> exit ${v.status}, "${v.out.trim()}"; package.json says ${pkg.version}`,
    'the version a user reports is the one the package carries, read at run time rather than copied',
  );

  const later = ['build', 'comfy'];
  const help = runCli(['--help']);
  const stubs = later.map((c) => ({ c, r: runCli([c]) }));
  const honest = stubs.filter(({ r }) => r.status === 2 && r.out.includes('NOT_IMPLEMENTED') && r.out.includes('not implemented in this version'));
  say(
    'CL02_EVERY_LATER_COMMAND_IS_LISTED_AND_EXITS_TWO_SAYING_SO',
    help.status === 0 && [...later, 'layers', 'sheet', 'rig', 'propose', 'check', 'loop', 'assemble'].every((c) => help.out.includes(c)) && honest.length === later.length,
    `${honest.length} of ${later.length} stubs exit 2 with NOT_IMPLEMENTED (${stubs.map(({ c, r }) => `${c}=${r.status}`).join(', ')}); --help names all of them`,
    'the surface is visible before it exists, and the help does not promise a command that would do nothing',
  );

  const dir = temp('cli');
  try {
    writeWrapperFixture(dir);
    const table = runCli(['layers', dir]);
    const rows = table.out.split('\n').filter((l) => /^ {2}\d+ {2}/.test(l));
    const empty = WRAPPER_LAYERS.filter((l) => l.painted === 0).length;
    say(
      'CL03_LAYERS_PRINTS_ONE_ROW_PER_LAYER_AND_A_LINE_DERIVED_FROM_THEM',
      table.status === 0 && rows.length === WRAPPER_LAYERS.length && table.out.includes(`${WRAPPER_LAYERS.length} layer(s): ${WRAPPER_LAYERS.length - empty} with opaque pixels, ${empty} with none`),
      `exit ${table.status}, ${rows.length} row(s) for ${WRAPPER_LAYERS.length} fixture layers; first row "${rows[0]?.trim() ?? ''}"`,
      'an agent reads this table instead of the images, so every layer is a row and the closing line counts the rows it printed',
    );

    const refused = runCli(['layers', join(dir, 'nowhere')]);
    const usage = runCli(['layers']);
    say(
      'CL04_A_REFUSAL_EXITS_ONE_WITH_FAIL_LINES_AND_A_USAGE_ERROR_EXITS_TWO',
      refused.status === 1 && /^ {2}FAIL {2}LAYERS_INPUT_KIND: /m.test(refused.out) && usage.status === 2,
      `a missing path -> exit ${refused.status} "${refused.out.split('\n')[0].trim()}"; no path -> exit ${usage.status}`,
      'exit codes are part of the interface: 1 means the input was refused and says why, 2 means the call was malformed',
    );

    const src = join(dir, 'painting.png');
    writeFileSync(src, encodePngBytes(layerRaster({ ...WRAPPER_LAYERS[0] })));
    const out = join(dir, 'sheet.png');
    const cell = 60;
    const cols = 3;
    const sheet = runCli(['sheet', '--source', src, '--layers', dir, '--out', out, '--cell', String(cell), '--cols', String(cols)]);
    const written = existsSync(out) ? decodePngBytes(new Uint8Array(readFileSync(out)), out) : null;
    const tiles = WRAPPER_LAYERS.length + 1;
    const w = cols * cell;
    const h = Math.ceil(tiles / cols) * cell;
    say(
      'CL05_SHEET_WRITES_A_PNG_OF_THE_SIZE_IT_PRINTS',
      sheet.status === 0 && written !== null && written.width === w && written.height === h && sheet.out.includes(`sheet ${w}x${h}`) && (sheet.out.match(/^ {2}tile /gm) ?? []).length === tiles,
      `exit ${sheet.status}; ${written === null ? 'no file' : `${written.width}x${written.height}`} for the source plus ${WRAPPER_LAYERS.length} layers in ${cols} columns of ${cell} px`,
      'the printed tile list is the sheet for a reader that cannot open it, so it has to describe the sheet that was written',
    );

    const shim = spawnSync('node', [join(ROOT, 'bin', 'spine-parts.cjs'), '--version'], { encoding: 'utf8' });
    say(
      'CL06_THE_BIN_SHIM_HANDS_OFF_TO_BUN',
      shim.status === 0 && (shim.stdout ?? '').trim() === pkg.version,
      `node bin/spine-parts.cjs --version -> exit ${shim.status}, "${(shim.stdout ?? '').trim()}"`,
      'npm installs the bin as a Node script; the shim is what makes a Bun program runnable from it, and the smoke checks its no-Bun half on an install',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// the rig stage
// ---------------------------------------------------------------------------

/** The fixture config through the loader, so every control starts from a config the loader accepts. */
function rigCfg(edit: (c: Record<string, unknown>) => void = () => {}): CharacterConfig {
  const c = rigConfig();
  edit(c);
  return parseConfig(c);
}

/** The same edit applied without the loader — for the rig stage's own checks on a caller that skipped it. */
function rawRigCfg(edit: (c: Record<string, unknown>) => void): CharacterConfig {
  const c = rigConfig();
  edit(c);
  return c as unknown as CharacterConfig;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function runRigSuite(): number {
  section('rig: bones, lattice meshes, weights, regions and the idle');
  const { say, bad } = counter();
  const r = buildRig(rigCfg(), rigParts(), rigImages());
  const cloth = r.rig.skins.default.cloth.cloth as MeshAttachment;
  const eye = r.rig.skins.default.eye.eye as RegionAttachment;
  const uvAt = (u: number, v: number): number => {
    for (let i = 0; i < cloth.uvs.length / 2; i++) if (cloth.uvs[2 * i] === u && cloth.uvs[2 * i + 1] === v) return i;
    return -1;
  };
  const vi = uvAt(RIG_EXPECT.weighed.uv[0], RIG_EXPECT.weighed.uv[1]);
  const got = vi < 0 ? [] : cloth.weights[vi];
  const sums = cloth.weights.map((ws) => pyRound(ws.reduce((a, w) => a + w.weight, 0), 5));
  const report = r.meshReport[0];
  say(
    'RG01_THE_FIXTURE_RIG_HAS_THE_COUNTS_AND_THE_WEIGHT_DERIVED_BY_HAND',
    cloth.uvs.length / 2 === RIG_EXPECT.vertices &&
      cloth.triangles.length / 3 === RIG_EXPECT.triangles &&
      cloth.hull === RIG_EXPECT.hull &&
      JSON.stringify(got) === JSON.stringify(RIG_EXPECT.weighed.weights) &&
      sums.every((x) => x === 1) &&
      eye.x === RIG_EXPECT.region.x &&
      eye.y === RIG_EXPECT.region.y &&
      report.art_coverage === 1 &&
      r.rig.bones.map((b) => b.name).join(',') === RIG_EXPECT.bones.join(','),
    `cloth: ${cloth.uvs.length / 2} vertices, ${cloth.triangles.length / 3} triangles, hull ${cloth.hull}, coverage ${report.art_coverage}; the vertex at uv ${RIG_EXPECT.weighed.uv.join(',')} -> ${JSON.stringify(got)}; every vertex's weights sum to 1: ${sums.every((x) => x === 1)}; eye offset ${eye.x},${eye.y}; bones ${r.rig.bones.map((b) => b.name).join(',')}`,
    'the positive control, every figure derived in fixtures/rig.ts: 3x2 cells make 12 vertices, 12 triangles and a 10-vertex outline; w = 1/(d+r)^2 at d = 0 and d = 8 with r = 8 is 1/64 : 1/256, i.e. 0.8 / 0.2',
  );

  const idle = r.motion.animations.idle;
  const byTarget = new Map(idle.tracks.map((t) => [`${t.bone ?? t.group}.${t.property}`, t]));
  const link0 = byTarget.get('hem0_ctl.rotate');
  const link1 = byTarget.get('hem1_ctl.rotate');
  const eyes = byTarget.get('eyes.scaley');
  // hem1 at phase 0 + 0.1 * 1: v(0) = 2 sin(-0.2 pi); its first handle is v(0) + v'(0) dt / 3 with dt = 0.5 and v' = 2 (2 pi / 4) cos(-0.2 pi).
  const v0 = 2 * Math.sin(-0.2 * Math.PI);
  const h0 = v0 + (2 * (Math.PI / 2) * Math.cos(-0.2 * Math.PI) * 0.5) / 3;
  const closes = link0 !== undefined && link0.keys[0].v[0] === link0.keys[link0.keys.length - 1].v[0];
  say(
    'RG02_THE_IDLE_IS_SINES_WITH_EXACT_TANGENTS_ON_THE_CONTROLS_AND_ONE_BLINK',
    link0 !== undefined &&
      link1 !== undefined &&
      link0.keys.length === RIG_EXPECT.keysPerLink &&
      link1.keys[0].v[0] === pyRound(v0, 4) &&
      link1.keys[0].curve !== undefined &&
      link1.keys[0].curve[1] === pyRound(h0, 4) &&
      link1.keys[0].curve[0] === pyRound(0.5 / 3, 6) &&
      link1.keys[link1.keys.length - 1].curve === undefined &&
      closes &&
      eyes !== undefined &&
      eyes.keys.map((k) => `${k.t}:${k.v[0]}${k.ease === undefined ? '' : `:${k.ease}`}`).join(' ') === '0:1 1:1:shut 1.07:0.12 1.11:0.12:open 1.27:1 4:1' &&
      JSON.stringify(r.motion.groups) === '{"eyes":["eye"],"brows":["eye"]}' &&
      r.controls.join(',') === 'hem0,hem1',
    `hem0_ctl: ${link0?.keys.length ?? 0} keys, first ${link0?.keys[0].v[0]}, last ${link0?.keys[link0.keys.length - 1].v[0]}; hem1_ctl first ${link1?.keys[0].v[0]} (by hand ${pyRound(v0, 4)}), handle ${link1?.keys[0].curve?.join(',')} (by hand ${pyRound(0.5 / 3, 6)},${pyRound(h0, 4)}); eyes ${eyes?.keys.map((k) => `${k.t}:${k.v[0]}`).join(' ')}; controls ${r.controls.join(',')}`,
    'a period of 4 s in a 4 s idle is 8 spans and 9 keys; the lag puts link 1 at phase 0.1; the handle is the Hermite tangent a third of a span out; the blink shuts in 0.07 s, holds 0.04 s and opens in 0.16 s',
  );

  const a = [rigJsonText(r.rig), rigJsonText(r.motion), rigJsonText(r.meshReport)];
  const again = buildRig(rigCfg(), rigParts(), rigImages());
  const b = [rigJsonText(again.rig), rigJsonText(again.motion), rigJsonText(again.meshReport)];
  const dir = temp('rig');
  try {
    const one = writeRigFixture(join(dir, 'one'));
    const two = writeRigFixture(join(dir, 'two'));
    const run1 = runCli(['rig', '--config', one.config, '--parts', one.parts, '--out', join(dir, 'one', 'out')]);
    const run2 = runCli(['rig', '--config', two.config, '--parts', two.parts, '--out', join(dir, 'two', 'out')]);
    const files1 = filesUnder(join(dir, 'one', 'out'));
    const files2 = filesUnder(join(dir, 'two', 'out'));
    const sameBytes = files1.length > 0 && files1.join() === files2.join() && files1.every((f) => readFileSync(join(dir, 'one', 'out', f)).equals(readFileSync(join(dir, 'two', 'out', f))));
    say(
      'RG03_TWO_BUILDS_WRITE_THE_SAME_BYTES',
      a.every((t, i) => t === b[i]) && sameBytes,
      `in memory: rig.json, motion.json and mesh_report.json ${a.every((t, i) => t === b[i]) ? 'identical' : 'DIFFERENT'} across two builds; on disk: ${files1.length} file(s) from two CLI runs into two directories, ${sameBytes ? 'byte-identical' : 'DIFFERENT'}`,
      'determinism is a contract: spine-rigc compares a second compile byte for byte (A18), and the spec it compiles has to hold still first',
    );

    const wroteAll = ['images/cloth.png', 'images/eye.png', 'mesh_report.json', 'motion.json', 'rig.json'].join() === files1.join();
    const gateLines = run1.out.split('\n').filter((l) => /assertions: \d+ measured \(\d+ passed, 0 failed\)/.test(l));
    say(
      'RG04_THE_RIG_COMMAND_WRITES_ONLY_AFTER_SPINE_RIGC_IS_GREEN_ON_IT',
      run1.status === 0 && run2.status === 0 && wroteAll && gateLines.length >= 2 && /rigc build --profile spine-html --pack: exit 0/.test(run1.out) && /rigc validate --profile spine: exit 0/.test(run1.out),
      `exit ${run1.status}; wrote ${files1.join(', ')}; ${gateLines.length} green rigc assertion line(s), e.g. "${gateLines[0]?.trim() ?? ''}"`,
      "CLAUDE.md: the rig stages write only after spine-rigc's round trip has passed — so the command builds the staged spec through rigc before --out sees a byte",
    );

    const red = writeRigFixture(join(dir, 'red'), (() => {
      const c = rigConfig();
      ((c.motion as Record<string, unknown>).blink as Record<string, unknown>).brows = [];
      return c;
    })());
    const redRun = runCli(['rig', '--config', red.config, '--parts', red.parts, '--out', join(dir, 'red', 'out')]);
    say(
      'RG05_A_SPEC_SPINE_RIGC_REFUSES_IS_REFUSED_AND_NOTHING_IS_WRITTEN',
      redRun.status === 1 && /^ {2}FAIL {2}RIG_RIGC_GREEN: rigc build --profile spine-html --pack/m.test(redRun.out) && redRun.out.includes('group "brows" declares no members') && !existsSync(join(dir, 'red', 'out')),
      `a blink whose brows list is empty — which the loader accepts — -> exit ${redRun.status}, ${(redRun.out.split('\n').find((l) => l.includes('RIG_RIGC_GREEN')) ?? '').trim().slice(0, 160)}…; --out exists: ${existsSync(join(dir, 'red', 'out'))}`,
      "the round trip is only a gate if a red one stops the write; rigc's own refusal is carried into the FAIL line so the reader sees what rigc said",
    );

    const bogus = writeRigFixture(join(dir, 'bogus'), (() => {
      const c = rigConfig();
      (c.meshes as Record<string, Record<string, unknown>>).cloth.segments = ['sash'];
      return c;
    })());
    const bogusRun = runCli(['rig', '--config', bogus.config, '--parts', bogus.parts, '--out', join(dir, 'bogus', 'out')]);
    const direct = refusals(() => buildRig(rawRigCfg((c) => ((c.meshes as Record<string, Record<string, unknown>>).cloth.segments = ['sash'])), rigParts(), rigImages()));
    say(
      'RG06_A_MESH_NAMING_AN_UNDECLARED_BONE_IS_REFUSED_BY_NAME',
      bogusRun.status === 1 &&
        /FAIL {2}CONFIG_NAME_RESOLVES: config\.meshes\.cloth\.segments\[0\] — names "sash"/.test(bogusRun.out) &&
        direct !== null &&
        direct.problems.length === 1 &&
        direct.problems[0].code === 'RIG_NAME_RESOLVES' &&
        direct.problems[0].object === 'config.meshes.cloth.segments[0]',
      `through the CLI -> exit ${bogusRun.status}, ${(bogusRun.out.split('\n').find((l) => l.includes('FAIL')) ?? '').trim()}; handed to buildRig without the loader -> ${codes(direct)}: ${direct?.problems[0]?.detail ?? ''}`,
      'a weight bound to a bone that does not exist is the silence rigc was built to end; the loader names it first, and the stage names it again for a caller that skipped the loader',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const noCloth: PartsFile = { ...rigParts(), parts: [] };
  noCloth.parts = rigParts().parts.filter((p) => p.name === 'eye');
  const e1 = refusals(() => buildRig(rigCfg(), noCloth, rigImages()));
  const extra: PartsFile = rigParts();
  extra.parts.push({ ...extra.parts[1], name: 'sash' });
  const e1b = refusals(() => buildRig(rigCfg(), extra, new Map([...rigImages(), ['sash', rigImages().get('eye') as Raster]])));
  say(
    'RG07_A_CONFIG_PART_MISSING_FROM_PARTS_JSON_AND_A_PART_NOBODY_ATTACHES_ARE_REFUSED',
    e1 !== null &&
      e1.problems.length === 1 &&
      e1.problems[0].code === 'RIG_PART_PRESENT' &&
      e1.problems[0].object === 'config.meshes.cloth' &&
      e1b !== null &&
      e1b.problems.length === 1 &&
      e1b.problems[0].code === 'RIG_PART_ATTACHED' &&
      e1b.problems[0].object === 'part "sash"',
    `parts.json without "cloth" -> ${codes(e1)}: ${e1?.problems[0]?.detail ?? ''}; parts.json with an extra "sash" -> ${codes(e1b)}`,
    'the reference stopped at the first unattached part and never checked the other direction, so a mesh whose part was renamed away vanished from the rig with no word',
  );

  const flat = refusals(() =>
    buildRig(
      rigCfg((c) => {
        (c.bones as Array<Record<string, unknown>>)[1] = { chain: 'hem', parent: 'body', points: [[14, 14]], tip: [14, 14] };
        ((c.motion as Record<string, unknown>).tracks as Array<Record<string, unknown>>)[0].amps = [1];
      }),
      rigParts(),
      rigImages(),
    ),
  );
  const noPoints = refusals(() => buildRig(rawRigCfg((c) => ((c.bones as Array<Record<string, unknown>>)[1] = { chain: 'hem', parent: 'body', points: [], tip: [30, 14] })), rigParts(), rigImages()));
  say(
    'RG08_A_CHAIN_WITH_FEWER_THAN_TWO_POINTS_IS_REFUSED',
    flat !== null &&
      flat.problems.some((p) => p.code === 'RIG_CHAIN_POINTS' && p.object === 'config.bones[1] chain "hem" link 0') &&
      noPoints !== null &&
      noPoints.problems.some((p) => p.code === 'RIG_CHAIN_POINTS' && p.object === 'config.bones[1] chain "hem"'),
    `one point and a tip on the same spot -> ${codes(flat)}; no point at all, past the loader -> ${codes(noPoints)}`,
    'a link is a segment from its origin to the next point; with one distinct point there is no segment and distance-to-segment silently becomes distance-to-a-point',
  );

  const noTip = refusals(() => buildRig(rigCfg((c) => ((c.meshes as Record<string, Record<string, unknown>>).cloth.segments = ['hem', 'body'])), rigParts(), rigImages()));
  say(
    'RG09_A_SEGMENT_THE_CONFIG_DOES_NOT_DEFINE_IS_REFUSED_NOT_INVENTED',
    noTip !== null && noTip.problems.length === 1 && noTip.problems[0].code === 'RIG_SEGMENT_DEFINED' && noTip.problems[0].object === 'config.meshes.cloth.segments[1]',
    `"body" (no tip, no chain child) as a segment -> ${codes(noTip)}: ${noTip?.problems[0]?.detail ?? ''}`,
    'the reference gave such a bone the segment (x, y) -> (x, y + 1): one pixel straight down, a direction no field states',
  );

  const oneLoopTwoIslands = refusals(() => buildRig(rigCfg(), rigParts(), islandImages(), 0));
  const joined = refusals(() => buildRig(rigCfg(), rigParts(), islandImages()));
  const joinedRig = joined === null ? buildRig(rigCfg(), rigParts(), islandImages()) : null;
  say(
    'RG10_A_LATTICE_THAT_IS_NOT_ONE_LOOP_IS_REFUSED_AND_TWO_ISLANDS_ARE_JOINED',
    oneLoopTwoIslands !== null &&
      oneLoopTwoIslands.problems.length === 1 &&
      oneLoopTwoIslands.problems[0].code === 'RIG_LATTICE_ONE_LOOP' &&
      oneLoopTwoIslands.problems[0].detail.includes('2 outline loop(s)') &&
      joinedRig !== null &&
      joinedRig.meshReport[0].vertices === RIG_EXPECT.vertices &&
      joinedRig.meshReport[0].art_coverage === 1,
    `cloth as two islands with the pass limit at 0 -> ${codes(oneLoopTwoIslands)}: ${oneLoopTwoIslands?.problems[0]?.detail ?? ''}; with the default limit -> ${joined === null ? `green, ${joinedRig?.meshReport[0].vertices} vertices (the bridge refills the middle column), coverage ${joinedRig?.meshReport[0].art_coverage}` : codes(joined)}`,
    'spine-rigc refuses an outline that is not one closed loop; the reference returned whatever it had when its passes ran out, and this port checks the outline instead of trusting the loop',
  );

  const wrongSize = new Map(rigImages());
  wrongSize.set('eye', rigImages().get('cloth') as Raster);
  const missing = new Map(rigImages());
  missing.delete('cloth');
  const e3 = refusals(() => buildRig(rigCfg(), rigParts(), wrongSize));
  const e4 = refusals(() => buildRig(rigCfg(), rigParts(), missing));
  const blank = new Map(rigImages());
  blank.set('cloth', newRaster(16, 8));
  const e5 = refusals(() => buildRig(rigCfg(), rigParts(), blank));
  say(
    'RG11_A_PART_PNG_MISSING_THE_WRONG_SIZE_OR_EMPTY_IS_REFUSED',
    e3?.problems.map((p) => p.code).join() === 'RIG_PNG_MATCHES_BOX' && e4?.problems.map((p) => p.code).join() === 'RIG_PNG_PRESENT' && e5?.problems.map((p) => p.code).join() === 'RIG_PART_HAS_ART',
    `eye given a 16x8 PNG -> ${codes(e3)}: ${e3?.problems[0]?.detail ?? ''}; cloth absent -> ${codes(e4)}; cloth fully transparent -> ${codes(e5)}`,
    'parts.json places a part by its box; a PNG of another size would put every vertex and offset somewhere the record does not say',
  );

  const late = refusals(() => buildRig(rigCfg((c) => (((c.motion as Record<string, unknown>).blink as Record<string, unknown>).t = 3.9)), rigParts(), rigImages()));
  const taken = refusals(() => buildRig(rigCfg((c) => (c.bones as Array<Record<string, unknown>>).push({ name: 'hem0_ctl', parent: 'body', at: [1, 1] })), rigParts(), rigImages()));
  say(
    'RG12_A_BLINK_OUTSIDE_THE_IDLE_AND_A_TAKEN_CONTROL_NAME_ARE_REFUSED',
    late?.problems.map((p) => p.code).join() === 'RIG_BLINK_INSIDE_IDLE' && taken?.problems.map((p) => `${p.code} ${p.object}`).join() === 'RIG_CONTROL_NAME_FREE bone "hem0"',
    `blink at 3.9 s in a 4 s idle -> ${codes(late)}: ${late?.problems[0]?.detail ?? ''}; a declared "hem0_ctl" -> ${codes(taken)}`,
    'a blink running past the last key writes keys out of order; a control whose name is taken would silently replace a declared bone',
  );
  return bad();
}

/** The corpus of worked examples, when the tree carries one: `examples/<name>/inputs/{config.json, parts.json, parts/}`. */
function runRigExamplesSuite(): number | null {
  section('rig-examples: every examples/*/inputs builds green and twice the same');
  const root = join(ROOT, 'examples');
  const inputs = existsSync(root)
    ? readdirSync(root)
        .sort()
        .map((n) => join(root, n, 'inputs'))
        .filter((d) => existsSync(join(d, 'config.json')) && existsSync(join(d, 'parts.json')))
    : [];
  if (inputs.length === 0) {
    console.log(`  SKIP  no examples/*/inputs holding config.json and parts.json under ${root}, so no worked example was rigged`);
    console.log('          ⚠️ This is a HOLE in this run, not a pass — the rig stage was exercised on the synthetic fixture only.');
    return null;
  }
  const { say, bad } = counter();
  const rows: string[] = [];
  const failed: string[] = [];
  for (const d of inputs) {
    const label = relative(ROOT, d);
    try {
      const cfg = loadConfig(join(d, 'config.json'));
      const parts = readParts(join(d, 'parts.json'));
      const images = new Map<string, Raster>();
      for (const p of parts.parts) {
        const f = join(d, 'parts', `${p.name}.png`);
        if (existsSync(f)) images.set(p.name, decodePngBytes(new Uint8Array(readFileSync(f)), f));
      }
      const one = buildRig(cfg, parts, images);
      const two = buildRig(cfg, parts, images);
      const same = rigJsonText(one.rig) === rigJsonText(two.rig) && rigJsonText(one.motion) === rigJsonText(two.motion);
      const cover = one.meshReport.every((m) => m.art_coverage === 1);
      rows.push(`${label}: ${one.rig.bones.length} bones, ${one.meshReport.length} meshes, ${one.meshReport.reduce((s, m) => s + m.vertices, 0)} vertices, coverage 1 ${cover}, deterministic ${same}`);
      if (!same || !cover) failed.push(label);
    } catch (err) {
      failed.push(`${label}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  say(
    'RX01_EVERY_WORKED_EXAMPLE_RIGS_GREEN_WITH_FULL_COVERAGE_AND_THE_SAME_BYTES_TWICE',
    failed.length === 0,
    `${inputs.length - failed.length} of ${inputs.length}: ${rows.join(' | ')}${failed.length > 0 ? `; red: ${failed.join(' | ')}` : ''}`,
    'the fixture is two blocks; the examples are real parts, and the question only they answer is whether the stage takes what assemble actually writes',
  );
  return bad();
}

// ---------------------------------------------------------------------------
// the propose stage
// ---------------------------------------------------------------------------

function boneAt(bones: readonly BoneEntry[], name: string): string {
  const b = bones.find((e) => ('name' in e ? e.name : e.chain) === name);
  if (b === undefined) return 'absent';
  return 'chain' in b ? `${JSON.stringify(b.points)}->${JSON.stringify(b.tip)}` : JSON.stringify(b.at);
}

/** A proposal as a config the loader accepts: the plan is the parts themselves. */
function proposalConfig(parts: readonly ProposeFixturePart[], prop: Proposal): Record<string, unknown> {
  return {
    key: 'fixture',
    assemble: { rig_scale: 1, plan: parts.map((p) => [p.name, ...p.from.split(':')]) },
    bones: prop.bones,
    meshes: prop.meshes,
    regions: prop.regions,
    motion: prop.motion,
  };
}

/** A full-run layer set built in memory: one opaque rectangle per layer on a square canvas. */
function headRun(side: number, rects: Array<[string, number, number, number, number]>): LayerSet {
  return {
    form: 'wrapper',
    source: 'fixture layers.json',
    canvas: { w: side, h: side },
    layers: rects.map(([name, left, top, w, h], i) => {
      const pixels = newRaster(w, h);
      for (let j = 0; j < w * h; j++) pixels.data.set([200, 180, 170, 255], j * 4);
      return { name, tag: readTag(name) as TagReading, file: null, pixels, left, top, right: left + w, bottom: top + h, depth: null, drawOrder: i, opaquePx: w * h };
    }),
  };
}

function runProposeSuite(): number {
  section('propose: bones, meshes and regions from the parts');
  const { say, bad } = counter();
  const dir = temp('propose');
  try {
    writeProposeFixture(dir);
    const P = readPartSet(dir);
    const prop = propose(P);
    // Hand-derived from fixtures/propose.ts (face 80,40 40x50; skirt 60,150 80x100; sleeves 20,100 and 160,100 20x60):
    //   axis = 80 + 40/2 = 100; chin = 90; no neck part -> neck y = 90 + 0.12*50 = 96; head y = 40 + 0.88*50 = 84.
    //   hip = (60 + 80/2, 150 + 0.14*50) = (100, 157); chest y = 96 + 0.5*(157 - 96) = 126.5, which Python's round takes to EVEN: 126.
    //   skirt chains: y = 177 + k*(250 - 4 - 177)/3 = 177, 200, 223, tip 246; x = 60 + f*79 = 83.7 -> 84, 99.5 -> 100 (even), 115.3 -> 115.
    //   sleeves: rows 100..159, y0 = 115, span = 159 - 6 - 115 = 38 -> y 115, 127.67 -> 128, 140.33 -> 140, tip 156;
    //   x = the band centroid 29.5 -> 30 and 169.5 -> 170 (ties, to even; ties-up agrees on these two).
    const want: Record<string, string> = {
      hip: '[100,157]',
      chest: '[100,126]',
      neck: '[100,96]',
      head: '[100,84]',
      skirt_r: '[[84,177],[84,200],[84,223]]->[84,246]',
      skirt_c: '[[100,177],[100,200],[100,223]]->[100,246]',
      skirt_l: '[[115,177],[115,200],[115,223]]->[115,246]',
      sleeve_r: '[[30,115],[30,128],[30,140]]->[30,156]',
      sleeve_l: '[[170,115],[170,128],[170,140]]->[170,156]',
    };
    const wrong = Object.entries(want).filter(([n, v]) => boneAt(prop.bones, n) !== v).map(([n, v]) => `${n} ${boneAt(prop.bones, n)} (want ${v})`);
    const names = prop.bones.map((b) => ('name' in b ? b.name : b.chain));
    say(
      'PR01_HAND_COMPUTED_PARTS_YIELD_THE_HAND_COMPUTED_BONES',
      wrong.length === 0 && names.join(',') === 'hip,chest,neck,head,sleeve_r,sleeve_l,skirt_r,skirt_c,skirt_l',
      `${names.length} bone entries (${names.join(', ')}); ${wrong.length === 0 ? 'face -> hip/chest/neck/head, bottomwear -> three skirt chains, two handwear blobs -> two sleeve chains, every coordinate as derived' : `wrong: ${wrong.join('; ')}`}`,
      "the rules are the reference proposer's; the fixture's rectangles make every one of them checkable by hand, and chest y 126.5 is an exact tie that only a round-half-to-even port takes to 126 (measured: a ties-up round makes this case FAIL on chest alone; the other ties, 29.5, 99.5 and 169.5, land on the same integer either way)",
    );

    const segs = (m: string): string => JSON.stringify(prop.meshes[m]?.segments ?? null);
    const regionsOk = JSON.stringify(prop.regions) === '{"face":"head"}';
    const meshOk =
      segs('sleeve_a') === '[["chest",[30,101],[30,117]],"sleeve_r"]' &&
      segs('sleeve_b') === '[["chest",[170,101],[170,117]],"sleeve_l"]' &&
      segs('skirt') === '[["chest",[100,96],[100,137]],["hip",[67,162],[133,162]],"skirt_r","skirt_c","skirt_l"]';
    const bytes = serializeProposal(prop);
    const again = serializeProposal(propose(readPartSet(dir)));
    const loads = refusals(() => parseConfig(proposalConfig(PROPOSE_PARTS, prop)));
    say(
      'PR02_ROLES_COME_FROM_THE_TAG_AND_THE_PROPOSAL_IS_A_LOADABLE_DETERMINISTIC_CONFIG',
      meshOk && regionsOk && bytes === again && loads === null,
      `sleeve_a (handwear-r) -> ${segs('sleeve_a')}; sleeve_b (handwear-l) -> ${segs('sleeve_b')}; regions ${JSON.stringify(prop.regions)}; two runs ${bytes === again ? 'identical' : 'DIFFERENT'} (${bytes.length} bytes); config loader: ${codes(loads)}`,
      'the parts are named sleeve_a/sleeve_b/skirt, not by role, so a name-based rule would miss them; and a proposal is pasted into a config, so it must load as one',
    );

    // A planted config: skirt_c moved to x = 190, outside the skirt (60..139) dilated 15 px (45..154).
    const planted = proposalConfig(PROPOSE_PARTS, prop) as { bones: BoneEntry[] } & Record<string, unknown>;
    planted.bones = prop.bones.map((b) => ('chain' in b && b.chain === 'skirt_c' ? { ...b, points: b.points.map((q): [number, number] => [190, q[1]]) } : b));
    const clean = lint(P, prop).findings.map(lintLine);
    const found = lint(P, { bones: planted.bones, meshes: prop.meshes }).findings.map(lintLine);
    const wantLint = [0, 1, 2].map((k) => `LINT skirt_c${k} at [190, ${177 + 23 * k}] is off the art of mesh 'skirt'`);
    const cfgClean = join(dir, 'clean.json');
    const cfgPlanted = join(dir, 'planted.json');
    writeFileSync(cfgClean, JSON.stringify(proposalConfig(PROPOSE_PARTS, prop)));
    writeFileSync(cfgPlanted, JSON.stringify(planted));
    const out = join(dir, 'out');
    const cliClean = runCli(['propose', '--parts', dir, '--source', join(dir, 'painting.png'), '--out', out, '--from-config', cfgClean]);
    const cliPlanted = runCli(['propose', '--parts', dir, '--source', join(dir, 'painting.png'), '--out', out, '--from-config', cfgPlanted]);
    const printed = cliPlanted.out.split('\n').filter((l) => l.startsWith('LINT '));
    say(
      'PR03_A_CHAIN_POINT_ON_TRANSPARENT_ART_IS_A_LINT_LINE_IN_THE_REFERENCE_FORMAT',
      clean.length === 0 && found.join('|') === wantLint.join('|') && cliClean.status === 0 && cliPlanted.status === 1 && printed.join('|') === wantLint.join('|'),
      `the proposal lints ${clean.length}; skirt_c planted at x 190 -> ${found.length} line(s): ${found.join(' | ')}; --from-config exits ${cliClean.status} clean and ${cliPlanted.status} planted, printing ${printed.length}`,
      "the LINT line is the reference's, verbatim, so an agent reading either tool reads the same finding; a mesh's candidate bone sitting in the background still weights by distance, which is how a rig moves the wrong pixels in silence",
    );

    const unknownDir = join(dir, 'unknown');
    // writeParts refuses an unknown tag itself, so the plant is made in the file after a green write.
    writeProposeFixture(unknownDir);
    writeFileSync(join(unknownDir, 'parts.json'), readFileSync(join(unknownDir, 'parts.json'), 'utf8').replace('"full:bottomwear"', '"full:skirt"'));
    const e = refusals(() => readPartSet(unknownDir));
    const cliUnknown = runCli(['propose', '--parts', unknownDir, '--source', join(unknownDir, 'painting.png'), '--out', join(dir, 'out2')]);
    const noFaceDir = join(dir, 'noface');
    writeProposeFixture(noFaceDir, PROPOSE_PARTS.filter((p) => p.name !== 'face'));
    const noFace = refusals(() => propose(readPartSet(noFaceDir)));
    say(
      'PR04_AN_UNKNOWN_TAG_AND_A_MISSING_FACE_ARE_REFUSED_BY_NAME',
      e !== null &&
        e.problems.some((p) => p.code === 'PARTS_FROM_KNOWN' && p.object.includes('part "skirt"') && p.detail.includes('"full:skirt"')) &&
        cliUnknown.status === 1 &&
        !existsSync(join(dir, 'out2', 'proposal.json')) &&
        noFace !== null &&
        noFace.problems[0].code === 'PROPOSE_FACE_PRESENT',
      `"full:skirt" -> ${codes(e)} (CLI exit ${cliUnknown.status}, proposal.json ${existsSync(join(dir, 'out2', 'proposal.json')) ? 'WRITTEN' : 'not written'}); no face part -> ${codes(noFace)}`,
      'a role is read from the tag, so a tag the vocabulary does not hold is refused rather than mapped to a near one; the reference crashed with an IndexError on a missing face',
    );

    // Compare: the config's head moved by (3, 4) -> exactly 5.0 px; everything else 0.0.
    const moved = prop.bones.map((b) => ('name' in b && b.name === 'head' ? { ...b, at: [b.at[0] + 3, b.at[1] + 4] as [number, number] } : b));
    const lines = compareLines(compare(prop.bones, moved));
    say(
      'PR05_COMPARE_PRINTS_EACH_SHARED_BONE_S_DISTANCE_IN_THE_REFERENCE_FORMAT',
      lines.includes('  head            5.0 px') && lines.includes('  hip             0.0 px') && lines.includes('matched 19 bones: median 0.0 px, mean 0.3, p90 0.0, max 5.0; <=10 px 19, <=25 px 19'),
      lines.filter((l) => l.startsWith('  head') || l.startsWith('matched')).join(' | '),
      'the head moved (3, 4) is a 3-4-5 triangle; 19 origins (4 single bones + 5 chains of 3 links), one of them 5 px off: mean 5/19 = 0.263 -> "0.3"; p90 by numpy\'s linear rule sits at index 19*0.9 + 0.1 - 1 = 16.2, between two zeros',
    );

    const inside = proposeHeadBox(headRun(100, [['face', 40, 40, 20, 20]]), { w: 100, h: 100 });
    const leaving = proposeHeadBox(headRun(100, [['face', 40, 0, 20, 20]]), { w: 100, h: 100 });
    const tooBig = refusals(() => proposeHeadBox(headRun(100, [['face', 4, 4, 92, 92]]), { w: 100, h: 100 }));
    const faceless = refusals(() => proposeHeadBox(headRun(100, [['front hair', 40, 40, 20, 20]]), { w: 100, h: 100 }));
    // The face 40..59 x 40..59: size = 19*1.12 = 21.28 about (49.5, 49.5): edges round(38.86) = 39, round(60.14) = 60 -> [39, 39, 60, 60].
    // At y 0..19 the same box is [39, -1, 60, 20]: one pixel above the canvas, so it moves down 1 at the same size.
    // A 92 px face spans 91 px: 91*1.12 = 101.92, so its box is 102 px and no 100 px canvas holds it.
    say(
      'PR06_A_HEAD_BOX_THAT_LEAVES_THE_CANVAS_IS_SHIFTED_INSIDE_AT_THE_SAME_SIZE',
      inside.head_box.join(',') === '39,39,60,60' &&
        inside.shift.join(',') === '0,0' &&
        leaving.unclamped.join(',') === '39,-1,60,20' &&
        leaving.head_box.join(',') === '39,0,60,21' &&
        leaving.shift.join(',') === '0,1' &&
        tooBig?.problems[0].code === 'HEADBOX_FITS_CANVAS' &&
        faceless?.problems[0].code === 'HEADBOX_FACE_PRESENT',
      `inside: [${inside.head_box.join(', ')}] shift ${inside.shift.join(',')}; at the top edge: [${leaving.unclamped.join(', ')}] -> [${leaving.head_box.join(', ')}] shift ${leaving.shift.join(',')}; a box larger than the canvas -> ${codes(tooBig)}; no face -> ${codes(faceless)}`,
      'the reference proposed a box 118 px above the public demo painting and the crop filled that band with black; the control is the same geometry on a 100 px canvas',
    );

    const cliOut = join(dir, 'cli');
    const cli = runCli(['propose', '--parts', dir, '--source', join(dir, 'painting.png'), '--out', cliOut, '--compare', cfgClean]);
    const written = existsSync(join(cliOut, 'proposal.json')) ? readFileSync(join(cliOut, 'proposal.json'), 'utf8') : '';
    const overlay = existsSync(join(cliOut, 'render', 'landmarks.png')) ? decodePngBytes(new Uint8Array(readFileSync(join(cliOut, 'render', 'landmarks.png'))), 'landmarks.png') : null;
    const head = existsSync(join(cliOut, 'render', 'landmarks_head.png')) ? decodePngBytes(new Uint8Array(readFileSync(join(cliOut, 'render', 'landmarks_head.png'))), 'landmarks_head.png') : null;
    say(
      'PR07_THE_CLI_WRITES_THE_PROPOSAL_AND_BOTH_OVERLAYS_AND_PRINTS_THE_COMPARISON',
      cli.status === 0 && written === bytes && overlay?.width === PROPOSE_RIG.w && overlay.height === PROPOSE_RIG.h && head?.width === 600 && head.height === 640 && cli.out.includes('matched 19 bones: median 0.0 px'),
      `exit ${cli.status}; proposal.json ${written === bytes ? 'is' : 'is NOT'} the serialised proposal; landmarks.png ${overlay === null ? 'absent' : `${overlay.width}x${overlay.height}`}, landmarks_head.png ${head === null ? 'absent' : `${head.width}x${head.height}`}`,
      'the overlay is the rig size and the head crop is 300x320 rig px at 2x, as the reference draws them; the proposal file is the same bytes the function serialises',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

/**
 * The public examples, where they have been fetched: `examples/<key>/` tracks
 * `config.json` and `proposal.json` (the reference proposer's output), and
 * `bun run fetch-examples` puts `inputs/painting.png` and the See-through
 * layer sets `inputs/layers/{full,head}` beside them. Assembled parts are the
 * assemble stage's output; where an example carries them (`parts.json` beside
 * a `parts/` directory, under `inputs/` or `expected/`), the proposal half runs.
 */
function exampleDirs(): string[] {
  const root = join(ROOT, 'examples');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((n) => join(root, n))
    .filter((d) => existsSync(join(d, 'config.json')) && existsSync(join(d, 'inputs', 'painting.png')) && existsSync(join(d, 'inputs', 'layers', 'full')));
}

function assembledParts(example: string): string | null {
  for (const sub of ['inputs', 'expected']) {
    const d = join(example, sub);
    if (existsSync(join(d, 'parts.json')) && existsSync(join(d, 'parts'))) return d;
  }
  return null;
}

/** Deep equality of two parsed JSON values, numbers by value: 4 and 4.0 are one number once parsed. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

function runProposeCorpusSuite(): number | null {
  section('propose: the public examples (corpus)');
  const examples = exampleDirs();
  if (examples.length === 0) {
    console.log('  SKIP  no fetched examples/<key>/inputs (painting.png + layers/full) in this tree, so the proposer ran on the generated fixture only');
    console.log('          ⚠️ This is a HOLE in this run, not a pass — run `bun run fetch-examples` to cover the head box and the proposal on real layers.');
    return null;
  }
  const { say, bad } = counter();
  const boxes: string[] = [];
  const wrongBox: string[] = [];
  for (const d of examples) {
    const key = relative(join(ROOT, 'examples'), d);
    try {
      const painting = readPng(join(d, 'inputs', 'painting.png'));
      const r = proposeHeadBox(readLayers(join(d, 'inputs', 'layers', 'full')), { w: painting.width, h: painting.height });
      const cfg = JSON.parse(readFileSync(join(d, 'config.json'), 'utf8')) as { seethrough?: { head_box?: number[] } };
      const want = cfg.seethrough?.head_box;
      const line = `${key} [${r.head_box.join(', ')}]${r.shift[0] !== 0 || r.shift[1] !== 0 ? ` (clamped from [${r.unclamped.join(', ')}])` : ''}`;
      boxes.push(line);
      if (want === undefined || want.join(',') !== r.head_box.join(',')) wrongBox.push(`${line}; config.json holds ${want === undefined ? 'no head_box' : `[${want.join(', ')}]`}`);
    } catch (err) {
      wrongBox.push(`${key}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  say(
    'PC01_EVERY_EXAMPLE_HEAD_BOX_PROPOSED_FROM_ITS_FULL_RUN_IS_THE_ONE_ITS_CONFIG_CARRIES',
    wrongBox.length === 0,
    wrongBox.length === 0 ? `${examples.length} example(s): ${boxes.join('; ')}` : `${examples.length - wrongBox.length} of ${examples.length}; ${wrongBox.join(' | ')}`,
    "each example's config carries the head box its head run was actually fed, a clamped one included; a proposer that reproduces it from the full run's layers reproduces the input stage",
  );

  const withParts = examples.map((d) => [d, assembledParts(d)] as const).filter(([, p]) => p !== null) as Array<readonly [string, string]>;
  if (withParts.length === 0) {
    console.log('  SKIP  PC02: no example carries assembled parts (parts.json beside parts/), so no proposal was compared');
    console.log('          ⚠️ This half is a HOLE: the proposal needs the assemble stage\'s parts.');
  } else {
    const failed: string[] = [];
    for (const [d, parts] of withParts) {
      const key = relative(join(ROOT, 'examples'), d);
      try {
        const P = readPartSet(parts);
        const a = propose(P);
        checkProposal(P, a);
        const again = serializeProposal(propose(readPartSet(parts)));
        const tracked = JSON.parse(readFileSync(join(d, 'proposal.json'), 'utf8')) as unknown;
        if (again !== serializeProposal(a)) failed.push(`${key}: two runs differ`);
        if (!sameJson(JSON.parse(serializeProposal(a)), tracked)) failed.push(`${key}: differs from the tracked proposal.json`);
      } catch (err) {
        failed.push(`${key}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    say(
      'PC02_EVERY_EXAMPLE_WITH_PARTS_PROPOSES_THE_TRACKED_PROPOSAL_FIELD_BY_FIELD',
      failed.length === 0,
      `${withParts.length - failed.length} of ${withParts.length} example(s) with assembled parts${failed.length > 0 ? `; ${failed.join(' | ')}` : ''}`,
      "the tracked proposal.json is what the reference proposer wrote from the same parts; the port is deterministic, so it must be equal field by field, and loadable, and the same twice",
    );
  }
  return bad();
}

// ---------------------------------------------------------------------------
// check: the whole stage, through the installed spine-rigc, on a rig authored here
// ---------------------------------------------------------------------------

/** Every file under a directory, relative, sorted — to prove a read-only input stayed read-only. */
function listing(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listing(p, base));
    else out.push(`${relative(base, p)}:${statSync(p).size}`);
  }
  return out;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : null;
}

const CHECK_KEYS = ['gate_spine_html_green', 'gate_spine_green', 'loop_max_diff', 'seam_mean', 'seam_px_over_40', 'seam_px_over_80', 'PASS'];

function failLine(out: string, code: string): string | null {
  return out.split('\n').find((l) => l.startsWith(`  FAIL  ${code}`)) ?? null;
}

function runCheckSuite(): number {
  section('check: build, gates, seam and loop through the installed spine-rigc');
  const { say, bad } = counter();
  const dir = temp('check');
  try {
    const rig = join(dir, 'rig');
    writeCheckRig(rig);
    const before = listing(rig);
    const out = join(dir, 'out');
    const ok = runCli(['check', '--rig', rig, '--out', out]);
    const fig = readJsonFile(join(out, 'check.json'));
    const pack = parsePackLines(existsSync(join(out, 'gate_spine-html.txt')) ? readFileSync(join(out, 'gate_spine-html.txt'), 'utf8').split('\n') : []);
    const outputs = ['gate_spine-html.txt', 'gate_spine.txt', 'contact.png', 'motion_heat.png', 'check.json', 'build/skeleton.json', 'build/skeleton.atlas', 'build/skeleton.png', 'idle_frames/frames.json', 'idle_frames/idle/f0000.png'];
    const missing = outputs.filter((o) => !existsSync(join(out, o)));
    say(
      'CK01_THE_AUTHORED_RIG_PASSES_AND_EVERY_OUTPUT_IS_WRITTEN_OUTSIDE_THE_RIG',
      ok.status === 0 &&
        ok.out.includes('check: PASS') &&
        fig !== null &&
        Object.keys(fig).join(',') === CHECK_KEYS.join(',') &&
        fig.PASS === true &&
        missing.length === 0 &&
        pack.length === 1 &&
        pack[0].regions === CHECK_PARTS.length &&
        ok.out.includes(SPINEBOY_YARDSTICK) &&
        listing(rig).join('|') === before.join('|') &&
        !existsSync(join(out, '_still')),
      `exit ${ok.status}; check.json ${fig === null ? 'absent' : JSON.stringify(fig)}; missing outputs: ${missing.join(', ') || 'none'}; pack ${pack.map((p) => p.line).join(' | ') || 'none'} for ${CHECK_PARTS.length} part(s); --rig ${listing(rig).join('|') === before.join('|') ? 'unchanged' : 'CHANGED'}`,
      'the positive control: a two-part, one-bone rig with a closed idle and an exact stack must come back green from both profiles, with the reference\'s seven check.json keys in its order, the packed page as the build, and nothing written into the input',
    );

    const again = runCli(['check', '--rig', rig, '--out', join(dir, 'out2')]);
    const same = ['check.json', 'motion_heat.png', 'gate_spine-html.txt', 'gate_spine.txt', 'build/skeleton.json', 'build/skeleton.png'].filter(
      (f) => existsSync(join(out, f)) && existsSync(join(dir, 'out2', f)) && Buffer.compare(readFileSync(join(out, f)), readFileSync(join(dir, 'out2', f))) === 0,
    );
    say(
      'CK02_TWO_RUNS_WRITE_THE_SAME_BYTES',
      again.status === 0 && same.length === 6,
      `second run exit ${again.status}; ${same.length} of 6 outputs byte-identical (${same.join(', ')})`,
      'determinism is a contract: the same rig must write the same check.json, heat map and gate files, or no diff of them means anything',
    );

    const loopRig = join(dir, 'loop');
    writeCheckRig(loopRig, { lastKey: IDLE_PEAK + 1 });
    const loop = runCli(['check', '--rig', loopRig, '--out', join(dir, 'loop-out')]);
    const lf = readJsonFile(join(dir, 'loop-out', 'check.json'));
    const ll = failLine(loop.out, 'CHECK_LOOP_CLOSES');
    const quoted = ll === null ? null : /max \|d\| (\d+)\/255/.exec(ll);
    say(
      'CK03_AN_IDLE_WHOSE_LAST_KEY_IS_NOT_ITS_FIRST_FAILS_THE_LOOP_WITH_THE_MAX_QUOTED',
      loop.status === 1 && quoted !== null && Number(quoted[1]) > 0 && lf !== null && lf.loop_max_diff === Number(quoted[1]) && lf.PASS === false && failLine(loop.out, 'CHECK_SEAM') === null,
      `exit ${loop.status}; ${ll?.trim() ?? 'no CHECK_LOOP_CLOSES line'}; check.json loop_max_diff ${lf?.loop_max_diff ?? 'absent'}`,
      'the gate cannot see a loop that jumps — both profiles pass it — so the loop check is the only thing between that idle and a README; the setup pose is unchanged, so the seam must stay quiet',
    );

    const seamRig = join(dir, 'seam');
    writeCheckRig(seamRig);
    writeFileSync(join(seamRig, 'parts', `${CHECK_PARTS[0].name}.png`), encodePngBytes(shiftRight(checkPartRaster(CHECK_PARTS[0]), 3)));
    const seam = runCli(['check', '--rig', seamRig, '--out', join(dir, 'seam-out')]);
    const sf = readJsonFile(join(dir, 'seam-out', 'check.json'));
    const sl = failLine(seam.out, 'CHECK_SEAM_WITHIN_BAR');
    say(
      'CK04_A_PART_SHIFTED_THREE_PIXELS_FAILS_THE_SEAM_WITH_THE_NUMBERS',
      seam.status === 1 && sl !== null && sf !== null && sl.includes(`mean |d| ${String(sf.seam_mean)}/255`) && sl.includes(`${String(sf.seam_px_over_40)} px over`) && sf.loop_max_diff === 0 && sf.gate_spine_html_green === true,
      `exit ${seam.status}; ${sl?.trim() ?? 'no CHECK_SEAM_WITHIN_BAR line'}`,
      'parts/ is what the seam composites and images/ is what rigc draws; a part moved 3 px in one and not the other is the drift an assembler bug produces, and both gates pass it',
    );

    const redRig = join(dir, 'red');
    writeCheckRig(redRig, { opaqueFront: true });
    const red = runCli(['check', '--rig', redRig, '--out', join(dir, 'red-out')]);
    const rl = failLine(red.out, 'CHECK_RIGC_GREEN');
    const gateFile = existsSync(join(dir, 'red-out', 'gate_spine-html.txt')) ? readFileSync(join(dir, 'red-out', 'gate_spine-html.txt'), 'utf8') : '';
    say(
      'CK05_A_RIG_RIGC_REFUSES_SURFACES_RIGCS_ASSERTION_BY_NAME_AND_WRITES_NO_VERDICT',
      red.status === 1 && rl !== null && rl.includes('A19_OVERLAY_PNGS_HAVE_ALPHA') && gateFile.includes('A19_OVERLAY_PNGS_HAVE_ALPHA') && !existsSync(join(dir, 'red-out', 'check.json')),
      `exit ${red.status}; ${rl === null ? 'no CHECK_RIGC_GREEN line' : rl.trim().slice(0, 140)}…; gate file ${gateFile.includes('A19_') ? 'quotes A19' : 'does not quote A19'}; check.json ${existsSync(join(dir, 'red-out', 'check.json')) ? 'WRITTEN' : 'not written'}`,
      "an opaque part is refused by rigc's own A19 under spine-html; the refusal an agent reads has to be rigc's line, not a paraphrase of it, and a red build leaves no check.json that could be mistaken for a verdict",
    );

    const holeRig = join(dir, 'hole');
    writeCheckRig(holeRig);
    rmSync(join(holeRig, 'motion.json'));
    rmSync(join(holeRig, 'parts', `${CHECK_PARTS[1].name}.png`));
    const hole = refusals(() => readCheckInputs(holeRig));
    say(
      'CK06_A_RIG_DIRECTORY_MISSING_TWO_INPUTS_IS_REFUSED_NAMING_BOTH',
      codes(hole).includes('CHECK_INPUT_PRESENT') && codes(hole).includes('CHECK_PART_PNG_PRESENT') && (hole?.problems.length ?? 0) === 2,
      `refused: ${codes(hole)}`,
      'readers collect every problem and throw once, so one run names everything that is missing',
    );

    const found = findRigc(ROOT, '');
    const nowhere = refusals(() => findRigc(dir, ''));
    say(
      'CK07_RIGC_IS_FOUND_BESIDE_THE_PACKAGE_AND_A_MISS_IS_REFUSED_NAMING_WHERE_IT_LOOKED',
      found.endsWith(join('node_modules', '.bin', 'rigc')) && codes(nowhere).startsWith('CHECK_RIGC_PRESENT') && (nowhere?.problems[0].detail.includes(join(dir, 'node_modules', '.bin', 'rigc')) ?? false),
      `from the package: ${relative(ROOT, found)}; from ${relative(tmpdir(), dir)} with an empty PATH: ${nowhere?.problems[0].detail.slice(0, 120) ?? 'found one'}…`,
      'a missing rigc must say which binary and where it looked, not surface as a spawn error',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const tenFailed = '  ..    49 assertions: 23 measured (13 passed, 10 failed), 26 skipped';
  const pack = parsePackLines(['  ..    pack: skeleton.png 1024x2048, 21 region(s), 49.2% covered, padding 2']);
  say(
    'CK08_A_GATE_IS_READ_BY_ITS_COUNT_NOT_BY_A_SUBSTRING_AND_NO_SUMMARY_IS_NOT_GREEN',
    tenFailed.includes('0 failed') && !gateGreen(0, [tenFailed]) && !gateGreen(0, []) && gateGreen(0, ['  ..    49 assertions: 14 measured (14 passed, 0 failed)']) && !gateGreen(1, ['  ..    49 assertions: 14 measured (14 passed, 0 failed)']) &&
      pack.length === 1 && pack[0].width === 1024 && pack[0].height === 2048 && pack[0].regions === 21 && pack[0].coveredPct === 49.2 && pack[0].padding === 2,
    `"10 failed" contains "0 failed" (${tenFailed.includes('0 failed')}) and reads ${gateGreen(0, [tenFailed]) ? 'GREEN' : 'red'}; no summary line reads ${gateGreen(0, []) ? 'GREEN' : 'red'}; a pack line parses to ${JSON.stringify(pack[0] ?? null)}`,
    "the reference judged a gate by the substring \"0 failed\", which \"10 failed\" contains, and by Python's all() over the summary lines, which is True of none; both would print green over a red build",
  );
  return bad();
}

// ---------------------------------------------------------------------------
// loop: the APNG and GIF encoders, read back by decoders written here
// ---------------------------------------------------------------------------

interface DecodedFrame {
  image: Raster;
  /** Display time in the file's own unit: APNG delay_num over delay_den as seconds, GIF centiseconds. */
  delay: number;
}

function be32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function unfilter(raw: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const type = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >>> 1 : pr;
      out[y * stride + i] = (x + pred) & 255;
    }
  }
  return out;
}

/** A minimal APNG reader: 8-bit RGBA only, dispose NONE, blend SOURCE or OVER on opaque-or-cleared pixels. */
function decodeApng(bytes: Uint8Array): { frames: DecodedFrame[]; numFrames: number; plays: number } {
  let at = 8;
  let w = 0;
  let h = 0;
  let numFrames = -1;
  let plays = -1;
  let canvas = new Uint8Array(0);
  let pending: { x: number; y: number; w: number; h: number; delay: number; blend: number; data: Uint8Array[] } | null = null;
  const frames: DecodedFrame[] = [];
  const flush = (): void => {
    if (pending === null) return;
    const px = unfilter(new Uint8Array(inflateSync(Buffer.concat(pending.data))), pending.w, pending.h);
    for (let y = 0; y < pending.h; y++) {
      for (let x = 0; x < pending.w; x++) {
        const s = (y * pending.w + x) * 4;
        const d = ((pending.y + y) * w + pending.x + x) * 4;
        if (pending.blend === 1 && px[s + 3] === 0) continue;
        canvas.set(px.subarray(s, s + 4), d);
      }
    }
    frames.push({ image: { width: w, height: h, data: new Uint8ClampedArray(canvas) }, delay: pending.delay });
    pending = null;
  };
  while (at < bytes.length) {
    const len = be32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = be32(body, 0);
      h = be32(body, 4);
      canvas = new Uint8Array(w * h * 4);
    } else if (type === 'acTL') {
      numFrames = be32(body, 0);
      plays = be32(body, 4);
    } else if (type === 'fcTL') {
      flush();
      pending = { w: be32(body, 4), h: be32(body, 8), x: be32(body, 12), y: be32(body, 16), delay: ((body[20] << 8) | body[21]) / ((body[22] << 8) | body[23]), blend: body[25], data: [] };
    } else if (type === 'IDAT' || type === 'fdAT') pending?.data.push(type === 'IDAT' ? body : body.subarray(4));
    else if (type === 'IEND') flush();
    at += 12 + len;
  }
  return { frames, numFrames, plays };
}

/** A minimal GIF LZW decoder, written independently of `src/gif.ts`'s encoder. */
function lzwDecode(data: Uint8Array, minCode: number, count: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out = new Uint8Array(count);
  let n = 0;
  let size = minCode + 1;
  let dict: number[][] = [];
  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    size = minCode + 1;
  };
  reset();
  let prev: number[] | null = null;
  let bitPos = 0;
  const total = data.length * 8;
  while (bitPos + size <= total) {
    let code = 0;
    for (let i = 0; i < size; i++) code |= ((data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1) << i;
    bitPos += size;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev !== null) entry = [...prev, prev[0]];
    else throw new Error(`LZW code ${code} with a table of ${dict.length}`);
    for (const v of entry) if (n < count) out[n++] = v;
    if (prev !== null && dict.length < 4096) dict.push([...prev, entry[0]]);
    if (dict.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  if (n !== count) throw new Error(`LZW decoded ${n} index(es); the frame needs ${count}`);
  return out;
}

/** A minimal GIF89a reader: global palette, GCE transparency and delay, disposal "do not dispose". */
function decodeGif(b: Uint8Array): { frames: DecodedFrame[]; loops: number | null } {
  const w = b[6] | (b[7] << 8);
  const h = b[8] | (b[9] << 8);
  const gct = b[10] & 0x80 ? 3 * (1 << ((b[10] & 7) + 1)) : 0;
  const palette = b.subarray(13, 13 + gct);
  let at = 13 + gct;
  const canvas = new Uint8ClampedArray(w * h * 4);
  const frames: DecodedFrame[] = [];
  let delay = 0;
  let transparent = -1;
  let loops: number | null = null;
  const blocks = (): Uint8Array => {
    const parts: number[] = [];
    while (b[at] !== 0) {
      const n = b[at];
      for (let i = 1; i <= n; i++) parts.push(b[at + i]);
      at += n + 1;
    }
    at++;
    return new Uint8Array(parts);
  };
  while (at < b.length && b[at] !== 0x3b) {
    if (b[at] === 0x21 && b[at + 1] === 0xf9) {
      transparent = b[at + 3] & 1 ? b[at + 6] : -1;
      delay = b[at + 4] | (b[at + 5] << 8);
      at += 8;
    } else if (b[at] === 0x21) {
      const label = b[at + 1];
      at += 2;
      const body = blocks();
      if (label === 0xff && body.length >= 14) loops = body[12] | (body[13] << 8);
    } else if (b[at] === 0x2c) {
      const x0 = b[at + 1] | (b[at + 2] << 8);
      const y0 = b[at + 3] | (b[at + 4] << 8);
      const fw = b[at + 5] | (b[at + 6] << 8);
      const fh = b[at + 7] | (b[at + 8] << 8);
      at += 10;
      const minCode = b[at++];
      const ix = lzwDecode(blocks(), minCode, fw * fh);
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const v = ix[y * fw + x];
          if (v === transparent) continue;
          canvas.set([palette[v * 3], palette[v * 3 + 1], palette[v * 3 + 2], 255], ((y0 + y) * w + x0 + x) * 4);
        }
      }
      frames.push({ image: { width: w, height: h, data: new Uint8ClampedArray(canvas) }, delay });
    } else throw new Error(`GIF byte ${at} is 0x${b[at].toString(16)}; a block introducer is required`);
  }
  return { frames, loops };
}

function channelError(a: Raster, b: Raster): { max: number; mean: number } {
  let max = 0;
  let sum = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]);
      if (e > max) max = e;
      sum += e;
    }
  }
  return { max, mean: sum / (a.width * a.height * 3) };
}

/** A deterministic pseudo-random sequence (a 32-bit LCG) — the selftest reads no randomness either. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function runLoopSuite(): number {
  section('loop: the APNG and GIF encoders, read back');
  const { say, bad } = counter();
  const dir = temp('loop');
  try {
    // A real frame set: the check fixture's idle, rendered by the installed rigc.
    const rig = join(dir, 'rig');
    writeCheckRig(rig);
    const checked = runCli(['check', '--rig', rig, '--out', join(dir, 'out')]);
    const set = readFrameSet(join(dir, 'out', 'idle_frames'));
    const src = set.frames.map((f) => f.image);

    const apngPath = join(dir, 'idle.png');
    const apng = runCli(['loop', '--frames', join(dir, 'out', 'idle_frames'), '--out', apngPath]);
    const bytes = existsSync(apngPath) ? new Uint8Array(readFileSync(apngPath)) : new Uint8Array(0);
    const types = bytes.length > 0 ? chunkTypes(bytes) : [];
    const shape = types.join(',').replace(/(,fcTL,fdAT)+/, ',(fcTL,fdAT)*');
    const plain = bytes.length > 0 ? decodePngBytes(bytes, apngPath) : null;
    const f0 = plain !== null && Buffer.compare(Buffer.from(plain.data), Buffer.from(src[0].data)) === 0;
    say(
      'LP01_THE_APNG_IS_ACTL_FCTL_IDAT_THEN_FCTL_FDAT_AND_RIGCS_PNG_READER_SEES_FRAME_ZERO',
      checked.status === 0 && apng.status === 0 && shape === 'IHDR,acTL,fcTL,IDAT,(fcTL,fdAT)*,IEND' && f0,
      `check exit ${checked.status}, loop exit ${apng.status}; chunks ${shape}; spine-rigc's decodePng on the APNG ${plain === null ? 'read nothing' : `reads ${plain.width}x${plain.height}, ${f0 ? 'equal to' : 'NOT equal to'} f0000.png`}`,
      'a decoder that knows nothing of APNG shows the default image, so frame 0 has to be the IDAT — and the one PNG reader in this package has to read the file at all',
    );

    const dec = bytes.length > 0 ? decodeApng(bytes) : { frames: [], numFrames: -1, plays: -1 };
    const closes = src.length > 1 && Buffer.compare(Buffer.from(src[0].data), Buffer.from(src[src.length - 1].data)) === 0;
    const expected = closes ? src.slice(0, -1) : src;
    const lossless = dec.frames.length === expected.length && dec.frames.every((f, i) => Buffer.compare(Buffer.from(f.image.data), Buffer.from(expected[i].data)) === 0);
    const totalTime = dec.frames.reduce((s, f) => s + f.delay, 0);
    say(
      'LP02_EVERY_APNG_FRAME_DECODES_EXACT_AND_THE_DUPLICATED_LAST_FRAME_IS_DROPPED_SAYING_SO',
      closes && lossless && dec.numFrames === dec.frames.length && dec.plays === 0 && Math.abs(totalTime - expected.length / set.fps) < 1e-9 && apng.out.includes('is dropped'),
      `${src.length} rendered frame(s), last ${closes ? 'equals' : 'differs from'} frame 0; decoded ${dec.frames.length} (acTL says ${dec.numFrames}, plays ${dec.plays}), ${lossless ? 'all byte-exact' : 'NOT exact'}, ${totalTime.toFixed(4)}s per loop`,
      'the rendered idle ends on the pose it starts with (that is what check measured), so a loop that also showed the last frame would hold that pose for two ticks; the reader here is independent of the writer',
    );

    const gifPath = join(dir, 'idle.gif');
    const gif = runCli(['loop', '--frames', join(dir, 'out', 'idle_frames', 'idle'), '--out', gifPath]);
    const g = existsSync(gifPath) ? decodeGif(new Uint8Array(readFileSync(gifPath))) : { frames: [], loops: null };
    const stated = /frame 0 max (\d+), mean ([\d.]+); all frames max (\d+), mean ([\d.]+)/.exec(gif.out);
    const e0 = g.frames.length > 0 ? channelError(g.frames[0].image, src[0]) : { max: -1, mean: -1 };
    const eAll = g.frames.map((f, i) => channelError(f.image, expected[i]));
    const worst = Math.max(...eAll.map((e) => e.max));
    say(
      'LP03_THE_GIF_DECODES_BACK_WITHIN_THE_PALETTE_ERROR_IT_STATES',
      gif.status === 0 && stated !== null && g.loops === 0 && g.frames.length === expected.length && e0.max === Number(stated[1]) && e0.mean.toFixed(3) === stated[2] && worst <= Number(stated[3]),
      `exit ${gif.status}; stated ${stated === null ? 'nothing' : stated[0]}; decoded ${g.frames.length} frame(s), loop count ${g.loops}; frame 0 measured max ${e0.max}, mean ${e0.mean.toFixed(3)}; worst frame max ${worst}`,
      'a GIF is 255 colours, so it is lossy by construction; what is checkable is that the error printed is the error in the file, read back by a decoder that shares nothing with the encoder',
    );

    // Hand-computable: four colours, a repeated frame, and a noise frame long enough to reset the LZW table.
    const W = 40;
    const H = 30;
    const flat = (rgb: [number, number, number], mark: number): Raster => {
      const r = newRaster(W, H);
      for (let p = 0; p < W * H; p++) r.data.set(p % W < mark ? [250, 250, 250, 255] : [...rgb, 255], p * 4);
      return r;
    };
    const next = lcg(7);
    const noise = newRaster(W * 5, H * 5);
    for (let p = 0; p < noise.width * noise.height; p++) {
      const v = next() % 200;
      noise.data.set([v, (v * 3) % 256, 255 - v, 255], p * 4);
    }
    const a = flat([200, 30, 30], 10);
    const b2 = flat([30, 30, 200], 20);
    const seq: AnimFrame[] = [a, a, b2, flat([30, 200, 30], 5)].map((image) => ({ image, ticks: 1 }));
    const small = encodeGif(seq, 12);
    const sd = decodeGif(small.bytes);
    const exact = sd.frames.length === 3 && [a, b2, seq[3].image].every((im, i) => channelError(sd.frames[i].image, im).max === 0);
    const delays = sd.frames.map((f) => f.delay);
    const big = encodeGif([{ image: noise, ticks: 1 }], 12);
    const bd = decodeGif(big.bytes);
    const noiseExact = bd.frames.length === 1 && channelError(bd.frames[0].image, noise).max === 0;
    say(
      'LP04_FRAMES_OF_AT_MOST_255_COLOURS_DECODE_EXACT_THE_REPEAT_IS_MERGED_AND_THE_LZW_TABLE_RESETS',
      exact && delays.join(',') === '17,8,8' && small.stats.all.max === 0 && noiseExact && big.stats.distinct === 200 && big.bytes.length > 4096,
      `4 frames of 4 colours -> ${sd.frames.length} decoded, ${exact ? 'exact' : 'NOT exact'}, delays ${delays.join(',')} cs (the repeat merged: round(200/12) - 0, then 8, 8); a ${noise.width}x${noise.height} frame of ${big.stats.distinct} colours -> ${big.bytes.length} bytes, ${noiseExact ? 'exact' : 'NOT exact'}`,
      'with no more colours than the palette holds a GIF has no excuse for error, so any is an encoder defect; 30,000 noise pixels outrun the 4096-code table, which is the path a small fixture never takes',
    );

    const open = [a, b2, flat([30, 200, 30], 5)];
    const openDir = join(dir, 'open', 'idle');
    mkdirSync(openDir, { recursive: true });
    open.forEach((im, i) => writeFileSync(join(openDir, `f${String(i).padStart(4, '0')}.png`), encodePngBytes(im)));
    writeFileSync(
      join(dir, 'open', 'frames.json'),
      JSON.stringify({ spec: 'rigc-frames/1', background: [232, 232, 232, 255], viewport: { x: 0, y: 0, width: W, height: H, scale: 1, pixelWidth: W, pixelHeight: H }, sets: [{ dir: 'idle', animation: 'idle', fps: 12, sampled: 3, written: 3, stride: 1, duration: 2 / 12 }] }),
    );
    const kept = runCli(['loop', '--frames', join(dir, 'open'), '--out', join(dir, 'open.png')]);
    const keptFrames = existsSync(join(dir, 'open.png')) ? decodeApng(new Uint8Array(readFileSync(join(dir, 'open.png')))).frames.length : -1;
    say(
      'LP05_A_LOOP_THAT_DOES_NOT_CLOSE_KEEPS_EVERY_FRAME_AND_SAYS_SO',
      kept.status === 0 && keptFrames === 3 && kept.out.includes('differs from f0000.png') && !kept.out.includes('is dropped'),
      `exit ${kept.status}; ${keptFrames} frame(s) in the APNG for 3 rendered`,
      'the drop is a consequence of a measured equality, not a habit: when the last frame is not frame 0, dropping it would cut a real pose',
    );

    const webp = runCli(['loop', '--frames', join(dir, 'open'), '--out', join(dir, 'x.webp')]);
    const translucent = flat([200, 30, 30], 0);
    translucent.data[3] = 128;
    const alphaRefused = threw(() => encodeGif([{ image: translucent, ticks: 1 }], 12));
    const sizeRefused = threw(() => encodeApng([{ image: a, ticks: 1 }, { image: noise, ticks: 1 }], 12));
    say(
      'LP06_WEBP_A_TRANSLUCENT_GIF_FRAME_AND_A_SIZE_CHANGE_ARE_REFUSED_BY_NAME',
      webp.status === 2 && webp.out.includes('VP8') && alphaRefused !== null && alphaRefused.includes('pixel 0,0 has alpha 128') && sizeRefused !== null && sizeRefused.includes(`frame 1 is ${noise.width}x${noise.height}`),
      `.webp -> exit ${webp.status}; translucent: ${alphaRefused ?? 'accepted'}; size change: ${sizeRefused ?? 'accepted'}`,
      'animated WebP is out of scope and says why; GIF has one bit of alpha, so a translucent pixel is refused rather than thresholded in silence',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// examples: the committed example rigs, when there are any
// ---------------------------------------------------------------------------

function runExamplesSuite(): number | null {
  section('examples: check on every examples/*/inputs rig');
  const root = join(ROOT, 'examples');
  const inputs = existsSync(root)
    ? readdirSync(root)
        .sort()
        .map((e) => join(root, e, 'inputs'))
        .filter((p) => existsSync(join(p, 'rig.json')))
    : [];
  if (inputs.length === 0) {
    console.log(`  SKIP  ${existsSync(root) ? 'examples/ holds no */inputs/rig.json' : 'no examples/ directory'}, so no committed example rig was checked`);
    console.log('          ⚠️ This is a HOLE in this run, not a pass — check ran on the generated fixture only.');
    return null;
  }
  const { say, bad } = counter();
  const dir = temp('examples');
  try {
    for (const p of inputs) {
      const name = relative(root, dirname(p));
      const r = runCli(['check', '--rig', p, '--out', join(dir, name)]);
      const fig = readJsonFile(join(dir, name, 'check.json'));
      say(
        `EX01_EXAMPLE_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSES_CHECK`,
        r.status === 0 && fig?.PASS === true,
        `exit ${r.status}; check.json ${fig === null ? 'absent' : JSON.stringify(fig)}`,
        'a committed example is a claim that the pipeline produces a passing rig; this is the run that keeps the claim true',
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// the assemble stage
// ---------------------------------------------------------------------------

function fixtureInput(dir: string, painting = 'painting.png'): Omit<AssembleInput, 'seamRule'> {
  return {
    source: readPng(join(dir, painting)),
    full: readWrapperLayers(join(dir, 'full')),
    head: readWrapperLayers(join(dir, 'head')),
    ...stageFields(loadConfig(join(dir, 'config.json'))),
  };
}


function runAssembleSuite(): number {
  section('assemble: the stage, on generated runs');
  const { say, bad } = counter();
  const dir = temp('assemble');
  try {
    writeAssembleFixture(dir);
    const base = fixtureInput(dir);
    const result = assemble({ ...base, seamRule: 'near-white' });
    const got = serializeParts(result.parts);
    const want = serializeParts(EXPECTED_PARTS);
    say(
      'AS01_FIXTURE_PARTS_JSON_IS_THE_HAND_DERIVED_ONE',
      got === want,
      got === want ? `${result.parts.parts.length} parts, every field of every record and all ${Object.keys(EXPECTED_PARTS.ghost_px).length} ghost counts equal` : `got ${got}`,
      'fixtures/assemble_fixture.ts derives every count in its doc comment: exact resamples, a flat painting, rectangles whose erosions and rims are counted by hand',
    );

    const covered = EXPECTED_PARTS.parts.reduce((s, p) => s + p.opaque_px, 0);
    const [W, H] = EXPECTED_PARTS.rig_size;
    const f = result.figures;
    const boxes = result.images.every(({ record, image }) => image.width === record.w && image.height === record.h);
    say(
      'AS02_RECOMPOSITE_FIGURES_COUNT_ONLY_THE_UNCOVERED_PAGE',
      boxes && f.errorPx === W * H - covered && f.uncoveredErrorPx === W * H - covered,
      `error px > 40: ${f.errorPx}, uncovered: ${f.uncoveredErrorPx}; the ${W}x${H} rig less the ${covered} opaque px of five disjoint parts is ${W * H - covered}; every PNG is its record's box: ${boxes}`,
      'on a flat painting every covered pixel ends within 1 level of it (the one refused part is recoloured by the seam override), so every error pixel is uncovered white page over the painting colour',
    );

    const ghostIn = newRaster(12, 12);
    const put = (x: number, y: number, a: number): void => ghostIn.data.set([9, 9, 9, a], (y * 12 + x) * 4);
    for (let i = 0; i < 40; i++) put(i % 8, Math.floor(i / 8), 255); // 40 px: kept (the floor is inclusive)
    for (let i = 0; i < 39; i++) put(i % 12, 6 + Math.floor(i / 12), 200); // 39 px, rows 6..9: dropped
    put(11, 0, 8); // alpha 8 is not "above 8": zeroed and not counted
    const cleaned = cleanGhosts(ghostIn);
    const kept = Array.from({ length: 144 }, (_, i) => cleaned.canvas.data[i * 4 + 3]).filter((a) => a > 0).length;
    say(
      'AS03_GHOST_CLEANUP_KEEPS_COMPONENTS_AT_THE_FLOOR_AND_ZEROES_THE_REST',
      cleaned.ghostPx === 39 && kept === 40 && cleaned.canvas.data[(0 * 12 + 11) * 4 + 3] === 0 && cleaned.canvas.data[0] === 9,
      `a 40-px and a 39-px component and one alpha-8 pixel -> ${kept} px kept, ghost ${cleaned.ghostPx}, the alpha-8 pixel's alpha ${cleaned.canvas.data[11 * 4 + 3]}`,
      'the 40-px floor is inclusive, a pixel of alpha 8 or less is cleared without being counted as a ghost, colour is untouched — each is a line of assemble_parts.py clean() that a plausible rewrite gets wrong',
    );

    const framed = temp('assemble-framed');
    try {
      writeRun(join(framed, 'full'), FRAMED_FULL);
      writeRun(join(framed, 'head'), FRAMED_HEAD);
      writeFileSync(join(framed, 'painting.png'), encodePngBytes(framedPainting()));
      writeFileSync(join(framed, 'config.json'), JSON.stringify(assembleConfig({ plan: FRAMED_PLAN, extend: [] })));
      const input = fixtureInput(framed);
      const faithful = assemble({ ...input, seamRule: 'near-white' });
      const sil = assemble({ ...input, seamRule: 'silhouette' });
      const seam = (r: typeof faithful, name: string): number => r.parts.parts.find((p) => p.name === name)?.seam_override_px ?? -1;
      const [hole0, hole1, line0, line1] = [seam(faithful, 'topwear'), seam(sil, 'topwear'), seam(faithful, 'bottomwear'), seam(sil, 'bottomwear')];
      say(
        'AS04_THE_SILHOUETTE_RULE_REPAIRS_A_NEAR_WHITE_PIXEL_INSIDE_THE_FIGURE_AND_KEEPS_THE_REFERENCE_RULE',
        hole0 === 0 && hole1 === 64 && line0 > 0 && line1 >= line0 && faithful.figures.errorPx - sil.figures.errorPx === 64 + (line1 - line0) && faithful.figures.uncoveredErrorPx === sil.figures.uncoveredErrorPx,
        `navy 8x8 over the white hole of a painted frame: recoloured ${hole0} (near-white rule) / ${hole1} (silhouette); Z over a painted line the silhouette's opening removes: ${line0} / ${line1}; error px ${faithful.figures.errorPx} -> ${sil.figures.errorPx}`,
        'the reference skips every near-white painting pixel, so See-through colour over a white garment is never repaired; the silhouette admits the enclosed hole, still admits every painted pixel the reference did (a replacement rule would drop the thin line), and leaves the page round the figure protected',
      );
    } finally {
      rmSync(framed, { recursive: true, force: true });
    }

    // A full run at k = 2 samples run x / 2, so rig column 29 reads run 14.5.
    // Run columns 0..15 hold red 100 and 16.. hold 200, all opaque. cv2's
    // bicubic weights at a 0.5 fraction are (-0.09375, 0.59375, 0.59375,
    // -0.09375): taps 13..16 = 100, 100, 100, 200 give 90.625 -> 90, and column 33
    // (run 16.5, taps 100, 200, 200, 200) gives 209.375 -> 209. Bilinear would
    // give 100 and 200.
    const stepFrame = checkGeometry({ sourceW: 64, sourceH: 64, resolution: 32, headBox: [0, 0, 32, 32], rigScale: 1 });
    const step = newRaster(32, 32);
    for (let i = 0; i < 32 * 32; i++) step.data.set([i % 32 < 16 ? 100 : 200, 0, 0, 255], i * 4);
    const warped = layerToRig(step, stepFrame, 'full');
    const red = (x: number): number => warped.data[(10 * warped.width + x) * 4];
    say(
      'AS10_AN_ENLARGING_RUN_IS_RESAMPLED_BICUBIC',
      red(29) === 90 && red(33) === 209 && red(20) === 100 && red(40) === 200,
      `rig columns 20, 29, 33, 40 read red ${red(20)}, ${red(29)}, ${red(33)}, ${red(40)}`,
      'the fixture above samples only at whole run pixels, where every filter agrees; this is the one place the filter choice (cubic for k >= 1, the reference\'s INTER_AREA, answered bilinear, below) is visible',
    );

    // belowCrop + growRim by hand on a 40x16 rig, crop line row 6 (probe row 4).
    // The head part is opaque on columns 2..3, rows 0..5, so the seed band is
    // columns 0..15. The extra layer has three components below the line:
    // A (columns 4..5, rows 6..9) touches the seed rows inside the band; B
    // (columns 30..31, rows 6..9) touches them outside it; C (columns 8..9,
    // rows 12..15) is inside the band but never reaches rows 6..11. So sel = A,
    // 8 px. Its 3x3 dilation is columns 3..6, rows 5..10 = 24 px, less A (8) and
    // less (3, 5), where the head part is already opaque = 15; a front part over
    // column 6 takes 6 more, so the rim is 9.
    const bw = 40;
    const bh = 16;
    const opaqueAt = (r: Raster, cells: Array<[number, number, number, number]>): void => {
      for (const [x0, y0, x1, y1] of cells) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data.set([...C, 255], (y * bw + x) * 4);
    };
    const headPart = newRaster(bw, bh);
    opaqueAt(headPart, [[2, 0, 4, 6]]);
    const extra = newRaster(bw, bh);
    opaqueAt(extra, [[4, 6, 6, 10], [30, 6, 32, 10], [8, 12, 10, 16]]);
    const sel = belowCrop(headPart, extra, 6);
    const selPx = Array.from(sel.data).reduce((a, b) => a + b, 0);
    const front = newMask(bw, bh);
    for (let y = 0; y < bh; y++) front.data[y * bw + 6] = 1;
    const painting = newRaster(bw, bh);
    opaqueAt(painting, [[0, 0, bw, bh]]);
    const withSel: Raster = { width: bw, height: bh, data: new Uint8ClampedArray(headPart.data) };
    for (let p = 0; p < bw * bh; p++) if (sel.data[p] === 1) withSel.data.set(extra.data.subarray(p * 4, p * 4 + 4), p * 4);
    const rim = growRim(withSel, sel, painting, front);
    say(
      'AS11_BELOW_CROP_TAKES_WHOLE_SEEDED_COMPONENTS_AND_THE_RIM_STAYS_OFF_FRONT_PARTS',
      selPx === 8 && sel.data[6 * bw + 4] === 1 && sel.data[6 * bw + 30] === 0 && sel.data[12 * bw + 8] === 0 && rim === 9,
      `sel ${selPx} px (component A only: B at column 30 ${sel.data[6 * bw + 30] === 1 ? 'taken' : 'left'}, C below the seed rows ${sel.data[12 * bw + 8] === 1 ? 'taken' : 'left'}); rim ${rim} px`,
      'the flat fixture keeps every later part away from its rim and has one component, so the two rules it cannot see — the seed column band and the front exclusion — are held here',
    );

    // Derivation (fixtures/assemble_fixture.ts): full-run tags with >= 150 run px
    // are headwear (192), bottomwear (336) and topwear (600) — back hair (132) and
    // footwear (120 after its speck) fall short; head-run tags: back hair (704) and
    // face (576). back hair first; headwear is a head tag the head run lacks while
    // the full run has 192 rig px (k = 1), so it goes after back hair with a note;
    // then bottomwear and topwear in the full run's draw order; then face. The full
    // run's back hair ends on run row 43, and 44 * 1 = 44 > the crop line 28 + 8.
    const prop = proposePlan(base.full, base.head, { sourceW: SOURCE_SIDE, sourceH: SOURCE_SIDE, resolution: RESOLUTION, headBox: HEAD_BOX, rigScale: RIG_SCALE });
    say(
      'AS05_PROPOSE_PLAN_IS_THE_HAND_DERIVED_ONE',
      JSON.stringify(prop) === JSON.stringify(EXPECTED_PROPOSAL),
      `plan ${prop.plan.map((p) => p[0]).join(', ')}; extend ${prop.extend_below_crop.map((e) => e.part).join(', ')}; notes: ${prop.notes.join(' | ')}`,
      'the order rules, the 150-px floor, the head-run shortfall note and the extend rule of assemble_parts.py propose_plan, each exercised once',
    );

    const mutants: Array<[string, string, () => unknown]> = [
      ['a plan entry naming a tag its run does not hold', 'ASSEMBLE_PLAN_TAG_IN_RUN', () => assemble({ ...base, plan: [...base.plan, ['wings', 'full', 'wings']], seamRule: 'near-white' })],
      ['an extend entry naming a tag its run does not hold', 'ASSEMBLE_EXTEND_TAG_IN_RUN', () => assemble({ ...base, extend: [{ part: 'hair_back', run: 'full', tag: 'front hair' }], seamRule: 'near-white' })],
      ['a part whose layer is all ghost', 'ASSEMBLE_PART_OPAQUE', () => assemble({ ...base, plan: [...base.plan, ['neck', 'full', 'neck']], seamRule: 'near-white' })],
      ['a head box past the painting', 'ASSEMBLE_HEAD_BOX_INSIDE', () => assemble({ ...base, headBox: [96, 0, 160, 64], seamRule: 'near-white' })],
      ['a resolution the runs were not made at', 'ASSEMBLE_RUN_CANVAS', () => assemble({ ...base, resolution: 32, seamRule: 'near-white' })],
      ['a landscape painting', 'ASSEMBLE_SOURCE_PORTRAIT', () => assemble({ ...base, source: flatPainting(SOURCE_SIDE, SOURCE_SIDE + 32), seamRule: 'near-white' })],
      ['a rig scale that makes no rig', 'ASSEMBLE_RIG_SIZE', () => assemble({ ...base, rigScale: 0.001, seamRule: 'near-white' })],
      ['a config with no seethrough block', 'ASSEMBLE_FIELD_PRESENT', () => stageFields(parseConfig(assembleConfig({ seethrough: false })))],
      ['a proposal config with no rig_scale', 'CONFIG_FIELD_TYPE', () => proposeFields({ seethrough: { resolution: 64, head_box: HEAD_BOX }, assemble: {} })],
    ];
    const outcomes = mutants.map(([what, code, run]) => {
      const err = refusals(run);
      return { what, code, ok: err !== null && err.problems.some((p) => p.code === code), got: codes(err), line: err?.problems.find((p) => p.code === code) };
    });
    const missed = outcomes.filter((o) => !o.ok);
    say(
      'AS06_EVERY_REFUSAL_PATH_FIRES_BY_NAME',
      missed.length === 0,
      missed.length === 0
        ? `${outcomes.length} planted inputs, each refused under its code; e.g. ${outcomes[0].line?.code}: ${outcomes[0].line?.object} — ${outcomes[0].line?.detail}`
        : missed.map((o) => `${o.what}: wanted ${o.code}, got ${o.got}`).join('; '),
      'the reference raised a KeyError, printed EMPTY and went on, read row -1, or assumed 1024 on each of these; here each is a refusal naming the object, the value found and the value required',
    );

    const out1 = join(dir, 'out1');
    const out2 = join(dir, 'out2');
    const args = (out: string): string[] => ['assemble', '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--config', join(dir, 'config.json'), '--out', out];
    const r1 = runCli(args(out1));
    const r2 = runCli(args(out2));
    const files = filesUnder(out1);
    const same = files.length > 0 && files.join(',') === filesUnder(out2).join(',') && files.every((f) => Buffer.compare(readFileSync(join(out1, f)), readFileSync(join(out2, f))) === 0);
    const readBack = r1.status === 0 ? serializeParts(readParts(join(out1, 'rig', 'parts.json'))) : '';
    say(
      'AS07_THE_CLI_WRITES_THE_SAME_BYTES_TWICE_AND_THE_RECORD_READS_BACK',
      r1.status === 0 && r2.status === 0 && same && readBack === want && files.length === EXPECTED_PARTS.parts.length + 2 && r1.out.includes('recomposite vs source: mean |d|='),
      `exit ${r1.status}/${r2.status}; ${files.length} file(s) (${files.join(', ')}), byte-identical across two runs: ${same}; parts.json reads back equal: ${readBack === want}`,
      'determinism is a contract, and the parts.json the CLI writes is the one the in-memory control checked',
    );

    const refusedOut = join(dir, 'refused');
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(assembleConfig({ plan: [...PLAN, ['neck', 'full', 'neck']] })));
    const rr = runCli(['assemble', '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--config', join(dir, 'bad.json'), '--out', refusedOut]);
    say(
      'AS08_A_REFUSED_ASSEMBLY_WRITES_NOTHING',
      rr.status === 1 && /^ {2}FAIL {2}ASSEMBLE_PART_OPAQUE: part "neck"/m.test(rr.out) && !existsSync(refusedOut),
      `exit ${rr.status}, "${rr.out.split('\n')[0].trim()}"; ${existsSync(refusedOut) ? `wrote ${filesUnder(refusedOut).join(', ')}` : 'the out directory was never created'}`,
      'emit only after green: a wrong file on disk outlives the console that warned about it',
    );

    const pp = runCli(['assemble', '--propose-plan', '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--config', join(dir, 'config.json')]);
    let printed: unknown = null;
    try {
      printed = JSON.parse(pp.out);
    } catch {
      printed = null;
    }
    const noOut = runCli(['assemble', '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--config', join(dir, 'config.json')]);
    say(
      'AS09_PROPOSE_PLAN_PRINTS_THE_PROPOSAL_AND_A_MISSING_FLAG_IS_A_USAGE_ERROR',
      pp.status === 0 && JSON.stringify(printed) === JSON.stringify(EXPECTED_PROPOSAL) && noOut.status === 2 && noOut.out.includes('--out'),
      `--propose-plan -> exit ${pp.status}, ${printed === null ? 'not JSON' : 'JSON equal to the derived proposal'}; no --out -> exit ${noOut.status}`,
      'the proposal is read by an agent and pasted into the config, so it is printed as the JSON it is and nothing else',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}


/**
 * The assemble stage on the public examples, where they have been fetched
 * (`exampleDirs`: `examples/<key>/config.json` tracked, `inputs/painting.png`
 * and `inputs/layers/{full,head}` from `bun run fetch-examples`).
 */
function runAssembleExamplesSuite(): number | null {
  section('assemble: the public examples (examples/<key>/inputs)');
  const found = exampleDirs().filter((d) => existsSync(join(d, 'inputs', 'layers', 'head')));
  if (found.length === 0) {
    console.log('  SKIP  no fetched example (examples/<key>/config.json + inputs/painting.png + inputs/layers/{full,head}); run bun run fetch-examples');
    console.log('          ⚠️ This is a HOLE in this run, not a pass — assemble-examples measured no real painting.');
    return null;
  }
  const { say, bad } = counter();
  for (const ex of found) {
    const name = relative(join(ROOT, 'examples'), ex);
    let detail: string;
    let ok = false;
    try {
      const input = {
        source: readPng(join(ex, 'inputs', 'painting.png')),
        full: readLayers(join(ex, 'inputs', 'layers', 'full')),
        head: readLayers(join(ex, 'inputs', 'layers', 'head')),
        ...stageFields(loadConfig(join(ex, 'config.json'))),
      };
      const a = assemble({ ...input, seamRule: DEFAULT_SEAM_RULE });
      const b = assemble({ ...input, seamRule: DEFAULT_SEAM_RULE });
      const same = serializeParts(a.parts) === serializeParts(b.parts) && a.images.every((p, i) => Buffer.compare(Buffer.from(encodePngBytes(p.image)), Buffer.from(encodePngBytes(b.images[i].image))) === 0);
      ok = same && a.parts.parts.every((p) => p.opaque_px > 0);
      detail = `${a.parts.parts.length} parts, two runs identical: ${same}; ${figuresLine(a.figures)}`;
    } catch (err) {
      detail = `refused or crashed: ${(err as Error).message.split('\n')[0]}`;
    }
    say(`AE01_EXAMPLE_ASSEMBLES_GREEN_AND_DETERMINISTIC[${name}]`, ok, detail, 'a public painting and its real See-through runs: the question the generated rectangles cannot answer is whether real layers go through green');
  }
  return bad();
}

// ---------------------------------------------------------------------------
// the extra suite: a corpus of real See-through output, read only
// ---------------------------------------------------------------------------

/** The corpus directory, if one was named; a name that does not exist exits 2. */
function corpusDir(): string | null {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--corpus');
  let named: string | null = null;
  if (at !== -1) {
    const value = argv[at + 1];
    if (value === undefined) {
      console.error('selftest: --corpus needs a path');
      process.exit(2);
    }
    named = resolve(value);
  } else if (process.env.SPINE_PARTS_CORPUS) named = resolve(process.env.SPINE_PARTS_CORPUS);
  if (named === null) return null;
  if (!existsSync(named)) {
    // A typo must not read as "no corpus": the one caller who asked for the
    // extra suite would be the one caller who silently does not get it.
    console.error(`selftest: --corpus named ${named}, which does not exist`);
    process.exit(2);
  }
  return named;
}

function findFiles(dir: string, name: string, depth: number, out: string[] = []): string[] {
  if (depth < 0) return out;
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) findFiles(p, name, depth - 1, out);
    else if (entry === name) out.push(p);
  }
  return out;
}

/** How deep under the corpus root a `layers.json` or `parts.json` is looked for. */
const CORPUS_DEPTH = 6;

/** The public examples: `examples/<key>/` holding a `config.json`, with the heavy inputs fetched into `inputs/`. */
const EXAMPLES_DIR = join(ROOT, 'examples');
const EXAMPLE_RUNS = ['full', 'head'] as const;
const EXAMPLE_INPUT_FILES = ['painting.png', 'st_input_full.png', 'st_input_head.png'] as const;

interface ExampleKeys {
  /** Every key with a config.json. */
  all: string[];
  /** Those whose inputs/ exists. */
  fetched: string[];
}

function exampleKeys(): ExampleKeys {
  if (!existsSync(EXAMPLES_DIR)) return { all: [], fetched: [] };
  const all = readdirSync(EXAMPLES_DIR)
    .sort()
    .filter((k) => existsSync(join(EXAMPLES_DIR, k, 'config.json')));
  return { all, fetched: all.filter((k) => existsSync(join(EXAMPLES_DIR, k, 'inputs'))) };
}

/**
 * Where what the readers saw disagrees with what the reference's parts.json
 * records. `seen` is every `<run>:<layer name>` the wrapper reader returned for
 * the example's two runs. The reference assembler writes a `ghost_px` entry for
 * every layer it read, so its keys are the layer set it saw, and every part's
 * `from` must be one of them. Empty means the two agree.
 */
function layerSetMismatch(seen: ReadonlySet<string>, expected: PartsFile): string[] {
  const out: string[] = [];
  const recorded = new Set(Object.keys(expected.ghost_px));
  const onlySeen = [...seen].filter((k) => !recorded.has(k)).sort();
  const onlyRecorded = [...recorded].filter((k) => !seen.has(k)).sort();
  if (onlySeen.length > 0) out.push(`read here but absent from ghost_px: ${onlySeen.join(', ')}`);
  if (onlyRecorded.length > 0) out.push(`in ghost_px but not read here: ${onlyRecorded.join(', ')}`);
  const unsourced = expected.parts.filter((p) => !seen.has(p.from)).map((p) => `${p.name} <- ${p.from}`);
  if (unsourced.length > 0) out.push(`parts whose from is no layer read here: ${unsourced.join(', ')}`);
  return out;
}

/** Where a config's plan disagrees with the expected parts list: same names, same `<run>:<tag>`, same order. */
function planMismatch(plan: ReadonlyArray<readonly [string, string, string]>, expected: PartsFile): string[] {
  const want = plan.map(([name, run, tag]) => `${name}=${run}:${tag}`);
  const got = expected.parts.map((p) => `${p.name}=${p.from}`);
  if (want.join('|') === got.join('|')) return [];
  const at = want.findIndex((w, i) => w !== got[i]);
  const i = at === -1 ? Math.min(want.length, got.length) : at;
  return [`plan has ${want.length} part(s), parts.json ${got.length}; first difference at [${i}]: plan ${want[i] ?? 'ends'}, parts.json ${got[i] ?? 'ends'}`];
}

function runExamplesHalf(keys: ExampleKeys, say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const unfetched = keys.all.filter((k) => !keys.fetched.includes(k));
  let layerSets = 0;
  let layerCount = 0;
  const readFailed: string[] = [];
  const agree: string[] = [];
  const disagree: string[] = [];
  const configs: string[] = [];
  const configFailed: string[] = [];
  for (const key of keys.fetched) {
    const inputs = join(EXAMPLES_DIR, key, 'inputs');
    const absentFiles = EXAMPLE_INPUT_FILES.filter((f) => !existsSync(join(inputs, f)));
    if (absentFiles.length > 0) readFailed.push(`${key}: inputs/ lacks ${absentFiles.join(', ')}`);
    const seen = new Set<string>();
    let readAll = true;
    for (const run of EXAMPLE_RUNS) {
      try {
        const set = readWrapperLayers(join(inputs, 'layers', run));
        layerSets++;
        layerCount += set.layers.length;
        for (const l of set.layers) seen.add(`${run}:${l.name}`);
      } catch (err) {
        readAll = false;
        readFailed.push(`${key}/${run}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    let expected: PartsFile | null = null;
    try {
      expected = readParts(join(EXAMPLES_DIR, key, 'expected', 'parts.json'));
    } catch (err) {
      disagree.push(`${key}: expected/parts.json refused: ${(err as Error).message.split('\n')[0]}`);
    }
    if (expected !== null && readAll) {
      const miss = layerSetMismatch(seen, expected);
      if (miss.length === 0) agree.push(`${key} ${seen.size} layer(s), ${expected.parts.length} part(s)`);
      else disagree.push(`${key}: ${miss.join('; ')}`);
    }
    if (expected !== null) {
      try {
        const config = loadConfig(join(EXAMPLES_DIR, key, 'config.json'));
        const miss = planMismatch(config.assemble.plan, expected);
        const extendTags = (config.assemble.extend_below_crop ?? []).map((e) => `${e.run}:${e.tag}`).filter((t) => readAll && !seen.has(t));
        if (miss.length === 0 && extendTags.length === 0) configs.push(`${key} ${config.assemble.plan.length} part(s)`);
        else configFailed.push(`${key}: ${[...miss, ...(extendTags.length > 0 ? [`extend_below_crop takes ${extendTags.join(', ')}, which no layer read here is`] : [])].join('; ')}`);
      } catch (err) {
        configFailed.push(`${key}: ${err instanceof PartsError ? err.problems.map((q) => `${q.code} ${q.object}`).join(', ') : (err as Error).message.split('\n')[0]}`);
      }
    }
  }
  say(
    'CO03_EVERY_FETCHED_EXAMPLE_HOLDS_ITS_INPUTS_AND_THEY_READ_GREEN',
    keys.fetched.length > 0 && unfetched.length === 0 && readFailed.length === 0 && layerSets === keys.fetched.length * EXAMPLE_RUNS.length,
    `${keys.fetched.length} of ${keys.all.length} example(s) fetched (${keys.fetched.join(', ')}), ${layerSets} layer set(s) read, ${layerCount} layer(s)` +
      (unfetched.length > 0 ? `; no inputs/ for ${unfetched.join(', ')} while others have one, so the fetch was partial` : '') +
      (readFailed.length > 0 ? `; refused: ${readFailed.join(' | ')}` : ''),
    'the examples are real See-through output with a published source, so they are the corpus a public run can read; a key without its inputs beside keys that have them is a partial fetch, not a smaller corpus',
  );
  const plantSeen = new Set(['full:face', 'head:face']);
  const plantParts: PartsFile = {
    rig_size: [4, 4],
    scale_rig_per_source: 1,
    parts: [{ name: 'face', from: 'head:face', x: 0, y: 0, w: 1, h: 1, opaque_px: 1, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 }],
    ghost_px: { 'full:face': 0, 'head:face': 0 },
  };
  const plantAgrees = layerSetMismatch(plantSeen, plantParts).length === 0;
  const plantDropped = layerSetMismatch(new Set(['full:face']), plantParts).length;
  const plantExtra = layerSetMismatch(new Set([...plantSeen, 'head:nose']), plantParts).length;
  say(
    'CO04_THE_READERS_SEE_EXACTLY_THE_LAYER_SET_THE_EXPECTED_PARTS_JSON_RECORDS',
    keys.fetched.length > 0 && disagree.length === 0 && agree.length === keys.fetched.length && plantAgrees && plantDropped > 0 && plantExtra > 0,
    `${agree.length} of ${keys.fetched.length} agree${agree.length > 0 ? ` (${agree.join('; ')})` : ''}${disagree.length > 0 ? `; disagree: ${disagree.join(' | ')}` : ''}; ` +
      `planted: a matching pair agrees (${plantAgrees}), one dropped layer is named (${plantDropped} problem(s)), one extra layer is named (${plantExtra})`,
    "the reference assembler records a ghost_px entry for every layer it read, and a part's from names the layer it came from; a reader that dropped, renamed or invented a layer would disagree with both",
  );
  const plantPlan = planMismatch([['face', 'head', 'nose']], plantParts).length;
  say(
    'CO05_EVERY_FETCHED_EXAMPLE_CONFIG_LOADS_AND_ITS_PLAN_IS_THE_EXPECTED_PART_LIST',
    keys.fetched.length > 0 && configFailed.length === 0 && configs.length === keys.fetched.length && plantPlan > 0 && planMismatch([['face', 'head', 'face']], plantParts).length === 0,
    `${configs.length} of ${keys.fetched.length} config(s) load and match${configs.length > 0 ? ` (${configs.join('; ')})` : ''}${configFailed.length > 0 ? `; refused: ${configFailed.join(' | ')}` : ''}; a planted plan taking the wrong tag is named (${plantPlan} problem(s))`,
    "each example's config is the reference's, converted to this schema; its plan is what made expected/parts.json, so a conversion that lost or reordered a part shows here",
  );
}

function runCorpusSuite(dir: string | null): number | null {
  section('corpus: real See-through output (extra, read only)');
  const keys = exampleKeys();
  if (dir === null && keys.fetched.length === 0) {
    const why = keys.all.length > 0 ? `the example(s) ${keys.all.join(', ')} have no inputs/ (run \`bun run fetch-examples\`)` : 'there is no examples/<key>/config.json';
    console.log(`  SKIP  no --corpus <dir>, no SPINE_PARTS_CORPUS, and ${why}, so no real layer set was read`);
    console.log('          ⚠️ This is a HOLE in this run, not a pass — the readers were exercised on fixtures only.');
    return null;
  }
  const { say, bad } = counter();
  if (keys.fetched.length > 0) runExamplesHalf(keys, say);
  if (dir === null) return bad();
  const manifests = findFiles(dir, 'layers.json', CORPUS_DEPTH);
  const partsFiles = findFiles(dir, 'parts.json', CORPUS_DEPTH);
  let layers = 0;
  const failed: string[] = [];
  for (const m of manifests) {
    try {
      layers += readWrapperLayers(m).layers.length;
    } catch (err) {
      failed.push(`${relative(dir, m)}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  say(
    'CO01_EVERY_LAYER_SET_UNDER_THE_CORPUS_READS_GREEN',
    manifests.length > 0 && failed.length === 0,
    manifests.length === 0
      ? `no layers.json within ${CORPUS_DEPTH} levels of ${dir}, so the corpus named here holds nothing this suite reads`
      : `${manifests.length - failed.length} of ${manifests.length} layer set(s) read, ${layers} layer(s)${failed.length > 0 ? `; refused: ${failed.join(' | ')}` : ''}`,
    'the fixtures stand in for real output; this is the question only real output answers — does the reader accept what See-through actually wrote?',
  );
  const partsFailed: string[] = [];
  for (const p of partsFiles) {
    try {
      readParts(p);
    } catch (err) {
      partsFailed.push(`${relative(dir, p)}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  say(
    'CO02_EVERY_PARTS_JSON_UNDER_THE_CORPUS_READS_GREEN',
    partsFailed.length === 0,
    `${partsFiles.length - partsFailed.length} of ${partsFiles.length} parts.json read${partsFailed.length > 0 ? `; refused: ${partsFailed.join(' | ')}` : ''}`,
    'a parts.json the reference wrote is the contract this port has to keep reading; zero files is reported rather than failed, because a corpus may hold only layers',
  );
  return bad();
}

// ---------------------------------------------------------------------------
// the tree itself
// ---------------------------------------------------------------------------

/**
 * The `.gitignore` entries, read by a deliberately small matcher: a bare name
 * matches that path component anywhere, a leading `/` anchors it to the root,
 * and `*` matches within one component. A pattern using anything else is a
 * fault rather than a guess (`ignoreReaderFaults`).
 */
function ignorePatterns(): string[] {
  const path = join(ROOT, '.gitignore');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

function ignoreReaderFaults(patterns: string[]): string[] {
  return patterns.filter((p) => /[!?[\]]|\*\*/.test(p) || p.endsWith('/')).map((p) => `.gitignore pattern "${p}" uses syntax this reader does not implement`);
}

function ignored(rel: string, patterns: string[]): boolean {
  const parts = rel.split('/');
  const glob = (pattern: string, text: string): boolean => new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(text);
  return patterns.some((p) => {
    if (p.startsWith('/')) {
      const anchored = p.slice(1).split('/');
      return anchored.every((seg, i) => parts[i] !== undefined && glob(seg, parts[i]));
    }
    return parts.some((seg) => glob(p, seg));
  });
}

/**
 * The files a commit of this tree would carry: everything under the root
 * minus `.git` and what `.gitignore` excludes — read off the disk rather than
 * off git, so the population is the same before the first commit as after it.
 */
function treeFiles(): string[] {
  const patterns = ignorePatterns();
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = join(dir, entry);
      const rel = relative(ROOT, abs);
      if (rel === '.git' || ignored(rel, patterns)) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(rel);
    }
  };
  walk(ROOT);
  return out;
}

const TEXT_FILE = /\.(ts|js|cjs|mjs|json|md|yml|yaml|lock|txt|sh)$|(^|\/)(\.gitignore|LICENSE)$/;
/** The binary files the tree may carry: fixture PNGs and PSDs, and the examples' contact sheets and reference renders. */
const IMAGE_FILE = /\.(png|psd|jpg|webp|gif)$/;

function scanText(files: ReadonlyArray<readonly [string, string]>, test: (text: string) => string | null): string[] {
  const hits: string[] = [];
  for (const [name, text] of files) {
    const hit = test(text);
    if (hit !== null) hits.push(`${name}: ${hit}`);
  }
  return hits;
}

const HANGUL = new RegExp(
  `[${String.fromCharCode(0x1100)}-${String.fromCharCode(0x11ff)}${String.fromCharCode(0x3130)}-${String.fromCharCode(0x318f)}${String.fromCharCode(0xac00)}-${String.fromCharCode(0xd7a3)}]`,
);
const LAN_PREFIX = ['192', '168', ''].join('.');

// ▼▼▼ FORBIDDEN NAMES — the one place in this repository these words may appear ▼▼▼
//
// Character names from the private reference corpus. They must never appear in
// any other file of this tree — code, docs, fixtures, notes bound for a commit —
// because this repository is public and that corpus is not. `TY04` scans every
// text file for them and excludes only the lines between these two markers.
const FORBIDDEN_NAMES: readonly string[] = ['gyeongpae', 'yoyeon', 'chaebong', 'chunun', 'gyeonghong', 'lanyang', 'neungpa', 'seomwol', 'guunmong'];
// ▲▲▲ FORBIDDEN NAMES — end ▲▲▲

const FORBIDDEN_BEGIN = '// ▼▼▼ FORBIDDEN' + ' NAMES';
const FORBIDDEN_END = '// ▲▲▲ FORBIDDEN' + ' NAMES — end';

function withoutForbiddenBlock(text: string): string {
  const a = text.indexOf(FORBIDDEN_BEGIN);
  const b = a < 0 ? -1 : text.indexOf(FORBIDDEN_END, a);
  return a < 0 || b < 0 ? text : text.slice(0, a) + text.slice(b + FORBIDDEN_END.length);
}

function forbiddenNameIn(text: string): string | null {
  const lower = withoutForbiddenBlock(text).toLowerCase();
  const found = FORBIDDEN_NAMES.filter((n) => lower.includes(n));
  return found.length === 0 ? null : `names ${found.join(', ')}`;
}

/** Every `any` keyword a TypeScript file writes, with its line and whether an eslint-disable bracket covers it. */
function anyKeywords(name: string, text: string): Array<{ line: number; bracketed: boolean }> {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const src = text.split('\n');
  const open = (l: string): boolean => /eslint-disable\s+@typescript-eslint\/no-explicit-any/.test(l) && !/eslint-disable-(next-)?line/.test(l);
  const close = (l: string): boolean => /eslint-enable\s+@typescript-eslint\/no-explicit-any/.test(l);
  return lines.map((line) => {
    let inside = false;
    for (let i = 0; i < line - 1; i++) {
      if (open(src[i])) inside = true;
      if (close(src[i])) inside = false;
    }
    return { line, bracketed: inside };
  });
}

/** The code with every comment and every string, template and regex body blanked, offsets kept. */
function codeOnly(name: string, text: string): string {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const chars = text.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' ';
  };
  const seen = new Set<number>();
  const comments = (pos: number): void => {
    for (const r of [...(ts.getLeadingCommentRanges(text, pos) ?? []), ...(ts.getTrailingCommentRanges(text, pos) ?? [])]) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      blank(r.pos, r.end);
    }
  };
  const visit = (node: ts.Node): void => {
    comments(node.pos);
    comments(node.end);
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node);
    if (literal) blank(node.getStart(sf) + 1, node.end - 1);
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return chars.join('');
}

const IMPURE: Array<[RegExp, string]> = [
  [/\bDate\s*\.\s*now\b|\bnew\s+Date\b/, 'reads the clock'],
  [/\bperformance\s*\.\s*now\b/, 'reads the clock'],
  [/\bMath\s*\.\s*random\b|\bcrypto\s*\.\s*(getRandomValues|randomUUID)\b/, 'draws randomness'],
  [/\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/, 'opens the network'],
  [/\bfrom\s+['"]node:(http|https|net|dns|tls|dgram|child_process)['"]/, 'imports a network or process module'],
];

function impurityIn(code: string, imports: string): string | null {
  for (const [re, what] of IMPURE) if (re.test(what.startsWith('imports') ? imports : code)) return what;
  return null;
}

const SUMMARY_START = '// the summary' + ' begins here';
const SUMMARY_END = '// the summary' + ' ends here';

/** Digits written into the summary's literal text — a figure typed rather than counted. */
function typedFigures(region: string): string[] {
  const sf = ts.createSourceFile('summary.ts', region, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/\d/.test(node.text)) hits.push(node.text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Top-level numeric constants only the summary region reads — a hand-kept figure one hop away. */
function summaryOnlyConstants(source: string, from: number, to: number): string[] {
  const sf = ts.createSourceFile('selftest.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const numeric = new Map<string, number>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined && ts.isNumericLiteral(d.initializer)) numeric.set(d.name.text, d.name.getStart(sf));
    }
  }
  const inside = new Set<string>();
  const outside = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && numeric.has(node.text) && node.getStart(sf) !== numeric.get(node.text)) {
      const at = node.getStart(sf);
      (at >= from && at < to ? inside : outside).add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...inside].filter((k) => !outside.has(k));
}

function runTreeSuite(): number {
  section('tree: the rules CLAUDE.md states, held to the files');
  const { say, bad } = counter();
  const patterns = ignorePatterns();
  const readerFaults = ignoreReaderFaults(patterns);
  const files = treeFiles();
  const text: Array<readonly [string, string]> = files.filter((f) => TEXT_FILE.test(f)).map((f) => [f, readFileSync(join(ROOT, f), 'utf8')] as const);
  const unclassified = files.filter((f) => !TEXT_FILE.test(f) && !IMAGE_FILE.test(f));
  say(
    'TY00_THE_TREE_WALK_READS_EVERY_FILE_A_COMMIT_WOULD_CARRY',
    text.length > 0 && readerFaults.length === 0 && unclassified.length === 0 && text.some(([f]) => f === 'selftest.ts') && !files.some((f) => f.startsWith('node_modules/')),
    `${files.length} file(s) outside .gitignore, ${text.length} of them text, over ${patterns.length} ignore pattern(s)` +
      (readerFaults.length > 0 ? `; ${readerFaults.join('; ')}` : '') +
      (unclassified.length > 0 ? `; neither text nor a known image type: ${unclassified.join(', ')}` : ''),
    'every scan below runs over this list, so the list is held first: a walk that read nothing, read node_modules, or skipped a file type would make every scan below green over the wrong population',
  );

  const sources = text.filter(([f]) => f === 'cli.ts' || (f.startsWith('src/') && f.endsWith('.ts')));
  const loose = sources.flatMap(([f, t]) => anyKeywords(f, t).map((a) => `${f}:${a.line}`));
  const selftestAny = anyKeywords('selftest.ts', readFileSync(join(ROOT, 'selftest.ts'), 'utf8')).filter((a) => !a.bracketed);
  const plantAny = anyKeywords('plant.ts', 'const x: number = 1;\nexport const y = x as any;\n');
  const plantBracketed = anyKeywords(
    'plant.ts',
    '/* eslint-disable @typescript-eslint/no-explicit-any */\nconst y = 1 as any;\n/* eslint-enable @typescript-eslint/no-explicit-any */\nconst z = 2 as any;\n',
  );
  say(
    'TY01_NO_ANY_IN_SRC_OR_CLI_AND_NONE_OUTSIDE_THE_BRACKETS_IN_SELFTEST',
    sources.length > 0 && loose.length === 0 && selftestAny.length === 0 && plantAny.length === 1 && plantBracketed.map((a) => a.bracketed).join(',') === 'true,false',
    `${sources.length} file(s) in src/ and cli.ts with ${loose.length} \`any\`${loose.length > 0 ? ` at ${loose.join(', ')}` : ''}; selftest.ts outside a bracket: ${selftestAny.length}; a planted \`as any\` is found (${plantAny.length}) and a bracket covers only what it brackets`,
    'eslint enforces the rule; this is the half it cannot state — that any exemption in selftest.ts is exactly as wide as its brackets',
  );

  const hangul = scanText(text, (t) => (HANGUL.test(t) ? 'holds Hangul' : null));
  const plantHangul = scanText([['plant.md', `note ${String.fromCharCode(0xd55c)}`]], (t) => (HANGUL.test(t) ? 'holds Hangul' : null));
  say(
    'TY02_NO_TRACKED_FILE_HOLDS_KOREAN_TEXT',
    hangul.length === 0 && plantHangul.length === 1,
    `${text.length} text file(s): ${hangul.length === 0 ? 'none holds Hangul' : hangul.join('; ')}; a planted syllable is found (${plantHangul.length})`,
    'the repository is English only; a note meant for one reader lives somewhere untracked',
  );

  const lan = scanText(text, (t) => (t.includes(LAN_PREFIX) ? `holds ${LAN_PREFIX}` : null));
  const plantLan = scanText([['plant.ts', `const host = 'http://${LAN_PREFIX}1.2:8188';`]], (t) => (t.includes(LAN_PREFIX) ? 'hit' : null));
  say(
    'TY03_NO_TRACKED_FILE_HOLDS_A_LAN_ADDRESS',
    lan.length === 0 && plantLan.length === 1,
    `${text.length} text file(s): ${lan.length === 0 ? 'no private-range address' : lan.join('; ')}; a planted one is found (${plantLan.length})`,
    "the GPU box a run used is the user's machine, not a default; a host comes from the environment or a flag",
  );

  const names = scanText(text, forbiddenNameIn);
  const plantName = scanText([['plant.md', `the ${FORBIDDEN_NAMES[0]} rig`]], forbiddenNameIn);
  const blockOnly = forbiddenNameIn(readFileSync(join(ROOT, 'selftest.ts'), 'utf8'));
  say(
    'TY04_NO_PRIVATE_CHARACTER_NAME_OUTSIDE_THE_MARKED_BLOCK',
    names.length === 0 && plantName.length === 1 && blockOnly === null && FORBIDDEN_NAMES.length > 0,
    `${FORBIDDEN_NAMES.length} name(s) over ${text.length} file(s): ${names.length === 0 ? 'none found' : names.join('; ')}; a planted one is found (${plantName.length})`,
    'the port is verified against a private corpus that never enters this tree; its names are the easiest part of it to leak',
  );

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files: string[] };
  const absent = pkg.files.filter((f) => !existsSync(join(ROOT, f)));
  const plantFiles = [...pkg.files, 'tools/not-here.ts'].filter((f) => !existsSync(join(ROOT, f)));
  say(
    'TY05_EVERY_FILES_ENTRY_IN_PACKAGE_JSON_EXISTS',
    pkg.files.length > 0 && absent.length === 0 && plantFiles.length === 1,
    `${pkg.files.length} entr(ies) in files: ${absent.length === 0 ? 'all present' : `absent: ${absent.join(', ')}`}; a planted entry is reported (${plantFiles.length})`,
    'an entry whose file is gone drops out of the published package with no error; the smoke catches the other direction',
  );

  const pure = sources.filter(([f]) => f.startsWith('src/') && !f.startsWith('src/comfy/'));
  const impure = pure.map(([f, t]) => [f, impurityIn(codeOnly(f, t), t)] as const).filter(([, w]) => w !== null);
  const plantImpure = impurityIn(codeOnly('plant.ts', 'export const t = Date.now();'), '');
  const plantQuiet = impurityIn(codeOnly('plant.ts', '// Date.now() is refused here\nexport const t = "Math.random";\n'), '');
  say(
    'TY06_SRC_IS_PURE_OUTSIDE_SRC_COMFY',
    pure.length > 0 && impure.length === 0 && plantImpure !== null && plantQuiet === null,
    `${pure.length} file(s): ${impure.length === 0 ? 'no clock, randomness or network' : impure.map(([f, w]) => `${f} ${w}`).join('; ')}; a planted Date.now() is found, and the same words in a comment and a string are not`,
    'determinism is a contract: a stage that read the clock or the network could not promise the same bytes twice',
  );

  const importers = sources.filter(([, t]) => t.includes("'spine-rigc/src/transform.ts'")).map(([f]) => f);
  say(
    'TY07_ONLY_SRC_COORDS_IMPORTS_THE_Y_FLIP',
    importers.join(',') === 'src/coords.ts' && cropToSpineY(10, 100) === 90,
    `importers of spine-rigc/src/transform.ts: ${importers.join(', ') || 'none'}; cropToSpineY(10, 100) through the door = ${cropToSpineY(10, 100)}`,
    "spine-rigc forbids a second copy of its coordinate conversion; one door keeps every later stage on rigc's",
  );

  const declareCall = /(^|[^.\w$])declare\s*\(/;
  const declared = text.filter(([f]) => f.endsWith('.ts')).filter(([f, t]) => declareCall.test(codeOnly(f, t))).map(([f]) => f);
  const plantDeclare = declareCall.test(codeOnly('plant.ts', 'const declare = (n: string) => n;\ndeclare("x");\n'));
  say(
    'TY08_NO_CALL_TO_A_FUNCTION_NAMED_DECLARE',
    declared.length === 0 && plantDeclare,
    `${declared.length === 0 ? 'no declare(...) call in any .ts file' : declared.join(', ')}; a planted one is found`,
    'measured while writing the config loader: Bun strips a statement `declare(...)` as a TypeScript ambient declaration while tsc accepts it as a call, so the call vanished at run time with typecheck and lint green, and no bone was ever registered',
  );

  const self = readFileSync(join(ROOT, 'selftest.ts'), 'utf8');
  const from = self.indexOf(SUMMARY_START);
  const to = from < 0 ? -1 : self.indexOf(SUMMARY_END, from);
  const region = from < 0 || to < 0 ? null : self.slice(from + SUMMARY_START.length, to);
  const typed = region === null ? null : typedFigures(region);
  const hopped = region === null ? null : summaryOnlyConstants(self, from, to);
  const plantTyped = typedFigures("console.log(`green — ${n('a')} controls, + 4 static controls`);");
  const plantDerived = typedFigures("console.log(`green — ${n('a')} controls, + ${n('b')} static controls`);");
  const miniature = `const SIX = 6;\nconst USED = 2;\nexport const w = USED + 1;\n${SUMMARY_START}\nconsole.log(SIX, USED);\n${SUMMARY_END}\n`;
  const plantHop = summaryOnlyConstants(miniature, miniature.indexOf(SUMMARY_START), miniature.indexOf(SUMMARY_END));
  say(
    'TY09_EVERY_FIGURE_IN_THE_SUMMARY_IS_COUNTED_NOT_WRITTEN',
    typed !== null && typed.length === 0 && hopped !== null && hopped.length === 0 && plantTyped.length === 1 && plantDerived.length === 0 && plantHop.join(',') === 'SIX',
    region === null
      ? 'the summary region was not found between its markers, so there is nothing to scan and no clean scan to report'
      : `the summary's literal text holds ${typed?.length ?? 0} digit(s)${typed !== null && typed.length > 0 ? `: ${typed.join(' | ')}` : ''} and ${hopped?.length ?? 0} constant(s) only it reads; a planted "+ 4" is found (${plantTyped.length}), the interpolated one is not (${plantDerived.length}), and a constant read only by a miniature summary is named (${plantHop.join(', ')})`,
    'a hand-written figure never goes red — it goes stale; the summary may state only what the run counted',
  );
  return bad();
}

// ---------------------------------------------------------------------------
// the tally's own controls
// ---------------------------------------------------------------------------

function runTallySuite(live: RunTally): number {
  section('run-tally: the floor, planted');
  // What the run had printed when this suite began: this suite's own cases are
  // not in a block until it returns, so the live check reads the run up to here.
  const before = live.total;
  const gutterBefore = new Map(live.gutter);
  const { say, bad } = counter();
  const block = (over: Partial<SuiteBlock>): SuiteBlock => ({ key: 'alpha', ran: true, controls: 3, quiet: 0, headers: 1, fails: 0, returned: 0, names: [], ...over });
  const gutter = (...words: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const healthy = tallyFaults([block({})], gutter('PASS', 'PASS', 'PASS'), 3);
  const empty = tallyFaults([block({ controls: 0 }), block({ key: 'beta' })], gutter('PASS', 'PASS', 'PASS'), 3);
  say(
    'RT01_A_SUITE_THAT_RAN_AND_PRINTED_NO_CASE_FAULTS_WHILE_A_HEALTHY_ONE_DOES_NOT',
    healthy.length === 0 && empty.length === 1 && empty[0].includes('"alpha"'),
    `healthy: ${healthy.length === 0 ? 'no fault' : healthy.join('; ')}; a suite with no cases beside one with three: ${empty.join('; ')}`,
    'the floor is per suite; a floor on the sum is how a suite that went to zero stays hidden behind the others',
  );

  const outside = tallyFaults([block({})], gutter('PASS', 'PASS', 'PASS', 'PASS'), 4);
  const unknownWord = tallyFaults([block({})], gutter('PASS', 'PASS', 'PASS', 'WARN'), 3);
  const nothing = tallyFaults([block({ ran: false, controls: 0, quiet: 1 })], gutter('SKIP'), 0);
  say(
    'RT02_UNWRAPPED_LINES_AN_UNKNOWN_GUTTER_WORD_AND_AN_EMPTY_SCAN_EACH_FAULT',
    outside.some((f) => f.includes('outside every tallied suite')) && unknownWord.some((f) => f.includes('"WARN"')) && nothing.some((f) => f.includes('matched nothing')),
    `${outside.join('; ')} | ${unknownWord.join('; ')} | ${nothing.join('; ')}`,
    'a scanner that stops matching goes quiet, not red, unless the run refuses what it cannot account for',
  );

  const lying = tallyFaults([block({ fails: 1, returned: 0 })], gutter('PASS', 'PASS', 'FAIL'), 3);
  const claiming = tallyFaults([block({ fails: 0, returned: 2 })], gutter('PASS', 'PASS', 'PASS'), 3);
  say(
    'RT03_A_RETURNED_COUNT_THAT_DISAGREES_WITH_THE_FAIL_LINES_FAULTS_BOTH_WAYS',
    lying.length === 1 && lying[0].includes('printed 1 FAIL') && claiming.length === 1 && claiming[0].includes('handed back 2'),
    `${lying[0] ?? 'no fault'} | ${claiming[0] ?? 'no fault'}`,
    'below the lines is the dangerous direction — a FAIL printed and a green exit',
  );

  const skipped = tallyFaults([block({}), block({ key: 'beta', ran: false, controls: 0, quiet: 1 })], gutter('PASS', 'PASS', 'PASS', 'SKIP'), 3);
  const blank = tallyFaults([block({}), block({ key: 'beta', ran: false, controls: 0, headers: 0 })], gutter('PASS', 'PASS', 'PASS'), 3);
  say(
    'RT04_A_SKIPPED_SUITE_THAT_SAYS_SO_IS_NOT_A_FAULT_AND_ONE_THAT_LEAVES_A_BLANK_IS',
    skipped.length === 0 && blank.length === 1 && blank[0].includes('opened no section'),
    `a suite that opened its section and printed SKIP: ${skipped.length === 0 ? 'no fault' : skipped.join('; ')}; one that printed nothing: ${blank[0] ?? 'no fault'}`,
    'the negative control is the load-bearing half: a floor that refused every skipped suite would refuse the corpus suite on every public run',
  );

  const liveFaults = tallyFaults(live.blocks, gutterBefore, before);
  const asked = threw(() => live.countOf('a-suite-nobody-ran'));
  say(
    'RT05_THE_LIVE_TALLY_ACCOUNTS_FOR_EVERY_SUITE_SO_FAR_AND_REFUSES_AN_UNKNOWN_KEY',
    liveFaults.length === 0 && live.blocks.length > 0 && asked !== null,
    `${live.blocks.length} suite(s) tallied before this one, ${liveFaults.length === 0 ? 'no fault' : liveFaults.join('; ')}; asking for a suite that never ran: ${asked ?? 'answered'}`,
    'the summary asks the tally for its figures, so the tally must refuse a figure no suite produced',
  );
  return bad();
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

function main(): void {
  const corpus = corpusDir();
  const tally = new RunTally();
  const printLine = console.log;
  console.log = (...args: unknown[]): void => {
    tally.observe(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    printLine(...args);
  };
  tally.of('raster-components', runComponentsSuite);
  tally.of('raster-morph', runMorphSuite);
  tally.of('raster-blur', runBlurSuite);
  tally.of('raster-resize', runResizeSuite);
  tally.of('raster-warp', runWarpSuite);
  tally.of('raster-poly', runPolySuite);
  tally.of('raster-composite', runCompositeSuite);
  tally.of('png', runPngSuite);
  tally.of('layers-wrapper', runWrapperSuite);
  tally.of('layers-psd', runPsdSuite);
  tally.of('config', runConfigSuite);
  tally.of('parts', runPartsSuite);
  tally.of('sheet', runSheetSuite);
  tally.of('cli', runCliSuite);
  tally.of('rig', runRigSuite);
  tally.of('rig-examples', runRigExamplesSuite);
  tally.of('propose', runProposeSuite);
  tally.of('propose-corpus', runProposeCorpusSuite);
  tally.of('check', runCheckSuite);
  tally.of('loop', runLoopSuite);
  tally.of('examples', runExamplesSuite);
  tally.of('assemble', runAssembleSuite);
  tally.of('assemble-examples', runAssembleExamplesSuite);
  tally.of('tree', runTreeSuite);
  tally.of('corpus', () => runCorpusSuite(corpus));
  tally.of('run-tally', () => runTallySuite(tally));
  console.log = printLine;

  console.log('');
  const floor = tallyFaults(tally.blocks, tally.gutter, tally.total);
  if (floor.length > 0) {
    console.error('spine-parts selftest: this run cannot account for itself — that is not a pass, it is an empty gate');
    for (const f of floor) console.error(`  ${f}`);
    process.exit(2);
  }
  const bad = tally.failures;
  if (bad > 0) {
    console.error(`spine-parts selftest: ${bad} control(s) failed`);
    process.exit(1);
  }
  // the summary begins here
  const n = (key: string): number => tally.countOf(key);
  const raster = ['raster-components', 'raster-morph', 'raster-blur', 'raster-resize', 'raster-warp', 'raster-poly', 'raster-composite'].reduce((sum, k) => sum + n(k), 0);
  const holes = tally.blocks.filter((b) => !b.ran).map((b) => b.key);
  const ran = tally.blocks.length - holes.length;
  const corpusClause = holes.includes('corpus') ? '' : `, + ${n('corpus')} corpus`;
  const examplesClause = holes.includes('rig-examples') ? '' : `, + ${n('rig-examples')} rig-example`;
  const checkExamplesClause = holes.includes('examples') ? '' : `, + ${n('examples')} examples`;
  const proposeClause = holes.includes('propose-corpus') ? '' : `, + ${n('propose-corpus')} example-propose`;
  const assembleExamplesClause = holes.includes('assemble-examples') ? '' : `, + ${n('assemble-examples')} assemble-example`;
  console.log(
    `spine-parts selftest: green — ${tally.total} control(s) over ${ran} suite(s): ${raster} raster-op, + ${n('png')} codec, ` +
      `+ ${n('layers-wrapper')} wrapper-reader, + ${n('layers-psd')} PSD-reader, + ${n('config')} config, + ${n('parts')} parts.json, ` +
      `+ ${n('sheet')} sheet, + ${n('cli')} CLI, + ${n('assemble')} assemble, + ${n('propose')} propose, + ${n('rig')} rig, + ${n('check')} check, + ${n('loop')} loop-encoder, + ${n('tree')} tree, + ${n('run-tally')} tally${corpusClause}${examplesClause}${proposeClause}${checkExamplesClause}${assembleExamplesClause}`,
  );
  if (holes.length > 0) console.log(`  ⚠️ HOLE: ${holes.join(', ')} did not run, so this run does not cover ${holes.length === 1 ? 'it' : 'them'}.`);
  // the summary ends here
}

main();
