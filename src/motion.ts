/**
 * The idle: every channel a sine, one blink, and the control bones that move
 * idle keys off the bones a mesh is weighted to.
 *
 * ## Sines
 *
 * `v(t) = base + amp * sin(2 pi (t / period - phase))`, sampled at
 * {@link KEYS_PER_PERIOD} keys per period across the idle, each key carrying
 * the EXACT Hermite tangent of the sine as a raw bezier `curve`:
 * `[t + dt/3, v + m dt/3, t1 - dt/3, v1 - m1 dt/3]` with `m = v'(t)`. A
 * cubic bezier with those handles matches the sine's value and slope at both
 * ends of every span, so the loop has no hitch at the seam and none inside.
 * The loader already refuses a period that does not divide the idle
 * (`CONFIG_PERIOD_DIVIDES_DURATION`), so the last key is the first key's value.
 *
 * A chain track drives `rotate` on every link, link `i` at phase
 * `phase + lag * i` and amplitude `amps[i]` — amplitude growing and phase
 * lagging down the chain is written in the config, not computed here. A
 * single track without `base` oscillates about 0: `base` is the value the
 * sine is centred on, and an absent one is the sine as written.
 *
 * Times are rounded to 6 decimals and values to 4, as the reference wrote them.
 *
 * ## Blink
 *
 * The `eyes` group's `scaley` goes 1 -> `squash` -> 1 and the `brows`
 * group's `translatey` 0 -> `-brow_drop` -> 0, with the reference's fixed
 * timing: eyes shut over {@link BLINK.shut} s, hold {@link BLINK.hold} s, open
 * over {@link BLINK.open} s; brows 0.08 / 0.04 / 0.20 s. The two named easings
 * are the reference's. A blink whose window does not fit strictly inside the
 * idle would write keys out of order, and is refused (`RIG_BLINK_INSIDE_IDLE`).
 * The squash pivots at each eye bone's origin, so a part's rows above it move
 * down by (1 - squash) times their height above it; the rows a
 * `motion.blink.still` entry cuts off sit on a bone no group names and do not
 * move at all (`src/rig.ts`).
 *
 * ## Control bones — `A15_IDLE_NO_MESH_BONE_KEYS`
 *
 * spine-rigc's `spine-html` profile refuses an `idle` that keys a bone a mesh
 * is weighted to (the player skips idle work on meshes). The reference's
 * answer, ported as is: for every keyed bone that some mesh names among its
 * candidates, add a parent `<bone>_ctl` at the SAME origin, re-parent the bone
 * under it, and move the keys to the control. The pose is identical.
 *
 * ⚠️ **This satisfies the rule's wording only.** The meshes are still
 * deformed every frame — by the control's motion, through the bone they are
 * weighted to — so whatever cost `A15` exists to keep off the player is paid
 * all the same. How a weighted-mesh painting rig should meet that rule is an
 * open question about the rule, not something this function settles.
 *
 * One correction to the reference: it moved single-bone tracks to the control
 * but left the blink GROUPS naming the original bone, so a mesh-bound eye or
 * brow bone would get a control nobody keys and keep its own keys — red under
 * `A15`. Here a group member that got a control is renamed with it.
 */
import type { CharacterConfig } from './config.ts';
import { pyRound } from './round.ts';

export const KEYS_PER_PERIOD = 8;

/** The blink's fixed timing, in seconds after `blink.t`. */
export const BLINK = {
  shut: 0.07,
  hold: 0.04,
  open: 0.16,
  browShut: 0.08,
  browHold: 0.04,
  browOpen: 0.2,
} as const;

export const EASINGS: Record<string, [number, number, number, number]> = {
  shut: [0.5, 0, 0.9, 0.6],
  open: [0.1, 0.4, 0.4, 1],
};

export const IDLE_NOTE =
  'Breath (chest), head roll, hair/accessory sway, sleeve and hem sway, one blink. Sines with exact tangents; phase lags down every chain.';

export const CONTROL_SUFFIX = '_ctl';

export interface MotionKey {
  t: number;
  v: number[];
  curve?: [number, number, number, number];
  ease?: string;
}

export interface MotionTrack {
  bone?: string;
  group?: string;
  property: string;
  keys: MotionKey[];
}

export interface MotionSpec {
  spec: 'rigc-motion/1';
  archetype: string;
  cut: string;
  easings: Record<string, [number, number, number, number]>;
  groups: Record<string, string[]>;
  animations: { idle: { duration: number; loop: true; note: string; tracks: MotionTrack[] } };
}

/** One sine channel over an idle of `duration` seconds. */
export function sineTrack(bone: string, property: string, amp: number, period: number, phase: number, base: number, duration: number): MotionTrack {
  const n = Math.round((duration / period) * KEYS_PER_PERIOD);
  const w = (2 * Math.PI) / period;
  const raw: Array<[number, number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const t = (duration * k) / n;
    const arg = w * t - 2 * Math.PI * phase;
    raw.push([t, base + amp * Math.sin(arg), amp * w * Math.cos(arg)]);
  }
  const keys: MotionKey[] = raw.map(([t, v, m], i) => {
    const key: MotionKey = { t: pyRound(t, 6), v: [pyRound(v, 4)] };
    if (i < raw.length - 1) {
      const [t1, v1, m1] = raw[i + 1];
      const dt = t1 - t;
      key.curve = [pyRound(t + dt / 3, 6), pyRound(v + (m * dt) / 3, 4), pyRound(t1 - dt / 3, 6), pyRound(v1 - (m1 * dt) / 3, 4)];
    }
    return key;
  });
  return { bone, property, keys };
}

/** The idle as the config states it, before control bones. `chains` maps a chain name to its link names. */
export function idleMotion(cfg: CharacterConfig, chains: ReadonlyMap<string, string[]>): MotionSpec {
  const mc = cfg.motion;
  const T = mc.duration;
  const tracks: MotionTrack[] = [];
  for (const tr of mc.tracks) {
    if ('chain' in tr) {
      const links = chains.get(tr.chain) ?? [];
      links.forEach((link, i) => tracks.push(sineTrack(link, 'rotate', tr.amps[i], tr.period, tr.phase + tr.lag * i, 0, T)));
    } else {
      tracks.push(sineTrack(tr.bone, tr.prop, tr.amp, tr.period, tr.phase, tr.base ?? 0, T));
    }
  }
  const groups: Record<string, string[]> = {};
  const bl = mc.blink;
  if (bl !== undefined) {
    const tb = bl.t;
    groups.eyes = [...bl.eyes];
    groups.brows = [...bl.brows];
    const at = (dt: number): number => pyRound(tb + dt, 6);
    tracks.push({
      group: 'eyes',
      property: 'scaley',
      keys: [
        { t: 0, v: [1] },
        { t: tb, v: [1], ease: 'shut' },
        { t: at(BLINK.shut), v: [bl.squash] },
        { t: at(BLINK.shut + BLINK.hold), v: [bl.squash], ease: 'open' },
        { t: at(BLINK.shut + BLINK.hold + BLINK.open), v: [1] },
        { t: T, v: [1] },
      ],
    });
    tracks.push({
      group: 'brows',
      property: 'translatey',
      keys: [
        { t: 0, v: [0] },
        { t: tb, v: [0], ease: 'shut' },
        { t: at(BLINK.browShut), v: [-bl.brow_drop] },
        { t: at(BLINK.browShut + BLINK.browHold), v: [-bl.brow_drop], ease: 'open' },
        { t: at(BLINK.browShut + BLINK.browHold + BLINK.browOpen), v: [0] },
        { t: T, v: [0] },
      ],
    });
  }
  const name = `${cfg.key}_painting`;
  return {
    spec: 'rigc-motion/1',
    archetype: name,
    cut: name,
    easings: { shut: [...EASINGS.shut], open: [...EASINGS.open] },
    groups,
    animations: { idle: { duration: T, loop: true, note: IDLE_NOTE, tracks } },
  };
}

/** The last time any blink key sits at before the closing key, in seconds after `blink.t`. */
export const BLINK_SPAN = Math.max(BLINK.shut + BLINK.hold + BLINK.open, BLINK.browShut + BLINK.browHold + BLINK.browOpen);

/**
 * The bones that get a `<bone>_ctl`: keyed by a single track or named by a
 * blink group, AND named by some mesh's candidates. Sorted, as the reference
 * sorted them — the order they are appended to the bone table.
 */
export function controlledBones(motion: MotionSpec, meshBones: ReadonlySet<string>): string[] {
  const keyed = new Set<string>();
  for (const t of motion.animations.idle.tracks) if (t.bone !== undefined) keyed.add(t.bone);
  for (const members of Object.values(motion.groups)) for (const b of members) if (meshBones.has(b)) keyed.add(b);
  return [...keyed].filter((b) => meshBones.has(b)).sort();
}

/** Rename every key on a controlled bone — track or group member — to its control. */
export function moveKeysToControls(motion: MotionSpec, controlled: readonly string[]): void {
  const set = new Set(controlled);
  for (const t of motion.animations.idle.tracks) if (t.bone !== undefined && set.has(t.bone)) t.bone = `${t.bone}${CONTROL_SUFFIX}`;
  for (const g of Object.keys(motion.groups)) motion.groups[g] = motion.groups[g].map((b) => (set.has(b) ? `${b}${CONTROL_SUFFIX}` : b));
}
