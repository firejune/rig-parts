/**
 * The stages as callable units, and `build`, which runs three of them in a row.
 *
 * Each command in `cli.ts` — `assemble`, `rig`, `check`, `loop` — is a thin
 * flag parser over one function here, and `build` calls the same functions in
 * the same process. That is the whole reason this file exists: a driver that
 * re-implemented a stage (or re-spawned the CLI and parsed its text) would be a
 * second copy that could drift from the command it claims to run. What a
 * stage prints, it prints through the `Log` it is handed, so `build` reads the
 * very lines the command prints, under a `[stage]` prefix.
 *
 *     build = assemble -> rig -> check [-> loop]
 *
 * `propose` is deliberately not a step. A config with bones is the input to
 * `build`: the proposal is a starting point to be corrected against its
 * overlay, and a driver that fed the proposal straight to `rig` would turn a
 * draft into a rig with nobody having looked at it.
 *
 * `build --out <dir>` receives:
 *
 * | path | from |
 * | --- | --- |
 * | `parts/<name>.png`, `parts.json`, `recomposite_rig.png` | assemble — the loose parts, an intermediate |
 * | `rig/` (`rig.json`, `motion.json`, `mesh_report.json`, `images/`) | rig |
 * | `check/` (`build/` with the packed atlas, both gate files, `idle_frames/`, `contact.png`, `motion_heat.png`, `check.json`) | check |
 * | `idle.png` (lossless APNG), `idle-indexed.png` (indexed APNG), `idle.gif` | loop, with `--loop`, from `check/idle_frames/` |
 *
 * The artifact is `check/build/skeleton.json`, `.atlas` and the packed page
 * (issue #2): the last lines of a green build are the pack line and those
 * three paths.
 *
 * Emit only after green, stage by stage: each stage writes only after its own
 * checks, and `build` stops at the first stage that refuses — printing that
 * stage's own FAIL lines — so nothing downstream of a red is written. The paths
 * `build` owns under `--out` (the table above, and nothing else) are removed
 * before the first stage runs, so a file left by an earlier run cannot sit
 * beside a later run's refusal looking current.
 *
 * Pure in the sense `src/` is held to: no clock, no randomness, no network and
 * no child process. spine-rigc runs as a process, but the process is injected
 * as a {@link RigcRunner}, exactly as `src/check.ts` takes it.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type AnimFrame, EncodeError, encodeApng, encodeIndexedApng, INDEXED_DEFAULTS } from './apng.ts';
import { assemble, type AssembleResult, figuresLine, type ProjectRule, type SeamRule, stageFields } from './assemble.ts';
import { type CheckReport, JUDGEMENT_LINES, type JudgementLine, readFrameSet, type RigcRunner, runCheck, SEAM_MEAN_BAR, SEAM_PX_BAR, SEAM_PX_LEVEL, SEAM_PX_LEVEL_HIGH, SPINEBOY_YARDSTICK } from './check.ts';
import { loadConfig } from './config.ts';
import { PartsError, type Problem, problemLine } from './errors.ts';
import { encodeGif } from './gif.ts';
import type { PaletteError } from './palette.ts';
import { type LayerSet, readLayers } from './layers.ts';
import { readParts, writeParts } from './parts.ts';
import { encodePngBytes, readPng, writePng } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { buildRig, rigJsonText, type RigOutput } from './rig.ts';

/** Where a stage's lines go. The commands hand it `console.log`; `build` hands it a prefixing wrapper. */
export type Log = (line: string) => void;

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------

/** The painting, refused by name when it is missing or is not a PNG. */
export function readSource(path: string): Raster {
  if (!existsSync(path)) {
    throw new PartsError([{ code: 'ASSEMBLE_SOURCE_PRESENT', object: path, detail: 'no such file; the painting the two runs were made from is required' }]);
  }
  try {
    return readPng(path);
  } catch (err) {
    throw new PartsError([{ code: 'ASSEMBLE_SOURCE_DECODES', object: path, detail: `${(err as Error).message}; a PNG is required` }]);
  }
}

/** Read both runs, collecting the refusals of both before throwing. */
export function readRuns(full: string, head: string): { full: LayerSet; head: LayerSet } {
  const problems: Problem[] = [];
  const one = (path: string): LayerSet | null => {
    try {
      return readLayers(path);
    } catch (err) {
      if (err instanceof PartsError) {
        problems.push(...err.problems);
        return null;
      }
      throw err;
    }
  };
  const f = one(full);
  const h = one(head);
  if (problems.length > 0) throw new PartsError(problems);
  return { full: f as LayerSet, head: h as LayerSet };
}

export interface AssembleStageInput {
  source: string;
  full: string;
  head: string;
  config: string;
  seam: SeamRule;
  project: ProjectRule;
}

/** Where the assemble stage writes: `parts.json`, the directory of part PNGs, and the recomposite. */
export interface AssembleOutputs {
  partsJson: string;
  partsDir: string;
  recomposite: string;
}

/** Read, assemble, and write only after every refusal has had its chance. Throws a PartsError on a refusal, having written nothing. */
export function assembleStage(input: AssembleStageInput, outs: AssembleOutputs, log: Log): AssembleResult {
  const src = readSource(input.source);
  const runs = readRuns(input.full, input.head);
  const cfg = loadConfig(input.config);
  const fields = stageFields(cfg);
  const result = assemble({ source: src, full: runs.full, head: runs.head, ...fields, seamRule: input.seam, projectRule: input.project });
  // Emit only after green: every refusal above has already thrown.
  mkdirSync(outs.partsDir, { recursive: true });
  mkdirSync(dirname(outs.partsJson), { recursive: true });
  mkdirSync(dirname(outs.recomposite), { recursive: true });
  writeParts(outs.partsJson, result.parts);
  for (const { record, image } of result.images) writePng(join(outs.partsDir, `${record.name}.png`), image);
  writePng(outs.recomposite, result.recomposite);
  const [W, H] = result.parts.rig_size;
  log(`spine-parts assemble: ${result.images.length} part(s) on a ${W}x${H} rig (${result.parts.scale_rig_per_source} rig px per source px), seam rule ${result.seamRule}, projection rule ${result.projectRule}`);
  for (const p of result.parts.parts) {
    log(
      `  ${p.name.padEnd(11)} ${p.from.padEnd(16)} ${`${p.w}x${p.h}`.padEnd(9)} @${String(p.x).padStart(4)},${String(p.y).padStart(4)} ` +
        `op=${String(p.opaque_px).padStart(6)} vis=${String(p.visible_px).padStart(6)} src=${String(p.source_px_taken).padStart(6)}/${String(p.projected_core_px).padStart(6)} ` +
        `unproj=${String(p.visible_not_projected_px).padStart(5)} drift=${String(p.refused_drift_px).padStart(5)} merged=${p.merged_px} seam=${p.seam_override_px}`,
    );
  }
  const total = (k: 'opaque_px' | 'visible_px' | 'occluded_px' | 'source_px_taken' | 'visible_not_projected_px'): number => result.parts.parts.reduce((a, p) => a + (p[k] ?? 0), 0);
  const [op, vis, occ, taken, unproj] = (['opaque_px', 'visible_px', 'occluded_px', 'source_px_taken', 'visible_not_projected_px'] as const).map(total);
  const pct = (n: number): string => `${((100 * n) / op).toFixed(1)}%`;
  log(
    `  pixels: opaque ${op} = visible ${vis} + occluded ${occ} (${pct(occ)}); taken from the painting ${taken} (${pct(taken)}); ` +
      `visible but not projected ${unproj} (${pct(unproj)})`,
  );
  const ghosts = Object.values(result.parts.ghost_px).reduce((a, b) => a + b, 0);
  log(`  ghost px removed: ${ghosts} over ${Object.keys(result.parts.ghost_px).length} layer(s)`);
  log(figuresLine(result.figures));
  log(`wrote ${outs.partsJson}, ${result.images.length} PNG(s) in ${outs.partsDir}, ${outs.recomposite}`);
  return result;
}

// ---------------------------------------------------------------------------
// rig
// ---------------------------------------------------------------------------

interface GateRun {
  label: string;
  status: number;
  /** rigc's FAIL lines and its assertion summary, as it printed them. */
  lines: string[];
}

function gateRun(label: string, rigc: RigcRunner, args: string[]): GateRun {
  const r = rigc(args);
  const lines = r.out.split('\n').filter((l) => /^ {2}FAIL {2}/.test(l) || /assertions: \d+ measured/.test(l) || /^rigc compile error/.test(l));
  return { label, status: r.status, lines };
}

/**
 * spine-rigc's round trip over the rig in a scratch directory: `build` under
 * the spine-html profile with `--pack`, then `validate` of that build under
 * the spine profile. The files are staged exactly as `--out` will receive
 * them, so what passed is what is written. The scratch directory is the
 * caller's, and is emptied here before and after.
 */
function gateThroughRigc(out: RigOutput, texts: Array<[string, string]>, rigc: RigcRunner, scratch: string): GateRun[] {
  rmSync(scratch, { recursive: true, force: true });
  try {
    mkdirSync(join(scratch, 'images'), { recursive: true });
    for (const [file, img] of out.images) writeFileSync(join(scratch, 'images', file), encodePngBytes(img));
    for (const [file, text] of texts) writeFileSync(join(scratch, file), text);
    const build = join(scratch, 'build');
    const html = gateRun('build --profile spine-html --pack', rigc, [
      'build', '--rig', join(scratch, 'rig.json'), '--motion', join(scratch, 'motion.json'), '--out', build, '--profile', 'spine-html', '--pack',
    ]);
    if (html.status !== 0) return [html];
    return [html, gateRun('validate --profile spine', rigc, ['validate', build, '--profile', 'spine'])];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export interface RigStageInput {
  config: string;
  /** The directory holding parts.json and parts/<name>.png. */
  parts: string;
  out: string;
}

/** Author the rig, gate it through rigc in `scratch`, and write `out` only when both gates are green. */
export function rigStage(input: RigStageInput, rigc: RigcRunner, scratch: string, log: Log): RigOutput {
  const cfg = loadConfig(input.config);
  const parts = readParts(join(input.parts, 'parts.json'));
  const images = new Map<string, Raster>();
  for (const p of parts.parts) {
    const png = join(input.parts, 'parts', `${p.name}.png`);
    if (existsSync(png)) images.set(p.name, readPng(png));
  }
  const rig = buildRig(cfg, parts, images);
  const texts: Array<[string, string]> = [
    ['rig.json', rigJsonText(rig.rig)],
    ['motion.json', rigJsonText(rig.motion)],
    ['mesh_report.json', rigJsonText(rig.meshReport)],
  ];
  log(`spine-parts rig: ${cfg.key}, rig ${parts.rig_size[0]}x${parts.rig_size[1]}, ${parts.parts.length} part(s)`);
  let vertices = 0;
  for (const m of rig.meshReport) {
    vertices += m.vertices;
    log(
      `  mesh ${m.part.padEnd(12)} v=${String(m.vertices).padStart(4)} t=${String(m.triangles).padStart(4)} hull=${String(m.hull).padStart(3)} ` +
        `grid=${m.grid} bones=${m.bones.length} infl max ${m.max_influences} mean ${m.mean_influences.toFixed(2)} cover ${m.art_coverage.toFixed(5)} loop passes ${rig.loopPasses[m.part]}`,
    );
  }
  const regions = rig.rig.slots.length - rig.meshReport.length;
  const tracks = rig.motion.animations.idle.tracks;
  const keys = tracks.reduce((n, t) => n + t.keys.length, 0);
  log(
    `  bones ${rig.rig.bones.length} (${rig.controls.length} control) slots ${rig.rig.slots.length} meshes ${rig.meshReport.length} regions ${regions} vertices ${vertices}; idle ${rig.motion.animations.idle.duration} s, ${tracks.length} track(s), ${keys} key(s)`,
  );
  const gate = gateThroughRigc(rig, texts, rigc, scratch);
  for (const g of gate) {
    log(`  rigc ${g.label}: exit ${g.status}`);
    for (const l of g.lines) log(`    ${l.trim()}`);
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
  mkdirSync(join(input.out, 'images'), { recursive: true });
  for (const [file, img] of rig.images) writePng(join(input.out, 'images', file), img);
  for (const [file, text] of texts) writeFileSync(join(input.out, file), text);
  log(`spine-parts rig: wrote ${join(input.out, 'rig.json')}, motion.json, mesh_report.json and ${rig.images.length} image(s) under ${join(input.out, 'images')}`);
  return rig;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

export interface CheckStageInput {
  /** The directory holding rig.json and motion.json. */
  rig: string;
  /** The directory holding parts.json and parts/; the rig directory when they sit there. */
  parts: string;
  out: string;
}

/** The pack line as it is printed: rigc's own, then the page's opaque share beside the spineboy yardstick. */
export function packLines(r: CheckReport): string[] {
  if (r.pack.length === 0) return ['pack: no pack line in the build output'];
  return r.pack.map((p) => {
    const op = r.packOpaque.find((o) => o.page === p.page);
    return `${p.line}; page opaque ${op === undefined ? 'not measured (page not on disk)' : `${(op.share * 100).toFixed(1)}%`} (alpha > 0) — spineboy yardstick ${SPINEBOY_YARDSTICK}, a reference and not a bar`;
  });
}

function showFigure(v: unknown): string {
  if (Array.isArray(v)) return v.length === 0 ? 'none' : v.map(showFigure).join(' | ');
  if (typeof v === 'object' && v !== null) return Object.entries(v).map(([k, x]) => `${k} ${showFigure(x)}`).join(', ');
  return String(v);
}

/** A judgement line as the console prints it: its name, its status, then its figures and bars as check.json holds them (a SKIP prints its reason). */
export function judgementLine(name: string, line: JudgementLine): string {
  if (line.status === 'SKIP') return `${name}: SKIP — ${String(line.reason)}`;
  return `${name}: ${line.status} — ${Object.entries(line)
    .filter(([k]) => k !== 'status')
    .map(([k, v]) => `${k} ${showFigure(v)}`)
    .join('; ')}`;
}

/**
 * Run the check and print its report. Returns the report; `figures.PASS` says
 * whether every bar was met, and each one that was not is printed as a FAIL
 * line here. Throws a PartsError when the check could not measure at all.
 */
export function checkStage(input: CheckStageInput, rigc: RigcRunner, bin: string, log: Log): CheckReport {
  const v = rigc(['--version']);
  log(`spine-parts check: ${input.rig} -> ${input.out}`);
  log(`  rigc ${v.out.trim().split('\n')[0]} at ${bin}`);
  const r = runCheck(input.rig, input.out, rigc, input.parts);
  log('  gate spine-html (rigc build --profile spine-html --pack), verbatim:');
  for (const l of r.gateHtml) log(l);
  log('  gate spine (rigc validate build --profile spine), verbatim:');
  for (const l of r.gateSpine) log(l);
  for (const l of packLines(r)) log(`  ${l}`);
  const fig = r.figures;
  log(`  loop: idle ${r.idle.frames} frame(s) at ${r.idle.fps} fps, f0000 vs f${String(r.idle.lastIndex).padStart(4, '0')} (t = ${r.idle.duration}s): max |d| ${fig.loop_max_diff} (0 required)`);
  log(
    `  seam: setup pose at ${r.seamViewport.pixelWidth}x${r.seamViewport.pixelHeight}, scale ${r.seamViewport.scale.toFixed(4)}: mean |d| ${fig.seam_mean} (<= ${SEAM_MEAN_BAR.toFixed(1)}), ` +
      `${fig.seam_px_over_40} px over ${SEAM_PX_LEVEL} (<= ${SEAM_PX_BAR}), ${fig.seam_px_over_80} px over ${SEAM_PX_LEVEL_HIGH} (reported)`,
  );
  for (const name of JUDGEMENT_LINES) log(`  ${judgementLine(name, fig[name])}`);
  log(`  gates: spine-html ${fig.gate_spine_html_green ? 'green' : 'RED'}, spine ${fig.gate_spine_green ? 'green' : 'RED'}`);
  log(`  wrote ${r.written.map((w) => join(input.out, w)).join(', ')}, ${join(input.out, 'build')}/, ${join(input.out, 'idle_frames')}/`);
  for (const p of r.problems) log(`  FAIL  ${problemLine(p)}`);
  log(fig.PASS ? 'check: PASS' : `check: FAIL — ${r.problems.length} bar(s) not met`);
  return r;
}

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

function sameRgba(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The loop file's format: `apng` is the lossless APNG, the exactness record;
 * `indexed` the colour-type-3 APNG with one shared palette, the README-sized
 * file; `gif` the GIF89a. The CLI picks it from the extension and `--palette`.
 */
export type LoopFormat = 'apng' | 'indexed' | 'gif';

export interface LoopResult {
  bytes: number;
  /** The palette error over every encoded frame; null for the lossless APNG, which has none. */
  error: PaletteError | null;
}

/**
 * Encode a rigc frame set as a looping APNG, indexed APNG or GIF and write it.
 * An encoder refusal is a PartsError coded `LOOP_ENCODE`, so it prints like
 * every other.
 */
export function loopStage(frames: string, out: string, format: LoopFormat, log: Log): LoopResult {
  const set = readFrameSet(frames);
  const images = set.frames.map((fr) => fr.image);
  log(`spine-parts loop: ${set.dir} -> ${out}`);
  log(`  ${images.length} frame(s) ${images[0]?.width ?? 0}x${images[0]?.height ?? 0} at ${set.fps} fps (from frames.json), animation ${set.animation ?? '(none)'}`);
  let used = images;
  const lastName = set.frames[set.frames.length - 1]?.name ?? '';
  if (images.length > 1 && sameRgba(images[0].data, images[images.length - 1].data)) {
    used = images.slice(0, -1);
    log(`  ${lastName} equals f0000.png byte for byte, so it is dropped: the loop wraps onto frame 0, and showing it twice would hold that pose for two ticks`);
  } else if (images.length > 1) {
    log(`  ${lastName} differs from f0000.png, so every frame is kept and the loop will jump at the wrap`);
  }
  const anim: AnimFrame[] = used.map((image) => ({ image, ticks: 1 }));
  log(`  ${anim.length} frame(s) encoded, ${(anim.length / set.fps).toFixed(3)}s per loop, looping forever`);
  try {
    if (format === 'apng') {
      const { bytes, stats } = encodeApng(anim, set.fps);
      writeFileSync(out, bytes);
      log(`  APNG: ${stats.frames} frame(s) after merging identical neighbours, ${stats.overFrames} of ${Math.max(0, stats.frames - 1)} later frame(s) blended OVER with unchanged pixels cleared, lossless`);
      log(`  wrote ${out}: ${stats.bytes} bytes`);
      return { bytes: stats.bytes, error: null };
    }
    if (format === 'indexed') {
      const { bytes, stats } = encodeIndexedApng(anim, set.fps);
      writeFileSync(out, bytes);
      log(
        `  indexed APNG: ${stats.frames} frame(s) after merging, ${stats.overFrames} of ${Math.max(0, stats.frames - 1)} later frame(s) blended OVER; ${stats.entries} palette entries (1 transparent, ${stats.entries - 1} cut from ${stats.distinct} distinct), ${stats.bitDepth}-bit, ${INDEXED_DEFAULTS.dither ? 'Floyd–Steinberg dithering' : 'no dithering'}, filter ${INDEXED_DEFAULTS.adaptiveFilter ? 'adaptive' : 'None'}`,
      );
      log(`  ${errorText(stats.all)}`);
      log(`  wrote ${out}: ${stats.bytes} bytes`);
      return { bytes: stats.bytes, error: stats.all };
    }
    const { bytes, stats } = encodeGif(anim, set.fps);
    writeFileSync(out, bytes);
    log(`  GIF: ${stats.frames} frame(s) after merging, ${stats.colours} palette colour(s) cut from ${stats.distinct} distinct, no dithering`);
    log(`  palette error (per channel, of 255): frame 0 max ${stats.frame0.max}, mean ${stats.frame0.mean.toFixed(3)}; all frames max ${stats.all.max}, mean ${stats.all.mean.toFixed(3)}`);
    log(`  wrote ${out}: ${stats.bytes} bytes`);
    return { bytes: stats.bytes, error: stats.all };
  } catch (err) {
    if (err instanceof EncodeError) throw new PartsError([{ code: 'LOOP_ENCODE', object: out, detail: err.message }]);
    throw err;
  }
}

/** A palette error as the loop lines print it: R, G, B per channel over every frame, and alpha. */
function errorText(e: PaletteError): string {
  return `palette error (per channel, of 255, all frames): max ${e.max}, mean ${e.mean.toFixed(3)}; alpha max ${e.alphaMax}`;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export interface BuildInput {
  config: string;
  source: string;
  full: string;
  head: string;
  out: string;
  seam: SeamRule;
  project: ProjectRule;
  loop: boolean;
}

/** The two rigc processes, as each command runs its own: `rig` gates through one, `check` measures through the other. */
export interface BuildRunners {
  rig: RigcRunner;
  check: RigcRunner;
  /** Where the check's rigc binary is, for its header line. */
  checkBin: string;
  /** A directory the rig stage may stage its gate in; emptied before and after. */
  scratch: string;
}

/** Every path `build` writes under `--out`, relative — and so every path it clears first. */
export const BUILD_OWNS: readonly string[] = ['parts', 'parts.json', 'recomposite_rig.png', 'rig', 'check', 'idle.gif', 'idle.png', 'idle-indexed.png'];

export type BuildStage = 'assemble' | 'rig' | 'check' | 'loop' | 'artifact';

export interface BuildResult {
  /** The stage that refused, or null when the build is green. */
  stoppedAt: BuildStage | null;
  check: CheckReport | null;
  /** The artifact's paths, on green: skeleton JSON, atlas, then each packed page. */
  artifact: string[];
}

/** The three artifact files of a packed build, each refused by name when absent. */
function artifactPaths(buildDir: string, report: CheckReport): string[] {
  const problems: Problem[] = [];
  const names = existsSync(buildDir) ? readdirSync(buildDir).sort() : [];
  const json = names.filter((n) => n.endsWith('.json'));
  const atlas = names.filter((n) => n.endsWith('.atlas'));
  if (json.length !== 1) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} skeleton JSON`, detail: `holds ${json.length} .json file(s) [${json.join(', ')}]; the packed build writes exactly one` });
  if (atlas.length !== 1) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} atlas`, detail: `holds ${atlas.length} .atlas file(s) [${atlas.join(', ')}]; the packed build writes exactly one` });
  if (report.pack.length === 0) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} packed page`, detail: 'rigc printed no pack line, so no packed page is named; the build runs with --pack and must print one' });
  for (const p of report.pack) {
    if (!names.includes(p.page)) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} packed page`, detail: `the pack line names ${p.page}, which is not on disk` });
  }
  if (problems.length > 0) throw new PartsError(problems);
  return [join(buildDir, json[0]), join(buildDir, atlas[0]), ...report.pack.map((p) => join(buildDir, p.page))];
}

/**
 * assemble -> rig -> check [-> loop], each stage's lines under its prefix,
 * stopping at the first stage that refuses. Returns where it stopped; the
 * caller turns that into the exit status. A crash that is not a refusal is
 * rethrown: it is not a stage's message and must not be printed as one.
 */
export function build(input: BuildInput, run: BuildRunners, log: Log): BuildResult {
  const prefixed = (stage: BuildStage): Log => (line) => log(`[${stage}] ${line}`);
  const refused = (stage: BuildStage, err: unknown, check: CheckReport | null = null): BuildResult => {
    if (!(err instanceof PartsError)) throw err;
    const say = prefixed(stage);
    for (const p of err.problems) say(`  FAIL  ${problemLine(p)}`);
    say(`refused: ${err.problems.length} problem(s)`);
    log(`build: stopped at ${stage}; no later stage ran`);
    return { stoppedAt: stage, check, artifact: [] };
  };
  const out = input.out;
  mkdirSync(out, { recursive: true });
  for (const p of BUILD_OWNS) rmSync(join(out, p), { recursive: true, force: true });
  log(`spine-parts build: ${input.config} -> ${out}, seam rule ${input.seam}, projection rule ${input.project}${input.loop ? ', with the idle loop' : ''}`);

  try {
    assembleStage(
      { source: input.source, full: input.full, head: input.head, config: input.config, seam: input.seam, project: input.project },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png') },
      prefixed('assemble'),
    );
  } catch (err) {
    return refused('assemble', err);
  }

  try {
    rigStage({ config: input.config, parts: out, out: join(out, 'rig') }, run.rig, run.scratch, prefixed('rig'));
  } catch (err) {
    return refused('rig', err);
  }

  let report: CheckReport;
  try {
    report = checkStage({ rig: join(out, 'rig'), parts: out, out: join(out, 'check') }, run.check, run.checkBin, prefixed('check'));
  } catch (err) {
    return refused('check', err);
  }
  if (!report.figures.PASS) {
    log(`build: stopped at check; ${report.problems.length} bar(s) not met, so no loop was encoded and no artifact is reported`);
    return { stoppedAt: 'check', check: report, artifact: [] };
  }

  if (input.loop) {
    const frames = join(out, 'check', 'idle_frames');
    try {
      const say = prefixed('loop');
      const lossless = loopStage(frames, join(out, 'idle.png'), 'apng', say);
      const indexed = loopStage(frames, join(out, 'idle-indexed.png'), 'indexed', say);
      const gif = loopStage(frames, join(out, 'idle.gif'), 'gif', say);
      const fig = (e: PaletteError | null): string => (e === null ? 'lossless' : `max ${e.max}, mean ${e.mean.toFixed(3)}`);
      say(`loop: idle.png ${lossless.bytes} B (${fig(lossless.error)}); idle-indexed.png ${indexed.bytes} B (${fig(indexed.error)}); idle.gif ${gif.bytes} B (${fig(gif.error)}) — palette error per channel over all frames`);
    } catch (err) {
      return refused('loop', err, report);
    }
  }

  let artifact: string[];
  try {
    artifact = artifactPaths(join(out, 'check', 'build'), report);
  } catch (err) {
    return refused('artifact', err, report);
  }
  log(`build: PASS — the packed atlas is the artifact; parts/ and rig/ are the intermediates it was made from`);
  for (const l of packLines(report)) log(`  ${l}`);
  for (const a of artifact) log(`  ${a}`);
  return { stoppedAt: null, check: report, artifact };
}
