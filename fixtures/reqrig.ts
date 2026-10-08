/**
 * The rig the declared-requirement controls (issue #93) measure: a
 * `rigc-rig/1` spec with ik constraints written directly, as
 * {@link writeMergedCheckRig} writes its merged rig — the config cannot carry
 * constraints on this tree (that is #92's) — and a motion with four
 * animations, built and posed by the installed rig-c.
 *
 * Every expected figure is computed by hand from the numbers below, never read
 * off a run:
 *
 * - **arm** — `upper` (length {@link UPPER_LEN}) at the shoulder
 *   {@link SHOULDER}, `lower` (length {@link LOWER_LEN}) at its tip, a
 *   two-bone ik `arm_ik` at mix 1 aimed at `grip`, a bone whose parent is the
 *   root. Placed by a scene target from {@link REACH_FROM} to {@link REACH_TO}
 *   (all within reach) the tip sits on `grip`; from {@link OVERREACH_FROM} to
 *   {@link OVERREACH_TO} the last frame is {@link OVERREACH_TO} −
 *   (UPPER_LEN + LOWER_LEN) = 5 px beyond the straightened chain.
 * - **pointer** — one bone, length {@link POINTER_LEN}, under a one-bone ik
 *   `aim_ik` at `far`, {@link FAR_ABOVE} world units straight above its
 *   origin: it turns to 90° and points at `far` exactly, its tip
 *   FAR_ABOVE − POINTER_LEN short of it by construction.
 * - **vane** — one bone under a one-bone ik `vane_ik` at mix
 *   {@link VANE_MIX} aimed at `lure`, which sits {@link LURE_ANGLE}° off the
 *   vane's rest axis: released (mix 0) the vane rests at 0°, full (mix 1) it
 *   turns LURE_ANGLE°, as declared it turns VANE_MIX × LURE_ANGLE, so the
 *   follow measures VANE_MIX. `sweep` keys the mix 0 → 1 → 1 at t = 0, 0.5,
 *   1, so at {@link REQ_FPS} fps the five frames take 0, 0.5, 1, 1, 1 of the
 *   same drive and the follow measures their mean, 3.5 / 5 = 0.7.
 * - **swing** — keyed `rotate` 0 → {@link SWING_PEAK} → 0 on `reach`, and
 *   0 → {@link SWING_BROKEN} → 0 on `sweep` (one key changed).
 * - **stub** — a bone of length 0: it has no tip.
 * - **rider** — under a transform constraint `ride_tf` from `driver`, x to
 *   x only, at mixX {@link RIDE_MIX}; `reach` slides `driver`
 *   {@link DRIVER_SLIDE} right and back. A transform's mix blends the bone
 *   linearly between where it stands and where the constraint puts it, so
 *   the follow measures RIDE_MIX whatever the full pose is.
 *
 * The stage is {@link REQ_STAGE} (stage px, y down); a world point goes to the
 * stage through `cropToSpineY`, the one door.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cropToSpineY } from '../src/coords.ts';
import { encodePngBytes } from '../src/raster/png.ts';
import { checkPartRaster, MERGED_COPY_DX, writeMergedCheckRig } from './checkrig.ts';

export const REQ_STAGE = { x: -32, y: 0, width: 64, height: 64 };
export const REQ_FPS = 4;
export const UPPER_LEN = 10;
export const LOWER_LEN = 10;
export const SHOULDER = { x: 0, y: 32 };
/** World x of `grip` along the shoulder's row: within reach at both ends. */
export const REACH_FROM = 12;
export const REACH_TO = 18;
/** World x of `grip`: reachable at the start, 5 beyond the chain at the end. */
export const OVERREACH_FROM = 15;
export const OVERREACH_TO = 25;
export const POINTER_AT = { x: -20, y: 10 };
export const POINTER_LEN = 8;
export const FAR_ABOVE = 40;
export const VANE_AT = { x: 20, y: 10 };
export const VANE_MIX = 0.5;
export const LURE_ANGLE = 60;
export const LURE_DIST = 10;
export const SWING_PEAK = 20;
export const SWING_BROKEN = 40;
export const DRIVER_AT = { x: -10, y: 20 };
export const RIDER_AT = { x: -25, y: 20 };
export const DRIVER_SLIDE = 10;
export const RIDE_MIX = 0.5;

/** A world point as a stage point (stage px, y down), through the one y door. */
export function stageOf(wx: number, wy: number): [number, number] {
  return [wx - REQ_STAGE.x, cropToSpineY(wy - REQ_STAGE.y, REQ_STAGE.height)];
}

/** Write rig.json, motion.json and images/ — no parts.json and no idle, as a rig a consumer composed. */
export function writeReqRig(dir: string): void {
  mkdirSync(join(dir, 'images'), { recursive: true });
  // Two soft ellipses (a page holding one region is refused by rigc's A27, an opaque one by A19).
  const art = [
    { name: 'plate', x: 8, y: 8, w: 48, h: 48, rgb: [120, 120, 200] as [number, number, number] },
    { name: 'badge', x: 20, y: 20, w: 16, h: 16, rgb: [200, 160, 40] as [number, number, number] },
  ];
  for (const a of art) writeFileSync(join(dir, 'images', `${a.name}.png`), encodePngBytes(checkPartRaster(a)));
  const rad = (LURE_ANGLE * Math.PI) / 180;
  const rig = {
    spec: 'rigc-rig/1',
    name: 'req_probe',
    images: 'images',
    skeleton: REQ_STAGE,
    bones: [
      { name: 'root', x: 0, y: 0 },
      { name: 'upper', parent: 'root', x: SHOULDER.x, y: SHOULDER.y, length: UPPER_LEN },
      { name: 'lower', parent: 'upper', x: UPPER_LEN, y: 0, length: LOWER_LEN },
      { name: 'grip', parent: 'root', x: SHOULDER.x + (REACH_FROM + REACH_TO) / 2, y: SHOULDER.y },
      { name: 'pointer', parent: 'root', x: POINTER_AT.x, y: POINTER_AT.y, length: POINTER_LEN },
      { name: 'far', parent: 'root', x: POINTER_AT.x, y: POINTER_AT.y + FAR_ABOVE },
      { name: 'vane', parent: 'root', x: VANE_AT.x, y: VANE_AT.y, length: 6 },
      { name: 'lure', parent: 'root', x: VANE_AT.x + LURE_DIST * Math.cos(rad), y: VANE_AT.y + LURE_DIST * Math.sin(rad) },
      { name: 'swing', parent: 'root', x: -20, y: 40, length: 5 },
      { name: 'stub', parent: 'root', x: 0, y: 55 },
      { name: 'driver', parent: 'root', x: DRIVER_AT.x, y: DRIVER_AT.y },
      { name: 'rider', parent: 'root', x: RIDER_AT.x, y: RIDER_AT.y },
    ],
    slots: art.map((a) => ({ name: a.name, bone: 'root', attachment: a.name })),
    skins: { default: Object.fromEntries(art.map((a) => [a.name, { [a.name]: { image: `${a.name}.png`, x: REQ_STAGE.x + a.x + a.w / 2, y: REQ_STAGE.y + cropToSpineY(a.y + a.h / 2, REQ_STAGE.height) } }])) },
    constraints: [
      { type: 'ik', name: 'arm_ik', bones: ['upper', 'lower'], target: 'grip' },
      { type: 'ik', name: 'aim_ik', bones: ['pointer'], target: 'far' },
      { type: 'ik', name: 'vane_ik', bones: ['vane'], target: 'lure', mix: VANE_MIX },
      { type: 'transform', name: 'ride_tf', bones: ['rider'], source: 'driver', properties: { x: { to: { x: {} } } }, mixX: RIDE_MIX },
    ],
  };
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const swing = (peak: number): Record<string, unknown> => ({ bone: 'swing', property: 'rotate', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [peak] }, { t: 1, v: [0] }] });
  const motion = {
    spec: 'rigc-motion/1',
    archetype: 'req_probe',
    cut: 'req_probe',
    easings: {},
    groups: {},
    animations: {
      reach: { duration: 1, loop: false, tracks: [swing(SWING_PEAK), { bone: 'driver', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 0.5, v: [DRIVER_SLIDE] }, { t: 1, v: [0] }] }] },
      overreach: { duration: 1, loop: false, tracks: [swing(0)] },
      sweep: { duration: 1, loop: false, tracks: [swing(SWING_BROKEN)], ik: [{ constraint: 'vane_ik', keys: [{ t: 0, mix: 0 }, { t: 0.5, mix: 1 }, { t: 1, mix: 1 }] }] },
      still: { duration: 1, loop: false, tracks: [swing(0)] },
    },
  };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
}

/** A requirements file, written as JSON. */
export function writeRequirements(path: string, body: Record<string, unknown>): void {
  writeFileSync(path, `${JSON.stringify({ spec: 'spine-parts-requirements/1', fps: REQ_FPS, ...body }, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// a composed rig: one character's ik reaching for another character's bone
// ---------------------------------------------------------------------------

/** Character `a_`'s shoulder in world units: its `a_upper` sits here under `a_root` (at the origin). */
export const COMPOSED_SHOULDER = { x: 10, y: 40 };
/** World x of character `b_`'s `b_hand` at rest: 15 from the shoulder along its row, inside the 10 + 10 chain. */
export const COMPOSED_HAND_X = 25;

/**
 * The composed shape {@link writeMergedCheckRig} writes (two prefixed copies under one `root`, no
 * `parts.json`), with two bones added to each side: `a_upper` (length {@link UPPER_LEN}) and `a_lower`
 * (length {@link LOWER_LEN}) under `a_root`, and `b_hand` under `b_root` at world
 * ({@link COMPOSED_HAND_X}, shoulder y). A two-bone ik `a_reach` on A's arm takes B's bone as its target,
 * named as the composed rig names it. One animation, `greet`, slides B — `b_root` `translatex` 0 → `slide`
 * over 1 s — so `b_hand` is 15 + slide from the shoulder at t = 1 s: within the 20 the chain reaches for a
 * slide up to 5, and 15 + slide − 20 beyond it otherwise.
 */
export function writeComposedRig(dir: string, slide: number): void {
  writeMergedCheckRig(dir, { idle: false, plate: false });
  const rig = JSON.parse(readFileSync(join(dir, 'rig.json'), 'utf8')) as { bones: Array<Record<string, unknown>>; constraints?: unknown[] };
  rig.bones.push(
    { name: 'a_upper', parent: 'a_root', x: COMPOSED_SHOULDER.x, y: COMPOSED_SHOULDER.y, length: UPPER_LEN },
    { name: 'a_lower', parent: 'a_upper', x: UPPER_LEN, y: 0, length: LOWER_LEN },
    { name: 'b_hand', parent: 'b_root', x: COMPOSED_HAND_X - MERGED_COPY_DX, y: COMPOSED_SHOULDER.y },
  );
  rig.constraints = [{ type: 'ik', name: 'a_reach', bones: ['a_upper', 'a_lower'], target: 'b_hand' }];
  writeFileSync(join(dir, 'rig.json'), `${JSON.stringify(rig, null, 2)}\n`);
  const motion = JSON.parse(readFileSync(join(dir, 'motion.json'), 'utf8')) as { animations: Record<string, unknown> };
  motion.animations = { greet: { duration: 1, loop: false, tracks: [{ bone: 'b_root', property: 'translatex', keys: [{ t: 0, v: [0] }, { t: 1, v: [slide] }] }] } };
  writeFileSync(join(dir, 'motion.json'), `${JSON.stringify(motion, null, 2)}\n`);
}
