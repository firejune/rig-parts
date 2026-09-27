/**
 * The check stage: build a rig through spine-rigc, gate it under both
 * profiles, render its idle, and measure the two things the gate cannot see —
 * whether the setup pose IS the flat stack of parts (the seam), and whether the
 * idle ends where it began (the loop).
 *
 * ⭐ **This is the one stage that drives a subprocess, and it does not own the
 * spawn.** Every rigc step — build, validate, render — is spine-rigc's own CLI,
 * never a re-implementation of it, because rigc's round trip through
 * `spine-core` is the only oracle behind a skeleton (CLAUDE.md, "spine-rigc's
 * validation is not optional here either"). But `src/` is held to no child
 * processes (`TY06`, with `src/comfy/` its one named exception), so the process
 * is injected: `runCheck` takes a {@link RigcRunner}, `cli.ts` hands it one
 * that spawns the binary {@link findRigc} located, and the selftest hands it
 * the same. What this module does with the file system is read inputs and write
 * the outputs listed below; it never reads the clock or the network.
 *
 * Input — a rig directory holding what the rig stage writes:
 * `rig.json`, `motion.json` (with an `idle` animation), `parts.json`, and
 * `parts/<name>.png` for every part (the last two may sit in a directory of
 * their own, `partsHome`). The inputs are read only; everything is written
 * under the output directory:
 *
 * | output | what |
 * | --- | --- |
 * | `build/` | `rigc build --profile spine-html --pack` — the packed atlas is the final artifact |
 * | `gate_spine-html.txt` | that build's gate lines, verbatim |
 * | `gate_spine.txt` | `rigc validate build/ --profile spine`'s gate lines, verbatim |
 * | `idle_frames/` | `rigc render --animation idle --fps 12 --max 640`: `frames.json` + `idle/f*.png` |
 * | `contact.png` | rigc's own contact sheet of that render, copied out |
 * | `motion_heat.png` | frame 0 in grey with each pixel's largest change across the idle in red |
 * | `check.json` | the figures below and `PASS` |
 *
 * The acceptance bars are the reference implementation's (`check_rig.py`):
 * both gate summaries `0 failed`; seam mean |d| <= 1.0 of 255 and at most 50
 * pixels differing by more than 40; loop max |d| == 0.
 *
 * Beside them, five judgement lines (issue #11) measure what used to be left
 * to an eye — `BREATH_VISIBLE`, `BLINK_NO_HOLE`, `CHAIN_LAG`,
 * `TIP_OVER_ROOT`, `STILL_REGIONS_DARK` — from rigc renders of the idle (the
 * whole rig, or a part alone through `--slot`), from the setup still with the
 * blink held shut, or from `motion.json` read as sines. Each reports SKIP,
 * with the reason, when the rig has nothing for it to read. The instruments
 * are `src/instruments.ts`; the bars are below and in AUTHORING §7. After
 * them, one REPORTED line with no bar, `RECOMPOSITE_HOLES` (issue #25): the
 * uncovered holes `assemble` recorded in `parts.json`'s `recomposite` block,
 * copied into `check.json` because the seam cannot see them — it compares the
 * setup pose with the flat stack of parts, and a pixel no part holds is
 * missing from both. The
 * part-alone renders and the shut-eye still are scratch (`_isolated/`,
 * `_still/`), removed before the stage returns.
 *
 * Where this port deliberately differs from the reference, each written where
 * it applies below: a gate summary is read with a pattern rather than the
 * substring `"0 failed"` (which `"10 failed"` contains); a gate with no summary
 * line is not green (Python's `all()` of nothing is `True`); the seam render's
 * `--max` is the rig canvas's longest side rather than the literal 1216 (which
 * was that for every rig it ever saw); the grey is read from rigc's
 * `frames.json` rather than typed; the crop-to-world map comes from the rig's
 * own stage box through `src/coords.ts` rather than an open-coded `-W/2`; and
 * the last idle frame is refused unless it sits at t = duration.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { cropToSpineY } from './coords.ts';
import { PartsError, type Problem, refuseIfAny } from './errors.ts';
import {
  bandExcursion,
  blinkFigures,
  blinkTracks,
  boxLabel,
  chainFigures,
  EYE_TAGS,
  eyeBones,
  FACE_FEATURE_TAGS,
  FACE_TAGS,
  FEET_TAGS,
  frameBox,
  heatField,
  partsTagged,
  type PixelBox,
  regionHeat,
  rowHalves,
  SWING_TAGS,
  topmostIndex,
  TORSO_TAGS,
  visibleMask,
} from './instruments.ts';
import { type PartRecord, type PartsFile, readParts } from './parts.ts';
import { alphaComposite } from './raster/composite.ts';
import { readPng, writePng } from './raster/png.ts';
import { newFloatImage, newRaster, type Raster } from './raster/types.ts';
import type { BaseTag } from './tags.ts';
import { warpAffine } from './raster/warp.ts';

// ---------------------------------------------------------------------------
// the bars
// ---------------------------------------------------------------------------

/** Seam: mean max-channel |d| over the frame, in levels of 255, at most this. */
export const SEAM_MEAN_BAR = 1.0;
/** Seam: pixels whose max-channel |d| exceeds {@link SEAM_PX_LEVEL}, at most this many. */
export const SEAM_PX_BAR = 50;
export const SEAM_PX_LEVEL = 40;
/** Seam: the second, reported-only level. */
export const SEAM_PX_LEVEL_HIGH = 80;
/** Loop: frame 0 vs the frame at t = duration, largest |d|, exactly this. */
export const LOOP_MAX_BAR = 0;

/** The idle render the reference makes, and the one issue #1's loop is encoded from. */
export const IDLE_FPS = 12;
export const IDLE_MAX_PX = 640;
/** The throwaway setup-pose animation: one key at 0 and one at this time, rendered at this rate. */
const STILL_DURATION = 0.1;
const STILL_FPS = 10;

/**
 * The judgement lines' bars (issue #11). Each is derived from the two public
 * examples by one stated rule, and AUTHORING §7 quotes what each example
 * measures beside it: a floor is half the weaker example's figure, a ceiling
 * twice the worse one's, so the weaker example clears every bar by a factor of
 * two; a bar the model itself fixes (a still part does not move, a lag is
 * above 0, a hole is 0 pixels) is that value, not a margin.
 */
export const BREATH_TORSO_MEAN_FLOOR = 3.809;
export const BREATH_FEET_MAX_CEILING = 0;
export const BLINK_HOLE_BAR = 0;
/** The reported colour-patch level: the seam's own "differs by more than 40". */
export const BLINK_PATCH_LEVEL = SEAM_PX_LEVEL;
/** The smallest lag the reading resolves, in cycles: phases are written to three places. */
export const CHAIN_LAG_MIN_STEP = 0.001;
export const TIP_RATIO_FLOOR = 1.4725;
export const STILL_FACE_MEAN_CEILING = 33.976;
export const STILL_FEET_MEAN_CEILING = 3.244;

/** Issue #2's yardstick, measured on the Spine example export `spineboy.png` (alpha > 0). */
export const SPINEBOY_YARDSTICK = '1024x256, 40 region(s), 45.8% opaque (alpha > 0)';

// ---------------------------------------------------------------------------
// the rigc process, injected
// ---------------------------------------------------------------------------

export interface RigcCall {
  /** Exit status; a process that did not start is reported by the runner as a non-zero status with the reason in `out`. */
  status: number;
  /** stdout then stderr. */
  out: string;
}

export type RigcRunner = (args: readonly string[]) => RigcCall;

/**
 * Where the `rigc` binary is: `node_modules/.bin/rigc` in `from` or any
 * directory above it (a clone has it beside the package; an install has it in
 * the consumer's `node_modules/.bin`), then every directory on `PATH`. A miss
 * is refused naming every place looked.
 */
export function findRigc(from: string, pathVar: string): string {
  const looked: string[] = [];
  let dir = resolve(from);
  for (;;) {
    const bin = join(dir, 'node_modules', '.bin', 'rigc');
    looked.push(bin);
    if (existsSync(bin)) return bin;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const p of pathVar.split(delimiter).filter((s) => s !== '')) {
    const bin = join(p, 'rigc');
    if (existsSync(bin)) return bin;
  }
  refuseIfAny([
    {
      code: 'CHECK_RIGC_PRESENT',
      object: 'the spine-rigc CLI `rigc`',
      detail: `found at none of ${looked.length} node_modules/.bin/rigc path(s) from ${resolve(from)} up (nearest ${looked[0]}) nor on PATH; spine-rigc is this package's dependency — \`bun install\` puts it at node_modules/.bin/rigc`,
    },
  ]);
  return '';
}

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

export interface StageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `--parts` is, said once for the refusals and the help. */
export const PARTS_HOME_SENTENCE = '--parts names the directory holding parts.json and parts/, not parts/ itself (after build, that is build\'s --out, whose rig is <out>/rig); without --parts it is --rig';

export interface CheckInputs {
  rigDir: string;
  rigPath: string;
  motionPath: string;
  partsPath: string;
  partsDir: string;
  rig: Record<string, unknown>;
  motion: Record<string, unknown>;
  parts: PartsFile;
  stage: StageBox;
  rootBone: string;
  idleDuration: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(path: string, problems: Problem[]): Record<string, unknown> | null {
  if (!existsSync(path)) {
    problems.push({ code: 'CHECK_INPUT_PRESENT', object: path, detail: 'no such file; the rig directory holds rig.json, motion.json, parts.json and parts/' });
    return null;
  }
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isRecord(v)) return v;
    problems.push({ code: 'CHECK_INPUT_IS_JSON', object: path, detail: `holds ${JSON.stringify(v)?.slice(0, 40)}; an object is required` });
  } catch (err) {
    problems.push({ code: 'CHECK_INPUT_IS_JSON', object: path, detail: `does not parse as JSON: ${(err as Error).message}` });
  }
  return null;
}

/**
 * Read and cross-check the rig directory. Every problem is collected before
 * one refusal. `partsHome` is the directory holding `parts.json` and `parts/`
 * when they do not sit beside `rig.json` — `build` keeps the parts at the top
 * of its output and the rig under `rig/`; the default is the rig directory.
 */
export function readCheckInputs(rigDir: string, partsHome: string = rigDir): CheckInputs {
  const dir = resolve(rigDir);
  const home = resolve(partsHome);
  const problems: Problem[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    refuseIfAny([{ code: 'CHECK_INPUT_PRESENT', object: dir, detail: 'is not a directory; --rig names the directory holding rig.json, motion.json, parts.json and parts/' }]);
  }
  const rigPath = join(dir, 'rig.json');
  const motionPath = join(dir, 'motion.json');
  const partsPath = join(home, 'parts.json');
  const partsDir = join(home, 'parts');
  if (home !== dir && (!existsSync(home) || !statSync(home).isDirectory())) {
    refuseIfAny([{ code: 'CHECK_INPUT_PRESENT', object: home, detail: `is not a directory; ${PARTS_HOME_SENTENCE}` }]);
  }
  const rig = readJson(rigPath, problems);
  const motion = readJson(motionPath, problems);
  let parts: PartsFile | null = null;
  if (!existsSync(partsPath)) {
    // The usual miss is passing parts/ itself; the parent is then named.
    const parent = dirname(home);
    const hint = existsSync(join(parent, 'parts.json')) ? ` — ${parent} holds parts.json, so --parts ${parent} is the directory meant` : '';
    problems.push({
      code: 'CHECK_INPUT_PRESENT',
      object: partsPath,
      detail: `no such file; ${PARTS_HOME_SENTENCE} (the seam check composites the parts parts.json lists)${hint}`,
    });
  }
  else {
    try {
      parts = readParts(partsPath);
    } catch (err) {
      if (err instanceof PartsError) problems.push(...err.problems);
      else throw err;
    }
  }
  if (parts !== null) {
    for (const p of parts.parts) {
      const png = join(partsDir, `${p.name}.png`);
      if (!existsSync(png)) {
        problems.push({ code: 'CHECK_PART_PNG_PRESENT', object: `part "${p.name}"`, detail: `${png} does not exist; parts.json lists it` });
        continue;
      }
      const im = readPng(png);
      if (im.width !== p.w || im.height !== p.h) {
        problems.push({ code: 'CHECK_PART_PNG_MATCHES_BOX', object: `part "${p.name}"`, detail: `${png} is ${im.width}x${im.height}; parts.json's box is ${p.w}x${p.h}` });
      }
    }
  }
  let stage: StageBox | null = null;
  let rootBone: string | null = null;
  if (rig !== null) {
    const s = rig.skeleton;
    const nums = isRecord(s) && ['x', 'y', 'width', 'height'].every((k) => typeof s[k] === 'number' && Number.isFinite(s[k]));
    if (!nums) {
      problems.push({ code: 'CHECK_RIG_STAGE_PRESENT', object: `${rigPath} field "skeleton"`, detail: `is ${JSON.stringify(s)}; the stage box { x, y, width, height } is required — it is where parts.json's crop pixels sit in Spine's world` });
    } else {
      stage = { x: s.x as number, y: s.y as number, width: s.width as number, height: s.height as number };
      if (parts !== null && (stage.width !== parts.rig_size[0] || stage.height !== parts.rig_size[1])) {
        problems.push({
          code: 'CHECK_RIG_STAGE_IS_THE_CANVAS',
          object: `${rigPath} field "skeleton"`,
          detail: `is ${stage.width}x${stage.height}; parts.json's rig_size is ${parts.rig_size[0]}x${parts.rig_size[1]}, and the seam compares the two pixel for pixel`,
        });
      }
    }
    const slots = new Set((Array.isArray(rig.slots) ? rig.slots : []).filter(isRecord).map((s) => s.name));
    if (parts !== null) {
      for (const p of parts.parts) {
        if (!slots.has(p.name)) {
          problems.push({
            code: 'CHECK_PART_SLOT_PRESENT',
            object: `part "${p.name}"`,
            detail: `${rigPath} has no slot named "${p.name}"; the rig stage draws every part by the slot of its own name, and the judgement lines render a part alone by that slot`,
          });
        }
      }
    }
    const bones = rig.bones;
    const first: unknown = Array.isArray(bones) ? bones[0] : undefined;
    if (isRecord(first) && typeof first.name === 'string') rootBone = first.name;
    else problems.push({ code: 'CHECK_RIG_ROOT_BONE', object: `${rigPath} field "bones"`, detail: 'has no first bone with a name; the setup-pose render keys the root bone' });
  }
  let idleDuration: number | null = null;
  if (motion !== null) {
    const anims = motion.animations;
    const idle = isRecord(anims) ? anims.idle : undefined;
    if (!isRecord(idle)) {
      problems.push({ code: 'CHECK_IDLE_PRESENT', object: `${motionPath} field "animations"`, detail: `holds ${isRecord(anims) ? `[${Object.keys(anims).join(', ')}]` : JSON.stringify(anims)}; an "idle" animation is required — the loop is measured on it` });
    } else if (!(typeof idle.duration === 'number' && idle.duration > 0)) {
      problems.push({ code: 'CHECK_IDLE_PRESENT', object: `${motionPath} animation "idle" field "duration"`, detail: `is ${JSON.stringify(idle.duration)}; a positive number of seconds is required` });
    } else idleDuration = idle.duration;
  }
  refuseIfAny(problems);
  return {
    rigDir: dir,
    rigPath,
    motionPath,
    partsPath,
    partsDir,
    rig: rig as Record<string, unknown>,
    motion: motion as Record<string, unknown>,
    parts: parts as PartsFile,
    stage: stage as StageBox,
    rootBone: rootBone as string,
    idleDuration: idleDuration as number,
  };
}

// ---------------------------------------------------------------------------
// gate lines
// ---------------------------------------------------------------------------

/** `check_rig.py`'s filter for the build: summary, stats and pack lines, and anything that failed. */
export function buildGateLines(out: string): string[] {
  return out.split('\n').filter((l) => (l.trim().startsWith('..') && (l.includes(' assertions: ') || l.includes('pages=') || l.includes('pack:'))) || l.includes('FAIL') || l.includes('compile error'));
}

/** `check_rig.py`'s filter for validate: the summary and anything that failed. */
export function validateGateLines(out: string): string[] {
  return out.split('\n').filter((l) => l.includes(' assertions: ') || l.includes('FAIL'));
}

const SUMMARY = /\((\d+) passed, (\d+) failed\)/;

/**
 * Green = rigc exited 0, at least one summary line, and every summary line says
 * `0 failed`. Read with a pattern: the reference's substring test `"0 failed"`
 * is also true of `"10 failed"`, and its `all()` over no summary line is true.
 */
export function gateGreen(status: number, lines: readonly string[]): boolean {
  const summaries = lines.filter((l) => l.includes(' assertions: '));
  return status === 0 && summaries.length > 0 && summaries.every((l) => SUMMARY.exec(l)?.[2] === '0');
}

export interface PackLine {
  line: string;
  page: string;
  width: number;
  height: number;
  regions: number;
  coveredPct: number;
  padding: number;
}

const PACK = /pack: (\S+) (\d+)x(\d+), (\d+) region\(s\), ([\d.]+)% covered, padding (\d+)/;

export function parsePackLines(lines: readonly string[]): PackLine[] {
  const out: PackLine[] = [];
  for (const l of lines) {
    const m = PACK.exec(l);
    if (m !== null) out.push({ line: l.trim().replace(/^\.\.\s+/, ''), page: m[1], width: Number(m[2]), height: Number(m[3]), regions: Number(m[4]), coveredPct: Number(m[5]), padding: Number(m[6]) });
  }
  return out;
}

/** Share of a page's pixels with alpha above 0 — the measure issue #2's spineboy figure is in. rigc's "covered" is region rectangles, not pixels. */
export function opaqueShare(r: Raster): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > 0) n++;
  return n / (r.width * r.height);
}

// ---------------------------------------------------------------------------
// rigc's frames
// ---------------------------------------------------------------------------

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface FrameSet {
  /** The directory holding the frames. */
  dir: string;
  animation: string | null;
  fps: number;
  sampled: number;
  written: number;
  stride: number;
  /** The last sampled frame's time, as rigc records it. */
  duration: number;
  background: [number, number, number, number];
  viewport: Viewport;
  /** `f<index>.png`, in index order. */
  frames: Array<{ name: string; index: number; image: Raster }>;
}

function sidecarProblem(object: string, detail: string): never {
  refuseIfAny([{ code: 'FRAMES_SIDECAR', object, detail }]);
  throw new Error('unreachable');
}

/**
 * A frame set as `rigc render` wrote it: either the `--out` directory
 * (`frames.json` plus one set directory) or a set directory whose parent holds
 * `frames.json`. Every figure is read off the sidecar; none is assumed.
 */
export function readFrameSet(path: string): FrameSet {
  const dir = resolve(path);
  let sidecarPath: string;
  let setName: string | null;
  if (existsSync(join(dir, 'frames.json'))) {
    sidecarPath = join(dir, 'frames.json');
    setName = null;
  } else if (existsSync(join(dirname(dir), 'frames.json'))) {
    sidecarPath = join(dirname(dir), 'frames.json');
    setName = basename(dir);
  } else {
    return sidecarProblem(dir, `neither ${join(dir, 'frames.json')} nor ${join(dirname(dir), 'frames.json')} exists; the fps and the frame count are read from the frames.json \`rigc render\` writes`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  } catch (err) {
    return sidecarProblem(sidecarPath, `does not parse as JSON: ${(err as Error).message}`);
  }
  if (!isRecord(raw) || !Array.isArray(raw.sets) || !isRecord(raw.viewport) || !Array.isArray(raw.background)) {
    return sidecarProblem(sidecarPath, 'lacks "sets", "viewport" or "background"; a rigc-frames/1 sidecar carries all three');
  }
  const sets = raw.sets.filter(isRecord);
  let set: Record<string, unknown> | undefined;
  if (setName === null) {
    if (sets.length !== 1) return sidecarProblem(sidecarPath, `holds ${sets.length} set(s) [${sets.map((s) => String(s.dir)).join(', ')}]; name one set directory when there is not exactly one`);
    set = sets[0];
  } else {
    set = sets.find((s) => s.dir === setName);
    if (set === undefined) return sidecarProblem(sidecarPath, `has no set "${setName}"; it has [${sets.map((s) => String(s.dir)).join(', ')}]`);
  }
  const num = (o: Record<string, unknown>, k: string, at: string): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return sidecarProblem(sidecarPath, `${at} field "${k}" is ${JSON.stringify(v)}; a number is required`);
    return v;
  };
  const vpRaw = raw.viewport;
  const viewport: Viewport = {
    x: num(vpRaw, 'x', 'viewport'),
    y: num(vpRaw, 'y', 'viewport'),
    width: num(vpRaw, 'width', 'viewport'),
    height: num(vpRaw, 'height', 'viewport'),
    scale: num(vpRaw, 'scale', 'viewport'),
    pixelWidth: num(vpRaw, 'pixelWidth', 'viewport'),
    pixelHeight: num(vpRaw, 'pixelHeight', 'viewport'),
  };
  const bg = raw.background;
  if (bg.length !== 4 || !bg.every((v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 255)) {
    return sidecarProblem(sidecarPath, `"background" is ${JSON.stringify(bg)}; four 8-bit channels are required`);
  }
  const setDir = join(dirname(sidecarPath), String(set.dir));
  if (!existsSync(setDir)) return sidecarProblem(setDir, 'does not exist; frames.json names it');
  const frames = readdirSync(setDir)
    .map((name) => ({ name, m: /^f(\d+)\.png$/.exec(name) }))
    .filter((e) => e.m !== null)
    .map((e) => ({ name: e.name, index: Number((e.m as RegExpExecArray)[1]) }))
    .sort((a, b) => a.index - b.index)
    .map((e) => ({ ...e, image: readPng(join(setDir, e.name)) }));
  const written = num(set, 'written', `set "${String(set.dir)}"`);
  if (frames.length !== written) return sidecarProblem(setDir, `holds ${frames.length} f*.png frame(s); frames.json says ${written} were written`);
  return {
    dir: setDir,
    animation: typeof set.animation === 'string' ? set.animation : null,
    fps: num(set, 'fps', `set "${String(set.dir)}"`),
    sampled: num(set, 'sampled', `set "${String(set.dir)}"`),
    written,
    stride: num(set, 'stride', `set "${String(set.dir)}"`),
    duration: num(set, 'duration', `set "${String(set.dir)}"`),
    background: bg as [number, number, number, number],
    viewport,
    frames,
  };
}

// ---------------------------------------------------------------------------
// pixel measurements
// ---------------------------------------------------------------------------

/** Largest per-channel |a - b| over RGB (alpha dropped, as PIL's `convert("RGB")` does), and the first pixel where it is. */
export function maxRgbDiff(a: Raster, b: Raster): { max: number; x: number; y: number } {
  let max = 0;
  let at = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]);
      if (d > max) {
        max = d;
        at = p;
      }
    }
  }
  return { max, x: at % a.width, y: Math.floor(at / a.width) };
}

/**
 * The motion heat map: frame 0 as grey, blended 0.6 toward a red channel
 * holding each pixel's largest per-channel change from frame 0 across all
 * frames. The grey is PIL's `convert("L")` (`(19595 R + 38470 G + 7471 B +
 * 0x8000) >> 16`) and the blend is PIL's `Image.blend` (`in1 + alpha * (in2 -
 * in1)` with alpha as float32, fused, truncated) — the reference's two calls,
 * measured byte-exact against the reference's own heat maps (ORACLE_check.md).
 */
export function motionHeat(frames: readonly Raster[]): Raster {
  const f0 = frames[0];
  const n = f0.width * f0.height;
  const d = heatField(frames);
  const alpha = Math.fround(0.6);
  // One rounding, to float32, of the exact `in1 + alpha * (in2 - in1)`: the
  // build of Pillow 12.2.0 measured here contracts the expression to a fused
  // multiply-add. Rounding the product first (two roundings) disagreed with it
  // on 33 of 256 values of in1 at in2 = 0; this form agrees on all 65,536
  // (in1, in2) pairs. The product and sum are exact in float64, so one fround
  // IS the fused result.
  const blend = (a: number, b: number): number => Math.trunc(Math.fround(a + alpha * (b - a)));
  const out = newRaster(f0.width, f0.height);
  for (let p = 0; p < n; p++) {
    const l = (f0.data[p * 4] * 19595 + f0.data[p * 4 + 1] * 38470 + f0.data[p * 4 + 2] * 7471 + 0x8000) >>> 16;
    out.data[p * 4] = blend(l, d[p]);
    out.data[p * 4 + 1] = blend(l, 0);
    out.data[p * 4 + 2] = blend(l, 0);
    out.data[p * 4 + 3] = 255;
  }
  return out;
}

export interface SeamFigures {
  mean: number;
  over40: number;
  over80: number;
}

/**
 * The flat stack of parts over the background, in rig pixels: PIL's
 * `alpha_composite` of every part at its `x, y`, in parts.json order, over an
 * opaque canvas of the render's own background colour.
 */
export function flatComposite(parts: PartsFile, partsDir: string, background: readonly [number, number, number, number]): Raster {
  const [W, H] = parts.rig_size;
  let canvas = newRaster(W, H);
  for (let i = 0; i < W * H; i++) canvas.data.set(background, i * 4);
  for (const p of parts.parts) canvas = alphaComposite(canvas, readPng(join(partsDir, `${p.name}.png`)), p.x, p.y);
  return canvas;
}

/**
 * The seam figures: the setup-pose frame vs the flat composite carried onto the
 * frame's pixel grid.
 *
 * Crop pixel (u, v) is world (stage.x + u, stage.y + cropToSpineY(v, H)), and
 * world (wx, wy) is frame pixel ((wx - vp.x) s, (vp.y + vp.height - wy) s), so
 * the map is a scale by s and a translate. It is warped with
 * `src/raster/warp.ts` (cv2's bilinear `warpAffine`, which is also what the
 * reference's `INTER_AREA` flag gets from cv2 — see that file) in float32.
 * cv2's `borderValue` is the background; this warp's border is 0, so the
 * composite is warped as `(pixel - background)` and the background added back,
 * which is the same linear sum. The per-pixel figure is the largest channel
 * |d|, as in the reference.
 */
export function seamFigures(composite: Raster, frame: Raster, stage: StageBox, vp: Viewport, background: readonly [number, number, number, number]): SeamFigures {
  const [W, H] = [composite.width, composite.height];
  const s = vp.scale;
  // The reference hands cv2 the matrix as float32 (`np.float32([[...]])`), and
  // that quantisation moves a sample row across a 1/32-pixel step: in float64
  // one row of one rig's 1216-row frame (C1 in ORACLE_check.md) sampled
  // differently and the unrounded mean drifted 3.1e-4. The map is rounded to
  // float32 the same way.
  const f = Math.fround;
  const map = { sx: f(s), sy: f(s), tx: f((stage.x - vp.x) * s), ty: f((vp.y + vp.height - (stage.y + cropToSpineY(0, H))) * s) };
  const src = newFloatImage(W, H, 3);
  for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) src.data[p * 3 + c] = composite.data[p * 4 + c] - background[c];
  const warped = warpAffine(src, map, vp.pixelWidth, vp.pixelHeight, 'bilinear');
  if (frame.width !== vp.pixelWidth || frame.height !== vp.pixelHeight) {
    refuseIfAny([{ code: 'CHECK_SEAM_FRAME_SIZE', object: 'the setup-pose frame', detail: `is ${frame.width}x${frame.height}; frames.json's viewport is ${vp.pixelWidth}x${vp.pixelHeight}` }]);
  }
  let sum = 0;
  let over40 = 0;
  let over80 = 0;
  const n = vp.pixelWidth * vp.pixelHeight;
  for (let p = 0; p < n; p++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const w = Math.fround(warped.data[p * 3 + c] + background[c]);
      const d = Math.abs(w - frame.data[p * 4 + c]);
      if (d > m) m = d;
    }
    sum += m;
    if (m > SEAM_PX_LEVEL) over40++;
    if (m > SEAM_PX_LEVEL_HIGH) over80++;
  }
  return { mean: sum / n, over40, over80 };
}

/** Python's `round(x, 3)` for the figures written: to three places, on the value's exact decimal expansion. */
function round3(x: number): number {
  return Number(x.toFixed(3));
}

// ---------------------------------------------------------------------------
// the stage
// ---------------------------------------------------------------------------

/** One judgement line (issue #11): its status, the figures it measured, and the bars it held them to — or why it measured nothing. */
export type JudgementLine = { status: 'PASS' | 'FAIL'; [figure: string]: unknown } | { status: 'SKIP'; reason: string };

/** The judgement lines, in the order check.json and the console carry them. */
export const JUDGEMENT_LINES = ['BREATH_VISIBLE', 'BLINK_NO_HOLE', 'CHAIN_LAG', 'TIP_OVER_ROOT', 'STILL_REGIONS_DARK'] as const;
export type JudgementName = (typeof JUDGEMENT_LINES)[number];

/**
 * A line with no bar (issue #25): it reports figures and can never be a FAIL,
 * so `PASS` does not read it. SKIP, with the reason, when there is nothing to
 * report from.
 */
export type ReportedLine = { status: 'REPORTED'; [figure: string]: unknown } | { status: 'SKIP'; reason: string };

/** The reported lines, after the judgement lines, in the order check.json and the console carry them. */
export const REPORTED_LINES = ['RECOMPOSITE_HOLES'] as const;

/** check.json — the reference's fields in its order, then the judgement lines, then PASS. */
export interface CheckFigures {
  gate_spine_html_green: boolean;
  gate_spine_green: boolean;
  loop_max_diff: number;
  seam_mean: number;
  seam_px_over_40: number;
  seam_px_over_80: number;
  BREATH_VISIBLE: JudgementLine;
  BLINK_NO_HOLE: JudgementLine;
  CHAIN_LAG: JudgementLine;
  TIP_OVER_ROOT: JudgementLine;
  STILL_REGIONS_DARK: JudgementLine;
  RECOMPOSITE_HOLES: ReportedLine;
  PASS: boolean;
}

export interface CheckReport {
  figures: CheckFigures;
  gateHtml: string[];
  gateSpine: string[];
  pack: PackLine[];
  /** Opaque share (alpha > 0) of each packed page, by page file name. */
  packOpaque: Array<{ page: string; share: number }>;
  idle: { frames: number; fps: number; duration: number; lastIndex: number; loopAt: { x: number; y: number } };
  seamViewport: Viewport;
  /** Every bar that was not met, one problem each; empty on PASS. */
  problems: Problem[];
  written: string[];
}

function rigcFailed(what: string, call: RigcCall, lines: readonly string[]): Problem[] {
  const named = lines.filter((l) => l.includes('FAIL') || l.includes('compile error'));
  const quoted = named.length > 0 ? named : call.out.split('\n').filter((l) => l.trim() !== '').slice(-3);
  return quoted.map((l) => ({ code: 'CHECK_RIGC_GREEN', object: `\`rigc ${what}\``, detail: `exit ${call.status}: ${l.trim()}` }));
}

/**
 * Run the whole check. Refuses (throws a PartsError) when the inputs are
 * unreadable or a rigc step that everything after it depends on is red — the
 * gate file is written first, so the refusal's evidence is on disk. Otherwise
 * it measures everything, writes every output including `check.json`, and
 * returns the report; `report.problems` names each bar that was not met, and
 * `figures.PASS` is true exactly when it is empty.
 */
export function runCheck(rigDir: string, outDir: string, rigc: RigcRunner, partsHome: string = rigDir): CheckReport {
  const inp = readCheckInputs(rigDir, partsHome);
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const buildDir = join(out, 'build');
  const idleDir = join(out, 'idle_frames');
  const stillDir = join(out, '_still');
  const isoDir = join(out, '_isolated');
  for (const d of [buildDir, idleDir, stillDir, isoDir]) rmSync(d, { recursive: true, force: true });
  const written: string[] = [];
  const write = (name: string, data: string): void => {
    writeFileSync(join(out, name), data);
    written.push(name);
  };

  // 1. build, packed, under the policy profile
  const build = rigc(['build', '--rig', inp.rigPath, '--motion', inp.motionPath, '--out', buildDir, '--profile', 'spine-html', '--pack']);
  const gateHtml = buildGateLines(build.out);
  write('gate_spine-html.txt', `${gateHtml.join('\n')}\n`);
  if (build.status !== 0) refuseIfAny(rigcFailed('build --profile spine-html --pack', build, gateHtml));
  const pack = parsePackLines(gateHtml);
  const packOpaque = pack.filter((p) => existsSync(join(buildDir, p.page))).map((p) => ({ page: p.page, share: opaqueShare(readPng(join(buildDir, p.page))) }));

  // 2. validate under the validity profile
  const validate = rigc(['validate', buildDir, '--profile', 'spine']);
  const gateSpine = validateGateLines(validate.out);
  write('gate_spine.txt', `${gateSpine.join('\n')}\n`);
  const htmlGreen = gateGreen(build.status, gateHtml);
  const spineGreen = gateGreen(validate.status, gateSpine);

  // 3. the idle, the loop, the heat
  const render = rigc(['render', '--candidate', buildDir, '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--out', idleDir]);
  if (render.status !== 0) refuseIfAny(rigcFailed('render --animation idle', render, render.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
  const idle = readFrameSet(idleDir);
  const last = idle.frames[idle.frames.length - 1];
  if (idle.stride !== 1 || idle.written !== idle.sampled || idle.duration !== inp.idleDuration || last.index !== idle.sampled - 1) {
    refuseIfAny([
      {
        code: 'CHECK_LOOP_LAST_FRAME_AT_DURATION',
        object: `idle frame ${last.name}`,
        detail: `rigc sampled ${idle.sampled} frame(s), wrote ${idle.written} at stride ${idle.stride}, the last at t = ${idle.duration}s; the loop compares frame 0 with the frame at the idle's duration, ${inp.idleDuration}s, so a duration that is a whole number of 1/${IDLE_FPS} s ticks and every frame written are required`,
      },
    ]);
  }
  const contact = join(idle.dir, 'contact.png');
  if (existsSync(contact)) {
    copyFileSync(contact, join(out, 'contact.png'));
    written.push('contact.png');
  }
  const loop = maxRgbDiff(idle.frames[0].image, last.image);
  const idleImages = idle.frames.map((f) => f.image);
  writePng(join(out, 'motion_heat.png'), motionHeat(idleImages));
  written.push('motion_heat.png');
  const idleHeat = heatField(idleImages);
  const H = inp.parts.rig_size[1];
  const problems: Problem[] = [];

  // 3b. the parts a judgement reads alone: each rendered by its own slots, on the whole rig's grid
  const isolated = (label: string, ps: readonly PartRecord[]): FrameSet => {
    const dir = join(isoDir, label);
    const r = rigc(['render', '--candidate', buildDir, '--animation', 'idle', '--fps', String(IDLE_FPS), '--max', String(IDLE_MAX_PX), '--slot', ps.map((p) => p.name).join(','), '--out', dir]);
    if (r.status !== 0) refuseIfAny(rigcFailed(`render --animation idle --slot ${ps.map((p) => p.name).join(',')}`, r, r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('rigc:'))));
    return readFrameSet(dir);
  };
  let breath: JudgementLine;
  let tip: JudgementLine;
  try {
    breath = breathLine(inp, isolated, problems);
    tip = tipLine(inp, isolated, problems);
  } finally {
    rmSync(isoDir, { recursive: true, force: true });
  }
  const still = stillLine(inp, idleHeat, idle.viewport, H, problems);
  const chain = chainLine(inp, problems);

  // 4. the seam: the setup pose as a one-key throwaway animation — and, beside it, the same pose with the eyes shut
  let seam: SeamFigures;
  let seamViewport: Viewport;
  let blink: JudgementLine;
  try {
    mkdirSync(stillDir, { recursive: true });
    const images = typeof inp.rig.images === 'string' ? resolve(inp.rigDir, inp.rig.images) : inp.rig.images;
    writeFileSync(join(stillDir, 'rig.json'), JSON.stringify({ ...inp.rig, images }));
    const eyes = partsTagged(inp.parts, EYE_TAGS);
    const slotBone = new Map((Array.isArray(inp.rig.slots) ? inp.rig.slots : []).filter(isRecord).map((sl) => [String(sl.name), String(sl.bone)]));
    const shut = blinkTracks(inp.motion, eyeBones(inp.rig, eyes.map((p) => slotBone.get(p.name) ?? '')));
    const animations: Record<string, unknown> = {
      still: { duration: STILL_DURATION, loop: false, tracks: [{ bone: inp.rootBone, property: 'rotate', keys: [{ t: 0, v: [0] }, { t: STILL_DURATION, v: [0] }] }] },
    };
    if (eyes.length > 0 && shut.length > 0) {
      animations[BLINK_ANIMATION] = {
        duration: STILL_DURATION,
        loop: false,
        tracks: shut.map((b) => ({ ...b.target, property: 'scaley', keys: [{ t: 0, v: [b.closed] }, { t: STILL_DURATION, v: [b.closed] }] })),
      };
    }
    writeFileSync(join(stillDir, 'motion.json'), JSON.stringify({ ...inp.motion, animations }));
    const sb = rigc(['build', '--rig', join(stillDir, 'rig.json'), '--motion', join(stillDir, 'motion.json'), '--out', join(stillDir, 'build'), '--profile', 'spine']);
    if (sb.status !== 0) refuseIfAny(rigcFailed('build (the setup-pose still)', sb, buildGateLines(sb.out)));
    const maxSide = Math.max(inp.parts.rig_size[0], inp.parts.rig_size[1]);
    const sr = rigc(['render', '--candidate', join(stillDir, 'build'), '--animation', 'still', '--fps', String(STILL_FPS), '--max', String(maxSide), '--out', join(stillDir, 'render')]);
    if (sr.status !== 0) refuseIfAny(rigcFailed('render (the setup-pose still)', sr, sr.out.split('\n').filter((l) => l.includes('FAIL'))));
    const stillSet = readFrameSet(join(stillDir, 'render'));
    seamViewport = stillSet.viewport;
    const composite = flatComposite(inp.parts, inp.partsDir, stillSet.background);
    seam = seamFigures(composite, stillSet.frames[0].image, inp.stage, stillSet.viewport, stillSet.background);
    if (eyes.length === 0) blink = skip(`no part comes from a See-through ${tagWords(EYE_TAGS)} layer, so there is no eye to look behind`);
    else if (shut.length === 0) blink = skip(`no idle "scaley" track on the bones of ${quoteParts(eyes)} goes below its first key, so the idle has no blink`);
    else {
      const br = rigc(['render', '--candidate', join(stillDir, 'build'), '--animation', BLINK_ANIMATION, '--fps', String(STILL_FPS), '--max', String(maxSide), '--out', join(stillDir, 'blink')]);
      if (br.status !== 0) refuseIfAny(rigcFailed(`render (the setup pose with the eyes shut, "${BLINK_ANIMATION}")`, br, br.out.split('\n').filter((l) => l.includes('FAIL'))));
      blink = blinkLine(inp, eyes, shut, stillSet, readFrameSet(join(stillDir, 'blink')), idle, H, problems);
    }
  } finally {
    rmSync(stillDir, { recursive: true, force: true });
  }

  const figures: CheckFigures = {
    gate_spine_html_green: htmlGreen,
    gate_spine_green: spineGreen,
    loop_max_diff: loop.max,
    seam_mean: round3(seam.mean),
    seam_px_over_40: seam.over40,
    seam_px_over_80: seam.over80,
    BREATH_VISIBLE: breath,
    BLINK_NO_HOLE: blink,
    CHAIN_LAG: chain,
    TIP_OVER_ROOT: tip,
    STILL_REGIONS_DARK: still,
    RECOMPOSITE_HOLES: holesLine(inp.parts),
    PASS: false,
  };
  const barProblems: Problem[] = [];
  if (!htmlGreen) barProblems.push(...rigcFailed('build --profile spine-html --pack', build, gateHtml));
  if (!spineGreen) barProblems.push(...rigcFailed('validate --profile spine', validate, gateSpine));
  if (figures.loop_max_diff !== LOOP_MAX_BAR) {
    barProblems.push({
      code: 'CHECK_LOOP_CLOSES',
      object: `idle frame f0000.png vs ${last.name} (t = ${idle.duration}s)`,
      detail: `max |d| ${figures.loop_max_diff}/255, first at pixel ${loop.x},${loop.y} of ${idle.viewport.pixelWidth}x${idle.viewport.pixelHeight}; ${LOOP_MAX_BAR} is required — the idle's last key must equal its first`,
    });
  }
  if (figures.seam_mean > SEAM_MEAN_BAR || figures.seam_px_over_40 > SEAM_PX_BAR) {
    barProblems.push({
      code: 'CHECK_SEAM_WITHIN_BAR',
      object: 'the setup-pose render vs the flat composite of parts/',
      detail: `mean |d| ${figures.seam_mean}/255 and ${figures.seam_px_over_40} px over ${SEAM_PX_LEVEL} (${figures.seam_px_over_80} over ${SEAM_PX_LEVEL_HIGH}); mean <= ${SEAM_MEAN_BAR.toFixed(1)} and <= ${SEAM_PX_BAR} px over ${SEAM_PX_LEVEL} are required`,
    });
  }
  const rank = (q: Problem): number => JUDGEMENT_LINES.findIndex((n) => q.code === `CHECK_${n}`);
  problems.sort((a, b) => rank(a) - rank(b));
  problems.unshift(...barProblems);
  figures.PASS = problems.length === 0;
  write('check.json', `${JSON.stringify(figures, null, 1)}\n`);
  return {
    figures,
    gateHtml,
    gateSpine,
    pack,
    packOpaque,
    idle: { frames: idle.frames.length, fps: idle.fps, duration: idle.duration, lastIndex: last.index, loopAt: { x: loop.x, y: loop.y } },
    seamViewport,
    problems,
    written,
  };
}

// ---------------------------------------------------------------------------
// the judgement lines (issue #11)
// ---------------------------------------------------------------------------

/**
 * `RECOMPOSITE_HOLES`: `parts.json`'s `recomposite` block as a line — the
 * uncovered error pixels, how many holes they make, and the largest hole's box
 * and bordering parts. Read, not measured: the block is what assemble measured
 * on the painting, which check never sees. REPORTED, never FAIL, because no
 * bar for a hole is derivable by the rule the judgement bars follow: both
 * public examples hold hundreds of holes of a few dozen pixels along part
 * edges (453 on demo, the largest 70 px; 259 on sample, the largest 94 px),
 * and whether a hole matters depends on where it is — which the box and the
 * bordering parts say and a count cannot (AUTHORING §7).
 */
export function holesLine(parts: PartsFile): ReportedLine {
  const r = parts.recomposite;
  if (r === undefined) return { status: 'SKIP', reason: 'parts.json has no "recomposite" block (a parts.json the reference wrote has none); re-run assemble, which writes it' };
  return {
    status: 'REPORTED',
    error_px: r.error_px,
    uncovered_error_px: r.uncovered_error_px,
    hole_count: r.hole_count,
    largest: r.holes.length === 0 ? null : { px: r.holes[0].px, box: boxText(r.holes[0]), borders: r.holes[0].borders.map((b) => `${b.part} ${b.px} px`) },
  };
}

function boxText(h: { x: number; y: number; w: number; h: number }): string {
  return `${h.x},${h.y} ${h.w}x${h.h}`;
}

/** The throwaway animation that holds the blink tracks at their closed value, rendered beside the setup-pose still. */
export const BLINK_ANIMATION = 'blink_shut';

function skip(reason: string): JudgementLine {
  return { status: 'SKIP', reason };
}

function tagWords(tags: readonly BaseTag[]): string {
  return tags.map((t) => `"${t}"`).join(' or ');
}

function quoteParts(ps: readonly PartRecord[]): string {
  return ps.map((p) => `"${p.name}"`).join(', ');
}

type Isolate = (label: string, ps: readonly PartRecord[]) => FrameSet;

/** (1) The torso moves while the feet do not: each rendered alone, heat over its own box. */
function breathLine(inp: CheckInputs, isolated: Isolate, problems: Problem[]): JudgementLine {
  const torso = partsTagged(inp.parts, TORSO_TAGS);
  const feet = partsTagged(inp.parts, FEET_TAGS);
  if (torso.length === 0) return skip(`no part comes from a See-through ${tagWords(TORSO_TAGS)} layer, so there is no torso to see breathe`);
  if (feet.length === 0) return skip(`no part comes from a See-through ${tagWords(FEET_TAGS)} layer, so there are no feet to hold still`);
  const H = inp.parts.rig_size[1];
  const ts = isolated('torso', torso);
  const fs = isolated('feet', feet);
  const tb = frameBox(torso, H, inp.stage, ts.viewport);
  const fb = frameBox(feet, H, inp.stage, fs.viewport);
  if (tb === null || fb === null) return skip(`the ${tb === null ? 'torso' : 'feet'} box falls outside the idle frame`);
  const th = regionHeat(heatField(ts.frames.map((f) => f.image)), ts.viewport.pixelWidth, tb);
  const fh = regionHeat(heatField(fs.frames.map((f) => f.image)), fs.viewport.pixelWidth, fb);
  const mean = round3(th.mean);
  const ok = mean >= BREATH_TORSO_MEAN_FLOOR && fh.max <= BREATH_FEET_MAX_CEILING;
  if (mean < BREATH_TORSO_MEAN_FLOOR) {
    problems.push({
      code: 'CHECK_BREATH_VISIBLE',
      object: `torso ${quoteParts(torso)} rendered alone, frame box ${boxLabel(tb)}`,
      detail: `heat mean ${mean}/255 over the idle; >= ${BREATH_TORSO_MEAN_FLOOR} is required — the chest's breath track moves too little, or the torso is not weighted to the bone it keys`,
    });
  }
  if (fh.max > BREATH_FEET_MAX_CEILING) {
    problems.push({
      code: 'CHECK_BREATH_VISIBLE',
      object: `feet ${quoteParts(feet)} rendered alone, frame box ${boxLabel(fb)}`,
      detail: `heat max ${fh.max}/255 over the idle; <= ${BREATH_FEET_MAX_CEILING} is required — the feet move: their slot rides, or their mesh is weighted to, a bone the idle keys`,
    });
  }
  return {
    status: ok ? 'PASS' : 'FAIL',
    torso_parts: torso.map((p) => p.name),
    torso_heat_mean: mean,
    torso_floor: BREATH_TORSO_MEAN_FLOOR,
    feet_parts: feet.map((p) => p.name),
    feet_heat_max: fh.max,
    feet_ceiling: BREATH_FEET_MAX_CEILING,
  };
}

/** (4) Each swinging part's tip travels further than its root: the part rendered alone, its box's lower half against its upper half. */
function tipLine(inp: CheckInputs, isolated: Isolate, problems: Problem[]): JudgementLine {
  const swing = partsTagged(inp.parts, SWING_TAGS);
  if (swing.length === 0) return skip(`no part comes from a See-through ${tagWords(SWING_TAGS)} layer, so there is no hem or sleeve to swing`);
  const H = inp.parts.rig_size[1];
  const rows: Array<Record<string, unknown>> = [];
  let measured = 0;
  let failed = false;
  for (const p of swing) {
    const set = isolated(`swing-${p.name}`, [p]);
    const box = frameBox([p], H, inp.stage, set.viewport);
    const halves = box === null ? null : rowHalves(box);
    const images = set.frames.map((f) => f.image);
    const root = halves === null ? null : bandExcursion(images, set.background, halves.root);
    const tipPx = halves === null ? null : bandExcursion(images, set.background, halves.tip);
    if (root === null || tipPx === null) {
      rows.push({ part: p.name, unmeasured: `${box === null ? 'its box falls outside the idle frame' : `the ${root === null ? 'upper' : 'lower'} half of its box holds no art in frame 0`}` });
      continue;
    }
    measured++;
    const ratio = root > 0 ? round3(tipPx / root) : null;
    const ok = ratio === null ? tipPx > 0 : ratio >= TIP_RATIO_FLOOR;
    rows.push({ part: p.name, root_px: round3(root), tip_px: round3(tipPx), ratio });
    if (!ok) {
      failed = true;
      problems.push({
        code: 'CHECK_TIP_OVER_ROOT',
        object: `part "${p.name}" rendered alone, frame box ${boxLabel(box as PixelBox)}`,
        detail: `its lower half travels ${round3(tipPx)} px and its upper half ${round3(root)} px (ratio ${ratio ?? 'undefined: nothing moves'}); a ratio >= ${TIP_RATIO_FLOOR} is required — the chain's amplitudes do not grow toward the tip, or the mesh is not weighted to the chain`,
      });
    }
  }
  if (measured === 0) return { status: 'SKIP', reason: `none of ${quoteParts(swing)} could be measured: ${rows.map((r) => `${String(r.part)}: ${String(r.unmeasured)}`).join('; ')}` };
  return { status: failed ? 'FAIL' : 'PASS', parts: rows, ratio_floor: TIP_RATIO_FLOOR };
}

/** (7) The idle's heat map, over the face outline and the feet as they show in the flat stack. */
function stillLine(inp: CheckInputs, heat: Uint8Array, vp: Viewport, H: number, problems: Problem[]): JudgementLine {
  const face = partsTagged(inp.parts, FACE_TAGS);
  const feet = partsTagged(inp.parts, FEET_TAGS);
  if (face.length === 0 && feet.length === 0) return skip(`no part comes from a See-through ${tagWords([...FACE_TAGS, ...FEET_TAGS])} layer, so the heat map has no still region to read`);
  const top = topmostIndex(inp.parts, (i) => readPng(join(inp.partsDir, `${inp.parts.parts[i].name}.png`)));
  const index = new Map(inp.parts.parts.map((p, i) => [p.name, i]));
  const region = (ps: readonly PartRecord[], exclude: readonly PartRecord[], ceiling: number, label: string): Record<string, unknown> | string => {
    if (ps.length === 0) return `no part comes from a See-through ${label === 'face' ? tagWords(FACE_TAGS) : tagWords(FEET_TAGS)} layer`;
    const box = frameBox(ps, H, inp.stage, vp);
    if (box === null) return 'its box falls outside the idle frame';
    const ex = exclude.map((p) => frameBox([p], H, inp.stage, vp)).filter((b): b is PixelBox => b !== null);
    const mask = visibleMask(top, inp.parts, new Set(ps.map((p) => index.get(p.name) as number)), box, ex, inp.stage, vp);
    const rh = regionHeat(heat, vp.pixelWidth, box, mask);
    if (rh.px === 0) return 'none of its pixels is on top of the flat stack';
    const mean = round3(rh.mean);
    if (mean > ceiling) {
      problems.push({
        code: 'CHECK_STILL_REGIONS_DARK',
        object: `the ${label} region of motion_heat.png (${quoteParts(ps)} where on top${exclude.length > 0 ? `, less the boxes of ${quoteParts(exclude)}` : ''}; ${rh.px} px in ${boxLabel(box)})`,
        detail: `heat mean ${mean}/255 (max ${rh.max}); <= ${ceiling} is required — something that should hold still moves: a mesh weighted to a swinging bone, or a part that rides the wrong bone`,
      });
    }
    return { parts: ps.map((p) => p.name), px: rh.px, heat_mean: mean, heat_max: rh.max, mean_ceiling: ceiling };
  };
  const f = region(face, partsTagged(inp.parts, FACE_FEATURE_TAGS), STILL_FACE_MEAN_CEILING, 'face');
  const t = region(feet, [], STILL_FEET_MEAN_CEILING, 'feet');
  const ok = (r: Record<string, unknown> | string): boolean => typeof r === 'string' || (r.heat_mean as number) <= (r.mean_ceiling as number);
  if (typeof f === 'string' && typeof t === 'string') return skip(`face: ${f}; feet: ${t}`);
  return { status: ok(f) && ok(t) ? 'PASS' : 'FAIL', face: typeof f === 'string' ? { unmeasured: f } : f, feet: typeof t === 'string' ? { unmeasured: t } : t };
}

function fmt3(x: number): string {
  return x.toFixed(3);
}

/** (3) Down every chain the phase lags and the amplitude does not shrink, read off motion.json's rotate tracks. */
export function chainLine(inp: Pick<CheckInputs, 'rig' | 'motion'>, problems: Problem[]): JudgementLine {
  const cf = chainFigures(inp.rig, inp.motion);
  const long = cf.chains.filter((c) => c.length >= 2);
  if (cf.edges.length === 0 && long.length === 0) {
    return skip(`no idle "rotate" track sits under another at the same period${cf.unread.length > 0 ? ` (unread, not sampled sines: ${cf.unread.join(', ')})` : ''}, so there is no chain to lag`);
  }
  const violations: string[] = [];
  for (const e of cf.edges) {
    if (round3(e.step) < CHAIN_LAG_MIN_STEP) {
      const v = `"${e.child}" follows its keyed ancestor "${e.parent}" by ${fmt3(e.step)} cycle(s)`;
      violations.push(v);
      problems.push({ code: 'CHECK_CHAIN_LAG', object: `bone "${e.child}" under "${e.parent}"`, detail: `phase step ${fmt3(e.step)} cycle(s); >= ${CHAIN_LAG_MIN_STEP} is required — a link must lag the one above it (a larger "phase", or a positive "lag" on the chain track)` });
    }
  }
  for (const c of long) {
    for (let i = 1; i < c.length; i++) {
      const a = round3(c[i - 1].reading.amp);
      const b = round3(c[i].reading.amp);
      if (b < a) {
        violations.push(`"${c[i].bone}" swings ${fmt3(b)} under "${c[i - 1].bone}"'s ${fmt3(a)}`);
        problems.push({ code: 'CHECK_CHAIN_LAG', object: `bone "${c[i].bone}" in the chain from "${c[0].bone}"`, detail: `amplitude ${fmt3(b)} below the link above's ${fmt3(a)}; non-decreasing down the chain is required — "amps" grow toward the tip` });
      }
    }
  }
  const minStep = cf.edges.length === 0 ? null : round3(Math.min(...cf.edges.map((e) => e.step)));
  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    chains: long.map((c) => `${c.map((l) => l.bone).join(' > ')}: period ${round3(c[0].reading.period)}s, phase ${c.map((l) => fmt3(l.reading.phase)).join(' ')}, amp ${c.map((l) => fmt3(l.reading.amp)).join(' ')}`),
    lags: cf.edges.map((e) => `${e.parent} > ${e.child} ${e.step >= 0 ? '+' : ''}${fmt3(e.step)}`),
    min_step: minStep,
    step_floor: CHAIN_LAG_MIN_STEP,
    other_period: cf.otherPeriod.map((e) => `${e.parent} > ${e.child}`),
    unread: cf.unread,
    first_violation: violations[0] ?? null,
  };
}

function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.scale === b.scale && a.pixelWidth === b.pixelWidth && a.pixelHeight === b.pixelHeight;
}

/** (2) The setup pose with the blink tracks held at their closed value, against the setup pose, inside the eye box. */
function blinkLine(
  inp: CheckInputs,
  eyes: readonly PartRecord[],
  shut: ReturnType<typeof blinkTracks>,
  open: FrameSet,
  closed: FrameSet,
  idle: FrameSet,
  H: number,
  problems: Problem[],
): JudgementLine {
  if (!sameViewport(open.viewport, closed.viewport)) return skip(`the closed-eye render's grid ${JSON.stringify(closed.viewport)} is not the setup still's ${JSON.stringify(open.viewport)}, so the two cannot be compared pixel for pixel`);
  const box = frameBox(eyes, H, inp.stage, open.viewport);
  if (box === null) return skip('the eye box falls outside the setup-pose frame');
  const b = blinkFigures(open.frames[0].image, closed.frames[0].image, open.background, box, BLINK_PATCH_LEVEL);
  const from = Math.max(...shut.map((s) => s.window[0]));
  const to = Math.min(...shut.map((s) => s.window[1]));
  const frames: number[] = [];
  for (let k = 0; k < idle.sampled; k++) if (k / idle.fps >= from - 1e-9 && k / idle.fps <= to + 1e-9) frames.push(k);
  if (b.holePx > BLINK_HOLE_BAR) {
    problems.push({
      code: 'CHECK_BLINK_NO_HOLE',
      object: `the eye box ${boxLabel(box)} (${quoteParts(eyes)}) with the eyes shut`,
      detail: `${b.holePx} px show the background where the open eye had art; ${BLINK_HOLE_BAR} is required — the layer under the eye has no art there (See-through left it empty), so a closed eye opens a hole`,
    });
  }
  return {
    status: b.holePx > BLINK_HOLE_BAR ? 'FAIL' : 'PASS',
    eye_parts: eyes.map((p) => p.name),
    closed: shut.map((s) => `${'bone' in s.target ? `bone ${s.target.bone}` : `group ${s.target.group}`} scaley ${s.closed} from ${s.window[0]}s to ${s.window[1]}s`),
    idle_frames_closed: frames,
    box_px: b.px,
    hole_px: b.holePx,
    hole_bar: BLINK_HOLE_BAR,
    patch_max: b.patchMax,
    patch_px_over_40: b.patchOver,
  };
}
