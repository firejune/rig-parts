/**
 * Finished single-character builds for the `scene` controls (issue #74),
 * generated on every run: the rig fixture (`fixtures/rig.ts`, a 40x40 canvas,
 * two parts, a `hem` chain and an `eye`) run through the rig stage's own
 * `buildRig`, written where `build --out` writes it — `parts.json`,
 * `rig/rig.json`, `rig/motion.json`, `rig/images/` — beside a
 * `check/check.json` that says the build's own check was green.
 *
 * ⭐ That check.json is written by hand: it stands for "this build's check
 * passed", which `compose` requires and does not re-run. The composed rig is
 * what the controls gate through rig-c and check; the characters' own
 * builds are not. No claim about appearance comes from these fixtures.
 *
 * Two characters:
 *
 * - `plain`: {@link rigConfig} under `--idle-keys ctl` — controls, no
 *   constraint, no invariants.
 * - `reach`: {@link constraintConfig} with a two-bone ik over `hem0`, `hem1`
 *   following the scene target `tgt` (a bone under `root`), under
 *   `--idle-keys direct` — so its rig carries `constraints`,
 *   `invariants.idleDrivesMeshes` and `invariants.detached`, every name kind
 *   compose has to prefix.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { serializeParts } from '../src/parts.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { newRaster } from '../src/raster/types.ts';
import { buildRig, type IdleKeys, rigJsonText, type RigOutput } from '../src/rig.ts';
import { constraintConfig, rigConfig, rigImages, rigParts } from './rig.ts';

/** The ik the `reach` character carries: rigc's own shape, as `config.constraints` writes it. */
export const REACH_IK = { type: 'ik', name: 'reach', bones: ['hem0', 'hem1'], target: 'tgt' } as const;

export type SceneCharacterKind = 'plain' | 'reach';

/** The rig stage's output for one fixture character. */
export function sceneCharacterRig(kind: SceneCharacterKind): RigOutput {
  const raw = kind === 'plain' ? rigConfig() : constraintConfig([{ ...REACH_IK, bones: [...REACH_IK.bones] }]);
  const keys: IdleKeys = kind === 'plain' ? 'ctl' : 'direct';
  return buildRig(parseConfig(raw as Parameters<typeof parseConfig>[0]), rigParts(), rigImages(), undefined, keys);
}

export interface SceneBuildOptions {
  /** check/check.json's PASS and gate_spine_html_green; both true when absent. */
  pass?: boolean;
  /** Edit the rig before it is written (a planted fault). */
  rig?: (rig: Record<string, unknown>) => void;
  /** Edit the motion before it is written (a planted fault). */
  motion?: (motion: Record<string, unknown>) => void;
  /** parts.json's scale_rig_per_source; the fixture's 0.5 when absent. */
  rigScale?: number;
  /** Leave check/check.json out. */
  noCheck?: boolean;
}

/** Write one fixture character as `build --out` leaves it, under `dir`. Returns `dir`. */
export function writeSceneBuild(dir: string, kind: SceneCharacterKind, opts: SceneBuildOptions = {}): string {
  const out = sceneCharacterRig(kind);
  const rig = JSON.parse(rigJsonText(out.rig)) as Record<string, unknown>;
  const motion = JSON.parse(rigJsonText(out.motion)) as Record<string, unknown>;
  opts.rig?.(rig);
  opts.motion?.(motion);
  mkdirSync(join(dir, 'rig', 'images'), { recursive: true });
  for (const [file, img] of out.images) writeFileSync(join(dir, 'rig', 'images', file), encodePngBytes(img));
  writeFileSync(join(dir, 'rig', 'rig.json'), rigJsonText(rig));
  writeFileSync(join(dir, 'rig', 'motion.json'), rigJsonText(motion));
  writeFileSync(join(dir, 'parts.json'), serializeParts({ ...rigParts(), scale_rig_per_source: opts.rigScale ?? 0.5 }));
  if (opts.noCheck !== true) {
    mkdirSync(join(dir, 'check'), { recursive: true });
    const green = opts.pass ?? true;
    writeFileSync(join(dir, 'check', 'check.json'), `${JSON.stringify({ gate_spine_html_green: green, PASS: green }, null, 1)}\n`);
  }
  return dir;
}

/** A flat, opaque PNG of `w` x `h` in one colour: the generated plate (provenance `generated`). */
export function writeFlatPlate(path: string, w: number, h: number, rgb: readonly [number, number, number]): void {
  const r = newRaster(w, h);
  for (let i = 0; i < w * h; i++) r.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  writeFileSync(path, encodePngBytes(r));
}

/** A scene file's text: `spine-parts-scene/1` with the fields given, in the order the spec lists them. */
export function sceneText(body: Record<string, unknown>): string {
  return `${JSON.stringify({ spec: 'spine-parts-scene/1', ...body }, null, 1)}\n`;
}
