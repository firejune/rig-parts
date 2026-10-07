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
 * | `parts/<name>.png`, `parts.json`, `recomposite_rig.png`, `recomposite_error_rig.png` | assemble — the loose parts, an intermediate, and the error map of their flat stack |
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
import { assemble, type AssembleResult, figuresLine, holeLines, type ProjectRule, type SeamRule, stageFields } from './assemble.ts';
import { BARS, causeLines, REQUIREMENTS_DIR, type CheckReport, type PackLine, DEFAULT_PACK_SHAPE, DEFAULT_PAGE_EDGES, JUDGEMENT_LINES, type JudgementLine, packedBuildArgs, packedBuildLabel, type PackMode, type PackShape, type PageEdges, readFrameSet, REPORTED_LINES, type ReportedLine, type RigcRunner, runCheck, SEAM_MEAN_BAR, SOURCE_LINE, SEAM_PX_BAR, SEAM_PX_LEVEL, SEAM_PX_LEVEL_HIGH, SPINEBOY_YARDSTICK } from './check.ts';
import { loadConfig, loadEarlyConfig } from './config.ts';
import { PartsError, type Problem, problemLine } from './errors.ts';
import { encodeGif } from './gif.ts';
import { CONTROL_SUFFIX } from './motion.ts';
import type { PaletteError } from './palette.ts';
import { type LayerSet, readLayers } from './layers.ts';
import { type PartRecord, readParts, writeParts } from './parts.ts';
import { encodePngBytes, readPng, writePng } from './raster/png.ts';
import type { Raster } from './raster/types.ts';
import { readRequirements, type RequirementLine, summaryText } from './requirements.ts';
import { buildRig, DEFAULT_IDLE_KEYS, type IdleKeys, type RigCommand, rigJsonText, type RigOutput } from './rig.ts';

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

/** Where the assemble stage writes: `parts.json`, the directory of part PNGs, the recomposite, and its error map. */
export interface AssembleOutputs {
  partsJson: string;
  partsDir: string;
  recomposite: string;
  errorMap: string;
}

/** The error map's file name beside a recomposite: `recomposite_rig.png` -> `recomposite_error_rig.png`. */
export const ERROR_MAP_FILE = 'recomposite_error_rig.png';

/**
 * One line per part whose fringe `pushBackFringe` cleared (issue #119), in
 * draw order: `  fringe pushed back: "topwear" 723 px, where the painting
 * shows "handwear_l" 460 px, "bottomwear" 257 px`. No line when no part had
 * one, so a stack the rule did not touch prints what it printed before.
 */
export function fringeLines(parts: readonly PartRecord[]): string[] {
  return parts
    .filter((p) => p.fringe_pushed_back !== undefined && p.fringe_pushed_back.length > 0)
    .map((p) => {
      const list = p.fringe_pushed_back ?? [];
      const n = list.reduce((a, q) => a + q.px, 0);
      return `  fringe pushed back: "${p.name}" ${n} px, where the painting shows ${list.map((q) => `"${q.part}" ${q.px} px`).join(', ')}`;
    });
}

/** Read, assemble, and write only after every refusal has had its chance. Throws a PartsError on a refusal, having written nothing. */
export function assembleStage(input: AssembleStageInput, outs: AssembleOutputs, log: Log): AssembleResult {
  const src = readSource(input.source);
  const runs = readRuns(input.full, input.head);
  // The early door: assemble runs before propose has drafted bones, meshes,
  // regions and motion, so it requires only what it reads (issue #20).
  const fields = stageFields(loadEarlyConfig(input.config, 'assemble'));
  const result = assemble({ source: src, full: runs.full, head: runs.head, ...fields, seamRule: input.seam, projectRule: input.project });
  // Emit only after green: every refusal above has already thrown.
  mkdirSync(outs.partsDir, { recursive: true });
  mkdirSync(dirname(outs.partsJson), { recursive: true });
  mkdirSync(dirname(outs.recomposite), { recursive: true });
  mkdirSync(dirname(outs.errorMap), { recursive: true });
  writeParts(outs.partsJson, result.parts);
  for (const { record, image } of result.images) writePng(join(outs.partsDir, `${record.name}.png`), image);
  writePng(outs.recomposite, result.recomposite);
  writePng(outs.errorMap, result.errorMap);
  const [W, H] = result.parts.rig_size;
  log(`spine-parts assemble: ${result.images.length} part(s) on a ${W}x${H} rig (${result.parts.scale_rig_per_source} rig px per source px), seam rule ${result.seamRule}, projection rule ${result.projectRule}`);
  for (const p of result.parts.parts) {
    log(
      `  ${p.name.padEnd(11)} ${p.from.padEnd(16)} ${`${p.w}x${p.h}`.padEnd(9)} @${String(p.x).padStart(4)},${String(p.y).padStart(4)} ` +
        `op=${String(p.opaque_px).padStart(6)} vis=${String(p.visible_px).padStart(6)} src=${String(p.source_px_taken).padStart(6)}/${String(p.projected_core_px).padStart(6)} ` +
        `unproj=${String(p.visible_not_projected_px).padStart(5)} drift=${String(p.refused_drift_px).padStart(5)} merged=${p.merged_px} seam=${p.seam_override_px}`,
    );
  }
  for (const l of fringeLines(result.parts.parts)) log(l);
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
  for (const l of holeLines(result.figures)) log(l);
  log(`wrote ${outs.partsJson}, ${result.images.length} PNG(s) in ${outs.partsDir}, ${outs.recomposite}, ${outs.errorMap} (uncovered error px red, covered error px blue, the painting grey)`);
  return result;
}

// ---------------------------------------------------------------------------
// rig
// ---------------------------------------------------------------------------

export interface GateRun {
  label: string;
  status: number;
  /**
   * rigc's FAIL lines, its assertion summary, the core entry's `here:` line and
   * the one SKIP this stage's own declaration causes, as it printed them — or,
   * for a run that exited non-zero with none of those, the lines
   * {@link causeLines} says name why.
   */
  lines: string[];
}

/**
 * `A15_IDLE_NO_MESH_BONE_KEYS`'s SKIP under `invariants.idleDrivesMeshes` —
 * the line in which rigc states what `--idle-keys direct` declared and what it
 * costs. It is the one SKIP the rig stage prints: every other SKIP is a check
 * with nothing to measure, while this one is switched off by a field this
 * stage wrote, so it is shown rather than folded into the skipped count.
 */
const DECLARED_SKIP = /^ {2}SKIP {2}A15_IDLE_NO_MESH_BONE_KEYS: declared by the rig/;

/** The core entry's line after its summary (spine-rigc 2.0.0 and later): which rules ran, and that the round trip did not. */
const HERE_LINE = /^ {2}\.\. {4}here: /;

function gateRun(label: string, rigc: RigcRunner, args: string[]): GateRun {
  const r = rigc(args);
  const lines = r.out.split('\n').filter((l) => /^ {2}FAIL {2}/.test(l) || /assertions: \d+ measured/.test(l) || /^rigc compile error/.test(l) || DECLARED_SKIP.test(l) || HERE_LINE.test(l));
  const failed = lines.some((l) => /^ {2}FAIL {2}/.test(l) || /^rigc compile error/.test(l));
  return { label, status: r.status, lines: r.status !== 0 && !failed ? [...lines, ...causeLines(r.out)] : lines };
}

/**
 * spine-rigc's gate over the rig in a scratch directory: `build` under the
 * spine-html profile with `--pack --page-edges <edges> --pack-shape <shape>`, which runs the gate
 * once over the compile and once over the packed pages on disk. There is no
 * second `validate --profile spine` run: spine-html holds every rule spine
 * measures (selftest `CH09`). The files are staged exactly as `--out` will
 * receive them, so what passed is what is written. The scratch directory is
 * the caller's, and is emptied here before and after. `images` are the PNG
 * files' bytes as `--out` will receive them: the rig stage's are its rasters
 * encoded as `writePng` encodes them, `compose`'s the builds' own files.
 */
export function gateThroughRigc(images: ReadonlyArray<readonly [string, Uint8Array]>, texts: ReadonlyArray<readonly [string, string]>, rigc: RigcRunner, scratch: string, mode: PackMode): GateRun[] {
  rmSync(scratch, { recursive: true, force: true });
  try {
    mkdirSync(join(scratch, 'images'), { recursive: true });
    for (const [file, bytes] of images) writeFileSync(join(scratch, 'images', file), bytes);
    for (const [file, text] of texts) writeFileSync(join(scratch, file), text);
    const build = join(scratch, 'build');
    return [gateRun(packedBuildLabel(mode), rigc, ['build', '--rig', join(scratch, 'rig.json'), '--motion', join(scratch, 'motion.json'), '--out', build, ...packedBuildArgs(mode)])];
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * What only this package can add to rigc's refusal of a two-bone ik a control
 * splits (issue #103). Under `--idle-keys ctl` a chain link the idle keys is
 * keyed through a same-origin `<link>_ctl` parent, so a config's ik over that
 * link and the link above it names a pair whose second bone is not the
 * first's child; spine-rigc 2.15.0's rig-spec parser refuses it by name
 * (firejune/rigc#1205), with `("<link>_ctl" stands between)` in its sentence
 * and a remedy a config cannot follow — a config cannot name the control.
 *
 * This reads rigc's verdict and checks no rule of its own: for each control
 * the stage added, a rigc line saying that control, and only it, stands
 * between gets one sentence naming the flag on the command that ran. The ik
 * shape is rigc's to judge; a pair split by a control and by a bone the config
 * declares (`"…_ctl", "…" stand between`) gets nothing, because
 * `--idle-keys direct` would not make it a parent and its child. Should rigc
 * reword its sentence, rigc's refusal still reaches the author and only this
 * sentence is lost; the selftest holds it on the installed rigc (`RG56`).
 */
export function ctlRemedies(lines: readonly string[], controls: readonly string[], command: RigCommand): string[] {
  const out: string[] = [];
  for (const bone of controls) {
    const ctl = `${bone}${CONTROL_SUFFIX}`;
    if (!lines.some((l) => l.includes(`("${ctl}" stands between)`))) continue;
    out.push(`"${ctl}" is the control this stage keys "${bone}" through under --idle-keys ctl, and a config cannot name it: run \`${command} --idle-keys direct\`, which keys "${bone}" in place, so no control stands between "${bone}" and its parent`);
  }
  return out;
}

export interface RigStageInput {
  config: string;
  /** The directory holding parts.json and parts/<name>.png. */
  parts: string;
  out: string;
  /** Where the idle's keys on mesh-driving bones go; `ctl` when absent. See `IDLE_KEYS` in `src/rig.ts`. */
  idleKeys?: IdleKeys;
  /** The gate build's `--page-edges`; {@link DEFAULT_PAGE_EDGES} when absent. The pack is scratch here; the gate is what it is for. */
  pageEdges?: PageEdges;
  /** The gate build's `--pack-shape`; {@link DEFAULT_PACK_SHAPE} when absent. */
  packShape?: PackShape;
  /** The command running the stage, which {@link ctlRemedies} names beside the flag; `rig` when absent. It moves no byte written. */
  command?: RigCommand;
}

/** Author the rig, gate it through rigc in `scratch`, and write `out` only when the gate is green. */
export function rigStage(input: RigStageInput, rigc: RigcRunner, scratch: string, log: Log): RigOutput {
  const cfg = loadConfig(input.config);
  const parts = readParts(join(input.parts, 'parts.json'));
  const images = new Map<string, Raster>();
  for (const p of parts.parts) {
    const png = join(input.parts, 'parts', `${p.name}.png`);
    if (existsSync(png)) images.set(p.name, readPng(png));
  }
  const rig = buildRig(cfg, parts, images, undefined, input.idleKeys ?? DEFAULT_IDLE_KEYS);
  const texts: Array<[string, string]> = [
    ['rig.json', rigJsonText(rig.rig)],
    ['motion.json', rigJsonText(rig.motion)],
    ['mesh_report.json', rigJsonText(rig.meshReport)],
  ];
  log(`spine-parts rig: ${cfg.key}, rig ${parts.rig_size[0]}x${parts.rig_size[1]}, ${parts.parts.length} part(s)`);
  let vertices = 0;
  for (const m of rig.meshReport) {
    vertices += m.vertices;
    const head = `  mesh ${m.part.padEnd(12)} v=${String(m.vertices).padStart(4)} t=${String(m.triangles).padStart(4)} hull=${String(m.hull).padStart(3)} `;
    const infl = `bones=${m.bones.length} infl max ${m.max_influences} mean ${m.mean_influences.toFixed(2)} cover ${m.art_coverage.toFixed(5)}`;
    if ('mode' in m && m.mode === 'auto') {
      const s = m.source.counts;
      const r = m.result.counts;
      const t = m.termination;
      const tried = t.reason === 'no-further-valid-reduction' || t.reason === 'budget-exhausted' ? ` after ${t.candidatesTried} candidate(s)` : '';
      const worst = m.worst_residual === null ? 'none declared' : `${m.worst_residual.code}${m.worst_residual.region === null ? '' : `[${m.worst_residual.region}]`} ${m.worst_residual.value} ${m.worst_residual.bound?.op} ${m.worst_residual.bound?.value}`;
      const from = s === null ? 'unread' : `${s.boundaryVertices}+${s.interiorVertices}`;
      log(`${head}auto ${from} -> ${r.boundaryVertices}+${r.interiorVertices} (hull+interior) bindings ${r.bindings} ${infl} ${t.reason}${tried}; worst ${worst}; deformation unmeasured`);
    } else if ('mode' in m) {
      const c = m.contour;
      const stray = c.strayIslands === 0 ? '' : ` left out ${c.strayIslands} island(s), ${c.strayPixels} px`;
      const regions = m.regions.map((rg) => ` region ${rg.name}->${rg.bone} reaches ${rg.reached} (${rg.whole} whole)`).join('');
      log(`${head}contour tol=${m.params.tolerance} margin=${m.params.margin} spacing=${m.params.spacing} ${infl} overshoot ${c.overshoot} min angle ${c.smallestAngle.value}${stray}${regions}`);
    } else log(`${head}grid=${m.grid} ${infl} loop passes ${rig.loopPasses[m.part]}`);
  }
  const regions = rig.rig.slots.length - rig.meshReport.length;
  const tracks = rig.motion.animations.idle.tracks;
  const keys = tracks.reduce((n, t) => n + t.keys.length, 0);
  log(
    `  bones ${rig.rig.bones.length} (${rig.controls.length} control) slots ${rig.rig.slots.length} meshes ${rig.meshReport.length} regions ${regions} vertices ${vertices}; idle ${rig.motion.animations.idle.duration} s, ${tracks.length} track(s), ${keys} key(s)`,
  );
  log(
    rig.idleKeys === 'ctl'
      ? `  idle keys ctl: ${rig.meshKeyed.length} mesh-driving bone(s) keyed by the idle, each keyed through a same-origin <bone>_ctl parent`
      : `  idle keys direct: ${rig.meshKeyed.length} mesh-driving bone(s) keyed in place, ${rig.rig.invariants === undefined ? 'so no invariants.idleDrivesMeshes is declared (it would switch nothing off)' : 'invariants.idleDrivesMeshes declared'}`,
  );
  const gate = gateThroughRigc(rig.images.map(([file, img]) => [file, encodePngBytes(img)] as const), texts, rigc, scratch, { pageEdges: input.pageEdges ?? DEFAULT_PAGE_EDGES, packShape: input.packShape ?? DEFAULT_PACK_SHAPE });
  for (const g of gate) {
    log(`  rigc ${g.label}: exit ${g.status}`);
    for (const l of g.lines) log(`    ${l.trim()}`);
  }
  const red = gate.filter((g) => g.status !== 0);
  if (red.length > 0) {
    const problems: Problem[] = red.map((g) => ({
      code: 'RIG_RIGC_GREEN',
      object: `rigc ${g.label}`,
      detail: `exited ${g.status}${g.lines.length > 0 ? `: ${g.lines.map((l) => l.trim()).join(' | ')}` : ', and it printed nothing'}; ${ctlRemedies(g.lines, rig.controls, input.command ?? 'rig').map((s) => `${s}; `).join('')}exit 0 is required before anything is written, and nothing was`,
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
  /**
   * The directory holding parts.json and parts/ (`--parts`). Absent, it is the
   * rig directory, where a missing parts.json is measured without (issue #77);
   * named, a missing one is refused.
   */
  parts?: string;
  out: string;
  /** The painting `--source` names (issue #77): adds the setup pose against it. */
  source?: string;
  /** The packed build's `--page-edges`; {@link DEFAULT_PAGE_EDGES} when absent. */
  pageEdges?: PageEdges;
  /** The packed build's `--pack-shape`; {@link DEFAULT_PACK_SHAPE} when absent. */
  packShape?: PackShape;
  /** The scene's declared requirements (`--requirements`, issue #93); absent, nothing is read, written or printed for them. */
  requirements?: string;
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

/**
 * How many of the {@link BARS} measured and how many said SKIP, by name — the
 * summary's second half (issue #77): `PASS` reads only the bars that measured,
 * so a run that measured one bar says so on the line that says PASS.
 */
export function barsSummary(r: CheckReport): string {
  const { measured, skipped } = r.bars;
  return `${measured.length} of ${BARS.length} bar(s) measured, ${skipped.length} skipped${skipped.length === 0 ? '' : ` (${skipped.map((s) => s.bar).join(', ')})`}`;
}

/** A judgement line as the console prints it: its name, its status, then its figures and bars as check.json holds them (a SKIP prints its reason). */
export function judgementLine(name: string, line: JudgementLine | ReportedLine): string {
  if (line.status === 'SKIP') return `${name}: SKIP — ${String(line.reason)}`;
  return `${name}: ${line.status} — ${Object.entries(line)
    .filter(([k]) => k !== 'status')
    .map(([k, v]) => `${k} ${showFigure(v)}`)
    .join('; ')}`;
}

/** A requirement's line as the console prints it: its name and status, the reason first when NOT MEASURABLE, then its figures as check.json holds them. */
export function requirementText(name: string, line: RequirementLine): string {
  const rest = Object.entries(line).filter(([k]) => k !== 'status' && k !== 'reason');
  return `${name}: ${line.status} — ${[...(line.status === 'NOT MEASURABLE' ? [String(line.reason)] : []), ...rest.map(([k, v]) => `${k} ${showFigure(v)}`)].join('; ')}`;
}

/**
 * Run the check and print its report. Returns the report; `figures.PASS` says
 * whether every bar was met, and each one that was not is printed as a FAIL
 * line here. Throws a PartsError when the check could not measure at all.
 */
export function checkStage(input: CheckStageInput, rigc: RigcRunner, bin: string, log: Log): CheckReport {
  const v = rigc(['--version']);
  log(`spine-parts check: ${input.rig} -> ${input.out}`);
  const versionLines = v.out.trim().split('\n');
  const entryLine = versionLines.find((l) => l.startsWith('entry:'));
  log(`  rigc ${versionLines[0]} at ${bin}${entryLine === undefined ? '' : `; ${entryLine}`}`);
  const mode: PackMode = { pageEdges: input.pageEdges ?? DEFAULT_PAGE_EDGES, packShape: input.packShape ?? DEFAULT_PACK_SHAPE };
  const r = runCheck(input.rig, input.out, rigc, input.parts, mode, input.source, input.requirements);
  log(`  gate spine-html (rigc ${packedBuildLabel(mode)}), verbatim:`);
  for (const l of r.gateHtml) log(l);
  for (const l of packLines(r)) log(`  ${l}`);
  const fig = r.figures;
  if (r.idle === null) log(`  loop: SKIP — ${fig.skipped?.loop ?? ''}`);
  else log(`  loop: idle ${r.idle.frames} frame(s) at ${r.idle.fps} fps, f0000 vs f${String(r.idle.lastIndex).padStart(4, '0')} (t = ${r.idle.duration}s): max |d| ${fig.loop_max_diff} (0 required)`);
  if (r.seamViewport === null || fig.seam_mean === null) log(`  seam: SKIP — ${fig.skipped?.seam ?? ''}`);
  else {
    log(
      `  seam: setup pose at ${r.seamViewport.pixelWidth}x${r.seamViewport.pixelHeight}, scale ${r.seamViewport.scale.toFixed(4)}: mean |d| ${fig.seam_mean} (<= ${SEAM_MEAN_BAR.toFixed(1)}), ` +
        `${fig.seam_px_over_40} px over ${SEAM_PX_LEVEL} (<= ${SEAM_PX_BAR}), ${fig.seam_px_over_80} px over ${SEAM_PX_LEVEL_HIGH} (reported)`,
    );
  }
  for (const name of JUDGEMENT_LINES) log(`  ${judgementLine(name, fig[name])}`);
  for (const name of REPORTED_LINES) log(`  ${judgementLine(name, fig[name])}`);
  const vsSource = fig[SOURCE_LINE];
  if (vsSource !== undefined) log(`  ${judgementLine(SOURCE_LINE, vsSource)}`);
  if (r.requirements !== null) {
    for (const [name, line] of Object.entries(r.requirements.lines)) log(`  ${requirementText(name, line)}`);
    log(`  ${summaryText(r.requirements.summary)}`);
  }
  log(`  gate: spine-html ${fig.gate_spine_html_green ? 'green' : 'RED'} (${fig.rigc_entry.entry}${fig.rigc_entry.spine_core === null ? ', rigc\'s own validator' : `, the spine-core ${fig.rigc_entry.spine_core} round trip`})`);
  log(`  wrote ${r.written.map((w) => join(input.out, w)).join(', ')}, ${join(input.out, 'build')}/${r.idle === null ? '' : `, ${join(input.out, 'idle_frames')}/`}${r.requirements === null ? '' : `, ${join(input.out, REQUIREMENTS_DIR)}/`}`);
  for (const p of r.problems) log(`  FAIL  ${problemLine(p)}`);
  const reqNotPass = r.requirements === null ? 0 : r.requirements.summary.declared - r.requirements.summary.pass;
  const notMet = r.requirements === null ? `${r.problems.length} bar(s) not met` : `${r.problems.length - reqNotPass} bar(s) not met, ${reqNotPass} declared requirement(s) not PASS`;
  log(`${fig.PASS ? 'check: PASS' : `check: FAIL — ${notMet}`}; ${barsSummary(r)}`);
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
  /** `--page-edges` for both packed builds, the rig stage's gate and the check's artifact. */
  pageEdges: PageEdges;
  /** `--pack-shape` for both packed builds, as `pageEdges`; {@link DEFAULT_PACK_SHAPE} when absent. */
  packShape?: PackShape;
  /** `--requirements`, forwarded to the check (issue #93): read before assemble runs, so a file check would refuse is refused first; absent, nothing moves. */
  requirements?: string;
  /** `--idle-keys`, forwarded to the rig stage as `rig` takes it (issue #95); {@link DEFAULT_IDLE_KEYS} when absent. */
  idleKeys?: IdleKeys;
}

/**
 * The rigc process for each stage: `rig` gates through one, `check` measures
 * through the other. `cli.ts` hands both the same runner, the `rigc` binary
 * spine-rigc's launcher answers for; they are two fields so a caller can tell
 * the stages' calls apart (the selftest counts them).
 */
export interface BuildRunners {
  rig: RigcRunner;
  check: RigcRunner;
  /** Where the check's rigc binary is, for its header line. */
  checkBin: string;
  /** A directory the rig stage may stage its gate in; emptied before and after. */
  scratch: string;
}

/** Every path `build` writes under `--out`, relative — and so every path it clears first. */
export const BUILD_OWNS: readonly string[] = ['parts', 'parts.json', 'recomposite_rig.png', ERROR_MAP_FILE, 'rig', 'check', 'idle.gif', 'idle.png', 'idle-indexed.png'];

export type BuildStage = 'assemble' | 'rig' | 'check' | 'loop' | 'artifact';

export interface BuildResult {
  /** The stage that refused, or null when the build is green. */
  stoppedAt: BuildStage | null;
  check: CheckReport | null;
  /** The artifact's paths, on green: skeleton JSON, atlas, then each packed page. */
  artifact: string[];
}

/**
 * rigc's own record of the compiled rig, which `build` writes beside the
 * skeleton JSON and atlas (spine-rigc's AUTHORING, the `--out` row; written
 * since 1.6): what rigc's posing core reads, not a Spine file, so it is not the
 * artifact and is not counted as a second skeleton JSON.
 */
export const RIGC_MODEL_DOCUMENT = 'skeleton.model.json';

/** The three artifact files of a packed build, each refused by name when absent. */
export function artifactPaths(buildDir: string, pack: readonly PackLine[]): string[] {
  const problems: Problem[] = [];
  const names = existsSync(buildDir) ? readdirSync(buildDir).sort() : [];
  const json = names.filter((n) => n.endsWith('.json') && n !== RIGC_MODEL_DOCUMENT);
  const atlas = names.filter((n) => n.endsWith('.atlas'));
  if (json.length !== 1) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} skeleton JSON`, detail: `holds ${json.length} .json file(s) [${json.join(', ')}]; the packed build writes exactly one besides rigc's ${RIGC_MODEL_DOCUMENT}` });
  if (atlas.length !== 1) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} atlas`, detail: `holds ${atlas.length} .atlas file(s) [${atlas.join(', ')}]; the packed build writes exactly one` });
  if (pack.length === 0) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} packed page`, detail: 'rigc printed no pack line, so no packed page is named; the build runs with --pack and must print one' });
  for (const p of pack) {
    if (!names.includes(p.page)) problems.push({ code: 'BUILD_ARTIFACT_PRESENT', object: `${buildDir} packed page`, detail: `the pack line names ${p.page}, which is not on disk` });
  }
  if (problems.length > 0) throw new PartsError(problems);
  return [join(buildDir, json[0]), join(buildDir, atlas[0]), ...pack.map((p) => join(buildDir, p.page))];
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
  // The idle-keys value is named only when it is not the default, so a build without the flag, or with the default, prints the line it printed before issue #95.
  const idleKeys = input.idleKeys ?? DEFAULT_IDLE_KEYS;
  log(`spine-parts build: ${input.config} -> ${out}, seam rule ${input.seam}, projection rule ${input.project}, page edges ${input.pageEdges}, pack shape ${input.packShape ?? DEFAULT_PACK_SHAPE}${idleKeys === DEFAULT_IDLE_KEYS ? '' : `, idle keys ${idleKeys}`}${input.loop ? ', with the idle loop' : ''}`);

  try {
    // build runs rig next, which needs the whole config, so the full loader is
    // asked first: a config rig would refuse is refused before assemble writes
    // anything, and under [assemble], as it was before the stage had its own
    // narrower door.
    loadConfig(input.config);
    // The same for the requirements file's own shape; its names resolve against the rig, in the check, before it builds.
    if (input.requirements !== undefined) readRequirements(input.requirements);
    assembleStage(
      { source: input.source, full: input.full, head: input.head, config: input.config, seam: input.seam, project: input.project },
      { partsJson: join(out, 'parts.json'), partsDir: join(out, 'parts'), recomposite: join(out, 'recomposite_rig.png'), errorMap: join(out, ERROR_MAP_FILE) },
      prefixed('assemble'),
    );
  } catch (err) {
    return refused('assemble', err);
  }

  try {
    rigStage({ config: input.config, parts: out, out: join(out, 'rig'), idleKeys, pageEdges: input.pageEdges, packShape: input.packShape, command: 'build' }, run.rig, run.scratch, prefixed('rig'));
  } catch (err) {
    return refused('rig', err);
  }

  let report: CheckReport;
  try {
    report = checkStage({ rig: join(out, 'rig'), parts: out, out: join(out, 'check'), pageEdges: input.pageEdges, packShape: input.packShape, ...(input.requirements === undefined ? {} : { requirements: input.requirements }) }, run.check, run.checkBin, prefixed('check'));
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
    artifact = artifactPaths(join(out, 'check', 'build'), report.pack);
  } catch (err) {
    return refused('artifact', err, report);
  }
  log(`build: PASS — the packed atlas is the artifact; parts/ and rig/ are the intermediates it was made from`);
  for (const l of packLines(report)) log(`  ${l}`);
  for (const a of artifact) log(`  ${a}`);
  return { stoppedAt: null, check: report, artifact };
}
