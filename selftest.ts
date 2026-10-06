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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import ts from 'typescript';
import {
  assembleConfig,
  C,
  EXPECTED_PARTS,
  EXPECTED_PROPOSAL,
  FULL_LAYERS,
  FRAMED_FULL,
  FRAMED_HEAD,
  FRAMED_PLAN,
  flatPainting,
  framedPainting,
  HEAD_BOX,
  HEM_BAND,
  HEM_BOX,
  HEM_BOX_PX,
  HEM_FULL,
  HEM_UNDER,
  HEM_UNDER_DROP,
  HEM_UNDER_PX,
  HEM_PLAN,
  hemPainting,
  HEAD_LAYERS,
  LANDSCAPE_EXPECTED_PARTS,
  LANDSCAPE_FULL_LAYERS,
  LANDSCAPE_H,
  LANDSCAPE_PAD_TOP,
  landscapePainting,
  PLAN,
  RESOLUTION,
  RIG_SCALE,
  SOURCE_SIDE,
  STRIP_EXPECTED,
  STRIP_FULL,
  STRIP_PLAN,
  writeAssembleFixture,
  writeRun,
} from './fixtures/assemble_fixture.ts';
import { type AnimFrame, chunkTypes, encodeApng, encodeIndexedApng } from './src/apng.ts';
import { artifactPaths, build, BUILD_OWNS, RIGC_MODEL_DOCUMENT, rigStage } from './src/build.ts';
import { CHECK_PARTS, checkPartRaster, IDLE_PEAK, shiftRight, writeCheckRig } from './fixtures/checkrig.ts';
import { fakePainting } from './fixtures/fakecomfy.ts';
import { BARE_CROWN_PARTS, eyeParts, IRIS_NO_EYEWHITE_PARTS, LONG_ROBE_PARTS, LONG_ROBE_RIG, MIXED_STRAND_PARTS, NO_BROW_PARTS, NO_EYE_PARTS, ONE_EYEWHITE_PARTS, PROPOSE_PARTS, PROPOSE_RIG, type ProposeFixturePart, STRAND_PARTS, STRAND_RIG, writeProposeFixture } from './fixtures/propose.ts';
// The runtime's own posing, for the one control that measures where a mesh's pixels go (PR14): a second opinion about a weighted vertex is what a measurement must not carry.
import { type BoneSnapshot, type Frame, loadPosable, type Mesh, sampleAnimation, sampleSetupPose } from 'spine-rigc/src/render.ts';
import { CANVAS, flatName, layerRaster, minimalConfig, WRAPPER_LAYERS, writePsdFixture, writeWrapperFixture } from './fixtures/synthetic.ts';
import {
  assemble,
  type AssembleInput,
  belowCrop,
  checkGeometry,
  cleanGhosts,
  DEFAULT_PROJECT_RULE,
  DEFAULT_SEAM_RULE,
  figureSilhouette,
  figuresLine,
  growRim,
  holeLines,
  HOLES_LISTED,
  layerToRig,
  MAP_MISMATCHED,
  MAP_UNCOVERED,
  measureRecomposite,
  type PlacedPart,
  PROJECT_RULES,
  proposeFields,
  proposePlan,
  recomposite,
  recompositeErrorMap,
  sourceInRig,
  stageFields,
  visibilityCounts,
} from './src/assemble.ts';
import { buildGateLines, causeLines, chainLine, measuredRules, packedBuildArgs, DEFAULT_PACK_MODE, DEFAULT_PAGE_EDGES, findRigc, type PackMode, type PageEdges, type FrameSet, GEOMETRY_FILE, gateGreen, headBoneOf, type JudgementLine, JUDGEMENT_LINES, packEdgeProblems, PARTS_HOME_SENTENCE, parsePackLines, readBoneTrack, readCheckInputs, readFrameSet, readGeometry, readRigcEntry, REPORTED_LINES, requireRigcVersion, RIGC_ENTRY_VERSION, RIGC_GEOMETRY_VERSION, rigcFailed, type RigcRunner, runCheck, SPINEBOY_YARDSTICK, STILL_FACE_RESAMPLER_MARGIN, stretchLine, TEXTURE_STRETCH_CEILING } from './src/check.ts';
import { blinkFigures, frameBox, lagStep, readSine } from './src/instruments.ts';
import { buildHeaderProblem } from './tools/atlas_population.ts';
import { BLINK, blinkHoldMisses, CONTROL_SUFFIX, framesInside, IDLE_FPS, sineTrack } from './src/motion.ts';
import { type BoneEntry, type CharacterConfig, CONFIG_REQUIRES, type ConfigDoor, type Generation, loadConfig, loadEarlyConfig, parseConfig, parseEarlyConfig } from './src/config.ts';
import { cropToSpineY } from './src/coords.ts';
import { PartsError, type Problem } from './src/errors.ts';
import { encodeGif } from './src/gif.ts';
import { buildPrompts, checkGraph, fillSeeThrough, FRAMING, NEGATIVE_HEAD, paintingGraph, POSITIVE_HEAD, stripWords } from './src/graphs.ts';
import { proposeHeadBox } from './src/headbox.ts';
import { makeInputs, squarePad } from './src/inputs.ts';
import { implausibleRules, type Layer, layerFigures, type LayerSet, PLAUSIBLE_AREA_RATIO_MAX, PLAUSIBLE_JUDGED_AREA_RATIO, PLAUSIBLE_TRANSLUCENT_MAX, PLAUSIBLE_BACKGROUND_MAX, PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN, readLayers, readPsdLayers, readWrapperLayers, ruleSummary } from './src/layers.ts';
import { type PartsFile, type RecompositeRecord, readParts, serializeParts, writeParts } from './src/parts.ts';
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
import { block, islandImages, LASH_CREASE, LASH_RIG, LASH_ROW, lashConfig, lashImages, lashParts, RIG_CANVAS, RIG_EXPECT, rigConfig, rigImages, rigParts, writeRigFixture } from './fixtures/rig.ts';
import { blinkHoldProblems, buildRig, IDLE_DRIVES_MESHES_WHY, type MeshAttachment, type RegionAttachment, rigJsonText } from './src/rig.ts';
import { pyRound } from './src/round.ts';
import { COLORS, KEYPOINT_NAMES, renderSkeleton, scaledPoints, SKELETON_BASE, SKELETONS, stickScale } from './src/skeleton.ts';
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

  // assemble.patches (issue #28): one entry that loads, then every malformed
  // one alone, each refused exactly once under its code and its object.
  const patchCfg = (entries: unknown[], edit: (c: Record<string, unknown>) => void = () => {}): Record<string, unknown> => {
    const c = minimalConfig();
    (c.assemble as Record<string, unknown>).patches = entries;
    const regions = c.regions as Record<string, unknown>;
    for (const e of entries) if (typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string') regions[(e as { name: string }).name] = 'hip';
    edit(c);
    return c;
  };
  const hem = { name: 'hem', box: [2, 40, 30, 44], alpha: 'silhouette', draw: 'back' };
  const patchOk = refusals(() => parseConfig(patchCfg([hem, { ...hem, name: 'hem2', alpha: 'box', draw: { before: 'robe' } }, { ...hem, name: 'hem3', draw: 'front' }])));
  const patchMutants: Array<[string, unknown[], string, string, ((c: Record<string, unknown>) => void)?]> = [
    ['a name a plan part already has', [{ ...hem, name: 'face' }], 'CONFIG_PART_UNIQUE', 'config.assemble.patches[0].name'],
    ['a name two patches share', [hem, { ...hem }], 'CONFIG_PART_UNIQUE', 'config.assemble.patches[1].name'],
    ['a name that is a path', [{ ...hem, name: 'hem/x' }], 'CONFIG_PART_NAME', 'config.assemble.patches[0].name'],
    ['a box of three numbers', [{ ...hem, box: [2, 40, 30] }], 'CONFIG_FIELD_TYPE', 'config.assemble.patches[0].box'],
    ['a box with a negative corner', [{ ...hem, box: [-1, 40, 30, 44] }], 'CONFIG_FIELD_TYPE', 'config.assemble.patches[0].box'],
    ['an empty box', [{ ...hem, box: [30, 40, 30, 44] }], 'CONFIG_PATCH_BOX', 'config.assemble.patches[0].box'],
    ['an unknown alpha rule', [{ ...hem, alpha: 'union' }], 'CONFIG_FIELD_TYPE', 'config.assemble.patches[0].alpha'],
    ['a draw target no plan part has', [{ ...hem, draw: { before: 'skirt' } }], 'CONFIG_NAME_RESOLVES', 'config.assemble.patches[0].draw.before'],
    ['a draw value that is no position', [{ ...hem, draw: 'middle' }], 'CONFIG_FIELD_TYPE', 'config.assemble.patches[0].draw'],
    ['a draw object with an unknown key', [{ ...hem, draw: { before: 'robe', after: 'face' } }], 'CONFIG_KEY_KNOWN', 'config.assemble.patches[0].draw.after'],
    ['a bone written on the patch', [{ ...hem, bone: 'hip' }], 'CONFIG_KEY_KNOWN', 'config.assemble.patches[0].bone'],
    ['a missing field', [{ name: 'hem', box: [2, 40, 30, 44], draw: 'back' }], 'CONFIG_FIELD_PRESENT', 'config.assemble.patches[0].alpha'],
    ['a patch with a mesh', [hem], 'CONFIG_PART_ATTACHED', 'part "hem"', (c) => { (c.meshes as Record<string, unknown>).hem = { grid: 8, r: 4, segments: ['chest'] }; }],
    ['a patch with no region', [hem], 'CONFIG_PART_ATTACHED', 'part "hem"', (c) => { delete (c.regions as Record<string, unknown>).hem; }],
    ['patches that are not an array', [], 'CONFIG_FIELD_TYPE', 'config.assemble.patches', (c) => { (c.assemble as Record<string, unknown>).patches = { hem }; }],
  ];
  const patchOutcomes = patchMutants.map(([what, entries, code, object, edit]) => {
    const err = refusals(() => parseConfig(patchCfg(entries, edit)));
    const one = err !== null && err.problems.length === 1 ? err.problems[0] : null;
    return { what, code, object, ok: one !== null && one.code === code && one.object === object, got: err === null ? 'loads' : err.problems.map((q) => `${q.code} ${q.object}`).join('; '), line: one };
  });
  const patchMissed = patchOutcomes.filter((o) => !o.ok);
  const boneLine = patchOutcomes.find((o) => o.what === 'a bone written on the patch')?.line;
  say(
    'CF07_A_PATCH_ENTRY_LOADS_AND_EVERY_MALFORMED_ONE_IS_REFUSED_ONCE_BY_NAME',
    patchOk === null && patchMissed.length === 0 && (boneLine?.detail.includes('config.regions.<name>') ?? false),
    patchOk !== null
      ? `three good patches are refused: ${codes(patchOk)}`
      : patchMissed.length === 0
        ? `three patches (back, before robe, front; silhouette and box) load; ${patchOutcomes.length} planted entries, each refused exactly once under its code and object; e.g. ${boneLine?.code}: ${boneLine?.object} — ${boneLine?.detail}`
        : patchMissed.map((o) => `${o.what}: wanted ${o.code} at ${o.object}, got ${o.got}`).join(' | '),
    'issue #28: a patch is a part the tool cuts from the painting, so every field that places it resolves by name or is refused by name; the bone is not a patch field because a region\'s bone already has one place, config.regions',
  );

  runBlinkConfigCases(say);
  runRecordConfigCases(say);
  return bad();
}

/** A generation block the loader accepts; every value is a fixture's, none is read here. */
function fixtureGeneration(): Record<string, unknown> {
  return {
    checkpoint: 'fixture_base.safetensors',
    loras: [{ name: 'fixture_style.safetensors', strength: 0.6 }],
    trigger: '',
    identity: '1girl, solo',
    sampler: { steps: 4, cfg: 6, sampler: 'euler', scheduler: 'normal' },
    costume: 'grey coat',
    negative_extra: '',
    style: 'white background',
    negative_pose: 'back view',
    latent: [16, 24],
    seed: 5,
    pose: 'standing',
  };
}

/**
 * Issue #70: a key beginning `x-` holds any JSON value in every object the
 * loader vouches for, and nothing reads it. The door, its edges, the three
 * refusals that now name it, the part-name maps where it stays shut, and an
 * early door. That nothing reads a record is BU08's (the build) and CF13's
 * (the painting meta), byte for byte.
 */
function runRecordConfigCases(say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const one = (err: PartsError | null): Problem | null => (err !== null && err.problems.length === 1 ? err.problems[0] : null);
  const line = (q: Problem | null, err: PartsError | null): string => (q === null ? codes(err) : `${q.code}: ${q.object} — ${q.detail}`);
  const kinds: Record<string, unknown> = { 'x-status': { gate: 'green', built_with: '0.8.2' }, 'x-seeds': [3, 7], 'x-builds': 2, 'x-reviewed': null };

  // Three depths, four kinds of value at each, and x-seed_note holding an object.
  const deep = { ...minimalConfig(), ...kinds };
  const g = fixtureGeneration();
  deep.generation = { ...g, ...kinds, 'x-seed_note': { why: 'a record, not an annotation' }, 'x-seeds_tried': [{ seed: 3, why: 'two figures' }], sampler: { ...(g.sampler as Record<string, unknown>), ...kinds } };
  const motion = deep.motion as Record<string, unknown>;
  motion.blink = { ...(motion.blink as Record<string, unknown>), ...kinds };
  const deepErr = refusals(() => parseConfig(deep));
  say(
    'CF50_RECORDS_UNDER_X_KEYS_LOAD_AT_THREE_DEPTHS_HOLDING_AN_OBJECT_AN_ARRAY_A_NUMBER_AND_NULL',
    deepErr === null,
    `${Object.keys(kinds).join(', ')} (an object, an array, a number, null) at config, config.generation, config.generation.sampler and config.motion.blink, with generation.x-seed_note holding an object and generation.x-seeds_tried a list of seeds with reasons -> ${deepErr === null ? 'loads' : codes(deepErr)}`,
    'issue #70: a project keeps its own records — gate results, rejected seeds — beside the conditions that made the rig; the record test comes before the annotation test, so x-seed_note is a record and may hold an object',
  );

  // The entry kinds that meet a test before Check.object: a bone entry (chain or
  // single by `'chain' in entry`), a track (the same), a patch (a bespoke `bone`
  // refusal first); and an entry of a part-name map, which Check.object checks.
  const entriesCfg = minimalConfig();
  const bones = entriesCfg.bones as Array<Record<string, unknown>>;
  bones[0]['x-placed'] = [32, 40];
  bones[3]['x-placed'] = null;
  const tracks = (entriesCfg.motion as { tracks: Array<Record<string, unknown>> }).tracks;
  tracks[0]['x-was'] = { amp: 0 };
  tracks[1]['x-was'] = 1;
  const asm = entriesCfg.assemble as Record<string, unknown>;
  (asm.extend_below_crop as Array<Record<string, unknown>>)[0]['x-n'] = 0;
  asm.patches = [{ name: 'hem', box: [2, 40, 30, 44], alpha: 'box', draw: 'back', 'x-bone': 'hip', 'x-from': { issue: 28 } }];
  (entriesCfg.regions as Record<string, unknown>).hem = 'hip';
  ((entriesCfg.meshes as Record<string, Record<string, unknown>>).robe)['x-grid_was'] = 4;
  const entriesErr = refusals(() => parseConfig(entriesCfg));
  const boneStill = structuredClone(entriesCfg);
  ((boneStill.assemble as Record<string, unknown>).patches as Array<Record<string, unknown>>)[0].bone = 'hip';
  const boneLine = one(refusals(() => parseConfig(boneStill)));
  say(
    'CF51_A_RECORD_ON_A_BONE_A_TRACK_A_PATCH_AN_EXTEND_AND_A_MESH_ENTRY_LOADS_AND_A_PATCH_BONE_IS_STILL_REFUSED',
    entriesErr === null && boneLine?.code === 'CONFIG_KEY_KNOWN' && boneLine.object === 'config.assemble.patches[0].bone' && boneLine.detail.includes('config.regions.<name>'),
    `x- records on bones[0] (single), bones[3] (chain), tracks[0] (single), tracks[1] (chain), extend_below_crop[0], patches[0] (x-bone among them) and meshes.robe -> ${entriesErr === null ? 'loads' : codes(entriesErr)}; the same patch with a plain bone besides -> ${line(boneLine, null)}`,
    'a bone and a track are told chain from single by a test before Check.object, and a patch meets a bespoke bone refusal first; none of those tests looks at an x- key, so each entry is an object Check.object vouches for and the door is open there. That the records change no byte of the build is BU08\'s',
  );

  const status = one(refusals(() => parseConfig({ ...minimalConfig(), status: { gate: 'green' } })));
  const nested = one(refusals(() => parseConfig({ ...minimalConfig(), motion: { ...(minimalConfig().motion as Record<string, unknown>), colour: 'warm' } })));
  const doors = (q: Problem | null): boolean => q !== null && q.detail.includes('a project\'s own record goes under a key beginning "x-" (any JSON, read by nothing)') && q.detail.includes('a remark under note or <name>_note (a string)');
  say(
    'CF52_A_PLAIN_UNKNOWN_KEY_IS_STILL_REFUSED_AND_THE_REFUSAL_NAMES_BOTH_DOORS',
    status?.code === 'CONFIG_KEY_KNOWN' && status.object === 'config.status' && status.detail.startsWith('is not a field here; known: key, ') && doors(status) && nested?.code === 'CONFIG_KEY_KNOWN' && nested.object === 'config.motion.colour' && doors(nested),
    `status: {"gate":"green"} -> ${line(status, null)}; motion.colour -> ${nested === null ? 'not one refusal' : `${nested.code} ${nested.object}, naming the doors: ${doors(nested)}`}`,
    'issue #70: the downstream author stripped the keys from a copy on every rebuild because the refusal listed the known fields and stopped; typo protection is the point of the loader, so the key is still refused, and the refusal now says where a record goes',
  );

  const near = ['xstatus', 'x_status', 'X-status', 'x-'].map((k) => ({ k, q: one(refusals(() => parseConfig({ ...minimalConfig(), [k]: { gate: 'green' } }))) }));
  const shortest = refusals(() => parseConfig({ ...minimalConfig(), 'x-s': 1 }));
  say(
    'CF53_XSTATUS_X_UNDERSCORE_A_CAPITAL_X_AND_A_BARE_X_DASH_ARE_REFUSED_AND_X_DASH_ONE_CHARACTER_LOADS',
    near.every(({ k, q }) => q?.code === 'CONFIG_KEY_KNOWN' && q.object === `config.${k}` && doors(q)) && shortest === null,
    `${near.map(({ k, q }) => `"${k}" -> ${q === null ? 'not one refusal' : `${q.code} ${q.object}`}`).join('; ')}; "x-s" -> ${codes(shortest)}`,
    'the prefix is exactly "x-" and a name after it: a near miss is a typo the loader names, not a record it swallows, and a bare "x-" names nothing',
  );

  const retiredAt = (key: string): Problem | null => one(refusals(() => parseConfig({ ...minimalConfig(), generation: { ...fixtureGeneration(), [key]: key === 'seed0' ? 3 : [3, 7] } })));
  const tried = retiredAt('seeds_tried');
  const seed0 = retiredAt('seed0');
  const structured = (q: Problem | null): boolean => q?.code === 'CONFIG_KEY_RETIRED' && q.detail.includes('the search belongs in generation.seed_note') && q.detail.includes('or as a structured record in generation.x-seeds_tried');
  say(
    'CF54_A_RETIRED_SEED_KEY_STAYS_RETIRED_AND_ITS_REFUSAL_NAMES_THE_STRUCTURED_DOOR',
    structured(tried) && tried?.object === 'config.generation.seeds_tried' && structured(seed0) && seed0?.object === 'config.generation.seed0',
    `generation.seeds_tried -> ${line(tried, null)}; generation.seed0 -> ${seed0 === null ? 'not one refusal' : `${seed0.code}, naming the structured door: ${structured(seed0)}`}`,
    'issue #70: a list of seeds with reasons is exactly the record the string rule refused; the retired key keeps its sentence, because a plain seeds_tried still is not a field, and gains the place a structured search now goes',
  );

  const objNote = one(refusals(() => parseConfig({ ...minimalConfig(), status_note: { gate: 'green' } })));
  const samplerNote = one(refusals(() => parseConfig({ ...minimalConfig(), generation: { ...fixtureGeneration(), sampler: { ...(fixtureGeneration().sampler as Record<string, unknown>), note: 4 } } })));
  const recordDoor = (q: Problem | null): boolean => q?.code === 'CONFIG_FIELD_TYPE' && q.detail.includes('an annotation is a string — a structured record goes under a key beginning "x-" (any JSON, read by nothing)');
  say(
    'CF55_A_NON_STRING_ANNOTATION_IS_STILL_REFUSED_AND_ITS_REFUSAL_NAMES_THE_RECORD_DOOR',
    recordDoor(objNote) && objNote?.object === 'config.status_note' && objNote.detail.startsWith('is {"gate":"green"}; ') && recordDoor(samplerNote) && samplerNote?.object === 'config.generation.sampler.note',
    `status_note: {"gate":"green"} -> ${line(objNote, null)}; generation.sampler.note: 4 -> ${samplerNote === null ? 'not one refusal' : `${samplerNote.code} ${samplerNote.object}`}`,
    'a note is prose beside the value it explains, and the string rule is what keeps it that; an author who wrote an object there meant a record, and is told where one goes',
  );

  // The part-name maps: the refusal an x- key meets there, measured, is the one
  // any part the plan does not make meets — the same code and the same words.
  const mapCase = (name: string, edit: (c: Record<string, unknown>, key: string) => void): { x: string[]; plain: string[] } => {
    const run = (key: string): string[] => {
      const c = minimalConfig();
      edit(c, key);
      return refusals(() => parseConfig(c))?.problems.map((q) => `${q.code} ${q.object} — ${q.detail}`.replaceAll(key, '<part>')) ?? [];
    };
    return { x: run('x-foo'), plain: run(`ghost_${name}`) };
  };
  const maps = {
    meshes: mapCase('meshes', (c, k) => { (c.meshes as Record<string, unknown>)[k] = { grid: 8, r: 4, segments: ['chest'] }; }),
    regions: mapCase('regions', (c, k) => { (c.regions as Record<string, unknown>)[k] = 'head'; }),
    still: mapCase('still', (c, k) => {
      const m = c.motion as { blink: Record<string, unknown> };
      m.blink.still = { [k]: { row: 3, bone: 'chest' } };
    }),
  };
  const shut = Object.values(maps).every((m) => m.x.length === 1 && m.x.join() === m.plain.join());
  const partCfg = minimalConfig();
  ((partCfg.assemble as Record<string, unknown>).plan as unknown[]).push(['x-cape', 'full', 'bottomwear']);
  (partCfg.regions as Record<string, unknown>)['x-cape'] = 'hip';
  const partErr = refusals(() => parseConfig(partCfg));
  const partMissing = structuredClone(partCfg);
  delete (partMissing.regions as Record<string, unknown>)['x-cape'];
  const unattached = one(refusals(() => parseConfig(partMissing)));
  say(
    'CF56_THE_DOOR_IS_SHUT_INSIDE_MESHES_REGIONS_AND_BLINK_STILL_WHERE_AN_X_KEY_IS_A_PART_NAME',
    shut && maps.meshes.x[0].startsWith('CONFIG_NAME_RESOLVES config.meshes.<part> — names a part that neither assemble.plan nor assemble.patches makes') && maps.still.x[0].startsWith('CONFIG_NAME_RESOLVES config.motion.blink.still.<part> — names "<part>", which config.regions does not attach') && partErr === null && unattached?.code === 'CONFIG_PART_ATTACHED' && unattached.object === 'part "x-cape"',
    `${Object.entries(maps).map(([k, m]) => `${k}["x-foo"] -> ${m.x.join('; ') || 'loads'} (a part named ghost_${k}: ${m.x.join() === m.plain.join() ? 'the same' : m.plain.join('; ')})`).join(' | ')}; a plan part named x-cape on a region -> ${codes(partErr)}, and with its region removed -> ${line(unattached, null)}`,
    'issue #70: meshes, regions and blink.still are keyed by part name, so an x- key there is a part name and meets whatever a part the plan does not make meets — it is never a record nothing reads. The positive half: a part named x-cape is a part, attached and required to be like any other',
  );

  const dir = temp('records-early');
  try {
    const early = { key: 'fixture', ...kinds, seethrough: { resolution: 1024, steps: 30, seed: 42, offload: true, ...kinds }, assemble: { rig_scale: 0.5, ...kinds } };
    const paintOnly = { key: 'fixture', ...kinds, generation: { ...fixtureGeneration(), ...kinds, sampler: { ...(fixtureGeneration().sampler as Record<string, unknown>), ...kinds } } };
    writeFileSync(join(dir, 'early.json'), JSON.stringify(early));
    writeFileSync(join(dir, 'paint.json'), JSON.stringify(paintOnly));
    writeFileSync(join(dir, 'typo.json'), JSON.stringify({ ...early, status: { gate: 'green' } }));
    const layersErr = refusals(() => loadEarlyConfig(join(dir, 'early.json'), 'layers'));
    const paintErr = refusals(() => loadEarlyConfig(join(dir, 'paint.json'), 'paint'));
    const typo = one(refusals(() => loadEarlyConfig(join(dir, 'typo.json'), 'layers')));
    say(
      'CF57_AN_EARLY_DOOR_ACCEPTS_A_RECORD_AND_STILL_REFUSES_A_PLAIN_UNKNOWN_NAMING_THE_DOORS',
      layersErr === null && paintErr === null && typo?.code === 'CONFIG_KEY_KNOWN' && typo.object === 'config.status' && doors(typo),
      `loadEarlyConfig(…, "layers") with records at config, seethrough and assemble -> ${codes(layersErr)}; loadEarlyConfig(…, "paint") with records at config, generation and generation.sampler -> ${codes(paintErr)}; the layers config plus a plain status -> ${line(typo, null)}`,
      'the early doors read through the same Check.object, so a config that carries its records from the first step is not refused before the rig exists and accepted after',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Issue #35: a blink group with no members, and brows stated without their drop, are the loader's refusals — before rig or build starts rigc. */
function runBlinkConfigCases(say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const blinkCfg = (edit: (b: Record<string, unknown>) => void): Record<string, unknown> => {
    const c = minimalConfig();
    edit((c.motion as Record<string, unknown>).blink as Record<string, unknown>);
    return c;
  };
  const one = (err: PartsError | null): Problem | null => (err !== null && err.problems.length === 1 ? err.problems[0] : null);
  const noEyes = refusals(() => parseConfig(blinkCfg((b) => (b.eyes = []))));
  const noBrows = refusals(() => parseConfig(blinkCfg((b) => (b.brows = []))));
  const eyesOnly = refusals(() => parseConfig(blinkCfg((b) => {
    delete b.brows;
    delete b.brow_drop;
  })));
  const noBlink = refusals(() => parseConfig((() => {
    const c = minimalConfig();
    delete (c.motion as Record<string, unknown>).blink;
    return c;
  })()));
  const e = one(noEyes);
  const b = one(noBrows);
  say(
    'CF30_AN_EMPTY_BLINK_GROUP_IS_REFUSED_BY_NAME_AND_A_BLINK_WITHOUT_BROWS_OR_NO_BLINK_LOADS',
    e?.code === 'CONFIG_BLINK_GROUP_MEMBERS' &&
      e.object === 'config.motion.blink.eyes' &&
      e.detail.includes('eyewhite-r / eyewhite-l') &&
      e.detail.includes('leave config.motion.blink out') &&
      b?.code === 'CONFIG_BLINK_GROUP_MEMBERS' &&
      b.object === 'config.motion.blink.brows' &&
      b.detail.includes('eyebrow-r / eyebrow-l') &&
      eyesOnly === null &&
      noBlink === null,
    `eyes [] -> ${e === null ? codes(noEyes) : `${e.code}: ${e.object} — ${e.detail}`}; brows [] -> ${codes(noBrows)}; no brows and no brow_drop -> ${codes(eyesOnly)}; no blink -> ${codes(noBlink)}`,
    'issue #35: rigc refuses a group with no members (group "eyes" declares no members), but at the rig gate, one stage after the input that was wrong; the loader names the field and the tags that would have filled it, and the two shapes the proposer now writes — eyes only, and no blink — both load',
  );

  const dropless = one(refusals(() => parseConfig(blinkCfg((b) => delete b.brow_drop))));
  const browless = one(refusals(() => parseConfig(blinkCfg((b) => delete b.brows))));
  say(
    'CF31_BROWS_AND_BROW_DROP_ARE_STATED_TOGETHER_OR_NOT_AT_ALL',
    dropless?.code === 'CONFIG_BLINK_BROWS_PAIRED' && dropless.object === 'config.motion.blink.brow_drop' && browless?.code === 'CONFIG_BLINK_BROWS_PAIRED' && browless.object === 'config.motion.blink.brows',
    `brows without brow_drop -> ${dropless === null ? 'not one refusal' : `${dropless.code} ${dropless.object}`}; brow_drop without brows -> ${browless === null ? 'not one refusal' : `${browless.code}: ${browless.object} — ${browless.detail}`}`,
    'brows became optional so an eyebrow-less figure can be stated; without the pairing, a drop with no brows would be a value nothing reads and brows with no drop a value the idle would have to invent',
  );

  const twiceEyes = refusals(() => parseConfig(blinkCfg((b) => (b.eyes = ['head', 'head']))));
  // hip, not chest: the fixture keys chest.translatey with a single track, so
  // a brows group naming chest is also two tracks on one property (issue #49).
  const thriceBrows = refusals(() => parseConfig(blinkCfg((b) => (b.brows = ['head', 'hip', 'head', 'head']))));
  const bothOnce = refusals(() => parseConfig(blinkCfg((b) => (b.eyes = ['head', 'chest']))));
  const te = one(twiceEyes);
  const tb = one(thriceBrows);
  say(
    'CF40_A_BLINK_GROUP_NAMING_A_BONE_TWICE_IS_REFUSED_BY_NAME_WITH_ITS_INDICES',
    te?.code === 'CONFIG_BLINK_GROUP_UNIQUE' &&
      te.object === 'config.motion.blink.eyes' &&
      te.detail.startsWith('names "head" twice (at [0], [1]); each bone is named once') &&
      tb?.code === 'CONFIG_BLINK_GROUP_UNIQUE' &&
      tb.object === 'config.motion.blink.brows' &&
      tb.detail.startsWith('names "head" 3 times (at [0], [2], [3])') &&
      bothOnce === null,
    `eyes ["head", "head"] -> ${te === null ? codes(twiceEyes) : `${te.code}: ${te.object} — ${te.detail}`}; brows ["head", "hip", "head", "head"] -> ${tb === null ? codes(thriceBrows) : `${tb.code}: ${tb.detail.slice(0, 40)}…`}; eyes ["head", "chest"] -> ${codes(bothOnce)}`,
    'issue #45: rigc refuses a group naming a member twice, but at the rig gate; the loader names the group, the bone and every index it sits at, once per repeated bone, and two distinct members still load',
  );

  // Issue #49: two tracks keying one bone property. The three shapes, each a
  // refusal naming the property and both tracks by their config paths.
  const withTracks = (...extra: Array<Record<string, unknown>>): Record<string, unknown> => {
    const c = minimalConfig();
    ((c.motion as Record<string, unknown>).tracks as unknown[]).push(...extra);
    return c;
  };
  const sine = (bone: string, prop: string): Record<string, unknown> => ({ bone, prop, amp: 1, period: 4, phase: 0 });
  const twoSingles = one(refusals(() => parseConfig(withTracks(sine('head', 'rotate'), sine('head', 'rotate')))));
  const besideEyes = one(refusals(() => parseConfig(withTracks(sine('head', 'scaley')))));
  const besideLink = one(refusals(() => parseConfig(withTracks(sine('hem1', 'rotate')))));
  // The positive half: another property on the same bones (translatex beside the brows' translatey, scaley on a chain link), and both public example configs as tracked.
  const otherProps = refusals(() => parseConfig(withTracks(sine('head', 'translatex'), sine('hem1', 'scaley'))));
  const examples = exampleKeys().all.map((k) => ({ k, err: refusals(() => parseConfig(JSON.parse(readFileSync(join(EXAMPLES_DIR, k, 'config.json'), 'utf8')) as unknown)) }));
  const keyedOnce = (q: Problem | null, target: string, first: string, second: string): boolean =>
    q?.code === 'CONFIG_BONE_PROPERTY_KEYED_ONCE' && q.object === `bone property "${target}"` && q.detail.startsWith(`is keyed by 2 tracks: ${first} and ${second}; one track per bone property is required`);
  say(
    'CF42_TWO_TRACKS_ON_ONE_BONE_PROPERTY_ARE_REFUSED_NAMING_THE_PROPERTY_AND_BOTH_TRACKS',
    keyedOnce(twoSingles, 'head.rotate', 'config.motion.tracks[2]', 'config.motion.tracks[3]') &&
      keyedOnce(besideEyes, 'head.scaley', 'config.motion.tracks[2]', "config.motion.blink.eyes[0] (the blink's eyes group, which keys scaley on every member)") &&
      keyedOnce(besideLink, 'hem1.rotate', 'config.motion.tracks[1] (chain "hem", link 1)', 'config.motion.tracks[2]') &&
      otherProps === null &&
      examples.length === 2 &&
      examples.every((e) => e.err === null),
    `two singles on head.rotate -> ${twoSingles === null ? 'not one refusal' : `${twoSingles.code}: ${twoSingles.object} — ${twoSingles.detail}`}; a single on head.scaley beside the eyes group -> ${besideEyes === null ? 'not one refusal' : `${besideEyes.object}: ${besideEyes.detail.slice(0, 130)}…`}; a single on hem1.rotate beside the hem chain -> ${besideLink === null ? 'not one refusal' : `${besideLink.object}: ${besideLink.detail.slice(0, 90)}…`}; head.translatex and hem1.scaley -> ${codes(otherProps)}; ${examples.map((e) => `examples/${e.k}/config.json -> ${codes(e.err)}`).join(', ')}`,
    'issue #49: rigc refuses two tracks on one bone property (animation "idle" has two tracks on <bone>.<property>), but at the rig gate; the loader knows every track idleMotion writes — a chain keys rotate on each link, the eyes group scaley and the brows group translatey on each member — so it names the property and both tracks first, and a track on another property of the same bone still loads',
  );

  // The same forged config at rig and at build, with runners that count: the refusal must come before any rigc process.
  const dir = temp('blink-config');
  try {
    writeProposeFixture(dir, NO_EYE_PARTS, STRAND_RIG, true);
    const clean = proposalConfig(NO_EYE_PARTS, propose(readPartSet(dir)));
    const forged = { ...clean, motion: { ...(clean.motion as Record<string, unknown>), blink: { t: 2.3, eyes: [], brows: [], squash: 0.12, brow_drop: 1.2 } } };
    writeFileSync(join(dir, 'clean.json'), JSON.stringify(clean));
    writeFileSync(join(dir, 'forged.json'), JSON.stringify(forged));
    const calls: string[] = [];
    const counting = (label: string): RigcRunner => (args) => {
      calls.push(`${label} ${args[0] ?? ''}`);
      return { status: 1, out: 'counting runner: no rigc here' };
    };
    const scratch = join(dir, 'scratch');
    mkdirSync(scratch, { recursive: true });
    const quiet = (): void => {};
    const atRig = refusals(() => rigStage({ config: join(dir, 'forged.json'), parts: dir, out: join(dir, 'rig-out') }, counting('rig'), scratch, quiet));
    const rigCalls = calls.length;
    const lines: string[] = [];
    const built = build(
      { config: join(dir, 'forged.json'), source: join(dir, 'painting.png'), full: join(dir, 'absent-full'), head: join(dir, 'absent-head'), out: join(dir, 'build-out'), seam: 'near-white', project: 'core', loop: false, pageEdges: DEFAULT_PAGE_EDGES },
      { rig: counting('build-rig'), check: counting('build-check'), checkBin: 'counting', scratch },
      (l) => lines.push(l),
    );
    const buildCalls = calls.length - rigCalls;
    // The positive control: the unforged config does reach the runner, so a count of zero above is the refusal and not a runner nobody calls.
    const reached = refusals(() => rigStage({ config: join(dir, 'clean.json'), parts: dir, out: join(dir, 'clean-out') }, counting('clean'), scratch, quiet));
    const cleanCalls = calls.length - rigCalls - buildCalls;
    const rigCodes = atRig?.problems.map((q) => `${q.code} ${q.object}`) ?? [];
    const buildFail = lines.filter((l) => l.includes('FAIL'));
    say(
      'CF32_AN_EMPTY_EYES_GROUP_STOPS_RIG_AND_BUILD_BEFORE_ANY_RIGC_PROCESS',
      rigCodes.join('|') === 'CONFIG_BLINK_GROUP_MEMBERS config.motion.blink.eyes|CONFIG_BLINK_GROUP_MEMBERS config.motion.blink.brows' &&
        rigCalls === 0 &&
        built.stoppedAt === 'assemble' &&
        buildCalls === 0 &&
        buildFail.length === 2 &&
        buildFail.every((l) => l.includes('CONFIG_BLINK_GROUP_MEMBERS')) &&
        !existsSync(join(dir, 'rig-out')) &&
        reached !== null &&
        cleanCalls > 0,
      `rig -> ${rigCodes.join('; ') || 'nothing'}, ${rigCalls} rigc call(s); build stopped at ${built.stoppedAt ?? 'nothing'} with ${buildFail.length} FAIL line(s) (${buildFail[0]?.trim() ?? ''}), ${buildCalls} rigc call(s); the unforged config reaches the runner ${cleanCalls} time(s) (${reached?.problems[0]?.code ?? 'no refusal'} from the counting runner's red answer)`,
      'the loop\'s rule is that a refusal names the stage whose input is wrong: rig reads motion first and build asks the full loader before assemble writes anything, so neither may leave the empty group for rigc to find; the counting runner is the witness that no process was asked',
    );

    // Issue #45: a group naming one bone twice — the same forged-config walk, through the same counting runners.
    const twice = { ...clean, motion: { ...(clean.motion as Record<string, unknown>), blink: { t: 2.3, eyes: ['head', 'head'], squash: 0.12 } } };
    writeFileSync(join(dir, 'twice.json'), JSON.stringify(twice));
    const before = calls.length;
    const twiceRig = refusals(() => rigStage({ config: join(dir, 'twice.json'), parts: dir, out: join(dir, 'twice-out') }, counting('twice-rig'), scratch, quiet));
    const twiceRigCalls = calls.length - before;
    const twiceLines: string[] = [];
    const twiceBuilt = build(
      { config: join(dir, 'twice.json'), source: join(dir, 'painting.png'), full: join(dir, 'absent-full'), head: join(dir, 'absent-head'), out: join(dir, 'twice-build'), seam: 'near-white', project: 'core', loop: false, pageEdges: DEFAULT_PAGE_EDGES },
      { rig: counting('twice-build-rig'), check: counting('twice-build-check'), checkBin: 'counting', scratch },
      (l) => twiceLines.push(l),
    );
    const twiceBuildCalls = calls.length - before - twiceRigCalls;
    const twiceCodes = twiceRig?.problems.map((q) => `${q.code} ${q.object}`) ?? [];
    const twiceFail = twiceLines.filter((l) => l.includes('FAIL'));
    say(
      'CF41_A_BLINK_GROUP_NAMING_A_BONE_TWICE_STOPS_RIG_AND_BUILD_BEFORE_ANY_RIGC_PROCESS',
      twiceCodes.join('|') === 'CONFIG_BLINK_GROUP_UNIQUE config.motion.blink.eyes' &&
        twiceRigCalls === 0 &&
        twiceBuilt.stoppedAt === 'assemble' &&
        twiceBuildCalls === 0 &&
        twiceFail.length === 1 &&
        twiceFail[0].includes('CONFIG_BLINK_GROUP_UNIQUE: config.motion.blink.eyes — names "head" twice') &&
        !existsSync(join(dir, 'twice-out')) &&
        cleanCalls > 0,
      `rig -> ${twiceCodes.join('; ') || 'nothing'}, ${twiceRigCalls} rigc call(s); build stopped at ${twiceBuilt.stoppedAt ?? 'nothing'} with ${twiceFail.length} FAIL line(s) (${twiceFail[0]?.trim() ?? ''}), ${twiceBuildCalls} rigc call(s); the unforged config reached the runner ${cleanCalls} time(s) above`,
      'issue #45: rigc refused a member named twice (group "eyes" names member "eye" twice) at the gate, one stage late; the loader refuses it first, so neither stage hands the group to a rigc process — CF32\'s positive control is the witness that the runner is one that gets called',
    );

    // Issue #49: a proposal config with its first track written twice — the same walk, the same counting runners.
    const cleanMotion = clean.motion as Record<string, unknown>;
    const cleanTracks = cleanMotion.tracks as unknown[];
    const shared = { ...clean, motion: { ...cleanMotion, tracks: [...cleanTracks, cleanTracks[0]] } };
    writeFileSync(join(dir, 'shared.json'), JSON.stringify(shared));
    const sharedBefore = calls.length;
    const sharedRig = refusals(() => rigStage({ config: join(dir, 'shared.json'), parts: dir, out: join(dir, 'shared-out') }, counting('shared-rig'), scratch, quiet));
    const sharedRigCalls = calls.length - sharedBefore;
    const sharedLines: string[] = [];
    const sharedBuilt = build(
      { config: join(dir, 'shared.json'), source: join(dir, 'painting.png'), full: join(dir, 'absent-full'), head: join(dir, 'absent-head'), out: join(dir, 'shared-build'), seam: 'near-white', project: 'core', loop: false, pageEdges: DEFAULT_PAGE_EDGES },
      { rig: counting('shared-build-rig'), check: counting('shared-build-check'), checkBin: 'counting', scratch },
      (l) => sharedLines.push(l),
    );
    const sharedBuildCalls = calls.length - sharedBefore - sharedRigCalls;
    const sharedProblems = sharedRig?.problems ?? [];
    const sharedFail = sharedLines.filter((l) => l.includes('FAIL'));
    const lastAt = `config.motion.tracks[${cleanTracks.length}]`;
    say(
      'CF43_TWO_TRACKS_ON_ONE_BONE_PROPERTY_STOP_RIG_AND_BUILD_BEFORE_ANY_RIGC_PROCESS',
      sharedProblems.length > 0 &&
        sharedProblems.every((q) => q.code === 'CONFIG_BONE_PROPERTY_KEYED_ONCE' && q.detail.includes('config.motion.tracks[0]') && q.detail.includes(lastAt)) &&
        sharedRigCalls === 0 &&
        sharedBuilt.stoppedAt === 'assemble' &&
        sharedBuildCalls === 0 &&
        sharedFail.length === sharedProblems.length &&
        sharedFail.every((l) => l.includes('CONFIG_BONE_PROPERTY_KEYED_ONCE')) &&
        !existsSync(join(dir, 'shared-out')) &&
        cleanCalls > 0,
      `the proposal's tracks[0] written again as ${lastAt}: rig -> ${sharedProblems.length} refusal(s) (${sharedProblems[0] === undefined ? 'none' : `${sharedProblems[0].code}: ${sharedProblems[0].object} — ${sharedProblems[0].detail.slice(0, 120)}…`}), ${sharedRigCalls} rigc call(s); build stopped at ${sharedBuilt.stoppedAt ?? 'nothing'} with ${sharedFail.length} FAIL line(s), ${sharedBuildCalls} rigc call(s); the unforged config reached the runner ${cleanCalls} time(s) above`,
      'issue #49: rigc refused the pair at the gate (animation "idle" has two tracks on …), one stage after the config that was wrong; the loader refuses it first, so neither stage starts a rigc process — CF32\'s positive control is the witness that the runner is one that gets called',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

    // The three visibility counts: all or none, and adding up when present.
    const counted = JSON.parse(first) as { parts: Array<Record<string, unknown>> } & Record<string, unknown>;
    Object.assign(counted.parts[0], { visible_px: 90, occluded_px: 10, visible_not_projected_px: 15 });
    writeFileSync(path, JSON.stringify(counted));
    const countedOk = refusals(() => readParts(path));
    const countedBytes = countedOk === null ? serializeParts(readParts(path)) : '';
    const inOrder = countedBytes.indexOf('"opaque_px"') < countedBytes.indexOf('"visible_px"') && countedBytes.indexOf('"source_px_taken"') < countedBytes.indexOf('"visible_not_projected_px"');
    const broken = JSON.parse(JSON.stringify(counted)) as typeof counted;
    Object.assign(broken.parts[0], { occluded_px: 11, visible_not_projected_px: 91 });
    writeFileSync(path, JSON.stringify(broken));
    const eAdd = refusals(() => readParts(path));
    const partial = JSON.parse(JSON.stringify(counted)) as typeof counted;
    delete partial.parts[0].occluded_px;
    writeFileSync(path, JSON.stringify(partial));
    const ePart = refusals(() => readParts(path));
    const adds = eAdd?.problems.filter((p) => p.code === 'PARTS_COUNTS_ADD_UP') ?? [];
    say(
      'PT03_THE_VISIBILITY_COUNTS_ARE_ALL_OR_NONE_AND_MUST_ADD_UP',
      countedOk === null && inOrder && adds.length === 2 && adds[0].detail.includes('visible_px 90 + occluded_px 11 = 101; opaque_px 100 is required') && ePart !== null && ePart.problems.length === 1 && ePart.problems[0].code === 'PARTS_FIELD_PRESENT' && ePart.problems[0].detail.includes('only visible_px, visible_not_projected_px present'),
      `90 + 10 of 100 opaque -> ${countedOk === null ? 'read' : codes(countedOk)}, written after opaque_px and source_px_taken: ${inOrder}; 90 + 11 and 91 unprojected of 90 visible -> ${adds.map((p) => p.detail).join(' | ') || codes(eAdd)}; occluded_px dropped -> ${ePart === null ? 'read' : `${ePart.problems[0].code}: ${ePart.problems[0].detail}`}; PT01's record carries none and reads, as a reference-written parts.json must`,
      "issue #9's counts are this port's: the reference's files have none of them and must keep reading, but a record carrying some is not one either stage wrote",
    );

    // The recomposite block (issue #25): optional, as the reference wrote none; when present, every figure consistent.
    const block: RecompositeRecord = {
      mean_abs: 2.5,
      within_limit: 8,
      within_share: 0.95,
      error_limit: 40,
      error_px: 50,
      covered_alpha: 128,
      uncovered_error_px: 30,
      hole_count: 3,
      holes_listed: 2,
      holes: [
        { px: 20, x: 0, y: 0, w: 5, h: 4, borders: [{ part: 'face', px: 6 }] },
        { px: 7, x: 25, y: 20, w: 7, h: 4, borders: [] },
      ],
    };
    writeParts(path, { ...file, recomposite: block });
    const withBlock = readFileSync(path, 'utf8');
    const blockBack = readParts(path);
    const blockSame = serializeParts(blockBack) === withBlock && JSON.stringify(blockBack.recomposite) === JSON.stringify(block) && withBlock.indexOf('"ghost_px"') < withBlock.indexOf('"recomposite"');
    type Forge = (b: Record<string, unknown> & { holes: Array<Record<string, unknown>> }) => void;
    const forged: Array<[string, string, Forge]> = [
      ['an unknown key in the block', 'PARTS_KEY_KNOWN', (b) => (b.largest = 1)],
      ['hole_count dropped', 'PARTS_FIELD_PRESENT', (b) => delete b.hole_count],
      ['mean_abs 300', 'PARTS_FIELD_TYPE', (b) => (b.mean_abs = 300)],
      ['holes not an array', 'PARTS_FIELD_TYPE', (b) => (b.holes = {} as unknown as Array<Record<string, unknown>>)],
      ['uncovered 60 of 50 error px', 'PARTS_COUNTS_ADD_UP', (b) => (b.uncovered_error_px = 60)],
      ['holes_listed 3 with two listed of three', 'PARTS_COUNTS_ADD_UP', (b) => (b.holes_listed = 3)],
      ['a 21 px hole in a 5x4 box', 'PARTS_COUNTS_ADD_UP', (b) => (b.holes[0].px = 21)],
      ['both holes listed, holding 27 of 30 px', 'PARTS_COUNTS_ADD_UP', (b) => (b.hole_count = 2)],
      ['the smaller hole first', 'PARTS_HOLES_LARGEST_FIRST', (b) => b.holes.reverse()],
      ['a box past the rig edge', 'PARTS_BOX_INSIDE_RIG', (b) => (b.holes[1].x = 26)],
      ['a border naming no part', 'PARTS_HOLE_PART_KNOWN', (b) => ((b.holes[0].borders as Array<Record<string, unknown>>)[0].part = 'hair')],
    ];
    const forgeries = forged.map(([what, code, forge]) => {
      const raw = JSON.parse(withBlock) as { recomposite: Record<string, unknown> & { holes: Array<Record<string, unknown>> } };
      forge(raw.recomposite);
      writeFileSync(path, JSON.stringify(raw));
      const err = refusals(() => readParts(path));
      return { what, code, ok: err !== null && err.problems.length === 1 && err.problems[0].code === code, got: codes(err), line: err?.problems[0] };
    });
    const unmet = forgeries.filter((f) => !f.ok);
    say(
      'PT04_THE_RECOMPOSITE_BLOCK_ROUND_TRIPS_AND_EACH_FORGED_FIGURE_IS_ONE_NAMED_REFUSAL',
      blockSame && unmet.length === 0,
      `a block with two of three holes listed reads back equal and is written after ghost_px: ${blockSame}; ` +
        (unmet.length === 0
          ? `${forgeries.length} forged blocks, each exactly one refusal under its code; e.g. ${forgeries[7].line?.code}: ${forgeries[7].line?.object} — ${forgeries[7].line?.detail}`
          : unmet.map((f) => `${f.what}: wanted ${f.code} alone, got ${f.got}`).join('; ')),
      "a reader is only a gate on the fields it refuses: check copies this block into check.json, so a block that does not add up would be reported as a measurement",
    );


    // A painting patch (issue #28): its provenance names itself, and it is 100 % source.
    const patchRec = { name: 'hem', from: 'painting:hem', x: 2, y: 20, w: 10, h: 2, opaque_px: 20, visible_px: 20, occluded_px: 0, projected_core_px: 20, source_px_taken: 20, visible_not_projected_px: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
    const withPatch = (rec: Record<string, unknown>, ghost: Record<string, number> = file.ghost_px): string => {
      writeFileSync(path, JSON.stringify({ ...file, parts: [...file.parts, rec], ghost_px: ghost }));
      return path;
    };
    const patchOk = refusals(() => readParts(withPatch(patchRec)));
    const patchFaults: Array<[string, Record<string, unknown>, Record<string, number> | undefined, string, string]> = [
      ['a provenance naming another patch', { ...patchRec, from: 'painting:skirt' }, undefined, 'PARTS_FROM_KNOWN', '"painting:hem" is required'],
      ['a patch that took less than its opaque pixels', { ...patchRec, source_px_taken: 19, visible_not_projected_px: 1 }, undefined, 'PARTS_COUNTS_ADD_UP', 'source_px_taken 19 (opaque_px 20 required), visible_not_projected_px 1 (0 required)'],
      ['a patch with occluded pixels', { ...patchRec, visible_px: 18, occluded_px: 2 }, undefined, 'PARTS_COUNTS_ADD_UP', 'visible_px 18 (opaque_px 20 required), occluded_px 2 (0 required)'],
      ['a ghost count for a patch', patchRec, { ...file.ghost_px, 'painting:hem': 0 }, 'PARTS_FROM_KNOWN', 'a patch has no See-through layer'],
    ];
    const patchSeen = patchFaults.map(([what, rec, ghost, code, text]) => {
      const err = refusals(() => readParts(withPatch(rec, ghost)));
      const one = err !== null && err.problems.length === 1 ? err.problems[0] : null;
      return { what, ok: one !== null && one.code === code && one.detail.includes(text), got: err === null ? 'reads' : err.problems.map((q) => `${q.code}: ${q.detail}`).join('; ') };
    });
    const patchMissed = patchSeen.filter((o) => !o.ok);
    say(
      'PT05_A_PAINTING_PATCH_NAMES_ITSELF_AND_IS_100_PERCENT_SOURCE',
      patchOk === null && patchMissed.length === 0,
      patchOk !== null ? `a correct painting:hem record is refused: ${codes(patchOk)}` : patchMissed.length === 0 ? `painting:hem with every count 20 or 0 reads; ${patchSeen.length} planted records, each refused once: ${patchSeen.map((o) => o.got).join(' | ')}` : patchMissed.map((o) => `${o.what}: ${o.got}`).join(' | '),
      'a patch is cut from the painting, so its record can only say one thing about where its pixels came from; a "painting:" record that says anything else is a record assemble did not write',
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

  const later: string[] = [];
  const help = runCli(['--help']);
  const stubs = later.map((c) => ({ c, r: runCli([c]) }));
  const honest = stubs.filter(({ r }) => r.status === 2 && r.out.includes('NOT_IMPLEMENTED') && r.out.includes('not implemented in this version'));
  say(
    'CL02_EVERY_LATER_COMMAND_IS_LISTED_AND_EXITS_TWO_SAYING_SO',
    help.status === 0 && [...later, 'layers', 'sheet', 'assemble', 'propose', 'rig', 'check', 'loop', 'inputs', 'comfy seethrough', 'comfy paint', 'build'].every((c) => help.out.includes(c)) && honest.length === later.length,
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
      eyes.keys.map((k) => `${k.t}:${k.v[0]}${k.ease === undefined ? '' : `:${k.ease}`}`).join(' ') === '0:1 1:1:shut 1.07:0.12 1.154:0.12:open 1.314:1 4:1' &&
      JSON.stringify(r.motion.groups) === '{"eyes":["eye"],"brows":["eye"]}' &&
      r.controls.join(',') === 'hem0,hem1',
    `hem0_ctl: ${link0?.keys.length ?? 0} keys, first ${link0?.keys[0].v[0]}, last ${link0?.keys[link0.keys.length - 1].v[0]}; hem1_ctl first ${link1?.keys[0].v[0]} (by hand ${pyRound(v0, 4)}), handle ${link1?.keys[0].curve?.join(',')} (by hand ${pyRound(0.5 / 3, 6)},${pyRound(h0, 4)}); eyes ${eyes?.keys.map((k) => `${k.t}:${k.v[0]}`).join(' ')}; controls ${r.controls.join(',')}`,
    'a period of 4 s in a 4 s idle is 8 spans and 9 keys; the lag puts link 1 at phase 0.1; the handle is the Hermite tangent a third of a span out; the blink shuts in 0.07 s, holds 0.084 s (one 12 fps frame, 0.083333 s, rounded up to the third place — issue #32) and opens in 0.16 s',
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

    // Issue #70: the build fixtures carry no mesh entry and no blink, so the
    // records there are held here, on the two rig fixtures that do — through
    // the loader, then the rig stage, against the same configs without them.
    const rigTexts = (cfg: CharacterConfig, parts: PartsFile, images: Map<string, Raster>): string[] => {
      const built = buildRig(cfg, parts, images);
      return [rigJsonText(built.rig), rigJsonText(built.motion), rigJsonText(built.meshReport)];
    };
    const rigRecords = withRecords(rigConfig());
    const lashRecords = withRecords(lashConfig());
    const rigPlant = withRecords(rigConfig()).cfg;
    ((rigPlant.motion as { tracks: Array<Record<string, unknown>> }).tracks[0]).lag = 0.2;
    const files3 = ['rig.json', 'motion.json', 'mesh_report.json'];
    const sameAs = (x: string[], y: string[]): string => (x.every((t, i) => t === y[i]) ? 'byte-identical' : `${files3.filter((_, i) => x[i] !== y[i]).join(', ')} DIFFER`);
    const plainRig = rigTexts(rigCfg(), rigParts(), rigImages());
    const recRig = rigTexts(parseConfig(rigRecords.cfg), rigParts(), rigImages());
    const plainLash = rigTexts(lashCfg(), lashParts(), lashImages());
    const recLash = rigTexts(parseConfig(lashRecords.cfg), lashParts(), lashImages());
    const plantRig = rigTexts(parseConfig(rigPlant), rigParts(), rigImages());
    const lashAt = lashRecords.at.filter((w) => !rigRecords.at.includes(w));
    say(
      'RG44_X_RECORDS_ON_A_MESH_ENTRY_THE_BLINK_AND_A_STILL_CUT_LEAVE_THE_RIG_BYTE_IDENTICAL_AND_ONE_LAG_DOES_NOT',
      rigRecords.at.some((w) => w.startsWith('meshes.')) &&
        rigRecords.at.includes('blink') &&
        lashAt.some((w) => w.startsWith('blink.still.')) &&
        sameAs(plainRig, recRig) === 'byte-identical' &&
        sameAs(plainLash, recLash) === 'byte-identical' &&
        plantRig[1] !== plainRig[1],
      `the rig fixture with records at ${rigRecords.at.join(', ')} -> rig.json, motion.json, mesh_report.json ${sameAs(plainRig, recRig)}; the blink-still fixture with records at ${lashAt.join(', ')} besides -> ${sameAs(plainLash, recLash)}; planted, the hem chain's lag 0.1 -> 0.2 besides -> ${sameAs(plainRig, plantRig)}`,
      'issue #70: BU08 holds the records to every file a build writes, but its fixtures have no mesh entry and no blink; a mesh entry, the blink and a still cut are objects the loader vouches for too, and the rig stage is the one that reads them',
    );

    const wroteAll = ['images/cloth.png', 'images/eye.png', 'mesh_report.json', 'motion.json', 'rig.json'].join() === files1.join();
    const gateLines = run1.out.split('\n').filter((l) => /assertions: \d+ measured \(\d+ passed, 0 failed\)/.test(l));
    say(
      'RG04_THE_RIG_COMMAND_WRITES_ONLY_AFTER_SPINE_RIGC_IS_GREEN_ON_IT',
      run1.status === 0 && run2.status === 0 && wroteAll && gateLines.length >= 2 && /rigc build --profile spine-html --pack --page-edges free --pack-shape polygon: exit 0/.test(run1.out) && !run1.out.includes('rigc validate'),
      `exit ${run1.status}; wrote ${files1.join(', ')}; ${gateLines.length} green rigc assertion line(s), e.g. "${gateLines[0]?.trim() ?? ''}"`,
      "CLAUDE.md: the rig stages write only after spine-rigc's round trip has passed — so the command builds the staged spec through rigc before --out sees a byte",
    );

    // The mutant is a spec the loader accepts and rigc refuses. It was an
    // empty brows list until issue #35 made the loader refuse that
    // (CONFIG_BLINK_GROUP_MEMBERS), a brows list naming "eye" twice until
    // issue #45 made the loader refuse that too (CONFIG_BLINK_GROUP_UNIQUE,
    // RG40), and a sine track on eye.scaley beside the blink's eyes group until
    // issue #49 made the loader refuse two tracks on one bone property
    // (CONFIG_BONE_PROPERTY_KEYED_ONCE, RG42). Now the config is the fixture's
    // own and the fault is in parts.json, which no config loader reads: the
    // cloth mesh's box is the whole 40x40 rig, and rigc's spine-html profile
    // refuses a mesh spanning the whole stage (A14_NO_FULL_FRAME_MESH). The
    // loader's acceptance and the absence of any spine-parts refusal are
    // asserted, so the day this repository learns the rule too, this control
    // says so instead of passing on its own line.
    const redParts = rigParts();
    redParts.parts[0] = { ...redParts.parts[0], x: 0, y: 0, w: RIG_CANVAS[0], h: RIG_CANVAS[1], opaque_px: RIG_CANVAS[0] * RIG_CANVAS[1] };
    const redImages = new Map(rigImages());
    redImages.set('cloth', block(RIG_CANVAS[0], RIG_CANVAS[1]));
    const redCfg = rigConfig();
    const redLoads = refusals(() => parseConfig(redCfg));
    const red = writeRigFixture(join(dir, 'red'), redCfg, redImages, redParts);
    const redRun = runCli(['rig', '--config', red.config, '--parts', red.parts, '--out', join(dir, 'red', 'out')]);
    const redFail = redRun.out.split('\n').filter((l) => /^ {2}FAIL {2}/.test(l));
    const fullFrame = `A14_NO_FULL_FRAME_MESH: mesh "cloth" spans the whole ${RIG_CANVAS[0]}x${RIG_CANVAS[1]} stage`;
    say(
      'RG05_A_SPEC_SPINE_RIGC_REFUSES_IS_REFUSED_AND_NOTHING_IS_WRITTEN',
      redLoads === null &&
        redRun.status === 1 &&
        redFail.length === 1 &&
        /^ {2}FAIL {2}RIG_RIGC_GREEN: rigc build --profile spine-html --pack --page-edges free/.test(redFail[0]) &&
        redFail[0].includes(fullFrame) &&
        !existsSync(join(dir, 'red', 'out')),
      `the fixture config (the loader: ${codes(redLoads)}) with parts.json placing cloth at 0,0 ${RIG_CANVAS[0]}x${RIG_CANVAS[1]} -> exit ${redRun.status}, ${redFail.length} FAIL line(s): ${(redFail[0] ?? '').trim().slice(0, 70)}… ${redFail[0]?.includes(fullFrame) === true ? fullFrame : 'no rigc line naming the full-frame mesh'}; --out exists: ${existsSync(join(dir, 'red', 'out'))}`,
      "the round trip is only a gate if a red one stops the write; rigc's own refusal is carried into the FAIL line so the reader sees what rigc said, and the mutant is one the loader and the rig stage let through, or the line would be theirs — a mesh's extent comes from parts.json, which the config loader never reads",
    );

    // A rigc that dies before any gate line: the line it did print is the refusal's cause. The three stub
    // outputs are the forms measured on spine-rigc 2.0.3 (src/check.ts, causeLines): Bun's import error, a
    // run whose header came before it stopped, and a run that printed nothing.
    const dead = writeRigFixture(join(dir, 'dead'));
    const deadScratch = join(dir, 'dead-scratch');
    const deadRun = (out: string): string => {
      const err = refusals(() => rigStage({ config: dead.config, parts: dead.parts, out: join(dir, 'dead', 'out') }, () => ({ status: 1, out }), deadScratch, () => {}));
      return err === null ? 'no refusal' : err.problems.map((q) => `${q.code}: ${q.object} — ${q.detail}`).join(' / ');
    };
    const importError = "error: Cannot find module '@esotericsoftware/spine-core' from '/x/node_modules/spine-rigc/src/render.ts'";
    const died = deadRun(`${importError}\n\nBun v1.3.11 (macOS arm64)\n`);
    const headerOnly = deadRun('rigc build /x/rig.json\n  ..    rig    /x/rig.json\n  ..    motion /x/motion.json\n  ..    22 part page(s):\n');
    const silent = deadRun('');
    say(
      'RG41_A_RIGC_THAT_DIES_BEFORE_THE_GATE_PRINTS_IS_QUOTED_BY_ITS_OWN_LINE',
      died.startsWith('RIG_RIGC_GREEN: rigc build --profile spine-html --pack --page-edges free --pack-shape polygon — exited 1: ') &&
        died.includes(importError) &&
        !died.includes('Bun v1.3.11') &&
        headerOnly.includes('exited 1: ..    rig    /x/rig.json | ..    motion /x/motion.json | ..    22 part page(s):') &&
        !headerOnly.includes('rigc build /x/rig.json') &&
        silent.includes('exited 1, and it printed nothing') &&
        !existsSync(join(dir, 'dead', 'out')),
      `Bun's import error -> ${died.slice(0, 200)}…; header lines only -> …${headerOnly.slice(60, 200)}…; nothing printed -> …${silent.slice(60, 160)}`,
      "spine-rigc 2.0's cli.ts run by path without spine-core dies at import, which no gate filter reads, and the refusal said only \"exited 1\"; the line rigc or Bun printed is what names the cause, and RG05 above is the positive control that a FAIL line is still quoted as it was",
    );

    const dup = writeRigFixture(join(dir, 'dup'), (() => {
      const c = rigConfig();
      ((c.motion as Record<string, unknown>).blink as Record<string, unknown>).brows = ['eye', 'eye'];
      return c;
    })());
    const dupRun = runCli(['rig', '--config', dup.config, '--parts', dup.parts, '--out', join(dir, 'dup', 'out')]);
    const dupFail = dupRun.out.split('\n').filter((l) => l.includes('FAIL'));
    say(
      'RG40_RG05S_OLD_MUTANT_A_BROWS_GROUP_NAMING_A_BONE_TWICE_IS_NOW_THE_LOADERS_REFUSAL',
      dupRun.status === 1 &&
        dupFail.length === 1 &&
        /^ {2}FAIL {2}CONFIG_BLINK_GROUP_UNIQUE: config\.motion\.blink\.brows — names "eye" twice \(at \[0\], \[1\]\)/.test(dupFail[0]) &&
        !dupRun.out.includes('RIG_RIGC_GREEN') &&
        !dupRun.out.includes('rigc build') &&
        !existsSync(join(dir, 'dup', 'out')),
      `brows ["eye", "eye"] through the rig CLI -> exit ${dupRun.status}, ${dupFail.length} FAIL line(s): ${dupFail[0]?.trim().slice(0, 200) ?? 'none'}; a rigc line printed: ${dupRun.out.includes('rigc build')}`,
      'issue #45: rigc refused this at the gate (group "brows" names member "eye" twice), one stage after the input that was wrong; the loader now names the field and the indices, and no rigc line is printed because no rigc process ran',
    );

    const pair = writeRigFixture(join(dir, 'pair'), (() => {
      const c = rigConfig();
      ((c.motion as Record<string, unknown>).tracks as unknown[]).push({ bone: 'eye', prop: 'scaley', amp: 0.1, period: 4, phase: 0 });
      return c;
    })());
    const pairRun = runCli(['rig', '--config', pair.config, '--parts', pair.parts, '--out', join(dir, 'pair', 'out')]);
    const pairFail = pairRun.out.split('\n').filter((l) => l.includes('FAIL'));
    say(
      'RG42_RG05S_SECOND_MUTANT_A_TRACK_BESIDE_THE_BLINK_ON_EYE_SCALEY_IS_NOW_THE_LOADERS_REFUSAL',
      pairRun.status === 1 &&
        pairFail.length === 1 &&
        pairFail[0].includes('CONFIG_BONE_PROPERTY_KEYED_ONCE: bone property "eye.scaley" — is keyed by 2 tracks: config.motion.tracks[1] and config.motion.blink.eyes[0]') &&
        !pairRun.out.includes('RIG_RIGC_GREEN') &&
        !pairRun.out.includes('rigc build') &&
        !existsSync(join(dir, 'pair', 'out')),
      `a sine track on eye.scaley beside the blink's eyes group through the rig CLI -> exit ${pairRun.status}, ${pairFail.length} FAIL line(s): ${pairFail[0]?.trim().slice(0, 200) ?? 'none'}; a rigc line printed: ${pairRun.out.includes('rigc build')}`,
      'issue #49: rigc refused this at the gate (animation "idle" has two tracks on eye.scaley; merge them into one track), one stage after the input that was wrong; the loader now names the property and both tracks, and no rigc line is printed because no rigc process ran',
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

  // A parts.json painting patch the config meshes (issue #28): the loader
  // refuses that when the config names it a patch; the stage refuses it for a
  // config that names it a plan part instead.
  const painted: PartsFile = rigParts();
  const clothRec = painted.parts.find((p) => p.name === 'cloth') as PartsFile['parts'][number];
  clothRec.from = 'painting:cloth';
  const e1c = refusals(() => buildRig(rigCfg(), painted, rigImages()));
  say(
    'RG17_A_PAINTING_PATCH_IS_NEVER_MESHED',
    e1c !== null && e1c.problems.length === 1 && e1c.problems[0].code === 'RIG_PART_ATTACHED' && e1c.problems[0].object === 'part "cloth"' && e1c.problems[0].detail.includes('painting patch'),
    `cloth recorded as painting:cloth under config.meshes.cloth -> ${codes(e1c)}: ${e1c?.problems[0]?.detail ?? ''}`,
    'a patch has no tag and no bone segments of its own; it rides one bone as a region, and a mesh over it is a config that disagrees with parts.json about what the part is',
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

  // Issue #49's note: could the control rename make two distinct targets one?
  // Only if a moved key lands on a name a user track or group member already
  // holds — a declared "<bone>_ctl" (chain links end in a digit, so no link
  // can be one). Planted both ways on the mesh-keyed hem0: a single track on a
  // declared hem0_ctl beside the hem chain's rotate on hem0, and an eyes group
  // naming hem0 and hem0_ctl. Under ctl each is RIG_CONTROL_NAME_FREE before
  // any key moves; under direct nothing is renamed, so the targets stay two.
  const ctlTaken = (edit: (c: Record<string, unknown>) => void): Record<string, unknown> => {
    const c = rigConfig();
    (c.bones as unknown[]).push({ name: 'hem0_ctl', parent: 'body', at: [14, 14] });
    edit(c);
    return c;
  };
  const onTrack = ctlTaken((c) => ((c.motion as Record<string, unknown>).tracks as unknown[]).push({ bone: 'hem0_ctl', prop: 'rotate', amp: 1, period: 4, phase: 0 }));
  const inGroup = ctlTaken((c) => (((c.motion as Record<string, unknown>).blink as Record<string, unknown>).eyes = ['eye', 'hem0', 'hem0_ctl']));
  const targetsOf = (r: ReturnType<typeof buildRig>): string[] => [
    ...r.motion.animations.idle.tracks.flatMap((t) => (t.bone !== undefined ? [`${t.bone}.${t.property}`] : (r.motion.groups[t.group ?? ''] ?? []).map((b) => `${b}.${t.property}`))),
  ];
  const ctlOutcomes = [onTrack, inGroup].map((raw) => {
    const cfg = parseConfig(raw);
    const ctl = refusals(() => buildRig(cfg, rigParts(), rigImages()));
    const direct = buildRig(cfg, rigParts(), rigImages(), undefined, 'direct');
    const targets = targetsOf(direct);
    return { ctl, targets, distinct: new Set(targets).size === targets.length && targets.includes('hem0.rotate') && targets.includes(raw === onTrack ? 'hem0_ctl.rotate' : 'hem0_ctl.scaley') };
  });
  say(
    'RG43_A_DECLARED_CONTROL_NAME_CANNOT_MERGE_TWO_TRACKS_IT_IS_REFUSED_UNDER_CTL_AND_STAYS_TWO_UNDER_DIRECT',
    ctlOutcomes.every((o) => o.ctl?.problems.map((q) => `${q.code} ${q.object}`).join() === 'RIG_CONTROL_NAME_FREE bone "hem0"' && o.distinct),
    ctlOutcomes
      .map((o, i) => `${i === 0 ? 'a track on a declared hem0_ctl.rotate beside the hem chain' : 'eyes ["eye", "hem0", "hem0_ctl"]'}: ctl -> ${codes(o.ctl)}; direct -> ${o.targets.length} target(s), ${o.distinct ? 'all distinct' : 'NOT distinct'} (${o.targets.join(', ')})`)
      .join('; '),
    'issue #49 asked whether moveKeysToControls could make two tracks one: it renames every key of a controlled bone x to x_ctl, the same suffix for every bone, so two targets merge only if x_ctl is already a target, i.e. a declared bone — which the rig stage refuses by name before the rename (RIG_CONTROL_NAME_FREE), and direct, which renames nothing, keeps apart; measured on spine-rigc 2.1.3 and again on 2.10.1, both direct rigs build green',
  );

  runIdleKeysCases(say);

  // Issue #32: the eyes' hold against the frame grid the idle is rendered on.
  const treeHold = blinkHoldMisses(BLINK.shut, BLINK.hold, IDLE_FPS);
  const treeProblems = blinkHoldProblems(BLINK.shut, BLINK.hold, IDLE_FPS);
  const rgEyes = eyes?.keys ?? [];
  const rgClosed = rgEyes.length === 6 ? framesInside(rgEyes[2].t, rgEyes[3].t, IDLE_FPS, Math.round(rgEyes[5].t * IDLE_FPS) + 1) : [];
  say(
    'MO20_THE_TREES_BLINK_HOLD_PUTS_A_FRAME_IN_THE_CLOSED_WINDOW_FOR_EVERY_T',
    treeHold.phases === 250000 && treeHold.misses === 0 && treeProblems.length === 0 && rgClosed.length > 0,
    `BLINK.hold ${BLINK.hold} s at IDLE_FPS ${IDLE_FPS}: ${treeHold.misses} of ${treeHold.phases} phase(s) miss, ${treeProblems.length} refusal(s); the rig fixture's emitted closed window ${rgEyes[2]?.t}..${rgEyes[3]?.t} s holds frame(s) ${JSON.stringify(rgClosed)}`,
    'the positive control: at 12 fps a frame falls every 10^6/12 us, a pattern that repeats every 250,000 us against the 6-decimal key grid, so trying every microsecond of one such period is every blink.t; a closed interval at least 1/12 s long holds a frame wherever it starts, and 0.084 >= 0.083334',
  );
  const refHold = blinkHoldProblems(0.07, 0.04, 12);
  const refMiss = refHold[0]?.detail ?? '';
  say(
    'MO21_THE_REFERENCES_HOLD_UNDER_ONE_FRAME_IS_REFUSED_NAMING_THE_HOLD_THE_RATE_AND_THE_MISSES',
    refHold.length === 1 && refHold[0].code === 'RIG_BLINK_HOLD_SPANS_A_FRAME' && refHold[0].object === 'BLINK.hold (src/motion.ts)' && refMiss.startsWith('is 0.04 s; the idle is rendered at IDLE_FPS = 12') && refMiss.includes('for 129999 of the 250000 phases') && refMiss.includes('1/12 s, is required'),
    `hold 0.04 s at 12 fps (forged, the reference's pair) -> ${refHold.map((q) => `${q.code} ${q.object}: ${q.detail}`).join(' | ') || 'no refusal'}`,
    'by hand: a window of 40,000 us starting at an integer microsecond a misses exactly when a frame f lies just below a and the next one after a + 40,000, i.e. a in (f, f + 43,333.33); each of the three frames in a 250,000 us period (fractional parts .0, .333, .667) leaves 43,333 integers there, 129,999 in all',
  );
  const under = blinkHoldProblems(0.07, 0.083332, 12);
  const exact = blinkHoldProblems(0.07, 0.083333, 12);
  say(
    'MO22_A_HOLD_ONE_MICROSECOND_UNDER_THE_GRIDS_FLOOR_IS_REFUSED_AND_THE_FLOOR_IS_NOT',
    under.length === 1 && under[0].code === 'RIG_BLINK_HOLD_SPANS_A_FRAME' && under[0].detail.includes('for 3 of the 250000 phases') && exact.length === 0,
    `hold 0.083332 s -> ${under.map((q) => `${q.code}: ${q.detail.split(';')[1]?.trim() ?? ''}`).join(' | ') || 'no refusal'}; hold 0.083333 s -> ${exact.length} refusal(s)`,
    'the two-sided edge, by the same count: a window of 83,332 us misses for a in (f, f + 1.33), one integer per frame, 3 per period; a window of 83,333 us misses for a in (f, f + 0.33), which holds no integer after any of the three fractional parts — so the refusal is the count, not a comparison with 1/12 typed in',
  );

  runBlinkStillCases(say);
  return bad();
}

/**
 * `rig --idle-keys ctl|direct` (spine-parts #13). `ctl` is the default and
 * writes what the stage always wrote; `direct` keys the mesh-driving bones in
 * place and declares `invariants.idleDrivesMeshes`, which rigc 1.3.0's A15
 * reads. The static counts are derived from the ctl build rather than typed:
 * the fixture's chain `hem` (two links) is keyed and weighted to by `cloth`,
 * so exactly those two bones get a control.
 */
function runIdleKeysCases(say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const a = buildRig(rigCfg(), rigParts(), rigImages());
  const b = buildRig(rigCfg(), rigParts(), rigImages(), undefined, 'direct');
  const strip = (n: string): string => (n.endsWith(CONTROL_SUFFIX) ? n.slice(0, -CONTROL_SUFFIX.length) : n);
  const aNames = a.rig.bones.map((x) => x.name);
  const bNames = b.rig.bones.map((x) => x.name);
  const keysOf = (m: typeof a.motion, rename: (n: string) => string): string =>
    JSON.stringify({ groups: Object.fromEntries(Object.entries(m.groups).map(([g, ms]) => [g, ms.map(rename)])), tracks: m.animations.idle.tracks.map((t) => ({ ...t, ...(t.bone === undefined ? {} : { bone: rename(t.bone) }) })) });
  const sameKeys = keysOf(a.motion, strip) === keysOf(b.motion, (n) => n);
  const sameSkins = JSON.stringify(a.rig.skins) === JSON.stringify(b.rig.skins) && JSON.stringify(a.rig.slots) === JSON.stringify(b.rig.slots);
  const aKeys = a.motion.animations.idle.tracks.reduce((n, t) => n + t.keys.length, 0);
  const bKeys = b.motion.animations.idle.tracks.reduce((n, t) => n + t.keys.length, 0);
  const lashDirect = buildRig(lashCfg(), lashParts(), lashImages(), undefined, 'direct');
  const lashCtl = buildRig(lashCfg(), lashParts(), lashImages());
  say(
    'RG18_IDLE_KEYS_DIRECT_DROPS_EXACTLY_THE_CONTROLS_AND_MOVES_NO_KEY_OR_VERTEX',
    a.controls.join(',') === a.meshKeyed.join(',') &&
      b.controls.length === 0 &&
      b.meshKeyed.join(',') === a.meshKeyed.join(',') &&
      aNames.length - bNames.length === a.controls.length &&
      aNames.filter((n) => !n.endsWith(CONTROL_SUFFIX)).join(',') === bNames.join(',') &&
      sameSkins &&
      sameKeys &&
      aKeys === bKeys &&
      a.rig.invariants === undefined &&
      b.rig.invariants?.idleDrivesMeshes.why === IDLE_DRIVES_MESHES_WHY &&
      lashDirect.meshKeyed.length === 0 &&
      lashDirect.rig.invariants === undefined &&
      rigJsonText(lashDirect.rig) === rigJsonText(lashCtl.rig),
    `ctl: ${aNames.length} bones (${a.controls.length} control: ${a.controls.join(', ')}), ${a.motion.animations.idle.tracks.length} track(s), ${aKeys} key(s); direct: ${bNames.length} bones, ${b.motion.animations.idle.tracks.length} track(s), ${bKeys} key(s), mesh-keyed ${b.meshKeyed.join(', ')}; slots and skins ${sameSkins ? 'identical' : 'DIFFERENT'}; keys ${sameKeys ? 'identical once _ctl is stripped' : 'DIFFERENT'}; invariants ctl ${JSON.stringify(a.rig.invariants ?? null)}, direct ${JSON.stringify(b.rig.invariants ?? null)}; a rig whose idle keys no mesh bone (the lash fixture) under direct: ${lashDirect.rig.invariants === undefined ? 'no declaration' : 'DECLARED'}, rig.json ${rigJsonText(lashDirect.rig) === rigJsonText(lashCtl.rig) ? 'identical to ctl' : 'DIFFERENT from ctl'}`,
    "the static-count half of #13: a same-origin control changes the bone count by one per keyed mesh bone and nothing else — no weight offset, no key — which is why the pose is the same; and a declaration is written only when some mesh-driving bone is keyed, because rigc refuses one that switches nothing off",
  );

  const dir = temp('idle-keys');
  try {
    const fx = writeRigFixture(join(dir, 'fx'));
    const run = (keys: string | null, out: string): { status: number; out: string } =>
      runCli(['rig', '--config', fx.config, '--parts', fx.parts, '--out', join(dir, out), ...(keys === null ? [] : ['--idle-keys', keys])]);
    const none = run(null, 'none');
    const ctl = run('ctl', 'ctl');
    const direct = run('direct', 'direct');
    const bogus = run('bones', 'bogus');
    const files = filesUnder(join(dir, 'none'));
    const ctlSame = files.length > 0 && files.join() === filesUnder(join(dir, 'ctl')).join() && files.every((f) => readFileSync(join(dir, 'none', f)).equals(readFileSync(join(dir, 'ctl', f))));
    const green = (r: { out: string }): boolean => /rigc build --profile spine-html --pack --page-edges free --pack-shape polygon: exit 0/.test(r.out) && !r.out.includes('rigc validate');
    const skipLine = direct.out.split('\n').find((l) => l.includes('SKIP  A15_IDLE_NO_MESH_BONE_KEYS')) ?? '';
    const directRig = existsSync(join(dir, 'direct', 'rig.json')) ? (JSON.parse(readFileSync(join(dir, 'direct', 'rig.json'), 'utf8')) as { bones: Array<{ name: string }>; invariants?: unknown }) : null;
    // The planted half: the direct rig with its declaration taken out, built
    // by the installed rigc as the stage builds it. A15 must go red, once per
    // keyed mesh bone — the declaration is what keeps direct green, not luck.
    let undeclared = 'not run (no direct rig.json)';
    let undeclaredRed = false;
    if (directRig !== null) {
      const plant = join(dir, 'undeclared');
      mkdirSync(plant, { recursive: true });
      const raw = JSON.parse(readFileSync(join(dir, 'direct', 'rig.json'), 'utf8')) as Record<string, unknown>;
      delete raw.invariants;
      writeFileSync(join(plant, 'rig.json'), JSON.stringify({ ...raw, images: join(dir, 'direct', 'images') }));
      const r = spawnSync(findRigc(ROOT, ''), ['build', '--rig', join(plant, 'rig.json'), '--motion', join(dir, 'direct', 'motion.json'), '--out', join(plant, 'build'), '--profile', 'spine-html', '--pack', '--page-edges', DEFAULT_PAGE_EDGES], { encoding: 'utf8', maxBuffer: 1 << 26 });
      const fails = `${r.stdout}${r.stderr}`.split('\n').filter((l) => /^ {2}FAIL {2}A15_IDLE_NO_MESH_BONE_KEYS: idle keys bone "/.test(l));
      const distinct = [...new Set(fails)];
      undeclaredRed = r.status !== 0 && distinct.length === a.meshKeyed.length;
      undeclared = `exit ${r.status}, ${distinct.length} distinct A15 FAIL line(s) for ${a.meshKeyed.length} keyed mesh bone(s)`;
    }
    say(
      'RG19_BOTH_IDLE_KEYS_VALUES_BUILD_GREEN_AND_AN_UNKNOWN_ONE_IS_REFUSED_BY_NAME',
      none.status === 0 &&
        ctl.status === 0 &&
        direct.status === 0 &&
        green(ctl) &&
        green(direct) &&
        ctlSame &&
        skipLine.includes(`declared by the rig ("${IDLE_DRIVES_MESHES_WHY}")`) &&
        directRig !== null &&
        directRig.invariants !== undefined &&
        !directRig.bones.some((x) => x.name.endsWith(CONTROL_SUFFIX)) &&
        bogus.status === 2 &&
        bogus.out.includes('FAIL  USAGE: --idle-keys bones; one of ctl, direct is required') &&
        !existsSync(join(dir, 'bogus')) &&
        undeclaredRed,
      `no flag exit ${none.status}; --idle-keys ctl exit ${ctl.status}, ${ctlSame ? `${files.length} file(s) byte-identical to no flag` : 'DIFFERENT from no flag'}; --idle-keys direct exit ${direct.status}, gates ${green(direct) ? 'green' : 'NOT green'}, rigc says "${skipLine.trim().slice(0, 120)}…"; --idle-keys bones -> exit ${bogus.status}, ${(bogus.out.split('\n').find((l) => l.includes('FAIL')) ?? '').trim()}; --out written: ${existsSync(join(dir, 'bogus'))}; the direct rig with invariants.idleDrivesMeshes removed -> ${undeclared}`,
      "the switch's two values both pass spine-rigc's round trip on the synthetic fixture, the default is the old output byte for byte (so the examples' expected files do not move), and a value the stage does not know is a usage error naming the two it does",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function lashCfg(edit: (c: Record<string, unknown>) => void = () => {}): CharacterConfig {
  const c = lashConfig();
  edit(c);
  return parseConfig(c);
}

function stillOf(c: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return ((c.motion as Record<string, unknown>).blink as Record<string, unknown>).still as Record<string, Record<string, unknown>>;
}

/**
 * The setup pose and the setup pose with the blink held shut, rendered by the
 * installed rigc from a rig directory the rig stage wrote — the same two
 * throwaway animations `check` renders for BLINK_NO_HOLE, at the rig's size.
 */
function stillAndShut(rigDir: string, dest: string, squash: number): { open: FrameSet; shut: FrameSet } | string {
  mkdirSync(dest, { recursive: true });
  const rig = JSON.parse(readFileSync(join(rigDir, 'rig.json'), 'utf8')) as Record<string, unknown>;
  const motion = JSON.parse(readFileSync(join(rigDir, 'motion.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dest, 'rig.json'), JSON.stringify({ ...rig, images: join(rigDir, 'images') }));
  const hold = (tracks: unknown[]): Record<string, unknown> => ({ duration: 0.1, loop: false, tracks });
  const animations = {
    open: hold([{ bone: 'root', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 0.1, v: [0] }] }]),
    shut: hold([{ group: 'eyes', property: 'scaley', keys: [{ t: 0, v: [squash] }, { t: 0.1, v: [squash] }] }]),
  };
  writeFileSync(join(dest, 'motion.json'), JSON.stringify({ ...motion, animations }));
  const rigc = findRigc(ROOT, '');
  const run = (args: string[]): string | null => {
    const r = spawnSync(rigc, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    return r.status === 0 ? null : `rigc ${args[0]} exit ${r.status}: ${`${r.stdout}${r.stderr}`.trim().split('\n').slice(-2).join(' | ')}`;
  };
  const max = String(Math.max(...LASH_RIG));
  const err =
    run(['build', '--rig', join(dest, 'rig.json'), '--motion', join(dest, 'motion.json'), '--out', join(dest, 'build'), '--profile', 'spine']) ??
    run(['render', '--candidate', join(dest, 'build'), '--animation', 'open', '--fps', '10', '--max', max, '--out', join(dest, 'open')]) ??
    run(['render', '--candidate', join(dest, 'build'), '--animation', 'shut', '--fps', '10', '--max', max, '--out', join(dest, 'shut')]);
  return err ?? { open: readFrameSet(join(dest, 'open')), shut: readFrameSet(join(dest, 'shut')) };
}

/** Pixels of `a` and `b` that differ in any channel, inside `box` when one is given. */
function differingPx(a: Raster, b: Raster, box?: { x0: number; y0: number; x1: number; y1: number }): number {
  const bx = box ?? { x0: 0, y0: 0, x1: a.width, y1: a.height };
  let n = 0;
  for (let y = bx.y0; y < bx.y1; y++) {
    for (let x = bx.x0; x < bx.x1; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++;
    }
  }
  return n;
}

/** issue #26: `motion.blink.still` — the loader, the rig stage's cut, and the rendered proof that the rest pose holds and the crease does not squash. */
function runBlinkStillCases(say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const r = buildRig(lashCfg(), lashParts(), lashImages());
  const low = r.rig.skins.default.lash?.lash as RegionAttachment | undefined;
  const up = r.rig.skins.default.lash_still?.lash_still as RegionAttachment | undefined;
  const img = new Map(r.images);
  const lowImg = img.get('lash.png');
  const upImg = img.get('lash_still.png');
  const whole = buildRig(lashCfg((c) => delete ((c.motion as Record<string, unknown>).blink as Record<string, unknown>).still), lashParts(), lashImages());
  // By hand (fixtures/rig.ts): the lash 14,17 16x9 cut at row 20 -> lower rows 20..25 (6 rows), upper 17..19 (3 rows), each padded by 4.
  // Lower centre (14 + 8, 20 + 3) = (22, 23) on eye (22, 27): (0, (64 - 23) - (64 - 27)) = (0, 4).
  // Upper centre (22, 17 + 1.5) = (22, 18.5) on head (24, 40): (-2, (64 - 18.5) - (64 - 40)) = (-2, 21.5).
  say(
    'RG13_A_BLINK_STILL_CUTS_THE_REGION_AT_ITS_ROW_INTO_A_BLINKING_AND_A_STILL_PIECE',
    r.rig.slots.map((sl) => `${sl.name}@${sl.bone}`).join(',') === 'face@head,eyewhite@eye,lash@eye,lash_still@head' &&
      low?.x === 0 &&
      low.y === 4 &&
      up?.x === -2 &&
      up.y === 21.5 &&
      lowImg?.width === 24 &&
      lowImg.height === 14 &&
      upImg?.width === 24 &&
      upImg.height === 11 &&
      JSON.stringify(r.motion) === JSON.stringify(whole.motion) &&
      JSON.stringify(r.rig.bones) === JSON.stringify(whole.rig.bones),
    `slots ${r.rig.slots.map((sl) => `${sl.name}@${sl.bone}`).join(', ')}; lash at ${low?.x},${low?.y} (${lowImg?.width}x${lowImg?.height}), lash_still at ${up?.x},${up?.y} (${upImg?.width}x${upImg?.height}); motion and bones ${JSON.stringify(r.motion) === JSON.stringify(whole.motion) && JSON.stringify(r.rig.bones) === JSON.stringify(whole.rig.bones) ? 'identical to' : 'DIFFERENT from'} the uncut rig's`,
    'the positive control, every figure derived in fixtures/rig.ts: the rows above the cut are drawn right after the part by <part>_still on the named bone, which no blink group names; the lower piece keeps the part\'s slot, so the blink keys nothing new',
  );

  const through = refusals(() => buildRig(lashCfg((c) => (stillOf(c).lash.row = 22)), lashParts(), lashImages()));
  const edge = refusals(() => buildRig(lashCfg((c) => (stillOf(c).lash.row = 17)), lashParts(), lashImages()));
  const bare = lashImages();
  const noCrease = bare.get('lash') as Raster;
  for (let i = 0; i < 16 * 2 * 4; i++) noCrease.data[i] = 0;
  const empty = refusals(() => buildRig(lashCfg((c) => (stillOf(c).lash.row = 18)), lashParts(), bare));
  const takenParts = lashParts();
  takenParts.parts.push({ ...takenParts.parts[1], name: 'lash_still' });
  // Past the loader, whose plan does not make lash_still: the rig stage's own check, for a caller that skipped it.
  const takenCfg = lashConfig();
  (takenCfg.regions as Record<string, string>).lash_still = 'head';
  const taken = refusals(() => buildRig(takenCfg as unknown as CharacterConfig, takenParts, new Map([...lashImages(), ['lash_still', lashImages().get('eyewhite') as Raster]])));
  say(
    'RG14_A_CUT_THROUGH_ART_ON_THE_EDGE_WITH_AN_EMPTY_PIECE_OR_ONTO_A_TAKEN_NAME_IS_REFUSED',
    codes(through) === 'RIG_STILL_ROW_CLEAR config.motion.blink.still.lash.row' &&
      (through?.problems[0].detail.includes('16 pixel(s)') ?? false) &&
      codes(edge) === 'RIG_STILL_ROW_INSIDE_PART config.motion.blink.still.lash.row' &&
      codes(empty) === 'RIG_STILL_PIECES_HAVE_ART config.motion.blink.still.lash.row' &&
      codes(taken) === 'RIG_STILL_NAME_FREE config.motion.blink.still.lash',
    `row 22 (lash line) -> ${codes(through)}: ${through?.problems[0]?.detail.slice(0, 90) ?? ''}…; row 17 (the part's top) -> ${codes(edge)}; the crease erased, row 18 -> ${codes(empty)}; a part already named lash_still -> ${codes(taken)}`,
    'a cut through art is not exact even at rest — measured on the demo example cut through its lash line: the setup-pose render moved 36 px (max 7 levels) at render scale 0.942 — so only a clear row is accepted; a piece with no art holds nothing still, and a taken slot name would draw one part twice',
  );

  const off = refusals(() => parseConfig(((): Record<string, unknown> => {
    const c = lashConfig();
    stillOf(c).lash.bone = 'eye';
    stillOf(c).face = { row: 20, bone: 'head' };
    stillOf(c).cloth = { row: 20, bone: 'nowhere' };
    stillOf(c).eyewhite = { row: 20.5, bone: 'head' };
    return c;
  })()));
  const got = off?.problems.map((p) => `${p.code} ${p.object}`) ?? [];
  const want = [
    'CONFIG_STILL_OFF_THE_BLINK config.motion.blink.still.lash.bone',
    'CONFIG_STILL_OFF_THE_BLINK config.motion.blink.still.face',
    'CONFIG_NAME_RESOLVES config.motion.blink.still.cloth.bone',
    'CONFIG_NAME_RESOLVES config.motion.blink.still.cloth',
    'CONFIG_FIELD_TYPE config.motion.blink.still.eyewhite.row',
  ];
  say(
    'RG15_THE_LOADER_REFUSES_A_STILL_PIECE_THAT_WOULD_BLINK_OR_HOLDS_NOTHING_STILL_BY_NAME',
    refusals(() => lashCfg()) === null && got.length === want.length && want.every((w) => got.includes(w)),
    `the fixture's still loads: ${codes(refusals(() => lashCfg()))}; planted -> ${got.join('; ')}`,
    'a still piece on an eye bone blinks anyway, a cut of a part the blink never moves holds nothing still, and a bone or part that resolves to nothing is the silence the loader exists to name',
  );

  const dir = temp('blink-still');
  try {
    const cut = writeRigFixture(join(dir, 'cut'), lashConfig(true), lashImages(), lashParts());
    const uncut = writeRigFixture(join(dir, 'uncut'), lashConfig(false), lashImages(), lashParts());
    const a = runCli(['rig', '--config', cut.config, '--parts', cut.parts, '--out', join(dir, 'cut', 'rig')]);
    const b = runCli(['rig', '--config', uncut.config, '--parts', uncut.parts, '--out', join(dir, 'uncut', 'rig')]);
    const ra = a.status === 0 ? stillAndShut(join(dir, 'cut', 'rig'), join(dir, 'cut', 'r'), 0.12) : `rig exit ${a.status}`;
    const rb = b.status === 0 ? stillAndShut(join(dir, 'uncut', 'rig'), join(dir, 'uncut', 'r'), 0.12) : `rig exit ${b.status}`;
    let detail: string;
    let ok = false;
    if (typeof ra === 'string' || typeof rb === 'string') detail = `cut: ${typeof ra === 'string' ? ra : 'rendered'}; uncut: ${typeof rb === 'string' ? rb : 'rendered'}`;
    else {
      const H = LASH_RIG[1];
      const stage = { x: -LASH_RIG[0] / 2, y: 0, width: LASH_RIG[0], height: H };
      const crease = frameBox([{ ...lashParts().parts[2], x: LASH_CREASE.x0, y: LASH_CREASE.y0, w: LASH_CREASE.x1 - LASH_CREASE.x0, h: LASH_CREASE.y1 - LASH_CREASE.y0 }], H, stage, ra.open.viewport);
      const eyeBox = frameBox([lashParts().parts[1]], H, stage, ra.open.viewport);
      const restSame = differingPx(ra.open.frames[0].image, rb.open.frames[0].image);
      const creaseCut = crease === null ? -1 : differingPx(ra.open.frames[0].image, ra.shut.frames[0].image, crease);
      const creaseUncut = crease === null ? -1 : differingPx(rb.open.frames[0].image, rb.shut.frames[0].image, crease);
      const hole = eyeBox === null ? null : blinkFigures(ra.open.frames[0].image, ra.shut.frames[0].image, ra.open.background, eyeBox, 40);
      ok = restSame === 0 && creaseCut === 0 && creaseUncut > 0 && hole !== null && hole.holePx === 0 && hole.px > 0;
      detail = `setup pose, cut vs uncut: ${restSame} differing px of ${ra.open.frames[0].image.width}x${ra.open.frames[0].image.height}; the crease box ${crease === null ? 'off the frame' : boxLabelOf(crease)} with the eyes shut vs open: cut ${creaseCut} px, uncut ${creaseUncut} px; the eyewhite box shut: ${hole === null ? 'off the frame' : `${hole.holePx} hole px of ${hole.px}`}`;
    }
    say(
      'RG16_THE_CUT_RIG_IS_THE_UNCUT_ONE_AT_REST_AND_ITS_CREASE_DOES_NOT_MOVE_WHEN_THE_EYE_SHUTS',
      ok,
      detail,
      "issue #26's proof, rendered by the installed rigc: the cut changes no pixel of the setup pose, the crease rows are the same pixels with the blink held shut, the same crease in the uncut rig moves, and the shut eye opens no hole — the face is under it",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function boxLabelOf(b: { x0: number; y0: number; x1: number; y1: number }): string {
  return `${b.x0},${b.y0} ${b.x1 - b.x0}x${b.y1 - b.y0}`;
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

    // Issue #78: the full run of a landscape painting is the painting padded top and bottom, and the
    // box comes back through that pad. The same face on a 100-px run, k = 100 / 100 = 1, run box
    // [39, 39, 60, 60] (PR06's): on a 100x60 painting the top pad is floor(40 / 2) = 20, so
    // [39, 19, 60, 40]; on 60x100 the left pad is 20, so [19, 39, 40, 60]; on 100x61 the top pad is
    // floor(39 / 2) = 19, so [39, 20, 60, 41]. A dropped top pad reads the run box as the painting's:
    // [39, 39, 60, 60], which a 100x60 painting holds, so nothing would refuse it.
    const faceRun = headRun(100, [['face', 40, 40, 20, 20]]);
    const wideBox = proposeHeadBox(faceRun, { w: 100, h: 60 });
    const tallBox = proposeHeadBox(faceRun, { w: 60, h: 100 });
    const oddBox = proposeHeadBox(faceRun, { w: 100, h: 61 });
    const unpadded = proposeHeadBox(faceRun, { w: 100, h: 100 });
    say(
      'PR42_A_LANDSCAPE_PAINTING_S_HEAD_BOX_COMES_BACK_THROUGH_THE_TOP_PAD',
      wideBox.head_box.join(',') === '39,19,60,40' &&
        wideBox.shift.join(',') === '0,0' &&
        tallBox.head_box.join(',') === '19,39,40,60' &&
        oddBox.head_box.join(',') === '39,20,60,41' &&
        unpadded.head_box.join(',') !== wideBox.head_box.join(','),
      `100x60: [${wideBox.head_box.join(', ')}] shift ${wideBox.shift.join(',')}; 60x100: [${tallBox.head_box.join(', ')}]; 100x61: [${oddBox.head_box.join(', ')}]; the run box read with no pad: [${unpadded.head_box.join(', ')}]`,
      'the head run is fed the painting cropped at this box, so a box one pad too low cuts the chin and the shoulders instead of the head, and the crop is in the painting so nothing refuses it',
    );

    // What is still impossible: a painting whose SHORT side cannot hold the box at its size. A 20-px-tall
    // landscape painting under the same face: edge 21 > 20. And a box that leaves the top of a landscape
    // painting is held inside: the face at run y 18..37 -> run edges round(38.86) = 39, round(16.86) = 17,
    // so [39, 17 - 20, 60, 38 - 20] = [39, -3, 60, 18], shifted down 3 to [39, 0, 60, 21].
    const flat = refusals(() => proposeHeadBox(faceRun, { w: 100, h: 20 }));
    const highFace = proposeHeadBox(headRun(100, [['face', 40, 18, 20, 20]]), { w: 100, h: 60 });
    const flatLine = flat?.problems.find((p) => p.code === 'HEADBOX_FITS_CANVAS');
    say(
      'PR43_A_LANDSCAPE_PAINTING_TOO_SHORT_FOR_THE_BOX_IS_REFUSED_AND_ONE_LEAVING_ITS_TOP_IS_HELD_INSIDE',
      flat?.problems.length === 1 &&
        flatLine !== undefined &&
        flatLine.detail.includes('is 21x21 source px') &&
        flatLine.detail.includes('the 100x20 painting cannot hold it') &&
        highFace.unclamped.join(',') === '39,-3,60,18' &&
        highFace.head_box.join(',') === '39,0,60,21' &&
        highFace.shift.join(',') === '0,3',
      `100x20 -> ${codes(flat)}: ${flatLine?.detail ?? 'nothing'}; a face high on a 100x60 painting: [${highFace.unclamped.join(', ')}] -> [${highFace.head_box.join(', ')}] shift ${highFace.shift.join(',')}`,
      'HEADBOX_CANVAS_PORTRAIT is gone because a landscape painting is mapped back now; what stays impossible is a box larger than the painting\'s shorter side, whichever side that is',
    );

    const wideRunDir = join(dir, 'wide-full');
    writeRun(wideRunDir, [{ name: 'face', depth: 0.5, rects: [{ x0: 40, y0: 40, x1: 60, y1: 60, colour: C }] }], 100);
    const wideCli = runCli(['propose', '--head-box', '--full', wideRunDir, '--canvas', '100x60']);
    const wideJson = wideCli.out.split('\n').filter((ln) => ln.trim() !== '').pop() ?? '';
    say(
      'PR44_PROPOSE_HEAD_BOX_TAKES_A_LANDSCAPE_CANVAS',
      wideCli.status === 0 && wideJson === '{"head_box":[39,19,60,40]}' && wideCli.out.includes('painting 100x60;') && wideCli.out.includes('inside the painting, no shift'),
      `--canvas 100x60 -> exit ${wideCli.status}, last line ${wideJson}`,
      'the CLI refused a landscape --canvas by HEADBOX_CANVAS_PORTRAIT before issue #78; its answer is the one PR42 derives by hand',
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

    // ---- issues #22 and #23: the long robe (fixtures/propose.ts LONG_ROBE_PARTS), hand-derived there:
    //   figure y 40..389 -> 0.25 of it is y 127.25; the robe's top 95 + 0.14*50 = 102 is above it, so the hip comes from the waist.
    //   shoulder band y 96..146: 80 px (60..139) from y 96; waist band y 96..214 (the figure's middle, 214.5): the belt, 51 px at y 170,
    //   51 <= 0.8*80 = 64 -> waist; x (75 + 125)/2 = 100; hip y 170 + 7 = 177; chest 96 + 0.5*(177 - 96) = 136.5 -> 136 (to even).
    //   hands 88,160 24x24: one 576 px blob, 24 <= 0.5*80 = 40 wide, centre 100 on the axis -> clasped, a region on hip.
    // The reference rule on the same parts: hip [100, 102], chest [100, 99] (three px apart, at the collar), and two sleeve chains on the
    // 24 px blob starting on one point [100, 99] — four LINT lines (measured with the two departures switched off).
    const robeDir = join(dir, 'robe');
    writeProposeFixture(robeDir, LONG_ROBE_PARTS, LONG_ROBE_RIG);
    const RP = readPartSet(robeDir);
    const robe = propose(RP);
    const robeLint = lint(RP, robe).findings.map(lintLine);
    const robeNames = robe.bones.map((b) => ('name' in b ? b.name : b.chain));
    const waistNote = 'hip from the waist: silhouette narrowest at y=170 (width 51 px, shoulders 80 px at y=96), hip 0.14 face heights below it';
    const topNote = robe.notes.find((n) => n.startsWith('hip: robe (full:bottomwear) starts at y=95'));
    say(
      'PR08_A_ROBE_TAGGED_BOTTOMWEAR_FROM_THE_COLLAR_TAKES_ITS_HIP_FROM_THE_WAIST_BELOW_THE_CHEST',
      boneAt(robe.bones, 'hip') === '[100,177]' &&
        boneAt(robe.bones, 'chest') === '[100,136]' &&
        robe.notes.includes(waistNote) &&
        topNote !== undefined &&
        topNote.includes('above 0.25 of the figure height (y=127, figure y 40..389)') &&
        robeLint.length === 0 &&
        boneAt(robe.bones, 'skirt_c') === '[[100,197],[100,250],[100,303]]->[100,356]',
      `hip ${boneAt(robe.bones, 'hip')} (want [100,177]), chest ${boneAt(robe.bones, 'chest')} (want [100,136]), skirt_c ${boneAt(robe.bones, 'skirt_c')}; notes: ${robe.notes.filter((n) => n.startsWith('hip')).join(' | ')}; ${robeLint.length} LINT line(s)${robeLint.length > 0 ? `: ${robeLint.join(' | ')}` : ''}`,
      "issue #22: a long under-robe tagged bottomwear starts at the collar, and the reference put the hip 0.14 face heights below that edge — three px under the chest at the collar, with breath and skirt sway hanging from the shoulders and no line saying so",
    );

    // No waist: the same robe as one 80 px column (60,95 80x265). Every torso row is the shoulders' 80 px, none reaches 64 ->
    // hip 40 + 0.32*349 = 151.68 -> 152 on the axis; chest 96 + 0.5*(151.68 - 96) = 123.84 -> 124.
    const straightDir = join(dir, 'straight');
    writeProposeFixture(
      straightDir,
      LONG_ROBE_PARTS.map((p) => (p.name === 'robe' ? { ...p, x: 60, w: 80, rects: undefined } : p)),
      LONG_ROBE_RIG,
    );
    const SP = readPartSet(straightDir);
    const straight = propose(SP);
    const fallback = straight.notes.find((n) => n.startsWith('hip from 0.32 of figure height (no waist found: the silhouette never narrows to 0.8 of the shoulders (80 px at y=96)'));
    say(
      'PR09_A_ROBE_WITH_NO_WAIST_TAKES_ITS_HIP_FROM_A_STATED_PROPORTION_AND_SAYS_SO',
      boneAt(straight.bones, 'hip') === '[100,152]' && boneAt(straight.bones, 'chest') === '[100,124]' && fallback !== undefined && lint(SP, straight).findings.length === 0,
      `hip ${boneAt(straight.bones, 'hip')} (want [100,152]), chest ${boneAt(straight.bones, 'chest')} (want [100,124]); note: ${fallback ?? `ABSENT (notes: ${straight.notes.join(' | ')})`}`,
      'a waist that is not there is not measured: the fallback is the proportion the reference already uses without bottomwear, and the note names why the waist rule found nothing',
    );

    // Two planted configs on the robe: hip [100,140] under chest [100,150] (below 127.25, so only the chest line), and hip [100,120]
    // with chest [100,110] (below the chest, above the figure line: only the height line). Both exit 1 from --from-config.
    const plantHip = (hipAt: [number, number], chestAt: [number, number]): Record<string, unknown> => {
      const c = proposalConfig(LONG_ROBE_PARTS, robe) as { bones: BoneEntry[] } & Record<string, unknown>;
      c.bones = robe.bones.map((b) => ('name' in b && b.name === 'hip' ? { ...b, at: hipAt } : 'name' in b && b.name === 'chest' ? { ...b, at: chestAt } : b));
      return c;
    };
    const aboveChest = plantHip([100, 140], [100, 150]);
    const tooHigh = plantHip([100, 120], [100, 110]);
    const lintOf = (c: Record<string, unknown>): string[] =>
      lint(RP, { bones: (c as { bones: BoneEntry[] }).bones, meshes: robe.meshes })
        .findings.filter((f) => f.kind !== 'off-art')
        .map(lintLine);
    const wantChest = 'LINT hip at [100, 140] is not below chest at [100, 150]: the hip must have the larger y, or breathing and the skirt hang from the shoulders';
    const wantHigh = 'LINT hip at [100, 120] is above 0.25 of the figure height (figure y 40..389, so hip y must be at least 127.2): a hip at the shoulders';
    const cfgRobe = join(dir, 'robe.json');
    const cfgAbove = join(dir, 'robe-above.json');
    const cfgHigh = join(dir, 'robe-high.json');
    writeFileSync(cfgRobe, JSON.stringify(proposalConfig(LONG_ROBE_PARTS, robe)));
    writeFileSync(cfgAbove, JSON.stringify(aboveChest));
    writeFileSync(cfgHigh, JSON.stringify(tooHigh));
    const robeOut = join(dir, 'robe-out');
    const cliRobe = runCli(['propose', '--parts', robeDir, '--source', join(robeDir, 'painting.png'), '--out', robeOut, '--from-config', cfgRobe]);
    const cliAbove = runCli(['propose', '--parts', robeDir, '--source', join(robeDir, 'painting.png'), '--out', robeOut, '--from-config', cfgAbove]);
    const cliHigh = runCli(['propose', '--parts', robeDir, '--source', join(robeDir, 'painting.png'), '--out', robeOut, '--from-config', cfgHigh]);
    const printedOf = (r: { out: string }): string[] => r.out.split('\n').filter((l) => l.startsWith('LINT hip'));
    say(
      'PR10_A_HIP_NOT_BELOW_THE_CHEST_OR_ABOVE_A_QUARTER_OF_THE_FIGURE_IS_A_LINT_LINE',
      lintOf(aboveChest).join('|') === wantChest &&
        lintOf(tooHigh).join('|') === wantHigh &&
        cliRobe.status === 0 &&
        cliAbove.status === 1 &&
        cliHigh.status === 1 &&
        printedOf(cliAbove).join('|') === wantChest &&
        printedOf(cliHigh).join('|') === wantHigh,
      `hip under chest -> ${lintOf(aboveChest).join(' | ') || 'no line'}; hip at y 120 -> ${lintOf(tooHigh).join(' | ') || 'no line'}; --from-config exits ${cliRobe.status} on the proposal, ${cliAbove.status} and ${cliHigh.status} planted`,
      "issue #22: no LINT line or note flagged a hip at shoulder height, and a mesh lint cannot see it — every chain link was on its art. The two lines are separate because a proposal's chest is half-way to the neck, so a hip at the collar is still below its chest (the issue's hip y 270 under chest y 259): only the height line catches that case",
    );

    // Clasped hands vs the three shapes that must keep the sleeve rule: the same hands moved off the axis (20,160: centre 32,
    // 68 px from the axis, over 0.25*80 = 20), widened to 50 px at the axis (75,160 50x24: over 0.5*80 = 40), and PR01's two blobs.
    const handsCase = (name: string, hands: Partial<ProposeFixturePart>): Proposal => {
      const d = join(dir, name);
      writeProposeFixture(
        d,
        LONG_ROBE_PARTS.map((p) => (p.name === 'hands' ? { ...p, ...hands } : p)),
        LONG_ROBE_RIG,
      );
      return propose(readPartSet(d));
    };
    const offAxis = handsCase('offaxis', { x: 20 });
    const wide = handsCase('wide', { x: 75, w: 50 });
    const sleeveChains = (p: Proposal): string[] => p.bones.filter((b) => 'chain' in b && b.chain.startsWith('sleeve_')).map((b) => ('chain' in b ? b.chain : ''));
    const claspedNote = robe.notes.find((n) => n.startsWith('handwear is one blob (hands) 24x24 px centred at x=100: at most 0.5 of the shoulder width (80 px at y=96)'));
    say(
      'PR11_ONE_NARROW_BLOB_AT_THE_AXIS_IS_CLASPED_HANDS_A_REGION_WITH_NO_SLEEVE_CHAINS',
      robe.regions.hands === 'hip' &&
        !('hands' in robe.meshes) &&
        sleeveChains(robe).length === 0 &&
        claspedNote !== undefined &&
        robeNames.join(',') === 'hip,chest,neck,head,skirt_r,skirt_c,skirt_l' &&
        sleeveChains(offAxis).join(',') === 'sleeve_r,sleeve_l' &&
        'hands' in offAxis.meshes &&
        sleeveChains(wide).join(',') === 'sleeve_r,sleeve_l' &&
        'hands' in wide.meshes &&
        sleeveChains(prop).join(',') === 'sleeve_r,sleeve_l' &&
        prop.notes.includes('handwear is two blobs: one sleeve chain per mesh, chest only at the shoulder'),
      `clasped: region ${robe.regions.hands ?? 'none'}, sleeve chains [${sleeveChains(robe).join(', ')}], note ${claspedNote === undefined ? 'ABSENT' : 'present'}; off the axis: [${sleeveChains(offAxis).join(', ')}]; 50 px wide: [${sleeveChains(wide).join(', ')}]; two blobs (PR01): [${sleeveChains(prop).join(', ')}]`,
      'issue #23: hands clasped in front of the waist are one small blob at the midline, and the one-blob rule read it as both sleeves — two chains on one vertical line, six LINT lines once pasted. Two sleeves hanging from the shoulders are at least as wide as them, so a blob half as wide cannot be both',
    );

    runStrandCases(dir, say);
    runBlinkCases(dir, say);

    // issue #26: the eye parts of fixtures/propose.ts, once with a clear gap between crease and lash line and once without.
    const eyed = join(dir, 'eyes');
    writeProposeFixture(eyed, [...PROPOSE_PARTS, ...eyeParts(true)]);
    const withGap = propose(readPartSet(eyed));
    const shut = join(dir, 'eyes-shut');
    writeProposeFixture(shut, [...PROPOSE_PARTS, ...eyeParts(false)]);
    const noGap = propose(readPartSet(shut));
    const plain = propose(readPartSet(dir));
    const lashNotes = (p: Proposal): string[] => p.notes.filter((n) => n.startsWith('lash_'));
    const gapNote = lashNotes(withGap);
    const noGapNote = lashNotes(noGap);
    const loadsWithStill = refusals(() => parseConfig(proposalConfig([...PROPOSE_PARTS, ...eyeParts(true)], withGap)));
    say(
      'PR16_A_LASH_FAR_ABOVE_ITS_EYEWHITE_IS_NOTED_AND_SPLIT_AT_A_CLEAR_ROW_AND_A_NORMAL_ONE_IS_NOT',
      JSON.stringify(withGap.motion.blink?.still) === '{"lash_a":{"row":55,"bone":"head"}}' &&
        gapNote.length === 1 &&
        gapNote[0].includes('reaches 8 px above white_a\'s top, 80 % of its 10 px height (noted above 35 %)') &&
        gapNote[0].includes('is 1.67x the height of lash_b, 6 px (noted above 1.20x)') &&
        gapNote[0].includes('rows above 55') &&
        noGap.motion.blink !== undefined &&
        noGap.motion.blink.still === undefined &&
        noGapNote.length === 1 &&
        noGapNote[0].includes('no row between its top and the lid is clear') &&
        plain.motion.blink?.still === undefined &&
        lashNotes(plain).length === 0 &&
        loadsWithStill === null,
      `with a clear gap: still ${JSON.stringify(withGap.motion.blink?.still)}, note "${gapNote.join(' | ')}"; without one: still ${JSON.stringify(noGap.motion.blink?.still ?? null)}, ${noGapNote.length} note(s); lash_b (33 %, 0.6x): ${gapNote.some((n) => n.startsWith('lash_b')) ? 'NOTED' : 'not noted'}; the proposal with its still loads: ${codes(loadsWithStill)}`,
      'every figure derived in fixtures/propose.ts: 80 % is over the 35 % bar and 1.67x over 1.2x, 33 % and 0.6x are under both; the cut is proposed only on a row the rig stage accepts (RIG_STILL_ROW_CLEAR), and the bars sit above both public examples (17-26 %, 1.00-1.04x)',
    );


    // A painting patch (issue #28) named like a tag: no rule may read it by
    // that name, and the proposal must still load with it as a region.
    const patched = join(dir, 'patched');
    writeProposeFixture(patched, [...PROPOSE_PARTS, { name: 'bottomwear', from: 'painting:bottomwear', x: 60, y: 250, w: 80, h: 10, colour: [70, 110, 200] }]);
    const PP = readPartSet(patched);
    const pprop = propose(PP);
    const pLoad = refusals(() => checkProposal(PP, pprop));
    const same = JSON.stringify(pprop.bones) === JSON.stringify(prop.bones) && JSON.stringify(pprop.meshes) === JSON.stringify(prop.meshes) && JSON.stringify(pprop.motion) === JSON.stringify(prop.motion);
    const pNote = pprop.notes.find((n) => n.startsWith('bottomwear (painting:bottomwear)')) ?? '';
    say(
      'PR17_A_PAINTING_PATCH_IS_A_REGION_NO_TAG_RULE_READS_AND_THE_PROPOSAL_STILL_LOADS',
      same && pprop.regions.bottomwear === 'hip' && !('bottomwear' in pprop.meshes) && pNote.includes('config.regions.bottomwear is the bone it rides') && pLoad === null,
      `bones, meshes and motion ${same ? 'identical to' : 'DIFFER from'} the unpatched proposal; regions.bottomwear = ${pprop.regions.bottomwear}; note "${pNote}"; the proposal ${pLoad === null ? 'loads' : `is refused: ${codes(pLoad)}`}`,
      'a patch has no See-through tag, so a patch named "bottomwear" must not become a skirt; its centre (y 255) is below the hip (157), so the trunk rule puts it on hip, and the loader then holds it to a patch\'s rule (a region, never a mesh)',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

/**
 * How far a mesh part's pixels leave the rigid motion of one bone over the
 * idle, posed by spine-core through spine-rigc's sampler: per pixel centre in
 * `groups`, its setup-pose triangle's barycentric weights carried to every
 * frame (60 fps), against the same point carried by `bone`'s world transform.
 * Returns the largest offset per group, in world units (= rig px at scale 1).
 */
function offBone(buildDir: string, slot: string, bone: string, at: readonly [number, number], H: number, groups: Record<string, Array<[number, number]>>): Record<string, number> {
  const { data } = loadPosable(join(buildDir, 'skeleton.json'), join(buildDir, 'skeleton.atlas'), buildDir);
  const setup = sampleSetupPose(data, { bones: true })[0];
  const frames = sampleAnimation(data, 'idle', 60, { bones: true });
  const mesh = (f: Frame): Mesh => f.pieces.find((q) => q.slot === slot && q.kind === 'mesh') as Mesh;
  const boneOf = (f: Frame): BoneSnapshot => (f.bones ?? []).find((b) => b.name === bone) as BoneSnapshot;
  const b0 = boneOf(setup);
  // The crop-to-world offset, read off the bone rather than assumed: its crop origin is `at`.
  const ox = b0.worldX - at[0];
  const oy = b0.worldY - cropToSpineY(at[1], H);
  const s0 = mesh(setup).world;
  const tri = mesh(setup).triangles;
  const out: Record<string, number> = {};
  const located = Object.entries(groups).map(([g, pts]) => [
    g,
    pts.map(([cx, cy]) => {
      const X = cx + ox;
      const Y = cropToSpineY(cy, H) + oy;
      for (let t = 0; t < tri.length; t += 3) {
        const [i, j, l] = [tri[t], tri[t + 1], tri[t + 2]];
        const det = (s0[2 * j + 1] - s0[2 * l + 1]) * (s0[2 * i] - s0[2 * l]) + (s0[2 * l] - s0[2 * j]) * (s0[2 * i + 1] - s0[2 * l + 1]);
        const u = ((s0[2 * j + 1] - s0[2 * l + 1]) * (X - s0[2 * l]) + (s0[2 * l] - s0[2 * j]) * (Y - s0[2 * l + 1])) / det;
        const v = ((s0[2 * l + 1] - s0[2 * i + 1]) * (X - s0[2 * l]) + (s0[2 * i] - s0[2 * l]) * (Y - s0[2 * l + 1])) / det;
        if (u >= -1e-9 && v >= -1e-9 && 1 - u - v >= -1e-9) return { X, Y, i, j, l, u, v };
      }
      return null;
    }),
  ] as const);
  for (const [g, pts] of located) {
    let worst = pts.some((q) => q === null) ? Number.POSITIVE_INFINITY : 0;
    for (const f of frames) {
      const w = mesh(f).world;
      const b = boneOf(f);
      for (const q of pts) {
        if (q === null) continue;
        const x = q.u * w[2 * q.i] + q.v * w[2 * q.j] + (1 - q.u - q.v) * w[2 * q.l];
        const y = q.u * w[2 * q.i + 1] + q.v * w[2 * q.j + 1] + (1 - q.u - q.v) * w[2 * q.l + 1];
        const dx = q.X - b0.worldX;
        const dy = q.Y - b0.worldY;
        const det = b0.a * b0.d - b0.b * b0.c;
        const lx = (b0.d * dx - b0.b * dy) / det;
        const ly = (-b0.c * dx + b0.a * dy) / det;
        worst = Math.max(worst, Math.hypot(x - (b.worldX + b.a * lx + b.b * ly), y - (b.worldY + b.c * lx + b.d * ly)));
      }
    }
    out[g] = worst;
  }
  return out;
}

/** Pixel centres of a part's rectangle `[x, y, w, h]` (rig px, as `rects` holds them); `row` keeps one rig row only. */
function rectPixels(p: ProposeFixturePart, k: number, row?: number): Array<[number, number]> {
  const [x0, y0, w, h] = (p.rects ?? [[p.x, p.y, p.w, p.h]])[k];
  const out: Array<[number, number]> = [];
  for (let y = y0; y < y0 + h; y++) if (row === undefined || y === row) for (let x = x0; x < x0 + w; x++) out.push([x + 0.5, y + 0.5]);
  return out;
}

/** Issue #24: hanging strands on an accessory are found, noted, and given pendulum chains; the body they hang from stays on its bone. */
function runStrandCases(dir: string, say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const sdir = join(dir, 'strands');
  writeProposeFixture(sdir, STRAND_PARTS, STRAND_RIG, true);
  const P = readPartSet(sdir);
  const prop = propose(P);
  const again = serializeProposal(propose(readPartSet(sdir)));
  // Hand-derived from fixtures/propose.ts: strands at column centroids 7 and 92, rows 16..55, 5 wide;
  // each chain's links at the strand's top and 0.45 x 40 = 18 rows down, its tip on the last row.
  const wantNote = 'crown (head:headwear): 2 hanging strands at x=7,92, y 16-55,16-55, width 5,5 -> pendulum chains hairpin_strand0_, hairpin_strand1_';
  const chains = prop.bones.filter((b) => 'chain' in b).map((b) => JSON.stringify(b));
  const wantChains = [
    '{"chain":"hairpin_strand0_","parent":"hairpin","points":[[7,16],[7,34]],"tip":[7,55]}',
    '{"chain":"hairpin_strand1_","parent":"hairpin","points":[[92,16],[92,34]],"tip":[92,55]}',
  ];
  const strandTracks = prop.motion.tracks.filter((t) => 'chain' in t).map((t) => JSON.stringify(t));
  const wantTrack = (c: string): string => `{"chain":"${c}","amps":[4,7],"period":2,"phase":0.2,"lag":0.12}`;
  // The body: 100 px wide, rows 0..15 -> its mean row 7.5, which rounds to even 8; the hold segment spans it.
  const segs = JSON.stringify(prop.meshes.crown?.segments ?? null);
  const segsOk = segs.endsWith(',["hairpin",[0,8],[99,8]],"hairpin_strand0_","hairpin_strand1_"]');
  const loads = refusals(() => parseConfig(proposalConfig(STRAND_PARTS, prop)));
  say(
    'PR12_TWO_HANGING_STRANDS_ARE_NOTED_AND_EACH_GETS_A_PENDULUM_CHAIN',
    prop.notes.includes(wantNote) &&
      prop.notes.filter((n) => n.includes('hanging strand')).length === 1 &&
      chains.join('|') === wantChains.join('|') &&
      strandTracks.join('|') === [wantTrack('hairpin_strand0_'), wantTrack('hairpin_strand1_')].join('|') &&
      segsOk &&
      loads === null &&
      again === serializeProposal(prop),
    `notes ${JSON.stringify(prop.notes.filter((n) => n.includes('strand')))}; chains ${chains.join(' ')}; tracks ${strandTracks.join(' ')}; crown segments ${segs}; config loader ${codes(loads)}; two runs ${again === serializeProposal(prop) ? 'identical' : 'DIFFERENT'}`,
    "issue #24: a crown with two tassels got one fixed bone and no chain, with no note, and hung stiff until the columns were measured by hand; a strand is a sub-shape of the pendant rows at least 3x as tall as wide and 0.2 of the part, and each gets the reference tassel's chain and sway",
  );

  const bdir = join(dir, 'bare-crown');
  writeProposeFixture(bdir, BARE_CROWN_PARTS, STRAND_RIG, true);
  const bare = propose(readPartSet(bdir));
  const bareChains = bare.bones.filter((b) => 'chain' in b).map((b) => ('chain' in b ? b.chain : ''));
  say(
    'PR13_A_STRAND_FREE_CROWN_GETS_NO_STRAND_NOTE_AND_NO_CHAIN',
    bare.notes.every((n) => !n.includes('strand')) && bareChains.length === 0 && JSON.stringify(bare.meshes.crown?.segments) === '[["hairpin",[22,7],[0,7]],["hairpin",[99,-5],[22,25]]]',
    `notes ${JSON.stringify(bare.notes)}; chains [${bareChains.join(', ')}]; crown segments ${JSON.stringify(bare.meshes.crown?.segments)}`,
    "the positive control: the same crown without its tassels is 100 px wide in every row, so its only pendant row is its last and nothing in it is a strand — the reference's rigid bone and its two segments, unchanged",
  );

  // The proposal, pasted into a config as an agent would, through the rig and check stages.
  const cfg = join(sdir, 'config.json');
  writeFileSync(cfg, JSON.stringify(proposalConfig(STRAND_PARTS, prop)));
  const rig = runCli(['rig', '--config', cfg, '--parts', sdir, '--out', join(sdir, 'rig')]);
  const chk = runCli(['check', '--rig', join(sdir, 'rig'), '--parts', sdir, '--out', join(sdir, 'check')]);
  const crown = STRAND_PARTS.find((q) => q.name === 'crown') as ProposeFixturePart;
  const hairpin = prop.bones.find((b) => 'name' in b && b.name === 'hairpin');
  const at: [number, number] = hairpin !== undefined && 'name' in hairpin ? hairpin.at : [0, 0];
  const groups = { body: rectPixels(crown, 0), tips: [...rectPixels(crown, 1, 55), ...rectPixels(crown, 2, 55)] };
  const built = existsSync(join(sdir, 'check', 'build', 'skeleton.json')) ? offBone(join(sdir, 'check', 'build'), 'crown', 'hairpin', at, STRAND_RIG.h, groups) : null;
  // The mutant: the same proposal without the body-hold segment.
  const mdir = join(dir, 'strands-unheld');
  writeProposeFixture(mdir, STRAND_PARTS, STRAND_RIG, true);
  const unheld = proposalConfig(STRAND_PARTS, prop) as { meshes: Record<string, { segments: unknown[] }> } & Record<string, unknown>;
  unheld.meshes = { ...prop.meshes, crown: { ...prop.meshes.crown, segments: prop.meshes.crown.segments.filter((sg) => JSON.stringify(sg) !== '["hairpin",[0,8],[99,8]]') } };
  writeFileSync(join(mdir, 'config.json'), JSON.stringify(unheld));
  const mrig = runCli(['rig', '--config', join(mdir, 'config.json'), '--parts', mdir, '--out', join(mdir, 'rig')]);
  runCli(['check', '--rig', join(mdir, 'rig'), '--parts', mdir, '--out', join(mdir, 'check')]);
  const loose = existsSync(join(mdir, 'check', 'build', 'skeleton.json')) ? offBone(join(mdir, 'check', 'build'), 'crown', 'hairpin', at, STRAND_RIG.h, groups) : null;
  const f = (v: number | undefined): string => (v === undefined ? 'absent' : v.toFixed(3));
  say(
    'PR14_THE_STRAND_PROPOSAL_BUILDS_CHECKS_GREEN_AND_ONLY_THE_TASSELS_SWING',
    rig.status === 0 &&
      chk.status === 0 &&
      chk.out.includes('check: PASS') &&
      built !== null &&
      built.body < 1 &&
      built.tips > 2 &&
      mrig.status === 0 &&
      loose !== null &&
      loose.body >= 1 &&
      unheld.meshes.crown.segments.length === prop.meshes.crown.segments.length - 1,
    `rig exit ${rig.status}, check exit ${chk.status} (${chk.out.includes('check: PASS') ? 'PASS' : 'not PASS'}); over the idle at 60 fps the body's ${groups.body.length} pixels leave the hairpin bone by at most ${f(built?.body)} px (< 1 required) while the ${groups.tips.length} tassel-tip pixels swing ${f(built?.tips)} px (> 2 required); without the body-hold segment (rig exit ${mrig.status}) the body leaves it by ${f(loose?.body)} px (>= 1 required)`,
    'the body rides its bone and the tassels ride their chains: the offset is measured against the bone rather than the screen, because the head roll moves the whole crown and that is the head, not a swing; the mutant shows the hold segment is what keeps the body under the pixel',
  );

  const xdir = join(dir, 'strands-mixed');
  writeProposeFixture(xdir, MIXED_STRAND_PARTS);
  const X = propose(readPartSet(xdir));
  const want = [
    'veil (full:headwear): 1 hanging strand at x=20, y 120-159, width 5 -- no chain proposed (it rides the head as a region)',
    'crown (head:headwear): 2 hanging strands at x=52,151, y 20-79,20-79, width 5,19 -> pendulum chain hairpin_strand0_; no chain proposed at x=151 (a chain down it would run off the art)',
    'drops (full:earwear): 2 hanging strands at x=62,97, y 120-159,120-159, width 5,5 -> pendulum chains earring_strand0_, earring_strand1_',
  ];
  const got = X.notes.filter((n) => n.includes('hanging strand'));
  const xchains = X.bones.filter((b) => 'chain' in b).map((b) => JSON.stringify(b));
  const wantX = [
    '{"chain":"hairpin_strand0_","parent":"hairpin","points":[[52,20],[52,47]],"tip":[52,79]}',
    '{"chain":"earring_strand0_","parent":"head","points":[[62,120],[62,138]],"tip":[62,159]}',
    '{"chain":"earring_strand1_","parent":"head","points":[[97,120],[97,138]],"tip":[97,159]}',
  ];
  const xloads = refusals(() => parseConfig(proposalConfig(MIXED_STRAND_PARTS, X)));
  say(
    'PR15_A_STRAND_WITH_NO_CHAIN_IS_NOTED_AS_SUCH_ON_A_REGION_AN_OFF_ART_LINK_AND_AN_ALL_PENDANT_PART',
    got.join('|') === want.join('|') && xchains.join('|') === wantX.join('|') && X.regions.veil === 'head' && !('drops' in X.regions) && xloads === null,
    `notes ${JSON.stringify(got)}; chains ${xchains.join(' ')}; veil -> region ${X.regions.veil ?? 'none'}; config loader ${codes(xloads)}`,
    "the note is the issue's must: whenever a strand is found and gets no chain — a second layer riding the head, a chain that would leave the art, a Z-shaped strand's second link — it is said with the strand's figures, never left silent; an all-pendant earring hangs one chain per strand from the head, as its single chain did",
  );
}

/** Issue #35: a figure with no eyewhite gets no blink, one with no eyebrow a blink with no brows group — each said in a note, each a rig that builds. */
function runBlinkCases(dir: string, say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const edir = join(dir, 'no-eyes');
  writeProposeFixture(edir, NO_EYE_PARTS, STRAND_RIG, true);
  const E = readPartSet(edir);
  const eprop = propose(E);
  const eText = serializeProposal(eprop);
  const wantEyeNote = 'no blink: no eyewhite part (looked for: eyewhite-r, eyewhite-l), so the blink\'s eyes group would name no bone';
  const eLoads = refusals(() => checkProposal(E, eprop));
  say(
    'PR30_A_FIGURE_WITH_NO_EYEWHITE_GETS_NO_BLINK_AND_A_NOTE_NAMING_THE_TAGS_LOOKED_FOR',
    !('blink' in eprop.motion) && !eText.includes('"blink"') && eprop.notes.includes(wantEyeNote) && eprop.notes.filter((n) => n.includes('blink')).length === 1 && eLoads === null && eText === serializeProposal(propose(readPartSet(edir))),
    `motion keys ${JSON.stringify(Object.keys(eprop.motion))}; "blink" in proposal.json: ${eText.includes('"blink"')}; notes ${JSON.stringify(eprop.notes.filter((n) => n.includes('blink')))}; loads: ${codes(eLoads)}`,
    'issue #35: the proposal used to write eyes [] and brows [], the loader accepted it, and rigc refused one stage later (group "eyes" declares no members); only eyewhite-r/-l make the eye bones, so a figure with neither has nothing to blink and no blink is written — the field absent, not null — and the note says which tags were looked for',
  );

  const bdir = join(dir, 'no-brows');
  writeProposeFixture(bdir, NO_BROW_PARTS, STRAND_RIG, true);
  const Bp = readPartSet(bdir);
  const bprop = propose(Bp);
  const wantBrowNote = 'blink without brows: no eyebrow part (looked for: eyebrow-r, eyebrow-l), so the blink has no brows group and no brow_drop';
  const bLoads = refusals(() => checkProposal(Bp, bprop));
  say(
    'PR31_EYES_WITH_NO_EYEBROW_GET_A_BLINK_WITH_NO_BROWS_GROUP_AND_A_NOTE',
    JSON.stringify(bprop.motion.blink) === '{"t":2.3,"eyes":["eye_r","eye_l"],"squash":0.12}' && bprop.notes.includes(wantBrowNote) && bprop.notes.filter((n) => n.includes('blink')).length === 1 && bLoads === null,
    `blink ${JSON.stringify(bprop.motion.blink ?? null)}; notes ${JSON.stringify(bprop.notes.filter((n) => n.includes('blink')))}; loads: ${codes(bLoads)}`,
    'rigc refuses a group with no members, so an eyebrow-less figure gets the eyes half of the blink and neither brows nor the brow_drop that only brows read; the fixture\'s two eyewhites sit either side of the face centre, so both eye bones are made',
  );

  // Both proposals, pasted into a config as an agent would, through the rig stage (and check on the blink-less one).
  const ecfg = join(edir, 'config.json');
  writeFileSync(ecfg, JSON.stringify(proposalConfig(NO_EYE_PARTS, eprop)));
  const erig = runCli(['rig', '--config', ecfg, '--parts', edir, '--out', join(edir, 'rig')]);
  const echk = runCli(['check', '--rig', join(edir, 'rig'), '--parts', edir, '--out', join(edir, 'check')]);
  const emo = readJsonFile(join(edir, 'rig', 'motion.json'));
  const eTracks = JSON.stringify(emo === null ? null : (((emo.animations as Record<string, unknown>).idle as Record<string, unknown>).tracks as Array<Record<string, unknown>>).map((t) => t.group ?? null).filter((g) => g !== null));
  const skipLine = echk.out.split('\n').find((l) => l.includes('BLINK_NO_HOLE:')) ?? '';
  const bcfg = join(bdir, 'config.json');
  writeFileSync(bcfg, JSON.stringify(proposalConfig(NO_BROW_PARTS, bprop)));
  const brig = runCli(['rig', '--config', bcfg, '--parts', bdir, '--out', join(bdir, 'rig')]);
  const bmo = readJsonFile(join(bdir, 'rig', 'motion.json'));
  const bGroups = JSON.stringify(bmo?.groups ?? null);
  const bTracks = JSON.stringify(bmo === null ? null : (((bmo.animations as Record<string, unknown>).idle as Record<string, unknown>).tracks as Array<Record<string, unknown>>).filter((t) => t.group !== undefined).map((t) => `${String(t.group)}.${String(t.property)}`));
  say(
    'PR32_BOTH_PROPOSALS_RIG_GREEN_AND_CHECK_SKIPS_BLINK_NO_HOLE_BY_NAME_WHEN_THERE_IS_NO_EYE',
    erig.status === 0 &&
      JSON.stringify(emo?.groups ?? null) === '{}' &&
      eTracks === '[]' &&
      echk.status === 0 &&
      echk.out.includes('check: PASS') &&
      skipLine.trim() === 'BLINK_NO_HOLE: SKIP — no part comes from a See-through "eyewhite" layer, so there is no eye to look behind' &&
      brig.status === 0 &&
      bGroups === '{"eyes":["eye_r","eye_l"]}' &&
      bTracks === '["eyes.scaley"]',
    `no eyes: rig exit ${erig.status}, motion.json groups ${JSON.stringify(emo?.groups ?? null)}, group tracks ${eTracks}; check exit ${echk.status} (${echk.out.includes('check: PASS') ? 'PASS' : 'not PASS'}), "${skipLine.trim()}"; no brows: rig exit ${brig.status}, groups ${bGroups}, group tracks ${bTracks}`,
    'the loader and rigc now agree with the proposal: a blink-less idle has no blink group or track and gates green, and check does not pretend to have looked behind an eye that is not there — SKIP with its reason, never a pass',
  );

  runEyelessFeatureCases(dir, say);
}

/** Issue #45: irides and lashes on a side with no eyewhite ride head as regions, with the cause in a note — not a region on an eye bone nobody made. */
function runEyelessFeatureCases(dir: string, say: (name: string, ok: boolean, detail: string, why: string) => void): void {
  const idir = join(dir, 'iris-no-eyewhite');
  writeProposeFixture(idir, IRIS_NO_EYEWHITE_PARTS, STRAND_RIG, true);
  const I = readPartSet(idir);
  const iprop = propose(I);
  const wantNote = 'no eyewhite part for eye_r, eye_l (looked for: eyewhite-r, eyewhite-l): iris_a (head:irides-r), lash_b (head:eyelash-l) are placed on head as regions, rigid with the head and not blinking — an eye bone comes only from an eyewhite';
  const iLoads = refusals(() => checkProposal(I, iprop));
  const icfg = join(idir, 'config.json');
  writeFileSync(icfg, JSON.stringify(proposalConfig(IRIS_NO_EYEWHITE_PARTS, iprop)));
  const irig = runCli(['rig', '--config', icfg, '--parts', idir, '--out', join(idir, 'rig')]);
  const iBones = iprop.bones.map((b) => ('name' in b ? b.name : b.chain));
  // The mutant: the proposal as it was written before #45, both parts on the eye bones nobody made.
  const before = { ...iprop, regions: { ...iprop.regions, iris_a: 'eye_r', lash_b: 'eye_l' } };
  const beforeLoads = refusals(() => checkProposal(I, before));
  say(
    'PR40_AN_IRIS_AND_A_LASH_WITH_NO_EYEWHITE_RIDE_HEAD_WITH_THE_CAUSE_IN_A_NOTE',
    iprop.regions.iris_a === 'head' &&
      iprop.regions.lash_b === 'head' &&
      !iBones.includes('eye_r') &&
      !iBones.includes('eye_l') &&
      !('blink' in iprop.motion) &&
      iprop.notes.includes(wantNote) &&
      iLoads === null &&
      irig.status === 0 &&
      codes(beforeLoads) === 'CONFIG_NAME_RESOLVES config.regions.iris_a; CONFIG_NAME_RESOLVES config.regions.lash_b' &&
      serializeProposal(iprop) === serializeProposal(propose(readPartSet(idir))),
    `regions iris_a -> ${iprop.regions.iris_a}, lash_b -> ${iprop.regions.lash_b}; eye bones ${JSON.stringify(iBones.filter((b) => b.startsWith('eye')))}; notes ${JSON.stringify(iprop.notes.filter((n) => n.includes('eyewhite')))}; loads: ${codes(iLoads)}; rig exit ${irig.status}; the pre-#45 regions (eye_r, eye_l) -> ${codes(beforeLoads)}`,
    'issue #45: the proposer wrote the iris and the lash onto eye_r / eye_l, which only an eyewhite makes, and the loader refused the symptom (config.regions.iris_a — is "eye_r"); head is the bone the eye bone would hang from and the one the face already rides, so nothing is invented, the proposal still loads and rigs green, and the note names the cause and the tags looked for',
  );

  const odir = join(dir, 'one-eyewhite');
  writeProposeFixture(odir, ONE_EYEWHITE_PARTS, STRAND_RIG, true);
  const O = readPartSet(odir);
  const oprop = propose(O);
  const wantOne = 'no eyewhite part for eye_l (looked for: eyewhite-l): lash_b (head:eyelash-l) is placed on head as a region, rigid with the head and not blinking — an eye bone comes only from an eyewhite';
  const oLoads = refusals(() => checkProposal(O, oprop));
  const ocfg = join(odir, 'config.json');
  writeFileSync(ocfg, JSON.stringify(proposalConfig(ONE_EYEWHITE_PARTS, oprop)));
  const orig = runCli(['rig', '--config', ocfg, '--parts', odir, '--out', join(odir, 'rig')]);
  say(
    'PR41_WITH_ONE_EYEWHITE_ITS_IRIS_RIDES_THE_EYE_BONE_AND_THE_OTHER_SIDES_LASH_RIDES_HEAD',
    oprop.regions.eye_a === 'eye_r' &&
      oprop.regions.iris_a === 'eye_r' &&
      oprop.regions.lash_b === 'head' &&
      JSON.stringify(oprop.motion.blink?.eyes ?? null) === '["eye_r"]' &&
      oprop.notes.includes(wantOne) &&
      oprop.notes.filter((n) => n.includes('no eyewhite part')).length === 1 &&
      oLoads === null &&
      orig.status === 0,
    `regions eye_a -> ${oprop.regions.eye_a}, iris_a -> ${oprop.regions.iris_a}, lash_b -> ${oprop.regions.lash_b}; blink eyes ${JSON.stringify(oprop.motion.blink?.eyes ?? null)}; notes ${JSON.stringify(oprop.notes.filter((n) => n.includes('eyewhite')))}; loads: ${codes(oLoads)}; rig exit ${orig.status}`,
    'the rule is per side: the eye bone the right eyewhite makes still carries its iris and blinks, and only the side with no eyewhite falls back to head, named in the note with only that side\'s tag',
  );
}

/**
 * The public examples, where they have been fetched: `examples/<key>/` tracks
 * `config.json` and `proposal.json` (the reference proposer's output), and
 * `bun run fetch-examples` puts `inputs/painting.png` and the See-through
 * layer sets `inputs/layers/{full,head}` beside them. The proposal itself is
 * compared by the chain suite, which proposes from the parts its own build
 * assembled (`CH06`).
 */
function exampleDirs(): string[] {
  const root = join(ROOT, 'examples');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((n) => join(root, n))
    .filter((d) => existsSync(join(d, 'config.json')) && existsSync(join(d, 'inputs', 'painting.png')) && existsSync(join(d, 'inputs', 'layers', 'full')));
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

const CHECK_KEYS = ['gate_spine_html_green', 'rigc_entry', 'pack_mode', 'loop_max_diff', 'seam_mean', 'seam_px_over_40', 'seam_px_over_80', ...JUDGEMENT_LINES, ...REPORTED_LINES, 'PASS'];

/** A judgement line's status in a check.json read back, or null. */
function lineStatus(fig: Record<string, unknown> | null, name: string): string | null {
  const l = fig?.[name];
  return typeof l === 'object' && l !== null && 'status' in l ? String((l as { status: unknown }).status) : null;
}

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
    const outputs = ['gate_spine-html.txt', 'contact.png', 'motion_heat.png', 'check.json', 'build/skeleton.json', 'build/skeleton.atlas', 'build/skeleton.png', 'idle_frames/frames.json', 'idle_frames/idle/f0000.png'];
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
        !existsSync(join(out, '_still')) &&
        !existsSync(join(out, '_isolated')) &&
        JUDGEMENT_LINES.every((n) => lineStatus(fig, n) === 'SKIP' && ok.out.includes(`  ${n}: SKIP — `)) &&
        lineStatus(fig, 'RECOMPOSITE_HOLES') === 'SKIP' &&
        ok.out.includes('  RECOMPOSITE_HOLES: SKIP — parts.json has no "recomposite" block'),
      `exit ${ok.status}; check.json ${fig === null ? 'absent' : JSON.stringify(fig).slice(0, 220)}…; judgement lines ${JUDGEMENT_LINES.map((n) => `${n} ${lineStatus(fig, n) ?? 'absent'}`).join(', ')}; RECOMPOSITE_HOLES ${lineStatus(fig, 'RECOMPOSITE_HOLES') ?? 'absent'}; missing outputs: ${missing.join(', ') || 'none'}; pack ${pack.map((p) => p.line).join(' | ') || 'none'} for ${CHECK_PARTS.length} part(s); --rig ${listing(rig).join('|') === before.join('|') ? 'unchanged' : 'CHANGED'}`,
      "the positive control: a two-part, one-bone rig with a closed idle and an exact stack must come back green from the spine-html gate, with the reference's check.json keys in its order (gate_spine_green gone with the second gate, rigc_entry after the gate, pack_mode after it) and the six judgement lines and the reported line between the seam and PASS, the packed page as the build, and nothing written into the input; its two parts are both topwear, so every judgement line has nothing to read (and neither part is a mesh, so neither has TEXTURE_STRETCH) and must say SKIP, by name, with its reason — never PASS — and its hand-written parts.json has no recomposite block, so RECOMPOSITE_HOLES says SKIP too",
    );

    const again = runCli(['check', '--rig', rig, '--out', join(dir, 'out2')]);
    const same = ['check.json', 'motion_heat.png', 'gate_spine-html.txt', 'build/skeleton.json', 'build/skeleton.png'].filter(
      (f) => existsSync(join(out, f)) && existsSync(join(dir, 'out2', f)) && Buffer.compare(readFileSync(join(out, f)), readFileSync(join(dir, 'out2', f))) === 0,
    );
    say(
      'CK02_TWO_RUNS_WRITE_THE_SAME_BYTES',
      again.status === 0 && same.length === 5,
      `second run exit ${again.status}; ${same.length} of 5 outputs byte-identical (${same.join(', ')})`,
      'determinism is a contract: the same rig must write the same check.json, heat map and gate file, or no diff of them means anything',
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
      'the gate cannot see a loop that jumps — it passes it — so the loop check is the only thing between that idle and a README; the setup pose is unchanged, so the seam must stay quiet',
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
      'parts/ is what the seam composites and images/ is what rigc draws; a part moved 3 px in one and not the other is the drift an assembler bug produces, and the gate passes it',
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

    // The judgement lines (issue #11): each one's bar made to fire on the fixture, by name.
    const judged = (label: string, opts: Parameters<typeof writeCheckRig>[1]): { status: number; out: string; fig: Record<string, unknown> | null } => {
      const r = join(dir, label);
      writeCheckRig(r, opts);
      const res = runCli(['check', '--rig', r, '--out', join(dir, `${label}-out`)]);
      return { ...res, fig: readJsonFile(join(dir, `${label}-out`, 'check.json')) };
    };
    const lineOf = (o: string, name: string): string => o.split('\n').find((l) => l.startsWith(`  ${name}: `))?.trim() ?? `no ${name} line`;
    const still = judged('breath-still', { from: ['full:topwear', 'full:footwear'], peak: 0 });
    const stillFail = failLine(still.out, 'CHECK_BREATH_VISIBLE');
    say(
      'CK09_A_TORSO_THE_IDLE_DOES_NOT_MOVE_FAILS_BREATH_VISIBLE_BY_NAME',
      still.status === 1 && lineStatus(still.fig, 'BREATH_VISIBLE') === 'FAIL' && stillFail !== null && stillFail.includes('torso') && stillFail.includes('heat mean 0/255') && failLine(still.out, 'CHECK_LOOP_CLOSES') === null,
      `exit ${still.status}; ${lineOf(still.out, 'BREATH_VISIBLE')}; ${stillFail?.trim() ?? 'no CHECK_BREATH_VISIBLE line'}`,
      'a zero-amplitude breath is a closed loop and an exact seam — the gate and both old bars pass it — so the torso rendered alone is the only thing that sees it does not breathe',
    );
    const walk = judged('breath-feet', { from: ['full:topwear', 'full:footwear'] });
    const feetFail = walk.out.split('\n').filter((l) => l.startsWith('  FAIL  CHECK_BREATH_VISIBLE') && l.includes('feet'));
    const darkFail = failLine(walk.out, 'CHECK_STILL_REGIONS_DARK');
    say(
      'CK10_FEET_ON_A_KEYED_BONE_FAIL_BREATH_VISIBLE_AND_STILL_REGIONS_DARK',
      walk.status === 1 && feetFail.length === 1 && lineStatus(walk.fig, 'BREATH_VISIBLE') === 'FAIL' && lineStatus(walk.fig, 'STILL_REGIONS_DARK') === 'FAIL' && darkFail !== null && darkFail.includes('feet region'),
      `exit ${walk.status}; ${feetFail[0]?.trim() ?? 'no feet CHECK_BREATH_VISIBLE line'}; ${darkFail?.trim().slice(0, 160) ?? 'no CHECK_STILL_REGIONS_DARK line'}…`,
      'the fixture\'s footwear part rides the root the idle slides: rendered alone it moves (the feet half of the breath line, bar 0) and in the heat map it is lit (the still-region line), and neither gate can tell',
    );
    const slide = judged('tip-slide', { from: ['head:face', 'full:handwear-r'], peak: 8 });
    const tipFail = failLine(slide.out, 'CHECK_TIP_OVER_ROOT');
    say(
      'CK11_A_SLEEVE_THAT_SLIDES_WHOLE_FAILS_TIP_OVER_ROOT',
      slide.status === 1 && tipFail !== null && /ratio 1\b/.test(tipFail),
      `exit ${slide.status}; ${tipFail?.trim() ?? 'no CHECK_TIP_OVER_ROOT line'}`,
      'a sleeve translated whole has its tip travel exactly as far as its root — the swing a chain is for is absent',
    );

    // STILL_REGIONS_DARK's face half in the head's own frame (issue #33).
    type FaceHalf = { head_bone?: string; screen_heat_mean?: number; head_frame_heat_mean?: number; resampler_heat_mean?: number; mean_ceiling?: number; unmeasured?: string };
    const faceOf = (fig: Record<string, unknown> | null): FaceHalf => ((fig?.STILL_REGIONS_DARK as { face?: FaceHalf } | undefined)?.face ?? {});
    const n = (v: number | undefined): number => v ?? NaN;
    const roll = judged('face-roll', { from: ['head:face', 'head:mouth'], peak: 0, head: { roll: 2 } });
    const rf = faceOf(roll.fig);
    say(
      'CK40_A_RIGID_FACE_ON_A_ROLLING_HEAD_IS_STILL_IN_THE_HEAD_FRAME_WHILE_THE_SCREEN_SEES_THE_ROLL',
      roll.status === 0 &&
        lineStatus(roll.fig, 'STILL_REGIONS_DARK') === 'PASS' &&
        rf.head_bone === 'head' &&
        n(rf.head_frame_heat_mean) <= n(rf.mean_ceiling) &&
        Math.abs(n(rf.mean_ceiling) - STILL_FACE_RESAMPLER_MARGIN * n(rf.resampler_heat_mean)) <= 0.0005 * (STILL_FACE_RESAMPLER_MARGIN + 1) &&
        n(rf.screen_heat_mean) > n(rf.mean_ceiling) &&
        n(rf.head_frame_heat_mean) < n(rf.screen_heat_mean),
      `exit ${roll.status}; ${lineOf(roll.out, 'STILL_REGIONS_DARK').slice(0, 330)}`,
      "both parts ride `head`, whose control bone the idle rolls 2 degrees each way: the roll lights the face in screen space (above the bar there), and carried back into the head's frame what is left is the resampler's error — the calibration moves the whole rig rigidly as the head moves, so here the two are the same motion",
    );
    const RETIRED_SCREEN_CEILING = 33.976;
    const slid = judged('face-slide', { from: ['head:face', 'head:mouth'], peak: 0, head: { roll: 0, slide: 2 } });
    const sf2 = faceOf(slid.fig);
    const slidFail = failLine(slid.out, 'CHECK_STILL_REGIONS_DARK');
    say(
      'CK41_A_FACE_SLIDING_TWO_PIXELS_ON_ITS_HEAD_FAILS_IN_THE_HEAD_FRAME_WHERE_THE_SCREEN_BAR_PASSED_IT',
      slid.status === 1 &&
        lineStatus(slid.fig, 'STILL_REGIONS_DARK') === 'FAIL' &&
        slidFail !== null &&
        slidFail.includes('face region') &&
        slidFail.includes('in the frame of its bone "head"') &&
        slidFail.includes(`heat mean ${sf2.head_frame_heat_mean}/255`) &&
        slidFail.includes(`<= ${sf2.mean_ceiling} is required`) &&
        n(sf2.head_frame_heat_mean) > n(sf2.mean_ceiling) &&
        n(sf2.screen_heat_mean) <= RETIRED_SCREEN_CEILING,
      `exit ${slid.status}; screen ${sf2.screen_heat_mean} (the retired screen-space ceiling ${RETIRED_SCREEN_CEILING} passes it); ${slidFail?.trim().slice(0, 300) ?? 'no CHECK_STILL_REGIONS_DARK line'}…`,
      "the face is a mesh weighted wholly to a bone under `head` that the idle slides 2 rig px while its slot rides `head` itself: the motion the line exists for — something on the face the head does not carry — which the screen-space bar this line held until issue #33 let through",
    );
    const both = judged('face-roll-slide', { from: ['head:face', 'head:mouth'], peak: 0, head: { roll: 2, slide: 2 } });
    const bf = faceOf(both.fig);
    say(
      'CK42_THE_SAME_SLIDE_ON_A_ROLLING_HEAD_IS_RED_ABOVE_THE_ROLLS_OWN_RESAMPLER_ERROR',
      both.status === 1 && lineStatus(both.fig, 'STILL_REGIONS_DARK') === 'FAIL' && n(bf.head_frame_heat_mean) > n(bf.mean_ceiling) && n(bf.resampler_heat_mean) > 0 && n(bf.resampler_heat_mean) === n(rf.resampler_heat_mean),
      `exit ${both.status}; ${lineOf(both.out, 'STILL_REGIONS_DARK').slice(0, 330)}`,
      "the roll puts a resampler error under the bar (CK40's, the same rig moved the same way, since the calibration drops every key but the head's motion — the slide included); the slide still stands out of it",
    );
    const sfo = faceOf(slide.fig);
    say(
      'CK43_A_FACE_THAT_MOVES_WITH_THE_BONE_ITS_SLOT_RIDES_IS_STILL_IN_THAT_FRAME',
      lineStatus(slide.fig, 'STILL_REGIONS_DARK') === 'PASS' && sfo.head_bone === 'root' && n(sfo.head_frame_heat_mean) <= n(sfo.mean_ceiling) && n(sfo.screen_heat_mean) > RETIRED_SCREEN_CEILING && failLine(slide.out, 'CHECK_STILL_REGIONS_DARK') === null,
      `${lineOf(slide.out, 'STILL_REGIONS_DARK').slice(0, 330)}`,
      "CK11's rig: the face rides the root the idle slides 8 px. Its head bone is the bone its slot rides, so the whole face moving with it is the head moving, which the line does not judge — the screen-space figure (over the retired ceiling) is reported beside it, and the root's motion is the feet half's to see",
    );
    const twoBones = judged('face-two-bones', { from: ['head:face', 'head:face'], peak: 0, blinkSquash: 0.5 });
    const tb = lineOf(twoBones.out, 'STILL_REGIONS_DARK');
    say(
      'CK44_A_FACE_WITH_NO_ONE_HEAD_BONE_LEAVES_THE_FACE_UNMEASURED_AND_THE_LINE_SAYS_SKIP',
      lineStatus(twoBones.fig, 'STILL_REGIONS_DARK') === 'SKIP' && tb.includes('face: no head bone to measure it in: the face parts ride "back" on "root", "front" on "eye"'),
      tb.slice(0, 300),
      "the head frame is one bone's; face parts on two bones have none, and no bone is picked for them — the face half says so, and with no feet either the line is a SKIP, never a pass",
    );
    const shut = judged('blink-hole', { from: ['head:face', 'head:eyewhite-r'], peak: 0, blinkSquash: 0.1 });
    const holeFail = failLine(shut.out, 'CHECK_BLINK_NO_HOLE');
    const holeFig = shut.fig?.BLINK_NO_HOLE as { hole_px?: number; idle_frames_closed?: number[] } | undefined;
    say(
      'CK12_A_SHUT_EYE_OVER_NOTHING_FAILS_BLINK_NO_HOLE_WITH_THE_COUNT_AND_THE_FRAMES',
      shut.status === 1 && holeFail !== null && holeFig !== undefined && (holeFig.hole_px ?? 0) > 0 && holeFail.includes(`${holeFig.hole_px} px show the background`) && JSON.stringify(holeFig.idle_frames_closed) === '[6,7]',
      `exit ${shut.status}; ${holeFail?.trim() ?? 'no CHECK_BLINK_NO_HOLE line'}; idle frames closed ${JSON.stringify(holeFig?.idle_frames_closed)}`,
      'the eye part reaches past the face on one side, so squashing it shows the page there; the blink holds 0.5 s to 0.6 s, which at 12 fps is frames 6 and 7 (0.5 and 0.583 s)',
    );

    // The geometry the face half reads: absent is a reason, disagreeing with its frames is a refusal, and the head bone is read off the slots.
    const geoSet = join(dir, 'geo-planted');
    cpSync(join(dir, 'face-roll-out', 'idle_frames'), geoSet, { recursive: true });
    const geoPath = join(geoSet, 'idle', 'geometry.json');
    const geoText = existsSync(geoPath) ? readFileSync(geoPath, 'utf8') : '{}';
    const clean = readBoneTrack(readFrameSet(geoSet), 'head');
    const geo = JSON.parse(geoText) as { viewport: { scale: number }; frames: Array<{ bones: Array<{ name: string }> }> };
    geo.viewport.scale *= 2;
    writeFileSync(geoPath, JSON.stringify(geo));
    const wrongGrid = refusals(() => readBoneTrack(readFrameSet(geoSet), 'head'));
    geo.viewport.scale /= 2;
    geo.frames[3].bones = geo.frames[3].bones.filter((b) => b.name !== 'head');
    writeFileSync(geoPath, JSON.stringify(geo));
    const noBone = refusals(() => readBoneTrack(readFrameSet(geoSet), 'head'));
    rmSync(geoPath);
    const noGeometry = readBoneTrack(readFrameSet(geoSet), 'head');
    const oneBone = headBoneOf({ rig: { slots: [{ name: 'a', bone: 'skull' }, { name: 'b', bone: 'skull' }] }, parts: { rig_size: [4, 4], scale_rig_per_source: 1, parts: [{ name: 'a', from: 'head:face' }, { name: 'b', from: 'full:topwear' }], ghost_px: {} } as unknown as PartsFile });
    say(
      'CK45_THE_HEAD_TRACK_IS_READ_OFF_GEOMETRY_JSON_AND_A_FILE_THAT_DISAGREES_WITH_ITS_FRAMES_IS_REFUSED_BY_NAME',
      typeof clean === 'object' &&
        clean.frames.length === readFrameSet(geoSet).frames.length &&
        (wrongGrid?.problems.length === 1 && wrongGrid.problems[0].code === 'CHECK_GEOMETRY_FILE') &&
        (wrongGrid?.problems[0].detail.includes('viewport scale') ?? false) &&
        (noBone?.problems.length === 1 && noBone.problems[0].code === 'CHECK_GEOMETRY_FILE') &&
        (noBone?.problems[0].detail.includes('frame 3 has no bone "head"') ?? false) &&
        typeof noGeometry === 'string' &&
        noGeometry.includes('geometry.json does not exist') &&
        'bone' in oneBone &&
        oneBone.bone === 'skull',
      `clean: ${typeof clean === 'string' ? clean : `${clean.frames.length} frame(s) of "${clean.bone}"`}; viewport doubled: ${wrongGrid?.problems[0].detail.slice(0, 110) ?? 'read'}; bone dropped from frame 3: ${noBone?.problems[0].detail ?? 'read'}; file removed: ${typeof noGeometry === 'string' ? noGeometry.slice(-90) : 'read'}; head bone from the face's slot: ${JSON.stringify(oneBone)}`,
      "the head's transform comes from rigc's geometry.json beside the frames; one on another grid would carry the face onto the wrong pixels, and a frame without the bone would leave a hole in the track — each is a refusal naming the field, while no file at all leaves the face half unmeasured with the reason; the head bone is the bone the face part's slot rides (a slot named nothing like a head), never a name",
    );

    // RECOMPOSITE_HOLES (issue #25): a parts.json that records a large hole must be reported, and must not fail a rig that is otherwise green.
    const holed = join(dir, 'holed');
    const holeBlock = {
      mean_abs: 3.5,
      within_limit: 8,
      within_share: 0.9,
      error_limit: 40,
      error_px: 900,
      covered_alpha: 128,
      uncovered_error_px: 700,
      hole_count: 2,
      holes_listed: 5,
      holes: [
        { px: 600, x: 30, y: 40, w: 18, h: 40, borders: [{ part: 'back', px: 40 }] },
        { px: 100, x: 0, y: 0, w: 4, h: 25, borders: [] },
      ],
    };
    writeCheckRig(holed, { recomposite: holeBlock });
    const hr = runCli(['check', '--rig', holed, '--out', join(dir, 'holed-out')]);
    const hf = readJsonFile(join(dir, 'holed-out', 'check.json'));
    const hl = hf?.RECOMPOSITE_HOLES as Record<string, unknown> | undefined;
    const printed = hr.out.split('\n').find((l) => l.startsWith('  RECOMPOSITE_HOLES: ')) ?? null;
    say(
      'CK15_A_RECORDED_HOLE_IS_REPORTED_IN_CHECK_JSON_AND_DOES_NOT_FAIL_THE_CHECK',
      hr.status === 0 &&
        hf?.PASS === true &&
        hr.out.includes('check: PASS') &&
        !hr.out.includes('FAIL  CHECK_RECOMPOSITE') &&
        hl !== undefined &&
        JSON.stringify(hl) === JSON.stringify({ status: 'REPORTED', error_px: 900, uncovered_error_px: 700, hole_count: 2, largest: { px: 600, box: '30,40 18x40', borders: ['back 40 px'] } }) &&
        printed === '  RECOMPOSITE_HOLES: REPORTED — error_px 900; uncovered_error_px 700; hole_count 2; largest px 600, box 30,40 18x40, borders back 40 px',
      `exit ${hr.status}, PASS ${String(hf?.PASS)}; check.json RECOMPOSITE_HOLES ${JSON.stringify(hl)}; console ${printed?.trim() ?? 'no RECOMPOSITE_HOLES line'}`,
      "the hole class the seam cannot see — a pixel no part holds is missing from the setup pose and from the flat stack alike — reaches check.json from parts.json's recomposite block, figure for figure, as a line with no bar: 600 px of hole leaves a green rig green",
    );

    // TEXTURE_STRETCH (issue #31): a mesh the idle stretches by a hand-computed ratio, the same geometry forged, the no-mesh and no-file SKIPs, the version gate.
    const stretchRun = (label: string, by: number): { status: number; out: string; fig: Record<string, unknown> | null; geo: string } => {
      const r = join(dir, label);
      writeCheckRig(r, { stretchMesh: by });
      const res = runCli(['check', '--rig', r, '--out', join(dir, `${label}-out`)]);
      return { ...res, fig: readJsonFile(join(dir, `${label}-out`, 'check.json')), geo: join(dir, `${label}-out`, 'idle_frames', 'idle', GEOMETRY_FILE) };
    };
    type StretchFig = { status?: string; severity?: number; max_ratio?: number; min_ratio?: number; frames?: number; worst?: { slot: string; triangle: number; vertices: number[]; edge: number[]; frame: number; ratio: number } };
    const rest = CHECK_PARTS[0].h;
    const stretchBy = 8;
    const mild = stretchRun('stretch-mild', stretchBy);
    const mf = mild.fig?.TEXTURE_STRETCH as StretchFig | undefined;
    const want = Number(((rest + stretchBy) / rest).toFixed(3));
    say(
      'CK30_A_MESH_THE_IDLE_STRETCHES_READS_THE_HAND_COMPUTED_RATIO_ON_THE_NAMED_TRIANGLE_AND_FRAME',
      mild.status === 0 &&
        mild.fig?.PASS === true &&
        mf?.status === 'PASS' &&
        mf.severity === want &&
        mf.max_ratio === want &&
        mf.min_ratio === 1 &&
        mf.frames === IDLE_FPS + 1 &&
        JSON.stringify(mf.worst) === JSON.stringify({ slot: CHECK_PARTS[0].name, triangle: 0, vertices: [0, 1, 2], edge: [1, 2], frame: IDLE_FPS / 2, ratio: want }) &&
        existsSync(mild.geo) &&
        mild.out.includes(`  TEXTURE_STRETCH: PASS — `),
      `exit ${mild.status}; ${lineOf(mild.out, 'TEXTURE_STRETCH').slice(0, 260)}…; geometry.json ${existsSync(mild.geo) ? 'written' : 'ABSENT'}`,
      `the positive control through the real render: the fixture's back part is a four-vertex mesh whose bottom edge the idle lowers ${stretchBy} units at t = 0.5 s, so its ${rest}-unit sides read (${rest} + ${stretchBy}) / ${rest} = ${want} at frame ${IDLE_FPS / 2} of ${IDLE_FPS + 1}, on triangle 0 (vertices 0 1 2, edge 1-2) — the first of the two that tie — and no edge ever shortens`,
    );

    // The same file forged: frame 3 put back at rest, then vertex 1 moved along edge 0-1 by its own length — that edge doubles, 1-2 grows to sqrt(w^2 + h^2)/h, and triangle 1 (2 3 0) does not hold vertex 1.
    const forgedGeo = join(dir, 'forged-geometry.json');
    let forgeNote = 'CK30 wrote no geometry.json to forge';
    let forgedLine: Record<string, unknown> | null = null;
    const forgedProblems: Problem[] = [];
    if (existsSync(mild.geo)) {
      const g = JSON.parse(readFileSync(mild.geo, 'utf8')) as { rest: Array<{ slot: string; kind: string; vertices: number[] }>; frames: Array<{ index: number; attachments: Array<{ slot: string; vertices: number[] }> }> };
      const r0 = g.rest.find((r) => r.slot === CHECK_PARTS[0].name && r.kind === 'mesh');
      const f3 = g.frames.find((f) => f.index === 3)?.attachments.find((a) => a.slot === CHECK_PARTS[0].name);
      if (r0 !== undefined && f3 !== undefined) {
        const v = [...r0.vertices];
        v[2] = v[2] + (v[2] - v[0]);
        v[3] = v[3] + (v[3] - v[1]);
        f3.vertices = v;
        writeFileSync(forgedGeo, JSON.stringify(g));
        forgedLine = stretchLine(readGeometry(forgedGeo, g.frames.length), forgedGeo, forgedProblems) as Record<string, unknown>;
        forgeNote = `${JSON.stringify(forgedLine.worst)}; ${forgedProblems.map((p) => `FAIL  ${p.code}: ${p.object} — ${p.detail.slice(0, 80)}`).join(' | ') || 'no problem'}`;
      }
    }
    say(
      'CK31_A_FORGED_GEOMETRY_WITH_ONE_EDGE_DOUBLED_FAILS_NAMING_THE_SLOT_TRIANGLE_EDGE_AND_FRAME',
      forgedLine !== null &&
        forgedLine.status === 'FAIL' &&
        forgedLine.severity === 2 &&
        forgedProblems.length === 1 &&
        forgedProblems[0].code === 'CHECK_TEXTURE_STRETCH' &&
        forgedProblems[0].object === `mesh "${CHECK_PARTS[0].name}" triangle 0 (vertices 0 1 2), edge 0-1, idle frame 3` &&
        forgedProblems[0].detail.startsWith(`the edge is 2 times its rest length (max(ratio, 1/ratio) 2); <= ${TEXTURE_STRETCH_CEILING} is required`),
      forgeNote,
      "the brief's mutant: the frame the stretch is forged into is not the one the idle itself stretches most (6), so a line that named the idle's own worst, or the frame of the file's last change, would name the wrong one",
    );

    const hard = stretchRun('stretch-hard', rest);
    const hardFail = failLine(hard.out, 'CHECK_TEXTURE_STRETCH');
    const others = hard.out.split('\n').filter((l) => l.startsWith('  FAIL  ') && !l.startsWith('  FAIL  CHECK_TEXTURE_STRETCH'));
    say(
      'CK32_A_MESH_THE_IDLE_STRETCHES_TO_TWICE_ITS_LENGTH_FAILS_THE_CHECK_END_TO_END_AND_NOTHING_ELSE_DOES',
      hard.status === 1 &&
        hard.fig?.PASS === false &&
        lineStatus(hard.fig, 'TEXTURE_STRETCH') === 'FAIL' &&
        hardFail === `  FAIL  CHECK_TEXTURE_STRETCH: mesh "${CHECK_PARTS[0].name}" triangle 0 (vertices 0 1 2), edge 1-2, idle frame ${IDLE_FPS / 2} — the edge is 2 times its rest length (max(ratio, 1/ratio) 2); <= ${TEXTURE_STRETCH_CEILING} is required — the texture on it is stretched: the bones this mesh is weighted to move apart (amplitudes too large down a chain), or a vertex blends bones that move against each other` &&
        others.length === 0,
      `exit ${hard.status}; ${hardFail?.trim().slice(0, 200) ?? 'no CHECK_TEXTURE_STRETCH line'}…; other FAIL lines: ${others.length}`,
      `the side lowered by its own length (${rest} units) doubles; the gate passes it, the loop closes and the seam is the setup pose, so this line is the only one that sees it`,
    );

    const stretchAgain = stretchRun('stretch-mild-2', stretchBy);
    const sameGeo = existsSync(mild.geo) && existsSync(stretchAgain.geo) && Buffer.compare(readFileSync(mild.geo), readFileSync(stretchAgain.geo)) === 0;
    const sameCheck = mild.fig !== null && stretchAgain.fig !== null && JSON.stringify(mild.fig) === JSON.stringify(stretchAgain.fig);
    say(
      'CK33_TWO_RUNS_ON_A_STRETCHED_MESH_WRITE_THE_SAME_GEOMETRY_AND_THE_SAME_TEXTURE_STRETCH',
      stretchAgain.status === 0 && sameGeo && sameCheck,
      `second run exit ${stretchAgain.status}; geometry.json ${sameGeo ? 'byte-identical' : 'DIFFERS'}; check.json ${sameCheck ? 'identical' : 'DIFFERS'} (TEXTURE_STRETCH ${JSON.stringify((stretchAgain.fig?.TEXTURE_STRETCH as StretchFig | undefined)?.worst ?? null)})`,
      "CK02 compares two runs of the fixture with no mesh, where this line is a SKIP; determinism of a figure has to be shown where there is a figure",
    );

    const noMesh = fig?.TEXTURE_STRETCH as { status?: string; reason?: string } | undefined;
    const absentPath = join(dir, 'no-such-dir', GEOMETRY_FILE);
    const absent = stretchLine(readGeometry(absentPath, 1), absentPath, []);
    say(
      'CK34_TEXTURE_STRETCH_SKIPS_BY_NAME_ON_A_RIG_WITH_NO_MESH_AND_ON_A_MISSING_GEOMETRY_FILE',
      noMesh?.status === 'SKIP' &&
        noMesh.reason === 'the rig draws no mesh attachment (every slot is a region), so there is no triangle to stretch' &&
        ok.out.includes('  TEXTURE_STRETCH: SKIP — the rig draws no mesh attachment') &&
        absent.status === 'SKIP' &&
        absent.reason.startsWith(`${absentPath} does not exist; \`rigc render --geometry\` (spine-rigc ${RIGC_GEOMETRY_VERSION} or later) writes it`),
      `CK01's two-region fixture: ${noMesh?.status} — ${noMesh?.reason}; no file: ${absent.status} — ${'reason' in absent ? String(absent.reason).slice(0, 120) : ''}`,
      'a rig with nothing to stretch is unmeasured, not certified, and says which of the two reasons it is',
    );

    const calls: string[] = [];
    const oldRigc: RigcRunner = (args) => {
      calls.push(args.join(' '));
      return args[0] === '--version' ? { status: 0, out: '1.3.0\n' } : { status: 1, out: 'this stub builds nothing' };
    };
    const old = refusals(() => runCheck(rig, join(dir, 'old-rigc-out'), oldRigc));
    const accepts = (out: string): boolean => refusals(() => requireRigcVersion(() => ({ status: 0, out }))) === null;
    say(
      'CK35_A_RIGC_BELOW_THE_GEOMETRY_VERSION_IS_REFUSED_BY_VERSION_BEFORE_ANYTHING_IS_BUILT',
      old !== null &&
        old.problems.length === 1 &&
        old.problems[0].code === 'CHECK_RIGC_VERSION' &&
        old.problems[0].detail.startsWith(`is 1.3.0; spine-rigc ${RIGC_GEOMETRY_VERSION} or later is required`) &&
        calls.join('|') === '--version' &&
        !existsSync(join(dir, 'old-rigc-out', 'build')) &&
        accepts(`${RIGC_GEOMETRY_VERSION}\n`) &&
        accepts('1.10.0\n') &&
        accepts('2.0.0\n') &&
        !accepts('1.3.9\n') &&
        !accepts('not a version\n'),
      `a stub printing 1.3.0: ${codes(old)} — ${old?.problems[0].detail.slice(0, 90) ?? ''}…; rigc calls ${JSON.stringify(calls)}; accepted 1.4.0 ${accepts('1.4.0\n')}, 1.10.0 ${accepts('1.10.0\n')}, 2.0.0 ${accepts('2.0.0\n')}; refused 1.3.9 ${!accepts('1.3.9\n')}, no version ${!accepts('not a version\n')}`,
      'an old rigc would fail on --geometry only after the build and validate had run, naming a flag; the version is asked first and compared as numbers (1.10.0 is after 1.4.0, which a string comparison gets backwards)',
    );

    // The reader refuses a half-written export, and a rest edge of length 0 fails the line by name rather than dividing by it.
    const bad1 = join(dir, 'bad-count.json');
    const bad2 = join(dir, 'bad-frames.json');
    const flat = join(dir, 'flat-rest.json');
    let malformed = 'CK30 wrote no geometry.json';
    let flatLine: JudgementLine | null = null;
    const flatProblems: Problem[] = [];
    let short: PartsError | null = null;
    let fewer: PartsError | null = null;
    if (existsSync(mild.geo)) {
      const text = readFileSync(mild.geo, 'utf8');
      const g1 = JSON.parse(text) as { rest: Array<{ slot: string; vertices: number[] }>; frames: Array<{ index: number; attachments: Array<{ slot: string; vertices: number[] }> }> };
      const target = g1.frames[5].attachments.find((a) => a.slot === CHECK_PARTS[0].name);
      if (target !== undefined) target.vertices = target.vertices.slice(0, -2);
      writeFileSync(bad1, JSON.stringify(g1));
      short = refusals(() => readGeometry(bad1, g1.frames.length));
      const g2 = JSON.parse(text) as { frames: unknown[] };
      writeFileSync(bad2, JSON.stringify(g2));
      fewer = refusals(() => readGeometry(bad2, g2.frames.length + 1));
      const g3 = JSON.parse(text) as { rest: Array<{ slot: string; kind: string; vertices: number[] }> };
      const r3 = g3.rest.find((r) => r.slot === CHECK_PARTS[0].name && r.kind === 'mesh');
      if (r3 !== undefined) {
        r3.vertices[2] = r3.vertices[0];
        r3.vertices[3] = r3.vertices[1];
      }
      writeFileSync(flat, JSON.stringify(g3));
      flatLine = stretchLine(readGeometry(flat, (g3 as unknown as { frames: unknown[] }).frames.length), flat, flatProblems);
      malformed = `vertex dropped in frame 5: ${codes(short)} — ${short?.problems[0].detail.slice(0, 110) ?? ''}; one frame fewer than written: ${fewer?.problems[0].detail.slice(0, 80) ?? 'accepted'}; vertex 1 on vertex 0 at rest: ${flatLine.status} — ${flatProblems[0]?.detail.slice(0, 90) ?? 'no problem'}`;
    }
    say(
      'CK36_A_HALF_WRITTEN_GEOMETRY_FILE_IS_REFUSED_BY_NAME_AND_A_ZERO_REST_EDGE_FAILS_THE_LINE',
      short !== null &&
        short.problems[0].code === 'CHECK_GEOMETRY_FILE' &&
        short.problems[0].detail === `frame 5 mesh "${CHECK_PARTS[0].name}" attachment "${CHECK_PARTS[0].name}" has 6 vertex number(s); its rest entry has 8` &&
        fewer !== null &&
        fewer.problems[0].detail === `holds ${IDLE_FPS + 1} frame(s); the frame set beside it wrote ${IDLE_FPS + 2}` &&
        flatLine !== null &&
        flatLine.status === 'FAIL' &&
        flatProblems.some((p) => p.code === 'CHECK_TEXTURE_STRETCH' && p.detail.startsWith('1 rest edge(s) of length 0, the first triangle 0 edge 0-1')),
      malformed,
      'a figure read off a truncated export would be a wrong number printed as a measurement, and a rest edge of length 0 has no ratio — each is named, neither is divided through',
    );

    const slotless = join(dir, 'slotless');
    writeCheckRig(slotless);
    const sr = JSON.parse(readFileSync(join(slotless, 'rig.json'), 'utf8')) as { slots: Array<{ name: string }> };
    sr.slots = sr.slots.filter((sl) => sl.name !== CHECK_PARTS[1].name);
    writeFileSync(join(slotless, 'rig.json'), JSON.stringify(sr));
    const noSlot = refusals(() => readCheckInputs(slotless));
    say(
      'CK14_A_PART_WITH_NO_SLOT_OF_ITS_NAME_IS_REFUSED_BEFORE_ANYTHING_IS_RENDERED',
      noSlot !== null && noSlot.problems.length === 1 && noSlot.problems[0].code === 'CHECK_PART_SLOT_PRESENT' && noSlot.problems[0].object === `part "${CHECK_PARTS[1].name}"`,
      `refused: ${codes(noSlot)}; ${noSlot?.problems[0].detail.slice(0, 120) ?? ''}`,
      'the judgement lines render a part alone by the slot of its own name; a rig that broke that contract would make them measure another part, or nothing, in silence',
    );

    const found = findRigc(ROOT, '');
    const nowhere = refusals(() => findRigc(dir, ''));
    say(
      'CK07_RIGC_IS_FOUND_BESIDE_THE_PACKAGE_AND_A_MISS_IS_REFUSED_NAMING_WHERE_IT_LOOKED',
      found.endsWith(join('node_modules', '.bin', 'rigc')) && codes(nowhere).startsWith('CHECK_RIGC_PRESENT') && (nowhere?.problems[0].detail.includes(join(dir, 'node_modules', '.bin', 'rigc')) ?? false),
      `from the package: ${relative(ROOT, found)}; from ${relative(tmpdir(), dir)} with an empty PATH: ${nowhere?.problems[0].detail.slice(0, 120) ?? 'found one'}…`,
      'a missing rigc must say which binary and where it looked, not surface as a spawn error',
    );

    // --page-edges and --pack-shape: the default run above packed under free and polygon, and pot and rect are rigc's
    // own defaults, so each value is held to a direct rigc build of the same rig with the same flags — the page bytes
    // are rigc's, never a typed figure.
    // At the depth check's own build/ sits (<dir>/<name>/build), so skeleton.json's relative images path is the same text.
    const direct = (name: string, extra: readonly string[]): string => {
      const d = join(dir, name, 'build');
      spawnSync(findRigc(ROOT, ''), ['build', '--rig', join(rig, 'rig.json'), '--motion', join(rig, 'motion.json'), '--out', d, '--profile', 'spine-html', '--pack', ...extra], { encoding: 'utf8', maxBuffer: 1 << 26 });
      return d;
    };
    const ARTIFACT = ['skeleton.atlas', 'skeleton.json', 'skeleton.png'];
    const sameArtifact = (a: string, b: string): boolean => ARTIFACT.every((f) => existsSync(join(a, f)) && existsSync(join(b, f)) && readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
    const freeDirect = direct('direct-free', ['--page-edges', 'free', '--pack-shape', 'polygon']);
    const freeSame = sameArtifact(join(out, 'build'), freeDirect);
    const defaultMode = JSON.stringify(fig?.pack_mode ?? null);
    say(
      'CK46_THE_DEFAULT_CHECK_PACKS_WITH_FREE_PAGE_EDGES_AND_POLYGON_SHAPE_AND_ITS_PAGE_IS_RIGCS_OWN_BYTE_FOR_BYTE',
      DEFAULT_PAGE_EDGES === 'free' &&
        DEFAULT_PACK_MODE.packShape === 'polygon' &&
        pack.length === 1 &&
        pack[0].pageEdges === 'free' &&
        pack[0].packShape === 'polygon' &&
        pack[0].line.endsWith(', page edges free, shape polygon') &&
        ok.out.includes('gate spine-html (rigc build --profile spine-html --pack --page-edges free --pack-shape polygon), verbatim:') &&
        defaultMode === '{"page_edges":"free","pack_shape":"polygon"}' &&
        freeSame,
      `no --page-edges, no --pack-shape: ${pack[0]?.line ?? 'no pack line'}; the console names "--page-edges free --pack-shape polygon": ${ok.out.includes('--page-edges free --pack-shape polygon), verbatim:')}; check.json pack_mode ${defaultMode}; build/ vs a direct \`rigc build --pack --page-edges free --pack-shape polygon\` of the same rig: ${freeSame ? `${ARTIFACT.join(', ')} byte-identical` : 'DIFFERENT'}`,
      "the packed page is the artifact, and free with polygon is the least-area page rigc can write for it; both values reach rigc verbatim, so check's page must be rigc's own page for those flags and nothing this package re-derived, and check.json says which flags made it",
    );

    const potOut = join(dir, 'out-pot');
    const potRun = runCli(['check', '--rig', rig, '--out', potOut, '--page-edges', 'pot', '--pack-shape', 'rect']);
    const potPack = parsePackLines(existsSync(join(potOut, 'gate_spine-html.txt')) ? readFileSync(join(potOut, 'gate_spine-html.txt'), 'utf8').split('\n') : []);
    const rigcDefault = direct('direct-default', []);
    const potSame = sameArtifact(join(potOut, 'build'), rigcDefault);
    const pow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
    say(
      'CK47_PAGE_EDGES_POT_WITH_PACK_SHAPE_RECT_IS_RIGCS_OWN_DEFAULT_PAGE_BYTE_FOR_BYTE',
      potRun.status === 0 &&
        potRun.out.includes('check: PASS') &&
        potPack.length === 1 &&
        potPack[0].pageEdges === 'pot' &&
        potPack[0].packShape === 'rect' &&
        !potPack[0].line.includes('page edges') &&
        potPack[0].line.endsWith(', padding 2, shape rect') &&
        pow2(potPack[0].width) &&
        pow2(potPack[0].height) &&
        potRun.out.includes('gate spine-html (rigc build --profile spine-html --pack --page-edges pot --pack-shape rect), verbatim:') &&
        potSame,
      `--page-edges pot --pack-shape rect: exit ${potRun.status}, ${potPack[0]?.line ?? 'no pack line'}; build/ vs a direct \`rigc build --pack\` with neither flag (rigc's defaults, the page every build wrote before the flags): ${potSame ? `${ARTIFACT.join(', ')} byte-identical` : 'DIFFERENT'}`,
      'pot and rect are the opt-outs, so together they must give back exactly the page an earlier build wrote: rigc with neither flag is that build, and pot is a power of two on both edges by rigc\'s own definition',
    );

    const rectOut = join(dir, 'out-rect');
    const rectRun = runCli(['check', '--rig', rig, '--out', rectOut, '--pack-shape', 'rect']);
    const rectPack = parsePackLines(existsSync(join(rectOut, 'gate_spine-html.txt')) ? readFileSync(join(rectOut, 'gate_spine-html.txt'), 'utf8').split('\n') : []);
    const rectDirect = direct('direct-rect', ['--page-edges', 'free']);
    const rectSame = sameArtifact(join(rectOut, 'build'), rectDirect);
    const rectMode = JSON.stringify(readJsonFile(join(rectOut, 'check.json'))?.pack_mode ?? null);
    say(
      'CK53_PACK_SHAPE_RECT_IS_RIGCS_RECT_PAGE_BYTE_FOR_BYTE_THE_PAGE_EARLIER_RELEASES_WROTE',
      rectRun.status === 0 &&
        rectPack.length === 1 &&
        rectPack[0].pageEdges === 'free' &&
        rectPack[0].packShape === 'rect' &&
        rectPack[0].line.endsWith(', page edges free, shape rect') &&
        rectRun.out.includes('gate spine-html (rigc build --profile spine-html --pack --page-edges free --pack-shape rect), verbatim:') &&
        rectMode === '{"page_edges":"free","pack_shape":"rect"}' &&
        rectSame,
      `--pack-shape rect: exit ${rectRun.status}, ${rectPack[0]?.line ?? 'no pack line'}; check.json pack_mode ${rectMode}; build/ vs a direct \`rigc build --pack --page-edges free\` with no --pack-shape (rigc's default shape, the only one before 2.1): ${rectSame ? `${ARTIFACT.join(', ')} byte-identical` : 'DIFFERENT'}`,
      'rect is the opt-out from the polygon default, so it must give back the page a build wrote before the flag: rigc with no --pack-shape packs by rectangles, as every rigc before 2.1.0 did (on the two public examples this page and atlas were measured byte-identical to rigc 2.0.3\'s)',
    );

    const bogus = [
      ['check', '--rig', rig, '--out', join(dir, 'bogus-check'), '--page-edges', 'square'],
      ['rig', '--config', join(dir, 'absent.json'), '--parts', dir, '--out', join(dir, 'bogus-rig'), '--page-edges', 'square'],
      ['build', '--config', join(dir, 'absent.json'), '--source', join(dir, 'absent.png'), '--full', dir, '--head', dir, '--out', join(dir, 'bogus-build'), '--page-edges', 'square'],
    ].map((args) => ({ command: args[0], r: runCli(args), out: join(dir, `bogus-${args[0]}`) }));
    const usageLine = '  FAIL  USAGE: --page-edges square; one of pot, free is required';
    say(
      'CK48_AN_UNKNOWN_PAGE_EDGES_VALUE_IS_A_USAGE_ERROR_ON_EVERY_COMMAND_THAT_PACKS',
      bogus.every((b) => b.r.status === 2 && b.r.out.split('\n').includes(usageLine) && !existsSync(b.out)),
      bogus.map((b) => `${b.command} --page-edges square -> exit ${b.r.status}, ${(b.r.out.split('\n').find((l) => l.includes('FAIL')) ?? 'no FAIL line').trim()}; --out written: ${existsSync(b.out)}`).join(' | '),
      'rig, check and build all pack, so all three take the flag, and a value rigc does not take is refused before any stage runs — naming the flag, the value and the two accepted — rather than handed to rigc to fail in the middle of a build',
    );

    const hull = [
      ['check', '--rig', rig, '--out', join(dir, 'hull-check'), '--pack-shape', 'hull'],
      ['rig', '--config', join(dir, 'absent.json'), '--parts', dir, '--out', join(dir, 'hull-rig'), '--pack-shape', 'hull'],
      ['build', '--config', join(dir, 'absent.json'), '--source', join(dir, 'absent.png'), '--full', dir, '--head', dir, '--out', join(dir, 'hull-build'), '--pack-shape', 'hull'],
    ].map((args) => ({ command: args[0], r: runCli(args), out: join(dir, `hull-${args[0]}`) }));
    const shapeUsage = '  FAIL  USAGE: --pack-shape hull; one of rect, polygon is required';
    say(
      'CK54_AN_UNKNOWN_PACK_SHAPE_VALUE_IS_A_USAGE_ERROR_ON_EVERY_COMMAND_THAT_PACKS',
      hull.every((b) => b.r.status === 2 && b.r.out.split('\n').includes(shapeUsage) && !existsSync(b.out)),
      hull.map((b) => `${b.command} --pack-shape hull -> exit ${b.r.status}, ${(b.r.out.split('\n').find((l) => l.includes('FAIL')) ?? 'no FAIL line').trim()}; --out written: ${existsSync(b.out)}`).join(' | '),
      'as for --page-edges: rig, check and build all pack, so all three take --pack-shape, and a value rigc does not take is refused before any stage runs, naming the flag, the value and the two accepted',
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

  // The pack line, read whole: rigc 1.5.1-2.0.3's two forms (no shape clause, so rect) are read, anything else is
  // refused, and a line that disagrees with the --page-edges passed is refused. Every expectation is the line's own text.
  const freeLine = '  ..    pack: skeleton.png 300x500, 4 region(s), 80.0% covered, padding 2, page edges free';
  const potLine = '  ..    pack: skeleton.png 512x1024, 4 region(s), 22.9% covered, padding 2';
  const readFree = parsePackLines([freeLine]);
  const readPot = parsePackLines([potLine]);
  const diagonal = refusals(() => parsePackLines(['  ..    pack: skeleton.png 300x500, 4 region(s), 80.0% covered, padding 2, page edges diagonal']));
  const noPadding = refusals(() => parsePackLines(['  ..    pack: skeleton.png 300x500, 4 region(s), 80.0% covered']));
  const rectUnder = (pageEdges: PageEdges): PackMode => ({ pageEdges, packShape: 'rect' });
  const freeUnderFree = packEdgeProblems(readFree, rectUnder('free'));
  const potUnderPot = packEdgeProblems(readPot, rectUnder('pot'));
  const potUnderFree = packEdgeProblems(readPot, rectUnder('free'));
  const freeUnderPot = packEdgeProblems(readFree, rectUnder('pot'));
  const odd = packEdgeProblems(parsePackLines(['  ..    pack: skeleton.png 300x500, 4 region(s), 80.0% covered, padding 2']), rectUnder('pot'));
  const one = (ps: Problem[]): string => ps.map((q) => `${q.code}: ${q.object} — ${q.detail}`).join(' / ') || 'none';
  say(
    'CK49_A_PACK_LINE_IS_READ_WHOLE_AND_ONE_THAT_DISAGREES_WITH_THE_PAGE_EDGES_PASSED_IS_REFUSED',
    readFree.length === 1 &&
      readFree[0].pageEdges === 'free' &&
      readFree[0].width === 300 &&
      readFree[0].height === 500 &&
      readFree[0].line === freeLine.trim().replace(/^\.\.\s+/, '') &&
      readPot.length === 1 &&
      readPot[0].pageEdges === 'pot' &&
      freeUnderFree.length === 0 &&
      potUnderPot.length === 0 &&
      codes(diagonal) === 'CHECK_PACK_LINE_READS rigc\'s pack line "pack: skeleton.png 300x500, 4 region(s), 80.0% covered, padding 2, page edges diagonal"' &&
      codes(noPadding).startsWith('CHECK_PACK_LINE_READS ') &&
      potUnderFree.length === 1 &&
      potUnderFree[0].code === 'CHECK_PACK_PAGE_EDGES' &&
      potUnderFree[0].detail.startsWith("rigc's pack line says page edges pot") &&
      freeUnderPot.length === 1 &&
      freeUnderPot[0].code === 'CHECK_PACK_PAGE_EDGES' &&
      freeUnderPot[0].detail.startsWith("rigc's pack line says page edges free") &&
      odd.length === 1 &&
      odd[0].code === 'CHECK_PACK_PAGE_EDGES' &&
      odd[0].detail.startsWith('is 300x500;'),
    `both forms read (free ${readFree[0]?.pageEdges}, pot ${readPot[0]?.pageEdges}); "page edges diagonal" -> ${diagonal?.problems[0] === undefined ? 'read' : `${diagonal.problems[0].code}: ${diagonal.problems[0].object}`}; no padding -> ${noPadding?.problems[0]?.code ?? 'read'}; a pot line under --page-edges free -> ${one(potUnderFree)}; a free line under pot -> ${one(freeUnderPot)}; 300x500 with no suffix under pot -> ${one(odd)}`,
    'a pack line half-read would drop the one field that changed, and a page whose edges are not the ones asked for is a build nobody ran; both are refused by name, and the two agreeing lines are the positive control',
  );

  // spine-rigc 2.1's pack line ends in the shape it packed under, after the page-edges clause or after the padding
  // (the four lines below are the forms rigc 2.1.3 and 2.10.1 printed on the public demo, both edges by both shapes). The
  // 1.5-2.0 form above, with no shape clause, reads as rect; an unknown shape, or the clauses out of order, is refused
  // by name; and a shape that disagrees with the --pack-shape passed is refused as edges are. Every expectation is the
  // line's own text.
  const newForms = [
    { line: '  ..    pack: skeleton.png 967x1338, 22 region(s), 91.2% covered, padding 2, page edges free, shape rect', edges: 'free', shape: 'rect' },
    { line: '  ..    pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, page edges free, shape polygon', edges: 'free', shape: 'polygon' },
    { line: '  ..    pack: skeleton.png 1024x2048, 22 region(s), 56.3% covered, padding 2, shape rect', edges: 'pot', shape: 'rect' },
    { line: '  ..    pack: skeleton.png 1024x2048, 22 region(s), 56.3% covered, padding 2, shape polygon', edges: 'pot', shape: 'polygon' },
  ].map((f) => ({ ...f, read: parsePackLines([f.line]) }));
  const formsRead = newForms.every((f) => f.read.length === 1 && f.read[0].pageEdges === f.edges && f.read[0].packShape === f.shape && f.read[0].line === f.line.trim().replace(/^\.\.\s+/, ''));
  const formsAgree = newForms.every((f) => packEdgeProblems(f.read, { pageEdges: f.read[0].pageEdges, packShape: f.read[0].packShape }).length === 0);
  const oldIsRect = readFree[0]?.packShape === 'rect' && readPot[0]?.packShape === 'rect';
  const hullShape = refusals(() => parsePackLines(['  ..    pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, page edges free, shape hull']));
  const swapped = refusals(() => parsePackLines(['  ..    pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, shape polygon, page edges free']));
  const polygonUnderRect = packEdgeProblems(newForms[1].read, { pageEdges: 'free', packShape: 'rect' });
  const rectUnderPolygon = packEdgeProblems(newForms[0].read, { pageEdges: 'free', packShape: 'polygon' });
  const oldUnderPolygon = packEdgeProblems(readFree, { pageEdges: 'free', packShape: 'polygon' });
  const bothWrong = packEdgeProblems(newForms[3].read, { pageEdges: 'free', packShape: 'rect' });
  say(
    'CK55_THE_PACK_LINES_SHAPE_IS_READ_BY_NAME_IN_EVERY_FORM_AND_ONE_THAT_DISAGREES_WITH_THE_PACK_SHAPE_PASSED_IS_REFUSED',
    formsRead &&
      formsAgree &&
      oldIsRect &&
      codes(hullShape) === 'CHECK_PACK_LINE_READS rigc\'s pack line "pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, page edges free, shape hull"' &&
      codes(swapped).startsWith('CHECK_PACK_LINE_READS ') &&
      polygonUnderRect.length === 1 &&
      polygonUnderRect[0].code === 'CHECK_PACK_SHAPE' &&
      polygonUnderRect[0].detail.startsWith('rigc\'s pack line says shape polygon (it ends ", shape polygon"); the build was run with --pack-shape rect') &&
      rectUnderPolygon.length === 1 &&
      rectUnderPolygon[0].code === 'CHECK_PACK_SHAPE' &&
      rectUnderPolygon[0].detail.startsWith('rigc\'s pack line says shape rect (it ends ", shape rect"); the build was run with --pack-shape polygon') &&
      oldUnderPolygon.length === 1 &&
      oldUnderPolygon[0].code === 'CHECK_PACK_SHAPE' &&
      oldUnderPolygon[0].detail.startsWith('rigc\'s pack line says shape rect (no ", shape" clause') &&
      bothWrong.map((q) => q.code).join(',') === 'CHECK_PACK_PAGE_EDGES,CHECK_PACK_SHAPE',
    `2.1 forms read (${newForms.map((f) => `${f.read[0]?.pageEdges}/${f.read[0]?.packShape}`).join(', ')}) and agree with their own flags: ${formsAgree}; the 1.5-2.0 forms read as ${readFree[0]?.packShape} and ${readPot[0]?.packShape}; "shape hull" -> ${hullShape?.problems[0]?.code ?? 'read'}; shape before page edges -> ${swapped?.problems[0]?.code ?? 'read'}; a polygon line under --pack-shape rect -> ${one(polygonUnderRect)}; a rect line under polygon -> ${one(rectUnderPolygon)}; a 2.0 line under polygon -> ${one(oldUnderPolygon)}; a pot polygon line under free rect -> ${bothWrong.map((q) => q.code).join(', ')}`,
    'spine-rigc 2.1 appended the shape to the pack line, which the 2.0 reader refused whole; the reader takes both forms by name and nothing looser, and a page packed under a shape nobody asked for is a build nobody ran, refused as a page with the wrong edges is',
  );

  // check's own refusal of a red rigc run with no FAIL line: the core entry's refusal of validate (spine-rigc 2.0.3,
  // the line as it printed it, cut after its first clause), a FAIL line, and a run that printed nothing.
  const coreValidate = 'rigc validate: `validate` runs through spine-core (the gate it re-runs is the round trip through it), and the runtime could not be used';
  const refusedValidate = rigcFailed('validate --profile spine', { status: 1, out: `${coreValidate}\n` }, []);
  const failLineKept = rigcFailed('validate --profile spine', { status: 1, out: '  FAIL  A06_ATLAS_PAGE_SIZE_MATCHES_PNG: x\nrigc: red\n' }, ['  FAIL  A06_ATLAS_PAGE_SIZE_MATCHES_PNG: x']);
  const printedNothing = rigcFailed('validate --profile spine', { status: 1, out: '\n' }, []);
  say(
    'CK50_A_RED_RIGC_RUN_WITH_NO_FAIL_LINE_IS_REFUSED_BY_THE_LINE_THAT_NAMES_WHY',
    refusedValidate.length === 1 &&
      refusedValidate[0].code === 'CHECK_RIGC_GREEN' &&
      refusedValidate[0].detail === `exit 1: ${coreValidate}` &&
      failLineKept.length === 1 &&
      failLineKept[0].detail === 'exit 1: FAIL  A06_ATLAS_PAGE_SIZE_MATCHES_PNG: x' &&
      printedNothing.length === 1 &&
      printedNothing[0].detail === 'exit 1, and it printed nothing' &&
      causeLines('rigc build a\n  ..    b\nrigc: could not launch bun: x\n').join('|') === 'rigc: could not launch bun: x',
    `the core entry's validate refusal -> ${refusedValidate.map((q) => q.detail).join(' / ').slice(0, 120)}…; a FAIL line -> ${failLineKept.map((q) => q.detail).join(' / ')}; nothing printed -> ${printedNothing.map((q) => q.detail).join(' / ')}`,
    'a red run whose reason was not a FAIL line was quoted by its last lines whatever they said, and one that printed nothing produced no problem at all, which refuseIfAny does not refuse; the core entry refuses validate in one line no gate filter reads',
  );

  // The entry, read by name off `rigc --version`: the launcher's two lines as spine-rigc 2.0.3 writes them,
  // a third form, no line at all, and the live rigc beside this package, which must be the round trip
  // with the spine-core this repository pins.
  const fullEntry = readRigcEntry('2.0.3\nentry: cli.ts — @esotericsoftware/spine-core 4.3.13 present\n');
  const coreEntry = readRigcEntry('2.0.3\nentry: cli_core.ts — @esotericsoftware/spine-core absent — the round trip and the commands that need it are not available here; see --help\n');
  const thirdEntry = refusals(() => readRigcEntry('2.1.0\nentry: cli_wasm.ts — something else\n'));
  const noEntry = refusals(() => readRigcEntry('1.5.1\n'));
  const live = spawnSync(findRigc(ROOT, ''), ['--version'], { encoding: 'utf8' });
  const liveEntry = readRigcEntry(`${live.stdout ?? ''}${live.stderr ?? ''}`);
  const pinned = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> }).devDependencies['@esotericsoftware/spine-core'];
  say(
    'CK51_THE_RIGC_ENTRY_IS_READ_BY_NAME_IN_BOTH_FORMS_AND_ANY_OTHER_IS_REFUSED',
    JSON.stringify(fullEntry) === '{"entry":"cli.ts","spine_core":"4.3.13"}' &&
      JSON.stringify(coreEntry) === '{"entry":"cli_core.ts","spine_core":null}' &&
      codes(thirdEntry) === 'CHECK_RIGC_ENTRY_READS rigc\'s entry line "entry: cli_wasm.ts — something else"' &&
      codes(noEntry) === 'CHECK_RIGC_ENTRY `rigc --version`' &&
      (noEntry?.problems[0].detail.includes(`spine-rigc ${RIGC_ENTRY_VERSION} or later is required`) ?? false) &&
      liveEntry.entry === 'cli.ts' &&
      liveEntry.spine_core === pinned,
    `full ${JSON.stringify(fullEntry)}; core ${JSON.stringify(coreEntry)}; a third form -> ${codes(thirdEntry)}; no entry line -> ${codes(noEntry)}; the live rigc -> ${JSON.stringify(liveEntry)} against the pinned spine-core ${pinned}`,
    "spine-rigc 2.0's launcher chooses which validator gates a build by whether spine-core resolves beside it, and check.json records which one did; a reader that took any entry: line would record a third entry as one of the two",
  );

  // Both entries' build reports through the gate filter and the green test. The lines are spine-rigc 2.10.1's
  // on one build of the demo, the compile pass (clauses and paths cut): the core entry prints 52 assertions, an A00
  // SKIP, the figures line the full entry prints (since 2.2.0, firejune/rigc#1114) and a here: line; the full entry
  // prints 50. The core entry's 2.1.3 form, whose figures line carried physicsConstraints alone, is still read.
  const coreOut = [
    "  SKIP  A00_ROUNDTRIP_PARSE: spine-core's parser is the subject of this rule and this entry links none of it",
    '  ..    52 assertions: 24 measured (24 passed, 0 failed), 28 skipped, 0 not in profile "spine-html"',
    '  ..    pages=22 regions=22 bones=72 slots=22 animations=1 version=4.3.13 regionAttachments=14 meshAttachments=8 physicsConstraints=0 rig=demo_painting profile=spine-html',
    "  ..    here: 43 rule(s) on the model side over the document, 8 of the round trip's own restated over the emitted text; not run: A00_ROUNDTRIP_PARSE",
    '  ..    pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, page edges free, shape polygon',
    'rigc: wrote /x/skeleton.json',
  ].join('\n');
  const core213Out = [
    "  SKIP  A00_ROUNDTRIP_PARSE: spine-core's parser is the subject of this rule and this entry links none of it",
    '  ..    52 assertions: 24 measured (24 passed, 0 failed), 28 skipped, 0 not in profile "spine-html"',
    '  ..    physicsConstraints=0',
    "  ..    here: 43 rule(s) on the model side over the document, 8 of the round trip's own restated over the emitted text; not run: A00_ROUNDTRIP_PARSE",
    '  ..    pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, page edges free, shape polygon',
    'rigc: wrote /x/skeleton.json',
  ].join('\n');
  const fullOut = [
    '  PASS  A00_ROUNDTRIP_PARSE',
    '  ..    50 assertions: 23 measured (23 passed, 0 failed), 27 skipped, 0 not in profile "spine-html"',
    '  ..    pages=22 regions=22 bones=72 slots=22 animations=1 version=4.3.13 regionAttachments=14 meshAttachments=8 physicsConstraints=0 rig=demo_painting profile=spine-html',
    '  ..    pack: skeleton.png 922x1348, 22 region(s), 95.0% covered, padding 2, page edges free, shape polygon',
    'rigc: wrote /x/skeleton.json',
  ].join('\n');
  const coreLines = buildGateLines(coreOut);
  const core213Lines = buildGateLines(core213Out);
  const fullLines = buildGateLines(fullOut);
  const coreRed = buildGateLines(coreOut.replace('(24 passed, 0 failed)', '(23 passed, 1 failed)'));
  say(
    'CK52_BOTH_RIGC_ENTRIES_BUILD_REPORTS_ARE_READ_AND_THE_CORE_ENTRYS_SAYS_WHICH_RULES_RAN',
    coreLines.length === 4 &&
      coreLines[1].trim().startsWith('..    pages=22 ') &&
      coreLines[2].trim().startsWith('..    here: ') &&
      gateGreen(0, coreLines) &&
      !gateGreen(0, coreRed) &&
      parsePackLines(coreLines).length === 1 &&
      core213Lines.length === 3 &&
      core213Lines[1].trim().startsWith('..    here: ') &&
      gateGreen(0, core213Lines) &&
      parsePackLines(core213Lines)[0].line === parsePackLines(coreLines)[0].line &&
      fullLines.length === 3 &&
      !fullLines.some((l) => l.includes('here: ')) &&
      gateGreen(0, fullLines) &&
      parsePackLines(fullLines)[0].line === parsePackLines(coreLines)[0].line,
    `core entry: ${coreLines.map((l) => l.trim().slice(0, 40)).join(' | ')}, green ${gateGreen(0, coreLines)}, one failed red ${!gateGreen(0, coreRed)}; its 2.1.3 form: ${core213Lines.map((l) => l.trim().slice(0, 40)).join(' | ')}, green ${gateGreen(0, core213Lines)}; full entry: ${fullLines.map((l) => l.trim().slice(0, 40)).join(' | ')}, green ${gateGreen(0, fullLines)}`,
    "the gate file is the verdict's record, so under the core entry it must carry the here: line that says the round trip did not run; the summary is read by its counts in both forms (52 and 50 assertions), the figures line the core entry gained in 2.2.0 is kept as the full entry's is, and the pack line is the same line under either entry and either release",
  );

  // CHAIN_LAG reads motion.json and the bone tree only, so its controls need no render.
  const chainRig = { bones: [{ name: 'root' }, { name: 'a', parent: 'root' }, { name: 'b', parent: 'a' }, { name: 'c', parent: 'b' }] };
  const chainMotion = (phases: number[], amps: number[]): Record<string, unknown> => ({
    groups: {},
    animations: { idle: { duration: 4, tracks: ['a', 'b', 'c'].map((b, i) => sineTrack(b, 'rotate', amps[i], 4, phases[i], 0, 4)) } },
  });
  const judge = (m: Record<string, unknown>): { line: Record<string, unknown>; codes: string[] } => {
    const ps: Problem[] = [];
    const line = chainLine({ rig: chainRig, motion: m }, ps) as Record<string, unknown>;
    return { line, codes: ps.map((p) => p.code) };
  };
  const good = judge(chainMotion([0.1, 0.2, 0.3], [1, 2, 3]));
  const back = judge(chainMotion([0.3, 0.2, 0.1], [1, 2, 3]));
  const shrink = judge(chainMotion([0.1, 0.2, 0.3], [3, 2, 1]));
  const mirrored = judge(chainMotion([0.1, 0.2, 0.3], [-1, -2, -3]));
  const read = readSine(sineTrack('a', 'rotate', 0.25, 2, 0.37, 0, 4).keys, 4);
  say(
    'CK13_CHAIN_LAG_READS_EACH_LINKS_PHASE_AND_NAMES_A_REVERSED_OR_SHRINKING_CHAIN',
    good.line.status === 'PASS' &&
      good.line.min_step === 0.1 &&
      back.line.status === 'FAIL' &&
      String(back.line.first_violation).includes('"b" follows its keyed ancestor "a" by -0.100') &&
      back.codes.every((c) => c === 'CHECK_CHAIN_LAG') &&
      shrink.line.status === 'FAIL' &&
      String(shrink.line.first_violation).includes('"b" swings 2.000 under "a"\'s 3.000') &&
      mirrored.line.status === 'PASS' &&
      read !== null &&
      Math.abs(read.phase - 0.37) < 1e-3 &&
      Math.abs(read.amp - 0.25) < 1e-3 &&
      read.period === 2 &&
      Math.abs(lagStep(0.9, 0.05) - 0.15) < 1e-12,
    `in order: ${String((good.line.chains as string[] | undefined)?.[0])}; reversed: ${String(back.line.first_violation)}; shrinking: ${String(shrink.line.first_violation)}; mirrored (negative amps) ${String(mirrored.line.status)}; a 2 s sine at phase 0.37, amp 0.25 reads ${JSON.stringify(read)}; a lag across the cycle's end (0.9 -> 0.05) reads ${lagStep(0.9, 0.05).toFixed(3)}`,
    'the model writes phase + lag*i and one amplitude per link (src/motion.ts); the reading recovers them from the keys alone, a mirrored chain (negative amps, half a cycle) is the same lag, and a chain that leads or shrinks toward its tip is named at its first link that does',
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

/** Undo PNG scanline filters over `height` rows of `stride` bytes, `bpp` bytes to the left neighbour. */
function unfilterRows(raw: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >>> 1 : pr;
      out[y * stride + i] = (x + pred) & 255;
    }
  }
  return out;
}

interface IndexedApngRead {
  /** Every structural fact the controls name, as text, so a failing detail quotes it. */
  faults: string[];
  colourType: number;
  bitDepth: number;
  entries: number;
  trns: number[] | null;
  numFrames: number;
  plays: number;
  frames: DecodedFrame[];
}

/**
 * A minimal indexed APNG reader written independently of `encodeIndexedApng`:
 * a chunk walker (signature, CRC-free lengths, IHDR, PLTE, tRNS, acTL, the
 * fcTL/fdAT sequence) and a decoder for colour type 3 at any bit depth,
 * dispose NONE, blend SOURCE or OVER (OVER skipping alpha-0 entries, which is
 * exact only when every other written entry is opaque — the reader checks that
 * too, as a fault).
 */
function readIndexedApng(bytes: Uint8Array): IndexedApngRead {
  const faults: string[] = [];
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => bytes[i] === v)) faults.push('no PNG signature');
  let at = 8;
  let w = 0;
  let h = 0;
  let colourType = -1;
  let bitDepth = -1;
  let palette = new Uint8Array(0);
  let trns: number[] | null = null;
  let numFrames = -1;
  let plays = -1;
  let expectSeq = 0;
  let canvas = new Uint8ClampedArray(0);
  let pending: { x: number; y: number; w: number; h: number; delay: number; blend: number; data: Uint8Array[] } | null = null;
  const frames: DecodedFrame[] = [];
  const seq = (n: number, type: string): void => {
    if (n !== expectSeq) faults.push(`${type} sequence ${n} where ${expectSeq} is next`);
    expectSeq = n + 1;
  };
  const flush = (): void => {
    if (pending === null) return;
    const stride = Math.ceil((pending.w * bitDepth) / 8);
    const rows = unfilterRows(new Uint8Array(inflateSync(Buffer.concat(pending.data))), stride, pending.h, 1);
    const perByte = 8 / bitDepth;
    for (let y = 0; y < pending.h; y++) {
      for (let x = 0; x < pending.w; x++) {
        const byte = rows[y * stride + Math.floor(x / perByte)];
        const ix = (byte >> (8 - bitDepth * ((x % perByte) + 1))) & ((1 << bitDepth) - 1);
        if (ix * 3 >= palette.length) faults.push(`index ${ix} past a palette of ${palette.length / 3}`);
        const alpha = trns !== null && ix < trns.length ? trns[ix] : 255;
        if (pending.blend === 1 && alpha === 0) continue;
        if (pending.blend === 1 && alpha !== 255) faults.push(`OVER frame writes translucent entry ${ix}`);
        canvas.set([palette[ix * 3], palette[ix * 3 + 1], palette[ix * 3 + 2], alpha], ((pending.y + y) * w + pending.x + x) * 4);
      }
    }
    frames.push({ image: { width: w, height: h, data: new Uint8ClampedArray(canvas) }, delay: pending.delay });
    pending = null;
  };
  while (at + 8 <= bytes.length) {
    const len = be32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = be32(body, 0);
      h = be32(body, 4);
      bitDepth = body[8];
      colourType = body[9];
      canvas = new Uint8ClampedArray(w * h * 4);
    } else if (type === 'PLTE') {
      palette = body.slice();
      if (len % 3 !== 0 || len / 3 > 256 || len === 0) faults.push(`PLTE of ${len} bytes`);
    } else if (type === 'tRNS') {
      trns = [...body];
      if (trns.length > palette.length / 3) faults.push(`tRNS of ${trns.length} entries for a palette of ${palette.length / 3}`);
    } else if (type === 'acTL') {
      numFrames = be32(body, 0);
      plays = be32(body, 4);
    } else if (type === 'fcTL') {
      flush();
      seq(be32(body, 0), 'fcTL');
      pending = { w: be32(body, 4), h: be32(body, 8), x: be32(body, 12), y: be32(body, 16), delay: ((body[20] << 8) | body[21]) / ((body[22] << 8) | body[23]), blend: body[25], data: [] };
    } else if (type === 'IDAT') pending?.data.push(body);
    else if (type === 'fdAT') {
      seq(be32(body, 0), 'fdAT');
      pending?.data.push(body.subarray(4));
    } else if (type === 'IEND') flush();
    at += 12 + len;
  }
  if (colourType !== 3) faults.push(`IHDR colour type ${colourType}`);
  if (trns === null) faults.push('no tRNS');
  if (numFrames !== frames.length) faults.push(`acTL says ${numFrames} frame(s), ${frames.length} decoded`);
  return { faults, colourType, bitDepth, entries: palette.length / 3, trns, numFrames, plays, frames };
}

/** Per-channel R, G, B error over a whole frame list, and alpha's max, the way `loop` states it. */
function framesError(got: readonly DecodedFrame[], want: readonly Raster[]): { max: number; mean: number; alphaMax: number } {
  let max = 0;
  let alphaMax = 0;
  let sum = 0;
  let count = 0;
  want.forEach((im, f) => {
    const d = got[f]?.image.data;
    for (let p = 0; p < im.width * im.height; p++) {
      for (let c = 0; c < 4; c++) {
        const e = Math.abs(im.data[p * 4 + c] - (d === undefined ? -999 : d[p * 4 + c]));
        if (c === 3) alphaMax = Math.max(alphaMax, e);
        else {
          max = Math.max(max, e);
          sum += e;
          count++;
        }
      }
    }
  });
  return { max, mean: count === 0 ? 0 : sum / count, alphaMax };
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

    const idxPath = join(dir, 'idle-indexed.png');
    const idx = runCli(['loop', '--frames', join(dir, 'out', 'idle_frames'), '--out', idxPath, '--palette']);
    const ib = existsSync(idxPath) ? new Uint8Array(readFileSync(idxPath)) : new Uint8Array(0);
    const ir = ib.length > 0 ? readIndexedApng(ib) : null;
    const iStated = /all frames\): max (\d+), mean ([\d.]+); alpha max (\d+)/.exec(idx.out);
    const iErr = ir === null ? null : framesError(ir.frames, expected);
    const iPlain = ib.length > 0 ? decodePngBytes(ib, idxPath) : null;
    const iF0 = iPlain !== null && ir !== null && ir.frames.length > 0 && Buffer.compare(Buffer.from(iPlain.data), Buffer.from(ir.frames[0].image.data)) === 0;
    const iTime = ir === null ? -1 : ir.frames.reduce((t, f) => t + f.delay, 0);
    say(
      'LP07_THE_INDEXED_APNG_OF_A_RENDERED_IDLE_DECODES_BACK_TO_THE_ERROR_IT_STATES_OVER_EVERY_FRAME',
      idx.status === 0 &&
        ir !== null &&
        ir.faults.length === 0 &&
        iStated !== null &&
        iErr !== null &&
        ir.frames.length === expected.length &&
        ir.plays === 0 &&
        iErr.max === Number(iStated[1]) &&
        iErr.mean.toFixed(3) === iStated[2] &&
        iErr.alphaMax === Number(iStated[3]) &&
        iF0 &&
        Math.abs(iTime - expected.length / set.fps) < 1e-9 &&
        idx.out.includes('is dropped'),
      `exit ${idx.status}; stated ${iStated === null ? 'nothing' : iStated[0]}; read ${ir === null ? 'nothing' : `colour type ${ir.colourType}, ${ir.bitDepth}-bit, ${ir.entries} entries, ${ir.frames.length} frame(s), plays ${ir.plays}, faults [${ir.faults.slice(0, 3).join('; ')}]`}; measured over every frame max ${iErr?.max}, mean ${iErr?.mean.toFixed(3)}, alpha max ${iErr?.alphaMax}; spine-rigc's decodePng frame 0 ${iF0 ? 'equals' : 'does NOT equal'} the reader's; ${iTime.toFixed(4)}s per loop`,
      'the indexed file is the README artifact and is lossy by construction, so the one checkable claim is that the error it prints is the error in the file — over all frames, not frame 0 — read back by a reader that shares nothing with the writer',
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

    const openIdx = join(dir, 'open-indexed.png');
    const once = runCli(['loop', '--frames', join(dir, 'open'), '--out', openIdx, '--palette']);
    const first = existsSync(openIdx) ? new Uint8Array(readFileSync(openIdx)) : new Uint8Array(0);
    const twice = runCli(['loop', '--frames', join(dir, 'open'), '--out', openIdx, '--palette']);
    const second = existsSync(openIdx) ? new Uint8Array(readFileSync(openIdx)) : new Uint8Array(0);
    const or = first.length > 0 ? readIndexedApng(first) : null;
    const oPlain = first.length > 0 ? decodePngBytes(first, openIdx) : null;
    const oErr = or === null ? null : framesError(or.frames, open);
    const oStated = /all frames\): max (\d+), mean ([\d.]+); alpha max (\d+)/.exec(once.out);
    const oF0 = oPlain === null ? null : channelError(oPlain, open[0]);
    say(
      'LP08_A_THREE_FRAME_INDEXED_APNG_WALKS_AS_TYPE_3_WITH_ONE_PALETTE_TRNS_ACTL_3_AND_IN_ORDER_SEQUENCES_AND_TWO_RUNS_ARE_ONE_FILE',
      once.status === 0 &&
        twice.status === 0 &&
        or !== null &&
        or.faults.length === 0 &&
        or.colourType === 3 &&
        or.entries <= 256 &&
        or.trns !== null &&
        or.numFrames === 3 &&
        or.bitDepth === 4 &&
        oErr !== null &&
        oStated !== null &&
        oErr.max === Number(oStated[1]) &&
        oF0 !== null &&
        oF0.max <= Number(oStated[1]) &&
        oF0.max === 0 &&
        first.length > 0 &&
        Buffer.compare(Buffer.from(first), Buffer.from(second)) === 0,
      `exits ${once.status}, ${twice.status}; ${or === null ? 'nothing read' : `colour type ${or.colourType}, ${or.bitDepth}-bit, ${or.entries} PLTE entries, tRNS ${or.trns === null ? 'absent' : `[${or.trns.join(',')}]`}, acTL ${or.numFrames}, faults [${or.faults.join('; ')}]`}; stated ${oStated === null ? 'nothing' : oStated[0]}; spine-rigc's decodePng frame 0 max ${oF0?.max}; every frame max ${oErr?.max}; two runs ${Buffer.compare(Buffer.from(first), Buffer.from(second)) === 0 ? 'byte-identical' : 'DIFFERENT'} (${first.length} bytes)`,
      'four colours and the transparent entry are five, so the fewest bits that hold them are 4 and the palette has no excuse for error; the default image must be readable by the one PNG decoder in this package, which knows nothing of APNG',
    );

    const many = newRaster(30, 10);
    for (let p = 0; p < 300; p++) many.data.set([p % 256, Math.floor(p / 256) * 97 + ((p * 7) % 50), (p * 13) % 256, 255], p * 4);
    const manyDistinct = new Set(Array.from({ length: 300 }, (_, p) => many.data.slice(p * 4, p * 4 + 4).join(','))).size;
    const moved = newRaster(30, 10);
    moved.data.set(many.data);
    moved.data.set([255, 255, 255, 255], 0);
    const q = encodeIndexedApng(
      [
        { image: many, ticks: 1 },
        { image: moved, ticks: 1 },
      ],
      12,
    );
    const qr = readIndexedApng(q.bytes);
    const qErr = framesError(qr.frames, [many, moved]);
    say(
      'LP09_THREE_HUNDRED_DISTINCT_COLOURS_QUANTISE_TO_AT_MOST_256_ENTRIES_AND_THE_ERROR_REPORTED_IS_ABOVE_ZERO_AND_IS_THE_FILES',
      manyDistinct === 300 && qr.faults.length === 0 && qr.frames.length === 2 && q.stats.overFrames === 1 && qr.entries <= 256 && q.stats.entries === qr.entries && q.stats.all.max > 0 && qErr.max === q.stats.all.max && qErr.mean.toFixed(6) === q.stats.all.mean.toFixed(6) && qr.bitDepth === 8,
      `${manyDistinct} distinct colours -> ${qr.entries} entries (${q.stats.entries} stated), ${qr.bitDepth}-bit, ${qr.frames.length} frame(s), ${q.stats.overFrames} OVER; stated max ${q.stats.all.max}, mean ${q.stats.all.mean.toFixed(6)}; decoded max ${qErr.max}, mean ${qErr.mean.toFixed(6)}; faults [${qr.faults.join('; ')}]`,
      'a palette of 256 entries cannot hold 300 colours, so an error of 0 here would be a figure the encoder did not measure; the frame that moves one pixel exercises the OVER path on a lossy palette',
    );

    const edge = newRaster(8, 4);
    for (let p = 0; p < 32; p++) edge.data.set([200, 40, 40, [0, 64, 128, 255][p % 4]], p * 4);
    const edge2 = newRaster(8, 4);
    edge2.data.set(edge.data);
    edge2.data.set([200, 40, 40, 32], 5 * 4);
    const t = encodeIndexedApng(
      [
        { image: edge, ticks: 1 },
        { image: edge2, ticks: 2 },
      ],
      12,
    );
    const tr = readIndexedApng(t.bytes);
    const tErr = framesError(tr.frames, [edge, edge2]);
    const palettesOnly = runCli(['loop', '--frames', join(dir, 'open'), '--out', join(dir, 'x.gif'), '--palette']);
    say(
      'LP10_GRADED_ALPHA_IS_KEPT_PER_ENTRY_A_TRANSLUCENT_CHANGE_BLENDS_SOURCE_AND_PALETTE_WITH_A_GIF_IS_REFUSED',
      tr.faults.length === 0 && tErr.max === 0 && tErr.alphaMax === 0 && t.stats.overFrames === 0 && tr.trns !== null && tr.trns.length > 1 && palettesOnly.status === 2 && palettesOnly.out.includes('--palette selects the indexed APNG'),
      `alpha 0/64/128/255 and 32 -> tRNS [${tr.trns?.join(',')}], decoded max ${tErr.max}, alpha max ${tErr.alphaMax}, OVER frames ${t.stats.overFrames}; faults [${tr.faults.join('; ')}]; --palette with .gif -> exit ${palettesOnly.status}`,
      'a translucent edge that went through a binary-alpha palette would print an alpha error the rendered idle never has; OVER would mix a translucent entry with what is under it, so that frame must be SOURCE',
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
// build: the driver, on the generated assemble fixture
// ---------------------------------------------------------------------------

/** `build`'s flags over a fixture directory written by `writeAssembleFixture`. */
function buildArgs(dir: string, out: string, config = 'config.json'): string[] {
  return ['build', '--config', join(dir, config), '--source', join(dir, 'painting.png'), '--full', join(dir, 'full'), '--head', join(dir, 'head'), '--out', out];
}

/**
 * A copy of `cfg` with `x-` records written into every object the loader
 * vouches for that the config holds (issue #70): the top level, `assemble`,
 * each `extend_below_crop` and `patches` entry, `seethrough`, each bone entry,
 * each mesh entry, `motion`, each track and the blink — holding an object, an
 * array, a number and null between them, and one named `x-…_note`, which is a
 * record because the record test comes first. Nothing here changes a field.
 * `at` lists every place a record was written, so a control says what its
 * fixture actually held rather than what this function would write.
 */
function withRecords(cfg: Record<string, unknown>): { cfg: Record<string, unknown>; at: string[] } {
  const c = structuredClone(cfg);
  const at: string[] = [];
  const add = (o: unknown, where: string, extra: Record<string, unknown>): void => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return;
    Object.assign(o, extra);
    at.push(where);
  };
  const each = (list: unknown, where: string, extra: (i: number) => Record<string, unknown>): void => {
    if (Array.isArray(list)) list.forEach((o, i) => add(o, `${where}[${i}]`, extra(i)));
  };
  const values = (map: unknown, where: string, extra: Record<string, unknown>): void => {
    if (typeof map === 'object' && map !== null) for (const [k, o] of Object.entries(map)) add(o, `${where}.${k}`, extra);
  };
  add(c, 'config', { 'x-status': { gate: 'green', built_with: '0.8.2' }, 'x-seeds_tried': [3, 7], 'x-builds': 2, 'x-reviewed': null, 'x-seed_note': { why: 'a record, not an annotation' } });
  const a = c.assemble as Record<string, unknown> | undefined;
  add(a, 'assemble', { 'x-why': { rig_scale: 'measured off the painting' } });
  each(a?.extend_below_crop, 'extend_below_crop', (i) => ({ 'x-n': i }));
  each(a?.patches, 'patches', () => ({ 'x-from': { issue: 28 } }));
  add(c.seethrough, 'seethrough', { 'x-runs': ['full', 'head'] });
  each(c.bones, 'bones', (i) => ({ 'x-placed': i === 0 ? null : [i] }));
  values(c.meshes, 'meshes', { 'x-grid_was': 4 });
  const m = c.motion as Record<string, unknown> | undefined;
  add(m, 'motion', { 'x-tuned': ['by eye'] });
  each(m?.tracks, 'tracks', () => ({ 'x-was': { amp: 0 } }));
  const blink = m?.blink as Record<string, unknown> | undefined;
  add(blink, 'blink', { 'x-t_was': null });
  values(blink?.still, 'blink.still', { 'x-row_was': 19 });
  return { cfg: c, at };
}

/** The last non-empty lines a run printed. */
function lastLines(out: string, n: number): string[] {
  return out.split('\n').filter((l) => l.trim() !== '').slice(-n);
}

/** The top-level entries of a directory, sorted; none when it is absent. */
function entries(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function runBuildSuite(): number {
  section('build: assemble, rig and check in one process, on generated runs');
  const { say, bad } = counter();
  const dir = temp('build');
  try {
    // The fixture's own config has an idle with no track, which rigc refuses
    // (a declared duration with no key at it). The green build's idle is the
    // smallest one the judgement lines (issue #11) also accept: the topwear
    // rides a bone that breathes, the bottomwear a bone that swings from the
    // top of its own box, and the face and the shoes stay on the still anchor.
    // One sine on the anchor under everything was the idle here before those
    // lines existed; it swings the shoes and slides the skirt whole, and
    // STILL_REGIONS_DARK and TIP_OVER_ROOT say so.
    const moving = assembleConfig();
    const skirtTop = EXPECTED_PARTS.parts.find((p) => p.name === 'bottomwear') as { x: number; y: number; w: number };
    const torsoTop = EXPECTED_PARTS.parts.find((p) => p.name === 'topwear') as { x: number; y: number; w: number };
    moving.bones = [
      { name: 'anchor', parent: 'root', at: [0, 0] },
      { name: 'chest', parent: 'root', at: [torsoTop.x + torsoTop.w / 2, torsoTop.y] },
      { name: 'skirt', parent: 'root', at: [skirtTop.x + skirtTop.w / 2, skirtTop.y] },
    ];
    moving.regions = { ...(moving.regions as Record<string, string>), topwear: 'chest', bottomwear: 'skirt' };
    moving.motion = {
      duration: 1,
      tracks: [
        { bone: 'chest', prop: 'translatey', amp: 1, period: 1, phase: 0 },
        { bone: 'skirt', prop: 'rotate', amp: 2, period: 1, phase: 0 },
      ],
    };
    writeAssembleFixture(dir, moving);
    writeFileSync(join(dir, 'still.json'), `${JSON.stringify(assembleConfig(), null, 2)}\n`);
    writeFileSync(join(dir, 'wrongtag.json'), `${JSON.stringify(assembleConfig({ plan: [...PLAN, ['wings', 'head', 'wings']] }), null, 2)}\n`);

    const out = join(dir, 'out');
    const green = runCli([...buildArgs(dir, out), '--loop']);
    const tail = lastLines(green.out, 4);
    const expectedTree = [...BUILD_OWNS].sort();
    const tree = entries(out);
    const artifacts = tail.slice(1).map((l) => l.trim());
    const stageOrder = ['[assemble]', '[rig]', '[check]', '[loop]'].map((p) => green.out.indexOf(`\n${p} `));
    const partsSame = existsSync(join(out, 'parts.json')) && serializeParts(readParts(join(out, 'parts.json'))) === serializeParts(EXPECTED_PARTS);
    say(
      'BU01_A_GREEN_BUILD_WRITES_ITS_TREE_AND_ENDS_WITH_THE_PACK_LINE_AND_THE_THREE_ARTIFACT_PATHS',
      green.status === 0 &&
        tree.join(',') === expectedTree.join(',') &&
        /^pack: skeleton\.png \d+x\d+, \d+ region\(s\), [\d.]+% covered, padding \d+, page edges free, shape polygon; page opaque [\d.]+% \(alpha > 0\) — spineboy yardstick /.test(tail[0]?.trim() ?? '') &&
        artifacts.map((a) => a.split('/').pop()).join(',') === 'skeleton.json,skeleton.atlas,skeleton.png' &&
        artifacts.every((a) => a.startsWith(join(out, 'check', 'build')) && existsSync(a)) &&
        stageOrder.every((at, i) => at > 0 && (i === 0 || at > stageOrder[i - 1])) &&
        partsSame,
      `exit ${green.status}; --out holds [${tree.join(', ')}]; last lines: ${tail.map((l) => l.trim()).join(' | ')}; stage prefixes at ${stageOrder.join(', ')}; parts.json equals the fixture's hand-derived one: ${partsSame}`,
      "issue #2: the packed page is the artifact and the loose parts an intermediate, so the lines a reader stops at are the pack line and the three files; the parts.json equality is what shows build called the assemble stage rather than something like it",
    );

    // Issue #78: the landscape twin through the same driver (fixtures/assemble_fixture.ts, "The landscape
    // twin"): a 128x124 painting, the full run moved down by its top pad in run pixels (1 row), the same
    // config. Its parts are the portrait's, so the green build's parts PNGs are the expectation, byte for byte.
    // No --loop here, so the tree is BUILD_OWNS less the three idle files the loop writes.
    const wideDir = join(dir, 'landscape');
    writeAssembleFixture(wideDir, moving, landscapePainting(), { full: LANDSCAPE_FULL_LAYERS, head: HEAD_LAYERS });
    const wideOut = join(wideDir, 'out');
    const wide = runCli(buildArgs(wideDir, wideOut));
    const wideParts = existsSync(join(wideOut, 'parts.json')) ? serializeParts(readParts(join(wideOut, 'parts.json'))) : 'absent';
    const pngs = entries(join(out, 'parts'));
    const pngSame = pngs.filter((f) => existsSync(join(wideOut, 'parts', f)) && Buffer.compare(readFileSync(join(out, 'parts', f)), readFileSync(join(wideOut, 'parts', f))) === 0);
    say(
      'BU11_A_LANDSCAPE_PAINTING_BUILDS_GREEN_TO_THE_PORTRAIT_S_PARTS_IN_PAINTING_PIXELS',
      wide.status === 0 && wideParts === serializeParts(LANDSCAPE_EXPECTED_PARTS) && pngs.length === EXPECTED_PARTS.parts.length && pngSame.length === pngs.length && entries(wideOut).join(',') === expectedTree.filter((f) => !f.startsWith('idle')).join(','),
      `exit ${wide.status}; parts.json equals the hand-derived landscape one: ${wideParts === serializeParts(LANDSCAPE_EXPECTED_PARTS)}; ${pngSame.length} of ${pngs.length} part PNGs byte-identical to the portrait build's; --out holds [${entries(wideOut).join(', ')}]`,
      'the reporter padded the painting itself to a square, which puts the padding in the rig; here the pad is See-through\'s input only, so assemble, rig and check see the painting and the same figure gives the same parts',
    );

    // The planted input: the portrait's full run beside the landscape painting — a full run whose square
    // the painting was not centred on, which is what a stage dropping the top pad reads. Every full-run
    // part lands one rig row high; build writes it (nothing it measures can know the figure), and the
    // parts.json names the move.
    const highDir = join(dir, 'landscape-unshifted');
    writeAssembleFixture(highDir, moving, landscapePainting());
    const highOut = join(highDir, 'out');
    runCli(buildArgs(highDir, highOut));
    const highParts = existsSync(join(highOut, 'parts.json')) ? readParts(join(highOut, 'parts.json')) : null;
    const highTop = highParts?.parts.find((p) => p.name === 'topwear');
    say(
      'BU12_A_FULL_RUN_READ_WITHOUT_ITS_TOP_PAD_MOVES_THE_BUILD_S_PARTS_BY_THE_PAD',
      highParts !== null && highTop?.y === 19 && serializeParts(highParts) !== wideParts,
      `the unmoved full run on the 128x124 painting: parts.json ${highParts === null ? 'absent' : `topwear at y ${highTop?.y}`} (20 with the pad, 19 = 20 - 2 x 0.5 without)`,
      'a dropped vertical pad is not a refusal anywhere downstream — the parts are plausible, one pad too high — so the expectation has to be a number derived by hand',
    );

    // The Spine header of a build is the setup-pose box since spine-rigc 2.2.0 (firejune/rigc#907), and
    // tools/atlas_population.ts reads a build's figure there, held to spine-core's getBounds through rigc's own
    // writing of a bound (headerBoxNumber). The green build above is the positive control; the plants are its
    // header's width moved one float32 step up, and its box removed. Every expectation is the header's own text.
    const builtDir = join(out, 'check', 'build');
    const headerGreen = existsSync(join(builtDir, 'skeleton.json')) ? buildHeaderProblem('green', builtDir) : 'no build';
    const plantHeader = (name: string, edit: (box: Record<string, unknown>) => void): { box: Record<string, unknown>; problem: string | null } => {
      const at = join(dir, name);
      cpSync(builtDir, at, { recursive: true });
      const doc = JSON.parse(readFileSync(join(at, 'skeleton.json'), 'utf8')) as { skeleton: Record<string, unknown> };
      edit(doc.skeleton);
      writeFileSync(join(at, 'skeleton.json'), JSON.stringify(doc));
      return { box: doc.skeleton, problem: buildHeaderProblem(name, at) };
    };
    const ulpUp = (v: number): number => {
      const bits = new Uint32Array(new Float32Array([v]).buffer);
      bits[0] += v >= 0 ? 1 : -1;
      return new Float32Array(bits.buffer)[0];
    };
    const wider = existsSync(builtDir) ? plantHeader('header-wider', (b) => { b.width = ulpUp(Number(b.width)); }) : null;
    const boxless = existsSync(builtDir) ? plantHeader('header-boxless', (b) => { delete b.width; }) : null;
    const box = wider?.box;
    const widerHead = box === undefined ? '' : `BUILD_HEADER_IS_SETUP_BOUNDS: header-wider — the header box is x ${box.x}, y ${box.y}, width ${box.width}, height ${box.height}; spine-core's getBounds at the setup pose is `;
    say(
      'BU07_A_BUILDS_HEADER_IS_HELD_TO_THE_SETUP_POSE_BOUNDS_AND_ONE_FLOAT32_STEP_OFF_IS_REFUSED_WITH_BOTH_BOXES',
      headerGreen === null &&
        wider !== null &&
        (wider.problem?.startsWith(widerHead) ?? false) &&
        (wider.problem?.endsWith('(headerBoxNumber); they differ on width') ?? false) &&
        (boxless?.problem?.startsWith('BUILD_HEADER_BOX: header-boxless — ') ?? false),
      `the green build's header -> ${headerGreen ?? 'agrees'}; width one float32 step up -> ${wider?.problem ?? 'no build'}; no width -> ${boxless?.problem?.slice(0, 60) ?? 'no build'}`,
      "rigc 2.2.0 moved the header from the stage to the setup-pose box, which is what the atlas instrument reads a build's figure from; it holds the four to getBounds at rigc's own rounding and nothing looser, so a header one float32 step off — the smallest change the format can carry — is a named disagreement quoting both boxes, not a figure",
    );

    // A stale file where build writes: it must be gone after a refusal, not left looking current.
    const stale = join(dir, 'stale');
    mkdirSync(join(stale, 'check'), { recursive: true });
    writeFileSync(join(stale, 'check', 'check.json'), '{"PASS": true}\n');
    writeFileSync(join(stale, 'idle.gif'), 'stale');
    writeFileSync(join(stale, 'keep.txt'), 'not build\'s');
    const still = runCli(buildArgs(dir, stale, 'still.json'));
    const stillTree = entries(stale);
    const rigFail = still.out.split('\n').find((l) => l.startsWith('[rig]   FAIL  RIG_RIGC_GREEN: ')) ?? null;
    say(
      'BU02_A_RIG_THAT_RIGC_REFUSES_STOPS_THE_BUILD_AT_RIG_WITH_RIGC_S_OWN_LINE_AND_NOTHING_AFTER_IT',
      still.status === 1 &&
        rigFail !== null &&
        rigFail.includes('declares duration 1s but its last key is at 0s') &&
        still.out.includes('build: stopped at rig; no later stage ran') &&
        !still.out.includes('[check]') &&
        stillTree.join(',') === 'keep.txt,parts,parts.json,recomposite_error_rig.png,recomposite_rig.png',
      `exit ${still.status}; ${rigFail ?? 'no [rig] FAIL line'}; --out afterwards [${stillTree.join(', ')}] (a planted check/check.json and idle.gif were there before, and keep.txt, which build does not own)`,
      'emit only after green, across stages: a red stage stops everything after it, its own refusal is what is printed, and a file an earlier run left where build writes is cleared rather than left beside the refusal looking current',
    );

    const early = join(dir, 'early');
    const wrong = runCli(buildArgs(dir, early, 'wrongtag.json'));
    const planFail = wrong.out.split('\n').find((l) => l.startsWith('[assemble]   FAIL  ASSEMBLE_PLAN_TAG_IN_RUN: ')) ?? null;
    const noOut = runCli(buildArgs(dir, early).slice(0, -2));
    const badSeam = runCli([...buildArgs(dir, early), '--seam', 'whiteish']);
    const badProject = runCli([...buildArgs(dir, early), '--project', 'eroded']);
    say(
      'BU03_AN_ASSEMBLE_REFUSAL_STOPS_THE_BUILD_FIRST_AND_A_MALFORMED_CALL_IS_A_USAGE_ERROR',
      wrong.status === 1 &&
        planFail !== null &&
        planFail.includes('no layer "wings"') &&
        wrong.out.includes('build: stopped at assemble; no later stage ran') &&
        !wrong.out.includes('[rig]') &&
        entries(early).length === 0 &&
        noOut.status === 2 &&
        noOut.out.includes('build needs --out') &&
        badSeam.status === 2 &&
        badSeam.out.includes('--seam whiteish') &&
        badProject.status === 2 &&
        badProject.out.includes('--project eroded; one of core, visible is required') &&
        entries(early).length === 0,
      `plan tag absent -> exit ${wrong.status}, ${planFail ?? 'no [assemble] FAIL line'}, --out holds [${entries(early).join(', ')}]; no --out -> exit ${noOut.status}; --seam whiteish -> exit ${badSeam.status}; --project eroded -> exit ${badProject.status}, "${badProject.out.split('\n').find((l) => l.includes('--project')) ?? ''}"`,
      'the first stage refuses by name under its own prefix and writes nothing; exit 2 stays the malformed call, as for every other command',
    );

    // The hem fixture with a patch (issue #28), end to end: the patch survives
    // the build because it is config, its slot is where its draw put it, and
    // the gates and bars see an ordinary region.
    const hemDir = join(dir, 'hem');
    const hemCfg = assembleConfig({ plan: HEM_PLAN, extend: [], patches: [{ name: 'hem', box: HEM_UNDER, alpha: 'box', draw: 'back' }] });
    hemCfg.bones = [
      { name: 'anchor', parent: 'root', at: [0, 0] },
      { name: 'chest', parent: 'root', at: [32, 8] },
      { name: 'skirt', parent: 'root', at: [32, 40] },
    ];
    hemCfg.regions = { ...(hemCfg.regions as Record<string, string>), topwear: 'chest', bottomwear: 'skirt' };
    hemCfg.motion = {
      duration: 1,
      tracks: [
        { bone: 'chest', prop: 'translatey', amp: 1, period: 1, phase: 0 },
        { bone: 'skirt', prop: 'rotate', amp: 8, period: 1, phase: 0 },
      ],
    };
    writeAssembleFixture(hemDir, hemCfg, hemPainting(), { full: HEM_FULL, head: FRAMED_HEAD });
    const unpatched = assemble({ ...fixtureInput(hemDir), patches: [], seamRule: 'near-white' });
    const hemOut = join(hemDir, 'out');
    const hemBuild = runCli(buildArgs(hemDir, hemOut));
    const hemParts = existsSync(join(hemOut, 'parts.json')) ? readParts(join(hemOut, 'parts.json')) : null;
    const hemRig = readJsonFile(join(hemOut, 'rig', 'rig.json'));
    const hemCheck = readJsonFile(join(hemOut, 'check', 'check.json'));
    const slotNames = Array.isArray(hemRig?.slots) ? (hemRig.slots as Array<{ name: string; bone: string }>).map((q) => q.name) : [];
    const firstSlot = Array.isArray(hemRig?.slots) ? (hemRig.slots as Array<{ name: string; bone: string }>)[0] : undefined;
    const uncoveredLine = hemBuild.out.split('\n').find((l) => l.includes('uncovered error px:')) ?? '';
    const wantUncovered = unpatched.figures.uncoveredErrorPx - HEM_UNDER_DROP;
    say(
      'BU04_A_PATCH_IN_THE_CONFIG_IS_ASSEMBLED_RIGGED_AND_CHECKED_LIKE_ANY_REGION_PART',
      hemBuild.status === 0 &&
        hemParts?.parts[0].name === 'hem' &&
        hemParts.parts[0].from === 'painting:hem' &&
        hemParts.parts[0].opaque_px === HEM_UNDER_PX &&
        slotNames.join(',') === 'hem,topwear,bottomwear' &&
        firstSlot?.bone === 'anchor' &&
        hemCheck?.PASS === true &&
        uncoveredLine.trim().endsWith(`uncovered error px: ${wantUncovered}`),
      `exit ${hemBuild.status}; parts.json first part ${hemParts?.parts[0].name} (${hemParts?.parts[0].from}, ${hemParts?.parts[0].opaque_px} px of ${HEM_UNDER_PX}); rig slots ${slotNames.join(', ')}, the first on ${firstSlot?.bone}; check.json PASS ${String(hemCheck?.PASS)}; "${uncoveredLine.trim()}", and without the patch the stage measures ${unpatched.figures.uncoveredErrorPx}, less the hand-derived ${HEM_UNDER_DROP} (want ${wantUncovered})`,
      'issue #28 fixed the hole by adding a region to rig.json and PNGs by hand after build, which the next build deleted; as config it is rebuilt every time, recorded as what it is, and held to every gate an ordinary part is',
    );

    // Issue #70, the rig side of "read by nothing": the two green builds above
    // (BU01's, with --loop, and the patch build) again from the same configs
    // with x- records written into every object the loader vouches for, and
    // BU01's once more with one real value changed besides, which must differ.
    const records = withRecords(moving);
    const hemRecords = withRecords(hemCfg);
    const plantCfg = withRecords(moving).cfg;
    ((plantCfg.motion as { tracks: Array<Record<string, unknown>> }).tracks[1]).amp = 3;
    writeFileSync(join(dir, 'records.json'), `${JSON.stringify(records.cfg, null, 2)}\n`);
    writeFileSync(join(dir, 'records-plant.json'), `${JSON.stringify(plantCfg, null, 2)}\n`);
    writeFileSync(join(hemDir, 'records.json'), `${JSON.stringify(hemRecords.cfg, null, 2)}\n`);
    const recOut = join(dir, 'out-records');
    const plantOut = join(dir, 'out-records-plant');
    const hemRecOut = join(hemDir, 'out-records');
    const recRun = runCli([...buildArgs(dir, recOut, 'records.json'), '--loop']);
    const plantRun = runCli([...buildArgs(dir, plantOut, 'records-plant.json'), '--loop']);
    const hemRecRun = runCli(buildArgs(hemDir, hemRecOut, 'records.json'));
    const recDiff = treeDiff(out, recOut);
    const hemRecDiff = treeDiff(hemOut, hemRecOut);
    const plantDiff = treeDiff(out, plantOut);
    const recFiles = existsSync(recOut) ? filesUnder(recOut).length : 0;
    const hemRecFiles = existsSync(hemRecOut) ? filesUnder(hemRecOut).length : 0;
    say(
      'BU08_X_RECORDS_IN_EVERY_VOUCHED_OBJECT_LEAVE_EVERY_FILE_A_BUILD_WRITES_BYTE_IDENTICAL_AND_ONE_TRACK_VALUE_DOES_NOT',
      recRun.status === 0 && hemRecRun.status === 0 && plantRun.status === 0 && recDiff.length === 0 && hemRecDiff.length === 0 && plantDiff.some((d) => d.startsWith(join('rig', 'motion.json'))),
      `records (an object, an array, a number, null, and x-seed_note holding an object) at ${records.at.join(', ')}: build --loop -> exit ${recRun.status}, ${recFiles} file(s), against BU01's ${recDiff.length === 0 ? 'byte-identical' : recDiff.slice(0, 3).join(' | ')}; records at ${hemRecords.at.filter((w) => !records.at.includes(w)).join(', ')} besides, in the patch build -> exit ${hemRecRun.status}, ${hemRecFiles} file(s), against BU04's ${hemRecDiff.length === 0 ? 'byte-identical' : hemRecDiff.slice(0, 3).join(' | ')}; planted, the skirt track's amp 2 -> 3 besides -> exit ${plantRun.status}, ${plantDiff.length === 0 ? 'IDENTICAL, so the comparison sees nothing' : `${plantDiff.length} file(s) differ, e.g. ${plantDiff.find((d) => d.startsWith(join('rig', 'motion.json'))) ?? plantDiff[0]}`}`,
      'issue #70: a record is read by nothing, which is a claim about every output, so it is held to every file the furthest stage writes — parts, the rig, the packed build, check.json and the loop — and the plant is the witness that a real value moving does reach those files',
    );

    const wrongHome = runCli(['check', '--rig', join(hemOut, 'rig'), '--parts', join(hemOut, 'parts'), '--out', join(hemDir, 'check2')]);
    const homeLine = wrongHome.out.split('\n').find((l) => l.includes('CHECK_INPUT_PRESENT')) ?? '';
    const help = runCli(['--help']);
    say(
      'BU05_CHECK_PARTS_GIVEN_THE_PARTS_DIRECTORY_ITSELF_SAYS_WHAT_PARTS_IS_AND_NAMES_THE_PARENT',
      wrongHome.status === 1 && homeLine.includes(PARTS_HOME_SENTENCE) && homeLine.includes(`${hemOut} holds parts.json, so --parts ${hemOut} is the directory meant`) && help.out.includes(PARTS_HOME_SENTENCE) && !existsSync(join(hemDir, 'check2', 'check.json')),
      `check --parts <out>/parts -> exit ${wrongHome.status}: ${homeLine.trim()}; --help carries the sentence: ${help.out.includes(PARTS_HOME_SENTENCE)}`,
      'issue #28 item 3: two attempts passed parts/ itself before the tool said anything useful; the refusal and the help now say the same sentence, and the refusal points at the parent that holds parts.json',
    );

    // The artifact beside rigc's model document (spine-rigc writes skeleton.model.json since 1.6): three paths, the
    // document not counted as a second skeleton; a second skeleton JSON beside it is still refused naming both.
    const art = join(dir, 'artifact');
    mkdirSync(art, { recursive: true });
    for (const f of ['skeleton.json', 'skeleton.atlas', 'skeleton.png', RIGC_MODEL_DOCUMENT]) writeFileSync(join(art, f), '');
    const artPack = parsePackLines(['  ..    pack: skeleton.png 4x4, 1 region(s), 50.0% covered, padding 2, page edges free']);
    const withModel = artifactPaths(art, artPack).map((a) => relative(art, a));
    writeFileSync(join(art, 'other.json'), '');
    const twoJson = refusals(() => artifactPaths(art, artPack));
    say(
      'BU06_RIGCS_MODEL_DOCUMENT_BESIDE_THE_ARTIFACT_IS_NOT_A_SECOND_SKELETON_AND_A_SECOND_SKELETON_STILL_IS',
      withModel.join(',') === 'skeleton.json,skeleton.atlas,skeleton.png' &&
        twoJson !== null &&
        twoJson.problems.length === 1 &&
        twoJson.problems[0].code === 'BUILD_ARTIFACT_PRESENT' &&
        twoJson.problems[0].detail.startsWith('holds 2 .json file(s) [other.json, skeleton.json]'),
      `with ${RIGC_MODEL_DOCUMENT} beside: ${withModel.join(', ')}; with other.json beside too: ${codes(twoJson)} — ${twoJson?.problems[0]?.detail ?? ''}`,
      `spine-rigc writes ${RIGC_MODEL_DOCUMENT} after the same gate as the pair, and the artifact stage refused every green build as holding two skeleton JSON files; the document is named and set aside, and nothing else is`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// chain: build on every fetched public example, against its expected/
// ---------------------------------------------------------------------------

/**
 * Where two parsed JSON values differ, as `path: expected X, built Y` lines.
 * `tolerance(path)` may allow a numeric difference at a path: an absolute
 * band, or a number of decimals both sides are rounded to. A difference inside
 * its tolerance is reported in `within`, so a pass says what it forgave.
 */
interface Tolerance {
  abs?: number;
  decimals?: number;
}

function jsonDiffs(expected: unknown, built: unknown, tolerance: (path: string) => Tolerance | null, path = ''): { over: string[]; within: string[] } {
  const over: string[] = [];
  const within: string[] = [];
  const show = (v: unknown): string => (v === undefined ? 'absent' : JSON.stringify(v));
  const walk = (a: unknown, b: unknown, at: string): void => {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) over.push(`${at}: expected ${a.length} item(s), built ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${at}[${i}]`);
      return;
    }
    if (typeof a === 'object' && a !== null && !Array.isArray(a) && typeof b === 'object' && b !== null && !Array.isArray(b)) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      for (const k of ka) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at === '' ? k : `${at}.${k}`);
      for (const k of kb) if (!ka.includes(k)) over.push(`${at === '' ? k : `${at}.${k}`}: expected absent, built ${show((b as Record<string, unknown>)[k])}`);
      return;
    }
    if (a === b) return;
    const tol = typeof a === 'number' && typeof b === 'number' ? tolerance(at) : null;
    if (tol !== null && typeof a === 'number' && typeof b === 'number') {
      const inside = tol.decimals !== undefined ? a.toFixed(tol.decimals) === b.toFixed(tol.decimals) : Math.abs(a - b) <= (tol.abs ?? 0) + 1e-12;
      if (inside) {
        within.push(`${at} ${a} vs ${b}`);
        return;
      }
    }
    over.push(`${at}: expected ${show(a)}, built ${show(b)}`);
  };
  walk(expected, built, path);
  return { over, within };
}

/**
 * The tolerances, each one measured and each one narrow:
 *
 * - parts.json — every count exact except `seam_override_px`, ±1. The assemble
 *   oracle (the ten reference characters, 2,282 of 2,288 fields exact) traced
 *   every one of its six misses to one cause: cv2 accumulates `warpAffine` in
 *   float32 and `src/raster/warp.ts` in float64, so an alpha the reference
 *   truncates to 254 is 255 here, and that pixel's composite difference lands
 *   on the seam limit's other side. On the two public examples it is one field:
 *   demo's `sleeves`, 4616 expected and 4615 built. `visible_px`,
 *   `occluded_px` and `visible_not_projected_px` have no reference value: the
 *   expected ones are this port's default build's, inserted beside the
 *   reference's fields, and are held exactly like the rest.
 * - motion.json — key times `t` to 6 decimals: the reference's blink times
 *   carried float64 sums (2.3699999999999997) that this port writes rounded
 *   (2.37). Since issue #32 lengthened the blink's hold the expected files are
 *   this port's own `build` output, which writes no such sum; the band stays
 *   because it is still the precision the rig stage writes times to.
 * - check.json — `seam_mean` ±0.005, every other field exact, the judgement
 *   lines included. Until issue #11 the file was the reference's, and the seam
 *   was measured on the parts this chain assembled, which are the reference's
 *   to within one level on a few pixels (above), so the mean moved in the third
 *   place: reference 0.209 vs 0.207 on sample, 0.328 vs 0.326 on demo. The
 *   reference has no judgement lines, so the file is now regenerated by this
 *   port's `build` and carries its own seam mean; the band stays, because it is
 *   the size of that measured parts difference. The check oracle itself is
 *   exact (0 difference) when handed the reference's own parts.
 */
function chainTolerance(file: string): (path: string) => Tolerance | null {
  if (file === 'parts.json') return (p) => (/^parts\[\d+\]\.seam_override_px$/.test(p) ? { abs: 1 } : null);
  if (file === 'motion.json') return (p) => (/\.t$/.test(p) ? { decimals: 6 } : null);
  if (file === 'check.json') return (p) => (p === 'seam_mean' ? { abs: 0.005 } : null);
  return () => null;
}

/** parts.json's records are named by part in a diff, not by index alone. */
function namedPartsPath(parts: PartsFile, line: string): string {
  return line.replace(/^parts\[(\d+)\]/, (m, i: string) => `${m} ${parts.parts[Number(i)]?.name ?? '?'}`);
}

/** Two text files line by line: the first differing line, or null when equal. */
function firstLineDiff(expected: string, built: string): string | null {
  const a = expected.replace(/\n$/, '').split('\n');
  const b = built.replace(/\n$/, '').split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}: expected ${JSON.stringify(a[i] ?? '(end of file)')}, built ${JSON.stringify(b[i] ?? '(end of file)')}`;
  }
  return null;
}

function readJsonAt(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function summarise(d: { over: string[]; within: string[] }, limit = 3): string {
  const over = d.over.length === 0 ? 'no difference over tolerance' : `${d.over.length} over tolerance: ${d.over.slice(0, limit).join('; ')}${d.over.length > limit ? '; …' : ''}`;
  return `${over}${d.within.length > 0 ? `; ${d.within.length} within: ${d.within.slice(0, limit).join('; ')}${d.within.length > limit ? '; …' : ''}` : ''}`;
}

function runChainSuite(): number | null {
  section('chain: build on every fetched example, against its expected/');
  const found = exampleDirs().filter((d) => existsSync(join(d, 'inputs', 'layers', 'head')));
  if (found.length === 0) {
    console.log('  SKIP  no fetched example (examples/<key>/config.json + inputs/painting.png + inputs/layers/{full,head}), so the chain assemble -> rig -> check ran on no real painting');
    console.log('          ⚠️ This is a HOLE in this run, not a pass — run `bun run fetch-examples` (CI does) to compare the whole chain with each expected/.');
    return null;
  }
  const { say, bad } = counter();
  const dir = temp('chain');
  let planted: { key: string; out: string; exp: string } | null = null;
  try {
    for (const ex of found) {
      const key = relative(join(ROOT, 'examples'), ex);
      const exp = join(ex, 'expected');
      const out = join(dir, key);
      const inputs = join(ex, 'inputs');
      const r = runCli(['build', '--config', join(ex, 'config.json'), '--source', join(inputs, 'painting.png'), '--full', join(inputs, 'layers', 'full'), '--head', join(inputs, 'layers', 'head'), '--out', out]);
      const tail = lastLines(r.out, 4);
      const stopped = r.out.split('\n').find((l) => l.startsWith('build: stopped at')) ?? null;
      const refusal = r.out.split('\n').filter((l) => /^\[[a-z]+\] {3}FAIL {2}/.test(l)).slice(0, 3);
      say(
        `CH01_BUILD_IS_GREEN_AND_ENDS_WITH_THE_ARTIFACT[${key}]`,
        r.status === 0 && tail.length === 4 && tail[0].trim().startsWith('pack: ') && tail.slice(1).every((l) => existsSync(l.trim())),
        r.status === 0 ? `exit 0; ${tail.map((l) => l.trim().replace(`${out}/`, '')).join(' | ')}` : `exit ${r.status}; ${stopped ?? 'no stop line'}; ${refusal.join(' | ') || lastLines(r.out, 3).join(' | ')}`,
        'a fetched example is a published claim that the pipeline takes this painting to a green rig; this run keeps the claim true end to end',
      );
      if (r.status !== 0) continue;
      if (planted === null) planted = { key, out, exp };

      const expParts = readParts(join(exp, 'parts.json'));
      const parts = jsonDiffs(readJsonAt(join(exp, 'parts.json')), readJsonAt(join(out, 'parts.json')), chainTolerance('parts.json'));
      const named = { over: parts.over.map((l) => namedPartsPath(expParts, l)), within: parts.within.map((l) => namedPartsPath(expParts, l)) };
      say(
        `CH02_PARTS_JSON_IS_THE_EXPECTED_FIELD_BY_FIELD[${key}]`,
        parts.over.length === 0,
        `${expParts.parts.length} part(s): ${summarise(named)}`,
        'every count exact but seam_override_px, ±1 — the float32/float64 warp accumulation the assemble oracle traced every miss to (see chainTolerance)',
      );

      const rigFiles = ['rig.json', 'motion.json', 'mesh_report.json'].map((f) => [f, jsonDiffs(readJsonAt(join(exp, f)), readJsonAt(join(out, 'rig', f)), chainTolerance(f))] as const);
      say(
        `CH03_RIG_MOTION_AND_MESH_REPORT_ARE_THE_EXPECTED_AS_PARSED_VALUES[${key}]`,
        rigFiles.every(([, d]) => d.over.length === 0),
        rigFiles.map(([f, d]) => `${f}: ${summarise(d)}`).join(' | '),
        "the rig stage is exact against the reference given the same parts, but for the blink's two hold-end and two open-end key times per example, which issue #32 moved on purpose (expected/motion.json is regenerated by build since); motion key times are compared to 6 decimals, the precision the rig stage writes",
      );

      const check = jsonDiffs(readJsonAt(join(exp, 'check.json')), readJsonAt(join(out, 'check', 'check.json')), chainTolerance('check.json'));
      say(
        `CH04_CHECK_JSON_IS_THE_EXPECTED_FIELD_BY_FIELD[${key}]`,
        check.over.length === 0,
        summarise(check),
        'gates, loop, both seam pixel counts and every judgement figure exact; seam_mean ±0.005, the measured size of the parts difference against the reference (see chainTolerance)',
      );

      const builtCheck = readJsonAt(join(out, 'check', 'check.json')) as Record<string, unknown>;
      const statuses = JUDGEMENT_LINES.map((n) => `${n} ${lineStatus(builtCheck, n) ?? 'absent'}`);
      say(
        `CH08_EVERY_JUDGEMENT_LINE_MEASURES_THE_EXAMPLE_AND_PASSES[${key}]`,
        JUDGEMENT_LINES.every((n) => lineStatus(builtCheck, n) === 'PASS') && JUDGEMENT_LINES.every((n) => r.out.includes(`[check]   ${n}: PASS — `)),
        statuses.join(', '),
        "issue #11's positive control: a published example has a torso, feet, eyes, chains and a skirt, so no judgement line may SKIP on it, and each bar was set so both examples clear it (AUTHORING §7 quotes the margin)",
      );

      const blinkFig = builtCheck.BLINK_NO_HOLE as { closed?: string[]; idle_frames_closed?: number[]; hole_px?: number } | undefined;
      const shownClosed = blinkFig?.idle_frames_closed ?? [];
      const windows = (blinkFig?.closed ?? []).map((c) => /from ([\d.]+)s to ([\d.]+)s$/.exec(c)).map((m) => (m === null ? null : [Number(m[1]), Number(m[2])] as const));
      say(
        `CK20_THE_IDLE_FRAMES_SHOW_THE_CLOSED_EYE_AND_EACH_ONE_LIES_IN_THE_HOLD[${key}]`,
        shownClosed.length > 0 && windows.length > 0 && windows.every((w) => w !== null && shownClosed.every((k) => k / IDLE_FPS >= w[0] - 1e-9 && k / IDLE_FPS <= w[1] + 1e-9)) && blinkFig?.hole_px === 0,
        `idle_frames_closed ${JSON.stringify(shownClosed)} at ${IDLE_FPS} fps (${shownClosed.map((k) => (k / IDLE_FPS).toFixed(6)).join(', ') || 'none'} s) against ${(blinkFig?.closed ?? []).join('; ') || 'no closed window'}; hole ${blinkFig?.hole_px} px`,
        "issue #32: the loop is encoded from these frames, so a blink no frame lands in is a blink the idle frames, the contact sheet and the README's animation never show; with BLINK.hold at one frame or more (MO20) every example's blink.t has one",
      );

      const gates = ['gate_spine-html.txt'].map((f) => [f, firstLineDiff(readFileSync(join(exp, f), 'utf8'), readFileSync(join(out, 'check', f), 'utf8'))] as const);
      const pack = parsePackLines(readFileSync(join(out, 'check', 'gate_spine-html.txt'), 'utf8').split('\n'));
      say(
        `CH05_THE_GATE_FILE_IS_THE_EXPECTED_LINE_BY_LINE_AND_THE_PACK_HOLDS_EVERY_PART[${key}]`,
        gates.every(([, d]) => d === null) && pack.length === 1 && pack[0].regions === expParts.parts.length,
        `${gates.map(([f, d]) => `${f}: ${d ?? 'identical'}`).join('; ')}; ${pack.map((p) => p.line).join(', ') || 'no pack line'} for ${expParts.parts.length} part(s)`,
        "issue #2's control: the pack line is one of the gate lines, so its page size, region count and coverage are held exactly (tolerance 0), and one region per part is asserted by itself",
      );

      // The one gate: rigc's build under spine-html measures every rule validate under spine would. Run here,
      // where spine-core is present (the full entry), on this example's own rig; validate is not a stage any more.
      const subsetDir = join(dir, `${key}-subset`);
      const subBuild = spawnSync(findRigc(ROOT, ''), ['build', '--rig', join(out, 'rig', 'rig.json'), '--motion', join(out, 'rig', 'motion.json'), '--out', subsetDir, ...packedBuildArgs(DEFAULT_PACK_MODE)], { encoding: 'utf8', maxBuffer: 1 << 28 });
      const subValidate = spawnSync(findRigc(ROOT, ''), ['validate', subsetDir, '--profile', 'spine'], { encoding: 'utf8', maxBuffer: 1 << 28 });
      const builtRules = measuredRules(`${subBuild.stdout ?? ''}${subBuild.stderr ?? ''}`);
      const validRules = measuredRules(`${subValidate.stdout ?? ''}${subValidate.stderr ?? ''}`);
      const outside = validRules.filter((r) => !builtRules.includes(r));
      say(
        `CH09_VALIDATE_UNDER_SPINE_MEASURES_NO_RULE_THE_SPINE_HTML_BUILD_DOES_NOT[${key}]`,
        subBuild.status === 0 && subValidate.status === 0 && builtRules.length > 0 && validRules.length > 0 && outside.length === 0,
        `build exit ${subBuild.status}, ${builtRules.length} rule(s) measured; validate --profile spine exit ${subValidate.status}, ${validRules.length} rule(s) measured; ${outside.length === 0 ? 'every one of them is in the build\'s set' : `outside the build's set: ${outside.join(', ')}`}`,
        "the rig and check stages dropped their second gate, `rigc validate <build> --profile spine`, because it measured nothing the build had not; this control is that measurement, run on every fetched example, so the day spine gains a rule spine-html lacks it goes red here rather than being lost",
      );

      let proposal: string;
      let proposalOk = false;
      try {
        const P = readPartSet(out);
        const prop = propose(P);
        checkProposal(P, prop);
        const d = jsonDiffs(readJsonAt(join(ex, 'proposal.json')), JSON.parse(serializeProposal(prop)) as unknown, () => null);
        proposalOk = d.over.length === 0;
        proposal = summarise(d);
      } catch (err) {
        proposal = `refused or crashed: ${(err as Error).message.split('\n')[0]}`;
      }
      say(
        `CH06_PROPOSE_ON_THE_BUILT_PARTS_IS_THE_TRACKED_PROPOSAL[${key}]`,
        proposalOk,
        proposal,
        "the tracked proposal.json is what the reference proposer wrote from the reference's parts; the port's proposer on the port's parts must write the same, which is the proposer's half the examples could not reach before a build existed",
      );
    }

    // CH09's comparator, planted: a validate line set carrying a rule the build's set lacks is named, and the
    // spine-html superset (the measured shape, PROF and SKIP lines not counted) is not.
    const plantBuild = '  PASS  A07_ATLAS_TEXT_SHAPE\n  PASS  A15_IDLE_NO_MESH_BONE_KEYS\n  SKIP  A13_MESH_BUDGET: none\n  ..    2 assertions: 2 measured (2 passed, 0 failed)\n  PASS  A07_ATLAS_TEXT_SHAPE\n';
    const plantSubset = measuredRules('  PASS  A07_ATLAS_TEXT_SHAPE\n  PROF  A15_IDLE_NO_MESH_BONE_KEYS: renderer rule, not in profile "spine"\n').filter((r) => !measuredRules(plantBuild).includes(r));
    const plantExtra = measuredRules('  PASS  A07_ATLAS_TEXT_SHAPE\n  FAIL  A99_A_RULE_ONLY_SPINE_HAS: x\n').filter((r) => !measuredRules(plantBuild).includes(r));
    say(
      'CH10_A_VALIDATE_RULE_THE_BUILD_DID_NOT_MEASURE_IS_NAMED_AND_THE_SUPERSET_IS_NOT',
      measuredRules(plantBuild).join(',') === 'A07_ATLAS_TEXT_SHAPE,A15_IDLE_NO_MESH_BONE_KEYS' && plantSubset.length === 0 && plantExtra.join(',') === 'A99_A_RULE_ONLY_SPINE_HAS',
      `build set ${measuredRules(plantBuild).join(', ')}; a subset with a PROF line -> outside ${plantSubset.join(', ') || 'none'}; a FAIL on a rule the build lacks -> outside ${plantExtra.join(', ') || 'none'}`,
      "CH09 passes when nothing is outside; this is the half that shows a rule outside would be found, and that a PROF or SKIP line is not counted as measured",
    );

    // The comparators themselves, planted: each difference must be named, and a difference inside its tolerance must not be.
    if (planted !== null) {
      const { out, exp } = planted;
      const rig = readJsonAt(join(out, 'rig', 'rig.json')) as { skins: { default: Record<string, Record<string, { weights?: Array<Array<{ weight: number }>> }>> } };
      let weightPath = '';
      for (const [slot, atts] of Object.entries(rig.skins.default)) {
        for (const [name, att] of Object.entries(atts)) {
          if (weightPath === '' && att.weights !== undefined && att.weights[0]?.length > 0) {
            att.weights[0][0].weight += 0.01;
            weightPath = `skins.default.${slot}.${name}.weights[0][0].weight`;
          }
        }
      }
      const rigPlant = jsonDiffs(readJsonAt(join(exp, 'rig.json')), rig, chainTolerance('rig.json'));
      const partsBuilt = readJsonAt(join(out, 'parts.json')) as { parts: Array<{ seam_override_px: number }> };
      partsBuilt.parts[0].seam_override_px += 2;
      const partsPlant = jsonDiffs(readJsonAt(join(exp, 'parts.json')), partsBuilt, chainTolerance('parts.json'));
      const checkBuilt = readJsonAt(join(out, 'check', 'check.json')) as { seam_mean: number; BREATH_VISIBLE: { torso_heat_mean: number } };
      checkBuilt.seam_mean += 0.01;
      checkBuilt.BREATH_VISIBLE.torso_heat_mean += 0.001;
      const checkPlant = jsonDiffs(readJsonAt(join(exp, 'check.json')), checkBuilt, chainTolerance('check.json'));
      const gateText = readFileSync(join(out, 'check', 'gate_spine-html.txt'), 'utf8');
      const gatePlant = firstLineDiff(readFileSync(join(exp, 'gate_spine-html.txt'), 'utf8'), gateText.replace(/padding (\d+)/, (_, n: string) => `padding ${Number(n) + 1}`));
      const insideTol = jsonDiffs({ parts: [{ seam_override_px: 10 }] }, { parts: [{ seam_override_px: 11 }] }, chainTolerance('parts.json'));
      say(
        'CH07_A_PLANTED_DIFFERENCE_IN_EACH_COMPARED_FILE_IS_NAMED_AND_ONE_INSIDE_ITS_TOLERANCE_IS_NOT',
        weightPath !== '' &&
          rigPlant.over.some((l) => l.startsWith(`${weightPath}:`)) &&
          partsPlant.over.some((l) => l.startsWith('parts[0].seam_override_px:')) &&
          checkPlant.over.some((l) => l.startsWith('seam_mean:')) &&
          checkPlant.over.some((l) => l.startsWith('BREATH_VISIBLE.torso_heat_mean:')) &&
          gatePlant !== null &&
          gatePlant.includes('padding') &&
          insideTol.over.length === 0 &&
          insideTol.within.length === 1,
        `on ${planted.key}: a weight +0.01 -> ${rigPlant.over[0] ?? 'not named'}; seam_override_px +2 -> ${partsPlant.over.find((l) => l.startsWith('parts[0]')) ?? 'not named'}; seam_mean +0.01 -> ${checkPlant.over.find((l) => l.startsWith('seam_mean')) ?? 'not named'}; a judgement figure +0.001 -> ${checkPlant.over.find((l) => l.startsWith('BREATH_VISIBLE.')) ?? 'not named'}; padding +1 in the pack line -> ${gatePlant ?? 'not named'}; a ±1 seam override -> forgiven (${insideTol.within.join('') || 'not reported'})`,
        'a comparator that forgave everything would print the same green; each tolerance is shown to stop exactly where it says it stops',
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// the README loop, run in order on a fresh config (issue #20)
// ---------------------------------------------------------------------------

/** The `spine-parts …` lines of README.md's "The loop, for an agent" block, in order, comments dropped; a string says why none could be read. */
function readmeLoopLines(readme: string): string[] | string {
  const at = readme.indexOf('## The loop, for an agent');
  if (at < 0) return 'README.md has no "## The loop, for an agent" section';
  const open = readme.indexOf('```sh\n', at);
  const close = open < 0 ? -1 : readme.indexOf('\n```', open + 6);
  if (open < 0 || close < 0) return 'the loop section has no ```sh block';
  const lines = readme
    .slice(open + 6, close)
    .split('\n')
    .map((l) => l.replace(/\s+#.*$/, '').trim())
    .filter((l) => l.startsWith('spine-parts '));
  return lines.length === 0 ? 'the loop block holds no spine-parts line' : lines;
}

interface LoopRun {
  /** Each step as `command status`, in the order run. */
  ran: string[];
  /** The first step that did not exit 0, its status and its first FAIL line (or its last line, when it printed none). */
  refused: { line: string; status: number; first: string } | null;
}

/**
 * Run the README's loop lines against one fetched example, in `work`, as an
 * agent following the README would: the See-through runs are the fetched
 * layers, every relative path in a line lands in `work` except the painting and
 * the two runs, and what a `#    ->` comment says to paste into the config is
 * pasted — the head box, the plan, and the proposal's rig sections, nothing
 * else and nothing corrected. The config starts as the state after the first
 * step's own fields are authored: `key`, `seethrough` without `head_box`, and
 * `assemble.rig_scale`, copied from the example's config.
 */
function runReadmeLoop(lines: readonly string[], ex: string, work: string): LoopRun {
  const inputs = join(ex, 'inputs');
  const painting = readPng(join(inputs, 'painting.png'));
  const recorded = JSON.parse(readFileSync(join(ex, 'config.json'), 'utf8')) as { key: string; seethrough: Record<string, unknown>; assemble: { rig_scale: number } };
  const { head_box: _box, ...seethrough } = recorded.seethrough;
  const configPath = join(work, 'config.json');
  const cfg: Record<string, unknown> & { seethrough: Record<string, unknown>; assemble: Record<string, unknown> } = {
    key: recorded.key,
    seethrough,
    assemble: { rig_scale: recorded.assemble.rig_scale },
  };
  mkdirSync(work, { recursive: true });
  const save = (): void => writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  save();
  const fixed: Record<string, string> = {
    'painting.png': join(inputs, 'painting.png'),
    'layers/full': join(inputs, 'layers', 'full'),
    'layers/head': join(inputs, 'layers', 'head'),
    'config.json': configPath,
  };
  const place = (token: string): string => {
    if (token.startsWith('--')) return token;
    if (/^\d+x\d+$/.test(token)) return `${painting.width}x${painting.height}`;
    return fixed[token] ?? join(work, token);
  };
  const ran: string[] = [];
  const known = ['inputs', 'layers', 'sheet', 'propose', 'assemble', 'build'];
  for (const line of lines) {
    const [command, ...rest] = line.split(/\s+/).slice(1);
    const args = [command, ...rest.map(place)];
    if (!known.includes(command)) return { ran, refused: { line, status: -1, first: `"${command}" is not a command this control knows how to run; teach runReadmeLoop what the README says to do with it` } };
    const r = runCli(args);
    ran.push(`${command}${args.includes('--head-box') ? ' --head-box' : args.includes('--propose-plan') ? ' --propose-plan' : args.includes('--from-config') ? ' --from-config' : ''} ${r.status}`);
    if (r.status !== 0) {
      const printed = r.out.split('\n').filter((l) => l.trim() !== '');
      // A refusal's first FAIL line; for a crash, its first error line rather than the runtime's banner.
      const first = printed.find((l) => /FAIL {2}/.test(l)) ?? printed.find((l) => /\b(?:[A-Z]+[a-z]*Error|E[A-Z]{3,}):/.test(l)) ?? printed[printed.length - 1] ?? '(nothing printed)';
      return { ran, refused: { line, status: r.status, first: first.trim() } };
    }
    const out = (): string => args[args.indexOf('--out') + 1];
    if (command === 'propose' && args.includes('--head-box')) {
      const last = r.out.split('\n').filter((l) => l.trim() !== '').pop() ?? '';
      cfg.seethrough.head_box = (JSON.parse(last) as { head_box: unknown }).head_box;
      save();
    } else if (command === 'assemble' && args.includes('--propose-plan')) {
      const p = JSON.parse(r.out) as { plan: unknown; extend_below_crop: unknown };
      cfg.assemble.plan = p.plan;
      cfg.assemble.extend_below_crop = p.extend_below_crop;
      save();
    } else if (command === 'propose' && !args.includes('--from-config') && !args.includes('--compare')) {
      const p = JSON.parse(readFileSync(join(out(), 'proposal.json'), 'utf8')) as Record<string, unknown>;
      for (const k of ['bones', 'meshes', 'regions', 'motion']) cfg[k] = p[k];
      save();
    }
  }
  return { ran, refused: null };
}

function runReadmeLoopSuite(): number | null {
  section('readme-loop: the README\'s loop, in order, on a fresh config, on every fetched example');
  const found = exampleDirs().filter((d) => existsSync(join(d, 'inputs', 'layers', 'head')));
  if (found.length === 0) {
    console.log('  SKIP  no fetched example (examples/<key>/config.json + inputs/painting.png + inputs/layers/{full,head}), so the README loop ran on no painting');
    console.log('          ⚠️ This is a HOLE in this run, not a pass — run `bun run fetch-examples` (CI does) to follow the README from a fresh config.');
    return null;
  }
  const { say, bad } = counter();
  const lines = readmeLoopLines(readFileSync(join(ROOT, 'README.md'), 'utf8'));
  const dir = temp('readme-loop');
  try {
    if (typeof lines === 'string') {
      say('RL01_THE_README_LOOP_RUNS_IN_ORDER_ON_A_FRESH_CONFIG', false, lines, '');
      return bad();
    }
    for (const ex of found) {
      const key = relative(join(ROOT, 'examples'), ex);
      const r = runReadmeLoop(lines, ex, join(dir, key));
      say(
        `RL01_THE_README_LOOP_RUNS_IN_ORDER_ON_A_FRESH_CONFIG[${key}]`,
        r.refused === null && r.ran.length === lines.length,
        r.refused === null
          ? `${r.ran.length} README step(s) in order, each exit 0: ${r.ran.join(', ')}; the config started with key, seethrough (no head_box) and assemble.rig_scale, and got the head box, the plan and the proposal's four rig sections pasted, uncorrected`
          : `step ${r.ran.length + (r.refused.status === -1 ? 1 : 0)} of ${lines.length} refused (exit ${r.refused.status}): \`${r.refused.line}\` — ${r.refused.first}`,
        'issue #20: the README loop is what an agent follows, so it is run as written; plain assemble once refused the config for the four sections the next step drafts, and the only way past was a stub of invented rig fields',
      );
    }
    // The planted order: assemble before the plan exists. It must stop at
    // that step, name it, and quote the loader's line — the reporter has to be
    // seen naming a refusal, and the refusal has to say which command writes a plan.
    const assembleAt = lines.findIndex((l) => /^spine-parts assemble /.test(l) && !l.includes('--propose-plan'));
    const planAt = lines.findIndex((l) => l.includes('--propose-plan'));
    const early = assembleAt > planAt && planAt >= 0 ? [...lines.slice(0, planAt), lines[assembleAt]] : null;
    const planted = early === null ? null : runReadmeLoop(early, found[0], join(dir, 'planted'));
    const unknown = runReadmeLoop(['spine-parts animate --config config.json'], found[0], join(dir, 'unknown'));
    const plantedLine = planted?.refused?.first ?? '';
    say(
      'RL02_AN_ASSEMBLE_BEFORE_ITS_PLAN_AND_A_LINE_THE_CONTROL_CANNOT_RUN_ARE_NAMED_AS_THE_STEP_THAT_STOPPED',
      planted !== null &&
        planted.refused !== null &&
        planted.refused.line === lines[assembleAt] &&
        plantedLine.startsWith('FAIL  CONFIG_FIELD_PRESENT: config.assemble.plan') &&
        plantedLine.includes('assemble --propose-plan') &&
        unknown.refused !== null &&
        unknown.refused.status === -1 &&
        unknown.ran.length === 0,
      `the README's steps up to --propose-plan, then plain assemble -> ${planted === null ? 'the README has no such pair' : `stopped at \`${planted.refused?.line ?? 'nothing'}\`: ${plantedLine}`}; an unknown "animate" line -> ${unknown.refused?.first ?? 'ran'}`,
      'a control that has never been seen to stop is not a control; the planted order is also the message an agent meets when it skips --propose-plan',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// the assemble stage
// ---------------------------------------------------------------------------

/**
 * Where docs/AUTHORING.md §4's table of loaders disagrees with
 * `CONFIG_REQUIRES`: a loader with no row, a row for no loader, or a row whose
 * "requires" cell is not that loader's fields in order. Empty is agreement.
 */
function doorTableFaults(guide: string): string[] {
  const lines = guide.split('\n');
  const head = lines.findIndex((l) => /^\| loader \| steps \| requires \|/.test(l));
  if (head < 0) return ['docs/AUTHORING.md has no "| loader | steps | requires |" table'];
  const rows = new Map<string, string[]>();
  for (const l of lines.slice(head + 2)) {
    if (!l.startsWith('|')) break;
    const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    rows.set(cells[0].replace(/`/g, ''), [...(cells[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  }
  const faults: string[] = [];
  for (const [door, fields] of Object.entries(CONFIG_REQUIRES) as Array<[ConfigDoor, readonly string[]]>) {
    const row = rows.get(door);
    if (row === undefined) faults.push(`no row for the ${door} loader`);
    else if (row.join(',') !== fields.join(',')) faults.push(`the ${door} row requires [${row.join(', ')}]; the loader requires [${fields.join(', ')}]`);
  }
  for (const door of rows.keys()) if (!(door in CONFIG_REQUIRES)) faults.push(`a row for "${door}", which is no loader`);
  return faults;
}

function fixtureInput(dir: string, painting = 'painting.png'): Omit<AssembleInput, 'seamRule'> {
  return {
    source: readPng(join(dir, painting)),
    full: readWrapperLayers(join(dir, 'full')),
    head: readWrapperLayers(join(dir, 'head')),
    ...stageFields(loadConfig(join(dir, 'config.json'))),
    projectRule: DEFAULT_PROJECT_RULE,
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

    // The visibility counts, in both projection rules, on the thin-strip fixture (derived in fixtures/assemble_fixture.ts).
    const strip = temp('assemble-strip');
    try {
      writeRun(join(strip, 'full'), STRIP_FULL);
      writeRun(join(strip, 'head'), FRAMED_HEAD);
      writeFileSync(join(strip, 'painting.png'), encodePngBytes(flatPainting()));
      writeFileSync(join(strip, 'config.json'), JSON.stringify(assembleConfig({ plan: STRIP_PLAN, extend: [] })));
      const input = fixtureInput(strip);
      const seen: string[] = [];
      let exact = true;
      for (const rule of PROJECT_RULES) {
        const res = assemble({ ...input, seamRule: 'near-white', projectRule: rule });
        for (const p of res.parts.parts) {
          const got: [number, number, number, number] = [p.visible_px ?? -1, p.occluded_px ?? -1, p.source_px_taken, p.visible_not_projected_px ?? -1];
          const want = STRIP_EXPECTED[rule][p.name];
          if (want === undefined || got.join(',') !== want.join(',') || (p.visible_px ?? -1) + (p.occluded_px ?? -1) !== p.opaque_px) exact = false;
          seen.push(`${rule} ${p.name} vis/occ/taken/unproj ${got.join('/')}`);
        }
      }
      const fixtureAddsUp = result.parts.parts.every((p) => (p.visible_px ?? -1) + (p.occluded_px ?? -1) === p.opaque_px && (p.visible_not_projected_px ?? Infinity) <= (p.visible_px ?? -1));
      say(
        'AS12_A_THIN_VISIBLE_STRIP_IS_UNPROJECTED_UNDER_CORE_AND_PROJECTED_UNDER_VISIBLE',
        exact && seen.length === 4 && fixtureAddsUp,
        `${seen.join('; ')}; visible + occluded = opaque on every part of both fixtures: ${fixtureAddsUp && exact}`,
        "issue #9: a part a few pixels wide has no eroded core, so under the reference's rule every visible pixel of it counts as synthesis; --project visible keeps the erosion only along a rim with a layer in front (topwear's 120 px beside the strip) and takes the rest",
      );
    } finally {
      rmSync(strip, { recursive: true, force: true });
    }

    // The identity refusals, fired by forged masks: visibilityCounts is the one place the counts are made.
    const forgePart = newRaster(4, 4);
    for (let p = 0; p < 8; p++) forgePart.data[p * 4 + 3] = 255; // rows 0..1 opaque
    const visOk = newMask(4, 4);
    for (let p = 0; p < 8; p++) visOk.data[p] = 1;
    const projOk = newMask(4, 4);
    projOk.data[0] = 1;
    const green = refusals(() => visibilityCounts('forge', forgePart, visOk, projOk));
    const visLeak = newMask(4, 4);
    visLeak.data.set(visOk.data);
    visLeak.data[12] = 1; // a transparent pixel marked visible
    const projHidden = newMask(4, 4);
    projHidden.data[0] = 1;
    projHidden.data[9] = 1; // projected, but not in the visible mask
    const leak = refusals(() => visibilityCounts('forge "leak"', forgePart, visLeak, projOk));
    const hidden = refusals(() => visibilityCounts('forge "hidden"', forgePart, visOk, projHidden));
    const leakLine = leak?.problems.find((p) => p.code === 'ASSEMBLE_COUNTS_ADD_UP');
    const hiddenLine = hidden?.problems.find((p) => p.code === 'ASSEMBLE_COUNTS_ADD_UP');
    say(
      'AS13_A_FORGED_MASK_BREAKS_A_COUNT_IDENTITY_AND_IS_REFUSED_BY_NAME',
      green === null && leakLine !== undefined && leakLine.detail.includes('visible 9 + occluded 0 = 9, opaque (alpha above 8) 8') && hiddenLine !== undefined && hiddenLine.detail.includes('1 of 2 projected pixel(s) are not visible'),
      `true masks -> ${green === null ? 'counted' : codes(green)}; a transparent pixel in the visible mask -> ${leakLine === undefined ? codes(leak) : `${leakLine.code}: ${leakLine.object} — ${leakLine.detail}`}; a projected pixel outside it -> ${hiddenLine === undefined ? codes(hidden) : `${hiddenLine.code}: ${hiddenLine.detail}`}`,
      'visible + occluded = opaque and projected within visible hold by construction; a mask that escaped its definition is a bug, so it stops the stage rather than printing a count nobody can reason about',
    );

    // Issue #25: a planted gap between two parts is listed as a hole with its box and both parts; flush parts list none.
    {
      const G = 32;
      const paint = newRaster(G, G);
      paint.data.fill(255);
      for (let y = 4; y < 28; y++) for (let x = 4; x < 28; x++) paint.data.set([...C, 255], (y * G + x) * 4);
      const part = (name: string, x0: number, y0: number, x1: number, y1: number, rgb: readonly number[], pin: ReadonlyArray<[number, number]> = []): PlacedPart => {
        const image = newRaster(x1 - x0, y1 - y0);
        for (let p = 0; p < image.width * image.height; p++) image.data.set([...rgb, 255], p * 4);
        for (const [x, y] of pin) image.data[((y - y0) * image.width + (x - x0)) * 4 + 3] = 0;
        const record = { name, from: 'full:legwear', x: x0, y: y0, w: x1 - x0, h: y1 - y0, opaque_px: 0, projected_core_px: 0, source_px_taken: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
        return { record, image };
      };
      const measure = (ps: PlacedPart[]): ReturnType<typeof measureRecomposite> => measureRecomposite(recomposite(ps, G, G), paint, ps);
      // The legs [4, 15) and [17, 28) x [4, 28): the gap is columns 15..16, rows 4..27 = 2 x 24 = 48 px, and each leg's
      // column beside it (14, and 17) touches it on all 24 rows, so each borders it by 24 px; equal counts keep plan order.
      const gap = measure([part('leg_l', 4, 4, 15, 28, C), part('leg_r', 17, 4, 28, 28, C)]);
      const flush = measure([part('leg_l', 4, 4, 16, 28, C), part('leg_r', 16, 4, 28, 28, C)]);
      // Six single pixels punched out of the left leg at column 6, rows 6, 9, …, 21: seven holes; the largest five are the gap,
      // then the four topmost pinholes, each bordered by the 8 leg pixels round it.
      const pins: Array<[number, number]> = [6, 9, 12, 15, 18, 21].map((y) => [6, y]);
      const pinned = measure([part('leg_l', 4, 4, 15, 28, C, pins), part('leg_r', 17, 4, 28, 28, C)]);
      // A 4x4 patch in a wrong colour over the right leg: covered, and more than 40 off — blue in the map, not a hole.
      const patched = [part('leg_l', 4, 4, 15, 28, C), part('leg_r', 17, 4, 28, 28, C), part('patch', 20, 8, 24, 12, [250, 250, 250])];
      const withPatch = measure(patched);
      const map = recompositeErrorMap(recomposite(patched, G, G), paint, patched);
      const count = (rgb: readonly number[]): number => {
        let n = 0;
        for (let p = 0; p < G * G; p++) if (map.data[p * 4] === rgb[0] && map.data[p * 4 + 1] === rgb[1] && map.data[p * 4 + 2] === rgb[2]) n++;
        return n;
      };
      // luma of C = trunc((299*100 + 587*60 + 114*40 + 500) / 1000) = 70 -> 192 + 17 = 209; of white 255 -> 192 + 63 = 255.
      const hole = gap.holes[0];
      const listedPins = pinned.holes.slice(1).map((h) => `${h.x},${h.y} ${h.px}:${h.borders.map((b) => `${b.part}${b.px}`).join('')}`);
      const lines = holeLines(gap);
      say(
        'AS14_A_PLANTED_GAP_IS_LISTED_WITH_ITS_BOX_AND_BOTH_PARTS_AND_FLUSH_PARTS_LIST_NONE',
        gap.uncoveredErrorPx === 48 &&
          gap.holeCount === 1 &&
          JSON.stringify(hole) === JSON.stringify({ px: 48, x: 15, y: 4, w: 2, h: 24, borders: [{ part: 'leg_l', px: 24 }, { part: 'leg_r', px: 24 }] }) &&
          lines.join('|') === 'uncovered holes (8-connected): 1|  uncovered hole 1: 48 px at 15,4 2x24 (between "leg_l" 24 px, "leg_r" 24 px)' &&
          flush.uncoveredErrorPx === 0 &&
          flush.holeCount === 0 &&
          flush.holes.length === 0 &&
          pinned.holeCount === 7 &&
          pinned.holes.length === HOLES_LISTED &&
          pinned.uncoveredErrorPx === 54 &&
          pinned.holes[0].px === 48 &&
          listedPins.join(' ') === '6,6 1:leg_l8 6,9 1:leg_l8 6,12 1:leg_l8 6,15 1:leg_l8' &&
          withPatch.errorPx === 48 + 16 &&
          withPatch.uncoveredErrorPx === 48 &&
          withPatch.holeCount === 1 &&
          count(MAP_UNCOVERED) === 48 &&
          count(MAP_MISMATCHED) === 16 &&
          count([209, 209, 209]) === 24 * 24 - 48 - 16 &&
          count([255, 255, 255]) === G * G - 24 * 24 &&
          map.data.every((v, i) => i % 4 !== 3 || v === 255),
        `gap: ${lines.join(' / ')}; flush: ${flush.holeCount} hole(s), ${flush.uncoveredErrorPx} uncovered px; six pinholes: ${pinned.holeCount} holes, ${pinned.holes.length} listed, then ${listedPins.join(', ')}; a wrong-colour patch: error ${withPatch.errorPx}, uncovered ${withPatch.uncoveredErrorPx}; map red ${count(MAP_UNCOVERED)}, blue ${count(MAP_MISMATCHED)}, figure grey 209 ${count([209, 209, 209])}, page 255 ${count([255, 255, 255])}`,
        "issue #25: See-through split a skirt into two legs, and the space between them was in no layer; the count said 7671 and nothing said where. The box, the two parts and the red in the map are the where — and a fixture with no gap must list nothing, or the list is noise",
      );
    }

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
      ['a rig scale that makes no rig', 'ASSEMBLE_RIG_SIZE', () => assemble({ ...base, rigScale: 0.001, seamRule: 'near-white' })],
      ['a patch box past the rig', 'ASSEMBLE_PATCH_BOX_INSIDE', () => assemble({ ...base, patches: [{ name: 'hem', box: [0, 60, 65, 64], alpha: 'box', draw: 'back' }], seamRule: 'near-white' })],
      ['a silhouette patch where the painting has no figure', 'ASSEMBLE_PATCH_OPAQUE', () => assemble({ ...base, patches: [{ name: 'hem', box: [0, 60, 4, 64], alpha: 'silhouette', draw: 'back' }], seamRule: 'near-white' })],
      ['a config with no seethrough block', 'ASSEMBLE_FIELD_PRESENT', () => stageFields(parseConfig(assembleConfig({ seethrough: false })))],
      ['a proposal config with no rig_scale', 'CONFIG_FIELD_PRESENT', () => proposeFields(parseEarlyConfig({ key: 'k', seethrough: { resolution: 64, steps: 1, seed: 0, offload: false, head_box: HEAD_BOX }, assemble: {} }, 'layers'))],
      ['a proposal config with no head box yet', 'ASSEMBLE_FIELD_PRESENT', () => proposeFields(parseEarlyConfig({ key: 'k', seethrough: { resolution: 64, steps: 1, seed: 0, offload: false }, assemble: { rig_scale: 0.5 } }, 'layers'))],
      ['an assemble config with no plan yet', 'CONFIG_FIELD_PRESENT', () => stageFields(parseEarlyConfig({ key: 'k', seethrough: { resolution: 64, steps: 1, seed: 0, offload: false, head_box: HEAD_BOX }, assemble: { rig_scale: 0.5 } }, 'assemble'))],
      ['an assemble config with no head box yet', 'ASSEMBLE_FIELD_PRESENT', () => stageFields(parseEarlyConfig({ key: 'k', seethrough: { resolution: 64, steps: 1, seed: 0, offload: false }, assemble: { rig_scale: 0.5, plan: PLAN } }, 'assemble'))],
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

    // Issue #78: the landscape twin (fixtures/assemble_fixture.ts, "The landscape twin"). The painting is
    // 128x124, so the full run's map is k = (128 / 64) x 0.5 = 1, tx = 0, ty = -2 x 0.5 = -1: a run
    // rectangle on rows 21..50 lands on rig rows 20..49 of a 64x62 rig. The planted frame has its top pad
    // dropped, which is the map before #78 on a square painting: the same rectangle on rows 21..50.
    const wideFrame = checkGeometry({ sourceW: SOURCE_SIDE, sourceH: LANDSCAPE_H, resolution: RESOLUTION, headBox: HEAD_BOX, rigScale: RIG_SCALE });
    const block64 = newRaster(RESOLUTION, RESOLUTION);
    for (let y = 21; y < 51; y++) for (let x = 10; x < 30; x++) block64.data.set([...C, 255], (y * RESOLUTION + x) * 4);
    const rows = (r: Raster): string => {
      let lo = -1;
      let hi = -1;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if (r.data[(y * r.width + x) * 4 + 3] > 0) {
            if (lo < 0) lo = y;
            hi = y;
            break;
          }
        }
      }
      return `${lo}..${hi}`;
    };
    const mapped = layerToRig(block64, wideFrame, 'full');
    const dropped = layerToRig(block64, { ...wideFrame, fullPadTop: 0 }, 'full');
    say(
      'AS20_A_LANDSCAPE_FULL_RUN_MAPS_BACK_THROUGH_THE_TOP_PAD',
      wideFrame.fullPad === 0 && wideFrame.fullPadTop === LANDSCAPE_PAD_TOP && mapped.width === 64 && mapped.height === 62 && rows(mapped) === '20..49' && rows(dropped) === '21..50',
      `128x124 -> pads left ${wideFrame.fullPad}, top ${wideFrame.fullPadTop} (0 and 2 by hand); run rows 21..50 -> rig rows ${rows(mapped)} of ${mapped.width}x${mapped.height} (20..49 by hand); with the top pad dropped: ${rows(dropped)}`,
      'the full run is See-through on the padded square; mapping it back without the vertical pad moves every full-run part down by the pad in rig pixels',
    );

    const wideDir = join(dir, 'landscape');
    writeAssembleFixture(wideDir, assembleConfig(), landscapePainting(), { full: LANDSCAPE_FULL_LAYERS, head: HEAD_LAYERS });
    const wideBase = fixtureInput(wideDir);
    const wide = assemble({ ...wideBase, seamRule: 'near-white' });
    const wideGot = serializeParts(wide.parts);
    const sameImages = wide.images.length === result.images.length && wide.images.every((p, i) => p.record.name === result.images[i].record.name && Buffer.compare(Buffer.from(encodePngBytes(p.image)), Buffer.from(encodePngBytes(result.images[i].image))) === 0);
    // The planted input: the portrait's full run read against the landscape painting — See-through layers
    // cut from a square the painting was NOT centred on — lands every full-run part one rig row high.
    const highDir = join(dir, 'landscape-unshifted');
    writeAssembleFixture(highDir, assembleConfig(), landscapePainting());
    const high = assemble({ ...fixtureInput(highDir), seamRule: 'near-white' });
    const highTop = high.parts.parts.find((p) => p.name === 'topwear');
    say(
      'AS21_THE_LANDSCAPE_TWIN_ASSEMBLES_TO_THE_PORTRAIT_S_PARTS_IN_PAINTING_PIXELS',
      wideGot === serializeParts(LANDSCAPE_EXPECTED_PARTS) && sameImages && highTop?.y === 19 && serializeParts(high.parts) !== wideGot,
      `parts.json equals the hand-derived landscape one (the portrait's parts on a 64x62 rig): ${wideGot === serializeParts(LANDSCAPE_EXPECTED_PARTS)}; every part PNG byte-identical to the portrait run's: ${sameImages}; ` +
        `the unmoved full run on the landscape painting puts topwear at y ${highTop?.y} (20 is the figure's)`,
      'the rig stays in painting pixels: the pad is See-through\'s input only, so the same figure is the same parts whichever square it was fed on',
    );

    // --propose-plan's extend rule reads a full-run row as a rig row, so it carries the pad as the warp
    // does: rig row = (row + 1) x 1 - 1. A back hair ending on landscape run row 36 ends on rig row 36,
    // which is not more than 8 below the crop line 28: no extend. Read without the pad (the same run on a
    // square painting), it ends on 37 and is extended.
    const wideG = { sourceW: SOURCE_SIDE, sourceH: LANDSCAPE_H, resolution: RESOLUTION, headBox: HEAD_BOX, rigScale: RIG_SCALE };
    const wideProp = proposePlan(wideBase.full, wideBase.head, wideG);
    const edgeHair = LANDSCAPE_FULL_LAYERS.map((l) => (l.name === 'back hair' ? { ...l, rects: [{ ...l.rects[0], y0: 15, y1: 37 }] } : l));
    writeRun(join(dir, 'edge-full'), edgeHair);
    const edgeFull = readWrapperLayers(join(dir, 'edge-full'));
    const atEdge = proposePlan(edgeFull, wideBase.head, wideG);
    const atEdgeUnpadded = proposePlan(edgeFull, wideBase.head, { ...wideG, sourceH: SOURCE_SIDE });
    say(
      'AS22_PROPOSE_PLAN_ON_THE_LANDSCAPE_TWIN_READS_FULL_RUN_ROWS_THROUGH_THE_TOP_PAD',
      JSON.stringify(wideProp) === JSON.stringify(EXPECTED_PROPOSAL) && atEdge.extend_below_crop.length === 0 && atEdgeUnpadded.extend_below_crop.length === 1,
      `the twin's proposal equals the portrait's hand-derived one: ${JSON.stringify(wideProp) === JSON.stringify(EXPECTED_PROPOSAL)}; back hair ending on run row 36: extend ${JSON.stringify(atEdge.extend_below_crop)}; the same run read with no pad: extend ${atEdgeUnpadded.extend_below_crop.map((e) => e.part).join(', ') || 'none'}`,
      'the extend rule compares a full-run row with the crop line in rig pixels, so it must map the row exactly as the warp does, or a lock that ends at the crop is pulled below it',
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
      r1.status === 0 && r2.status === 0 && same && readBack === want && files.length === EXPECTED_PARTS.parts.length + 3 && files.includes('render/recomposite_error_rig.png') && r1.out.includes('recomposite vs source: mean |d|=') && r1.out.includes('  uncovered hole 1: 2611 px at 0,0 64x64 (between "topwear" 86 px, "hair_back" 84 px, "bottomwear" 72 px, "shoes" 48 px, "face" 34 px)'),
      `exit ${r1.status}/${r2.status}; ${files.length} file(s) (${files.join(', ')}), byte-identical across two runs: ${same}; parts.json reads back equal: ${readBack === want}`,
      'determinism is a contract — the error map included — and the parts.json the CLI writes is the one the in-memory control checked; its one hole is printed with the box and the borders the fixture derives',
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
    const badProjectOut = join(dir, 'bad-project');
    const badProject = runCli([...args(badProjectOut), '--project', 'thin']);
    const badProjectLine = badProject.out.split('\n').find((l) => l.includes('--project')) ?? '';
    say(
      'AS09_PROPOSE_PLAN_PRINTS_THE_PROPOSAL_AND_A_MISSING_FLAG_IS_A_USAGE_ERROR',
      pp.status === 0 &&
        JSON.stringify(printed) === JSON.stringify(EXPECTED_PROPOSAL) &&
        noOut.status === 2 &&
        noOut.out.includes('--out') &&
        badProject.status === 2 &&
        badProjectLine.includes('--project thin; one of core, visible is required') &&
        !existsSync(badProjectOut),
      `--propose-plan -> exit ${pp.status}, ${printed === null ? 'not JSON' : 'JSON equal to the derived proposal'}; no --out -> exit ${noOut.status}; --project thin -> exit ${badProject.status}, "${badProjectLine.trim()}", ${existsSync(badProjectOut) ? 'wrote an out directory' : 'nothing written'}`,
      'the proposal is read by an agent and pasted into the config, so it is printed as the JSON it is and nothing else',
    );

    // AUTHORING §4's table against the loaders' one statement of what they require.
    const guide = readFileSync(join(ROOT, 'docs', 'AUTHORING.md'), 'utf8');
    const tableFaults = doorTableFaults(guide);
    const assembleRow = guide.split('\n').find((l) => l.startsWith('| `assemble` |')) ?? '';
    const plantedFaults = doorTableFaults(guide.replace(assembleRow, assembleRow.replace(', `assemble.plan`', '')));
    say(
      'AS15_AUTHORING_S_TABLE_OF_WHAT_EACH_STEP_REQUIRES_IS_THE_LOADERS',
      tableFaults.length === 0 && plantedFaults.length === 1 && plantedFaults[0].includes('assemble'),
      `${Object.keys(CONFIG_REQUIRES).length} loader row(s) equal CONFIG_REQUIRES: ${tableFaults.length === 0 ? 'yes' : tableFaults.join('; ')}; the assemble row without assemble.plan -> ${plantedFaults.join('; ') || 'not caught'}`,
      'issue #20: the step list said what the config held at each step in prose, twice, and plain assemble required four sections no step before it writes; the loaders now take their required keys from one constant and the guide is held to it',
    );

    // The README's order on the flat fixture, as far as the fixture can go:
    // a fresh config, --propose-plan pasted, then plain assemble. Past this the
    // fixture's 14x24 skirt makes a proposal rig refuses (RIG_CHAIN_POINTS),
    // so the whole loop is run on the fetched examples (RL01).
    const fresh = join(dir, 'fresh');
    const early: Record<string, unknown> = { key: 'fresh', seethrough: { resolution: RESOLUTION, steps: 1, seed: 0, offload: false, head_box: HEAD_BOX }, assemble: { rig_scale: RIG_SCALE } };
    writeAssembleFixture(fresh, early);
    const freshArgs = (config: string, out: string | null): string[] => [
      'assemble', ...(out === null ? ['--propose-plan'] : []), '--source', join(fresh, 'painting.png'), '--full', join(fresh, 'full'), '--head', join(fresh, 'head'), '--config', join(fresh, config), ...(out === null ? [] : ['--out', join(fresh, out)]),
    ];
    const noPlan = runCli(freshArgs('config.json', 'noplan'));
    const noPlanLine = noPlan.out.split('\n').find((l) => l.includes('FAIL  CONFIG_FIELD_PRESENT: config.assemble.plan')) ?? '';
    const proposed = runCli(freshArgs('config.json', null));
    const proposal = proposed.status === 0 ? (JSON.parse(proposed.out) as { plan: unknown; extend_below_crop: unknown }) : null;
    const planned = { ...early, assemble: { rig_scale: RIG_SCALE, plan: proposal?.plan, extend_below_crop: proposal?.extend_below_crop } };
    writeFileSync(join(fresh, 'planned.json'), JSON.stringify(planned));
    const assembled = runCli(freshArgs('planned.json', 'work'));
    const wrote = filesUnder(join(fresh, 'work'));
    const buildEarly = runCli(buildArgs(fresh, join(fresh, 'built'), 'planned.json'));
    const buildLine = buildEarly.out.split('\n').find((l) => l.startsWith('[assemble]   FAIL  CONFIG_FIELD_PRESENT: config.bones')) ?? '';
    say(
      'AS16_A_FRESH_CONFIG_WITH_ITS_PLAN_PASTED_ASSEMBLES_AND_BUILD_STILL_ASKS_THE_FULL_LOADER',
      noPlan.status === 1 &&
        noPlanLine.includes('assemble --propose-plan') &&
        !existsSync(join(fresh, 'noplan')) &&
        proposal !== null &&
        assembled.status === 0 &&
        wrote.includes(join('rig', 'parts.json')) &&
        wrote.filter((f) => f.startsWith(join('rig', 'parts'))).length === (proposal.plan as unknown[]).length + 1 &&
        buildEarly.status === 1 &&
        buildLine !== '' &&
        buildEarly.out.includes('build: stopped at assemble; no later stage ran') &&
        entries(join(fresh, 'built')).length === 0,
      `key + seethrough + rig_scale, no plan -> exit ${noPlan.status}, "${noPlanLine.trim()}"; --propose-plan pasted -> assemble exit ${assembled.status}, wrote ${wrote.length} file(s); ` +
        `the same config to build -> exit ${buildEarly.status}, "${buildLine.trim()}", --out holds [${entries(join(fresh, 'built')).join(', ')}]`,
      'issue #20: assemble reads the plan and the See-through block and nothing of the rig, so it reads through the early door; build runs rig next, so it still asks the full loader before its assemble writes anything',
    );

    // assemble.patches over the planted hem hole (issue #28; fixtures/assemble_fixture.ts, *The hem fixture*).
    const hemDir = temp('assemble-hem');
    try {
      writeAssembleFixture(hemDir, assembleConfig({ plan: HEM_PLAN, extend: [] }), hemPainting(), { full: HEM_FULL, head: FRAMED_HEAD });
      const hemIn = fixtureInput(hemDir);
      const before = assemble({ ...hemIn, seamRule: 'near-white' });
      const boxed = assemble({ ...hemIn, patches: [{ name: 'hem', box: HEM_BOX, alpha: 'box', draw: 'back' }], seamRule: 'near-white' });
      const rec = boxed.parts.parts[0];
      const [bx0, by0, bx1, by1] = HEM_BOX;
      const want = { name: 'hem', from: 'painting:hem', x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, opaque_px: HEM_BOX_PX, visible_px: HEM_BOX_PX, occluded_px: 0, projected_core_px: HEM_BOX_PX, source_px_taken: HEM_BOX_PX, visible_not_projected_px: 0, refused_drift_px: 0, merged_px: 0, seam_override_px: 0 };
      // The part records only: the recomposite block (issue #25) measures the stack, which the patch changes by design.
      const others = JSON.stringify(boxed.parts.parts.slice(1)) === JSON.stringify(before.parts.parts) && JSON.stringify(boxed.parts.ghost_px) === JSON.stringify(before.parts.ghost_px);
      const dropU = before.figures.uncoveredErrorPx - boxed.figures.uncoveredErrorPx;
      const dropE = before.figures.errorPx - boxed.figures.errorPx;
      say(
        'AS17_A_BOX_PATCH_OVER_THE_HEM_HOLE_IS_A_PAINTING_PART_AND_THE_UNCOVERED_ERROR_PX_DROP_BY_ITS_COUNT',
        JSON.stringify(rec) === JSON.stringify(want) && others && dropU === HEM_BOX_PX && dropE === HEM_BOX_PX && before.figures.uncoveredErrorPx >= HEM_BOX_PX,
        `record ${JSON.stringify(rec)}; every other record unchanged: ${others}; holes ${before.parts.recomposite?.hole_count} (largest ${before.parts.recomposite?.holes[0]?.px} px) -> ${boxed.parts.recomposite?.hole_count} (largest ${boxed.parts.recomposite?.holes[0]?.px} px); uncovered error px ${before.figures.uncoveredErrorPx} -> ${boxed.figures.uncoveredErrorPx} (drop ${dropU}), error px ${before.figures.errorPx} -> ${boxed.figures.errorPx} (drop ${dropE}); the hand-derived count is ${HEM_BOX_PX}`,
        'the hole is where no layer holds the figure; a patch cut from the painting over its exactly-C pixels covers each of them with the painting itself, so each stops being an error pixel, and nothing else about the assembly moves',
      );

      const band = assemble({ ...hemIn, patches: [{ name: 'hem', box: HEM_BAND, alpha: 'silhouette', draw: 'back' }], seamRule: 'near-white' });
      const srcr = sourceInRig(hemIn.source, 64, 64);
      const sil = figureSilhouette(srcr);
      const b = band.images[0];
      let mismatch = 0;
      let expectDrop = 0;
      const [ax0, ay0, ax1, ay1] = HEM_BAND;
      for (let y = ay0; y < ay1; y++) {
        for (let x = ax0; x < ax1; x++) {
          const p = y * 64 + x;
          const inside = x >= b.record.x && x < b.record.x + b.record.w && y >= b.record.y && y < b.record.y + b.record.h;
          const a = inside ? b.image.data[((y - b.record.y) * b.record.w + (x - b.record.x)) * 4 + 3] : 0;
          if ((a === 255) !== (sil.data[p] === 1) || (a !== 0 && a !== 255)) mismatch++;
          const off = Math.max(255 - srcr.data[p * 4], 255 - srcr.data[p * 4 + 1], 255 - srcr.data[p * 4 + 2]);
          if (sil.data[p] === 1 && off > 40) expectDrop++;
        }
      }
      const bandPx = (ax1 - ax0) * (ay1 - ay0);
      const dropBand = before.figures.uncoveredErrorPx - band.figures.uncoveredErrorPx;
      say(
        'AS18_A_SILHOUETTE_PATCH_IS_THE_PAINTING_S_FIGURE_INSIDE_ITS_BOX_PIXEL_FOR_PIXEL',
        mismatch === 0 && b.record.from === 'painting:hem' && b.record.opaque_px > HEM_BOX_PX && b.record.opaque_px < bandPx && dropBand === expectDrop,
        `over the ${ax1 - ax0}x${ay1 - ay0} band (${bandPx} px): ${b.record.opaque_px} px taken, ${mismatch} disagreeing with figureSilhouette; uncovered error px drop ${dropBand}, the silhouette's gap pixels more than 40 off white ${expectDrop}`,
        'the silhouette is the painting\'s, not the layers\' union: the pixels a patch exists for are the ones no layer holds, so that union is empty over them by definition; the band runs through the figure\'s edge onto the page, and the page is not taken',
      );

      const order = assemble({
        ...hemIn,
        patches: [
          { name: 'p_front', box: [11, 36, 20, 40], alpha: 'box', draw: 'front' },
          { name: 'p_before', box: [20, 36, 30, 40], alpha: 'box', draw: { before: 'bottomwear' } },
          { name: 'p_back', box: [30, 36, 40, 40], alpha: 'box', draw: 'back' },
          { name: 'p_back2', box: [40, 36, 50, 40], alpha: 'box', draw: 'back' },
        ],
        seamRule: 'near-white',
      });
      const names = order.parts.parts.map((q) => q.name).join(', ');
      const wantOrder = 'p_back, p_back2, topwear, p_before, bottomwear, p_front';
      say(
        'AS19_A_PATCH_IS_DRAWN_WHERE_ITS_DRAW_SAYS',
        names === wantOrder,
        `back, back, before bottomwear and front patches over the plan topwear, bottomwear -> ${names}`,
        '"back" patches in their own order, each "before" patch immediately behind its plan part, "front" patches last: parts.json order is draw order, and the rig\'s slots follow it',
      );
    } finally {
      rmSync(hemDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

// ---------------------------------------------------------------------------
// the control skeleton, the See-through inputs, the prompt, the ComfyUI adapter
// ---------------------------------------------------------------------------

function sameColour(r: Raster, x: number, y: number, rgb: readonly number[]): boolean {
  const i = (y * r.width + x) * 4;
  return r.data[i] === rgb[0] && r.data[i + 1] === rgb[1] && r.data[i + 2] === rgb[2];
}

/** The horizontal run of `rgb` on row `y`: how many pixels of the row hold it. */
function rowRun(r: Raster, y: number, rgb: readonly number[]): number {
  let n = 0;
  for (let x = 0; x < r.width; x++) if (sameColour(r, x, y, rgb)) n++;
  return n;
}

/**
 * A layer of `w x h` at (`left`, `top`), each pixel given by `fill(i)` in raster
 * order (null = transparent). The plausibility controls build their layers in
 * memory so every count below is the loop bound that made it.
 */
function paintedLayer(name: string, box: [number, number, number, number], fill: (i: number) => [number, number, number, number] | null, drawOrder = 0): Layer {
  const [left, top, w, h] = box;
  const pixels = newRaster(w, h);
  let opaquePx = 0;
  for (let i = 0; i < w * h; i++) {
    const v = fill(i);
    if (v === null) continue;
    pixels.data.set(v, i * 4);
    if (v[3] > 8) opaquePx++;
  }
  return { name, tag: readTag(name) as TagReading, file: null, pixels, left, top, right: left + w, bottom: top + h, depth: null, drawOrder, opaquePx };
}

/** `set` with `layer` in place of the layer of the same name, or put furthest back when there is none. */
function withLayer(set: LayerSet, layer: Layer): LayerSet {
  const at = set.layers.findIndex((l) => l.name === layer.name);
  const layers = at >= 0 ? set.layers.map((l, i) => (i === at ? { ...layer, depth: l.depth, drawOrder: l.drawOrder } : l)) : [layer, ...set.layers.map((l) => ({ ...l, drawOrder: l.drawOrder + 1 }))];
  return { ...set, layers };
}

/**
 * The haze the issue describes, as a planted layer: near-white (245), four in
 * five pixels at alpha 40 and every fifth at alpha 200, over the first `n`
 * pixels of a `side x side` canvas in raster order.
 */
function hazeLayer(name: string, side: number, n: number): Layer {
  return paintedLayer(name, [0, 0, side, side], (i) => (i >= n ? null : [245, 245, 245, i % 5 === 0 ? 200 : 40]));
}

/**
 * `--propose-plan`'s plausibility rules (`implausibleRules`, `src/layers.ts`).
 *
 * Derivation on the flat fixture (fixtures/assemble_fixture.ts): the full
 * run's six layers are disjoint rectangles — headwear 16 x 12 = 192, back hair
 * 6 x 22 = 132, bottomwear 14 x 24 = 336, topwear 20 x 30 = 600, footwear
 * 20 x 6 + 2 x 2 = 124, neck 3 x 3 = 9 — disjoint but for neck's column 4 over
 * rows 2..4 (3 px under headwear), so a planted layer's rest of the figure is
 * their union, 1,393 - 3 = 1,390 px, wherever it lies.
 */
function runPlausibilitySuite(): number {
  section('plausibility: --propose-plan leaves out a translucent, background-coloured or oversized layer, by rule');
  const { say, bad } = counter();
  const dir = temp('plausible');
  try {
    // Counting: one 10 x 4 layer — row 0 opaque C, row 1 alpha 100 C, row 2
    // opaque white 245, row 3 alpha 5 (not opaque) — over a second 10 x 2
    // layer covering rows 0..1. Opaque 30; translucent 10 (row 1); background
    // 10 (row 2); rest = the other layer's 20.
    const probe: LayerSet = {
      form: 'wrapper',
      source: 'probe',
      canvas: { w: 10, h: 4 },
      layers: [
        paintedLayer('topwear', [0, 0, 10, 2], () => [100, 60, 40, 255]),
        paintedLayer('bottomwear', [0, 0, 10, 4], (i) => (i < 10 ? [100, 60, 40, 255] : i < 20 ? [100, 60, 40, 100] : i < 30 ? [245, 245, 245, 255] : [245, 245, 245, 5]), 1),
      ],
    };
    const [pt, pb] = layerFigures(probe);
    say(
      'PL01_THE_THREE_FIGURES_COUNT_WHAT_THEIR_DEFINITIONS_SAY',
      pb.opaquePx === 30 && pb.translucentPx === 10 && pb.backgroundPx === 10 && pb.restPx === 20 && pb.areaRatio === 1.5 && pt.restPx === 30 && pt.translucent === 0 && pt.areaRatio === 20 / 30,
      `bottomwear: opaque ${pb.opaquePx}, translucent ${pb.translucentPx}, background ${pb.backgroundPx}, rest ${pb.restPx}, area ${pb.areaRatio}; topwear: rest ${pt.restPx}, area ${pt.areaRatio?.toFixed(4)}`,
      'alpha 1..8 is not a pixel of the layer (See-through hazes whole canvases at that alpha), alpha below 128 is translucent, a min channel above 235 is the seam rule\'s near-white, and the rest of the figure is the OTHER layers\' union',
    );

    // Each bar, at the bar and one step past it: the smallest edit that crosses.
    // A 100-px layer beside a rest of `rest` px, with `t` translucent and `b` background pixels.
    const judge = (t: number, b: number, rest: number, n = 100): string[] => {
      const set: LayerSet = {
        form: 'wrapper',
        source: 'bars',
        canvas: { w: 100, h: 200 },
        layers: [
          paintedLayer('topwear', [0, 100, 100, 100], (i) => (i < rest ? [100, 60, 40, 255] : null)),
          paintedLayer('wings', [0, 0, 100, 100], (i) => (i >= n ? null : [i < b ? 245 : 100, i < b ? 245 : 60, i < b ? 245 : 40, i < t ? 100 : 255]), 1),
        ],
      };
      return implausibleRules(layerFigures(set)[1]);
    };
    const cases: Array<[string, string[], string[]]> = [
      ['50 translucent of 100 (at the bar)', judge(50, 0, 1000), []],
      ['51 translucent of 100', judge(51, 0, 1000), ['PLAN_LAYER_TRANSLUCENT']],
      ['51 translucent of 100 at 100/2001 of the rest (below the judged floor)', judge(51, 0, 2001), []],
      ['51 translucent of 100 at 100/2000 = 0.05 of the rest (on the floor)', judge(51, 0, 2000), ['PLAN_LAYER_TRANSLUCENT']],
      ['100 background, 25 translucent', judge(25, 100, 1000), []],
      ['100 background, 26 translucent', judge(26, 100, 1000), ['PLAN_LAYER_BACKGROUND']],
      ['50 background, 40 translucent', judge(40, 50, 1000), []],
      ['51 background, 40 translucent', judge(40, 51, 1000), ['PLAN_LAYER_BACKGROUND']],
      ['100 opaque background (a white garment)', judge(0, 100, 1000), []],
      ['100 px beside a rest of 25 (4x, at the bar)', judge(0, 0, 25), []],
      ['100 px beside a rest of 24', judge(0, 0, 24), ['PLAN_LAYER_OVERSIZED']],
    ];
    const wrong = cases.filter(([, got, want]) => got.join(',') !== want.join(','));
    say(
      'PL02_EACH_RULE_FIRES_ONE_STEP_PAST_ITS_BAR_AND_NOT_AT_IT',
      wrong.length === 0 && PLAUSIBLE_TRANSLUCENT_MAX === 0.5 && PLAUSIBLE_BACKGROUND_MAX === 0.5 && PLAUSIBLE_BACKGROUND_TRANSLUCENT_MIN === 0.25 && PLAUSIBLE_AREA_RATIO_MAX === 4 && PLAUSIBLE_JUDGED_AREA_RATIO === 0.05,
      wrong.length === 0 ? cases.map(([what, got]) => `${what} -> ${got.length === 0 ? 'kept' : got.join('+')}`).join('; ') : wrong.map(([what, got, want]) => `${what}: got ${got.join('+') || 'kept'}, wanted ${want.join('+') || 'kept'}`).join('; '),
      'a bar is a line: the control stands on it and one pixel past it, so a bar that moved, or a comparison that turned from > into >=, is named',
    );

    writeAssembleFixture(dir);
    const base = fixtureInput(dir);
    const g = { sourceW: SOURCE_SIDE, sourceH: SOURCE_SIDE, resolution: RESOLUTION, headBox: HEAD_BOX, rigScale: RIG_SCALE };
    const clean = proposePlan(base.full, base.head, g);
    const expectedNotes = EXPECTED_PROPOSAL.notes;
    const samePlan = (p: { plan: unknown; extend_below_crop: unknown }): boolean => JSON.stringify(p.plan) === JSON.stringify(EXPECTED_PROPOSAL.plan) && JSON.stringify(p.extend_below_crop) === JSON.stringify(EXPECTED_PROPOSAL.extend_below_crop);

    // The issue's layer: the haze over 2,780 px = 2.000x the rest (1,390).
    // 2,780 / 5 = 556 at alpha 200, 2,224 at alpha 40: 80.0 % translucent, all 245: 100.0 % background.
    const hazed = proposePlan(withLayer(base.full, hazeLayer('wings', RESOLUTION, 2780)), base.head, g);
    const hazeNote = hazed.notes.at(-1) ?? '';
    const wantPrefix = 'wings: full run layer 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure -> not proposed by ';
    const wantRules = `PLAN_LAYER_TRANSLUCENT (${ruleSummary('PLAN_LAYER_TRANSLUCENT')}), PLAN_LAYER_BACKGROUND (${ruleSummary('PLAN_LAYER_BACKGROUND')})`;
    say(
      'PL03_THE_ISSUES_HAZE_IS_LEFT_OUT_BY_NAME_AND_THE_REST_OF_THE_PROPOSAL_IS_UNMOVED',
      JSON.stringify(clean) === JSON.stringify(EXPECTED_PROPOSAL) && samePlan(hazed) && hazed.notes.length === expectedNotes.length + 1 && hazed.notes.slice(0, -1).join('|') === expectedNotes.join('|') && hazeNote === wantPrefix + wantRules,
      `plan ${hazed.plan.map((p) => p[0]).join(', ')}; note "${hazeNote}"`,
      'See-through hallucinated a wings layer of mostly translucent grey on a character with none; proposed as an ordinary part it became an 832 x 1096 part and the recomposite error rose to mean |d| 15.01 (issue #21)',
    );

    // A real layer copied under the planted tag: topwear's own 600 opaque C px.
    const topwear = base.full.layers.find((l) => l.name === 'topwear') as Layer;
    const copied = proposePlan(withLayer(base.full, { ...topwear, name: 'wings', tag: readTag('wings') as TagReading }), base.head, g);
    // The white garment: the fixture's own bottomwear is opaque Z (250, 250, 250), 100 % background-coloured and 0 % translucent.
    const bottom = layerFigures(base.full).find((f) => f.name === 'bottomwear');
    say(
      'PL04_A_REAL_LAYER_COPY_AND_AN_OPAQUE_WHITE_GARMENT_ARE_PROPOSED',
      copied.plan.some((p) => p[2] === 'wings') && !copied.notes.some((n) => n.includes('PLAN_LAYER_')) && bottom !== undefined && bottom.background === 1 && bottom.translucent === 0 && clean.plan.some((p) => p[2] === 'bottomwear'),
      `a copy of topwear as wings -> plan ${copied.plan.map((p) => p[0]).join(', ')}, ${copied.notes.length} note(s); bottomwear ${bottom === undefined ? 'absent' : `${(bottom.background ?? 0) * 100}% background, ${(bottom.translucent ?? 0) * 100}% translucent`} -> proposed`,
      "the positive control: the rules read a haze, not a tag and not a colour — a white dress is the page's colour at full alpha",
    );

    // One rule each, through the paths that consult a layer.
    // TRANSLUCENT: 700 px of C at alpha 100 (0.504x the rest, judged): 100 % translucent, 0 % background.
    const dim = (tag: string): Layer => paintedLayer(tag, [0, 0, 64, 64], (i) => (i < 700 ? [100, 60, 40, 100] : null));
    const tr = proposePlan(withLayer(base.full, dim('wings')), base.head, g);
    // BACKGROUND: 700 px of 245, i % 5 < 2 at alpha 100 (280, 40 %) and the rest opaque: 100 % background, 40 % translucent.
    const bg = proposePlan(withLayer(base.full, paintedLayer('wings', [0, 0, 64, 64], (i) => (i < 700 ? [245, 245, 245, i % 5 < 2 ? 100 : 255] : null))), base.head, g);
    // OVERSIZED: a full run of topwear (600) and 64 x 40 = 2,560 opaque C as wings: 4.267x.
    const bigRun: LayerSet = { ...base.full, layers: [paintedLayer('wings', [0, 0, 64, 40], () => [100, 60, 40, 255]), { ...topwear, drawOrder: 1 }] };
    const big = proposePlan(bigRun, base.head, g);
    // The extend path: the full run's back hair replaced by the translucent layer — the head run's back hair is still proposed, but not extended from it.
    const ext = proposePlan(withLayer(base.full, dim('back hair')), base.head, g);
    // The fallback path: the full run's headwear replaced by it — no hairpin, and no fallback note.
    const fall = proposePlan(withLayer(base.full, dim('headwear')), base.head, g);
    const only = (p: { notes: string[] }, tag: string, rule: string, what: string): boolean => {
      const n = p.notes.filter((x) => x.includes('PLAN_LAYER_'));
      return n.length === 1 && n[0].startsWith(`${tag}: full run layer `) && n[0].includes(`-> ${what} by ${rule} (`) && ['PLAN_LAYER_TRANSLUCENT', 'PLAN_LAYER_BACKGROUND', 'PLAN_LAYER_OVERSIZED'].filter((r) => n[0].includes(r)).length === 1;
    };
    const outcomes: Array<[string, boolean, string]> = [
      ['translucent wings', only(tr, 'wings', 'PLAN_LAYER_TRANSLUCENT', 'not proposed') && samePlan(tr), tr.notes.at(-1) ?? ''],
      ['background-coloured wings', only(bg, 'wings', 'PLAN_LAYER_BACKGROUND', 'not proposed') && samePlan(bg), bg.notes.at(-1) ?? ''],
      ['oversized wings', only(big, 'wings', 'PLAN_LAYER_OVERSIZED', 'not proposed') && !big.plan.some((p) => p[2] === 'wings') && big.plan.some((p) => p[2] === 'topwear'), big.notes.at(-1) ?? ''],
      ['hazy full-run back hair', only(ext, 'back hair', 'PLAN_LAYER_TRANSLUCENT', 'not extended below the crop') && ext.extend_below_crop.length === 0 && ext.plan.some((p) => p[1] === 'head' && p[2] === 'back hair'), ext.notes.at(-1) ?? ''],
      ['hazy full-run headwear', only(fall, 'headwear', 'PLAN_LAYER_TRANSLUCENT', 'not proposed') && !fall.plan.some((p) => p[2] === 'headwear') && !fall.notes.some((n) => n.includes('0.8 x full run')), fall.notes.at(-1) ?? ''],
    ];
    const missed = outcomes.filter(([, ok]) => !ok);
    say(
      'PL05_EACH_RULE_LEAVES_ITS_MUTANT_OUT_THROUGH_EVERY_PATH_THAT_READS_A_LAYER',
      missed.length === 0,
      missed.length === 0 ? `${outcomes.length} planted layers, each left out under its one rule; e.g. "${outcomes[2][2]}"` : missed.map(([what, , note]) => `${what}: "${note}"`).join('; '),
      'the body order, the head-run fallback and the extend below the crop each read a layer; a rule that guarded one of them would let the haze in through another',
    );

    // The reader: `layers` prints the figures and a WARN line per rule crossed, and refuses nothing.
    writeRun(join(dir, 'hazed'), FULL_LAYERS);
    const manifest = JSON.parse(readFileSync(join(dir, 'hazed', 'layers.json'), 'utf8')) as { layers: unknown[]; width: number; height: number };
    manifest.layers.push({ name: 'wings', filename: 'wings.png', left: 0, top: 0, right: RESOLUTION, bottom: RESOLUTION, depth_median: 0.99 });
    writeFileSync(join(dir, 'hazed', 'wings.png'), encodePngBytes(hazeLayer('wings', RESOLUTION, 2780).pixels));
    writeFileSync(join(dir, 'hazed', 'layers.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const warned = runCli(['layers', join(dir, 'hazed')]);
    const quiet = runCli(['layers', join(dir, 'full')]);
    const warnLines = warned.out.split('\n').filter((l) => l.startsWith('  WARN  '));
    const wingsRow = warned.out.split('\n').find((l) => /^ {2}0 +wings /.test(l)) ?? '';
    say(
      'PL06_LAYERS_PRINTS_THE_FIGURES_AND_WARNS_WITHOUT_REFUSING',
      warned.status === 0 &&
        warnLines.length === 2 &&
        warnLines[0].startsWith('  WARN  PLAN_LAYER_TRANSLUCENT: layer "wings" — 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure; ') &&
        warnLines[1].startsWith('  WARN  PLAN_LAYER_BACKGROUND: layer "wings" — ') &&
        warned.out.includes('  2 WARN line(s)') &&
        /80\.0%\s+100\.0%\s+2\.000x$/.test(wingsRow) &&
        quiet.status === 0 &&
        quiet.out.includes('  0 WARN line(s)'),
      `hazed run -> exit ${warned.status}, ${warnLines.length} WARN line(s), first "${warnLines[0]?.trim() ?? ''}"; wings row "${wingsRow.trim()}"; the fixture's run -> exit ${quiet.status}, ${quiet.out.includes('  0 WARN line(s)') ? '0 WARN lines' : 'WARN lines'}`,
      'the reader says what the plan will leave out and why, in the same words as the note, and exits 0: a WARN is a finding, and the plan step is where it acts',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return bad();
}

function runSkeletonSuite(): number {
  section('skeleton: the OpenPose body-18 control image');
  const { say, bad } = counter();
  const scales = [[400, 1], [499, 1], [500, 2], [832, 2], [1000, 3], [1216, 3], [2048, 4], [5000, 7], [99999, 7]] as const;
  const wrong = scales.filter(([side, want]) => stickScale(side) !== want);
  say(
    'SK01_THE_STICK_SCALE_IS_XINSIRS_RULE',
    wrong.length === 0,
    `${scales.map(([s]) => `${s}->${stickScale(s)}`).join(', ')}; expected 1 below 500, then min(2 + side // 1000, 7)`,
    "xinsir's controlnet-openpose-sdxl-1.0 was trained on sticks scaled this way; the canonical 4 px width is three times too thin at the painting latent",
  );

  const [W, H] = SKELETON_BASE;
  const failedKp: string[] = [];
  for (const name of ['stand_sides', 'stand_clasp'] as const) {
    const r = renderSkeleton(name, W, H);
    const pts = scaledPoints(name, W, H);
    KEYPOINT_NAMES.forEach((k, i) => {
      const [x, y] = pts[k];
      if (!sameColour(r, x, y, COLORS[i])) failedKp.push(`${name}.${k} at ${x},${y} is ${px(r, x, y).slice(0, 3).join(',')}, not ${COLORS[i].join(',')}`);
    });
    if (!(pts.r_shoulder[0] < pts.l_shoulder[0])) failedKp.push(`${name}: r_shoulder is not on the image left`);
    if (px(r, 0, 0).join(',') !== '0,0,0,255') failedKp.push(`${name}: the background is ${px(r, 0, 0).join(',')}, not opaque black`);
  }
  const scaledOk = scaledPoints('stand_sides', 416, 608).nose.join(',') === '208,88';
  say(
    'SK02_EVERY_KEYPOINT_IS_ITS_COLOUR_AT_ITS_POINT_ON_BLACK',
    failedKp.length === 0 && scaledOk,
    `${KEYPOINT_NAMES.length} keypoints x 2 skeletons at ${W}x${H}: ${failedKp.length === 0 ? 'every centre pixel is its full colour' : failedKp.join('; ')}; stand_sides at 416x608 puts the nose at ${scaledPoints('stand_sides', 416, 608).nose.join(',')} (208,88 by hand)`,
    'the keypoints are drawn last, at full colour, so each centre pixel is its own colour whatever the limbs under it; r/l are the subject\'s sides',
  );

  // stand_sides' shin r_knee (384,862) -> r_ankle (388,1100) is limb 8, drawn at 0.6 x COLORS[8]; at its middle row it is
  // all but vertical, so the row crosses the stick where it is widest: 2 x the half-width, within one pixel either side.
  const shin = COLORS[8].map((c) => Math.trunc(c * 0.6));
  const row = 981;
  const half = 4 * stickScale(Math.max(W, H));
  const run = rowRun(renderSkeleton('stand_sides', W, H), row, shin);
  const thin = rowRun(renderSkeleton('stand_sides', W, H, 4), row, shin);
  const widthOk = (n: number): boolean => Math.abs(n - 2 * half) <= 1;
  say(
    'SK03_THE_STICK_IS_DRAWN_AT_THE_XINSIR_WIDTH_AND_A_CANONICAL_ONE_IS_CAUGHT',
    widthOk(run) && !widthOk(thin),
    `the right shin crosses row ${row} ${run} px wide (2 x ${half} +-1 required); planted at the canonical half-width 4 it is ${thin} px, and the check refuses it`,
    'a skeleton drawn at the canonical width is a different conditioning image, and only the width says which one was drawn',
  );

  const a = encodePngBytes(renderSkeleton('stand_clasp', W, H));
  const b = encodePngBytes(renderSkeleton('stand_clasp', W, H));
  say(
    'SK04_THE_SAME_SKELETON_IS_THE_SAME_BYTES',
    a.length === b.length && a.every((v, i) => v === b[i]),
    `two renders of stand_clasp at ${W}x${H}: ${a.length} bytes each, identical`,
    'the skeleton is uploaded as the ControlNet image, and determinism is a contract',
  );
  return bad();
}

function runInputsSuite(): number {
  section('inputs: the two images See-through is fed');
  const { say, bad } = counter();
  // a 6x10 painting whose every pixel is distinct, so any shift or crop is visible
  const painting = newRaster(6, 10);
  for (let i = 0; i < 60; i++) painting.data.set([i * 4, 255 - i * 4, (i * 7) % 256, 255], i * 4);
  const cfg = (box?: [number, number, number, number]): Pick<CharacterConfig, 'seethrough'> => ({ seethrough: { resolution: 1024, steps: 30, seed: 42, offload: true, ...(box ? { head_box: box } : {}) } });
  const r = makeInputs(painting, cfg([1, 2, 5, 6]), 'painting');
  let placed = r.full.width === 10 && r.full.height === 10 && r.padLeft === 2;
  for (let y = 0; y < 10 && placed; y++) {
    for (let x = 0; x < 10; x++) {
      const want = x < 2 || x >= 8 ? [255, 255, 255, 255] : px(painting, x - 2, y);
      if (px(r.full, x, y).join(',') !== want.join(',')) placed = false;
    }
  }
  say(
    'IN01_THE_FULL_INPUT_IS_THE_PAINTING_CENTRED_ON_WHITE',
    placed,
    `6x10 -> ${r.full.width}x${r.full.height}, painting at x ${r.padLeft} (2 by hand), columns 0-1 and 8-9 white, every painting pixel where it was put`,
    "See-through pads with black, which reads as figure; the reference fed a white square with the painting at ((side - w) // 2, 0)",
  );
  const seven = newRaster(7, 10);
  seven.data.fill(255);
  const odd = makeInputs(seven, cfg(), 'odd');
  say(
    'IN02_AN_ODD_PAD_PUTS_THE_EXTRA_COLUMN_ON_THE_RIGHT',
    odd.padLeft === 1 && odd.full.width === 10 && odd.head === null,
    `7x10 -> pad ${odd.padLeft} left, ${odd.full.width - 7 - odd.padLeft} right; no head box, so no head input (${odd.head === null ? 'none' : 'one'})`,
    "the reference's `(side - w) // 2` floors, so a one-pixel disagreement here would shift the whole full run against proposeHeadBox's mapping",
  );
  let cropped = r.head !== null && r.head.width === 4 && r.head.height === 4;
  for (let y = 0; y < 4 && cropped; y++) for (let x = 0; x < 4; x++) if (px(r.head!, x, y).join(',') !== px(painting, 1 + x, 2 + y).join(',')) cropped = false;
  say(
    'IN03_THE_HEAD_INPUT_IS_THE_HEAD_BOX_AT_ITS_EXACT_SIZE',
    cropped,
    `head_box [1, 2, 5, 6] -> ${r.head?.width}x${r.head?.height}, every pixel the painting's at (1 + x, 2 + y)`,
    'the head run is See-through at a higher resolution on this crop; a resampled or shifted crop would move every head part',
  );
  const glass = newRaster(6, 10);
  glass.data.fill(255);
  glass.data[4 * 13 + 3] = 128;
  const translucent = refusals(() => makeInputs(glass, cfg(), 'glass.png'));
  const outside = refusals(() => makeInputs(painting, cfg([3, 4, 9, 10]), 'painting'));
  const square = refusals(() => parseConfig({ ...minimalConfig(), seethrough: { resolution: 1024, steps: 30, seed: 42, offload: true, head_box: [0, 0, 4, 5] } }));
  say(
    'IN04_A_TRANSLUCENT_PAINTING_AND_A_BOX_OUTSIDE_OR_NOT_SQUARE_ARE_REFUSED',
    translucent?.problems[0]?.code === 'INPUTS_PAINTING_OPAQUE' &&
      translucent.problems[0].detail.includes('1 pixel(s)') &&
      outside?.problems[0]?.code === 'INPUTS_HEAD_BOX_INSIDE' &&
      square?.problems.some((p) => p.code === 'CONFIG_HEAD_BOX_SQUARE') === true,
    `one alpha-128 pixel -> ${translucent?.problems[0]?.detail ?? 'nothing'}; [3, 4, 9, 10] on 6x10 -> ${codes(outside)}; 4x5 box -> ${codes(square)}`,
    'the reference dropped alpha and scaled a non-square box by its width, each silently (a landscape painting, which it top-aligned, is padded vertically now: IN07)',
  );

  // Issue #78: a landscape painting is padded top and bottom, as a portrait one is left and right.
  // 10x6, every pixel distinct: side max(10, 6) = 10, top floor((10 - 6) / 2) = 2, bottom 10 - 6 - 2 = 2, left 0.
  const wide = newRaster(10, 6);
  for (let i = 0; i < 60; i++) wide.data.set([i * 4, 255 - i * 4, (i * 7) % 256, 255], i * 4);
  /** Whether `full` is white everywhere except `src`, placed whole at (left, top). */
  const placedAt = (full: Raster, src: Raster, left: number, top: number): boolean => {
    for (let y = 0; y < full.height; y++) {
      for (let x = 0; x < full.width; x++) {
        const inside = x >= left && x < left + src.width && y >= top && y < top + src.height;
        if (px(full, x, y).join(',') !== (inside ? px(src, x - left, y - top) : [255, 255, 255, 255]).join(',')) return false;
      }
    }
    return true;
  };
  const l = makeInputs(wide, cfg([3, 1, 7, 5]), 'wide.png');
  // The planted input: the reference's paste at ((side - w) // 2, 0), the painting on the square's top rows.
  const topAligned = newRaster(10, 10);
  topAligned.data.fill(255);
  topAligned.data.set(wide.data, 0);
  let wideHead = l.head !== null && l.head.width === 4 && l.head.height === 4;
  for (let y = 0; y < 4 && wideHead; y++) for (let x = 0; x < 4; x++) if (px(l.head!, x, y).join(',') !== px(wide, 3 + x, 1 + y).join(',')) wideHead = false;
  say(
    'IN07_A_LANDSCAPE_PAINTING_IS_CENTRED_ON_WHITE_VERTICALLY',
    l.full.width === 10 && l.full.height === 10 && l.padTop === 2 && l.padLeft === 0 && placedAt(l.full, wide, 0, 2) && !placedAt(topAligned, wide, 0, 2) && wideHead,
    `10x6 -> ${l.full.width}x${l.full.height}, painting at x ${l.padLeft}, y ${l.padTop} (0 and 2 by hand), rows 0-1 and 8-9 white: ${placedAt(l.full, wide, 0, 2)}; ` +
      `the reference's top-aligned paste read the same way: ${placedAt(topAligned, wide, 0, 2)}; head_box [3, 1, 7, 5] is the painting's own pixels at (3 + x, 1 + y): ${wideHead}`,
    'the full run is centred on the square either way, so See-through sees white on both sides of the figure; the head crop is cut from the painting, never from the square',
  );
  const tall7 = newRaster(10, 7);
  for (let i = 0; i < 70; i++) tall7.data.set([i * 3, 255 - i * 3, (i * 5) % 256, 255], i * 4);
  const oddTop = makeInputs(tall7, cfg(), 'odd-wide');
  say(
    'IN08_AN_ODD_VERTICAL_PAD_PUTS_THE_EXTRA_ROW_AT_THE_BOTTOM',
    oddTop.padTop === 1 && oddTop.padLeft === 0 && oddTop.full.height === 10 && placedAt(oddTop.full, tall7, 0, 1) && !placedAt(oddTop.full, tall7, 0, 2),
    `10x7 -> pad ${oddTop.padTop} top, ${oddTop.full.height - 7 - oddTop.padTop} bottom (floor(3 / 2) = 1 and 2 by hand); the painting read one row lower: ${placedAt(oddTop.full, tall7, 0, 2)}`,
    "the vertical margin floors as the horizontal one does, so proposeHeadBox and assemble, which take it from the same squarePad, agree with the image to the pixel",
  );
  // squarePad over every size 1..12 x 1..12, against its definition: side max(w, h), one margin 0,
  // the other floor((side - dim) / 2). The planted mutant is the derivation with w and h swapped.
  const sizes: Array<[number, number]> = [];
  for (let w = 1; w <= 12; w++) for (let h = 1; h <= 12; h++) sizes.push([w, h]);
  const byDefinition = (pad: { side: number; left: number; top: number }, w: number, h: number): boolean =>
    pad.side === Math.max(w, h) && pad.left === Math.floor((pad.side - w) / 2) && pad.top === Math.floor((pad.side - h) / 2) && (pad.left === 0 || pad.top === 0);
  const wrongPads = sizes.filter(([w, h]) => !byDefinition(squarePad(w, h), w, h));
  const swappedWrong = sizes.filter(([w, h]) => !byDefinition(squarePad(h, w), w, h));
  // A portrait painting's margins are the pre-#78 derivation's: top 0, left floor((h - w) / 2) on a square of side h.
  const portraitMoved = sizes.filter(([w, h]) => w <= h).filter(([w, h]) => {
    const q = squarePad(w, h);
    return q.side !== h || q.top !== 0 || q.left !== Math.floor((h - w) / 2);
  });
  say(
    'IN09_SQUARE_PAD_IS_ITS_DEFINITION_AND_A_PORTRAIT_PAINTING_S_IS_UNCHANGED',
    wrongPads.length === 0 && swappedWrong.length > 0 && portraitMoved.length === 0,
    `${sizes.length} sizes: ${wrongPads.length} off the definition; ${sizes.filter(([w, h]) => w <= h).length} portrait or square ones whose margins differ from the pre-#78 ones: ${portraitMoved.length}; ` +
      `the planted mutant (w and h swapped) is off on ${swappedWrong.length}`,
    'one derivation is read by inputs, proposeHeadBox and assemble; a portrait painting must keep the margins the reference measured against (the inputs-examples suite holds the bytes)',
  );

  const dir = temp('inputs');
  try {
    const src = join(dir, 'painting.png');
    writeFileSync(src, encodePngBytes(painting));
    const c = { ...minimalConfig(), seethrough: { resolution: 1024, steps: 30, seed: 42, offload: true, head_box: [1, 2, 5, 6] } };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(c));
    const run = runCli(['inputs', '--source', src, '--config', join(dir, 'config.json'), '--out', join(dir, 'out')]);
    const full = existsSync(join(dir, 'out', 'st_input_full.png')) ? readPng(join(dir, 'out', 'st_input_full.png')) : null;
    const head = existsSync(join(dir, 'out', 'st_input_head.png')) ? readPng(join(dir, 'out', 'st_input_head.png')) : null;
    const same = (a: Raster | null, b: Raster | null): boolean => a !== null && b !== null && a.width === b.width && a.data.every((v, i) => v === b.data[i]);
    const wideSrc = join(dir, 'wide.png');
    writeFileSync(wideSrc, encodePngBytes(wide));
    const wideRun = runCli(['inputs', '--source', wideSrc, '--config', join(dir, 'config.json'), '--out', join(dir, 'wide')]);
    const wideFull = existsSync(join(dir, 'wide', 'st_input_full.png')) ? readPng(join(dir, 'wide', 'st_input_full.png')) : null;
    const wideLine = 'st_input_full.png 10x10: the painting at y 2, white above and below (2 + 2 px)';
    const portraitLine = 'st_input_full.png 10x10: the painting at x 2, white either side (2 + 2 px)';
    say(
      'IN10_THE_CLI_CUTS_A_LANDSCAPE_PAINTING_AND_SAYS_WHERE_IT_SITS',
      wideRun.status === 0 && same(wideFull, makeInputs(wide, cfg([1, 2, 5, 6]), 'wide.png').full) && wideRun.out.includes(wideLine) && !wideRun.out.includes('at x ') && run.out.includes(portraitLine),
      `10x6 -> exit ${wideRun.status}, st_input_full ${wideFull === null ? 'absent' : `${wideFull.width}x${wideFull.height}`}; says "${wideLine}": ${wideRun.out.includes(wideLine)}; the 6x10 run still says "${portraitLine}": ${run.out.includes(portraitLine)}`,
      'the line is how an agent learns where the painting sits on the square it hands See-through; a landscape painting was refused here before issue #78',
    );
    say(
      'IN05_THE_CLI_WRITES_BOTH_INPUTS_AND_SAYS_WHAT_IT_WROTE',
      run.status === 0 && same(full, r.full) && same(head, r.head) && run.out.includes('st_input_full.png 10x10') && run.out.includes('st_input_head.png 4x4'),
      `exit ${run.status}; st_input_full ${full === null ? 'absent' : `${full.width}x${full.height}`}, st_input_head ${head === null ? 'absent' : `${head.width}x${head.height}`}, both equal to makeInputs'`,
      'the command is what an agent runs; the file it writes is the one the See-through run is fed',
    );

    // A new character's config at the first `inputs` call: no plan, bones, meshes, regions or motion, and no head box yet.
    const seethrough = { resolution: 1024, steps: 30, seed: 42, offload: true };
    const fresh = { key: 'fresh', seethrough, assemble: { rig_scale: 0.5 } };
    const write = (name: string, cfgObj: unknown): string => {
      const at = join(dir, name);
      writeFileSync(at, JSON.stringify(cfgObj));
      return at;
    };
    const first = runCli(['inputs', '--source', src, '--config', write('fresh.json', fresh), '--out', join(dir, 'fresh1')]);
    const firstFiles = existsSync(join(dir, 'fresh1')) ? readdirSync(join(dir, 'fresh1')).sort() : [];
    const second = runCli(['inputs', '--source', src, '--config', write('fresh_box.json', { ...fresh, seethrough: { ...seethrough, head_box: [1, 2, 5, 6] } }), '--out', join(dir, 'fresh2')]);
    const secondFiles = existsSync(join(dir, 'fresh2')) ? readdirSync(join(dir, 'fresh2')).sort() : [];
    const rigRun = runCli(['rig', '--config', join(dir, 'fresh_box.json'), '--parts', dir, '--out', join(dir, 'fresh_rig')]);
    const rigNamed = ['config.bones', 'config.meshes', 'config.regions', 'config.motion', 'config.assemble.plan'].every((f) => rigRun.out.includes(`FAIL  CONFIG_FIELD_PRESENT: ${f} `));
    const retired = runCli(['inputs', '--source', src, '--config', write('retired.json', { ...fresh, generation: { character_file: 'elsewhere.json' } }), '--out', join(dir, 'fresh3')]);
    const unknown = runCli(['inputs', '--source', src, '--config', write('unknown.json', { ...fresh, status: 'draft' }), '--out', join(dir, 'fresh4')]);
    say(
      'IN06_A_NEW_CHARACTER_CONFIG_PASSES_INPUTS_HEAD_BOX_OPTIONAL_AND_THE_FULL_LOADER_STILL_REFUSES_IT_FOR_RIG',
      first.status === 0 &&
        firstFiles.join(',') === 'st_input_full.png' &&
        second.status === 0 &&
        secondFiles.join(',') === 'st_input_full.png,st_input_head.png' &&
        rigRun.status === 1 &&
        rigNamed &&
        !existsSync(join(dir, 'fresh_rig')) &&
        retired.status === 1 &&
        retired.out.includes('FAIL  CONFIG_KEY_RETIRED: config.generation.character_file') &&
        unknown.status === 1 &&
        unknown.out.includes('FAIL  CONFIG_KEY_KNOWN: config.status'),
      `key + seethrough + assemble.rig_scale -> exit ${first.status}, wrote [${firstFiles.join(', ')}]; with head_box -> exit ${second.status}, wrote [${secondFiles.join(', ')}]; ` +
        `the same config to rig -> exit ${rigRun.status}, all five sections named: ${rigNamed}; generation.character_file -> exit ${retired.status}; an unknown "status" -> exit ${unknown.status}`,
      'inputs runs before the plan and the bones exist, so it reads through the partial entry point; that door narrows what is required, never what is known — the full loader still stands in front of rig',
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
      const a = assemble({ ...input, seamRule: DEFAULT_SEAM_RULE, projectRule: DEFAULT_PROJECT_RULE });
      const b = assemble({ ...input, seamRule: DEFAULT_SEAM_RULE, projectRule: DEFAULT_PROJECT_RULE });
      const same = serializeParts(a.parts) === serializeParts(b.parts) && a.images.every((p, i) => Buffer.compare(Buffer.from(encodePngBytes(p.image)), Buffer.from(encodePngBytes(b.images[i].image))) === 0);
      ok = same && a.parts.parts.every((p) => p.opaque_px > 0);
      detail = `${a.parts.parts.length} parts, two runs identical: ${same}; ${figuresLine(a.figures)}`;
    } catch (err) {
      detail = `refused or crashed: ${(err as Error).message.split('\n')[0]}`;
    }
    say(`AE01_EXAMPLE_ASSEMBLES_GREEN_AND_DETERMINISTIC[${name}]`, ok, detail, 'a public painting and its real See-through runs: the question the generated rectangles cannot answer is whether real layers go through green');

    // Plausibility on real layers: no layer crosses a rule, and the issue's haze
    // planted in place of the full run's (empty) wings layer is left out with the
    // rest of the proposal unmoved, while a copy of the real topwear is proposed.
    let pDetail: string;
    let pOk = false;
    try {
      const painting = readPng(join(ex, 'inputs', 'painting.png'));
      const full = readLayers(join(ex, 'inputs', 'layers', 'full'));
      const head = readLayers(join(ex, 'inputs', 'layers', 'head'));
      const g = { sourceW: painting.width, sourceH: painting.height, ...proposeFields(loadEarlyConfig(join(ex, 'config.json'), 'layers')) };
      const crossed = [...layerFigures(full).map((f) => ['full', f] as const), ...layerFigures(head).map((f) => ['head', f] as const)].filter(([, f]) => implausibleRules(f).length > 0);
      const clean = proposePlan(full, head, g);
      const rest = layerFigures(full).find((f) => f.name === 'wings');
      const side = full.canvas.w;
      const hazed = rest === undefined ? null : proposePlan(withLayer(full, hazeLayer('wings', side, 2 * rest.restPx)), head, g);
      const topwear = full.layers.find((l) => l.name === 'topwear');
      const copied = topwear === undefined ? null : proposePlan(withLayer(full, { ...topwear, name: 'wings', tag: readTag('wings') as TagReading }), head, g);
      const note = hazed?.notes.at(-1) ?? '';
      pOk =
        crossed.length === 0 &&
        !clean.notes.some((n) => n.includes('PLAN_LAYER_')) &&
        hazed !== null &&
        JSON.stringify(hazed.plan) === JSON.stringify(clean.plan) &&
        JSON.stringify(hazed.extend_below_crop) === JSON.stringify(clean.extend_below_crop) &&
        hazed.notes.slice(0, -1).join('|') === clean.notes.join('|') &&
        note.startsWith('wings: full run layer 80.0% translucent, 100.0% background-coloured, 2.000x the rest of the figure -> not proposed by PLAN_LAYER_TRANSLUCENT') &&
        copied !== null &&
        copied.plan.some((p) => p[2] === 'wings') &&
        !copied.notes.some((n) => n.includes('PLAN_LAYER_'));
      pDetail = `${full.layers.length + head.layers.length} layers, ${crossed.length} crossing a rule${crossed.length > 0 ? ` (${crossed.map(([run, f]) => `${run}:${f.name} ${implausibleRules(f).join('+')}`).join(', ')})` : ''}; haze over ${rest === undefined ? '?' : 2 * rest.restPx} px -> "${note}"; a topwear copy as wings -> ${copied?.plan.some((p) => p[2] === 'wings') ? 'proposed' : 'NOT proposed'}`;
    } catch (err) {
      pDetail = `refused or crashed: ${(err as Error).message.split('\n')[0]}`;
    }
    say(
      `AE02_EXAMPLE_LAYERS_PASS_EVERY_PLAUSIBILITY_RULE_AND_A_PLANTED_HAZE_DOES_NOT[${name}]`,
      pOk,
      pDetail,
      'the bars were set off these layers with margin, so a real layer crossing one means the bar is wrong; the planted haze is the issue\'s layer on a real run, whose other layers are the figure it is measured against',
    );
  }
  return bad();
}

/** A raster with its rows and columns exchanged. */
function transposed(r: Raster): Raster {
  const out = newRaster(r.height, r.width);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) out.data.set(r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4), (x * out.width + y) * 4);
  return out;
}

function runInputsExamplesSuite(): number | null {
  section('inputs-examples: inputs reproduces every fetched example\'s st_input_full.png and st_input_head.png');
  const keys = exampleKeys().fetched.filter((k) => existsSync(join(EXAMPLES_DIR, k, 'inputs', 'painting.png')));
  if (keys.length === 0) {
    console.log('  SKIP  no examples/*/inputs/painting.png on disk (bun run fetch-examples), so the cut was not compared with the reference\'s');
    console.log('          ⚠️ This is a HOLE in this run, not a pass — inputs was exercised on the synthetic painting only.');
    return null;
  }
  const { say, bad } = counter();
  for (const k of keys) {
    const d = join(EXAMPLES_DIR, k);
    const r = makeInputs(readPng(join(d, 'inputs', 'painting.png')), loadConfig(join(d, 'config.json')), k);
    const rows: string[] = [];
    let ok = true;
    for (const [file, img] of [['st_input_full.png', r.full], ['st_input_head.png', r.head]] as const) {
      const ref = readPng(join(d, 'inputs', file));
      let diff = 0;
      if (img === null || img.width !== ref.width || img.height !== ref.height) diff = -1;
      else for (let i = 0; i < ref.data.length; i++) if (ref.data[i] !== img.data[i]) diff++;
      rows.push(`${file} ${ref.width}x${ref.height}: ${diff < 0 ? 'size differs' : `${diff} byte(s) differ`}`);
      if (diff !== 0) ok = false;
    }
    say(
      `IE01_EXAMPLE_${k.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_INPUTS_MATCH_THE_REFERENCE_PIXEL_FOR_PIXEL`,
      ok,
      rows.join('; '),
      "the reference cut these two files from this painting; the port has to cut the same pixels, or every See-through layer downstream moves",
    );

    // Issue #78 on a real painting: the example transposed is landscape, and its full input must be the
    // reference's st_input_full.png transposed — the vertical pad is the horizontal one, by definition.
    // The planted input is the reference's paste on the transposed painting: the square's top rows.
    const painting = readPng(join(d, 'inputs', 'painting.png'));
    const refFull = readPng(join(d, 'inputs', 'st_input_full.png'));
    const turned = transposed(painting);
    const t = makeInputs(turned, {}, `${k} transposed`);
    const want = transposed(refFull);
    const diffs = (a: Raster, b: Raster): number => (a.width !== b.width || a.height !== b.height ? -1 : a.data.reduce((n, v, i) => n + (v === b.data[i] ? 0 : 1), 0));
    const pasted = newRaster(want.width, want.height);
    pasted.data.fill(255);
    pasted.data.set(turned.data, 0);
    const got = diffs(t.full, want);
    const plant = diffs(pasted, want);
    say(
      `IE02_EXAMPLE_${k.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TRANSPOSED_IS_PADDED_VERTICALLY_TO_THE_REFERENCE_S_INPUT_TRANSPOSED`,
      got === 0 && plant > 0 && t.padLeft === 0 && t.padTop === squarePad(painting.width, painting.height).left,
      `${turned.width}x${turned.height} -> ${t.full.width}x${t.full.height} at y ${t.padTop}: ${got < 0 ? 'size differs' : `${got} byte(s) differ`} from the reference's ${refFull.width}x${refFull.height} transposed; the planted top-aligned paste: ${plant} byte(s) differ`,
      'a real painting wider than tall, with a known answer: the reference never cut one, so its portrait cut, turned, is the only reference there is',
    );
  }
  return bad();
}

/** The reference's default pose words when generation.pose was absent — the planted mutant, private tail included. */
function referencePoseWords(skeleton: 'stand_sides' | 'stand_clasp'): string {
  return `${FRAMING}, ${SKELETONS[skeleton].words}, gentle smile, long robe to the ankles, feet visible, shoes`;
}

/** Every positive term that none of its named sources holds. Empty means each word is traceable to the config, the head or the skeleton. */
function untraceable(positive: string, g: Generation): string[] {
  const terms = (s: string): string[] => s.split(',').map((t) => t.trim()).filter((t) => t !== '');
  const pose = g.pose !== undefined ? g.pose : g.control !== undefined ? `${FRAMING}, ${SKELETONS[g.control.skeleton].words}` : '';
  const known = new Set([POSITIVE_HEAD, g.trigger, g.identity, g.costume, pose, g.style].flatMap(terms));
  return terms(positive).filter((t) => !known.has(t));
}

function runPromptSuite(): number {
  section('prompt: the words and the graphs the ComfyUI adapter submits');
  const { say, bad } = counter();
  const s = stripWords('a, Symmetry, , b ,character sheet, symmetrical composition, c');
  say(
    'PR01_DUP_WORDS_ARE_STRIPPED_CASE_INSENSITIVELY_PER_TERM',
    s.text === 'a, b, c' && s.dropped.join('|') === 'Symmetry|character sheet|symmetrical composition' && stripWords('asymmetry').text === 'asymmetry',
    `"${s.text}", dropped ${s.dropped.join(' | ')}; "asymmetry" kept ("${stripWords('asymmetry').text}")`,
    'prompt-only batches drew two figures side by side in 21 of 24 images with these terms in; the match is per term, so a word containing one is kept',
  );

  const g: Generation = {
    checkpoint: 'base.safetensors',
    loras: [{ name: 'style.safetensors', strength: 0.6 }],
    trigger: '',
    identity: '1girl, solo, adult woman',
    sampler: { steps: 30, cfg: 6, sampler: 'euler_ancestral', scheduler: 'normal' },
    costume: 'grey coat, black boots',
    negative_extra: '2girls',
    style: 'anime illustration',
    negative_pose: 'cropped',
    latent: [832, 1216],
    seed: 1,
    control: { skeleton: 'stand_clasp', strength: 0.8, end_percent: 0.7 },
  };
  const p = buildPrompts(g);
  const want = `${POSITIVE_HEAD}, 1girl, solo, adult woman, grey coat, black boots, ${FRAMING}, ${SKELETONS.stand_clasp.words}, anime illustration`;
  const planted = stripWords([POSITIVE_HEAD, g.trigger, g.identity, g.costume, referencePoseWords('stand_clasp'), g.style].join(', ')).text;
  const examples = exampleKeys().all.map((k) => [k, loadConfig(join(EXAMPLES_DIR, k, 'config.json')).generation] as const).filter((e): e is readonly [string, Generation] => e[1] !== undefined);
  const exampleHits = examples.flatMap(([k, eg]) => {
    const pos = buildPrompts(eg).positive;
    const cfgText = JSON.stringify(eg);
    return [...untraceable(pos, eg).map((t) => `${k}: "${t}"`), ...(pos.includes('long robe') && !cfgText.includes('long robe') ? [`${k}: long robe`] : [])];
  });
  const cleanOk = p.positive === want && !p.positive.includes('long robe') && untraceable(p.positive, g).length === 0 && p.poseFrom === 'the stand_clasp skeleton';
  const plantCaught = planted.includes('long robe') && untraceable(planted, g).length > 0;
  say(
    'PR02_WITHOUT_A_POSE_THE_POSE_WORDS_ARE_THE_SKELETONS_AND_NO_CAST_WORD_IS_EMITTED',
    cleanOk && plantCaught && exampleHits.length === 0,
    `positive = head, identity, costume, FRAMING, the stand_clasp words, style (${p.positive.length} chars, ${p.positive === want ? 'as assembled by hand' : `differs: ${p.positive}`}); ` +
      `no "long robe", 0 untraceable terms; the reference's default planted -> untraceable ${untraceable(planted, g).map((t) => `"${t}"`).join(', ')}; ` +
      `${examples.length} example config(s): ${exampleHits.length === 0 ? '0 untraceable terms' : exampleHits.join('; ')}`,
    "the reference appended one private cast's expression and costume words after the skeleton's; a word no config and no skeleton holds is a word the tool invented",
  );

  const posed = buildPrompts({ ...g, pose: 'standing, arms crossed' });
  say(
    'PR03_A_POSE_IN_THE_CONFIG_IS_THE_WHOLE_OF_THE_POSE_WORDS',
    posed.positive.includes('standing, arms crossed') && !posed.positive.includes(SKELETONS.stand_clasp.words) && !posed.positive.includes('head to toe') && posed.poseFrom === 'generation.pose',
    `pose "standing, arms crossed" with a stand_clasp control -> skeleton words ${posed.positive.includes(SKELETONS.stand_clasp.words) ? 'present' : 'absent'}, framing ${posed.positive.includes('head to toe') ? 'present' : 'absent'}`,
    'the skeleton is a fallback for the words and never an addition to what the config wrote',
  );

  const bare = buildPrompts({ ...g, negative_extra: '' });
  say(
    'PR04_THE_NEGATIVE_IS_HEAD_EXTRA_POSE_AND_AN_EMPTY_EXTRA_LEAVES_NO_GAP',
    p.negative === `${NEGATIVE_HEAD}, 2girls, cropped` && bare.negative === `${NEGATIVE_HEAD}, cropped` && NEGATIVE_HEAD.includes('child, loli, shota') && NEGATIVE_HEAD.includes('nsfw, nude'),
    `"...${p.negative.slice(-24)}"; with negative_extra "" -> "...${bare.negative.slice(-24)}"; the safety terms of the head are present`,
    "the reference's negative is NEG_HEAD + extra + ', ' + pose; the head's nudity and minor terms are a guard, not a cast",
  );

  const graph = paintingGraph(g, 9, p, 'pfx', 'skel.png');
  const ks = graph['3'].inputs;
  const wired =
    JSON.stringify(ks.positive) === '["32",0]' &&
    JSON.stringify(ks.negative) === '["32",1]' &&
    JSON.stringify(ks.model) === '["20",0]' &&
    ks.seed === 9 &&
    graph['20'].inputs.strength_clip === 0.6 &&
    graph['31'].inputs.control_net_name === 'controlnet-openpose-sdxl-1.0.safetensors' &&
    graph['30'].inputs.image === 'skel.png' &&
    graph['14'].inputs.scale_by === 0.5;
  const noControl = paintingGraph({ ...g, control: undefined, pose: 'standing' }, 9, p, 'pfx', null);
  say(
    'PR05_THE_PAINTING_GRAPH_CHAINS_LORAS_AND_CONTROL_INTO_THE_SAMPLER',
    wired && !('32' in noControl) && JSON.stringify(noControl['3'].inputs.positive) === '["6",0]',
    `KSampler positive ${JSON.stringify(ks.positive)}, negative ${JSON.stringify(ks.negative)}, model ${JSON.stringify(ks.model)}, seed ${ks.seed}; LoRA strength_clip ${graph['20'].inputs.strength_clip} (= strength when absent); without control the sampler reads node 6 directly`,
    "checkpoint -> LoRAs -> encoders -> ControlNetApplyAdvanced -> KSampler -> 4x-AnimeSharp -> 0.5 is the reference's graph; a link to the wrong node is a valid graph that ignores the control",
  );

  const template: unknown = JSON.parse(readFileSync(join(ROOT, 'workflows', 'seethrough.json'), 'utf8'));
  const params = { image: 'in.png', seed: 7, resolution: 512, steps: 3, quant: 'none' as const, offload: true, lama: false, prefix: 'run1' };
  const st = fillSeeThrough(template, params);
  const stray = threw(() => fillSeeThrough({ '1': { class_type: 'X', inputs: { a: '%NOBODY%' } } }, params));
  const filled = !JSON.stringify(st).includes('%') && !('_comment' in st) && st['3'].inputs.seed === 7 && st['3'].inputs.resolution === 512 && st['2'].inputs.group_offload === true && st['9'].inputs.filename_prefix === 'run1_preview_parts';
  say(
    'PR06_THE_SEETHROUGH_TEMPLATE_IS_FILLED_TYPED_AND_A_STRAY_PLACEHOLDER_IS_REFUSED',
    filled && stray !== null && stray.includes('%NOBODY%'),
    `${Object.keys(st).length} nodes, no "%" left, seed ${String(st['3'].inputs.seed)} (a number), offload ${String(st['2'].inputs.group_offload)}; a template holding %NOBODY% -> ${stray ?? 'nothing thrown'}`,
    'a placeholder sent unfilled is a string where the node wants an integer, which the box refuses only after the upload',
  );

  const info = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['base.safetensors']] } } },
    UpscaleModelLoader: { input: { required: { model_name: ['COMBO', { options: ['4x-AnimeSharp.pth'] }] } } },
    SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] }, hidden: { prompt: 'PROMPT' } } },
  };
  const probe = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'base.safetensors' } },
    '12': { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-AnimeSharp.pth' } },
    '9': { class_type: 'SaveImage', inputs: { images: ['14', 0] as [string, number], filename_prefix: 'p' } },
  };
  const green = checkGraph(probe, info, 'box');
  const red = checkGraph(
    {
      ...probe,
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'other.safetensors' } },
      '12': { class_type: 'UpscaleModelLoader', inputs: { model_name: 'nope.pth' } },
      '9': { class_type: 'SaveImage', inputs: { images: ['14', 0] as [string, number], fps: 3 } },
      '40': { class_type: 'SeeThrough_SavePSD', inputs: {} },
    },
    info,
    'box',
  );
  const got = red.map((q) => q.code).sort().join(',');
  say(
    'PR07_A_GRAPH_IS_CHECKED_AGAINST_OBJECT_INFO_NODE_BY_NODE',
    green.length === 0 && got === 'COMFY_CHOICE_PRESENT,COMFY_CHOICE_PRESENT,COMFY_INPUT_KNOWN,COMFY_INPUT_SET,COMFY_NODE_PRESENT',
    `a matching graph -> ${green.length} problem(s); planted -> ${red.map((q) => `${q.code} ${q.object}`).join('; ')}`,
    'both enum spellings /object_info uses are read, hidden inputs are inputs, and a missing node class is named before anything is uploaded',
  );
  return bad();
}

interface HarnessResult {
  status: number;
  out: string;
  paths: string[];
  uploads: string[];
  prompts: number;
}

/**
 * Where two output trees differ: every file under either, byte for byte, after
 * `normalise` (identity unless a caller names a value the clock writes). Each
 * line names the file relative to its tree. Empty means byte-identical; an
 * empty first tree is a difference, so two trees of nothing never agree.
 */
function treeDiff(a: string, b: string, normalise: (bytes: Buffer, file: string) => Buffer = (bytes) => bytes): string[] {
  const out: string[] = [];
  const fa = existsSync(a) ? filesUnder(a) : [];
  const fb = existsSync(b) ? filesUnder(b) : [];
  if (fa.length === 0) out.push(`${a} holds nothing`);
  for (const f of [...new Set([...fa, ...fb])].sort()) {
    if (!fa.includes(f) || !fb.includes(f)) {
      out.push(`${f}: only under ${fa.includes(f) ? a : b}`);
      continue;
    }
    const x = normalise(readFileSync(join(a, f)), f);
    const y = normalise(readFileSync(join(b, f)), f);
    if (x.equals(y)) continue;
    let at = 0;
    while (at < x.length && at < y.length && x[at] === y[at]) at++;
    out.push(`${f}: differs from byte ${at} (${JSON.stringify(x.subarray(at, at + 24).toString('latin1'))} vs ${JSON.stringify(y.subarray(at, at + 24).toString('latin1'))})`);
  }
  return out;
}

/** A file's text, or "" when it is absent. */
function readOr(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * Where two harness paint scenarios' outputs differ: every file under each
 * scenario's --out, byte for byte, and the graph each sent the box. The one
 * value set aside is a meta's `elapsed_s`, which the clock writes and no
 * config can hold still. Empty means byte-identical.
 */
function paintRunDiff(dir: string, a: string, b: string): string[] {
  const clockless = (bytes: Buffer, file: string): Buffer => (file.endsWith('_meta.json') ? Buffer.from(bytes.toString('utf8').replace(/"elapsed_s": [0-9.]+/, '"elapsed_s": <clock>')) : bytes);
  const out = treeDiff(join(dir, a), join(dir, b), clockless);
  const ga = readOr(join(dir, `${a}.prompts.json`));
  const gb = readOr(join(dir, `${b}.prompts.json`));
  if (ga === '' || ga !== gb) out.push(`the graph sent: ${ga === '' ? `${a} sent none` : 'differs'}`);
  return out;
}

function runComfySuite(): number {
  section('comfy: the adapter against a fake ComfyUI on 127.0.0.1');
  const { say, bad } = counter();
  const dir = temp('comfy');
  try {
    const h = spawnSync('bun', [join(ROOT, 'fixtures', 'comfyharness.ts'), dir], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    let parsed: { image: string; results: Record<string, HarnessResult> } | null = null;
    try {
      parsed = JSON.parse((h.stdout ?? '').trim().split('\n').pop() ?? '');
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      say('CF00_THE_HARNESS_RAN', false, `exit ${h.status}; ${(h.stdout ?? '').slice(-400)} ${(h.stderr ?? '').slice(-400)}`, 'the scenarios run in a child process that serves the fake box');
      return bad();
    }
    const R = parsed.results;
    const fail = (r: HarnessResult | undefined, code: string): string | null => (r === undefined ? null : failLine(r.out, code));
    const nothingSent = (r: HarnessResult | undefined): boolean => r !== undefined && r.uploads.length === 0 && r.prompts === 0;
    const leftovers = (name: string): string[] => readdirSync(dir).filter((f) => f === name || f.startsWith(`.${name}.partial`));

    const ok = R['st-ok'];
    const out = join(dir, 'st-ok');
    const meta = readJsonFile(join(out, 'meta.json'));
    let set: LayerSet | null = null;
    try {
      set = readWrapperLayers(out);
    } catch {
      set = null;
    }
    const prompts = JSON.parse(readFileSync(join(dir, 'st-ok.prompts.json'), 'utf8')) as Array<Record<string, { inputs: Record<string, unknown> }>>;
    const g = prompts[0];
    const uploaded = ok.uploads.length === 1 ? readFileSync(join(dir, 'st-ok.uploads', ok.uploads[0])) : null;
    const input = readFileSync(parsed.image);
    const layersRight =
      set !== null &&
      set.layers.map((l) => l.name).sort().join('|') === WRAPPER_LAYERS.map((l) => l.name).sort().join('|') &&
      set.layers.every((l) => l.opaquePx === (WRAPPER_LAYERS.find((w) => w.name === l.name)?.painted ?? -1));
    const graphRight =
      g !== undefined &&
      g['3'].inputs.seed === 7 &&
      g['3'].inputs.resolution === 512 &&
      g['3'].inputs.num_inference_steps === 3 &&
      g['2'].inputs.group_offload === true &&
      g['6'].inputs.use_lama === false &&
      g['7'].inputs.filename_prefix === meta?.prefix &&
      !JSON.stringify(g).includes('%');
    const written = ['layers.json', 'meta.json'].map((f) => readFileSync(join(out, f), 'utf8'));
    const hostFree = written.every((t) => !t.includes('127.0.0.1'));
    const previews = existsSync(join(out, 'previews')) ? readdirSync(join(out, 'previews')).length : 0;
    say(
      'CF01_A_GREEN_RUN_WRITES_THE_WRAPPER_FORM_THE_LAYER_READER_ACCEPTS',
      ok.status === 0 && layersRight && graphRight && uploaded !== null && uploaded.equals(input) && hostFree && previews === 2 && meta?.seed === 7 && leftovers('st-ok').length === 1,
      `exit ${ok.status}; ${set === null ? 'the layer reader refused the output' : `${set.layers.length} layers read back, opaque counts ${layersRight ? 'equal to the fixture' : 'DIFFER'}`}; ` +
        `graph seed/resolution/steps/offload/lama/prefix ${graphRight ? 'as passed' : 'WRONG'}; upload ${uploaded === null ? 'absent' : uploaded.equals(input) ? 'byte-identical to the input' : 'differs'}; ${previews} preview(s); host in written files: ${hostFree ? 'no' : 'YES'}; routes ${[...new Set(ok.paths)].join(', ')}`,
      'the positive control: the refusals below are only worth something if a box that answers correctly yields a layer set the next stage reads',
    );

    const busy = R['st-busy'];
    say(
      'CF02_A_QUEUE_THAT_NEVER_EMPTIES_IS_REFUSED_BY_NAME_BEFORE_ANYTHING_IS_SENT',
      busy.status === 1 && fail(busy, 'COMFY_QUEUE_EMPTY') !== null && nothingSent(busy) && leftovers('st-busy').length === 0,
      `exit ${busy.status}; "${fail(busy, 'COMFY_QUEUE_EMPTY') ?? 'no COMFY_QUEUE_EMPTY line'}"; uploads ${busy.uploads.length}, prompts ${busy.prompts}`,
      "the adapter never queues behind someone else's job, and a wait that runs out says how long it waited for what",
    );

    const empty = R['st-no-outputs'];
    say(
      'CF03_A_HISTORY_ENTRY_WITH_NO_OUTPUTS_IS_REFUSED_AND_NOTHING_IS_WRITTEN',
      empty.status === 1 && fail(empty, 'COMFY_HISTORY_OUTPUTS') !== null && leftovers('st-no-outputs').length === 0,
      `exit ${empty.status}; "${fail(empty, 'COMFY_HISTORY_OUTPUTS') ?? 'no COMFY_HISTORY_OUTPUTS line'}"; left on disk: ${leftovers('st-no-outputs').join(', ') || 'nothing'}`,
      'a job that finished and saved nothing is not a result, and an empty directory at --out would read as one',
    );

    const bare = R['st-no-seethrough'];
    const missing = (bare.out.match(/COMFY_NODE_PRESENT: graph node \d+ — is a (SeeThrough_\w+)/g) ?? []).length;
    say(
      'CF04_A_BOX_WITHOUT_THE_SEETHROUGH_NODES_IS_REFUSED_NAMING_EACH_CLASS_BEFORE_UPLOAD',
      bare.status === 1 && missing === 6 && nothingSent(bare),
      `exit ${bare.status}; ${missing} SeeThrough_* class(es) named missing (6 in the workflow); uploads ${bare.uploads.length}, prompts ${bare.prompts}`,
      'the wrapper not installed is the likeliest failure on a fresh box, and /object_info answers it before a GPU is touched',
    );

    const stale = R['st-stale'];
    say(
      'CF05_A_MANIFEST_FROM_ANOTHER_RUN_IS_REFUSED',
      stale.status === 1 && fail(stale, 'COMFY_MANIFEST_IS_THIS_RUN') !== null && leftovers('st-stale').length === 0,
      `exit ${stale.status}; "${fail(stale, 'COMFY_MANIFEST_IS_THIS_RUN') ?? 'no COMFY_MANIFEST_IS_THIS_RUN line'}"`,
      'seethrough_psd_info.log names the last manifest ANY run wrote; reading it without checking the prefix would hand back somebody else\'s layers',
    );

    const paint = R['paint-ok'];
    const pdir = join(dir, 'paint-ok');
    const pm = readJsonFile(join(pdir, 'painting_5_meta.json'));
    const pprompts = JSON.parse(readFileSync(join(dir, 'paint-ok.prompts.json'), 'utf8')) as Array<Record<string, { inputs: Record<string, unknown> }>>;
    const skel = encodePngBytes(renderSkeleton('stand_clasp', 16, 24));
    const control = existsSync(join(pdir, 'control_stand_clasp.png')) ? new Uint8Array(readFileSync(join(pdir, 'control_stand_clasp.png'))) : null;
    const up = paint.uploads.length === 1 ? new Uint8Array(readFileSync(join(dir, 'paint-ok.uploads', paint.uploads[0]))) : null;
    const eq = (a: Uint8Array | null, b: Uint8Array): boolean => a !== null && a.length === b.length && a.every((v, i) => v === b[i]);
    const painted = [5, 6].every((s) => existsSync(join(pdir, `painting_${s}.png`)) && eq(new Uint8Array(readFileSync(join(pdir, `painting_${s}.png`))), encodePngBytes(fakePainting(32, 48))));
    const positive = typeof pm?.positive === 'string' ? pm.positive : '';
    const seeds = pprompts.map((q) => q['3']?.inputs.seed);
    say(
      'CF06_A_GREEN_PAINT_WRITES_EACH_SEED_WITH_ITS_VERBATIM_PROMPTS_AND_THE_SKELETON_IT_UPLOADED',
      paint.status === 0 &&
        painted &&
        eq(control, skel) &&
        eq(up, skel) &&
        JSON.stringify(seeds) === '[5,6]' &&
        positive.includes(SKELETONS.stand_clasp.words) &&
        !positive.includes('symmetrical composition') &&
        JSON.stringify(pm?.dropped) === '["symmetrical composition"]' &&
        (pm?.control as Record<string, unknown> | undefined)?.model === 'controlnet-openpose-sdxl-1.0.safetensors' &&
        pprompts[0]?.['6']?.inputs.text === positive,
      `exit ${paint.status}; painting_5/6 ${painted ? 'byte-identical to what the box saved' : 'missing or different'}; control_stand_clasp.png ${eq(control, skel) ? '= the rendered skeleton' : 'differs'}, upload ${eq(up, skel) ? '= it' : 'differs'}; KSampler seeds ${JSON.stringify(seeds)}; dropped ${JSON.stringify(pm?.dropped)}; meta positive ${pprompts[0]?.['6']?.inputs.text === positive ? '= the text sent' : 'differs from the text sent'}`,
      'the meta is the record of what produced the painting, so the prompt in it is the prompt that was sent, and the control image is the one that was uploaded',
    );

    const ckpt = R['paint-missing-ckpt'];
    say(
      'CF07_A_CHECKPOINT_THE_BOX_DOES_NOT_LIST_IS_REFUSED_BEFORE_UPLOAD',
      ckpt.status === 1 && (fail(ckpt, 'COMFY_CHOICE_PRESENT') ?? '').includes('not_on_the_box.safetensors') && nothingSent(ckpt) && !existsSync(join(dir, 'paint-missing-ckpt', 'painting_5.png')),
      `exit ${ckpt.status}; "${fail(ckpt, 'COMFY_CHOICE_PRESENT') ?? 'no COMFY_CHOICE_PRESENT line'}"; uploads ${ckpt.uploads.length}, prompts ${ckpt.prompts}`,
      'a model name the box does not have fails the job after the queue wait; /object_info names it before',
    );

    const gone = R['st-unreachable'];
    say(
      'CF08_A_BOX_THAT_DOES_NOT_ANSWER_IS_REFUSED_NAMING_THE_HOST',
      gone.status === 1 && (fail(gone, 'COMFY_REACHABLE') ?? '').includes('127.0.0.1') && !existsSync(join(dir, 'st-unreachable')),
      `exit ${gone.status}; "${fail(gone, 'COMFY_REACHABLE') ?? 'no COMFY_REACHABLE line'}"`,
      'an unreachable host is the first thing an agent with a wrong address meets, and the line has to say which address',
    );

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (k !== 'COMFY_HOST' && v !== undefined) env[k] = v;
    const nohost = spawnSync('bun', [join(ROOT, 'cli.ts'), 'comfy', 'seethrough', '--image', parsed.image, '--out', join(dir, 'nohost')], { cwd: ROOT, encoding: 'utf8', env });
    const nohostOut = `${nohost.stdout ?? ''}${nohost.stderr ?? ''}`;
    const emptyHost = spawnSync('bun', [join(ROOT, 'cli.ts'), 'comfy', 'paint', '--config', join(dir, 'paint.json'), '--out', join(dir, 'nohost2')], { cwd: ROOT, encoding: 'utf8', env: { ...env, COMFY_HOST: '' } });
    say(
      'CF09_NO_HOST_IS_REFUSED_BY_NAME_AND_THERE_IS_NO_DEFAULT',
      nohost.status === 1 && failLine(nohostOut, 'COMFY_HOST_GIVEN') !== null && emptyHost.status === 1 && failLine(`${emptyHost.stdout ?? ''}`, 'COMFY_HOST_GIVEN') !== null,
      `no --host, no COMFY_HOST -> exit ${nohost.status} "${failLine(nohostOut, 'COMFY_HOST_GIVEN') ?? nohostOut.slice(0, 200)}"; COMFY_HOST="" -> exit ${emptyHost.status}`,
      "the reference defaulted to one person's LAN address; a host is the user's, supplied at run time, and an empty one is not one",
    );

    // The early door: a config that holds only what exists before the painting.
    const only = R['paint-only'];
    const onlyGen = (readJsonFile(join(dir, 'paint_only.json')) as { generation: Generation }).generation;
    const onlySent = JSON.parse(readFileSync(join(dir, 'paint-only.prompts.json'), 'utf8')) as Array<Record<string, { inputs: Record<string, unknown> }>>;
    const onlyMeta = readJsonFile(join(dir, 'paint-only', 'painting_11_meta.json'));
    const sentText = onlySent[0]?.['6']?.inputs.text;
    const sentSeed = onlySent[0]?.['3']?.inputs.seed;
    say(
      'CF10_A_CONFIG_OF_ONLY_KEY_AND_GENERATION_REACHES_THE_BOX_WITH_ITS_PROMPT_AND_SEED',
      only.status === 0 &&
        onlySent.length === 1 &&
        sentSeed === onlyGen.seed &&
        sentText === buildPrompts(onlyGen).positive &&
        existsSync(join(dir, 'paint-only', 'painting_11.png')) &&
        onlyMeta?.key === 'paint_only' &&
        failLine(only.out, '') === null,
      `exit ${only.status}; ${onlySent.length} prompt(s) queued, KSampler seed ${JSON.stringify(sentSeed)} (generation.seed ${onlyGen.seed}), positive ${sentText === buildPrompts(onlyGen).positive ? '= buildPrompts(generation)' : 'DIFFERS from buildPrompts(generation)'}; meta key ${JSON.stringify(onlyMeta?.key)}${failLine(only.out, '') === null ? '' : `; "${failLine(only.out, '')}"`}`,
      'comfy paint runs before See-through and before the rig, so a config that holds only key and generation is what exists then; the full loader refused it with five CONFIG_FIELD_PRESENT lines before a painting was generated',
    );

    const rigOnly = runCli(['rig', '--config', join(dir, 'paint_only.json'), '--parts', dir, '--out', join(dir, 'paint_only_rig')]);
    const rigSections = ['config.assemble', 'config.bones', 'config.meshes', 'config.regions', 'config.motion'];
    const rigNamed = rigSections.filter((f) => rigOnly.out.includes(`FAIL  CONFIG_FIELD_PRESENT: ${f} `));
    say(
      'CF11_THE_SAME_CONFIG_IS_STILL_REFUSED_BY_RIG_NAMING_EACH_SECTION',
      rigOnly.status === 1 && rigNamed.length === rigSections.length && !existsSync(join(dir, 'paint_only_rig')),
      `rig --config paint_only.json -> exit ${rigOnly.status}; CONFIG_FIELD_PRESENT for ${rigNamed.length}/${rigSections.length} of ${rigSections.join(', ')}`,
      'the early door narrows what one step requires; it does not open the full loader, which still stands in front of rig',
    );

    const noGen = R['paint-no-generation'];
    const noGenLine = failLine(noGen.out, 'CONFIG_FIELD_PRESENT: config.generation');
    const noGenFails = noGen.out.split('\n').filter((l) => l.startsWith('  FAIL  ')).length;
    say(
      'CF12_COMFY_PAINT_ON_A_CONFIG_WITHOUT_GENERATION_IS_REFUSED_NAMING_IT_BEFORE_THE_BOX_IS_ASKED',
      noGen.status === 1 &&
        noGenLine !== null &&
        noGenLine.includes('checkpoint') &&
        noGenLine.includes('pose or control') &&
        noGenFails === 1 &&
        noGen.paths.length === 0 &&
        !existsSync(join(dir, 'paint-no-generation')),
      `exit ${noGen.status}; "${noGenLine ?? 'no CONFIG_FIELD_PRESENT line for config.generation'}"; ${noGenFails} FAIL line(s); requests to the box: ${noGen.paths.length}`,
      'generation is the one block this step paints from, so on this door it is required, and its absence names the fields it has to hold; seethrough and assemble are not asked for, because they do not exist yet',
    );

    // Issue #70, the paint door's half of "read by nothing": what paint-only
    // wrote, against the same config with records and annotations written into
    // it, with one real sampler value changed besides, and with the sampler's
    // four keys in another order.
    const pr = paintRunDiff(dir, 'paint-only', 'paint-records');
    const pp = paintRunDiff(dir, 'paint-only', 'paint-records-plant');
    const metaPlant = pp.find((d) => d.startsWith('painting_11_meta.json'));
    const leaked = ['four steps', 'a remark on one field', 'x-tried', 'x-seeds_tried', 'x-why', 'x-source', 'x-status'].filter((w) => readOr(join(dir, 'paint-records', 'painting_11_meta.json')).includes(w));
    say(
      'CF13_RECORDS_AND_ANNOTATIONS_IN_THE_CONFIG_LEAVE_THE_PAINTING_META_AND_GRAPH_BYTE_IDENTICAL_AND_ONE_SAMPLER_VALUE_DOES_NOT',
      R['paint-records']?.status === 0 && R['paint-records-plant']?.status === 0 && pr.length === 0 && leaked.length === 0 && metaPlant !== undefined && pp.some((d) => d.startsWith('the graph sent')),
      `paint_records.json (a note, a steps_note and an x- record in generation.sampler; x- records in a LoRA, in generation.control and in generation; x- records at the top level holding an object, a number, null and an array) -> exit ${R['paint-records']?.status}, against paint-only: ${pr.length === 0 ? 'every file and the graph sent byte-identical (elapsed_s, the clock, set aside)' : pr.join(' | ')}; words of the records found in its meta: ${leaked.join(', ') || 'none'}; planted, generation.sampler.cfg 6 -> 6.5 -> ${pp.length === 0 ? 'IDENTICAL, so the comparison sees nothing' : pp.join(' | ')}`,
      'issue #70: an x- record and an annotation are read by nothing, and the painting meta is an output; it once wrote generation.sampler whole, so whatever its author wrote beside the four fields reached the meta. The plant is the witness that the comparison reads the meta and the graph at all',
    );

    const po = paintRunDiff(dir, 'paint-only', 'paint-reordered');
    say(
      'CF14_A_SAMPLER_WRITTEN_IN_ANOTHER_KEY_ORDER_WRITES_THE_SAME_META',
      R['paint-reordered']?.status === 0 && po.length === 0,
      `generation.sampler written scheduler, sampler, cfg, steps -> exit ${R['paint-reordered']?.status}, against paint-only (steps, cfg, sampler, scheduler): ${po.length === 0 ? 'every file and the graph sent byte-identical (elapsed_s set aside)' : po.join(' | ')}`,
      'determinism is a contract: the meta names the sampler\'s fields in one order (resolvedSampler), not in the order its author happened to type them',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
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

const SPINE_CORE = '@esotericsoftware/spine-core';

/** Where this repository's spine-core devDependency pin and the installed spine-rigc's devDependency pin disagree, or null when they are equal. */
function pinDrift(ours: { devDependencies?: Record<string, string> }, theirs: { version?: string; devDependencies?: Record<string, string> } | null): string | null {
  if (theirs === null) return 'node_modules/spine-rigc/package.json is not there; run `bun install`';
  const a = ours.devDependencies?.[SPINE_CORE];
  const b = theirs.devDependencies?.[SPINE_CORE];
  if (a === undefined) return `package.json declares no ${SPINE_CORE} devDependency`;
  if (b === undefined) return `spine-rigc ${theirs.version ?? '?'} declares no ${SPINE_CORE} devDependency, so there is no pin to hold this one to`;
  return a === b ? null : `package.json pins ${SPINE_CORE} ${a}; spine-rigc ${theirs.version ?? '?'} develops against ${b}; the two must be equal`;
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

  const ours = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
  const rigcPkgPath = join(ROOT, 'node_modules', 'spine-rigc', 'package.json');
  const theirs = existsSync(rigcPkgPath) ? (JSON.parse(readFileSync(rigcPkgPath, 'utf8')) as { version?: string; devDependencies?: Record<string, string> }) : null;
  const drift = pinDrift(ours, theirs);
  const plantDrift = pinDrift({ devDependencies: { [SPINE_CORE]: '4.3.12' } }, theirs);
  const plantAbsent = pinDrift({ devDependencies: {} }, theirs);
  say(
    'TY10_THE_SPINE_CORE_PIN_IS_THE_ONE_SPINE_RIGC_DEVELOPS_AGAINST',
    drift === null && plantDrift !== null && plantAbsent !== null,
    `package.json ${SPINE_CORE} ${ours.devDependencies?.[SPINE_CORE] ?? 'absent'}, spine-rigc ${theirs?.version ?? '(not installed)'}'s devDependency ${theirs?.devDependencies?.[SPINE_CORE] ?? 'absent'}: ${drift ?? 'equal'}; a planted 4.3.12 -> ${plantDrift ?? 'not found'}; a planted absence -> ${plantAbsent ?? 'not found'}`,
    "spine-core is this repository's development dependency — the round trip in its selftest and CI, the selftest's posing oracle, the two tools — because spine-rigc 2.0 stopped carrying it; a runtime other than the one rigc's round trip is developed against would be a second opinion nobody chose",
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
  tally.of('propose', runProposeSuite);
  tally.of('propose-corpus', runProposeCorpusSuite);
  tally.of('check', runCheckSuite);
  tally.of('loop', runLoopSuite);
  tally.of('assemble', runAssembleSuite);
  tally.of('plausibility', runPlausibilitySuite);
  tally.of('assemble-examples', runAssembleExamplesSuite);
  tally.of('skeleton', runSkeletonSuite);
  tally.of('inputs', runInputsSuite);
  tally.of('inputs-examples', runInputsExamplesSuite);
  tally.of('prompt', runPromptSuite);
  tally.of('comfy', runComfySuite);
  tally.of('build', runBuildSuite);
  tally.of('chain', runChainSuite);
  tally.of('readme-loop', runReadmeLoopSuite);
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
  const chainClause = holes.includes('chain') ? '' : `, + ${n('chain')} example-chain`;
  const readmeLoopClause = holes.includes('readme-loop') ? '' : `, + ${n('readme-loop')} readme-loop`;
  const proposeClause = holes.includes('propose-corpus') ? '' : `, + ${n('propose-corpus')} example-propose`;
  const assembleExamplesClause = holes.includes('assemble-examples') ? '' : `, + ${n('assemble-examples')} assemble-example`;
  const inputsClause = holes.includes('inputs-examples') ? '' : `, + ${n('inputs-examples')} example-inputs`;
  console.log(
    `spine-parts selftest: green — ${tally.total} control(s) over ${ran} suite(s): ${raster} raster-op, + ${n('png')} codec, ` +
      `+ ${n('layers-wrapper')} wrapper-reader, + ${n('layers-psd')} PSD-reader, + ${n('config')} config, + ${n('parts')} parts.json, ` +
      `+ ${n('sheet')} sheet, + ${n('cli')} CLI, + ${n('assemble')} assemble, + ${n('plausibility')} plausibility, + ${n('propose')} propose, + ${n('rig')} rig, + ${n('check')} check, + ${n('loop')} loop-encoder, + ${n('skeleton')} skeleton, + ${n('inputs')} inputs, + ${n('prompt')} prompt, + ${n('comfy')} comfy-adapter, + ${n('build')} build, + ${n('tree')} tree, + ${n('run-tally')} tally${corpusClause}${proposeClause}${assembleExamplesClause}${inputsClause}${chainClause}${readmeLoopClause}`,
  );
  if (holes.length > 0) console.log(`  ⚠️ HOLE: ${holes.join(', ')} did not run, so this run does not cover ${holes.length === 1 ? 'it' : 'them'}.`);
  // the summary ends here
}

main();
