#!/usr/bin/env bun
/**
 * The motion gate of the automatic mesh mode (`src/automotion.ts`, issue #126
 * item 3) over the public examples, by one command:
 *
 *     bun run fetch-examples          # once: examples/{demo,sample,scarf}/inputs
 *     bun tools/auto_motion_survey.ts
 *
 * Which parts: the eight that item 2 accepted on geometry (issue #126, the
 * item-2 comment: demo `neck`, `bottomwear`; sample `neck`, `sleeves`,
 * `topwear`, `bottomwear`; scarf `hair_front`, `handwear_l`), each switched
 * **alone** to `auto` in its example's own config. The policy, stated before
 * any comparison ran and not tuned per part: `examplePolicy(spacing)`
 * (`fixtures/automesh.ts`, with the part's tracked spacing — its lattice
 * `grid`, or the contour spacing of a part already in that mode) plus
 * `policyMotion` (`fixtures/automotion.ts`: `maxLocalDeformation` = the
 * policy's `maxBoundaryDeviation`, no stretch bounds, no `deformMayFold`).
 *
 * What runs: `assembleStage` on the example's fetched inputs, then the real
 * `rigStage` — the gate build, the reference build and spine-rigc's
 * `compareMeshesInMotion` — through the installed rigc, in a temporary
 * directory that is removed afterwards. The stage's verdict decides the
 * verdict column; the rows of a refused part, which the stage does not write,
 * are read from the same comparison re-run on the two model documents the
 * stage's builds wrote (the stage's own function, `runComparison`), and the
 * tool refuses to print a row whose re-run verdict disagrees with the
 * stage's. The case is rebuilt by `buildRig` with the stage's own reduction
 * handed back (`reuseReductions`, keyed by the whole input), so each part's
 * `reduceMesh` runs once (issue #135).
 *
 * Output: Markdown — one table, one schedule line per part, and the refusal
 * text of every refused part. Every number is read from spine-rigc's report;
 * no path, no time and no machine is printed, so two runs of one tree print
 * the same bytes. Exit 1 when an example's inputs are missing (it names
 * them) or a re-run disagrees with the stage; 0 otherwise, refused parts
 * included — a refusal is a result.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MeasureRow, MeshQualityReport } from 'spine-rigc/mesh';
import { DEFAULT_PROJECT_RULE, DEFAULT_SEAM_RULE } from '../src/assemble.ts';
import { type Reducer, type ReductionResult, reductionKey, reuseReductions, runReduction } from '../src/automesh.ts';
import { motionInput, motionVerdict, runComparison } from '../src/automotion.ts';
import { assembleStage, RIGC_MODEL_DOCUMENT, rigStage } from '../src/build.ts';
import { findRigc, type RigcRunner } from '../src/check.ts';
import { loadConfig } from '../src/config.ts';
import { PartsError, problemLine } from '../src/errors.ts';
import { readParts } from '../src/parts.ts';
import { readPng, type Raster } from '../src/raster/index.ts';
import { buildRig } from '../src/rig.ts';
import { examplePolicy } from '../fixtures/automesh.ts';
import { withPolicyMotion } from '../fixtures/automotion.ts';

const ROOT = resolve(import.meta.dir, '..');

/** The parts item 2 accepted on geometry, by example (issue #126, the item-2 comment). */
const PARTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['demo', ['neck', 'bottomwear']],
  ['sample', ['neck', 'sleeves', 'topwear', 'bottomwear']],
  ['scarf', ['hair_front', 'handwear_l']],
];

interface Measured {
  example: string;
  part: string;
  counts: string;
  refusal: string | null;
  report: MeshQualityReport | null;
}

const missing = PARTS.map(([k]) => k).filter((k) => !existsSync(join(ROOT, 'examples', k, 'inputs', 'painting.png')));
if (missing.length > 0) {
  console.error(`auto_motion_survey: no fetched inputs for ${missing.map((k) => `examples/${k}/inputs`).join(', ')}; run \`bun run fetch-examples\` first`);
  process.exit(1);
}

const rigcBin = findRigc(ROOT, '');
const work = mkdtempSync(join(tmpdir(), 'spine-parts-auto-motion-survey-'));
const results: Measured[] = [];
let disagreements = 0;
try {
  for (const [key, parts] of PARTS) {
    const ex = join(ROOT, 'examples', key);
    const asm = join(work, key, 'asm');
    assembleStage(
      { source: join(ex, 'inputs', 'painting.png'), full: join(ex, 'inputs', 'layers', 'full'), head: join(ex, 'inputs', 'layers', 'head'), config: join(ex, 'config.json'), seam: DEFAULT_SEAM_RULE, project: DEFAULT_PROJECT_RULE },
      { partsJson: join(asm, 'parts.json'), partsDir: join(asm, 'parts'), recomposite: join(asm, 'recomposite_rig.png'), errorMap: join(asm, 'recomposite_error_rig.png') },
      () => {},
    );
    for (const part of parts) {
      const raw = JSON.parse(readFileSync(join(ex, 'config.json'), 'utf8')) as { meshes: Record<string, { grid?: number; contour?: { spacing: number }; r: number; segments: unknown }> };
      const m = raw.meshes[part];
      const spacing = m.grid ?? m.contour?.spacing;
      if (spacing === undefined) throw new Error(`examples/${key}/config.json meshes.${part} has neither grid nor contour.spacing`);
      (raw.meshes as Record<string, unknown>)[part] = { auto: withPolicyMotion(examplePolicy(spacing)), r: m.r, segments: m.segments };
      const dir = join(work, key, part);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify(raw, null, 1));
      // The documents the stage's builds wrote: 0 is the gate build (the candidate), 1 the reference.
      const models: Array<string | null> = [];
      const runner: RigcRunner = (args) => {
        const r = spawnSync(rigcBin, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
        if (args[0] === 'build') {
          const path = join(args[args.indexOf('--out') + 1], RIGC_MODEL_DOCUMENT);
          models.push(r.status === 0 && existsSync(path) ? readFileSync(path, 'utf8') : null);
        }
        return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
      };
      let refusal: string | null = null;
      // The stage's reductions, kept by input so the rebuild below reuses them instead of running them again.
      const reduced = new Map<string, ReductionResult>();
      const recording: Reducer = (object, input) => {
        const r = runReduction(object, input);
        reduced.set(reductionKey(input), r);
        return r;
      };
      try {
        rigStage({ config: join(dir, 'config.json'), parts: asm, out: join(dir, 'rig'), reduce: recording }, runner, join(dir, 'scratch'), () => {});
      } catch (err) {
        if (!(err instanceof PartsError)) throw err;
        refusal = err.problems.map(problemLine).join('\n');
      }
      // The case the stage compared, rebuilt from the same config and parts (buildRig is pure: the same bytes).
      const images = new Map<string, Raster>();
      const partsFile = readParts(join(asm, 'parts.json'));
      for (const p of partsFile.parts) images.set(p.name, readPng(join(asm, 'parts', `${p.name}.png`)));
      const rig = buildRig(loadConfig(join(dir, 'config.json')), partsFile, images, undefined, undefined, reuseReductions(reduced).reduce);
      const c = rig.autoMotion[0];
      const row = rig.meshReport.find((x) => x.part === part);
      const counts = row !== undefined && 'mode' in row && row.mode === 'auto' && row.source.counts !== null ? `${row.source.counts.boundaryVertices}+${row.source.counts.interiorVertices} → ${row.result.counts.boundaryVertices}+${row.result.counts.interiorVertices}` : 'not built';
      let report: MeshQualityReport | null = null;
      if (c !== undefined && c.motion !== undefined && models.length === 2 && models[0] !== null && models[1] !== null) {
        const ran = runComparison(c.object, motionInput(c, c.motion, models[1], models[0]));
        if (!('code' in ran)) {
          report = ran;
          if ((motionVerdict(c.object, ran) === null) !== (refusal === null)) {
            disagreements++;
            console.error(`auto_motion_survey: ${key}/${part}: the re-run comparison ${refusal === null ? 'refuses' : 'accepts'} what the stage ${refusal === null ? 'accepted' : 'refused'}`);
          }
        }
      }
      results.push({ example: key, part, counts, refusal, report });
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const rowOf = (r: MeshQualityReport | null, code: string): MeasureRow | undefined => r?.candidates[0]?.motion?.rows.find((x) => x.code === code && x.object.region === null);
const cell = (x: MeasureRow | undefined): string => (x === undefined || x.value === null ? 'not measured' : `${x.value}${x.bound === null ? '' : ` / ${x.bound.op} ${x.bound.value}`}${x.worst?.frame === undefined ? '' : ` @ ${x.worst.frame.id}`}`);

console.log('## The motion gate on the public examples (tools/auto_motion_survey.ts)\n');
console.log('Policy: examplePolicy(spacing) (fixtures/automesh.ts) + policyMotion (fixtures/automotion.ts); each part switched alone; the real rig stage through the installed spine-rigc.\n');
console.log('| part | source → result (hull+interior) | MQ_LOCAL_DEFORMATION value / bound @ worst frame | samples (art) | MQ_STRETCH | MQ_SQUASH | MQ_INVERSION | verdict |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  const local = rowOf(r.report, 'MQ_LOCAL_DEFORMATION');
  const samples = local?.sampling === undefined ? 'not measured' : `${local.sampling.count} (${local.art?.samples ?? 'n/a'})`;
  const verdict = r.refusal === null ? 'accepted' : `refused ${r.refusal.split(':')[0]}`;
  console.log(`| ${r.example}/${r.part} | ${r.counts} | ${cell(local)} | ${samples} | ${cell(rowOf(r.report, 'MQ_STRETCH'))} | ${cell(rowOf(r.report, 'MQ_SQUASH'))} | ${cell(rowOf(r.report, 'MQ_INVERSION'))} | ${verdict} |`);
}
console.log('\n### The schedule walked\n');
for (const r of results) {
  const s = r.report?.candidates[0]?.motion?.schedule;
  if (s === undefined) {
    console.log(`- ${r.example}/${r.part}: no comparison ran`);
    continue;
  }
  const rates = s.frames.map((f) => (f === 'setup' ? 'setup' : 'fps' in f ? `${f.animation} at ${f.fps} fps` : `${f.animation} at ${f.times.length} explicit time(s)`)).join(', ');
  const perPhase = s.phases.map((p) => `${p} ${s.walked.filter((w) => w.phase === p).length}`).join(', ');
  const physics = s.physics.mode === 'step' ? `step dt ${s.physics.dt}, warmupSteps ${s.physics.warmupSteps}` : 'none';
  console.log(`- ${r.example}/${r.part}: ${rates}; frames ${perPhase}; physics ${physics}; held out ${s.heldOutClaim}, selection [${s.selection.join(', ')}]`);
}
const refused = results.filter((r) => r.refusal !== null);
if (refused.length > 0) {
  console.log('\n### Refusals\n');
  for (const r of refused) console.log(`- ${r.example}/${r.part}: ${r.refusal}`);
}
console.log(`\n${results.length - refused.length} of ${results.length} accepted, ${refused.length} refused.`);
if (disagreements > 0) process.exit(1);
